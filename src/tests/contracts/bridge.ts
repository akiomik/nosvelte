/**
 * The bridge between `docs/decisions/0005` and the production contract tests.
 *
 * 0005 keeps one roster line per contract row — the row's port route and its
 * production evidence — and phase 2 moves the evidence from `TBD` to
 * `test:<id>` as tests land under this directory. Everything here is a pure
 * function over text, so that `catalogue.test.ts` can drive each refusal
 * against fabricated sources: the landings in this directory only ever take
 * the accepting path.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import ts from 'typescript';

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

/** A parsed TypeScript source, with parent links. */
const parse = (source: string): ts.SourceFile =>
  ts.createSourceFile('arms.test.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const checkerFor = (tree: ts.SourceFile): ts.TypeChecker => {
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === tree.fileName ? tree : undefined);
  host.fileExists = (name) => name === tree.fileName;

  return ts.createProgram({ rootNames: [tree.fileName], options, host }).getTypeChecker();
};

/**
 * Whether a name is the runner's own: imported from `vitest` under its own
 * name, or bound to nothing in the file (the runner's global). A local
 * `function it` or `const it = test.fails` is not, whatever it does.
 */
const runnerName = (checker: ts.TypeChecker, name: ts.Identifier): boolean => {
  const declaration = checker.getSymbolAtLocation(name)?.declarations?.[0];
  if (declaration === undefined) return true;
  if (!ts.isImportSpecifier(declaration)) return false;
  const imported = declaration.propertyName ?? declaration.name;
  if (imported.text !== name.text) return false;
  const from = declaration.parent.parent.parent.moduleSpecifier;

  return ts.isStringLiteral(from) && from.text === 'vitest';
};

/**
 * Whether a callee declares an arm this bridge reads: `it(` and nothing else.
 * `it.fails` inverts what passing means, so its `passed` in a report is not a
 * landing having run and held.
 */
const armCallee = (callee: ts.Expression): boolean =>
  ts.isIdentifier(callee) && callee.text === 'it';

/** Where a test is declared, one-based, as the runner reports it. */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/**
 * The rows each test arm declares, its call text, and the ids declared twice.
 *
 * An arm is a call in the syntax tree — `it('ID: …', …)`, the runner's own `it` —
 * so text that only looks like one, inside a string or a comment, is not an
 * arm. A marker `@contracts <id> …` belongs to the arm it sits **directly**
 * above: the comment block above the line the call starts on, which a blank
 * line ends. A marker floating above a `describe` or at the top of a file
 * belongs to nothing.
 */
export const declarationsIn = (
  source: string
): {
  rows: Map<string, Set<string>>;
  twice: string[];
  bodies: Map<string, string>;
  positions: Map<string, Position>;
} => {
  const rows = new Map<string, Set<string>>();
  const bodies = new Map<string, string>();
  const positions = new Map<string, Position>();
  const twice: string[] = [];
  const tree = parse(source);
  const checker = checkerFor(tree);
  const lines = source.split('\n');
  const shape = new RegExp(`^(${TEST_ID}):`);
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      armCallee(node.expression) &&
      runnerName(checker, node.expression as ts.Identifier)
    ) {
      const title = node.arguments[0];
      const id =
        title !== undefined && ts.isStringLiteralLike(title)
          ? shape.exec(title.text)?.[1]
          : undefined;
      if (id !== undefined) {
        bodies.set(id, node.getText(tree));
        if (rows.has(id)) twice.push(id);
        const declared = new Set<string>();
        const where = tree.getLineAndCharacterOfPosition(node.getStart(tree));
        // One-based, as the runner reports a test's location.
        positions.set(id, { line: where.line + 1, column: where.character + 1 });
        const start = where.line;
        for (let above = start - 1; above >= 0; above -= 1) {
          const text = (lines[above] as string).trim();
          if (text === '') break;
          if (!text.startsWith('//') && !text.startsWith('*') && !text.startsWith('/*')) break;
          // The closer of a one-line JSDoc marker is not a row id.
          const marker = /@contracts\s+(.+?)(?:\s*\*\/)?$/.exec(text);
          if (marker !== null)
            for (const row of (marker[1] as string).trim().split(/\s+/)) declared.add(row);
        }
        rows.set(id, declared);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);

  return { rows, twice, bodies, positions };
};

