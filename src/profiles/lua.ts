/**
 * Parser and sanitizer for World of Warcraft SavedVariables Lua files.
 *
 * SavedVariables files are a restricted Lua subset: a sequence of
 * `GlobalName = <value>` statements where values are table constructors,
 * strings, numbers, or booleans. The parser builds an AST annotated with
 * source spans so the scrubber can REMOVE personal-data entries by cutting
 * their exact byte ranges - everything that is kept stays byte-identical
 * to what the game wrote (no re-serialization, no reformatting).
 */

/** One entry inside a table constructor, with its source span. */
export interface LuaTableEntry {
  /** Decoded key: string for `["k"] =` / `k =`, number for `[n] =` and positional values. */
  key: string | number;
  /** Offset of the entry's first character. */
  start: number;
  /** Offset just past the entry, its trailing separator, and one following newline. */
  end: number;
  value: LuaValue;
}

/** A `{ ... }` table constructor. */
export interface LuaTable {
  /** Offset of the opening brace. */
  start: number;
  /** Offset just past the closing brace. */
  end: number;
  entries: LuaTableEntry[];
}

export type LuaValue = { kind: 'table'; table: LuaTable } | { kind: 'scalar' };

/** A `Name = <value>` statement. */
export interface SavedVariableStatement {
  name: string;
  value: LuaValue;
}

/** A parsed SavedVariables file. */
export interface SavedVariablesFile {
  statements: SavedVariableStatement[];
}

class ParseError extends Error {}

class Parser {
  private pos = 0;

  constructor(private readonly source: string) {}

  parseFile(): SavedVariablesFile {
    const statements: SavedVariableStatement[] = [];
    this.skipWhitespace();
    while (!this.eof()) {
      statements.push(this.parseStatement());
      this.skipWhitespace();
    }
    return { statements };
  }

  private eof(): boolean {
    return this.pos >= this.source.length;
  }

  private peek(): string {
    return this.source[this.pos] ?? '';
  }

  private error(message: string): ParseError {
    return new ParseError(`${message} at offset ${this.pos}`);
  }

