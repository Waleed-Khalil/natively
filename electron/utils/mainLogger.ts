import { app } from "electron";
import path from "path";
import fs from "fs";

// CQ-04 fix: do NOT call app.getPath() at module load time.
// app.getPath('documents') is not guaranteed to be available before app.whenReady().
// Use a lazy getter instead — the path is resolved on first logToFile() call.
let _logFile: string | null = null;
function getLogFile(): string | null {
  if (_logFile) return _logFile;
  try {
    _logFile = path.join(app.getPath('documents'), 'natively_debug.log');
    return _logFile;
  } catch {
    // app.ready not yet fired — return null, logToFile will skip silently
    return null;
  }
}

/** Maximum log file size before rotation (10 MB). */
const LOG_MAX_BYTES = 10 * 1024 * 1024;

export function logToFile(msg: string): void {
  try {
    const logFile = getLogFile();
    // If the app isn't ready yet (path not available), skip silently.
    if (!logFile) return;

    // P2-1: rotate the log file when it exceeds LOG_MAX_BYTES so that long-running
    // sessions (or meetings with dense transcripts) don't fill the user's disk.
    // The previous log is kept as .log.1 for one-generation rollover.
    try {
      const stat = fs.statSync(logFile);
      if (stat.size >= LOG_MAX_BYTES) {
        const rotated = logFile + '.1';
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        fs.renameSync(logFile, rotated);
      }
    } catch {
      // statSync throws if the file doesn't exist yet — that's fine
    }
    fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n');
  } catch {
    // Ignore logging errors
  }
}

/**
 * Redirect console.log/warn/error to also append to the debug log file.
 * The original console methods are preserved and still called.
 */
export function installConsoleOverrides(): void {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  const fmt = (args: any[]) =>
    args.map(a => (a instanceof Error) ? a.stack || a.message : (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');

  console.log = (...args: any[]) => {
    logToFile('[LOG] ' + fmt(args));
    try { originalLog.apply(console, args); } catch { }
  };

  console.warn = (...args: any[]) => {
    logToFile('[WARN] ' + fmt(args));
    try { originalWarn.apply(console, args); } catch { }
  };

  console.error = (...args: any[]) => {
    logToFile('[ERROR] ' + fmt(args));
    try { originalError.apply(console, args); } catch { }
  };
}

/**
 * Register process-level error handlers that route uncaught exceptions and
 * unhandled rejections to the debug log file. Also silences EIO crashes from
 * stdout/stderr being detached (common with packaged Electron apps).
 */
export function installProcessErrorHandlers(): void {
  // Handle stdout/stderr errors at the process level to prevent EIO crashes
  // This is critical for Electron apps that may have their terminal detached
  process.stdout?.on?.('error', () => { });
  process.stderr?.on?.('error', () => { });

  process.on('uncaughtException', (err) => {
    logToFile('[CRITICAL] Uncaught Exception: ' + (err.stack || err.message || err));
  });

  process.on('unhandledRejection', (reason, promise) => {
    logToFile('[CRITICAL] Unhandled Rejection at: ' + promise + ' reason: ' + (reason instanceof Error ? reason.stack : reason));
  });
}
