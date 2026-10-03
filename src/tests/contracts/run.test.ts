/**
 * The run-time half of rule 6: `checkRun`, which `npm test` applies to the
 * report `scripts/landing-reporter.ts` wrote for the run it just made, judged
 * here against fabricated reports and against real runs of the runner over
 * fabricated tests.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  checkRun,
  collectFrom,
  type Expected,
  expectedSupport,
  PRODUCTION_ROOT,
  supportingArms
} from './bridge.js';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('the run-time check of the landings', () => {
  it('CAT40: a landing counts only when this run reports it once, where it is declared, passed', () => {
    const expected: Expected[] = [
      { row: 'A1-C1', id: 'CT1', file: '/x/a.test.ts', line: 3, column: 1 }
    ];
    const test = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
      file: '/x/a.test.ts',
      name: 'CT1: y',
      line: 3,
      column: 1,
      state: 'passed',
      fails: false,
      ...overrides
    });
    const report = (startTime: number, tests: unknown[]): string =>
      JSON.stringify({ startTime, tests });
    const judge = (status: number | null, text: string | undefined): string[] =>
      checkRun({ status, report: text, startedAt: 100, expected });

    // The control: once, where it is declared, passed, not expecting failure.
    expect(judge(0, report(100, [test()]))).toEqual([]);
    // The run itself, and the report's presence, shape and provenance.
    expect(judge(1, report(100, []))).toEqual(['the runner exited with 1']);
    expect(judge(null, report(100, []))).toEqual(['the runner exited with null']);
    expect(judge(0, undefined)).toEqual(['the runner wrote no report']);
    expect(judge(0, '{"tests": [')).toEqual(['the report is not JSON']);
    expect(judge(0, '{}')).toEqual(['the report has no test results']);
    expect(judge(0, report(99, [test()]))).toEqual(['the report was not written by this run']);
    // Each landing: missing, twice, declared elsewhere, expecting failure, and
    // every state but passed.
    expect(judge(0, report(100, [test({ name: 'CT2: other' })]))).toEqual([
      'A1-C1: CT1 is not in the report — it was never collected'
    ]);
    expect(judge(0, report(100, [test(), test({ line: 9 })]))).toEqual([
      'A1-C1: CT1 is in the report 2 times'
    ]);
    for (const elsewhere of [{ file: '/x/b.test.ts' }, { line: 4 }, { column: 3 }])
      expect(judge(0, report(100, [test(elsewhere)]))).toEqual([
        'A1-C1: CT1 never ran at /x/a.test.ts:3:1; what ran under that id was declared elsewhere'
      ]);
    expect(judge(0, report(100, [test({ fails: true })]))).toEqual([
      'A1-C1: CT1 is registered to expect failure, so its passing means its body failed'
    ]);
    for (const state of ['skipped', 'pending', 'failed'])
      expect(judge(0, report(100, [test({ state })]))).toEqual([
        `A1-C1: CT1 is ${state}, not passed`
      ]);
  });

  it('CAT42: the contract arms a split-out row names are read strictly from its line and held like a landing', () => {
    const row = (id: string, text: string): string =>
      `| \`${id}\` | A1 | behavior | given | ${text} | E | P |`;
    const R = '(split out 2026-10-04 from `A1-C0` under the route rule)';
    // Read: a list, `and`, a range, two lists in one split; nothing read where
    // nothing was split out, however it is worded; and a split-out row that
    // names no arm, which is how a port closes one with `absent:`.
    const record = [
      row('A1-C1', `held ${R}: the arms that fail are, measured, \`XA1\`, \`XB2\` and \`XC3\``),
      row('A1-C2', `${R} measured, \`XA1\` and \`XN1\`–\`XN3\`. And measured, \`XD4\``),
      row('A1-C3', '(reopened) not split out, though measured, `XZ9` and measured: `XZ8`'),
      row('A1-C4', `${R} absent here, and nothing is named`),
      'measured, `XZ7` on a line that is not a row'
    ].join('\n');
    const { arms, faults } = supportingArms(record);
    expect([...arms]).toEqual([
      ['A1-C1', ['XA1', 'XB2', 'XC3']],
      ['A1-C2', ['XA1', 'XN1', 'XN2', 'XN3', 'XD4']]
    ]);
    expect(faults).toEqual([]);

    // Refused, each by name: every spelling a lenient reader dropped arms from
    // silently, and a range across prefixes.
    for (const [label, text] of [
      ['a hyphen range', `${R} measured, \`XN1\`-\`XN4\``],
      ['an em dash range', `${R} measured, \`XN1\`—\`XN4\``],
      ['a spaced en dash', `${R} measured, \`XN1\` – \`XN4\``],
      ['an or', `${R} measured, \`XA1\`, \`XB2\` or \`XC3\``],
      ['a parenthesis', `${R} measured, \`XA1\`, \`XB2\` (and \`XC3\`)`],
      ['a colon', `${R} the arms that fail are, measured: \`XA1\``],
      ['words before the list', `${R} measured, the engine arms \`XA1\` and \`XB2\``],
      ['two spaces', `${R} measured,  \`XA1\``],
      ['a bold id', `${R} measured, **\`XA1\`**`],
      ['an id after the list', `${R} measured, \`XA1\`, while \`XB2\` stays green`],
      ['a range across prefixes', `${R} measured, \`XA1\`–\`XB3\``]
    ] as const) {
      const read = supportingArms(row('A1-C9', text));
      expect(read.faults.length, label).toBeGreaterThan(0);
      for (const fault of read.faults) expect(fault, label).toMatch(/^A1-C9: /);
    }

    // Each named arm must be declared; one that is not is a fault, and one that
    // is becomes a landing the run has to show.
    const declared = {
      files: new Map([['XA1', 'a.test.ts']]),
      positions: new Map([['XA1', { line: 3, column: 1 }]])
    };
    const held = expectedSupport(new Map([['A1-C1', ['XA1', 'XB2']]]), declared, '/root');
    expect(held.expected).toEqual([
      { row: 'A1-C1 (internal half)', id: 'XA1', file: '/root/a.test.ts', line: 3, column: 1 }
    ]);
    expect(held.faults).toEqual(['A1-C1 (internal half): XB2 is declared nowhere under the root']);

    // And the record itself: read without a fault, every list read whole, and
    // every arm in it declared under the root.
    const real = supportingArms(
      readFileSync(join(REPO, 'docs/decisions/0005-contract-catalogue.md'), 'utf8')
    );
    expect(real.faults).toEqual([]);
    expect(Object.fromEntries(real.arms)).toEqual({
      'B-α-C24': ['SG32', 'TR2', 'TQ3', 'CG11', 'NA3', 'NA4', 'RI4', 'RI6'],
      'B-α-C25': ['CG12', 'CG4', 'TR7', 'NA1', 'NA2', 'NA3', 'NA4', 'RI6'],
      'B-α-C26': ['SG4', 'SG5', 'SG12', 'SG25', 'RG3', 'RG5'],
      'B-α-C27': ['SG26'],
      'B-α-C28': ['SG27', 'SG31']
    });
    const landed = expectedSupport(real.arms, collectFrom(join(REPO, PRODUCTION_ROOT)), REPO);
    expect(landed.faults).toEqual([]);
  });

  it('CAT41: real runs of the runner — skips, an empty table, the config, a filter, failure expected', () => {
    // Fixtures run under the runner itself, from a directory of their own with
    // a config of their own; `globals` spares them an import the directory
    // could not resolve. The realpath is what the runner reports a file as.
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'nosvelte-runs-')));
    try {
      const write = (name: string, lines: string[]): string => {
        const path = join(root, name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, lines.join('\n'));

        return path;
      };
      write('vitest.config.mjs', [
        "export default { test: { globals: true, include: ['**/*.test.ts'], exclude: ['excluded/**'] } };"
      ]);
      write('pass.test.ts', [
        "describe('plain', () => {",
        "  it('CT1: runs', () => { expect(1).toBe(1); });",
        "  it('CT5: runs as well', () => { expect(1).toBe(1); });",
        '});'
      ]);
      write('hook.test.ts', [
        "describe('x', () => {",
        '  beforeEach((ctx) => ctx.skip());',
        "  it('CT2: skipped by a hook', () => { expect(1).toBe(1); });",
        '});'
      ]);
      // Beside an ordinary test, as a landing would sit: a file whose only
      // suite is the empty table fails the run outright instead.
      write('table.test.ts', [
        "it('CT6: beside the table', () => { expect(1).toBe(1); });",
        "describe.each([])('x %s', () => {",
        "  it('CT3: in an empty table', () => { expect(1).toBe(1); });",
        '});'
      ]);
      write('excluded/out.test.ts', ["it('CT4: not collected', () => { expect(1).toBe(1); });"]);
      write('fails.test.ts', [
        "it('CT7: expects failure', { fails: true }, () => { expect(1).toBe(0); });"
      ]);
      // A local `it` that registers nothing, beside a real test under its id,
      // and a local `it` that registers a test expecting failure.
      write('local.test.ts', [
        'function it(_title: string, _fn: () => void): void {}',
        "it('CT8: never registered', () => { expect(1).toBe(0); });",
        "test('CT8: an unrelated test', () => { expect(1).toBe(1); });"
      ]);
      write('rebound.test.ts', [
        'const it = test.fails;',
        "it('CT9: through a rebound it', () => { expect(1).toBe(0); });"
      ]);

      // Where each arm is declared, as the static half reads it; the two the
      // static half refuses — a local `it` — are placed by hand.
      const declared = collectFrom(root);
      const at = (id: string, file: string, line?: number): Expected => {
        const position = declared.positions.get(id);

        return {
          row: `R-${id}`,
          id,
          file: join(root, file),
          line: line ?? position?.line ?? -1,
          column: position?.column ?? 1
        };
      };
      expect(declared.tests.has('CT8'), 'a local it is not the runner’s').toBe(false);
      expect(declared.tests.has('CT9'), 'a rebound it is not the runner’s').toBe(false);

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
            `--reporter=${join(REPO, 'scripts/landing-reporter.ts')}`,
            '--includeTaskLocation',
            ...extra
          ],
          { cwd: root, encoding: 'utf8', env: { ...process.env, NOSVELTE_RUN_REPORT: output } }
        );

        return { status: result.status, report: readFileSync(output, 'utf8'), startedAt };
      };

      const whole = run();
      // **The runner calls this a success**, which is why its own verdict is
      // not the check: every one of the faults below leaves it green.
      expect(whole.status).toBe(0);
      expect(
        checkRun({
          ...whole,
          expected: [
            at('CT1', 'pass.test.ts'),
            at('CT2', 'hook.test.ts'),
            at('CT3', 'table.test.ts'),
            at('CT4', 'excluded/out.test.ts'),
            at('CT7', 'fails.test.ts'),
            at('CT8', 'local.test.ts', 2),
            at('CT9', 'rebound.test.ts', 2)
          ]
        })
      ).toEqual([
        'R-CT2: CT2 is skipped, not passed',
        'R-CT3: CT3 is not in the report — it was never collected',
        'R-CT4: CT4 is not in the report — it was never collected',
        'R-CT7: CT7 is registered to expect failure, so its passing means its body failed',
        `R-CT8: CT8 never ran at ${join(root, 'local.test.ts')}:2:1; what ran under that id was declared elsewhere`,
        'R-CT9: CT9 is registered to expect failure, so its passing means its body failed'
      ]);

      // A filter that leaves a landing out, beside the one it keeps.
      const filtered = run('-t', 'CT1');
      expect(filtered.status).toBe(0);
      expect(
        checkRun({ ...filtered, expected: [at('CT1', 'pass.test.ts'), at('CT5', 'pass.test.ts')] })
      ).toEqual(['R-CT5: CT5 is skipped, not passed']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 60_000);
});
