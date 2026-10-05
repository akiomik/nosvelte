/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { NormalizedDescriptor, ReadonlyFilter } from './normalize.js';
import { hardenOwned, ownedByLibrary } from './owned.js';
import type { ReqError } from './reqerror.js';

/**
 * Canonical cache identity for a request.
 *
 * The safety condition is one-directional, and it holds **of descriptors that
 * agree on `environment`**:
 *
 *   canonicalKey(a) === canonicalKey(b)  =>  a and b have the same wire
 *                                            semantics and the same cache scope
 *
 * The converse is not required. Two equivalent descriptors landing on different
 * keys costs a duplicate REQ; two *different* descriptors landing on the same
 * key merges unrelated data, so only that direction is a defect.
 *
 * **That qualifier was missing, and it is load-bearing.** `environment` is on
 * the {@link NormalizedDescriptor} and it changes what the request means:
 * `planRequest` answers `defer` for `'server'`, so a server-side descriptor
 * sends no REQ at all. It is not an input below. So two descriptors alike but
 * for it share a key while having different wire semantics — the direction that
 * is otherwise the defect.
 *
 * It stays out rather than being fixed, because keying on it is the worse
 * trade. `environment` is not a knob a caller shapes a request with: it is
 * absent from the published `ReqDescriptor`, and the provider detects it once
 * and holds it as a provider-level fact, so descriptors sharing one cache agree
 * on it and the qualifier costs nothing. Keying on it would instead split one cache
 * owner's entries on a fact that cannot vary inside that owner: C6 gives a cache
 * one provider, and a provider detects its environment once.
 *
 * **This paragraph argued from a hydration handoff and `0003` withdrew that
 * reason**: under A12 a server render fills no entry, and no cache value crosses
 * a realm from this design at all.
 *
 * **Where the qualifier is not yet free, stated rather than assumed**: in this
 * spike the engine still takes `environment` as a per-request option, because
 * there is no published hook to carry the provider's value into it. So one
 * provider can be handed both values today and get one entry for them. That is
 * a gap in the plumbing rather than in this rule, and it closes when the option
 * stops being a caller's to spell.
 *
 * Everything that changes what the request means, or where its results may have
 * come from, has to be an input. Everything else must not be — in particular the
 * per-attempt filters the stream derives internally, which change on every
 * subscription and would split the cache if they participated.
 *
 * **`environment` is not the only thing outside the key that can change an
 * answer, and this used to say it was.** Two hooks that agree about every field
 * above and disagree about anything *outside* the key share one entry, one
 * attempt and one gate — so which of them mounted first decides what both of
 * them read. **`OM6` is the measurement**, in both orders: with a permissive
 * verifier first the strict hook shows an event its own verifier rejected; with
 * the strict one first the permissive hook is told nothing was found. For four
 * rounds three records called this measured while the only arm that had ever
 * made the measurement had **withdrawn** it — under the published arrangement
 * the two hooks are indistinguishable, so no order exists to decide anything,
 * and the arrangement that exhibits it is the caller-owned one.
 *
 * **This named three of them — `verifyEvent`, `clock`, `accumulator` — and read
 * as if that were the list.** It is not — the transport, the client and the
 * attempt registry are outside it too, and so are the query-level options and
 * the spike's own test seams. **`0004` prints the roster and `WR31` derives it**
 * by subtracting `canonicalKey`'s members from the option bag, so there is one
 * enumeration and it is computed. This comment deliberately does not repeat it:
 * the three-member phrasing stood in `0003`, `0004` and here, was repaired in
 * `0003` alone for a round, and the first repair then wrote three *disagreeing*
 * partial lists in three files. A partial list reads as a roster; the count and
 * the members live in one place.
 *
 * The reason it is not a defect *here* is the same as `environment`'s and has
 * to be said rather than assumed: a seam is not something a consumer spells.
 * `verifyEvent` and `clock` are the provider's, `accumulator` is 0001's escape
 * route, and none of them is on the published `ReqDescriptor` — so two hooks
 * that disagree about one need two providers over a single `QueryClient`, which
 * C6 forbids. **It is the plumbing gap `environment` already has**, at the whole
 * complement rather than at three options, and it closes the same way: when a
 * seam stops being a caller's to spell. Recorded as residue rather than keyed on, because keying
 * on a function is keying on its identity — a fresh closure per render would
 * split the cache on every keystroke.
 */