  private skipWhitespace(): void {
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
        this.pos++;
        continue;
      }
      // Lua line comment: -- to end of line (not emitted by the game's
      // writer, but tolerated so hand-edited files still parse).
      if (ch === '-' && this.source[this.pos + 1] === '-') {
        while (!this.eof() && this.peek() !== '\n') this.pos++;
        continue;
      }
      break;
    }
  }

  private expect(ch: string): void {
    if (this.peek() !== ch) throw this.error(`expected '${ch}'`);
    this.pos++;
  }

  private isIdentStart(ch: string): boolean {
    return /[A-Za-z_]/.test(ch);
  }

  private isIdentChar(ch: string): boolean {
    return /[A-Za-z0-9_]/.test(ch);
  }

  private parseIdentifier(): string {
    if (!this.isIdentStart(this.peek())) throw this.error('expected identifier');
    const start = this.pos;
    while (!this.eof() && this.isIdentChar(this.peek())) this.pos++;
    return this.source.slice(start, this.pos);
  }

  private parseStatement(): SavedVariableStatement {
    const name = this.parseIdentifier();
    this.skipWhitespace();
    this.expect('=');
    this.skipWhitespace();
    const value = this.parseValue();
    return { name, value };
  }

  private parseValue(): LuaValue {
    const ch = this.peek();
    if (ch === '{') return { kind: 'table', table: this.parseTable() };
    if (ch === '"' || ch === "'") {
      this.parseString();
      return { kind: 'scalar' };
    }
    if (ch === '[' && (this.source[this.pos + 1] === '[' || this.source[this.pos + 1] === '=')) {
      this.parseLongString();
      return { kind: 'scalar' };
    }
    if (ch === '-' || ch === '.' || /\d/.test(ch)) {
      this.parseNumber();
      return { kind: 'scalar' };
    }
    if (this.isIdentStart(ch)) {
      const keyword = this.parseIdentifier();
      if (keyword !== 'true' && keyword !== 'false' && keyword !== 'nil') {
        throw this.error(`unexpected identifier '${keyword}'`);
      }
      return { kind: 'scalar' };
    }
    throw this.error('expected value');
  }

  /** Parse a quoted string, returning its decoded contents. */
  private parseString(): string {
    const quote = this.peek();
    this.pos++;
    let decoded = '';
    while (true) {
      if (this.eof()) throw this.error('unterminated string');
      const ch = this.peek();
      if (ch === quote) {
        this.pos++;
        return decoded;
      }
      if (ch === '\n') throw this.error('newline inside string');
      if (ch === '\\') {
        decoded += this.parseEscape();
        continue;
      }
      decoded += ch;
      this.pos++;
    }
  }

  private parseEscape(): string {
    this.pos++; // backslash
    if (this.eof()) throw this.error('unterminated escape');
    const ch = this.peek();
    const simple: Record<string, string> = {
      a: '\x07', // Lua \a (bell); not a valid JS escape
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      '\\': '\\',
      '"': '"',
      "'": "'",
    };
    const simpleEscape = simple[ch];
    if (simpleEscape !== undefined) {
      this.pos++;
      return simpleEscape;
    }
    if (/\d/.test(ch)) {
      // Decimal escape: up to 3 digits.
      let digits = '';
      while (digits.length < 3 && /\d/.test(this.peek())) {
        digits += this.peek();
        this.pos++;
      }
      return String.fromCharCode(parseInt(digits, 10) & 0xff);
    }
    if (ch === 'x') {
      // Hex escape (Lua 5.2+): \xHH.
      this.pos++;
      const hex = this.source.slice(this.pos, this.pos + 2);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) throw this.error('invalid hex escape');
      this.pos += 2;
      return String.fromCharCode(parseInt(hex, 16));
    }
    if (ch === '\n') {
      this.pos++;
      return '\n';
    }
    // Unknown escape: keep the escaped char, drop the backslash.
    this.pos++;
    return ch;
  }

  /** Parse a long-bracket string `[[...]]` / `[=[...]=]`. */
  private parseLongString(): void {
    this.expect('[');
    let level = 0;
    while (this.peek() === '=') {
      level++;
      this.pos++;
    }
    this.expect('[');
    const closing = `]${'='.repeat(level)}]`;
    const end = this.source.indexOf(closing, this.pos);
    if (end === -1) throw this.error('unterminated long string');
    this.pos = end + closing.length;
  }

  private parseNumber(): void {
    const match = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(this.source.slice(this.pos));
    if (!match) throw this.error('invalid number');
    this.pos += match[0].length;
  }

  private parseTable(): LuaTable {
    const start = this.pos;
    this.expect('{');
    const entries: LuaTableEntry[] = [];
    let positionalIndex = 0;

    for (;;) {
      this.skipWhitespace();
      if (this.eof()) throw this.error('unterminated table');
      if (this.peek() === '}') {
        this.pos++;
        return { start, end: this.pos, entries };
      }

      const entryStart = this.pos;
      let key: string | number;

      if (this.peek() === '[') {
        // Bracketed key: ["k"] = v / [n] = v.
        this.pos++;
        this.skipWhitespace();
        const ch = this.peek();
        if (ch === '"' || ch === "'") {
          key = this.parseString();
        } else {
          const numStart = this.pos;
          this.parseNumber();
          key = parseFloat(this.source.slice(numStart, this.pos));
        }
        this.skipWhitespace();
        this.expect(']');
        this.skipWhitespace();
        this.expect('=');
        this.skipWhitespace();
      } else if (this.isIdentStart(this.peek())) {
        // Either `ident = v` or a positional true/false/nil keyword.
        const ident = this.parseIdentifier();
        this.skipWhitespace();
        if (this.peek() === '=') {
          this.pos++;
          this.skipWhitespace();
          key = ident;
        } else {
          if (ident !== 'true' && ident !== 'false' && ident !== 'nil') {
            throw this.error(`unexpected identifier '${ident}'`);
          }
          positionalIndex++;
          entries.push(this.finishEntry(positionalIndex, entryStart, { kind: 'scalar' }));
          continue;
        }
      } else {
        // Positional value: { "a", 1, {...} }.
        positionalIndex++;
        const value = this.parseValue();
        entries.push(this.finishEntry(positionalIndex, entryStart, value));
        continue;
      }

      const value = this.parseValue();
      entries.push(this.finishEntry(key, entryStart, value));
    }
  }

  /**
   * Close out an entry: consume its trailing separator plus trailing
   * whitespace and one newline, so a scrubbed entry removes whole lines
   * in the game's one-entry-per-line format.
   */
  private finishEntry(key: string | number, start: number, value: LuaValue): LuaTableEntry {
    this.skipWhitespace();
    if (this.peek() === ',' || this.peek() === ';') this.pos++;
    while (this.peek() === ' ' || this.peek() === '\t') this.pos++;
    if (this.peek() === '\r' && this.source[this.pos + 1] === '\n') this.pos += 2;
    else if (this.peek() === '\n') this.pos++;
    return { key, start, end: this.pos, value };
  }
}

