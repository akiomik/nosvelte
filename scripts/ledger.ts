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
 * the file. It is run by hand, not by CI — a full run takes minutes to hours —
 * and it edits the working tree, so one run holds the tree at a time.
 *
 *     node scripts/ledger.ts plan  <ledger> [ids…]  — checks, counts, estimate; runs nothing
 *     node scripts/ledger.ts run   <ledger> [ids…] [--out file] [--resume file] [--workers n] [--nice n] [--limit s]
 *     node scripts/ledger.ts table <ledger> <results>  — the markdown table a PR quotes
 *     node scripts/ledger.ts restore                   — undo what an interrupted run left applied
 *
 * **What a result is.** Each verdict is read from Vitest's JSON report, not
 * from its console, and from the one test each arm is:
 * - `killed`: every arm the entry requires ran and failed;
 * - `survived`: they all ran, and one passed;
 * - `error`: one never ran — its file failed to load, or the run was stopped
 *   at `--limit` (default 300 s). An error is not a kill. A mutation that
 *   breaks the build, or hangs it, tells nothing about the clause the arm
 *   holds.
 *
 * An entry requires its `arm`, and any `requires` beside it: one mutation a
 * clause owes to two arms counts only when both fail. A failure from a test or
 * a hook that timed out is a kill flagged `timedOut`, since a loaded machine
 * can produce one. Before any entry runs, the selected arms must pass
 * unmutated, each found as **exactly one test**, which fixes the file and the
 * full title every later verdict is read from — so another test whose title
 * starts the same way cannot answer for the arm, and an arm that fails
 * everywhere cannot read as killing everything.
 *
 * **Cost, chosen rather than defaulted.** One run is one Vitest process,
 * given only its arms by `-t`. Entries whose edits are identical — one
 * mutation held against several arms — run once. `--workers` (default 1) and
 * `--nice` trade load against time; a ledger's `calibration` turns a plan into
 * an estimate, and a run reports how far it drifted from it.
 *
 * **Restoring is the runner's first duty.** A run holds a lock for its whole
 * length, so two runs never edit one tree. Before an entry's edits land, the
 * files' contents and the arm's process group are written to a marker in the
 * system's temporary directory; the edits are applied inside the boundary
 * that restores them, and the files are read back after the run however it
 * ends — on SIGINT and SIGTERM too, which is why the arm runs in a process
 * group of its own that the runner awaits, and stops whole: a worker in a
 * synchronous loop is not left behind. A run killed outright leaves the lock
 * and the marker; the next start refuses, before reading any anchor, until
 * `restore` stops the recorded group and puts the files back.
 *
 * **A result file says which tree it is about**: the revision, a fingerprint
 * of the working tree's changes and untracked files, the ledger's hash and the
 * load chosen. `--resume` continues one only for the same tree and ledger, and
 * `table` quotes one only for its own ledger.
 */
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VITEST = join(ROOT, 'node_modules/.bin/vitest');
const STATE = join(
  tmpdir(),
  `nosvelte-ledger-${createHash('sha256').update(ROOT).digest('hex').slice(0, 12)}`
);
const MARKER = `${STATE}.json`;
const LOCK = `${STATE}.lock`;
const RESULTS = join(ROOT, 'node_modules/.cache/nosvelte-ledger');

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
/** Where an arm is: the one test it was found as, unmutated. */
interface Identity {
  readonly file: string;
  readonly fullName: string;
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
/** `to` as written: a function replacer, so `$&` and its kin are not read as patterns. */
const replaced = (text: string, edit: Edit): string => text.replace(edit.from, () => edit.to);
const armsOf = (entry: Entry): string[] => [entry.arm, ...(entry.requires ?? [])];

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

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const filterOf = (arms: readonly string[]): string =>
  `\\b(?:${[...new Set(arms)].map(escape).join('|')}):`;

/** The arm's process group, while one runs: stopped whole with the runner. */
let running: ChildProcess | undefined;
/** The files an entry's edits changed, while they are applied. */
let applied: ReadonlyMap<string, string> | undefined;
/** Whether this process holds the tree's lock. */
let holding = false;
// However this process ends — a failure, a finished run — it lets the tree
// go, unless an entry's edits are still applied: then the lock and the marker
// stay, and the next start sends its owner to `restore`.
process.on('exit', () => {
  if (holding && applied === undefined) rmSync(LOCK, { force: true });
});

const stopGroup = (pid: number | undefined): void => {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
};

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
      readonly title: string;
      readonly fullName: string;
      readonly status: string;
      readonly failureMessages?: readonly string[];
    }[];
  }[];
}

