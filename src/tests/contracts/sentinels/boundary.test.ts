/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The rule that makes this directory mean something.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const TESTS = resolve(HERE, '../..');
const ROOT = resolve(HERE, '../../../..');

/**
 * Every file under this directory, at any depth.
 *
 * **Flat and `.ts`-only for its first several rounds, and that stopped being
 * the shape of the directory.** A sentinel that needs a component has to have
 * one to render, so `fixtures/` exists now — and a `.svelte` file in a
 * subdirectory satisfied both of the old filters by being neither. The rule
 * this test exists to enforce is "nothing *here* imports `$lib`", and a rule
 * that stops at the first subdirectory is one a fixture walks straight through.
 *
 * Widened rather than special-cased for `fixtures/`: the next subdirectory
 * would need the same edit, and a boundary with a list of what it covers is one
 * that silently stops covering whatever is not on the list.
 *
 * **The extension filter is the surviving half of that defect**, so `DS0`
 * carries a control that counts the directory a second way — see there.
 */
function* filesUnder(dir: string, pattern = /\.(ts|js|svelte)$/): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* filesUnder(path, pattern);
    else if (pattern.test(entry.name)) yield path;
  }
}

/**
 * Every specifier a module names, whatever syntax names it.
 *
 * The four forms beyond `from '…'` are here because each of them was a way past
 * the previous version of this check, which read `from\s+['"]…['"]` and nothing
 * else: a side-effect import (`import './x.js';`) binds no name, a dynamic
 * `import('./x.js')` is a call, `require('./x.js')` is another, and
 * `vi.mock('$lib/…')` names a module in order to replace it — which still makes
 * the library part of what this directory depends on, and is the one form that
 * can change what a sentinel observes without ever appearing to be an import.
 *
 * **What none of these see** is a specifier that is not a literal —
 * `import(someVariable)`. Nothing in this tree writes one, and the honest
 * statement is that this is a check over the text of literal specifiers rather
 * than over the resolved graph a bundler would build. Closing it would mean
 * running the module, which is the thing a boundary check must not do.
 */
function* specifiersIn(source: string): Generator<string> {
  const forms = [
    // Prose is not an import, and this file proved it the expensive way: the
    // first run of the widened check reported `boundary.test.ts -> $lib/…`,
    // which is the `vi.mock` example written in the docblock above. A check
    // that reads comments is the same defect `withoutComments` exists for one
    // directory over — and a boundary that a *description* of an import can
    // fail is one nobody can document.
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bvi\s*\.\s*(?:mock|doMock|unmock|importActual|importMock)\s*\(\s*['"]([^'"]+)['"]/g
  ];
  for (const form of forms) {
    for (const match of source.matchAll(form)) yield match[1] as string;
  }
}

/**
 * Comments out, before anything looks for an import.
 *
 * The line form is guarded against `://` so that a `ws://localhost:9500` in a
 * fixture does not swallow the rest of its line — every sentinel in this
 * directory builds URLs that shape, so the naive version used one directory
 * over would be reading half of them.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\w])\/\/[^\n]*/gm, '$1');
}

