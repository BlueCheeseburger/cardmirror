/**
 * Recognition engine: sherpa-onnx (Parakeet TDT 0.6B v2 int8 for
 * transcription, Silero VAD for speech boundaries). Loaded in the
 * recognizer worker only. The interface is small so the service can be
 * tested with a fake engine and so the engine can be swapped.
 */

export interface SpeechSegment {
  /** Sample index of the segment start in the audio fed so far. */
  start: number;
  samples: Float32Array;
}

export interface VadHandle {
  /** Feed a 512-sample window at 16 kHz. */
  acceptWaveform(samples: Float32Array): void;
  /** Speech is being heard right now. */
  isDetected(): boolean;
  /** Completed segments waiting to be popped. */
  isEmpty(): boolean;
  front(): SpeechSegment;
  pop(): void;
  /** Flush a segment still open (session end). */
  flush(): void;
  reset(): void;
}

export interface VoiceEngine {
  /** Transcribe 16 kHz mono samples in one shot. */
  decode(samples: Float32Array): string;
  createVad(): VadHandle;
  readonly version: string;
}

export const SAMPLE_RATE = 16000;
/** Silero VAD's fixed window at 16 kHz. */
export const VAD_WINDOW = 512;

export interface EngineOptions {
  modelDir: string;
  vadModelPath: string;
  threads?: number;
}

interface SherpaApi {
  version: string;
  OfflineRecognizer: new (config: unknown) => {
    createStream(): { acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void };
    decode(stream: unknown): void;
    getResult(stream: unknown): { text: string };
  };
  Vad: new (config: unknown, bufferSizeInSeconds: number) => Omit<VadHandle, 'front'> & {
    front(enableExternalBuffer?: boolean): SpeechSegment;
  };
}

/** Load the runtime and the models. Throws on a missing model. */
export function loadEngine(opts: EngineOptions): { engine: VoiceEngine; loadMs: number } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sherpa = require('sherpa-onnx-node') as SherpaApi;
  const path = require('node:path') as typeof import('node:path');
  const t0 = Date.now();
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: path.join(opts.modelDir, 'encoder.int8.onnx'),
        decoder: path.join(opts.modelDir, 'decoder.int8.onnx'),
        joiner: path.join(opts.modelDir, 'joiner.int8.onnx'),
      },
      tokens: path.join(opts.modelDir, 'tokens.txt'),
      numThreads: opts.threads ?? 4,
      provider: 'cpu',
      modelType: 'nemo_transducer',
      debug: 0,
    },
    decodingMethod: 'greedy_search',
  });
  const engine: VoiceEngine = {
    version: sherpa.version,
    decode(samples) {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
      recognizer.decode(stream);
      return recognizer.getResult(stream).text;
    },
    createVad() {
      const vad = new sherpa.Vad(
        {
          sileroVad: {
            model: opts.vadModelPath,
            threshold: 0.35,
            // Commands are single words with no internal pause, so a short
            // trailing silence closes a segment (spec §6.1 early commit).
            minSilenceDuration: 0.2,
            minSpeechDuration: 0.1,
            windowSize: VAD_WINDOW,
            maxSpeechDuration: 10,
          },
          sampleRate: SAMPLE_RATE,
          numThreads: 1,
          debug: 0,
        },
        30,
      );
      // Electron's Node forbids N-API external buffers ("External buffers
      // are not allowed"): ask for a copied segment, never a view.
      return {
        acceptWaveform: (w) => vad.acceptWaveform(w),
        isDetected: () => vad.isDetected(),
        isEmpty: () => vad.isEmpty(),
        front: () => vad.front(false),
        pop: () => vad.pop(),
        flush: () => vad.flush(),
        reset: () => vad.reset(),
      };
    },
  };
  // Warm the graph so the first real utterance doesn't pay allocation cost.
  engine.decode(new Float32Array(SAMPLE_RATE / 2));
  return { engine, loadMs: Date.now() - t0 };
}
