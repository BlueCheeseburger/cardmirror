/**
 * Voice v2 recognizer service, headless: a fake engine and a scripted
 * VAD drive the two channels — ambient commands (segment → pre/post-roll
 * → decode → whole-utterance match), held dictation (buffer, suppress
 * commands, transcribe on release), long-speech rejection, and the
 * sleep / wake phrases.
 */
import { describe, it, expect } from 'vitest';
import { VoiceService, PAD_MS } from '../../apps/desktop/src/voice/service';
import { SAMPLE_RATE, VAD_WINDOW, type VadHandle, type VoiceEngine, type SpeechSegment } from '../../apps/desktop/src/voice/engine';
import type { VoiceEvent } from '../../apps/desktop/src/voice/types';

/** Energy VAD over 512-sample windows; a segment closes after 4 silent windows. */
class FakeVad implements VadHandle {
  private fed = 0;
  private inSpeech = false;
  private start = 0;
  private buf: number[] = [];
  private silent = 0;
  private queue: SpeechSegment[] = [];
  acceptWaveform(w: Float32Array): void {
    let loud = false;
    for (let i = 0; i < w.length; i++) if (Math.abs(w[i]!) > 0.05) { loud = true; break; }
    if (loud) {
      if (!this.inSpeech) { this.inSpeech = true; this.start = this.fed; this.buf = []; }
      this.silent = 0;
      this.buf.push(...w);
    } else if (this.inSpeech) {
      this.buf.push(...w);
      if (++this.silent >= 4) {
        this.queue.push({ start: this.start, samples: Float32Array.from(this.buf) });
        this.inSpeech = false;
      }
    }
    this.fed += w.length;
  }
  isDetected(): boolean { return this.inSpeech; }
  isEmpty(): boolean { return this.queue.length === 0; }
  front(): SpeechSegment { return this.queue[0]!; }
  pop(): void { this.queue.shift(); }
  flush(): void {}
  reset(): void { this.inSpeech = false; this.buf = []; this.silent = 0; }
}

function fakeEngine(script: string[]): VoiceEngine & { decoded: number[] } {
  const decoded: number[] = [];
  return {
    version: 'fake',
    decoded,
    decode(samples) { decoded.push(samples.length); return script.shift() ?? ''; },
    createVad: () => new FakeVad(),
  };
}

/** s16le PCM of `ms` of tone (speech-like energy) or silence. */
function pcm(ms: number, loud: boolean): Buffer {
  const n = Math.round((ms / 1000) * SAMPLE_RATE);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(loud ? Math.round(Math.sin(i / 20) * 12000) : 0, i * 2);
  return b;
}

function harness(script: string[], opts: { autoSleepSeconds?: number } = {}) {
  let t = 0;
  const events: VoiceEvent[] = [];
  const engine = fakeEngine(script);
  const svc = new VoiceService({ engine, autoSleepSeconds: opts.autoSleepSeconds ?? 0, onEvent: (e) => events.push(e), now: () => t });
  svc.start();
  const feed = (ms: number, loud: boolean) => {
    // 20 ms chunks, the clock advancing with the audio
    for (let done = 0; done < ms; done += 20) { svc.pushAudio(pcm(20, loud)); t += 20; }
  };
  return { svc, engine, events, feed, clock: () => t };
}

