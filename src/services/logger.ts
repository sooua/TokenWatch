import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

type LogLevel = 'info' | 'warn' | 'error';

/**
 * Minimal file logger for the main process.
 *
 * Why this exists: in a packaged Windows GUI build the main process has no
 * console attached, so every `console.error` is dropped on the floor. When the
 * app misbehaves in the field (duplicate instances, update failures, a crash)
 * there is nothing to inspect. This writes a durable log to
 * `~/.tokenwatch/logs/main.log` so post-mortems have ground truth.
 *
 * Writes are synchronous + best-effort: logging must never throw into a caller
 * (especially the global uncaughtException handler) and must survive an
 * imminent process exit, which rules out async/buffered writes.
 */
class Logger {
  private readonly maxBytes = 1_000_000; // ~1 MB, then rotate once
  private dirEnsured = false;

  // Resolved lazily rather than in the constructor: this module is imported at
  // the top of the graph, and reading os.homedir() that early breaks anything
  // that redirects the home directory afterwards (tests, portable installs).
  private get logDir(): string {
    return path.join(os.homedir(), '.tokenwatch', 'logs');
  }

  private get logPath(): string {
    return path.join(this.logDir, 'main.log');
  }

  private ensureDir(): void {
    if (this.dirEnsured) return;
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
      this.dirEnsured = true;
    } catch {
      // If we can't create the dir, logging is a no-op — never fatal.
    }
  }

  private rotateIfNeeded(): void {
    try {
      const st = fs.statSync(this.logPath);
      if (st.size <= this.maxBytes) return;
      // Single-generation rotation: main.log → main.log.1 (overwritten).
      fs.renameSync(this.logPath, `${this.logPath}.1`);
    } catch {
      // statSync throws if the file doesn't exist yet — that's fine.
    }
  }

  private write(level: LogLevel, message: string, detail?: unknown): void {
    try {
      this.ensureDir();
      if (!this.dirEnsured) return;
      this.rotateIfNeeded();

      let line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
      if (detail !== undefined) {
        line += ` ${this.formatDetail(detail)}`;
      }
      fs.appendFileSync(this.logPath, `${line}\n`, 'utf8');
    } catch {
      // Logging failures are swallowed by design — the logger is a safety net,
      // not a dependency.
    }
  }

  private formatDetail(detail: unknown): string {
    if (detail instanceof Error) {
      return detail.stack || `${detail.name}: ${detail.message}`;
    }
    if (typeof detail === 'string') return detail;
    try {
      return JSON.stringify(detail);
    } catch {
      return String(detail);
    }
  }

  info(message: string, detail?: unknown): void {
    this.write('info', message, detail);
    // Mirror to console for `electron-dev` where the console is live.
    console.log(message, detail ?? '');
  }

  warn(message: string, detail?: unknown): void {
    this.write('warn', message, detail);
    console.warn(message, detail ?? '');
  }

  error(message: string, detail?: unknown): void {
    this.write('error', message, detail);
    try {
      console.error(message, detail ?? '');
    } catch {
      // console can throw on a broken stdout pipe — already logged to file.
    }
  }

  getLogPath(): string {
    return this.logPath;
  }
}

export const logger = new Logger();