/** Fields whose value is a set: order and duplicates carry no meaning. */
const SET_FIELDS = ['ids', 'authors', 'kinds'] as const;

/** Fields whose value is a scalar. */
const SCALAR_FIELDS = ['since', 'until', 'limit'] as const;

/**
 * Fields the high-level API refuses.
 *
 * **The rule is about membership, and it used to be about local decidability.**
 * It read "anything that cannot be decided locally is rejected here", which is a
 * universal `limit` satisfies and is accepted under: `isFiltered()` does not
 * evaluate `limit` either (measured), so the sentence refused a field this
 * boundary takes. The split it was missing is what the two fields *are*:
 *
 * - **A membership field constrains which events belong to the answer.** It has
 *   to be reproducible locally, because the same predicate decides what is
 *   accepted into the set after the wire has done its half — `search` is one and
 *   `isFiltered()` accepts everything for it, so a request carrying it would
 *   collect events nothing checked. Refused.
 * - **A shaping field asks the relay for a different amount or ordering of the
 *   same membership.** `limit` is one: which events belong to the answer does
 *   not depend on it, so there is nothing for a local predicate to reproduce.
 *   It is normalized, passed to the wire unchanged, and — because two requests
 *   that ask for different amounts are different requests — it is part of the
 *   cache identity. Accepted.
 *
 * What is deliberately **not** promised is that this library re-applies `limit`
 * locally: a relay that sends more than it was asked for is not corrected here,
 * and a top-N of the stored set is `retain`'s job rather than the filter's.
 *
 * The neighbouring refusals stay where they are, and the split says why they are
 * not this one: `since > until` is refused because the dependency deletes the
 * whole filter (no membership at all, and no REQ to show for it); `retain: 0` is
 * refused by a rule about what a consumer could observe rather than by this one;
 * and an empty set field is a *known* membership — nothing can match — which
 * `planRequest` answers without asking anybody.
 */
const REJECTED_FIELDS = ['search'] as const;

const isTagField = (key: string): boolean => /^#[a-zA-Z]$/.test(key);

export class UnsupportedFilterError extends Error {
  /**
   * The four members `Error` gives this class, re-declared.
   *
   * **`B5-C8` says every member of every published type is `readonly` to the
   * depth a consumer can reach, and inherited members are where that was
   * false**: `message`, `name`, `stack` and `cause` arrive from `Error`, where
   * they are mutable, so `err.message = '[redacted]'` compiled against the
   * emitted `.d.ts` — legal-looking code the run time refuses. `cause` is
   * narrowed as well as closed: what this channel publishes there is another of
   * its own values or nothing, never the graph of whatever was thrown.
   * `declare` makes all of it type-only, and `LK17` reads the emitted result.
   */
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  declare readonly cause?: ReqError | undefined;

  /**
   * The literal a consumer branches on when `instanceof` cannot be trusted.
   *
   * **Added because the records said every value this library owns carries
   * one, and five classes did not** — including the two a consumer meets
   * most, and including the one `PO7` used to witness the sentence. A claim
   * that stops where its witness stops is the shape these records are about.
   */
  readonly code = 'unsupported-filter' as const;

