/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * C8: what is in each published entry point.
 *
 * The decision said "freeze the public subpath surface in v1" and named no
 * symbols, which makes it an intention rather than a decision — nothing about
 * it can be wrong, so nothing about it can be reviewed. These are the lists.
 *
 * They are data rather than a barrel file because the spike does not ship: the
 * point is that the surface can be *checked* — against what the modules
 * actually export, against what today's entry point exports, and against C8's
 * prohibition — before anything is published under it. A barrel would assert
 * the same thing and could not be compared with what it replaces.
 */

/**
 * `nosvelte` — the high-level entry.
 *
 * The rule for membership: a symbol belongs here if using it correctly requires
 * no knowledge the library has not already decided. Lifetime, acceptance, cache
 * identity and the slot mapping are all handled behind these; a caller who only
 * ever imports from here cannot open a subscription that outlives its consumer,
 * because there is nothing here that opens one directly.
 */
export const MAIN_SURFACE = {
  /** C7 decides how these are generated; C8 only decides that they are here. */
  components: [
    'Article',
    'Contacts',
    'Event',
    'EventList',
    'Metadata',
    'Mute',
    'NostrApp',
    'Pin',
    'RelayListMetadata',
    'Text',
    'UniqueEventList',
    'UserReactionList'
  ],
  /** The request surface, and the two axes that are not the request. */
  hooks: ['useReq', 'useRelayDiagnostics', 'useSend'],
  /**
   * Types a consumer needs to *name* what the hooks return.
   *
   * A value's type is part of the contract whether or not it is exported: a
   * consumer writing a function that takes a `ReqHandle` needs the name, and
   * without it they write `ReturnType<typeof useReq>`, which pins them to more
   * than the contract promises.
   *
   * `CachedEventSet` is deliberately absent, and no published type reaches it.
   * It is what an accumulator builds, and publishing its shape freezes it for
   * every accumulator — which is the one thing A11 says can be swapped. What a
   * consumer holds is `ReqState.events`, a list of protocol events, which is a
   * far smaller promise than the structure they were assembled in.
   */
  types: [
    'ReqDescriptor',
    // What `useReq` takes: a request, or the fact that the consumer is not
    // asking yet. A union rather than a field on the descriptor, so "deferred
    // with filters" cannot be written.
    'ReqPlan',
    'ReqState',
    'ReqHandle',
    'RefreshOutcome',
    'ReqDiagnostics',
    'QueryActivity',
    'Slot',
    'Completion',
    'IncompleteCause',
    // Both added by `LK10`, which walks the published types instead of reading
    // this list. `IncompleteCauses` — the non-empty list, not the member — is
    // named by `ReqState`, `RefreshOutcome`, `Completion` and
    // `IncompleteResultError`, and was exported by nothing, so a consumer
    // holding one of those could not write down what it holds.
    // `RelayConnection` is the library's own name for the socket states;
    // `RelayDiagnostic.connection` was rx-nostr's `ConnectionState` until then.
    'IncompleteCauses',
    'RelayConnection',
    // The event a hook publishes: eight fields this library writes out itself,
    // immutable to the depth a consumer can reach, because what they hold is
    // this library's own frozen copy of the wire's object rather than the
    // object itself.
    'ReqEvent',
    // The bounded text of `Refusal.notice` and `RelayDiagnostic.lastNotice`.
    'RelayMessage',
    'Retention',
    'IncompleteResultError',
    'LegEnd',
    'LegName',
    'Refusal',
    'RefusalReason',
    'RelayConfig',
    'RelayInput',
    'RelayDiagnostic',
    'RelayDiagnostics',
    'RelayRefusalDiagnostic',
    // The refusal a relay list can be answered with, and its discriminant.
    // One class rather than the five it is the base of: a consumer's answer
    // differs by cause, so the cause has to be readable, and publishing the
    // subclasses would tie the surface to how the boundary is split today.
    'RelayConfigurationError',
    'RelayConfigurationErrorCode',
    // **Thrown by `useRelayDiagnostics` with no provider above it**, and off
    // this list until a reviewer named the state as incoherent: the class was
    // thrown, asserted by name in the suite, and promised nowhere. A consumer
    // who has to recognise it is a consumer this surface owes a name.
    'MissingProviderError',
    // The other Error a consumer can only meet at construction: no
    // cryptographic randomness, so no owner for an attempt id.
    'MissingRandomnessError',
    // The failure channel's own value: a copy of what was thrown, with the
    // boundary it arrived at and a stable code. A consumer naming it is a
    // consumer branching on `code` rather than on `instanceof`.
    // **The failure channel, published as a shape rather than as a class**, and
    // as the **aliases the published fields are declared with** rather than as
    // every variant. `ReqFailure` the class is gone because a published
    // constructor is a second name for a value it cannot mint; the variant
    // interfaces, both base interfaces, the captured and rejection aliases and
    // the two door unions are gone because a consumer writes
    // `Extract<ReqError, { code: … }>` for any part of the union and
    // `Pick<ReqError, …>` for the common part — and a published name is a SemVer
    // surface that cannot be taken back.
    'ReqError',
    'ReqErrorCode',
    'ReqStateError',
    'IncompleteError',
    'RefreshOutcomeError',
    'ReqOutletError',
    'ReqLastError',
    'RelayLegError',
    'EventTemplate',
    'NostrSigner',
    'Send',
    'SendInput',
    'SendOptions',
    'SendRefusalCode',
    'SendRelayOutcome',
    'SendResult'
  ],
  /**
   * Values on this surface that are not components, hooks or classes.
   *
   * **Empty, and it stays a group.** It held `isReqError`, a recognition guard
   * for `catch (value: unknown)` — removed because a guard and a union are two
   * hand-written descriptions of one shape and the guard was wrong three times.
   * The group is kept so that the checks which iterate the surface keep reading
   * a complete manifest, and so a future parser has a place that is not "the
   * types".
   */
  guards: [] as readonly string[]
} as const;

