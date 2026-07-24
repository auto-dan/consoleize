import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import extract from 'extract-zip';
import { logger } from '../logger.ts';
import { downloadFile } from './download.ts';
import type { FetchLike } from './sources/github.ts';

/**
 * Resolution of .pkgmeta externals. Raw GitHub source zips lack the
 * libraries CurseForge's packager would embed (Ace3 etc.), so addons fail in
 * game with "Cannot find a library instance of ...". We replicate the
 * packager's externals step:
 *   - repos.wowace.com externals are fetched over plain HTTP (the SVN server
 *     serves the latest revision of any file path via GET, no svn needed)
 *   - github.com externals are fetched as repo zipballs
 */

/** One external dependency: install `url` into the addon at `path`. */
export interface ExternalSpec {
  path: string;
  url: string;
}

const REQUEST_INIT: RequestInit = {
  headers: { Accept: '*/*', 'User-Agent': 'consoleize' },
};

/** Polite pacing between file requests to the same host. */
const REQUEST_DELAY_MS = 30;
/** Attempts per file before giving up (1 initial + retries). */
const MAX_ATTEMPTS = 4;
/** Transient statuses worth retrying (throttling, gateway hiccups). */
const RETRYABLE_STATUSES = new Set([403, 408, 409, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number, retryAfterSeconds: number): number {
  if (retryAfterSeconds > 0 && retryAfterSeconds <= 60) return retryAfterSeconds * 1000;
  return Math.min(250 * 2 ** attempt, 8000);
}

/**
 * Fetch one URL with retries on transient failures (wowace throttles bursts
 * of requests; a failed lib fetch must not doom the whole install).
 * Non-retryable statuses are returned as-is for the caller to handle.
 */
async function fetchWithRetry(url: string, fetchImpl: FetchLike): Promise<Response> {
  let lastError: unknown = new Error(`fetch failed for ${url}`);

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetchImpl(url, REQUEST_INIT);
      if (response.ok || response.status === 404) return response;
      if (!RETRYABLE_STATUSES.has(response.status)) return response;

      const retryAfter = Number(response.headers.get('retry-after') ?? 0);
      lastError = new Error(`HTTP ${response.status} for ${url}`);
      logger.debug('external fetch throttled, retrying', { url, status: response.status, attempt });
      await sleep(backoffMs(attempt, retryAfter));
    } catch (error) {
      lastError = error;
      logger.debug('external fetch error, retrying', { url, attempt, error: String(error) });
      await sleep(backoffMs(attempt, 0));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Parse the `externals:` section of a .pkgmeta file. Only the subset of YAML
 * the packager uses is supported: '<path>:' entries with a nested 'url:'.
 */
export function parsePkgmetaExternals(content: string): ExternalSpec[] {
  const specs: ExternalSpec[] = [];
  let inExternals = false;
  let currentPath: string | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    // Strip comments and trailing whitespace; skip blanks.
    const line = rawLine.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    if (!line.trim()) continue;

    if (/^externals:\s*$/.test(line)) {
      inExternals = true;
      continue;
    }
    if (!inExternals) continue;

    const indent = line.length - line.trimStart().length;
    if (indent === 0) break; // reached the next top-level key

    const pathMatch = line.match(/^\s+(\S.*?):\s*$/);
    if (pathMatch?.[1] && indent <= 4 && !line.includes('url:')) {
      currentPath = pathMatch[1];
      continue;
    }

    const urlMatch = line.match(/^\s+url:\s*(\S+)\s*$/);
    if (urlMatch?.[1] && currentPath) {
      specs.push({ path: currentPath, url: urlMatch[1] });
      currentPath = null;
    }
  }

  return specs;
}

/** Extract relative file references ('file="..."') from a WoW XML include. */
export function parseXmlFileRefs(xml: string): string[] {
  const refs: string[] = [];
  // Strip comments first: upstream xml often contains commented-out
  // includes (e.g. AceConfigDropdown in Ace3) that are not actually loaded.
  const uncommented = xml.replace(/<!--[\s\S]*?-->/g, '');
  for (const match of uncommented.matchAll(/<(?:Script|Include)\s+file="([^"]+)"\s*\/>/g)) {
    if (match[1]) refs.push(match[1]);
  }
  return refs;
}