  constructor(
    readonly field: string,
    detail?: string
  ) {
    super(
      `nosvelte: the filter field ${JSON.stringify(field)}${detail === undefined ? ' is not supported' : ` ${detail}`}. ` +
        `Unsupported values are rejected rather than ignored, because ignoring one ` +
        `would make the request sent to relays disagree with the events accepted locally.`
    );
    this.name = 'UnsupportedFilterError';
    this.code = 'unsupported-filter';
    hardenOwned(this);
    // **Frozen for the same reason every other published Error is, and this one
    // is shared more widely than any of them.** A refused descriptor is filed
    // under `['nosvelte', 'refused', <namespace>, <generation>, <message>]`, so
    // two hooks in one namespace asking entirely different questions — the
    // filters are not on that key — that are refused for the same field are
    // handed **one** object. (Different namespaces were on that list until the
    // merge was measured; the namespace is on the key now.) 0003's argument for
    // that merge is that the entry holds an error and nothing else, "so the only
    // thing a merge here could hand one caller is the other's identical
    // message"; measured, it handed one caller the other's *mutation*, on
    // `state.error` and on `diagnostics.lastError`.
    Object.freeze(this);
  }
}

/**
 * Throws on anything the high-level API cannot honour end to end.
 *
 * The rule is one rule: **reject where the local predicate and the wire would
 * disagree.** It used to be applied to field *names* only, which left the
 * values rx-nostr silently rewrites on the way out (CONST-R17) to sail through.
 * Those rewrites are not narrowings — dropping a field the caller used to
 * constrain the request makes the request *wider* — so a value that gets dropped
 * is exactly the disagreement this exists to stop:
 *
 * - `limit < 0` and a negative `since`/`until` are removed from the outgoing
 *   filter, so the wire asks for more than the caller wrote.
 * - `since > until` deletes the whole filter, and a request whose filters have
 *   all been deleted is never sent at all — no REQ, no CLOSED, no EOSE, no
 *   error. Measured: the stream settles empty, and a live one reports `settled`
 *   while claiming to be live.
 *
 * A multi-character tag name is the same class and is already caught by the
 * name check, since `isTagField` uses the pattern `normalizeFilter` uses.
 */
/**
 * The half of {@link validateFilter} that reads no value, only names.
 *
 * **Separate because of where it has to run.** The boundary takes a snapshot of
 * each filter before it checks anything, so that the value it checks is the
 * value it sends; but a snapshot reads every field, and reading is what a
 * caller's getter gets to do something with. Names can be checked without
 * reading anything — `Object.keys` enumerates, it does not invoke — so this
 * runs against the caller's own object first, and an unsupported field whose
 * getter throws is refused as an unsupported field rather than escaping as the
 * caller's own error. Measured: with only the whole check running after the
 * snapshot, `{ kinds: [1], get search() { throw } }` came out of the boundary
 * as `Error('from the consumer')` and was filed under that as a cache key.
 *
 * It is run again on the snapshot, by {@link validateFilter}, and that is not
 * redundant: a `Proxy` may answer `ownKeys` differently each time, so the names
 * that were checked and the names that are sent are two questions.
 */
export function validateFilterNames(filter: ReadonlyFilter): void {
  for (const key of Object.keys(filter)) {
    if ((REJECTED_FIELDS as readonly string[]).includes(key)) {
      throw ownedByLibrary(new UnsupportedFilterError(key));
    }
    const known =
      (SET_FIELDS as readonly string[]).includes(key) ||
      (SCALAR_FIELDS as readonly string[]).includes(key) ||
      isTagField(key);
    if (!known) throw ownedByLibrary(new UnsupportedFilterError(key));
  }
}

