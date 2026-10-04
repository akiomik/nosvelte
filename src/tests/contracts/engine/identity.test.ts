/**
 * The canonical cache key (0003 B1–B4, B9) and the canonical event set with its
 * projections (B5–B7, B10), against their own seams — the pure functions, and
 * for the refused key `entryKeyOf`, which takes the engine's resolution.
 *
 * Ported from the spike's identity suite onto `src/lib/v1`. The arms are
 * renamed from `K<n>` to `KI<n>` and from `E<n>` to `ES<n>`: 0005 records the
 * old names as spike witnesses, and a production arm carries a name of its own.
 * **The comments keep the spike's names**, because what they record — which arm
 * a mutation killed, what a sweep counted — was measured there: `K6` in a
 * comment is the arm that is `KI6` here, and every other arm name in a comment
 * (`EK4`, `NZ8`, `P47`, …) is the spike's as 0005 records it, not a file in
 * this repository.
 *
 * There are two hand-written seeded sweeps here — `KI6` over 2000 descriptors
 * and `ES5` over 200 permutations — and no property testing: no generator
 * library, no shrinking. The safety conditions are universally quantified and
 * these tests do not establish them.
 */
import type Nostr from 'nostr-typedef';
import type { EventPacket } from 'rx-nostr';
import { isFiltered } from 'rx-nostr';
import { hashKey } from 'tanstack-svelte-query-v6';
import { describe, expect, it, vi } from 'vitest';

import type { AttemptId } from '$lib/v1/attempt.js';
import { createAttemptRegistry, MissingRandomnessError } from '$lib/v1/attempt.js';
import type { OwnedPacket } from '$lib/v1/event.js';
import { ownPacket } from '$lib/v1/event.js';
import type { CachedEventSet, IncompleteCause, LegName, Refusal } from '$lib/v1/eventset.js';
import {
  addRefusal,
  backlogEndOf,
  beginAttempt,
  classifyKind,
  completionOf,
  emptyEventSet,
  endBacklog,
  endForward,
  foldEvent,
  laterWins,
  noteFailure,
  project,
  refusalsOf,
  replacementKey,
  selectMany,
  selectOne
} from '$lib/v1/eventset.js';
import { canonicalKey, UnsupportedFilterError, validateFilter } from '$lib/v1/key.js';
import type { RawDescriptor } from '$lib/v1/normalize.js';
import { normalizeDescriptor, relayMessage } from '$lib/v1/normalize.js';
import { relayFailure } from '$lib/v1/own.js';
import type { RefusalReason } from '$lib/v1/refusal.js';
import { classifyRefusal } from '$lib/v1/refusal.js';
import type { ReqError } from '$lib/v1/reqerror.js';
import { createRelayScope, type RelayScope } from '$lib/v1/scope.svelte.js';
import { entryKeyOf } from '$lib/v1/useStreamedReq.svelte.js';

import {
  base,
  type Case,
  CROSSINGS,
  type Dimension,
  DIRECTIONS,
  DOMAINS,
  FIELD_ROLES,
  firstD,
  type Fold,
  FOLDS,
  HEX_PAIRS,
  INSTANTS,
  minimalPairs,
  OUTSIDE_THE_ID,
  PAYLOAD_FIELDS,
  permutations,
  rankingVariants,
  RELATIONS
} from './helpers/design.js';
import {
  arbitraryEvents,
  coordinateOf,
  isEphemeral,
  SERIALIZED,
  shuffled,
  winnersOf
} from './helpers/nip01.js';

/**
 * A value from outside, handed to a door whose published type is `ReqError`.
 *
 * **The writer's parameter says what the channel hands *out*, and these arms are
 * about what a port may hand *in*.** `noteFailure` is typed by the structural
 * union the failure channel publishes, so a bare `Error` no longer type-checks
 * there — but its runtime contract is unchanged and is the thing measured
 * below: whatever arrives is snapshotted, and what is recorded is a value this
 * library made rather than the caller's object. The assertions that follow each
 * of these say so by identity (`not.toBe`), which is exactly the claim the cast
 * would hide if it were spelled at each call site instead of named once here.
 */
const foreign = (message: string): ReqError => new Error(message) as unknown as ReqError;

/**
 * One notice prefix per `RefusalReason`, which is what `B-η`'s bound is counted
 * over. The last is deliberately not a standardized prefix: `unknown` is a class
 * like the others for counting purposes, and a bound that skipped it would be
 * counted over nine.
 *
 * **Keyed by the reason rather than listed, so that a missing one cannot
 * compile.** This was a hand-maintained array and nothing tied it to
 * `RefusalReason`: `B-η`'s bound is per classification, so one new reason in
 * `refusal.ts` left `E18` green while it quietly stopped being the whole of one
 * relay's leg — the numbers it asserts are `40` and `120`, and those are ten
 * classes times the wordings kept, times the records the projection is deep.
 * A list that had gone stale would still make them true of nine.
 *
 * `Record<RefusalReason, string>` makes the absence unrepresentable rather than
 * merely detectable: adding a reason is a type error here, and the array is
 * derived so there is no second place to update.
 *
 * **The falsifier was run, and it is two steps because the defect was**. With a
 * tenth reason added to `RefusalReason` and nothing else, `npm run check` fails
 * on this literal — `Property 'spam' is missing in type … but required in type
 * 'Record<RefusalReason, string>'` — while the suite stays green, 32 passed.
 * That green is the hole itself, measured: no assertion in this file can see a
 * reason it was never handed a prefix for. Add the key so the type is satisfied
 * and `E18` fails on its own number, `expected 44 to be 40`.
 *
 * **The order is the point.** The type is what breaks the silence, and `E18` is
 * what then makes someone decide the new bound rather than inherit it — which
 * is why the counts below stay written down instead of being computed from
 * `REFUSAL_PREFIXES.length`. A check that re-derived them would pass at 44
 * having decided nothing.
 */
const REFUSAL_PREFIX_OF: Record<RefusalReason, string> = {
  duplicate: 'duplicate',
  pow: 'pow',
  blocked: 'blocked',
  'rate-limited': 'rate-limited',
  invalid: 'invalid',
  restricted: 'restricted',
  mute: 'mute',
  error: 'error',
  'auth-required': 'auth-required',
  unknown: 'nostandardprefix'
};

/**
 * The same list, in the same order, as the loops below take it.
 *
 * The mapping's own correctness is asserted rather than assumed, and `E18` is
 * what asserts it: two keys sharing a prefix, or a key whose prefix classifies
 * as something else, collapses two classifications into one and the count falls
 * short of `40`. So the type carries "every reason is present" and the witness
 * carries "each one is the prefix it says it is".
 */
const REFUSAL_PREFIXES = Object.values(REFUSAL_PREFIX_OF);

/** Deterministic PRNG so a failure is reproducible from the seed alone. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SCOPE = 'scope-1';
const key = (filters: Nostr.Filter[], live = false, namespace?: string) =>
  keyOf({
    filters,
    live,
    // Required when live, so the helper states it rather than letting the
    // boundary refuse. The value is the same one an unset `retain` used to mean.
    retain: 'unbounded',
    scopeGeneration: SCOPE,
    ...(namespace ? { namespace } : {})
  });

/**
 * Real ids, because the boundary now requires them.
 *
 * The fixtures used to be `'a'` and `'b'`. rx-nostr's local matcher accepts
 * those as prefixes and relays match these fields exactly, so a short value is
 * a filter that accepts events locally which no relay will ever send — the
 * boundary rejects them, and the tests had been written against a request that
 * could not work.
 */
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const X = 'c'.repeat(64);
const Y = 'd'.repeat(64);

/** The boundary, applied. Nothing below may take a raw descriptor. */
const keyOf = (raw: RawDescriptor): string => canonicalKey(normalizeDescriptor(raw));

