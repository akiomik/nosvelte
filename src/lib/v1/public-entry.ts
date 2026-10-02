/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What `nosvelte` would publish, as a module rather than as a list of names.
 *
 * The surface list is a hand-written array of strings, and a hand-written list
 * cannot see what a type drags in behind it. A published `ReqState` whose events
 * were the dependency's packet type would satisfy every check on that list while
 * making the dependency's representation part of this API.
 *
 * So the surface is also a module, and what it emits is inspected. This is the
 * spike's stand-in for the real entry point: the components and the provider are
 * not here because they do not exist yet, and everything that does is exported
 * exactly as 0004 lists it.
 */

import type Nostr from 'nostr-typedef';

import type { Retention } from './normalize.js';

/**
 * What a consumer describes a request with.
 *
 * Not the engine's descriptor. That one carries a client, a request-id base and
 * an environment, because the engine is called directly in this spike; in the
 * published API the provider owns all three, so none of them is a caller's to
 * supply. Writing the published shape here rather than re-exporting the
 * internal one is what keeps that difference visible — and what stops the
 * dependency's client type from being reachable through it.
 */
export interface ReqDescriptor {
  filters: Nostr.Filter[];
  live?: boolean;
  /** Partitions the cache. It can only split, never merge. */
  namespace?: string;
  settleTimeoutMs?: number;
  retain?: Retention;
  /**
   * Where this request is asked, as a subset of what the provider reads from.
   *
   * Absent means the provider's whole readable set; `[]` means nowhere, asked
   * on purpose. A relay this provider cannot read from is a typed refusal
   * before the wire rather than a request that quietly goes to the rest.
   *
   * It is the relay axis of the cache key, replacing the provider's generation
   * rather than joining it — so a request that names its own relays is not
   * re-keyed when a relay outside that set joins or leaves the provider.
   */
  relays?: readonly string[];
}

/**
 * What a consumer hands `useReq`: a request, or the fact that they are not
 * asking yet.
 *
 * **A union rather than a field on the descriptor**, and the difference is what
 * cannot be written: a deferred plan carries no descriptor, so "not asking, with
 * these filters" has no representation, and there is no ordering question about
 * validating a descriptor nobody is asking with.
 *
 * The commonest dependent query on Nostr — resolve a NIP-05 or an npub, then
 * load the profile — has a waiting state, and both obvious encodings of it in a
 * descriptor (`filters: []`, `authors: []`) are genuine empty-set *questions*
 * this library answers with "nothing matches". Those stay what they are. This is
 * the other thing.
 *
 * A deferred plan builds no key for the question it would have asked, no
 * attempt and no REQ; it reports `loading` with `activity: 'idle'`; `refresh()`
 * resolves `{ kind: 'not-started', reason: 'deferred' }`. Becoming a request
 * applies the ordinary mount triggers; going back releases the observer without
 * deleting the entry.
 */
export type ReqPlan = { kind: 'deferred' } | { kind: 'request'; descriptor: ReqDescriptor };

