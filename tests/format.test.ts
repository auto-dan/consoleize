import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { bannerFits, renderBanner } from '../src/ui/banner.ts';
import { formatBytes, shortenPath } from '../src/ui/format.ts';

describe('shortenPath', () => {
  test('collapses the home directory to ~', () => {
    const path = `${homedir()}/.config/consoleize/config.json`;
    expect(shortenPath(path, 100)).toBe('~/.config/consoleize/config.json');
  });

  test('leaves non-home paths alone', () => {
    expect(shortenPath('/opt/wow/Interface/AddOns', 100)).toBe('/opt/wow/Interface/AddOns');
  });

  test('ellipsizes the middle when too long', () => {
    const path = '/very/long/path/to/World of Warcraft/_retail_/Interface/AddOns';
    const shortened = shortenPath(path, 30);
    expect(shortened.length).toBe(30);
    expect(shortened).toContain('…');
    expect(shortened.startsWith('/very/long/path')).toBe(true);
    expect(shortened.endsWith('AddOns')).toBe(true);
  });

  test('returns the path untouched when it fits', () => {
    expect(shortenPath('/short/path', 30)).toBe('/short/path');
  });
});

describe('renderBanner', () => {
  test('renders the full ASCII art on wide terminals', () => {
    expect(bannerFits(100)).toBe(true);
    expect(renderBanner(100)).toContain('█');
  });

  test('renders a compact wordmark on narrow terminals', () => {
    expect(bannerFits(50)).toBe(false);
    const banner = renderBanner(50);
    expect(banner).not.toContain('█');
    // Letters are individually wrapped in truecolor escapes; strip to compare.
    // eslint-disable-next-line no-control-regex -- stripping raw ESC bytes is the point
    const plain = banner.replace(/\x1b\[[0-9;]*m/g, '');
    expect(plain).toContain('C O N S O L E I Z E');
  });
});

describe('formatBytes', () => {
  test('formats human-readable sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(18026863)).toBe('18.0 MB');
  });
});
