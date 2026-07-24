import { describe, expect, test } from 'bun:test';
import type { GitHubSourceSpec } from '../src/addons/manifest.ts';
import { fetchLatestFromGitHub, type FetchLike } from '../src/addons/sources/github.ts';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const CONSOLE_PORT: GitHubSourceSpec = {
  type: 'github',
  owner: 'seblindfors',
  repo: 'ConsolePort',
};

const DYNAMIC_CAM: GitHubSourceSpec = {
  type: 'github',
  owner: 'Mpstark',
  repo: 'DynamicCam',
  excludeTagPattern: '^classic-',
  includeTagPattern: '^\\d',
};

describe('fetchLatestFromGitHub', () => {
  test('prefers the zip asset of the latest release', async () => {
    const fetchImpl: FetchLike = async (url) => {
      expect(url).toBe('https://api.github.com/repos/seblindfors/ConsolePort/releases/latest');
      return jsonResponse({
        tag_name: '3.1.44',
        published_at: '2026-07-21T23:14:09Z',
        zipball_url: 'https://api.github.com/repos/seblindfors/ConsolePort/zipball/3.1.44',
        assets: [
          {
            name: 'ConsolePort-3.1.44.zip',
            browser_download_url:
              'https://github.com/seblindfors/ConsolePort/releases/download/3.1.44/ConsolePort-3.1.44.zip',
          },
          { name: 'release.json', browser_download_url: 'https://example.com/release.json' },
        ],
      });
    };

    const latest = await fetchLatestFromGitHub(CONSOLE_PORT, fetchImpl);
    expect(latest.version).toBe('3.1.44');
    expect(latest.downloadUrl).toBe(
      'https://github.com/seblindfors/ConsolePort/releases/download/3.1.44/ConsolePort-3.1.44.zip',
    );
    expect(latest.publishedAt).toBe('2026-07-21T23:14:09Z');
  });

  test('falls back to zipball when a release has no zip asset', async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResponse({
        tag_name: '1.0.0',
        zipball_url: 'https://api.github.com/repos/x/y/zipball/1.0.0',
        assets: [],
      });

    const latest = await fetchLatestFromGitHub(CONSOLE_PORT, fetchImpl);
    expect(latest.downloadUrl).toBe('https://api.github.com/repos/x/y/zipball/1.0.0');
  });

  test('falls back to tags on 404 and picks the newest non-excluded tag', async () => {
    const requested: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      requested.push(url);
      if (url.endsWith('/releases/latest')) return jsonResponse({}, 404);
      return jsonResponse([
        { name: 'classic-1.4.6', zipball_url: 'https://api.github.com/zipball/classic-1.4.6' },
        { name: 'Beta_4_RC2b', zipball_url: 'https://api.github.com/zipball/Beta_4_RC2b' },
        { name: '2.20.1', zipball_url: 'https://api.github.com/zipball/2.20.1' },
        { name: '2.9.0', zipball_url: 'https://api.github.com/zipball/2.9.0' },
      ]);
    };

    const latest = await fetchLatestFromGitHub(DYNAMIC_CAM, fetchImpl);
    expect(requested[1]).toBe('https://api.github.com/repos/Mpstark/DynamicCam/tags?per_page=100');
    expect(latest.version).toBe('2.20.1');
    expect(latest.downloadUrl).toBe('https://api.github.com/zipball/2.20.1');
  });

  test('throws when the releases endpoint errors', async () => {
    const fetchImpl: FetchLike = async () => jsonResponse({}, 403);
    await expect(fetchLatestFromGitHub(CONSOLE_PORT, fetchImpl)).rejects.toThrow('HTTP 403');
  });

  test('throws when no usable tags exist', async () => {
    const fetchImpl: FetchLike = async (url) =>
      url.endsWith('/releases/latest')
        ? jsonResponse({}, 404)
        : jsonResponse([{ name: 'classic-1.4.6', zipball_url: 'x' }]);

    await expect(fetchLatestFromGitHub(DYNAMIC_CAM, fetchImpl)).rejects.toThrow('no usable tags');
  });
});
