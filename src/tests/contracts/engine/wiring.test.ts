/**
 * How the engine reads its caller's option bag, from its own source (0003 B4,
 * the guarded-read rule `B4-C6` states): every field is guarded, read through a
 * seam, or deliberately raw, and the source is what says which.
 *
 * Ported from the spike's wiring suite onto `src/lib/v1` — the one arm the B4
 * rows name, with the helpers it reads through — and renamed from `WR19` to
 * `WI19`: 0005 records the `WR` names as spike witnesses.
 *
 * Other arm names in the comments below — the ones not renamed here — are the
 * spike's, as 0005 records them; they are history rather than files in this
 * repository.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { validateFilter } from '$lib/v1/key.js';
import { normalizeDescriptor } from '$lib/v1/normalize.js';
import { capture, providerDisposed } from '$lib/v1/own.js';
import { isOwnedByLibrary, sealOwned } from '$lib/v1/owned.js';
import { REQ_ERROR_CODES } from '$lib/v1/reqerror.js';

import {
  asAConsumerWould,
  bothTables,
  constructionSites,
  errorClasses,
  everyConstructorCalled,
  libraryOnly,
  MINTERS,
  NOT_AN_ERROR_CLASS,
  oneOfEachClass
} from './helpers/errorclasses.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const LIB = resolve(ROOT, 'src/lib/v1');
const sourceOf = (name: string): string => readFileSync(join(LIB, name), 'utf8');

/**
 * Strip comments before looking for a symbol.
 *
 * `key.ts` names `canonicalKey` three times in its own header while nothing
 * calls it, which counted as a use and made an unwired decision look wired.
 * A mention in prose is exactly what this test exists to disbelieve.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * The caller's option bag, read by the compiler rather than by a pattern.
 *
 * **Three readers of one population lived in this file.** `WR31` moved to
 * `declaredMembers` after a regex of exactly this shape passed three
 * counterexamples — `_debugTap`, a prefix-decoy interface and a block comment —
 * and `WR19` and `WR32` were still parsing the text. A reviewer found the third
 * one the round it was written, which is the same finding as the first two
 * arriving late rather than a new one.
 */
function optionFields(): readonly string[] {
  const lib = LIB;
  return declaredMembers(join(lib, 'useStreamedReq.svelte.ts'), 'UseStreamedReqOpts');
}

/**
 * How each of those fields is read: guarded, through a seam, or deliberately raw.
 *
 * **Shared for the reason `keyedCallerFields` is.** `WR32` claimed to derive the
 * guarded count from the source and compared a literal `9` — so moving a field
 * from guarded to raw in the implementation, and updating `WR19` to match, left
 * `WR32` green and the record's nine standing. A census check that does not
 * reach the classifier is a census check of its own constant.
 */
function classifyOptionReads(): {
  readonly guarded: readonly string[];
  readonly seam: readonly string[];
  readonly raw: readonly string[];
} {
  const lib = LIB;
  const source = withoutComments(readFileSync(join(lib, 'useStreamedReq.svelte.ts'), 'utf8'));
  const fields = optionFields();
  const guarded = fields.filter((field) => source.includes(`read('${field}',`));
  const seam = fields.filter((field) =>
    new RegExp(`safely\\(\\(\\) => getOpts\\(\\)\\.${field}\\b`).test(source)
  );
  // **Copied exactly, not paraphrased.** The first extraction of this rewrote
  // the `raw` predicate as "not guarded, not a seam, and read directly", which
  // is a different rule: `rxNostr` and `client` are read *both* ways and belong
  // to two of the three lists. `WR19` went red on the difference, which is what
  // an extraction that changes behaviour should do.
  const raw = fields.filter(
    (field) =>
      new RegExp(`\\bgiven\\.${field}\\b`).test(source) ||
      new RegExp(`(?<!safely\\(\\(\\) => )getOpts\\(\\)\\.${field}\\b`).test(source) ||
      new RegExp(`^ {6}${field}\\s*[,=]`, 'm').test(
        /const \{([\s\S]*?)\} = given;/.exec(source)?.[1] ?? ''
      )
  );
  return { guarded, seam, raw };
}

/**
 * The members of a declared interface, **resolved by the compiler**.
 *
 * **Every population in this file was a regex over an interface body, and a
 * reviewer walked through five of them in one sitting.** `^ {2}(?:readonly )?
 * (\w+)[?:]` cannot see a member contributed by `extends`, a quoted key
 * (`'raw-socket'`), or a method (`setRelays(…)`) where the pattern only allowed
 * `?:`; `indexOf('export interface ' + name)` matches a **prefix**, so a decoy
 * `NostrContextCommonV1` declared above the real one is what gets read; and the
 * body ends at the first column-0 `\n}`, which a block comment can supply, so
 * everything after it vanishes from the population while the guards — `length >
 * 5`, `> 10` — stay green over what is left.
 *
 * The type checker answers all five at once, because "the members of this type"
 * is the question it exists to answer. It costs a program build, which this file
 * already pays for elsewhere.
 */
