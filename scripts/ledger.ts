/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledgers' runner: `node scripts/ledger.ts <command> <ledger> …`.
 *
 * A landing is held to a rule: it fails under a mutation of each normative
 * clause of its row. A **ledger** is the list of those mutations, as data in
 * `scripts/ledgers/<name>.ts`: each entry an edit of the source and the arm it
 * must make fail. This applies one entry at a time, runs the arm, and restores
 * the file. It is run by hand, not by CI: a full run takes minutes to hours.
 *
 *     node scripts/ledger.ts plan  <ledger> [ids…]  — checks, counts, estimate; runs nothing
 *     node scripts/ledger.ts run   <ledger> [ids…] [--out file] [--resume file] [--workers n] [--nice n] [--limit s]
 *     node scripts/ledger.ts table <ledger> <results>  — the markdown table a PR quotes
 *     node scripts/ledger.ts clean                     — remove the copies runs that died left behind
 *
 * **A run never writes the tree it is started in.** It copies that tree
 * into a disposable git worktree:
 * - `HEAD`, with the uncommitted changes applied;
 * - the untracked files that are not ignored;
 * - `node_modules` linked package by package, with Vite's writable
 *   directories of its own;
 * - `.svelte-kit` generated afresh.
 *
 * Every mutation is applied, run and restored there, and the copy is removed
 * when the run ends. A run that dies leaves only that copy behind, which
 * `clean` removes once nothing runs in it. Two runs are two copies. A file the
 * copy cannot restore ends the run: the copy is discarded, and the user's tree
 * was never touched.
 *
 * **What a result is.** Each verdict is read from Vitest's JSON report, not
 * from its console, and from the one test each arm is:
 * - `killed`: every arm the entry requires ran and failed;
 * - `survived`: they all ran, and one passed;
 * - `error`: one never ran — its file failed to load, or the run was stopped
 *   at `--limit` (default 300 s).
 *
 * An error is not a kill. A mutation that breaks the build, or hangs it, tells
 * nothing about the clause the arm holds. An entry requires its `arm`, and any
 * `requires` beside it: one mutation a clause owes to two arms counts only
 * when both fail. A failure from a test or a hook that timed out is a kill
 * flagged `timedOut`, since a loaded machine can produce one.
 *
 * Before any entry runs, the selected arms must pass unmutated. Each must be
 * found as **exactly one test**, named by its file, its `describe` titles and
 * its own title, in a file that did not fail around it. Every later verdict is
 * read from that one test, found exactly once again. So another test whose
 * title starts the same way cannot answer for the arm, and an arm that fails
 * everywhere cannot read as killing everything.
 *
 * **Cost, chosen rather than defaulted.** One run is one Vitest process,
 * given only its arms by `-t`, under a supervisor that leads its process
 * group and stops it whole: at `--limit`, and when the runner dies, however it
 * dies (`ledger-supervisor.ts`). Entries whose edits are identical, one
 * mutation held against several arms, run once. `--workers` (default 1) and
 * `--nice` trade load against time. A ledger's `calibration` turns a plan into
 * an estimate, and a run reports how far it drifted from it.
 *
 * **A result file says which tree it is about.** It records:
 * - the revision;
 * - a fingerprint of the uncommitted changes, the untracked files copied
 *   (also listed), and the dependency tree npm recorded installing
 *   (`node_modules/.package-lock.json`);
 * - the ledger's hash, and the load chosen.
 *
 * `--resume` continues one only for the same tree and ledger. An edit made by
 * hand inside `node_modules` is not seen. `table` quotes a result file only
 * for its own ledger.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPERVISOR = join(ROOT, 'scripts/ledger-supervisor.ts');
/** The prefix of every copy this repository's runs make, and nothing else's. */
const COPIES = `nosvelte-ledger-${createHash('sha256').update(ROOT).digest('hex').slice(0, 12)}-run-`;
const RESULTS = join(ROOT, 'node_modules/.cache/nosvelte-ledger');
/** What Vite and Vitest write under `node_modules`: the copy's own, not linked. */
const WRITTEN = new Set(['.vite', '.vite-temp', '.cache']);

/** One edit of a source file: `from` must occur exactly once, and `to` is inserted as written. */
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
  /** Arms that must fail too, for the entry to count as killed. */
  readonly requires?: readonly string[];
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
/** Which test an arm is: its file, relative to the tree, and its titles, outermost first. */
interface Identity {
  readonly file: string;
  readonly titles: readonly string[];
}

