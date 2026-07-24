import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { configFilePath } from '../src/config/paths.ts';
import {
  createConfig,
  DEFAULT_PREFERENCES,
  loadConfig,
  resetConfig,
  saveConfig,
} from '../src/config/store.ts';

let xdgDir: string;
let originalXdg: string | undefined;

beforeEach(() => {
  xdgDir = mkdtempSync(join(tmpdir(), 'consoleize-store-test-'));
  originalXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = xdgDir;
});

afterEach(() => {
  if (originalXdg === undefined) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdg;
  }
  rmSync(xdgDir, { recursive: true, force: true });
});

describe('config store', () => {
  test('loadConfig returns null when no config exists', () => {
    expect(loadConfig()).toBeNull();
  });

  test('save + load roundtrips the config', () => {
    const config = createConfig('illidan', '/wow/_retail_/Interface/AddOns');
    config.preferences.debug = true;
    config.addons['console-port'] = {
      latestVersion: '3.1.44',
      lastCheckedAt: '2026-07-24T00:00:00Z',
    };
    saveConfig(config);

    const loaded = loadConfig();
    expect(loaded).not.toBeNull();
    expect(loaded?.username).toBe('illidan');
    expect(loaded?.wowAddonsPath).toBe('/wow/_retail_/Interface/AddOns');
    expect(loaded?.preferences.debug).toBe(true);
    expect(loaded?.addons['console-port']?.latestVersion).toBe('3.1.44');
  });

  test('config is written under the XDG config home', () => {
    saveConfig(createConfig('illidan', '/wow'));
    expect(configFilePath()).toBe(join(xdgDir, 'consoleize', 'config.json'));
    expect(existsSync(configFilePath())).toBe(true);
  });

  test('missing preferences fall back to defaults', () => {
    const path = join(xdgDir, 'consoleize', 'config.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ username: 'illidan', wowAddonsPath: '/wow' }));

    const loaded = loadConfig();
    expect(loaded?.preferences).toEqual(DEFAULT_PREFERENCES);
  });

  test('corrupt config loads as null instead of throwing', () => {
    const path = join(xdgDir, 'consoleize', 'config.json');
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'not json {{{');
    expect(loadConfig()).toBeNull();
  });

  test('resetConfig deletes the config file', () => {
    saveConfig(createConfig('illidan', '/wow'));
    expect(existsSync(configFilePath())).toBe(true);
    resetConfig();
    expect(existsSync(configFilePath())).toBe(false);
  });

  test('resetConfig is a no-op when nothing exists', () => {
    expect(() => resetConfig()).not.toThrow();
  });
});
