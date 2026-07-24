import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearAddonData, getStatuses, listAddonData } from '../src/addons/manager.ts';
import { writeAddonMetadata } from '../src/addons/metadata.ts';
import { createConfig, type UserConfig } from '../src/config/store.ts';

let workDir: string;
let addonsDir: string;
let config: UserConfig;

function installFakeAddon(directory: string, tocVersion: string): string {
  const dir = join(addonsDir, directory);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${directory}.toc`), `## Version: ${tocVersion}\n`);
  return dir;
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'consoleize-manager-test-'));
  // mirror the real layout: <workDir>/Interface/AddOns
  addonsDir = join(workDir, 'Interface', 'AddOns');
  mkdirSync(addonsDir, { recursive: true });
  config = createConfig('illidan', addonsDir);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('getStatuses', () => {
  test('reports not-installed addons', () => {
    const statuses = getStatuses(config);
    expect(statuses).toHaveLength(3);
    for (const status of statuses) {
      expect(status.installed).toBe(false);
      expect(status.updateAvailable).toBe(false);
    }
  });

  test('flags an update when the toc version is older than the cached latest', () => {
    installFakeAddon('ConsolePort', '3.1.43');
    config.addons['console-port'] = {
      latestVersion: '3.1.44',
      lastCheckedAt: '2026-07-24T00:00:00Z',
    };

    const status = getStatuses(config).find((s) => s.manifest.id === 'console-port');
    expect(status?.installed).toBe(true);
    expect(status?.installedVersion).toBe('3.1.43');
    expect(status?.updateAvailable).toBe(true);
  });

  test('no update when up to date', () => {
    installFakeAddon('ConsolePort', '3.1.44');
    config.addons['console-port'] = {
      latestVersion: '3.1.44',
      lastCheckedAt: '2026-07-24T00:00:00Z',
    };

    const status = getStatuses(config).find((s) => s.manifest.id === 'console-port');
    expect(status?.updateAvailable).toBe(false);
  });

  test('metadata source version wins over the toc version', () => {
    // DialogueUI's toc says '1.0.4' but the release tag was 'v1.0.4-e';
    // without the recorded source version this would look outdated forever.
    const dir = installFakeAddon('DialogueUI', '1.0.4');
    writeAddonMetadata(dir, {
      addonId: 'dialogue-ui',
      sourceVersion: 'v1.0.4-e',
      installedAt: '2026-07-24T00:00:00Z',
    });
    config.addons['dialogue-ui'] = {
      latestVersion: 'v1.0.4-e',
      lastCheckedAt: '2026-07-24T00:00:00Z',
    };

    const status = getStatuses(config).find((s) => s.manifest.id === 'dialogue-ui');
    expect(status?.installedVersion).toBe('1.0.4');
    expect(status?.updateAvailable).toBe(false);
  });

  test('unknown latest version never flags an update', () => {
    installFakeAddon('ConsolePort', '3.1.43');
    const status = getStatuses(config).find((s) => s.manifest.id === 'console-port');
    expect(status?.updateAvailable).toBe(false);
  });
});

describe('clearAddonData', () => {
  test('deletes everything inside the addons folder and resets the cache', async () => {
    installFakeAddon('ConsolePort', '3.1.44');
    installFakeAddon('DynamicCam', '2.20.1');
    config.addons['console-port'] = {
      latestVersion: '3.1.44',
      lastCheckedAt: '2026-07-24T00:00:00Z',
    };

    const { removed } = await clearAddonData(config);

    expect(removed.sort()).toEqual(['ConsolePort', 'DynamicCam']);
    expect(config.addons).toEqual({});
    const statuses = getStatuses(config);
    for (const status of statuses) {
      expect(status.installed).toBe(false);
    }
  });

  test('is a no-op when the addons folder does not exist', async () => {
    rmSync(addonsDir, { recursive: true, force: true });
    const { removed } = await clearAddonData(config);
    expect(removed).toEqual([]);
  });

  test('refuses to run when the tracked path is not an AddOns folder', async () => {
    const notAddons = join(workDir, 'World of Warcraft');
    mkdirSync(notAddons, { recursive: true });
    const dangerous = createConfig('illidan', notAddons);
    await expect(clearAddonData(dangerous)).rejects.toThrow('not an AddOns folder');
  });

  test('listAddonData previews folder contents', async () => {
    installFakeAddon('ConsolePort', '3.1.44');
    expect(await listAddonData(config)).toEqual(['ConsolePort']);
    const missing = createConfig('illidan', join(workDir, 'Interface', 'Nope'));
    rmSync(join(workDir, 'Interface'), { recursive: true, force: true });
    expect(await listAddonData(missing)).toEqual([]);
  });
});
