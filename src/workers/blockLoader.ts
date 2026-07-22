import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  PricingFetcher,
  calculateCostForEntry,
  createUniqueHash,
  getClaudePaths,
  getUsageLimitResetTime,
  globUsageFiles,
  identifySessionBlocks,
} from 'ccusage/data-loader';

/**
 * Incremental replacement for `loadSessionBlockData`.
 *
 * The upstream loader re-reads and re-parses every JSONL file under
 * `~/.claude/projects` on every call. On a heavy user's machine that is ~3.5 GB
 * across ~420 files, measured at 6-14 s of CPU and disk per call — and the app
 * calls it every 30 s. Steady state, almost nothing has changed: Claude Code
 * only ever *appends* to the session file it is currently writing.
 *
 * So we keep the parsed entries per file in memory, keyed by (mtimeMs, size),
 * and on each refresh only read the bytes that were appended since last time.
 * Blocks are then rebuilt from the cached entries using ccusage's own
 * `identifySessionBlocks`, so bucketing stays identical to upstream.
 *
 * Trade-off: memory. Entries are small (~200 B) and only assistant messages
 * with a usage payload qualify, so a multi-GB corpus lands in the tens of MB —
 * far less than the transient garbage a full re-parse produces.
 */

const FILE_CONCURRENCY = 32;
const READ_CHUNK_BYTES = 4 * 1024 * 1024;
const NEWLINE = 0x0a;

/**
 * Disk cache of the parsed entries, so a restart doesn't pay the full cold
 * parse again (~8 s on a 3.5 GB history). Entries are stored per file with the
 * byte offset they were parsed up to; on load, a file whose size still covers
 * that offset resumes from there and only its appended bytes are read.
 */
const CACHE_VERSION = 2;

/**
 * Age past which entries are folded down to one per (file, block, day, model).
 *
 * Only four consumers read entries at their own timestamp, and the widest
 * window among them is 7 days: hourly burn rate (1h), session-window cost (5h),
 * velocity (24h/7d) and peak-hour bucketing (7d). The 30-day `thisMonth` view
 * does *not* count — it goes through convertBlocksToDailyUsage, whose per-day
 * and per-model totals compaction preserves exactly.
 *
 * 14 days leaves a week of margin for timezone/DST skew and a machine that sat
 * asleep. Sizing this to 30+ days looks safer and is actually useless: a heavy
 * user produces ~45k entries in 45 days, so a 45-day window evicted 7 of them.
 */
const RETENTION_DAYS = 14;
// Resolved lazily: reading os.homedir() at module load breaks anything that
// redirects the home directory afterwards (tests, portable installs).
const cachePath = (): string => path.join(os.homedir(), '.tokenwatch', 'entries-cache.json');
/** Don't rewrite the cache more often than this; it is pure optimisation. */
const CACHE_WRITE_INTERVAL_MS = 5 * 60 * 1000;

interface LoadedEntry {
  timestamp: Date;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
  costUSD: number | null;
  model: string;
  version?: string;
  usageLimitResetTime?: Date;
}

interface FileState {
  mtimeMs: number;
  size: number;
  /** Byte offset of the end of the last *complete* line we consumed. */
  offset: number;
  entries: LoadedEntry[];
  /**
   * Dedup hashes contributed by this file, so a rewrite can retract them.
   * Strictly parallel to `entries` — `null` where the line carried no id to
   * hash. (Pushing only the non-null ones used to shift every later hash by
   * one slot, so a retraction released the wrong hashes.)
   */
  hashes: (string | null)[];
}

export interface IncrementalLoadResult {
  blocks: ReturnType<typeof identifySessionBlocks>;
  filesScanned: number;
  filesChanged: number;
  bytesRead: number;
  entryCount: number;
  /** Per-file read/parse failures from this pass (empty on a healthy run). */
  failures: string[];
}

