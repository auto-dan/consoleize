import { existsSync } from 'node:fs';
import { cp, readdir, rm } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { wowFlavorRootFromAddonsPath } from '../config/paths.ts';
import { saveConfig, type UserConfig } from '../config/store.ts';
import { logger } from '../logger.ts';
import { installAddon } from './installer.ts';
import { ADDON_MANIFEST, type ManifestAddon } from './manifest.ts';
import { readAddonMetadata } from './metadata.ts';
import { fetchLatestRelease } from './sources/index.ts';
import { readInstalledAddon } from './toc.ts';
import { isNewerVersion } from './versions.ts';

/** Combined local + upstream state for one manifest addon. */
export interface AddonStatus {
  manifest: ManifestAddon;
  installed: boolean;
  installedVersion: string | null;
  /** Last modified dttm of the installed addon directory. */
  modifiedAt: Date | null;
  /** Latest upstream version from the last update check (cached). */
  latestVersion: string | null;
  /** ISO dttm of the last successful update check for this addon. */
  lastCheckedAt: string | null;
  /** True when a newer upstream version is known to exist. */
  updateAvailable: boolean;
  /** Set when the last update check failed for this addon. */
  checkError: boolean;
}

/** Read the current status of every manifest addon (local state + cache). */
export function getStatuses(config: UserConfig): AddonStatus[] {
  return ADDON_MANIFEST.map((manifest) => {
    const local = readInstalledAddon(config.wowAddonsPath, manifest.directory);
    const cache = config.addons[manifest.id];
    const latestVersion = cache?.latestVersion ?? null;

    // Prefer the upstream tag recorded at install time; the .toc version can
    // differ from release tags (e.g. '1.0.4' vs tag 'v1.0.4-e'), which would
    // otherwise produce phantom "update available" states.
    const metadata = local.installed ? readAddonMetadata(local.path) : null;
    const comparisonVersion = metadata?.sourceVersion ?? local.version;

    const updateAvailable =
      local.installed &&
      comparisonVersion !== null &&
      latestVersion !== null &&
      isNewerVersion(latestVersion, comparisonVersion);

    return {
      manifest,
      installed: local.installed,
      installedVersion: local.version,
      modifiedAt: local.modifiedAt,
      latestVersion,
      lastCheckedAt: cache?.lastCheckedAt ?? null,
      updateAvailable,
      checkError: false,
    };
  });
}

/**
 * Poll upstream sources for the latest version of every manifest addon and
 * cache the results in the user config. Never installs anything; failures
 * are logged and reported per-addon instead of throwing.
 */
export async function checkForUpdates(config: UserConfig): Promise<AddonStatus[]> {
  logger.info('checking for updates');

  await Promise.all(
    ADDON_MANIFEST.map(async (manifest) => {
      try {
        const latest = await fetchLatestRelease(manifest);
        config.addons[manifest.id] = {
          latestVersion: latest.version,
          lastCheckedAt: new Date().toISOString(),
        };
        logger.debug('update check ok', { addon: manifest.id, latest: latest.version });
      } catch (error) {
        logger.error('update check failed', { addon: manifest.id, error: String(error) });
        // Preserve any previously cached result but flag the failure.
        config.addons[manifest.id] = {
          latestVersion: config.addons[manifest.id]?.latestVersion ?? null,
          lastCheckedAt: config.addons[manifest.id]?.lastCheckedAt ?? null,
        };
      }
    }),
  );

  saveConfig(config);

  // Mark addons whose check just failed so the UI can say "unknown".
  const failed = new Set(
    ADDON_MANIFEST.filter((m) => config.addons[m.id]?.lastCheckedAt === null).map((m) => m.id),
  );
  return getStatuses(config).map((status) => ({
    ...status,
    checkError: failed.has(status.manifest.id) && status.latestVersion === null,
  }));
}

/** Progress stages while installing/updating one addon. */
export type InstallStage =
  'check' | 'download' | 'extract' | 'extract-install' | 'libraries' | 'done' | 'skipped' | 'error';

export interface InstallEvent {
  addon: ManifestAddon;
  stage: InstallStage;
  /** Bytes received / total during the download stage. */
  received?: number;
  total?: number;
  /** Installed version when stage === 'done'. */
  version?: string | null;
  /** External library paths that failed to resolve (stage === 'done'). */
  externalsFailed?: string[];
  /** Stage detail: folder name or n/total progress. */
  detail?: string;
  /** Error message when stage === 'error'. */
  error?: string;
}

export type InstallEventHandler = (event: InstallEvent) => void;

/**
 * Install or update addons. With `forceAll`, every manifest addon is
 * (re)installed to its latest version; otherwise only missing or outdated
 * addons are touched. Updates the cached latest version on success.
 */
