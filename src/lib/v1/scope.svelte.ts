/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * B-α: what a scope generation is.
 *
 * The key input has had a `scopeGeneration` field since B1, with nothing behind
 * it. Two readings were on the table: make the provider's relay set immutable
 * and rebuild it when it changes, or put a normalized relay scope into the
 * internal key. They were presented as a choice between a simpler explanation
 * and keeping the existing context.
 *
 * They are not equivalent, and the thing that separates them is not simplicity.
 * rx-nostr publishes no signal when its relay list changes (CONST-R24), and
 * `getDefaultRelays()` is a plain getter that Svelte cannot track — so a scope
 * *read from the client* is a scope nothing can react to. A request deferred
 * because it had nowhere to ask stays deferred after relays arrive (P19c). Only
 * an owned, reactive set fixes that, so the second reading cannot stand alone:
 * whatever the key contains, something has to own the set.
 */

import type { RxNostr } from 'rx-nostr';
import { createRxNostr } from 'rx-nostr';

import { describeValue, InvalidDescriptorError } from './normalize.js';
import { saidBy } from './own.js';
import { hardenOwned, ownedByLibrary } from './owned.js';
import { RelayNotInScopeError } from './reqerror.js';

/**
 * The relays a request may read from, as one immutable value.
 *
 * Immutable per generation is the whole of it. A scope that could be edited in
 * place would let two requests keyed on "the same scope" have been asked under
 * different relay sets, which is the safety condition the cache key exists to
 * state — the same collision the time-window question ran into from the other
 * direction (`CH6`. This cited that test under its old id for sixteen days
 * after a rename moved it, and nothing read the citation until a check for
 * exactly this was written — the old id is not repeated here, because a dead
 * id in shipping prose is what that check is looking for).
 */
/** A relay and what it may be used for. The same shape `NostrApp` accepts. */
export interface RelayConfig {
  readonly url: string;
  readonly read: boolean;
  readonly write: boolean;
}

export interface RelayScope {
  /**
   * Every relay, with what each is for.
   *
   * The first version took `string[]` and made everything read/write, which
   * dropped a capability the current `NostrApp.relays` already has — while
   * B-γ and the relay diagnostics both depend on the distinction. Losing
   * read/write here would have meant a public API that cannot express the
   * configuration the library itself branches on.
   */
  readonly relays: readonly RelayConfig[];
  /**
   * For each relay, the spellings the caller wrote that resolved to it.
   *
   * **The join a consumer has no other way to make.** The diagnostics map is
   * keyed by the transport's name for a relay; what a consumer holds is what
   * they typed, and looking a relay up by their own spelling came back
   * `undefined` — measured, with a trailing slash, a capitalised host and a
   * reordered query. Nothing published bridged the two.
   *
   * Derived here, once, while both are in hand: after the scope is built the
   * caller's strings are gone, and recovering them would mean asking the
   * transport again — a second answer to a question already answered, which is
   * the shape this file refuses everywhere else.
   *
   * Deduplicated and sorted, so that the order is not a promise about the
   * order a caller happened to write them in. **Not on `RelayConfig`**: that
   * type is also the *input* a caller writes, and a field they cannot supply
   * does not belong on it.
   */
  readonly configuredUrls: Readonly<Record<string, readonly string[]>>;
  /**
   * The readable relays, normalized: deduplicated and sorted.
   *
   * Sorted because the *set* is what identifies a scope. Two callers listing
   * the same relays in different orders are asking the same question, and a key
   * that disagreed would split the cache for no reason a user could see.
   */
  readonly urls: readonly string[];
  /**
   * The scope's identity, and what goes into the cache key.
   *
   * Derived from the readable relays alone. A write-only relay cannot answer a
   * REQ, so adding or removing one does not change what any request can be told
   * — and splitting the cache over it would re-ask every question for a change
   * that cannot affect an answer.
   */
  readonly id: string;
}

export type RelayInput = string | RelayConfig;

/**
 * Which of this library's reasons for refusing a relay list applies (C16).
 *
 * **One per class below, and the count is a measurement rather than a
 * preference.** Eleven `throw` sites are reachable from a relay list — four
 * inside the entrance check, one for a duplicate that disagrees with itself,
 * two for a name the transport will not leave alone, one for a set it does not
 * name the way it named the members, and three for a transport that cannot give
 * one usable name for one relay. 0004 C16 was written with three codes, from a
 * comment in this file that counted the entrance as "the fourth cause"; the
 * fourth is here because the enumeration says so, and the fifth arrived the same
 * way. **This paragraph counted eight for three rounds after it stopped being
 * eight** — the sites are the thing that grows when a seam is distrusted more
 * finely, and nothing counts them but a reader.
 *
 * **What decides whether two causes share a code is whether a consumer does the
 * same thing about them**, and the entrance's four sites do: a value that is not
 * a `ws:`/`wss:` URL, a `read` that is not a boolean and an entry that is
 * neither a string nor an object are all "the object this list was built from
 * is the wrong shape", fixed where it was built. They are also the four this
 * library refuses **before the transport is asked anything**, which is the
 * distinction `B-α-C17` is written on and the one a code that spanned layers
 * would erase.
 *
 * The other four do not fold into each other or into that one:
 *
 * - `conflicting-capabilities` — every entry is well formed and two of them
 *   disagree, so the repair is to reconcile the two sources that produced them,
 *   not to fix a value;
 * - `non-idempotent-url` — the URL is a relay URL and the transport will not
 *   settle on a name for it, so the repair is to write the relay a different
 *   way;
 * - `transport-key-mismatch` — the transport itself does not compose, so the
 *   repair is to pin the resolved rx-nostr, or to write a set whose members it
 *   names one at a time;
 * - `transport-incompatible` — asked about a relay, or about the whole list at
 *   once, the transport does not give back one usable name per relay, and no
 *   relay list answers that: the repair is to pin or upgrade, or to report what
 *   it answered.
 *
 * **A code splitting `not-a-relay-url` out of the entrance was considered and is
 * not taken**: `{ url: 5 }` and `{ url: 'nostr.example.com' }` are refused by one
 * function with one message, and no consumer action separates them that the
 * message does not already carry. That is a different question from the fifth
 * code above, which exists because its remedy *is* different — and the two were
 * both called "a fifth code" in this file for a day, which is a reason to name
 * codes for what a consumer does rather than for where the throw is.
 */
export type RelayConfigurationErrorCode =
  | 'invalid-relay-input'
  | 'conflicting-capabilities'
  | 'non-idempotent-url'
  | 'transport-key-mismatch'
  // **A fifth, and it is here because this record's own rule put it here.**
  // `0004`: a consumer's response differs by cause, so the cause has to be
  // discriminable, and *a new cause of refusal has to arrive as a new code
  // rather than as a message change*.
  //
  // **The line between it and the one above is what the consumer can do**, and
  // that is why this one is named for the outcome rather than for the fault:
  //
  // - `transport-key-mismatch` — every relay has a valid, stable name of its
  //   own, and the *set* changes when they are asked about together. A consumer
  //   rewrites the list so each entry is a relay the transport names on its own.
  // - `transport-incompatible` — the transport does not yield exactly one
  //   usable name per relay, asked about one of them or about the configured
  //   list as a set. Nothing in the relay list fixes that: the remedy is
  //   pinning or upgrading rx-nostr or this library, or reporting what was
  //   answered.
  //
  // Named for the class rather than for today's instance on purpose. Several
  // faults have the same remedy — no name for a relay, several names for one
  // relay, an answer that is not a string, a URL that is not a relay URL, an
  // adapter that throws — and one code per fault would grow a permanent public
  // union every time the internal transport contract is split more finely. Those
  // distinctions live in the message and in the unpublished subclass.
  | 'transport-incompatible';

/*
 * **Why a request naming a relay this provider cannot read is not a sixth code
 * here.** It was written as one for an afternoon. This union is
 * `RelayConfigurationError`'s, and that class is *every way this library refuses
 * a relay list* — a provider-level value that reaches a consumer through
 * `context.configurationError`, not through a request. A request naming a bad
 * target refuses **a request**: it has to arrive on `state.error` and on
 * `refresh()`'s rejection, which is `ReqError`'s channel and a different code
 * space. It is `relay-not-in-scope` there, and {@link RelayNotInScopeError}
 * carries it.

/**
 * Every way this library refuses a relay list, as one published type (C16).
 *
 * **A base class rather than a translation.** The alternative was to catch the
 * four classes below and rebuild them as one, and rebuilding loses the message,
 * the stack and the identity of the object that was actually thrown — for a
 * refusal whose whole job is to tell a consumer what to change. Extending
 * instead means the `throw` sites do not move, `instanceof` answers for all
 * five, and the subclasses stay unpublished: a subtype is not reachable from
 * the type a consumer can name, so `public-entry.ts` grows by two names and not
 * by seven.
 *
 * **`urls` names relays and is empty when there are none to name.** An entry
 * refused at the entrance is refused *for not being a relay URL*, so there is
 * no name for it to carry — `{ url: 5 }` has none, and quoting `5` in a field
 * typed `readonly string[]` would make the field mean "whatever was written
 * there" for one code and "relays" for the other three. The message carries the
 * value. What that costs is stated rather than hidden: the most common
 * misconfiguration is the one whose `urls` is empty.
 */
export class RelayConfigurationError extends Error {
  /**
   * The three members `Error` gives this class, re-declared as `readonly`.
   *
   * **`B5-C6` says every member of every published type is `readonly` to the
   * depth a consumer can reach, and inherited members are where that was
   * false**: `message`, `name` and `stack` arrive from `Error`, where they are
   * mutable, so `err.message = '[redacted]'` compiled against the emitted
   * `.d.ts` — legal-looking code the run time refuses, which is the exact
   * failure the sentence exists to prevent. `declare` makes this type-only: the
   * run time is unchanged and the modality reaches the `.d.ts`, which is where
   * `LK17` reads it, over the four classes still exported as values rather than one. (A merged
   * `interface` says the same thing and is what
   * `@typescript-eslint/no-unsafe-declaration-merging` exists to stop.)
   */
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  /**
   * Re-declared for its siblings' reason, and narrowed to what this class can
   * carry: it never sets a `cause`, so the published type says so rather than
   * leaving `Error`'s mutable `unknown` reachable.
   */
  declare readonly cause?: undefined;

