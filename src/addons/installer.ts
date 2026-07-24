import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import extract from 'extract-zip';
import { downloadFile, type DownloadProgress } from './download.ts';
import { resolveExternals, type ExternalsResult } from './externals.ts';
import type { ManifestAddon } from './manifest.ts';
import { writeAddonMetadata } from './metadata.ts';
import type { LatestRelease } from './sources/github.ts';
import { readInstalledAddon } from './toc.ts';

export type { DownloadProgress } from './download.ts';

/** Fine-grained install phases for UI feedback. */
export type InstallSubStage = 'extract' | 'install' | 'libraries';

/** Called as the installer moves through phases (detail: folder name or n/total). */
export type InstallSubStageHandler = (stage: InstallSubStage, detail?: string) => void;

/**
 * Recursively (bounded depth) collect directories that contain .toc files.
 * Addon zips come in many shapes: proper 'Name/Name.toc', a single wrapper
 * folder ('Owner-Repo-sha/Name.toc'), or multiple nested addon folders.
 */
async function collectTocDirs(root: string, maxDepth = 3): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await readdir(dir, { withFileTypes: true });
    const hasToc = entries.some(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.toc'),
    );
    if (hasToc) {
      results.push(dir);
      return; // don't descend into an addon folder
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await walk(join(dir, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  return results;
}

/** All addon folders found inside an extracted zip, plus the primary one. */
export interface LocatedAddons {
  /** Every folder that should be copied into AddOns (a package can ship
   *  several sibling addons, e.g. ConsolePort + ConsolePort_Config + ...). */
  dirs: string[];
  /** The folder mapping to the manifest's canonical directory, when found. */
  primary: string | null;
}

/**
 * Locate every addon folder inside an extracted zip. Each folder containing
 * a .toc is an addon (embedded libraries live inside their parent folder
 * and are not collected separately, because collection stops descending at
 * the first toc-bearing directory). The primary folder is identified by an
 * exact name match, then by containing <directory>.toc, then by being the
 * only candidate.
 */
async function locateAddonDirs(extractRoot: string, directory: string): Promise<LocatedAddons> {
  const tocDirs = await collectTocDirs(extractRoot);
  if (tocDirs.length === 0) {
    throw new Error(`no addon .toc found inside extracted zip for ${directory}`);
  }

  const lower = directory.toLowerCase();
  let primary = tocDirs.find((dir) => basename(dir).toLowerCase() === lower) ?? null;

  if (!primary) {
    for (const dir of tocDirs) {
      const entries = await readdir(dir);
      if (entries.some((entry) => entry.toLowerCase() === `${lower}.toc`)) {
        primary = dir;
        break;
      }
    }
  }

  if (!primary && tocDirs.length === 1) primary = tocDirs[0]!;
  return { dirs: tocDirs, primary };
}

/**
 * Substitute packager tokens (e.g. '@project-version@') in installed .toc
 * files. CurseForge's packager does this at upload time; raw GitHub zipballs
 * ship the tokens unsubstituted, which would display oddly in-game and break
 * version comparison.
 */
async function substituteTocTokens(addonDir: string, version: string): Promise<void> {
  const cleanVersion = version.replace(/^[vV]/, '');
  const entries = await readdir(addonDir);
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.toc')) continue;
    const tocPath = join(addonDir, entry);
    const content = await readFile(tocPath, 'utf8');
    if (!content.includes('@project-version@')) continue;
    await writeFile(tocPath, content.replaceAll('@project-version@', cleanVersion), 'utf8');
  }
}

/** Result of installing one addon package. */
export interface InstallResult {
  /** Version read back from the primary addon's .toc, when parseable. */
  version: string | null;
  /** Where the primary addon was installed. */
  installedTo: string;
  /** Folder names of everything installed into AddOns. */
  installedDirs: string[];
  /** .pkgmeta externals resolution per installed folder (embedded libs). */
  externals: ExternalsResult;
}

/**
 * Install every addon folder found in an extracted package into the AddOns
 * directory. The primary folder always lands at the manifest's canonical
 * directory name (repo zipballs wrap sources in an 'owner-repo-sha' folder);
 * sibling companion folders keep their own names. Existing folders with the
 * same names are replaced.
 */
export async function installFromExtracted(
  addon: ManifestAddon,
  extractRoot: string,
  addonsPath: string,
  release: LatestRelease,
  onStage?: InstallSubStageHandler,
): Promise<InstallResult> {
  const { dirs, primary } = await locateAddonDirs(extractRoot, addon.directory);
  await mkdir(addonsPath, { recursive: true });

  const installedDirs: string[] = [];
  const externals: ExternalsResult = { resolved: [], failed: [] };
  for (const dir of dirs) {
    const folderName = dir === primary ? addon.directory : basename(dir);
    const destination = join(addonsPath, folderName);
    onStage?.('install', folderName);
    await rm(destination, { recursive: true, force: true });
    await cp(dir, destination, { recursive: true });
    await substituteTocTokens(destination, release.version);

    // Raw source zips lack packager-embedded libraries; pull them in so the
    // addon loads in game (no-op when no .pkgmeta is present).
    const dirExternals = await resolveExternals(destination, undefined, (current, total) => {
      onStage?.('libraries', `${current}/${total}`);
    });
    externals.resolved.push(...dirExternals.resolved);
    externals.failed.push(...dirExternals.failed);

    installedDirs.push(folderName);
  }

  // Record the upstream tag so future update checks compare exact versions
  // even when the .toc version differs from the release tag.
  if (primary) {
    writeAddonMetadata(join(addonsPath, addon.directory), {
      addonId: addon.id,
      sourceVersion: release.version,
      installedAt: new Date().toISOString(),
    });
  }

  const info = readInstalledAddon(addonsPath, addon.directory);
  return { version: info.version, installedTo: info.path, installedDirs, externals };
}

/**
 * Download and install (or replace) an addon package into the AddOns
 * directory: download zip -> extract to a temp dir -> locate the real addon
 * folder(s) -> swap them into place -> clean up temp files.
 */
export async function installAddon(
  addon: ManifestAddon,
  release: LatestRelease,
  addonsPath: string,
  onProgress?: DownloadProgress,
  onStage?: InstallSubStageHandler,
): Promise<InstallResult> {
  await mkdir(addonsPath, { recursive: true });
  const workDir = await mkdtemp(join(tmpdir(), `consoleize-${addon.id}-`));

  try {
    const zipPath = join(workDir, `${addon.id}.zip`);
    await downloadFile(release.downloadUrl, zipPath, onProgress);

    const zipStat = await stat(zipPath);
    if (zipStat.size === 0) throw new Error('downloaded zip is empty');

    const extractRoot = join(workDir, 'extract');
    await mkdir(extractRoot, { recursive: true });
    onStage?.('extract');
    await extract(zipPath, { dir: extractRoot });

    return await installFromExtracted(addon, extractRoot, addonsPath, release, onStage);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
