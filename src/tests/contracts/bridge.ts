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
): { tests: Map<string, Set<string>>; files: Map<string, string>; duplicates: string[] } => {
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

  return { tests, files: owner, duplicates };
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
 * Whether a name is the runner's own: imported from `vitest` under its own
 * name, or bound to nothing in the file (the runner's globals). A local
 * binding that shadows `it` or `describe` — `const it = test.skip` — is not,
 * whatever it holds.
 */
const runnerName = (checker: ts.TypeChecker, name: ts.Identifier): boolean => {
  const declaration = checker.getSymbolAtLocation(name)?.declarations?.[0];
  if (declaration === undefined) return true;
  if (!ts.isImportSpecifier(declaration)) return false;
  // Under its own name: `import { describe as it }` is a suite called `it`.
  const imported = declaration.propertyName ?? declaration.name;
  if (imported.text !== name.text) return false;
  const from = declaration.parent.parent.parent.moduleSpecifier;

  return ts.isStringLiteral(from) && from.text === 'vitest';
};

const checkerFor = (tree: ts.SourceFile): ts.TypeChecker => {
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === tree.fileName ? tree : undefined);
  host.fileExists = (name) => name === tree.fileName;

  return ts.createProgram({ rootNames: [tree.fileName], options, host }).getTypeChecker();
};

/**
 * An arrow function that takes no parameter. Only an arrow: it has no
 * `arguments` of its own, so nothing inside it — a computed method name
 * included — can reach what the runner passed, and with every callback on the
 * path an arrow there is no outer `function` whose `arguments` it could reach.
 */
const bareCallback = (node: ts.Node | undefined): node is ts.ArrowFunction =>
  node !== undefined && ts.isArrowFunction(node) && node.parameters.length === 0;

/** Whether a block can end early — a `return` or a `throw` anywhere in it, outside a function of its own. */
const leaves = (block: ts.Block): boolean => {
  let found = false;
  const look = (node: ts.Node): void => {
    if (found || ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) found = true;
    else ts.forEachChild(node, look);
  };
  for (const statement of block.statements) look(statement);

  return found;
};

/**
 * Which id-shaped arms in a test file are not credited, and which id-shaped
 * titles the arm-id shape cannot read.
 *
 * **What is credited is two shapes and nothing else.** An arm is
 * `it('ID: …', () => { … })` — the runner's own `it`, written directly, a
 * string title, a callback that takes no parameter, and at most a numeric
 * timeout after it — called as a statement of its own, at the top of the file
 * or inside the callback of a suite of the one shape a suite may have:
 * `describe('title', () => { … })`, the runner's own `describe`, a string
 * title and a callback that takes no parameter, itself placed the same way,
 * with no `return` or `throw` in any block on the path, and every statement
 * beside it on the way quiet (`quiet`); a file holding an `only` credits
 * nothing, and only an arm that declares a row is judged. Nothing is
 * interpreted — no modifier, no options object, no table, no test context —
 * so there is nothing to interpret wrongly. Every other shape is refused,
 * including ones the runner would run; that is the price, and a landing in
 * one is rewritten into these two.
 */
export const inspect = (
  source: string,
  file: string,
  declared: ReadonlySet<string> = new Set(),
  landings?: ReadonlySet<string>
): { disabled: string[]; unreadable: string[] } => {
  const tree = parse(source);
  const checker = checkerFor(tree);
  const named = (callee: ts.Expression, name: string): boolean =>
    ts.isIdentifier(callee) && callee.text === name && runnerName(checker, callee);
  const titled = (call: ts.CallExpression): boolean => {
    const title = call.arguments[0];

    return title !== undefined && ts.isStringLiteralLike(title);
  };
  // The name a chain starts from, through members, calls and tagged
  // templates: every `it…` call with an id-shaped title is judged, so
  // `it.skip('CT1: …')` is refused as out of shape rather than passed over.
  const rootOf = (callee: ts.Expression): string | undefined => {
    let at: ts.Expression = callee;
    for (;;) {
      if (ts.isPropertyAccessExpression(at) || ts.isCallExpression(at)) at = at.expression;
      else if (ts.isTaggedTemplateExpression(at)) at = at.tag;
      else return ts.isIdentifier(at) ? at.text : undefined;
    }
  };
  // The root of a chain written directly, for a sibling registration.
  const directRoot = (callee: ts.Expression): ts.Identifier | undefined => {
    let at: ts.Expression = callee;
    for (;;) {
      if (ts.isPropertyAccessExpression(at) || ts.isCallExpression(at)) at = at.expression;
      else if (ts.isTaggedTemplateExpression(at)) at = at.tag;
      else return ts.isIdentifier(at) ? at : undefined;
    }
  };
  const suite = (call: ts.Node): call is ts.CallExpression =>
    ts.isCallExpression(call) &&
    named(call.expression, 'describe') &&
    call.arguments.length === 2 &&
    titled(call) &&
    bareCallback(call.arguments[1]);
  const arm = (call: ts.CallExpression): boolean => {
    const rest = call.arguments.slice(2);

    return (
      named(call.expression, 'it') &&
      titled(call) &&
      bareCallback(call.arguments[1]) &&
      rest.length <= 1 &&
      rest.every((argument) => ts.isNumericLiteral(argument))
    );
  };
  // A statement that runs nothing at collection time beyond registering tests:
  // the list below and nothing else. A hook takes a callback with no
  // parameter, so it cannot reach the test context; nothing is imported from
  // the runner's internals, through which a context is reachable; and every
  // value evaluated while the file is collected is `settled`.
  //
  // **`settled` is an allow-list of expressions, not a search for dangerous
  // ones.** A search missed a computed method name, which is evaluated when
  // its object is built although it sits on a function; a getter, a spread
  // or a coercion would each have been the next. So a value counts only when
  // every part of it is one of these: a literal, a name or a property read, a
  // function (its body runs later), a type-only wrapper, a sign on a number,
  // an array of settled elements, or an object of plain settled properties. A
  // spread, a method, an accessor, a computed key, a template with a hole, an
  // operator and any call are not on the list.
  const settled = (value: ts.Node): boolean => {
    if (
      ts.isStringLiteral(value) ||
      ts.isNumericLiteral(value) ||
      ts.isBigIntLiteral(value) ||
      ts.isNoSubstitutionTemplateLiteral(value) ||
      ts.isRegularExpressionLiteral(value) ||
      value.kind === ts.SyntaxKind.TrueKeyword ||
      value.kind === ts.SyntaxKind.FalseKeyword ||
      value.kind === ts.SyntaxKind.NullKeyword ||
      ts.isIdentifier(value) ||
      ts.isArrowFunction(value) ||
      ts.isFunctionExpression(value)
    )
      return true;
    if (
      ts.isParenthesizedExpression(value) ||
      ts.isAsExpression(value) ||
      ts.isSatisfiesExpression(value) ||
      ts.isNonNullExpression(value) ||
      ts.isTypeAssertionExpression(value) ||
      ts.isPropertyAccessExpression(value)
    )
      return settled(value.expression);
    if (ts.isPrefixUnaryExpression(value))
      return (
        (value.operator === ts.SyntaxKind.MinusToken ||
          value.operator === ts.SyntaxKind.PlusToken) &&
        (ts.isNumericLiteral(value.operand) || ts.isBigIntLiteral(value.operand))
      );
    if (ts.isArrayLiteralExpression(value))
      return value.elements.every((element) => !ts.isSpreadElement(element) && settled(element));
    if (ts.isObjectLiteralExpression(value))
      return value.properties.every(
        (property) =>
          (ts.isShorthandPropertyAssignment(property) &&
            property.objectAssignmentInitializer === undefined) ||
          (ts.isPropertyAssignment(property) &&
            !ts.isComputedPropertyName(property.name) &&
            settled(property.initializer))
      );

    return false;
  };
  const HOOKS = ['beforeEach', 'afterEach', 'beforeAll', 'afterAll'];
  const quiet = (statement: ts.Statement): boolean => {
    if (ts.isImportDeclaration(statement)) {
      const from = statement.moduleSpecifier;

      return (
        ts.isStringLiteral(from) &&
        !from.text.startsWith('vitest/') &&
        !from.text.startsWith('@vitest/')
      );
    }
    if (
      ts.isTypeAliasDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isFunctionDeclaration(statement) ||
      ts.isEmptyStatement(statement)
    )
      return true;
    if (ts.isVariableStatement(statement))
      return statement.declarationList.declarations.every(
        // A plain name: a destructuring pattern evaluates defaults and
        // computed keys of its own, on the binding side.
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          (declaration.initializer === undefined || settled(declaration.initializer))
      );
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression))
      return false;
    const call = statement.expression;
    const root = rootOf(call.expression);
    // Another test or suite registers its own and decides nothing for this one
    // — provided registering it evaluates nothing: every argument of every
    // call in its chain, and every tagged template, is inert outside a function
    // body. `it((beforeEach(…), 'x'), …)` registers a hook while it is read.
    const inert = (link: ts.Expression): boolean => {
      if (ts.isCallExpression(link)) return link.arguments.every(settled) && inert(link.expression);
      if (ts.isTaggedTemplateExpression(link)) return settled(link.template) && inert(link.tag);
      if (ts.isPropertyAccessExpression(link)) return inert(link.expression);

      return ts.isIdentifier(link);
    };
    const sibling = directRoot(call.expression);
    if (
      (root === 'it' || root === 'test' || root === 'describe' || root === 'suite') &&
      sibling !== undefined &&
      runnerName(checker, sibling)
    )
      return inert(call);
    const rest = call.arguments.slice(1);

    return (
      HOOKS.some((hook) => named(call.expression, hook)) &&
      bareCallback(call.arguments[0]) &&
      rest.length <= 1 &&
      rest.every((argument) => ts.isNumericLiteral(argument))
    );
  };
  // Placed as a statement at the top of the file, or in a suite's callback
  // with no early exit, that suite placed the same way all the way up, and
  // every statement beside it on the way quiet.
  const placed = (call: ts.Node): boolean => {
    const statement = call.parent;
    if (!ts.isExpressionStatement(statement) || statement.expression !== call) return false;
    const block = statement.parent;
    if (ts.isSourceFile(block)) return block.statements.every(quiet);
    if (!ts.isBlock(block) || leaves(block) || !block.statements.every(quiet)) return false;
    const holder = block.parent;
    const parent = holder.parent;

    return suite(parent) && parent.arguments[1] === holder && placed(parent);
  };
  const shape = new RegExp(`^(${TEST_ID}):`);
  // An `only` anywhere in the file makes the runner skip every test that does
  // not carry one, so no landing in such a file is credited.
  let only = false;
  const findOnly = (node: ts.Node): void => {
    if (only) return;
    if (
      (ts.isPropertyAccessExpression(node) && node.name.text === 'only') ||
      ((ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) &&
        (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
        node.name.text === 'only')
    )
      only = true;
    else ts.forEachChild(node, findOnly);
  };
  findOnly(tree);
  const disabled: string[] = [];
  const unreadable: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const at = `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`;
      const title = node.arguments[0];
      const text = title !== undefined && ts.isStringLiteralLike(title) ? title.text : undefined;
      const id = text === undefined ? undefined : shape.exec(text)?.[1];
      if (
        rootOf(node.expression) === 'it' &&
        id !== undefined &&
        (landings === undefined || landings.has(id))
      ) {
        if (only) disabled.push(`${at} (the file holds an \`only\`)`);
        else if (!(arm(node) && placed(node)))
          disabled.push(`${at} (not in the shape this bridge credits)`);
      }
      // Only a title that means to be an id — one with a digit in it — is
      // held to the id shape; `it('rejects: an empty filter', …)` is prose.
      const root = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression)
          ? node.expression.expression.text
          : undefined;
      const idLike = text === undefined ? undefined : /^(\S*\d\S*):/.exec(text)?.[1];
      if ((root === 'it' || root === 'test') && idLike !== undefined && !declared.has(idLike))
        unreadable.push(
          `${at} — this bridge cannot read "${idLike}" as an arm id` +
            `${root === 'test' ? ', and it reads only `it(`' : ''}`
        );
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);

  return { disabled, unreadable };
};

