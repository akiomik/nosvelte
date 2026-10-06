/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledgers' runner: `node scripts/ledger.ts <command> <ledger> …`.
 *
 * A landing is held to a rule: it fails under a mutation of each normative
 * clause of its row. A **ledger** is the list of those mutations, as data in
 * `scripts/ledgers/<name>.ts`. Each entry is an edit of the source and the arm
 * it must make fail. This applies one entry at a time, runs the arm, and
 * restores the file. It is run by hand, not by CI, because a full run takes
 * minutes to hours. A run edits the working tree, so it never runs two
 * entries at once.
 *
 *     node scripts/ledger.ts plan  <ledger> [ids…]  — checks, counts, estimate; runs nothing
 *     node scripts/ledger.ts run   <ledger> [ids…] [--out file] [--resume file] [--workers n] [--nice n]
 *     node scripts/ledger.ts table <ledger> <results>  — the markdown table a PR quotes
 *     node scripts/ledger.ts restore                   — undo what an interrupted run left applied
 *
 * **What a result is.** Each entry's verdict is read from Vitest's JSON
 * report, not from its console:
 * - `killed`: the entry's arm ran and failed;
 * - `survived`: the arm ran and passed;
 * - `error`: the arm never ran, because its file failed to load or the
 *   filter matched nothing. An error is not a kill. A mutation that breaks the
 *   build tells nothing about the clause the arm holds.
 *
 * A failure from a timed-out test is a kill flagged `timedOut`, since a loaded
 * machine can produce one. The arms of the selected entries must all pass
 * unmutated before any entry runs: an arm that fails everywhere would read as
 * killing everything.
 *
 * **Cost, chosen rather than defaulted.** One run of an arm is one Vitest
 * process, given only the arm by `-t`. Entries whose edits are identical, the
 * same mutation held against several arms, run once, with every one of their
 * arms. `--workers` (default 1) and `--nice` trade load against time; a
 * ledger's `calibration` turns a plan into an estimate, and a run reports how
 * far it drifted from it.
 *
 * **Restoring is the runner's first duty.** Before an entry's edits are
 * applied, the files' contents are written to a marker in the system's
 * temporary directory. They are restored, and read back, after the run,
 * however the run ends — on SIGINT and SIGTERM too, which is why the arm runs
 * in a child process the runner awaits rather than blocks on. A run that was
 * killed outright leaves the marker, and the next start refuses until
 * `restore` puts the files back.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VITEST = join(ROOT, 'node_modules/.bin/vitest');
const MARKER = join(
  tmpdir(),
  `nosvelte-ledger-${createHash('sha256').update(ROOT).digest('hex').slice(0, 12)}.json`
);
const RESULTS = join(ROOT, 'node_modules/.cache/nosvelte-ledger');

/** One edit of a source file: `from` must occur exactly once. */
export interface Edit {
  readonly file: string;
  readonly from: string;
  readonly to: string;
}

/** One mutation, and the arm it must make fail. */
export interface Entry {
  readonly id: string;
  /** The arm's id, as its test's title begins: `OE14` for `'OE14: …'`. */
  readonly arm: string;
  readonly edits: readonly Edit[];
  /** What the mutation breaks, in a reviewer's words; the table's first column. */
  readonly describe?: string;
}

/** A mutation kept on record and not run, with the reason it cannot fail its arm. */
export interface Retired extends Entry {
  readonly reason: string;
}

export interface Ledger {
  readonly name: string;
  /** What the ledger is the evidence of: the rows and their landings. */
  readonly subject: string;
  /** The test files the arms are declared in. */
  readonly files: readonly string[];
  /**
   * Seconds one run of each arm alone took, process start included, and where
   * it was measured: the plan's estimate, never a check. Arms differ by an
   * order of magnitude, so the estimate is per arm. A run reports how far it
   * drifted from it.
   */
  readonly calibration: {
    readonly measured: string;
    readonly seconds: Readonly<Record<string, number>>;
  };
  readonly entries: readonly Entry[];
  readonly retired?: readonly Retired[];
}

