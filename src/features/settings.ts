import * as p from '@clack/prompts';
import pc from 'picocolors';
import { clearAddonData, listAddonData } from '../addons/manager.ts';
import { logFilePath } from '../config/paths.ts';
import { resetConfig, saveConfig, type UserConfig } from '../config/store.ts';
import { logger, setDebugLogging } from '../logger.ts';
import { confirm, orBack, pause, select, settle } from '../ui/prompts.ts';
import { clearScreen } from '../ui/screen.ts';
import { playSound, setSoundsEnabled } from '../ui/sounds.ts';
import { createSpinner } from '../ui/spinner.ts';

function onOff(value: boolean): string {
  return value ? pc.green('on') : pc.dim('off');
}

/** Danger-zone flow: wipe everything inside the tracked AddOns folder. */
async function runClearAddonData(config: UserConfig): Promise<void> {
  const entries = await listAddonData(config);

  if (entries.length === 0) {
    p.note(
      `tracked addon folder:\n${pc.cyan(config.wowAddonsPath)}\n\nalready empty - nothing to delete`,
      'clear addon data',
    );
    await pause();
    return;
  }

  // Show exactly what will be destroyed before asking for confirmation, so
  // there is no ambiguity about scope: these entries, and nothing else.
  const preview = [
    `tracked addon folder:`,
    pc.cyan(config.wowAddonsPath),
    '',
    pc.red(`the following ${entries.length} item(s) will be permanently deleted:`),
    ...entries.map((entry) => `  ${pc.dim(entry)}`),
  ].join('\n');
  p.note(preview, 'clear addon data');

  const sure = orBack(
    await confirm({
      message: pc.bold(pc.red('ARE YOU SURE? This cannot be undone.')),
      initialValue: false,
    }),
  );

  if (sure !== true) {
    p.log.info('clear cancelled - nothing was deleted');
    await pause();
    return;
  }

  const spinner = createSpinner();
  spinner.start('clearing addon data...');
  try {
    const { removed } = await clearAddonData(config);
    spinner.stop('clear complete');
    p.note(
      removed.length > 0
        ? [`deleted ${removed.length} item(s):`, '', ...removed.map((entry) => pc.dim(entry))].join(
            '\n',
          )
        : 'nothing to delete - the folder was already empty',
      'clear addon data',
    );
  } catch (error) {
    spinner.stop('clear failed');
    logger.error('clear addon data failed', { error: String(error) });
    p.note(
      pc.red(error instanceof Error ? error.message : String(error)),
      'clear addon data failed',
    );
  }
  await pause();
}

/**
 * Settings submenu: toggle debug mode, sounds, check-for-updates-on-launch,
 * clear addon data (danger), or reset the local account. Esc goes back.
 * Returns 'reset' when the account was reset.
 */
export async function runSettings(config: UserConfig): Promise<'back' | 'reset'> {
  for (;;) {
    clearScreen();
    const action = orBack(
      await select({
        message: 'settings',
        options: [
          {
            value: 'debug' as const,
            label: `debug mode: ${onOff(config.preferences.debug)}`,
            hint: `verbose logging to ${logFilePath()}`,
          },
          {
            value: 'sounds' as const,
            label: `interface sounds: ${onOff(config.preferences.sounds)}`,
            hint: 'soft blips on navigation/selection/prompts',
          },
          {
            value: 'checkOnLaunch' as const,
            label: `check for updates on launch: ${onOff(config.preferences.checkUpdatesOnLaunch)}`,
            hint: 'auto-run update check when the app starts',
          },
          {
            value: 'clearData' as const,
            label: pc.red('clear addon data'),
            hint: 'deletes everything in the tracked addon folder',
          },
          {
            value: 'reset' as const,
            label: pc.red('reset account'),
            hint: 'clears local config; first-time setup runs on next launch',
          },
          { value: 'back' as const, label: 'back  (esc)' },
        ],
      }),
    );

    switch (action) {
      case 'debug': {
        config.preferences.debug = !config.preferences.debug;
        saveConfig(config);
        setDebugLogging(config.preferences.debug);
        logger.info('debug mode toggled', { debug: config.preferences.debug });
        p.log.success(`debug mode ${config.preferences.debug ? 'enabled' : 'disabled'}`);
        if (config.preferences.debug) p.log.info(`logging to ${logFilePath()}`);
        await settle();
        break;
      }
      case 'sounds': {
        config.preferences.sounds = !config.preferences.sounds;
        saveConfig(config);
        setSoundsEnabled(config.preferences.sounds);
        logger.info('sounds toggled', { sounds: config.preferences.sounds });
        p.log.success(`interface sounds ${config.preferences.sounds ? 'enabled' : 'disabled'}`);
        if (config.preferences.sounds) playSound('select');
        await settle();
        break;
      }
      case 'checkOnLaunch': {
        config.preferences.checkUpdatesOnLaunch = !config.preferences.checkUpdatesOnLaunch;
        saveConfig(config);
        logger.info('check on launch toggled', {
          checkUpdatesOnLaunch: config.preferences.checkUpdatesOnLaunch,
        });
        p.log.success(
          `check for updates on launch ${config.preferences.checkUpdatesOnLaunch ? 'enabled' : 'disabled'}`,
        );
        await settle();
        break;
      }
      case 'clearData': {
        await runClearAddonData(config);
        break;
      }
      case 'reset': {
        const sure = orBack(
          await confirm({
            message: 'Reset your local account? This deletes the local config file.',
            initialValue: false,
          }),
        );
        if (sure === true) {
          logger.info('account reset');
          resetConfig();
          return 'reset';
        }
        p.log.info('reset cancelled');
        await pause();
        break;
      }
      case 'back':
      case null: // Esc
        return 'back';
    }
  }
}
