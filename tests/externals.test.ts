import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parsePkgmetaExternals,
  parseWowAceUrl,
  parseXmlFileRefs,
  resolveExternals,
} from '../src/addons/externals.ts';
import type { FetchLike } from '../src/addons/sources/github.ts';

const DYNAMIC_CAM_PKGMETA = `package-as: DynamicCam

externals:
    Libs/LibStub:
        url: https://repos.wowace.com/wow/libstub/trunk

    # Ace3 Libraries
    Libs/AceLocale-3.0:
        url: https://repos.wowace.com/wow/ace3/trunk/AceLocale-3.0

    # Libraries
    Libs/LibCamera:
        url: https://github.com/Mpstark/LibCamera.git
    Libs/LibMountInfo:
        url: https://github.com/LudiusMaximus/LibMountInfo
`;

describe('parsePkgmetaExternals', () => {
  test('parses paths and urls, ignoring comments', () => {
    const specs = parsePkgmetaExternals(DYNAMIC_CAM_PKGMETA);
    expect(specs).toEqual([
      { path: 'Libs/LibStub', url: 'https://repos.wowace.com/wow/libstub/trunk' },
      {
        path: 'Libs/AceLocale-3.0',
        url: 'https://repos.wowace.com/wow/ace3/trunk/AceLocale-3.0',
      },
      { path: 'Libs/LibCamera', url: 'https://github.com/Mpstark/LibCamera.git' },
      { path: 'Libs/LibMountInfo', url: 'https://github.com/LudiusMaximus/LibMountInfo' },
    ]);
  });

  test('returns empty when there is no externals section', () => {
    expect(parsePkgmetaExternals('package-as: Foo\n')).toEqual([]);
    expect(parsePkgmetaExternals('')).toEqual([]);
  });

  test('stops at the next top-level key', () => {
    const content = `externals:\n    Libs/A:\n        url: https://example.com/a\nmove-folders:\n    a: b\n`;
    expect(parsePkgmetaExternals(content)).toEqual([
      { path: 'Libs/A', url: 'https://example.com/a' },
    ]);
  });
});

describe('parseWowAceUrl', () => {
  test('parses project and subpath', () => {
    expect(parseWowAceUrl('https://repos.wowace.com/wow/ace3/trunk/AceGUI-3.0')).toEqual({
      project: 'ace3',
      subpath: 'AceGUI-3.0',
    });
    expect(parseWowAceUrl('https://repos.wowace.com/wow/libstub/trunk')).toEqual({
      project: 'libstub',
      subpath: '',
    });
    expect(parseWowAceUrl('https://repos.wowace.com/wow/ace3/trunk/AceGUI-3.0/')).toEqual({
      project: 'ace3',
      subpath: 'AceGUI-3.0',
    });
  });

  test('returns null for non-wowace urls', () => {
    expect(parseWowAceUrl('https://github.com/Mpstark/LibCamera.git')).toBeNull();
    expect(parseWowAceUrl('https://example.com/wow/ace3/trunk')).toBeNull();
  });
});

describe('parseXmlFileRefs', () => {
  test('extracts Script and Include file attributes', () => {
    const xml = `<Ui>
      <Script file="AceGUI-3.0.lua"/>
      <Script file="widgets\\AceGUIWidget-Button.lua"/>
      <Include file="Callbacks\\Callbacks.xml"/>
    </Ui>`;
    expect(parseXmlFileRefs(xml)).toEqual([
      'AceGUI-3.0.lua',
      'widgets\\AceGUIWidget-Button.lua',
      'Callbacks\\Callbacks.xml',
    ]);
  });

  test('ignores commented-out includes', () => {
    const xml = `<Ui>
      <Include file="Real\\Real.xml"/>
      <!--<Include file="Commented\\Commented.xml"/>-->
    </Ui>`;
    expect(parseXmlFileRefs(xml)).toEqual(['Real\\Real.xml']);
  });
});