type Verdict = 'killed' | 'survived' | 'error';
interface ArmResult {
  readonly arm: string;
  readonly verdict: Verdict;
  readonly timedOut: boolean;
  readonly message: string;
}

/** Entries whose edits are identical: one mutation, run once, held against each arm. */
interface Group {
  readonly edits: readonly Edit[];
  readonly entries: readonly Entry[];
}

const fail = (message: string): never => {
  process.stderr.write(`ledger: ${message}\n`);
  process.exit(2);
};

const occurrences = (text: string, part: string): number => text.split(part).length - 1;

async function load(name: string): Promise<{ ledger: Ledger; hash: string }> {
  const path = join(ROOT, 'scripts/ledgers', `${name}.ts`);
  if (!existsSync(path)) fail(`no ledger at ${path}`);
  const module = (await import(pathToFileURL(path).href)) as { default: Ledger };
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
  return { ledger: module.default, hash };
}

/**
 * The selected entries, checked against the tree as it is: each id once, each
 * id asked for known, and each edit's `from` found exactly once — applied in
 * order, so a second edit of one file is read against the first's result.
 */
function select(ledger: Ledger, ids: readonly string[]): Entry[] {
  const seen = new Set<string>();
  for (const entry of [...ledger.entries, ...(ledger.retired ?? [])]) {
    if (seen.has(entry.id)) fail(`${entry.id} is in ${ledger.name} twice`);
    seen.add(entry.id);
  }
  for (const id of ids)
    if (!ledger.entries.some((entry) => entry.id === id))
      fail(`${id} is not an entry of ${ledger.name}`);
  const chosen =
    ids.length === 0
      ? [...ledger.entries]
      : ledger.entries.filter((entry) => ids.includes(entry.id));
  const faults: string[] = [];
  for (const entry of chosen) {
    const contents = new Map<string, string>();
    for (const edit of entry.edits) {
      const text = contents.get(edit.file) ?? readFileSync(join(ROOT, edit.file), 'utf8');
      const found = occurrences(text, edit.from);
      if (found !== 1) faults.push(`${entry.id}: its edit of ${edit.file} is found ${found} times`);
      contents.set(edit.file, text.replace(edit.from, edit.to));
    }
  }
  if (faults.length > 0) fail(`anchors that do not hold:\n  ${faults.join('\n  ')}`);
  return chosen;
}

function groupsOf(entries: readonly Entry[]): Group[] {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = JSON.stringify(entry.edits);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()].map((members) => ({
    edits: (members[0] as Entry).edits,
    entries: members
  }));
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const filterOf = (arms: readonly string[]): string =>
  `\\b(?:${[...new Set(arms)].map(escape).join('|')}):`;

/** The arm's process, while one runs: stopped with the runner. */
let running: ReturnType<typeof spawn> | undefined;

interface Options {
  readonly workers: number;
  readonly nice: number | undefined;
}

/**
 * One Vitest process over the ledger's files, given only `arms`, and each
 * arm's result read from its JSON report.
 */
function runArms(ledger: Ledger, arms: readonly string[], options: Options): Promise<ArmResult[]> {
  const directory = mkdtempSync(join(tmpdir(), 'nosvelte-ledger-report-'));
  const report = join(directory, 'report.json');
  const args = [
    'run',
    ...ledger.files,
    '-t',
    filterOf(arms),
    '--reporter=json',
    `--outputFile=${report}`,
    `--maxWorkers=${options.workers}`
  ];
  const [command, ...rest] =
    options.nice === undefined
      ? [VITEST, ...args]
      : ['nice', '-n', String(options.nice), VITEST, ...args];
  return new Promise((done) => {
    const child = spawn(command as string, rest, { cwd: ROOT, stdio: 'ignore' });
    running = child;
    child.on('close', () => {
      running = undefined;
      done(resultsOf(report, arms));
      rmSync(directory, { recursive: true, force: true });
    });
  });
}

