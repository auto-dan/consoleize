import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const APP_NAME = 'consoleize';

/**
 * Directory where the local user config file lives.
 * Respects XDG_CONFIG_HOME, falls back to ~/.config.
 */
export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, APP_NAME);
}

/**
 * Directory where log files are written.
 * Respects XDG_STATE_HOME, falls back to ~/.local/state.
 */
export function stateDir(): string {
  const xdg = process.env.XDG_STATE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.local', 'state');
  return join(base, APP_NAME);
}

/**
 * Directory used for temporary downloads/extractions.
 * Respects XDG_CACHE_HOME, falls back to ~/.cache.
 */
export function cacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.cache');
  return join(base, APP_NAME);
}

/** Absolute path to the local user config file. */
export function configFilePath(): string {
  return join(configDir(), 'config.json');
}

/** Absolute path to the debug log file. */
export function logFilePath(): string {
  return join(stateDir(), 'consoleize.log');
}

/** A detected World of Warcraft installation. */
export interface WowInstallCandidate {
  /** Root of the WoW install (the folder that contains _retail_ etc.). */
  wowRoot: string;
  /** Absolute path to the Interface/AddOns directory. */
  addonsPath: string;
  /** Whether the AddOns directory already exists on disk. */
  addonsDirExists: boolean;
}

const FLAVOR_DIRS = ['_retail_', '_classic_', '_classic_era_', '_ptr_', '_beta_'];

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
}

/**
 * Given a WoW root directory, locate the Interface/AddOns directory for the
 * first known game flavor that exists on disk.
 */
function candidateFromWowRoot(wowRoot: string): WowInstallCandidate | null {
  for (const flavor of FLAVOR_DIRS) {
    const interfaceDir = join(wowRoot, flavor, 'Interface');
    if (isDirectory(interfaceDir)) {
      const addonsPath = join(interfaceDir, 'AddOns');
      return { wowRoot, addonsPath, addonsDirExists: isDirectory(addonsPath) };
    }
  }
  return null;
}

function* wowRootCandidates(): Generator<string> {
  const home = homedir();
  const steamRoots = [
    join(home, '.local', 'share', 'Steam'),
    join(home, '.steam', 'steam'),
    join(home, '.steam', 'root'),
    join(home, '.var', 'app', 'com.valvesoftware.Steam', '.local', 'share', 'Steam'),
  ];

  for (const steamRoot of steamRoots) {
    const steamapps = join(steamRoot, 'steamapps');
    yield join(steamapps, 'common', 'World of Warcraft');

    // WoW under Proton lives inside a compatdata prefix; scan every app id.
    const compatdata = join(steamapps, 'compatdata');
    for (const entry of safeReadDir(compatdata)) {
      const pfx = join(compatdata, entry, 'pfx', 'drive_c');
      yield join(pfx, 'Program Files (x86)', 'World of Warcraft');
      yield join(pfx, 'Program Files', 'World of Warcraft');
    }
  }

  // Lutris-style installs: ~/Games/<slug>/drive_c/.../World of Warcraft
  const gamesDir = join(home, 'Games');
  for (const entry of safeReadDir(gamesDir)) {
    const driveC = join(gamesDir, entry, 'drive_c');
    yield join(driveC, 'Program Files (x86)', 'World of Warcraft');
    yield join(driveC, 'Program Files', 'World of Warcraft');
  }
}

/**
 * Scan well-known install locations (Steam native, Steam/Proton compatdata,
 * Lutris) for World of Warcraft and return every install that has an
 * Interface directory. Linux-first; Steam Deck paths included.
 */
export function detectWowInstalls(): WowInstallCandidate[] {
  const found: WowInstallCandidate[] = [];
  const seen = new Set<string>();

  for (const root of wowRootCandidates()) {
    if (!isDirectory(root) || seen.has(root)) continue;
    const candidate = candidateFromWowRoot(root);
    if (candidate) {
      seen.add(root);
      found.push(candidate);
    }
  }

  return found;
}

/**
 * Resolve a user-supplied path into an AddOns directory. Accepts any of:
 * the AddOns dir itself, an Interface dir, a flavor dir (_retail_), or the
 * WoW install root. Returns null when no AddOns location can be derived.
 */
export function resolveAddonsPathFromInput(input: string): string | null {
  const path = resolve(input.trim());
  const name = basename(path);

  if (name === 'AddOns') return path;
  if (name === 'Interface') return join(path, 'AddOns');
  if (FLAVOR_DIRS.includes(name)) return join(path, 'Interface', 'AddOns');

  const fromRoot = candidateFromWowRoot(path);
  if (fromRoot) return fromRoot.addonsPath;

  // Fall back to treating it as a WoW root whose Interface dir does not
  // exist yet; still derive the conventional location.
  const conventional = join(path, '_retail_', 'Interface', 'AddOns');
  if (isDirectory(join(path, '_retail_'))) return conventional;

  return null;
}

/**
 * Derive the WoW flavor root (e.g. .../World of Warcraft/_retail_) from an
 * AddOns path: <flavor>/Interface/AddOns -> <flavor>. Returns null when the
 * path does not follow the conventional layout.
 */
export function wowFlavorRootFromAddonsPath(addonsPath: string): string | null {
  const interfaceDir = resolve(addonsPath, '..');
  if (basename(interfaceDir) !== 'Interface') return null;
  return resolve(interfaceDir, '..');
}
