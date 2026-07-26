import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfig, type UserConfig } from '../src/config/store.ts';
import {
  ACCOUNT_PLACEHOLDER,
  applyProfiles,
  captureDefaults,
} from '../src/profiles/defaults.ts';

let workDir: string;
let profilesDir: string;

const ACCOUNT_NAME = 'SECRETACCT';

/** Build a fake WoW install: <root>/_retail_/Interface/AddOns + WTF/Account. */
function makeWowInstall(root: string, accountName: string | null): UserConfig {
  const addonsDir = join(root, '_retail_', 'Interface', 'AddOns');
  mkdirSync(addonsDir, { recursive: true });
  if (accountName !== null) {
    mkdirSync(join(root, '_retail_', 'WTF', 'Account', accountName, 'SavedVariables'), {
      recursive: true,
    });
  }
  return createConfig('tester', addonsDir);
}

function writeSavedVariables(config: UserConfig, accountName: string, name: string, lua: string) {
  const dir = join(
    config.wowAddonsPath,
    '..',
    '..',
    'WTF',
    'Account',
    accountName,
    'SavedVariables',
  );
  writeFileSync(join(dir, name), lua, 'utf8');
}

function savedVariablesDir(config: UserConfig, accountName: string): string {
  return join(
    config.wowAddonsPath,
    '..',
    '..',
    'WTF',
    'Account',
    accountName,
    'SavedVariables',
  );
}

const DYNAMIC_CAM_LUA = [
  'DynamicCamDB = {',
  '["profileKeys"] = {',
  '["Zappydan - Illidan"] = "Default",',
  '},',
  '["profiles"] = {',
  '["Default"] = {',
  '["cvars"] = {',
  '["cameraZoomSpeed"] = 20,',
  '},',
  '},',
  '},',
  '}',
].join('\n');

const CONSOLE_PORT_LUA = [
  'ConsolePortSettings = {',
  '["mvmtAnalog"] = true,',
  '}',
  'ConsolePortShared = {',
  '["Zappydan (Restoration) Illidan"] = {',
  '["Meta"] = {',
  '["Name"] = "Zappydan",',
  '},',
  '},',
  '}',
].join('\n');

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'consoleize-defaults-test-'));
  profilesDir = join(workDir, 'profiles');
  mkdirSync(profilesDir, { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('captureDefaults', () => {
  test('captures managed addon settings into the placeholder layout, sanitized', async () => {
    const install = join(workDir, 'wow-a');
    const config = makeWowInstall(install, ACCOUNT_NAME);
    writeSavedVariables(config, ACCOUNT_NAME, 'DynamicCam.lua', DYNAMIC_CAM_LUA);
    writeSavedVariables(config, ACCOUNT_NAME, 'ConsolePort.lua', CONSOLE_PORT_LUA);
    writeSavedVariables(config, ACCOUNT_NAME, 'DialogueUI.lua', 'DialogueUI_DB = {\n["Theme"] = 1,\n}');
    // Not managed: Blizzard's own files, unrelated addons, and .bak backups.
    writeSavedVariables(config, ACCOUNT_NAME, 'Blizzard_CombatLog.lua', 'CombatLogDB = {}');
    writeSavedVariables(config, ACCOUNT_NAME, 'WeakAuras.lua', 'WeakAurasDB = {}');
    writeSavedVariables(config, ACCOUNT_NAME, 'DynamicCam.lua.bak', DYNAMIC_CAM_LUA);

    const result = await captureDefaults(config, { profilesDir });

    expect(result.captured).toEqual(['ConsolePort.lua', 'DialogueUI.lua', 'DynamicCam.lua']);

    const targetDir = join(
      profilesDir,
      'WTF',
      'Account',
      ACCOUNT_PLACEHOLDER,
      'SavedVariables',
    );
    expect(result.targetDir).toBe(targetDir);

    const dynamicCam = readFileSync(join(targetDir, 'DynamicCam.lua'), 'utf8');
    expect(dynamicCam).toContain('cameraZoomSpeed');
    expect(dynamicCam).not.toContain('Zappydan');
    expect(dynamicCam).not.toContain('profileKeys');

    const consolePort = readFileSync(join(targetDir, 'ConsolePort.lua'), 'utf8');
    expect(consolePort).toContain('mvmtAnalog');
    expect(consolePort).not.toContain('Zappydan');

    // Nothing outside the managed addons was captured.
    expect(existsSync(join(targetDir, 'Blizzard_CombatLog.lua'))).toBe(false);
    expect(existsSync(join(targetDir, 'WeakAuras.lua'))).toBe(false);
    expect(existsSync(join(targetDir, 'DynamicCam.lua.bak'))).toBe(false);

    // The account name must not appear anywhere in the captured defaults.
    for (const file of result.captured) {
      expect(readFileSync(join(targetDir, file), 'utf8')).not.toContain(ACCOUNT_NAME);
    }

    expect(result.scrubbedKeys).toEqual([
      'ConsolePort.lua: ConsolePortShared.Zappydan (Restoration) Illidan',
      'DynamicCam.lua: DynamicCamDB.profileKeys',
    ]);
  });

  test('replaces stale defaults from a previous capture', async () => {
    const config = makeWowInstall(join(workDir, 'wow-a'), ACCOUNT_NAME);
    writeSavedVariables(config, ACCOUNT_NAME, 'DynamicCam.lua', DYNAMIC_CAM_LUA);

    const staleDir = join(
      profilesDir,
      'WTF',
      'Account',
      ACCOUNT_PLACEHOLDER,
      'SavedVariables',
    );
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, 'Stale.lua'), 'StaleDB = {}', 'utf8');

    await captureDefaults(config, { profilesDir });

    expect(existsSync(join(staleDir, 'Stale.lua'))).toBe(false);
    expect(existsSync(join(staleDir, 'DynamicCam.lua'))).toBe(true);
  });

  test('throws when the install has no account SavedVariables yet', async () => {
    const config = makeWowInstall(join(workDir, 'wow-a'), null);
    await expect(captureDefaults(config, { profilesDir })).rejects.toThrow(
      'log into WoW once first',
    );
  });

  test('throws when no profiles directory exists', async () => {
    const config = makeWowInstall(join(workDir, 'wow-a'), ACCOUNT_NAME);
    writeSavedVariables(config, ACCOUNT_NAME, 'DynamicCam.lua', DYNAMIC_CAM_LUA);
    await expect(
      captureDefaults(config, { profilesDir: join(workDir, 'no-such-dir') }),
    ).rejects.toThrow('no profiles/ directory found');
  });
});