export async function updateAddons(
  config: UserConfig,
  options: { forceAll?: boolean } = {},
  onEvent?: InstallEventHandler,
): Promise<AddonStatus[]> {
  const statuses = getStatuses(config);

  const targets = statuses.filter((status) => {
    if (options.forceAll) return true;
    if (!status.installed) return true;
    return status.updateAvailable;
  });

  logger.info('updating addons', {
    forceAll: options.forceAll ?? false,
    targets: targets.map((t) => t.manifest.id),
  });

  for (const status of targets) {
    const { manifest } = status;
    const emit = (event: Partial<InstallEvent> & { stage: InstallStage }) =>
      onEvent?.({ addon: manifest, ...event });

    try {
      emit({ stage: 'check' });
      const latest = await fetchLatestRelease(manifest);

      emit({ stage: 'download', received: 0, total: 0 });
      const result = await installAddon(
        manifest,
        latest,
        config.wowAddonsPath,
        (received, total) => emit({ stage: 'download', received, total }),
        (subStage, detail) => {
          if (subStage === 'extract') emit({ stage: 'extract' });
          else if (subStage === 'libraries') emit({ stage: 'libraries', detail });
          else emit({ stage: 'extract-install', detail });
        },
      );

      config.addons[manifest.id] = {
        latestVersion: latest.version,
        lastCheckedAt: new Date().toISOString(),
      };
      saveConfig(config);

      logger.info('addon installed', {
        addon: manifest.id,
        upstream: latest.version,
        toc: result.version,
        externalsResolved: result.externals.resolved.length,
        externalsFailed: result.externals.failed,
      });
      emit({
        stage: 'done',
        version: result.version ?? latest.version,
        externalsFailed: result.externals.failed.map((failure) => failure.path),
      });
    } catch (error) {
      logger.error('addon install failed', { addon: manifest.id, error: String(error) });
      emit({ stage: 'error', error: error instanceof Error ? error.message : String(error) });
    }
  }

  return getStatuses(config);
}

/**
 * List everything currently inside the tracked AddOns folder (preview for
 * the clear-addon-data confirmation). Empty when the folder is missing.
 */
export async function listAddonData(config: UserConfig): Promise<string[]> {
  if (!existsSync(config.wowAddonsPath)) return [];
  return readdir(config.wowAddonsPath);
}

/**
 * Clear addon data: delete everything inside the tracked AddOns folder and
 * reset the per-addon update cache.
 *
 * Safety guarantees:
 * - hard-refuses unless the tracked path is literally named 'AddOns', so a
 *   misconfigured path can never wipe the WoW install (or worse) by accident
 * - only ever removes entries INSIDE the folder, never the folder itself
 * - fs.rm does not follow symlinks, so a symlinked entry removes the link,
 *   not its target
 */
export async function clearAddonData(config: UserConfig): Promise<{ removed: string[] }> {
  const addonsPath = config.wowAddonsPath;
  if (basename(addonsPath) !== 'AddOns') {
    throw new Error(`refusing to clear: ${addonsPath} is not an AddOns folder`);
  }
  if (!existsSync(addonsPath)) {
    return { removed: [] };
  }

  const removed = await readdir(addonsPath);
  for (const entry of removed) {
    await rm(join(addonsPath, entry), { recursive: true, force: true });
  }

  // Nothing is installed anymore; drop all cached update-check results.
  config.addons = {};
  saveConfig(config);

  logger.info('addon data cleared', { addonsPath, removed });
  return { removed };
}

/** Result of applying the local profiles/ overlay. */
export interface ProfileApplyResult {
  applied: boolean;
  reason?: string;
  filesCopied?: string[];
}

/**
 * Profile hook for "consoleize me": if a `profiles/` directory exists (cwd,
 * then next to the app), its contents are copied over the WoW flavor root
 * (the folder containing Interface/), so users can drop WTF/SavedVariables
 * defaults in later. MVP: purely opt-in; no-op with an explanation when the
 * directory is missing or empty.
 */
export async function applyProfiles(config: UserConfig): Promise<ProfileApplyResult> {
  const candidates = [
    resolve(process.cwd(), 'profiles'),
    resolve(import.meta.dir, '../../profiles'),
  ];

  const profilesDir = candidates.find((dir) => existsSync(dir));
  if (!profilesDir) {
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
  for (const entry of entries) {
    await cp(join(profilesDir, entry), join(flavorRoot, entry), { recursive: true, force: true });
    copied.push(entry);
  }

  logger.info('applied profiles', { from: profilesDir, to: flavorRoot, entries: copied });
  return { applied: true, filesCopied: copied };
}
