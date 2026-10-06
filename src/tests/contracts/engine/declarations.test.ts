/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The compile probe's own behaviour, where no arm can see it: the files it
 * parses once a process, and the file it parses again.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { consumerDiagnostics, parsedFileCount } from './helpers/declarations.js';

describe('the probe’s parsed files', () => {
  it('a second question parses nothing the first did, and an edited file is parsed again', () => {
    consumerDiagnostics('export const one: number = 1;\n');
    const parsed = parsedFileCount();
    expect(parsed, 'the premise: the project’s files were parsed, and kept').toBeGreaterThan(100);
    consumerDiagnostics('export const two: string = "two";\n');
    expect(parsedFileCount(), 'a second program reads the files the first parsed').toBe(parsed);

    // **And a file edited while the process lives is parsed again**, so the
    // cache never answers for a source that is no longer on the disk.
    const directory = mkdtempSync(join(tmpdir(), 'probe-'));
    const held = join(directory, 'held.ts');
    try {
      writeFileSync(held, 'export type Held = number;\n');
      const asked = `import type { Held } from '${held.replace(/\.ts$/, '.js')}';\nexport const value: Held = 1;\n`;
      expect(
        consumerDiagnostics(asked).map((one) => one.code),
        'the premise: the file as first written'
      ).toEqual([]);
      writeFileSync(held, 'export type Held = string;\n');
      const later = new Date(Date.now() + 2000);
      utimesSync(held, later, later);
      expect(
        consumerDiagnostics(asked).map((one) => one.code),
        'the file as edited, parsed again'
      ).toEqual([2322]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
