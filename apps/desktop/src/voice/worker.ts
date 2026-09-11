/**
 * Recognizer worker — a PLAIN NODE child process (child_process.fork),
 * not an Electron utilityProcess: decode is synchronous native work and
 * the model is ~1 GB resident, and a stall or crash here can never block
 * or take down the main process. Speaks a tiny message protocol with
 * voice/ipc.ts over the fork IPC channel (advanced serialization, so
 * ArrayBuffer audio chunks structured-clone through).
 *
 * Bundled by esbuild (build:service) because it imports the shared
 * vocabulary from src/editor; `sherpa-onnx-node` stays external and is
 * resolved from the unpacked node_modules at runtime.
 */
import { loadEngine } from './engine';
import { VoiceService } from './service';
import type { WorkerInbound, WorkerOutbound } from './types';

const dumpDir = process.env.CARDMIRROR_VOICE_DUMP ? process.env.CARDMIRROR_VOICE_DUMP.replace(/\/$/, '') : null;
if (dumpDir) { try { require('node:fs').mkdirSync(dumpDir, { recursive: true }); } catch { /* ignore */ } }

let service: VoiceService | null = null;
const send = (m: WorkerOutbound): void => {
  process.send?.(m);
};

process.on('message', (m: WorkerInbound) => {
  try {
    if (m.type === 'start') {
      const { engine, loadMs } = loadEngine({ modelDir: m.modelDir, vadModelPath: m.vadModelPath, threads: m.threads });
      service = new VoiceService({
        // CARDMIRROR_VOICE_DUMP=<dir>: write every decoded command-mode
        // utterance as a 16 kHz wav named with what was heard, so a field
        // recognition problem can be replayed against other engines.
        onSegment: dumpDir
          ? (samples, info) => {
              try {
                const slug = (info.text || 'silence').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40);
                const file = `${dumpDir}/${Date.now()}-${info.verb ?? 'none'}-${slug}.wav`;
                (require('sherpa-onnx-node') as { writeWave(f: string, w: { samples: Float32Array; sampleRate: number }): void }).writeWave(file, { samples, sampleRate: 16000 });
              } catch (err) {
                console.warn('voice dump failed', err);
              }
            }
          : undefined,
        engine,
        autoSleepSeconds: m.autoSleepSeconds,
        profile: m.profile ?? null,
        onEvent: (event) => send({ type: 'event', event }),
        onLevel: (level) => send({ type: 'level', level }),
      });
      service.start();
      send({ type: 'started', modelLoadMs: loadMs });
    } else if (m.type === 'audio') {
      // Validate — a malformed payload must not kill the worker.
      if (m.chunk instanceof ArrayBuffer) service?.pushAudio(Buffer.from(m.chunk));
      else if (ArrayBuffer.isView(m.chunk)) service?.pushAudio(Buffer.from((m.chunk as Uint8Array).buffer));
    } else if (m.type === 'dictation') {
      service?.setDictation(!!m.on, m.autoEndAfterMs);
    } else if (m.type === 'profile') {
      service?.setProfile(m.profile ?? null);
    } else if (m.type === 'calibrating') {
      service?.setCalibrating(!!m.on);
    }
  } catch (err) {
    send({ type: 'error', error: String(err) });
  }
});