  readonly code: RelayConfigurationErrorCode;
  readonly urls: readonly string[];

  constructor(code: RelayConfigurationErrorCode, urls: readonly string[], message: string) {
    super(message);
    (this as { name: string }).name = 'RelayConfigurationError';
    hardenOwned(this);
    this.code = code;
    // **Copied and frozen, and the copy is not decoration.** The array handed
    // in is the scope's own list at several `throw` sites, and this Error is
    // published on `useRelayDiagnostics().configurationError` — so a consumer's
    // `error.urls.push('wss://…')` rewrote the provider's metadata and the next
    // panel listed a relay nobody configured. Measured end to end through the
    // provider. `RD24` closed the same defect on the diagnostics row and the
    // sweep stopped there, which is why this line is dated later than that one.
    this.urls = Object.freeze([...urls]);
    // **The freeze is in the five subclasses and not here**, and the reason is
    // that this constructor cannot do it: every refusal extends this class and
    // assigns its own fields after `super(...)`, so freezing here would make
    // each of them throw on its next line. A `new.target === …` guard would put
    // a line here that nothing reaches — nothing constructs this class directly
    // (`CF2` holds the family closed, which is what makes that a measured claim
    // rather than a hope), and a guard with no falsifier is what this
    // repository calls dead code rather than defence.
    //
    // What the freeze is for is `code`: a consumer could rewrite it, and `code`
    // is the field C16 says they branch on — a written `code` and the message
    // it came with then say different things to the next reader of one object.
    // `CF1` checks every refusal the family can produce is frozen, `CF10` what
    // a write to one reaches.
  }
}

/**
 * Constructed from a named object rather than from an ordered pair.
 *
 * Two strings in a row is the shape where a caller — or a later edit here — can
 * swap them and get a plausible sentence out. The fields are the same fields;
 * what changes is that neither position means anything. This is the form the
 * review wrote, and nothing in any record argued for the positional one.
 */
export interface InvalidRelayScopeDetail {
  /**
   * The relays the consumer configured, in their own spelling — the two entries
   * that disagree, or the one spelling both were written as. Never empty.
   *
   * **Not the transport's name for them**, which is what this carried for a
   * round: `scopeOf` detects the conflict *after* naming, so under a transport
   * that renames, the refusal named a URL that is nowhere in the caller's
   * source and the message contained nothing they could search for. Found by a
   * reviewer, one commit after the same defect was repaired in the fifth code's
   * class and not swept.
   */
  readonly wrote: readonly [string, ...string[]];
  /** What the transport calls them, said only when it differs. */
  readonly named: string;
  readonly reason: string;
}

export class InvalidRelayScopeError extends RelayConfigurationError {
  readonly wrote: readonly string[];
  readonly named: string;
  readonly reason: string;

  constructor({ wrote, named, reason }: InvalidRelayScopeDetail) {
    const spellings = wrote.join(' and ');
    const under = wrote.includes(named) ? '' : `, both named ${named} by the transport,`;
    super(
      'conflicting-capabilities',
      wrote,
      `nosvelte: ${spellings}${under} ${wrote.length === 1 ? 'appears' : 'appear'} twice with ` +
        `${reason}. The scope is refused rather than merged: an OR of the two would produce a ` +
        `relay with capabilities neither entry asked for, which quietly widens what is read ` +
        `from or written to.`
    );
    (this as { name: string }).name = 'InvalidRelayScopeError';
    hardenOwned(this);
    this.wrote = Object.freeze([...wrote]);
    this.named = named;
    this.reason = reason;
    if (new.target === InvalidRelayScopeError) Object.freeze(this);
  }
}

/**
 * A relay input this library refuses to ask anybody about.
 *
 * **The one check that is nosvelte's own judgement rather than the transport's,
 * and it exists because the transport has none.** rx-nostr's `normalizeRelayUrl`
 * opens with `let o = ""`, does its work in a `try`, and returns `o` from the
 * `catch` — so a value it cannot handle comes back as the empty string rather
 * than as an error. Measured at 3.7.5, one value per throwaway client:
 * `setDefaultRelays([5])`, `[true]`, `[{}]` and `[['wss://a']]` are all
 * **accepted**, and all four name the connection `""`. `['nostr.example.com']`,
 * `['http://h.example']` and `['not a url at all']` are accepted too, under
 * themselves. The only inputs it refuses at all are `null` and `undefined`,
 * which reach it as a raw `TypeError` about reading `'url'`.
 *
 * So "rx-nostr will refuse it" — which is what the comment in
 * {@link canonicalOnce} used to say, and what made leaving this unchecked look
 * safe — is false. What actually happens is worse than a refusal in the one way
 * that matters: **different bad inputs become the same relay.** Four
 * `{ url: <not a string> }` entries produced one scope identity, `[""]`, so two
 * requests configured with different nonsense shared a cache entry — the
 * verbatim falsifier B-α exists to prevent. `TD8` is that measurement, and
 * `TD9` is the pair of it that must stay green.
 *
 * **The check is a function because the published API is a JavaScript API**,
 * which is 0003's argument for {@link InvalidDescriptorError} applied to the
 * one input it was never applied to: a `RelayInput` annotation does not stop a
 * value arriving, and `NostrApp.relays` is the most likely place for one to
 * arrive from configuration, storage or a network response.
 *
 * Not on the published surface, and now for a reason with a mechanism behind
 * it: it is a {@link RelayConfigurationError} with the code
 * `invalid-relay-input`, so a consumer catches it by the published type and
 * discriminates it by the published field. This comment used to say it was
 * "the fourth cause a `RelayConfigurationError` code would have to
 * discriminate", and that is what it turned out to be — 0004 C16 named three.
 */
export class InvalidRelayInputError extends RelayConfigurationError {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(
      'invalid-relay-input',
      // Empty rather than the value: what was written is not a relay URL, which
      // is the refusal, so there is no relay name for this to carry. See
      // {@link RelayConfigurationError}.
      [],
      `nosvelte: ${field} ${detail}. **nosvelte refused this, before the relay transport ` +
        `was asked anything about it** — rx-nostr accepts values that are not relay URLs, ` +
        `names its connection after them or after the empty string, and the request that ` +
        `follows fails much later as an ordinary network timeout. Relay input is checked ` +
        `at runtime because the published API is a JavaScript API: a type annotation does ` +
        `not stop a value arriving.`
    );
    (this as { name: string }).name = 'InvalidRelayInputError';
    hardenOwned(this);
    this.field = field;
    if (new.target === InvalidRelayInputError) Object.freeze(this);
  }
}

/**
 * The two names one relay would have, and the reason it is refused.
 *
 * Named fields rather than an ordered triple, for {@link InvalidRelayScopeDetail}'s
 * reason: three strings in a row is the shape where a later edit can swap two of
 * them and still produce a sentence that reads.
 */
export interface NonIdempotentRelayUrlDetail {
  /** What the caller wrote. */
  readonly url: string;
  /** What the transport names it, applied once to what the caller wrote. */
  readonly once: string;
  /** What the transport would name *that*, if it were handed back. */
  readonly again: string;
}

/**
 * A relay URL the transport does not leave alone.
 *
 * The library hands the transport a name — {@link createRelayScope} writes the
 * accepted set through with `setDefaultRelays`, and the machine keys its
 * per-relay table by the same strings — so a name the transport rewrites
 * *again* is one where the name a request is attributed by and the connection
 * that answers it are two different relays.
 *
 * **Whose judgement that is changed, and the fields below were already written
 * for the new one.** `once` and `again` say "what the transport names it" and
 * "what the transport would name that", and until r31 both were produced by
 * {@link canonicalOnce} — this library's transcription of a function rx-nostr
 * does not export. They are the actual transport's answers now, taken one URL
 * at a time from {@link TransportKeys}, so the refusal is a fact about the
 * rx-nostr a consumer resolved rather than about the one this repository was
 * written against. `TD4` is the arm that separates the two: a transport that
 * settles `?x=%257E` in a single pass has no such relay to refuse, and the old
 * ordering refused it anyway without ever asking.
 *
 * There are two ways out of that and only one of them is a v1 decision. Keep
 * applying the transformation until it stops moving, and the library picks a
 * route the caller did not write: `?x=%2526y=1` is one query parameter after
 * one pass (`x="&y=1"`) and two after the next (`x=""`, `y="1"`), which a relay
 * that authenticates or routes on its query reads as a different request.
 * Refuse, and the caller is told. B4 already says an input that cannot be
 * honoured is refused rather than guessed at, and this is that rule applied to
 * the one input the library cannot honour without choosing an endpoint.
 *
 * Not on the published surface, deliberately: `public-entry.ts` names what a
 * consumer can catch by type, and adding to it is 0004's decision rather than
 * this file's. A consumer sees the message.
 */
export class NonIdempotentRelayUrlError extends RelayConfigurationError {
  readonly url: string;
  readonly once: string;
  readonly again: string;

  constructor({ url, once, again }: NonIdempotentRelayUrlDetail) {
    super(
      'non-idempotent-url',
      // The caller's own string, because that is the one they would change.
      // `once` and `again` are the transport's two answers about it and are on
      // the message; putting all three here would make the field a trace.
      [url],
      `nosvelte: ${url} is refused as a relay URL. The transport names it ${once}, and ` +
        `handed that name back it would name it ${again} — so the string this library ` +
        `would identify the relay by is not the connection that answers under it. Rather ` +
        `than choose between them, which is choosing an endpoint the caller did not ` +
        `write, the scope is refused. Write the relay as a URL the transport leaves ` +
        `alone.`
    );
    (this as { name: string }).name = 'NonIdempotentRelayUrlError';
    hardenOwned(this);
    this.url = url;
    this.once = once;
    this.again = again;
    if (new.target === NonIdempotentRelayUrlError) Object.freeze(this);
  }
}