const fileStates = new Map<string, FileState>();
const seenHashes = new Set<string>();
let fetcher: InstanceType<typeof PricingFetcher> | null = null;
/** Set when an entry was costed without pricing data — see ingestLine. */
let pricingDegraded = false;
let hydrated = false;
let lastCacheWriteAt = 0;

/** Drop all in-memory state. Used when the caller wants a guaranteed clean read. */
export function resetIncrementalCache(): void {
  fileStates.clear();
  seenHashes.clear();
  hydrated = true; // a deliberate cold read must not be refilled from disk
  lastCacheWriteAt = 0; // persist the rebuilt state as soon as it exists
}

/**
 * Allow the next load to refill from the on-disk cache. This is what a fresh
 * worker does implicitly; tests use it to simulate a restart.
 */
export function reloadFromDisk(): void {
  hydrated = false;
}

/**
 * Compact on-disk shape. Entries become positional arrays and models are
 * interned into a table — the same data as JSON objects is roughly 4x larger,
 * and this file is written from a worker thread on a timer.
 */
interface CachedFile {
  p: string;
  m: number;
  s: number;
  o: number;
  /** [timestampMs, in, out, cacheCreate, cacheRead, cost, modelIndex, hash] */
  e: [number, number, number, number, number, number, number, string | null][];
}

function serializeCache(): string {
  const models: string[] = [];
  const modelIndex = new Map<string, number>();
  const files: CachedFile[] = [];

  for (const [file, state] of fileStates) {
    const entries: CachedFile['e'] = [];
    for (let i = 0; i < state.entries.length; i++) {
      const entry = state.entries[i];
      let index = modelIndex.get(entry.model);
      if (index == null) {
        index = models.length;
        models.push(entry.model);
        modelIndex.set(entry.model, index);
      }
      entries.push([
        entry.timestamp.getTime(),
        entry.usage.inputTokens,
        entry.usage.outputTokens,
        entry.usage.cacheCreationInputTokens,
        entry.usage.cacheReadInputTokens,
        entry.costUSD ?? 0,
        index,
        state.hashes[i] ?? null,
      ]);
    }
    files.push({ p: file, m: state.mtimeMs, s: state.size, o: state.offset, e: entries });
  }

  return JSON.stringify({ version: CACHE_VERSION, savedAt: Date.now(), models, files });
}

/** Restore one file's cached entries, if the file still backs them. */
function hydrateFile(cached: CachedFile, models: string[]): void {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(cached.p);
  } catch {
    return; // gone since the cache was written
  }
  if (stats.size < cached.o) return; // truncated — cached entries are stale

  const entries: LoadedEntry[] = [];
  const hashes: (string | null)[] = [];
  for (const [ts, input, output, create, read, cost, model, hash] of cached.e) {
    entries.push({
      timestamp: new Date(ts),
      usage: {
        inputTokens: input,
        outputTokens: output,
        cacheCreationInputTokens: create,
        cacheReadInputTokens: read,
      },
      costUSD: cost,
      model: models[model] ?? 'unknown',
    });
    hashes.push(hash);
    if (hash != null) seenHashes.add(hash);
  }

  // mtime/size are stored as they were at parse time, so an appended file
  // still looks changed and its tail gets read.
  fileStates.set(cached.p, {
    mtimeMs: cached.m,
    size: cached.s,
    offset: cached.o,
    entries,
    hashes,
  });
}

/**
 * Refill the in-memory state from disk. Files are only trusted while their
 * recorded offset still lies inside the current file — anything shorter was
 * rewritten and gets re-read from scratch by the normal path.
 */
function hydrateFromDisk(): void {
  hydrated = true;
  try {
    const file = cachePath();
    if (!fs.existsSync(file)) return;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      version?: number;
      models?: string[];
      files?: CachedFile[];
    };
    if (parsed?.version !== CACHE_VERSION || !Array.isArray(parsed.files)) return;

    for (const cached of parsed.files) hydrateFile(cached, parsed.models ?? []);
  } catch {
    // A corrupt cache is only a lost optimisation — start empty.
    fileStates.clear();
    seenHashes.clear();
  }
}

