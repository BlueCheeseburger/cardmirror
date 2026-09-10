/**
 * Recognizer-worker voice service (voice v2). Consumes 16 kHz mono
 * s16le PCM; emits typed VoiceEvents. Two channels over one stream:
 *
 *  - Commands (ambient): Silero VAD finds utterance boundaries; each
 *    closed segment is padded with silence, transcribed in one shot,
 *    and matched against the twelve-word vocabulary with the
 *    whole-utterance rule (vocabulary.ts). While speech runs on (a
 *    noisy room keeps the VAD open), a rolling window of the trailing
 *    audio is decoded periodically so a command still lands (spec §6.1).
 *  - Dictation (held key): while the key is held, audio is buffered and
 *    the command path is suppressed structurally — the VAD is not fed.
 *    On release the whole utterance is transcribed once.
 *
 * No Electron imports: driven by PCM buffers and a clock, so it is
 * testable headless with a fake engine and synthetic audio.
 */
import { performance } from 'node:perf_hooks';
import { SAMPLE_RATE, VAD_WINDOW, type VadHandle, type VoiceEngine } from './engine';
import {
  matchCommand,
  matchPhrase,
  SLEEP_PHRASES,
  WAKE_PHRASES,
  type VoiceProfile,
} from '../../../../src/editor/voice/vocabulary';
import type { VoiceEvent, VoiceLevelEvent, VoiceMode } from './types';

export interface VoiceServiceOptions {
  engine: VoiceEngine;
  /** Idle seconds before auto-sleep. 0 disables; default 60. */
  autoSleepSeconds?: number;
  profile?: VoiceProfile | null;
  onEvent: (event: VoiceEvent) => void;
  onLevel?: (level: VoiceLevelEvent) => void;
  /** Clock override for tests. */
  now?: () => number;
}

const LEVEL_EVERY_MS = 250;
const AUTO_SLEEP_DEFAULT_S = 60;
const COUNTDOWN_WINDOW_MS = 10_000;
/** Silence padded around a segment before decoding — the spike measured
 *  +3/36 command words recognized from padding alone. */
export const PAD_MS = 300;
/** Longer than this is speech, not a command word. */
export const MAX_COMMAND_MS = 3000;
const MIN_SEGMENT_MS = 120;
/** Rolling decode while the VAD stays open (background speech). */
const ROLLING_AFTER_MS = 1500;
const ROLLING_EVERY_MS = 400;
const ROLLING_WINDOW_MS = 1200;
const RING_SECONDS = 6;
/** Audio kept from BEFORE a VAD segment's start (the detector opens a
 *  little late on soft onsets: "line" decoded as "fine" without it)
 *  and after its end. */
const PRE_ROLL_MS = 250;
const POST_ROLL_MS = 120;
const MAX_DICTATION_SECONDS = 120;

export class VoiceService {
  private vad: VadHandle | null = null;
  private mode: VoiceMode = 'command';
  private utteranceId = 0;
  private profile: VoiceProfile | null;
  /** Samples not yet forming a full VAD window. */
  private pending: Float32Array = new Float32Array(0);
  /** Ring of the most recent audio for rolling decodes. */
  private ring = new Float32Array(RING_SECONDS * SAMPLE_RATE);
  private ringWrite = 0;
  private ringFilled = 0;
  /** Samples pushed through the ring since start (absolute index base). */
  private samplesSeen = 0;
  private dictation: Float32Array[] | null = null;
  private dictationSamples = 0;
  private speechSince: number | null = null;
  private spanFired = false;
  private lastRollingAt = 0;
  private lastActivityAt = 0;
  private lastLevelAt = 0;
  private readonly now: () => number;

  constructor(private opts: VoiceServiceOptions) {
    this.profile = opts.profile ?? null;
    this.now = opts.now ?? (() => performance.now());
  }

  get currentMode(): VoiceMode {
    return this.mode;
  }

  start(): void {
    this.vad = this.opts.engine.createVad();
    this.lastActivityAt = this.now();
  }

  stop(): void {
    this.vad = null;
    this.dictation = null;
    this.dictationSamples = 0;
  }

  setProfile(profile: VoiceProfile | null): void {
    this.profile = profile;
  }

