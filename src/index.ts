import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  applyProfiles,
  checkForUpdates,
  getStatuses,
  updateAddons,
  type AddonStatus,
} from './addons/manager.ts';
import { loadConfig, type UserConfig } from './config/store.ts';
import { runSettings } from './features/settings.ts';
import { initLogger, logger } from './logger.ts';
import { runFirstTimeSetup } from './setup.ts';
import { animateBannerOnce, renderBanner, renderWelcome } from './ui/banner.ts';
import { progressBar, updateBadge } from './ui/format.ts';
import { confirm, orBack, orExit, pause, select } from './ui/prompts.ts';
import { clearScreen, enterAltScreen, exitAltScreen, registerScreenCleanup } from './ui/screen.ts';
import { initSounds } from './ui/sounds.ts';
import { createSpinner } from './ui/spinner.ts';
import { renderPathsFooter, renderStatusPanel } from './ui/status.ts';

/** Render the result table after an update check. */
function renderCheckResults(statuses: AddonStatus[]): string {
  return statuses
    .map((status) => {
      const name = pc.bold(status.manifest.name.padEnd(14));
      if (!status.installed) {
        const latest = status.latestVersion ?? 'unknown';
        return `${pc.dim('○')} ${name} not installed ${pc.dim(`(latest: ${latest})`)}`;
      }
      if (status.updateAvailable) {
        return `${pc.yellow('↑')} ${name} ${status.installedVersion ?? '?'} → ${pc.green(status.latestVersion ?? '?')}  ${updateBadge()}`;
      }
      if (status.latestVersion === null) {
        return `${pc.red('×')} ${name} ${status.installedVersion ?? '?'} ${pc.dim('(check failed)')}`;
      }
      return `${pc.green('✓')} ${name} ${status.installedVersion ?? '?'} ${pc.dim('up to date')}`;
    })
    .join('\n');
}

/** Menu action: check for updates (never installs anything). */
async function actionCheckForUpdates(config: UserConfig): Promise<void> {
  const spinner = createSpinner();
  spinner.start('polling approved sources...');
  const statuses = await checkForUpdates(config);
  spinner.stop('update check complete');
  p.note(renderCheckResults(statuses), 'check for updates');
  await pause();
}

/**
 * Install missing + update outdated addons, with a per-addon loading bar
 * while downloading. With nothing to do, reports instead of spinning.
 */
async function runInstaller(
  config: UserConfig,
  options: { forceAll?: boolean } = {},
): Promise<void> {
  const spinner = createSpinner();
  const failures: string[] = [];
  const completed: string[] = [];
  const warnings: string[] = [];

  await updateAddons(config, options, (event) => {
    const name = event.addon.name;
    switch (event.stage) {
      case 'check':
        spinner.message(`resolving latest ${name}...`);
        break;
      case 'download':
        spinner.message(
          `downloading ${name} ${progressBar(event.received ?? 0, event.total ?? 0)}`,
        );
        break;
      case 'extract':
        spinner.message(`extracting ${name}...`);
        break;
      case 'extract-install':
        spinner.message(`installing ${name}...`);
        break;
      case 'libraries':
        spinner.message(`fetching libraries for ${name} (${event.detail ?? '...'})...`);
        break;
      case 'done':
        completed.push(`${name} ${event.version ?? ''}`.trim());
        if (event.externalsFailed && event.externalsFailed.length > 0) {
          warnings.push(`${name}: some libraries failed (${event.externalsFailed.join(', ')})`);
        }
        break;
      case 'error':
        failures.push(`${name}: ${event.error ?? 'unknown error'}`);
        break;
    }
  });

  // Safe even when nothing fired (no targets): stop() is a no-op then.
  spinner.stop('done');

  const lines: string[] = [];
  for (const item of completed) lines.push(`${pc.green('✓')} ${item}`);
  for (const item of warnings) lines.push(`${pc.yellow('!')} ${item}`);
  for (const item of failures) lines.push(`${pc.red('×')} ${item}`);
  if (lines.length === 0) lines.push(pc.dim('everything already up to date'));
  p.note(lines.join('\n'), options.forceAll ? 'consoleize me' : 'update addons');

  if (failures.length > 0) {
    p.log.warn('some addons failed - enable debug mode in settings for detailed logs');
  }
  await pause();
}