/**
 * Fetch a repos.wowace.com external over plain HTTP. Fetches <name>.xml
 * (recursively following its file references, e.g. AceGUI's widgets/) and/or
 * <name>.lua, whichever exists.
 */
async function fetchWowAceExternal(
  spec: ExternalSpec,
  destDir: string,
  fetchImpl: FetchLike,
): Promise<number> {
  const name = basename(spec.path);
  const base = spec.url.replace(/\/+$/, '');
  const fetched = new Set<string>();

  async function fetchOne(relativePath: string): Promise<void> {
    const normalized = relativePath.replaceAll('\\', '/');
    if (fetched.has(normalized)) return;
    fetched.add(normalized);

    await sleep(REQUEST_DELAY_MS);
    const response = await fetchWithRetry(`${base}/${normalized}`, fetchImpl);
    if (response.status === 404) return; // optional file, tolerated
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${normalized}`);

    const content = await response.text();
    const target = join(destDir, normalized);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');

    if (normalized.endsWith('.xml')) {
      for (const ref of parseXmlFileRefs(content)) {
        await fetchOne(ref);
      }
    }
  }

  await fetchOne(`${name}.xml`);
  await fetchOne(`${name}.lua`);

  // The two probes above count as attempts; success means at least one real
  // file landed on disk.
  let count = 0;
  try {
    const entries = await readdir(destDir, { recursive: true });
    count = entries.length;
  } catch {
    count = 0;
  }
  if (count === 0) throw new Error(`no files found for ${name} at ${base}`);
  return count;
}

/** A parsed repos.wowace.com SVN url. */
export interface WowAceUrl {
  project: string;
  /** Path inside the project (e.g. 'AceGUI-3.0'); '' for the project root. */
  subpath: string;
}

/** Parse 'https://repos.wowace.com/wow/<project>/trunk(/<subpath>)?'. */
export function parseWowAceUrl(url: string): WowAceUrl | null {
  const match = url.match(/repos\.wowace\.com\/wow\/([^/]+)\/trunk(?:\/(.+?))?\/?$/);
  if (!match?.[1]) return null;
  return { project: match[1], subpath: match[2] ?? '' };
}

/**
 * wowace SVN projects mirrored on GitHub with the full trunk layout at the
 * repo root. Mirrored externals are served from ONE repo zipball instead of
 * dozens of individual file GETs (faster, and immune to wowace throttling).
 */
const WOWACE_MIRRORS: Record<string, { owner: string; repo: string }> = {
  ace3: { owner: 'WoWUIDev', repo: 'Ace3' },
};

/**
 * Download + extract a GitHub repo once per install run and hand out its
 * content root from cache (11 Ace3 externals share a single zipball).
 */
class RepoCache {
  private readonly entries = new Map<string, Promise<string>>();

  constructor(private readonly workDir: string) {}

  async get(owner: string, repo: string): Promise<string> {
    const key = `${owner}/${repo}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = this.fetchRepo(owner, repo);
      this.entries.set(key, entry);
    }
    return entry;
  }

  private async fetchRepo(owner: string, repo: string): Promise<string> {
    const zipPath = join(this.workDir, `${owner}-${repo}.zip`);
    await downloadFile(`https://api.github.com/repos/${owner}/${repo}/zipball/HEAD`, zipPath);

    const extractDir = join(this.workDir, `${owner}-${repo}-extract`);
    await mkdir(extractDir, { recursive: true });
    await extract(zipPath, { dir: extractDir });

    const top = await readdir(extractDir, { withFileTypes: true });
    const root =
      top.length === 1 && top[0]?.isDirectory() ? join(extractDir, top[0].name) : extractDir;
    return root;
  }
}

/** Copy a subdirectory (or the whole root) of an extracted repo into destDir. */
async function copyFromExtractedRepo(
  repoRoot: string,
  subpath: string,
  destDir: string,
): Promise<void> {
  if (subpath) {
    const source = join(repoRoot, subpath);
    if (!existsSync(source)) {
      throw new Error(`path '${subpath}' not found in extracted repo`);
    }
    await cp(source, destDir, { recursive: true });
    return;
  }

  await mkdir(destDir, { recursive: true });
  for (const entry of await readdir(repoRoot)) {
    if (entry.startsWith('.')) continue; // skip .git, .github, etc.
    await cp(join(repoRoot, entry), join(destDir, entry), { recursive: true, force: true });
  }
}