/**
 * What the transport would actually call these relays. **Where every name in a
 * scope comes from.**
 *
 * Not a check on a name this library chose — the name itself. That distinction
 * is the whole of r30's defect: the seam used to be handed
 * `next.relays[].url`, which is {@link canonicalOnce}'s output, so the only
 * thing a consumer's transport was ever asked about was a string this library
 * had already decided on. A transport `T` with `T(caller's URL) = elsewhere`
 * and `T(our output) = our output` agreed with every comparison that could be
 * made and routed every request to `elsewhere` — self-consistency read as
 * agreement, which is the move r29 withdrew from `canonicalUrl` reappearing one
 * layer out. `TD1` is that counterexample as a contract.
 *
 * **Asked two ways, and the two are different questions.**
 *
 * - **One URL at a time**, with the caller's own string, to get the name that
 *   relay is identified, routed and attributed by, and then a second time with
 *   that name to find out whether the transport would leave it alone. Several
 *   URLs in one call cannot answer this: the transport merges them into a map
 *   keyed by its own names before it reports them, so the correspondence
 *   between a raw URL and the key it produced is gone by the time the answer
 *   comes back.
 * - **The whole candidate set once**, after the per-URL pass, because a
 *   disagreement can be a *merge* — two names the transport settled separately
 *   that it calls one relay together — and one-at-a-time cannot see that.
 *   `TD6`.
 *
 * Every call must answer for a transport that has seen nothing else; the
 * default builds one per call and throws it away. Injectable so a test can
 * supply one that disagrees: the condition is a consumer's lockfile resolving
 * an rx-nostr this repository cannot see, and a seam nothing can move is a
 * refusal nobody has watched happen.
 */
export type TransportKeys = (urls: readonly string[]) => readonly string[];

/**
 * Ask the transport, on a client that is thrown away.
 *
 * **Three properties make this affordable, and each was measured against
 * rx-nostr 3.7.5 rather than assumed.**
 *
 * - `setDefaultRelays` **opens no socket**: a mock server standing at the URL
 *   sees no client, before or after `dispose()`, 200ms later. The default
 *   connection strategy is lazy, so naming a relay is not dialling it.
 * - It **fills the status map at once**, which is what makes the key readable
 *   without connecting (`RD6`).
 * - It is **cheap**, and the figure that matters is the one for the way it is
 *   actually called. A generation of *n* entries costs `2n + 1` of these rather
 *   than one, because each URL is asked about alone and then its answer is
 *   asked about alone — `n` entries and not `n` relays, since a caller who
 *   lists one relay twice pays for it twice. **`n = 0` is the exception and it
 *   costs nothing**: with no relays there is no set to be renamed, so the set
 *   probe is not built either (`B-α-C20`). Measured on an idle ten-core
 *   machine, node v26.3.1,
 *   1,000 generations each: **1 relay 0.07ms, 3 relays 0.18ms, 8 relays
 *   0.46ms, 20 relays 1.14ms** — against 0.03/0.06/0.15/0.35ms for the single
 *   set probe this replaced, so between 2.2x and 3.2x of a number that was
 *   already too small to see. The old note said "1,000 probes of three relays
 *   each took 80ms", which is the same measurement of the call this is no
 *   longer made through.
 *
 * **`skipFetchNip11` is load-bearing rather than copied from the harness — and
 * unlike the `finally` below, nothing observes it.** Removing it kills only the
 * ledger's own text check, so what stands here is the measurement in this
 * comment and not a test that would go red.
 * With it left at its default, `setDefaultRelays` calls `fetch` once per relay
 * — measured, with a spy — so a probe without it turns every relay-list change
 * into an HTTP round trip for metadata nothing here reads.
 *
 * **The `finally` is load-bearing too.** An undisposed client that has been
 * given relays holds a timer: 200 of them left 200 `Timeout` handles alive
 * (`process.getActiveResourcesInfo()`), while 200 undisposed clients that were
 * never given relays held none. So the leak this would cause is one timer per
 * relay-list change, for the life of the page. `TK2` is that measurement as a
 * test.
 */
export const probeTransportKeys: TransportKeys = (urls) => {
  const probe = createRxNostr({
    skipVerify: true,
    skipFetchNip11: true,
    retry: { strategy: 'off' }
  });
  try {
    probe.setDefaultRelays([...urls]);
    return Object.keys(probe.getAllRelayStatus());
  } finally {
    probe.dispose();
  }
};

export interface TransportKeyMismatchDetail {
  /**
   * The relays the consumer configured, in their own spelling. Never empty, and
   * typed so rather than checked.
   */
  readonly wrote: readonly [string, ...string[]];

  /**
   * What the transport was asked to name: the candidate set the per-URL pass
   * settled on.
   *
   * **One shape now.** It carried a second — the single URL a probe was given
   * when that probe came back with none or several names — and the message
   * below had to be worded to be true of either. That case is
   * `transport-incompatible` since r32, because a transport that cannot name
   * one relay once is not answered by rewriting the list this message tells a
   * consumer to rewrite.
   */
  readonly expected: readonly string[];
  /** What it answered for exactly that list. */
  readonly actual: readonly string[];
}

/**
 * The transport does not compose: it answers about a set differently from how
 * it answered about each member.
 *
 * **This row is much narrower than it was, and the narrowing is the r31
 * repair rather than a weakening.** It used to carry "the transport disagrees
 * with `canonicalUrl`", which was the only guard there was — and it could not
 * work, because the disagreement it compared was between our output and the
 * transport's answer *to our output*. Names come from the transport now
 * ({@link TransportKeys}), so there is no second opinion left to differ with:
 * a transport that calls the caller's relay something unexpected is obeyed
 * (`TD1`), and one that will not leave its own answer alone is refused as
 * non-idempotent (`TD2`).
 *
 * What is left is what the per-URL pass structurally cannot see. Each name was
 * settled on its own; this is the transport asked about all of them together,
 * and the answer that matters is a **merge** — two names it settled separately
 * that it calls one relay when they arrive as a set (`TD6`). Then one relay's
 * EOSE is attributed to a scope entry no packet will ever carry, and the
 * symptom is a relay that answered in full reported as a network timeout
 * (`SC16`'s failure mode).
 *
 * **The degenerate case on the way in — a transport that answers a single URL
 * with none or several — is not this class any more.** It is
 * `transport-incompatible`, because a consumer cannot answer it by rewriting the
 * relay list, which is what this message tells them to do.
 *
 * That is silent, and it is silent in the direction that matters: a consumer
 * sees partial answers blamed on the network. So the comparison is made at the
 * one moment it can be made cheaply and before anything depends on the answer.
 *
 * Not on the published surface, for {@link NonIdempotentRelayUrlError}'s
 * reason: `public-entry.ts` is 0004's decision.
 */
/**
 * Asked about one relay, the transport did not yield exactly one usable name.
 *
 * **Not a mismatch, and the difference is what a consumer does next.** A
 * mismatch is answered by rewriting the relay list so that each entry is one the
 * transport names separately; nothing in a relay list answers this one, so
 * telling a consumer to rewrite theirs would send them after a problem that is
 * not there.
 *
 * **One class for several faults, because they have one remedy.** No name, more
 * than one name, and an answer that is not a string are all "this transport is
 * not the one this library was written against" — and the public `code` is the
 * remedy rather than the fault, so that the next fault of the same kind can join
 * it instead of growing the union. What was actually seen goes in the message,
 * rendered by {@link describeValue}, because rendering the array collapses the
 * offender away: `JSON.stringify` of `[Symbol()]`, `[undefined]`, `[() => {}]`
 * and `[null]` are one string. Measured before this class existed.
 *
 * **What it does not say is which client to look at.** The message told a
 * consumer to check the client they passed to the provider, and under C6 there
 * is no such client: the provider makes its own. What a consumer can act on is
 * the resolved version.
 *
 * **`urls` is what the consumer wrote, and the message is what was asked — the
 * two are not always the same string.** Three of the four questions this class
 * reports on are asked about something the consumer never typed: the stability
 * pass asks about the *transport's* answer, and the set probe asks about the
 * scope's names, which are the transport's answers too. Publishing the asked
 * string as `urls` put a URL the consumer had not configured into the field
 * `0004` says names relays they can act on — measured on both paths, and
 * `B-α-C18` is the row for the first. So the two are separate parameters and
 * the message says both when they differ.
 *
 * **Every relay, not the first of them.** The set probe asks about the whole
 * list at once, and naming one of three sent a consumer to a relay that may
 * have had nothing wrong with it, under a sentence reading "one relay".
 */
export class TransportIncompatibleError extends RelayConfigurationError {
  /**
   * What the transport said, rendered — **not the object it said it with.**
   *
   * The field used to be `answered: unknown`, holding the transport's live value
   * and shallow-freezing it. A reviewer measured what that meant on the surface
   * this class is published on: `configurationError.answered === theirArray`,
   * their array frozen by us as a side effect of reading it, and its nested
   * objects still mutable and still visible through the published Error. That is
   * the same defect the failure channel was redesigned to remove, in the one
   * class the redesign did not sweep — a foreign graph reachable from a value
   * every component under the provider reads.
   *
   * So what is kept is the rendering the message already carries: bounded,
   * frozen, and nothing of the transport's. A consumer who needs the value
   * itself is a consumer whose transport is broken in a way this library cannot
   * describe, and that is what the message is for.
   */
  readonly answered: string;

