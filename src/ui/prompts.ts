import * as p from '@clack/prompts';
import { exitAltScreen } from './screen.ts';
import { playSound } from './sounds.ts';

/**
 * Delay before opening a prompt. When a prompt closes (especially via
 * Esc-cancel), the terminal's escape-sequence parser may still be inside
 * its ~50ms escapeCodeTimeout window; bytes that arrive in that window get
 * merged with the pending ESC and mis-parsed, which can leak phantom
 * keypresses (toggles/submits) into the NEXT prompt. Settling briefly
 * before opening the next prompt lets the parser finish and flush.
 */
const PROMPT_SETTLE_MS = 75;

/**
 * Wrapped clack prompts with soft interface sounds: a tone when the prompt
 * opens, quiet blips while navigating options, and a confirm tone on
 * submit. Navigation sounds come from passively watching stdin for arrow
 * key escape sequences while the prompt is active.
 */

const NAV_SOUND_MIN_INTERVAL_MS = 50;
// eslint-disable-next-line no-control-regex -- matching raw ESC bytes is the point
const ARROW_SEQUENCE = /\x1b(\[|O)(A|B)/;
const VIM_NAV_KEYS = new Set(['h', 'j', 'k', 'l']);

/**
 * True when an stdin chunk is a navigation keypress: an arrow-key escape
 * sequence, or (when vimKeys is on) a lone hjkl press. Only enable vimKeys
 * for option-list prompts; in text inputs hjkl are real characters.
 */
export function isNavKey(chunk: string, vimKeys: boolean): boolean {
  if (ARROW_SEQUENCE.test(chunk)) return true;
  return vimKeys && chunk.length === 1 && VIM_NAV_KEYS.has(chunk);
}

function attachNavSounds(vimKeys: boolean): () => void {
  if (!process.stdin.isTTY) return () => {};

  let lastPlayedAt = 0;
  const onData = (chunk: Buffer) => {
    if (!isNavKey(chunk.toString('utf8'), vimKeys)) return;
    const now = Date.now();
    if (now - lastPlayedAt < NAV_SOUND_MIN_INTERVAL_MS) return;
    lastPlayedAt = now;
    playSound('nav');
  };

  process.stdin.on('data', onData);
  return () => {
    process.stdin.off('data', onData);
  };
}

async function withSounds<T>(run: () => Promise<T>, vimKeys: boolean): Promise<T> {
  playSound('prompt');
  await settle(PROMPT_SETTLE_MS);
  const detach = attachNavSounds(vimKeys);
  try {
    const value = await run();
    if (!p.isCancel(value)) playSound('select');
    return value;
  } finally {
    detach();
  }
}

/** clack text prompt with interface sounds. */
export async function text(options: p.TextOptions): Promise<string | symbol> {
  return withSounds(() => p.text(options), false);
}

/** clack confirm prompt with interface sounds. */
export async function confirm(options: p.ConfirmOptions): Promise<boolean | symbol> {
  return withSounds(() => p.confirm(options), true);
}

/** clack select prompt with interface sounds. */
export async function select<Value>(options: p.SelectOptions<Value>): Promise<Value | symbol> {
  return withSounds(() => p.select(options), true);
}

/**
 * Unwrap a prompt result, exiting gracefully when the user cancels
 * (Ctrl+C / Esc). Used at the top level and first-run setup, where
 * cancelling means leaving the app.
 */
export function orExit<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    exitAltScreen();
    p.cancel('no problem - bye!');
    process.exit(0);
  }
  return value;
}

/**
 * Unwrap a prompt result, mapping cancel (Esc) to null. Used inside
 * submenus and dialogs, where Esc means "go back" rather than "quit".
 */
export function orBack<T>(value: T | symbol): T | null {
  return p.isCancel(value) ? null : value;
}

/** Brief pause so short-lived feedback stays visible before a redraw. */
export function settle(ms = 800): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for the user to press enter. Used after an action completes so its
 * output stays on screen until acknowledged, before the homepage redraws.
 * Esc is treated the same as enter (back to the menu).
 */
export async function pause(message = 'press enter to continue'): Promise<void> {
  await text({ message, placeholder: '', defaultValue: '' });
}