/** Menu action: update addons (only missing/outdated). */
async function actionUpdateAddons(config: UserConfig): Promise<void> {
  const pending = getStatuses(config).filter(
    (status) => !status.installed || status.updateAvailable,
  );
  if (pending.length === 0) {
    p.note('everything is already up to date - nothing to do', 'update addons');
    await pause();
    return;
  }
  await runInstaller(config);
}

/** Menu action: consoleize me - latest of all approved addons + profile defaults. */
async function actionConsoleizeMe(config: UserConfig): Promise<void> {
  const sure = orBack(
    await confirm({
      message: 'Consoleize me? Installs/updates all approved addons and applies local defaults.',
      initialValue: true,
    }),
  );
  if (sure !== true) return;

  await runInstaller(config, { forceAll: false });

  clearScreen();
  console.log(renderBanner());

  const spinner = createSpinner();
  spinner.start('applying local profile defaults...');
  const profile = await applyProfiles(config);
  spinner.stop('profile step complete');

  if (profile.applied) {
    p.note(`applied: ${(profile.filesCopied ?? []).join(', ')}`, 'profile defaults');
  } else {
    p.note(profile.reason ?? 'no profile defaults applied', 'profile defaults');
  }

  p.log.success('you are consoleized. launch wow and grab your controller.');
  await pause();
}

/** Say goodbye on the restored terminal screen, then quit. */
function exitApp(message: string): never {
  exitAltScreen();
  p.outro(message);
  process.exit(0);
}

let bannerPlayed = false;

/** Redraw the homepage: banner + welcome + status box + paths footer. */
async function renderHome(config: UserConfig, statuses: AddonStatus[]): Promise<void> {
  clearScreen();
  if (!bannerPlayed) {
    // One quick rainbow sweep on first paint, then static from here on.
    bannerPlayed = true;
    await animateBannerOnce();
  } else {
    console.log(renderBanner());
  }
  console.log('');
  console.log(`  ${renderWelcome(config.username)}`);
  p.note(renderStatusPanel(statuses, config), 'home');
  console.log(renderPathsFooter(statuses, config));
  console.log('');
}

/** Repaint the banner at the top of an action screen. */
function renderActionScreen(): void {
  clearScreen();
  console.log(renderBanner());
  console.log('');
}

async function main(): Promise<void> {
  let config = loadConfig();
  initLogger(config?.preferences.debug ?? false);
  initSounds(config?.preferences.sounds ?? false);
  logger.info('consoleize starting');

  registerScreenCleanup();
  enterAltScreen();

  if (!config) {
    config = await runFirstTimeSetup();
    initSounds(config.preferences.sounds);
  }

  if (config.preferences.checkUpdatesOnLaunch) {
    const spinner = createSpinner();
    spinner.start('checking for updates (launch preference on)...');
    await checkForUpdates(config);
    spinner.stop('update check complete');
  }

  for (;;) {
    const statuses = getStatuses(config);
    const pendingCount = statuses.filter(
      (status) => !status.installed || status.updateAvailable,
    ).length;

    await renderHome(config, statuses);

    const action = orExit(
      await select({
        message: 'what would you like to do?',
        options: [
          { value: 'check' as const, label: 'check for updates', hint: 'poll approved sources' },
          {
            value: 'update' as const,
            label: 'update addons',
            hint: pendingCount > 0 ? `${pendingCount} waiting` : 'pull latest approved sources',
          },
          {
            value: 'consoleize' as const,
            label: 'consoleize me',
            hint: 'latest of everything + opinionated defaults',
          },
          { value: 'settings' as const, label: 'settings' },
          { value: 'exit' as const, label: 'exit  (esc)' },
        ],
      }),
    );

    switch (action) {
      case 'check':
        renderActionScreen();
        await actionCheckForUpdates(config);
        break;
      case 'update':
        renderActionScreen();
        await actionUpdateAddons(config);
        break;
      case 'consoleize':
        renderActionScreen();
        await actionConsoleizeMe(config);
        break;
      case 'settings': {
        clearScreen();
        const result = await runSettings(config);
        if (result === 'reset') {
          exitApp('account reset - see you at first-time setup next launch');
        }
        break;
      }
      case 'exit':
        exitApp(`gl hf, ${config.username}`);
    }
  }
}

main().catch((error: unknown) => {
  logger.error('fatal error', { error: String(error) });
  exitAltScreen();
  p.cancel(`something broke: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
