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

let service: VoiceService | null = null;
const send = (m: WorkerOutbound): void => {
  process.send?.(m);
};

process.on('message', (m: WorkerInbound) => {
  try {
    if (m.type === 'start') {
      const { engine, loadMs } = loadEngine({ modelDir: m.modelDir, vadModelPath: m.vadModelPath, threads: m.threads });
      service = new VoiceService({
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
    }
  } catch (err) {
    send({ type: 'error', error: String(err) });
  }
});
