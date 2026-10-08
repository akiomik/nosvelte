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
 * **A run writes nothing of the tree it is started in but its result file.**
 * It reads the tree once and builds a disposable git worktree from what it
 * read:
 * - `HEAD`, with the uncommitted changes applied;
 * - the untracked files that are not ignored, from the bytes captured;
 * - `node_modules` cloned, copy-on-write where the filesystem can, without
 *   what Vite, Vitest and this runner write there;
 * - `.svelte-kit` generated afresh, under the supervisor and the limit;
 * - every link read as the user's tree reads it: one that lands in the tree
 *   points at the same place in the copy, and one that lands outside is
 *   reported, since reads and writes through it are shared.
 *
 * Git runs with no hooks while it does so. Every mutation is applied, run and
 * restored inside the copy. An edit that resolves outside it is refused, and a
 * restore that does not read back ends the run. The copy is removed when the
 * run ends. A run that dies leaves only its copy, which `clean` removes once
 * the copy proves to be one of this repository's and nothing runs in it. Two
 * runs are two copies. The result file must be a plain file of its own, and
 * not a tracked one; its header is written whole or not at all. This assumes
 * no other process replaces the result file or its directory while a run
 * writes it.
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
 * dies (`ledger-supervisor.ts`). If the supervisor itself is stopped or killed,
 * the runner kills the group, a grace period past the limit or as soon as the
 * supervisor ends. Only the runner dying while the supervisor cannot act is
 * not covered. Entries whose edits are identical, one
 * mutation held against several arms, run once. `--workers` (default 1) and
 * `--nice` trade load against time. A ledger's `calibration` turns a plan into
 * an estimate, and a run reports how far it drifted from it.
 *
 * **A result file says which tree it is about.** It records:
 * - the revision;
 * - a fingerprint of the uncommitted changes, the untracked files copied
 *   (also listed), and the dependency tree npm recorded installing
 *   (`node_modules/.package-lock.json`);
 * - the ledger's hash, and the load chosen. The hash is of the data a verdict
 *   is decided from, in its order: the ledger's name, its files, and each
 *   entry's id, arms and edits. A ledger recalibrated or reworded after a run
 *   still quotes that run. Any change to that data refuses it, even one that
 *   cannot change a verdict, such as an entry's independent edits reordered.
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
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPERVISOR = join(ROOT, 'scripts/ledger-supervisor.ts');
/** The prefix of every copy this repository's runs make, and nothing else's. */
const COPIES = `nosvelte-ledger-${createHash('sha256').update(ROOT).digest('hex').slice(0, 12)}-run-`;
const RESULTS = join(ROOT, 'node_modules/.cache/nosvelte-ledger');
/** What Vite, Vitest and this runner write under `node_modules`: not carried into a copy. */
const WRITTEN = ['.vite', '.vite-temp', '.cache'];
/** Seconds a stopped run's group is given to end before it is killed. */
const GRACE = 5;
/**
 * `cp`'s arguments for a clone of a directory's contents, links kept as
 * links: copy-on-write where this `cp` takes it — `-c` on macOS, which falls
 * back to copying, `--reflink=auto` with GNU's, which does too — tried on a
 * small directory first, and a plain recursive copy where it is refused.
 */
function cloneFlags(): string[] {
  const preferred =
    process.platform === 'darwin'
      ? ['-cRP']
      : process.platform === 'linux'
        ? ['-RP', '--reflink=auto']
        : undefined;
  if (preferred === undefined) return ['-RP'];
  const trial = mkdtempSync(join(tmpdir(), 'nosvelte-ledger-cp-'));
  try {
    mkdirSync(join(trial, 'from'));
    writeFileSync(join(trial, 'from', 'file'), 'cloned');
    const tried = spawnSync('cp', [...preferred, `${join(trial, 'from')}/`, join(trial, 'to')], {
      stdio: 'ignore'
    });
    return tried.status === 0 && existsSync(join(trial, 'to', 'file')) ? preferred : ['-RP'];
  } finally {
    rmSync(trial, { recursive: true, force: true });
  }
}

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
   * Seconds a run of each arm takes, process start included, and how that was
   * measured: the plan's estimate, never a check. Arms differ by an order of
   * magnitude, so the estimate is per arm, summed over a run's arms — an upper
   * bound where arms share a run. A run reports how far it drifted from it.
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
  must('git', ['-c', 'core.hooksPath=/dev/null', ...args], cwd);
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
  const ledger = module.default;
  const decides = {
    name: ledger.name,
    files: ledger.files,
    entries: ledger.entries.map((entry) => ({
      id: entry.id,
      arms: armsOf(entry),
      edits: entry.edits.map(({ file, from, to }) => ({ file, from, to }))
    }))
  };
  const hash = createHash('sha256').update(JSON.stringify(decides)).digest('hex').slice(0, 16);
  return { ledger, hash };
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

