import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  METADATA_FILENAME,
  readAddonMetadata,
  writeAddonMetadata,
} from '../src/addons/metadata.ts';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'consoleize-metadata-test-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('addon metadata', () => {
  test('write + read roundtrips', () => {
    writeAddonMetadata(workDir, {
      addonId: 'dialogue-ui',
      sourceVersion: 'v1.0.4-e',
      installedAt: '2026-07-24T00:00:00Z',
    });

    expect(existsSync(join(workDir, METADATA_FILENAME))).toBe(true);
    expect(readAddonMetadata(workDir)).toEqual({
      addonId: 'dialogue-ui',
      sourceVersion: 'v1.0.4-e',
      installedAt: '2026-07-24T00:00:00Z',
    });
  });

  test('returns null when no metadata exists', () => {
    expect(readAddonMetadata(workDir)).toBeNull();
  });

  test('returns null on corrupt metadata instead of throwing', () => {
    writeFileSync(join(workDir, METADATA_FILENAME), 'nope');
    expect(readAddonMetadata(workDir)).toBeNull();
  });
});
