import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { logger } from './logger.js';

// Raw shape of Codex CLI's `token_count` event payload (the only event type
// we care about). Codex writes these into rollout JSONL files under
// ~/.codex/sessions/YYYY/MM/DD/ — each write is an append-only log line.
interface CodexTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface CodexRateLimitWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number; // unix seconds
  limit_name?: string | null;
}

interface CodexRateLimits {
  primary?: CodexRateLimitWindow;
  secondary?: CodexRateLimitWindow;
  credits?: {
    has_credits?: boolean;
    unlimited?: boolean;
    balance?: number | null;
  };
  plan_type?: string | null;
}

export interface CodexStats {
  installed: boolean;
  // Cumulative totals for the session from the most recent token_count event.
  tokens: CodexTokenUsage | null;
  // Tokens in the most recent turn only — i.e. the current context-window
  // occupancy. Distinct from `tokens` (whole-session cumulative); using the
  // cumulative total against the context window produces nonsensical
  // percentages (e.g. 2890%).
  lastTokens: CodexTokenUsage | null;
  rateLimits: CodexRateLimits | null;
  modelContextWindow: number | null;
  lastEventAt: string | null; // ISO
  sessionsSeen: number;
  latestFile: string | null;
}

export class CodexService {
  private static instance: CodexService;
  private readonly codexHome: string;
  private cached: CodexStats | null = null;
  private lastFetchedAt = 0;
  private cachedTodayModels: Record<string, { tokens: number; cost: number }> | null = null;
  private todayModelsAt = 0;
  private readonly CACHE_DURATION_MS = 15_000;

  constructor() {
    this.codexHome = path.join(os.homedir(), '.codex');
  }

  static getInstance(): CodexService {
    if (!CodexService.instance) {
      CodexService.instance = new CodexService();
    }
    return CodexService.instance;
  }

  isInstalled(): boolean {
    return fs.existsSync(path.join(this.codexHome, 'sessions'));
  }

  /**
   * Today's Codex token usage grouped by model, for the dashboard's
   * "by model" distribution. Walks the session files touched since local
   * midnight; for each `token_count` event today, attributes the turn's
   * NON-cached tokens (`last_token_usage.total - cached_input`) to the model
   * from the most recent `turn_context`. Non-cached is used so the numbers are
   * comparable with the Claude breakdown (which excludes cache-read). Cost is
   * left at 0 — Codex usage is plan-based and the logs carry no dollar amount.
   */
  async getTodayModelUsage(): Promise<Record<string, { tokens: number; cost: number }>> {
    const now = Date.now();
    if (this.cachedTodayModels && now - this.todayModelsAt < this.CACHE_DURATION_MS) {
      return this.cachedTodayModels;
    }
    const result = await this.computeTodayModelUsage();
    this.cachedTodayModels = result;
    this.todayModelsAt = now;
    return result;
  }

  private async computeTodayModelUsage(): Promise<
    Record<string, { tokens: number; cost: number }>
  > {
    const models: Record<string, { tokens: number; cost: number }> = {};
    if (!this.isInstalled()) return models;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startMs = startOfDay.getTime();

    const files = await this.collectRecentJsonl(path.join(this.codexHome, 'sessions'), startMs);

    for (const file of files) {
      let raw: string;
      try {
        raw = await fsp.readFile(file, 'utf8');
      } catch {
        continue;
      }
      let currentModel = 'codex';
      for (const line of raw.split(/\r?\n/)) {
        if (!line) continue;
        let parsed: { type?: string; timestamp?: string; payload?: Record<string, unknown> };
        try {
          parsed = JSON.parse(line);
        } catch {
          continue; // tail/partial line
        }
        const payload = parsed.payload as
          | { model?: string; type?: string; info?: { last_token_usage?: CodexTokenUsage } }
          | undefined;

        if (parsed.type === 'turn_context' && typeof payload?.model === 'string') {
          currentModel = payload.model;
          continue;
        }
        if (
          parsed.type === 'event_msg' &&
          payload?.type === 'token_count' &&
          payload.info?.last_token_usage
        ) {
          const ts =
            typeof parsed.timestamp === 'string' ? Date.parse(parsed.timestamp) : Number.NaN;
          if (!Number.isFinite(ts) || ts < startMs) continue;
          const last = payload.info.last_token_usage;
          const nonCached = Math.max(0, (last.total_tokens ?? 0) - (last.cached_input_tokens ?? 0));
          if (nonCached <= 0) continue;
          if (!models[currentModel]) models[currentModel] = { tokens: 0, cost: 0 };
          models[currentModel].tokens += nonCached;
        }
      }
    }
    return models;
  }