describe('canonical key', () => {
  it('KI1: equivalent descriptors written differently share a key', () => {
    expect(key([{ kinds: [1, 2], authors: [B, A] }])).toBe(
      key([{ authors: [A, B], kinds: [2, 1] }])
    );
    // Duplicates inside a set field, and duplicate filters in the OR array.
    expect(key([{ kinds: [1], ids: [X, X, Y] }])).toBe(key([{ kinds: [1], ids: [Y, X] }]));
    expect(key([{ kinds: [1] }, { kinds: [1] }])).toBe(key([{ kinds: [1] }]));
    // The OR array's order carries no meaning.
    expect(key([{ kinds: [1] }, { kinds: [7] }])).toBe(key([{ kinds: [7] }, { kinds: [1] }]));
    // Tag values are a set in exactly the same way, and go through the same
    // normalisation — but until this line nothing swept them, so dropping the
    // sort/dedupe from the tag branch alone left every test in this file green.
    expect(key([{ kinds: [1], '#e': [B, A, B] }])).toBe(key([{ kinds: [1], '#e': [A, B] }]));
    // Tag names are keys of the filter object, so their order is free as well.
    expect(key([{ kinds: [1], '#e': [A], '#p': [B] }])).toBe(
      key([{ kinds: [1], '#p': [B], '#e': [A] }])
    );
  });

  it('KI2: a single differing field never collides — the direction that matters', () => {
    const variants: Array<[string, Nostr.Filter[]]> = [
      ['baseline', [{ kinds: [1], authors: [A] }]],
      ['kind changed', [{ kinds: [2], authors: [A] }]],
      ['kind added', [{ kinds: [1, 2], authors: [A] }]],
      ['author changed', [{ kinds: [1], authors: [B] }]],
      ['author added', [{ kinds: [1], authors: [A, B] }]],
      ['authors emptied', [{ kinds: [1], authors: [] }]],
      ['authors omitted', [{ kinds: [1] }]],
      ['since added', [{ kinds: [1], authors: [A], since: 1 }]],
      ['until 1', [{ kinds: [1], authors: [A], until: 1 }]],
      ['until 2', [{ kinds: [1], authors: [A], until: 2 }]],
      ['limit 0', [{ kinds: [1], authors: [A], limit: 0 }]],
      ['limit 1', [{ kinds: [1], authors: [A], limit: 1 }]],
      ['tag added', [{ kinds: [1], authors: [A], '#e': [X] }]],
      ['second filter', [{ kinds: [1], authors: [A] }, { kinds: [9] }]]
    ];

    const seen = new Map<string, string>();
    for (const [label, filters] of variants) {
      const k = key(filters);
      const clash = seen.get(k);
      expect(clash, `${label} collided with ${clash}`).toBeUndefined();
      seen.set(k, label);
    }
  });

  it('KI3: falsy scalars are distinguished from absent ones', () => {
    // `until: 0` used to be the example here, then `since: 0` was. **Both are
    // rejected now** — the dependency drops either at send time with the same
    // truthiness test, so either reaches relays as no bound at all — which
    // leaves `limit: 0` carrying the case: a falsy scalar that *is* accepted
    // has to stay distinct from absence in the key.
    expect(key([{ kinds: [1], limit: 0 }])).not.toBe(key([{ kinds: [1] }]));
    // An empty set matches nothing; an absent field matches everything — and
    // an absent `kinds` is refused now, since it would match ephemeral kinds
    // too. So the pair is stated over a field the boundary still allows.
    expect(key([{ kinds: [1], authors: [] }])).not.toBe(key([{ kinds: [1] }]));
  });

  it('KI4c: the retention bound is part of the identity too', () => {
    // Same argument as the settle timeout: it decides what the cache value
    // contains, so two descriptors keeping different numbers of events are not
    // looking at the same thing. Adding one and not the other is how the first
    // version of this went out.
    const filters: Nostr.Filter[] = [{ kinds: [1] }];
    const base = { filters, live: false, scopeGeneration: SCOPE };
    expect(keyOf({ ...base, retain: 100 })).not.toBe(keyOf({ ...base, retain: 50 }));
    expect(keyOf({ ...base, retain: 100 })).not.toBe(keyOf(base));
  });

  // @contracts B9-C1
  it('KI4b: the settle timeout is part of the identity too', () => {
    // B9 decided: settle belongs in the key. The marker rides on the cache
    // value, so two descriptors that would settle at different times cannot
    // share an entry — whichever mounted first would decide when the other
    // reports `settled`, which is the non-determinism B9 exists to refuse.
    const filters: Nostr.Filter[] = [{ kinds: [1] }];
    const base = { filters, live: false, scopeGeneration: SCOPE };
    expect(keyOf({ ...base, settleTimeoutMs: 5000 })).not.toBe(
      keyOf({ ...base, settleTimeoutMs: 8000 })
    );
    // And passing the default explicitly is the same request as omitting it.
    // This assertion was the other way round until the defaults moved in front
    // of the key: two callers who behave identically were getting separate
    // cache entries, which costs a duplicate REQ — the harmless direction of
    // the safety condition, but harmless is not the same as right.
    expect(keyOf({ ...base, settleTimeoutMs: 5000 })).toBe(keyOf(base));
    expect(keyOf({ ...base, settleTimeoutMs: 5000 })).toBe(
      keyOf({ ...base, settleTimeoutMs: 5000 })
    );
  });

  // @contracts B2-C1
  it('KI4: live, namespace and relay scope are all part of the identity', () => {
    const filters: Nostr.Filter[] = [{ kinds: [1] }];
    expect(key(filters, false)).not.toBe(key(filters, true));
    expect(key(filters, false)).not.toBe(key(filters, false, 'ns'));
    expect(key(filters, false, 'a')).not.toBe(key(filters, false, 'b'));
    expect(keyOf({ filters, live: false, scopeGeneration: 'A' })).not.toBe(
      keyOf({ filters, live: false, scopeGeneration: 'B' })
    );

    // **And on the refused path**, where there is no canonical form and the
    // key is `['nosvelte', 'refused', namespace, scope identity, message]` —
    // read back by position, so a key that swapped two of them is not this
    // one. The provider's scope identity is the clause the record lists
    // without a witness.
    const refusedKey = (
      namespace: string | undefined,
      scope: string,
      filter: object,
      relays?: string[]
    ): unknown[] =>
      entryKeyOf({
        filters: [filter as Nostr.Filter],
        ...(namespace === undefined ? {} : { namespace }),
        ...(relays === undefined ? {} : { relays }),
        scope: { id: scope } as unknown as RelayScope
      }) as unknown[];
    const unsupported = { kinds: [1], search: 'x' };
    const [library, path, namespaced, scoped, message] = refusedKey('a', 'S', unsupported);
    expect([library, path, namespaced, scoped]).toEqual(['nosvelte', 'refused', 'a', 'S']);
    expect(message).toContain('"search"');
    const hashed = (...args: Parameters<typeof refusedKey>): string => hashKey(refusedKey(...args));
    // A namespace, the provider's scope, and the refusal itself each split it.
    expect(hashed('a', 'S', unsupported)).not.toBe(hashed('b', 'S', unsupported));
    expect(hashed('a', 'S', unsupported)).not.toBe(hashed(undefined, 'S', unsupported));
    expect(hashed('a', 'S', unsupported)).not.toBe(hashed('a', 'T', unsupported));
    expect(hashed('a', 'S', unsupported)).not.toBe(hashed('a', 'S', { kinds: [1], until: 0 }));
    // What does **not** split it, stated rather than left to be found: two
    // different filters refused for the same reason under one namespace and
    // scope share the entry (0003 B1 — it holds an error and no data).
    expect(hashed('a', 'S', unsupported)).toBe(hashed('a', 'S', { kinds: [2], search: 'x' }));
    // Nor does a request's own `relays`. Asked under a real scope and naming
    // relays that scope reads, so the request reaches the filter check rather
    // than being refused for its targets: refused for the filter, the two share
    // an entry; accepted, the same two are two entries — the separation the
    // accepted key makes and the refused one owes nothing for.
    const real = createRelayScope(undefined, ['wss://x.example', 'wss://y.example']).current;
    const keyNaming = (relays: string[], filter: object): unknown[] =>
      entryKeyOf({ filters: [filter as Nostr.Filter], relays, scope: real }) as unknown[];
    const naming = (relays: string[], filter: object): string => hashKey(keyNaming(relays, filter));
    const [, refusedPath, , , refusedFor] = keyNaming(['wss://x.example'], unsupported);
    expect(refusedPath).toBe('refused');
    expect(refusedFor).toContain('"search"');
    expect(naming(['wss://x.example'], unsupported)).toBe(naming(['wss://y.example'], unsupported));
    expect(naming(['wss://x.example'], { kinds: [1] })).not.toBe(
      naming(['wss://y.example'], { kinds: [1] })
    );

    // And the scope identity does not separate two providers configured
    // alike: it is the identity of the readable set, which they share.
    const left = createRelayScope(undefined, ['wss://relay.example', 'wss://other.example']);
    const right = createRelayScope(undefined, ['wss://other.example', 'wss://relay.example']);
    expect(left.current.id).toBe(right.current.id);
    expect(createRelayScope(undefined, ['wss://third.example']).current.id).not.toBe(
      left.current.id
    );
  });

  it('KI5: unsupported fields are rejected, not ignored', () => {
    expect(() => validateFilter({ kinds: [1], search: 'needle' })).toThrow(UnsupportedFilterError);
    expect(() => key([{ kinds: [1], search: 'needle' }])).toThrow(UnsupportedFilterError);
    expect(() => validateFilter({ nonsense: 1 } as unknown as Nostr.Filter)).toThrow(
      UnsupportedFilterError
    );
    // Only single-letter tag filters are indexed by relays (NIP-01). A
    // multi-character one goes on the wire, is ignored there, and is then
    // enforced locally — the same disagreement between predicate and request
    // that `search` is rejected for, pointing the other way. Loosening the tag
    // test to `startsWith('#')` is the plausible mistake, and it went unnoticed
    // until this line existed.
    expect(() => validateFilter({ '#foo': ['x'] } as unknown as Nostr.Filter)).toThrow(
      UnsupportedFilterError
    );
    // Rejecting is what keeps the wire request and the local predicate in
    // agreement; silently dropping `search` would send it to relays while
    // accepting everything locally.
  });

  it('KI5e: values rx-nostr would silently rewrite are rejected too, not just names', () => {
    // The rule is "reject where the predicate and the wire disagree". It was
    // applied to field names only, so the values `normalizeFilter` strips on the
    // way out went through — and stripping a constraint makes the request wider,
    // not narrower (CTR-4).
    expect(() => validateFilter({ kinds: [1], limit: -1 })).toThrow(UnsupportedFilterError);
    expect(() => validateFilter({ kinds: [1], since: -1 })).toThrow(UnsupportedFilterError);
    expect(() => validateFilter({ kinds: [1], until: -1 })).toThrow(UnsupportedFilterError);
    // An impossible range deletes the whole filter upstream, and a request whose
    // filters have all been deleted is never sent: no REQ, no CLOSED, no EOSE,
    // no error. Silence indistinguishable from #90.
    expect(() => validateFilter({ kinds: [1], since: 100, until: 50 })).toThrow(
      UnsupportedFilterError
    );

    // The boundary is accepted: equal bounds are a satisfiable request. **Both
    // falsy bounds are rejected**, for one reason: the dependency drops either
    // at send time with a truthiness test, so the relay is asked with no bound
    // at all. `since: 0` was admitted for a round on the argument that
    // "created_at >= 0 constrains nothing" — an assumption this library does not
    // make anywhere else, and one a validly signed event with a negative
    // `created_at` falsifies.
    expect(() => validateFilter({ kinds: [1], until: 0 })).toThrow(UnsupportedFilterError);
    expect(() => validateFilter({ kinds: [1], since: 0 })).toThrow(UnsupportedFilterError);
    // The rule is "non-negative safe integer", not a list of the values seen so
    // far. NaN and Infinity are stripped or malformed the same way a negative
    // number is, and enumerating kept the reject set one example behind.
    expect(() => validateFilter({ kinds: [1], until: Number.NaN })).toThrow(UnsupportedFilterError);
    expect(() => validateFilter({ kinds: [1], since: Number.NaN })).toThrow(UnsupportedFilterError);
    expect(() => validateFilter({ kinds: [1], limit: Number.NaN })).toThrow(UnsupportedFilterError);
    expect(() => validateFilter({ kinds: [1], until: Number.POSITIVE_INFINITY })).toThrow(
      UnsupportedFilterError
    );
    expect(() => validateFilter({ kinds: [1], limit: 1.5 })).toThrow(UnsupportedFilterError);
    expect(() => validateFilter({ kinds: [1], since: 50, until: 50 })).not.toThrow();
    expect(() => validateFilter({ kinds: [1], limit: 0 })).not.toThrow();
  });

  // Upstream sentinel, not a release gate: these record *why* the rejection rule
  // exists. If rx-nostr starts evaluating these fields the rule can be relaxed,
  // and this test failing is the signal to revisit — not a contract violation.
  // Previously this reasoning lived only in a comment.
  it("KI5b: rx-nostr's matcher accepts everything for `search`, which is why it is rejected", () => {
    const event = {
      id: 'i',
      pubkey: 'p',
      created_at: 10,
      kind: 1,
      tags: [],
      content: 'haystack',
      sig: 's'
    };
    // The content does not contain the term, yet the predicate says it matches.
    // A wire request carrying `search` would therefore be paired with a local
    // predicate that accepts every event the relay sends.
    expect(isFiltered(event, { search: 'needle' })).toBe(true);
  });

  it('KI5c: the falsy-bound gap is real for both bounds, and the event that shows it is signable', () => {
    const event = {
      id: 'i',
      pubkey: 'p',
      created_at: 10,
      kind: 1,
      tags: [],
      content: '',
      sig: 's'
    };

    // `until: 0` means created_at <= 0, so this should not match. It does,
    // because the implementation guards with `filter.until &&`.
    expect(isFiltered(event, { until: 0 })).toBe(true);
    expect(isFiltered(event, { until: 5 })).toBe(false);

    // **`since: 0` was called harmless here, and the argument was this
    // library's own assumption about somebody else's data.** It went: ignoring
    // it cannot change the answer, because it means `created_at >= 0` and every
    // event satisfies that. The ingest boundary two files away admits any
    // *finite* `created_at` — `isWireEvent` checks `Number.isFinite` and
    // nothing more — and a negative one carries a real signature, so the
    // premise was never this boundary's to make.
    expect(isFiltered(event, { since: 0 })).toBe(true);
    expect(isFiltered(event, { since: 50 })).toBe(false);
    // The event the argument forgot: below the epoch, and matched by a filter
    // that says it should not be.
    const backdated = { ...event, created_at: -5 };
    expect(isFiltered(backdated, { since: 0 })).toBe(true);
    expect(isFiltered(backdated, { since: 1 })).toBe(false);
    // So the rule is what it was written to be — reject where the predicate and
    // the wire disagree — and both falsy bounds are on the same side of it.
    expect(() => validateFilter({ kinds: [1], since: 0 })).toThrow(UnsupportedFilterError);
  });

  it('KI5d: tags are ANDed across names, ORed within one, and matched on two elements', () => {
    // The acceptance predicate is derived from the same filters that go on the
    // wire, so its tag semantics are part of B4's correctness — and tags are
    // where #63 (a hardcoded `d` tag position) and #64 (the wrong aggregation
    // key) both went wrong. Recorded as an upstream sentinel: if rx-nostr
    // changes any of these, the derivation has to be revisited.
    const event = {
      id: 'i',
      pubkey: 'p',
      created_at: 10,
      kind: 1,
      // A real `e` tag carries a relay hint and a marker after the value.
      tags: [
        ['e', 'e1', 'wss://relay.example/', 'root'],
        ['p', 'p1']
      ],
      content: '',
      sig: 's'
    };

    // Within one tag name the values are alternatives.
    expect(isFiltered(event, { '#e': ['e1', 'e2'] })).toBe(true);
    expect(isFiltered(event, { '#e': ['e2'] })).toBe(false);

    // Across tag names they are conjoined.
    expect(isFiltered(event, { '#e': ['e1'], '#p': ['p1'] })).toBe(true);
    expect(isFiltered(event, { '#e': ['e1'], '#p': ['p2'] })).toBe(false);

    // Only the first two elements of an event tag take part. The marker sits in
    // position four and cannot be matched, so a filter must never be built from
    // anything past the value.
    expect(isFiltered(event, { '#e': ['root'] })).toBe(false);
    expect(isFiltered(event, { '#e': ['wss://relay.example/'] })).toBe(false);
  });

  // @contracts B1-C1
  it('KI6: randomised — the safety condition holds over generated descriptors', () => {
    // The previous version of this sweep generated set fields of length 1 and
    // OR arrays of length 1, with a fixed scope and no namespace, so it never
    // reached the sort/dedupe paths it was supposed to cover: mutation testing
    // showed it missed every defect that K2/K3/K4 did not already catch. It now
    // generates alternate spellings of the same request on purpose, and compares
    // against a semantic identity computed by a different route than the key.
    const rand = mulberry32(0x5eed);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)] as T;
    const shuffle = <T>(xs: T[]): T[] => {
      const out = [...xs];
      for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j] as T, out[i] as T];
      }
      return out;
    };
    /** 1-3 members drawn from a pool, shuffled, sometimes with a duplicate. */
    const someOf = <T>(pool: T[]): T[] => {
      const n = 1 + Math.floor(rand() * 3);
      const chosen = shuffle(pool).slice(0, n);
      return rand() < 0.4 ? shuffle([...chosen, pick(chosen)]) : chosen;
    };

    const buildFilter = (): Nostr.Filter => {
      const f: Nostr.Filter = {};
      // Always present, and never ephemeral: the boundary refuses a filter that
      // could select one, and an absent `kinds` could. The sweep generates
      // descriptors the API accepts, so that a collision it finds is a defect
      // in the key rather than a request nobody can make.
      f.kinds = someOf([0, 1, 3, 7, 10002, 30023]);
      if (rand() < 0.7) f.authors = someOf([A, B, X]);
      if (rand() < 0.3) f.ids = someOf([X, Y, 'e'.repeat(64)]);
      // Ordered, because `validateFilter` now rejects `since > until`: rx-nostr
      // deletes such a filter on the way out, and a request whose filters have
      // all been deleted is never sent. The sweep is about key identity, so it
      // generates only descriptors the API accepts.
      if (rand() < 0.3) {
        // Ordered, and `until` never 0: both are rejected by `validateFilter`,
        // and this sweep is about key identity over descriptors the API accepts.
        // Neither bound is ever 0: both falsy bounds are rejected by
        // `validateFilter`, for the one reason the dependency gives them.
        const bounds = [pick([1, 50, 100]), pick([1, 100])].sort((a, b) => a - b) as number[];
        f.since = bounds[0] as number;
        if (rand() < 0.5) f.until = bounds[1] as number;
      }
      if (rand() < 0.3) f.limit = pick([0, 1, 10]);
      if (rand() < 0.3) f['#e'] = someOf([X, Y]);
      return f;
    };

    /**
     * An alternate spelling of the same request: array values permuted and
     * duplicated, filter fields reordered, the OR array shuffled.
     *
     * Waiting for the sweep to stumble onto two equivalent descriptors leaves
     * whole fields uncovered, because a collision needs every *other* field to
     * match as well. Tags were measured to be one of those fields: dropping the
     * sort/dedupe from the tag branch changed keys and this sweep still passed.
     * Comparing each descriptor against a re-spelling built on purpose covers
     * every field the generator emits, tags included.
     */
    const respell = (filters: Nostr.Filter[]): Nostr.Filter[] =>
      shuffle(
        filters.map((f) => {
          const out: Record<string, unknown> = {};
          for (const k of shuffle(Object.keys(f))) {
            const v = (f as Record<string, unknown>)[k];
            out[k] = Array.isArray(v) ? shuffle(v.length > 0 ? [...v, v[0]] : []) : v;
          }
          return out as Nostr.Filter;
        })
      );

    /**
     * The semantic identity of a descriptor, computed independently of
     * `canonicalKey` — a different serialisation shape, built with Sets and
     * joins rather than JSON — so that a shared bug does not make the two agree
     * by accident.
     */
    const identityOf = (input: {
      filters: Nostr.Filter[];
      live: boolean;
      scopeGeneration: string;
      namespace?: string | undefined;
      retain?: 'unbounded' | number;
      settleTimeoutMs?: number | undefined;
    }): string => {
      const one = (f: Nostr.Filter) =>
        Object.keys(f)
          .sort()
          .map((k) => {
            const v = (f as Record<string, unknown>)[k];
            return Array.isArray(v)
              ? `${k}=[${[...new Set(v as Array<string | number>)].map(String).sort().join('|')}]`
              : `${k}=${String(v)}`;
          })
          .join(';');
      const fs = [...new Set(input.filters.map(one))].sort().join('/');
      // **Six fields, and this oracle carried four.** `settleTimeoutMs` and
      // `retain` are key inputs — two requests that wait for different lengths
      // of time, or keep different numbers of events, are different requests —
      // and the generator pinned `retain` and never emitted a timeout, so the
      // sweep's own Given could not produce a pair that differed in either.
      // What that made the row was a sweep over four fields wearing the words
      // of a sweep over descriptors; the single pairs `K4b`/`K4c` were carrying
      // the other two alone.
      return [
        input.scopeGeneration,
        input.namespace ?? '',
        input.live,
        input.retain ?? 'unbounded',
        input.settleTimeoutMs ?? 'default',
        fs
      ].join('#');
    };

    const byKey = new Map<string, string>();
    const byIdentity = new Map<string, string>();
    let falsePositives = 0;
    let splits = 0;
    let respellSplits = 0;
    // Each descriptor beside itself with exactly one keyed axis moved: the
    // direction of the safety condition that matters, asked of every shape the
    // generator makes rather than left to two draws meeting on every other
    // field. Without it an axis is covered only by collisions, and a key that
    // dropped the scope saw none at this seed.
    const moved = new Map<string, number>();
    const perturbed = (input: {
      filters: Nostr.Filter[];
      live: boolean;
      retain: 'unbounded' | number;
      scopeGeneration: string;
      namespace?: string;
      settleTimeoutMs?: number;
    }): [string, typeof input][] => [
      ['scope', { ...input, scopeGeneration: input.scopeGeneration === 'A' ? 'B' : 'A' }],
      ['live', { ...input, live: !input.live }],
      ['retain', { ...input, retain: input.retain === 'unbounded' ? 50 : 'unbounded' }],
      ['namespace', { ...input, namespace: input.namespace === 'n1' ? 'n2' : 'n1' }],
      ['settle', { ...input, settleTimeoutMs: input.settleTimeoutMs === 1_000 ? 7_000 : 1_000 }],
      [
        'filters',
        {
          ...input,
          filters: [{ ...input.filters[0], kinds: [65_000] }, ...input.filters.slice(1)]
        }
      ]
    ];

    for (let i = 0; i < 2000; i += 1) {
      const filters = shuffle(Array.from({ length: 1 + Math.floor(rand() * 3) }, buildFilter));
      // Sometimes repeat a filter: the OR array's duplicates must not matter.
      if (rand() < 0.3 && filters.length > 0) filters.push(filters[0] as Nostr.Filter);

      const input = {
        filters,
        live: rand() < 0.5,
        retain: pick(['unbounded' as const, 50, 200]),
        scopeGeneration: pick(['A', 'B']),
        ...(rand() < 0.5 ? { namespace: pick(['n1', 'n2']) } : {}),
        // **Neither value is the default**, and that is not cosmetic: an
        // absent `settleTimeoutMs` is resolved to 5 000 at the boundary, so a
        // descriptor written with `5_000` and one written without are the same
        // request — and an oracle that spelled one `'default'` and the other
        // `5000` would report the key merging them as a false positive.
        // Measured: it did, once in 2 000.
        ...(rand() < 0.5 ? { settleTimeoutMs: pick([1_000, 7_000]) } : {})
      };

      const k = keyOf(input);
      const id = identityOf(input);

      // The same request, written differently, must land on the same key.
      if (keyOf({ ...input, filters: respell(filters) }) !== k) respellSplits += 1;
      for (const [axis, variant] of perturbed(input)) {
        if (identityOf(variant) === id) continue;
        moved.set(axis, (moved.get(axis) ?? 0) + 1);
        if (keyOf(variant) === k) falsePositives += 1;
      }

      // Required direction: one key must never cover two different requests.
      const previous = byKey.get(k);
      if (previous !== undefined && previous !== id) falsePositives += 1;
      byKey.set(k, id);

      // Not required by the safety condition, but our implementation provides
      // it: equivalent spellings land on one entry. Losing it costs duplicate
      // REQs, so it should be a deliberate change rather than a silent one.
      const previousKey = byIdentity.get(id);
      if (previousKey !== undefined && previousKey !== k) splits += 1;
      byIdentity.set(id, k);
    }

    expect(falsePositives).toBe(0);
    expect(splits).toBe(0);
    expect(respellSplits).toBe(0);
    // Every axis was moved on most draws — the arm is not satisfied by an
    // axis the identity treats as unchanged.
    for (const axis of ['scope', 'live', 'retain', 'namespace', 'settle', 'filters'])
      expect(moved.get(axis) ?? 0, axis).toBeGreaterThan(1_000);
    // The sweep is only meaningful if it actually produced alternate spellings
    // of the same request; assert that it did.
    expect(byIdentity.size).toBeLessThan(2000);
  });
});