describe('applyProfiles', () => {
  test('expands the account placeholder into every real account folder', async () => {
    // Capture from the maintainer install...
    const source = makeWowInstall(join(workDir, 'wow-source'), ACCOUNT_NAME);
    writeSavedVariables(source, ACCOUNT_NAME, 'DynamicCam.lua', DYNAMIC_CAM_LUA);
    await captureDefaults(source, { profilesDir });

    // ...then apply to a fresh install with a different account name.
    const target = makeWowInstall(join(workDir, 'wow-target'), 'NEWACCT');
    const result = await applyProfiles(target, { profilesDir });

    expect(result.applied).toBe(true);
    const applied = readFileSync(
      join(savedVariablesDir(target, 'NEWACCT'), 'DynamicCam.lua'),
      'utf8',
    );
    expect(applied).toContain('cameraZoomSpeed');
    expect(applied).not.toContain('Zappydan');
    expect(applied).not.toContain(ACCOUNT_NAME);
    // No literal placeholder folder may leak onto the install.
    expect(
      existsSync(join(target.wowAddonsPath, '..', '..', 'WTF', 'Account', ACCOUNT_PLACEHOLDER)),
    ).toBe(false);
  });

  test('copies plain overlay files verbatim', async () => {
    const config = makeWowInstall(join(workDir, 'wow-a'), ACCOUNT_NAME);
    const wtfDir = join(profilesDir, 'WTF');
    mkdirSync(wtfDir, { recursive: true });
    writeFileSync(join(wtfDir, 'Config.wtf'), 'SET cameraFoV "90"\n', 'utf8');

    const result = await applyProfiles(config, { profilesDir });

    expect(result.applied).toBe(true);
    expect(result.filesCopied).toEqual([join('WTF', 'Config.wtf')]);
    const written = readFileSync(join(config.wowAddonsPath, '..', '..', 'WTF', 'Config.wtf'), 'utf8');
    expect(written).toBe('SET cameraFoV "90"\n');
  });

  test('reports when there is no account folder to expand into', async () => {
    const config = makeWowInstall(join(workDir, 'wow-a'), null);
    const svDir = join(profilesDir, 'WTF', 'Account', ACCOUNT_PLACEHOLDER, 'SavedVariables');
    mkdirSync(svDir, { recursive: true });
    writeFileSync(join(svDir, 'DynamicCam.lua'), DYNAMIC_CAM_LUA, 'utf8');

    const result = await applyProfiles(config, { profilesDir });

    expect(result.applied).toBe(false);
    expect(result.reason).toContain('no WoW account folder');
  });

  test('reports when the profiles directory is missing or empty', async () => {
    const config = makeWowInstall(join(workDir, 'wow-a'), ACCOUNT_NAME);

    const missing = await applyProfiles(config, { profilesDir: join(workDir, 'no-such-dir') });
    expect(missing.applied).toBe(false);
    expect(missing.reason).toContain('no profiles/ directory found');

    const empty = await applyProfiles(config, { profilesDir });
    expect(empty.applied).toBe(false);
    expect(empty.reason).toContain('profiles/ is empty');
  });
});
