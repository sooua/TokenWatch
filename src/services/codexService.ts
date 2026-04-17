import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

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
  // Last-seen totals from the most recent token_count event we found.
  tokens: CodexTokenUsage | null;
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

  async getStats(): Promise<CodexStats> {
    const now = Date.now();
    if (this.cached && now - this.lastFetchedAt < this.CACHE_DURATION_MS) {
      return this.cached;
    }

    const stats = this.computeStats();
    this.cached = stats;
    this.lastFetchedAt = now;
    return stats;
  }

  private computeStats(): CodexStats {
    const empty: CodexStats = {
      installed: this.isInstalled(),
      tokens: null,
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
    const latest = this.findLatestJsonl(sessionsDir);
    if (!latest) return empty;

    empty.latestFile = latest.path;
    empty.sessionsSeen = latest.totalCount;

    // Read the tail of the file to find the most recent token_count event.
    // These events fire after every assistant turn so the tail is
    // authoritative — no need to walk the whole history.
    const raw = this.readTail(latest.path, 64 * 1024);
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
  private findLatestJsonl(
    dir: string
  ): { path: string; mtimeMs: number; totalCount: number } | null {
    let newest: { path: string; mtimeMs: number } | null = null;
    let totalCount = 0;
    const walk = (d: string, depth: number) => {
      if (depth > 5) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) {
          walk(full, depth + 1);
        } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
          totalCount++;
          try {
            const st = fs.statSync(full);
            if (!newest || st.mtimeMs > newest.mtimeMs) {
              newest = { path: full, mtimeMs: st.mtimeMs };
            }
          } catch {
            /* skip unreadable */
          }
        }
      }
    };
    walk(dir, 0);
    if (!newest) return null;
    const found = newest as { path: string; mtimeMs: number };
    return { path: found.path, mtimeMs: found.mtimeMs, totalCount };
  }

  /**
   * Read the last `bytes` of a file as UTF-8. Faster than loading multi-MB
   * session logs just to inspect the latest token_count event.
   */
  private readTail(filePath: string, bytes: number): string {
    try {
      const fd = fs.openSync(filePath, 'r');
      try {
        const st = fs.fstatSync(fd);
        const size = st.size;
        const readFrom = Math.max(0, size - bytes);
        const length = size - readFrom;
        const buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, readFrom);
        return buf.toString('utf8');
      } finally {
        fs.closeSync(fd);
      }
    } catch (err) {
      console.error('[codex] tail read failed:', err);
      return '';
    }
  }
}
