/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The one place raw input becomes a request.
 *
 * The cache key and the wire filters used to read the caller's descriptor
 * separately, and they read it differently. `canonicalKey` folded `undefined`,
 * `null`, `NaN` and `Infinity` onto the same key, while the runtime treated them
 * as different things — a `NaN` settle timeout fires its timer immediately, a
 * `NaN` retention keeps nothing. So two requests that behave differently shared
 * a cache entry, which is exactly the safety condition the key exists to state.
 *
 * TypeScript does not prevent this. The published API is a JavaScript API: a
 * consumer without types, or with one `as any`, hands over whatever they like,
 * and a type annotation is not a runtime contract. So the boundary is a
 * function, and everything downstream takes its output rather than the caller's
 * object:
 *
 *     raw input -> normalizeDescriptor -> NormalizedDescriptor
 *                                            |-> canonicalKey
 *                                            |-> planRequest
 *                                            `-> wireFilters
 *
 * The brand is what makes that a structural claim rather than a convention:
 * there is no way to reach the three functions below without going through here.
 */

import type Nostr from 'nostr-typedef';

import { UnsupportedFilterError, validateFilter, validateFilterNames } from './key.js';
import { hardenOwned, ownedByLibrary } from './owned.js';
import type { ReqError } from './reqerror.js';

declare const normalized: unique symbol;

/**
 * How much of the answer to keep.
 *
 * A number bounds the set newest-first (B6); `'unbounded'` says so out loud. The
 * two together are what let a live request be *required* to choose without the
 * requirement being a silent truncation.
 */
export type Retention = number | 'unbounded';

/**
 * A filter with nothing writable left, at the depth the value actually has.
 *
 * `readonly Nostr.Filter[]` says the array cannot be reassigned into and says
 * nothing about the objects in it, so `wireFilters` used to hand an internal
 * caller the descriptor's own filters and its `authors` array — the snapshot the
 * boundary took, aliased straight back out. Nothing did that today, which is a
 * fact about this month's code rather than a property of the type.
 *
 * Written as a mapped type over the dependency's `Filter` rather than as a
 * hand-written twin: the fields are its to change, and a twin would go stale
 * silently. One level of arrays is the whole depth — every field is a primitive
 * or an array of primitives — and this stops being true the day a field with
 * structure is added, which is the same limit {@link cloneFilter} carries.
 */
export type ReadonlyFilter = {
  readonly [K in keyof Nostr.Filter]: Nostr.Filter[K] extends
    ReadonlyArray<infer Element> | undefined
    ? readonly Element[] | undefined
    : Nostr.Filter[K];
};

export interface NormalizedDescriptor {
  readonly [normalized]: true;
  readonly filters: readonly ReadonlyFilter[];
  readonly live: boolean;
  /** Resolved, never absent. See {@link DEFAULT_SETTLE_TIMEOUT_MS}. */
  readonly settleTimeoutMs: number;
  /**
   * Resolved, never absent. `'unbounded'` is a choice rather than a gap.
   *
   * It used to be `number | undefined`, where absent meant unbounded — and that
   * is the shape a caller cannot be *asked* about. A live request has no natural
   * end, so its retained set grows for as long as the subscription lives; the
   * policy is required there, and the only reason a number could not be made the
   * default is that B6 bounds newest-first, so a default silently discards
   * events nobody was told about.
   */
  readonly retain: Retention;
  /**
   * The relays this request named, or `undefined` for the provider's default
   * readable set.
   *
   * Named by the provider's transport, deduplicated and sorted before it
   * arrives: `resolveTargets` resolves a caller's spellings against the
   * provider's accepted universe and
   * refuses anything outside it, and this boundary re-checks the shape rather
   * than the membership. Two jobs, in the module that can do each: the scope
   * owns what a relay is called and which ones this provider can read from,
   * this owns what a descriptor is allowed to be.
   *
   * `undefined` and `[]` are different requests. Absent means "wherever this
   * provider reads", and it moves when the provider's list moves; empty means
   * "nowhere", which is a question a caller asked on purpose and which no
   * change to the provider's list answers.
   */
  readonly relays: readonly string[] | undefined;
  /**
   * The identity of the **effective target set**, not of the provider.
   *
   * `resolveTargets` produces it: the scope's own generation when the request
   * named no relays, and the identity of the named set when it did. The name is
   * the older one and the meaning is the wider one, so read it as "the relay
   * axis of the key" rather than as "which relay list the provider is on".
   *
   * That is what stops the first request every Nostr client makes from being
   * keyed by its own answer: an app that fetches its NIP-65 list from bootstrap
   * relays `B`, then sets the provider's relays to `B ∪ L`, re-keys every
   * request that did not name a relay set — and the bootstrap request, which
   * named `B`, keeps its key, its data and its observer.
   */
  readonly scopeGeneration: string;
  readonly namespace: string | undefined;
  readonly environment: 'browser' | 'server';
}

/** A-γ's initial value, resolved here so the key sees a number either way. */
export const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;

/**
 * The largest settle timeout this library will accept, and why there is one.
 *
 * A-γ says the request owns its timeout. That was false above 30 seconds:
 * rx-nostr runs a second timer, `eoseTimeout`, which *completes* the backward
 * observable (measured, SEN14) and defaults to 30s, so a caller passing
 * `settleTimeoutMs: 45_000` got a backlog closed by the dependency at 30, with
 * no EOSE, no CLOSED and no connection-state change to say so.
 *
 * **Thirty is orientation, not an assertion.** `CX16` checks that this library's
 * timer is *greater* than whatever the dependency fills in for itself, which is
 * the part a port inherits; `SEN14` passes 40ms explicitly, because a sentinel
 * that waits the real default out is one nobody runs. Any default below the
 * library's timer keeps both green and makes the figure wrong, so it is dated to
 * the version the sentinels pin rather than relied on.
 *
 * Two mitigations, and the plan takes both because either alone leaves the claim
 * conditional. This is the boundary half; {@link LIBRARY_EOSE_TIMEOUT_MS} is the
 * other, and the two are stated together so the relation between them is
 * checkable rather than remembered.
 *
 * Refused rather than clamped. Silently lowering a number is the coercion this
 * file exists to remove: a caller who asked for ten minutes and got one would be
 * told nothing, and the key would agree with neither request.
 */
export const MAX_SETTLE_TIMEOUT_MS = 60_000;

/**
 * What the provider sets rx-nostr's own EOSE timer to.
 *
 * Far above {@link MAX_SETTLE_TIMEOUT_MS} rather than disabled, because there is
 * no way to disable it — `completeOnTimeout` takes a number. An order of
 * magnitude of headroom means the request's timer is always the one that fires,
 * which is what makes A-γ's claim true rather than true-below-30-seconds.
 *
 * `eoseTimeout` is one of the four options 0004 says the provider does not
 * publish, so the library setting it is that decision being kept rather than
 * contradicted: the caller's control over when a backlog gives up is
 * `settleTimeoutMs`, per request, and this exists so that nothing overrides it.
 */
export const LIBRARY_EOSE_TIMEOUT_MS = 600_000;

/**
 * How long a send waits for each target relay's `OK` before that relay is
 * reported as `no-response`. The dependency's own default at 3.7.5, written
 * here so that it is this library's figure rather than an inherited one.
 */
export const LIBRARY_OK_TIMEOUT_MS = 30_000;

/**
 * The offending value, rendered without trusting it to render.
 *
 * **Both refusal paths used `JSON.stringify` directly, and the refusal itself
 * threw.** The records publish that a bad relay list reaches a consumer as a
 * `RelayConfigurationError` and a bad descriptor as an `InvalidDescriptorError`,
 * and the premise for checking at runtime at all is that a type annotation does
 * not stop a value arriving, because this is a JavaScript API. So the values a
 * careless or hostile caller actually sends are exactly the ones that reached
 * the message builder — measured, three classes escaped as something else:
 * `1n` threw `TypeError: Do not know how to serialize a BigInt`, an object
 * holding itself threw `TypeError: Converting circular structure to JSON`, and
 * `{ toJSON() { throw … } }` threw **the caller's own error**, so a consumer
 * could put anything at all in place of this library's refusal.
 *
 * **Both paths, because the second was found by sweeping the first.**
 * `settleTimeoutMs` and `retain` are published descriptor fields checked the
 * same way, through the same builder, so the same four values reached the same
 * door there — the relay list was the half a reviewer named.
 *
 * A symbol needed no throw to be wrong: `JSON.stringify` answers `undefined`
 * for one, so the message read `and was undefined` and named the wrong fault.
 *
 * **One of the branches is equivalent and is kept anyway, which is worth saying
 * because nothing can witness it.** Removing the `function` case leaves the
 * output byte-identical for a function declaration, an arrow, a class, a native
 * function, a callable `Proxy`, an async function and a generator — measured, all
 * seven — because `JSON.stringify` answers `undefined` for each and the fallback
 * below then says `a function` in the same words. It stays as the statement that
 * a function is refused rather than rendered, and it is a line no mutation can
 * be aimed at.
 *
 * Nothing is inferred about the value beyond what rendering it needs, and
 * `String()` is not the fallback — it calls `toString`, which is the same door
 * one step over. `TD13` holds all four for the relay list, `NZ12` for the
 * descriptor.
 *
 * **Two more things it owes, both found by asking what the message is used
 * for.** A refusal's message is the cache key its refused entry is filed under
 * (`resolveRequest`), so it is a value this library stores rather than only a
 * string it prints:
 *
 * - **It is bounded.** `JSON.stringify` of the caller's object renders all of
 *   it, and a descriptor field holding a large object put megabytes into the
 *   message and the same megabytes into the key. The tail is cut rather than
 *   the head because the field, the rule and the beginning of the value are
 *   what a consumer reads to find their own mistake. `NZ15` holds both edges —
 *   a large value is cut and a small one is not.
 * - **Values that are refused separately look separate, to the extent stated
 *   here.** `JSON.stringify` answers `null` for `NaN` and for both infinities,
 *   so four different mistakes arrived as one message and one key — the exact
 *   collision the normalizer exists to remove, reproduced inside its own
 *   diagnostics. `NZ14` holds those four. **It is a value's own type that is
 *   read**, so a non-finite number reached through something else still renders
 *   as `null`: `new Number(NaN)`, `[NaN]`, and `{ n: Infinity }` are `null`,
 *   `[null]` and `{"n":null}` — measured. So are `-0` and `0`. Two refusals
 *   sharing a message share an entry, and the entry holds an error and nothing
 *   else, which is the argument `resolveRequest` makes for keying by the
 *   message at all; what is narrowed here is how far "look separate" reaches,
 *   not what a collision costs.
 */
export const MAX_RENDERED = 200;

/** `a`/`an` for a type name, so a refusal does not say "a object". */
const article = (noun: string): string => (/^[aeiou]/.test(noun) ? 'an' : 'a');

/**
 * The bound, applied to whatever was rendered rather than to one way of
 * rendering it.
 *
 * **It used to sit inside the `JSON.stringify` branch, and four branches went
 * round it.** Measured there: `Symbol('X'.repeat(1_000_000))` produced a
 * message of 1 000 285 characters and a cache key of the same size, and a
 * bigint of 200 000 digits did the same — while the docblock above said the
 * message is bounded. A bound that four of five branches skip is a bound only
 * of the shape it was written next to.
 *
 * **Not `slice` alone: the cut is in UTF-16 units and a character can be two of
 * them.** Landing between the halves of a surrogate pair puts a lone half in
 * the message, and the message is stored as a cache key. Measured: with 190
 * letters before it, an emoji straddles this boundary exactly. Only the tail is
 * trimmed and only by one unit — a lone half *inside* the text came from the
 * caller's own symbol description and is theirs to keep, and trimming until the
 * whole string is well formed would eat it all.
 *
 * **What that is and is not.** It keeps the string well formed: a lone
 * surrogate is the one thing a cut can create that the input did not contain,
 * because `JSON.stringify` escapes any the caller wrote. It does **not** cut at
 * a grapheme — measured, a ZWJ emoji loses its tail and keeps the joiner, a
 * combining mark is dropped from its base, and a `\uXXXX` escape can be halved
 * — and it does not need to: what is downstream is a cache key and a message,
 * both of which tolerate a broken-looking tail and neither of which tolerates
 * an invalid string.
 */
const bounded = (rendered: string): RelayMessage => {
  if (rendered.length <= MAX_RENDERED) return whole(rendered);
  const cut = rendered.slice(0, MAX_RENDERED);
  const kept = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  return Object.freeze({ text: `${kept}… (cut)`, truncated: true });
};

/**
 * The same bound, applied to text that is already text.
 *
 * **`saidBy` had no bound at all and one of its two callers interpolates the
 * result into a published, stored message.** A relay entry whose `url` getter
 * throws `new Error('x'.repeat(100_000))` produced a `RelayConfigurationError`
 * whose message was 100 439 characters — measured — while the same payload
 * thrown as a plain *object* came out at 646, because that path goes through
 * {@link describeValue} and this cap. The bound belongs to the rendering, not
 * to one shape of input, so it is exported rather than transcribed: `WR22` is
 * the rule that a value has one declaration, and 200 is this one's.
 */
/**
 * The bound, with the fact of the cut kept.
 *
 * **`truncated` has to be derived where the cut happens.** A `boundedText` that
 * returned the string alone stood here, and a `ReqFailure` built from it
 * reported `truncated: false` for a message this module had just cut — measured
 * at 10 000 characters in, 207 out, with the flag saying nothing was lost. A
 * published discriminant that says the opposite of what happened is worse than
 * not publishing one, so the projection is gone and every caller takes the pair.
 */
export const boundedMessage = (text: string): RelayMessage => bounded(text);

/** A rendering that had nothing to cut. */
const whole = (text: string): RelayMessage => Object.freeze({ text, truncated: false });

/*
 * `wireText` stood here — "a text field off the wire, read as text whatever
 * arrived" — and **nothing called it after the truncation repair**, which gave
 * {@link relayMessage} the same branch and a flag to go with it. It was found
 * by a full ledger run rather than by reading: the entry aimed at it went from
 * killing `OW13` to killing nothing, which is what an edit to code no path
 * reaches looks like. Its own kill set was the only thing keeping it live.
 *
 * The rule it carried is unchanged and is {@link relayMessage}'s now: a relay
 * can put anything in a `CLOSED` reason or a `NOTICE` body, the types say
 * `string` because the protocol does, and a reason nobody can read is still a
 * refusal — so what came is rendered, bounded, rather than dropped or thrown
 * past. `OW13` is the trace of the day it threw `notice.indexOf is not a
 * function` out of the message channel.
 */

/**
 * How much of a relay's own words this library keeps.
 *
 * **4096 UTF-16 code units**, and the unit is part of the decision rather than
 * an implementation detail: bytes would depend on an encoding this library
 * never performs, and code points would make the bound a walk rather than a
 * length. What a consumer is promised is a bound, not a character count.
 *
 * **"4 KiB" stood here and it is not the same statement.** 4096 code units is
 * at most 8192 bytes of UTF-16 storage, and more again if somebody reads "KiB"
 * as the UTF-8 encoding of the same text; the durable records (0003, 0004) were
 * corrected to the code-unit wording a round ago and this comment was missed —
 * which is the class of defect this branch keeps finding, a correction applied
 * to the record and not to the code beside it.
 *
 * The number is a diagnostics figure: long enough for any refusal a relay has a
 * reason to send — NIP-01's own examples are a line — and short enough that a
 * relay cannot decide how much memory this library holds.
 */
export const MAX_RELAY_MESSAGE_UNITS = 4096;

/*
 * `UNREADABLE` stood here for two rounds: a sentinel *value* that a field whose
 * getter threw was passed along as, so that the boundary would refuse it by
 * name. It is gone, and the reason is worth keeping.
 *
 * **A sentinel is a new inhabitant of the domain, and every reader owes it a
 * branch.** Three did not have one, and each was a defect: the side that
 * decides who publishes a refusal (it matched neither `'server'` nor nullish),
 * the relay resolution (neither a scope nor absent), and this renderer, which
 * put `{"nosvelte":…}` in front of a consumer who never wrote it — text a
 * consumer *could* write, which would then have shared their cache entry. Two
 * of the repairs for those had no falsifier of their own.
 *
 * What replaced it carries the same fact beside the values instead of inside
 * them: `requestOf` collects the names of the fields that threw, and
 * `resolveRequest` refuses the first of them by name. Nothing downstream reads
 * that list, so there is nothing to leak.
 */

/**
 * A relay's own words, as much of them as this library keeps.
 *
 * **The bound is on the published type rather than applied silently**, because
 * a truncated string presented as the whole thing is a diagnostics value that
 * lies. `truncated` is what makes the two cases distinguishable to a consumer
 * rendering it.
 *
 * Why it is bounded at all: a relay is outside the trust boundary, and the
 * count of retained refusals was bounded (four wordings per relay per leg per
 * classification) while the size of each was not — so the retained state was
 * unbounded in the dimension nobody had bounded. `Refusal.notice` in particular
 * enters the cache and survives for the collection window.
 *
 * **What this does not do**, said here so that nobody reads it as more: it
 * bounds what is *kept*, not what is *received*. A 50MB frame is still received
 * and parsed by the transport before this sees it; refusing that is a limit on
 * the socket, and this library does not own one.
 */
export interface RelayMessage {
  /** What the relay said, up to the bound. */
  readonly text: string;
  /** Whether there was more of it. */
  readonly truncated: boolean;
}

/**
 * A relay's words, bounded, frozen, and honest about which it is.
 *
 * The cut is by UTF-16 code units and never lands between the halves of a
 * surrogate pair — a lone half is the one thing a cut can create that the relay
 * did not send, and this value is rendered.
 */
export const relayMessage = (value: unknown): RelayMessage => {
  // **Two renderings can cut, and the flag is the OR of them.** A value that is
  // not text is rendered by `renderValue`, which has a bound of its own (200
  // units, for the messages and cache keys it also feeds) — so a long object
  // arrived here already cut and *under* this cap, and the published flag said
  // `false`. Measured by the review: `{ detail: 'x'.repeat(10_000) }` came out
  // as 207 characters and "not truncated".
  //
  // The axes are "text or not" and "long or not", and the arms measured each of
  // them alone. The defect is in the cell where both are true.
  const rendered = typeof value === 'string' ? whole(value) : renderValue(value);
  if (rendered.text.length <= MAX_RELAY_MESSAGE_UNITS) return rendered;
  const cut = rendered.text.slice(0, MAX_RELAY_MESSAGE_UNITS);
  const kept = /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
  return Object.freeze({ text: kept, truncated: true });
};

/**
 * A value rendered for a human, and whether the rendering had to cut it.
 *
 * **The provenance travels with the text**, which is the repair the review
 * asked for: `relayMessage` used to take a rendered *string* and compare its
 * length against its own cap, so a value this module had **already** cut came
 * back well under it — a 10 000 character object was published as
 * `{ text: '{"detail":"xxx…… (cut)', truncated: false }`, a public discriminant
 * saying the opposite of what happened. Reading the marker back out of the text
 * would be worse than the bug: a relay can end a message with those characters.
 *
 * So the branches live here and return the pair, and {@link describeValue} is
 * the projection for the callers that want a message.
 */
export const renderValue = (value: unknown): RelayMessage => {
  // Named rather than typed, because `and was a undefined` is both ungrammatical
  // and the wrong thing to say: the caller left the field out, and what they
  // need to read is that it is missing.
  if (value === undefined) return whole('absent');
  if (typeof value === 'bigint') return bounded(`${value}n`);
  if (typeof value === 'symbol') return bounded(value.toString());
  if (typeof value === 'function') return whole('a function');
  // Before `JSON.stringify`, which renders all three as `null` and would tell a
  // caller who computed a `NaN` to go looking for a `null` they never wrote.
  if (typeof value === 'number' && !Number.isFinite(value)) return whole(String(value));
  try {
    const rendered = JSON.stringify(value);
    // Nothing came back, and the value is not `undefined` — a `toJSON` that
    // answered with nothing, or a host object that renders as nothing. The type
    // is all this can say without asking the value a second question.
    if (rendered === undefined) return whole(`${article(typeof value)} ${typeof value}`);
    return bounded(rendered);
  } catch {
    // Circular, or a `toJSON` that throws. The type is the most this can say
    // about it without asking the value anything further.
    return whole(`an unserialisable ${typeof value}`);
  }
};

/** The message half, for the callers that are building a sentence. */
export const describeValue = (value: unknown): string => renderValue(value).text;

export class InvalidDescriptorError extends Error {
  /**
   * The four members `Error` gives this class, re-declared.
   *
   * **`B5-C6` says every member of every published type is `readonly` to the
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
  readonly code = 'invalid-descriptor' as const;

  constructor(
    readonly field: string,
    detail: string
  ) {
    super(
      `nosvelte: ${field} ${detail}. Descriptor values are checked at runtime because ` +
        `the published API is a JavaScript API — a type annotation does not stop a ` +
        `value arriving, and two descriptors that behave differently must not share a cache entry.`
    );
    this.name = 'InvalidDescriptorError';
    this.code = 'invalid-descriptor';
    hardenOwned(this);
    // Frozen for `UnsupportedFilterError`'s reason: it is published on
    // `state.error`, and a refusal's entry is keyed by its message, so one
    // object can be the answer to several requests.
    Object.freeze(this);
  }
}

/**
 * Integers, checked as one rule rather than as a list of the values seen so far.
 *
 * `Number.isSafeInteger` rejects `null` (via the type check), `NaN`, `Infinity`,
 * `1.5` and `2 ** 53` together. Enumerating them is how the filter's reject set
 * kept ending one example behind.
 */
function requireInteger(
  field: string,
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw ownedByLibrary(
      new InvalidDescriptorError(
        field,
        `must be a safe integer of at least ${minimum}, and was ${describeValue(value)}`
      )
    );
  }
  if (value > maximum) {
    throw ownedByLibrary(
      new InvalidDescriptorError(
        field,
        `must be at most ${maximum}, and was ${describeValue(value)}`
      )
    );
  }
  return value;
}

/** 64 lowercase hex characters. See {@link normalizeDescriptor} for why. */
const isEventId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function checkFilterValues(filter: Nostr.Filter): void {
  const raw = filter as Record<string, unknown>;

  for (const field of ['ids', 'authors'] as const) {
    const value = raw[field];
    if (value === undefined) continue;
    if (!Array.isArray(value)) {
      throw ownedByLibrary(new UnsupportedFilterError(field, 'must be an array'));
    }
    // Exactly 64 lowercase hex, not a prefix. rx-nostr's local matcher accepts
    // prefixes — `ids.every(prefix => !event.id.startsWith(prefix))` — and
    // relays match these fields exactly, so a prefix is a filter that accepts
    // events locally which no relay will ever send. That is the same divergence
    // between the wire request and the local predicate that the rejected fields
    // exist to prevent, arrived at from the value side instead of the name side.
    if (!value.every(isEventId)) {
      throw ownedByLibrary(
        new UnsupportedFilterError(
          field,
          'must contain 64-character lowercase hex ids — a prefix is matched locally by rx-nostr and exactly by relays, so it would accept events that never arrive'
        )
      );
    }
  }

  const kinds = raw['kinds'];
  if (kinds !== undefined) {
    if (!Array.isArray(kinds))
      throw ownedByLibrary(new UnsupportedFilterError('kinds', 'must be an array'));
    // NIP-01 defines a kind as an integer between 0 and 65535. Above that is
    // not a kind the protocol has, so a relay's behaviour is undefined and the
    // local matcher's is not — the same divergence prefixes are refused for.
    if (
      !kinds.every(
        (kind) =>
          typeof kind === 'number' && Number.isSafeInteger(kind) && kind >= 0 && kind <= 65535
      )
    ) {
      throw ownedByLibrary(
        new UnsupportedFilterError('kinds', 'must contain integers between 0 and 65535')
      );
    }
  }

  for (const [field, value] of Object.entries(raw)) {
    if (!/^#[a-zA-Z]$/.test(field)) continue;
    // **An explicit `undefined` is a field the caller did not set**, here as
    // everywhere else on this boundary: `validateFilter` skips one on a scalar
    // and the loop above skips one on `ids`/`authors`/`kinds`, and this loop
    // reached `Array.isArray(undefined)` instead. So `{ kinds, '#e': maybeTag }`
    // — an everyday shape — was a published error while
    // `{ kinds, ids: maybeIds }` was a working request, and the two produce the
    // identical REQ and the identical local predicate. Measured across all
    // seven fields.
    if (value === undefined) continue;
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
      throw ownedByLibrary(new UnsupportedFilterError(field, 'must be an array of strings'));
    }
    // **`#e` and `#p` carry an event id and a pubkey, and the reason is not the
    // prefix rule.** That argument belongs to `ids` and `authors` alone — at
    // rx-nostr 3.7.5 `nostr/filter.ts` matches those two with `startsWith` and
    // matches `#`-tag values with an exact `includes`, so there is no
    // local-prefix-against-remote-exact divergence for these two to inherit
    // (measured). 0003 was corrected to say so and the message a consumer reads
    // was not, which is a correction landing in one artifact out of three. The
    // requirement survives on the plainer ground: a short value here is not a
    // prefix that matches too much, it is a value that matches nothing.
    if ((field === '#e' || field === '#p') && !value.every(isEventId)) {
      throw ownedByLibrary(
        new UnsupportedFilterError(
          field,
          'must contain 64-character lowercase hex values — it references an event id or a ' +
            'pubkey, and a value that is not one matches nothing at any relay'
        )
      );
    }
  }
}