// ---------------------------------------------------------------------------

let seq = 0;
/**
 * A packet the cache can take: built as the wire builds one, then through the
 * ownership boundary.
 *
 * **`ownPacket` is the only way to make one**, and that is the point of the
 * brand on `OwnedPacket`: a fold of a raw `EventPacket` is a state the library
 * cannot reach, so a test that arranged it was measuring nothing. `undefined`
 * would mean this fixture is not a well-formed event, which is a broken test
 * rather than a case.
 */
function ev(overrides: Partial<Nostr.Event> = {}): OwnedPacket {
  seq += 1;
  const event: Nostr.Event = {
    id: `id-${seq}`,
    pubkey: 'p1',
    created_at: seq,
    kind: 1,
    tags: [],
    content: '',
    sig: 's',
    ...overrides
  };
  const wire: EventPacket = {
    from: 'wss://r/',
    type: 'EVENT',
    subId: 'sub',
    event,
    message: ['EVENT', 'sub', event]
  };
  const owned = ownPacket(wire);
  if (owned === undefined) throw new Error('the fixture is not a well-formed event');
  return owned;
}

const foldAll = (packets: OwnedPacket[]): CachedEventSet =>
  packets.reduce((acc, packet) => foldEvent(acc, packet), emptyEventSet);

const idsOf = (set: CachedEventSet) => selectMany(set).map((p) => p.event.id);

/**
 * What a set holds, each event whole: an id kept with another revision's
 * content or tags is a different event, so nothing is projected away.
 */
const heldOf = (set: CachedEventSet): string[] =>
  selectMany(set)
    .map(({ event }) => JSON.stringify(event))
    .sort();

/** Another 128-digit signature than `sig`. */
const run128 = (sig: string): string => (sig === 'f'.repeat(128) ? '0' : 'f').repeat(128);

/** Held events with the fields outside the id taken out: what the id commits to. */
const committedOf = (held: readonly string[]): string[] =>
  held
    .map((json) => {
      const event = JSON.parse(json) as Record<string, unknown>;
      for (const field of OUTSIDE_THE_ID) delete event[field];
      return JSON.stringify(event);
    })
    .sort();

/** What NIP-01 keeps of `packets`, each event whole, by `helpers/nip01.ts`. */
const keptOf = (packets: readonly OwnedPacket[]): string[] =>
  [...winnersOf(packets.map(({ event }) => event)).values()]
    .map((event) => JSON.stringify(event))
    .sort();

/**
 * The packets of an enumerated case, the last of them from another relay when
 * `elsewhere`, as a parsed copy that shares nothing with the others.
 */
const packetsOfCase = (
  events: readonly Partial<Nostr.Event>[],
  elsewhere: boolean
): OwnedPacket[] =>
  events.map((fields, at) => {
    const packet = ev(fields);
    return elsewhere && at === events.length - 1
      ? ({
          ...packet,
          from: 'wss://elsewhere/',
          event: structuredClone(packet.event)
        } as OwnedPacket)
      : packet;
  });

/** The enumerated design, built once. */
const CASES = minimalPairs();

/** The packets for `events`, half of them from a second relay. */
const packetsOf = (events: readonly Partial<Nostr.Event>[], rand: () => number): OwnedPacket[] =>
  events.map((fields) => {
    const packet = ev(fields);
    return rand() < 0.5
      ? packet
      : ({ ...packet, from: 'wss://elsewhere/', event: { ...packet.event } } as OwnedPacket);
  });