function persistCacheIfDue(): void {
  const now = Date.now();
  if (now - lastCacheWriteAt < CACHE_WRITE_INTERVAL_MS) return;
  lastCacheWriteAt = now;
  try {
    const file = cachePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tempPath = `${file}.tmp`;
    fs.writeFileSync(tempPath, serializeCache(), 'utf8');
    fs.renameSync(tempPath, file);
  } catch {
    // Never fail a refresh over the cache write.
  }
}

/**
 * Read from `start` to EOF, invoking `onLine` for each complete line.
 * Returns the offset of the last complete line boundary — a trailing partial
 * line (Claude Code mid-write) is left unconsumed and picked up next round.
 */
async function ingestFrom(
  file: string,
  start: number,
  onLine: (line: string) => Promise<void>
): Promise<{ offset: number; bytesRead: number }> {
  const handle = await fs.promises.open(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(READ_CHUNK_BYTES);
    let position = start;
    let rest: Buffer = Buffer.alloc(0);
    let bytesRead = 0;

    for (;;) {
      const { bytesRead: n } = await handle.read(buf, 0, buf.length, position);
      if (n === 0) break;
      position += n;
      bytesRead += n;

      const chunk =
        rest.length > 0
          ? Buffer.concat([rest, buf.subarray(0, n)])
          : Buffer.from(buf.subarray(0, n));

      const lastNewline = chunk.lastIndexOf(NEWLINE);
      if (lastNewline < 0) {
        // No complete line in this chunk yet — carry it forward.
        rest = chunk;
        continue;
      }

      const text = chunk.subarray(0, lastNewline + 1).toString('utf8');
      rest = Buffer.from(chunk.subarray(lastNewline + 1));

      for (const line of text.split('\n')) {
        if (line.length === 0) continue;
        await onLine(line);
      }
    }

    return { offset: position - rest.length, bytesRead };
  } finally {
    await handle.close();
  }
}

function toEntry(data: Record<string, unknown>, costUSD: number): LoadedEntry | null {
  const message = data.message as { usage?: Record<string, number>; model?: string } | undefined;
  const usage = message?.usage;
  if (usage == null) return null;

  const timestamp = new Date(data.timestamp as string);
  if (Number.isNaN(timestamp.getTime())) return null;

  return {
    timestamp,
    usage: {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    },
    costUSD,
    model: message?.model ?? 'unknown',
    version: data.version as string | undefined,
    usageLimitResetTime: getUsageLimitResetTime(data as never) ?? undefined,
  };
}

/** Forget a file's cached entries and release its dedup hashes. */
function retract(state: FileState): void {
  for (const hash of state.hashes) {
    if (hash != null) seenHashes.delete(hash);
  }
  state.entries = [];
  state.hashes = [];
  state.offset = 0;
}

/** Parse one JSONL line into the file's cached entries, honouring global dedup. */
async function ingestLine(state: FileState, line: string): Promise<void> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return; // partial or malformed line — ccusage skips these too
  }
  if (data == null || typeof data !== 'object') return;

  // Most lines in a session transcript are not assistant usage records (user
  // turns, tool results, meta events). Upstream filters them with a valibot
  // schema; we do the same check by hand — and it must happen *before*
  // createUniqueHash, which dereferences data.message.id and throws on
  // anything else.
  const message = data.message as { usage?: Record<string, number> } | undefined;
  if (message?.usage == null || typeof data.timestamp !== 'string') return;

  const hash = createUniqueHash(data as never);
  if (hash != null) {
    if (seenHashes.has(hash)) return;
    seenHashes.add(hash);
  }

  let cost = (data.costUSD as number | undefined) ?? 0;
  if (fetcher != null) {
    try {
      cost = await calculateCostForEntry(data as never, 'calculate', fetcher as never);
    } catch {
      // Pricing lookup failed (offline first run, no disk cache yet). The
      // transcript's own cost is the fallback, but it is usually absent — and a
      // wrong cost cached here would stick forever, since the entry is never
      // re-parsed. Flag it so this pass's cache is discarded and retried.
      pricingDegraded = true;
    }
  }

  const entry = toEntry(data, cost);
  if (entry == null) return;

  state.hashes.push(hash ?? null);
  state.entries.push(entry);
}

