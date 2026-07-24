import * as p from '@clack/prompts';
import { existsSync, mkdirSync } from 'node:fs';
import { configFilePath, detectWowInstalls, resolveAddonsPathFromInput } from './config/paths.ts';
import { createConfig, saveConfig, type UserConfig } from './config/store.ts';
import { logger } from './logger.ts';
import { renderBanner } from './ui/banner.ts';
import { confirm, orExit, pause, select, text } from './ui/prompts.ts';
import { clearScreen } from './ui/screen.ts';

const MANUAL_ENTRY = '__manual__';

/**
 * First-time setup: create a local account (username + WoW AddOns location)
 * and save it to the local config file. Local only; nothing is uploaded.
 */
export async function runFirstTimeSetup(): Promise<UserConfig> {
  clearScreen();
  console.log(renderBanner());
  console.log('');
  p.note(
    "No local account found - let's get you set up.\n" +
      'Your settings live in a local config file only; nothing is sent anywhere.',
  );

  const username = orExit(
    await text({
      message: 'What should we call you?',
      placeholder: 'illidan',
      validate: (value) => (value.trim().length === 0 ? 'a name is required' : undefined),
    }),
  ).trim();

  const candidates = detectWowInstalls();
  let addonsPath: string | null = null;

  if (candidates.length > 0) {
    const choice = orExit(
      await select({
        message: 'Where are your WoW addons?',
        options: [
          ...candidates.map((candidate) => ({
            value: candidate.addonsPath,
            label: candidate.addonsPath,
            hint: candidate.addonsDirExists ? 'detected' : 'will be created',
          })),
          { value: MANUAL_ENTRY, label: 'Enter a path manually' },
        ],
      }),
    );
    if (choice !== MANUAL_ENTRY) addonsPath = choice;
  }

  while (addonsPath === null) {
    const input = orExit(
      await text({
        message: 'Path to your WoW AddOns folder (or WoW install root):',
        placeholder:
          '~/.local/share/Steam/steamapps/common/World of Warcraft/_retail_/Interface/AddOns',
        validate: (value) => (value.trim().length === 0 ? 'a path is required' : undefined),
      }),
    );

    const resolved = resolveAddonsPathFromInput(input);
    if (resolved === null) {
      p.log.error('No WoW install found at that path - try pointing at the AddOns folder itself.');
      continue;
    }
    addonsPath = resolved;
  }

  if (!existsSync(addonsPath)) {
    const create = orExit(
      await confirm({
        message: `${addonsPath} does not exist yet. Create it?`,
        initialValue: true,
      }),
    );
    if (create) mkdirSync(addonsPath, { recursive: true });
  }

  const config = createConfig(username, addonsPath);
  saveConfig(config);

  logger.info('first time setup complete', { username, addonsPath });
  p.note(
    `Account created for ${username}.\nSaving preferences in ${configFilePath()}`,
    'setup complete',
  );
  await pause();

  return config;
}
