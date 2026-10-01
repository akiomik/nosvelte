/**
 * The bridge between `docs/decisions/0005` and the production contract tests.
 *
 * 0005 keeps one roster line per contract row — the row's port route and its
 * production evidence — and phase 2 moves the evidence from `TBD` to
 * `test:<id>` as tests land under this directory. Everything here is a pure
 * function over text, so that `catalogue.test.ts` can drive each refusal
 * against fabricated sources while the directory holds no landing yet.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Where landing tests live, as 0005 names it. */
export const PRODUCTION_ROOT_LEAF = 'contracts';
export const PRODUCTION_ROOT = `src/tests/${PRODUCTION_ROOT_LEAF}`;

/** The routes a row may carry. Closed: an unknown word is a row nobody classified. */
export const ROUTES = [
  'public',
  'internal',
  'architecture',
  'sentinel',
  'no-test',
  'discharged'
] as const;

/**
 * A decision id as the records spell one: a letter, then digits with an
 * optional suffix (`A4b`) or a hyphen and one Greek letter (`A-ε`). Both
 * boundaries matter — without them the `A-ε` of `A-ε-C14`, or the `C10` of
 * `A11-C10`, would read as a decision.
 */
export const DECISION_ID = '(?<![\\w-])([ABC](?:[0-9]+[a-z]?|-[α-ω]))(?![\\w-])';

/**
 * A test id: letters then digits (`CT1`), a hyphenated family (`CT-1`), or a
 * `#`-prefixed number. A title shaped like a row id (`A5-C1`) is none of these,
 * which is why naming a landing after its row is refused rather than accepted.
 */
export const TEST_ID = String.raw`(?:[A-Za-z]+-[0-9]+[a-z]?|[A-Za-z]+[0-9]+[a-z]?|#[0-9]+)`;

/** A fresh matcher for `it('ID: …')`, with the id in group 2. The title may sit on the next line. */
export const declaresTest = (): RegExp =>
  new RegExp(String.raw`\bit(?:\.fails)?\(\s*(['"\`])(${TEST_ID}):`, 'g');

/**
 * Source with its comments removed and nothing else touched, one output line
 * per input line.
 *
 * It reads the language rather than a pattern: a comment opener inside a
 * string or a regular expression literal is not one, and whether a `/` opens a
 * pattern is decided the way a lexer decides it — by the last significant
 * character, or keyword, before it. A keyword used as a property name
 * (`obj.in / 2`) is not a keyword. Single and double quotes and patterns reset
 * at a line end; a template carries.
 */