export interface Landings {
  readonly tests: Map<string, Set<string>>;
  /** The file each arm is declared in, relative to the root read. */
  readonly files: Map<string, string>;
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
    const found = inspect(
      source,
      file,
      new Set(parsed.rows.keys()),
      new Set([...parsed.rows].filter(([, rows]) => rows.size > 0).map(([id]) => id))
    );
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
}

/**
 * Every landing the roster names, with the file its arm is declared in under
 * `root`, which is an absolute path. A `test:` that names no declared arm is a
 * fault here as well as in `CAT33`, so the run is not judged against a list
 * that silently lost a member.
 */
export const expectedLandings = (
  roster: Roster,
  files: ReadonlyMap<string, string>,
  root: string
): { expected: Expected[]; faults: string[] } => {
  const expected: Expected[] = [];
  const faults: string[] = [];
  for (const [row, { evidence }] of roster) {
    if (!evidence.startsWith('test:')) continue;
    const id = evidence.slice('test:'.length).trim();
    const file = files.get(id);
    if (file === undefined) faults.push(`${row}: test:${id} is declared nowhere under the root`);
    else expected.push({ row, id, file: join(root, file) });
  }

  return { expected, faults };
};

/**
 * Whether one run of the suite shows every landing **ran and passed**.
 *
 * This is the half of rule 6 a static read cannot settle: what the runner
 * actually did. It is judged from the report the runner wrote for this very
 * run — the run's exit status, then the report's presence, shape and start
 * time — and then each expected landing must appear exactly once, in the file
 * it is declared in, with the status `passed`. Missing (never collected, or
 * filtered out), duplicated, `skipped`, `todo` or failed are each a fault. The
 * run's overall success is not used: a skipped test leaves it `true`.
 */
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
  const report = parsed as {
    startTime?: unknown;
    testResults?: Array<{
      name?: unknown;
      assertionResults?: Array<{ title?: unknown; status?: unknown }>;
    }>;
  };
  if (typeof report !== 'object' || report === null || !Array.isArray(report.testResults))
    return ['the report has no test results'];
  if (typeof report.startTime !== 'number' || report.startTime < run.startedAt)
    return ['the report was not written by this run'];
  const seen = new Map<string, Array<{ file: string; status: string }>>();
  for (const result of report.testResults) {
    const file = typeof result.name === 'string' ? result.name : '';
    for (const assertion of result.assertionResults ?? []) {
      const id =
        typeof assertion.title === 'string' ? /^([^:\s]+):/.exec(assertion.title)?.[1] : undefined;
      if (id === undefined) continue;
      seen.set(id, [
        ...(seen.get(id) ?? []),
        { file, status: typeof assertion.status === 'string' ? assertion.status : 'unknown' }
      ]);
    }
  }
  const faults: string[] = [];
  for (const { row, id, file } of run.expected) {
    const found = seen.get(id) ?? [];
    if (found.length === 0)
      faults.push(`${row}: ${id} is not in the report — it was never collected`);
    else if (found.length > 1) faults.push(`${row}: ${id} is in the report ${found.length} times`);
    else if ((found[0] as { file: string }).file !== file)
      faults.push(`${row}: ${id} ran from ${(found[0] as { file: string }).file}, not ${file}`);
    else if ((found[0] as { status: string }).status !== 'passed')
      faults.push(`${row}: ${id} is ${(found[0] as { status: string }).status}, not passed`);
  }

  return faults;
};