  /** Held-key dictation: on = buffer and suppress commands; off =
   *  transcribe what was buffered and return to command listening. */
  setDictation(on: boolean): void {
    const now = this.now();
    if (on) {
      if (this.mode === 'dictation') return;
      this.dictation = [];
      this.dictationSamples = 0;
      this.setMode('dictation', 'hold', now);
      return;
    }
    if (this.mode !== 'dictation') return;
    const chunks = this.dictation ?? [];
    this.dictation = null;
    const total = this.dictationSamples;
    this.dictationSamples = 0;
    // The VAD saw none of the held audio; drop any half-open state so the
    // first post-release command decodes clean.
    this.vad?.reset();
    this.pending = new Float32Array(0);
    this.speechSince = null;
    this.spanFired = false;
    this.lastActivityAt = now;
    this.setMode('command', 'release', now);
    const durationMs = (total / SAMPLE_RATE) * 1000;
    const id = ++this.utteranceId;
    if (durationMs < PAD_MS) {
      this.opts.onEvent({ utteranceId: id, mode: 'command', raw: '', tEndOfSpeech: now, tParse: now, kind: 'dictation', text: '', durationMs });
      return;
    }
    const samples = new Float32Array(total);
    let at = 0;
    for (const c of chunks) {
      samples.set(c, at);
      at += c.length;
    }
    const text = this.opts.engine.decode(pad(samples)).trim();
    this.opts.onEvent({ utteranceId: id, mode: 'command', raw: text, tEndOfSpeech: now, tParse: this.now(), kind: 'dictation', text, durationMs });
  }

  /** Feed one chunk of 16 kHz mono s16le PCM. */
  pushAudio(pcm: Buffer): void {
    if (!this.vad) return;
    const n = Math.floor(pcm.length / 2);
    const samples = new Float32Array(n);
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const s = pcm.readInt16LE(i * 2);
      samples[i] = s / 32768;
      sumSq += s * s;
    }
    const rms = n ? Math.sqrt(sumSq / n) : 0;
    const now = this.now();

    if (this.mode === 'dictation' && this.dictation) {
      if (this.dictationSamples < MAX_DICTATION_SECONDS * SAMPLE_RATE) {
        this.dictation.push(samples);
        this.dictationSamples += n;
      }
      this.report(now, rms, true, undefined);
      return;
    }

    this.pushRing(samples);
    // Feed the VAD in its fixed windows.
    const merged = concat(this.pending, samples);
    let off = 0;
    for (; off + VAD_WINDOW <= merged.length; off += VAD_WINDOW) {
      this.vad.acceptWaveform(merged.subarray(off, off + VAD_WINDOW));
    }
    this.pending = merged.subarray(off).slice();

    const detected = this.vad.isDetected();
    if (detected) {
      if (this.speechSince === null) this.speechSince = now;
      this.lastActivityAt = now;
    }
    while (!this.vad.isEmpty()) {
      const seg = this.vad.front();
      this.vad.pop();
      this.handleSegment(this.withContext(seg.start, seg.samples), now);
      this.speechSince = null;
      this.spanFired = false;
    }
    if (!detected) this.speechSince = null;

    // Rolling decode: speech has run on without closing (background talk
    // keeps the VAD open) — look for a command word in the trailing window.
    if (
      this.mode === 'command' &&
      detected &&
      this.speechSince !== null &&
      now - this.speechSince >= ROLLING_AFTER_MS &&
      now - this.lastRollingAt >= ROLLING_EVERY_MS &&
      !this.spanFired
    ) {
      this.lastRollingAt = now;
      const window = this.ringTail(Math.round((ROLLING_WINDOW_MS / 1000) * SAMPLE_RATE));
      if (window.length >= SAMPLE_RATE / 4) {
        const text = this.opts.engine.decode(pad(window)).trim();
        const verb = matchCommand(text, this.profile);
        if (verb) {
          this.spanFired = true;
          const id = ++this.utteranceId;
          this.opts.onEvent({ utteranceId: id, mode: this.mode, raw: text, tEndOfSpeech: now, tParse: this.now(), kind: 'command', verb });
        }
      }
    }

