import { homedir } from 'node:os';
import pc from 'picocolors';

const BLINK_ON = '\u001b[5m';
const BLINK_OFF = '\u001b[25m';

/** Format a Date/ISO string as 'yyyy-MM-dd HH:mm' local time. */
export function formatDttm(value: Date | string): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return 'unknown';

  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Format a byte count as a short human string (e.g. '12.4 MB'). */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log10(bytes) / 3), units.length - 1);
  const value = bytes / 10 ** (exponent * 3);
  return `${value.toFixed(value >= 100 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

/**
 * Render a text loading bar, e.g. '[██████----]  62% 11.2/18.0 MB'.
 * When total is unknown (0), shows an indeterminate byte count instead.
 */
export function progressBar(received: number, total: number, width = 20): string {
  if (total <= 0) return `[${'-'.repeat(width)}] ${formatBytes(received)}`;

  const ratio = Math.min(1, received / total);
  const filled = Math.round(ratio * width);
  const bar = `${'█'.repeat(filled)}${'-'.repeat(width - filled)}`;
  const percent = String(Math.round(ratio * 100)).padStart(3);
  return `[${bar}] ${percent}% ${formatBytes(received)}/${formatBytes(total)}`;
}

/**
 * Attention-grabbing badge for addons with an available update.
 * Uses ANSI blink (GPU-accelerated terminals render it as a pulse).
 */
export function updateBadge(text = 'UPDATE AVAILABLE'): string {
  return `${BLINK_ON}${pc.bold(pc.yellow(`* ${text} *`))}${BLINK_OFF}`;
}

/**
 * Shorten a filesystem path for display: collapse the user's home directory
 * to '~', then ellipsize the middle when it still exceeds maxLength.
 */
export function shortenPath(path: string, maxLength: number): string {
  const home = homedir();
  const display = path.startsWith(home) ? `~${path.slice(home.length)}` : path;

  if (display.length <= maxLength) return display;
  if (maxLength <= 4) return display.slice(0, maxLength);

  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${display.slice(0, head)}…${display.slice(display.length - tail)}`;
}

/** Terminal width in columns, with a sane default for non-TTY output. */
export function terminalWidth(): number {
  return process.stdout.columns ?? 80;
}