/** The file a relative specifier names, written the way TypeScript sources are. */
function resolveRelative(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.svelte.ts'),
    `${base}.ts`,
    base
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

/**
 * Walk every literal specifier from `roots`, recursing through anything under
 * `tests`, and report each path that reaches `lib` or `dist` — by `$lib`, by
 * `src/lib`, or by a relative path that resolves there. Bare specifiers are
 * dependencies and are not followed. Taken as a function so that `DS0` can
 * drive it over a fabricated tree as well as over this one.
 */
function reach(
  roots: readonly string[],
  { here, tests, root, lib, dist }: Record<'here' | 'tests' | 'root' | 'lib' | 'dist', string>
): { offenders: string[]; walked: Set<string> } {
  const offenders: string[] = [];
  const walked = new Set<string>();
  const queue = roots.map((path) => ({ path, via: [relative(here, path)] }));
  while (queue.length > 0) {
    const { path, via } = queue.shift() as { path: string; via: string[] };
    if (walked.has(path)) continue;
    walked.add(path);
    for (const specifier of specifiersIn(withoutComments(readFileSync(path, 'utf8')))) {
      if (specifier.startsWith('$lib') || specifier.startsWith('src/lib')) {
        offenders.push([...via, specifier].join(' -> '));
        continue;
      }
      if (!specifier.startsWith('.')) continue;
      const target = resolveRelative(path, specifier);
      if (target === undefined) continue;
      // `dist/` is the library too, and it is in this tree.
      if (target.startsWith(`${lib}/`) || target.startsWith(`${dist}/`)) {
        offenders.push([...via, relative(root, target)].join(' -> '));
        continue;
      }
      if (target.startsWith(`${tests}/`) && !walked.has(target))
        queue.push({ path: target, via: [...via, relative(tests, target)] });
    }
  }

  return { offenders, walked };
}

describe('the sentinel boundary', () => {
  /**
   * **This read the spelling of one file's imports, and the property it claims
   * is about a graph.** Two things were true at once: `DS0` was green, and
   * `sentinels/rx-nostr.test.ts` executed `$lib/stores/spike-v6/normalize.js`
   * on import, through `../helpers/relay.js`, which imported
   * `LIBRARY_EOSE_TIMEOUT_MS` from it **as a value**. Neither of the old
   * check's two conditions could see it: `helpers/` is not under the directory
   * it walked, and the specifier the sentinel wrote did not start with `$lib`.
   *
   * That matters beyond this file. `0005` exempts the whole `SEN*` family — the
   * `DS*` arms here — from
   * the mutation ledger on the strength of this claim, and calls the exemption
   * "stronger than aimed at and provably not killable — a property of the
   * directory". A property of the directory that holds only for directly
   * written specifiers is not one.
   *
   * So the walk is transitive: start at every file here, follow every literal
   * specifier, recurse through anything under `src/tests`, and fail on anything
   * that resolves into `src/lib`. A relative path spelled `../../lib/…` — which
   * the old check also missed — needs no separate arm, because resolving is
   * what the walk does.
   *
   * **A bare specifier is a dependency and is deliberately not followed.** That
   * is what a sentinel is for: `rx-nostr`, `mock-socket` and the query engine
   * are the subjects. `$lib` is refused before resolution because SvelteKit's
   * alias is not on disk in a form this can resolve, and `src/lib` is refused
   * after it.
   */
  it('DS0: nothing here reaches the library it is meant to be independent of', () => {
    // **The setup file is in every one of these modules' graphs and in none of
    // their sources.** Vitest injects `test.setupFiles` ahead of each test file,
    // so a `$lib` import added there would be executed by every sentinel while
    // this walk — which starts from what the sentinels themselves import — saw
    // nothing. Read from the config rather than written here, because a list
    // written here is the hand-maintained kind of root set this check exists to
    // replace.
    const injected = (
      readFileSync(resolve(ROOT, 'vite.config.ts'), 'utf8').match(
        /setupFiles:\s*\[([^\]]*)\]/
      )?.[1] ?? ''
    )
      .split(',')
      .map((entry) => entry.trim().replace(/^['"`]|['"`]$/g, ''))
      .filter((entry) => entry.length > 0)
      .map((entry) => resolve(ROOT, entry));
    expect(injected.length).toBeGreaterThan(0);

    const roots = [...filesUnder(HERE), ...injected];
    const { offenders } = reach(roots, {
      here: HERE,
      tests: TESTS,
      root: ROOT,
      lib: resolve(ROOT, 'src/lib'),
      dist: resolve(ROOT, 'dist')
    });

    // **The control, and `length > 0` is not it.** The defect this check has
    // actually had was a *filter* that dropped part of the directory — a
    // `.svelte` fixture in a subdirectory was neither flat nor `.ts`, and the
    // walk was non-empty the whole time it was being skipped. So the directory
    // is counted a second way, by a rule that has nothing in common with the
    // first: every file under here that is not documentation. A file the
    // extension pattern stops recognising fails this rather than going quietly
    // unread.
    const everyFile = [...filesUnder(HERE, /^(?!.*\.md$).*$/)];
    expect(
      roots
        .filter((path) => path.startsWith(`${HERE}/`))
        .map((path) => relative(HERE, path))
        .sort()
    ).toEqual(everyFile.map((path) => relative(HERE, path)).sort());
    // **And the walk leaves the directory, driven rather than assumed.** The
    // real tree no longer exercises that: the harness the rx-nostr sentinels
    // share lives in this directory, so every edge it has stays inside. A
    // fabricated tree puts the library one hop outside — a sentinel importing a
    // helper elsewhere under the suite root, which imports the library both by
    // path and by alias — and the clean variant beside it says the walk still
    // reaches that helper when nothing is wrong with it.
    const sandbox = mkdtempSync(join(tmpdir(), 'nosvelte-boundary-'));
    try {
      const fake = {
        here: join(sandbox, 'src/tests/contracts/sentinels'),
        tests: join(sandbox, 'src/tests'),
        root: sandbox,
        lib: join(sandbox, 'src/lib'),
        dist: join(sandbox, 'dist')
      };
      for (const dir of [fake.here, join(fake.tests, 'helpers'), fake.lib])
        mkdirSync(dir, { recursive: true });
      writeFileSync(join(fake.lib, 'index.ts'), 'export const x = 1;');
      // The imports are assembled, so that this file's own text names none of
      // them: `DS0` reads this file, and a literal one would be an offender.
      const from = (specifier: string): string => `import { v } ${'from'} '${specifier}';`;
      const sentinel = join(fake.here, 'a.test.ts');
      writeFileSync(sentinel, from(['..', '..', 'helpers', 'h.js'].join('/')));
      const helper = join(fake.tests, 'helpers/h.ts');
      writeFileSync(
        helper,
        [
          from(['..', '..', 'lib', 'index.js'].join('/')),
          from(['$lib', 'index.js'].join('/'))
        ].join('\n')
      );
      expect(reach([sentinel], fake).offenders.sort()).toEqual([
        'a.test.ts -> helpers/h.ts -> $lib/index.js',
        'a.test.ts -> helpers/h.ts -> src/lib/index.ts'
      ]);
      writeFileSync(helper, "import { z } from 'rx-nostr';");
      const clean = reach([sentinel], fake);
      expect(clean.offenders).toEqual([]);
      expect([...clean.walked], 'the walk did not leave the directory').toContain(helper);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }

    expect(offenders).toEqual([]);
  });
});

describe('the sentinels name what they measured', () => {
  it('DS10: the versions the measurements were taken against are the resolved ones', () => {
    // A sentinel says "the dependency does this". Without a version that is not
    // a measurement, it is a rumour: nobody can re-take it, and nobody can tell
    // whether a bump has invalidated it. The records name these numbers, so a
    // bump has to fail here and be re-measured rather than quietly inherited.
    //
    // `tanstack-svelte-query-v6` matters twice over: two copies of query-core
    // resolve in this tree, and the one the streaming helper comes from is not
    // the one at the top level.
    const root = resolve(HERE, '../../../..');
    const versionAt = (...segments: string[]): string =>
      (
        JSON.parse(
          readFileSync(join(root, 'node_modules', ...segments, 'package.json'), 'utf8')
        ) as {
          version: string;
        }
      ).version;

    // 3.7.6 rather than the 3.7.5 the spike measured: the production line
    // resolved it and these sentinels re-ran green. The one source change is
    // `confirmOK` in `connection/publish.ts` — an acknowledged event now leaves
    // the publish count, which feeds a connection's idle state — and no
    // sentinel publishes. `0003` records the move and what it changes.
    expect(versionAt('rx-nostr')).toBe('3.7.6');
    expect(versionAt('tanstack-svelte-query-v6')).toBe('6.1.38');
    expect(versionAt('tanstack-svelte-query-v6', 'node_modules', '@tanstack', 'query-core')).toBe(
      '5.101.4'
    );
    // **Two more, and the gap they close was found by reading what the records
    // cite rather than what this file lists.** 0002 rests the drain floor on a
    // p95 of `rx-nostr-crypto`'s verifier and now names the version it was taken
    // against; and the same record reads the two query-library copies' context
    // keys against each other — one a Symbol, one a string — which is a claim
    // about the *top-level* copy that nothing here pinned. Both were prose with
    // no assertion behind them, which is the state this sentinel exists to
    // forbid, and a bump would have carried the figures forward silently.
    expect(versionAt('rx-nostr-crypto')).toBe('3.1.3');
    expect(versionAt('@tanstack', 'svelte-query')).toBe('5.90.2');
  });
});