  /**
   * @param wrote — the relays **the consumer configured**, which is what `urls`
   *   carries. Typed non-empty rather than checked: `0004` says every code but
   *   `invalid-relay-input` names a relay, and this is the one class whose
   *   callers hold a list rather than a single URL, so `expected[0] ?? ''` was
   *   expressible and did once publish `['']`. A caller with nothing to name
   *   now cannot construct this at all.
   * @param asked — the strings handed to the transport on the call that failed.
   * @param answered — what came back, or what was thrown. Rendered here and not
   *   retained.
   * @param how — whether `answered` is what came back or what was thrown. The
   *   sentence said "it answered" for both, so an adapter that threw and one
   *   that returned the same words produced identical published errors.
   */
  constructor(
    wrote: readonly [string, ...string[]],
    asked: readonly string[],
    answered: unknown,
    how: 'answered' | 'threw' = 'answered'
  ) {
    const rendered = describeValue(answered);
    super(
      'transport-incompatible',
      wrote,
      `nosvelte: the resolved rx-nostr transport is not one this version of nosvelte can use. ` +
        `${askedAbout(asked, wrote)} it ${how} ${rendered}, and ` +
        `this library needs exactly one name back per relay: every request is keyed, routed ` +
        `and attributed by that name, and the name is written back to the transport. Pin or ` +
        `upgrade rx-nostr, or upgrade nosvelte, or report what it said above; nothing about the ` +
        `relay list changes it.`
    );
    (this as { name: string }).name = 'TransportIncompatibleError';
    hardenOwned(this);
    this.answered = rendered;
    if (new.target === TransportIncompatibleError) Object.freeze(this);
  }
}

/**
 * How the transport was questioned, in the message's own voice.
 *
 * **It names the configured relay too whenever that is a different string.**
 * On the stability pass and on the set probe the question is about names the
 * transport itself produced, and a message that printed only the consumer's
 * spelling described a call that never happened — while one that printed only
 * the asked string told them to go and find a URL that is not in their source.
 */
function askedAbout(asked: readonly string[], wrote: readonly string[]): string {
  // **As sets, because the scope sorts and deduplicates and the caller's list
  // is neither.** Comparing them position by position made this clause fire for
  // `['wss://b.example', 'wss://a.example']` under a transport that renamed
  // nothing — measured — which is the opposite of what it is for: it exists to
  // say the question was about a name *this library* produced.
  const asASet = (urls: readonly string[]): string => [...new Set(urls)].sort().join('\u0000');
  const same = asASet(asked) === asASet(wrote);
  const count = asked.length === 1 ? 'one relay' : `${asked.length} relays, together`;
  const configured = same ? '' : `, which is what it had named ${wrote.join(', ')}`;
  if (asked.length === 0) return `Asked what it calls no relays at all —`;
  return `Asked what it calls ${asked.join(', ')} — ${count}${configured} —`;
}

export class TransportKeyMismatchError extends RelayConfigurationError {
  readonly expected: readonly string[];
  readonly actual: readonly string[];

  constructor({ wrote, expected, actual }: TransportKeyMismatchDetail) {
    super(
      'transport-key-mismatch',
      // **What the consumer configured**, for the reason `0004` gives the
      // field: it names relays they can act on, and they act on them by finding
      // them in their own source. `expected` is *this library's* names for
      // those relays — the transport's own answers — and under a transport that
      // renames, not one of them appears in the caller's file. That is what was
      // published here for a round: the repair that separated the two went into
      // the fifth code's class and stopped there, which is the
      // instance-instead-of-the-rule shape this record keeps naming. Both lists
      // are still on the error under names that say which is which.
      wrote,
      `nosvelte: the relay transport does not name these relays consistently. Asked about ` +
        // `describeValue` rather than `JSON.stringify`, for the reason it
        // exists: what is rendered here is the transport's answer, and this
        // message is built on the path that refuses it for being the wrong
        // thing. Rendering it with a call that throws on the wrong thing put
        // the refusal itself out of reach.
        `${describeValue(expected)} it answered ${describeValue(actual)}, which is not the ` +
        `same set. Every request would be keyed, routed and attributed under the first while ` +
        `answers arrived under the second, so relays that answered would be reported as ` +
        `having timed out. Two entries are most likely one relay to the transport even ` +
        `though it named them separately; write the set so that each entry is a relay it ` +
        `names on its own, or pin the resolved rx-nostr to a version whose naming this ` +
        `library was measured against.`
    );
    (this as { name: string }).name = 'TransportKeyMismatchError';
    hardenOwned(this);
    this.expected = Object.freeze([...expected]);
    this.actual = Object.freeze([...actual]);
    if (new.target === TransportKeyMismatchError) Object.freeze(this);
  }
}

/**
 * Two name lists for one relay set, compared as sets.
 *
 * Sorted rather than positional: `getAllRelayStatus()` is keyed by insertion
 * order, and depending on that would make this a check on the transport's map
 * implementation as well as on its names.
 *
 * **The length comparison is not what catches a merge, and saying so was
 * wrong.** A merge is caught by the element comparison — two of our names
 * arriving as one key leaves the sorted lists different whatever their
 * lengths. Measured: with the length line deleted the whole suite stays green.
 * What a length difference could catch on its own is a *split*, and the
 * transport cannot produce more keys than it was given, so the line is a
 * cheap guard rather than the thing that does the work.
 */
function sameNames(expected: readonly string[], actual: readonly string[]): boolean {
  if (expected.length !== actual.length) return false;
  const a = [...expected].sort();
  const b = [...actual].sort();
  return a.every((name, index) => name === b[index]);
}

/**
 * A config that shares nothing with the caller's object.
 *
 * B-α says the scope is immutable per generation, and an object the caller
 * still holds is not — they can flip `read` after the identity is computed, and
 * then the scope and the connection disagree about which relays are in use,
 * which is exactly the falsifier.
 */
/**
 * One spelling per relay, matching what the client will use.
 *
 * rx-nostr normalizes a relay URL before it connects — trailing slash, empty
 * hash, sorted query, decoded path — and keys its own maps by the result. Two
 * spellings of one relay therefore reach the client as one connection while
 * reaching a scope that did not normalize as two entries: the identity splits a
 * cache the connection does not, and `hasDrifted()` compares a list the client
 * has rewritten against one it has not. The duplicate rule below is only a rule
 * about *the same relay* if the same relay has one name here.
 *
 * The normalizer is not exported — `import { normalizeRelayUrl } from 'rx-nostr'`
 * does not resolve — so this is the same transformation written out.
 *
 * **A scope does not use it, and has not since r31.** {@link createRelayScope}
 * takes every name from {@link TransportKeys}, asked about the caller's own
 * string; this is a second copy of the same decision, and a second copy is only
 * ever a *belief* about the version a consumer resolved. Two callers are left,
 * and neither is a scope: `requestTargets`'s scope-less branch, which is a
 * spike-only internal fallback with no transport answer to hand (see
 * `stream.ts`), and `SC15`, which measures the belief against the rx-nostr this
 * repository resolves. Believing it is fine as a sentinel and was never fine as
 * an oracle — `TD1` is the counterexample, and it is the one this comment could
 * not have produced, because everything below argues about the *transcription*
 * being right and nothing about the transcription being *asked*.
 *
 * **It was written out wrong, and the divergence was not latent.** rx-nostr
 * 3.7.5 decodes the query *after* sorting it (`u.search = inlineTry(() =>
 * decodeURIComponent(u.search), u.search)`) and this step was missing, so
 * `wss://h.example/?x=%7E` was `?x=%7E` here and `?x=~` at the client. The
 * machine keys its per-relay backward table by this spelling while `packet.from`
 * carries the client's, so an EOSE from that relay was dropped as an unknown key
 * and a backlog that had been answered in full reported
 * `{ kind: 'incomplete', causes: ['timeout'] }`. `SC16` is that trace, kept.
 *
 * **This used to say `SC10` is what fails if the dependency's changes and this
 * does not, and `SC10` cannot fail for that reason.** It builds its scope over a
 * hand-rolled client stub, so no rx-nostr code runs in it, and it asserts the
 * spelling this function produces as a written-out literal. Measured, in a
 * throwaway worktree: with `parsed.hash = ''` removed, `SC10` fails with
 * `wss://h.example/#fragment` beside the expected entry — so it is a live
 * instrument for *this* function and is blind to the one it is being quoted
 * about. Measured again, the other way: with the query decode above taken out,
 * `SC10` still passes.
 *
 * **And it used to say `hasDrifted()` is where a divergence becomes observable,
 * which is false — it cannot see one at all.** That check reads
 * `Object.values(rxNostr.getDefaultRelays()).map((relay) => relay.url)`, and
 * rx-nostr rebuilds that record from each config's own `url` field, which is the
 * string it was handed. The string it was handed is what {@link createRelayScope}
 * wrote, which is this function's output — so the comparison is our spelling
 * against our own spelling echoed back, and no rx-nostr-normalized string is on
 * that path for it to disagree with. The client's normalized key exists on the
 * *other* accessor: `getAllRelayStatus()` is keyed by `NostrConnection.url`,
 * which is `normalizeRelayUrl`'d. `SEN25` records the two accessors disagreeing
 * about one relay.
 *
 * What witnesses the agreement is three checks rather than this comment.
 * `SEN25` takes the dependency's spelling from the resolved client with no
 * `$lib` on its path; `SC15` runs both sides in one process and compares them;
 * `SC16` carries it to the public outcome. All three are pinned to 3.7.5 by
 * `SEN10`, and none of them can see a consumer whose lockfile resolved a
 * different 3.x.
 *
 * **This is one application, and one application is all this function is.**
 * `normalizeRelayUrl` is not idempotent, so for some inputs the result of this
 * is a string the client would rewrite a second time. Those inputs are refused
 * rather than followed; see {@link canonicalUrl}, which is where the refusal
 * is, and {@link NonIdempotentRelayUrlError} for why refusing is the decision.
 * The sentence that stood here said the refusal matters because
 * {@link createRelayScope} writes this output back, and it does not any more —
 * what it writes back is the transport's own answer. The refusal still matters
 * to `requestTargets`'s scope-less branch, which does write this output to
 * nothing but its own target list.
 *
 * **What stood here instead was an iteration to the dependency's fixed point,
 * and it changed where requests were sent.** Measured against a fresh resolved
 * client per input: `wss://h.example/?x=%2526y=1` is `?x=%26y=1` after one pass
 * — one parameter — and `?x=&y=1` after the next, which is two. Reaching the
 * fixed point was therefore not "the spelling the transport chose" but a route
 * the library chose, and the check that was supposed to catch it built its
 * expectation by re-feeding its own output to the dependency, so it could not.
 */
