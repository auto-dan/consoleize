import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** What we know about an addon directory on disk. */
export interface InstalledAddonInfo {
  installed: boolean;
  /** Absolute path to the addon directory. */
  path: string;
  /** Version from the addon's .toc file, or null when unknown. */
  version: string | null;
  /** Last modified dttm of the addon directory. */
  modifiedAt: Date | null;
}

/**
 * Parse the `## Version:` metadata field out of a .toc file.
 * Returns null when the file has no Version field.
 */
export function readTocVersion(tocPath: string): string | null {
  const content = readFileSync(tocPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^##\s*Version\s*:\s*(.+?)\s*$/);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Inspect an installed addon directory: does it exist, what version does
 * its .toc declare, and when was it last modified.
 */
export function readInstalledAddon(addonsPath: string, directory: string): InstalledAddonInfo {
  const dirPath = join(addonsPath, directory);
  if (!existsSync(dirPath)) {
    return { installed: false, path: dirPath, version: null, modifiedAt: null };
  }

  const tocFiles = readdirSync(dirPath).filter((file) => file.toLowerCase().endsWith('.toc'));
  const preferred =
    tocFiles.find((file) => file.toLowerCase() === `${directory.toLowerCase()}.toc`) ?? tocFiles[0];

  let version: string | null = null;
  if (preferred) {
    try {
      version = readTocVersion(join(dirPath, preferred));
    } catch {
      version = null;
    }
  }

  return {
    installed: true,
    path: dirPath,
    version,
    modifiedAt: statSync(dirPath).mtime,
  };
}