/** Fold test files into one arm → rows map, reporting an id declared twice in a file or by two files. */
export const mergeDeclarations = (
  files: ReadonlyArray<{ readonly file: string; readonly source: string }>
): {
  tests: Map<string, Set<string>>;
  files: Map<string, string>;
  positions: Map<string, Position>;
  duplicates: string[];
} => {
  const tests = new Map<string, Set<string>>();
  const owner = new Map<string, string>();
  const positions = new Map<string, Position>();
  const duplicates: string[] = [];
  for (const { file, source } of files) {
    const parsed = declarationsIn(source);
    for (const arm of parsed.twice) duplicates.push(`${arm} is declared twice in ${file}`);
    for (const [arm, rows] of parsed.rows) {
      const previous = owner.get(arm);
      if (previous !== undefined) duplicates.push(`${arm} is declared in ${previous} and ${file}`);
      owner.set(arm, file);
      tests.set(arm, rows);
      const position = parsed.positions.get(arm);
      if (position !== undefined) positions.set(arm, position);
    }
  }

  return { tests, files: owner, positions, duplicates };
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

/**
 * The id-shaped titles in a test file that the arm-id shape cannot read: an
 * `it(` or `test(` whose title carries a digit before its colon, and is not an
 * arm `declarationsIn` read. The natural mistake is naming a landing after its
 * row (`it('A5-C1: …')`), and it is refused here, loudly, at the file.
 */
export const unreadableIn = (
  source: string,
  file: string,
  declared: ReadonlySet<string>
): string[] => {
  const tree = parse(source);
  const unreadable: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const root = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          ? callee.expression.text
          : undefined;
      const title = node.arguments[0];
      // Only a title that means to be an id — one with a digit in it — is
      // held to the id shape; `it('rejects: an empty filter', …)` is prose.
      const id =
        title !== undefined && ts.isStringLiteralLike(title)
          ? /^(\S*\d\S*):/.exec(title.text)?.[1]
          : undefined;
      if ((root === 'it' || root === 'test') && id !== undefined && !declared.has(id)) {
        const at = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
        unreadable.push(
          `${file}:${at} — this bridge cannot read "${id}" as an arm id` +
            `${root === 'test' ? ', and it reads only `it(`' : ''}`
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);

  return unreadable;
};

export interface Landings {
  readonly tests: Map<string, Set<string>>;
  /** The file each arm is declared in, relative to the root read. */
  readonly files: Map<string, string>;
  /** Where each arm is declared in its file. */
  readonly positions: Map<string, Position>;
  readonly duplicates: string[];
  readonly assertionless: string[];
  readonly unreadable: string[];
}

/** Read a directory of contract tests. A root that is not there is empty rather than an error. */
export const collectFrom = (root: string): Landings => {
  const files: Array<{ file: string; source: string }> = [];
  if (!existsSync(root)) return { ...mergeDeclarations(files), assertionless: [], unreadable: [] };
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
  for (const { file, source } of files) {
    const parsed = declarationsIn(source);
    for (const [id, body] of parsed.bodies)
      if (!asserts(body)) assertionless.push(`${id} in ${file}`);
    unreadable.push(...unreadableIn(source, file, new Set(parsed.rows.keys())));
  }

  return { ...merged, assertionless, unreadable };
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

/**
 * The port-route roster in 0005: one line per row, its route and its
 * production evidence, read from the fenced block under the roster heading
 * and nowhere else. Faults name what could not be read.
 */
export const rosterOf = (
  text: string
): { roster: Map<string, { route: string; evidence: string }>; faults: string[] } => {
  const roster = new Map<string, { route: string; evidence: string }>();
  const faults: string[] = [];
  const lines = text.split('\n');
  const heading = lines.findIndex((line) => line.startsWith('#### The port route of a row'));
  const opens = lines.findIndex((line, at) => at > heading && line.startsWith('```text'));
  const closes = lines.findIndex((line, at) => at > opens && line.startsWith('```'));
  if (heading === -1) faults.push('the record no longer has a port-route section');
  else if (opens === -1) faults.push('the record no longer carries a roster block');
  else if (closes <= opens) faults.push('the roster fence is never closed');
  else
    for (const line of lines.slice(opens + 1, closes)) {
      const match = /^(\S+)\s+([a-z-]+)\s+(\S.*)$/.exec(line);
      if (match === null) faults.push(`a roster line that is not id, route, evidence: ${line}`);
      else if (!(ROUTES as readonly string[]).includes(match[2] as string))
        faults.push(`an unknown route in the roster: ${match[2] as string}`);
      else if (roster.has(match[1] as string))
        faults.push(`${match[1] as string} is rostered twice`);
      else
        roster.set(match[1] as string, { route: match[2] as string, evidence: match[3] as string });
    }

  return { roster, faults };
};

/** A landing the run must show: the row, the arm that carries it, and the file it is declared in. */
export interface Expected {
  readonly row: string;
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/**
 * Every landing the roster names, with the file its arm is declared in under
 * `root`, which is an absolute path. A `test:` that names no declared arm is a
 * fault here as well as in `CAT33`, so the run is not judged against a list
 * that silently lost a member.
 */
export const expectedLandings = (
  roster: Roster,
  declared: Pick<Landings, 'files' | 'positions'>,
  root: string
): { expected: Expected[]; faults: string[] } => {
  const expected: Expected[] = [];
  const faults: string[] = [];
  for (const [row, { evidence }] of roster) {
    if (!evidence.startsWith('test:')) continue;
    const id = evidence.slice('test:'.length).trim();
    const file = declared.files.get(id);
    const position = declared.positions.get(id);
    if (file === undefined || position === undefined)
      faults.push(`${row}: test:${id} is declared nowhere under the root`);
    else expected.push({ row, id, file: join(root, file), ...position });
  }

  return { expected, faults };
};

/**
 * Whether one run of the suite shows every landing **ran and passed**.
 *
 * This is the half of rule 6 a static read cannot settle: what the runner
 * actually did. It is judged from the report `scripts/landing-reporter.ts`
 * wrote for this very run — the run's exit status, then the report's
 * presence, shape and start time — and then each expected landing must appear
 * exactly once **at its declaration**: the file, the id and the line and
 * column the arm was declared at, so another test that happens to share the
 * file and the id does not stand in for one that never registered. It must
 * have `passed`, and must not have been registered to expect failure, since
 * such a test passes when its body throws. Missing (never collected, or
 * filtered out), duplicated, `skipped`, `pending`, failed or failing-expected
 * are each a fault. The run's overall success is not used: a skipped test
 * leaves it `true`.
 */
/**
 * The engine arms a row names as holding the half of a clause it reopened
 * under the route rule — the half no published value reflects.
 *
 * **Read from the record because the roster cannot hold them**: a roster line
 * credits one arm, and that arm is the public one. So the list lives in the
 * row's own text, after `measured, `, as backticked arm ids joined by `, `,
 * ` and ` or an en dash for a range of one prefix. Without this a reopened row
 * named arms nothing checked: renamed, emptied or turned into a `todo`, they
 * left every check green while the record still said they held the clause.
 *
 * **And read strictly, because a lenient reader is the same hole one level
 * down.** The first version stopped at the first separator it did not know and
 * said nothing, so a hyphen range, an `or`, a colon after `measured` or a bold
 * id dropped arms from the run while the record went on naming them. So every
 * sentence that begins at `measured` is read twice — the grammar above, and
 * every backticked arm id in it — and the two must agree; and a row that says
 * it was reopened under the route rule must name at least one arm.
 *
 * **Where it reads is the text a reopening wrote**, from `(reopened` to the end
 * of the row: "measured" is an ordinary word elsewhere in the record, beside
 * spike ids and arms that hold other clauses, and reading it there would make
 * every one of those an obligation nobody wrote.
 */
export const supportingArms = (
  record: string
): { arms: Map<string, string[]>; faults: string[] } => {
  const ARM = '[A-Za-z]+[0-9]+[a-z]?';
  const ITEM = `\`${ARM}\`(?:–\`${ARM}\`)?`;
  const list = new RegExp(`^measured, (${ITEM}(?:(?:, (?:and )?| and )${ITEM})*)`);
  const arms = new Map<string, string[]>();
  const faults: string[] = [];
  for (const line of record.split('\n')) {
    const row = /^\| `([^`]+)`\s+\|/.exec(line)?.[1];
    if (row === undefined) continue;
    const opened = line.indexOf('(reopened');
    if (opened === -1) continue;
    const reopened = line.slice(opened);
    const ids: string[] = [];
    for (const start of reopened.matchAll(/\bmeasured\b/gi)) {
      // The sentence from `measured` to its end, or to the end of the cell.
      const rest = reopened.slice(start.index);
      const end = rest.search(/\.(?:\s|$)|\s\|/);
      const sentence = end === -1 ? rest : rest.slice(0, end);
      const named = [...sentence.matchAll(/`([A-Za-z]+[0-9]+[a-z]*)`/g)].map(
        (match) => match[1] as string
      );
      if (named.length === 0) continue;
      const read: string[] = [];
      const strict = list.exec(sentence);
      if (strict !== null)
        for (const item of (strict[1] as string).split(/, (?:and )?| and /)) {
          const [from, to] = item.replaceAll('`', '').split('–') as [string, string | undefined];
          if (to === undefined) {
            read.push(from);
            continue;
          }
          const [, prefix, first] = /^([A-Za-z]+)([0-9]+)$/.exec(from) ?? [];
          const [, toPrefix, last] = /^([A-Za-z]+)([0-9]+)$/.exec(to) ?? [];
          if (prefix === undefined || prefix !== toPrefix || Number(first) > Number(last))
            faults.push(`${row}: ${from}–${to} is not a range of one prefix`);
          else
            for (let at = Number(first); at <= Number(last); at += 1) read.push(`${prefix}${at}`);
        }
      const endpoints = read.length === 0 ? [] : named;
      const unread = endpoints.filter((id) => !read.includes(id));
      if (strict === null || unread.length > 0)
        faults.push(
          `${row}: the list after "measured" names ${named.join(', ')} and is read as ` +
            `${read.length === 0 ? 'nothing' : read.join(', ')} — write it as \`measured, \`A\`, \`B\` and \`C\`\``
        );
      ids.push(...read);
    }
    if (ids.length > 0) arms.set(row, ids);
    else
      faults.push(`${row}: reopened under the route rule, and names no arm after \`measured, \``);
  }

  return { arms, faults };
};

/** The supporting arms as landings the run must show, labelled by the row whose half they hold. */
export const expectedSupport = (
  arms: ReadonlyMap<string, readonly string[]>,
  declared: Pick<Landings, 'files' | 'positions'>,
  root: string
): { expected: Expected[]; faults: string[] } => {
  const expected: Expected[] = [];
  const faults: string[] = [];
  for (const [row, ids] of arms)
    for (const id of ids) {
      const label = `${row} (internal half)`;
      const file = declared.files.get(id);
      const position = declared.positions.get(id);
      if (file === undefined || position === undefined)
        faults.push(`${label}: ${id} is declared nowhere under the root`);
      else expected.push({ row: label, id, file: join(root, file), ...position });
    }

  return { expected, faults };
};

export const checkRun = (run: {
  readonly status: number | null;
  readonly report: string | undefined;
  readonly startedAt: number;
  readonly expected: readonly Expected[];
}): string[] => {
  if (run.status !== 0) return [`the runner exited with ${String(run.status)}`];
  if (run.report === undefined) return ['the runner wrote no report'];
  let parsed: unknown;
  try {
    parsed = JSON.parse(run.report);
  } catch {
    return ['the report is not JSON'];
  }
  const report = parsed as { startTime?: unknown; tests?: unknown };
  if (typeof report !== 'object' || report === null || !Array.isArray(report.tests))
    return ['the report has no test results'];
  if (typeof report.startTime !== 'number' || report.startTime < run.startedAt)
    return ['the report was not written by this run'];
  const tests = (report.tests as Array<Record<string, unknown>>).map((test) => ({
    file: typeof test['file'] === 'string' ? test['file'] : '',
    name: typeof test['name'] === 'string' ? test['name'] : '',
    line: typeof test['line'] === 'number' ? test['line'] : undefined,
    column: typeof test['column'] === 'number' ? test['column'] : undefined,
    state: typeof test['state'] === 'string' ? test['state'] : 'unknown',
    fails: test['fails'] === true
  }));
  const faults: string[] = [];
  for (const { row, id, file, line, column } of run.expected) {
    const named = tests.filter((test) => test.name.startsWith(`${id}:`));
    const here = named.filter(
      (test) => test.file === file && test.line === line && test.column === column
    );
    if (here.length === 0)
      faults.push(
        named.length === 0
          ? `${row}: ${id} is not in the report — it was never collected`
          : `${row}: ${id} never ran at ${file}:${line}:${column}; what ran under that id was declared elsewhere`
      );
    else if (named.length > 1) faults.push(`${row}: ${id} is in the report ${named.length} times`);
    else if ((here[0] as { fails: boolean }).fails)
      faults.push(
        `${row}: ${id} is registered to expect failure, so its passing means its body failed`
      );
    else if ((here[0] as { state: string }).state !== 'passed')
      faults.push(`${row}: ${id} is ${(here[0] as { state: string }).state}, not passed`);
  }

  return faults;
};