/** Entries whose edits are identical: one mutation, run once, held against each arm. */
interface Group {
  readonly edits: readonly Edit[];
  readonly entries: readonly Entry[];
}

/** The work a failure leaves undone: the copy to discard, and the run to stop. */
const cleanups: (() => void)[] = [];
const fail = (message: string): never => {
  process.stderr.write(`ledger: ${message}\n`);
  process.exit(2);
};
process.on('exit', () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

/** A command that must succeed: its output, as bytes, or the run ends with what it said. */
function must(command: string, args: readonly string[], cwd: string, input?: Buffer): Buffer {
  const done = spawnSync(command, args, {
    cwd,
    input,
    encoding: 'buffer',
    maxBuffer: 1 << 30,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });
  if (done.status !== 0)
    fail(
      `${command} ${args.join(' ')} failed in ${cwd}: ${done.error?.message ?? done.stderr.toString().trim()}`
    );
  return done.stdout;
}
/** Git with no hooks: making and removing a copy runs nothing of the repository's. */
const gitBytes = (cwd: string, ...args: string[]): Buffer =>
  must('git', ['-c', `core.hooksPath=${tmpdir()}/nosvelte-ledger-no-hooks`, ...args], cwd);
const git = (cwd: string, ...args: string[]): string => gitBytes(cwd, ...args).toString('utf8');

const occurrences = (text: string, part: string): number => text.split(part).length - 1;
/** `to` as written: a function replacer, so `$&` and its kin are not read as patterns. */
const replaced = (text: string, edit: Edit): string => text.replace(edit.from, () => edit.to);
const armsOf = (entry: Entry): string[] => [entry.arm, ...(entry.requires ?? [])];
const firstLine = (text: string): string =>
  (stripVTControlCharacters(text).split('\n')[0] ?? '').trim();

async function load(name: string): Promise<{ ledger: Ledger; hash: string }> {
  const path = join(ROOT, 'scripts/ledgers', `${name}.ts`);
  if (!existsSync(path)) fail(`no ledger at ${path}`);
  const module = (await import(pathToFileURL(path).href)) as { default: Ledger };
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
  return { ledger: module.default, hash };
}

/**
 * The selected entries, checked against `tree` as it is: each id once, each id
 * asked for known, and each edit's `from` found exactly once — applied in
 * order, so a second edit of one file is read against the first's result.
 */
function select(ledger: Ledger, ids: readonly string[], tree: string): Entry[] {
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
      const text = contents.get(edit.file) ?? readFileSync(join(tree, edit.file), 'utf8');
      const found = occurrences(text, edit.from);
      if (found !== 1) faults.push(`${entry.id}: its edit of ${edit.file} is found ${found} times`);
      contents.set(edit.file, replaced(text, edit));
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

/** The tree a run is about, as it was when the run began. */
interface Snapshot {
  readonly revision: string;
  readonly patch: Buffer;
  readonly untracked: readonly string[];
  readonly fingerprint: string;
}

/**
 * The user's tree: its revision, its uncommitted changes, and its untracked
 * files that are not ignored — less `excluded`, the result file a run writes
 * — with a fingerprint of all of them and of the dependency tree npm
 * recorded installing.
 */
function snapshotOf(excluded: string | undefined): Snapshot {
  const revision = git(ROOT, 'rev-parse', 'HEAD').trim();
  const patch = gitBytes(ROOT, 'diff', 'HEAD', '--binary');
  const untracked = git(ROOT, 'ls-files', '--others', '--exclude-standard', '-z')
    .split('\0')
    .filter((file) => file !== '' && file !== excluded)
    .sort();
  const hash = createHash('sha256').update(revision).update('\0').update(patch);
  for (const file of untracked) {
    if (file.endsWith('/')) continue;
    const stat = lstatSync(join(ROOT, file));
    hash.update(`\0${file}\0${stat.mode}\0`);
    hash.update(
      stat.isSymbolicLink() ? readlinkSync(join(ROOT, file)) : readFileSync(join(ROOT, file))
    );
  }
  const installed = join(ROOT, 'node_modules/.package-lock.json');
  hash.update('\0').update(existsSync(installed) ? readFileSync(installed) : 'no installed tree');
  return { revision, patch, untracked, fingerprint: hash.digest('hex').slice(0, 16) };
}

/** A disposable copy of `snapshot`: its directory, and the tree inside it. */
interface Copy {
  readonly directory: string;
  readonly tree: string;
}

/**
 * The copy a run works in, made from `snapshot` and discarded when this process
 * ends. Refused if the user's tree moved while it was being copied.
 */
function copyOf(snapshot: Snapshot, excluded: string | undefined): Copy {
  const directory = mkdtempSync(join(tmpdir(), COPIES));
  writeFileSync(
    join(directory, 'owner.json'),
    JSON.stringify({ pid: process.pid, started: new Date().toISOString() })
  );
  const tree = join(directory, 'tree');
  const copy = { directory, tree };
  cleanups.push(() => discard(copy));
  mkdirSync(`${tmpdir()}/nosvelte-ledger-no-hooks`, { recursive: true });
  git(ROOT, 'worktree', 'add', '--detach', tree, snapshot.revision);
  if (snapshot.patch.length > 0)
    must('git', ['apply', '--binary', '--whitespace=nowarn'], tree, snapshot.patch);
  const nested: string[] = [];
  for (const file of snapshot.untracked) {
    // A nested repository, such as another worktree: not the tree's to copy.
    if (file.endsWith('/')) {
      nested.push(file);
      continue;
    }
    const from = join(ROOT, file);
    const to = join(tree, file);
    mkdirSync(dirname(to), { recursive: true });
    const stat = lstatSync(from);
    if (stat.isSymbolicLink()) symlinkSync(readlinkSync(from), to);
    else {
      copyFileSync(from, to);
      chmodSync(to, stat.mode);
    }
  }
  // The dependencies, linked one package at a time, so what Vite and Vitest
  // write under `node_modules` is the copy's own.
  mkdirSync(join(tree, 'node_modules'));
  for (const name of readdirSync(join(ROOT, 'node_modules')))
    if (!WRITTEN.has(name))
      symlinkSync(join(ROOT, 'node_modules', name), join(tree, 'node_modules', name));
  must(join(tree, 'node_modules/.bin/svelte-kit'), ['sync'], tree);
  // Copied once; if the tree moved meanwhile, the copy is not of one tree.
  if (snapshotOf(excluded).fingerprint !== snapshot.fingerprint)
    fail('the tree changed while it was being copied; run again');
  if (nested.length > 0)
    process.stdout.write(`  not copied, nested repositories: ${nested.join(', ')}\n`);
  return copy;
}

/** Remove a copy: its worktree's registration, then its directory. */
function discard(copy: Copy): void {
  spawnSync('git', ['worktree', 'remove', '--force', copy.tree], { cwd: ROOT, stdio: 'ignore' });
  rmSync(copy.directory, { recursive: true, force: true });
}

/**
 * Remove the copies runs left behind: each whose owner no longer runs. A copy
 * whose owner's number is alive is left, even if that process is another that
 * took the number since; it is reported, and costs only disk.
 */
function cleanCommand(): void {
  const parent = tmpdir();
  let removed = 0;
  for (const name of readdirSync(parent).filter((one) => one.startsWith(COPIES))) {
    const directory = join(parent, name);
    let pid = Number.NaN;
    try {
      pid = Number(
        (JSON.parse(readFileSync(join(directory, 'owner.json'), 'utf8')) as { pid?: unknown }).pid
      );
    } catch {
      // A copy whose owner was never written.
    }
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch {
      // Not running.
    }
    if (alive) {
      process.stdout.write(`left ${directory}: process ${pid} is running\n`);
      continue;
    }
    discard({ directory, tree: join(directory, 'tree') });
    removed += 1;
  }
  process.stdout.write(
    `removed ${removed} cop${removed === 1 ? 'y' : 'ies'}; \`git worktree prune\` forgets the registration of any whose directory was deleted by hand\n`
  );
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const filterOf = (arms: readonly string[]): string =>
  `\\b(?:${[...new Set(arms)].map(escape).join('|')}):`;

interface Options {
  readonly workers: number;
  readonly nice: number | undefined;
  /** Seconds a run may take before its group is stopped and recorded as an error. */
  readonly limit: number;
}

interface Report {
  readonly testResults?: readonly {
    readonly name: string;
    readonly status?: string;
    readonly message?: string;
    readonly assertionResults?: readonly {
      readonly ancestorTitles?: readonly string[];
      readonly title: string;
      readonly status: string;
      readonly failureMessages?: readonly string[];
    }[];
  }[];
}

/** The supervisor of the run in progress: its pipe closed, its group stops. */
let running: ChildProcess | undefined;

/**
 * One Vitest process over the ledger's files in `tree`, given only `arms`,
 * under a supervisor that leads its process group — and its JSON report, or
 * why there is none.
 */
function runVitest(
  tree: string,
  ledger: Ledger,
  arms: readonly string[],
  options: Options
): Promise<{ report: Report } | { error: string }> {
  if (arms.length === 0) fail('a run was asked for with no arms');
  const directory = mkdtempSync(join(tmpdir(), 'nosvelte-ledger-report-'));
  const report = join(directory, 'report.json');
  const vitest = [
    join(tree, 'node_modules/.bin/vitest'),
    'run',
    ...ledger.files,
    '-t',
    filterOf(arms),
    '--reporter=json',
    `--outputFile=${report}`,
    `--maxWorkers=${options.workers}`
  ];
  const command =
    options.nice === undefined ? vitest : ['nice', '-n', String(options.nice), ...vitest];
  return new Promise((done) => {
    let stopped = false;
    let finished = false;
    const finish = (outcome: { report: Report } | { error: string }): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      running = undefined;
      rmSync(directory, { recursive: true, force: true });
      done(outcome);
    };
    // **A run that never ends is stopped, not waited on**: a mutation can put
    // an arm in a loop no test timeout interrupts, since a synchronous loop
    // never yields to one. It is an error, not a kill — what the arm would
    // have said is unknown.
    const timer = setTimeout(() => {
      stopped = true;
      running?.stdin?.end();
    }, options.limit * 1000);
    const supervisor = spawn(process.execPath, [SUPERVISOR, ...command], {
      cwd: tree,
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore']
    });
    running = supervisor;
    supervisor.on('error', (error) => finish({ error: `the run did not start: ${error.message}` }));
    supervisor.on('close', () => {
      if (stopped) return finish({ error: `the run was stopped after ${options.limit} s` });
      try {
        finish({ report: JSON.parse(readFileSync(report, 'utf8')) as Report });
      } catch {
        finish({ error: 'Vitest wrote no report' });
      }
    });
  });
}

/** The tests in `report` named `arm`, each with where it is. */
function testsOf(report: Report, arm: string, tree: string) {
  return (report.testResults ?? []).flatMap((file) =>
    (file.assertionResults ?? [])
      .filter((one) => one.title.startsWith(`${arm}:`))
      .map((one) => ({
        identity: {
          file: relative(tree, file.name),
          titles: [...(one.ancestorTitles ?? []), one.title]
        },
        test: one,
        file
      }))
  );
}
const same = (a: Identity, b: Identity): boolean =>
  a.file === b.file && JSON.stringify(a.titles) === JSON.stringify(b.titles);

/**
 * Each arm's one test, unmutated, and that it passed — or why the baseline
 * cannot stand: an arm found as no test, as several, failing, or in a file
 * that failed around it (a hook after its tests, a load).
 */
function identitiesOf(
  report: Report,
  arms: readonly string[],
  tree: string
): Map<string, Identity> {
  const faults: string[] = [];
  for (const file of report.testResults ?? [])
    if (file.status === 'failed')
      faults.push(`${relative(tree, file.name)} failed: ${firstLine(file.message ?? '')}`);
  const found = new Map<string, Identity>();
  for (const arm of arms) {
    const tests = testsOf(report, arm, tree);
    const [one] = tests;
    if (tests.length !== 1 || one === undefined) {
      faults.push(`${arm} is ${tests.length} tests, not one`);
      continue;
    }
    if (one.test.status !== 'passed') faults.push(`${arm} ${one.test.status} unmutated`);
    found.set(arm, one.identity);
  }
  if (faults.length > 0) fail(`the baseline does not stand:\n  ${faults.join('\n  ')}`);
  return found;
}

function resultsOf(
  outcome: { report: Report } | { error: string },
  arms: readonly string[],
  identities: ReadonlyMap<string, Identity>,
  tree: string
): ArmResult[] {
  if ('error' in outcome)
    return arms.map((arm) => ({ arm, verdict: 'error', timedOut: false, message: outcome.error }));
  return arms.map((arm) => {
    const identity = identities.get(arm) as Identity;
    const matches = testsOf(outcome.report, arm, tree).filter((one) =>
      same(one.identity, identity)
    );
    const [match] = matches;
    if (matches.length > 1)
      return {
        arm,
        verdict: 'error',
        timedOut: false,
        message: `${arm} is ${matches.length} tests now`
      };
    if (match?.test.status === 'failed') {
      const messages = match.test.failureMessages ?? [];
      return {
        arm,
        verdict: 'killed',
        timedOut: messages.some((message) => /(?:Test|Hook) timed out/.test(message)),
        message: firstLine(messages[0] ?? '')
      };
    }
    if (match?.test.status === 'passed')
      return { arm, verdict: 'survived', timedOut: false, message: '' };
    const file = (outcome.report.testResults ?? []).find(
      (one) => relative(tree, one.name) === identity.file
    );
    return {
      arm,
      verdict: 'error',
      timedOut: false,
      message:
        file?.status === 'failed' && (file.assertionResults ?? []).length === 0
          ? `the file did not load: ${firstLine(file.message ?? '')}`
          : `the arm did not run (${match?.test.status ?? 'absent'})`
    };
  });
}

/** An entry's verdict from its arms': killed only when every arm it requires failed. */
function verdictOf(
  entry: Entry,
  results: readonly ArmResult[]
): { verdict: Verdict; timedOut: boolean; message: string; arms: ArmResult[] } {
  const arms = armsOf(entry).map((arm) => results.find((one) => one.arm === arm) as ArmResult);
  const timedOut = arms.some((one) => one.timedOut);
  const errored = arms.filter((one) => one.verdict === 'error');
  if (errored.length > 0)
    return {
      verdict: 'error',
      timedOut,
      message: errored.map((one) => `${one.arm}: ${one.message}`).join('; '),
      arms
    };
  const passed = arms.filter((one) => one.verdict === 'survived');
  if (passed.length > 0)
    return {
      verdict: 'survived',
      timedOut,
      message: `passed: ${passed.map((one) => one.arm).join(', ')}`,
      arms
    };
  return {
    verdict: 'killed',
    timedOut,
    message:
      arms.length === 1
        ? (arms[0] as ArmResult).message
        : arms.map((one) => `${one.arm}: ${one.message}`).join('; '),
    arms
  };
}

function optionsOf(flags: ReadonlyMap<string, string>): Options {
  const workers = Number(flags.get('workers') ?? '1');
  if (!Number.isInteger(workers) || workers < 1) fail('--workers takes a whole number from 1');
  const niceness = flags.get('nice');
  const nice = niceness === undefined ? undefined : Number(niceness);
  if (nice !== undefined && (!Number.isInteger(nice) || nice < 0 || nice > 20))
    fail('--nice takes 0 to 20');
  const limit = Number(flags.get('limit') ?? '300');
  if (!Number.isFinite(limit) || limit <= 0) fail('--limit takes seconds, above 0');
  return { workers, nice, limit };
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
  if (chosen.length === 0) return 0;
  return groupsOf(chosen).reduce(
    (sum, group) => sum + estimateOf(ledger, group.entries.flatMap(armsOf)),
    estimateOf(ledger, chosen.flatMap(armsOf))
  );
}

function planText(ledger: Ledger, chosen: readonly Entry[], options: Options): string {
  const groups = groupsOf(chosen);
  return [
    `${ledger.name}: ${ledger.subject}`,
    `  entries ${chosen.length} of ${ledger.entries.length}, retired ${ledger.retired?.length ?? 0}`,
    `  runs ${groups.length + 1}: ${groups.length} mutations and one baseline, each one Vitest process over ${ledger.files.join(', ')}, in a disposable copy of this tree`,
    `  arms ${[...new Set(chosen.flatMap(armsOf))].sort().join(', ')}`,
    `  load: ${options.workers} worker${options.workers === 1 ? '' : 's'}${options.nice === undefined ? '' : `, nice ${options.nice}`}, at most ${options.limit} s a run`,
    `  estimate about ${(estimate(ledger, chosen) / 60).toFixed(0)} min at one worker, from each arm's time alone (${ledger.calibration.measured})`
  ].join('\n');
}

interface Header {
  readonly kind: 'header';
  readonly ledger: string;
  readonly ledgerHash: string;
  readonly revision: string;
  readonly fingerprint: string;
  readonly untracked: readonly string[];
  readonly workers: number;
  readonly nice: number | null;
  readonly limit: number;
}

const readResults = (file: string): Record<string, unknown>[] =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

/** The result file's path inside the user's tree, if it is one a copy would carry. */
function excludedOf(out: string): string | undefined {
  const inside = relative(ROOT, resolve(out));
  if (inside.startsWith('..') || isAbsolute(inside)) return undefined;
  if (git(ROOT, 'ls-files', '--', inside).trim() !== '')
    fail(`${out} is a tracked file; write results elsewhere`);
  return inside;
}

async function runCommand(
  ledger: Ledger,
  hash: string,
  ids: readonly string[],
  flags: ReadonlyMap<string, string>
): Promise<void> {
  const resume = flags.get('resume');
  const out = resume ?? flags.get('out') ?? join(RESULTS, `${ledger.name}-${Date.now()}.jsonl`);
  const excluded = excludedOf(out);
  const snapshot = snapshotOf(excluded);
  const chosen = select(ledger, ids, ROOT);
  let options = optionsOf(flags);
  const done = new Set<string>();
  if (resume !== undefined) {
    const lines = readResults(resume);
    const header = lines[0] as Partial<Header> | undefined;
    if (
      header?.ledgerHash !== hash ||
      header.revision !== snapshot.revision ||
      header.fingerprint !== snapshot.fingerprint
    )
      fail(`${resume} was written for another ledger, revision or tree`);
    // The load it was begun under, so one result file is one arrangement.
    options = {
      workers: header.workers ?? 1,
      nice: header.nice ?? undefined,
      limit: header.limit ?? 300
    };
    for (const line of lines) if (line['kind'] === 'entry') done.add(line['id'] as string);
  } else {
    mkdirSync(dirname(out), { recursive: true });
    const header: Header = {
      kind: 'header',
      ledger: ledger.name,
      ledgerHash: hash,
      revision: snapshot.revision,
      fingerprint: snapshot.fingerprint,
      untracked: snapshot.untracked,
      workers: options.workers,
      nice: options.nice ?? null,
      limit: options.limit
    };
    writeFileSync(
      out,
      `${JSON.stringify({ ...header, started: new Date().toISOString(), node: process.version })}\n`
    );
  }
  const pending = chosen.filter((entry) => !done.has(entry.id));
  process.stdout.write(`${planText(ledger, pending, options)}\n  results ${out}\n`);
  if (pending.length === 0) {
    process.stdout.write('nothing left to run\n');
    return;
  }

  const copy = copyOf(snapshot, excluded);
  const interrupted = (signal: NodeJS.Signals): void => {
    // The pipe closed, the supervisor stops its group; the copy goes with
    // this process's exit.
    running?.stdin?.end();
    process.stderr.write(
      `ledger: stopped by ${signal}; the copy is discarded, and this tree was never written\n`
    );
    process.exit(130);
  };
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);

  const arms = [...new Set(pending.flatMap(armsOf))];
  const started = Date.now();
  const baseline = await runVitest(copy.tree, ledger, arms, options);
  if ('error' in baseline) fail(`the baseline did not run: ${baseline.error}`);
  const identities = identitiesOf((baseline as { report: Report }).report, arms, copy.tree);

  const counts = { killed: 0, survived: 0, error: 0, timedOut: 0 };
  for (const group of groupsOf(pending)) {
    const begun = Date.now();
    const groupArms = [...new Set(group.entries.flatMap(armsOf))];
    const originals = new Map<string, string>();
    for (const edit of group.edits)
      if (!originals.has(edit.file))
        originals.set(edit.file, readFileSync(join(copy.tree, edit.file), 'utf8'));
    let outcome: Awaited<ReturnType<typeof runVitest>>;
    try {
      const contents = new Map(originals);
      for (const edit of group.edits)
        contents.set(edit.file, replaced(contents.get(edit.file) as string, edit));
      for (const [file, text] of contents) writeFileSync(join(copy.tree, file), text);
      outcome = await runVitest(copy.tree, ledger, groupArms, options);
    } finally {
      for (const [file, text] of originals) {
        writeFileSync(join(copy.tree, file), text);
        if (readFileSync(join(copy.tree, file), 'utf8') !== text)
          fail(
            `${file} did not read back as restored in the copy; the run ends, and the copy is discarded`
          );
      }
    }
    const seconds = (Date.now() - begun) / 1000;
    const results = resultsOf(outcome, groupArms, identities, copy.tree);
    for (const entry of group.entries) {
      const result = verdictOf(entry, results);
      counts[result.verdict] += 1;
      if (result.timedOut) counts.timedOut += 1;
      appendFileSync(
        out,
        `${JSON.stringify({ kind: 'entry', id: entry.id, arm: entry.arm, ...result, seconds })}\n`
      );
      process.stdout.write(
        `${entry.id.padEnd(44)} ${result.verdict.toUpperCase()}${result.timedOut ? ' (timed out)' : ''}  ${result.message}\n`
      );
    }
  }
  const spent = (Date.now() - started) / 1000;
  const expected = estimate(ledger, pending);
  const summary = {
    kind: 'summary',
    ...counts,
    entries: pending.length,
    minutes: Number((spent / 60).toFixed(1)),
    estimatedMinutes: Number((expected / 60).toFixed(1))
  };
  appendFileSync(out, `${JSON.stringify(summary)}\n`);
  process.stdout.write(
    `killed ${counts.killed}, survived ${counts.survived}, errors ${counts.error} (timed out ${counts.timedOut}); ${summary.minutes} min against an estimate of ${summary.estimatedMinutes}\n`
  );
  const drift = spent / expected;
  if (drift > 4 / 3 || drift < 3 / 4)
    process.stdout.write(
      `note: the run took ${drift.toFixed(2)}× the calibration's estimate; recalibrate, or find what changed\n`
    );
  if (counts.survived + counts.error > 0) process.exitCode = 1;
}

function tableCommand(ledger: Ledger, hash: string, results: string): void {
  const lines = readResults(results);
  const header = lines[0] as Partial<Header> | undefined;
  if (header?.ledger !== ledger.name || header.ledgerHash !== hash)
    fail(`${results} was written for another ledger, or another version of this one`);
  const recorded = new Map<string, Record<string, unknown>>();
  for (const line of lines) if (line['kind'] === 'entry') recorded.set(line['id'] as string, line);
  const cell = (text: string): string => text.replace(/\|/g, '\\|');
  const quoted = (message: string): string =>
    message.replace(/^AssertionError: /, '').replace(/: expected[\s\S]*$/, '');
  const rows = ledger.entries.map((entry) => {
    const result = recorded.get(entry.id);
    let outcome: string;
    if (result === undefined) outcome = 'not run';
    else if (result['verdict'] !== 'killed') outcome = String(result['verdict']);
    else
      outcome = ((result['arms'] as ArmResult[] | undefined) ?? [])
        .map(
          (one) =>
            `${armsOf(entry).length > 1 ? `${one.arm}: ` : ''}${quoted(one.message)}${one.timedOut ? ' (timed out)' : ''}`
        )
        .join('; ');
    return `| ${cell(entry.describe ?? entry.id)} | \`${armsOf(entry).join('` and `')}\` | ${cell(outcome)} |`;
  });
  process.stdout.write(
    [
      `At ${String(header.revision).slice(0, 7)}, tree ${String(header.fingerprint)}:`,
      '',
      '| Mutation | Arm | Fails at |',
      '| --- | --- | --- |',
      ...rows
    ].join('\n') + '\n'
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
  if (command === 'clean') return cleanCommand();
  const [name, ...ids] = positional;
  if (command === undefined || name === undefined)
    fail('usage: node scripts/ledger.ts plan|run|table|clean <ledger> [ids…]');
  const { ledger, hash } = await load(name as string);
  if (command === 'plan') {
    const chosen = select(ledger, ids, ROOT);
    process.stdout.write(
      `${planText(ledger, chosen, optionsOf(flags))}\n  anchors hold for every selected entry\n`
    );
  } else if (command === 'run') await runCommand(ledger, hash, ids, flags);
  else if (command === 'table')
    tableCommand(ledger, hash, ids[0] ?? fail('table needs a results file'));
  else fail(`no command ${command}`);
}

await main();
