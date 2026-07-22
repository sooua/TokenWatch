import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The loader persists its entry cache to ~/.tokenwatch — redirect the home
// directory so tests never touch the real one.
const state = { tempHomeDir: '' };
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => state.tempHomeDir || actual.homedir() };
});

import { loadBlocksIncremental, reloadFromDisk, resetIncrementalCache } from './blockLoader.js';

/**
 * End-to-end check of the incremental loader against a synthetic ~/.claude
 * tree: the whole point of the module is that a second pass re-reads only the
 * appended bytes, so that is what we assert.
 */

let tempDir: string;
let projectDir: string;
let sessionFile: string;

/** ISO timestamp for a local wall-clock time N days back — compaction buckets by local day. */
function localTs(daysAgo: number, hours: number, minutes = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function entry(
  id: string,
  timestamp: string,
  outputTokens: number,
  model = 'claude-sonnet-4-5-20250929'
): string {
  return `${JSON.stringify({
    timestamp,
    version: '1.0.0',
    requestId: `req_${id}`,
    message: {
      id: `msg_${id}`,
      model,
      usage: {
        input_tokens: 10,
        output_tokens: outputTokens,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  })}\n`;
}

const totalTokens = (blocks: { isGap?: boolean; tokenCounts: Record<string, number> }[]): number =>
  blocks
    .filter((block) => block.isGap !== true)
    .reduce(
      (sum, block) =>
        sum +
        block.tokenCounts.inputTokens +
        block.tokenCounts.outputTokens +
        block.tokenCounts.cacheCreationInputTokens +
        block.tokenCounts.cacheReadInputTokens,
      0
    );

describe('loadBlocksIncremental', () => {
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tokenwatch-blocks-'));
    state.tempHomeDir = tempDir;
    projectDir = path.join(tempDir, 'projects', 'demo');
    fs.mkdirSync(projectDir, { recursive: true });
    sessionFile = path.join(projectDir, 'session.jsonl');
    process.env.CLAUDE_CONFIG_DIR = tempDir;
    // The file cache lives at module scope, so each test starts by clearing it.
    resetIncrementalCache();
  });

  afterEach(() => {
    process.env.CLAUDE_CONFIG_DIR = undefined;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads only appended bytes on the second pass', async () => {
    fs.writeFileSync(sessionFile, entry('a', '2026-07-22T08:00:00.000Z', 100));

    const first = await loadBlocksIncremental(5);
    expect(first.failures).toEqual([]);
    expect(first.entryCount).toBe(1);
    expect(first.bytesRead).toBeGreaterThan(0);
    expect(totalTokens(first.blocks)).toBe(110);

    // Nothing changed: no bytes read at all.
    const unchanged = await loadBlocksIncremental(5);
    expect(unchanged.bytesRead).toBe(0);
    expect(unchanged.filesChanged).toBe(0);
    expect(unchanged.entryCount).toBe(1);

    const appended = entry('b', '2026-07-22T08:30:00.000Z', 200);
    fs.appendFileSync(sessionFile, appended);

    const second = await loadBlocksIncremental(5);
    expect(second.entryCount).toBe(2);
    // Only the appended line was re-read, not the whole file.
    expect(second.bytesRead).toBe(Buffer.byteLength(appended));
    expect(totalTokens(second.blocks)).toBe(320);
  });

  it('ignores a half-written trailing line until it is complete', async () => {
    fs.writeFileSync(sessionFile, entry('a', '2026-07-22T08:00:00.000Z', 100));
    const partial = entry('b', '2026-07-22T08:30:00.000Z', 200).slice(0, 40);
    fs.appendFileSync(sessionFile, partial);

    const first = await loadBlocksIncremental(5);
    expect(first.entryCount).toBe(1);
    expect(totalTokens(first.blocks)).toBe(110);

    // Completing the line makes the entry appear, exactly once.
    fs.appendFileSync(sessionFile, entry('b', '2026-07-22T08:30:00.000Z', 200).slice(40));

    const second = await loadBlocksIncremental(5);
    expect(second.entryCount).toBe(2);
    expect(totalTokens(second.blocks)).toBe(320);
  });

  it('re-reads from scratch when a file is truncated', async () => {
    fs.writeFileSync(
      sessionFile,
      entry('a', '2026-07-22T08:00:00.000Z', 100) + entry('b', '2026-07-22T08:30:00.000Z', 200)
    );
    const first = await loadBlocksIncremental(5);
    expect(first.entryCount).toBe(2);

    // Rewritten shorter — cached entries and their dedup hashes must be
    // retracted, otherwise the surviving entry is swallowed as a duplicate.
    fs.writeFileSync(sessionFile, entry('a', '2026-07-22T08:00:00.000Z', 100));

    const second = await loadBlocksIncremental(5);
    expect(second.entryCount).toBe(1);
    expect(totalTokens(second.blocks)).toBe(110);
  });

  it('resumes from the on-disk cache without re-reading old bytes', async () => {
    const original = entry('a', '2026-07-22T08:00:00.000Z', 100);
    fs.writeFileSync(sessionFile, original);
    await loadBlocksIncremental(5);

    const cacheFile = path.join(tempDir, '.tokenwatch', 'entries-cache.json');
    expect(fs.existsSync(cacheFile)).toBe(true);

    // Simulate a restart: in-memory state gone, disk cache retained. The
    // appended line is the only thing that should be read.
    resetIncrementalCache();
    reloadFromDisk();
    const appended = entry('b', '2026-07-22T08:30:00.000Z', 200);
    fs.appendFileSync(sessionFile, appended);

    const afterRestart = await loadBlocksIncremental(5);
    expect(afterRestart.entryCount).toBe(2);
    expect(afterRestart.bytesRead).toBe(Buffer.byteLength(appended));
    expect(totalTokens(afterRestart.blocks)).toBe(320);
  });

  it('folds entries past the retention window into one per block/day/model', async () => {
    fs.writeFileSync(
      sessionFile,
      entry('o1', localTs(60, 9, 0), 100) +
        entry('o2', localTs(60, 9, 30), 200) +
        entry('o3', localTs(60, 10, 0), 300) +
        // Same old block and day, different model — must stay separate.
        entry('o4', localTs(60, 10, 30), 400, 'claude-opus-4-1') +
        // Inside the retention window — untouched.
        entry('r1', localTs(0, 8, 0), 500)
    );

    const result = await loadBlocksIncremental(5);
    // 3 same-model entries collapse to 1; the other model and the recent entry survive.
    expect(result.entryCount).toBe(3);
    // Totals are preserved exactly — compaction sums, it does not discard.
    expect(totalTokens(result.blocks)).toBe(50 + 100 + 200 + 300 + 400 + 500);
    // The old session is still one session, not zero and not several.
    expect(result.blocks.filter((block) => block.isGap !== true)).toHaveLength(2);
  });

  it('keeps old entries on either side of local midnight in separate buckets', async () => {
    fs.writeFileSync(
      sessionFile,
      entry('a', localTs(60, 23, 30), 100) +
        entry('b', localTs(60, 23, 45), 200) +
        // Same 5-hour block, next calendar day — Profile buckets by day.
        entry('c', localTs(59, 0, 30), 300)
    );

    const result = await loadBlocksIncremental(5);
    expect(result.entryCount).toBe(2);
    expect(totalTokens(result.blocks)).toBe(30 + 100 + 200 + 300);
    expect(result.blocks.filter((block) => block.isGap !== true)).toHaveLength(1);
  });

  it('releases the dedup hashes of folded entries so a rewrite is re-read', async () => {
    const first = entry('a', localTs(60, 9, 0), 100);
    fs.writeFileSync(
      sessionFile,
      first + entry('b', localTs(60, 9, 30), 200) + entry('c', localTs(60, 10, 0), 300)
    );
    expect((await loadBlocksIncremental(5)).entryCount).toBe(1);

    // Rewritten shorter. Had the folded-away hashes stayed in the dedup set,
    // this line would be swallowed as a duplicate and its usage lost for good.
    fs.writeFileSync(sessionFile, first);

    const second = await loadBlocksIncremental(5);
    expect(second.entryCount).toBe(1);
    expect(totalTokens(second.blocks)).toBe(110);
  });

  it('drops entries for files that disappear', async () => {
    fs.writeFileSync(sessionFile, entry('a', '2026-07-22T08:00:00.000Z', 100));
    expect((await loadBlocksIncremental(5)).entryCount).toBe(1);

    fs.rmSync(sessionFile);

    const after = await loadBlocksIncremental(5);
    expect(after.entryCount).toBe(0);
    expect(after.blocks).toEqual([]);
  });
});
