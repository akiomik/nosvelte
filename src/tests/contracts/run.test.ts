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
  expectedLandings,
  expectedSupport,
  PRODUCTION_ROOT,
  rosterOf,
  supportingArms,
  testEvidence
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

  it('CAT42: the arms a row’s evidence names after its landing are held like a landing, and move with it', () => {
    // The grammar: a landing, and arms after it joined by `+`, read whole or
    // refused by name.
    expect(testEvidence('test:CT1')).toEqual({ landing: 'CT1', support: [] });
    expect(testEvidence('test:CT1+CT2+CT3b')).toEqual({ landing: 'CT1', support: ['CT2', 'CT3b'] });
    expect(testEvidence('absent:0002 A16 — no seam+none;returns when one exists')).toBeUndefined();
    expect(testEvidence('TBD')).toBeUndefined();
    for (const cell of [
      'test:CT1+',
      'test:CT1++CT2',
      'test:CT1 + CT2',
      'test:CT1,CT2',
      'test:CT1-CT3',
      'test:CT1–CT3',
      'test:CT1+CT2 and CT3',
      'test:'
    ])
      expect(testEvidence(cell), cell).toHaveProperty('fault');
    expect(testEvidence('test:CT1+CT2+CT1')).toEqual({ fault: 'test:CT1+CT2+CT1 names CT1 twice' });

    // From the roster through to what the run must show, on a fabricated
    // record: this implementation's evidence, and the two ways a port may
    // answer the same row instead — its own test, or the decision that the
    // seam does not exist. Nothing but the evidence cell changes between them.
    const recordWith = (evidence: string): string =>
      [
        '#### The port route of a row',
        '```text',
        `X1-C1      internal      ${evidence}`,
        '```'
      ].join('\n');
    const throughTheRun = (
      evidence: string,
      declared: readonly string[]
    ): { landings: string[]; support: string[]; faults: string[] } => {
      const { roster, faults } = rosterOf(recordWith(evidence));
      const files = new Map(declared.map((id) => [id, 'a.test.ts']));
      const positions = new Map(declared.map((id, at) => [id, { line: at + 1, column: 1 }]));
      const landings = expectedLandings(roster, { files, positions }, '/root');
      const support = expectedSupport(supportingArms(roster), { files, positions }, '/root');
      return {
        landings: landings.expected.map(({ id }) => id),
        support: support.expected.map(({ id }) => id),
        faults: [...faults, ...landings.faults, ...support.faults]
      };
    };
    // This implementation: the landing and its supporting arms, all held.
    expect(throughTheRun('test:SG31+SG27', ['SG31', 'SG27'])).toEqual({
      landings: ['SG31'],
      support: ['SG27'],
      faults: []
    });
    // A supporting arm that is not there is a fault, as a landing would be.
    expect(throughTheRun('test:SG31+SG27', ['SG31']).faults).toEqual([
      'X1-C1 (supporting): SG27 is declared nowhere under the root'
    ]);
    // A port with its own test: the supporting arms went with the evidence.
    expect(throughTheRun('test:ALT1', ['ALT1'])).toEqual({
      landings: ['ALT1'],
      support: [],
      faults: []
    });
    // A port without the seam: nothing to run, and nothing demanded.
    expect(
      throughTheRun('absent:0002 A16 — the port has no such seam;returns when one exists', [])
    ).toEqual({ landings: [], support: [], faults: [] });
    // And a cell that cannot be read whole is a fault, not a shorter list.
    expect(throughTheRun('test:SG31+SG27 SG26', ['SG31', 'SG27', 'SG26']).faults).toHaveLength(1);

    // The record itself: every supporting arm its roster names is declared.
    // Not a snapshot of which arms those are — a port moves them with the
    // evidence, and a fixed list here would refuse that.
    const real = rosterOf(
      readFileSync(join(REPO, 'docs/decisions/0005-contract-catalogue.md'), 'utf8')
    );
    expect(real.faults).toEqual([]);
    const declared = collectFrom(join(REPO, PRODUCTION_ROOT));
    expect(expectedSupport(supportingArms(real.roster), declared, REPO).faults).toEqual([]);
    expect(expectedLandings(real.roster, declared, REPO).faults).toEqual([]);
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