export function code(raw: string): string {
  let out = '';
  let inBlock = false;
  let quote: string | undefined;
  for (const line of raw.split('\n')) {
    let kept = '';
    let inRegex = false;
    let inClass = false;
    let previous = '';
    let word = '';
    let afterDot = false;
    for (let at = 0; at < line.length; at += 1) {
      const here = line[at] as string;
      const two = line.slice(at, at + 2);
      if (inBlock) {
        if (two === '*/') {
          inBlock = false;
          at += 1;
        }
        continue;
      }
      if (inRegex) {
        if (here === '\\') {
          kept += here + (line[at + 1] ?? '');
          at += 1;
          continue;
        }
        if (here === '[') inClass = true;
        else if (here === ']') inClass = false;
        else if (here === '/' && !inClass) inRegex = false;
        kept += here;
        continue;
      }
      if (quote === undefined) {
        if (two === '/*') {
          inBlock = true;
          at += 1;
          continue;
        }
        if (two === '//') break;
        if (
          here === '/' &&
          (/^$|[=(,:[!&|?+\-*%~^{};<>]/.test(previous) ||
            (!afterDot &&
              /^(?:return|typeof|case|in|of|new|delete|void|do|else|yield|await|throw)$/.test(
                word
              )))
        ) {
          inRegex = true;
          inClass = false;
          kept += here;
          previous = here;
          continue;
        }
        if (here === "'" || here === '"' || here === '`') quote = here;
      } else if (here === '\\') {
        kept += here + (line[at + 1] ?? '');
        at += 1;
        continue;
      } else if (here === quote) quote = undefined;
      kept += here;
      if (quote === undefined && here.trim() !== '') {
        if (/[A-Za-z_$]/.test(here)) {
          if (word === '') afterDot = previous === '.';
          word += here;
        } else word = '';
        previous = here;
      }
    }
    if (quote === "'" || quote === '"') quote = undefined;
    out += `${kept}\n`;
  }

  return out;
}

/** The text of the call that starts at `at`, by matching its parentheses. */
export const callAt = (source: string, at: number): string => {
  const opened = source.indexOf('(', at);
  if (opened === -1) return '';
  let depth = 0;
  for (let index = opened; index < source.length; index += 1) {
    const character = source[index];
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(at, index + 1);
    }
  }

  return source.slice(at);
};

/**
 * The rows each test arm declares, its call text, and the ids declared twice.
 *
 * A marker `@contracts <id> …` belongs to the arm it sits **directly** above:
 * the comment block above the declaration, which a blank line ends. A marker
 * floating above a `describe` or at the top of a file belongs to nothing.
 * Declarations are found in the code with comments stripped — one somebody
 * commented out is not an arm — while markers, being comments, are read from
 * the raw lines at the same index.
 */
export const declarationsIn = (
  source: string
): { rows: Map<string, Set<string>>; twice: string[]; bodies: Map<string, string> } => {
  const rows = new Map<string, Set<string>>();
  const bodies = new Map<string, string>();
  const twice: string[] = [];
  const stripped = code(source);
  const lines = source.split('\n');
  const startOf = (index: number): number => stripped.slice(0, index).split('\n').length - 1;
  for (const arm of stripped.matchAll(declaresTest())) {
    const id = arm[2] as string;
    bodies.set(id, callAt(stripped, arm.index));
    if (rows.has(id)) twice.push(id);
    const declared = new Set<string>();
    for (let above = startOf(arm.index) - 1; above >= 0; above -= 1) {
      const text = (lines[above] as string).trim();
      if (text === '') break;
      if (!text.startsWith('//') && !text.startsWith('*') && !text.startsWith('/*')) break;
      // The closer of a one-line JSDoc marker is not a row id.
      const marker = /@contracts\s+(.+?)(?:\s*\*\/)?$/.exec(text);
      if (marker !== null) {
        for (const id of (marker[1] as string).trim().split(/\s+/)) declared.add(id);
      }
    }
    rows.set(id, declared);
  }

  return { rows, twice, bodies };
};

/** Fold test files into one arm → rows map, reporting an id declared twice in a file or by two files. */
export const mergeDeclarations = (
  files: ReadonlyArray<{ readonly file: string; readonly source: string }>
): { tests: Map<string, Set<string>>; duplicates: string[] } => {
  const tests = new Map<string, Set<string>>();
  const owner = new Map<string, string>();
  const duplicates: string[] = [];
  for (const { file, source } of files) {
    const parsed = declarationsIn(source);
    for (const arm of parsed.twice) duplicates.push(`${arm} is declared twice in ${file}`);
    for (const [arm, rows] of parsed.rows) {
      const previous = owner.get(arm);
      if (previous !== undefined) duplicates.push(`${arm} is declared in ${previous} and ${file}`);
      owner.set(arm, file);
      tests.set(arm, rows);
    }
  }

  return { tests, duplicates };
};

/**
 * Why a call would not run as a single readable arm, if it would not: a
 * disabling word anywhere in the chain (`skip`, `only`, `todo`, `skipIf`,
 * `runIf`), a disabling options object, or a table-driven arm (`it.each`),
 * which this bridge cannot record one id for. A parametrised `describe` is
 * none of these — its arms are ordinary declarations.
 */
export const collectDisabled = (call: string): string[] => {
  const bare = call.trim().replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
  const found: string[] = [];
  if (/^(it|describe|test)\b[^;]*\.(skip|only|todo|skipIf|runIf)\b/.test(bare)) found.push('');
  if (/^(it|test)\b[^;]*\{[^}]*\b(skip|only|todo)\s*:\s*true/.test(bare))
    found.push(' (disabled by its options)');
  if (/^(it|test)\b[^;]*\.each\b/.test(bare))
    found.push(' (a table-driven arm; this bridge records one id per arm)');

  return found;
};

/**
 * Whether an arm's call makes an assertion: a matcher after `expect(…)`,
 * `expectTypeOf`/`expectOf`, `assert`, or `expect.assertions` and its
 * siblings. Strings come out first, so a title cannot assert by being named.
 */
export const asserts = (body: string): boolean => {
  const bare = code(body).replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");

  return (
    /\bexpect(?:\.\w+)?\s*\([^;]*\)\s*\.\s*\w/.test(bare) ||
    /\bexpect(?:Type)?Of\s*\(/.test(bare) ||
    /\bassert(?:\.\w+)?\s*\(/.test(bare) ||
    /\bexpect\s*\.\s*(?:assertions|hasAssertions|unreachable)\s*\(/.test(bare)
  );
};

export interface Landings {
  readonly tests: Map<string, Set<string>>;
  readonly duplicates: string[];
  readonly assertionless: string[];
  readonly disabled: string[];
  readonly unreadable: string[];
}

/** Read a directory of contract tests. A root that is not there is empty rather than an error. */
export const collectFrom = (root: string): Landings => {
  const files: Array<{ file: string; source: string }> = [];
  if (!existsSync(root))
    return { ...mergeDeclarations(files), assertionless: [], disabled: [], unreadable: [] };
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.test.ts'))
        files.push({ file: relative(root, full), source: readFileSync(full, 'utf8') });
    }
  };
  walk(root);
  const merged = mergeDeclarations(files);
  const unreadable: string[] = [];
  const assertionless: string[] = [];
  const disabled: string[] = [];
  for (const { file, source } of files) {
    const parsed = declarationsIn(source);
    for (const [id, body] of parsed.bodies)
      if (!asserts(body)) assertionless.push(`${id} in ${file}`);
    const declared = new Set(parsed.rows.keys());
    const stripped = code(source);
    const strippedLines = stripped.split('\n');
    for (const [at, line] of source.split('\n').entries()) {
      if (!/^\s*(it|describe|test)\b/.test(line)) continue;
      // The call rather than the line, because the title may be on the next one.
      const from = strippedLines.slice(0, at).join('\n').length + (at > 0 ? 1 : 0);
      const call = callAt(stripped, from).replace(/\s+/g, ' ').trim();
      for (const why of collectDisabled(call)) disabled.push(`${file}:${at + 1}${why}`);
      // Only a title that means to be an id — one with a digit in it — is held
      // to the id shape; `it('rejects: an empty filter', …)` is prose.
      const titled = /^(it|test)(?:\.\w+)*\(\s*['"`]([^\s'"`]*\d[^\s'"`]*):/.exec(call);
      if (titled !== null && !declared.has(titled[2] as string))
        unreadable.push(
          `${file}:${at + 1} — this bridge cannot read "${titled[2] as string}" as an arm id` +
            `${(titled[1] as string) === 'test' ? ', and it reads only `it(`' : ''}`
        );
    }
  }

  return { ...merged, assertionless, disabled, unreadable };
};

export type Roster = ReadonlyMap<string, { readonly route: string; readonly evidence: string }>;

/** The edges a test claims that no row claims back. */
export const backwardFaults = (rows: Roster, tests: ReadonlyMap<string, Set<string>>): string[] => {
  const faults: string[] = [];
  for (const [arm, declared] of tests) {
    for (const row of declared) {
      const evidence = rows.get(row)?.evidence;
      if (evidence === undefined) {
        faults.push(`${arm} declares ${row}, which is not a row`);
        continue;
      }
      if (evidence !== `test:${arm}`)
        faults.push(`${arm} declares ${row}, which points at ${evidence}`);
    }
  }

  return faults;
};

/** What is wrong with a row's `test:<arm>`, if anything. */
export const faultInLanding = (
  row: string,
  arm: string,
  tests: ReadonlyMap<string, Set<string>>
): string | undefined => {
  const declared = tests.get(arm);
  if (declared === undefined)
    return `${row}: test:${arm} names no test under the production contract root`;
  if (!declared.has(row)) return `${row}: test:${arm} does not declare this row`;

  return undefined;
};

/**
 * Whether a row's route and its evidence contradict each other. `absent:` is
 * for the two routes whose seam a port may genuinely not have — `internal` and
 * `sentinel`; on `public` or `architecture` it would hide a phase-1 error.
 */
export const disagrees = (route: string, evidence: string): boolean => {
  if (route === 'discharged') return !evidence.startsWith('discharged:');
  if (route === 'no-test') return !evidence.startsWith('no-test:');

  return (
    evidence.startsWith('discharged:') ||
    evidence.startsWith('no-test:') ||
    (evidence.startsWith('absent:') && !['internal', 'sentinel'].includes(route))
  );
};