const RESOLVED = new Map<string, Map<string, string[]>>();
/** Whether a resolved interface has an index signature, by file and name. */
const INDEXED = new Map<string, Map<string, boolean>>();

function declaredMembers(file: string, name: string): string[] {
  // **One program per file, not one per question.** Each call built a whole
  // TypeScript program; five of them in two arms is seconds of work repeated,
  // and under the mutation runner's parallel load that was enough to push these
  // arms past their deadline — which the walk reported as two unrelated entries
  // killing `WR27`. A loaded machine widening a kill set is this repository's
  // most familiar false signal, and the fix is to stop paying the cost twice.
  const cached = RESOLVED.get(file);
  if (cached !== undefined) return cached.get(name) ?? [];
  resolveInterfaces(file);

  return RESOLVED.get(file)?.get(name) ?? [];
}

function resolveInterfaces(file: string): void {
  const host: ts.ParseConfigFileHost = {
    useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
    readDirectory: ts.sys.readDirectory,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
    }
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(resolve(ROOT, 'tsconfig.json'), {}, host);
  const options = { ...(parsed as ts.ParsedCommandLine).options, noEmit: true };
  const program = ts.createProgram([file], options);
  const source = program.getSourceFile(file);
  if (source === undefined) {
    RESOLVED.set(file, new Map());
    INDEXED.set(file, new Map());

    return;
  }
  const checker = program.getTypeChecker();
  const members = new Map<string, string[]>();
  const indexed = new Map<string, boolean>();
  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue;
    const type = checker.getTypeAtLocation(statement.name);
    members.set(
      statement.name.text,
      type.getApparentProperties().map((symbol) => symbol.getName())
    );
    indexed.set(statement.name.text, checker.getIndexInfosOfType(type).length > 0);
  }
  RESOLVED.set(file, members);
  INDEXED.set(file, indexed);
}