/** One untracked file, as read when the run began. */
interface Captured {
  readonly path: string;
  readonly mode: number;
  /** A symbolic link's target, as spelled; or the file's bytes. */
  readonly link?: string;
  readonly content?: Buffer;
}

/** The tree a run is about, as it was read when the run began. */
interface Snapshot {
  readonly revision: string;
  readonly patch: Buffer;
  readonly files: readonly Captured[];
  /** Untracked paths not carried: nested repositories, such as other worktrees. */
  readonly nested: readonly string[];
  /** `node_modules/.package-lock.json` as read: the installation the copy must be a clone of. */
  readonly installed: Buffer;
  readonly fingerprint: string;
}

/**
 * The user's tree, read once: its revision, its uncommitted changes, and its
 * untracked files that are not ignored — less `excluded`, the result file a
 * run writes — with a fingerprint of all of them and of the dependency tree
 * npm recorded installing, which a run requires. A copy's source is made from
 * these bytes, so it is the snapshot whatever the tree does meanwhile. Its
 * dependencies are cloned after, and refused unless the clone's installation
 * record and the tree's are still the one read; this assumes no install runs
 * while a copy is made, since one still running may show in neither. Links
 * are followed in the tree when the copy is made, not when it was read, so
 * this also assumes no link in the tree is changed meanwhile.
 */
function snapshotOf(excluded: string | undefined): Snapshot {
  const revision = git(ROOT, 'rev-parse', 'HEAD').trim();
  const patch = gitBytes(ROOT, 'diff', 'HEAD', '--binary');
  const listed = git(ROOT, 'ls-files', '--others', '--exclude-standard', '-z')
    .split('\0')
    .filter((file) => file !== '' && file !== excluded)
    .sort();
  const nested = listed.filter((file) => file.endsWith('/'));
  const files: Captured[] = listed
    .filter((file) => !file.endsWith('/'))
    .map((file) => {
      const stat = lstatSync(join(ROOT, file));
      return stat.isSymbolicLink()
        ? { path: file, mode: stat.mode, link: readlinkSync(join(ROOT, file)) }
        : { path: file, mode: stat.mode, content: readFileSync(join(ROOT, file)) };
    });
  const hash = createHash('sha256').update(revision).update('\0').update(patch);
  for (const file of files) {
    hash.update(`\0${file.path}\0${file.mode}\0`);
    hash.update(file.link ?? (file.content as Buffer));
  }
  // The installation, as npm recorded it: without that record there is
  // nothing to tell one installation from another, so no run.
  const record = join(ROOT, 'node_modules/.package-lock.json');
  if (!existsSync(record))
    fail(
      `${record} is missing; this runner fingerprints the dependencies by the record npm writes`
    );
  const installed = readFileSync(record);
  hash.update('\0').update(installed);
  return {
    revision,
    patch,
    files,
    nested,
    installed,
    fingerprint: hash.digest('hex').slice(0, 16)
  };
}

/** A disposable copy of a snapshot: its directory, and the tree inside it. */
interface Copy {
  readonly directory: string;
  readonly tree: string;
}

/** What a copy's directory says of itself, which `clean` checks before removing anything. */
interface Owner {
  readonly pid: number;
  readonly root: string;
  readonly tree: string;
  readonly started: string;
}

/**
 * The copy a run works in, made from `snapshot` and discarded when this process
 * ends: the worktree at its revision, its patch, its untracked files from the
 * bytes captured, `node_modules` cloned (copy-on-write where the filesystem
 * can) without what Vite and Vitest write there, and `.svelte-kit` generated
 * under the supervisor, bounded by `limit`.
 */
