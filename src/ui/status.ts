import pc from 'picocolors';
import type { AddonStatus } from '../addons/manager.ts';
import { configFilePath, logFilePath } from '../config/paths.ts';
import type { UserConfig } from '../config/store.ts';
import { formatDttm, shortenPath, terminalWidth, updateBadge } from './format.ts';

/** Width at or above which addon rows fit on a single line. */
const WIDE_ROW_MIN = 88;

function statusRow(status: AddonStatus, width: number): string {
  const name = pc.bold(status.manifest.name.padEnd(14));

  if (!status.installed) {
    return `${pc.dim('○')} ${name} ${pc.dim('not installed')}`;
  }

  const version = status.installedVersion ?? 'unknown';
  const modified = status.modifiedAt ? formatDttm(status.modifiedAt) : 'unknown';
  const badge = status.updateAvailable
    ? `  ${updateBadge(width < WIDE_ROW_MIN ? 'UPDATE' : undefined)} ${pc.dim(`(${status.latestVersion})`)}`
    : '';

  if (width >= WIDE_ROW_MIN) {
    return `${pc.green('●')} ${name} ${version} ${pc.dim(`· modified ${modified}`)}${badge}`;
  }

  // Narrow terminals: two-line row so nothing wraps awkwardly.
  const secondLine = `  ${''.padEnd(14)} ${pc.dim(`modified ${modified}`)}`;
  return `${pc.green('●')} ${name} ${version}${badge}\n${secondLine}`;
}

/**
 * The homepage status box: addon count summary + per-addon state.
 * Layout adapts to the terminal width.
 */
export function renderStatusPanel(
  statuses: AddonStatus[],
  config: UserConfig,
  width = terminalWidth(),
): string {
  const installedCount = statuses.filter((status) => status.installed).length;
  const updateCount = statuses.filter((status) => status.updateAvailable).length;

  const summary =
    updateCount > 0
      ? `${installedCount}/${statuses.length} addons installed · ` +
        pc.bold(pc.yellow(`${updateCount} update${updateCount === 1 ? '' : 's'} available`))
      : `${installedCount}/${statuses.length} addons installed`;

  const lines: string[] = [summary, ''];
  for (const status of statuses) {
    lines.push(statusRow(status, width));
  }
  return lines.join('\n');
}

/**
 * The paths footer, rendered below the status box: where we track addons,
 * where preferences live, debug log location, and last update check. Paths
 * are home-collapsed and ellipsized to fit the terminal width.
 */
export function renderPathsFooter(
  statuses: AddonStatus[],
  config: UserConfig,
  width = terminalWidth(),
): string {
  const lastChecked = statuses
    .map((status) => status.lastCheckedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  const maxPathLength = Math.max(12, width - 26);
  const lines = [
    `  ${pc.dim(`tracking addons in ${shortenPath(config.wowAddonsPath, maxPathLength)}`)}`,
    `  ${pc.dim(`saving preferences in ${shortenPath(configFilePath(), maxPathLength)}`)}`,
  ];

  if (config.preferences.debug) {
    lines.push(`  ${pc.dim(`debug logging to ${shortenPath(logFilePath(), maxPathLength)}`)}`);
  }
  lines.push(
    lastChecked
      ? `  ${pc.dim(`last update check: ${formatDttm(lastChecked)}`)}`
      : `  ${pc.dim('update status unknown - run "check for updates"')}`,
  );

  return lines.join('\n');
}