describe('canonical event set', () => {
  it('ES1: kinds are classified by the NIP-01 ranges', () => {
    expect(classifyKind(0)).toBe('replaceable');
    expect(classifyKind(3)).toBe('replaceable');
    expect(classifyKind(1)).toBe('regular');
    expect(classifyKind(7)).toBe('regular');
    expect(classifyKind(9999)).toBe('regular');
    expect(classifyKind(10002)).toBe('replaceable');
    expect(classifyKind(20001)).toBe('ephemeral');
    expect(classifyKind(30023)).toBe('addressable');
  });

  // @contracts B5-C7
  it('ES1b: every range boundary is pinned, and the two specials beside their neighbours', () => {
    // The ranges are the whole content of the classifier, so an off-by-one at
    // any edge is the failure to guard against. Examples in the middle of a
    // range cannot see one.
    // NIP-01's regular ranges, both sides of each edge: 1, 2, 4–44 and
    // 1000–9999.
    expect(classifyKind(1)).toBe('regular');
    expect(classifyKind(2)).toBe('regular');
    expect(classifyKind(4)).toBe('regular');
    expect(classifyKind(44)).toBe('regular');
    expect(classifyKind(1000)).toBe('regular');
    expect(classifyKind(9999)).toBe('regular');
    // The kinds NIP-01 leaves unclassified — 45–999 and 40000–65535 — are kept
    // as regular events by this library's decision (0003), not the protocol's.
    expect(classifyKind(45)).toBe('regular');
    expect(classifyKind(999)).toBe('regular');
    expect(classifyKind(65535)).toBe('regular');
    expect(classifyKind(10000)).toBe('replaceable');
    expect(classifyKind(19999)).toBe('replaceable');
    expect(classifyKind(20000)).toBe('ephemeral');
    expect(classifyKind(29999)).toBe('ephemeral');
    expect(classifyKind(30000)).toBe('addressable');
    expect(classifyKind(39999)).toBe('addressable');
    expect(classifyKind(40000)).toBe('regular');

    // **`0` and `3` are not explained by any range.** Both sit inside the span
    // the classifier answers `regular` for, and both are `replaceable` by a
    // clause of their own — NIP-01 names them rather than deriving them. The
    // range edges above cannot see them: a classifier that dropped the special
    // line keeps every one of those assertions green and starts replacing
    // nothing for a profile or a contact list, which is why they are asserted
    // here, beside the edges.
    expect(classifyKind(0)).toBe('replaceable');
    expect(classifyKind(3)).toBe('replaceable');

    // **And the neighbours, which is the other edge.** Without them the two
    // lines above are satisfied by a classifier that calls the whole low span
    // replaceable — and a `kind: 1` note replaced by its author's next one is
    // a feed that loses everything but the newest post.
    expect(classifyKind(1)).toBe('regular');
    expect(classifyKind(2)).toBe('regular');
    expect(classifyKind(4)).toBe('regular');
  });

  it('ES2: the replacement key follows the class, not the call site', () => {
    expect(replacementKey(ev({ kind: 1 }).event)).toMatch(/^id-/);
    expect(replacementKey(ev({ kind: 0 }).event)).toBe('0:p1');
    expect(
      replacementKey(
        ev({
          kind: 30023,
          tags: [
            ['title', 't'],
            ['d', 'slug']
          ]
        }).event
      )
    ).toBe('30023:p1:slug');
    // An addressable event with no `d` tag is addressed as if it were empty.
    expect(replacementKey(ev({ kind: 30023, tags: [] }).event)).toBe('30023:p1:');
  });

  // @contracts B5-C3
  it('ES3: the fold is idempotent, and a replay does not even rebuild the set', () => {
    const a = ev();
    const b = ev({ kind: 0 });
    expect(idsOf(foldAll([a, b, a, b, a]))).toEqual(idsOf(foldAll([a, b])));

    // Comparing ids only says the *value* is unchanged, which the Map gives for
    // free — no mutation of the fold could break it, so that assertion defends
    // nothing. Replaying must also return the identical set: a fold that
    // rebuilds on a replay makes every consumer of the cache value re-render on
    // a duplicate packet, and duplicates are the normal case with several
    // relays. This direction is breakable, and it is the one worth pinning.
    const set = foldAll([a, b]);
    expect(foldEvent(set, a)).toBe(set);
    expect(foldEvent(set, b)).toBe(set);

    // The duplicate that actually occurs is the same event delivered by a second
    // relay: an equal event in a different packet object. Re-folding the
    // identical object proves nothing about the comparison, because reference
    // equality short-circuits it either way.
    const fromAnotherRelay = { ...b, from: 'wss://other/', event: structuredClone(b.event) };
    expect(foldEvent(set, fromAnotherRelay)).toBe(set);
    const regularElsewhere = { ...a, from: 'wss://other/', event: structuredClone(a.event) };
    expect(foldEvent(set, regularElsewhere)).toBe(set);
    // From another relay, in every class with a coordinate as well: a tie-break
    // that let an equal event replace the incumbent for one class alone would
    // rebuild the set there and nowhere else.
    for (const kind of [3, 10002, 19999]) {
      const held = ev({ kind });
      const holding = foldEvent(set, held);
      const elsewhere = { ...held, from: 'wss://other/', event: structuredClone(held.event) };
      expect(foldEvent(holding, elsewhere), `${kind}`).toBe(holding);
    }

    // Every path a replay can take returns what it was given: an addressable
    // event, from either relay, and an ephemeral one once it has been noted.
    // **A replay from another relay is a separate object all the way down** —
    // `structuredClone`, not a spread — since a relay hands over a parsed copy
    // and shares nothing with the incumbent, not even its tag arrays.
    const addressable = ev({ kind: 30023, tags: [['d', 's']] });
    const withIt = foldEvent(set, addressable);
    expect(foldEvent(withIt, addressable)).toBe(withIt);
    const addressableElsewhere = {
      ...addressable,
      from: 'wss://other/',
      event: structuredClone(addressable.event)
    };
    expect(foldEvent(withIt, addressableElsewhere)).toBe(withIt);
    const ephemeral = ev({ kind: 20001 });
    const noted = foldEvent(set, ephemeral);
    expect(foldEvent(noted, ephemeral)).toBe(noted);
    expect(foldEvent(noted, { ...ephemeral, event: structuredClone(ephemeral.event) })).toBe(noted);

    // **And every enumerated case** (`helpers/design.ts`): both events folded,
    // in both orders, then each replayed — the same object, and a parsed copy
    // from another relay — after the whole case, so a revision replayed after
    // it was superseded is among them, with every value the rules read. Each
    // replay returns the set it was given.
    for (const { label, events } of CASES) {
      const packets = events.map((fields) => ev(fields));
      for (const order of [packets, [...packets].reverse()]) {
        const folded = foldAll(order);
        for (const packet of packets) {
          expect(foldEvent(folded, packet), `${label}: the same object`).toBe(folded);
          const elsewhere = {
            ...packet,
            from: 'wss://elsewhere/',
            event: structuredClone(packet.event)
          };
          expect(foldEvent(folded, elsewhere), `${label}: from another relay`).toBe(folded);
          // The same event with each field outside the id changed — another
          // valid signature, another `ots` — is a replay too (0003).
          for (const field of OUTSIDE_THE_ID) {
            const variant = structuredClone(packet.event) as unknown as Record<string, unknown>;
            variant[field] =
              field === 'sig' ? run128(packet.event.sig) : `${String(variant[field] ?? '')}+`;
            expect(
              foldEvent(folded, { ...elsewhere, event: variant as unknown as typeof packet.event }),
              `${label}: another ${field}`
            ).toBe(folded);
          }
        }
      }
    }

    // A seeded sweep over drawn events beside it, for combinations of several
    // coordinates the pairs above do not build. It claims no coverage.
    const draws = mulberry32(0xb5c3);
    for (let trial = 0; trial < 200; trial += 1) {
      const packets = arbitraryEvents(draws, 3 + Math.floor(draws() * 8)).map((fields) =>
        ev(fields)
      );
      const folded = foldAll(packets);
      for (const packet of shuffled(packets, draws)) {
        const replayed = {
          ...packet,
          from: 'wss://elsewhere/',
          event: structuredClone(packet.event)
        };
        expect(foldEvent(folded, replayed), `trial ${trial}: ${packet.event.id}`).toBe(folded);
      }
    }
  });

  it('ES29: every domain the design draws from shows every folding in the catalogue', () => {
    // An instrument, not a landing: what it holds is `helpers/design.ts`. For
    // each transformation a careless reader applies (`FOLDS`), the domain it
    // would be applied to must hold the input that shows it — a pair it merges
    // for an identifier, a value it changes for a payload, an ordered pair it
    // reorders for an instant. A folding found next is one line in `FOLDS`, and
    // this refuses a domain that cannot show it rather than letting the landings
    // pass on inputs that never meet it.
    // The `d` tag lists the design pairs, for the choice among several.
    const tagPairs = CASES.filter(
      (one) => one.dimension === 'd shape' && one.kinds.every((kind) => kind >= 30000)
    ).map(({ events }) => events.map(({ tags }) => tags ?? []) as [string[][], string[][]]);
    const shows = (fold: Fold): boolean => {
      switch (fold.domain) {
        case 'instant':
          return INSTANTS.some((older, at) =>
            INSTANTS.slice(at + 1).some((newer) => !(fold.key(older) < fold.key(newer)))
          );
        case 'hex order':
          return HEX_PAIRS.some(([a, b]) => fold.key(a) < fold.key(b) !== a < b);
        case 'd selection':
          return tagPairs.some(
            ([a, b]) => (fold.select(a) === fold.select(b)) !== (firstD(a) === firstD(b))
          );
        case 'payload string':
          return DOMAINS[fold.domain].flat().some((value) => fold.apply(value) !== value);
        case 'identifier string':
        case 'tag name':
        case 'hex':
          return (DOMAINS[fold.domain] as readonly (readonly [string, string])[]).some(
            ([a, b]) => a !== b && fold.apply(a) === fold.apply(b)
          );
        default:
          return fold satisfies never;
      }
    };
    for (const fold of FOLDS) expect(shows(fold), `${fold.domain}: ${fold.name}`).toBe(true);

    // The positive controls: a transformation that keeps what the rules read
    // shows nothing in any domain, so the check is not satisfied by any
    // function at all.
    const controls: Fold[] = [
      { name: 'injective', domain: 'identifier string', apply: (value) => `<${value}>` },
      { name: 'unchanged', domain: 'instant', key: (value) => value },
      { name: 'unchanged', domain: 'hex order', key: (value) => value },
      { name: 'the first', domain: 'd selection', select: firstD }
    ];
    for (const control of controls) expect(shows(control), `control ${control.domain}`).toBe(false);

    // **Every crossing the design promises has a case**: each dimension, over
    // each kind `CROSSINGS` lists for it, at every relation and in both
    // directions. A product narrowed by hand — ties for two kinds only — is
    // refused here by name, rather than left for a reviewer to notice.
    const missing = (cases: readonly Case[]): string[] =>
      (Object.entries(CROSSINGS) as [Dimension, (typeof CROSSINGS)[Dimension]][]).flatMap(
        ([dimension, { kinds, relations }]) =>
          kinds.flatMap((kind) =>
            relations.flatMap((relation) =>
              DIRECTIONS.filter(
                (direction) =>
                  !cases.some(
                    (one) =>
                      one.dimension === dimension &&
                      one.kinds.includes(kind) &&
                      one.relation === relation &&
                      one.direction === direction
                  )
              ).map((direction) => `${dimension} / kind ${kind} / ${relation} / ${direction}`)
            )
          )
      );
    expect(missing(CASES)).toEqual([]);
    // Its control: the design with kind 3's ties taken out is refused.
    expect(
      missing(CASES.filter((one) => !(one.kinds.includes(3) && one.relation === 'tie')))
    ).toContain('instant / kind 3 / tie / as built');
    // And a relation is crossed only where it can be: two packets of one id tie.
    expect(CROSSINGS['same id'].relations).toEqual(['tie']);
    expect(
      [...new Set(Object.values(CROSSINGS).flatMap(({ relations }) => relations))].sort()
    ).toEqual([...RELATIONS].sort());

    // **Every field of an event has a role, and every payload field is a
    // dimension and a ranking variant.** `FIELD_ROLES` is checked against the
    // event type when it compiles; here, against an event as built, and the
    // payload fields against what the design and the bound's variants change.
    expect(Object.keys(base(1, { ots: 'o' })).sort()).toEqual(Object.keys(FIELD_ROLES).sort());
    const payload = (Object.entries(FIELD_ROLES) as [string, readonly string[]][])
      .filter(([, roles]) => roles.includes('payload'))
      .map(([field]) => field);
    expect([...payload].sort()).toEqual([...PAYLOAD_FIELDS].sort());
    for (const field of PAYLOAD_FIELDS) {
      expect(Object.keys(CROSSINGS), `${field}: a dimension`).toContain(field);
      const probe = base(1, { ots: 'o' });
      const changed = rankingVariants().some(
        ([winner]) => JSON.stringify(winner(probe)[field]) !== JSON.stringify(probe[field])
      );
      expect(changed, `${field}: a ranking variant`).toBe(true);
    }
    // **And every field outside the id differs between two packets of one
    // id** in some case, since the id cannot tell them apart and the rules
    // have to.
    // Which fields are outside the id is NIP-01's serialization, not a choice.
    expect([...OUTSIDE_THE_ID].sort()).toEqual(
      Object.keys(FIELD_ROLES)
        .filter((field) => field !== 'id' && !(SERIALIZED as readonly string[]).includes(field))
        .sort()
    );
    for (const field of OUTSIDE_THE_ID)
      expect(
        CASES.some(
          ({ dimension, events: [a, b] }) =>
            dimension === 'same id' &&
            a?.id === b?.id &&
            JSON.stringify(a?.[field]) !== JSON.stringify(b?.[field])
        ),
        `${field}: two packets of one id`
      ).toBe(true);
  });

  it('ES4: the fold is order-independent, including on created_at ties', () => {
    const older = ev({ kind: 0, created_at: 10, id: 'bbb' });
    const newer = ev({ kind: 0, created_at: 20, id: 'aaa' });
    expect(idsOf(foldAll([older, newer]))).toEqual(idsOf(foldAll([newer, older])));

    // Tie on created_at: the lower id wins, whichever arrives first.
    const tieLow = ev({ kind: 0, created_at: 30, id: 'aaa' });
    const tieHigh = ev({ kind: 0, created_at: 30, id: 'zzz' });
    expect(idsOf(foldAll([tieLow, tieHigh]))).toEqual(['aaa']);
    expect(idsOf(foldAll([tieHigh, tieLow]))).toEqual(['aaa']);
    expect(laterWins(tieLow.event, tieHigh.event).id).toBe('aaa');
  });

  // @contracts B5-C2
  it('ES5: randomised — any permutation of the same packets folds to the same set', () => {
    const rand = mulberry32(0xc0ffee);
    const packets = [
      // The tie has to decide the final set, or the permutation sweep says
      // nothing about the tie-break. Previously a third, newer metadata event
      // beat both of these regardless of order, so removing the tie-break left
      // this test passing — the coverage was vacuous.
      ev({ kind: 0, created_at: 5, id: 'm1', content: 'content of m1' }),
      ev({ kind: 0, created_at: 5, id: 'm0', content: 'content of m0' }),
      ev({ kind: 0, created_at: 2, id: 'm2', content: 'content of m2' }),
      ev({ kind: 1, created_at: 1, id: 'n1', content: 'content of n1' }),
      ev({ kind: 1, created_at: 2, id: 'n2', content: 'content of n2' }),
      ev({ kind: 30023, created_at: 3, id: 'a1', content: 'content of a1', tags: [['d', 's']] }),
      ev({ kind: 30023, created_at: 4, id: 'a2', content: 'content of a2', tags: [['d', 's']] }),
      ev({
        kind: 30023,
        created_at: 4,
        id: 'a3',
        content: 'content of a3',
        tags: [['d', 'other']]
      }),
      // And a tie in each other class with a coordinate: a replaceable kind
      // from the range, and an addressable one under one `d`. A tie-break
      // written for one class alone is an order-dependent fold for the rest.
      ev({ kind: 10002, created_at: 7, id: 'r1', content: 'content of r1' }),
      ev({ kind: 10002, created_at: 7, id: 'r0', content: 'content of r0' }),
      ev({ kind: 30023, created_at: 8, id: 'b1', content: 'content of b1', tags: [['d', 'u']] }),
      ev({ kind: 30023, created_at: 8, id: 'b0', content: 'content of b0', tags: [['d', 'u']] })
    ];
    const expected = ['b0', 'r0', 'm0', 'a2', 'a3', 'n2', 'n1'];
    // **Written out rather than derived from the fold.** It was
    // `idsOf(foldAll(packets))` — the implementation under test producing its
    // own oracle — so an implementation that stored nothing agreed with itself
    // two hundred times: measured, with `entries.set` removed this arm passed
    // and `E4` died. What the row claims is that every order gives *this* set,
    // and the ties are what make the claim non-trivial: `m0`/`m1`, `r0`/`r1`
    // and `b0`/`b1` each share a coordinate and a `created_at`, and the lower
    // id has to win from either direction. Two hundred seeded shuffles, not
    // every order of twelve packets.

    for (let i = 0; i < 200; i += 1) {
      const shuffled = [...packets];
      for (let j = shuffled.length - 1; j > 0; j -= 1) {
        const k = Math.floor(rand() * (j + 1));
        [shuffled[j], shuffled[k]] = [shuffled[k] as OwnedPacket, shuffled[j] as OwnedPacket];
      }
      expect(idsOf(foldAll(shuffled))).toEqual(expected);
      // And the payload: the id kept is kept with its own content.
      expect(
        selectMany(foldAll(shuffled)).every(
          ({ event }) => event.content === `content of ${event.id}`
        ),
        'an id kept with another revision’s content'
      ).toBe(true);
    }

    // **And every order of every enumerated case** (`helpers/design.ts`) — each
    // a minimal pair that changes one dimension, alone and beside an ephemeral
    // event the fold drops — folds to the one set the rules name, each event
    // whole, with the drop noted the same way.
    //
    // **Two packets of one id are the exception, and it is contracted** (0003):
    // they are one event, the first to arrive is kept whole, and so which
    // signature and which `ots` the set shows follows the arrival order. The
    // set is the same by everything the id commits to, and the kept packet is
    // the first — both halves are compared.
    for (const { label, events, dimension } of CASES)
      for (const set of [events, [...events, base(20001, { id: 'e'.repeat(64) })]])
        for (const elsewhere of [false, true]) {
          const packets = packetsOfCase(set, elsewhere);
          const expected = keptOf(packets);
          const dropped = packets.some(({ event }) => isEphemeral(event.kind));
          for (const order of permutations(packets)) {
            const folded = foldAll(order);
            if (dimension === 'same id') {
              expect(committedOf(heldOf(folded)), label).toEqual(committedOf(expected));
              expect(heldOf(folded), `${label}: the first kept`).toEqual(keptOf(order));
            } else expect(heldOf(folded), label).toEqual(expected);
            expect(folded.ephemeralOmitted === true, `${label}: the drop noted`).toBe(dropped);
          }
        }

    // A seeded sweep over drawn events beside it, for combinations of several
    // coordinates the pairs above do not build. It claims no coverage: what is
    // covered is what the design lists.
    const draws = mulberry32(0xb5c2);
    for (let trial = 0; trial < 100; trial += 1) {
      const packets = packetsOf(
        arbitraryEvents(draws, 3 + Math.floor(draws() * 8), { ephemeral: true }),
        draws
      );
      const expected = keptOf(packets);
      const dropped = packets.some(({ event }) => isEphemeral(event.kind));
      for (let order = 0; order < 10; order += 1) {
        const folded = foldAll(shuffled(packets, draws));
        expect(heldOf(folded), `trial ${trial}`).toEqual(expected);
        expect(folded.ephemeralOmitted === true, `trial ${trial}: the drop noted`).toBe(dropped);
      }
    }
  });

  it('ES6: the fold is monotonic — replaying everything can only keep or replace', () => {
    const first = foldAll([ev({ kind: 1, id: 'r1' }), ev({ kind: 0, created_at: 1, id: 'm1' })]);
    const again = [
      ev({ kind: 1, id: 'r1', created_at: 1 }),
      ev({ kind: 0, created_at: 1, id: 'm1' })
    ].reduce((acc, packet) => foldEvent(acc, packet), first);
    expect(idsOf(again)).toEqual(idsOf(first));

    const superseded = foldEvent(first, ev({ kind: 0, created_at: 99, id: 'm2' }));
    expect(idsOf(superseded)).toContain('m2');
    expect(idsOf(superseded)).not.toContain('m1');
    expect(idsOf(superseded)).toContain('r1');
  });

  // @contracts B5-C1
  it('ES28: two revisions of one replaceable event fold to the newer, under the identity its class dictates', () => {
    // Every class that has a coordinate, at the edges of its range and in the
    // middle: the two specials, the replaceable range, and the addressable one.
    // Each with the `d` tag after another tag, so the identifier is the `d`
    // tag's and not the first tag's.
    const tags = [
      ['title', 't'],
      ['d', 's']
    ];
    const KINDS = [0, 3, 10000, 10002, 19999, 30000, 30023, 39999];
    // **Each pair twice, with the ids in both orders**, so the newer winning is
    // recency and neither id order: a fold that let the lower id win, or the
    // higher, picks the older revision in one of the two.
    const ORDERS = [
      ['a-older', 'b-newer'],
      ['y-older', 'x-newer']
    ] as const;
    for (const kind of KINDS) {
      for (const [olderId, newerId] of ORDERS) {
        const older = ev({ kind, created_at: 10, id: `${kind}-${olderId}`, tags });
        const newer = ev({ kind, created_at: 20, id: `${kind}-${newerId}`, tags });
        // The newer, whichever revision arrives first.
        expect(idsOf(foldAll([older, newer])), `${kind}`).toEqual([`${kind}-${newerId}`]);
        expect(idsOf(foldAll([newer, older])), `${kind}`).toEqual([`${kind}-${newerId}`]);
        // And whichever relay each came from: the relay is not the coordinate.
        const fromAnother = { ...newer, from: 'wss://another/', event: { ...newer.event } };
        expect(idsOf(foldAll([older, fromAnother])), `${kind}: another relay`).toEqual([
          `${kind}-${newerId}`
        ]);
      }
      // Another author's revision is another event.
      const older = ev({ kind, created_at: 10, id: `${kind}-a-older`, tags });
      const theirs = ev({ kind, created_at: 20, id: `${kind}-theirs`, pubkey: 'p2', tags });
      expect(idsOf(foldAll([older, theirs])).sort(), `${kind}: another author`).toEqual(
        [`${kind}-a-older`, `${kind}-theirs`].sort()
      );
    }
    // **And every kind's revisions in one set**, so the kind is part of the
    // identity too: one author's lists of two replaceable kinds, or two
    // addressable kinds under one `d`, are two coordinates and not one.
    for (const [olderId, newerId] of ORDERS) {
      const together = KINDS.flatMap((kind) => [
        ev({ kind, created_at: 10, id: `${kind}-${olderId}`, tags }),
        ev({ kind, created_at: 20, id: `${kind}-${newerId}`, tags })
      ]);
      expect(idsOf(foldAll(together)).sort(), 'one coordinate per kind').toEqual(
        KINDS.map((kind) => `${kind}-${newerId}`).sort()
      );
    }
    // Addressable: the `d` tag is part of the coordinate, so a revision under
    // another `d` is another event — with the same first tag, so only the `d`
    // tells them apart — and a revision with no `d` at all is the one whose `d`
    // is empty. Replaceable: the `d` tag is not, so a revision that carries
    // another one is still a revision.
    const otherD = [
      ['title', 't'],
      ['d', 'other']
    ];
    for (const kind of [30000, 30023, 39999]) {
      const here = ev({ kind, created_at: 20, id: `${kind}-here`, tags });
      const elsewhere = ev({ kind, created_at: 10, id: `${kind}-elsewhere`, tags: otherD });
      expect(idsOf(foldAll([here, elsewhere])).sort(), `${kind}: another d`).toEqual(
        [`${kind}-elsewhere`, `${kind}-here`].sort()
      );
      const unnamed = ev({ kind, created_at: 10, id: `${kind}-unnamed`, tags: [] });
      const emptyD = ev({ kind, created_at: 20, id: `${kind}-empty-d`, tags: [['d', '']] });
      expect(idsOf(foldAll([unnamed, emptyD])), `${kind}: no d is the empty d`).toEqual([
        `${kind}-empty-d`
      ]);
    }
    for (const kind of [0, 10002]) {
      const before = ev({ kind, created_at: 10, id: `${kind}-a-before`, tags });
      const after = ev({ kind, created_at: 20, id: `${kind}-b-after`, tags: otherD });
      expect(idsOf(foldAll([before, after])), `${kind}: d is not its identity`).toEqual([
        `${kind}-b-after`
      ]);
    }
    // A regular kind has no revisions: one author and one kind are two events.
    for (const kind of [1, 9999, 40000]) {
      const first = ev({ kind, created_at: 10, id: `${kind}-first` });
      const second = ev({ kind, created_at: 20, id: `${kind}-second` });
      expect(idsOf(foldAll([first, second])).sort(), `${kind}`).toEqual(
        [`${kind}-first`, `${kind}-second`].sort()
      );
    }

    // **And every enumerated case** (`helpers/design.ts`): each changes one
    // dimension of a base event — kind, author, `d` value or shape, a tag name
    // that only looks like `d`, content, `sig`, an unrelated tag, recency over
    // every ordered pair of instants, a tie — and states whether the two share
    // a coordinate. The oracle has to agree with that statement, and the fold
    // with the oracle, in both orders and with the later one from another relay,
    // each event compared whole.
    for (const { label, events, sameCoordinate } of CASES) {
      const owned = events.map((fields) => ev(fields).event);
      const [first, second] = owned as [(typeof owned)[number], (typeof owned)[number]];
      expect(coordinateOf(first) === coordinateOf(second), `${label}: the oracle`).toBe(
        sameCoordinate
      );
      for (const elsewhere of [false, true]) {
        const packets = packetsOfCase(events, elsewhere);
        expect(keptOf(packets), `${label}: kept`).toHaveLength(sameCoordinate ? 1 : 2);
        // The oracle is given the arrival order: two packets of one id are one
        // event, and the first to arrive is kept (0003).
        for (const order of [packets, [...packets].reverse()])
          expect(heldOf(foldAll(order)), label).toEqual(keptOf(order));
      }
    }

    // A seeded sweep over drawn events beside it, for combinations of several
    // coordinates the pairs above do not build. It claims no coverage: what is
    // covered is what the design lists.
    const rand = mulberry32(0xb5c1);
    for (let trial = 0; trial < 300; trial += 1) {
      const packets = packetsOf(arbitraryEvents(rand, 3 + Math.floor(rand() * 8)), rand);
      const expected = keptOf(packets);
      for (const order of [packets, [...packets].reverse(), shuffled(packets, rand)])
        expect(heldOf(foldAll(order)), `trial ${trial}`).toEqual(expected);
    }
  });

  // `E6b` and `E13` are not here any more. Both were written against
  // `foldEvent(set, packet, { retain })`, and the fold takes no bound now:
  // bounding is a separate rule over the whole set, which is what keeps the
  // fold a function of the events seen. The reason recorded here used to be
  // that a bound has to know whether a candidate expired when the chunk
  // arrived, and that reading a clock inside the fold is what B7b's first
  // clause forbids — the bound reads no clock either (B6, B7b), so neither of
  // them judges expiry at all. They moved to the spike's `retention.test.ts`, beside the
  // rule they exercise, with their claims unchanged.

  it('ES7: a descriptor that names an ephemeral kind is refused, and an arrival is dropped and said', () => {
    // **Three positions in turn, and the third is the adjudicated one.** The
    // fold used to drop them **silently**, so `kinds: [1, 20001]` was accepted,
    // matched ephemeral events on the wire, and reported "nothing found" for
    // them. Then the boundary refused any descriptor that *could* select one —
    // which refuses `{ ids, limit }`, the by-id request the published components
    // make, because a filter with no `kinds` matches every kind.
    //
    // Now: **naming** an ephemeral kind is refused, at the request, because that
    // is a fault a caller can see in their own descriptor; a **live** request
    // with no `kinds` is refused, because a forward leg has nowhere to report an
    // omission; a **non-live** request with no `kinds` is accepted, and an
    // ephemeral arrival on its backlog is dropped **and reported** as
    // `ephemeral-event-omitted`. Silence is what is forbidden, not the drop.
    const of = (filters: Nostr.Filter[]) =>
      normalizeDescriptor({ filters, live: false, scopeGeneration: SCOPE });

    // Both range edges, and the interior.
    for (const kind of [20000, 20001, 29999]) {
      expect(() => of([{ kinds: [kind] }])).toThrow(UnsupportedFilterError);
    }
    // One ephemeral kind among acceptable ones is still a filter that can
    // select one, and one filter among several decides the whole descriptor.
    expect(() => of([{ kinds: [1, 20001] }])).toThrow(UnsupportedFilterError);
    expect(() => of([{ kinds: [1] }, { kinds: [20001] }])).toThrow(UnsupportedFilterError);
    // An absent `kinds` matches every kind, ephemeral included — and is
    // **accepted** when the request is not live, because the answer is finite
    // and an omission from it can be reported. `NZ19` drives both legs.
    expect(() => of([{ authors: [A] }])).not.toThrow();

    // Just outside the range on both sides, and the fold keeps them.
    expect(() => of([{ kinds: [19999, 30000] }])).not.toThrow();
    const set = foldAll([
      ev({ kind: 1, id: 'keep' }),
      ev({ kind: 19999, id: 'keep-replaceable', pubkey: 'other' }),
      ev({ kind: 30000, id: 'keep-addressable', tags: [['d', 'x']] })
    ]);
    expect(idsOf(set).sort()).toEqual(['keep', 'keep-addressable', 'keep-replaceable'].sort());
    // The control for the drop below: nothing ephemeral arrived, so the flag is
    // not set, and "the flag is set" is not something the fold does to every
    // value it touches.
    expect(set.ephemeralOmitted ?? false, 'no ephemeral arrival, no flag').toBe(false);

    // **And the drop, which is what the accepted unknown-kind request needs.**
    // The entry map does not take it, and the value says an omission happened —
    // the two halves together are what makes this a report rather than a
    // silence.
    const dropped = foldAll([ev({ kind: 1, id: 'kept' }), ev({ kind: 20_001, id: 'gone' })]);
    expect(idsOf(dropped)).toEqual(['kept']);
    expect(dropped.ephemeralOmitted, 'the omission is recorded on the value').toBe(true);
  });

  it('ES8: deletions and expirations are NOT interpreted in v1', () => {
    // Recorded as an explicit non-feature: a kind 5 is stored like any other
    // regular event, and nothing removes what it references.
    const target = ev({ kind: 1, id: 'target' });
    const deletion = ev({ kind: 5, id: 'del', tags: [['e', 'target']] });
    // NIP-40: an expiration far in the past. v1 does not read the tag, so the
    // event is retained like any other. Asserted so that starting to honour it
    // is a deliberate change with a failing test, not a silent one.
    const expired = ev({
      kind: 1,
      id: 'expired',
      tags: [['expiration', '1']]
    });
    const set = foldAll([target, deletion, expired]);
    expect(idsOf(set).sort()).toEqual(['del', 'expired', 'target']);
  });

  it('ES9: one fetch serves both a single view and a list view', () => {
    const set = foldAll([
      ev({ kind: 1, created_at: 1, id: 'old' }),
      ev({ kind: 1, created_at: 3, id: 'new' }),
      ev({ kind: 1, created_at: 2, id: 'mid' })
    ]);
    expect(selectOne(set)?.event.id).toBe('new');
    expect(idsOf(set)).toEqual(['new', 'mid', 'old']);
    expect(selectMany(set, { limit: 2 }).map((p) => p.event.id)).toEqual(['new', 'mid']);
    // The projection is a pure function of the set: it took no part in the fetch.
  });

  it('ES10: an empty set projects to an empty list and no single event', () => {
    expect(selectMany(emptyEventSet)).toEqual([]);
    expect(selectOne(emptyEventSet)).toBeUndefined();
  });

  it('ES11: the fold gives the same answer whatever the clock says', () => {
    // B7b, observed rather than inferred from the fold's source. A fold that
    // consulted the time would return different sets at two moments, and every
    // property above — idempotence, order-independence, absorbing a
    // reconnection's replay — assumes it does not.
    const packet = ev({
      id: 'e11',
      kind: 1,
      created_at: 5,
      tags: [['expiration', '1000']]
    });

    const before = foldEvent(emptyEventSet, packet);
    const after = foldEvent(emptyEventSet, packet);

    expect(idsOf(before)).toEqual(['e11']);
    // Same input, same output, at any moment: the only time-dependent function
    // over the value is the projection, and it is a different one.
    expect(idsOf(after)).toEqual(idsOf(before));
    expect(project(before, 999).events.map((event) => event.id)).toEqual(['e11']);
    expect(project(before, 1001).events).toEqual([]);
  });

  it('ES11b: the fold gives the same answer at two different instants', () => {
    // **`WR3` reads the source text of one function**, so a clock reached
    // through a helper defeats it, and `E11` cannot see that either: its two
    // folds happen at one instant, and it compares ids while what moves is the
    // key. Measured — with a module-level `stamp()` folded into the key, `WR3`
    // and `E11` are both green and the set is no longer idempotent across time.
    //
    // This is the behavioural half: fold the same packet at two instants far
    // enough apart that any clock reaching the key would show, and require the
    // same keys, the same ids, and idempotence against the earlier set.
    const packet = ev({ id: 'e11b', kind: 1, created_at: 5, tags: [['expiration', '1000']] });
    const realNow = Date.now;
    try {
      Date.now = () => 1_000_000_000;
      const early = foldEvent(emptyEventSet, packet);
      Date.now = () => 9_000_000_000;
      const late = foldEvent(emptyEventSet, packet);

      expect([...late.entries.keys()]).toEqual([...early.entries.keys()]);
      expect(idsOf(late)).toEqual(idsOf(early));
      expect(foldEvent(early, packet)).toBe(early);
    } finally {
      Date.now = realNow;
    }
  });

  it('ES12: a value whose backlog has not ended cannot report that it settled', () => {
    // B10. The absence of a flag is the mechanism; this is the consequence,
    // which is what a consumer can actually observe.
    const attempt = createAttemptRegistry().mint();
    const running = beginAttempt(foldEvent(emptyEventSet, ev({ id: 'e12', kind: 1 })), attempt);
    expect(completionOf(running)).toBeUndefined();

    const done = endBacklog(running, attempt, { kind: 'complete' });
    expect(completionOf(done)).toEqual({ kind: 'complete' });

    // And a forward leg ending does not make the backlog complete.
    const forwardOnly = endForward(running, attempt, { kind: 'ended', error: undefined });
    expect(completionOf(forwardOnly)).toBeUndefined();
  });

  it('ES14: a new attempt keeps the answer it has not replaced and drops the leg it has not opened', () => {
    // B10's lifetime rule, which is where the two legs stop being symmetrical.
    //
    // The backlog record decides completeness, so clearing it when an attempt
    // begins takes the primary state out of `settled` for the whole of every
    // refresh — the defect P30 observes end to end. The forward record decides
    // liveness, so keeping it carries an end that belongs to a subscription the
    // new attempt has not opened, and a request that stopped once would report
    // itself stopped forever.
    const registry = createAttemptRegistry();
    const first = registry.mint();
    const answered = endBacklog(
      beginAttempt(foldEvent(emptyEventSet, ev({ id: 'e14', kind: 1 })), first),
      first,
      { kind: 'complete' }
    );
    const stopped = endForward(answered, first, { kind: 'ended', error: undefined });
    expect(completionOf(stopped)).toEqual({ kind: 'complete' });

    const second = registry.mint();
    const next = beginAttempt(stopped, second);

    // The answer is still the one that was given, until this attempt has one.
    expect(completionOf(next)).toEqual({ kind: 'complete' });
    expect(idsOf(next)).toEqual(['e14']);
    // And the leg the previous attempt held is not this attempt's to report:
    // the record is replaced by an empty one named for this attempt rather than
    // removed, because the name is what a later signal is checked against (E16).
    expect(next.forward).toEqual({ attemptId: second, end: undefined, refusals: [] });
  });
});

