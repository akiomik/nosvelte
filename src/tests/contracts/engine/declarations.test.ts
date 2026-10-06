/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The compile probe's own behaviour, where no arm can see it: the files it
 * parses once while they are unchanged, the files it parses again, and the
 * files it lets go.
 */
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { consumerDiagnostics, HELD_FOR, probeParses, probeReader } from './helpers/declarations.js';

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
const ALONE = 'export const alone: number = 1;\n';
/** A full window of questions that import nothing: what is held after it is `ALONE`'s files alone. */
const settle = (): number => {
  for (let at = 0; at < HELD_FOR; at += 1) consumerDiagnostics(ALONE);
  return probeParses().held;
};

describe('the probe’s parsed files', () => {
  it('a second question parses no project file again, and holds no question', () => {
    consumerDiagnostics(ALONE);
    const first = probeParses();
    expect(first.held, 'the premise: the project’s files are held').toBeGreaterThan(100);
    consumerDiagnostics('export const other: string = "other";\n');
    expect(probeParses(), 'another question: nothing parsed, nothing more held').toEqual(first);
    // And for longer than the window: a file every question reads stays held.
    for (let at = 0; at < 2 * HELD_FOR; at += 1) consumerDiagnostics(ALONE);
    expect(probeParses(), 'two windows of questions later: still nothing parsed again').toEqual(
      first
    );
  });

  it('a file whose text changed is parsed again, under the very same timestamp', () => {
    const held = heldModule();
    try {
      writeFileSync(held.file, 'export type Held = number;\n');
      // A whole second, so the time is exactly what was set on any filesystem.
      const at = new Date(Math.floor(Date.now() / 1000) * 1000);
      utimesSync(held.file, at, at);
      const stamped = statSync(held.file, { bigint: true }).mtimeNs;
      expect(codesOf(held.asked), 'the premise: the file as first written').toEqual([]);
      writeFileSync(held.file, 'export type Held = string;\n');
      utimesSync(held.file, at, at);
      expect(
        statSync(held.file, { bigint: true }).mtimeNs,
        'the premise: the edit carries the first write’s timestamp, to the nanosecond'
      ).toBe(stamped);
      expect(codesOf(held.asked), 'the file as edited, parsed again').toEqual([2322]);
    } finally {
      held.done();
    }
  });

  it('a held file that can no longer be read is let go, and read again once it can', () => {
    const held = heldModule();
    const read = probeReader.read;
    try {
      writeFileSync(held.file, 'export type Held = number;\n');
      const without = settle();
      expect(codesOf(held.asked), 'the premise: the file read').toEqual([]);
      expect(probeParses().held, 'the premise: and held').toBe(without + 1);
      // A read that fails for every user, root included, which a file mode
      // does not give.
      probeReader.read = (name) => (name === held.file ? undefined : read(name));
      expect(codesOf(held.asked), 'unreadable, it is not found').toEqual([2307]);
      expect(probeParses().held, 'and no longer held').toBe(without);
      probeReader.read = read;
      expect(codesOf(held.asked), 'readable again, it is read').toEqual([]);
    } finally {
      probeReader.read = read;
      held.done();
    }
  });

  it('a file no recent question asked for is let go', () => {
    const held = heldModule();
    try {
      writeFileSync(held.file, 'export type Held = number;\n');
      const without = settle();
      expect(codesOf(held.asked), 'the premise: the file read').toEqual([]);
      expect(probeParses().held, 'the premise: and held').toBe(without + 1);
      for (let at = 1; at < HELD_FOR; at += 1) consumerDiagnostics(ALONE);
      expect(probeParses().held, 'held while a recent question read it').toBe(without + 1);
      consumerDiagnostics(ALONE);
      expect(probeParses().held, 'let go once none of the last questions did').toBe(without);
    } finally {
      held.done();
    }
  });
});
