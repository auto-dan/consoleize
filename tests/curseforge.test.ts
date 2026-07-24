import { describe, expect, test } from 'bun:test';
import {
  curseForgeDownloadUrl,
  fetchLatestFromCurseForge,
} from '../src/addons/sources/curseforge.ts';
import type { FetchLike } from '../src/addons/sources/github.ts';

const PROJECT = { type: 'curseforge', projectId: 101120 } as const;

function cfFetch(files: unknown[]): FetchLike {
  return async (url: string) => {
    expect(url).toBe('https://api.cfwidget.com/wow/mods/101120');
    return new Response(JSON.stringify({ files }), { status: 200 });
  };
}

describe('fetchLatestFromCurseForge', () => {
  test('picks the newest stable release file', async () => {
    const latest = await fetchLatestFromCurseForge(
      PROJECT,
      cfFetch([
        { id: 2, display: '2.20.1', type: 'release', uploaded_at: '2026-07-22T23:30:11Z' },
        { id: 1, display: '2.20.0', type: 'release', uploaded_at: '2026-07-08T12:23:12Z' },
      ]),
    );
    expect(latest.version).toBe('2.20.1');
    expect(latest.downloadUrl).toBe(curseForgeDownloadUrl(101120, 2));
    expect(latest.publishedAt).toBe('2026-07-22T23:30:11Z');
  });

  test('prefers a stable release over a newer beta', async () => {
    const latest = await fetchLatestFromCurseForge(
      PROJECT,
      cfFetch([
        { id: 2, display: '2.21.0-beta', type: 'beta', uploaded_at: '2026-07-23T00:00:00Z' },
        { id: 1, display: '2.20.1', type: 'release', uploaded_at: '2026-07-22T00:00:00Z' },
      ]),
    );
    expect(latest.version).toBe('2.20.1');
  });

  test('falls back to non-release files when no stable exists', async () => {
    const latest = await fetchLatestFromCurseForge(
      PROJECT,
      cfFetch([
        { id: 9, display: '3.0.0-beta', type: 'beta', uploaded_at: '2026-07-23T00:00:00Z' },
      ]),
    );
    expect(latest.version).toBe('3.0.0-beta');
  });

  test('throws when the project has no files', async () => {
    await expect(fetchLatestFromCurseForge(PROJECT, cfFetch([]))).rejects.toThrow('no files');
  });

  test('throws on http errors', async () => {
    const fetchImpl: FetchLike = async () => new Response('nope', { status: 404 });
    await expect(fetchLatestFromCurseForge(PROJECT, fetchImpl)).rejects.toThrow('HTTP 404');
  });
});

describe('curseForgeDownloadUrl', () => {
  test('builds the public download endpoint', () => {
    expect(curseForgeDownloadUrl(101120, 8490307)).toBe(
      'https://www.curseforge.com/api/v1/mods/101120/files/8490307/download',
    );
  });
});