/**
 * NIP-01's ephemeral range, declared once.
 *
 * The bounds were written out twice — here, to refuse a filter that could match
 * one, and in `classifyKind`, to decide what the fold does with an event that
 * arrives. Same question, two answers, nothing requiring them to agree: a port
 * that moves one refuses a different set than it classifies.
 */
export const isEphemeralKind = (kind: number): boolean => kind >= 20_000 && kind < 30_000;

/**
 * Whether a filter could select an ephemeral event.
 *
 * B7a: they are not retained, and the high-level surface has no channel that
 * could show one — so a request that can match one is a request whose answer
 * would silently omit part of what it matched, and `nodata` would be a lie.
 * Refusing it is the same fail-closed rule the rest of this file follows.
 *
 * *Could* rather than *does*: a filter with no `kinds` matches every kind,
 * ephemeral included.
 *
 * **And an absent `kinds` is answered by `live`, which is the adjudicated rule.**
 * Refusing it outright refused `{ ids, limit }` — the by-id request `Event`,
 * `EventList` and `UniqueEventList` are specified to make, and the shape a
 * consumer holds whenever an id arrives from an `e` tag or a `nevent1…` link
 * without a kind beside it. Measured: the library refused its own components.
 * The split is what the two legs can report:
 *
 * - **live** with no `kinds`: still refused. A forward leg can deliver an
 *   ephemeral event and v1 has no transient channel to show one in, so it could
 *   only be dropped in silence.
 * - **non-live** with no `kinds`: accepted. A backlog is a finite answer, and an
 *   omission from a finite answer can be *reported* — {@link IncompleteCause}'s
 *   `ephemeral-event-omitted`, raised by the fold where the arrival is dropped.
 *
 * A filter that **names** an ephemeral kind is refused either way: that is a
 * fault a caller can see in their own descriptor, and refusing it at the request
 * is the right end of the pipe.
 */
