import { describe, expect, test } from 'bun:test';
import {
  isPersonalDataKey,
  parseSavedVariables,
  scrubSavedVariables,
} from '../src/profiles/lua.ts';

describe('isPersonalDataKey', () => {
  test('matches AceDB profileKeys and character/realm keys', () => {
    expect(isPersonalDataKey('profileKeys')).toBe(true);
    expect(isPersonalDataKey('Zappydan - Illidan')).toBe(true);
    expect(isPersonalDataKey('Autodan - Emerald Dream')).toBe(true);
    expect(isPersonalDataKey('Zappydan (Restoration) Illidan')).toBe(true);
  });

  test('ignores ordinary setting keys', () => {
    const keys = [
      'cameraZoomSpeed',
      'profiles',
      'Default',
      'global',
      'PADRTRIGGER',
      'SHIFT-',
      'CTRL-SHIFT-',
      'test_cameraOverShoulder',
    ];
    for (const key of keys) {
      expect(isPersonalDataKey(key)).toBe(false);
    }
  });
});

describe('parseSavedVariables', () => {
  test('parses statements with nested tables, scalars, and positional entries', () => {
    const file = parseSavedVariables(
      [
        'SomeDB = {',
        '["name"] = "value",',
        '["flag"] = true,',
        '["num"] = -1.5e3,',
        '["nested"] = {',
        '{ ["value"] = 0.5, ["zoom"] = 0, },',
        '{ ["value"] = 0.5, ["zoom"] = 39, },',
        '},',
        '}',
        'Empty = {',
        '}',
      ].join('\n'),
    );

    expect(file.statements.map((statement) => statement.name)).toEqual(['SomeDB', 'Empty']);
    const someDb = file.statements[0];
    expect(someDb?.value.kind).toBe('table');
    if (someDb?.value.kind !== 'table') throw new Error('expected table');
    expect(someDb.value.table.entries.map((entry) => entry.key)).toEqual([
      'name',
      'flag',
      'num',
      'nested',
    ]);
  });

  test('decodes escaped characters in string keys', () => {
    const file = parseSavedVariables('DB = {\n["it\\"s - \\"Realm\\""] = 1,\n}');
    const statement = file.statements[0];
    if (statement?.value.kind !== 'table') throw new Error('expected table');
    expect(statement.value.table.entries[0]?.key).toBe('it"s - "Realm"');
  });

  test('tolerates long-bracket strings and line comments', () => {
    const source = 'DB = {\n-- a comment\n["note"] = [[multi\nline]],\n}\n';
    const file = parseSavedVariables(source);
    expect(file.statements).toHaveLength(1);
  });

  test('throws on input outside the SavedVariables subset', () => {
    expect(() => parseSavedVariables('return 1 + 2')).toThrow('invalid SavedVariables Lua');
    expect(() => parseSavedVariables('DB = {\n["unterminated] = 1,\n}')).toThrow(
      'invalid SavedVariables Lua',
    );
  });
});

describe('scrubSavedVariables', () => {
  test('with a keep-everything predicate the output is byte-identical', () => {
    const source = [
      '',
      'DynamicCamDB = {',
      '["profileKeys"] = {',
      '["Zappydan - Illidan"] = "Default",',
      '},',
      '["cvars"] = {',
      '["cameraZoomSpeed"] = 20,',
      '},',
      '}',
      'minZoomValues = {',
      '}',
      '',
    ].join('\n');

    const result = scrubSavedVariables(source, () => false);
    expect(result.source).toBe(source);
    expect(result.droppedKeys).toEqual([]);
  });

  test('drops profileKeys while keeping the real settings byte-identical', () => {
    const source = [
      'DynamicCamDB = {',
      '["profileKeys"] = {',
      '["Zappydan - Illidan"] = "Default",',
      '},',
      '["profiles"] = {',
      '["Default"] = {',
      '["version"] = 5,',
      '},',
      '},',
      '}',
    ].join('\n');

    const result = scrubSavedVariables(source);
    expect(result.droppedKeys).toEqual(['DynamicCamDB.profileKeys']);
    expect(result.source).not.toContain('Zappydan');
    expect(result.source).not.toContain('profileKeys');
    expect(result.source).toBe(
      [
        'DynamicCamDB = {',
        '["profiles"] = {',
        '["Default"] = {',
        '["version"] = 5,',
        '},',
        '},',
        '}',
      ].join('\n'),
    );
    // The scrubbed file must still be valid SavedVariables Lua.
    expect(() => parseSavedVariables(result.source)).not.toThrow();
  });

  test('drops character-keyed entries nested inside other tables', () => {
    const source = [
      'ConsolePortShared = {',
      '["Zappydan (Restoration) Illidan"] = {',
      '["Meta"] = {',
      '["Name"] = "Zappydan",',
      '},',
      '},',
      '["Zappydan (Elemental) Illidan"] = {',
      '["Meta"] = {',
      '["Name"] = "Zappydan",',
      '},',
      '},',
      '}',
    ].join('\n');

    const result = scrubSavedVariables(source);
    expect(result.droppedKeys).toEqual([
      'ConsolePortShared.Zappydan (Restoration) Illidan',
      'ConsolePortShared.Zappydan (Elemental) Illidan',
    ]);
    expect(result.source).toBe('ConsolePortShared = {\n}');
    expect(result.source).not.toContain('Zappydan');
  });

  test('drops the last entry cleanly when it has no trailing comma', () => {
    const source = 'DB = {\n["keep"] = 1,\n["profileKeys"] = {\n["A - B"] = "Default",\n}\n}';
    const result = scrubSavedVariables(source);
    expect(result.source).toBe('DB = {\n["keep"] = 1,\n}');
    expect(() => parseSavedVariables(result.source)).not.toThrow();
  });

  test('handles compact single-line tables', () => {
    const source = 'DB = { ["keep"] = 1, ["profileKeys"] = { ["A - B"] = "x" }, ["also"] = 2 }';
    const result = scrubSavedVariables(source);
    expect(result.source).toContain('"keep"');
    expect(result.source).toContain('"also"');
    expect(result.source).not.toContain('profileKeys');
    expect(() => parseSavedVariables(result.source)).not.toThrow();
  });
});
