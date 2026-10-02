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