function selectsEphemeral(filter: Nostr.Filter, live: boolean): boolean {
  const kinds = (filter as Record<string, unknown>)['kinds'];
  if (kinds === undefined) return live;
  // **The range is asked for rather than restated.** It was written out here
  // and again in `classifyKind`, so the normalizer refused one set of kinds
  // while the fold classified another — two answers to one NIP-01 question,
  // with nothing requiring them to agree. `WR22` is that rule; this is a
  // duplication it could not see, because the value had no name. It lives here
  // rather than beside `classifyKind` because this module is the one with no
  // edge back: `eventset.ts` already depends on this file, and the reverse
  // would close a cycle through `own.ts`.
  return (kinds as number[]).some(isEphemeralKind);
}

/**
 * A filter that shares nothing with the one it was made from.
 *
 * Every value in a filter is a primitive or an array of primitives, so one
 * level of array copying is a full snapshot — there is no nesting to recur
 * into, and if a field with structure is ever added this has to grow with it.
 *
 * Used at both ends: on the way in it detaches the caller's object, and on the
 * way out it is how a {@link ReadonlyFilter} becomes a filter the dependency
 * will accept. The second is a copy rather than a cast, because a cast would
 * hand back the descriptor's own object with the type erased and the readonly
 * would be decoration.
 */