/** Local calendar day — the bucket the dashboard and Profile tab file usage under. */
function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Index of the last block starting at or before `ts`. `starts` is ascending. */
function blockIndexFor(starts: number[], ts: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= ts) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Fold entries older than the retention window down to one per
 * (file, session block, local day, model), returning how many were merged away.
 *
 * Without this the cache only ever grows — a heavy user was already at ~45k
 * entries and a 4.8 MB on-disk cache after a few months, with nothing ever
 * leaving.
 *
 * A merged group keeps its *first* entry, so the surviving timestamps are a
 * subset of the originals and `identifySessionBlocks` rebuilds the same blocks:
 * dropping entries from a block's interior cannot open a >5h gap inside it, and
 * the next block's first entry is untouched, so no block merges, splits or
 * disappears. Grouping never crosses a day or a model, so per-day and per-model
 * totals — everything the Profile tab reports over all history — stay exact.
 * Only sub-day ordering within an old block is lost, and nothing reads that.
 */
function compactOldEntries(blockStarts: number[], cutoffMs: number): number {
  let merged = 0;
  for (const state of fileStates.values()) {
    if (state.entries.some((entry) => entry.timestamp.getTime() < cutoffMs)) {
      merged += compactFileEntries(state, blockStarts, cutoffMs);
    }
  }
  return merged;
}

function compactFileEntries(state: FileState, blockStarts: number[], cutoffMs: number): number {
  const heads = new Map<string, LoadedEntry>();
  const entries: LoadedEntry[] = [];
  const hashes: (string | null)[] = [];
  let merged = 0;

  for (let i = 0; i < state.entries.length; i++) {
    const entry = state.entries[i];
    const hash = state.hashes[i] ?? null;
    const ts = entry.timestamp.getTime();
    const key =
      ts < cutoffMs
        ? `${blockIndexFor(blockStarts, ts)}|${localDayKey(entry.timestamp)}|${entry.model}`
        : null;
    const head = key == null ? undefined : heads.get(key);

    if (head == null) {
      if (key != null) heads.set(key, entry);
      entries.push(entry);
      hashes.push(hash);
      continue;
    }

    head.usage.inputTokens += entry.usage.inputTokens;
    head.usage.outputTokens += entry.usage.outputTokens;
    head.usage.cacheCreationInputTokens += entry.usage.cacheCreationInputTokens;
    head.usage.cacheReadInputTokens += entry.usage.cacheReadInputTokens;
    head.costUSD = (head.costUSD ?? 0) + (entry.costUSD ?? 0);

    // The line no longer exists as an entry, so release its dedup hash too: a
    // hash with no entry behind it would silently swallow that line for good if
    // its file were ever rewritten and re-read. The inverse risk — the same
    // line reappearing in a *different* file and being counted twice — needs a
    // cross-file duplicate older than RETENTION_DAYS whose other copy gets
    // rewritten, which is not a case that occurs in practice.
    if (hash != null) seenHashes.delete(hash);
    merged++;
  }

  state.entries = entries;
  state.hashes = hashes;
  return merged;
}