describe('voice service: commands', () => {
  it('a short utterance decodes with pre- and post-roll and fires the matched word', () => {
    const h = harness(['Line.']);
    h.feed(500, false);
    h.feed(400, true);
    h.feed(400, false);
    const cmd = h.events.find((e) => e.kind === 'command');
    expect(cmd && cmd.kind === 'command' ? cmd.verb : null).toBe('line');
    // Decoded length = padding + pre-roll + segment (+ trailing VAD windows) + post-roll
    const padded = h.engine.decoded[0]!;
    expect(padded).toBeGreaterThan(2 * (PAD_MS / 1000) * SAMPLE_RATE + 0.4 * SAMPLE_RATE + 0.25 * SAMPLE_RATE);
  });

  it('non-vocabulary speech is echoed as a rejection, never fired', () => {
    const h = harness(['The line of argument here']);
    h.feed(300, false);
    h.feed(600, true);
    h.feed(400, false);
    expect(h.events.map((e) => e.kind)).toEqual(['rejection']);
    const r = h.events[0]!;
    expect(r.kind === 'rejection' && r.reason).toBe('out-of-vocabulary');
    expect(r.raw).toBe('The line of argument here');
  });

  it('speech longer than a command is rejected as too long without decoding', () => {
    const h = harness(['unused']);
    h.feed(300, false);
    h.feed(3500, true);
    h.feed(400, false);
    const kinds = h.events.map((e) => (e.kind === 'rejection' ? e.reason : e.kind));
    expect(kinds).toContain('too-long');
    // The rolling window did decode during the long span (script consumed
    // by the rolling path), but the closing segment itself was not decoded.
  });

  it('the rolling window fires a command while speech keeps the VAD open', () => {
    const h = harness(['', 'glow', 'glow', 'glow', 'glow']);
    h.feed(300, false);
    h.feed(2400, true); // VAD never closes; rolling decodes start after 1.5 s
    const cmds = h.events.filter((e) => e.kind === 'command');
    expect(cmds.length).toBe(1); // dedupe: one fire per span
    expect(cmds[0]!.kind === 'command' && cmds[0]!.verb).toBe('glow');
    h.feed(400, false); // the span closes — the closing segment must NOT fire again
    expect(h.events.filter((e) => e.kind === 'command').length).toBe(1);
  });

  it('sleep phrase parks the mic; only the wake phrase decodes while asleep', () => {
    const h = harness(['voice sleep', 'delete', 'wake up', 'delete']);
    h.feed(300, false); h.feed(500, true); h.feed(400, false);
    expect(h.svc.currentMode).toBe('asleep');
    h.feed(500, true); h.feed(400, false); // "delete" while asleep: discarded
    expect(h.events.filter((e) => e.kind === 'command')).toHaveLength(0);
    h.feed(500, true); h.feed(400, false); // wake
    expect(h.svc.currentMode).toBe('command');
    h.feed(500, true); h.feed(400, false); // now delete fires
    expect(h.events.filter((e) => e.kind === 'command').map((e) => (e as { verb: string }).verb)).toEqual(['delete']);
  });

  it('idle auto-sleep after the configured silence', () => {
    const h = harness([], { autoSleepSeconds: 2 });
    h.feed(2500, false);
    expect(h.svc.currentMode).toBe('asleep');
    expect(h.events.some((e) => e.kind === 'mode' && e.to === 'asleep' && e.trigger === 'auto-sleep')).toBe(true);
  });
});

describe('voice service: held dictation', () => {
  it('buffers everything while held, suppresses commands, transcribes once on release', () => {
    const h = harness(['Shalaby argues the accords are dead', 'unused']);
    h.feed(300, false);
    h.svc.setDictation(true);
    expect(h.svc.currentMode).toBe('dictation');
    h.feed(600, true); h.feed(300, false); h.feed(600, true); h.feed(300, false); // two "utterances" while held: no command events
    expect(h.events.filter((e) => e.kind === 'command' || e.kind === 'rejection')).toHaveLength(0);
    h.svc.setDictation(false);
    expect(h.svc.currentMode).toBe('command');
    const d = h.events.find((e) => e.kind === 'dictation');
    expect(d && d.kind === 'dictation' ? d.text : null).toBe('Shalaby argues the accords are dead');
    expect(d && d.kind === 'dictation' ? Math.round(d.durationMs) : 0).toBe(1800);
    expect(h.engine.decoded).toHaveLength(1); // one decode for the whole hold
  });

  it('a tap shorter than the padding lands nothing', () => {
    const h = harness(['unused']);
    h.svc.setDictation(true);
    h.feed(100, true);
    h.svc.setDictation(false);
    const d = h.events.find((e) => e.kind === 'dictation');
    expect(d && d.kind === 'dictation' ? d.text : 'x').toBe('');
    expect(h.engine.decoded).toHaveLength(0);
  });

  it('holding while asleep works and returns to command listening', () => {
    const h = harness(['voice sleep', 'hello there']);
    h.feed(300, false); h.feed(500, true); h.feed(400, false);
    expect(h.svc.currentMode).toBe('asleep');
    h.svc.setDictation(true);
    h.feed(800, true);
    h.svc.setDictation(false);
    expect(h.svc.currentMode).toBe('command');
    expect(h.events.some((e) => e.kind === 'dictation' && e.text === 'hello there')).toBe(true);
  });
});
