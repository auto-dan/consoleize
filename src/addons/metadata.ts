import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sidecar metadata written into each addon folder consoleize installs.
 * The .toc `## Version:` does not always match the upstream release tag
 * (e.g. DialogueUI tags 'v1.0.4-e' but its toc says '1.0.4'), so we record
 * the upstream tag we installed to make future update checks exact.
 * WoW ignores unknown files in addon folders.
 */

export const METADATA_FILENAME = '.consoleize.json';

/** Metadata recorded at install time for one addon. */
export interface AddonMetadata {
  /** Manifest addon id. */
  addonId: string;
  /** Upstream release/tag string the install came from. */
  sourceVersion: string;
  /** ISO-8601 dttm of the install. */
  installedAt: string;
}

/** Persist install metadata inside the installed addon directory. */
export function writeAddonMetadata(addonDir: string, metadata: AddonMetadata): void {
  writeFileSync(
    join(addonDir, METADATA_FILENAME),
    JSON.stringify(metadata, null, 2) + '\n',
    'utf8',
  );
}

/** Read install metadata from an addon directory; null when absent/corrupt. */
export function readAddonMetadata(addonDir: string): AddonMetadata | null {
  const path = join(addonDir, METADATA_FILENAME);
  if (!existsSync(path)) return null;

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<AddonMetadata>;
    if (typeof parsed.sourceVersion !== 'string') return null;
    return {
      addonId: typeof parsed.addonId === 'string' ? parsed.addonId : 'unknown',
      sourceVersion: parsed.sourceVersion,
      installedAt: typeof parsed.installedAt === 'string' ? parsed.installedAt : 'unknown',
    };
  } catch {
    return null;
  }
}
