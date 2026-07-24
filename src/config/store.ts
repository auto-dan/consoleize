import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { configFilePath } from './paths.ts';

/** Cached update-check result for a single addon. */
export interface AddonCacheEntry {
  /** Latest version seen upstream, or null when the last check failed. */
  latestVersion: string | null;
  /** ISO-8601 dttm of the last successful check. */
  lastCheckedAt: string | null;
}

/** User-toggleable preferences persisted in the local config file. */
export interface UserPreferences {
  /** Enables verbose debug logging to the log file. */
  debug: boolean;
  /** Run "check for updates" automatically on launch. */
  checkUpdatesOnLaunch: boolean;
  /** Soft interface sounds on navigation/selection/prompts. */
  sounds: boolean;
}

/** The local user account config. Local only; never uploaded anywhere. */
export interface UserConfig {
  username: string;
  /** Absolute path to the WoW Interface/AddOns directory we manage. */
  wowAddonsPath: string;
  preferences: UserPreferences;
  /** Update-check cache keyed by addon id. */
  addons: Record<string, AddonCacheEntry>;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  debug: false,
  checkUpdatesOnLaunch: false,
  sounds: true,
};

/**
 * Load the local user config. Returns null when no config exists yet
 * (i.e. first launch) or when the file is unreadable/corrupt.
 */
export function loadConfig(): UserConfig | null {
  const path = configFilePath();
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<UserConfig>;

    if (typeof parsed.username !== 'string' || typeof parsed.wowAddonsPath !== 'string') {
      return null;
    }

    return {
      username: parsed.username,
      wowAddonsPath: parsed.wowAddonsPath,
      preferences: { ...DEFAULT_PREFERENCES, ...(parsed.preferences ?? {}) },
      addons: parsed.addons ?? {},
    };
  } catch {
    return null;
  }
}

/** Build a fresh config for a first-time user. */
export function createConfig(username: string, wowAddonsPath: string): UserConfig {
  return {
    username,
    wowAddonsPath,
    preferences: { ...DEFAULT_PREFERENCES },
    addons: {},
  };
}

/** Persist the config to disk, creating the config directory if needed. */
export function saveConfig(config: UserConfig): void {
  const path = configFilePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/** Delete the local config file (reset account). No-op when absent. */
export function resetConfig(): void {
  const path = configFilePath();
  if (existsSync(path)) rmSync(path);
}