  /** Collect .jsonl files under dir whose mtime is at/after `sinceMs`. */
  private async collectRecentJsonl(dir: string, sinceMs: number): Promise<string[]> {
    const out: string[] = [];
    const walk = async (d: string, depth: number): Promise<void> => {
      if (depth > 5) return;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) {
          await walk(full, depth + 1);
        } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
          try {
            const st = await fsp.stat(full);
            if (st.mtimeMs >= sinceMs) out.push(full);
          } catch {
            /* skip unreadable */
          }
        }
      }
    };
    await walk(dir, 0);
    return out;
  }

  async getStats(): Promise<CodexStats> {
    const now = Date.now();
    if (this.cached && now - this.lastFetchedAt < this.CACHE_DURATION_MS) {
      return this.cached;
    }

    const stats = await this.computeStats();
    this.cached = stats;
    this.lastFetchedAt = now;
    return stats;
  }

  private async computeStats(): Promise<CodexStats> {
    const empty: CodexStats = {
      installed: this.isInstalled(),
      tokens: null,
      lastTokens: null,
      rateLimits: null,
      modelContextWindow: null,
      lastEventAt: null,
      sessionsSeen: 0,
      latestFile: null,
    };

    if (!empty.installed) return empty;

    // Find the most recently modified rollout JSONL under sessions/.
    // Codex writes one file per session; we want the most recent event, so
    // mtime of the file is a cheap proxy for "session currently active".
    const sessionsDir = path.join(this.codexHome, 'sessions');
    const latest = await this.findLatestJsonl(sessionsDir);
    if (!latest) return empty;

    empty.latestFile = latest.path;
    empty.sessionsSeen = latest.totalCount;

    // Read the tail of the file to find the most recent token_count event.
    // These events fire after every assistant turn so the tail is
    // authoritative — no need to walk the whole history.
    const raw = await this.readTail(latest.path, 64 * 1024);
    const lines = raw.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line) continue;
      try {
        const parsed = JSON.parse(line);
        if (
          parsed?.type === 'event_msg' &&
          parsed?.payload?.type === 'token_count' &&
          parsed?.payload?.info
        ) {
          const info = parsed.payload.info;
          empty.tokens = (info.total_token_usage as CodexTokenUsage) ?? null;
          empty.lastTokens = (info.last_token_usage as CodexTokenUsage) ?? null;
          empty.modelContextWindow =
            typeof info.model_context_window === 'number' ? info.model_context_window : null;
          empty.rateLimits = (parsed.payload.rate_limits as CodexRateLimits) ?? null;
          empty.lastEventAt = typeof parsed.timestamp === 'string' ? parsed.timestamp : null;
          break;
        }
      } catch {
        // Skip malformed lines — tail slicing can split a line mid-record.
      }
    }

    return empty;
  }

  /**
   * Walk the sessions directory tree and return the newest .jsonl file by
   * mtime, plus the total number of .jsonl files encountered. Depth-limited
   * so a huge archive doesn't stall startup.
   */
  private async findLatestJsonl(
    dir: string
  ): Promise<{ path: string; mtimeMs: number; totalCount: number } | null> {
    let newest: { path: string; mtimeMs: number } | null = null;
    let totalCount = 0;
    // Async + awaited so the main process event loop stays responsive between
    // every readdir/stat — a large session archive no longer blocks the tray,
    // window, and IPC for the duration of the walk (runs every ~15s).
    const walk = async (d: string, depth: number): Promise<void> => {
      if (depth > 5) return;
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) {
          await walk(full, depth + 1);
        } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
          totalCount++;
          try {
            const st = await fsp.stat(full);
            if (!newest || st.mtimeMs > newest.mtimeMs) {
              newest = { path: full, mtimeMs: st.mtimeMs };
            }
          } catch {
            /* skip unreadable */
          }
        }
      }
    };
    await walk(dir, 0);
    if (!newest) return null;
    const found = newest as { path: string; mtimeMs: number };
    return { path: found.path, mtimeMs: found.mtimeMs, totalCount };
  }

  /**
   * Read the last `bytes` of a file as UTF-8. Faster than loading multi-MB
   * session logs just to inspect the latest token_count event.
   */
  private async readTail(filePath: string, bytes: number): Promise<string> {
    let handle: fsp.FileHandle | null = null;
    try {
      handle = await fsp.open(filePath, 'r');
      const st = await handle.stat();
      const size = st.size;
      const readFrom = Math.max(0, size - bytes);
      const length = size - readFrom;
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, readFrom);
      return buf.toString('utf8');
    } catch (err) {
      logger.error('[codex] tail read failed', err);
      return '';
    } finally {
      if (handle) await handle.close().catch(() => {});
    }
  }
}