/**
 * Parse a SavedVariables Lua file. Throws when the file does not follow
 * the expected subset (callers should treat that as "not capturable").
 */
export function parseSavedVariables(source: string): SavedVariablesFile {
  try {
    return new Parser(source).parseFile();
  } catch (error) {
    if (error instanceof ParseError) {
      throw new Error(`invalid SavedVariables Lua: ${error.message}`);
    }
    throw error;
  }
}

/** `Name - Realm` character keys (AceDB profileKeys, per-character maps). */
const CHARACTER_REALM_KEY = /^.+\s-\s.+$/;
/** `Name (Spec) Realm` character keys (ConsolePortShared bindings). */
const CHARACTER_SPEC_REALM_KEY = /^.+\s\(.+\)\s*.+$/;

/**
 * True when a SavedVariables table key carries personal data: AceDB
 * `profileKeys` character->profile maps, or keys embedding a character
 * name (+ optional spec) and realm. Such entries are dropped wholesale,
 * which also removes any character names in their values.
 */
export function isPersonalDataKey(key: string): boolean {
  return (
    key === 'profileKeys' ||
    CHARACTER_REALM_KEY.test(key) ||
    CHARACTER_SPEC_REALM_KEY.test(key)
  );
}

/** Result of scrubbing a SavedVariables file. */
export interface ScrubResult {
  /** Sanitized source; byte-identical to the input except removed entries. */
  source: string;
  /** Dotted paths of the dropped entries (for transparency/logging). */
  droppedKeys: string[];
}

/** Extend an entry span backwards over same-line indentation. */
function extendStartBackwards(source: string, start: number): number {
  let extended = start;
  while (extended > 0 && (source[extended - 1] === ' ' || source[extended - 1] === '\t')) {
    extended--;
  }
  return extended;
}

/**
 * Remove personal-data entries from a SavedVariables file. Entries whose
 * decoded string key matches `shouldDropKey` are cut out at any nesting
 * depth; kept content is preserved byte-for-byte. Dropping an entry drops
 * its whole subtree, so character names nested inside go with it.
 */
export function scrubSavedVariables(
  source: string,
  shouldDropKey: (key: string) => boolean = isPersonalDataKey,
): ScrubResult {
  const file = parseSavedVariables(source);
  const edits: Array<{ start: number; end: number }> = [];
  const droppedKeys: string[] = [];

  const collect = (table: LuaTable, path: string[]): void => {
    for (const entry of table.entries) {
      const keyName = typeof entry.key === 'string' ? entry.key : null;
      if (keyName !== null && shouldDropKey(keyName)) {
        edits.push({ start: extendStartBackwards(source, entry.start), end: entry.end });
        droppedKeys.push([...path, keyName].join('.'));
        continue; // a dropped subtree needs no edits of its own
      }
      if (entry.value.kind === 'table') {
        collect(entry.value.table, keyName !== null ? [...path, keyName] : path);
      }
    }
  };

  for (const statement of file.statements) {
    if (statement.value.kind === 'table') collect(statement.value.table, [statement.name]);
  }

  // Edits never overlap (a dropped entry swallows its subtree), so apply
  // right-to-left to keep earlier offsets valid.
  edits.sort((a, b) => b.start - a.start);
  let result = source;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + result.slice(edit.end);
  }
  return { source: result, droppedKeys };
}
