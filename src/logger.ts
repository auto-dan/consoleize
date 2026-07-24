import { appendFileSync, mkdirSync } from 'node:fs';
import { logFilePath, stateDir } from './config/paths.ts';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

let debugEnabled = false;
let initialized = false;

/**
 * Initialize the file logger. Debug-level lines are only written when debug
 * mode is on; info/warn/error are always recorded. Logging never throws.
 */
export function initLogger(debug: boolean): void {
  debugEnabled = debug;
  try {
    mkdirSync(stateDir(), { recursive: true });
    initialized = true;
  } catch {
    initialized = false;
  }
}

/** Enable/disable debug logging at runtime (settings toggle). */
export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
}

function write(level: LogLevel, message: string, meta?: unknown): void {
  if (!initialized) return;
  if (level === 'debug' && !debugEnabled) return;

  try {
    const stamp = new Date().toISOString();
    const suffix = meta === undefined ? '' : ` ${safeSerialize(meta)}`;
    appendFileSync(
      logFilePath(),
      `[${stamp}] [${level.toUpperCase()}] ${message}${suffix}\n`,
      'utf8',
    );
  } catch {
    // Logging must never break the app.
  }
}

function safeSerialize(meta: unknown): string {
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

export const logger = {
  debug: (message: string, meta?: unknown) => write('debug', message, meta),
  info: (message: string, meta?: unknown) => write('info', message, meta),
  warn: (message: string, meta?: unknown) => write('warn', message, meta),
  error: (message: string, meta?: unknown) => write('error', message, meta),
};
