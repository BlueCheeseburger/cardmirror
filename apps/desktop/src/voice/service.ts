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
 *  - Dictation (key held, or toggled on): the command path is suppressed
 *    structurally; the VAD keeps finding utterances and each run of
 *    speech lands as soon as it is followed by a pause (DICTATION_PAUSE_MS),
 *    so text appears sentence by sentence and no session ever becomes one
 *    huge decode. Release (or the second press) flushes the tail. A toggle
 *    session may also carry a silence limit: `autoEndAfterMs` without
 *    speech ends dictation from here, with a 'silence' mode event, so a
 *    forgotten toggle does not transcribe the room.
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
  /** Diagnostic tap: every command-mode utterance the recognizer decoded,
   *  with what it heard — the worker can write these to disk so a
   *  recognition problem can be reproduced offline. */
  onSegment?: (samples: Float32Array, info: { text: string; verb: string | null; durationMs: number }) => void;
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
/** A pause this long inside a dictation lands what came before it. */
export const DICTATION_PAUSE_MS = 700;
/** Land at the next utterance boundary once this much speech has piled up. */
const DICTATION_FLUSH_SECONDS = 20;
/** Absolute cap on un-landed dictation audio. */
const MAX_DICTATION_SECONDS = 120;

interface DictationSession {
  chunks: Float32Array[];
  /** Samples queued for the next landing, context rolls included. */
  samples: number;
  /** Raw speech in the queue (what the detector itself flagged). */
  speechSamples: number;
  startedAt: number;
  /** When the VAD last closed a run of speech; null until the first one. */
  lastSpeechEndAt: number | null;
  /** Toggle mode's silence limit; null = only the key ends it. */
  autoEndAfterMs: number | null;
  /** Whether any text landed this session (drives the "nothing heard" echo). */
  landed: boolean;
}

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
  private dictation: DictationSession | null = null;
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
  }

  private calibrating = false;
  /** Calibration: the dialog needs every utterance decoded and matched
   *  whatever the mode — wake a sleeping session, hold off auto-sleep
   *  while the user works through the word list (long silences between
   *  takes are normal), and ignore the sleep phrase. */
  setCalibrating(on: boolean): void {
    this.calibrating = on;
    const now = this.now();
    if (on && this.mode === 'asleep') this.setMode('command', 'calibrate', now);
    if (!on) this.lastActivityAt = now; // the idle clock starts fresh afterwards
  }

  setProfile(profile: VoiceProfile | null): void {
    this.profile = profile;
  }

  /** Dictation on: suppress commands and start landing speech at pauses.
   *  `autoEndAfterMs` (toggle mode) ends the session from here after that
   *  much silence. Off: land the tail and return to command listening. */
  setDictation(on: boolean, autoEndAfterMs?: number): void {
    const now = this.now();
    if (on) {
      if (this.mode === 'dictation') return;
      // A half-open command segment must not bleed into the dictation.
      this.vad?.reset();
      this.pending = new Float32Array(0);
      this.speechSince = null;
      this.spanFired = false;
      this.dictation = {
        chunks: [],
        samples: 0,
        speechSamples: 0,
        startedAt: now,
        lastSpeechEndAt: null,
        autoEndAfterMs: autoEndAfterMs && autoEndAfterMs > 0 ? autoEndAfterMs : null,
        landed: false,
      };
      this.setMode('dictation', 'hold', now);
      return;
    }
    this.endDictation('release', now);
  }

  private endDictation(trigger: string, now: number): void {
    if (this.mode !== 'dictation' || !this.dictation) return;
    // Close the run of speech still open in the detector so the tail lands.
    if (this.vad) {
      this.vad.flush();
      while (!this.vad.isEmpty()) {
        const seg = this.vad.front();
        this.vad.pop();
        this.accumulateDictation(this.withContext(seg.start, seg.samples), seg.samples.length, now);
      }
    }
    this.landDictation(now, true);
    this.dictation = null;
    this.vad?.reset();
    this.pending = new Float32Array(0);
    this.speechSince = null;
    this.spanFired = false;
    this.lastActivityAt = now;
    this.setMode('command', trigger, now);
  }

  private accumulateDictation(samples: Float32Array, speechSamples: number, now: number): void {
    const d = this.dictation;
    if (!d) return;
    d.chunks.push(samples);
    d.samples += samples.length;
    d.speechSamples += speechSamples;
    d.lastSpeechEndAt = now;
    if (d.samples >= DICTATION_FLUSH_SECONDS * SAMPLE_RATE) this.landDictation(now, false);
  }

  /** Decode what has piled up and emit it as one dictation utterance.
   *  `final` = the session is ending: a session that never landed
   *  anything still emits one empty event so the UI can say so. */
  private landDictation(now: number, final: boolean): void {
    const d = this.dictation;
    if (!d) return;
    const total = d.samples;
    const speech = d.speechSamples;
    const chunks = d.chunks;
    d.chunks = [];
    d.samples = 0;
    d.speechSamples = 0;
    const durationMs = (total / SAMPLE_RATE) * 1000;
    let text = '';
    // A tap shorter than the padding is never speech: no decode.
    if ((speech / SAMPLE_RATE) * 1000 >= PAD_MS) {
      const samples = new Float32Array(total);
      let at = 0;
      for (const c of chunks) {
        samples.set(c, at);
        at += c.length;
      }
      text = this.opts.engine.decode(pad(samples)).trim();
    }
    if (!text) {
      if (final && !d.landed) {
        const id = ++this.utteranceId;
        this.opts.onEvent({ utteranceId: id, mode: this.mode, raw: '', tEndOfSpeech: now, tParse: now, kind: 'dictation', text: '', durationMs });
      }
      return;
    }
    d.landed = true;
    const id = ++this.utteranceId;
    this.opts.onEvent({ utteranceId: id, mode: this.mode, raw: text, tEndOfSpeech: now, tParse: this.now(), kind: 'dictation', text, durationMs });
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
      const withContext = this.withContext(seg.start, seg.samples);
      if (this.mode === 'dictation' && this.dictation) this.accumulateDictation(withContext, seg.samples.length, now);
      else this.handleSegment(withContext, now);
      this.speechSince = null;
      this.spanFired = false;
    }
    if (!detected) this.speechSince = null;
    if (this.mode === 'dictation' && this.dictation) {
      const d = this.dictation;
      if (!detected) {
        // A pause after speech: land what came before it.
        if (d.chunks.length && d.lastSpeechEndAt !== null && now - d.lastSpeechEndAt >= DICTATION_PAUSE_MS) {
          this.landDictation(now, false);
        }
        // Toggle mode's silence limit, measured from the last speech (or
        // from the start if none came).
        if (d.autoEndAfterMs !== null && now - (d.lastSpeechEndAt ?? d.startedAt) >= d.autoEndAfterMs) {
          this.endDictation('silence', now);
        }
      } else if (d.samples >= MAX_DICTATION_SECONDS * SAMPLE_RATE) {
        this.landDictation(now, false);
      }
      this.report(now, rms, detected, undefined);
      return;
    }

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
    if (autoSleepMs > 0 && this.mode === 'command' && !this.calibrating) {
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
    const verb = matchCommand(text, this.profile);
    this.opts.onSegment?.(samples, { text, verb, durationMs });
    // Noise the VAD opened on but the recognizer heard nothing in: no
    // event at all (an empty "(not a command)" echo is just churn).
    if (!text) return;
    if (verb) {
      this.opts.onEvent({ ...base, raw: text, tParse, kind: 'command', verb });
      return;
    }
    if (!this.calibrating && matchPhrase(text, SLEEP_PHRASES)) {
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