describe('a leg ends once', () => {
  it('ES15: the first forward end wins, and a later signal does not overwrite it', () => {
    // The guard this exercises had no witness of its own. It used to be reached
    // through a dispose in the parity suite, and stopped being reached once a
    // forward end no longer ended the stream — the machine simply had no second
    // signal to give it. Reached directly instead, because the property is about
    // the fold rather than about how many signals a relay happens to send.
    //
    // Why it matters: the ends are not interchangeable. The first carries the
    // reason the leg died; a second, arriving because everything is shutting
    // down, would replace an explanation with a blank one — and the consumer
    // reads exactly that field to tell a leg that died from one that was never
    // opened.
    // **The value the machine actually puts there.** `LegEnd.error` is typed
    // `RelayLegError`, so the sentence above ("the reason the leg died") is in
    // the type as well as in the prose, and a bare `Error` is not one of them.
    //
    // **One code, and it used to be two.** `RelayLegError` was
    // `relay-failed | internal-failure`, and this line built the second with
    // `internalFailure`; measured, nothing could reach `legEnded.error` carrying
    // it, because `endForward` puts every reason through the relay door and that
    // door re-derives anything that did not come from a relay. So the union
    // dropped to the one code a path can produce, and the library names its own
    // relay failure with `relayFailure` — which is the value the machine builds
    // for exactly the sentence this arm's message quotes.
    const why = relayFailure('every relay in scope stopped the live request');
    const attempt = createAttemptRegistry().mint();
    const begun = beginAttempt(emptyEventSet, attempt);
    const once = endForward(begun, attempt, { kind: 'ended', error: why });
    const twice = endForward(once, attempt, { kind: 'ended', error: undefined });

    expect(twice.forward?.end).toEqual({ kind: 'ended', error: why });
  });

  it('ES16: a superseded attempt cannot write the forward record of the one that replaced it', () => {
    // The counterexample the review found, walked in the four steps it names.
    // It needs no engine: the guard is on the fold, and so is the defect.
    //
    // What was wrong: `ForwardRecord` had no name, `endForward` took no id, and
    // `addRefusal` took one and ignored it on the forward branch. So the
    // attribution work that closed this for the backward leg — a refusal or an
    // end belonging to an attempt that is no longer running is dropped — held
    // on one leg and not on the other, and the value has no way to say which
    // attempt a forward signal was about.
    //
    // Why it is not the backward rule twice over: the backward id is compared
    // against an attempt a *caller* holds, so `refresh()` can resolve on its
    // own answer. This one is compared against the attempt the value is on, so
    // a stale signal cannot describe a subscription it was never about. A
    // consumer reads exactly that field to tell a leg that died from one that
    // is open, and `diagnostics.refusals` to see who refused it.
    const registry = createAttemptRegistry();
    const a = registry.mint();
    const b = registry.mint();
    const refusalFrom = (from: string): Refusal => ({
      from,
      leg: 'forward',
      notice: relayMessage('blocked: no'),
      reason: 'blocked'
    });

    // 1. attempt A begins, and its forward leg is refused by one relay.
    const first = addRefusal(beginAttempt(emptyEventSet, a), refusalFrom('wss://a.example'), a);
    expect(first.forward?.refusals.map((refusal) => refusal.from)).toEqual(['wss://a.example']);

    // 2. attempt B begins, which clears the forward record.
    const second = beginAttempt(first, b);
    expect(second.forward?.refusals).toEqual([]);

    // 3. A's signals arrive late — a refusal from another relay, and the end of
    //    A's own subscription.
    const late = endForward(addRefusal(second, refusalFrom('wss://b.example'), a), a, {
      kind: 'ended',
      error: relayFailure('A stopped')
    });

    // 4. B's record is untouched by either. Before the fix both landed on it:
    //    B reported a refusal from a relay that never refused *its* leg, and a
    //    live subscription B still holds open as ended.
    expect(late.forward).toEqual({ attemptId: b, end: undefined, refusals: [] });
    expect(refusalsOf(late)).toEqual([]);

    // And B's own signals are applied, so the guard is an equality rather than
    // a way of dropping everything.
    const mine = endForward(addRefusal(late, refusalFrom('wss://b.example'), b), b, {
      kind: 'ended',
      error: undefined
    });
    expect(mine.forward?.refusals.map((refusal) => refusal.from)).toEqual(['wss://b.example']);
    expect(mine.forward?.end).toEqual({ kind: 'ended', error: undefined });
  });

  it('ES17: a failure outlives the attempt that begins after it, and is cleared by the one that ends', () => {
    // The lifetime the blocker is about, on the fold rather than through an
    // engine — the same reason E14 is here: the rule is a property of these
    // functions, and reaching it through a request would measure the request.
    //
    // Three moves, and the middle one is the whole finding. A new attempt
    // *beginning* leaves the failure alone, because while that attempt runs the
    // previous failure is still the most recent failure there has been — a field
    // called "the most recent failure" that a retry empties is the contradiction
    // r11 opened. What supersedes it is the new attempt *ending*: the question
    // was asked again and answered.
    const registry = createAttemptRegistry();
    const first = registry.mint();
    const second = registry.mint();
    const why = foreign('the fold threw part way through');

    // 1. an attempt fails, over a value that already holds an event.
    const failed = noteFailure(
      beginAttempt(foldEvent(emptyEventSet, ev({ id: 'e17', kind: 1 })), first),
      first,
      why
    );
    // **A snapshot, not their object.** The failure channel publishes a value
    // this library made (`own.ts`), so what is recorded carries the message and
    // the attempt rather than the reference.
    expect(failed.failure?.attemptId).toBe(first);
    expect(failed.failure?.error, 'not the caller’s object').not.toBe(why);
    expect(failed.failure?.error.message).toBe(why.message);

    // 2. the next attempt begins. The failure is still there, and so is the
    //    event — the two survive a retry for the same reason (A2).
    const retrying = beginAttempt(failed, second);
    expect(retrying.failure?.attemptId).toBe(first);
    expect(retrying.failure?.error.message).toBe(why.message);
    expect(idsOf(retrying)).toEqual(['e17']);

    // 3. the next attempt ends. Now it is superseded, and nothing else in the
    //    file does that: the fold, the bound, the forward end and a refusal all
    //    spread the value, so the record passes through each of them untouched.
    const answered = endBacklog(retrying, second, { kind: 'complete' });
    expect(answered.failure).toBeUndefined();
    expect(completionOf(answered)).toEqual({ kind: 'complete' });
  });

  it('ES17b: a failure is recorded for an attempt the value never saw begin, and its own end keeps it', () => {
    // Why `noteFailure` is the one writer here with no attempt guard, and why
    // `endBacklog` clears every record but its own. Both are stated in that
    // file's comments; this is where they are checked.
    //
    // The first half is reachable and is exactly `P47`'s shape: the poison
    // arrives as the attempt's first chunk and the reducer throws before
    // `collect` runs, so `beginAttempt` has never run for the attempt that threw
    // and the value's `running`/`forward` still name the one before it. Guarded
    // the way `endForward` and `addRefusal` are, this failure would be dropped —
    // and it is the only failure there is.
    //
    // The second half is a pair `endBacklog` has to have an answer for: one
    // value carrying both an end and a failure stamped with the same attempt.
    // The engine reaches that pair in the other order — a failure is the last
    // thing an attempt writes, since the throw ends the stream, so a live
    // attempt whose backlog completed and whose forward leg then threw writes
    // the end first and the failure after it. That makes the case below
    // unreachable through the engine as it stands, and the pure function still
    // has to answer it. It answers "keep": a failure from the attempt that ended
    // is not evidence against the end, it is what happened next, and there is
    // nowhere else for it to go.
    const registry = createAttemptRegistry();
    const previous = registry.mint();
    const throwing = registry.mint();
    const why = foreign('the fold threw on the first chunk of this attempt');

    // The value is on the previous attempt, which has already answered.
    const answered = endBacklog(beginAttempt(emptyEventSet, previous), previous, {
      kind: 'complete'
    });
    expect(answered.running).toBeUndefined();
    expect(answered.forward?.attemptId).toBe(previous);

    // A failure belonging to an attempt this value has never seen. It is kept,
    // and it is kept under its own name rather than the value's.
    const failed = noteFailure(answered, throwing, why);
    expect(failed.failure?.attemptId).toBe(throwing);
    expect(failed.failure?.error, 'not the caller’s object').not.toBe(why);
    expect(failed.failure?.error.message).toBe(why.message);

    // An attempt that ends does not erase the failure recorded against itself —
    // and it does replace the one before it, which is the same line doing both.
    const own = registry.mint();
    const ownFailed = noteFailure(beginAttempt(failed, own), own, why);
    expect(ownFailed.failure?.attemptId).toBe(own);
    expect(ownFailed.failure?.error.message).toBe(why.message);
    const afterEnd = endBacklog(ownFailed, own, { kind: 'complete' }).failure;
    expect(afterEnd?.attemptId).toBe(own);
    // The same snapshot object, carried rather than rebuilt — which is what
    // keeps `state.error` and `diagnostics.lastError` one value.
    expect(afterEnd?.error).toBe(ownFailed.failure?.error);
  });

  it('ES18: a relay that changes its mind is heard, a relay that repeats itself is not, and neither is unbounded', () => {
    // `addRefusal` deduplicated on `from` alone while saying it dropped "the
    // same relay saying the same thing", so a relay was allowed exactly one
    // refusal per leg per attempt and everything it said afterwards was
    // discarded in silence. The case that makes it a defect rather than a
    // simplification is the ordering below: `rate-limited:` clears by waiting
    // and `blocked:` does not, so the message a consumer most needs is the one
    // that arrived second, and it was the one being thrown away.
    //
    // Invisible in both directions before this: nothing asserted the second
    // refusal appears, and nothing asserted a repeat does not, so the rule had
    // no witness either way.
    //
    // The third clause is the price of the first. Widening the key to the notice
    // makes the array's length a function of what a relay chooses to say, and
    // these arrays live on the cache value for the whole of an attempt — so a
    // relay varying its wording turns a public, retained list into something it
    // controls the size of. The bound is per relay *per classification*, which
    // is what keeps the first clause unconditional: a class this relay has not
    // used yet is always under its own cap, so a `blocked:` is recorded however
    // much `rate-limited:` came before it.
    const registry = createAttemptRegistry();
    const attempt = registry.mint();
    const from = 'wss://a.example';
    const refusal = (leg: LegName, notice: string): Refusal => ({
      from,
      leg,
      notice: relayMessage(notice),
      reason: classifyRefusal(notice)
    });

    // 1. the same relay, the same leg, two different things. Both are heard.
    const begun = beginAttempt(emptyEventSet, attempt);
    const limited = addRefusal(begun, refusal('backward', 'rate-limited: slow down'), attempt);
    const blocked = addRefusal(
      limited,
      refusal('backward', 'blocked: you are not welcome'),
      attempt
    );
    expect(blocked.running?.refusals.map((each) => each.notice.text)).toEqual([
      'rate-limited: slow down',
      'blocked: you are not welcome'
    ]);

    // 2. and saying either of them again adds nothing. Not "the newest wins":
    //    the value is unchanged, so a consumer that has already rendered this
    //    list is not handed a reordered one.
    const repeated = addRefusal(blocked, refusal('backward', 'rate-limited: slow down'), attempt);
    expect(repeated).toBe(blocked);

    // 3. the same relay working through one classification in new words is
    //    bounded, and the bound does not reach across classifications.
    let flooded = blocked;
    for (let i = 0; i < 50; i += 1) {
      flooded = addRefusal(flooded, refusal('backward', `rate-limited: wait ${i}s`), attempt);
    }
    const notices = flooded.running?.refusals ?? [];
    // **The number, not just "some number".** This asserted `< 20`, which is
    // true of every cap from one to nineteen — so the bound had a witness and
    // its *value* did not, and the value is the part that is a product
    // decision. Measured: with the cap at one this line reads 2 and the assert
    // below reads 10, and both die. `B-η` is what says the size of a published
    // list is ours to decide rather than the relay's; this is where the size a
    // consumer actually sees is written down.
    expect(notices.length).toBe(5);
    // The one that matters survived the flood, and it survived in place: the
    // cap drops what arrives once it is full rather than evicting what is held,
    // so nothing a consumer was already shown is taken back.
    expect(notices[0]?.notice.text).toBe('rate-limited: slow down');
    expect(notices.some((each) => each.reason === 'blocked')).toBe(true);

    // 4. and the bound does not reach across classifications. A class this relay
    //    has not used yet is under its own cap however much came before it,
    //    which is what keeps clause 1 unconditional.
    //
    //    **This assertion is the one that separates a bound from the defect at
    //    a threshold**, and it was added because the three above do not: a cap
    //    counted over the relay's whole list rather than per classification
    //    passes every one of them and fails only here.
    const restricted = addRefusal(
      flooded,
      refusal('backward', 'restricted: members only'),
      attempt
    );
    expect(
      restricted.running?.refusals.some((each) => each.notice.text === 'restricted: members only')
    ).toBe(true);

    // 4b. **what a consumer is actually handed**, which is the number `B-η`
    //    decides and the one the review asked for. Per classification is the
    //    rule; the size of the published list is the rule times NIP-01's
    //    vocabulary, and it is asserted here rather than computed in a comment.
    //    Counted rather than multiplied out: the flatten is over three records,
    //    so the number a consumer sees is not the per-leg one.
    const wide = createAttemptRegistry();
    const older = wide.mint();
    let loaded = beginAttempt(emptyEventSet, older);
    const say = (set: CachedEventSet, id: AttemptId, leg: LegName, tag: string): CachedEventSet => {
      let next = set;
      for (const prefix of REFUSAL_PREFIXES) {
        for (let i = 0; i < 12; i += 1) {
          next = addRefusal(
            next,
            {
              from,
              leg,
              notice: relayMessage(`${prefix}: ${tag}${i}`),
              reason: classifyRefusal(`${prefix}: x`)
            },
            id
          );
        }
      }
      return next;
    };
    loaded = say(loaded, older, 'backward', 'a');
    // Ten classifications, four wordings each: the whole of one leg for one relay.
    expect(loaded.running?.refusals.length).toBe(40);
    loaded = endBacklog(loaded, older, { kind: 'complete' });
    const newer = wide.mint();
    loaded = say(say(beginAttempt(loaded, newer), newer, 'backward', 'b'), newer, 'forward', 'c');
    // And the published list is three records deep, because the previous
    // attempt's refusals stay visible while a new one runs.
    expect(refusalsOf(loaded).length).toBe(120);

    // 6. **the omission is silent, and that is contracted rather than left to
    //    be discovered.** A value built from twelve wordings of one class and
    //    one built from the four that were kept are the same value: nothing on
    //    it records that a relay said more than this. Written as an equality so
    //    it dies the moment anything on the value *does* record it — a counter,
    //    a flag, a truncation marker — which is what makes adding one a change
    //    to `B-η` rather than a change nobody has to argue for.
    const many = say(beginAttempt(emptyEventSet, attempt), attempt, 'backward', 'z');
    let few = beginAttempt(emptyEventSet, attempt);
    for (const prefix of REFUSAL_PREFIXES) {
      for (let i = 0; i < 4; i += 1) {
        few = addRefusal(
          few,
          {
            from,
            leg: 'backward',
            notice: relayMessage(`${prefix}: z${i}`),
            reason: classifyRefusal(`${prefix}: x`)
          },
          attempt
        );
      }
    }
    expect(many).toEqual(few);

    // 5. every clause again on the forward leg, which is a separate record with
    //    a separate key — the two branches of this function have disagreed
    //    before (E16), so neither is evidence for the other.
    const forwardLimited = addRefusal(
      begun,
      refusal('forward', 'rate-limited: slow down'),
      attempt
    );
    const forwardBlocked = addRefusal(
      forwardLimited,
      refusal('forward', 'blocked: you are not welcome'),
      attempt
    );
    expect(forwardBlocked.forward?.refusals.map((each) => each.notice.text)).toEqual([
      'rate-limited: slow down',
      'blocked: you are not welcome'
    ]);
    expect(
      addRefusal(forwardBlocked, refusal('forward', 'blocked: you are not welcome'), attempt)
    ).toBe(forwardBlocked);
  });

  it('ES19: the published list only grows within one attempt, and a new attempt withdraws the last one', () => {
    // **`B-η` said "a published list never comes back shorter or reordered"
    // with no attempt in it, and the tree falsified the sentence as written.**
    // Reproduced before this row existed: publish one forward refusal under
    // attempt A, begin attempt B, and `refusalsOf` goes from one entry to none
    // — `expected [] to deeply equal [ 'blocked: you are not welcome' ]`. The
    // backward leg does the same thing one step later, when B's *end* swaps the
    // old backlog record out.
    //
    // `E18` does not reach it, and the reason is worth writing down rather than
    // asserting: `E18` does cross an attempt boundary in its clause 4b, but only
    // on the backward leg and only while the old backlog is still standing —
    // the one interval in which nothing has been withdrawn yet. So it grows
    // (40 → 120) and never observes a shrink.
    //
    // **The rule the implementation actually has is per attempt**, and both
    // halves of it are contracted here: monotone *within* an attempt, and
    // withdrawn *at* the changeover. The second half is not a concession — it is
    // what makes `C12` true. A refusal that outlived its attempt pinned a
    // request to `error` for the life of the entry, which `P9d` is the end-to-end
    // measurement of; the whole-list-monotone reading re-opens exactly that.
    // Measured on a built version of it: `P9d` fails in both adapters with the
    // superseded `auth-required: nope` still published after a clean refresh,
    // and `E16` fails too. The same build grows one relay's published list to
    // 80, 800 and 8000 entries across 1, 10 and 100 attempts — so the reading
    // that promises never to shrink cannot also stay bounded, and a cap added to
    // bound it would shrink the list it was adopted to stop shrinking.
    const registry = createAttemptRegistry();
    const from = 'wss://a.example';
    const refusal = (leg: LegName, notice: string): Refusal => ({
      from,
      leg,
      notice: relayMessage(notice),
      reason: classifyRefusal(notice)
    });

    // 1. within one attempt, every published list is a prefix of the next one.
    //    That is "append-or-drop only" stated so that a shrink and a reorder
    //    each break it, rather than as a length that could grow while the front
    //    of the list moved.
    const a = registry.mint();
    let set = beginAttempt(emptyEventSet, a);
    const seen: readonly string[][] = [];
    const published = [...seen];
    for (const notice of [
      'rate-limited: slow down',
      'blocked: you are not welcome',
      'rate-limited: wait 1s',
      'rate-limited: slow down',
      'restricted: members only'
    ]) {
      set = addRefusal(set, refusal('backward', notice), a);
      published.push(refusalsOf(set).map((each) => each.notice.text));
    }
    for (let i = 1; i < published.length; i += 1) {
      const before = published[i - 1] as readonly string[];
      const after = published[i] as readonly string[];
      // A prefix: same order, same entries, nothing withdrawn.
      expect(after.slice(0, before.length)).toEqual(before);
    }
    // And the exact list, so "a prefix of the next" is not satisfied by a run
    // where nothing was ever added. The repeat added nothing; the other four did.
    expect(published[published.length - 1]).toEqual([
      'rate-limited: slow down',
      'blocked: you are not welcome',
      'rate-limited: wait 1s',
      'restricted: members only'
    ]);

    const backward = [
      'rate-limited: slow down',
      'blocked: you are not welcome',
      'rate-limited: wait 1s',
      'restricted: members only'
    ];
    const withForward = addRefusal(set, refusal('forward', 'blocked: not on the live leg'), a);
    expect(refusalsOf(withForward).map((each) => each.notice.text)).toEqual([
      ...backward,
      'blocked: not on the live leg'
    ]);
    const b = registry.mint();

    // 2. **There are three withdrawal moments and not two**, which this row
    //    found by getting the arm wrong: the review names the forward record
    //    (replaced by `beginAttempt`) and the backlog record (replaced by the
    //    next `endBacklog`), and the third is the *running* backward record.
    //    `beginAttempt` replaces that one too, so an attempt superseded before
    //    its backlog ever ended has its backward refusals withdrawn at the
    //    start of the next attempt rather than at the next end. Contracted here
    //    positively, because a rule stated with two of its three cases is the
    //    shape this file keeps correcting.
    expect(refusalsOf(beginAttempt(withForward, b))).toEqual([]);

    // 3. once A's backlog *has* ended, its refusals move to the record that
    //    explains the answer on show, and that record outlives the start of the
    //    next attempt. The forward one does not: it names a subscription B has
    //    not opened.
    const settledA = endBacklog(withForward, a, { kind: 'complete' });
    expect(refusalsOf(settledA).map((each) => each.notice.text)).toEqual([
      ...backward,
      'blocked: not on the live leg'
    ]);
    const runningB = beginAttempt(settledA, b);
    expect(refusalsOf(runningB).map((each) => each.notice.text)).toEqual(backward);

    // 4. and they are withdrawn by the *end* of the next attempt, which is the
    //    instant the answer they explain is replaced. Both move with the record
    //    that explains them, and neither moves before it — which is the whole of
    //    why the published list is not monotone and must not be.
    expect(refusalsOf(endBacklog(runningB, b, { kind: 'complete' }))).toEqual([]);
  });

  it('ES21: a late chunk from a superseded producer does not rewind the value', () => {
    // **The precondition `collect` had and did not check.** `beginAttempt` took
    // whatever attempt a `fresh` chunk named, so replaying an older attempt's
    // first chunk put the value back on that attempt — and then the newer
    // attempt's own end was dropped as belonging to somebody else, and the
    // published refusal list came back **shorter**, which is `B-η`'s falsifier
    // word for word.
    //
    // It is not reachable through the shipped engine, and it was written down
    // as a docblock and enforced by nothing — while this repository's own test
    // driver, the harness closest to a port, already violated it by starting a
    // second machine without cancelling the first.
    const registry = createAttemptRegistry();
    const a = registry.mint();
    const b = registry.mint();
    const from = 'wss://a.example';
    const refusal = (leg: LegName, notice: string): Refusal => ({
      from,
      leg,
      notice: relayMessage(notice),
      reason: classifyRefusal(notice)
    });

    let set = beginAttempt(emptyEventSet, a);
    set = addRefusal(set, refusal('backward', 'rate-limited: slow down'), a);
    set = beginAttempt(set, b);
    // The premise: the value is on B, and A's refusals went with A's record.
    expect(set.running?.attemptId).toBe(b);

    const rewound = beginAttempt(set, a);
    expect(rewound.running?.attemptId).toBe(b);
    // Identity, not equality: nothing was rebuilt, so nothing downstream of the
    // value sees a change either.
    expect(rewound).toBe(set);

    // **The control**, without which this passes on a `beginAttempt` that
    // refuses everything: a genuinely newer attempt begins.
    const c = registry.mint();
    expect(beginAttempt(set, c).running?.attemptId).toBe(c);

    // And the same guard once the backlog has ended, which is the other slot
    // the value's current attempt can be in.
    const ended = endBacklog(set, b, { kind: 'complete' });
    expect(beginAttempt(ended, a)).toBe(ended);
    expect(beginAttempt(ended, c).running?.attemptId).toBe(c);

    // **The direction the guard fails in, measured with the value that actually
    // occurs.** This arm used to hand it `'not-minted-here'` — a *malformed*
    // id — and called that "an id the registry did not mint". The two are not
    // the same equivalence class, and the one that happens is the other one: a
    // second provider's registry starts at zero like every registry, so its
    // genuine first attempt was read as older than this value's second and
    // **dropped**, which is the very thing this guard exists to not do.
    // Measured by the review, and reproduced here with two real registries.
    const elsewhere = createAttemptRegistry();
    const foreign = elsewhere.mint();
    expect(beginAttempt(set, foreign).running?.attemptId).toBe(foreign);
    // The same in the other direction, so this is not passing on "the second
    // registry happens to be ahead": its *later* attempt is not refused either,
    // because two registries have no order between them at all.
    const foreignLater = elsewhere.mint();
    const onForeign = beginAttempt(beginAttempt(emptyEventSet, foreignLater), foreign);
    expect(onForeign.running?.attemptId).toBe(foreignLater);
    expect(beginAttempt(set, foreignLater).running?.attemptId).toBe(foreignLater);
    // And a malformed id, which is a different question with the same answer.
    const malformed = 'not-minted-here' as unknown as AttemptId;
    expect(beginAttempt(set, malformed).running?.attemptId).toBe(malformed);
  });

  it('ES22: two module instances do not mint the same attempt id', async () => {
    // **The repair's own class, which the arm above cannot reach.** `E21` uses
    // two registries in one process; the first repair gave each a number from a
    // module-level counter, and that counter starts at zero in every *module
    // instance* — so a server render and the browser that hydrates it, or a
    // bundler that did not dedupe, both minted `r1a1`, and one owner's first
    // attempt read as older than the other's second. Exactly the defect the
    // registry prefix was introduced to repair, one level up.
    //
    // The two instances are what makes this a witness rather than a restatement
    // of `E21`: an id that is unique among the things *this* instance made is
    // not unique among the things that exist.
    // **Both instances fresh, and that is the whole arrangement.** Taking the
    // first one from this file's own static import made the arm pass for an
    // accidental reason: every registry built earlier in the file had already
    // advanced any module-level state, so an implementation that numbers
    // registries per instance still handed the two sides different ids.
    // Measured — with the token replaced by a module counter, the arm stayed
    // green. Reset before each import and both sides are the *first* registry
    // their instance ever built, which is the pair a server render and its
    // hydration produce.
    vi.resetModules();
    const here = await import('$lib/v1/attempt.js');
    vi.resetModules();
    const elsewhere = await import('$lib/v1/attempt.js');

    // **The premise, asserted rather than assumed, and it went unasserted for a
    // round.** If the runner handed back one module instance these would be the
    // same object and the arm below would be `E21` written twice.
    expect(here, 'two module instances').not.toBe(elsewhere);
    expect(here.createAttemptRegistry).not.toBe(elsewhere.createAttemptRegistry);

    const mine = here.createAttemptRegistry();
    const theirs = elsewhere.createAttemptRegistry();
    const first = mine.mint();
    const second = mine.mint();
    const foreign = theirs.mint();

    expect(foreign).not.toBe(first);
    // The order still works inside one registry, which is the control: an id
    // that is genuinely older is still older.
    expect(here.isOlderAttempt(first, second)).toBe(true);
    // And across instances there is no order at all — not "older", which is the
    // answer that drops a live attempt.
    expect(here.isOlderAttempt(foreign, second)).toBe(false);
    expect(here.isOlderAttempt(second, foreign)).toBe(false);
  });

  it('ES23: an owner token is wide enough that two of them are not expected to meet', () => {
    // **A provenance claim made out of randomness is a claim about width.** The
    // first version kept ten characters of a UUID — 40 bits — and a reviewer
    // priced it: ~0.45% chance of a collision among 100 000 registries, ~36.5%
    // among a million. Two registries that share an origin are exactly the pair
    // `isOlderAttempt` will order, so one owner's live attempt is droppable as
    // the other's stale one.
    //
    // **A collision cannot be waited for at this width, so the width is what is
    // read.** That is the honest instrument: the property is "collisions are
    // not expected", the mechanism is entropy, and entropy is countable.
    const ids = Array.from({ length: 64 }, () => createAttemptRegistry().mint());
    const origins = ids.map((id) => /^r([0-9a-z]+)a\d+$/.exec(id)?.[1] ?? '');

    // **Base 36, so 19 characters is 96 bits** — and the width is read as a
    // *value* rather than as a character count, because the alphabet is a
    // choice and the bits are the claim. `36^19` is just over `2^98`, so a
    // token that fits in 19 characters can be up to that; what this requires is
    // that it does not exceed 96 bits, and that it uses the width it has.
    const ceiling = 2n ** 96n;
    for (const origin of origins) {
      expect(origin, `${origin} is not 19 characters of base 36`).toMatch(/^[0-9a-z]{19}$/);
      expect(
        [...origin].reduce((n, c) => n * 36n + BigInt(parseInt(c, 36)), 0n) < ceiling,
        `${origin} is wider than 96 bits`
      ).toBe(true);
    }

    // And the width is used rather than nominal: over 64 draws the values
    // spread across the top of the range, which a padded short token would not.
    const widest = origins
      .map((origin) => [...origin].reduce((n, c) => n * 36n + BigInt(parseInt(c, 36)), 0n))
      .reduce((a, b) => (a > b ? a : b), 0n);
    expect(widest > ceiling / 8n, 'the draws do not reach the top of the range').toBe(true);
    // And they are drawn rather than derived: 64 registries, 64 origins.
    expect(new Set(origins).size).toBe(64);

    // **Not a uniformity test** — 64 draws cannot make one — but the shape the
    // dropped `Math.random()` fallback had: a token that always began with the
    // same character. Every position varies here.
    const first = new Set(origins.map((origin) => origin[0]));
    expect(first.size, 'the leading character is not fixed').toBeGreaterThan(1);
  });

  it('ES24: the two end writers hand back a frozen record, not one the caller can still write', () => {
    // **A rule kept by one call site is a rule the second call site does not
    // have.** `ReqDiagnostics.legEnded` republishes the forward record's own
    // `end` on every read, and the freeze that makes that safe lived at the one
    // place in the hook that builds a `LegEnd` — measured by a reviewer, who
    // called `endForward` directly and got a writable record back. `backlogEndOf`
    // was the same shape one field over: it froze the `causes` list and not the
    // record around it.
    //
    // Both are frozen where they are built now, which is what `B5-C6` says
    // about every published container: owned once, where it is made.
    const registry = createAttemptRegistry();
    const attemptId = registry.mint();

    const ended = endForward(beginAttempt(emptyEventSet, attemptId), attemptId, {
      kind: 'ended',
      error: undefined
    });
    const legEnd = ended.forward?.end;
    expect(legEnd, 'the write landed').toBeDefined();
    expect(Object.isFrozen(legEnd)).toBe(true);

    const backlogEnd = backlogEndOf(new Set<IncompleteCause>(['timeout']), undefined);
    expect(Object.isFrozen(backlogEnd)).toBe(true);
    // The list inside it was already frozen; the record around it is the half
    // that was missing, so both are read here rather than one standing for the
    // other.
    expect(Object.isFrozen(backlogEnd.kind === 'incomplete' ? backlogEnd.causes : undefined)).toBe(
      true
    );
    // And the complete case, which takes the other arm of the same expression.
    expect(Object.isFrozen(backlogEndOf(new Set<IncompleteCause>(), undefined))).toBe(true);

    // **The third writer, and the one the first version of this arm missed.**
    // `endBacklog` stores an end its *caller* built — the hook builds one for
    // the empty plan, which is an ordinary path — so freezing at `backlogEndOf`
    // left that one writable, measured through a request by a reviewer. The
    // answer token goes with it: the memos' correctness rests on its content,
    // so a consumer able to write `answer.of` collapses the next answer onto
    // this one through the query library's structural sharing, which is `X12`'s
    // defect reached from the outside.
    const answered = endBacklog(beginAttempt(emptyEventSet, attemptId), attemptId, {
      kind: 'complete'
    });
    expect(Object.isFrozen(answered.backlog?.end), 'the end the caller handed over').toBe(true);
    expect(Object.isFrozen(answered.backlog?.answer), 'the answer’s identity').toBe(true);
  });

  it('ES25: a superseded attempt’s failure does not overwrite the generation the value is on', () => {
    // **The writer that had no order at all.** A reviewer built the pair
    // directly — `noteFailure(noteFailure(set, newer, e1), older, e2)` — and the
    // *older* attempt's Error came back on `state.error`. The round before this
    // one left the guard out and gave the instrument as the reason ("the
    // comparator has one call site"), which is the derivation backwards: the
    // check watches the contract rather than choosing it.
    //
    // What is chosen is the reading 0003 and 0004 already take elsewhere:
    // `lastError` is the failure of the generation the value is on, not the last
    // failure the wall clock saw. So a superseded attempt's late failure is
    // dropped for the same reason its late chunk is, and the comparator has two
    // authorized call sites (`A6-C2`, `WR17`).
    const registry = createAttemptRegistry();
    const first = registry.mint();
    const second = registry.mint();

    const older = foreign('the superseded attempt threw, late');
    const newer = foreign('the attempt the value is on threw');

    const onSecond = noteFailure(beginAttempt(emptyEventSet, second), second, newer);
    expect(onSecond.failure?.attemptId).toBe(second);

    const late = noteFailure(onSecond, first, older);
    expect(late.failure?.error.message, 'the older attempt does not overwrite it').toBe(
      newer.message
    );
    expect(late, 'and the value is not rebuilt for a write that changed nothing').toBe(onSecond);

    // **The control, and it is the case the guard must not eat**: a failure for
    // an attempt the value has never seen begin — `P47`'s shape, where the
    // poison arrives as the attempt's first chunk — is *newer* than what the
    // value is on, and it is kept. Without this line the arm is satisfied by a
    // writer that refuses everything.
    const third = registry.mint();
    const unseen = foreign('an attempt the value never saw begin');
    expect(noteFailure(onSecond, third, unseen).failure?.error.message).toBe(unseen.message);

    // And an id from another registry is not judged at all: the comparator
    // answers `false` where it cannot place one, so the failure is kept rather
    // than dropped on a guess.
    const stranger = createAttemptRegistry().mint();
    expect(noteFailure(onSecond, stranger, older).failure?.attemptId).toBe(stranger);

    // **The other two legs of the guard's `??` chain, which the arm above never
    // enters.** Everything above starts from `beginAttempt`, so `running` is
    // always set — and `endBacklog` clears it, which makes the *settled* value
    // the steady state of every answered request and the one where the guard
    // reads `backlog` instead. A reviewer measured the cost: narrowing the chain
    // to `set.running?.attemptId` alone left the whole suite green but for the
    // ledger noticing its own anchor had moved.
    const settled = endBacklog(beginAttempt(emptyEventSet, second), second, { kind: 'complete' });
    expect(settled.running, 'the premise: nothing is running any more').toBeUndefined();
    expect(
      noteFailure(settled, first, older).failure,
      'a superseded attempt’s failure on a settled value'
    ).toBeUndefined();

    // And the third leg: a value whose only memory of an attempt is the failure
    // it already holds. Reached when a failure is written over a value that has
    // neither a running attempt nor a backlog — which is what a second failure
    // on a torn-down request is.
    const failedOnly = { ...emptyEventSet, failure: onSecond.failure };
    expect(failedOnly.running).toBeUndefined();
    expect(failedOnly.backlog).toBeUndefined();
    expect(
      noteFailure(failedOnly, first, older).failure?.error.message,
      'the older attempt does not overwrite the failure already published'
    ).toBe(newer.message);
  });

  it('ES26: a runtime with no cryptographic randomness is refused, not served a weaker token', () => {
    // **The fallback that was deleted, and the arm that says so.** Three
    // `Math.random()` draws stood at the end of `originToken`: 96 characters'
    // worth of width, and not 96 bits of entropy — one PRNG whose state and seed
    // are the host's, so two realms with the same seed draw the same token,
    // which is the boundary the token exists for. The record admitted that and
    // kept the fallback; a reviewer refused the trade, and the decision is to
    // fail closed at construction instead.
    //
    // Driven by taking both functions away from `globalThis.crypto`, which is
    // the only arm in this suite that does — every host it runs on has
    // `getRandomValues`, so the two remaining branches are otherwise unreachable
    // from here and the record says so beside them.
    const real = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { subtle: real?.subtle }
      });
      let thrown: unknown;
      try {
        createAttemptRegistry();
      } catch (error) {
        thrown = error;
      }
      expect(thrown, 'the registry refuses to be built').toBeInstanceOf(MissingRandomnessError);
      // The code as well as the class: `instanceof` is defeated by a duplicate
      // install of this package, and the string is what survives it.
      expect((thrown as MissingRandomnessError).code).toBe('missing-randomness');
      expect((thrown as Error).message).toContain('cryptographic randomness');

      // **The control**, and without it this arm passes on a library that
      // refuses every runtime: the `randomUUID` branch alone still mints, and
      // what it mints is the same shape.
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { randomUUID: () => real.randomUUID(), subtle: real?.subtle }
      });
      // **Two registries, not one spelling.** The first version asserted
      // `/^r[0-9a-z]{19}a1$/`, which a run of nineteen zeroes satisfies — a
      // reviewer replaced the UUID branch's output with a constant and this arm
      // stayed green, which is exactly "two realms draw the same token", the one
      // property the deleted fallback was deleted for.
      const first = createAttemptRegistry().mint();
      const second = createAttemptRegistry().mint();
      expect(first).toMatch(/^r[0-9a-z]{19}a1$/);
      expect(second).toMatch(/^r[0-9a-z]{19}a1$/);
      expect(second, 'two registries on the UUID branch do not share a token').not.toBe(first);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real });
    }
  });

  it('ES27: the UUID branch takes 24 free nibbles, and the record that says 96 bits has an arm', () => {
    // **`E26` cannot see which characters come out.** It draws two real UUIDs
    // and asserts they differ and match `/^r[0-9a-z]{19}a1$/` — true under *any*
    // 24 of the 32 hex characters, including the naive first 24, which contain
    // the fixed version nibble and the two fixed bits of the variant nibble and
    // therefore carry **90** bits and not 96. The width is the whole reason the
    // token exists at this size (`0002`, and the collision arithmetic there), so
    // a reviewer reading 90 in one record and 96 in another had nothing to
    // settle it with. This is the arm that settles it.
    //
    // **The oracle is written out rather than computed**, because deriving it
    // from the slice under test would make the arm agree with whatever the
    // implementation does. `randomUUID` is stubbed to a constant whose every
    // position is distinguishable, and the token below is the base 36 of the 24
    // hex characters this branch is supposed to take, padded to 19 — read off
    // once, by hand, from the digits named in the comment beside it.
    const real = globalThis.crypto;
    try {
      //   0123456789ab 4 cde 9 f0123456789abcd
      //   \__ 0-11 __/ ^  ^   ^  \__ 17-31 __/
      //                |  |   `- 16, the variant nibble: fixed at 10xx
      //                |  `- 13-15
      //                `- 12, the version nibble: always `4`
      //
      // Dropping 12 and 16 leaves thirty characters; the first 24 of those are
      // `0123456789ab` + `cde` + `f01234567`, which is `0123456789abcdef01234567`
      // — twenty-four characters, none of them fixed, so 96 bits.
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: { randomUUID: () => '01234567-89ab-4cde-9f01-23456789abcd', subtle: real?.subtle }
      });

      // `0x0123456789abcdef01234567` in base 36, left-padded to nineteen.
      //
      // **What this discriminates**, so the constant is not read as arbitrary:
      // the mutation it is aimed at is the naive slice, whose 24 characters are
      // `0123456789ab4cde9f012345` and whose base 36 is `0188skr4f35k8sv8pqd` —
      // a different token from the tenth character on. The digits above were
      // chosen so that a window shifted by one position changes the value too,
      // so dropping either nibble alone, or dropping both and slicing from
      // anywhere but the front, is red here.
      expect(createAttemptRegistry().mint()).toBe('r0188skr4f4jv458xrhja1');
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: real });
    }
  });

  it('ES20: the published list is a concatenation of records and not a set', () => {
    // **`B-η`'s falsifier said "a repeat lengthens the list", and the list it
    // named is the flat one a consumer holds.** That subject has no attempt in
    // it while the decision body has one throughout, so the clause as written
    // is walked through by the shipping tree. Reproduced here before the row
    // was scoped.
    //
    // `E19` cannot reach this and shares almost all of its setup: it begins
    // attempt B in order to observe the *withdrawal* and never adds a refusal
    // under B, so the one arrangement where two records are populated at once —
    // A's ended backlog beside B's running record — never arises there.
    //
    // What is asserted is the duplicate *and* its indistinguishability. The
    // first alone is satisfied by two entries a consumer could tell apart, and
    // being unable to tell them apart is the part that costs something.
    const registry = createAttemptRegistry();
    const notice = 'blocked: you are not welcome';
    const refusal = (): Refusal => ({
      from: 'wss://a.example',
      leg: 'backward',
      notice: relayMessage(notice),
      reason: classifyRefusal(notice)
    });

    const a = registry.mint();
    let set = addRefusal(beginAttempt(emptyEventSet, a), refusal(), a);
    // A's backlog ends, so its refusal moves to the record explaining the
    // answer on show; B then begins and is refused in the same words.
    set = endBacklog(set, a, { kind: 'incomplete', causes: ['refused'], error: undefined });
    const b = registry.mint();
    set = addRefusal(beginAttempt(set, b), refusal(), b);

    const published = refusalsOf(set);
    expect(published).toHaveLength(2);
    // Field for field. Not `toEqual` between the two — that would pass on two
    // objects differing in a field neither of these lists, which is precisely
    // the repair (an `attemptId`) this row records as not taken.
    const [first, second] = published as [Refusal, Refusal];
    expect(Object.keys(first).sort()).toEqual(['from', 'leg', 'notice', 'reason']);
    expect(Object.keys(second).sort()).toEqual(['from', 'leg', 'notice', 'reason']);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    // And the reason they are both there, so that a repair which deduplicates
    // is a failure here rather than an improvement: they explain two different
    // records, one of which is the answer currently on show.
    expect(set.backlog?.refusals).toHaveLength(1);
    expect(set.running?.refusals).toHaveLength(1);
  });
});
