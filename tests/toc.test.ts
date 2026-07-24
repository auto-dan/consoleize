import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInstalledAddon, readTocVersion } from '../src/addons/toc.ts';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'consoleize-toc-test-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('readTocVersion', () => {
  test('parses the Version field', () => {
    const tocPath = join(workDir, 'ConsolePort.toc');
    writeFileSync(
      tocPath,
      ['## Interface: 110107', '## Title: ConsolePort', '## Version: 3.1.44', ''].join('\n'),
    );
    expect(readTocVersion(tocPath)).toBe('3.1.44');
  });

  test('tolerates extra whitespace', () => {
    const tocPath = join(workDir, 'DynamicCam.toc');
    writeFileSync(tocPath, '## Version:   2.20.1  \n');
    expect(readTocVersion(tocPath)).toBe('2.20.1');
  });

  test('returns null when no Version field exists', () => {
    const tocPath = join(workDir, 'DialogueUI.toc');
    writeFileSync(tocPath, '## Title: Dialogue UI\n');
    expect(readTocVersion(tocPath)).toBeNull();
  });
});

describe('readInstalledAddon', () => {
  test('reports missing addons as not installed', () => {
    const info = readInstalledAddon(workDir, 'ConsolePort');
    expect(info.installed).toBe(false);
    expect(info.version).toBeNull();
    expect(info.modifiedAt).toBeNull();
  });

  test('reads version and mtime from an installed addon', () => {
    const addonDir = join(workDir, 'DialogueUI');
    mkdirSync(addonDir);
    writeFileSync(join(addonDir, 'DialogueUI.toc'), '## Version: 1.0.4-e\n');

    const info = readInstalledAddon(workDir, 'DialogueUI');
    expect(info.installed).toBe(true);
    expect(info.version).toBe('1.0.4-e');
    expect(info.modifiedAt).toBeInstanceOf(Date);
  });

  test('handles addons whose toc does not match the folder name', () => {
    const addonDir = join(workDir, 'DynamicCam');
    mkdirSync(addonDir);
    writeFileSync(join(addonDir, 'DynamicCam_Mainline.toc'), '## Version: 2.20.1\n');

    const info = readInstalledAddon(workDir, 'DynamicCam');
    expect(info.installed).toBe(true);
    expect(info.version).toBe('2.20.1');
  });
});