async function copyOf(snapshot: Snapshot, limit: number): Promise<Copy> {
  // Under the temporary directory's real path: a copy reached through a link
  // (`/var` on macOS is `/private/var`) names its files twice, to Vite and to
  // the reports alike.
  const directory = mkdtempSync(join(realpathSync.native(tmpdir()), COPIES));
  const tree = join(directory, 'tree');
  const owner: Owner = { pid: process.pid, root: ROOT, tree, started: new Date().toISOString() };
  writeFileSync(join(directory, 'owner.json'), JSON.stringify(owner));
  const copy = { directory, tree };
  cleanups.push(() => discard(copy));
  git(ROOT, 'worktree', 'add', '--detach', tree, snapshot.revision);
  if (snapshot.patch.length > 0)
    must('git', ['apply', '--binary', '--whitespace=nowarn'], tree, snapshot.patch);
  for (const file of snapshot.files) {
    const to = join(tree, file.path);
    mkdirSync(dirname(to), { recursive: true });
    if (file.link !== undefined) symlinkSync(file.link, to);
    else {
      writeFileSync(to, file.content as Buffer);
      chmodSync(to, file.mode);
    }
  }
  // The dependencies, cloned from their real directory — a checkout whose
  // `node_modules` is a link would otherwise copy the link, and what follows
  // would remove the user's caches — copy-on-write where the filesystem can.
  // A package that writes into its own directory writes the copy's.
  const dependencies = realpathSync.native(join(ROOT, 'node_modules'));
  const modules = join(tree, 'node_modules');
  must('cp', [...cloneFlags(), `${dependencies}/`, modules], ROOT);
  if (!lstatSync(modules).isDirectory() || lstatSync(modules).isSymbolicLink())
    fail(`${modules} is not a directory of the copy's own`);
  for (const name of WRITTEN) rmSync(join(modules, name), { recursive: true, force: true });
  // The installation copied is the one fingerprinted: an install that ran
  // while the copy was made would make the record describe another.
  // An install that ran meanwhile shows in either record; one still running
  // may show in neither, which is why no install may run while a copy is
  // made.
  const record = join(modules, '.package-lock.json');
  const cloned = existsSync(record) ? readFileSync(record) : undefined;
  const source = join(ROOT, 'node_modules/.package-lock.json');
  const now = existsSync(source) ? readFileSync(source) : undefined;
  const installed = snapshot.installed as Buffer;
  if (
    cloned === undefined ||
    now === undefined ||
    !cloned.equals(installed) ||
    !now.equals(installed)
  )
    fail('the dependencies changed while they were copied; run again');
  const { outside, dangling } = relink(tree, dependencies);
  if (outside.length > 0)
    process.stdout.write(
      `  links that leave the tree, shared with the copy: ${outside.join(', ')}\n`
    );
  if (dangling.length > 0)
    process.stdout.write(`  links that lead nowhere, left as written: ${dangling.join(', ')}\n`);
  const synced = await supervised(
    [join(tree, 'node_modules/.bin/svelte-kit'), 'sync'],
    copy,
    limit
  );
  if (synced.stopped || synced.code !== 0)
    fail(`svelte-kit sync did not finish in the copy${synced.stopped ? ` within ${limit} s` : ''}`);
  if (snapshot.nested.length > 0)
    process.stdout.write(`  not copied, nested repositories: ${snapshot.nested.join(', ')}\n`);
  return copy;
}

/** `path` relative to `root`, if it is `root` or inside it; a name that only begins with `..` is inside. */
function within(root: string, path: string): string | undefined {
  const inside = relative(root, path);
  return inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)
    ? undefined
    : inside;
}

/**
 * Every link in the copy, read as the user's tree reads it. Each is followed
 * where it stands in the user's tree — in the tree or, under `node_modules`,
 * in the directory the dependencies really are — by the operating system's
 * `realpath`, so a link met on the way is followed before a `..` after it, as
 * a read would follow it. Node's own `realpathSync` folds the `..` first: a
 * link to `portal/../target`, where `portal` leaves the tree, read as the
 * tree's `target`. One that arrives in the dependencies or the tree points at the same
 * place in the copy: one such link, `node_modules/node_modules`, had a
 * dependency's imports resolve to the user's packages beside the copy's, and
 * an arm wait out its timeout on an answer the second copy of Svelte never
 * gave. One that arrives outside both points there, and is reported, since
 * reads and writes through it are shared. One that arrives nowhere is left as
 * written, and reported.
 */
