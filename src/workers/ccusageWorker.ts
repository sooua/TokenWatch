import { parentPort } from 'node:worker_threads';
import { loadSessionBlockData } from 'ccusage/data-loader';
import { loadBlocksIncremental, resetIncrementalCache } from './blockLoader.js';

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
  /** Drop the incremental cache and re-read every file from byte 0. */
  cold?: boolean;
}

parentPort.on('message', async (msg: FetchRequest) => {
  if (msg?.type !== 'fetch' || parentPort == null) return;

  const sessionDurationHours = msg.sessionDurationHours ?? 5;

  try {
    if (msg.cold === true) resetIncrementalCache();

    let blocks: unknown;
    let stats: Record<string, number> | undefined;
    let warning: string | undefined;
    try {
      const result = await loadBlocksIncremental(sessionDurationHours);
      blocks = result.blocks;
      stats = {
        filesScanned: result.filesScanned,
        filesChanged: result.filesChanged,
        bytesRead: result.bytesRead,
        entryCount: result.entryCount,
      };
      if (result.failures.length > 0) {
        warning = `${result.failures.length} file(s) failed to parse: ${result.failures[0]}`;
      }
    } catch (incrementalError) {
      // Never let the fast path take the app down: fall back to upstream's
      // full re-parse. The worker has no console in a packaged build, so the
      // reason travels back to the main process to be logged there.
      resetIncrementalCache();
      blocks = await loadSessionBlockData({
        sessionDurationHours,
        mode: msg.mode ?? 'calculate',
      });
      stats = undefined;
      warning = `incremental load failed, used full re-parse: ${
        incrementalError instanceof Error ? incrementalError.message : String(incrementalError)
      }`;
    }

    // structured clone preserves Date objects natively, so blocks travel
    // across the thread boundary without manual serialization.
    parentPort.postMessage({ id: msg.id, ok: true, blocks, stats, warning });
  } catch (error) {
    parentPort.postMessage({
      id: msg.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
