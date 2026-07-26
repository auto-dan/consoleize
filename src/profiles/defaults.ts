import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ADDON_MANIFEST } from '../addons/manifest.ts';
import { wowFlavorRootFromAddonsPath } from '../config/paths.ts';
import type { UserConfig } from '../config/store.ts';
import { logger } from '../logger.ts';
import { scrubSavedVariables } from './lua.ts';

/**
 * Placeholder directory name under `profiles/WTF/Account/` that stands in
 * for the player's real account folder. Defaults are committed with this
 * placeholder so no account name ever ships in the repo; `applyProfiles`
 * expands it into every account folder found on the target install.
 */
export const ACCOUNT_PLACEHOLDER = '__ACCOUNT__';

/**
 * Locate the project profiles/ overlay: prefer the current working
 * directory, then next to the app. Null when neither exists.
 */
function resolveProfilesDir(): string | null {
  const candidates = [
    resolve(process.cwd(), 'profiles'),
    resolve(import.meta.dir, '../../profiles'),
  ];
  return candidates.find((dir) => existsSync(dir)) ?? null;
}

/** Names of account folders directly under a WTF/Account directory. */
async function listAccountDirs(wtfAccountDir: string): Promise<string[]> {
  try {
    const entries = await readdir(wtfAccountDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * True when a SavedVariables file belongs to a consoleize-managed addon
 * (manifest directory or one of its modules, e.g. ConsolePort_Cursor.lua).
 * Blizzard's own SavedVariables and unrelated addons are never captured.
 */
function isManagedAddonSettingsFile(name: string): boolean {
  if (!name.endsWith('.lua')) return false;
  return ADDON_MANIFEST.some((manifest) => name.startsWith(manifest.directory));
}

/** Result of capturing local addon settings into the project defaults. */
export interface CaptureDefaultsResult {
  /** Settings files written, by file name. */
  captured: string[];
  /** Personal-data entries scrubbed out, as `file: dotted.key` paths. */
  scrubbedKeys: string[];
  /** Directory the defaults were written to. */
  targetDir: string;
}

/**
 * Maintainer tool (debug mode): copy the local machine's SavedVariables
 * for every managed addon into the project defaults at
 * `profiles/WTF/Account/__ACCOUNT__/SavedVariables/`, scrubbing personal
 * data (character/realm keys, AceDB profileKeys) and never persisting the
 * account folder name. Fully replaces the previous defaults so shipping
 * the result is a clean snapshot of the current local curation.
 *
 * Throws with a user-readable message when preconditions are not met.
 */
export async function captureDefaults(
  config: UserConfig,
  options: { profilesDir?: string } = {},
): Promise<CaptureDefaultsResult> {
  const flavorRoot = wowFlavorRootFromAddonsPath(config.wowAddonsPath);
  if (!flavorRoot) {
    throw new Error(`could not derive WoW root from ${config.wowAddonsPath}`);
  }

  const accountBase = join(flavorRoot, 'WTF', 'Account');
  const accountDirs = await listAccountDirs(accountBase);
  const savedVariablesDirs = accountDirs
    .map((account) => join(accountBase, account, 'SavedVariables'))
    .filter((dir) => existsSync(dir));
  if (savedVariablesDirs.length === 0) {
    throw new Error('no SavedVariables found under WTF/Account - log into WoW once first');
  }

  const profilesDir = options.profilesDir ?? resolveProfilesDir();
  if (!profilesDir || !existsSync(profilesDir)) {
    throw new Error('no profiles/ directory found - run from a source checkout');
  }

  // Replace the previous defaults outright so stale curated files do not linger.
  const targetDir = join(profilesDir, 'WTF', 'Account', ACCOUNT_PLACEHOLDER, 'SavedVariables');
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(targetDir, { recursive: true });

  const captured: string[] = [];
  const scrubbedKeys: string[] = [];
  const seen = new Set<string>();

  for (const sourceDir of savedVariablesDirs) {
    for (const entry of (await readdir(sourceDir)).sort()) {
      if (!isManagedAddonSettingsFile(entry) || seen.has(entry)) continue;
      seen.add(entry);

      const raw = await readFile(join(sourceDir, entry), 'utf8');
      const scrubbed = scrubSavedVariables(raw);

      // Defense in depth: the account folder name must never reach disk,
      // even if it shows up somewhere the key-scrubber did not catch.
      for (const account of accountDirs) {
        if (scrubbed.source.includes(account)) {
          throw new Error(`refusing to write ${entry}: still contains an account name`);
        }
      }

      await writeFile(join(targetDir, entry), scrubbed.source, 'utf8');
      captured.push(entry);
      scrubbedKeys.push(...scrubbed.droppedKeys.map((key) => `${entry}: ${key}`));
    }
  }

  logger.info('captured local defaults', { targetDir, captured, scrubbedKeys });
  return { captured, scrubbedKeys, targetDir };
}

/** Result of applying the local profiles/ overlay. */
export interface ProfileApplyResult {
  applied: boolean;
  reason?: string;
  filesCopied?: string[];
}

/**
 * Profile hook for "consoleize me": copy the profiles/ overlay (cwd, then
 * next to the app) over the WoW flavor root. The `__ACCOUNT__` placeholder
 * inside `WTF/Account/` expands into every real account folder on the
 * install, so shipped SavedVariables defaults land where the game reads
 * them regardless of account name. No-op with an explanation when there
 * is nothing to apply or no account folder exists yet.
 */
export async function applyProfiles(
  config: UserConfig,
  options: { profilesDir?: string } = {},
): Promise<ProfileApplyResult> {
  const profilesDir = options.profilesDir ?? resolveProfilesDir();
  if (!profilesDir || !existsSync(profilesDir)) {
    return { applied: false, reason: 'no profiles/ directory found' };
  }

  const entries = (await readdir(profilesDir)).filter((entry) => !entry.startsWith('.'));
  if (entries.length === 0) {
    return {
      applied: false,
      reason: 'profiles/ is empty - drop config defaults there to apply them',
    };
  }

  const flavorRoot = wowFlavorRootFromAddonsPath(config.wowAddonsPath);
  if (!flavorRoot) {
    return {
      applied: false,
      reason: `could not derive WoW root from ${config.wowAddonsPath}`,
    };
  }

  const copied: string[] = [];
  let placeholderExpanded = false;
  let placeholderMissed = false;

  const copyTree = async (sourceDir: string, destDir: string, rel: string): Promise<void> => {
    for (const entry of await readdir(sourceDir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const sourcePath = join(sourceDir, entry.name);

      if (entry.isDirectory() && entry.name === ACCOUNT_PLACEHOLDER) {
        // destDir is the real WTF/Account here: expand per account folder.
        const accounts = await listAccountDirs(destDir);
        if (accounts.length === 0) {
          placeholderMissed = true;
          continue;
        }
        placeholderExpanded = true;
        for (const account of accounts) {
          await copyTree(sourcePath, join(destDir, account), join(rel, account));
        }
        continue;
      }

      if (entry.isDirectory()) {
        await copyTree(sourcePath, join(destDir, entry.name), join(rel, entry.name));
        continue;
      }

      await mkdir(destDir, { recursive: true });
      await cp(sourcePath, join(destDir, entry.name), { force: true });
      copied.push(join(rel, entry.name));
    }
  };

  await copyTree(profilesDir, flavorRoot, '');

  if (copied.length === 0) {
    if (placeholderMissed && !placeholderExpanded) {
      return {
        applied: false,
        reason: 'no WoW account folder found under WTF/Account - log in once first',
      };
    }
    return { applied: false, reason: 'profiles/ contains no files to apply' };
  }

  logger.info('applied profiles', { from: profilesDir, to: flavorRoot, filesCopied: copied });
  return { applied: true, filesCopied: copied };
}
