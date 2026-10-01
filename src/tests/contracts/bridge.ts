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
 * A callee walked down to its root, with every member named on the way.
 * `opaque` says a member could not be read — `describe[mode]` — so the chain
 * may hold a modifier nobody can see.
 */
const unwind = (
  expression: ts.Expression
): { root: ts.Identifier | undefined; names: string[]; opaque: boolean } => {
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

  return { root: ts.isIdentifier(at) ? at : undefined, names, opaque };
};

/**
 * What a name refers to **where it is used**: the initializer of the `const`
 * the type checker binds it to, `'unknown'` for any other binding — a
 * parameter, a `let`, an import — and `undefined` for a name bound to nothing
 * in the file. Scope is the checker's, so an inner `const` with the same name
 * shadows an outer one only where it is in scope.
 */
type Binding = ts.Expression | 'unknown' | undefined;

const checkerFor = (tree: ts.SourceFile): ts.TypeChecker => {
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === tree.fileName ? tree : undefined);
  host.fileExists = (name) => name === tree.fileName;

  return ts.createProgram({ rootNames: [tree.fileName], options, host }).getTypeChecker();
};

const bindingOf = (checker: ts.TypeChecker, name: ts.Identifier): Binding => {
  const declaration = checker.getSymbolAtLocation(name)?.declarations?.[0];
  if (declaration === undefined) return undefined;
  if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    (ts.getCombinedNodeFlags(declaration) & ts.NodeFlags.Const) !== 0
  )
    return declaration.initializer;

  return 'unknown';
};

/**
 * Whether a name is the runner's own: imported from `vitest`, or bound to
 * nothing in the file (the runner's globals). A local binding that shadows
 * `it` or `describe` — `const it = test.skip` — is not, whatever it holds.
 */
const runnerName = (checker: ts.TypeChecker, name: ts.Identifier): boolean => {
  const declaration = checker.getSymbolAtLocation(name)?.declarations?.[0];
  if (declaration === undefined) return true;
  if (!ts.isImportSpecifier(declaration)) return false;
  const from = declaration.parent.parent.parent.moduleSpecifier;

  return ts.isStringLiteral(from) && from.text === 'vitest';
};

/**
 * Whether a table-driven suite has a row to run. `describe.each([])` declares
 * nothing, so the arms written inside it never run. A table counts only when
 * it can be seen to hold a row: an array literal with an element that is not
 * a spread, a `const` bound to one, or a tagged template with a value in it.
 */