function relink(tree: string, dependencies: string): { outside: string[]; dangling: string[] } {
  const outside: string[] = [];
  const dangling: string[] = [];
  const modules = join(tree, 'node_modules');
  const root = realpathSync.native(ROOT);
  for (const link of linksUnder(tree)) {
    const at = relative(tree, link);
    const inModules = within(modules, link);
    const original = inModules === undefined ? join(ROOT, at) : join(dependencies, inModules);
    const target = readlinkSync(link);
    let destination: string;
    try {
      destination = realpathSync.native(original);
    } catch {
      dangling.push(`${at} -> ${target}`);
      continue;
    }
    const intoModules = within(dependencies, destination);
    const intoTree = intoModules === undefined ? within(root, destination) : undefined;
    const moved =
      intoModules !== undefined
        ? join(modules, intoModules)
        : intoTree !== undefined
          ? join(tree, intoTree)
          : undefined;
    const wanted = moved === undefined ? destination : relative(dirname(link), moved) || '.';
    if (moved === undefined) outside.push(`${at} -> ${destination}`);
    if (wanted === target) continue;
    rmSync(link);
    symlinkSync(wanted, link);
  }
  return { outside, dangling };
}

/** Every symbolic link under `directory`, not following any. */
function linksUnder(directory: string): string[] {
  const found: string[] = [];
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (at === directory && entry.name === '.git') continue;
      const path = join(at, entry.name);
      if (entry.isSymbolicLink()) found.push(path);
      else if (entry.isDirectory()) walk(path);
    }
  };
  walk(directory);
  return found;
}

/** Remove a copy: its worktree's registration, then its directory. */
function discard(copy: Copy): boolean {
  const removed = spawnSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', 'worktree', 'remove', '--force', copy.tree],
    {
      cwd: ROOT,
      stdio: 'ignore'
    }
  );
  rmSync(copy.directory, { recursive: true, force: true });
  return removed.status === 0 && !existsSync(copy.directory);
}

/** The worktrees Git has registered for this repository, by path. */
const registered = (): Set<string> =>
  new Set(
    git(ROOT, 'worktree', 'list', '--porcelain')
      .split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length))
  );

/**
 * Remove the copies runs left behind, and nothing else. A directory is
 * removed only when every one of these holds:
 * - its name carries this repository's prefix, and it is a real directory,
 *   not a link;
 * - its `owner.json` names this repository and its own `tree`, which is a
 *   real directory that Git has registered as a worktree;
 * - its owner no longer runs.
 *
 * Anything else is left and reported. A copy whose owner's number is alive is
 * left too, even if that process is another that took the number since; it
 * costs only disk.
 */
