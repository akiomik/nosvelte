/**
 * The run-time half of rule 6: `checkRun`, which `npm test` applies to the
 * report of the run it just made, judged here against fabricated reports and
 * against real runs of the runner over fabricated tests.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { checkRun, type Expected } from './bridge.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('the run-time check of the landings', () => {
  it('CAT40: a landing counts only when this run reports it once, in its file, passed', () => {
    const expected: Expected[] = [{ row: 'A1-C1', id: 'CT1', file: '/x/a.test.ts' }];
    const report = (startTime: number, results: unknown[]): string =>
      JSON.stringify({ startTime, success: true, testResults: results });
    const file = (name: string, ...assertions: Array<[string, string]>): unknown => ({
      name,
      assertionResults: assertions.map(([title, status]) => ({ title, status }))
    });
    const judge = (status: number | null, text: string | undefined): string[] =>
      checkRun({ status, report: text, startedAt: 100, expected });

    // The control: once, in its file, passed.
    expect(judge(0, report(100, [file('/x/a.test.ts', ['CT1: y', 'passed'])]))).toEqual([]);
    // The run itself, and the report's presence, shape and provenance.
    expect(judge(1, report(100, []))).toEqual(['the runner exited with 1']);
    expect(judge(null, report(100, []))).toEqual(['the runner exited with null']);
    expect(judge(0, undefined)).toEqual(['the runner wrote no report']);
    expect(judge(0, '{"testResults": [')).toEqual(['the report is not JSON']);
    expect(judge(0, '{}')).toEqual(['the report has no test results']);
    expect(judge(0, report(99, [file('/x/a.test.ts', ['CT1: y', 'passed'])]))).toEqual([
      'the report was not written by this run'
    ]);
    // Each landing: missing, twice, elsewhere, and every status but passed.
    expect(judge(0, report(100, [file('/x/a.test.ts', ['CT2: other', 'passed'])]))).toEqual([
      'A1-C1: CT1 is not in the report — it was never collected'
    ]);
    expect(
      judge(
        0,
        report(100, [
          file('/x/a.test.ts', ['CT1: y', 'passed']),
          file('/x/b.test.ts', ['CT1: z', 'passed'])
        ])
      )
    ).toEqual(['A1-C1: CT1 is in the report 2 times']);
    expect(judge(0, report(100, [file('/x/b.test.ts', ['CT1: y', 'passed'])]))).toEqual([
      'A1-C1: CT1 ran from /x/b.test.ts, not /x/a.test.ts'
    ]);
    for (const status of ['skipped', 'todo', 'pending', 'failed'])
      expect(judge(0, report(100, [file('/x/a.test.ts', ['CT1: y', status])]))).toEqual([
        `A1-C1: CT1 is ${status}, not passed`
      ]);
  });

  it('CAT41: real runs of the runner — a hook skip, an empty table, the config and a filter', () => {
    // Fixtures run under the runner itself, from a directory of their own with
    // a config of their own; `globals` spares them an import the directory
    // could not resolve. The realpath is what the runner reports a file as.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'nosvelte-runs-')));
    try {
      const write = (name: string, source: string): string => {
        const path = join(root, name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, source);

        return path;
      };
      write(
        'vitest.config.mjs',
        "export default { test: { globals: true, include: ['**/*.test.ts'], exclude: ['excluded/**'] } };"
      );
      const pass = write(
        'pass.test.ts',
        [
          "describe('plain', () => {",
          "  it('CT1: runs', () => { expect(1).toBe(1); });",
          "  it('CT5: runs as well', () => { expect(1).toBe(1); });",
          '});'
        ].join('\n')
      );
      const hook = write(
        'hook.test.ts',
        [
          "describe('x', () => {",
          '  beforeEach((ctx) => ctx.skip());',
          "  it('CT2: skipped by a hook', () => { expect(1).toBe(1); });",
          '});'
        ].join('\n')
      );
      const table = write(
        'table.test.ts',
        [
          // Beside an ordinary test, as a landing would sit: a file whose only
          // suite is the empty table fails the run outright instead.
          "it('CT6: beside the table', () => { expect(1).toBe(1); });",
          "describe.each([])('x %s', () => {",
          "  it('CT3: in an empty table', () => { expect(1).toBe(1); });",
          '});'
        ].join('\n')
      );
      const excluded = write(
        'excluded/out.test.ts',
        "it('CT4: not collected', () => { expect(1).toBe(1); });"
      );
      const run = (
        ...extra: string[]
      ): { status: number | null; report: string; startedAt: number } => {
        const output = join(root, 'report.json');
        rmSync(output, { force: true });
        const startedAt = Date.now();
        const result = spawnSync(
          process.execPath,
          [
            join(REPO, 'node_modules/vitest/vitest.mjs'),
            'run',
            '--root',
            root,
            '--config',
            join(root, 'vitest.config.mjs'),
            '--reporter=json',
            `--outputFile.json=${output}`,
            ...extra
          ],
          { cwd: root, encoding: 'utf8' }
        );

        return { status: result.status, report: readFileSync(output, 'utf8'), startedAt };
      };
      const landing = (id: string, file: string): Expected => ({ row: `R-${id}`, id, file });

      const whole = run();
      // **The runner calls this a success**, which is why its own verdict is
      // not the check: a skipped test and a test never collected both leave
      // it green.
      expect(whole.status).toBe(0);
      expect((JSON.parse(whole.report) as { success: boolean }).success).toBe(true);
      expect(
        checkRun({
          ...whole,
          expected: [
            landing('CT1', pass),
            landing('CT2', hook),
            landing('CT3', table),
            landing('CT4', excluded)
          ]
        })
      ).toEqual([
        'R-CT2: CT2 is skipped, not passed',
        'R-CT3: CT3 is not in the report — it was never collected',
        'R-CT4: CT4 is not in the report — it was never collected'
      ]);

      // A filter that leaves a landing out, beside the one it keeps.
      const filtered = run('-t', 'CT1');
      expect(filtered.status).toBe(0);
      expect(
        checkRun({ ...filtered, expected: [landing('CT1', pass), landing('CT5', pass)] })
      ).toEqual(['R-CT5: CT5 is skipped, not passed']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