/** Fetch a github.com external as a repo zipball and copy its contents in. */
async function fetchGitHubExternal(
  spec: ExternalSpec,
  destDir: string,
  repoCache: RepoCache,
): Promise<void> {
  const match = spec.url.match(/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?\/?$/);
  if (!match?.[1] || !match[2]) {
    throw new Error(`unsupported GitHub url: ${spec.url}`);
  }
  const repoRoot = await repoCache.get(match[1], match[2]);
  await copyFromExtractedRepo(repoRoot, '', destDir);
}

/** Outcome of resolving one addon's externals. */
export interface ExternalsResult {
  resolved: string[];
  failed: { path: string; error: string }[];
}

/** Progress callback: which external is being fetched (1-based) out of how many. */
export type ExternalsProgress = (current: number, total: number, path: string) => void;

/**
 * Resolve all .pkgmeta externals for an installed addon directory.
 * No-op when the addon ships no .pkgmeta (e.g. pre-packaged zips).
 * Individual failures are logged and reported, never thrown: a missing lib
 * should not fail the whole addon install.
 */
export async function resolveExternals(
  addonDir: string,
  fetchImpl: FetchLike = fetch,
  onProgress?: ExternalsProgress,
): Promise<ExternalsResult> {
  const result: ExternalsResult = { resolved: [], failed: [] };

  const pkgmetaPath = join(addonDir, '.pkgmeta');
  if (!existsSync(pkgmetaPath)) return result;

  const specs = parsePkgmetaExternals(await readFile(pkgmetaPath, 'utf8'));
  if (specs.length === 0) return result;

  logger.info('resolving externals', { addonDir, count: specs.length });
  const workDir = await mkdtemp(join(tmpdir(), 'consoleize-ext-'));
  const repoCache = new RepoCache(workDir);

  try {
    for (const [index, spec] of specs.entries()) {
      onProgress?.(index + 1, specs.length, spec.path);
      const destDir = join(addonDir, spec.path);
      // Fetch into a staging dir and only swap it into place on success, so
      // a failed download never leaves a broken half-installed library.
      const stagingDir = join(
        addonDir,
        `.staging-${basename(spec.path)}-${Math.random().toString(36).slice(2, 8)}`,
      );

      try {
        await fetchExternal(spec, stagingDir, repoCache, fetchImpl);
        await assertNotEmpty(stagingDir, spec);
        // rename(2) requires the destination's parent to exist.
        await mkdir(dirname(destDir), { recursive: true });
        await rm(destDir, { recursive: true, force: true });
        await rename(stagingDir, destDir);
        result.resolved.push(spec.path);
        logger.debug('external resolved', { path: spec.path, url: spec.url });
      } catch (error) {
        await rm(stagingDir, { recursive: true, force: true });
        const message = error instanceof Error ? error.message : String(error);
        logger.error('external fetch failed', { path: spec.path, url: spec.url, error: message });
        result.failed.push({ path: spec.path, error: message });
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }

  return result;
}

/** Fetch one external into its staging dir, using the best available source. */
async function fetchExternal(
  spec: ExternalSpec,
  stagingDir: string,
  repoCache: RepoCache,
  fetchImpl: FetchLike,
): Promise<void> {
  const wowace = parseWowAceUrl(spec.url);
  if (wowace) {
    const mirror = WOWACE_MIRRORS[wowace.project];
    if (mirror) {
      const repoRoot = await repoCache.get(mirror.owner, mirror.repo);
      await copyFromExtractedRepo(repoRoot, wowace.subpath, stagingDir);
      return;
    }
    await fetchWowAceExternal(spec, stagingDir, fetchImpl);
    return;
  }
  if (spec.url.includes('github.com')) {
    await fetchGitHubExternal(spec, stagingDir, repoCache);
    return;
  }
  throw new Error(`unsupported external host: ${spec.url}`);
}

/** Guard against silently-empty fetches (all probes 404'd, bad mirror path). */
async function assertNotEmpty(dir: string, spec: ExternalSpec): Promise<void> {
  let count = 0;
  try {
    count = (await readdir(dir)).length;
  } catch {
    count = 0;
  }
  if (count === 0) {
    throw new Error(`no files found for ${basename(spec.path)} at ${spec.url}`);
  }
}