describe('resolveExternals (wowace over http)', () => {
  let workDir: string;
  let addonDir: string;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'consoleize-externals-test-'));
    addonDir = join(workDir, 'DynamicCam');
    mkdirSync(addonDir, { recursive: true });
    // NB: 'somelib' is not in WOWACE_MIRRORS, so these tests exercise the
    // per-file walker; mirrored projects (ace3) are covered by live smoke.
    writeFileSync(
      join(addonDir, '.pkgmeta'),
      `externals:\n    Libs/AceLocale-3.0:\n        url: https://repos.wowace.com/wow/somelib/trunk/AceLocale-3.0\n`,
    );
  });

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  function mockWowAceFetch(files: Record<string, string>): FetchLike {
    return async (url: string) => {
      for (const [path, content] of Object.entries(files)) {
        if (url.endsWith(path)) {
          return new Response(content, { status: 200 });
        }
      }
      return new Response('not found', { status: 404 });
    };
  }

  test('fetches the xml and every referenced file', async () => {
    const fetchImpl = mockWowAceFetch({
      'AceLocale-3.0/AceLocale-3.0.xml': '<Ui><Script file="AceLocale-3.0.lua"/></Ui>',
      'AceLocale-3.0/AceLocale-3.0.lua': '-- locale lib',
    });

    const result = await resolveExternals(addonDir, fetchImpl);

    expect(result.failed).toEqual([]);
    expect(result.resolved).toEqual(['Libs/AceLocale-3.0']);
    expect(existsSync(join(addonDir, 'Libs/AceLocale-3.0/AceLocale-3.0.xml'))).toBe(true);
    expect(existsSync(join(addonDir, 'Libs/AceLocale-3.0/AceLocale-3.0.lua'))).toBe(true);
  });

  test('recurses into subdirectories referenced by the xml', async () => {
    const fetchImpl = mockWowAceFetch({
      'AceLocale-3.0/AceLocale-3.0.xml':
        '<Ui><Script file="AceLocale-3.0.lua"/><Script file="widgets\\Extra.lua"/></Ui>',
      'AceLocale-3.0/AceLocale-3.0.lua': '-- main',
      'AceLocale-3.0/widgets/Extra.lua': '-- widget',
    });

    const result = await resolveExternals(addonDir, fetchImpl);
    expect(result.failed).toEqual([]);
    expect(existsSync(join(addonDir, 'Libs/AceLocale-3.0/widgets/Extra.lua'))).toBe(true);
  });

  test('falls back to a bare <name>.lua when no xml exists', async () => {
    const fetchImpl = mockWowAceFetch({
      'AceLocale-3.0/AceLocale-3.0.lua': '-- lua only',
    });

    const result = await resolveExternals(addonDir, fetchImpl);
    expect(result.failed).toEqual([]);
    expect(existsSync(join(addonDir, 'Libs/AceLocale-3.0/AceLocale-3.0.lua'))).toBe(true);
  });

  test('reports a failure when nothing can be fetched', async () => {
    const fetchImpl = mockWowAceFetch({});
    const result = await resolveExternals(addonDir, fetchImpl);
    expect(result.resolved).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.path).toBe('Libs/AceLocale-3.0');
  });

  test('is a no-op when no .pkgmeta exists', async () => {
    rmSync(join(addonDir, '.pkgmeta'));
    const result = await resolveExternals(addonDir);
    expect(result).toEqual({ resolved: [], failed: [] });
  });

  test('retries transient throttling and eventually succeeds', async () => {
    let calls = 0;
    const fetchImpl: FetchLike = async (url: string) => {
      calls++;
      if (url.endsWith('AceLocale-3.0.xml')) {
        if (calls <= 2) return new Response('throttled', { status: 503 });
        return new Response('<Ui><Script file="AceLocale-3.0.lua"/></Ui>', { status: 200 });
      }
      if (url.endsWith('AceLocale-3.0.lua')) return new Response('-- ok', { status: 200 });
      return new Response('not found', { status: 404 });
    };

    const result = await resolveExternals(addonDir, fetchImpl);
    expect(result.failed).toEqual([]);
    expect(result.resolved).toEqual(['Libs/AceLocale-3.0']);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  test('gives up after repeated throttling and reports the failure', async () => {
    const fetchImpl: FetchLike = async () => new Response('throttled', { status: 503 });
    const result = await resolveExternals(addonDir, fetchImpl);
    expect(result.resolved).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.error).toContain('503');
  }, 15000);
});
