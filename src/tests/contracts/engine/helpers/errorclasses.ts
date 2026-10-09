/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The library's error classes, as a population the arms share: which classes
 * are `Error`s (parsed, not matched), where each is constructed and what call
 * that construction is an argument to, every constructor the library calls,
 * and one instance of each class built the way a consumer would.
 *
 * **One construction for every arm that reads it.** `WI23`, `WI24` and `WI28`
 * read this population, and so does `B5-C9`'s landing, `FC1`: two
 * transcriptions of a population are how two arms come to disagree about
 * which classes are in it.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse as parseComponent } from 'svelte/compiler';
import ts from 'typescript';

import {
  AccumulatorContractError,
  AttemptAbandonedError,
  MissingRandomnessError
} from '$lib/v1/attempt.js';
import { MissingProviderError, MissingVerifierError } from '$lib/v1/context.svelte.js';
import { IncompleteResultError } from '$lib/v1/engine.js';
import { UnsupportedFilterError } from '$lib/v1/key.js';
import { InvalidDescriptorError } from '$lib/v1/normalize.js';
import { ProviderDisposedError, ReqFailure } from '$lib/v1/own.js';
import { RelayNotInScopeError, RequestTransportIncompatibleError } from '$lib/v1/reqerror.js';
import {
  InvalidRelayInputError,
  InvalidRelayScopeError,
  NonIdempotentRelayUrlError,
  RelayConfigurationError,
  TransportIncompatibleError,
  TransportKeyMismatchError
} from '$lib/v1/scope.svelte.js';

/** The library's own modules: `src/lib/v1`, and every directory under it. */
const lib = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../lib/v1');

/**
 * A parsed module: where it is, relative to the library, and its syntax tree —
 * and, for a component, the lines everything outside its scripts constructs
 * anything on, which the tree does not hold, or that it could not be read.
 */
export type Module = {
  module: string;
  file: ts.SourceFile;
  markup?: { readonly constructsOn: readonly number[] } | { readonly unreadable: true };
};