function canonicalOnce(url: string): string {
  const trimmed = url.trim();
  try {
    // `SvelteURL` is for a URL something reads reactively. This one is a local
    // in a pure function — it is built, read once and discarded — so a reactive
    // one would allocate a proxy per call and be observed by nothing.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const parsed = new URL(trimmed);
    parsed.hash = '';
    try {
      parsed.pathname = decodeURI(parsed.pathname);
    } catch {
      // A path that is not valid percent-encoding is left as written.
    }
    parsed.pathname = parsed.pathname.replace(/\/$/, '');
    parsed.hostname = parsed.hostname.replace(/\.$/, '');
    parsed.searchParams.sort();
    try {
      parsed.search = decodeURIComponent(parsed.search);
    } catch {
      // A query that is not valid percent-encoding would be left as written —
      // which is what the dependency's `inlineTry` does here, and the reason
      // this is a `try` rather than a bare assignment. **Nothing can enter it.**
      // `searchParams.sort()` above re-serializes the query through the
      // urlencoded serializer first, so every `%` reaching this line is already
      // `%25`: measured over 229,791 inputs — 200,000 random query strings and
      // every `?x=%XXX` over a 31-character alphabet — with the branch counted,
      // and it was taken zero times. It is transcription rather than a
      // behaviour, and no test in this repository can distinguish it from an
      // unguarded assignment.
    }
    const out = parsed.toString();
    return parsed.search === '' ? out.replace(/\/$/, '') : out;
  } catch {
    // Not a URL at all. Left alone rather than guessed at: rx-nostr will refuse
    // it, and refusing it differently here would hide which layer said no.
    return trimmed;
  }
}

/**
 * One spelling per relay: this library's transcription, applied once, or no
 * relay at all.
 *
 * **A scope does not go through here. See {@link acceptedRelayName}, which asks
 * the transport the same two questions and gets them answered by the transport
 * a consumer resolved.** What is left for this is the **spike-only internal
 * fallback** in `requestTargets`: `scope` is optional on `UseStreamedReqOpts`
 * because the spike drives the engine directly, and on that branch the targets
 * come from the client's own relay list with no scope to have probed. Measured,
 * and it is a live defect on that branch: a client set up with `ws://host/` and
 * asked without a scope keys its backward table by `ws://host/` while every
 * packet says `ws://host`, so a relay that answered in full is reported as a
 * timeout (`SC19`). The intended public API has no caller who can reach it —
 * `public-entry.ts` publishes neither this nor `RelayScope`, and the provider's
 * scope is not optional — so it is a regression test for the spike's own code
 * rather than a consumer-facing path.
 *
 * **Two applications, and only the first one is a value.** The transport's
 * normalizer is not idempotent, so agreeing with it once is not enough on its
 * own: whoever takes this output uses it as a name, and for some inputs the
 * client would rewrite that name a second time and open a connection under a
 * string no target list, cache key or backward table carries. The second
 * application here answers *whether that happens* — it is a test, and its
 * result is never returned.
 *
 * **Which inputs that refuses, measured against a fresh resolved client per
 * input rather than argued from the transcription.** Accepted: a trailing
 * slash (`/`), two of them (`//`), one trailing hostname dot (`h.example./`), a
 * single percent-escape anywhere (`?x=%7E`, `/%7Epath`), an unsorted query, a
 * fragment, surrounding whitespace, an invalid escape (`?x=%zz`), and anything
 * already canonical. Refused: a doubly-escaped query (`?x=%257E`) or path
 * (`/%257Epath`), an escape that changes the query's shape (`?x=%2526y=1`),
 * three or more trailing slashes (`///`, `///?a=1`), and two or more trailing
 * hostname dots (`h.example../`). The last of those is why "the only unbounded
 * shape is a run of slashes" was wrong: dots come off one per pass too.
 *
 * **Why refuse rather than iterate.** See {@link NonIdempotentRelayUrlError}.
 * The short of it: the fixed point of `?x=%2526y=1` has a different number of
 * query parameters than one pass does, so converging is picking an endpoint,
 * and the loop that did it was also quadratic in a run of slashes with no
 * bound on the input.
 */
export function canonicalUrl(url: string): string {
  const once = canonicalOnce(url);
  // Applied to the result, not to the input, and the result is discarded. This
  // is the question "can the name we chose be handed to the transport without
  // it choosing a different one", and the only two answers it may produce are
  // `once` and a refusal.
  const again = canonicalOnce(once);
  if (again !== once) throw ownedByLibrary(new NonIdempotentRelayUrlError({ url, once, again }));
  return once;
}

/**
 * What the transport calls one relay, asked about that relay alone.
 *
 * A one-element list rather than a second seam shape, so the thing a test
 * injects and the thing a consumer resolves are one function. The length check
 * is not defensive padding: a transport that answers a single URL with none or
 * with several has produced no correspondence at all, and taking `answer[0]`
 * would silently invent one.
 */
/**
 * Is this a relay URL, asked without refusing anything?
 *
 * **Asked of the string itself, not of what a parser makes of it.** `new URL`
 * strips leading and trailing whitespace, tolerates a tab inside the scheme, and
 * accepts `wss:host` without the slashes — so a first version of this admitted
 * `' wss://a.example'` and handed it on as the relay's name. That name is the
 * routing key and what is written back with `setDefaultRelays`, while the
 * packets come back under the parsed spelling: the scope says one thing, the
 * client's status map says another, and a relay that answered is reported as
 * having timed out. That is `SC19`'s failure, reached through the transport
 * instead of through the caller.
 *
 * So the raw string must carry no whitespace at all — a URL that needs any has
 * to percent-encode it — and must begin with the scheme in full.
 */
function isRelayUrl(value: string): boolean {
  if (/\s/.test(value)) return false;
  if (!/^wss?:\/\//i.test(value)) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'ws:' || protocol === 'wss:';
  } catch {
    return false;
  }
}

/**
 * What the transport calls one relay.
 *
 * `reportAs` is the URL a refusal names, and it is a separate parameter because
 * the stability pass asks about the transport's *own* answer: `acceptedRelayName`
 * calls this twice, and the second call's `url` is a string the caller never
 * wrote. Reporting that one put a URL a consumer had not configured into
 * `RelayConfigurationError.urls` — measured — which is the field `0004` says
 * names relays the consumer can act on.
 */
function transportName(transportKeys: TransportKeys, url: string, reportAs = url): string {
  let answer;
  try {
    answer = transportKeys([url]);
  } catch (thrown) {
    // **The adapter itself giving out.** Same remedy as every other shape of
    // this — pin, upgrade, report — and without this the consumer's `catch` on
    // `RelayConfigurationError` is missed entirely and whatever rx-nostr threw
    // arrives instead. That is the defect `TD13`/`TD14` closed for values,
    // reaching the boundary one level up. Not `CF8`'s case: that is a disposed
    // provider throwing from the client this scope is written through, which is
    // a different call.
    throw ownedByLibrary(
      new TransportIncompatibleError([reportAs], [url], saidBy(thrown, String), 'threw')
    );
  }
  // **Asked about one relay and answered about none, or several.** That is the
  // same remedy as an answer that is not a name — nothing in the relay list
  // fixes a transport that cannot name one relay once — so it is the same code,
  // and it left `TransportKeyMismatchError` carrying one shape instead of two.
  // **Is it a list at all?** `answer.length` is read below and the `try` above
  // ends at the call, so a transport answering `null` — or an array-like, or a
  // string — reached `.length` unguarded and left a raw `TypeError` out of
  // relay-scope construction, past the class `0004` publishes. The set probe
  // gained this check a commit before this one and the comment there claimed
  // the per-relay path already had it; it did not, and this is the path a
  // consumer reaches first.
  if (!Array.isArray(answer))
    throw ownedByLibrary(new TransportIncompatibleError([reportAs], [url], answer));
  if (answer.length !== 1)
    throw ownedByLibrary(new TransportIncompatibleError([reportAs], [url], answer));
  const name = answer[0];
  // **The cast that used to stand here was the only thing saying this is a
  // string.** The transport is the one seam this file already declines to
  // trust — the mismatch check above is that distrust written down — and the
  // shape of what it answers was trusted anyway. What a non-string reaches is
  // not a type error a consumer can act on: it is `JSON.stringify` in an
  // error's own message and in `identityOf`, and a bigint there throws a raw
  // `TypeError` out of relay-scope construction, past the
  // `RelayConfigurationError` the records publish.
  //
  // **Its own code rather than the mismatch's**, because the two are answered
  // differently and `0004` says a cause is a code. It also keeps
  // `TransportKeyMismatchError.actual` true to its type: rendering an array
  // that holds a symbol or a bigint is what collapsed every one of these into
  // `it answered [null]`, and a consumer reading `actual` as strings would find
  // one that is not.
  if (typeof name !== 'string') {
    throw ownedByLibrary(new TransportIncompatibleError([reportAs], [url], name));
  }
  // **And a name this library cannot open a socket on is not a name.** The
  // answer is what every request is routed by *and* what is written back with
  // `setDefaultRelays`, so a transport that answers `''` — which is what
  // rx-nostr's own normaliser returns from its `catch` — put an empty string in
  // the scope's identity and in the client's relay list, and no connection could
  // ever open. Measured: `''`, `'banana'` and `'http://h.example'` were all
  // accepted and became routing keys.
  if (!isRelayUrl(name)) {
    throw ownedByLibrary(new TransportIncompatibleError([reportAs], [url], name));
  }
  return name;
}

/**
 * The name a relay is identified, routed and attributed by — the transport's,
 * for what the caller wrote.
 *
 * **Two questions, in this order, and the first one is the r31 repair.**
 *
 * 1. What does the transport call *the caller's string*? That answer is the
 *    candidate. Nothing this library computed is on its path, which is what
 *    makes the name a fact about the transport rather than a belief about a
 *    version.
 * 2. Handed that candidate, would the transport return it unchanged? The
 *    candidate is what gets written back with `setDefaultRelays`, so a "no"
 *    here is a name whose connection opens under a different string —
 *    {@link NonIdempotentRelayUrlError}, and see it for why that is refused
 *    rather than followed to a fixed point.
 *
 * Only the first answer is ever a value; the second is a test whose result is
 * discarded. That is the same shape {@link canonicalUrl} has, asked of the
 * transport instead of of a transcription — and the difference is not
 * decoration: `canonicalUrl` answers both questions with `canonicalOnce`, so
 * for a consumer whose rx-nostr normalizes differently it gets both wrong
 * together and cannot notice (`TD1`, `TD4`).
 */