/**
 * The low-level entry, withdrawn.
 *
 * The first version of this list published the cache value, the leg record and
 * the functions that build them. "Outside the high-level guarantees" does not
 * make that safe: an export is an API whatever the documentation says. So it
 * was cut down to one symbol that deals in the dependency's types instead of
 * ours — and then to none, because the reasons compound (0004 C9): no consumer
 * of the argument it replaced was found, `unstable` in a subpath is a hope
 * rather than a mechanism, handing back an `RxNostr` publishes the connection
 * the provider owns, and a stream entry needs its own decisions about lifetime,
 * abort, relay scope, server rendering and completion that no record makes.
 *
 * Kept as an empty list rather than deleted, so that the checks which read it
 * keep running and a symbol reappearing here has to be a decision rather than
 * an import.
 */
export const CORE_SURFACE = {
  stream: [] as readonly string[]
} as const;

/**
 * What must not appear in either entry.
 *
 * C8 makes the query library an implementation detail, and an entry point is
 * where that claim is either true or false. Today's entry re-exports
 * `QueryClient` and `QueryKey` directly, so the claim is currently false — which
 * is a fact about the surface rather than about the internals, and no amount of
 * care inside the wrapper changes it.
 */
export const FORBIDDEN_EXPORTS = ['QueryClient', 'QueryClientConfig', 'QueryKey'] as const;

/**
 * Internal representation that must not be published from either entry.
 *
 * The reason is A11 rather than tidiness. Its escape route is one seam — the
 * accumulation — with `experimental_streamedQuery` on one side of it and stable
 * `setQueryData`/`getQueryData` on the other. It is not a route out of the query
 * library; leaving that would need a second cache implementation and is a
 * different record. The swap stays an internal-implementation swap only while
 * nothing accumulator- or helper-specific is published: an exported accumulator,
 * an exported way to build one, or an exported type that names what one builds
 * makes taking the fallback breaking for consumers, so publishing these is the
 * same act as withdrawing the escape route. `SUR10` is the check, and 0001's
 * backward derivation is where the condition is argued.
 */
export const INTERNAL_ONLY = [
  'CachedEventSet',
  // The backward leg's end, which is the per-relay table's answer reduced. It
  // stays inside for the same reason the accumulator does: it is the shape the
  // engine's machine produces, and `LegEnd` — which a consumer does need, to
  // name what `diagnostics.legEnded` holds — is a different and much smaller
  // promise.
  'BacklogEnd',
  'beginAttempt',
  'endBacklog',
  'endForward',
  'addRefusal',
  'foldEvent',
  // The retention rule, which left `foldEvent` when the bound had to start
  // judging expiry. It is the same claim as the accumulator's: an engine that
  // keeps a different set is a breaking change the moment a consumer can call
  // this. Adding it here rather than leaving it off the list is the sweep the
  // move requires — the name changed, the reason did not.
  'retainNewest',
  // **The three that were exported and unlisted**, found by enumerating the
  // writers into a cache entry rather than by reading this list: `noteFailure`
  // is the seventh writer beside the six above, `collect` is their composition
  // — publishing it publishes all of them at once — and `entryKeyOf` decides
  // which entry a request is, which is `canonicalKey`'s promise one level up.
  // `SUR10` only checks that *listed* names are absent, so a writer nobody
  // listed was a name the check could not report.
  'noteFailure',
  'collect',
  'entryKeyOf',
  'canonicalKey',
  'normalizeDescriptor',
  // **The eight that were held by one check.** Every promise of the form "this
  // is not exported" rested on `LK7`'s equality between the entry and the
  // manifest: a name absent from the manifest is absent from the entry, and
  // nothing else would notice a new export. Listing them here gives `LK2` the
  // same question from the other side — the name must not appear in the
  // *published declarations* at all, transitively — so the two checks fail
  // independently rather than in a chain.
  //
  // Measured before adding them: none of the eight appears in the published
  // declarations today. The probe that said two of them did was reading the
  // emitted `.d.ts` with its comments intact, where `{@link EngineRequest}` in
  // a docblock looks exactly like a type reference; `emitDeclarationsOnce`
  // strips comments for precisely that reason, which is a defect the
  // instrument had already solved and a throwaway reader reintroduced.
  'createRelayScope',
  'RelayScope',
  'NostrContext',
  'EventVerifier',
  'isReqError',
  'RefreshRejection',
  'TransportKeys',
  'OwnedTransport',
  // The class a consumer under a provider cannot reach, because the provider is
  // what supplies the verifier: `0004` says it is not exported and the sentence
  // named no check, which is how it got onto this list.
  'MissingVerifierError'
] as const;