describe('the engine reads its caller', () => {
  it('WI19: every field of the caller’s options is classified, and the file is what classifies it', () => {
    // **The ratchet the rule was missing.** `B4-C6` says "every read of the
    // caller's object is decided — guarded or deliberately raw — not only every
    // value", and for four rounds the repair was written per site: a reviewer
    // named one raw read, it was guarded, and the next round found another. The
    // rule is written now, in the paragraph above `safely`; what was still
    // missing is anything that fails when a *new* read disagrees with it.
    //
    // The population is the published options type, because that is the
    // caller's whole surface: a field they can pass is a field this module
    // reads somewhere. Each one has to be reachable through one of the three
    // categories the rule names, and the categories below are the rule's own.
    // **One reader of the population and one classifier**, shared with `WR31`
    // and `WR32`. This arm parsed the interface text for its fields while
    // `WR31` had already moved to the compiler for the same population, and
    // `WR32` carried a third copy — a reviewer found the third the round it
    // was written.
    const fields = optionFields();
    expect(fields.length, 'the options type was not read at all').toBe(23);
    const { guarded, seam, raw } = classifyOptionReads();
    // The same text the classifier read, for the assertions below it about how
    // the caller's object is materialised.
    const source = withoutComments(sourceOf('useStreamedReq.svelte.ts'));

    // The rule, as a table rather than as prose. A field that moves between
    // these lists has had its guard added or taken away.
    expect({ guarded, seam, raw }).toEqual({
      guarded: [
        'filters',
        'live',
        'namespace',
        'environment',
        'settleTimeoutMs',
        'retain',
        'scope',
        // The relays *this request* names, which is a caller field like the six
        // above and not an owner input like `scope` beside it. Guarded for the
        // same reason `namespace` is: a getter that throws must refuse the
        // request by name rather than escape as the caller's own error under
        // the caller's own cache key.
        'relays',
        // Whether the caller is asking at all. Guarded because an unreadable
        // plan is not "asking": it is a request refused by name, which is what
        // the unreadable list is for.
        'deferred'
      ],
      // `clock` at its three sites and `live` in `activity`: read where nothing
      // can be refused, so they become absent or default rather than throwing
      // at whoever reads a published getter.
      //
      // **`rxNostr` joined them when the transport became a lease.** It is read
      // once at construction to wrap a caller-owned client in a permanent lease
      // — the provider's own lease is the other branch — and that read happens
      // where a refusal has nowhere to go. `refresh()` reads it again through
      // the guard that reports the *throw* rather than the absence, which is
      // the one place a refusal about a seam can be published (`RM6`).
      //
      // **Three fields joined them when the owner bundle closed.** The verifier,
      // the client and the attempt registry used to be read raw off the option
      // bag, each with its own fallback to the provider — the arrangement `OM1`
      // measured a counterexample against. They are read through the bundle's
      // caller arm now, which reads them under {@link safely} because a getter
      // there has no error channel either: what a caller-owned request does
      // without a client is refuse by name (`OM2`), not throw at whoever read
      // the getter.
      seam: ['rxNostr', 'verifyEvent', 'client', 'live', 'clock', 'attempts'],
      raw: [
        // **In both lists, and that is the classification rather than a gap.**
        // The lease wraps a caller-owned client through a guarded read; the
        // provider's own transport and the machine's target resolution still
        // take it raw, where the client is the channel a refusal would be
        // published on. A field with reads of two kinds appears under both.
        'rxNostr',
        // **`client` is in both lists for `rxNostr`'s reason.** The bundle's
        // caller arm reads it through the guard; `refresh()` reads what the
        // bundle answered, which is a raw read of a value that is already the
        // owner's. `verifyEvent` and `attempts` left this list entirely when
        // they stopped being read off the option bag at all.
        'client',
        'reqIdBase',
        'staleTime',
        'refetchOnMount',
        'enabled',
        'initialData',
        'consumeSignal',
        'poisonId',
        'passiveAbort',
        'accumulator'
      ]
    });
    // And the population is covered: a field in none of the three is a read
    // nobody decided about, which is the shape every one of those four rounds
    // found.
    expect(fields.filter((field) => ![...guarded, ...seam, ...raw].includes(field))).toEqual([]);

    // **One materialisation per derivation, which is the other half of the same
    // rule.** `refresh()` was repaired to call the thunk once and read each
    // field off that object; `queryOptions` was left calling it twice — once
    // for the seams and once inside `requestOf()` — so the client the query was
    // built on and the client the descriptor was checked against came from two
    // different answers. Both sites name the object they read.
    expect((source.match(/const given = getOpts\(\);/g) ?? []).length).toBe(2);
    expect(source).toMatch(/\} = given;/);
    expect(source).not.toMatch(/requestOf\(\)/);
    // **And the count, because the three lines above are a spelling check.**
    // Measured by a reviewer: `requestOf(getOpts())` is the same defect as the
    // spike ledger's `requestOf()` mutant — the seams off one materialisation, the
    // descriptor off the next — and it passes every line above, because the
    // name it does not use is the only thing they read. What cannot be evaded
    // is how many times the caller's thunk is *called*: ten sites, and any
    // eleventh is a materialisation somebody added.
    //
    // The ten, so that a change to this number is read rather than bumped:
    // `supplied` at construction, `from ?? getOpts()` inside `requestOf`, the
    // two `const given` (the options factory and `refresh()`), three `clock`
    // reads (the fold, the expiry effect, the projection), one `live` read in
    // `activity`, and two `client` reads (the query's own, and the write-back
    // inside the query function).
    // **Every mention of the thunk, not every call written `getOpts()`.** A
    // reviewer evaded the call-shaped count in one line —
    // `const materialise = getOpts;` and then `requestOf(materialise())` is an
    // eleventh materialisation that leaves the ten spellings untouched, and
    // `getOpts?.()` and `getOpts.call(…)` do the same. What cannot be aliased is
    // the name itself: every path to the caller's object goes through it, so the
    // number of times it appears is the number of places that can reach one.
    const mentions = (source.match(/\bgetOpts\b/g) ?? []).length;
    // **Eleven, and it went down.** It was twelve while the verifier, the
    // client, the clock and the attempt registry each reached for the caller's
    // object at their own use sites; they are read once each in the bundle's
    // caller arm now, and the provider arm reaches for nothing. Five of the
    // eleven are that arm — one field apiece — and the rest are the
    // materialisations the paragraph above describes. The number is the point
    // of this line: it moves when a path to the caller's object is added, and
    // it moved in the direction the owner bundle was for.
    expect(mentions, 'a reference to the caller’s thunk this list does not know about').toBe(11);

    // **What this cannot see, written rather than implied.** It reads the
    // *type*, so a second raw read of a field that is already guarded elsewhere
    // — `opts.namespace` written beside the guarded one inside `requestOf` —
    // moves nothing between the lists. The runtime arms are what hold that:
    // `EK8` for the descriptor fields, `EK9` for the refused key, `EK7` for the
    // reads the handler itself takes. It also says nothing about a field read
    // in another module; `A4b`'s allowlist (`OF2`) is where that lives.
    //
    // **And it says nothing about which fields are *keyed*.** The categories
    // here are about how a field is read; the cache hazard is about whether a
    // field is folded into the key. `WR31` is that one.
  });
});