function cleanCommand(): void {
  const parent = realpathSync.native(tmpdir());
  const worktrees = registered();
  let removed = 0;
  for (const name of readdirSync(parent).filter((one) => one.startsWith(COPIES))) {
    const directory = join(parent, name);
    const tree = join(directory, 'tree');
    const leave = (why: string): void => {
      process.stdout.write(`left ${directory}: ${why}\n`);
    };
    if (!lstatSync(directory).isDirectory()) {
      leave('not a directory');
      continue;
    }
    let owner: Partial<Owner>;
    try {
      owner = JSON.parse(readFileSync(join(directory, 'owner.json'), 'utf8')) as Partial<Owner>;
    } catch {
      leave('no owner it can read');
      continue;
    }
    if (owner.root !== ROOT || owner.tree !== tree) {
      leave('its owner names another repository or tree');
      continue;
    }
    if (existsSync(tree) && (!lstatSync(tree).isDirectory() || !worktrees.has(tree))) {
      leave('its tree is not a worktree of this repository');
      continue;
    }
    let alive = false;
    try {
      process.kill(Number(owner.pid), 0);
      alive = true;
    } catch {
      // Not running.
    }
    if (alive) {
      leave(`process ${owner.pid} is running`);
      continue;
    }
    if (discard({ directory, tree })) removed += 1;
    else leave('Git or the filesystem refused to remove it');
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

/** The supervisor of the command in progress: its pipe closed, its group stops. */
let running: ChildProcess | undefined;

/** SIGKILL to a group this process started and has not yet seen end. */
const killGroup = (pid: number | undefined): void => {
  if (pid === undefined) return;
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    // Already gone.
  }
};

/**
 * `command` in the copy, under a supervisor that leads its process group,
 * bounded by `limit`. At the limit the pipe is closed, and the supervisor
 * stops the group; one that has not ended `GRACE` seconds later, because its
 * supervisor was stopped or killed, is killed from here. When the supervisor
 * ends, whatever of its group remains is killed too: a group keeps its number
 * while any member of it remains, so the number names this group still. The
 * command's exit is read from the status file the supervisor wrote, kept in
 * the copy's directory.
 */
function supervised(
  command: readonly string[],
  copy: Copy,
  limit: number
): Promise<{ stopped: boolean; code: number | null }> {
  // In the copy's own directory, so a run that dies leaves nothing beside it.
  const status = join(mkdtempSync(join(copy.directory, 'status-')), 'status.json');
  const cwd = copy.tree;
  return new Promise((done) => {
    let stopped = false;
    const supervisor = spawn(process.execPath, [SUPERVISOR, status, ...command], {
      cwd,
      detached: true,
      stdio: ['pipe', 'ignore', 'ignore']
    });
    running = supervisor;
    const group = supervisor.pid;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      stopped = true;
      supervisor.stdin?.end();
      grace = setTimeout(() => killGroup(group), GRACE * 1000);
    }, limit * 1000);
    const finish = (): void => {
      clearTimeout(timer);
      if (grace !== undefined) clearTimeout(grace);
      killGroup(group);
      running = undefined;
      // The command's own exit, which the supervisor wrote before stopping
      // its group; none, if the command never ran to an end.
      let code: number | null = null;
      try {
        code = (JSON.parse(readFileSync(status, 'utf8')) as { code: number | null }).code;
      } catch {
        // No status written.
      }
      rmSync(dirname(status), { recursive: true, force: true });
      done({ stopped, code });
    };
    supervisor.on('error', finish);
    supervisor.on('close', finish);
  });
}

/**
 * One Vitest process over the ledger's files in `tree`, given only `arms`,
 * supervised and bounded by `--limit` — and its JSON report, or why there is
 * none.
 */