const firstLine = (text: string): string =>
  (stripVTControlCharacters(text).split('\n')[0] ?? '').trim();

/**
 * One Vitest process group over the ledger's files, given only `arms`, and
 * its JSON report — or why there is none.
 */
function runVitest(
  ledger: Ledger,
  arms: readonly string[],
  options: Options,
  started: (pid: number) => void
): Promise<{ report: Report } | { error: string }> {
  if (arms.length === 0) fail('a run was asked for with no arms');
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
    // A group of its own, so a stop reaches Vitest's workers too: a worker in
    // a synchronous loop outlives a parent killed alone.
    const child = spawn(command as string, rest, { cwd: ROOT, stdio: 'ignore', detached: true });
    running = child;
    if (child.pid !== undefined) started(child.pid);
    // **A run that never ends is stopped, not waited on**: a mutation can put
    // an arm in a loop no test timeout interrupts, since a synchronous loop
    // never yields to one. It is an error, not a kill — what the arm would
    // have said is unknown.
    let stopped = false;
    const timer = setTimeout(() => {
      stopped = true;
      stopGroup(child.pid);
    }, options.limit * 1000);
    const finish = (outcome: { report: Report } | { error: string }): void => {
      clearTimeout(timer);
      running = undefined;
      rmSync(directory, { recursive: true, force: true });
      done(outcome);
    };
    child.on('error', (error) => finish({ error: `Vitest did not start: ${error.message}` }));
    child.on('close', () => {
      stopGroup(child.pid);
      if (stopped) return finish({ error: `the run was stopped after ${options.limit} s` });
      try {
        finish({ report: JSON.parse(readFileSync(report, 'utf8')) as Report });
      } catch {
        finish({ error: 'Vitest wrote no report' });
      }
    });
  });
}

/**
 * Each arm's one test, unmutated, and that it passed — or why the baseline
 * cannot stand: an arm found as no test, as several, failing, or in a file
 * that failed around it (a hook after its tests, a load).
 */
function identitiesOf(report: Report, arms: readonly string[]): Map<string, Identity> {
  const files = report.testResults ?? [];
  const faults: string[] = [];
  for (const file of files)
    if (file.status === 'failed')
      faults.push(`${file.name} failed: ${firstLine(file.message ?? '')}`);
  const found = new Map<string, Identity>();
  for (const arm of arms) {
    const matches = files.flatMap((file) =>
      (file.assertionResults ?? [])
        .filter((one) => one.title.startsWith(`${arm}:`))
        .map((one) => ({ file: file.name, fullName: one.fullName, status: one.status }))
    );
    if (matches.length !== 1) {
      faults.push(`${arm} is ${matches.length} tests, not one`);
      continue;
    }
    const [match] = matches as [(typeof matches)[number]];
    if (match.status !== 'passed') faults.push(`${arm} ${match.status} unmutated`);
    found.set(arm, { file: match.file, fullName: match.fullName });
  }
  if (faults.length > 0) fail(`the baseline does not stand:\n  ${faults.join('\n  ')}`);
  return found;
}

function resultsOf(
  outcome: { report: Report } | { error: string },
  arms: readonly string[],
  identities: ReadonlyMap<string, Identity>
): ArmResult[] {
  if ('error' in outcome)
    return arms.map((arm) => ({ arm, verdict: 'error', timedOut: false, message: outcome.error }));
  const files = outcome.report.testResults ?? [];
  return arms.map((arm) => {
    const identity = identities.get(arm) as Identity;
    const file = files.find((one) => one.name === identity.file);
    const test = file?.assertionResults?.find((one) => one.fullName === identity.fullName);
    if (test?.status === 'failed') {
      const messages = test.failureMessages ?? [];
      return {
        arm,
        verdict: 'killed',
        timedOut: messages.some((message) => /(?:Test|Hook) timed out/.test(message)),
        message: firstLine(messages[0] ?? '')
      };
    }
    if (test?.status === 'passed')
      return { arm, verdict: 'survived', timedOut: false, message: '' };
    return {
      arm,
      verdict: 'error',
      timedOut: false,
      message:
        file?.status === 'failed' && (file.assertionResults ?? []).length === 0
          ? `the file did not load: ${firstLine(file.message ?? '')}`
          : `the arm did not run (${test?.status ?? 'absent'})`
    };
  });
}

