/**
 * Typed event contract between the recognizer worker and the renderer
 * voice layer (voice v2). The renderer never sees raw audio — only
 * these events — which keeps the renderer testable with synthetic
 * event streams.
 */
/** Per-user recognizer profile (mirrors `VoiceProfile` in
 *  src/editor/voice/vocabulary.ts — kept separate so this file stays
 *  inside the desktop tsconfig's rootDir). */
export interface VoiceProfile {
  /** Per-user spellings learned by calibration, keyed by verb. */
  aliases?: Record<string, string[]>;
}

export type VoiceMode = 'command' | 'dictation' | 'asleep';

export interface VoiceEventBase {
  /** Monotonic per-session utterance id — also the undo-grouping key. */
  utteranceId: number;
  mode: VoiceMode;
  /** What the recognizer heard, for the pill echo and calibration. */
  raw: string;
  /** ms timestamps (performance.now() epoch of the worker). */
  tEndOfSpeech: number;
  tParse: number;
}

export type VoiceEvent = VoiceEventBase &
  (
    | { kind: 'command'; verb: string }
    /** Speech that was not a command word (the whole-utterance rule). */
    | { kind: 'rejection'; reason: 'out-of-vocabulary' | 'too-long' }
    /** A held-key dictation utterance, transcribed after release. */
    | { kind: 'dictation'; text: string; durationMs: number }
    | { kind: 'mode'; from: VoiceMode; to: VoiceMode; trigger: string }
  );

/** Out-of-band session-terminated notice (worker crash/exit). */
export interface VoiceEndedEvent {
  kind: 'ended';
  reason: string;
}

/** Throttled input report for the pill meter. */
export interface VoiceLevelEvent {
  rms: number;
  /** The neural VAD currently hears speech. */
  speech: boolean;
  /** Present only in the final 10 s before idle auto-sleep. */
  autoSleepRemainingMs?: number;
}

export interface VoiceStartOptions {
  /** Idle seconds before auto-sleep. 0 disables; default 60. */
  autoSleepSeconds?: number;
  profile?: VoiceProfile | null;
}

export interface VoiceStartResult {
  ok: boolean;
  error?: string;
  modelLoadMs?: number;
}

/** Worker ⇄ host protocol. */
export type WorkerInbound =
  | {
      type: 'start';
      modelDir: string;
      vadModelPath: string;
      autoSleepSeconds?: number;
      profile?: VoiceProfile | null;
      threads?: number;
    }
  | { type: 'audio'; chunk: ArrayBuffer }
  | { type: 'dictation'; on: boolean; autoEndAfterMs?: number }
  | { type: 'profile'; profile: VoiceProfile | null }
  | { type: 'calibrating'; on: boolean };

export type WorkerOutbound =
  | { type: 'started'; modelLoadMs: number }
  | { type: 'error'; error: string }
  | { type: 'event'; event: VoiceEvent }
  | { type: 'level'; level: VoiceLevelEvent };
