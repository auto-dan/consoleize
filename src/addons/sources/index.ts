import type { ManifestAddon } from '../manifest.ts';
import { fetchLatestFromCurseForge } from './curseforge.ts';
import { fetchLatestFromGitHub, type FetchLike, type LatestRelease } from './github.ts';

export type { FetchLike, LatestRelease } from './github.ts';

/**
 * Resolve the latest available release of an addon from its configured
 * source (GitHub repo or CurseForge package).
 */
export async function fetchLatestRelease(
  manifest: ManifestAddon,
  fetchImpl?: FetchLike,
): Promise<LatestRelease> {
  if (manifest.source.type === 'curseforge') {
    return fetchLatestFromCurseForge(manifest.source, fetchImpl);
  }
  return fetchLatestFromGitHub(manifest.source, fetchImpl);
}