/** An entry's verdict from its arms': killed only when every arm it requires failed. */
function verdictOf(entry: Entry, results: readonly ArmResult[]): ArmResult & { by: string[] } {
  const own = armsOf(entry).map((arm) => results.find((one) => one.arm === arm) as ArmResult);
  const first = own[0] as ArmResult;
  const by = own.map((one) => one.arm);
  const errored = own.find((one) => one.verdict === 'error');
  if (errored !== undefined) return { ...errored, arm: entry.arm, by };
  const passed = own.filter((one) => one.verdict === 'survived');
  if (passed.length > 0)
    return {
      arm: entry.arm,
      verdict: 'survived',
      timedOut: false,
      message: `passed: ${passed.map((one) => one.arm).join(', ')}`,
      by
    };
  return { ...first, timedOut: own.some((one) => one.timedOut), by };
}

interface Marked {
  readonly root: string;
  readonly files: Record<string, string>;
  readonly group?: number;
}

const mark = (marked: Marked): void => writeFileSync(MARKER, JSON.stringify(marked));

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
  const owner = lockOwner();
  if (owner?.alive === true)
    fail(`a run (pid ${owner.pid}) is still running; stop it, and it restores what it applied`);
  if (existsSync(MARKER)) {
    const marked = JSON.parse(readFileSync(MARKER, 'utf8')) as Marked;
    if (marked.root !== ROOT) fail(`the marker is for ${marked.root}`);
    stopGroup(marked.group);
    restoreFrom(new Map(Object.entries(marked.files)));
    process.stdout.write(`restored ${Object.keys(marked.files).join(', ')}\n`);
  } else process.stdout.write('no files to restore\n');
  if (existsSync(LOCK)) {
    rmSync(LOCK, { force: true });
    process.stdout.write('released the lock\n');
  }
}

/** The pid in the tree's lock, and whether that process still runs. */
function lockOwner(): { pid: number; alive: boolean } | undefined {
  if (!existsSync(LOCK)) return undefined;
  let pid = Number.NaN;
  try {
    pid = Number((JSON.parse(readFileSync(LOCK, 'utf8')) as { pid?: unknown }).pid);
  } catch {
    // A lock written by nobody this runner knows.
  }
  let alive = false;
  try {
    process.kill(pid, 0);
    alive = true;
  } catch {
    // Not running.
  }
  return { pid, alive };
}

/**
 * Refuse to read the tree while another run holds it, or while a run that
 * ended left it held or edited: its files are not the ledger's to read.
 */
function refuseIfHeld(): void {
  const owner = lockOwner();
  if (owner?.alive === true) fail(`another run (pid ${owner.pid}) holds this tree`);
  if (owner !== undefined || existsSync(MARKER))
    fail(
      `a run ended without releasing this tree${existsSync(MARKER) ? ', with files still edited' : ''}; run \`node scripts/ledger.ts restore\` first`
    );
}

/** The tree's lock, for this run's whole length. */
function lock(): void {
  let held: number;
  try {
    held = openSync(LOCK, 'wx');
  } catch {
    refuseIfHeld();
    return fail(`the lock ${LOCK} could not be taken`);
  }
  holding = true;
  writeSync(held, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
  closeSync(held);
}

const git = (...args: string[]): string =>
  spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 30 }).stdout;

/**
 * The tree a result is about: its revision, and a fingerprint of everything
 * that differs from it — the changes to tracked files and every untracked file
 * the tests could read.
 */
function treeOf(): { revision: string; fingerprint: string } {
  const revision = git('rev-parse', 'HEAD').trim();
  const hash = createHash('sha256').update(git('diff', 'HEAD', '--binary'));
  for (const file of git('ls-files', '--others', '--exclude-standard', '-z').split('\0').sort())
    if (file !== '') hash.update(`\0${file}\0`).update(readFileSync(join(ROOT, file)));
  return { revision, fingerprint: hash.digest('hex').slice(0, 16) };
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
    `  runs ${groups.length + 1}: ${groups.length} mutations and one baseline, each one Vitest process over ${ledger.files.join(', ')}`,
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
  readonly workers: number;
  readonly nice: number | null;
  readonly limit: number;
}

