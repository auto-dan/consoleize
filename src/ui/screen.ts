/**
 * Full-screen terminal handling. The app runs in the terminal's alternate
 * screen buffer (like vim/htop), so the user's scrollback is left untouched
 * and each menu render rewrites the screen instead of appending below it.
 * When the app exits, the user's previous terminal content is restored.
 */

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const EXIT_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';

let altScreenActive = false;

function write(sequence: string): void {
  try {
    process.stdout.write(sequence);
  } catch {
    // Terminal control must never break the app.
  }
}

/** Switch to the alternate screen buffer (no-op when not a TTY). */
export function enterAltScreen(): void {
  if (!process.stdout.isTTY || altScreenActive) return;
  write(ENTER_ALT_SCREEN);
  altScreenActive = true;
}

/** Restore the normal screen buffer. Safe to call multiple times. */
export function exitAltScreen(): void {
  if (!altScreenActive) return;
  write(EXIT_ALT_SCREEN);
  altScreenActive = false;
}

/** Clear the current screen and move the cursor home (no-op when not a TTY). */
export function clearScreen(): void {
  if (!process.stdout.isTTY) return;
  write(CLEAR_SCREEN);
}

let handlersRegistered = false;

const SIGNAL_EXIT_CODES: Record<string, number> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

/**
 * Guarantee the user's terminal is restored no matter how the process ends:
 * normal exit, process.exit(), Ctrl+C, or kill.
 */
export function registerScreenCleanup(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  process.on('exit', () => exitAltScreen());
  for (const signal of Object.keys(SIGNAL_EXIT_CODES)) {
    process.on(signal, () => {
      // process.exit triggers the 'exit' handler above, which restores
      // the normal screen buffer.
      process.exit(SIGNAL_EXIT_CODES[signal] ?? 1);
    });
  }
}