function acceptedRelayName(transportKeys: TransportKeys, url: string): string {
  const once = transportName(transportKeys, url);
  const again = transportName(transportKeys, once, url);
  if (again !== once) throw ownedByLibrary(new NonIdempotentRelayUrlError({ url, once, again }));
  return once;
}

/**
 * Is this a relay URL at all? Asked by this library, of the caller's string.
 *
 * The rule is three things and no transformation: it is a string, it parses,
 * and its scheme is one a WebSocket can be opened on. What comes back is the
 * **caller's own string, byte for byte** — trimming or rewriting here would put
 * a second normalizer back in front of the transport, which is the whole of
 * what r31 removed. No trim is needed to make that work: `new URL` ignores
 * surrounding whitespace itself, so `'  wss://h.example  '` parses and `'   '`
 * throws, and both are judged without this function touching the string it
 * hands on.
 *
 * **What each clause refuses, measured rather than argued.** Refused: `5`,
 * `true`, `{}`, `['wss://a']` (not a string); `''`, `'   '`,
 * `'nostr.example.com'`, `'not a url at all'` (`new URL` throws); and
 * `'http://h.example'`, `'https://h.example'`, `'file:///etc/passwd'` (parse,
 * wrong scheme). Accepted: `'wss://h.example'`, `'WSS://h.example'`,
 * `'  wss://h.example  '`, `'ws://localhost:9410'`, and every percent-escape
 * and trailing-slash shape in `SC15`'s corpus. **The scheme clause and the
 * parse clause are one entry in the ledger and one message**, because they are
 * one question asked at two granularities — "is this a relay URL" — and a
 * caller told `must be a ws: or wss: URL, and was "nostr.example.com"` can act
 * on either.
 */

function requireRelayUrl(field: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw ownedByLibrary(
      new InvalidRelayInputError(field, `must be a string, and was ${describeValue(value)}`)
    );
  }
  let scheme: string | undefined;
  try {
    // Built, read once and discarded. `canonicalOnce` needs an
    // `eslint-disable` for `svelte/prefer-svelte-reactivity` on the same
    // constructor and this does not — the rule reads the binding rather than
    // the call, and nothing is bound here — so the directive is left off rather
    // than copied across, which `--report-unused-disable-directives` would
    // otherwise flag.
    scheme = new URL(value).protocol;
  } catch {
    // Not a URL. Left to the throw below rather than given its own message: a
    // caller who wrote `nostr.example.com` and one who wrote `http://…` have
    // made the same mistake at different depths.
  }
  if (scheme !== 'ws:' && scheme !== 'wss:') {
    throw ownedByLibrary(
      new InvalidRelayInputError(
        field,
        `must be a ws: or wss: URL, and was ${describeValue(value)}`
      )
    );
  }
  return value;
}

/**
 * A capability flag, required to be one.
 *
 * **Two defects, measured on the code this replaces, and they pull opposite
 * ways.** `{ read: 'no', write: 0 }` put the relay in the readable set, because
 * the filter that builds `urls` is a truthiness test and `'no'` is truthy — so
 * a caller who said no was read from. And `{ read: true }` beside `{ read: 1 }`
 * for one relay was refused as a capability *conflict*, because the duplicate
 * rule compares with `!==` — so two callers who agreed were told they disagreed.
 * One rule at the entrance answers both, and neither is reachable afterwards.
 */
function requireCapability(field: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw ownedByLibrary(
      new InvalidRelayInputError(field, `must be a boolean, and was ${describeValue(value)}`)
    );
  }
  return value;
}

/**
 * The caller's entry, checked and unpacked — and nothing else.
 *
 * No name is minted here: what comes out is the caller's own URL string beside
 * two booleans, and {@link scopeOf} is what asks the transport about it. The
 * order matters and is the coordinating reason this function exists separately
 * — a list with one bad entry in it does no transport probing at all.
 */
function checkedRelayInput(entry: RelayInput): RelayConfig {
  if (typeof entry === 'string') {
    return { url: requireRelayUrl('a relay', entry), read: true, write: true };
  }
  if (entry === null || typeof entry !== 'object') {
    throw ownedByLibrary(
      new InvalidRelayInputError(
        'a relay',
        `must be a URL string or a { url, read, write } object, and was ${describeValue(entry)}`
      )
    );
  }
  // **Read once, and a read that throws is this library's refusal rather than
  // the caller's exception.** An entry is an object a consumer built, so its
  // fields can be getters — `{ get url() { return config.relay.trim() } }` with
  // `config.relay` absent is an ordinary mistake, not a hostile one. Measured
  // before this: the `TypeError` left `createRelayScope` as itself, past the
  // class `0004` publishes, and on a *prop change* the provider's `$effect`
  // rethrew it and took the subtree and the client with it — which is `C16`'s
  // own falsifier, reached through a field instead of through the container
  // (`TD19` closed the container and the sweep stopped there).
  //
  // **The descriptor boundary decides this the other way** (`B4-C7`: a filter's
  // getter throwing is the caller's error and surfaces as theirs) and the
  // difference is not an inconsistency: a descriptor is refused *to the caller
  // who passed it*, and this list arrives on a prop, where the same throw is a
  // teardown of everything below the provider.
  let raw;
  try {
    raw = { url: entry.url, read: entry.read, write: entry.write };
  } catch (thrown) {
    throw ownedByLibrary(
      new InvalidRelayInputError('a relay', `could not be read: ${saidBy(thrown, describeValue)}`)
    );
  }
  const url = requireRelayUrl('a relay url', raw.url);
  const read = requireCapability('a relay read flag', raw.read);
  const write = requireCapability('a relay write flag', raw.write);
  return { url, read, write };
}

function scopeOf(entries: readonly RelayInput[], name: (url: string) => string): RelayScope {
  // **Every entry is checked before any of them is named.** Per-entry would be
  // enough for correctness — nothing bad reaches a scope either way — but it
  // would spend a transport probe per good entry ahead of a bad one, and the
  // refusal a caller reads would arrive after the library had already asked
  // about relays it was going to throw away.
  // **The list itself, which nothing checked.** Every entry was validated and
  // the container was taken on faith, so `relays={'wss://a.example'}` — one
  // string instead of a list, the commonest slip — left `entries.map is not a
  // function` out of `createRelayScope`, past the class `0004` publishes, and
  // on a *prop change* the provider's `$effect` rethrew it and took the whole
  // subtree and the client with it. That is `C16`'s own falsifier ("a refused
  // update tears down the provider's subtree"), reached through the container
  // rather than through an entry. Measured: a dense array holding the same bad
  // value is refused exactly as `C16` says.
  //
  // `Array.from` rather than a length check, because **a hole is not a value
  // and `map` skips it**: `[ , 'wss://a.example' ]` came out of `map` still
  // holed and `for…of` then read `.url` off `undefined`. Filled, the hole is an
  // entry that is not a relay, which is a refusal this boundary already has —
  // the same repair the transport's answer got, applied to the caller's list.
  if (!Array.isArray(entries)) {
    throw ownedByLibrary(
      new InvalidRelayInputError(
        'the relay list',
        `must be an array of relays, and was ${describeValue(entries)}`
      )
    );
  }
  const checked = Array.from(entries).map(checkedRelayInput);
  // A plain object rather than a Map, and deliberately not a reactive one: this
  // builds a value that is then assigned to `$state` in one go, so a tracked
  // collection would make the intermediate steps observable for no purpose.
  const byUrl: Record<string, RelayConfig> = {};
  // What the caller wrote for each name the transport gave back, so a refusal
  // can name the entries they can find in their own source rather than the
  // transport's answer for them.
  const wroteFor: Record<string, string> = {};
  // Every spelling, not the first: two entries can be one relay, and a consumer
  // holding either of them has to be able to find its row.
  const aliases: Record<string, string[]> = {};
  for (const entry of checked) {
    const config = { url: name(entry.url), read: entry.read, write: entry.write };
    const seen = byUrl[config.url];
    // Identical repeats are a spelling, not a conflict, and are deduplicated.
    // A disagreement is refused: the obvious repair — OR the capabilities — is
    // how `{read: false, write: true}` and `{read: true, write: false}` become
    // a relay that is both, which neither caller asked for and which is a
    // privacy decision made silently. Last-write-wins is worse still, since it
    // depends on the order two configuration sources happened to be merged in.
    if (seen !== undefined && (seen.read !== config.read || seen.write !== config.write)) {
      const first = wroteFor[config.url] ?? entry.url;
      throw ownedByLibrary(
        new InvalidRelayScopeError({
          wrote: first === entry.url ? [entry.url] : [first, entry.url],
          named: config.url,
          reason: 'conflicting read/write capabilities'
        })
      );
    }
    byUrl[config.url] = config;
    wroteFor[config.url] ??= entry.url;
    (aliases[config.url] ??= []).push(entry.url);
  }
  const relays = Object.values(byUrl).sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  // **Frozen where it is built, so the invariant has one place to be defended.**
  // The diagnostics row copies this list before publishing it; freezing here as
  // well means an internal path that reached for it would have to say so rather
  // than change it quietly.
  const configuredUrls = Object.freeze(
    Object.fromEntries(
      Object.entries(aliases).map(([name, wrote]) => [
        name,
        // Exact repeats collapse; different spellings of one relay all stay. The
        // order is this library's, deliberately: publishing the caller's order
        // would make "the order they were written in" a contract nobody asked
        // for.
        Object.freeze([...wrote].filter((url, at, all) => all.indexOf(url) === at).sort())
      ])
    )
  );
  // **And the rest of the snapshot, which the paragraph above claimed and the
  // code did not do.** Three records said this scope was "frozen through — the
  // array, its entries and the spelling map — (measured)"; an outside reviewer
  // measured it and only the spelling map was. `relays[0].read = false` took,
  // and so did `urls.push(…)` — on the object `stream.ts` hands the request path
  // as the relays a request is for. Nothing in this library writes to either
  // after this line (every writer rebuilds the snapshot), so the freeze costs a
  // pass and closes the door the sentence already described. `SC22`.
  const urls = Object.freeze(relays.filter((relay) => relay.read).map((relay) => relay.url));
  return Object.freeze({
    relays: Object.freeze(relays.map((relay) => Object.freeze(relay))),
    urls,
    configuredUrls,
    id: identityOf(urls)
  });
}

