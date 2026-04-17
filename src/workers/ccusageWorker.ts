import { parentPort } from 'node:worker_threads';
import { loadSessionBlockData } from 'ccusage/data-loader';

// Swallow benign stdio errors just like the main process does — ccusage's
// logger can throw EPIPE when the parent process is killed.
for (const stream of [process.stdout, process.stderr] as const) {
  stream.on('error', (err: NodeJS.ErrnoException) => {
    if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) return;
  });
}

process.on('uncaughtException', (err: NodeJS.ErrnoException) => {
  if (err && (err.code === 'EPIPE' || err.code === 'ERR_STREAM_DESTROYED')) return;
  try {
    console.error('[ccusageWorker] uncaught:', err);
  } catch {
    /* noop */
  }
});

if (parentPort == null) {
  throw new Error('ccusageWorker must be started as a worker_threads worker');
}

interface FetchRequest {
  type: 'fetch';
  id: number;
  sessionDurationHours?: number;
  mode?: 'calculate' | 'display' | 'auto';
}

parentPort.on('message', async (msg: FetchRequest) => {
  if (msg?.type !== 'fetch' || parentPort == null) return;

  try {
    const blocks = await loadSessionBlockData({
      sessionDurationHours: msg.sessionDurationHours ?? 5,
      mode: msg.mode ?? 'calculate',
    });
    // structured clone preserves Date objects natively, so blocks travel
    // across the thread boundary without manual serialization.
    parentPort.postMessage({ id: msg.id, ok: true, blocks });
  } catch (error) {
    parentPort.postMessage({
      id: msg.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
