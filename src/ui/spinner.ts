import * as p from '@clack/prompts';

/**
 * Crash-safe wrapper around clack's spinner:
 * - stop() before start() is a no-op (clack would throw: its unblock
 *   function is only assigned inside start()).
 * - start() while already active just updates the message (calling clack's
 *   start() twice leaks the first interval, which then re-renders forever -
 *   the "sticky, rapidly flashing" ghost frame).
 * - message() before start() starts the spinner with that message.
 */
export function createSpinner(): {
  start: (message: string) => void;
  message: (message: string) => void;
  stop: (message: string) => void;
} {
  const inner = p.spinner();
  let active = false;

  const spinner = {
    start(message: string): void {
      active = true;
      inner.start(message);
    },
    message(message: string): void {
      if (!active) {
        spinner.start(message);
        return;
      }
      inner.message(message);
    },
    stop(message: string): void {
      if (!active) return;
      active = false;
      inner.stop(message);
    },
  };

  return spinner;
}
