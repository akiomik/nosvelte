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

/** Whether a callee declares an arm this bridge reads: `it(` or `it.fails(`. */
const armCallee = (callee: ts.Expression): boolean =>
  (ts.isIdentifier(callee) && callee.text === 'it') ||
  (ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'it' &&
    callee.name.text === 'fails');

/**
 * The rows each test arm declares, its call text, and the ids declared twice.
 *
 * An arm is a call in the syntax tree — `it('ID: …', …)` or `it.fails(…)` —
 * so text that only looks like one, inside a string or a comment, is not an
 * arm. A marker `@contracts <id> …` belongs to the arm it sits **directly**
 * above: the comment block above the line the call starts on, which a blank
 * line ends. A marker floating above a `describe` or at the top of a file
 * belongs to nothing.
 */
export const declarationsIn = (
  source: string
): { rows: Map<string, Set<string>>; twice: string[]; bodies: Map<string, string> } => {
  const rows = new Map<string, Set<string>>();
  const bodies = new Map<string, string>();
  const twice: string[] = [];
  const tree = parse(source);
  const lines = source.split('\n');
  const shape = new RegExp(`^(${TEST_ID}):`);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && armCallee(node.expression)) {
      const title = node.arguments[0];
      const id =
        title !== undefined && ts.isStringLiteralLike(title)
          ? shape.exec(title.text)?.[1]
          : undefined;
      if (id !== undefined) {
        bodies.set(id, node.getText(tree));
        if (rows.has(id)) twice.push(id);
        const declared = new Set<string>();
        const start = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line;
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

/** A property's own name, when it has one this check can read — `skip`, `'skip'` or `['skip']`. */
const keyOf = (name: ts.Node): string | undefined =>
  ts.isComputedPropertyName(name)
    ? literalOf(name.expression)
    : ts.isIdentifier(name) || ts.isStringLiteralLike(name)
      ? name.text
      : undefined;

/** A string literal's text; a variable in its place is a name nobody can read. */
const literalOf = (expression: ts.Expression): string | undefined =>
  ts.isStringLiteralLike(expression) ? expression.text : undefined;

/**
 * A callee walked down to its root name, with every member named on the way.
 * `opaque` says a member could not be read — `describe[mode]` — so the chain
 * may hold a modifier nobody can see.
 */
const unwind = (
  expression: ts.Expression
): { root: string | undefined; names: string[]; opaque: boolean } => {
  const names: string[] = [];
  let opaque = false;
  let at: ts.Expression = expression;
  for (;;) {
    if (ts.isPropertyAccessExpression(at)) {
      names.unshift(at.name.text);
      at = at.expression;
    } else if (ts.isElementAccessExpression(at)) {
      const name = literalOf(at.argumentExpression);
      if (name === undefined) opaque = true;
      else names.unshift(name);
      at = at.expression;
    } else if (ts.isCallExpression(at)) at = at.expression;
    else if (ts.isTaggedTemplateExpression(at)) at = at.tag;
    else if (ts.isParenthesizedExpression(at) || ts.isNonNullExpression(at)) at = at.expression;
    else break;
  }

  return { root: ts.isIdentifier(at) ? at.text : undefined, names, opaque };
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

const OPTION_KEYS = ['skip', 'only', 'todo'];

/**
 * What a call's options say about whether it runs: `disabled` for a
 * **top-level** `skip`, `only` or `todo` set to anything but `false`,
 * `unreadable` for options this check cannot evaluate, `undefined` for options
 * that leave it running. A property inside a nested object is not an option of
 * this call. A spread of an object, and a `const` in the same file, are
 * followed; anything else that is neither the title, a function, a number nor
 * `undefined` is unreadable rather than assumed harmless.
 */
const optionsOf = (
  call: ts.CallExpression,
  consts: ReadonlyMap<string, ts.Expression>
): 'disabled' | 'unreadable' | undefined => {
  const judge = (value: ts.Expression, depth: number): 'disabled' | 'unreadable' | undefined => {
    if (depth > 8) return 'unreadable';
    if (ts.isParenthesizedExpression(value) || ts.isAsExpression(value))
      return judge(value.expression, depth + 1);
    if (ts.isNumericLiteral(value) || ts.isStringLiteralLike(value)) return undefined;
    if (ts.isIdentifier(value)) {
      if (value.text === 'undefined') return undefined;
      const bound = consts.get(value.text);

      return bound === undefined ? 'unreadable' : judge(bound, depth + 1);
    }
    if (!ts.isObjectLiteralExpression(value)) return 'unreadable';
    let verdict: 'disabled' | 'unreadable' | undefined;
    for (const property of value.properties) {
      if (ts.isSpreadAssignment(property)) {
        verdict = judge(property.expression, depth + 1) ?? verdict;
        if (verdict === 'disabled') return verdict;
        continue;
      }
      const name = property.name === undefined ? undefined : keyOf(property.name);
      if (name === undefined) {
        // A computed key nobody can read may be any of the three.
        verdict = 'unreadable';
        continue;
      }
      if (!OPTION_KEYS.includes(name)) continue;
      if (
        ts.isPropertyAssignment(property) &&
        property.initializer.kind === ts.SyntaxKind.FalseKeyword
      )
        continue;

      return 'disabled';
    }

    return verdict;
  };
  let verdict: 'disabled' | 'unreadable' | undefined;
  for (const [index, argument] of call.arguments.entries()) {
    if (index === 0 || ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) continue;
    verdict = judge(argument, 0) ?? verdict;
    if (verdict === 'disabled') return verdict;
  }

  return verdict;
};

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
          ? literalOf(callee.argumentExpression)
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
  const tree = parse(source);
  // Every `const` in the file, so an options object or a suite alias bound to
  // one can be followed.
  const consts = new Map<string, ts.Expression>();
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    )
      consts.set(node.name.text, node.initializer);
    ts.forEachChild(node, collect);
  };
  collect(tree);
  // A chain whose root is a `const` bound to another chain is that chain:
  // `const quiet = describe.skip; quiet('x', …)`.
  const resolve = (
    expression: ts.Expression
  ): { root: string | undefined; names: string[]; opaque: boolean } => {
    let chain = unwind(expression);
    for (let depth = 0; depth < 8; depth += 1) {
      const bound = chain.root === undefined ? undefined : consts.get(chain.root);
      if (bound === undefined || SUITES.has(chain.root as string)) break;
      const inner = unwind(bound);
      chain = {
        root: inner.root,
        names: [...inner.names, ...chain.names],
        opaque: inner.opaque || chain.opaque
      };
    }

    return chain;
  };
  const disabled: string[] = [];
  const unreadable: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && outermost(node)) {
      const { root, names, opaque } = resolve(node.expression);
      if (root !== undefined && SUITES.has(root)) {
        const at = `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`;
        if (names.some((name) => DISABLING.has(name))) disabled.push(at);
        if (opaque) disabled.push(`${at} (a chain this bridge cannot read)`);
        const options = optionsOf(node, consts);
        if (options === 'disabled') disabled.push(`${at} (disabled by its options)`);
        if (options === 'unreadable') disabled.push(`${at} (options this bridge cannot read)`);
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
