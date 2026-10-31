/**
 * The one entrance to the test suite, locally and in CI: `npm test`.
 *
 * It runs Vitest with its usual reporter and `landing-reporter.ts`, whose JSON
 * report goes to a directory made for this run alone, then judges that report
 * with `checkRun`: every landing 0005's roster names must have run once, at
 * the place it is declared, not expecting failure, and passed. A failed run, a
 * missing or unreadable report, a report that is not this run's, and a landing
 * that is missing, duplicated, misplaced, skipped, pending or expecting
 * failure all fail the command. Arguments are passed through to Vitest, so a
 * filter that leaves a landing out fails it too — which is the point.
 *
 * Then the arms that say nothing is written run again with `NODE_ENV=production`,
 * judged the same way. Svelte's console is not the same in a build: `CW2` reads
 * the line only that build writes, so a run that is not one fails there.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  checkRun,
  collectFrom,
  expectedLandings,
  expectedSupport,
  PRODUCTION_ROOT,
  rosterOf,
  supportingArms
} from '../src/tests/contracts/bridge.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS = join(ROOT, PRODUCTION_ROOT);

const record = readFileSync(join(ROOT, 'docs/decisions/0005-contract-catalogue.md'), 'utf8');
const { roster, faults: rosterFaults } = rosterOf(record);
const declared = collectFrom(CONTRACTS);
const { expected: landings, faults: landingFaults } = expectedLandings(roster, declared, CONTRACTS);
// The contract arms a row's evidence names after its landing, held the way a
// landing is: declared under the root, run once, passed.
const { expected: support, faults: supportFaults } = expectedSupport(
  supportingArms(roster),
  declared,
  CONTRACTS
);
const expected = [...landings, ...support];

const UNDER_PRODUCTION = ['TH3', 'CW1', 'CW2'];
const underProduction = expected.filter(({ id }) => UNDER_PRODUCTION.includes(id));

const directory = mkdtempSync(join(tmpdir(), 'nosvelte-run-'));

/** One run of Vitest, judged against `arms`. */
const judged = (
  name: string,
  args: readonly string[],
  env: Record<string, string>,
  arms: typeof expected
): string[] => {
  const reportPath = join(directory, `${name}.json`);
  const startedAt = Date.now();
  const run = spawnSync(
    process.execPath,
    [
      join(ROOT, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--reporter=default',
      `--reporter=${join(ROOT, 'scripts/landing-reporter.ts')}`,
      '--includeTaskLocation',
      ...args
    ],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, ...env, NOSVELTE_RUN_REPORT: reportPath }
    }
  );
  return checkRun({
    status: run.status,
    report: existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : undefined,
    startedAt,
    expected: arms
  });
};

let faults: string[];
try {
  faults = [
    ...rosterFaults,
    ...landingFaults,
    ...supportFaults,
    ...judged('all', process.argv.slice(2), {}, expected)
  ];
  if (faults.length === 0) {
    faults = UNDER_PRODUCTION.filter((arm) => !underProduction.some(({ id }) => id === arm)).map(
      (arm) => `${arm} is to run under production, and is no landing or supporting arm`
    );
    faults.push(
      ...judged(
        'production',
        [
          ...new Set(underProduction.map(({ file }) => file)),
          '-t',
          UNDER_PRODUCTION.map((arm) => `${arm}:`).join('|')
        ],
        { NODE_ENV: 'production' },
        underProduction
      )
    );
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

if (faults.length > 0) {
  console.error(`\nThe contract landings did not all run and pass:\n  ${faults.join('\n  ')}`);
  process.exit(1);
}
console.log(
  `\n${landings.length} contract landings and ${support.length} supporting arms ran and passed, ` +
    `and ${underProduction.length} of them again under production.`
);