async function refreshFile(file: string, stats: fs.Stats): Promise<number> {
  let state = fileStates.get(file);

  if (state == null) {
    state = { mtimeMs: 0, size: 0, offset: 0, entries: [], hashes: [] };
    fileStates.set(file, state);
  } else if (stats.size < state.offset) {
    // File shrank — it was truncated or rewritten, so cached entries are no
    // longer trustworthy. Start over for this file.
    retract(state);
  } else if (stats.mtimeMs === state.mtimeMs && stats.size === state.size) {
    return 0; // untouched since last poll — the common case
  }

  const target = state;
  const { offset, bytesRead } = await ingestFrom(file, state.offset, (line) =>
    ingestLine(target, line)
  );

  state.offset = offset;
  state.size = stats.size;
  state.mtimeMs = stats.mtimeMs;
  return bytesRead;
}

/** Stat + refresh every file with bounded concurrency, collecting failures. */
async function scanFiles(
  files: string[],
  failures: string[]
): Promise<{ filesChanged: number; bytesRead: number }> {
  let filesChanged = 0;
  let bytesRead = 0;

  for (let i = 0; i < files.length; i += FILE_CONCURRENCY) {
    const results = await Promise.all(
      files.slice(i, i + FILE_CONCURRENCY).map(async (file) => {
        let stats: fs.Stats;
        try {
          stats = await fs.promises.stat(file);
        } catch {
          return 0; // vanished between glob and stat
        }
        try {
          return await refreshFile(file, stats);
        } catch (error) {
          // A single unreadable file must not sink the whole refresh: drop its
          // cached state so the next round retries it from scratch. Report it —
          // silently returning 0 here once hid a total parse failure behind a
          // plausible-looking "nothing changed".
          failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
          fileStates.delete(file);
          return 0;
        }
      })
    );
    for (const read of results) {
      if (read > 0) filesChanged++;
      bytesRead += read;
    }
  }

  return { filesChanged, bytesRead };
}

export async function loadBlocksIncremental(
  sessionDurationHours = 5
): Promise<IncrementalLoadResult> {
  fetcher ??= new PricingFetcher();
  if (!hydrated) hydrateFromDisk();

  const globbed = await globUsageFiles(getClaudePaths());
  const files = [...new Set(globbed.map((entry) => entry.file))];
  const present = new Set(files);

  for (const known of fileStates.keys()) {
    if (!present.has(known)) {
      const state = fileStates.get(known);
      if (state != null) retract(state);
      fileStates.delete(known);
    }
  }

  const failures: string[] = [];
  const { filesChanged, bytesRead } = await scanFiles(files, failures);

  const collectEntries = (): LoadedEntry[] => {
    const all: LoadedEntry[] = [];
    for (const state of fileStates.values()) {
      for (const entry of state.entries) all.push(entry);
    }
    return all;
  };

  let allEntries = collectEntries();
  let blocks = identifySessionBlocks(allEntries, sessionDurationHours);

  // Compaction mutates the entry objects the blocks above were built from, so
  // the blocks have to be rebuilt from what survived.
  const blockStarts = blocks.map((block) => block.startTime.getTime()).sort((a, b) => a - b);
  const merged = compactOldEntries(blockStarts, Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  if (merged > 0) {
    allEntries = collectEntries();
    blocks = identifySessionBlocks(allEntries, sessionDurationHours);
  }

  if (pricingDegraded) {
    // Costs computed during this pass are untrustworthy. Entries are never
    // re-parsed once cached, so throw the cache away and rebuild it on the next
    // poll — by then the pricing table is usually loaded. This degrades to the
    // old full-re-parse behaviour while offline, and self-heals.
    pricingDegraded = false;
    resetIncrementalCache();
    hydrated = false; // the disk copy may predate the pricing outage — retry it
    failures.push('pricing unavailable — entry costs discarded, cache will be rebuilt');
  } else if (filesChanged > 0 || merged > 0) {
    persistCacheIfDue();
  }

  return {
    blocks,
    filesScanned: files.length,
    filesChanged,
    bytesRead,
    entryCount: allEntries.length,
    failures,
  };
}