interface Report {
  readonly testResults?: readonly {
    readonly status?: string;
    readonly message?: string;
    readonly assertionResults?: readonly {
      readonly title: string;
      readonly status: string;
      readonly failureMessages?: readonly string[];
    }[];
  }[];
}

const firstLine = (text: string): string =>
  (text.replace(/\u001b\[[0-9;]*m/g, '').split('\n')[0] ?? '').trim();

function resultsOf(report: string, arms: readonly string[]): ArmResult[] {
  let parsed: Report;
  try {
    parsed = JSON.parse(readFileSync(report, 'utf8')) as Report;
  } catch {
    return arms.map((arm) => ({
      arm,
      verdict: 'error',
      timedOut: false,
      message: 'Vitest wrote no report'
    }));
  }
  const files = parsed.testResults ?? [];
  const asserted = files.flatMap((file) => file.assertionResults ?? []);
  const loadFailure = files.find(
    (file) => file.status === 'failed' && (file.assertionResults ?? []).length === 0
  );
  return arms.map((arm) => {
    const ran = asserted.filter((one) => one.title.startsWith(`${arm}:`));
    const failed = ran.find((one) => one.status === 'failed');
    if (failed !== undefined) {
      const messages = failed.failureMessages ?? [];
      return {
        arm,
        verdict: 'killed',
        timedOut: messages.some((message) => message.includes('Test timed out')),
        message: firstLine(messages[0] ?? '')
      };
    }
    if (ran.some((one) => one.status === 'passed'))
      return { arm, verdict: 'survived', timedOut: false, message: '' };
    return {
      arm,
      verdict: 'error',
      timedOut: false,
      message:
        loadFailure !== undefined
          ? `the file did not load: ${firstLine(loadFailure.message ?? '')}`
          : 'the arm did not run'
    };
  });
}

/** The files `edits` touch, as they are now, written to the marker before any edit lands. */
function apply(edits: readonly Edit[]): Map<string, string> {
  const originals = new Map<string, string>();
  for (const edit of edits)
    if (!originals.has(edit.file))
      originals.set(edit.file, readFileSync(join(ROOT, edit.file), 'utf8'));
  writeFileSync(MARKER, JSON.stringify({ root: ROOT, files: Object.fromEntries(originals) }));
  const contents = new Map(originals);
  for (const edit of edits)
    contents.set(edit.file, (contents.get(edit.file) as string).replace(edit.from, edit.to));
  for (const [file, text] of contents) writeFileSync(join(ROOT, file), text);
  return originals;
}

/** Put each file back, read it back, and only then drop the marker. */
function restoreFrom(originals: ReadonlyMap<string, string>): void {
  for (const [file, text] of originals) {
    writeFileSync(join(ROOT, file), text);
    if (readFileSync(join(ROOT, file), 'utf8') !== text)
      fail(`${file} did not read back as restored; the marker ${MARKER} keeps it`);
  }
  rmSync(MARKER, { force: true });
}

function restoreCommand(): void {
  if (!existsSync(MARKER)) {
    process.stdout.write('nothing to restore\n');
    return;
  }
  const marked = JSON.parse(readFileSync(MARKER, 'utf8')) as {
    root: string;
    files: Record<string, string>;
  };
  if (marked.root !== ROOT) fail(`the marker is for ${marked.root}`);
  restoreFrom(new Map(Object.entries(marked.files)));
  process.stdout.write(`restored ${Object.keys(marked.files).join(', ')}\n`);
}

const git = (...args: string[]): string =>
  spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

function optionsOf(flags: Map<string, string>): Options {
  const workers = Number(flags.get('workers') ?? '1');
  if (!Number.isInteger(workers) || workers < 1) fail('--workers takes a whole number from 1');
  const niceness = flags.get('nice');
  const nice = niceness === undefined ? undefined : Number(niceness);
  if (nice !== undefined && (!Number.isInteger(nice) || nice < 0 || nice > 20))
    fail('--nice takes 0 to 20');
  return { workers, nice };
}

/** Seconds the calibration expects one run of `arms` to take: an upper bound, start-up counted once per arm. */
function estimateOf(ledger: Ledger, arms: readonly string[]): number {
  return [...new Set(arms)].reduce((sum, arm) => {
    const seconds = ledger.calibration.seconds[arm];
    return seconds === undefined
      ? fail(`${ledger.name}'s calibration has no ${arm}`)
      : sum + seconds;
  }, 0);
}

/** Seconds a run of `chosen` is expected to take: the baseline, then each mutation. */
function estimate(ledger: Ledger, chosen: readonly Entry[]): number {
  return groupsOf(chosen).reduce(
    (sum, group) =>
      sum +
      estimateOf(
        ledger,
        group.entries.map((entry) => entry.arm)
      ),
    estimateOf(
      ledger,
      chosen.map((entry) => entry.arm)
    )
  );
}

function planText(ledger: Ledger, chosen: readonly Entry[], options: Options): string {
  const groups = groupsOf(chosen);
  const runs = groups.length + 1;
  const minutes = estimate(ledger, chosen) / 60;
  return [
    `${ledger.name}: ${ledger.subject}`,
    `  entries ${chosen.length} of ${ledger.entries.length}, retired ${ledger.retired?.length ?? 0}`,
    `  runs ${runs}: ${groups.length} mutations and one baseline, each one Vitest process over ${ledger.files.join(', ')}`,
    `  arms ${[...new Set(chosen.map((entry) => entry.arm))].sort().join(', ')}`,
    `  load: ${options.workers} worker${options.workers === 1 ? '' : 's'}${options.nice === undefined ? '' : `, nice ${options.nice}`}`,
    `  estimate about ${minutes.toFixed(0)} min at one worker, from each arm's time alone (${ledger.calibration.measured})`
  ].join('\n');
}

async function runCommand(
  ledger: Ledger,
  hash: string,
  chosen: readonly Entry[],
  flags: Map<string, string>
): Promise<void> {
  if (existsSync(MARKER))
    fail(
      `a previous run left files mutated (${MARKER}); run \`node scripts/ledger.ts restore\` first`
    );
  const options = optionsOf(flags);
  const revision = git('rev-parse', 'HEAD');
  const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
  const resume = flags.get('resume');
  const out =
    resume ??
    flags.get('out') ??
    join(RESULTS, `${ledger.name}-${revision.slice(0, 7)}-${Date.now()}.jsonl`);
  const done = new Set<string>();
  if (resume !== undefined) {
    const lines = readFileSync(resume, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const header = lines[0];
    if (header?.['ledgerHash'] !== hash || header['revision'] !== revision)
      fail(`${resume} was written for another ledger or revision`);
    for (const line of lines) if (line['kind'] === 'entry') done.add(line['id'] as string);
  } else {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(
      out,
      `${JSON.stringify({ kind: 'header', ledger: ledger.name, ledgerHash: hash, revision, dirty, workers: options.workers, nice: options.nice ?? null, node: process.version, started: new Date().toISOString() })}\n`
    );
  }
  const pending = chosen.filter((entry) => !done.has(entry.id));
  process.stdout.write(`${planText(ledger, pending, options)}\n  results ${out}\n`);

  let originals: Map<string, string> | undefined;
  const interrupted = (signal: NodeJS.Signals): void => {
    running?.kill('SIGTERM');
    if (originals !== undefined) restoreFrom(originals);
    process.stderr.write(`ledger: stopped by ${signal}; the tree is restored\n`);
    process.exit(130);
  };
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);

  const arms = [...new Set(pending.map((entry) => entry.arm))];
  const started = Date.now();
  const baseline = await runArms(ledger, arms, options);
  const red = baseline.filter((one) => one.verdict !== 'survived');
  if (red.length > 0)
    fail(
      `the arms must pass unmutated first:\n  ${red.map((one) => `${one.arm}: ${one.verdict} ${one.message}`).join('\n  ')}`
    );
  const perRun: number[] = [(Date.now() - started) / 1000];

  const counts = { killed: 0, survived: 0, error: 0, timedOut: 0 };
  for (const group of groupsOf(pending)) {
    const begun = Date.now();
    originals = apply(group.edits);
    let results: ArmResult[];
    try {
      results = await runArms(
        ledger,
        group.entries.map((entry) => entry.arm),
        options
      );
    } finally {
      restoreFrom(originals);
      originals = undefined;
    }
    const seconds = (Date.now() - begun) / 1000;
    perRun.push(seconds);
    for (const entry of group.entries) {
      const result = results.find((one) => one.arm === entry.arm) as ArmResult;
      counts[result.verdict] += 1;
      if (result.timedOut) counts.timedOut += 1;
      appendFileSync(
        out,
        `${JSON.stringify({ kind: 'entry', id: entry.id, ...result, seconds })}\n`
      );
      process.stdout.write(
        `${entry.id.padEnd(44)} ${result.verdict.toUpperCase()}${result.timedOut ? ' (timed out)' : ''}  ${result.message}\n`
      );
    }
  }
  const spent = (Date.now() - started) / 1000;
  const expected = estimate(ledger, pending);
  const drift = spent / expected;
  const summary = {
    kind: 'summary',
    ...counts,
    entries: pending.length,
    runs: perRun.length,
    minutes: Number((spent / 60).toFixed(1)),
    estimatedMinutes: Number((expected / 60).toFixed(1))
  };
  appendFileSync(out, `${JSON.stringify(summary)}\n`);
  process.stdout.write(
    `killed ${counts.killed}, survived ${counts.survived}, errors ${counts.error} (timed out ${counts.timedOut}); ${summary.minutes} min against an estimate of ${summary.estimatedMinutes}\n`
  );
  if (drift > 4 / 3 || drift < 3 / 4)
    process.stdout.write(
      `note: the run took ${drift.toFixed(2)}× the calibration's estimate; recalibrate, or find what changed\n`
    );
  if (counts.survived + counts.error > 0) process.exitCode = 1;
}

function tableCommand(ledger: Ledger, results: string): void {
  const recorded = new Map<string, Record<string, unknown>>();
  for (const line of readFileSync(results, 'utf8').trim().split('\n')) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed['kind'] === 'entry') recorded.set(parsed['id'] as string, parsed);
  }
  const cell = (text: string): string => text.replace(/\|/g, '\\|');
  const rows = ledger.entries.map((entry) => {
    const result = recorded.get(entry.id);
    const outcome =
      result === undefined
        ? 'not run'
        : result['verdict'] === 'killed'
          ? String(result['message']).replace(/: expected[\s\S]*$/, '')
          : String(result['verdict']);
    return `| ${cell(entry.describe ?? entry.id)} | \`${entry.arm}\` | ${cell(outcome)} |`;
  });
  process.stdout.write(
    ['| Mutation | Arm | Fails at |', '| --- | --- | --- |', ...rows].join('\n') + '\n'
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let at = 0; at < rest.length; at += 1) {
    const arg = rest[at] as string;
    if (arg.startsWith('--')) {
      flags.set(arg.slice(2), rest[at + 1] ?? fail(`${arg} needs a value`));
      at += 1;
    } else positional.push(arg);
  }
  if (command === 'restore') return restoreCommand();
  const [name, ...ids] = positional;
  if (command === undefined || name === undefined)
    fail('usage: node scripts/ledger.ts plan|run|table|restore <ledger> [ids…]');
  const { ledger, hash } = await load(name as string);
  if (command === 'plan') {
    const chosen = select(ledger, ids);
    process.stdout.write(
      `${planText(ledger, chosen, optionsOf(flags))}\n  anchors hold for every selected entry\n`
    );
  } else if (command === 'run') await runCommand(ledger, hash, select(ledger, ids), flags);
  else if (command === 'table') tableCommand(ledger, ids[0] ?? fail('table needs a results file'));
  else fail(`no command ${command}`);
}

await main();