export function cloneFilter(filter: ReadonlyFilter): Nostr.Filter {
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(filter as Record<string, unknown>)) {
    out[field] = Array.isArray(value) ? [...(value as unknown[])] : value;
  }
  return out as Nostr.Filter;
}

export interface RawDescriptor {
  filters: Nostr.Filter[];
  live?: boolean | undefined;
  settleTimeoutMs?: number | undefined;
  retain?: Retention | undefined;
  /** Already resolved by `resolveTargets`. See {@link NormalizedDescriptor.relays}. */
  relays?: readonly string[] | undefined;
  /** Already resolved by `resolveTargets`. See {@link NormalizedDescriptor.scopeGeneration}. */
  scopeGeneration: string;
  namespace?: string | undefined;
  environment?: 'browser' | 'server' | undefined;
}

/**
 * Check, resolve defaults, and hand back the only thing the rest will accept.
 *
 * Defaults are resolved *before* the key rather than at the point of use, which
 * has a consequence worth stating: a caller who passes the default settle
 * timeout explicitly and one who omits it now share a cache entry. They always
 * behaved identically, and the key used to say otherwise.
 */
export function normalizeDescriptor(raw: RawDescriptor): NormalizedDescriptor {
  // **Read once, here, and everything below works from these.** Each of these
  // used to be read again wherever it was needed — `live` twice, `retain` three
  // times, `filters` three — and a field that answers differently each time it
  // is asked is then checked as one value and stored as another. Nothing about
  // the types says a caller cannot hand over an object with a getter on it.
  const {
    filters: rawFilters,
    settleTimeoutMs: rawSettleTimeoutMs,
    retain: rawRetain,
    relays: rawRelays,
    scopeGeneration,
    environment,
    live,
    namespace
  } = raw;

  if (!Array.isArray(rawFilters)) {
    throw ownedByLibrary(new InvalidDescriptorError('filters', 'must be an array'));
  }
  const filters: Nostr.Filter[] = [];
  for (const filter of rawFilters) {
    if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) {
      throw ownedByLibrary(new InvalidDescriptorError('filters', 'must contain objects'));
    }
    // The snapshot is taken **before** the value checks rather than after them,
    // which is the whole of `NZ13`. What it costs: a filter that is going to be
    // refused for its values is copied first, so refusing a filter now allocates
    // in proportion to it — measured at 0.28ms against 16.4ms for one carrying
    // two million authors. The alternative is reading the caller's object twice,
    // which is the defect this order exists to remove. `cloneFilter` reads each own field exactly once,
    // so the three checks below and the value that goes on the wire are looking
    // at the same numbers — and an ephemeral `kinds` that answered honestly the
    // first time cannot answer differently the fourth. Checking first and
    // cloning afterwards let a filter be admitted on one answer and sent on
    // another, and the answer it was sent on was the one nobody looked at.
    //
    // If reading a field throws, that exception is the caller's and comes out
    // as theirs: this boundary refuses values it can read, and a filter object
    // that cannot be read is not a value.
    // Names before the snapshot, because `Object.keys` enumerates without
    // invoking anything: an unsupported field whose getter throws is refused as
    // an unsupported field, rather than leaving the boundary as the caller's own
    // error under the caller's own cache key.
    validateFilterNames(filter as ReadonlyFilter);
    const snapshot = cloneFilter(filter as ReadonlyFilter);
    validateFilter(snapshot);
    checkFilterValues(snapshot);
    if (selectsEphemeral(snapshot, live === true)) {
      throw ownedByLibrary(
        new UnsupportedFilterError(
          'kinds',
          'must exclude ephemeral kinds (20000-29999) — ephemeral events are not retained and ' +
            'this surface has no channel that could show one. On a **live** request `kinds` must ' +
            'also be present: a filter with no `kinds` matches every kind, a forward leg can ' +
            'deliver an ephemeral event, and there is nowhere to show it. A request that is not ' +
            'live may omit `kinds` — an ephemeral event on its backlog is dropped and reported as ' +
            'the `ephemeral-event-omitted` cause rather than silently left out'
        )
      );
    }
    filters.push(snapshot);
  }

  // Capped, and the ceiling is about the dependency rather than about taste.
  // See {@link MAX_SETTLE_TIMEOUT_MS}: above it the request stops owning its own
  // timeout, which is a decision quietly becoming false rather than a large
  // number being unwise.
  const settleTimeoutMs =
    rawSettleTimeoutMs === undefined
      ? DEFAULT_SETTLE_TIMEOUT_MS
      : requireInteger('settleTimeoutMs', rawSettleTimeoutMs, 1, MAX_SETTLE_TIMEOUT_MS);

  // `retain: 0` is rejected rather than treated as "keep nothing". A request
  // whose answer is empty by construction is a request nobody meant to make,
  // and rendering an empty list forever is the failure mode this design keeps
  // removing elsewhere.
  //
  // Required when the request is live. Nothing about the wire changes — the same
  // REQ goes out either way — but a subscription with no end is the one shape
  // whose retained set grows without bound, and "the client may keep everything"
  // is a decision the caller should have to make rather than fall into.
  if (live === true && rawRetain === undefined) {
    throw ownedByLibrary(
      new InvalidDescriptorError(
        'retain',
        "is required when `live` is true — pass a number, or 'unbounded' to say so on purpose"
      )
    );
  }
  const retain: Retention =
    rawRetain === undefined || rawRetain === 'unbounded'
      ? 'unbounded'
      : requireInteger('retain', rawRetain, 1);

  if (typeof scopeGeneration !== 'string') {
    throw ownedByLibrary(new InvalidDescriptorError('scopeGeneration', 'must be a string'));
  }
  // The *shape*, not the membership. Which relays this provider can read from is
  // a question only the scope can answer, and `resolveTargets` has answered it
  // by the time a descriptor is built; what is left here is the check every
  // other field on this boundary gets, so that a hand-built `RawDescriptor`
  // cannot put a non-string into the set the wire is asked of.
  let relays: readonly string[] | undefined;
  if (rawRelays !== undefined) {
    if (!Array.isArray(rawRelays)) {
      throw ownedByLibrary(new InvalidDescriptorError('relays', 'must be an array'));
    }
    const copied = [...rawRelays];
    if (!copied.every((url) => typeof url === 'string' && url !== '')) {
      throw ownedByLibrary(
        new InvalidDescriptorError('relays', 'must contain non-empty relay URL strings')
      );
    }
    // The library's own array, for the reason `filters` is snapshotted: a
    // caller holding the array they passed must not be able to change the
    // relays a keyed request is sent to after it was keyed.
    relays = Object.freeze(copied);
  }
  if (environment !== undefined && environment !== 'browser' && environment !== 'server') {
    throw ownedByLibrary(
      new InvalidDescriptorError('environment', "must be 'browser' or 'server'")
    );
  }

  // Checked, not coerced. `live: 'yes'` used to become `false` and
  // `namespace: 7` used to become absent, which is the silent-default failure
  // this boundary exists to remove: two descriptors that behave differently
  // must not arrive at the same normalized value.
  if (live !== undefined && typeof live !== 'boolean') {
    throw ownedByLibrary(new InvalidDescriptorError('live', 'must be a boolean'));
  }
  if (namespace !== undefined && typeof namespace !== 'string') {
    throw ownedByLibrary(new InvalidDescriptorError('namespace', 'must be a string'));
  }

  return {
    // The snapshots taken above, not the caller's array. A `readonly` type does
    // not stop the caller from holding the same objects and mutating them after
    // the key is computed, which would let one descriptor produce two wire
    // filters — the exact divergence between key and wire this boundary exists
    // to prevent. Taking them at the top rather than here is what extends that
    // from "after the key is computed" to "while it is being computed".
    filters,
    live: live === true,
    settleTimeoutMs,
    retain,
    relays,
    scopeGeneration,
    namespace,
    environment: environment ?? 'browser'
  } as unknown as NormalizedDescriptor;
}