async function runVitest(
  copy: Copy,
  ledger: Ledger,
  arms: readonly string[],
  options: Options
): Promise<{ report: Report } | { error: string }> {
  if (arms.length === 0) fail('a run was asked for with no arms');
  const tree = copy.tree;
  const directory = mkdtempSync(join(copy.directory, 'report-'));
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
  // **A run that never ends is stopped, not waited on**: a mutation can put an
  // arm in a loop no test timeout interrupts, since a synchronous loop never
  // yields to one. It is an error, not a kill — what the arm would have said
  // is unknown.
  const ran = await supervised(command, copy, options.limit);
  try {
    if (ran.stopped) return { error: `the run was stopped after ${options.limit} s` };
    try {
      return { report: JSON.parse(readFileSync(report, 'utf8')) as Report };
    } catch {
      return { error: 'Vitest wrote no report' };
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
    `  estimate about ${(estimate(ledger, chosen) / 60).toFixed(0)} min at one worker, from each arm's measured time (${ledger.calibration.measured})`
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

/**
 * The result file: the one path a run writes outside its copy. It must be a
 * plain file of its own — not a link, not a second name for another file —
 * and not a tracked one, resolved through any link in its directories. Its
 * path inside the user's tree, if it is in it, is returned, so the snapshot
 * leaves it out.
 */
function resultFileOf(out: string): { path: string; excluded: string | undefined } {
  const path = resolve(out);
  mkdirSync(dirname(path), { recursive: true });
  const real = join(realpathSync.native(dirname(path)), basename(path));
  if (existsSync(real)) {
    const stat = lstatSync(real);
    if (!stat.isFile() || stat.nlink !== 1)
      fail(`${out} is a link or has another name; write results elsewhere`);
  }
  const inside = within(realpathSync.native(ROOT), real);
  if (inside === undefined) return { path: real, excluded: undefined };
  if (git(ROOT, 'ls-files', '--', inside).trim() !== '')
    fail(`${out} is a tracked file; write results elsewhere`);
  return { path: real, excluded: inside };
}

/** A file's first contents, written whole or not at all. */
function writeNew(path: string, text: string): void {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { flag: 'wx' });
  renameSync(temporary, path);
}

/** Each file an edit touches, refused unless it resolves inside the copy. */
function inside(copy: Copy, file: string): string {
  const real = realpathSync.native(join(copy.tree, file));
  const root = realpathSync.native(copy.tree);
  if (!real.startsWith(`${root}${sep}`))
    fail(`${file} resolves outside the copy (${real}); a mutation is not applied there`);
  return real;
}

async function runCommand(
  ledger: Ledger,
  hash: string,
  ids: readonly string[],
  flags: ReadonlyMap<string, string>
): Promise<void> {
  // Before anything is made: an interruption from here on stops what runs and
  // discards what was made, with this process's exit.
  const interrupted = (signal: NodeJS.Signals): void => {
    running?.stdin?.end();
    killGroup(running?.pid);
    process.stderr.write(
      `ledger: stopped by ${signal}; the copy is discarded, and this tree was not written\n`
    );
    process.exit(130);
  };
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);
  process.on('SIGHUP', interrupted);

  const resume = flags.get('resume');
  const { path: out, excluded } = resultFileOf(
    resume ?? flags.get('out') ?? join(RESULTS, `${ledger.name}-${Date.now()}.jsonl`)
  );
  const snapshot = snapshotOf(excluded);
  const chosen = select(ledger, ids, ROOT);
  let options = optionsOf(flags);
  const done = new Set<string>();
  if (resume !== undefined) {
    // The path checked, not the one spelled: a link followed by `..` is
    // another file than the same spelling read lexically.
    const lines = readResults(out);
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
    const header: Header = {
      kind: 'header',
      ledger: ledger.name,
      ledgerHash: hash,
      revision: snapshot.revision,
      fingerprint: snapshot.fingerprint,
      untracked: snapshot.files.map((file) => file.path),
      workers: options.workers,
      nice: options.nice ?? null,
      limit: options.limit
    };
    writeNew(
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

  const copy = await copyOf(snapshot, options.limit);

  const arms = [...new Set(pending.flatMap(armsOf))];
  const started = Date.now();
  const baseline = await runVitest(copy, ledger, arms, options);
  if ('error' in baseline) fail(`the baseline did not run: ${baseline.error}`);
  const identities = identitiesOf((baseline as { report: Report }).report, arms, copy.tree);

  const counts = { killed: 0, survived: 0, error: 0, timedOut: 0 };
  for (const group of groupsOf(pending)) {
    const begun = Date.now();
    const groupArms = [...new Set(group.entries.flatMap(armsOf))];
    const originals = new Map<string, string>();
    for (const edit of group.edits)
      if (!originals.has(edit.file))
        originals.set(edit.file, readFileSync(inside(copy, edit.file), 'utf8'));
    let outcome: Awaited<ReturnType<typeof runVitest>>;
    try {
      const contents = new Map(originals);
      for (const edit of group.edits)
        contents.set(edit.file, replaced(contents.get(edit.file) as string, edit));
      for (const [file, text] of contents) writeFileSync(inside(copy, file), text);
      outcome = await runVitest(copy, ledger, groupArms, options);
    } finally {
      for (const [file, text] of originals) {
        writeFileSync(inside(copy, file), text);
        if (readFileSync(inside(copy, file), 'utf8') !== text)
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
    else {
      const arms = (result['arms'] as ArmResult[] | undefined) ?? [];
      const each = arms.map((one) => {
        const said =
          one.verdict === 'killed'
            ? quoted(one.message)
            : one.verdict === 'survived'
              ? 'passed'
              : `error: ${one.message}`;
        return `${arms.length > 1 ? `${one.arm}: ` : ''}${said}${one.timedOut ? ' (timed out)' : ''}`;
      });
      outcome =
        result['verdict'] === 'killed'
          ? each.join('; ')
          : `${String(result['verdict'])} (${each.join('; ')})`;
    }
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