export function validateFilter(filter: ReadonlyFilter): void {
  validateFilterNames(filter);

  const { since, until, limit } = filter;

  // One rule rather than a list of the values seen so far. NIP-01 says these are
  // non-negative integers, and everything outside that either gets stripped on
  // the way out — which widens the request — or reaches the relay malformed.
  // Enumerating (`< 0`, then `NaN`, then `Infinity`, then non-integers) is how
  // the reject set kept ending one example behind.
  for (const [name, value] of [
    ['since', since],
    ['until', until],
    ['limit', limit]
  ] as const) {
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw ownedByLibrary(
        new UnsupportedFilterError(
          name,
          'must be a non-negative safe integer — anything else is stripped before the request is sent, or reaches the relay malformed'
        )
      );
    }
  }
  // **Both edges of the same guard, and `since` was left out on an argument
  // that does not hold.** The dependency drops either at send time with a
  // truthiness test, so `since: 0` reaches relays as no lower bound at all —
  // exactly the harm `until: 0` is refused for. It was admitted on the reasoning
  // that ignoring it "cannot change the answer: it means `created_at >= 0`,
  // which every event satisfies". This library's own ingest boundary admits any
  // *finite* `created_at`, negative included, and a validly signed event with
  // `created_at: -5` was measured being delivered under `since: 0` and refused
  // under `since: 1`. An assumption a boundary two files away does not make is
  // not an argument.
  for (const [name, value] of [
    ['since', since],
    ['until', until]
  ] as const) {
    if (value === 0) {
      throw ownedByLibrary(
        new UnsupportedFilterError(
          name,
          'must not be 0 — it is dropped on the way out, so relays are asked with no bound at all'
        )
      );
    }
  }
  if (typeof since === 'number' && typeof until === 'number' && since > until) {
    throw ownedByLibrary(
      new UnsupportedFilterError(
        'since',
        'must not be later than `until` — the filter is deleted before the request is sent, and a request with no filters left produces no REQ and no error'
      )
    );
  }
}

type Canonical = Record<string, unknown>;

function canonicalFilter(filter: ReadonlyFilter): Canonical {
  validateFilter(filter);

  const out: Canonical = {};
  // Sorted so that the serialisation is stable regardless of insertion order.
  for (const key of Object.keys(filter).sort()) {
    const value = (filter as Record<string, unknown>)[key];
    if (value === undefined) continue;

    if ((SET_FIELDS as readonly string[]).includes(key) || isTagField(key)) {
      // An empty array is not the same request as an absent field: it matches
      // nothing, where absence matches everything. Keep the distinction.
      const unique = [...new Set<string | number>(value as Array<string | number>)];
      out[key] = unique.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    } else {
      // Scalars pass through as-is. `0` is a real value for both `until` and
      // `limit`, so no truthiness checks here.
      out[key] = value;
    }
  }
  return out;
}

/**
 * The key's input is a {@link NormalizedDescriptor} and nothing else.
 *
 * It used to be the caller's object, with the key resolving defaults its own way
 * and the wire resolving them another — so `undefined`, `null` and `NaN` shared
 * a key while behaving differently. Taking a branded value removes the
 * possibility rather than documenting against it: there is no way to call this
 * with something that has not been through the boundary.
 */
export function canonicalKey({
  filters,
  live,
  scopeGeneration,
  namespace,
  settleTimeoutMs,
  retain
}: NormalizedDescriptor): string {
  // The filter array is an OR, so its order carries no meaning; duplicates
  // likewise. Sorting by the canonical serialisation of each element makes both
  // irrelevant without merging anything that differs.
  const canonicalFilters = [...filters]
    .map((filter) => JSON.stringify(canonicalFilter(filter)))
    .sort();
  const deduped = [...new Set(canonicalFilters)];

  return JSON.stringify({
    v: 1,
    scope: scopeGeneration,
    ns: namespace ?? null,
    live,
    // Already resolved, so `settle` is always a number — and so is `retain`:
    // `NormalizedDescriptor.retain` is not optional and the boundary resolves an
    // absent one to `'unbounded'` before a descriptor exists. **The `?? null`
    // below cannot fire**, and this comment used to say it could ("`retain` may
    // still be absent"), which is a shape the boundary removed: a port reading
    // it builds an optional field and re-opens the `undefined`/`NaN` collision
    // the boundary is there to close. The fallback is kept as the type's own
    // belt — the field is read off a caller's object one frame up — and named
    // here as unreachable rather than left to look load-bearing.
    settle: settleTimeoutMs,
    retain: retain ?? null,
    filters: deduped
  });
}