/**
 * The readable set, encoded so that no two different sets collide.
 *
 * `urls.join(',')` is not injective: `['wss://a', 'wss://b,wss://c']` and
 * `['wss://a,wss://b', 'wss://c']` produce the same string, so two different
 * scopes would share a cache entry — the one thing the key exists to prevent. A
 * URL cannot contain an unescaped quote or backslash, but this does not rely on
 * that; the encoding is unambiguous whatever the members are.
 */
function identityOf(urls: readonly string[]): string {
  return JSON.stringify(urls);
}

/**
 * The scope generation of a request made with no scope at all.
 *
 * Not a URL list, so it cannot collide with a real identity — {@link identityOf}
 * always produces a JSON array. It is only reachable outside a provider, which
 * in this spike means the harness: the engine is driven directly there, and
 * most expectations are not about relays.
 *
 * What stood here instead was a literal written into each engine of the two that
 * existed then, which is worse than this in the one way that matters — it looked
 * like a wired field while carrying nothing about relays, so B3 read as decided
 * and unit-tested while two requests under genuinely different relay sets shared
 * a key. A constant that says "there was no scope" cannot be mistaken for one.
 */
export const UNSCOPED_GENERATION = '(no relay scope)';

/**
 * What a descriptor's `scopeGeneration` is, given the scope it was made under.
 *
 * One function rather than a spelling per call site, because everything
 * agreeing about what a scope generation is _is_ the property: a key that means
 * different things in two places is the collision B1 exists to state.
 */
export function scopeGenerationOf(scope: RelayScope | undefined): string {
  return scope?.id ?? UNSCOPED_GENERATION;
}

/**
 * The relays a request is actually asked of, and the identity that follows.
 *
 * **One function, because the two answers have to be derived from the same
 * resolution.** The set the wire is asked of and the string the cache key
 * carries are the same fact said twice, and deriving them in two places is how
 * a request gets keyed by one relay set and sent to another — which is the one
 * direction {@link canonicalKey}'s safety condition forbids.
 *
 * `requested === undefined` means *the provider's default readable set*, and it
 * is not the same as `[]`: absent is "wherever this provider reads", empty is
 * "nowhere", written on purpose. Absent keeps the scope's own generation, so
 * nothing about today's requests changes; an explicit set keys on itself, which
 * is what stops a request that names its own relays from being re-keyed when a
 * relay it never asked of joins or leaves the provider.
 *
 * **An explicit set equal to the whole readable set produces the scope's own
 * generation**, because both are {@link identityOf} of the same sorted list.
 * That is the property rather than a coincidence: two requests with the same
 * effective targets are the same request.
 *
 * **Where the check stops, said rather than assumed.** With no scope there is no
 * accepted universe to be a subset of, so membership is unchecked and only the
 * canonicalization applies. That is the spike seam `requestTargets`'s second
 * branch already documents — a consumer cannot reach it, because a consumer
 * reaches this through a provider.
 */
export interface EffectiveTargets {
  /**
   * The canonical subset this request named, or `undefined` for "the
   * provider's default readable set".
   *
   * Sorted and deduplicated, so the caller's order and repeats carry no
   * meaning — the same discipline `RelayScope.urls` is under, for the same
   * reason: the *set* is the question.
   */
  readonly requested: readonly string[] | undefined;
  /** What the cache key carries for the relay axis. */
  readonly generation: string;
}

export function resolveTargets(
  requested: readonly string[] | undefined,
  scope: RelayScope | undefined
): EffectiveTargets {
  if (requested === undefined) {
    return Object.freeze({ requested: undefined, generation: scopeGenerationOf(scope) });
  }
  if (!Array.isArray(requested)) {
    throw ownedByLibrary(
      new InvalidDescriptorError(
        'relays',
        `must be an array of relay URLs, and it is ${describeValue(requested)}`
      )
    );
  }
  // Read once, into this library's own array, before anything is decided about
  // it — `B4-C7`. A caller's array may answer differently per read, and a
  // target checked as one relay and sent to another is the divergence every
  // boundary in this file exists to remove.
  const wrote: unknown[] = [...requested];
  // Built once per call rather than per element: a scope of *n* relays with a
  // request naming *m* of them is `n + m` rather than `n * m`.
  // A plain object with no prototype rather than a `Map`, which
  // `svelte/prefer-svelte-reactivity` refuses inside a `.svelte.ts`: this is a
  // lookup built and discarded inside one call, not state. `create(null)` so a
  // caller who writes `'toString'` looks up nothing rather than a function.
  const spelledAs: Record<string, string | undefined> = Object.create(null) as Record<
    string,
    string | undefined
  >;
  if (scope !== undefined) {
    for (const [name, spellings] of Object.entries(scope.configuredUrls)) {
      for (const spelling of spellings) spelledAs[spelling] = name;
    }
  }
  const resolved: string[] = [];
  for (const raw of wrote) {
    if (typeof raw !== 'string' || raw === '') {
      throw ownedByLibrary(
        new InvalidDescriptorError(
          'relays',
          `must contain relay URLs, and one entry is ${describeValue(raw)}`
        )
      );
    }
    // The caller's own spelling first, and that is the point of
    // `configuredUrls`: a consumer who configured `wss://A.example/` and asks of
    // `wss://A.example/` must not be told their own relay is not in the scope.
    // Falling through to `canonicalUrl` covers the spellings they did not
    // configure it under — including the transport's own name for it.
    // **Two refusals with two remedies, and the boundary decides which by what
    // has to change.** A string that is not a relay URL, or one the transport
    // would rename a second time, is a *descriptor* fault: the caller fixes the
    // value, exactly as they would a `retain: 0`. So the relay-list classes are
    // caught here and re-said on the request's own channel rather than escaping
    // as a provider-level refusal a request has no place to publish.
    let url: string;
    try {
      url = spelledAs[raw] ?? canonicalUrl(raw);
    } catch (thrown) {
      throw ownedByLibrary(
        new InvalidDescriptorError(
          'relays',
          `must contain relay URLs this library can name: ${saidBy(thrown, describeValue)}`
        )
      );
    }
    if (scope !== undefined && !scope.urls.includes(url)) {
      throw ownedByLibrary(
        new RelayNotInScopeError(url, scope.configuredUrls[url] !== undefined, scope.urls)
      );
    }
    resolved.push(url);
  }
  // `indexOf` rather than a `Set`, for the reason `adoptedScope` gives: the
  // rule refuses one inside a `.svelte.ts`, the value is a list this function
  // returns rather than state, and a request's relay count is single digits.
  const targets = Object.freeze(
    resolved
      .filter((url, at, all) => all.indexOf(url) === at)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  );
  return Object.freeze({ requested: targets, generation: identityOf(targets) });
}

/**
 * The owner of the relay set, held where Svelte can see it.
 *
 * This is what a provider would hold. `setRelays` writes through to the client,
 * so the scope leads and the client follows.
 *
 * **It is not the only way the client can change**, and an earlier version of
 * this comment said it was. The client is passed in, so a caller who has it can
 * call `setDefaultRelays` directly and the scope will not know — measured, in
 * `SC6`. Closing that needs the provider to own the client rather than receive
 * it, which is C6; until then this is a discipline with a hole in it, and
 * {@link hasDrifted} is here so the hole is observable rather than assumed
 * shut.
 *
 * Note what is *not* done: nothing reads the client's relay list back to build
 * the scope. That would reintroduce the untrackable read this exists to remove
 * — the client would be the source of truth and nothing would know when it
 * changed (CONST-R24).
 */
/*
 * Why AUTH state is not one of the inputs here.
 *
 * The question was whether authenticating should advance the generation. It
 * should not, and the reason is that v1 does not authenticate: `NostrApp`
 * constructs its client without an `authenticator`, so an `auth-required:`
 * refusal ends the subscription and stays ended (CONST-R15). There is no AUTH
 * state to be a function of.
 *
 * A consumer who configures an authenticator on the client they pass in gets
 * the re-request from rx-nostr itself, which re-sends the REQ after AUTH
 * succeeds — under the same subscription, so the same cache entry, so nothing
 * about identity changes. Putting AUTH into the key would split the cache
 * across an event that does not change what was asked.
 *
 * This stops being true if the library ever performs AUTH on the consumer's
 * behalf, because then the set of relays that will answer *is* a function of
 * auth state. That is a v2 question and it belongs to whichever decision adds
 * an authenticator, not to this one.
 */