/** Source text parsed as TypeScript, under the name it is reported by. */
export const parsedAs = (module: string, text: string): Module => ({
  module,
  file: ts.createSourceFile(module, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
});

/** A span of text blanked to spaces, its newlines kept, so every line stays where it was. */
const blanked = (text: string): string => text.replace(/[^\n]/g, ' ');

/**
 * A component, read as the scans read a module: its scripts parsed where they
 * stand in the file, and everything else in it — the markup, and the
 * `<svelte:options>` the compiler keeps beside it — read by Svelte's own parser
 * for anything that constructs, so that what runs outside a script is not a
 * place the scans silently do not look ({@link whatTheScanCannotRead}).
 *
 * **The component is the compiler's to read, all of it.** The markup was read
 * with `/\{[^{}]*\bnew\b[^{}]*\}/`, and a construction whose arguments held an
 * object literal had a brace inside it and matched nothing; then the parser's
 * `fragment` alone was read, and a class built in `customElement`'s `extend`
 * option, and `Reflect.construct` in an expression, each left the landing green —
 * all measured. So every node outside the two scripts is visited, and a `new`,
 * `Reflect` read in any position, or anything named `construct` there is a
 * construction the scans refuse.
 */
export const componentAs = (module: string, source: string): Module => {
  let scripts = blanked(source);
  let markup: NonNullable<Module['markup']>;
  try {
    const constructsAt: number[] = [];
    const tree = parseComponent(source, { modern: true });
    // **Where each script stands is the parser's answer, not a pattern's.** A
    // `generics="T extends Record<string, unknown>"` attribute put a `>` inside
    // the opening tag, the pattern took it for the tag's end, and the script's
    // construction was parsed as something else — the landing green, measured.
    for (const script of [tree.instance, tree.module]) {
      const { start, end } = (script?.content ?? {}) as { start?: unknown; end?: unknown };
      if (typeof start === 'number' && typeof end === 'number')
        scripts = scripts.slice(0, start) + source.slice(start, end) + scripts.slice(end);
    }
    // The scripts are the TypeScript parse's to read.
    const seen = new Set<unknown>([tree.instance, tree.module]);
    const visit = (node: unknown): void => {
      if (typeof node !== 'object' || node === null || seen.has(node)) return;
      seen.add(node);
      const { type, start, name, value } = node as {
        type?: unknown;
        start?: unknown;
        name?: unknown;
        value?: unknown;
      };
      // A construction, `Reflect` read in any position, or anything named
      // `construct`, however it is reached.
      const constructs =
        type === 'NewExpression' ||
        (type === 'Identifier' && (name === 'Reflect' || name === 'construct')) ||
        (type === 'Literal' && value === 'construct');
      if (constructs && typeof start === 'number') constructsAt.push(start);
      for (const child of Object.values(node)) visit(child);
    };
    visit(tree);
    markup = {
      constructsOn: [
        ...new Set(constructsAt.map((at) => source.slice(0, at).split('\n').length))
      ].sort((one, other) => one - other)
    };
  } catch {
    markup = { unreadable: true };
  }
  return { ...parsedAs(module, scripts), markup };
};

/**
 * Every class in this library whose instances are `Error`s — parsed, not
 * matched.
 *
 * **The population used to be `/class (\w*Error) extends [\w.]+ \{/`, and a
 * reviewer walked past it six ways.** `class X extends Error implements Y {`
 * and `class X extends Base<string> {` do not end where that pattern expects
 * a brace; `export const X = class extends Error {}` has no name in that
 * position; and a class whose name does not end in `Error` was never in the
 * population at all. Two of the six were about *where* the registration sat —
 * inside a method nothing calls, or under `if (Math.random() < 0)` — and a
 * better pattern does not answer those. Nothing read from source can: they are
 * answered by asking the run time, which is what the second half of `WR23` and
 * the whole of `WR24` do.
 *
 * So the population is the parser's: every class-like declaration in the
 * library, under the name it is reachable by, closed transitively over
 * `extends`. A class that reaches `Error` is in it, whatever it is called and
 * however it is written.
 */
export const parsedModules = (): Module[] =>
  (readdirSync(lib, { recursive: true, encoding: 'utf8' }) as string[])
    .map((name) => join(lib, name))
    .filter((path) => path.endsWith('.ts') || path.endsWith('.svelte'))
    .sort()
    .map((path) => {
      const source = readFileSync(path, 'utf8');
      return path.endsWith('.svelte')
        ? componentAs(relative(lib, path), source)
        : parsedAs(relative(lib, path), source);
    });

/** The name a class is reachable by: its own, or the binding it is assigned to. */
const classNameOf = (node: ts.ClassLikeDeclaration): string | undefined => {
  if (node.name !== undefined) return node.name.text;
  const parent = node.parent as ts.Node | undefined;
  if (parent !== undefined && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return undefined;
};

/** What it extends, by name — through type arguments, and past `implements`. */
const extendedNameOf = (node: ts.ClassLikeDeclaration): string | undefined => {
  const clause = node.heritageClauses?.find((each) => each.token === ts.SyntaxKind.ExtendsKeyword);
  const expression = clause?.types[0]?.expression;
  if (expression === undefined) return undefined;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return undefined;
};

/**
 * The platform's own `Error` classes: a class reaching any of them is an
 * `Error`, so `extends RangeError` is in the population as `extends Error` is.
 */
const ERROR_ROOTS = new Set([
  'Error',
  'AggregateError',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError'
]);

export const errorClasses = (
  modules: readonly Module[] = parsedModules()
): { module: string; name: string }[] => {
  const declared: { module: string; name: string; extends: string | undefined }[] = [];
  for (const { module, file } of modules) {
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const name = classNameOf(node);
        if (name !== undefined) declared.push({ module, name, extends: extendedNameOf(node) });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  // Transitive, so the five refusals that extend `RelayConfigurationError` are
  // in the population without naming their base here.
  const reaching = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const each of declared) {
      if (reaching.has(each.name) || each.extends === undefined) continue;
      if (ERROR_ROOTS.has(each.extends) || reaching.has(each.extends)) {
        reaching.add(each.name);
        changed = true;
      }
    }
  }
  return declared
    .filter((each) => reaching.has(each.name))
    .map(({ module, name }) => ({ module, name }));
};

/** An expression with the parentheses around it taken off: `new (X)()` constructs `X`. */
const unparenthesised = (expression: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(expression) ? unparenthesised(expression.expression) : expression;

/**
 * Every `new X(...)` of one of those classes inside the library, with the call
 * it sits directly inside.
 *
 * The wrapper has to be the expression the construction is an argument *to*.
 * A mint somewhere else in the same function — or in a method nothing calls,
 * or under a branch that cannot be taken — is not this, which is the whole
 * difference between reading a class body for the word `ownedByLibrary` and
 * reading where the object goes the moment it exists.
 */
export const constructionSites = (
  population: ReadonlySet<string>,
  modules: readonly Module[] = parsedModules()
): { where: string; name: string; wrapper: string | undefined }[] => {
  const sites: { where: string; name: string; wrapper: string | undefined }[] = [];
  for (const { module, file } of modules) {
    const visit = (node: ts.Node): void => {
      const callee = ts.isNewExpression(node) ? unparenthesised(node.expression) : undefined;
      if (callee !== undefined && ts.isIdentifier(callee) && population.has(callee.text)) {
        // The construction as an argument, past any parentheses around it.
        let argument: ts.Node = node;
        while (ts.isParenthesizedExpression(argument.parent)) argument = argument.parent;
        const parent = argument.parent as ts.Node | undefined;
        const wrapper =
          parent !== undefined &&
          ts.isCallExpression(parent) &&
          ts.isIdentifier(parent.expression) &&
          parent.arguments[0] === argument
            ? parent.expression.text
            : undefined;
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        sites.push({ where: `${module}:${line + 1}`, name: callee.text, wrapper });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return sites;
};

/**
 * Every `new X(...)` in the library, whatever `X` is.
 *
 * **The site scan reads a declared class name, and that is a hole an alias
 * walks through.** `const Refusal = InvalidDescriptorError; throw new
 * Refusal(…)` is a real refusal branch, it is unminted, and it was invisible:
 * measured, the whole wiring suite stayed green and the value came out of
 * `capture` copied — class gone, `field` gone, `code` replaced by the door's.
 * The pinned site count catches a removal and not an addition.
 *
 * So the population is read from the other side as well: every constructor
 * this library calls has to be a class it knows about or a name declared here
 * as not one. A new alias is neither, so it fails, and the fix is either to
 * mint it or to say what it is.
 */
export const everyConstructorCalled = (
  modules: readonly Module[] = parsedModules()
): { where: string; callee: string }[] => {
  const called: { where: string; callee: string }[] = [];
  for (const { module, file } of modules) {
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        const callee = unparenthesised(node.expression);
        called.push({
          where: `${module}:${line + 1}`,
          callee: ts.isIdentifier(callee) ? callee.text : callee.getText(file)
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return called;
};

/**
 * Constructors this library calls that are not error classes, by name and
 * because somebody wrote them down.
 *
 * Anything not here and not an error class is a constructor nobody has
 * classified — which is what an aliased error class looks like.
 */
export const NOT_AN_ERROR_CLASS = [
  'AbortController',
  'Date',
  'Error',
  'Map',
  'Observable',
  'Promise',
  'Proxy',
  'QueryClient',
  'Set',
  // v1's fold refuses a packet this library did not make with the platform's own
  // class (`foldEvent`).
  'TypeError',
  'Uint8Array',
  'Subject',
  'URL',
  'WeakMap',
  'WeakSet'
];

/** The two calls that say "this library made this object, here". */
export const MINTERS = ['ownedByLibrary', 'sealOwned'];

/**
 * What the scans above cannot vouch for, as a failing line each.
 *
 * **They read spellings, and spellings walked past them.** A minter is
 * recognised by the name it is called through, so `import { hardenOwned as
 * ownedByLibrary }` made an unminted construction read as minted, and
 * `Reflect.construct(InvalidDescriptorError, …)` is a construction with no `new`
 * in it — measured, each left the landing green. And a class whose `extends` is
 * not a name — `extends (Error)`, `extends mixin(Error)` — or that has no name to
 * be held by, `export default class extends Error`, is not in the population the
 * scan builds. Each is refused here rather than read, so the next spelling is a
 * decision rather than a site the scan does not see.
 *
 * **A binding is refused by where the name stands, not by which declaration
 * stands there.** The first version listed the declarations that bind a name,
 * and a named function expression — `(function ownedByLibrary(v) { … })()` —
 * was not on the list: an unminted refusal read as minted, landing and `WI23`
 * green. So the list is the other one now, the places a name stands without
 * binding anything — a member, a property, an export — and a minter's name
 * standing anywhere else as a declaration's name is refused, but for two: the
 * function declared at the top of the library's own `owned.ts`, and an import
 * of that name, unaliased, whose path resolves to that file. Both are read by
 * what they are, not by how they are spelled: a nested `function
 * ownedByLibrary` inside `owned.ts` read as a minter and left the landing green,
 * and so did, to the scan, an import from another directory's `owned.js` that
 * re-exports `hardenOwned` under the name — both measured. Since every other
 * binding of the name is refused, and scope is lexical, every call through the
 * name reaches one of those two. And a construction in a component's markup, which the parsed
 * scripts do not hold, is refused rather than passed over.
 */
export const whatTheScanCannotRead = (modules: readonly Module[] = parsedModules()): string[] => {
  const unread: string[] = [];
  for (const { module, file, markup } of modules) {
    const at = (node: ts.Node): string =>
      `${module}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}`;
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const clause = node.heritageClauses?.find(
          (each) => each.token === ts.SyntaxKind.ExtendsKeyword
        );
        if (clause !== undefined && extendedNameOf(node) === undefined)
          unread.push(`${at(node)}: a class extending something that is not a name`);
        if (clause !== undefined && classNameOf(node) === undefined)
          unread.push(`${at(node)}: a class with no name to be held by`);
      }
      // **`construct` is refused by its name, whatever reaches it.** The check
      // read `Reflect.construct` with `Reflect` named directly, and
      // `globalThis.Reflect.construct(…)` and `const { construct } = Reflect`
      // walked past it — measured. The library has no other use for the word.
      if (
        (ts.isIdentifier(node) && node.text === 'construct') ||
        (ts.isStringLiteralLike(node) && node.text === 'construct')
      )
        unread.push(`${at(node)}: a construction through \`construct\``);
      if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Reflect'
      )
        unread.push(`${at(node)}: \`Reflect\` read by a computed name`);
      if (ts.isIdentifier(node) && MINTERS.includes(node.text)) {
        const parent = node.parent as ts.Node | undefined;
        const named = parent !== undefined && (parent as { name?: ts.Node }).name === node;
        const bindsNothing =
          parent !== undefined &&
          (ts.isPropertyAccessExpression(parent) ||
            ts.isPropertyAssignment(parent) ||
            ts.isPropertyDeclaration(parent) ||
            ts.isPropertySignature(parent) ||
            ts.isMethodDeclaration(parent) ||
            ts.isMethodSignature(parent) ||
            ts.isGetAccessorDeclaration(parent) ||
            ts.isSetAccessorDeclaration(parent) ||
            ts.isExportSpecifier(parent) ||
            ts.isEnumMember(parent));
        if (named && !bindsNothing) {
          const specifier = ts.isImportSpecifier(parent)
            ? parent.parent.parent.parent.moduleSpecifier
            : undefined;
          const importedAsItself =
            ts.isImportSpecifier(parent) &&
            parent.propertyName === undefined &&
            specifier !== undefined &&
            ts.isStringLiteral(specifier) &&
            /^\.\.?\//.test(specifier.text) &&
            posix.normalize(posix.join(posix.dirname(module), specifier.text)) === 'owned.js';
          const declaredAtHome =
            module === 'owned.ts' && ts.isFunctionDeclaration(parent) && parent.parent === file;
          if (!importedAsItself && !declaredAtHome)
            unread.push(`${at(node)}: \`${node.text}\` bound to something it may not be`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    // What the parser could not read is not a module the scan has read.
    if ((file as unknown as { parseDiagnostics: readonly unknown[] }).parseDiagnostics.length > 0)
      unread.push(`${module}: source the parser could not read`);
    if (markup !== undefined && 'unreadable' in markup)
      unread.push(`${module}: a component whose markup the parser could not read`);
    for (const line of markup !== undefined && 'constructsOn' in markup ? markup.constructsOn : [])
      unread.push(
        `${module}:${String(line)}: a construction outside the scripts, which no scan reads`
      );
  }
  return unread;
};

/**
 * One instance of each class, built the way a **consumer** would.
 *
 * Written out on purpose, and required below to cover the parsed population
 * exactly: a class added to the library is a decision here — what a consumer
 * would pass, and what the run time then has to say about the result — rather
 * than a member that quietly falls outside a scan.
 *
 * **In v1 it covers the population on its own.** The spike's did not:
 * `ProviderDisposedError` was not exported from its module there, so a consumer
 * could not build one and it was listed in {@link libraryOnly} instead. v1
 * exports it from `own.ts` — not from the published entry, which carries none of
 * these constructors but the four `PB8` reads — so it is built here like the
 * rest, and {@link libraryOnly} is empty.
 */
export const asAConsumerWould: Readonly<Record<string, () => Error>> = {
  MissingRandomnessError: () => new MissingRandomnessError(),
  AttemptAbandonedError: () => new AttemptAbandonedError('a reason I chose'),
  AccumulatorContractError: () => new AccumulatorContractError('a reason I chose'),
  MissingProviderError: () => new MissingProviderError(),
  MissingVerifierError: () => new MissingVerifierError('a message I chose'),
  IncompleteResultError: () => new IncompleteResultError(['timeout']),
  UnsupportedFilterError: () => new UnsupportedFilterError('search'),
  InvalidDescriptorError: () => new InvalidDescriptorError('filters', 'must be an array'),
  ReqFailure: () =>
    new ReqFailure({
      thrownName: 'Error',
      message: 'a message I chose',
      source: 'relay',
      truncated: false,
      cause: undefined
    }),
  RelayConfigurationError: () =>
    new RelayConfigurationError('invalid-relay-input', ['wss://theirs.example/'], 'mine'),
  InvalidRelayScopeError: () =>
    new InvalidRelayScopeError({
      wrote: ['wss://theirs.example/'],
      named: 'wss://theirs.example/',
      reason: 'a reason I chose'
    }),
  InvalidRelayInputError: () => new InvalidRelayInputError('a relay', 'a detail I chose'),
  NonIdempotentRelayUrlError: () =>
    new NonIdempotentRelayUrlError({
      url: 'wss://theirs.example/',
      once: 'wss://theirs.example/',
      again: 'wss://other.example/'
    }),
  RelayNotInScopeError: () =>
    new RelayNotInScopeError('wss://theirs.example/', false, ['wss://mine.example/']),
  TransportIncompatibleError: () =>
    new TransportIncompatibleError(['wss://theirs.example/'], ['wss://theirs.example/'], 'mine'),
  TransportKeyMismatchError: () =>
    new TransportKeyMismatchError({
      wrote: ['wss://theirs.example/'],
      expected: ['wss://theirs.example/'],
      actual: ['wss://other.example/']
    }),
  // **Two classes the spike's table did not have, and why.** v1's request
  // refusal for a relay its transport cannot name is a class of its own
  // (`reqerror.ts`), and `ProviderDisposedError` is exported from its module
  // now, for the arms that name each class this library makes — so a consumer
  // can build one too, and it is measured here rather than exempted below.
  RequestTransportIncompatibleError: () => new RequestTransportIncompatibleError('a relay I chose'),
  ProviderDisposedError: () => new ProviderDisposedError('a reason I chose')
};

/**
 * The rest of the population: classes **this library declares and does not
 * export**, with the door each one is reachable through instead.
 *
 * **Why the exemption is a contract and not a hole.** `WR23`'s first half is
 * "no constructor mints — a consumer holding the class holds nothing", and for
 * one of these the premise cannot be arranged: there is no constructor to
 * hold. That is a *stronger* answer than the measurement, and it is only
 * stronger while it is true — so the un-exportedness is read off the module's
 * own run-time exports rather than asserted in prose, and it is the thing that
 * licenses skipping the build. A class moved onto the exports and left here
 * fails; a class added here without being un-exported fails.
 *
 * `builtBy` is the only way to hold one, and it is the library's own factory —
 * so the instance it answers with is minted, which is what makes it useless
 * for `WR23`'s first half and exactly right for `WR24`'s descriptor reads.
 */
export const libraryOnly: Readonly<
  Record<string, { readonly exports: () => object; readonly builtBy: () => Error }>
> = {
  // Empty in v1: `ProviderDisposedError`, the one class the spike listed here,
  // is exported from its module, so it is in the table above. The table stays,
  // because a class declared and not exported is a decision this arm reads.
};

/** Every class the population has to contain, from both tables. */
export const bothTables = (): string[] =>
  [...Object.keys(asAConsumerWould), ...Object.keys(libraryOnly)].sort();

/**
 * One instance of every class in the population, however it has to be got.
 *
 * `WR23` splits the population by whether a **consumer** can construct one,
 * because that is the question its first half asks. `WR24` and `WR28` ask
 * about the object, and every class has one — the un-exported one is reached
 * through the factory that is the only way to hold it. Merging here rather
 * than exempting is the difference between "the descriptor is closed on every
 * class" and "on every class we could reach".
 *
 * **One construction for both arms**, because two transcriptions of a
 * population are how two arms come to disagree about which classes are in it.
 */
export const oneOfEachClass = (): Readonly<Record<string, () => Error>> => ({
  ...asAConsumerWould,
  ...Object.fromEntries(Object.entries(libraryOnly).map(([name, { builtBy }]) => [name, builtBy]))
});