const tableHasRow = (suite: ts.CallExpression, checker: ts.TypeChecker): boolean => {
  const rows = (table: ts.Node | undefined, depth: number): boolean => {
    if (table === undefined || depth > 8) return false;
    if (ts.isArrayLiteralExpression(table))
      return table.elements.some((element) => !ts.isSpreadElement(element));
    if (ts.isTemplateExpression(table)) return table.templateSpans.length > 0;
    if (ts.isIdentifier(table)) {
      const bound = bindingOf(checker, table);

      return bound !== undefined && bound !== 'unknown' && rows(bound, depth + 1);
    }

    return false;
  };
  let at: ts.Expression = suite.expression;
  for (;;) {
    if (ts.isCallExpression(at)) {
      const callee = at.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isElementAccessExpression(callee)
          ? literalOf(callee.argumentExpression)
          : undefined;
      if (name === 'each' || name === 'for') return rows(at.arguments[0], 0);
      at = callee;
    } else if (ts.isTaggedTemplateExpression(at)) {
      const tag = at.tag;
      if (
        ts.isPropertyAccessExpression(tag) &&
        (tag.name.text === 'each' || tag.name.text === 'for')
      )
        return rows(at.template, 0);
      at = tag;
    } else if (ts.isPropertyAccessExpression(at) || ts.isElementAccessExpression(at))
      at = at.expression;
    else return true;
  }
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

const OPTION_KEYS = ['skip', 'only', 'todo'] as const;
type Setting = 'runs' | 'off' | 'unknown';

/**
 * What a call's options say about whether it runs: `disabled` when `skip`,
 * `only` or `todo` ends up truthy, `unreadable` when one of them ends up with a
 * value this check cannot evaluate, `undefined` when all of them leave it
 * running.
 *
 * The properties are folded **in order**, as the runtime folds them, so a
 * later `skip: false` overrides a spread that set it, and only the final value
 * of each key counts. A property inside a nested object is not an option. A
 * spread, a shorthand property and a name are followed to the `const` they are
 * bound to where they are used; anything else this check cannot evaluate — a
 * call, a parameter, a computed key from a variable — leaves the keys it could
 * set unknown rather than assumed harmless. A title, a function, a number or a
 * string is not an options argument.
 */
const optionsOf = (
  call: ts.CallExpression,
  checker: ts.TypeChecker
): 'disabled' | 'unreadable' | undefined => {
  const settings = new Map<string, Setting>();
  const unknownAll = (): void => {
    for (const key of OPTION_KEYS) settings.set(key, 'unknown');
  };
  const settingOf = (value: ts.Expression, depth: number): Setting => {
    if (depth > 8) return 'unknown';
    if (ts.isParenthesizedExpression(value) || ts.isAsExpression(value))
      return settingOf(value.expression, depth + 1);
    if (value.kind === ts.SyntaxKind.FalseKeyword || value.kind === ts.SyntaxKind.NullKeyword)
      return 'runs';
    if (value.kind === ts.SyntaxKind.TrueKeyword) return 'off';
    if (ts.isNumericLiteral(value)) return Number(value.text) === 0 ? 'runs' : 'off';
    if (ts.isStringLiteralLike(value)) return value.text === '' ? 'runs' : 'off';
    if (ts.isIdentifier(value)) {
      if (value.text === 'undefined') return 'runs';
      const bound = bindingOf(checker, value);

      return bound === undefined || bound === 'unknown' ? 'unknown' : settingOf(bound, depth + 1);
    }

    return 'unknown';
  };
  const fold = (value: ts.Expression, depth: number): void => {
    if (depth > 8) return unknownAll();
    if (ts.isParenthesizedExpression(value) || ts.isAsExpression(value))
      return fold(value.expression, depth + 1);
    if (ts.isNumericLiteral(value) || ts.isStringLiteralLike(value)) return;
    if (ts.isIdentifier(value)) {
      if (value.text === 'undefined') return;
      const bound = bindingOf(checker, value);

      return bound === undefined || bound === 'unknown' ? unknownAll() : fold(bound, depth + 1);
    }
    if (!ts.isObjectLiteralExpression(value)) return unknownAll();
    for (const property of value.properties) {
      if (ts.isSpreadAssignment(property)) {
        fold(property.expression, depth + 1);
        continue;
      }
      const name = keyOf(property.name);
      if (name === undefined) {
        // A computed key nobody can read may be any of the three.
        unknownAll();
        continue;
      }
      if (!(OPTION_KEYS as readonly string[]).includes(name)) continue;
      settings.set(
        name,
        ts.isPropertyAssignment(property)
          ? settingOf(property.initializer, depth + 1)
          : ts.isShorthandPropertyAssignment(property)
            ? settingOf(property.name, depth + 1)
            : 'unknown'
      );
    }
  };
  for (const [index, argument] of call.arguments.entries())
    if (index > 0 && !ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument))
      fold(argument, 0);
  const final = [...settings.values()];
  if (final.includes('off')) return 'disabled';

  return final.includes('unknown') ? 'unreadable' : undefined;
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
 * read.
 *
 * Arms are credited by an allow-list (`credited`), and that is where this
 * check stops: a shape outside it is refused rather than modelled, so a
 * refusal of something the runner would run is the price and not a defect,
 * while crediting something inside it that the runner would not run is. What
 * no static read can see — an environment variable, a command-line filter,
 * the runner's include and exclude — is outside it. 0005 states the same line
 * beside rule 6.
 */
export const inspect = (
  source: string,
  file: string,
  declared: ReadonlySet<string> = new Set()
): { disabled: string[]; unreadable: string[] } => {
  const tree = parse(source);
  const checker = checkerFor(tree);
  // A chain whose root is a `const` bound to another chain is that chain:
  // `const quiet = describe.skip; quiet('x', …)`. A root bound some other way
  // — a parameter, a `let` — cannot be read.
  const resolve = (
    expression: ts.Expression
  ): { root: string | undefined; names: string[]; opaque: boolean } => {
    let chain = unwind(expression);
    for (let depth = 0; depth < 8; depth += 1) {
      const root = chain.root;
      if (root === undefined) break;
      if (SUITES.has(root.text)) {
        // A known name counts only when it is the runner's own.
        if (!runnerName(checker, root)) chain = { ...chain, root: undefined };
        break;
      }
      const bound = bindingOf(checker, root);
      if (bound === undefined || bound === 'unknown') break;
      const inner = unwind(bound);
      chain = {
        root: inner.root,
        names: [...inner.names, ...chain.names],
        opaque: inner.opaque || chain.opaque
      };
    }

    return { root: chain.root?.text, names: chain.names, opaque: chain.opaque };
  };
  const disabled: string[] = [];
  const unreadable: string[] = [];
  const shape = new RegExp(`^(${TEST_ID}):`);
  // **The shape an arm is credited in, as an allow-list.** An arm counts only
  // when it is called as a statement of its own — or as an arrow's whole body —
  // at the top of the file or in the callback of a `describe` or `suite` chain,
  // that chain placed the same way, all the way up; and no block on the way
  // holds a `return` or a `throw`. Anything else — an `if`, a loop, a `try`, a
  // helper call, a function declaration, a suite reached through a `let` — is
  // a place where whether the arm runs is decided by something this check does
  // not read, so it is refused rather than modelled. The chain modifiers and
  // options of every suite on the way are judged where that suite is visited.
  // Whether a block can end early — a `return` or a `throw` anywhere in it,
  // nested statements included, but not inside a function of its own.
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
  const credited = (arm: ts.CallExpression): boolean => {
    if (resolve(arm.expression).root !== 'it') return false;
    let node: ts.Node = arm;
    for (;;) {
      const parent = node.parent;
      let holder: ts.Node;
      if (ts.isExpressionStatement(parent) && parent.expression === node) {
        const block = parent.parent;
        if (ts.isSourceFile(block)) return true;
        if (!ts.isBlock(block)) return false;
        if (leaves(block)) return false;
        holder = block.parent;
      } else if (ts.isArrowFunction(parent) && parent.body === node) holder = parent;
      else return false;
      if (!ts.isArrowFunction(holder) && !ts.isFunctionExpression(holder)) return false;
      const suite = holder.parent;
      if (!ts.isCallExpression(suite) || !suite.arguments.some((argument) => argument === holder))
        return false;
      const { root } = resolve(suite.expression);
      if (root !== 'describe' && root !== 'suite') return false;
      if (!tableHasRow(suite, checker)) return false;
      node = suite;
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && armCallee(node.expression)) {
      const title = node.arguments[0];
      if (
        title !== undefined &&
        ts.isStringLiteralLike(title) &&
        shape.test(title.text) &&
        !credited(node)
      )
        disabled.push(
          `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1} (declared where this bridge does not credit an arm)`
        );
    }
    if (ts.isCallExpression(node) && outermost(node)) {
      const { root, names, opaque } = resolve(node.expression);
      if (root !== undefined && SUITES.has(root)) {
        const at = `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}`;
        if (names.some((name) => DISABLING.has(name))) disabled.push(at);
        if (opaque) disabled.push(`${at} (a chain this bridge cannot read)`);
        const options = optionsOf(node, checker);
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