describe('this library mints where it constructs, and closes before it freezes', () => {
  /** What a call threw, because an owned value cannot be asked for — only thrown. */
  const thrownBy = (run: () => void): unknown => {
    try {
      run();
    } catch (thrown) {
      return thrown;
    }
    throw new Error('the premise: this boundary was expected to refuse, and it returned');
  };

  it('WI23: this library mints where it constructs, and no constructor mints', () => {
    // **The rule the failure channel is built on, and it is not the rule this
    // arm used to hold.** What is published there is a value this library
    // *made*, never one it was handed — and for a round that was implemented as
    // "an instance of one of our classes", with each constructor calling the
    // registrar. Four of those classes are on the published entry, so
    // `new RelayConfigurationError('duplicate-relay', [], 'a message I chose')`
    // handed a consumer a value the registry called ours and `capture` passed it
    // through: their `code`, their `message`, their live graph on `cause`, and
    // this library freezing their object on the way out. Measured end to end
    // through the hook. `PO8` had closed exactly that door on `ReqFailure` and
    // the correction was applied to the instance a reviewer named.
    //
    // So ownership is **"this library constructed this object, here"**, and it
    // has three halves, none of which is a word in a class body:
    //
    //   1. no constructor mints — a consumer holding the class holds nothing;
    //   2. every construction site inside the library mints;
    //   3. and what the library throws is, in fact, owned.
    //
    // (1) and (3) are read off the run time, because that is the only reader a
    // registration under `if (Math.random() < 0)` or inside an uncalled method
    // cannot mislead.
    const classes = errorClasses();
    const named = classes.map(({ name }) => name);
    // **Not vacuous, and pinned rather than `> 8`.** The old population was
    // asserted to be "more than eight", which is satisfied by nine of fifteen —
    // and by the six the pattern could not see being six of the missing ones.
    //
    // **Sixteen, and it was fifteen.** Splitting `internal-failure` into the
    // four remedies it had been carrying retired `InternalFailureError` and
    // declared two: `MissingVerifierError` (the wiring half, published) and
    // `ProviderDisposedError` (the disposed-provider half, not exported).
    //
    // **Seventeen now**: `RelayNotInScopeError` is the refusal a request gets
    // for naming a relay this provider cannot read from — the sixth
    // `RelayConfigurationError` code, and the first that is about a request
    // rather than about the provider's list.
    expect(named.length, 'every class in this library that is an Error').toBe(18);
    expect(
      [...named].sort(),
      'and each one is built below, so the run-time half covers the population'
    ).toEqual(bothTables());

    // (1) **No constructor mints.** Read as an effect: whatever the source says,
    // an instance a consumer can build is not in the registry.
    const minting = Object.entries(asAConsumerWould)
      .filter(([, build]) => isOwnedByLibrary(build()))
      .map(([name]) => name);
    expect(minting, 'a class whose constructor hands a consumer the library’s own answer').toEqual(
      []
    );
    // **And for the rest of the population there is no constructor to hold**,
    // which is what puts them outside the measurement above rather than beside
    // it. Read off the declaring module's exports at run time: a class that
    // becomes exported is a class a consumer can build, and it has to move into
    // the table that measures what building one does.
    const escaped = Object.entries(libraryOnly)
      .filter(([name, { exports }]) => Object.keys(exports()).includes(name))
      .map(([name]) => name);
    expect(
      escaped,
      'a class listed as unreachable that a consumer can in fact name and construct'
    ).toEqual([]);

    // (2) **Every construction site mints**, and the wrapper has to be the call
    // the construction is an argument to.
    const sites = constructionSites(new Set(named));
    const unminted = sites
      .filter((site) => site.wrapper === undefined || !MINTERS.includes(site.wrapper))
      .map((site) => `${site.where} (${site.name})`);
    expect(unminted, 'a construction this library never claimed as its own').toEqual([]);
    // Pinned for the reason above: a site deleted, or a class quietly dropped
    // out of the population, is a number that moves.
    //
    // **Fifty, and it was forty-seven**, net of four moves — counted per class,
    // because "three more" is a number a reader cannot check: the one
    // `new InternalFailureError` in its factory left (−1); the one
    // `new ProviderDisposedError` and the one `new MissingVerifierError` that
    // replaced its four meanings arrived (+2); and `refresh()`'s two new guarded
    // reads of the caller's own `client` and `rxNostr` each refuse by name, so
    // `InvalidDescriptorError` went from ten sites to twelve (+2). The machine's
    // two `throw internalFailure(…)` are calls to a factory rather than
    // constructions, so they moved to `relayFailure`/`providerDisposed` without
    // touching this count.
    // **Fifty-four**, and the four are one repair: a transport that cannot be
    // used is refused by the name of the seam now rather than published as a
    // disposed provider, so `InvalidDescriptorError` gained a site in the
    // machine, one in `stream.ts`, and one in the options factory — plus the
    // `refresh()` pair that names `client` and `rxNostr`, of which one was
    // already counted. Counted per class rather than as "+4": the disposal
    // sites became `providerDisposed` *calls*, which are not constructions.
    // **Fifty-five**, and the one is `accumulatorBroke`, which mints an
    // `AccumulatorContractError` for a `relay-failed` value arriving at a
    // terminal door (`A11-P4`). The disposal split that came with it added no
    // site: the provider's half is a `providerDisposed` *call*, and the
    // caller-owned half is `requestTargets`' existing refusal — the second
    // guard written for it on the `refresh()` path had no entrance and was
    // deleted rather than witnessed.
    //
    // **Fifty-seven now, and the last two are the owner bundle's two refusals.**
    // A caller who brings one owner input is served standalone, and a standalone
    // request cannot be built without a client and an attempt registry, so the
    // seam mints an `InvalidDescriptorError` naming the one that is missing
    // (`OM2`). A consumer who brought nothing and has no provider above them is
    // a different situation with a different remedy, and gets
    // `MissingProviderError` — one code for one remedy, which is `0004`'s rule.
    // Both are construction sites like every other one here, which is why the
    // number moved rather than the rule.
    //
    // **Sixty-three, and the six are the request's relay targets.** Four are
    // `resolveTargets`' — a `relays` that is not an array, an entry that is not
    // a relay URL string, an entry this library cannot name, and a target this
    // provider cannot read from — and two are the descriptor boundary
    // re-checking the shape of what it is handed. Every one is minted at its
    // construction site like the fifty-seven before them, which is why the
    // number moved and the rule did not.
    // **Sixty-four**: a `deferred` that is neither absent nor a boolean is
    // refused by name, like every other field of the bag whose type is checked
    // rather than coerced.
    // **Sixty-eight in v1**, and the four over the spike's sixty-four are all in
    // `scope.svelte.ts`, one more site of each of four classes: an
    // `InvalidDescriptorError` in `resolveTargets` naming `relays`, an
    // `InvalidRelayInputError` in `scopeOf` naming the relay list, a
    // `TransportIncompatibleError` in the set probe `ask`, and the one
    // `RequestTransportIncompatibleError`, a class the spike did not have, in
    // `resolveTargets`. Counted per class against the spike's source, by the
    // same scan.
    expect(sites.length, 'the sites the two minters cover').toBe(68);
    // **And the population read from the other side**, because the scan above
    // matches a declared class *name*: `const Refusal = InvalidDescriptorError;
    // throw new Refusal(…)` is a real unminted refusal branch that leaves every
    // line above green and the site count unmoved — measured, and the value came
    // out of `capture` copied, class and `field` gone. Every constructor this
    // library calls has to be an error class it knows or a name written down as
    // not one; an alias is neither.
    const unclassified = everyConstructorCalled()
      .filter(({ callee }) => !new Set(named).has(callee) && !NOT_AN_ERROR_CLASS.includes(callee))
      .map(({ where, callee }) => `${where} (${callee})`);
    expect(
      unclassified,
      'a constructor nobody has classified — an aliased error class looks exactly like this'
    ).toEqual([]);

    // (3) **And what it throws is owned** — the edge without which the two
    // above are satisfied by a library that mints nowhere at all. One per
    // mechanism rather than one per class: the classes not reached here are
    // covered by (2), which is a claim about all of them.
    // **`providerDisposed` where this read `internalFailure`.** The mechanism is
    // the same one — a class the library throws, minted at its construction site
    // — and the factory is what the split renamed it to; the class behind it is
    // the one a consumer cannot name, so this call is also the only way to reach
    // it at all.
    expect(isOwnedByLibrary(providerDisposed('the provider connection is terminated'))).toBe(true);
    expect(isOwnedByLibrary(capture(new Error('from outside'), 'relay'))).toBe(true);
    expect(
      isOwnedByLibrary(thrownBy(() => validateFilter({ search: 'unsupported' } as never))),
      'the filter boundary’s own refusal'
    ).toBe(true);
    expect(
      isOwnedByLibrary(thrownBy(() => normalizeDescriptor({ filters: 'not an array' } as never))),
      'and the descriptor boundary’s'
    ).toBe(true);

    // And the registrar is where it says it is — a leaf module, because the
    // classes that call it include the ones `own.ts` itself depends on.
    expect(withoutComments(sourceOf('owned.ts'))).toMatch(/export function ownedByLibrary/);
    expect(
      withoutComments(sourceOf('owned.ts')),
      'a leaf, so nothing can cycle through it'
    ).not.toMatch(/^import /m);
  });

  it('WI24: `stack` is closed before the value is frozen, at every class', () => {
    // **Order is the correctness property, and it is invisible to every
    // instrument that asks `Object.isFrozen`.** The registrar redefines `stack`
    // — an own *accessor* on V8 — as a data property, and `defineProperty` on a
    // frozen object throws. That throw lands in `closeStack`'s own `catch`, so a
    // value that was frozen first reports `Object.isFrozen === true`, keeps a
    // live setter, and takes `published.stack = '…'`. It shipped in
    // `ReqFailure`, and `PO9` was green anyway because the value that arm built
    // came from a class with the right order.
    //
    // **This was a syntax scan and is an effect now.** It compared the position
    // of `ownedByLibrary(this)` and `Object.freeze(this)` inside a class body —
    // two spellings that are both gone: the constructors call `hardenOwned`,
    // which closes and mints nothing, and the value that is complete when it is
    // made goes through `sealOwned`. What is read here is what a consumer would
    // find: the descriptor, and a write.
    //
    // **The host premise, said once.** `closeStack` is guarded for a runtime
    // that installs `stack` non-configurable (JSC), where there is nothing to
    // close because it was never writable. On this one it is an accessor, which
    // is the case every line below is about.
    const plain = Object.getOwnPropertyDescriptor(new Error('a plain one'), 'stack');
    expect(plain?.get, 'this host installs `stack` as an accessor').toBeTypeOf('function');

    const classes = errorClasses();
    expect(
      classes.map(({ name }) => name).sort(),
      'the population is `WR23`’s, and every member is built'
    ).toEqual(bothTables());

    const oneOfEach = oneOfEachClass();

    // **Which class closes where is derived, not listed.** A class the library
    // builds through `sealOwned` is closed at the site; every other one has to
    // close in its own constructor, because the mint at its site is a
    // `ownedByLibrary` that runs after the constructor has already frozen it.
    const sites = constructionSites(new Set(classes.map(({ name }) => name)));
    const sealedAtItsSite = new Set(
      sites.filter((site) => site.wrapper === 'sealOwned').map((site) => site.name)
    );
    expect([...sealedAtItsSite], 'one class is complete when it is made').toEqual(['ReqFailure']);

    const writeStack = (value: Error): void => {
      try {
        (value as { stack?: string }).stack = 'STACK OVERWRITTEN';
      } catch {
        // A closed property refuses, which is one way of keeping the promise.
      }
    };

    for (const [name, build] of Object.entries(oneOfEach)) {
      const instance = build();
      const descriptor = Object.getOwnPropertyDescriptor(instance, 'stack');
      if (sealedAtItsSite.has(name)) {
        // **The other edge, and it is a claim about the design rather than an
        // exemption.** A `ReqFailure` a consumer constructs is theirs: this
        // library has not closed it, has not frozen it, and has not minted it —
        // the sequence belongs to the factory, on the object the factory
        // derived.
        expect(descriptor?.get, `${name}: a consumer’s own is left as the host made it`).toBeTypeOf(
          'function'
        );
        continue;
      }
      expect(descriptor?.get, `${name}: closes \`stack\` in its own constructor`).toBeUndefined();
      expect(descriptor?.writable, `${name}: as a value, not an accessor`).toBe(false);
      // The effect, which is what is contracted: a write does not take, whatever
      // the descriptor says.
      const before = instance.stack;
      writeStack(instance);
      expect(instance.stack, `${name}: and the close came before the freeze`).toBe(before);
    }

    // **And the floor under `capture`'s pass-through, which is why that freeze
    // stopped killing anything.** `capture` freezes a value it hands through, and
    // the ledger entry that removes the freeze now measures `0 killed`: every
    // class that can *be* handed through — owned, and carrying a `ReqErrorCode` —
    // already froze itself in its own constructor, so the line is a net with
    // nothing under it. That is only true while it is true, and nothing said so.
    // Here it is said: a channel class that ships without freezing itself is
    // what makes that freeze load-bearing again, and this is the check that
    // notices.
    //
    // **"Carrying a `ReqErrorCode`" is read as exactly that now**, and it used
    // to be read through `isReqError` — a published recognition guard that is
    // gone, because a guard and a union were two hand-written descriptions of
    // one shape. What decides the pass-through inside `capture` is a private
    // `isChannelValue`, whose whole test on an already-owned value is the
    // discriminant; so that is what is asked here, off the same list the library
    // derives it from — which is the more faithful reading as well as the
    // shorter one, since the guard's extra members were never what decided a
    // pass-through.
    const channelClasses = Object.entries(oneOfEach)
      .filter(([name]) => !sealedAtItsSite.has(name))
      .map(([name, build]) => ({ name, instance: build() }))
      .filter(({ instance }) =>
        (REQ_ERROR_CODES as readonly string[]).includes(
          (instance as { code?: unknown }).code as string
        )
      );
    expect(
      channelClasses.filter(({ instance }) => !Object.isFrozen(instance)).map(({ name }) => name),
      'a class `capture` can hand through must be frozen before it leaves its constructor'
    ).toEqual([]);
    // Not vacuous: the filter finds classes at all, and the number is not one.
    expect(channelClasses.length, 'and the population it filters is not empty').toBeGreaterThan(4);

    // And the sealed one through the door that builds it, which is the only way
    // to hold one: closed, and closed *before* the freeze that follows.
    const published = capture(new Error('from outside'), 'relay') as Error;
    const sealedDescriptor = Object.getOwnPropertyDescriptor(published, 'stack');
    expect(sealedDescriptor?.get, 'the factory’s value is closed').toBeUndefined();
    expect(sealedDescriptor?.writable).toBe(false);
    const publishedStack = published.stack;
    writeStack(published);
    expect(published.stack, 'a snapshot’s `stack` is not the consumer’s to rewrite').toBe(
      publishedStack
    );

    // **The sequence itself, on a value nothing else here owns.** `sealOwned` is
    // close, mint, freeze, and reversing the last two is exactly the shipped
    // defect: `Object.isFrozen` answers `true` either way, so the write is the
    // only thing that can tell them apart.
    const bare = new Error('handed to the sealer');
    sealOwned(bare);
    expect(Object.isFrozen(bare), 'frozen').toBe(true);
    expect(isOwnedByLibrary(bare), 'and minted').toBe(true);
    const bareStack = bare.stack;
    writeStack(bare);
    expect(bare.stack, 'and closed, which freezing on its own does not do').toBe(bareStack);
  });

  it('WI28: `stack` is closed whatever the host’s getter answers, at every class', () => {
    // **`WR24`'s premise was the hole.** That arm asserts, at its top, that this
    // host installs `stack` as an accessor — true — and everything under it is
    // measured in a world where the getter answers a string. `closeStack` read
    // exactly that: `if (typeof held !== 'string') return`, with a comment
    // calling the other case a corner belonging to a host "no host in this
    // project's support matrix" is. It is not about the host. `Error.prepareStackTrace`
    // is a global any dependency can set, and the ordinary way to suppress
    // traces — a function returning `undefined` — makes the getter answer
    // `undefined` **while leaving the setter live**. A reviewer named it; driven
    // through the published `InvalidRelayInputError` it reproduced exactly:
    // `Object.isFrozen` answered `true`, and a second reader's write took.
    //
    // So this is `WR24`'s claim under the two globals that break its premise,
    // over the same population — one construction, shared, so the two arms
    // cannot come to disagree about which classes are in it.
    const previous = Error.prepareStackTrace;
    let sealedAtItsSiteNames = new Set<string>();
    try {
      for (const [label, prepare] of [
        ['a preparer that answers nothing', () => undefined],
        ['a preparer that answers a non-string', () => ({ not: 'a string' })]
      ] as const) {
        Error.prepareStackTrace = prepare;

        // **The arrangement bites, and this is the "does" side of it.** Without
        // this the loop below could be passing because the global did nothing.
        const plain = new Error('a plain one under the hostile global');
        expect(
          Object.getOwnPropertyDescriptor(plain, 'stack')?.set,
          `${label}: a stock Error still has a live setter`
        ).toBeTypeOf('function');
        expect(typeof plain.stack, `${label}: and its getter answers no string`).not.toBe('string');

        const oneOfEach = oneOfEachClass();
        const sites = constructionSites(new Set(Object.keys(oneOfEach)));
        const sealedAtItsSite = new Set(
          sites.filter((site) => site.wrapper === 'sealOwned').map((site) => site.name)
        );
        sealedAtItsSiteNames = sealedAtItsSite;
        // Not vacuous: the population is the whole table, and it is not empty.
        expect(Object.keys(oneOfEach).sort(), `${label}: over every class`).toEqual(bothTables());

        for (const [name, build] of Object.entries(oneOfEach)) {
          // The same exemption `WR24` derives rather than lists: a value a
          // consumer constructs of the class the factory seals is theirs, and
          // this library has not closed it.
          if (sealedAtItsSite.has(name)) continue;
          const instance = build();
          const descriptor = Object.getOwnPropertyDescriptor(instance, 'stack');
          expect(descriptor?.set, `${name}, ${label}: no setter survives`).toBeUndefined();
          expect(descriptor?.writable, `${name}, ${label}: closed as a value`).toBe(false);
          // The effect, which is the contract: a second reader's write does not
          // take, whatever the descriptor says.
          const before = instance.stack;
          try {
            (instance as { stack?: string }).stack = 'rewritten by a second reader';
          } catch {
            // A closed property refuses, which is one way of keeping it.
          }
          expect(instance.stack, `${name}, ${label}: and the write did not take`).toBe(before);
        }

        // **And the class the loop above skips, through the door that builds
        // it.** `WR24` covers this separately and the first draft of this arm
        // did not, which left the one class a consumer actually meets on the
        // failure channel — the snapshot `capture` returns — unmeasured under
        // exactly the globals this arm exists for. The exemption is about a
        // value a *consumer* constructed; the factory's own is ours to close.
        const published = capture(new Error('from outside'), 'relay') as Error;
        const sealed = Object.getOwnPropertyDescriptor(published, 'stack');
        expect(sealed?.set, `${label}: the factory’s value keeps no setter`).toBeUndefined();
        expect(sealed?.writable, `${label}: and is closed as a value`).toBe(false);
        const sealedStack = published.stack;
        try {
          (published as { stack?: string }).stack = 'rewritten by a second reader';
        } catch {
          // A closed property refuses, which is one way of keeping it.
        }
        expect(published.stack, `${label}: and the write did not take`).toBe(sealedStack);
      }

      // **The third member of the population this arm's own repair named, and it
      // was missing.** `closeStack`'s comment before the repair said the getter
      // may answer `undefined` **or throw**; the repair made the definition
      // unconditional and guarded the read, and an outside reviewer measured
      // that neither guard has a witness — with the read's `catch` removed,
      // `capture` itself throws, which is the failure channel's own door.
      //
      // **Measured with the global installed and asserted after it is gone.** A
      // preparer that throws makes *every* `stack` read throw, including the
      // ones vitest takes to report a failure, so an assertion under it reports
      // nothing usable. What is collected here is data.
      const underAThrowingPreparer: {
        built: boolean;
        set: unknown;
        writable: unknown;
        wrote: boolean;
      }[] = [];
      Error.prepareStackTrace = () => {
        throw new Error('a dependency’s preparer threw');
      };
      try {
        for (const [name, build] of Object.entries(oneOfEachClass())) {
          if (sealedAtItsSiteNames.has(name)) continue;
          let instance: Error | undefined;
          try {
            instance = build();
          } catch {
            underAThrowingPreparer.push({ built: false, set: null, writable: null, wrote: false });
            continue;
          }
          const descriptor = Object.getOwnPropertyDescriptor(instance, 'stack');
          const before = descriptor?.value;
          try {
            (instance as { stack?: string }).stack = 'rewritten by a second reader';
          } catch {
            // Refusing is one way of keeping it.
          }
          const after = Object.getOwnPropertyDescriptor(instance, 'stack')?.value;
          underAThrowingPreparer.push({
            built: true,
            set: descriptor?.set,
            writable: descriptor?.writable,
            wrote: before !== after
          });
        }
        // The factory's own, which is the class the loop above skips.
        const published = capture(new Error('from outside'), 'relay') as Error;
        const descriptor = Object.getOwnPropertyDescriptor(published, 'stack');
        underAThrowingPreparer.push({
          built: true,
          set: descriptor?.set,
          writable: descriptor?.writable,
          wrote: false
        });
      } finally {
        Error.prepareStackTrace = previous;
      }

      // Not vacuous: every class was built, so "no setter survives" is not being
      // said about an empty list.
      expect(
        underAThrowingPreparer.filter((one) => !one.built),
        'a preparer that throws does not stop a class being constructed'
      ).toEqual([]);
      expect(underAThrowingPreparer.length, 'over every class and the factory').toBeGreaterThan(4);
      expect(
        underAThrowingPreparer.filter((one) => one.set !== undefined),
        'a preparer that throws leaves no setter either'
      ).toEqual([]);
      expect(
        underAThrowingPreparer.filter((one) => one.writable !== false),
        'and everything is closed as a value'
      ).toEqual([]);
      expect(
        underAThrowingPreparer.filter((one) => one.wrote),
        'and no write took'
      ).toEqual([]);
    } finally {
      Error.prepareStackTrace = previous;
    }
  });
});
