import { describe, expect, test } from 'bun:test';
import { compareVersions, isNewerVersion, tokenizeVersion } from '../src/addons/versions.ts';

describe('tokenizeVersion', () => {
  test('splits numeric runs', () => {
    expect(tokenizeVersion('3.1.44')).toEqual([
      { kind: 'num', value: 3 },
      { kind: 'num', value: 1 },
      { kind: 'num', value: 44 },
    ]);
  });

  test('strips a leading v', () => {
    expect(tokenizeVersion('v2.20.1')).toEqual([
      { kind: 'num', value: 2 },
      { kind: 'num', value: 20 },
      { kind: 'num', value: 1 },
    ]);
  });

  test('keeps letter suffixes as alpha tokens', () => {
    expect(tokenizeVersion('1.0.4-e')).toEqual([
      { kind: 'num', value: 1 },
      { kind: 'num', value: 0 },
      { kind: 'num', value: 4 },
      { kind: 'alpha', value: 'e' },
    ]);
  });
});

describe('compareVersions', () => {
  test('orders plain numeric versions', () => {
    expect(compareVersions('3.1.44', '3.1.43')).toBeGreaterThan(0);
    expect(compareVersions('3.1.44', '3.1.44')).toBe(0);
    expect(compareVersions('3.1.44', '3.2.0')).toBeLessThan(0);
  });

  test('compares numerically, not lexically', () => {
    expect(compareVersions('2.20.1', '2.9.9')).toBeGreaterThan(0);
  });

  test('ignores a leading v', () => {
    expect(compareVersions('v1.0.4', '1.0.4')).toBe(0);
  });

  test('letter suffix is newer than the bare version', () => {
    expect(compareVersions('1.0.4-e', '1.0.4')).toBeGreaterThan(0);
    expect(compareVersions('1.0.4-e', '1.0.4-d')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.4-e', 'v1.0.4-d')).toBeGreaterThan(0);
  });

  test('missing tokens pad as zero', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBeGreaterThan(0);
  });

  test('isNewerVersion', () => {
    expect(isNewerVersion('3.1.44', '3.1.43')).toBe(true);
    expect(isNewerVersion('3.1.43', '3.1.44')).toBe(false);
    expect(isNewerVersion('3.1.44', '3.1.44')).toBe(false);
  });
});
