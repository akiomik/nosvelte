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
  PRODUCTION_ROOT,
  rosterOf
} from '../src/tests/contracts/bridge.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACTS = join(ROOT, PRODUCTION_ROOT);

const { roster, faults: rosterFaults } = rosterOf(
  readFileSync(join(ROOT, 'docs/decisions/0005-contract-catalogue.md'), 'utf8')
);
const { expected, faults: landingFaults } = expectedLandings(
  roster,
  collectFrom(CONTRACTS),
  CONTRACTS
);

const directory = mkdtempSync(join(tmpdir(), 'nosvelte-run-'));
const reportPath = join(directory, 'report.json');
let faults: string[];
try {
  const startedAt = Date.now();
  const run = spawnSync(
    process.execPath,
    [
      join(ROOT, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--reporter=default',
      `--reporter=${join(ROOT, 'scripts/landing-reporter.ts')}`,
      '--includeTaskLocation',
      ...process.argv.slice(2)
    ],
    { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NOSVELTE_RUN_REPORT: reportPath } }
  );
  faults = [
    ...rosterFaults,
    ...landingFaults,
    ...checkRun({
      status: run.status,
      report: existsSync(reportPath) ? readFileSync(reportPath, 'utf8') : undefined,
      startedAt,
      expected
    })
  ];
} finally {
  rmSync(directory, { recursive: true, force: true });
}

if (faults.length > 0) {
  console.error(`\nThe contract landings did not all run and pass:\n  ${faults.join('\n  ')}`);
  process.exit(1);
}
console.log(`\n${expected.length} contract landings ran and passed.`);
