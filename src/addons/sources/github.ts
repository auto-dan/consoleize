import type { GitHubSourceSpec } from '../manifest.ts';
import { compareVersions } from '../versions.ts';

/** The latest upstream version of an addon and where to download it. */
export interface LatestRelease {
  /** Version tag as published upstream (e.g. '3.1.44', 'v1.0.4-e'). */
  version: string;
  /** Direct URL to a zip of the addon. */
  downloadUrl: string;
  /** ISO-8601 publish dttm, when known. */
  publishedAt: string | null;
}

/** Minimal fetch signature so tests can inject a mock. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const GITHUB_API = 'https://api.github.com';

const REQUEST_INIT: RequestInit = {
  headers: {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'consoleize',
  },
};

interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  zipball_url?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

interface GitHubTag {
  name: string;
  zipball_url: string;
}

/**
 * Resolve the latest published version of an addon from its GitHub repo.
 * Prefers the releases API (proper packaged zip assets); falls back to the
 * tags API (zipball of the tagged source) for repos without releases.
 * Unauthenticated: fine at our request volume (60 req/hr/IP).
 */
export async function fetchLatestFromGitHub(
  spec: GitHubSourceSpec,
  fetchImpl: FetchLike = fetch,
): Promise<LatestRelease> {
  const repoPath = `${GITHUB_API}/repos/${spec.owner}/${spec.repo}`;

  const releaseResponse = await fetchImpl(`${repoPath}/releases/latest`, REQUEST_INIT);
  if (releaseResponse.ok) {
    const release = (await releaseResponse.json()) as GitHubRelease;
    const zipAsset = release.assets?.find((asset) => asset.name.endsWith('.zip'));
    const downloadUrl = zipAsset?.browser_download_url ?? release.zipball_url;
    const version = release.tag_name ?? release.name;
    if (!version || !downloadUrl) {
      throw new Error(`latest release for ${spec.owner}/${spec.repo} is missing version or zip`);
    }
    return { version, downloadUrl, publishedAt: release.published_at ?? null };
  }

  if (releaseResponse.status !== 404) {
    throw new Error(
      `GitHub releases lookup failed for ${spec.owner}/${spec.repo}: HTTP ${releaseResponse.status}`,
    );
  }

  // No releases published: fall back to tags.
  const tagsResponse = await fetchImpl(`${repoPath}/tags?per_page=100`, REQUEST_INIT);
  if (!tagsResponse.ok) {
    throw new Error(
      `GitHub tags lookup failed for ${spec.owner}/${spec.repo}: HTTP ${tagsResponse.status}`,
    );
  }

  let tags = (await tagsResponse.json()) as GitHubTag[];
  if (spec.excludeTagPattern) {
    const exclude = new RegExp(spec.excludeTagPattern);
    tags = tags.filter((tag) => !exclude.test(tag.name));
  }
  if (spec.includeTagPattern) {
    const include = new RegExp(spec.includeTagPattern);
    tags = tags.filter((tag) => include.test(tag.name));
  }
  if (tags.length === 0) {
    throw new Error(`no usable tags found for ${spec.owner}/${spec.repo}`);
  }

  tags.sort((a, b) => compareVersions(b.name, a.name));
  const latest = tags[0]!;
  return { version: latest.name, downloadUrl: latest.zipball_url, publishedAt: null };
}
