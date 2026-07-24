import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installFromExtracted } from '../src/addons/installer.ts';
import { ADDON_MANIFEST, type ManifestAddon } from '../src/addons/manifest.ts';
import { readAddonMetadata } from '../src/addons/metadata.ts';
import { readInstalledAddon } from '../src/addons/toc.ts';

let workDir: string;
let extractRoot: string;
let addonsPath: string;

function makeAddonFolder(relativePath: string, tocName: string, version: string): void {
  const dir = join(extractRoot, relativePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, tocName), `## Title: Test\n## Version: ${version}\n`);
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'consoleize-installer-test-'));
  extractRoot = join(workDir, 'extract');
  addonsPath = join(workDir, 'Interface', 'AddOns');
  mkdirSync(extractRoot, { recursive: true });
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

const CONSOLE_PORT = ADDON_MANIFEST.find((a) => a.id === 'console-port')!;
const DYNAMIC_CAM = ADDON_MANIFEST.find((a) => a.id === 'dynamic-cam')!;
const RELEASE = { version: '3.1.44', downloadUrl: 'https://example.com/x.zip', publishedAt: null };

describe('installFromExtracted', () => {
  test('installs every sibling addon folder of a multi-addon package', async () => {
    // Mirror the real ConsolePort package: 8 sibling addons, with embedded
    // library tocs inside the core folder that must NOT install separately.
    makeAddonFolder('ConsolePort', 'ConsolePort.toc', '3.1.44');
    makeAddonFolder('ConsolePort_Config', 'ConsolePort_Config.toc', '3.1.44');
    makeAddonFolder('ConsolePort_Bar', 'ConsolePort_Bar.toc', '3.1.44');
    makeAddonFolder('ConsolePort/Libs/External/LibStub', 'LibStub.toc', '@project-version@');

    const result = await installFromExtracted(CONSOLE_PORT, extractRoot, addonsPath, RELEASE);

    expect(result.installedDirs.sort()).toEqual([
      'ConsolePort',
      'ConsolePort_Bar',
      'ConsolePort_Config',
    ]);
    expect(existsSync(join(addonsPath, 'ConsolePort', 'ConsolePort.toc'))).toBe(true);
    expect(existsSync(join(addonsPath, 'ConsolePort_Config', 'ConsolePort_Config.toc'))).toBe(true);
    // embedded lib stays inside its parent, never installed as its own addon
    expect(existsSync(join(addonsPath, 'LibStub'))).toBe(false);
    expect(existsSync(join(addonsPath, 'ConsolePort', 'Libs', 'External', 'LibStub'))).toBe(true);

    // version + metadata come from the primary folder
    expect(result.version).toBe('3.1.44');
    expect(readAddonMetadata(join(addonsPath, 'ConsolePort'))?.sourceVersion).toBe('3.1.44');
  });

  test('renames a repo-zipball wrapper folder to the canonical directory', async () => {
    makeAddonFolder('Mpstark-DynamicCam-5ce5a8b', 'DynamicCam.toc', '@project-version@');

    const result = await installFromExtracted(DYNAMIC_CAM, extractRoot, addonsPath, {
      ...RELEASE,
      version: '2.20.1',
    });

    expect(result.installedDirs).toEqual(['DynamicCam']);
    // packager token substituted with the release version
    const toc = readFileSync(join(addonsPath, 'DynamicCam', 'DynamicCam.toc'), 'utf8');
    expect(toc).toContain('## Version: 2.20.1');
    expect(result.version).toBe('2.20.1');
  });

  test('replaces existing folders on reinstall', async () => {
    makeAddonFolder('ConsolePort', 'ConsolePort.toc', '3.1.44');
    mkdirSync(join(addonsPath, 'ConsolePort'), { recursive: true });
    writeFileSync(join(addonsPath, 'ConsolePort', 'stale-file.txt'), 'old');

    await installFromExtracted(CONSOLE_PORT, extractRoot, addonsPath, RELEASE);

    expect(existsSync(join(addonsPath, 'ConsolePort', 'stale-file.txt'))).toBe(false);
    expect(readInstalledAddon(addonsPath, 'ConsolePort').version).toBe('3.1.44');
  });

  test('throws when the package contains no addon folders', async () => {
    const bogus: ManifestAddon = {
      id: 'bogus',
      name: 'Bogus',
      directory: 'Bogus',
      curseforgeUrl: '',
      source: { type: 'github', owner: 'x', repo: 'y' },
    };
    await expect(installFromExtracted(bogus, extractRoot, addonsPath, RELEASE)).rejects.toThrow(
      'no addon .toc',
    );
  });
});
