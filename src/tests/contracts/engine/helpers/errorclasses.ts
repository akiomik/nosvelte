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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** The library's own modules: `src/lib/v1`, its top level. */
const lib = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../lib/v1');
const sourceOf = (name: string): string => readFileSync(join(lib, name), 'utf8');

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
const parsedModules = (): { module: string; file: ts.SourceFile }[] =>
  readdirSync(lib)
    .filter((name) => name.endsWith('.ts'))
    .map((module) => ({
      module,
      file: ts.createSourceFile(
        module,
        sourceOf(module),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TS
      )
    }));

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

export const errorClasses = (): { module: string; name: string }[] => {
  const declared: { module: string; name: string; extends: string | undefined }[] = [];
  for (const { module, file } of parsedModules()) {
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
      if (each.extends === 'Error' || reaching.has(each.extends)) {
        reaching.add(each.name);
        changed = true;
      }
    }
  }
  return declared
    .filter((each) => reaching.has(each.name))
    .map(({ module, name }) => ({ module, name }));
};

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
  population: ReadonlySet<string>
): { where: string; name: string; wrapper: string | undefined }[] => {
  const sites: { where: string; name: string; wrapper: string | undefined }[] = [];
  for (const { module, file } of parsedModules()) {
    const visit = (node: ts.Node): void => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        population.has(node.expression.text)
      ) {
        const parent = node.parent as ts.Node | undefined;
        const wrapper =
          parent !== undefined &&
          ts.isCallExpression(parent) &&
          ts.isIdentifier(parent.expression) &&
          parent.arguments[0] === node
            ? parent.expression.text
            : undefined;
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        sites.push({ where: `${module}:${line + 1}`, name: node.expression.text, wrapper });
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
export const everyConstructorCalled = (): { where: string; callee: string }[] => {
  const called: { where: string; callee: string }[] = [];
  for (const { module, file } of parsedModules()) {
    const visit = (node: ts.Node): void => {
      if (ts.isNewExpression(node)) {
        const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
        called.push({
          where: `${module}:${line + 1}`,
          callee: ts.isIdentifier(node.expression)
            ? node.expression.text
            : node.expression.getText(file)
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
 * One instance of each class, built the way a **consumer** would.
 *
 * Written out on purpose, and required below to cover the parsed population
 * exactly: a class added to the library is a decision here — what a consumer
 * would pass, and what the run time then has to say about the result — rather
 * than a member that quietly falls outside a scan.
 *
 * **It no longer covers the population on its own, and that is a second
 * decision rather than a gap.** `InternalFailureError` left when
 * `internal-failure` was split into the four remedies it had been carrying;
 * `MissingVerifierError` arrived as the wiring half of that split and is
 * constructible here because it is on the published entry, and
 * `ProviderDisposedError` arrived as the disposed-provider half and is **not
 * exported at all**. A class a consumer cannot name cannot be built the way a
 * consumer would, so it is listed in {@link libraryOnly} instead — with the
 * run-time reading of "cannot name" beside it.
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