export function createRelayScope(
  /**
   * The **live** transport the accepted generation is written through to, or
   * `undefined` where there is none.
   *
   * `undefined` is a server: no REQ is sent there (A12), so a connection buys
   * nothing and the provider does not make one. The derivation is unaffected —
   * every name still comes from {@link TransportKeys}, which asks *probe*
   * clients that open no socket and are disposed in a `finally` — so a relay
   * list is refused on a server for exactly the reasons it is refused in a
   * browser. What is skipped is the write-through, because there is nothing to
   * write to and nothing to route.
   *
   * Not optional, and that is not a formality: a caller who has a transport and
   * forgets to hand it over would get a scope that silently never routes, so
   * the argument is required and the absence has to be written down.
   */
  rxNostr: RxNostr | undefined,
  initial: readonly RelayInput[],
  transportKeys: TransportKeys = probeTransportKeys
): {
  readonly current: RelayScope;
  setRelays(entries: readonly RelayInput[]): void;
  /** Whether the client has been changed behind the scope's back. */
  hasDrifted(): boolean;
} {
  const write = (next: RelayScope) => {
    // Nothing to write to on a server. Note where the return is: *after* every
    // check, so the generation a server accepts is the same generation a
    // browser accepts and a list either side refuses is refused by both.
    if (rxNostr === undefined) return;
    rxNostr.setDefaultRelays(next.relays.map((relay) => ({ ...relay })));
  };
  /**
   * A whole generation, derived from the transport and then checked as a set.
   *
   * **The order is the decision.** Raw caller entries → the transport's one-pass
   * name for each of them → the transport's stability check on each of those →
   * the immutable scope, with duplicates and capability conflicts settled over
   * the *transport's* names → the set probe. Nothing this library computed
   * enters at any step, which is what makes an accepted scope a consequence of
   * the transport a consumer resolved rather than an agreement between two
   * copies that happened to hold. `TD1`-`TD4` are the arms.
   *
   * **What stood here was the same shape with the first step missing**, and the
   * miss is not a detail: the names came from `canonicalUrl`, and the seam was
   * shown *those*. A transport that renames the caller's URL and leaves our
   * name alone was therefore in full agreement with us about a relay the caller
   * never wrote.
   *
   * **Ordered so that a refusal cannot half-apply.** All of the above happens
   * before the live client is written to and before the `$state` moves. A check
   * placed after `write` would still throw, and would still be too late:
   * `setDefaultRelays` has already changed where every in-flight request is
   * routed, so a `throw` from below it is a fail-*open* dressed as fail-closed.
   * That ordering is what `CX11`, `CX13` and `TD7` observe rather than assume.
   *
   * The whole configured list is probed as a set, readable and write-only
   * alike. The reason is that a write-only relay is still a relay this library
   * names: `packet.from` attributes a `NOTICE` from one, and the diagnostics
   * map lists it — which is what `RD7` measures. **`RD7` does not measure this
   * comparison**, and nothing does: probing only the readable half leaves the
   * suite green, so the inclusion rests on the argument above rather than on a
   * witness.
   */
  const named = (entries: readonly RelayInput[]): RelayScope =>
    scopeOf(entries, (url) => acceptedRelayName(transportKeys, url));
  const probedAsASet = (next: RelayScope): RelayScope => {
    // What the transport is asked: the scope's names, which are its own answers.
    const expected = next.relays.map((relay) => relay.url);
    // What a refusal names: the strings the consumer typed. **Not the same
    // list** — with a transport that renames, `expected` holds URLs that are
    // nowhere in their source, and publishing those is the defect `B-α-C18`
    // records for the stability pass, reached here through the set instead.
    // Deduplicated, first spelling first: a caller who lists one relay twice
    // has one relay to look at, and `urls` holding it twice is the shape
    // `TransportKeyMismatchError`'s own comment refuses.
    //
    // **Taken from the scope rather than by reading the caller's list again.**
    // This used to re-read `entry.url` off the entries — a second read of a
    // value the entrance had already checked — and a caller's entry is an
    // object whose getter may answer differently each time. Measured: an entry
    // answering `'ws://a.example'` first and `undefined` second made the
    // destructuring below see nothing to name, **the whole set probe was
    // skipped**, and a pair of names one relay to the transport was accepted —
    // which is the "a relay that answered is reported as having timed out"
    // failure `B-α-C16` exists to refuse. A second answer of `Symbol()` left a
    // raw `TypeError` out of the refusal's own message builder.
    //
    // `next.configuredUrls` is the spellings as the entrance read them, frozen
    // at construction: read once, checked once, and no path from here back to
    // the caller's object. The descriptor boundary had this rule already
    // (`B4-C7`, "each field is read once"); the relay list is the surface it
    // was never swept to.
    const [first, ...rest] = Object.values(next.configuredUrls)
      .flat()
      // `indexOf` rather than a `Set`, which `svelte/prefer-svelte-reactivity`
      // refuses inside a `.svelte.ts` — the value is a list this function
      // returns, not state, and the relay count is single digits.
      .filter((url, at, all) => all.indexOf(url) === at);
    // **A scope with no relays asks nothing.** There is no set to be renamed,
    // and asking anyway is how a throwing adapter produced a refusal whose
    // `urls` was `['']` — a string that is not a URL, published in the field
    // 0004 says holds relays. The destructuring above is what carries that to
    // the type: below this line there is a relay to name.
    if (first === undefined) return next;
    const wrote: readonly [string, ...string[]] = [first, ...rest];
    // Wrapped for the reason the per-relay call is: an adapter that throws is the
    // same remedy and must not leave as its own error. **The repair that wrapped
    // the other call said it had done both**, and this one stood untouched — the
    // arm that measured it only had adapters that throw unconditionally, so they
    // were caught one call earlier and this line was never reached.
    let actual;
    try {
      actual = transportKeys(expected);
    } catch (thrown) {
      throw ownedByLibrary(
        new TransportIncompatibleError(wrote, expected, saidBy(thrown, String), 'threw')
      );
    }
    // **And the shape of what it answered, which this path trusted while the
    // per-relay one did not.** `sameNames` reads `.length` and iterates, so a
    // `null` or a non-iterable left a raw `TypeError` out of scope construction
    // past the published class, and a string or a bigint array reached
    // `TransportKeyMismatchError.actual` — typed `readonly string[]` — holding
    // neither. Measured, both, at the set seam only: the per-relay checks are
    // one call earlier and an adapter can answer differently to the two
    // questions.
    // `Array.from` before the check, because **`some` skips holes**: a sparse
    // array is an `Array`, and `[ 'wss://a.example', <1 empty item> ]` walked
    // straight past this into `TransportKeyMismatchError.actual`, which is
    // typed `readonly string[]` and rendered the hole as `null` — the exact
    // collapse `describeValue` exists to stop. `Array.from` fills holes with
    // `undefined`, which the first clause below then refuses.
    if (
      !Array.isArray(actual) ||
      Array.from(actual).some((name) => typeof name !== 'string' || !isRelayUrl(name))
    ) {
      throw ownedByLibrary(new TransportIncompatibleError(wrote, expected, actual));
    }
    if (!sameNames(expected, actual))
      throw ownedByLibrary(new TransportKeyMismatchError({ wrote, expected, actual }));
    return next;
  };
  // Named rather than read back out of `scope`, which is what the Svelte
  // compiler's `state_referenced_locally` was pointing at: `write(scope)` reads
  // a rune once, at construction, and looks from the outside like a reactive
  // read that has lost its closure. The value is wanted, not the cell, and
  // there is exactly one moment at which the two are the same thing.
  const initialScope = probedAsASet(named(initial));
  let scope = $state<RelayScope>(initialScope);
  write(initialScope);

  return {
    get current() {
      return scope;
    },
    hasDrifted() {
      // A scope with no transport cannot have been changed behind its back:
      // drift is the client's relay list disagreeing with the scope's, and
      // there is no client. Not "we could not tell" — there is nothing that
      // could have done it, since the object a caller would have to hold does
      // not exist.
      if (rxNostr === undefined) return false;
      // Encoded the same way the identity is, rather than by a second
      // spelling of it: the two were `join(',')` here and there, and a change
      // to one would have made every scope look drifted.
      const actual = Object.values(rxNostr.getDefaultRelays())
        .filter((relay) => relay.read)
        .map((relay) => relay.url)
        .sort();
      return identityOf(actual) !== scope.id;
    },
    setRelays(entries: readonly RelayInput[]) {
      // **The names are settled before the early return, and that is a cost
      // change worth stating rather than a reordering.** The comparison that
      // decides "nothing moved" is over names, and the names come from the
      // transport now — so a `setRelays` that changes nothing can no longer be
      // answered without asking it. What used to stand below the early return
      // said that a no-op costs no client construction; it costs `2n` of them,
      // and the set probe is what the early return still saves. Measured, on
      // the default probe: 0.07ms per call for one relay and 1.14ms for twenty.
      // The alternative is to answer "did anything move" from a local
      // transcription, which is the oracle this round removed.
      const next = named(entries);
      // Same readable set, same scope: re-setting it would churn every request
      // keyed on it for no change in what can be asked. B-ζ measured that cost.
      // Note this compares the *identity*, so flipping a relay from write-only
      // to readable is a change and flipping one the other way is too.
      if (next.id === scope.id && sameConfig(next, scope)) {
        // **Same relays, different spellings — the diagnostics still move.**
        // Nothing routed or keyed changes here: the transport's names, the
        // capabilities and the identity are all what they were, so no request
        // is re-keyed and nothing refetches. What did change is what the
        // consumer wrote, and `RelayDiagnostic.configuredUrls` is the field
        // that publishes it — a consumer who edits `wss://a.example` to
        // `wss://a.example/` would otherwise go on being told they configured
        // the old spelling for as long as the provider lives.
        if (!sameAliases(next, scope)) scope = next;
        return;
      }
      // After the early return, deliberately: a generation nothing publishes
      // has nothing for the set probe to protect, and the live one already
      // passed it. Every generation that *is* published has been through this.
      write(probedAsASet(next));
      scope = next;
    }
  };
}

/** The spellings each relay was written as, compared as the published lists. */
function sameAliases(a: RelayScope, b: RelayScope): boolean {
  const names = Object.keys(a.configuredUrls);
  if (names.length !== Object.keys(b.configuredUrls).length) return false;
  return names.every((name) => {
    const mine = a.configuredUrls[name] ?? [];
    const theirs = b.configuredUrls[name] ?? [];
    return mine.length === theirs.length && mine.every((url, at) => url === theirs[at]);
  });
}

function sameConfig(a: RelayScope, b: RelayScope): boolean {
  if (a.relays.length !== b.relays.length) return false;
  return a.relays.every((relay, index) => {
    const other = b.relays[index];
    return (
      other !== undefined &&
      relay.url === other.url &&
      relay.read === other.read &&
      relay.write === other.write
    );
  });
}
