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

const SUITES = new Set(['it', 'test', 'describe', 'suite']);
const ARMS = new Set(['it', 'test']);
const DISABLING = new Set(['skip', 'only', 'todo', 'skipIf', 'runIf']);

/** A callee walked down to its root name, with every member named on the way. */
const unwind = (expression: ts.Expression): { root: string | undefined; names: string[] } => {
  const names: string[] = [];
  let at: ts.Expression = expression;
  for (;;) {
    if (ts.isPropertyAccessExpression(at)) {
      names.unshift(at.name.text);
      at = at.expression;
    } else if (ts.isElementAccessExpression(at) && ts.isStringLiteralLike(at.argumentExpression)) {
      names.unshift(at.argumentExpression.text);
      at = at.expression;
    } else if (ts.isCallExpression(at)) at = at.expression;
    else if (ts.isTaggedTemplateExpression(at)) at = at.tag;
    else if (ts.isParenthesizedExpression(at) || ts.isNonNullExpression(at)) at = at.expression;
    else break;
  }

  return { root: ts.isIdentifier(at) ? at.text : undefined, names };
};

/** Whether `call` is the last link of its chain rather than a link inside one. */
const outermost = (call: ts.CallExpression): boolean => {
  const parent = call.parent;

  return !(
    ((ts.isCallExpression(parent) ||
      ts.isPropertyAccessExpression(parent) ||
      ts.isElementAccessExpression(parent)) &&
      parent.expression === call) ||
    (ts.isTaggedTemplateExpression(parent) && parent.tag === call)
  );
};

/** A property's own name, when it has one this check can read. */
const keyOf = (name: ts.Node): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : undefined;

/**
 * Whether the call's options disable it: a **top-level** `skip`, `only` or
 * `todo` set to anything but `false`. A property inside a nested object is
 * not an option of this call.
 */
const disablingOptions = (call: ts.CallExpression): boolean =>
  call.arguments.some(
    (argument) =>
      ts.isObjectLiteralExpression(argument) &&
      argument.properties.some((property) => {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))
          return false;
        const name = keyOf(property.name);
        if (name === undefined || !['skip', 'only', 'todo'].includes(name)) return false;

        return !(
          ts.isPropertyAssignment(property) &&
          property.initializer.kind === ts.SyntaxKind.FalseKeyword
        );
      })
  );

/**
 * Whether an arm's callback skips the test through its context: a call to
 * `<param>.skip(…)`, or to whatever local name the parameter's `skip` was
 * destructured into — in an arrow function or a `function` alike.
 */
const skipsThroughContext = (call: ts.CallExpression): boolean => {
  const callback = [...call.arguments]
    .reverse()
    .find(
      (argument): argument is ts.ArrowFunction | ts.FunctionExpression =>
        ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)
    );
  const parameter = callback?.parameters[0]?.name;
  if (callback === undefined || parameter === undefined) return false;
  const context = ts.isIdentifier(parameter) ? parameter.text : undefined;
  const aliases = new Set<string>();
  if (ts.isObjectBindingPattern(parameter))
    for (const element of parameter.elements)
      if (keyOf(element.propertyName ?? element.name) === 'skip' && ts.isIdentifier(element.name))
        aliases.add(element.name.text);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && aliases.has(callee.text)) found = true;
      const member = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isElementAccessExpression(callee)
          ? keyOf(callee.argumentExpression)
          : undefined;
      if (
        context !== undefined &&
        member === 'skip' &&
        (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
        ts.isIdentifier(callee.expression) &&
        callee.expression.text === context
      )
        found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(callback.body);

  return found;
};

/**
 * Why each suite or arm in a test file would not run, or could not be read,
 * found in the file's syntax tree rather than in its text: a disabling member
 * anywhere in the chain (`.skip`, `.only`, `.todo`, `.skipIf`, `.runIf`,
 * including after a curried call or a tagged template), a disabling top-level
 * option, a table-driven arm (`it.each`, `it.for`), an arm that skips itself
 * through its test context, and an id-shaped title the arm-id shape does not
 * read. What it cannot see is a decision made at run time, such as a suite
 * declared only under an `if`.
 */
export const inspect = (
  source: string,
  file: string,
  declared: ReadonlySet<string> = new Set()
): { disabled: string[]; unreadable: string[] } => {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const disabled: string[] = [];
  const unreadable: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && outermost(node)) {
      const { root, names } = unwind(node.expression);
      if (root !== undefined && SUITES.has(root)) {
        const at = `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`;
        if (names.some((name) => DISABLING.has(name))) disabled.push(at);
        if (disablingOptions(node)) disabled.push(`${at} (disabled by its options)`);
        if (ARMS.has(root) && names.some((name) => name === 'each' || name === 'for'))
          disabled.push(`${at} (a table-driven arm; this bridge records one id per arm)`);
        if (ARMS.has(root) && skipsThroughContext(node))
          disabled.push(`${at} (skipped from inside its body)`);
        // Only a title that means to be an id — one with a digit in it — is
        // held to the id shape; `it('rejects: an empty filter', …)` is prose.
        const title = node.arguments[0];
        const id =
          ARMS.has(root) && title !== undefined && ts.isStringLiteralLike(title)
            ? /^(\S*\d\S*):/.exec(title.text)?.[1]
            : undefined;
        if (id !== undefined && !declared.has(id))
          unreadable.push(
            `${at} — this bridge cannot read "${id}" as an arm id` +
              `${root === 'test' ? ', and it reads only `it(`' : ''}`
          );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);

  return { disabled, unreadable };
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
    const found = inspect(source, file, new Set(parsed.rows.keys()));
    disabled.push(...found.disabled);
    unreadable.push(...found.unreadable);
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