    // Idle auto-sleep: a forgotten mic must not transcribe the room.
    const autoSleepMs = (this.opts.autoSleepSeconds ?? AUTO_SLEEP_DEFAULT_S) * 1000;
    let autoSleepRemainingMs: number | undefined;
    if (autoSleepMs > 0 && this.mode === 'command') {
      const remaining = autoSleepMs - (now - this.lastActivityAt);
      if (remaining <= 0) this.setMode('asleep', 'auto-sleep', now);
      else if (remaining <= COUNTDOWN_WINDOW_MS) autoSleepRemainingMs = remaining;
    }
    this.report(now, rms, detected, autoSleepRemainingMs);
  }

  private report(now: number, rms: number, speech: boolean, autoSleepRemainingMs: number | undefined): void {
    if (!this.opts.onLevel || now - this.lastLevelAt < LEVEL_EVERY_MS) return;
    this.lastLevelAt = now;
    this.opts.onLevel({ rms, speech, autoSleepRemainingMs });
  }

  private handleSegment(samples: Float32Array, now: number): void {
    const durationMs = (samples.length / SAMPLE_RATE) * 1000;
    if (durationMs < MIN_SEGMENT_MS) return;
    if (this.mode === 'asleep') {
      // Only the wake phrase exists while asleep; everything else is
      // discarded with no event (near-zero false positives).
      if (durationMs > 4000) return;
      const text = this.opts.engine.decode(pad(samples)).trim();
      if (matchPhrase(text, WAKE_PHRASES)) this.setMode('command', 'voice wake', now);
      return;
    }
    if (this.mode !== 'command') return;
    if (this.spanFired) return; // the rolling decode already fired for this span
    const id = ++this.utteranceId;
    const base = { utteranceId: id, mode: this.mode, tEndOfSpeech: now };
    if (durationMs > MAX_COMMAND_MS) {
      this.opts.onEvent({ ...base, raw: '', tParse: this.now(), kind: 'rejection', reason: 'too-long' });
      return;
    }
    const text = this.opts.engine.decode(pad(samples)).trim();
    const tParse = this.now();
    // Noise the VAD opened on but the recognizer heard nothing in: no
    // event at all (an empty "(not a command)" echo is just churn).
    if (!text) return;
    const verb = matchCommand(text, this.profile);
    if (verb) {
      this.opts.onEvent({ ...base, raw: text, tParse, kind: 'command', verb });
      return;
    }
    if (matchPhrase(text, SLEEP_PHRASES)) {
      this.setMode('asleep', 'voice sleep', now);
      return;
    }
    this.opts.onEvent({ ...base, raw: text, tParse, kind: 'rejection', reason: 'out-of-vocabulary' });
  }

  private setMode(to: VoiceMode, trigger: string, now: number): void {
    const from = this.mode;
    if (from === to) return;
    this.mode = to;
    if (to !== 'dictation') this.lastActivityAt = now;
    this.opts.onEvent({ utteranceId: this.utteranceId, mode: to, raw: trigger, tEndOfSpeech: now, tParse: now, kind: 'mode', from, to, trigger });
  }

  private pushRing(samples: Float32Array): void {
    for (let i = 0; i < samples.length; i++) {
      this.ring[this.ringWrite] = samples[i] as number;
      this.ringWrite = (this.ringWrite + 1) % this.ring.length;
    }
    this.ringFilled = Math.min(this.ring.length, this.ringFilled + samples.length);
    this.samplesSeen += samples.length;
  }

  /** The VAD segment re-read from the ring with pre- and post-roll, so
   *  onset consonants the detector opened late on are in the decode.
   *  `start` is the segment's absolute sample index (the VAD counts every
   *  sample it was fed, which is every sample the ring saw). Falls back
   *  to the bare segment when the ring no longer covers it. */
  private withContext(start: number, samples: Float32Array): Float32Array {
    const pre = Math.round((PRE_ROLL_MS / 1000) * SAMPLE_RATE);
    const post = Math.round((POST_ROLL_MS / 1000) * SAMPLE_RATE);
    // The VAD only sees whole windows; `pending` samples are not in its count.
    const from = Math.max(0, start - pre);
    const to = Math.min(this.samplesSeen, start + samples.length + post);
    const oldest = this.samplesSeen - this.ringFilled;
    if (from < oldest || to <= from) return samples;
    const out = new Float32Array(to - from);
    for (let i = 0; i < out.length; i++) out[i] = this.ring[(from + i) % this.ring.length] as number;
    return out;
  }

  private ringTail(n: number): Float32Array {
    const take = Math.min(n, this.ringFilled);
    const out = new Float32Array(take);
    let idx = (this.ringWrite - take + this.ring.length) % this.ring.length;
    for (let i = 0; i < take; i++) {
      out[i] = this.ring[idx] as number;
      idx = (idx + 1) % this.ring.length;
    }
    return out;
  }
}

function concat(a: Float32Array, b: Float32Array): Float32Array {
  if (a.length === 0) return b;
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Silence padding around a segment (PAD_MS each side). */
export function pad(samples: Float32Array, ms = PAD_MS): Float32Array {
  const n = Math.round((ms / 1000) * SAMPLE_RATE);
  const out = new Float32Array(n + samples.length + n);
  out.set(samples, n);
  return out;
}