export type {
  RelayConnection,
  RelayDiagnostic,
  RelayDiagnostics,
  // Named by `RelayDiagnostic.lastRefusal`, so a consumer who reads that field
  // needs the name — which is `LK10`'s rule, and it caught this omission.
  RelayRefusalDiagnostic
} from './diagnostics.svelte.js';
export { useRelayDiagnostics } from './diagnostics.svelte.js';
export type {
  QueryActivity,
  RefreshOutcome,
  ReqDiagnostics,
  ReqHandle,
  ReqState,
  Slot
} from './engine.js';
export { IncompleteResultError } from './engine.js';
// **Thrown by `useRelayDiagnostics` when there is no provider above it**, and
// published for the reason a reviewer gave: it was already being recognised —
// thrown, asserted by name, argued about in `0004` — while the surface promised
// nothing. It carries `code: 'missing-provider'` beside the class — the same
// literal the request channel publishes, since a request with no provider
// refuses with this class — because `instanceof` cannot survive a duplicate
// install of this package and a string comparison can.
export { MissingProviderError } from './context.svelte.js';
// **Thrown where the registry is built, on a runtime with no CSPRNG.** The
// fallback that used to stand there — three `Math.random()` draws — kept the
// character width and lost the property the token exists for, so it is deleted
// and this is what a consumer gets instead. Published for the same reason as
// the class above, and carrying `code: 'missing-randomness'`.
export { MissingRandomnessError } from './attempt.js';
// **The classes above are construction-time errors, and one of them is on the
// request failure channel as well.** A consumer meets them before a request
// exists — no provider, and no randomness — and catches them by class. But
// `'missing-provider'` **is** a `ReqErrorCode`: a request mounted with no
// provider above it refuses on its own channel with this very class, because a
// throw out of a component is the shape this design removes and the remedy is
// the same one. `'missing-randomness'` is not on the channel and no request
// publishes it. This comment said neither was, for a commit after the code
// landed. What a *request's* failure is comes below, as a type rather
// than as a class.
//
// **The list said "no verifier" as well, and that class is not exported.** A
// request built without a signature verifier is refused by
// `MissingVerifierError`, which stays internal: a consumer under a provider
// cannot reach it — the provider supplies the verifier — and the only way to it
// is the spike's low-level seam, which this entry does not publish and which `A16` decides v1 does not keep. A published name is
// a SemVer surface that cannot be taken back, so it is not published for the
// sake of a sentence.
//
// This comment used to say `state.error` carries "one of the classes above or a
// `ReqFailure`", which was true of a design two rounds ago: the channel is a
// structural union now and the class is not exported.
export type {
  Completion,
  IncompleteCause,
  IncompleteCauses,
  LegEnd,
  LegName,
  Refusal
} from './eventset.js';
// **The failure channel, as a type a consumer branches on without
// `instanceof`.** `ReqError` is a structural discriminated union: every variant
// carries a literal `code`, so `switch (state.error.code)` narrows with no class
// in sight. That is why `code` exists — a duplicate install hands a consumer an
// object whose prototype is not the one their `instanceof` names — and for a
// round the channel was typed `Error`, which made `state.error.code` a
// compile error and `code`'s only type-safe route `instanceof ReqFailure`,
// through the very mechanism it was introduced to replace.
//
// The class is **not** exported. What a consumer names is the shape; what this
// library publishes is decided by who made the object, and a public constructor
// is a second name for a value it can never mint.
//
// **Eight names, and there were twenty.** Every variant interface, both base
// interfaces, the captured alias, the rejection alias, the two door unions and a
// recognition guard were published, and none of them is a name a consumer needs:
// a published name is a SemVer surface that cannot be removed,
// `Extract<ReqError, { code: … }>` writes down any part of the union without one,
// `Pick<ReqError, 'name' | 'message' | 'stack' | 'cause'>` writes down the common
// part, and the guard was a second hand-written description of a shape the union
// already gives. What is here is `ReqError`, the code union, and the alias each
// published field is actually declared with — because those are the names a
// consumer writes when they hold what a field hands them.
export type {
  IncompleteError,
  RefreshOutcomeError,
  RelayLegError,
  ReqError,
  ReqErrorCode,
  ReqLastError,
  ReqOutletError,
  ReqStateError
} from './reqerror.js';
// **The event a hook publishes, which is not the wire's object.** Eight fields
// this library writes out itself — not `Nostr.Event` narrowed, which would
// publish whatever the dependency adds next — immutable to the depth a consumer
// can reach. What they hold is this library's own frozen copy, so a write to it
// cannot reach the cache, another hook, or a later projection. `0004` records
// the rule; `event.ts` records what is copied.
export type { ReqEvent } from './event.js';
// What a relay said, as much of it as this library keeps — published because
// `Refusal.notice` and `RelayDiagnostic.lastNotice` are it, and a consumer
// rendering either has to be able to name what they hold. The bound is on the
// type rather than applied silently: a cut string presented as the whole thing
// is a diagnostics value that lies.
export type { RelayMessage } from './normalize.js';
export type { Retention } from './normalize.js';
export type { RefusalReason } from './refusal.js';
// `createRelayScope` and `RelayScope` are deliberately absent (0004): the first
// takes the connection as its first argument, which is exactly what C6 says a
// consumer never holds, and the second is the type it returns. The relay set
// reaches the library as `NostrApp`'s `relays` prop, which is data.
//
// **`RelayConfigurationError` is here and its five subclasses are not**, which
// is C16 and not an omission. A refused relay list is thrown at the provider's
// first construction, so a consumer needs a type to catch it by; what they need
// to *tell apart* is why, and `code` is that — five exported classes would
// publish this file's internal division of the checks and make moving a check
// between them a breaking change.
export type { RelayConfig, RelayConfigurationErrorCode, RelayInput } from './scope.svelte.js';
export { RelayConfigurationError } from './scope.svelte.js';
// **Posting, without the connection** (ruling 17). The provider owns the
// transport and nothing here returns it (`C6-C11`); what a consumer gets is an
// operation bound to the provider, whose answer is a value describing what each
// relay did. `NostrSigner` is this library's own name for the NIP-07 shape, so
// the dependency's signer type is not part of the surface.
export type {
  EventTemplate,
  NostrSigner,
  Send,
  SendInput,
  SendOptions,
  SendRefusalCode,
  SendRelayOutcome,
  SendResult
} from './send.svelte.js';
export { useSend } from './send.svelte.js';
