/**
 * Tolerant version comparison for WoW addon version strings, which are not
 * strict semver: '3.1.44', 'v1.0.4-e', '2.20.1', 'classic-1.4.6', etc.
 *
 * Versions are tokenized into numeric and alphabetic runs and compared
 * token by token. Numeric tokens compare numerically, alphabetic tokens
 * lexically, and a numeric token sorts before an alphabetic one (so
 * '1.0.4' < '1.0.4-e': letter suffixes denote later patch builds).
 */

type VersionToken = { kind: 'num'; value: number } | { kind: 'alpha'; value: string };

/**
 * Split a version string into comparable tokens. A leading 'v' is dropped.
 * Example: 'v1.0.4-e' -> [1, 0, 4, 'e'].
 */
export function tokenizeVersion(raw: string): VersionToken[] {
  const cleaned = raw.trim().replace(/^[vV]/, '');
  const parts = cleaned.match(/\d+|[a-zA-Z]+/g) ?? [];
  return parts.map((part) =>
    /^\d+$/.test(part)
      ? { kind: 'num', value: Number.parseInt(part, 10) }
      : { kind: 'alpha', value: part.toLowerCase() },
  );
}

/**
 * Compare two version strings.
 * Returns a negative number when a < b, zero when equal, positive when a > b.
 */
export function compareVersions(a: string, b: string): number {
  const tokensA = tokenizeVersion(a);
  const tokensB = tokenizeVersion(b);
  const length = Math.max(tokensA.length, tokensB.length);

  for (let i = 0; i < length; i++) {
    // Missing tokens pad as numeric zero, so '1.0' === '1.0.0' and
    // '1.0.4' < '1.0.4-e' (zero sorts before any alpha suffix).
    const x = tokensA[i] ?? { kind: 'num' as const, value: 0 };
    const y = tokensB[i] ?? { kind: 'num' as const, value: 0 };

    if (x.kind === 'num' && y.kind === 'num') {
      if (x.value !== y.value) return x.value - y.value;
    } else if (x.kind === 'alpha' && y.kind === 'alpha') {
      const diff = x.value.localeCompare(y.value);
      if (diff !== 0) return diff;
    } else {
      // Mixed: numeric sorts before alphabetic.
      return x.kind === 'num' ? -1 : 1;
    }
  }

  return 0;
}

/** True when candidate is a strictly newer version than current. */
export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) > 0;
}
