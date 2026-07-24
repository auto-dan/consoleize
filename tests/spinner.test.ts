import { describe, expect, test } from 'bun:test';
import { createSpinner } from '../src/ui/spinner.ts';

describe('createSpinner', () => {
  test('stop before start is a safe no-op', () => {
    const spinner = createSpinner();
    expect(() => spinner.stop('done')).not.toThrow();
  });

  test('double start does not throw or leak', () => {
    const spinner = createSpinner();
    spinner.start('one');
    expect(() => spinner.start('two')).not.toThrow();
    spinner.stop('done');
  });

  test('message before start auto-starts', () => {
    const spinner = createSpinner();
    expect(() => spinner.message('working...')).not.toThrow();
    spinner.stop('done');
  });

  test('stop after stop is a no-op', () => {
    const spinner = createSpinner();
    spinner.start('working');
    spinner.stop('done');
    expect(() => spinner.stop('again')).not.toThrow();
  });
});