const readResults = (file: string): Record<string, unknown>[] =>
  readFileSync(file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

async function runCommand(
  ledger: Ledger,
  hash: string,
  chosen: readonly Entry[],
  flags: ReadonlyMap<string, string>
): Promise<void> {
  lock();
  const interrupted = (signal: NodeJS.Signals): void => {
    stopGroup(running?.pid);
    if (applied !== undefined) restoreFrom(applied);
    applied = undefined;
    process.stderr.write(`ledger: stopped by ${signal}; the tree is restored\n`);
    process.exit(130);
  };
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);

  const tree = treeOf();
  const resume = flags.get('resume');
  let options = optionsOf(flags);
  let out =
    flags.get('out') ??
    join(RESULTS, `${ledger.name}-${tree.revision.slice(0, 7)}-${Date.now()}.jsonl`);
  const done = new Set<string>();
  if (resume !== undefined) {
    const lines = readResults(resume);
    const header = lines[0] as Partial<Header> | undefined;
    if (
      header?.ledgerHash !== hash ||
      header.revision !== tree.revision ||
      header.fingerprint !== tree.fingerprint
    )
      fail(`${resume} was written for another ledger, revision or working tree`);
    // The load it was begun under, so one result file is one arrangement.
    options = {
      workers: header?.workers ?? 1,
      nice: header?.nice ?? undefined,
      limit: header?.limit ?? 300
    };
    out = resume;
    for (const line of lines) if (line['kind'] === 'entry') done.add(line['id'] as string);
  } else {
    mkdirSync(dirname(out), { recursive: true });
    const header: Header = {
      kind: 'header',
      ledger: ledger.name,
      ledgerHash: hash,
      ...tree,
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

  const arms = [...new Set(pending.flatMap(armsOf))];
  const started = Date.now();
  const baseline = await runVitest(ledger, arms, options, () => undefined);
  if ('error' in baseline) fail(`the baseline did not run: ${baseline.error}`);
  const identities = identitiesOf((baseline as { report: Report }).report, arms);

  const counts = { killed: 0, survived: 0, error: 0, timedOut: 0 };
  for (const group of groupsOf(pending)) {
    const begun = Date.now();
    const groupArms = [...new Set(group.entries.flatMap(armsOf))];
    // The originals, read and marked before any edit lands; the edits are
    // applied inside the boundary that restores them.
    const files = new Map<string, string>();
    for (const edit of group.edits)
      if (!files.has(edit.file)) files.set(edit.file, readFileSync(join(ROOT, edit.file), 'utf8'));
    mark({ root: ROOT, files: Object.fromEntries(files) });
    applied = files;
    let outcome: Awaited<ReturnType<typeof runVitest>>;
    try {
      const contents = new Map(files);
      for (const edit of group.edits)
        contents.set(edit.file, replaced(contents.get(edit.file) as string, edit));
      for (const [file, text] of contents) writeFileSync(join(ROOT, file), text);
      outcome = await runVitest(ledger, groupArms, options, (pid) =>
        mark({ root: ROOT, files: Object.fromEntries(files), group: pid })
      );
    } finally {
      restoreFrom(files);
      applied = undefined;
    }
    const seconds = (Date.now() - begun) / 1000;
    const results = resultsOf(outcome, groupArms, identities);
    for (const entry of group.entries) {
      const result = verdictOf(entry, results);
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
  const rows = ledger.entries.map((entry) => {
    const result = recorded.get(entry.id);
    const outcome =
      result === undefined
        ? 'not run'
        : result['verdict'] === 'killed'
          ? String(result['message'])
              .replace(/^AssertionError: /, '')
              .replace(/: expected[\s\S]*$/, '')
          : String(result['verdict']);
    return `| ${cell(entry.describe ?? entry.id)} | \`${armsOf(entry).join('` and `')}\` | ${cell(outcome)} |`;
  });
  process.stdout.write(
    [
      `At ${String(header?.revision).slice(0, 7)}, tree ${String(header?.fingerprint)}:`,
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
  if (command === 'restore') return restoreCommand();
  // Before any anchor is read: a run killed outright leaves its edits in the
  // tree, and an anchor check would report them as missing anchors.
  refuseIfHeld();
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
  else if (command === 'table')
    tableCommand(ledger, hash, ids[0] ?? fail('table needs a results file'));
  else fail(`no command ${command}`);
}

await main();
