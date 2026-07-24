import { describe, expect, test } from 'bun:test';
import { isNavKey } from '../src/ui/prompts.ts';

describe('isNavKey', () => {
  test('matches arrow-key escape sequences', () => {
    expect(isNavKey('\x1b[A', false)).toBe(true); // up
    expect(isNavKey('\x1b[B', false)).toBe(true); // down
    expect(isNavKey('\x1bOA', false)).toBe(true); // application mode up
  });

  test('does not match unrelated input', () => {
    expect(isNavKey('x', true)).toBe(false);
    expect(isNavKey('hello', true)).toBe(false);
    expect(isNavKey('\r', true)).toBe(false);
  });

  test('matches lone hjkl only when vim keys are enabled', () => {
    for (const key of ['h', 'j', 'k', 'l']) {
      expect(isNavKey(key, true)).toBe(true);
      expect(isNavKey(key, false)).toBe(false);
    }
  });

  test('does not match hjkl inside longer input (pasted text, words)', () => {
    expect(isNavKey('hjkl', true)).toBe(false);
    expect(isNavKey('john', true)).toBe(false);
  });
});
