/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The compile probe's own behaviour, where no arm can see it: the files it
 * parses once while they are unchanged, and the files it parses again.
 */
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { consumerDiagnostics, probeParses } from './helpers/declarations.js';

/** A module in a directory of its own, and a consumer's line that reads it. */
function heldModule(): { file: string; asked: string; done: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'probe-'));
  const file = join(directory, 'held.ts');
  // The specifier as a string literal, so a path with a quote in it stays one.
  const specifier = JSON.stringify(file.replace(/\\/g, '/').replace(/\.ts$/, '.js'));
  return {
    file,
    asked: `import type { Held } from ${specifier};\nexport const value: Held = 1;\n`,
    done: () => rmSync(directory, { recursive: true, force: true })
  };
}

const codesOf = (source: string): number[] => consumerDiagnostics(source).map((one) => one.code);

describe('the probe’s parsed files', () => {
  it('a second question parses no project file again, and the consumer’s every time', () => {
    const question = 'export const one: number = 1;\n';
    consumerDiagnostics(question);
    const first = probeParses();
    expect(first.files, 'the premise: the project’s files were parsed').toBeGreaterThan(100);
    consumerDiagnostics(question);
    expect(
      probeParses(),
      'the same question again: the project as parsed, the consumer anew'
    ).toEqual({
      files: first.files,
      consumers: first.consumers + 1
    });
  });

  it('a file whose text changed is parsed again, whatever its modification time says', () => {
    const held = heldModule();
    try {
      writeFileSync(held.file, 'export type Held = number;\n');
      expect(codesOf(held.asked), 'the premise: the file as first written').toEqual([]);
      const { atime, mtime } = statSync(held.file);
      writeFileSync(held.file, 'export type Held = string;\n');
      // The edit carries the old timestamps, so only the text tells it apart.
      utimesSync(held.file, atime, mtime);
      expect(statSync(held.file).mtimeMs, 'the premise: the time is the old one').toBe(
        mtime.getTime()
      );
      expect(codesOf(held.asked), 'the file as edited, parsed again').toEqual([2322]);
    } finally {
      held.done();
    }
  });

  it('a file that could not be read is not remembered', () => {
    const held = heldModule();
    try {
      writeFileSync(held.file, 'export type Held = number;\n');
      chmodSync(held.file, 0o000);
      expect(() => readFileSync(held.file), 'the premise: the file cannot be read').toThrow();
      expect(codesOf(held.asked), 'the premise: unreadable, it is not found').toEqual([2307]);
      chmodSync(held.file, 0o644);
      expect(codesOf(held.asked), 'readable again, it is read').toEqual([]);
    } finally {
      chmodSync(held.file, 0o644);
      held.done();
    }
  });
});
