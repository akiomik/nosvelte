---
status: accepted
date: 2026-10-02
decision-makers: akiomik
consulted:
  redesign review rounds 1-30, the r7 review of rounds 31-32, and the external reviews of r33 and
  r34
informed: nosvelte users
---

# What consumers see

## Context and Problem Statement

The published surface is nineteen `use*` stores, twelve components, and three arguments that hand
the library's responsibilities to the caller: a request object that owns the subscription, a cache
key that decides identity, and an operator that transforms events in flight.

The components each carry a hand-written mapping from state to what they render. There are eleven
copies of it, all of them written the same wrong way: they test the error first, so a background
refresh that fails over a list someone is reading replaces the list with an error. **That was
asserted eleven times and witnessed nowhere until this round** — every error arm in
`src/tests/components/` fed an empty answer alongside the error, so reversing the two branches left
all of them green (an external reviewer measured it). One arm holds it now, on `Metadata`: data
_and_ an error, rendering the error slot, which fails the moment the branches are swapped. The other
ten are read from their source and are not witnessed, which is the honest state of a claim about
code this record exists to replace. None of them can express a request that has started and produced
nothing yet.

And the whole thing hangs off a module-level store — the connection is one per process, which is the
wrong number for server rendering, for tests, and for a page with two providers. **The cache is not,
and this said "one connection and one cache per process".** Its own closing example is what refutes
the second half: `NostrApp` constructs a `QueryClient` per instance and provides it through context,
so a page with two providers already has two caches and one connection. That split is the defect
rather than a mitigation of it — the two things a consumer would expect to share a lifetime do not,
and the one that is process-wide is the one holding the sockets. `0001` carries the narrow form,
which is about the client alone.

## Decision Drivers

- **The library must not claim more than it knows.** "Nothing found" is a claim about the world.
- **A component should not be deciding library semantics**, eleven times, in eleven files.
- **An export is an API** whatever the documentation says about it.

## Considered Options

- **Keep the surface, fix the internals.**
- **Replace the surface, provide a compatibility layer** for the removed arguments.
- **Replace the surface with one clean break**, and give the removed extension point a low-level
  entry.
- **Replace the surface with one clean break, and publish nothing in its place** for the removed
  extension point.

## Decision Outcome

Chosen: **replace the surface with one clean break, and publish nothing in its place** for the
removed extension point, because a compatibility layer for the removed arguments either reproduces
the defects they cause or silently changes what they mean, and because **no consumer of the removed
extension point is known to us**. That is weaker than the sentence this replaced, which said
"measured, none of the five dependent projects": there is no record naming those five, no artefact
of the survey, and the one tool in the neighbourhood — `tools/measure-break-surface.mjs`, which does
not survive this branch — says in its own header that it reads this repository's demos and README,
and has no pattern for `operator` at all. The reasoning stands on the compatibility-layer argument,
which is self-contained; the survey is a reason to believe the cost is small, and it is stated at
the strength it can be re-run at.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                           | Falsified if                                                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | The component layer stays, with the same four outlets, expressed as snippets — and **every one of the four is handed the request**, so a component consumer reaches the same state, activity, diagnostics and `refresh()` a `useReq` consumer does                                                                                                                                                                                                 | an outlet disappears, or a fifth is added, or a component is renamed, or a fact this design publishes is reachable from `useReq` and not from an outlet                                         |
| C2  | No compatibility layer                                                                                                                                                                                                                                                                                                                                                                                                                             | one could be written that neither reproduces a defect nor changes behaviour                                                                                                                     |
| C3  | `req`, `queryKey` and `operator` are removed, with nothing published in place of `operator`; **what `req` was reached for that a descriptor could not say — asking a particular relay — is a descriptor field**, resolved inside the universe the provider accepted                                                                                                                                                                                | a use case for `req` or `queryKey` survives that the descriptor does not cover, or a consumer of `operator` is found, or a relay target a consumer names is asked outside the accepted universe |
| C4a | Primary state and activity are separate                                                                                                                                                                                                                                                                                                                                                                                                            | "settled, and a refresh is running" cannot be expressed                                                                                                                                         |
| C4b | Diagnostics are a third axis, split per request and per relay — and a relay-level **failure** is summarised on the relay's own row (its last observed refusal) as well as attributed to the request that saw it                                                                                                                                                                                                                                    | a relay-level fact can **only** be reached through a request, or a panel that mounts after a refusal cannot see that it happened                                                                |
| C-δ | Relay-level diagnostics are a complete map of the scope's relays for as long as the provider stands, held as a value, replacing `useConnections`                                                                                                                                                                                                                                                                                                   | a consumer can hold a partial map, has to subscribe to read one, or is shown a relay their scope does not name                                                                                  |
| C5  | A failure over data already shown does not clear it, and the axis it moves to is reachable from **every** published surface rather than from `useReq` alone                                                                                                                                                                                                                                                                                        | a failed background refresh empties the list, or a component consumer cannot reach the failure it was moved to                                                                                  |
| C6  | The provider owns one **resource domain** — one connection pool, one cache, one clock, one diagnostics map — and its `relays` prop defines the accepted readable universe rather than one identity's relay list; a request selects an effective subset of that universe (`C3`), sockets for a common relay are shared **inside** a provider, and **owns a live connection only where one can be used**: in the browser. On the server it owns none | two providers on one page share anything, or one provider cannot serve two identities whose relay sets differ, or a server render leaves a transport resource alive after it returns            |
| C7  | Components are one implementation, not eleven                                                                                                                                                                                                                                                                                                                                                                                                      | two components disagree about how a kind is handled                                                                                                                                             |
| C8  | One entry in v1                                                                                                                                                                                                                                                                                                                                                                                                                                    | the internal representation appears in it                                                                                                                                                       |
| C9  | No public low-level entry in v1                                                                                                                                                                                                                                                                                                                                                                                                                    | a consumer needs one to do something v1 claims to support                                                                                                                                       |
| C11 | `refresh()` re-synchronises the backlog and resolves on that attempt's outcome                                                                                                                                                                                                                                                                                                                                                                     | its Promise means different things for live, stopped and non-live requests, or two callers who overlap on one request are told different things                                                 |
| C12 | "Nothing found" requires evidence that nothing exists, and keeps it                                                                                                                                                                                                                                                                                                                                                                                | it is shown after a timeout, a refusal, a request never sent, or an answer hiding entries it holds, or withheld from one that completed because a later attempt failed                          |
| C13 | The read model excludes events that have expired, at their expiry                                                                                                                                                                                                                                                                                                                                                                                  | an expired event is still listed, or leaves only when something else redraws                                                                                                                    |
| C14 | Svelte `^5.25.0`, and snippets rather than legacy slots                                                                                                                                                                                                                                                                                                                                                                                            | the published range admits a version the engine cannot run on                                                                                                                                   |
| C15 | What an incomplete answer publishes — its causes and its Error — is one object each, on every surface, while it stands                                                                                                                                                                                                                                                                                                                             | reading either twice over an unchanged answer gives two objects, a later answer is handed the previous one's, or two surfaces publish equal but distinct causes                                 |
| C16 | A refused relay list **never throws**: at first construction it yields an empty accepted scope with the children still mounted, and on a later change the previously accepted scope and client are kept; either way the refusal is published on the diagnostics axis. A partly valid list is refused whole                                                                                                                                         | a refused list throws, or tears down the provider's subtree, or leaves no way for a consumer to tell the first construction's refusal from a later one, or is partly accepted                   |

**There is a fifth state.** Four could not say that an answer arrived and is not the whole answer,
so the same partial fetch was reported as a success or a failure depending on how many events
happened to arrive from elsewhere — and the error it rendered had no error to render, since nothing
had failed. `incomplete` carries why: the timer ran out, a relay refused, the leg died, the verifier
answered too slowly to be waited for, or an ephemeral event was taken out of the backlog (`0003`'s
B7a) — five causes, which is what `IncompleteCause` declares, and this sentence, the first
description a reader meets, has listed three and then four of them. The slots stay at four; an
incomplete answer with something in it renders what it has, and what marks it partial travels on the
state and, when there is nothing to render, on the argument the error slot is handed — an
`IncompleteResultError` built from that state's own causes. This sentence used to end "on the state
and the diagnostics, which now report the same thing", and the diagnostics report the most recent
failure, which is the same thing only while nothing has thrown.

**C-δ's map is the scope's membership and the client's connections, and that is two answers rather
than one.** The question that went back to the review was whether the relay axis should report the
relays the consumer configured or the relays the connection actually has; it is not a choice,
because the facts have different owners. Which relays exist, what each is called, and whether it may
be read from or written to are the immutable `RelayScope` (B-α, frozen all the way down — `SC31`) —
the value every request is keyed under, and the only membership a consumer can act on. The
connection state and the last `NOTICE` are facts about a socket and can only be observed on the
client the provider owns.

**That sentence was already here while the implementation did the opposite, and the gap was a
counterexample rather than an untidiness.** The notice record and the subscription that filled it
were built inside each call of the diagnostics hook, so the value was a fact about _whoever was
watching_: one provider, one relay, one socket, and a component that called the hook before a
`NOTICE` arrived read it while a component calling after read nothing — at the same instant. A
diagnostics panel is opened _because_ a relay misbehaved, so it is mounted after the notice and was
structurally guaranteed to show nothing for it. **The record was right and the code was wrong**,
which is the direction this record is meant to be able to adjudicate.

A relay that is in the client and **not** in the scope is neither of those, and it is not merged in.
It cannot be produced through the published surface: C6 has the provider create the connection, so
the only way to add one is to hold the object C6 says a consumer never holds.

**That sentence was false for several rounds and is true again by construction rather than by
luck.** An outside reviewer produced exactly this state without holding the client: the hook
resolved its transport as the provider's and its relay scope from the caller's options alone, so a
scope naming a relay the provider never configured made the **provider's own** client open the
connection — the foreign relay received the `REQ`, the provider's connection table grew, and the
client the caller was holding stayed empty. The reading was right about the client and wrong about
how one is reached: the request path took its inputs field by field, and a field is not an owner. It
takes them as one bundle now — the owner is decided once and its transport and its scope come
together — so a provider's transport beside a caller's scope is not constructible. `RM25` drives it;
the port condition is on `C11-C17`'s row. That makes it an implementation inconsistency rather than
public state, and it gets no channel of its own — the same reading 0002 takes for `dormant`, where a
state that **should not** be reached is recorded rather than given a surface. (This said "cannot"
while 0002 had already settled on "should not" and said why: nothing in the suite drives a relay
into `dormant` with a subscription open, so "cannot" is asserted and unmeasured. The code agrees
with 0002 — `SHOULD_NOT_HAPPEN_WITH_AN_OPEN_SUBSCRIPTION`, renamed from `IMPOSSIBLE_…` — and this
record was the copy that kept the stronger word.) Internally it is observable through
`createRelayScope().hasDrifted()`, which exists for exactly that hole. **What would reopen this** is
a supported way for the relay list to move behind the scope — then drift becomes ordinary public
state, and both this and 0002's `dormant` paragraph are the decisions to revisit together.

**There is no low-level entry in v1.** An earlier version of this record published
`createEventStream` under `nosvelte/unstable-core`, as the replacement for the removed `operator`
argument and as the route to anything the cached read model cannot express. It is withdrawn, for
reasons that compound: no consumer of `operator` is known to us, so the hole it fills is one nobody
we can see is standing in — and "nobody we asked" is not "nobody", which the Consequences below
already said and this sentence used to contradict by claiming a survey; `unstable` in a subpath is a
hope rather than a mechanism, and a package export is a contract the moment it ships; handing back
an `RxNostr` or taking one as an argument publishes the connection that C6 exists to own; and a
stream entry needs its own decisions about lifetime, abort, relay scope, server rendering, refusal,
completion and backpressure, none of which this record makes. Adding an entry later is additive.
Withdrawing one is not.

The seam it stood for is kept, is internal, and is not this. 0002 A11 is about whether the
**accumulation** can be replaced — one engine, one cache, one identity, and a `queryFn` factory
swapped underneath it — and that is shown by running one suite against a second accumulator, not by
exposing anything to consumers. It works as an internal swap only while this record publishes no
accumulator- or helper-specific type, which is what `SUR10` holds. The internal `createEventStream`
that survived this withdrawal for several rounds is now deleted too: nothing in the library called
it, `CORE_SURFACE` was empty, and it passed already-expired events straight through, so repairing an
unreachable seam would have been keeping a regression alive for a caller who does not exist. When a
concrete use case appears, it can be designed as a stable `useEventStream` or as a low-level entry
with its own record.

**`refresh()` re-synchronises the backlog, and says what happened.** It used to mean three things:
for a healthy live request, nothing at all; for a stopped one, "the re-open has been started"; for a
non-live one, "the re-fetch has finished". One name, three Promise contracts, and the first of them
resolves having done nothing — which is the kind of API that reads correctly and behaves
surprisingly for years.

What it means now is one thing: start a new backward attempt, keep the events already held, and
resolve when that attempt reaches an outcome. **"That attempt" is a claim the value has to be able
to carry**, and it did not: an end recorded without saying whose let a request that had already
settled answer the next call before its own question was replied to. 0003 records the backward leg's
record and the attempt that names it, and the shape of the comparison is part of the contract rather
than an implementation detail: the call names its attempt before starting it and waits for _that_
id, because "an end newer than the one that was there" is a question two concurrent calls give the
same answer to. **The wait ends when that attempt does, and on nothing else.** It used to have a
ceiling of ten seconds as well, on the theory that an attempt still running by then had ceased to
exist — which it cannot tell from a request whose own settle timeout is thirty, or from a background
tab whose timers are throttled. So there is no second clock, and two things end the wait: the
attempt reaching an outcome, or the attempt ceasing to exist — the consumer torn down, the entry
removed, the attempt replaced by another fetch of the same request, the trigger that opened no
request. Those abort, and the call resolves rather than rejects (ruling 5); so does a provider
disposed under the call, with its own reason, and only a call made after the provider is gone
rejects. An attempt that failed is still an outcome rather than a rejection. The forward leg is
re-opened in a new generation either way, and is not part of what the Promise waits for — forward
liveness is the activity axis and the diagnostics, which report continuously and do not need a
Promise to say so.

**Removing the ceiling did not put a guarantee of termination in its place, and this record wrote
one down as though it had.** The sentence was "a running attempt always reaches an end because the
settle timeout belongs to the request, so the only way to wait forever is for the attempt to stop
existing", and 0002 denies both halves of it. A-γ's settle timer lives inside the stream the
accumulator is handed, so an invocation that never reaches that stream has no REQ, no timer and no
end — there is nothing for the timeout to belong to. What the engine guarantees is stated over an
invocation that **returned, threw or was externally cancelled**; a pending invocation whose consumer
_stays_ is bounded by nothing at all, and a `refresh()` waiting on it never settles. That is a
recorded limit of the accumulation seam rather than a hole that was closed: what speaks about the
state is `A11-P1`, a postcondition the two accumulators this library ships satisfy and the seam's
type cannot require, and not anything the engine prevents. This record now claims the engine's
guarantee and no more, because a consumer holding a `ReqHandle` cannot tell which of the two is
making the promise. **What falsifies the narrowed claim** is an attempt that returned, threw or was
cancelled and left a `refresh()` pending anyway. What does _not_ is an accumulator this library does
not ship whose invocation never returns while its consumer stays — that is `A11-P1`'s violation, and
pretending otherwise is how the withdrawn sentence got written.

**"Keep the events already held" is unconditional, and it is reached one way.** It was true on one
of two paths for several rounds: a request that had _failed_ was re-run by dropping its cache entry
and starting again, and the events live in that entry. Measured then — a live request holding one
event, refreshed after it stopped, answered `complete` with an empty list — and the record's answer
was to put the value back by hand as the entry was reset. That branch is gone (see below), so the
sentence is neither qualified nor repaired: every `refresh()` a consumer can reach re-fetches, and
`refetchMode: 'append'` folds the new attempt onto what is there. C11-C15 is the witness, and it
asserts the list mid-attempt as well as after it, because an answer that rebuilds what it dropped
looks the same at the end.

**A stopped request is not one state, and the record said it was.** "Stopped" covered two: a request
whose forward leg has ended, and one whose attempt failed. Both are re-opened by `refresh()`, and
the engine used to reach both by dropping the entry — which was described here as the price of
recovering either. **Neither needs it, and each half was measured separately rather than argued
away.** Removing the leg-ended half changed nothing any expectation can see: a leg that has ended
leaves a `success` entry holding a value, and re-fetching that re-opens both legs and folds the new
attempt onto what is there.

The failed half survived that round, and the reason it did has since been removed. It was never the
trigger — C11-S3 measures the resolved query-core re-running an entry stopped in `error` with
`refetchQueries` like any other. It was the read that followed: query-core clears a query's error
when a fetch succeeds, a live query function never settles, so a re-fetched failed request carried
the previous attempt's error for the whole life of the new one, and `refresh()` took that standing
error for its own because time order was all it had to attribute by. With the failure stamped with
its attempt and matched by id (below), no outcome is read off the entry's error at all, and the
branch has nothing left to do. Deleted, and measured the same way: the parity suite was run before
and after on both accumulators and came out **identical either way**, with P41, P47 and P48
unchanged. **That is a report of one round's run, not a size this tree still has** — the totals were
written here as a figure, and the suite has gained arms since, so what the sentence claims is the
equality of the two sides rather than the number on them. The by-hand put-back of the value went
with it — the one condition left has `data === undefined` as a conjunct, so it could only ever have
written nothing. That condition is the reset that was always its own: a `refresh()` over a fetch
that has not written anything yet, where query-core hands back the running attempt instead of
starting the one this call named.

**The failure clears when an attempt _ends_, not when one starts.** This record said the opposite,
and what makes the old reading wrong is a contradiction with the field's own name: `lastError` is
documented as the most recent failure, and a failure nothing has answered yet is still the most
recent failure there has been. Clear-on-start was load bearing only because it was the sole way to
tell whose failure was on the entry — and it can only ever hold for an entry with no value, which is
query-core's rule rather than ours (`SEN22`). So the failure is stamped with the attempt that
produced it and recorded on the cache value, a `refresh()` matches its failure by that id exactly as
it matches its answer, and the failure stays readable while the next attempt runs. **Both halves of
that hold from the query function's entry, not from the point the stream starts**, and the
difference is not cosmetic: while the id was claimed inside the stream function, a failure that
happened before the stream ran was filed under an id nobody was waiting for, and `refresh()` came
back rejected with "asked for an attempt that never began" over an attempt that had begun and
failed. 0002's A11 records why the boundary cannot sit any deeper — the accumulation seam's type
does not require the stream function to be reached at all — and `A11-C6`/`A11-C7`/ `A11-C8`/`A11-C9`
are the four failures that must answer alike. The fourth is the one that does not throw: an
invocation that _returns_ having left no attempt on the value is that attempt's failure too, written
by the same call, because entry into the query function is the boundary and an invocation that
entered ran an attempt whatever it did afterwards (0002). It is superseded by the first _later_
attempt that reaches an end, which is the moment the question has been asked again and answered —
and only by a later one, because a failure stamped with the attempt that just ended is what happened
after that answer rather than evidence against it (`B10-C6`). That puts the whole diagnostics axis
on one rule instead of two: `lastError`, `legEnded` and `refusals` are each read off the value and
each moves when the record it comes from is replaced, rather than one of them moving because a
`refresh()` said so.

**Two calls at once are one attempt.** Two `refresh()` calls on one request used to mean two
attempts, and the second cancelled the first — so of two callers who asked the same question at the
same moment, one was answered and the other was told its attempt had been superseded. That is the
honest report of what happened, and it is the wrong thing to have happened: promising a fresh
request per call fits a shared cache badly, because two consumers of one entry is what the cache is
_for_. So calls that overlap on one request share the attempt in flight, its Promise and its outcome
— the same outcome object, not two equal ones. What the later caller gives up is stated rather than
hidden: the attempt it joins may have started before it called, so what it is told is that attempt's
answer rather than one taken at the moment it asked. What it gains is that neither caller is refused
an answer because the other asked. An attempt is shareable only while its call is still waiting on
it; one that arrives after that starts its own.

**This is a property of `refresh()` and not of the cache**, and the record said the opposite until
it was reviewed. Coalescing was implemented on the engine with an entry alone, on the reasoning that
sharing is what an entry is for; the reasoning is right about the mechanism and wrong about the
promise. Which of two callers is answered, whether the other is rejected, and whether they hold the
same outcome are things a consumer can see, so an implementation that answers them differently is a
different published surface — and 0002 A11 offers exactly "the accumulation can be replaced without
changing the published surface" as the mitigation for depending on an experimental API. Coalescing
therefore lives on the attempt registry, above the seam, and both accumulators inherit it rather
than each agreeing to it.

**And the same argument closed the rest of it two rounds later.** This paragraph used to end by
saying what still differs — one cache entry however many hooks observe it on one engine, one hook's
current descriptor on the other — and that is the same sentence one level up: two components asking
the same question could tell which of two engines they were on. The second engine is deleted, and
A11's seam is the accumulation rather than the engine (0002 A11), so the one engine puts two hooks
over one identity on one entry whichever accumulator is installed, and the expectation runs against
both rather than naming one.

**Not "the forward leg is untouched when it is healthy", which is what this record said until it was
measured.** Both legs are opened by the query function, so re-running it re-opens both; keeping the
live subscription across a refresh would mean the forward leg lives outside the query, owned by
something else — which is the shape 0002 exists to remove, and is where the library's inability to
close what it opened came from. The cost is real and is stated rather than designed around: a
refresh on a live request closes its subscription and opens a new one, and an event published in
that window reaches neither. The events already held are kept, so nothing visible is lost, but a gap
in a live feed is not nothing. Closing it needs the two legs to have separate lifetimes, and that is
a change to 0002 rather than a wording change here.

**A lifetime ending is told apart by the outcome, not in a `catch`.** The two kinds of ending are
acted on differently and always have been: a consumer whose component went away wants the abort
ignored, and wants a refused descriptor or a disposed provider shown. This paragraph used to make
the abort a rejection carrying `name: 'AbortError'`, so that the two could be told apart in a
`catch`; ruling 5 moved it instead. The consumer going away, the attempt being replaced, and the
provider disposing under the call resolve `{ kind: 'cancelled' }` with a reason naming whose
lifetime ended, and what stays on the rejection — a refused descriptor, a missing provider, a call
made after the provider is gone — is what a consumer wants shown. An abort raised by something that
is not this library's still rejects, with the value it was raised with: an outcome that answered
"cancelled" for a reason it cannot recognise would swallow the one case a consumer has to see.

No class is published for the cancellation either. The discriminant is the outcome's `kind` and
`reason`, which are values a consumer already holds.

Because the outcomes differ in ways a consumer acts on, it returns them rather than resolving to
nothing. A refusal or a timeout is not an exception — the attempt happened and came back partial —
so it resolves as `incomplete` rather than rejecting. A rejected descriptor, a missing provider or a
call made after the provider is gone are failures of the call itself, and reject; an abort during
the call — including the provider disposing under it — is a lifetime ending, and resolves
`cancelled`. A request that cannot be sent at all resolves as `not-started` with the reason, because
"nothing came back" and "nothing was asked" are the distinction C12 exists to keep.

**"A disposed provider" is a browser sentence, and the order the two questions are asked in is
decided.** On the server there is no transport to dispose — C6 now says the provider owns none there
— and the release that would dispose one is an effect teardown the server never runs. So a refresh
on the server asks which side it is on **before** it asks anything about a connection, and answers
`not-started` with the reason. It was the other way round, and the answer was "the connection is
terminated, no later attempt will succeed" — which is false of a page about to hydrate. **No caller
in the spike reaches it**, because every call site still passes a client of its own — the engine
requires one in its type rather than at runtime, so an arm handing over what a server provider
actually owns walks straight into it, and one does. The published hook takes the transport from the
provider, which is the moment the last such caller disappears. `C11-C5`'s Implementation column
carries it, because it is the port that meets it first.

### The published surface

`nosvelte` — everything below, and nothing else:

```ts
NostrApp;
(Article,
  Contacts,
  Event,
  EventList,
  Metadata,
  Mute,
  Pin,
  RelayListMetadata,
  Text,
  UniqueEventList,
  UserReactionList);

(useReq, useRelayDiagnostics, useSend);

(ReqDescriptor,
  ReqPlan,
  ReqHandle,
  ReqState,
  RefreshOutcome,
  QueryActivity,
  ReqDiagnostics,
  Slot,
  Completion,
  IncompleteCause,
  IncompleteCauses,
  IncompleteResultError,
  ReqEvent,
  Retention,
  LegEnd,
  LegName,
  Refusal,
  RefusalReason,
  RelayMessage,
  RelayConfig,
  RelayInput,
  RelayConnection,
  RelayDiagnostic,
  RelayDiagnostics,
  RelayRefusalDiagnostic,
  RelayConfigurationError,
  RelayConfigurationErrorCode,
  MissingProviderError,
  MissingRandomnessError,
  ReqError,
  ReqErrorCode,
  ReqStateError,
  IncompleteError,
  RefreshOutcomeError,
  ReqOutletError,
  ReqLastError,
  RelayLegError,
  EventTemplate,
  NostrSigner,
  Send,
  SendInput,
  SendOptions,
  SendRefusalCode,
  SendRelayOutcome,
  SendResult);
```

**`IncompleteCauses` and `RelayConnection` are on that list because a check found them rather than
because this record thought of them** — named rather than pointed at by position, since the list is
ordered by nothing a sentence can rely on and "the last two" had drifted onto two other names.
`IncompleteCauses` is the non-empty list `ReqState`, `RefreshOutcome`, `Completion` and
`IncompleteResultError` are all written in terms of, and it was exported by nothing: a consumer
could hold one and not write down what they held. `RelayConnection` is this library's name for the
nine socket states — `RelayDiagnostic.connection` was typed as rx-nostr's `ConnectionState`, so the
dependency's type was on the published surface while the rule against exactly that was stated here
for `EventPacket` and enforced for `EventPacket`. The rule is now enforced by reachability (`LK10`),
which is the only form of it a list of names cannot answer.

A list of names decides what exists and not what it promises, so the signatures are part of the
decision:

```ts
// The provider creates what it owns (C6), so there is nowhere to hand it a
// query client or an rx-nostr instance. Both options default to empty: a
// provider with no relays is a valid state — it is what a page renders while
// the user's relay list is still loading — and B-γ is what makes a request
// under it report "not asked" rather than "nothing found".
// Three things are deliberately not here.
//
// The clock: A-δ makes the provider own one, and a prop for it would publish a
// lifetime the provider is supposed to hold — the same mistake as taking a
// query client. It is injectable inside the library so that expiry can be
// tested without waiting, and that seam stays internal.
//
// Which side this is rendering on: A12 turns on it, and it is detected rather
// than declared. A prop would let a caller say `'browser'` on a server, which
// is not a configuration but a way to switch A12 off — and the detection is the
// provider's for the same reason the clock is.
// **What "server" means is decided here rather than left to a `typeof window`
// in a file these records outlive**, which was the gap: no override is added,
// and the semantics are fixed. Server means *a Svelte server render, where the
// client lifecycle capability does not exist*. The transport capability is
// minted by the provider in a client-only lifecycle and is absent from an SSR
// context; a server render validates the relay scope and creates **no socket, no
// timer and no listener**. The supported hosts are the Svelte 5 DOM client and
// Svelte SSR — a Web Worker, a service worker, React Native and a Deno runtime
// are declared v1 non-goals, rather than silently taking the server branch and
// reporting every request "not asked" for ever with the escape closed by
// decision. The contract tests run against real server compiler output and
// browser hydration, not against a mocked global. It is injectable inside the
// library so the server branch can be rendered under a browser-shaped test
// runner, and that seam stays internal too. **The engine below the provider
// still takes it as an argument, and there a caller who passes one wins** —
// which is a fact about a function this record does not publish, and is worth
// naming here so that publishing that function later is understood as
// publishing this decision with it. **And a side being detected is not the same
// as the detection being reachable.** The fallback is read in three places and two of them run outside
// a component: a refresh driven from a consumer's click handler, and the
// verifier lookup on a refetch no reaction drove. Svelte's context read
// *throws* there rather than answering, so the first rejected on its opening
// statement and the second became an error outcome a consumer could not tell
// from a relay failure — on the published shape, not on a seam. It was
// measurable only after a sentinel opted out of the suite's context mock, which
// had made the question unaskable everywhere else. The provider is captured
// where the hook is built, which is a window the framework allows, and the late
// reads use what was captured.
//
// The connection's configuration: see below.
interface NostrAppProps {
  relays?: readonly RelayInput[]; // default: []
  signer?: NostrSigner; // default: none — an unsigned send is refused
  children: Snippet;
}

// **This component does not exist in the spike, and every arm that mounts a
// provider mounts one of three fixtures standing in for it.** `createNostrContext` is a
// function; the thing that applies `relays` in an effect, mounts a subtree and
// loses that subtree to a boundary throw is a test fixture. So the props above
// are a decision rather than a reading of shipped code, and the first run of any
// provider row against a real component is the port's own. `0005` records the
// size of that gap under "What this catalogue was witnessed against"; what keeps
// the *main* fixture honest meanwhile is `C16-A1`, which pins its props against
// this declaration — and only that one; the other two build a context for arms
// this declaration has no say over, and `0005` records what that leaves
// uncovered. **`NostrApp` does exist as the v1 component this rebuild
// replaces**, wired to none of this, which is the confusion this is here to
// stop. Below the declaration rather than above it, because `WR14` reads the
// paragraphs between the count and the interface as the list of what is
// deliberately not a prop — measured: put here, it was counted as a fourth.

// **The context is a discriminated union on the environment, and what that
// costs is named here because the type carrying it does not outlive the
// spike.** Splitting it makes "there is no connection on the server" something
// the compiler enforces at every call site rather than something a reader is
// trusted to remember — and it costs a consumer who wants the transport having
// to say which side they are on first, which is the question they were assuming
// an answer to. A port that publishes one optional field instead buys the
// convenience and gives up the enforcement.

// A relay list can be refused (B-α), and the refusal has to arrive somewhere a
// consumer can act on. It is not a prop: see "Refusing a relay list" below.
type RelayConfigurationErrorCode =
  // The list itself is the wrong shape: an entry that is neither a string nor a
  // config, a url that is not a `ws:`/`wss:` URL, a capability that is not a
  // boolean. One code for all of them, because they are refused at one place —
  // before the transport is asked anything — and a consumer fixes them the same
  // way. The alternative split is written here rather than left as a silence:
  // nobody could construct a consumer action that separates them.
  | 'invalid-relay-input'
  | 'conflicting-capabilities'
  | 'non-idempotent-url'
  | 'transport-key-mismatch'
  // The fifth, added by the rule below rather than in spite of it, and **named
  // for what a consumer does rather than for what went wrong**:
  //
  // - `transport-key-mismatch` — each relay has a valid, stable name of its own
  //   and the *set* changes when they are asked about together. Rewriting the
  //   relay list answers it.
  // - `transport-incompatible` — the transport does not yield exactly one
  //   usable name per relay: none, several, something that is not a string, a
  //   string that is not a relay URL, or an adapter that gives out. Asked about
  //   one relay, or about the configured list as a set — **both**, since the
  //   remedy is the same and the code is named for the remedy. No relay list
  //   answers it; pinning or upgrading rx-nostr or this library, or reporting
  //   the answer, does.
  //
  // The fault-shaped name this had first (`transport-key-not-a-name`) would have
  // needed a sixth member for the next fault with the same remedy — and there
  // are several: no name, several names, a name that is not a relay URL, an
  // adapter that throws, a version whose status map is shaped differently. Those
  // live in the message and in the unpublished subclass.
  | 'transport-incompatible';

// **A request that names a relay this provider cannot read is not a sixth code
// here**, and it was written as one before the question was asked properly.
// This union belongs to `RelayConfigurationError`, which is every way a **relay
// list** is refused — a provider-level value a consumer meets on the context.
// A bad *target* refuses a **request**, so it has to arrive on `state.error`
// and on `refresh()`'s rejection: it is `ReqError`'s `relay-not-in-scope`,
// below.

class RelayConfigurationError extends Error {
  readonly code: RelayConfigurationErrorCode;
  // **Empty for `invalid-relay-input`, and that is the field working rather
  // than failing.** The other four codes are each about relays — one the
  // transport renames, ones it collapses so that the set is no longer the one
  // that was configured, a pair whose capabilities disagree, and a transport
  // that cannot give exactly one usable name for one of them — so each has a
  // URL to name. The fourth of them names **every relay it asked about**: the
  // set probe asks about the whole list at once, and naming the first sent a
  // consumer to a relay that may have had nothing wrong with it. It follows
  // that a scope with no relays is not probed at all, since a refusal there
  // would have no relay to name; `B-α-C20` holds both halves. `invalid-relay-input` is the code for
  // an argument that is not a relay at all: a number, a string with no scheme,
  // an object with no `url`. A `urls` entry there would either be a lie (a
  // string that is not a URL, published in a field typed as URLs) or a
  // coercion, and the message already carries the offending value, which is
  // what a consumer needs to find it in their own source.
  //
  // **And it is their spelling, not a tidied one** — including surrounding
  // whitespace, which the entrance tolerates because `new URL` ignores it. So
  // a `urls` entry can be a string this library's own rule for a *transport's
  // answer* would reject: the two rules have different subjects, one judging
  // what a caller wrote and one judging a name that has to be opened as a
  // socket. Publishing the tidied version instead would name a relay the
  // consumer cannot find by searching their source, which is the one thing
  // this field is for. **Carries it rendered
  // rather than verbatim, and the difference is published**: the message is the
  // key its refused cache entry is filed under, so **the rendered value** is
  // bounded at 200 UTF-16 code units with a `… (cut)` marker. **The cut is by
  // code units and it is not at a grapheme** — this sentence said "at a
  // character rather than at a UTF-16 unit", which is the opposite of what the
  // renderer does: it trims a trailing lone high surrogate so the string stays
  // well formed and cuts nothing else, so 200 emoji are 100. And the message it
  // sits inside is bounded again, at
  // 4 096 UTF-16 code units, which is the bound 0003's `B-η` decides for
  // anything a relay chose the wording of. Two bounds, two subjects: this
  // sentence named one of them and read as if it were the whole message, and a field that is absent is named as absent instead of being
  // printed as its type. This sentence said "verbatim" until the bound went in. **The type
  // does not distinguish the two shapes** — that would be a fifth code or a
  // discriminated union, and both were rejected as publishing the boundary's
  // internal structure; what is published instead is that `urls` names relays,
  // and that a code about something which is not one has none.
  //
  // **What that costs, said here because the code comment carrying it does not
  // outlive the spike**: the most common misconfiguration — a typo where a relay
  // URL should be — is exactly the one whose `urls` comes back empty. A consumer
  // rendering "these relays were refused" gets nothing to render for the case
  // they will hit most, and has to read `message` to say anything at all. The
  // alternative was to put the offending value in a field typed `readonly
  // string[]` and named for relays, which makes the field mean two things across
  // every code; that is the trade and this is the side of it a port pays.
  readonly urls: readonly string[];
}

// **The hooks are context-bound — `useReq`, `useRelayDiagnostics` and
// `useSend` — so each is created during component initialisation** — the same rule every hook in this framework already has,
// stated because this record is what a consumer reads and because getting it
// wrong is not a compile error. A request built later — from a click handler,
// or in an effect root opened outside initialisation — cannot reach the
// provider, and the framework's context read throws there rather than answering.
// `A12-C4` holds what that must look like: the throw, and **not** either of the
// two answers a helpful `catch` produces — a missing provider reported from
// inside one, or the browser side taken silently under a server render. A
// handle may be used from anywhere afterwards, and so may the diagnostics
// result and the operation `useSend` returns (`C6-C17`) — every member any of
// them declares. It is the construction that
// has a window, and `A12-C4` holds both halves.
//
// **"Afterwards" is about place, and the *time* question has a different answer
// for each surface — and, for the handle, a different answer for each teardown.**
// A result held across the destruction of the root that made it is reachable for
// both. The diagnostics record is discarded at provider teardown (below). The
// handle is not discarded, and it does not freeze either: **what it answers is
// derived on every read**, from the cache entry it last saw and the clock it was
// given. Those two inputs die at different times.
//
// - **Nothing new reaches it.** Its subscription to the cache went with its root,
//   so an event folded into the same entry afterwards is visible to a live reader
//   and not to this one. That part is a freeze, and it is the part worth having:
//   the events it holds were really received and no later event makes them false.
//   Measured with two readers on one entry, because the live one is what makes
//   it a claim rather than an observation of silence: after one root is
//   destroyed the next event lands in the other's answer and not in that one's.
//   This sentence stood here unrun beside two measured ones for a commit, which
//   is the failure the two bullets below were found by.
// - **Expiry keeps moving.** The projection samples the clock at each read, and
//   the clock belongs to the provider. Measured: with only the reader's root
//   destroyed and the provider still standing, a held handle answered one event,
//   then answered none once the clock passed that event's `expiration`.
// - **When the provider goes too, the clock is disposed with it**, `now` stops,
//   and the projection stops moving. That is the case the arm for this measures,
//   and it is why "it freezes" read true for as long as nobody asked the other.
//
// So the honest statement is narrower than a freeze and wider than a discard: a
// held handle is a **view that has stopped receiving**, and a view still shows
// less as its contents expire. `status` and `activity` are the last values
// observed and are not updated, so both can describe an attempt that no longer
// exists.
//
// **What is *not* claimed, because it was and it was wrong.** An earlier version
// of this passage argued that reporting `activity: 'idle'` after teardown would
// produce the stopped-request spinner — `loading` beside `idle` — and used that
// to justify freezing every member. The slot table below takes `state` alone;
// `activity` is not one of its columns, so `idle` and `refreshing` render the
// identical slot and the argument does not separate the two options it was
// deployed to choose between. What is true is smaller and is the reason kept:
// the members that would have to be corrected are corrected on a hot read path,
// and correcting them changes what the value *says* without changing anything a
// consumer renders.
//
// **The cost is therefore named rather than argued away**: a held handle can go
// on rendering the `loading` slot indefinitely, or empty its list without any
// state change a consumer can see. A consumer must not drive UI from a handle
// whose component is gone.
//
// **`refresh()` on one is the third input, and ruling 11 closed it.** A
// handle's write capability is revoked when the root that created it is
// released: a refresh already in flight resolves `cancelled /
// consumer-released`, and every call after the release resolves `not-started /
// released` at once and sends no REQ (`0005`'s `C11-C19`). A provider that is
// gone is a different input, and a call after it rejects with
// `provider-disposed` (`RM8`). What follows is what this passage measured
// before the ruling, kept because it is why the ruling exists: the REQ went
// out, the relay answered, `refresh()` resolved `complete` — and the handle
// still answered the pre-refresh events, because the subscription that would
// have shown them went with the root. A consumer awaiting `refresh()` on a held
// handle got a true outcome about a request whose answer it would not be
// shown.
//
// The next three paragraphs are those measurements, taken before the ruling
// landed; a released handle can no longer make the call they describe, and
// `C11-C19` is the row that holds the repair in their arrangements.
//
// **And "a live reader on the same key sees it" is not the consolation this
// passage offered it as. It is the hazard.** A refresh moves the shared entry,
// so a component nobody touched re-renders on the strength of a call made from
// a handle whose own component is gone: measured, a still-mounted reader on the
// same key went from `streaming` with two events to `incomplete` — a different
// slot — while the detached caller's own view did not move at all. The
// demotion itself is ordinary shared-entry behaviour, and a *mounted* caller
// gets it too; what detachment adds is that the one who caused it is the one
// who cannot see it. The same asymmetry shows on the ordinary path, without any
// timeout: a refresh from a detached reader is answered, the still-mounted
// reader's list grows, and the caller's does not move.
//
// **And the diagnostics axis carries it too, which is the part that makes this
// worth a rule rather than a caution.** When the relay refuses that refresh, the
// complaint does not merely annotate the bystander — measured, it takes it from
// `settled` with an event to `incomplete`, ends its leg, sets its `lastError`,
// drops its `activity` to `idle`, puts two refusals in its diagnostics, and
// **stops its live subscription**: an event the relay sends afterwards reaches
// nobody. **And its slot does not move.** `deriveOutlet` answers `default` for
// any state holding at least one event, so the component goes on rendering the
// list it had, over a feed that has died, with nothing a consumer can act on —
// silence reading as health, which this record refuses everywhere else.
//
// The demotion is not detachment's doing, and that is measured rather than
// assumed: with both readers mounted, a refused refresh from one leaves both at
// `incomplete` and `idle` — the caller included. What detachment adds is that
// the one principal who lands in the state it caused is gone, so nobody who can
// see it caused it and nothing will refresh it back: the caller has no view to
// notice, and the bystander has no signal. **"Cannot attribute" is
// structural rather than inconvenient**: a `Refusal` carries the relay, the
// leg, the relay's message and the classified reason, and no attempt identity
// at all, so nothing in the value distinguishes one this consumer caused from
// one a detached sibling did. That is a fact a port can check against its own
// type rather than a claim it has to trust. So the
// honest description of a detached handle was not "a stale view": it was a
// **write capability on a shared entry with no read-back**.
//
// So the instruction above was not enough on its own: "do not drive UI from a
// handle whose component is gone" is advice to the holder, and the damage
// landed on somebody else. The one honest option this passage named — revoking
// `refresh()` once the caller's root is gone, at the price of the cache-warming
// a detached refresh did for whoever was still reading — is the one ruling 11
// took.

function useReq(plan: () => ReqPlan): ReqHandle;

// **What that returns, written out.** This record named `ReqHandle` in three
// places and declared it in none, and its members were enumerated exactly once
// — in the identity paragraph far below — from the object the spike's engine
// returns rather than from this type. That object is wider, and wider in the
// direction C8 forbids: it carries `raw`, which hands back the query library's
// own result, and `projected`, which the engine declares on a separate
// interface whose own comment says it is not part of this record. A port
// building its handle from the only list this record offered would put the
// query library's own result object on the published handle, which is what C8
// is falsified by; `projected` is the smaller error of publishing a member the
// engine has already said is not this record's. The three axes and the one verb
// are all of it.
// **What `raw` reaches, said plainly rather than left at "the cache's `Map`".**
// One line through it — `handle.raw.data.entries.clear()` — empties the cached
// value and flips another hook on the same key to `settled` with no events,
// which `deriveOutlet` renders as `nodata`: the library asserting that nothing
// exists because a consumer cleared a Map. So while `raw` is on the handle,
// `B5-C6` holds for every value this API *publishes* and is unenforceable
// through this member; `PO1` excludes it from the walk for that reason and says
// so. That is the price of the seam, and it is why a port drops it rather than
// deciding later.
//
// **The shipped object carries two members this interface does not**, and the
// difference is recorded here rather than left for a port to find: `raw` is the
// query library's own object (and under it the cache's `Map`), and `projected`
// is the state and the next expiry from one read of the value. Both are seams
// the spike's own arms read; the request hook is not on the published entry, so
// no consumer reaches them today. **A port that publishes the handle drops
// them** — publishing `raw` would put the query library's representation on this
// API, which is the mistake the export list closes for that dependency
// elsewhere. `PO2` keeps the list at two.
interface ReqHandle {
  readonly state: ReqState;
  readonly activity: QueryActivity;
  readonly diagnostics: ReqDiagnostics;
  // C11, decided above: one meaning whatever the request, resolving on *that*
  // attempt's outcome — `cancelled` when a lifetime ends under it — and
  // rejecting only for a refused descriptor, a missing provider or a provider
  // already gone.
  refresh(): Promise<RefreshOutcome>;
}

// Context-bound and argument-free: taking an `RxNostr` would publish the
// connection the provider owns. It returns an accessor rather than the map
// itself because a returned value is the answer at the instant of the call —
// the map has to stay live as relays connect, and in Svelte that is a property
// read, not a value.
// **`RelayDiagnostic.lastNotice` is the last `NOTICE` a relay sent this
// provider during that relay's current continuous membership of the accepted
// scope.** Not "since the hook mounted", which is what it used to be and what
// made a diagnostics panel useless: the record and the subscription lived in
// each call, so a panel opened *because* a relay misbehaved was mounted after
// the notice and showed nothing for it, while a component that had called the
// hook earlier showed it — at the same instant, for the same relay.
//
// So the subscription is the provider's. It starts when the provider is built,
// records with no hook mounted, and every hook under one provider reads the
// same value; a hook mounted later reads what arrived before it. A notice
// survives reconnection and a change of `read`/`write` while the relay stays in
// scope. **The reconnection half of that sentence bound nobody until r32**: the
// edit it excludes is not "discard on a connection change" — an arm that closes
// a socket already catches that — but "discard when a relay comes back", and no
// arm had ever brought one back. `C-δ-C10` is the row and `RD20` the witness. **It is discarded when the relay leaves the accepted scope**, and a
// re-added relay starts at `undefined` — pruning on removal is the point, since
// keeping URLs for the provider's whole life both grows the record through a
// session that edits its relay list and resurrects a stale notice on re-add. A
// **refused** update keeps the previous scope and its notices. Provider
// teardown ends the subscription and discards everything. Nothing crosses
// between providers.
//
// **"Discards everything" is a claim about what a held result answers**, and
// that is the half it lost. The sentence above sat here for rounds while only
// the subscription actually stopped: the map froze at its last snapshot and the
// getters went on serving it, so a panel kept across a teardown — which the
// paragraph two above expressly licenses — showed `connected` and a relay's
// complaint for a socket that had been disposed. Silence read as health, which
// is the one direction this record refuses everywhere else. So the two are
// separate obligations and a port owes both: **after teardown the record is
// empty**, and a result held across it answers no relay rather than the last
// thing it saw. The distinction that makes this implementable is that a
// provider whose relay list changes tears its subscriptions down too, and that
// teardown must *not* discard — it is the one `C-δ-C5`'s surviving notice runs
// through.
//
// **"Current continuous membership" is read where the scope is observed, not
// between two writes to the prop.** Pruning happens at the observation, so a
// relay removed and re-added inside a single flush never left and its notice
// stands, while the same two writes with a flush between them are two changes
// and it comes back empty.
//
// **Both are reachable, and the sentence here said the second one was not.**
// It read "not reachable through the published surface — the only mover is the
// `relays` prop applied in one effect, and two writes in a tick coalesce into
// one change". The coalescing is real; the conclusion was not, because
// `flushSync` is Svelte's own API and one call between the writes is the whole
// difference. So this is a rule a consumer can land on either side of, and it
// is stated as one: **membership is per applied change**. `RD28` measures the
// pair; `RD13` is the two-change side on its own. A port whose provider applies
// each write separately inherits the second answer everywhere and should say
// so.
//
// **Object identity is not promised for the values this hook publishes** — the
// contract is that the same provider answers the same content at the same
// instant, not that it answers the same object. An implementation may mint a
// fresh map per recompute or hold one and write into it; both conform, and a
// witness that can tell them apart is testing an implementation rather than
// this record.
//
// **Scoped deliberately, because identity _is_ promised elsewhere in this
// file** and an unscoped sentence here would contradict it: on a refused prop
// change the previous scope and client stay, "the same objects, not equal
// ones", because in-flight requests hang off that client and an equal
// replacement would strand them. The difference is what the identity is doing —
// there it is the thing being kept alive, here it would only be an artefact of
// how a snapshot is built.
//
// The cost is named rather than discovered: the subscription runs for a page
// that never reads diagnostics. That inverts what `RD5` used to hold — the
// listening stopped when the last consumer went away — and the inversion is the
// decision, because a value the provider owns cannot have a lifetime the
// consumer decides.
function useRelayDiagnostics(): {
  readonly relays: RelayDiagnostics;
  // The provider's own state rather than a relay's, which is why it is beside
  // the map instead of in it: a refused list has no relays to key by.
  readonly configurationError: RelayConfigurationError | undefined;
};

// **With no provider above them, the hooks answer differently, and no record
// said so.** This one *throws* — there is no map to publish and no
// request to refuse, so the absence is a programming error and is reported as
// one. The request hook does not: it has a channel for a refusal and uses it,
// which is `A12`'s reading of a hook that must not throw in a render path.
// `useSend` throws the way this one does: with no provider there is nothing to
// send through, so building the operation is the programming error. What the
// operation *returns* later is never a throw — that is the send's own contract
// (`C6-C13`, `C6-C15`) and a different call.
//
// **`MissingProviderError` is published, and it carries a code.** The state
// this replaces was the incoherent one: the class was thrown, asserted by name
// in the suite, argued about here, and promised nowhere — a consumer was being
// asked to recognise something the surface did not name. It is on the list
// above now, and beside the class it carries `code: 'missing-provider'` — the
// same literal the request's channel publishes, because a consumer's remedy for
// both is the same one: put the tree under a provider. `instanceof` is the ordinary way to
// catch it; a **duplicate install** of this package — two copies in one tree,
// which pnpm and a monorepo both produce — hands a consumer an object whose
// prototype is not the one their `instanceof` names, and a string comparison
// survives that. `.name` stays what a diagnostic prints and is not the typed
// discriminant.
//
// One literal per class rather than a shared `NosvelteErrorCode` union, and the
// reason is not the count. There are four code *namespaces* now —
// `'missing-randomness'`, `'missing-verifier'` (whose class is not exported —
// see the paragraph on `MissingVerifierError` below), `ReqErrorCode` (which
// `'missing-provider'` joined, because the request publishes this very class
// when it has no provider), and `RelayConfigurationErrorCode`, which is five
// causes of its own — and the
// sentence that said "there is one code, and the union is a surface to add when
// there is a second" was false the moment the second one landed. (`SendRefusalCode`
// is not one of them: it is the code on a value a send returns, and no class
// carries it.) **A count is
// what this paragraph keeps getting wrong**: it said one, then three, and the
// number is not the argument.
//
// What decides it is that **these do not share a catch boundary**: they are
// thrown at different entry points, a consumer meets them in different lines of
// their own code, and there is no API here that branches over the union. An
// umbrella union would make every future member a breaking change for an
// exhaustive consumer, in exchange for a name nobody switches on.
// `RelayConfigurationErrorCode` is a union because that family *is* met at one
// boundary and answered by one `catch`.
//
// (Written because a port reading the two signatures side by side has no way to
// know that one of them throws. `A12-C4` decides the *other* case — a hook
// built outside component initialisation — and that decision is the framework's
// context read failing, not this.)

// Every component takes `namespace` (default: absent, meaning the descriptor
// alone decides the cache entry — B2) and the same four outlets. What differs
// is the argument its kind needs, and what its default snippet is handed.
//
// **Three of the four are optional, and an outlet the mapping selects with no
// snippet supplied renders nothing.** No record decided that until this
// sentence, and it is the common case rather than a corner: a consumer who
// writes only `children` — the shape every one-block Svelte component takes —
// renders nothing for the whole of `loading`, nothing for `nodata`, and nothing
// for every failure. Two candidates were available and both are refused. Falling
// back to `children` is not typeable: it is the only outlet handed the answer,
// and on every row that selects one of the other three there is no `T` to hand
// it — for the eight single-event components there is no event in existence
// there.
// Rendering markup of the library's own is worse: an unstyled, unlocalised
// string a consumer cannot suppress is the shape of #85, where a `NOTICE` with
// nowhere to go became a `console.error` the application could not turn off.
// **The cost is named rather than argued away**, and it is the one this record
// refuses everywhere else: `error` and `nodata` are two of the three that may be
// absent, so a consumer who supplied neither is shown a failure and a
// proven-empty answer as the same empty region. What a port owes in place of a
// default is documentation.
// **Nothing witnesses this and nothing can yet**: the components in the tree are
// the ones being replaced, and they take legacy slots, where an unfilled
// `<slot name=…/>` with no fallback content also renders nothing — the same
// answer reached by a mechanism this decision does not keep. It joins C1 and
// C14 as a clause that closes when the components land.
// **Every outlet takes the request**, and `Events`/`Event` lose their `state`
// field, so there is one route to state rather than two that would need a
// contract about being the same snapshot.
//
// **What that closes**: all eleven **request** components could not
// reach the diagnostics axis at all. `C5` says a failure over data already shown
// "stays on the diagnostics axis" — for a component consumer that meant it was
// not reported anywhere. Unreachable from a component: `legEnded`, `refusals`,
// `lastError` over shown data, and `activity: 'idle'`. The sharpest case is a
// relay list that is all write-only, which makes every request "not asked",
// reported as `loading` with `activity: 'idle'` — so the component renders the
// `loading` snippet for ever, and the published string that explains it,
// `'no-readable-relay'`, lived on `RefreshOutcome`, reachable only through a
// handle a component consumer did not have.
//
// So `loading` and `nodata` take it as much as `children` does: the outlet that
// renders that state is the only one that could explain it. **No fifth outlet** —
// `C1` forbids one by name. The `error` argument stays as the slot's own
// discrimination, fixed to be the same object as `request.state.error`; two
// routes to one value need a contract that they are the same snapshot, and one
// route needs none. Keeping a handle after the slot is gone is closed by the
// revocation rule (`C11-C19`), not by withholding the handle.
interface RequestOutletContext {
  readonly request: ReqHandle;
}
type Outlets<T> = {
  children: Snippet<[T & RequestOutletContext]>;
  loading?: Snippet<[RequestOutletContext]>;
  // **`ReqError`, not `Error`, and for the reason the deep-readonly repair
  // exists**: a snippet handed an `Error` cannot read `code` — the field it is
  // supposed to branch on — and *can* assign to `message`. The component slot is
  // the surface most consumers meet the failure channel on, so it takes the
  // published union like `ReqState.error` does.
  error?: Snippet<[{ request: ReqHandle; error: ReqOutletError }]>;
  nodata?: Snippet<[RequestOutletContext]>;
};
type Events = { events: readonly ReqEvent[] };
// **`ReqEvent` here too, and the reason this line is called out**: the
// deep-readonly repair went into `Events` and stopped, so the eight components
// that hand a consumer *one* event went on publishing a mutable one. A snippet
// that wrote `event.content = …` type-checked, and the value it wrote to was
// frozen — legal-looking code failing only at run time, which is the state this
// record refuses two sections above. A contract changed in one place and not in
// its class; `SUR12` is the check that now counts the class — `SUR8` is a
// different arm, over the slot mapping of the components that ship today.
type Event = { event: ReqEvent };

// **`ids` becomes a filter here, and how is a contract rather than a detail.**
// The component asks for `{ ids, limit: ids.length }` — a list of ids is a
// request for those ids and nothing more, which is only true if the `limit`
// counts the ids beside it. **Both come from one read of the prop**, and in
// Svelte a prop read *is* a re-evaluation: reading it twice makes the pair
// describe two different lists, and the relay answers the second while the
// consumer is told about the first. That is the v1 defect `B4-C9` is written
// from — a `REQ` asking for two ids with `limit: 1`, a filter this library
// never constructed — and it is why the composition takes a **reader** rather
// than an array: "read it once" is then a property of the function a port
// writes, not of every call site. The spike's is `filtersForIds`, and it is
// deliberately not exported: a port's own is the thing `B4-C9` binds.
type EventListProps = { namespace?: string; ids: readonly string[] } & Outlets<Events>;
type UniqueEventListProps = EventListProps;
type UserReactionListProps = {
  namespace?: string;
  pubkey: string;
  limit?: number;
} & Outlets<Events>;
type ContactsProps = { namespace?: string; pubkey: string } & Outlets<Event>;
type MetadataProps = ContactsProps;
type MuteProps = ContactsProps;
type PinProps = ContactsProps;
type RelayListMetadataProps = ContactsProps;
type ArticleProps = { namespace?: string; pubkey: string; identifier: string } & Outlets<Event>;
type EventProps = { namespace?: string; id: string } & Outlets<Event>;
type TextProps = EventProps;
```

**The N+1 ceiling, declared rather than planned away.** Fifty per-author descriptors are fifty
entries and fifty subscriptions to every relay in scope, and relays cap subscriptions per
connection. A transparent merging layer is **not** in v1: it looks like an optimisation and is a new
state machine, since EOSE, timeout, refusal, refresh and retention all have to be demultiplexed back
to the requests they came from, which is larger than this accept unit. Shipping that in silence is
refused too, so what v1 owes instead is stated here and in the README's component section:

- subscriptions grow **per component, per descriptor, per target relay**, and the relay-side cap is
  implementation-specific and not something this library can promise — no universal number is
  invented, and the measured per-relay values and the conditions for reopening this are what the
  record carries;
- the examples stop mounting a per-kind component N times inside a list;
- many authors are asked for with **one** `useReq` over one filter and distributed in the
  application;
- the built-in components declare themselves standalone / small-cardinality, and say that they do
  not batch.

A future planner has to decide, before any wire count, **which logical request a merged request's
single-relay refusal makes incomplete** — which is why it is not a detail deferred but a design not
started.

**What each component asks, which `C7` decided and never stated.** The adjudication makes this table
a phase-1 blocker, and it is why: `C7` says the components are one implementation, only
`EventList`'s descriptor was written down, and all four of the fields the others would differ in —
the kinds, `live`, `retain`, `settleTimeoutMs` — are **in the cache key**. Two ports therefore
produce different cache identities for one published component name, and a consumer's own `useReq`
cannot land on the same entry as `<Metadata>` unless they guess all four. These are the norms the
next round is written against:

| Component family               | filters                                                               | `live`  | `retain`               | `settleTimeoutMs` | relay target     |
| ------------------------------ | --------------------------------------------------------------------- | ------- | ---------------------- | ----------------- | ---------------- |
| `Event`, `Text`                | `{ ids: [id], limit: 1 }`                                             | `false` | absent → `'unbounded'` | absent → `5_000`  | provider default |
| `EventList`, `UniqueEventList` | `{ ids, limit: ids.length }`                                          | `false` | absent → `'unbounded'` | absent → `5_000`  | provider default |
| `Metadata`                     | `{ kinds: [0], authors: [pubkey], limit: 1 }`                         | `false` | absent → `'unbounded'` | absent → `5_000`  | provider default |
| `Contacts`                     | `{ kinds: [3], authors: [pubkey], limit: 1 }`                         | `false` | absent → `'unbounded'` | absent → `5_000`  | provider default |
| `Mute`                         | `{ kinds: [10000], authors: [pubkey], limit: 1 }`                     | `false` | absent → `'unbounded'` | absent → `5_000`  | provider default |
| `Pin`                          | `{ kinds: [10001], authors: [pubkey], limit: 1 }`                     | `false` | absent → `'unbounded'` | absent → `5_000`  | provider default |
| `RelayListMetadata`            | `{ kinds: [10002], authors: [pubkey], limit: 1 }`                     | `false` | absent → `'unbounded'` | absent → `5_000`  | provider default |
| `Article`                      | `{ kinds: [30023], authors: [pubkey], '#d': [identifier], limit: 1 }` | `false` | absent → `'unbounded'` | absent → `5_000`  | provider default |
| `UserReactionList`             | `{ kinds: [7], authors: [pubkey], limit }`                            | `false` | `limit`                | absent → `5_000`  | provider default |

**`retain` is absent rather than `ids.length`, and that correction came from a counterexample.**
`retain: ids.length` refuses its own descriptor on an empty `ids` — measured: _"retain must be a
safe integer of at least 1, and was 0"_ — so an `EventList` asked for nothing could not reach `B8`'s
answered-without-the-wire state at all. The first eight rows take the non-live default: their filter
and replacement identity already bound what is kept.

**`UserReactionList` carries a `limit` prop, and that is a published field rather than a note.** It
defaults to **100**, is validated as a safe integer of at least 1, and **one read of it** is both
the filter's `limit` and `retain` — the same rule `B4-C9` binds for `ids`, and for the same reason:
two reads of a Svelte prop are two values, so a filter asking for one count while the cache retains
another is a `REQ` this library never meant to construct. A fixed bound would take away an
adjustment the old surface gave.

**This was a recorded gap rather than a decision for two rounds.** The sentence here said the
component "needs an input the new props do not have" and the props type went on not having it, so a
port reading only the published shape could not build the descriptor the table on this page requires
— it had to invent a fixed 100, accept a prop the type does not declare, or use different values for
the filter and the retention. A reviewer found it; what closed it is the prop above and `C7-C5`,
which reads every placeholder in that table and requires it to name a prop the same component
publishes. The table's cell says `limit` rather than `N` for that reason: a placeholder that is not
a published name is now a red arm rather than a paragraph. And `UniqueEventList` changes meaning
from the old surface's arbitrary filters to ids-only, which has to be said where a migrating
consumer reads it.

**The relay-target column is one value, not a choice.** Every component takes the provider default,
matching the props as they stand. Letting `RelayListMetadata` choose a bootstrap target is a
_separate_ ruling — an optional `relays` prop on **every** request component, defined as
`props.relays ?? provider.defaultReadableRelays` — because one component switching implicitly is the
shape that makes two components disagree, which is `C7`'s own falsifier.

Each row owes an architecture-or-contract test that the component's real descriptor and the same
descriptor handed to `useReq` produce the same canonical key. `C7` is then one implementation of the
composition, not only of the slot mapping.

Absent on purpose, and each absence is a decision above: no second entry (C8), no low-level stream
(C9), no type from the query library, no accumulated value or the functions that build one, no cache
key, no descriptor normaliser, and no general-purpose selector.

**And five a consumer will look for, which were not on this list until an adversarial pass asked for
them by name.** Three of them have been ruled since, and the passage says which. There was no way to
say _not yet_ — no `enabled`, no deferral of a request the descriptor describes — so a search box
minted an entry and a `REQ` per keystroke, and the only stop was unmounting the component. **That
one landed (ruling 4)**: `useReq` takes a plan rather than a descriptor, so that deferred and asked
are distinguishable rather than encoded —

    type ReqPlan = { kind: 'deferred' } | { kind: 'request'; descriptor: ReqDescriptor };

    function useReq(plan: () => ReqPlan): ReqHandle;

with a deferred plan making **no key for the question it would have asked, no attempt and no REQ** —
it occupies **one inert entry per client**, shared by every deferred hook, which is a price stated
rather than a promise of none — reporting `loading` with `activity: 'idle'`, resolving `refresh()`
as `{ kind: 'not-started', reason: 'deferred' }`, applying the ordinary mount triggers when it
becomes a request, and releasing the observer without deleting the entry when it goes back. It is
repeated here in an indented block rather than a fenced one because the fenced declarations — the
`useReq` signature above and `ReqPlan` beside `ReqDescriptor` below — are the ones `LK13` holds.
`filters: []` and `authors: []` are **not** the encoding — they stay `B8`'s genuine empty-set
questions, which is also what stops a descriptor being validated for a question nobody is asking.
There is no `cancel()`: `refresh()` closes and re-opens, which is the opposite. And an abort is
therefore not something a consumer raises at all — it is the teardown's, a consumer holds no signal,
and since ruling 5 it resolves `cancelled` rather than rejecting. The cancel is a v1 omission rather
than an oversight: it is a handle operation whose interaction with the query layer's own lifetime
nobody has decided. **Per-relay selection was the fourth, and it is no longer an omission
(ruling 3)**: the relay set was the provider's prop alone, so two relay sets on one page meant two
providers, which `C6` says share nothing — two connections, two caches, the same event twice. That
was the one `req` use case the descriptor did not cover, and `C3`'s falsifier names exactly that
shape; it was recorded here as a known gap for a reviewer to rule on, and the ruling added
`ReqDescriptor.relays`, a target set resolved inside the provider's readable scope. The passage is
kept as the state that ruling answered.

**And the fifth is not an omission of an option but of a direction — sending — and v1 publishes it
as an operation rather than as the connection (ruling 17).** Today's surface exports `app`, a
`writable<{ rxNostr: RxNostr }>` — `NostrApp` builds the transport itself and publishes it through
that store, so a consumer who wants to post reads `$app.rxNostr` and calls the dependency's own
`send`. It is the only path there is. `C6` moves the connection's ownership to the provider and no
published type hands it back — `C6-C4` holds the parameters and `C6-C11` what comes back, which
`LK24` reads over the edges that row lists (a type check, with the limits that row states). Posting
does not need the connection, only an operation bound to it, and that is what v1 publishes:

```ts
interface NostrSigner {
  signEvent(template: {
    readonly kind: number;
    readonly content: string;
    readonly tags: string[][];
    readonly created_at: number;
  }): Promise<ReqEvent>;
}

interface EventTemplate {
  readonly kind: number;
  readonly content: string;
  readonly tags?: readonly (readonly string[])[];
  readonly created_at?: number;
}

type SendInput = EventTemplate | ReqEvent;

interface SendOptions {
  readonly relays?: readonly string[];
}

type SendRefusalCode =
  | 'invalid-event'
  | 'no-signer'
  | 'signer-failed'
  | 'no-writable-relay'
  | 'relay-outside-scope'
  | 'not-in-browser'
  | 'provider-disposed';

type SendRelayOutcome =
  | { readonly relay: string; readonly outcome: 'accepted'; readonly message: RelayMessage }
  | { readonly relay: string; readonly outcome: 'rejected'; readonly message: RelayMessage }
  | { readonly relay: string; readonly outcome: 'no-response' }
  | { readonly relay: string; readonly outcome: 'aborted' };

type SendResult =
  | { readonly status: 'refused'; readonly code: SendRefusalCode; readonly message: string }
  | {
      readonly status: 'settled';
      readonly event: ReqEvent;
      readonly relays: readonly SendRelayOutcome[];
    };

type Send = (input: SendInput, options?: SendOptions) => Promise<SendResult>;

function useSend(): Send;
```

- **Who signs** — the maintainer's ruling. An input carrying any of `id`, `pubkey` or `sig` is a
  signed event: it must carry all three, its signature must verify, and it goes out unchanged.
  Anything else is a template, signed by the provider's `signer` prop — structurally NIP-07's
  `signEvent`, so `window.nostr` is one — and refused `'no-signer'` when there is none. What the
  signer returns must verify and must be the template it was asked to sign, or the send is refused
  `'signer-failed'` — and "the template" is a copy the signer never holds: it is handed another, so
  a signer that rewrites what it was given and signs the rewrite correctly is compared against the
  original and refused. Every copy taken from a caller's value is of the elements, by index into
  plain arrays, and compared element by element — an `Array` subclass's own `every` or `toJSON`
  never runs on a value this library has taken. The dependency never signs: it is handed the event
  already checked here, so what goes on the wire is what was checked (`C6-C12`, `C6-C15`).
- **Where it goes** — the maintainer's ruling. By default to every writable relay in the provider's
  scope. An explicit `relays` must be a subset of those; a relay outside the scope, or in it and not
  writable, is refused `'relay-outside-scope'` before anything is signed. The caller's `relays` is
  read once — the property and the list's iteration both — into a list this library owns, and a
  getter or iterator that throws is the same refusal. A connection the provider does not own is one
  its diagnostics cannot see and its teardown cannot close, which is `C6`'s argument (`C6-C14`).
- **What comes back** — never a throw, including for input that defeats its own types: every field
  is read once into the library's copy (`C6-C15`). `refused` with a code when nothing went out;
  `settled` with the library's frozen copy of the event and one outcome per target: `accepted` when
  the relay's `OK` carries the boolean `true`, `rejected` otherwise — each with the relay's reason
  as a `RelayMessage`, the bounded, frozen value `CLOSED` notices already publish, whatever the
  relay sent — `no-response` when the relay says nothing within the library's thirty-second wait, or
  `aborted` when the provider was destroyed first (`C6-C13`).
- **Lifetime.** The targets are resolved once, at the call; a later change to the relay list does
  not move a send in flight. **The provider's lifetime covers a send from the call**: destroyed
  while the event is still being signed or verified, the send resolves `'provider-disposed'` at
  once, and a signature or verdict that arrives afterwards starts nothing; destroyed after the event
  went out, the relays still owed an answer are `aborted`; every later send is refused
  `'provider-disposed'`. On the server there is no connection, and a send is refused
  `'not-in-browser'` rather than queued (`C6-C14` holds the targets decided at the call, `C6-C13`
  the teardown, `C6-C16` the server).
- **Reads are untouched** — the maintainer's ruling. A sent event is not inserted into any request's
  answer; it appears there when a subscription receives it from a relay, like any other event. So a
  send owes nothing to cache identity, refresh or retry (`C6-C16`). It has no retry of its own
  either, which is a v1 scope decision listed below rather than a contract.

- **The `signer` prop is read when the provider is created.** A later change to the prop is not
  applied in v1 — the provider holds the object it was given and calls its `signEvent` at each send.
  An extension that installs `window.nostr` after the page loads is supported by passing a signer
  that reads it at call time, `{ signEvent: (t) => window.nostr.signEvent(t) }`, rather than
  `window.nostr` itself, which may not exist yet.
- **Where it is observed.** The spike's arms run under a mocked context map, so that `useSend`
  reaches the provider it was built under — from a later handler, under two providers, and not at
  all without one — is a production observation against real Svelte context (`C6-C17`), not an
  inference from the other hooks.

**What it leaves out, stated rather than implied.** No retry, no outbox, no routing beyond the
scope's write flags, no AUTH handling beyond the dependency's own, and send outcomes are not on
`useRelayDiagnostics` — the per-relay outcomes are what a consumer who needs any of those builds on.
An earlier version of this section, written while the ruling was open, said a consumer posting
through a second connection of their own would see a relay's refusal nowhere; that was wrong — the
dependency's `send` returns each relay's `OK` — and the question it priced no longer arises.

**The connection's configuration is not a prop, and this is the fourth time the same mistake was
caught.** An earlier version took an `rxNostrConfig` and handed it to the client constructor
untouched. That is one prop, and through it a consumer could set four things this library has
decided:

| The option            | The decision it displaces                                                                                                                                                                                                        |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authenticator`       | 0002: v1 configures none, and the dependency has none by default, so withholding the option is what leaves it unconfigured — which is what makes `auth-required:` terminal rather than a state with no way to observe leaving it |
| `retry`               | 0002 A5: withholding it leaves the dependency's own retry on, and A5's per-relay tables are written against a transport that reconnects and re-sends. Not A14 — see below                                                        |
| `eoseTimeout`         | A-γ: the settle timeout belongs to the request, and a caller overrides it per request rather than per provider                                                                                                                   |
| `skipExpirationCheck` | B7b: NIP-40 is read by one parser in this library; no arrival is rejected for having expired and no deadline evicts anything                                                                                                     |

**`skipExpirationCheck` is not merely withheld either — the provider sets it to `true`,
unconditionally.** This row said for six rounds that "the dependency's arrival gate is relied on
rather than reimplemented"; that is withdrawn. Two parsers reading the same tag differently made
whether an event could be seen depend on when it arrived, so the dependency's gate is off and
`expiresAt` is the only reading of the tag this library has.

Off does **not** mean the library drops those events instead. No arrival is rejected for having
expired and no deadline passing evicts anything: **there is one place that applies the reading, and
it is the projection**, which hides what is expired now and shows it again when the clock is
corrected. Retention was the second place for a round — it preferred entries valid at the sampled
instant — and that is withdrawn: two appliers of one tag is the same shape as two parsers of it, and
it put the clock into what is stored, so a wrong clock at an overflow could cost the wrong entry its
slot permanently. Ranking by recency costs the bound nothing it was asked for and leaves a wrong
client clock costing visibility rather than data, which is what 0003 B7b wanted from the start. A
round of this design did put a gate at arrival and it is withdrawn; 0003 B7b says why, and states
what recovery a bounded set can and cannot promise. The reason the option is not a prop is unchanged
and is why the provider must set it: a consumer who turned the dependency's gate back on would put a
second reading of NIP-40 back on the path, and that one _does_ drop.

**One published member answered from the consumer's read history, and the shape is worth stating
before the options are.** **Before the repair** the query layer's `fetchStatus` had two readers —
`activity` and `refresh()`'s test for a flight already open — and that layer notifies a subscriber
only about properties the subscriber has touched, so a consumer who had never read `activity` and
never refreshed left the field untracked, and the handle went on reporting `live` over a
subscription that had died. The repair adds a third reader, unconditional at construction, which is
exactly what makes that conjunction unreachable. One earlier read anywhere changed the answer for
ever after. **The precondition matters and was written wrong once**: "the only reader" makes the
defect sound reachable by not reading one member, and it takes not reaching either. **`A12-C6` holds
it now**, with the repair being to touch the whole set the handle reads at construction rather than
the member that broke: the _first_ read is what narrows the subscription, so fixing one member
breaks the other three.

The general form is the part a port needs: **a published member that is among the only readers of an
upstream field inherits that field's subscription**, and no type can hold it — both answers are
well-typed. The check is a pair of runs, one with the member never read and one with it read once,
which have to agree.

**Sweeping that family found a second instance rather than none**, which is why the form is stated
rather than the instance. `clock.now` moves only when a timer fires, `wakeAt` is the only thing that
arms one, and its only caller was the projection's getter — so the scheduler that keeps expiry
honest was attached by the consumer's read, and a request nobody looked at showed events past their
deadline. Both are repaired the same way, unconditionally at construction, and **the repair the
tests cannot refuse is the wrong one**: sampling the clock inside the getter fixes the pair and
leaves every arm green while making an ordinary read of a handle a `$state` write from a derivation
or a template expression, which the framework refuses outright.

**A third instance of the same family turned up a round later, and it is the one that says the
family is about the _signal_ rather than about the read.** Arming at construction fixed who arms;
what a reader is subscribed to stayed "the second this clock reads", and a deadline being reached is
not the same event. The accumulator samples the clock as each chunk lands, so the second a deadline
falls in can already be current by the time its timer fires — the clock then reads the number it
already had, nothing is notified, and the deadline that had been refused for being further out is
never armed at all. Two deadlines and one chunk between them, measured, and the farther one booked
no sleep for the rest of the run: **C13's "at their expiry" was false whenever a request had more
than one deadline pending and traffic between them.** The clock publishes the reaching now, not only
the time (`C13-C4`).

**`eoseTimeout` is not merely withheld — the provider sets it.** Withholding an option leaves the
dependency's default in place, and that default is 30 seconds — **a figure no check asserts, said
plainly rather than dressed in a citation** and _completes_ the backward observable, so a caller's
`settleTimeoutMs` above it was closed by rx-nostr first. **The completing behaviour is measured, and
the number is not.** The sentinel drives it at 40ms; `A-γ-C6` reads what the dependency fills in for
itself and asserts only that the library's timer is **greater** than it. **Nothing anywhere asserts
thirty.** Any dependency default between zero and the library's own value leaves every one of those
checks green and this sentence false — so the figure is here as orientation, dated to the version
the sentinels pin, and a port must read its own transport's default rather than inherit this one.

**This paragraph cited `A-γ-C6` for the figure until the sentence two lines down was read back at
it.** That sentence says a port taking the number on trust would be taking it from nothing; the
citation made it look otherwise, which is the same defect one clause earlier rather than a different
one. The provider therefore writes its own value after whatever configuration it is handed, and
0002's boundary refuses a settle timeout above that. Setting an option this record says is not a
prop is the same decision rather than a departure from it: the reason it is not a prop is that A-γ
owns when a backlog gives up, and leaving the dependency to decide is exactly what that forbids.

**`retry` is withheld and not written, and this row named the wrong layer.** It read "A14: no retry,
so one wrapper bug cannot become many requests", which says the library turned retry off — and the
library did, one layer above the one this option names. The provider writes no `retry`, so the
dependency's own default stands: exponential backoff, up to five attempts, one second initial delay,
measured at 3.7.5. That is not an oversight and it is what 0002 A5 requires. A relay that drops off
is `recovering` rather than `terminal` **because** rx-nostr reconnects on its own and re-sends the
ongoing REQ; a consumer who set `retry: { strategy: 'off' }` would turn a momentary disconnect into
a relay that ends its leg, and when a leg ends is A5's decision rather than a caller's. That is why
the option is not a prop, and the reason is the opposite of the one this row gave.

A14's "no retry" is the **query** layer: `retry: 0` is written into the library's own query
defaults, so a query function that throws part way through a stream produces one request rather than
several (`A14-C1` measures exactly that). The two are different retries over different things — one
re-opens a socket and re-sends a REQ that is still wanted, the other re-runs a wrapper that failed —
and a reader given only the row came away believing the library had turned both off. **What would
falsify the pair as stated** is the provider writing a `retry` into the client's configuration,
which would put A5's recovery on a value this record does not own; or the query defaults carrying a
non-zero `retry`, which is what `A14-C1` fails on.

**`authenticator` is withheld and nothing is written, and the row gained the half that makes
withholding mean anything.** It read "0002: v1 configures none, which is what makes `auth-required:`
terminal" — which states the outcome without the step that produces it, and that step is a fact
about the dependency rather than about this library: `makeRxNostrConfig`'s defaults name no
authenticator and `getAuthenticator` returns none when the config carries none, measured at 3.7.5,
so withholding the option is what leaves it unconfigured. On a dependency that defaulted to one, the
same withholding would give the opposite result and the row would still read as though it had been
decided here. Every row in this table has now been corrected for a version of the same slip — a row
naming what the library wants rather than what the provider does about it — `skipExpirationCheck`
and `eoseTimeout` in earlier rounds, `retry` and this one in the round that wrote this paragraph.
**What would falsify it** is rx-nostr acquiring a default authenticator, which would make
`auth-required:` non-terminal without a line of this repository changing.

It is the same shape as a query client prop, and it was harder to see because one name hides all
four. So the provider takes none of it in v1, and the options that are neither decided elsewhere nor
asked for by anybody — `connectionStrategy` and `disconnectTimeout` among them — are absent for C9's
reason: adding a narrow option later is additive, and withdrawing one is not. **Those two used to be
given as the whole remainder, and they are not it.** `RxNostrConfig` at 3.7.5 also carries `signer`,
`okTimeout`, `authTimeout`, `skipValidateFilterMatching`, `skipFetchNip11` and `websocketCtor`, none
of which the table above decides and none of which the verifier paragraph below covers.

**One of those is not free to leave at its default on the probe transports, and nothing observes
it.** The scope's throwaway transports set `skipFetchNip11` deliberately: left at its default,
`setDefaultRelays` issues one `fetch` per relay — measured with a spy — so a probe without it turns
**every relay-list change into an HTTP round trip per relay for metadata nothing in this library
reads**. Removing it breaks no test, which is why the fact is here rather than in an arm. A port
that builds its own naming probe inherits the same trap from whatever its transport's equivalent
flag is. `skipVerify` was on that line and has left it: the provider writes it, for the reason the
paragraph below gives, so listing it among the fields nobody decides would now be the same slip this
table has been corrected for four times. Naming two as though they exhausted the config invites a
reader to conclude this record has been through every field; what it has been through is every field
it decides, and the rest are absent under the same rule. They are listed rather than counted so that
a field added to the dependency shows up as a name missing from this line.

The signature verifier is the one knob with a real argument for being a prop — verification is
expensive and an application might have a faster one. It is still absent, because publishing it
publishes the dependency's `EventVerifier` type, and no consumer has asked. The library supplies its
own; when someone needs to substitute one, that is a named option with its own record rather than a
config object with everything else riding along.

**And that record is not an addition, which this paragraph implied for several rounds.** `0003`
keeps the verifier _outside_ the cache key on the ground that a consumer cannot spell it — and `OM6`
measures what happens when two hooks disagree about one (`A16-C7`): with a permissive verifier
mounted first the strict hook shows an event its own verifier rejected, and the other way round it
is told nothing was found. The day the verifier becomes a descriptor field, that measured defect is
reachable under one provider through the published surface, and the obvious fix — keying on it — is
refused by the same record, because a fresh closure per render splits the cache on every keystroke.
So publishing the verifier is a cache-identity decision with no sound key today, not a new option
beside the existing ones. An adversarial pass read the two records against each other.

**"The library supplies its own" was false when this paragraph was written, and it is the reason
`skipVerify` has moved out of the list above.** The provider passed no verifier at all, and
`makeRxNostrConfig` defaults `verifier` to `emptyVerifier` — a function that throws — with
`skipVerify: false`. So the shipping configuration was one that rejects every event with an uncaught
exception, and nothing noticed because the fixture set `skipVerify: true` and no published path
reaches this provider yet. A sentence describing an intention was read for four rounds as a
description of the code.

The repair is the one that makes the sentence true rather than the one that withdraws it. **The
provider writes `skipVerify: true` and supplies the verifier to the engine instead of to the
client** — and that second half was itself false for a round after being written. The provider put a
verifier on the context and nothing carried it any further: the hook never read the context, so a
request made through a provider ran with whatever its caller passed, which was nothing. The sentence
described an intention twice over. `useStreamedReq` reads the context now, and `AE9` drives a forged
event through a provider-built request rather than calling the context's verifier directly — which
is what the previous witness did, and why forcing the gate off left it passing.

With that path in place, `skipVerify` joins `eoseTimeout` and `skipExpirationCheck` as an option
this record does not merely withhold but sets — the same move, for a reason of the same kind, and
0002's A-ε is where that reason lives: rx-nostr verifies inside `use()` behind an `await`, which
puts every event one microtask further from the raw message channel than the marker the engine
defers by exactly one (`AE1` measured it at 3.7.5; the repair is the gate moving, which `AE15`
holds), so the backward subscription was released before the events **the dependency's own verifier
had already passed** were handed downstream. A gate the library holds is one whose occupancy the
barrier can read; a gate inside the dependency is one the barrier can only guess at.

**What this does not do is make the verifier a prop.** A consumer still cannot pass one and
`EventVerifier` is still unpublished, so the paragraph above stands unchanged in what it decides.
What changed is that the library now does the thing the paragraph says it does. **What would falsify
it** is a forged event surviving a request made through a provider — `AE9` builds one with no
verifier argument of any kind, sends a tampered event and a genuine one, and requires that only the
genuine one reaches the consumer. Measured against its own falsifier: with the gate bypassed in
`admitEvent`, `AE9` fails.

**"The record was not loosened to close this" is true of that paragraph and not of its neighbour,
and the difference is worth stating rather than rounding off.** The verifier paragraph is untouched
— the decision it records is the one it recorded before. The sentence listing the `RxNostrConfig`
fields this record does not decide _was_ edited: `skipVerify` was removed from it, because the
provider now writes that field. That is an edit made to match an implementation, which is the move
this round is counting, and it is counted — one sentence, adjacent to the one that was left alone.

**The default posture inverted, and this is where that is recorded.** Before the gate moved, a
provider with no verifier got `emptyVerifier`, which throws: absent a verifier, nothing was
delivered at all. Fail-closed. Moving verification into the library and leaving the engine's
parameter optional made the same absence mean "verify nothing" — a strictly worse posture than the
one being replaced, and for a round it was written down only in a code comment. The engine's
parameter is required now, so the machine cannot be built without a gate. **No fail-open default
survives.** A request built with neither an explicit verifier nor a provider is refused: **the
request fails** — `status: 'error'` with an Error naming the two ways out, use it inside a provider,
which supplies one, or pass `verifyEvent`. **This said "the hook throws" and that is the one thing
it must not do**: an exception on the way through a component is the shape this redesign is
answering, and the refusal is carried as a rejected query function for exactly that reason. No
construction throws by decision any more: `C16`'s first render was the one place, until ruling 13
moved a refused first relay list onto the diagnostics hook as well. Nothing is asked of the relay
first, which matters, because refusing after the REQ has gone means the events are already on their
way to a consumer that trusts whatever arrives. `AE11` is the witness, and it fails when the
accept-everything fallback is put back.

The alternative was to keep that fallback as residue, and it was rejected: the round that found a
verifier not reaching the engine cannot ship one path where none has to, and signature verification
is not a thing that may fail quietly.

**Two other repairs were measured and rejected, and the shape is why.** Defaulting to the shipping
verifier rejects the fixtures outright: the harness builds events with placeholder keys and
signatures throughout — the strings are `'p1'` and `'pubkey-1'` and `sig: 's'`, not hex — so the
suite would be measuring the harness rather than the library. Making the parameter required at the
type level defeats the provider path, where the whole point is that a caller does not name it.
**What the refusal actually cost was a single named helper threaded through the tests**,
`acceptAnyEvent`, which already existed for the engine's own required parameter. The posture is
fail-closed and the price was bounded and mechanical, and that is what decided it.

**Four figures stood here and none of them re-derives**, so they are gone rather than corrected.
They said 88 `pubkey` overrides, 45 assertions reading them back, two files with `sig: 's'`, and one
line in each of fourteen files. Nothing here stated a counting rule or an as-of revision, so nobody
can say whether they were ever right — which is the shape `0001` forbids, a figure whose only
definition is a session that has ended. The argument never rested on the sizes; it rested on the
fixtures being placeholders and the helper being one call, and both survive being counted or not.

**The first attempt at this repair re-derived them instead, and the replacements rotted inside three
commits.** It quoted four fresh numbers "by the obvious rules" — and the obvious rule does not pick
between `src/tests` and `src`, which differ; one of the four then moved with every commit that added
an arm, in a paragraph two of those same commits edited without noticing. Replacing an unruled
figure with an unruled figure is not a repair, it is a younger instance of the same defect. The rule
that holds is the one applied one file over in `0005`: **drop the cardinality, keep the claim.** A
measurement that runs without verification now says so in its own source, which is the property the
fallback removed.

`createRelayScope` and `RelayScope` have left the list they were on. `createRelayScope(rxNostr, …)`
takes the connection as its first argument, which is exactly what C6 says a consumer never holds — a
published function contradicting the ownership decision a few rows above it. The relay set reaches
the library as `NostrApp`'s `relays` prop, which is data, and the scope built from it stays inside.

**Svelte is `^5.25.0`, and the outlets are snippets.** The three statements of this disagreed: the
package declared `^4.0.0 || ^5.0.0`, the design notes said Svelte 5 only, and the query library the
engine is built on requires `^5.25.0`. **That last is checkable only if the copy is named, and two
are installed.** The engine imports `tanstack-svelte-query-v6` — `@tanstack/svelte-query@6.1.38`,
whose peer range is `^5.25.0` — while the hooks being replaced still import
`@tanstack/svelte-query@5.90.2`, whose range is `^3.54.0 || ^4.0.0 || ^5.0.0`. A reader who resolves
the top-level copy therefore finds the wider range and reads this sentence as stale; the alias is
the one the engine's code path resolves, and a review of this record made exactly that mistake. The
dependency's requirement is not negotiable, so a range admitting Svelte 4 is a promise the engine
cannot keep — and keeping it would mean a second query implementation and a second contract suite,
for a version this redesign already breaks.

That decides slots too. Snippets are how a Svelte 5 component takes markup, and introducing them
later would break component markup a second time. So C1 is narrowed rather than kept: the four
outlets survive by name and by meaning, the twelve component names survive, and the markup that
fills them changes. The earlier wording — that migration is a change of arguments rather than of
markup — is withdrawn.

### Refusing a relay list, and where the refusal goes

B-α refuses a relay list it cannot name consistently — an input that is not a relay at all,
capabilities that contradict each other, a URL the transport would rewrite again after the transport
has named it, a set the transport collapses that it named apart one at a time, and a transport that
cannot give exactly one usable name for a relay at all. **Five, and this paragraph has now been
wrong twice in the same direction**: it said three until it was read against the code, then four
until the fifth cause was added below it and only the type, the code block and `C16-C1` were updated
— the third clause used to say the transport disagreed with a name _this library_ had chosen, which
was the design `B-α-C15` withdrew — names come from the transport now, so there is no second opinion
left to differ with; the fourth, the set probe, was missing; and the fifth,
`transport-incompatible`, arrived afterwards. A record that publishes a discriminant has to count it
the same way the code does, **and counting it in prose is what keeps going wrong** — the code block
above and `C16-C1` both say five, and this sentence is the third place the number lives. **Those
refusals are decided at a boundary the consumer reaches through one reactive prop**, so the question
this record has to answer is not whether to refuse but **what a `relays` prop that is refused does
to the subtree beneath it.**

**The two are decided differently, because at the two moments there is a different thing to
protect.**

**At the first construction, the provider used to throw, and it no longer does.** The argument was
that there is no previous generation, that a provider with no transport cannot serve any request
under it, and that throwing is what a consumer can already handle — Svelte's error boundary catches
it and renders the failed snippet, which is why the error class is published. The first two clauses
are still true and the conclusion does not follow from them; the paragraphs below are why, and the
code is where they landed.

**On the server none of that sentence is true, and it was written from the client.** `C16-C4`
measures it: rendering the provider with a refused list on the server leaves the error out of the
render with nothing produced, and the two boundary shapes a consumer would write do not contain it —
`onerror` alone is never called, because the server renderer has no such prop, and a `failed`
snippet is rendered only when an API-level transform handles the error, which the default does not.
**So on the server a refused relay list is a failed render**, and the half of this decision about a
later change has no server counterpart at all, because the effect that would carry it does not run
there. That was recorded as the contract rather than an oversight, on the argument that a relay list
the boundary refuses is a programming error.

**That argument is withdrawn, and the ruling is that first construction stops throwing.** A relay
list is not source code: it comes from a signed NIP-65 event, a settings row, a `nprofile1…` hint,
and `"wss//relay.example"` is an ordinary typo class in lists published in the wild. Classifying
untrusted input as a programming error means one stranger's malformed relay entry is a 500 on the
server and a torn-down subtree on the client — and there is **no published way to check first**,
since `createRelayScope` is correctly unexported and nothing replaced it — `LK7` holds the entry
against the manifest and `LK2` holds the name out of the published declarations, which are two
independent refusals rather than one. Multi-account amplifies it, because the natural
`{#key accountId}` reset makes every switch a first construction.

So: an invalid list at first construction creates no socket, leaves the accepted scope **empty**,
still mounts the children, and publishes the refusal on the diagnostics axis, where `B-γ` already
renders an empty scope sensibly as "not asked". A later invalid update keeps the previously accepted
scope and client and publishes the refusal, as before. A partly valid list is refused **whole**, not
partly accepted. A published total validator may be added later as an aid, but is refused as _the_
answer: it cannot prevent the crash when a consumer forgets to call it, when the value changes
between the check and a reactive update, or when SSR builds the provider from another entry. Making
the boundary itself total is what this decision is for.

**And the accepted list on the server used to leave a resource behind, which is now decided against
rather than priced.** The provider's release is an `$effect` teardown, and Svelte's server compiler
emits no `$effect` at all, so _that_ disposal never ran there while the accepted path still wrote
the relay list through to the transport during construction. Measured: five clients given one relay
each and left undisposed hold five timer handles, which disposing clears — one per render, until it
fires.

**"There is no way to release it on the server" would be a stronger sentence than the measurement
supports, and it is not the one this decision rests on.** `onDestroy` _does_ run under
`svelte/server` at 5.56.8 — so a release was writable, and this was not an impossibility. What it
does not survive is a child that throws: the renderer runs its cleanup only after collecting a
subtree's content successfully, so an abandoned render keeps its handle. Measured, with the provider
changed to build a transport unconditionally and release it in an `onDestroy`: the ordinary render
came out even and the throwing one left one `Timeout` behind — the same unbounded count wearing a
rarer trigger (`SS3`, `SS4`). So an `onDestroy` is a mitigation, and the decision is A12's: on the
server the transport has no use, so there is nothing to release.

**"Bounded per render" is not bounded.** The lifetime of one is finite; the number alive at an
instant is concurrent-requests times that lifetime, which nothing bounds. And a resource outliving
the render contradicts C6 itself — the provider owns the connection and frees it with its own
lifetime — while A12 has already removed the only thing a connection is for on the server. So the
trade was for nothing, in both directions.

**The rule, in the terms the two decisions divide between them.** `NostrApp` creates a
provider-owned **live** transport in the browser only. On the server it derives and validates the
relay scope and nothing else: no socket, no REQ, no reconnection, and **no transport-derived
resource left alive when the render returns**. SSR diagnostics still answer with the **whole** relay
map taken from the accepted scope — every relay, its `read` and `write`, and `initialized` for a
connection nothing has reported on. **A12 keeps its half** — a request on the server is not started
and reports not-asked — and **C6 takes this one**: because of that, there is no transport worth
owning there either.

**What the rule does not forbid, said in words rather than left to a reader.** The scope derives its
relay names by asking a transport what it calls them. Those are **probe** transports: they open no
socket, they are handed a list and read back a map, and they are disposed in a `finally` on both the
accepted and the refused path. They are not a live connection and the rule is not about them — which
is why refusing a relay list still works identically on the server, and why `C16-C4` keeps its arms.

**They do arm the dependency's timers while they live**, measured — one per relay, cleared by the
disposal — and a render probes several times. That is why the rule above is written about what
**survives** the render rather than about what is started during it: the flat form said no transport
timer is started at all, which is false, and was here until somebody counted.

**The claim that made it look like a trade was false.** This paragraph said the price of not
connecting is a server-rendered diagnostics list with no relays in it. It is not: the map is built
from the accepted scope's relays, in the scope's order, and a relay with no status entry reads
`initialized`. Without a transport the SSR output keeps the whole map — every relay, its `read` and
`write`, the refusal channel — and loses only what a socket could have said. **So `C6` gains the
rule below**, and the probe transports the scope derives its names with are not what it forbids:
they open no socket and are disposed in a `finally`, which is the distinction the rule has to draw
in words rather than leave to a reader.

**On a later change of the prop, the provider keeps the generation it has.** It does not throw,
because throwing from inside the effect that reacts to a prop runs the boundary's teardown over the
provider's own subtree — the client, the clock and every in-flight request go with it, and "the
previous generation survives" would be false of exactly the path it was written for. So the refusal
is caught, the previous scope and client stay (the same objects, not equal ones), and **the error is
published on the diagnostics hook** beside the relay map rather than inside it, since a refused list
has no relays to key it by.

**One refusal is published, not a history**, and the choice is between two failures rather than
between a feature and its absence. A history is unbounded in the length of a session, and the thing
it would be used for — _which_ of my edits was bad — is already answered by the prop that produced
it, which the consumer holds. What last-write-only loses is a refusal that is overwritten by a later
one before anybody reads it, and that loss is real: two bad lists in two frames publish one error.
It is taken because the alternative publishes a lifetime — how long entries live, when they are
dropped, whether reading clears them — which is the same argument that keeps the connection off the
props, and because the value being read is _the current state of the provider_, not a log. A
consumer who needs a log has the boundary and the prop.

**It clears when a later list is accepted**, and — while the provider stands — only then. A consumer
who fixes the prop sees it go; a consumer who re-sets the same refused list sees it refused again,
because the comparison that refuses is against the generation in force rather than against the last
thing tried.

**The qualifier is the exception the teardown makes**, and this sentence stood unqualified for a
commit after the rule it states had gained one: provider teardown discards the refusal with the rest
of the record, so a result held across it answers no complaint rather than an old one about a relay
list nobody can change. The sweep that added the qualifier reached the catalogue row and two library
comments and not this line — **which is the half that matters**, because the comments leave with the
spike and this record does not. An exclusion is two claims, and one witnessed only where the value
is kept cannot tell a missing exception from an exception nobody wrote down.

**Why the hook and not a callback prop.** A callback publishes a lifetime — when it is called,
whether it is called again on the same failure, what happens to a handler that changes between
renders — and the same argument that keeps the clock and the query client out of the props applies.
The hook is a read of provider state, which is what this is, and it is already the shape every other
provider-owned observation takes here.

**One class with a discriminant, not one class per cause.** A consumer's responses differ by cause —
merge the configuration, choose the URL differently, pin or upgrade the dependency — so the cause
has to be discriminable. Publishing five internal subclasses would tie the surface to how the
boundary happens to be split today; publishing one class with a `code` leaves that free. **The
internal error types stay internal** and are the thing that carries the detail into it.

**What this costs is a published surface that grows, and the union is closed.**
`RelayConfigurationError` and its code union are a long-term API. A code cannot be removed — and
**adding one is a breaking change too**, because the point of a discriminant is that a consumer can
switch on it exhaustively, and a member that appears in a minor turns every exhaustive switch into a
runtime surprise. The alternative is an open type that forces every consumer to carry a default
branch for ever; this record chooses the closed union and pays for it by adding members only at a
major.

**It has gained one since this was written**, and the rule decided it rather than being weighed
against: `transport-incompatible`, for a transport that cannot give exactly one usable name for one
relay. **That addition cost nothing because none of this has shipped** — the redesign is unreleased,
so there is no consumer whose exhaustive switch it could break — and saying so is the point: after
the first release, an addition of this kind waits for a major, and a cause that cannot wait is a
cause this record got wrong. The code beside it tells a consumer to rewrite their relay list, which
is the wrong instruction here — and it was being given, because the "one relay, several names" case
was reported as a mismatch until r32.

**Named for the remedy rather than for the fault, which is the decision worth carrying to a port.**
The first name for it was `transport-key-not-a-name`, and that would have needed a sixth member for
the next fault a consumer answers the same way. The union grows with _remedies_; the faults live in
the message.

**What is reachable through the published path today, said plainly.** The transport this library
ships asks rx-nostr and returns `Object.keys()` of its status map, so the elements are structurally
strings: the arm that produces a non-string injects at the internal `TransportKeys` seam. What a
consumer's tree can actually produce is the version-drift case — a resolved rx-nostr inside the
declared range whose naming or status map differs from the one these records were measured against —
which is the same remedy and now the same code. That is the price of a consumer being able to tell
them apart, and the alternative — matching on message text — is an API nobody wrote down and
everybody would depend on.

### What a consumer holds

```ts
// **What a hook hands out is this library's own copy of the event, frozen.**
// `readonly Nostr.Event[]` — which is what stood here — makes the *array*
// readonly and leaves every element mutable, including `tags: Tag.Any[]`. So
// `state.events[0].content = '…'` and `events[0].tags.push(…)` type-checked with
// no cast, reached the object in the shared cache, were visible to every other
// hook on the same key, and survived `refresh()`. Measured end to end.
//
// The contract is **not** "mutating throws" — that is one host's way of
// refusing, and pinning it here would make an implementation detail permanent.
// It is: *a change to a published event reaches neither the cache, nor another
// hook, nor a later projection; the published type does not permit one, and at
// run time the event and its tags are immutable.*
//
// The copy is taken **before the verifier sees the event**, which closes a
// second hole: the verifier was handed the wire's object and the same object
// was stored afterwards, so an event mutated while verification was in flight
// made "what was verified" and "what was stored" two different values. 0002
// records that ordering and 0003 the cache's invariant.
// **Written out rather than derived from the dependency's type.**
// `Readonly<Omit<Nostr.Event, 'tags'>>` was the first form and it published
// whatever `nostr-typedef` adds next — a new field upstream would appear on
// this surface while the copy went on carrying the eight it knows, so the
// declaration and what a consumer receives would drift apart with no change in
// this repository. These are NIP-01's fields; `ots` is deprecated upstream and
// still on the wire.
interface ReqEvent {
  readonly id: string;
  readonly sig: string;
  readonly kind: number;
  readonly pubkey: string;
  readonly content: string;
  readonly created_at: number;
  readonly tags: readonly (readonly string[])[];
  readonly ots?: string;
}

// The five states, written out rather than left to the slot table. `incomplete`
// is the one the four could not express, and the non-empty list is why: with
// several relays a timeout, a refusal and a leg end can hold at once, and a
// single cause is a presentation decision stored as a fact (0003).
// **`readonly` on every member of every variant**, discriminants included: the
// values are frozen, and a type that permits a write over a frozen value is
// legal-looking code that fails only at run time — the state this record refuses
// a few lines above. The unions were the half the rule missed when it was
// applied to the containers; `LK16` counts them now.
type ReqState =
  | { readonly status: 'loading' }
  | { readonly status: 'streaming'; readonly events: readonly ReqEvent[] }
  | {
      readonly status: 'settled';
      readonly events: readonly ReqEvent[];
      // Whether the request ever accepted an event, which is what `nodata`
      // rests on and what an empty list cannot answer (C12). Published rather
      // than kept inside a component: a consumer calling `useReq` directly has
      // to be able to reach the same judgement, and hiding it would rebuild
      // C12's defect for them. See below for what it promises.
      readonly hasMatchEvidence: boolean;
    }
  | {
      readonly status: 'incomplete';
      readonly events: readonly ReqEvent[];
      // `IncompleteCauses` is the non-empty list, spelled as the type that
      // ships rather than expanded here: the record and the shipped type are
      // compared exactly (`LK13`), and an expansion that is merely equivalent
      // is how a record starts describing a type instead of stating it.
      readonly causes: IncompleteCauses;
      // The same incompleteness the causes name, in the shape the error slot
      // takes — and carried here so that it can be *one object* (C15). The slot
      // mapping and the diagnostics both read this field; both used to build
      // their own, which made the published Error churn on every read.
      readonly error: IncompleteError;
    }
  | {
      readonly status: 'error';
      readonly events: readonly ReqEvent[];
      readonly error: ReqStateError;
    };

type RefreshOutcome =
  | { readonly kind: 'complete' }
  | { readonly kind: 'incomplete'; readonly causes: IncompleteCauses }
  | { readonly kind: 'error'; readonly error: RefreshOutcomeError }
  // **The call was made and something that is not a failure ended it.** A
  // consumer's root released, or the provider disposed while the call was in
  // flight. The bound is stated: what moves here is the *lifecycle*, a failure
  // the attempt answered is still `error`, and a caller's own exception is not
  // promised never to reject.
  | { readonly kind: 'cancelled'; readonly reason: 'consumer-released' | 'provider-disposed' }
  | {
      readonly kind: 'not-started';
      // Four "nothing was asked"es with four remedies: the side the render is
      // on, the provider's readable list — or a request that named an empty
      // target set on purpose — the consumer's own plan, which they change by
      // asking, and a handle whose root was released, which nothing revives
      // (`C11-C19`).
      readonly reason: 'server' | 'no-readable-relay' | 'deferred' | 'released';
    };
```

```ts
// The request axis of the diagnostics. `LegEnd` is one shape and not three,
// and the narrowing is the decision rather than an accident: a forward leg
// only ever ends by dying. A relay refusing at the protocol level neither
// errors nor completes the subscription (measured), and a backlog that ran out
// or was refused is not a *leg* ending — that is completeness, and it reaches a
// consumer through `ReqState.status` and its causes. What the reduced per-relay
// answer looks like inside stays inside: it is the engine's machine's shape,
// and not publishing it is the whole of what keeps it free to change.
type LegEnd = { readonly kind: 'ended'; readonly error: RelayLegError | undefined };

// **What the failure channel publishes, and it is a shape rather than a class.**
//
// `code` exists because `instanceof` cannot be trusted: a duplicate install —
// two copies of this package in one tree, which pnpm and a monorepo both produce
// — hands a consumer an object whose prototype is not the one their `instanceof`
// names, and a string comparison survives that. **For a round the channel was
// declared `Error`, which made that unreachable**: `state.error.code` did not
// compile, so the only type-safe route to `code` was
// `state.error instanceof ReqFailure && state.error.code`, through the mechanism
// `code` was introduced to replace. The same declaration made the
// deep-`readonly` promise unreachable — `state.error.message = '[redacted]'`
// type-checked — because the `readonly` re-declarations were on the classes and
// `Error` is what the channel said it handed out. `LK18` compiles a consumer
// against the emitted declarations and reads both.
//
// So the channel publishes a **structural discriminated union**. Every variant
// carries a literal `code`, so `switch (state.error.code)` narrows with no class
// in sight; a port owes the *shape* rather than this library's inheritance; and
// every member a consumer can reach — `message`, `name`, `stack` and `cause`
// among them — is `readonly`.
//
// **A new internal cause does not get a new code.** A code exists to tell a
// consumer to do something different: a cause with the same remedy takes an
// existing code, and one that cannot be classified takes `unspecified`, which is
// permanent. There was a second such home, `internal-failure`, and it is gone:
// after its four meanings went where they belonged nothing produced it but a
// defensive arm. Adding a member to any union here is a
// **breaking change** — an exhaustive `switch` in a consumer stops compiling.

// **Derived from the variants rather than declared beside them.** It was its own
// literal union with a value list and a door map kept in step, and a tenth
// member could join all three while no variant carried it: the checks passed and
// `ReqError['code']` did not have it. One source of truth, and it is the union.
type ReqErrorCode = ReqError['code'];

// **Every member is written out, and that is deliberate rather than untidy.**
// Nine variant interfaces and two bases were exported; none of them is a name a
// consumer needs, and a published name is a SemVer surface that cannot be taken
// back — `Extract<ReqError, { code: … }>` writes down any part of the union, and
// `Pick<ReqError, 'name' | 'message' | 'stack' | 'cause'>` writes down the
// common part. A published type that *names* an unpublished one hands a consumer
// something they cannot spell, so a shared base would have to be published to be
// referenced. Repetition is what "self-contained" costs.
//
// **And nothing here intersects `Error`.** It did, so that the union would read
// as "an `Error` with more on it" — and an intersection keeps `Error`'s
// *mutable* `message` beside the `readonly` one, which TypeScript resolves in
// favour of the assignment: `state.error.message = '…'` compiled again, which is
// the failure `LK18` exists for. What a consumer holds is an `Error` at run
// time; what the type promises is the shape.
//
// **`provider-disposed` is a rejection, not a state.** It reached `state.error`
// and the outcome for a round, because the machine held the client and could
// only learn of the disposal by using it. What the provider hands out now is a
// **capability, not the client**: the request path — `requestTargets`, the
// machine, the stream — takes operations, and no expression anywhere yields an
// `RxNostr` a caller can keep. Disposal is one linearised operation: revoke,
// cancel the running attempts — a `refresh()` still outstanding resolves
// `{ kind: 'cancelled', reason: 'provider-disposed' }` — and dispose last
// (`0005`'s `C11-C17`). What rejects with this code is a `refresh()` called
// *after* the teardown; a request cannot fail with it, because after the revoke
// there is no request to fail.
//
// **A lease that handed the client back would not buy this**, and one did for a
// round: `claim()` returned the raw `RxNostr`, so revocation changed only the
// *next* answer and the borrow already taken went on working. The reviewer's
// counterexample was three lines long.
//
// **And a client the *caller* owns is a different event.** Someone who hands the
// spike's low-level seam an `rxNostr` and then disposes it has not lost a provider —
// there is none to remake — so what they are told is that the seam they gave is
// unusable: `invalid-descriptor` on the field `rxNostr`, from the initial
// request and from `refresh()` alike. The two were one condition for a round,
// which put two classifications on one ownership event.
//
// **The captured members correlate `source` with `code`**, so a consumer who has
// narrowed on one has narrowed on the other.
type ReqError =
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'incomplete-result';
      readonly incompleteCauses: IncompleteCauses;
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'invalid-descriptor';
      readonly field: string;
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'unsupported-filter';
      readonly field: string;
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'relay-not-in-scope';
      /** The target, in this library's canonical spelling. */
      readonly url: string;
      /** Configured on the provider but not readable, rather than absent. */
      readonly configured: boolean;
    }
  // **`attempt-abandoned` was a member here and is gone.** It was what
  // `refresh()` rejected with when the thing waiting for the attempt went away —
  // a consumer navigating off a slow feed, an attempt replaced by a later one on
  // the same request. Nothing failed there, and putting it on the rejection
  // channel made `onclick={() => handle.refresh()}` produce an unhandled promise
  // rejection for it. It is a `RefreshOutcome` now: `{ kind: 'cancelled', reason:
  // 'consumer-released' }`. The class that carries the abort reason still exists,
  // because a signal needs one; what is gone is its membership of this channel.
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'accumulator-contract';
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'provider-disposed';
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly code: 'missing-provider';
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly thrownName: string;
      readonly truncated: boolean;
      readonly source: 'descriptor';
      readonly code: 'descriptor-unreadable';
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly thrownName: string;
      readonly truncated: boolean;
      readonly source: 'relay';
      readonly code: 'relay-failed';
    }
  | {
      readonly name: string;
      readonly message: string;
      readonly stack?: string;
      readonly cause?: ReqError | undefined;
      readonly thrownName: string;
      readonly truncated: boolean;
      readonly source: 'unspecified';
      readonly code: 'unspecified';
    };

type ReqStateError = Extract<
  ReqError,
  {
    readonly code:
      | 'invalid-descriptor'
      | 'unsupported-filter'
      | 'relay-not-in-scope'
      | 'descriptor-unreadable'
      | 'missing-provider'
      | 'accumulator-contract'
      | 'unspecified';
  }
>;

/** What `status: 'incomplete'` carries: the partial answer's own error. */
type IncompleteError = Extract<ReqError, { readonly code: 'incomplete-result' }>;

/**
 * What `RefreshOutcome`'s `{ kind: 'error' }` carries.
 *
 * Narrower than `ReqStateError` because a descriptor refusal never gets here:
 * `refresh()` throws it, so the caller sees a rejected promise rather than an
 * outcome. That difference is the one a consumer most needs, and the types are
 * where it is said.
 */
type RefreshOutcomeError = Extract<
  ReqError,
  { readonly code: 'accumulator-contract' | 'unspecified' }
>;

type ReqOutletError = ReqStateError | IncompleteError;

/**
 * What `diagnostics.lastError` carries.
 *
 * The same set as the slot today, and written separately because it gets there
 * another way: the value's own failure record, the entry's error, or the partial
 * answer's error when nothing threw.
 */
type ReqLastError = ReqStateError | IncompleteError;

/**
 * What a forward leg's end carries: **one code**.
 *
 * It was two. `internal-failure` was in this union because the machine names the
 * reason itself when every relay in scope stops — and `endForward` puts every
 * reason through the relay door, which re-derives anything that did not come
 * from a relay. Measured, on all nine codes the union had then: what reaches
 * `legEnded.error` is `relay-failed`, always. A union member no path can produce is a promise a
 * consumer can branch on and never see taken.
 */
type RelayLegError = Extract<ReqError, { readonly code: 'relay-failed' }>;

// **There is no published recognition guard, and its absence is a decision.**
// There was one, sold for `catch (value: unknown)`. It read `code` alone, so
// `{ code: 'unsupported-filter' }` narrowed and the consumer's
// `value.field.toUpperCase()` compiled and threw. Checking the members each code
// requires closed that, and a reviewer then found two more stable
// counterexamples — `stack: 42`, and an `incompleteCauses` of strings that are
// not `IncompleteCause` literals — because a guard and a union are two
// hand-written descriptions of one shape. What this library publishes is already
// typed, so the discriminant a consumer needs is `state.error.code`.
//
// **Ruled to change: the lifecycle cancellations leave this channel.** An
// ordinary navigation is not a failure, so `attempt-abandoned`, and a
// `provider-disposed` that lands under a call already outstanding, move to the
// resolved value —
//
//     | { kind: 'cancelled'; reason: 'consumer-released' | 'provider-disposed' }
//     | { kind: 'not-started'; reason: 'released' | 'deferred' | 'server' | 'no-readable-relay' }
//
// — so `onclick={() => handle.refresh()}` stops producing an unhandled rejection
// for a case where nothing went wrong. **The promise is bounded and says so**:
// what moves is the enumerated lifecycle cancellations, not caller errors and not
// unexpected exceptions, and `refresh()` is not promised never to reject. **And
// the union shrinks with them**: if `attempt-abandoned` and `provider-disposed`
// then reach no published channel, their `ReqError` variants are deleted rather
// than left as members a consumer can branch on and never receive.
// `attempt-abandoned` reached none and its variant is gone; `provider-disposed`
// still reaches the rejection of a `refresh()` called *after* the teardown, so
// it stays.
//
// **And what `refresh()` rejects with is a runtime contract, not a published
// type.** A promise's rejection has no place in a TypeScript signature, so an
// exported alias for it buys a consumer nothing they can hold. The set is
// **`invalid-descriptor`, `unsupported-filter`, `relay-not-in-scope`,
// `descriptor-unreadable`, `missing-provider` and `provider-disposed`**, one
// witness per code: `RM4`, `RM1`, `RM28`, `RM11`, `RM26` and `RM8` in that
// order; `attempt-abandoned` left it with the lifecycle cancellations. The list
// used to name four arms for five codes and two of them produced neither —
// `descriptor-unreadable` had no rejection witness at all. `missing-provider`
// joined when the code did, and its cell in `0005`'s matrix was `—` for a
// commit while `RefreshRejection` already listed it: the refusal is built by the
// seam `refresh()` re-enters, so it reaches this surface as well as the state,
// and `RM26` drives both.
//
// **What v1 gives up by not publishing it.** A consumer cannot write an
// exhaustive `switch` over a rejection as a *type*: `catch (value: unknown)` is
// where a rejection arrives, and narrowing it means reading `code` off an
// `unknown`, which is an unsafe read this library does not make safe. That is a
// real usability cost and it is taken deliberately — a parser or a type guard is
// a second hand-written description of a shape the union already carries, and
// `isReqError` was removed for being exactly that. The six codes are still a
// **behaviour** contract: changing which of them a call can reject with is an
// observable change to a consumer who branches on `code` at run time, and it is
// governed like any other. If type-safe branching on failures becomes a product
// requirement, the first thing to reconsider is not a parser but whether the
// expected failures belong on `RefreshOutcome`, which is a value and is typed.

// **`message` is the thrown value's own, bounded** — its `.message` when it has
// a string one, and this library's rendering of it when it does not. Read that
// way round on purpose: a `Proxy` can refuse `getPrototypeOf` while answering
// `.message` perfectly, and what a refusal wants to quote is what it said.
//
// **Capturing what this library already made returns it unchanged**, which is
// what makes `state.error` and `diagnostics.lastError` one object: the failure
// is captured once where it happens and the record carries that object to both
// surfaces. The tempting optimisation — memoising on the *thrown* value so two
// captures give one snapshot — is a defect that shipped and was removed: it made
// `source` a fact about where an object was first seen, so an Error re-thrown
// from a relay after a descriptor refusal was published as `descriptor`.
//
// **No class on this channel is constructible by a consumer to any effect.**
// Ownership is minted where *this library* constructs a value, not in a
// constructor: the published classes' constructors are public, so a consumer
// could build one, attach their own graph and throw it at a filter getter — and
// have it published unchanged, with their `code` and their live object on
// `cause`, and this library freezing their object on the way out. Measured end
// to end through the hook. What a consumer constructs is foreign here, and is
// copied like anything else.

interface ReqDiagnostics {
  // The most recent failure, until a *later* attempt that ends supersedes it. The
  // name and the lifetime have to agree, and for a while they did not: a
  // failure a retry has not answered yet is still the most recent failure there
  // has been, so the retry starting cannot be what clears it. See above.
  //
  // Not the argument the error slot is handed, which is derived from the state
  // (see the slot mapping). An incomplete answer with nothing thrown reports an
  // `IncompleteResultError` here as well, because then the answer coming back
  // partial *is* the most recent thing that went wrong — but when an attempt
  // answers incompletely and then throws, this is the throw and the slot's
  // argument is the incompleteness, deliberately.
  readonly lastError: ReqLastError | undefined;
  readonly legEnded: LegEnd | undefined;
  readonly refusals: readonly Refusal[];
}
```

**The channel is a same-realm, in-memory contract, and serialization is out of scope for v1.**
`JSON.stringify` of a published failure drops `message` and `stack` — they are non-enumerable own
properties of `Error` — and keeps `name`, `thrownName`, `source`, `code`, `truncated` and `cause`,
which is the trap: it looks complete. `structuredClone` is worse and it is worth writing out,
because "the worker boundary is where `instanceof` fails and `code` still works" is exactly the
sentence somebody will reach for: the clone is a base `Error` with `name: 'Error'` and **no `code`,
`source`, `truncated` or `thrownName` at all**. Any serializer does this. A consumer who needs a
failure to cross a boundary copies the fields they need; a port that promises more owes a
serializer, which this record does not.

### Every way a failure enters, and what a consumer is handed

**A port that implements this channel implements this table**, and a code is justified by the last
column: if two rows would send a consumer to the same remedy, they share a code. Nothing here is a
taxonomy of the library's internals.

| Where it enters                                                                                                                                          | `code`                  | Beyond the base                            | Which surfaces carry it                                                              | What a consumer does                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| A descriptor field this library refuses — including, at the internal seam v1 does not publish, an `rxNostr` **the caller owns** and disposed (`C11-C18`) | `invalid-descriptor`    | `field`                                    | `state.error`, `lastError`, the `error` slot, **and what `refresh()` rejects with**  | fix the field it names                                    |
| A filter field it does not support, or cannot accept as written                                                                                          | `unsupported-filter`    | `field`                                    | the same four                                                                        | change the filter                                         |
| Anything **thrown** below the seven guarded descriptor reads — a filter element getter, `scope.id`                                                       | `descriptor-unreadable` | the captured four, `source: 'descriptor'`  | the same four                                                                        | their own code threw; the copy quotes what it said        |
| A descriptor's `relays` names a relay the provider does not read from                                                                                    | `relay-not-in-scope`    | `url`, `configured`                        | the same four                                                                        | name a relay the provider reads, or configure it there    |
| No provider above the hook                                                                                                                               | `missing-provider`      | —                                          | the same four                                                                        | put the tree under a provider                             |
| A relay or the transport gave out                                                                                                                        | `relay-failed`          | the captured four, `source: 'relay'`       | **`legEnded.error`, and nothing else**                                               | retry, or look at the relay                               |
| The answer came back partial                                                                                                                             | `incomplete-result`     | `incompleteCauses`                         | `status: 'incomplete'` and its slot; `lastError` when nothing threw                  | refresh, widen the settle timeout, or render what arrived |
| An accumulator broke the contract this library folds through                                                                                             | `accumulator-contract`  | —                                          | `state.error`, `lastError`, the slot, **and `RefreshOutcome`'s `{ kind: 'error' }`** | fix the accumulator                                       |
| A `refresh()` called after the **provider** revoked the transport it owns — a call the revoke lands under resolves `cancelled` instead                   | `provider-disposed`     | —                                          | **only what `refresh()` rejects with**                                               | this handle will not recover; make a new provider         |
| Anything the query rejected with that is none of the above                                                                                               | `unspecified`           | the captured four, `source: 'unspecified'` | `state.error`, `lastError`, the slot, **and the outcome**                            | read `message`; the library cannot attribute it           |

**This table and the six surface aliases are the fixed v1 contract.** Six, and the count said seven:
the seventh column — what `refresh()` rejects with — has no published alias, which is a decision
this same record now states two paragraphs up. A count written beside the decision that falsified
it. A port implements _this_ matrix — the same reachable cells, the same empty ones, the same
exported aliases — rather than measuring its own. The aliases are exported, so they are API and not
a description of one implementation's paths, and a published union whose membership depends on who
implemented it is one a consumer cannot write a `switch` against. What a port is free to choose is
how it gets there; `0005` carries the two contracts that make the freedom safe — `A11`'s
postcondition on accumulators, and the disposal linearisation the provider owes.

**Two remedies are the library's rather than the consumer's in v1, and the column says so rather
than pretending.** "Fix the accumulator" and the clause about a caller-owned `rxNostr` are both
actions only somebody holding a seam can take, and `A16` keeps every seam inside the provider: an
accumulator is not on the descriptor, and neither is a client. So for a v1 consumer those rows say
_report it_ — the library or its port broke a contract it holds — and they are kept with their own
codes rather than folded into `unspecified` because the library **can** attribute them, and because
the day `A11`'s escape route is published the remedy becomes the consumer's without the code moving.
An adversarial pass measured the mismatch against this table's own rule that a code is justified by
its remedy.

**Read the fourth column, because it is the half a table like this usually gets wrong.** Every cell
above is measured, and four of them were wrong when they were written from the class list instead of
from the paths: `attempt-abandoned` was recorded as reaching `state.error` and `lastError` and
reached neither — it is an `AbortSignal` reason, and the one reader that published it was
`refresh()`'s rejection, which it has since left for the resolved `cancelled` outcome (ruling 5);
`internal-failure` was recorded as reaching `legEnded.error`, which no value can, because every
leg-end reason goes through the relay door; `relay-failed` was recorded as also reaching
`state.error`, which it does not with either accumulator this library ships, since a relay giving
out writes a leg record and the answer comes back **incomplete** rather than failed; and the three
descriptor codes omitted the rejection, which is the second, deliberate publication point.

**The distinction a consumer most needs from this table is rejects-versus-resolves.** `refresh()`
**rejects** for a descriptor refusal, a missing provider and a call made after the provider is gone;
it **resolves** `{ kind: 'error' }` for an accumulator's contract and for anything unattributable,
and `{ kind: 'cancelled' }` for an abandoned attempt and a provider disposed under the call. A
caller who awaited it inside a `try` sees the first three there and has to inspect the outcome for
the rest.

**`unspecified` is the complement, not a tenth entrance.** It is the permanent home for a cause this
library cannot attribute, and a new internal cause maps into it rather than growing the union,
because **adding a member is a breaking change** — an exhaustive `switch` in a consumer stops
compiling. There was a second such home, `internal-failure`, and it is gone: it had collected a
relay that went away, a disposed provider, a missing verifier and a teardown note — four remedies —
and once each went where it belonged the only thing left producing it was a defensive arm. A code
with no concrete entrance is a member a consumer can branch on and never reach.

**Two things that are deliberately not on this table.** A request with no signature verifier is a
wiring error, not a request failure: it is `MissingVerifierError`, and its `code` is not a
`ReqErrorCode`. **That class is not exported — `LK2` and `SUR10` both say so now — and this
paragraph said it stood beside `MissingProviderError` in the entry.** It does not: a consumer under
a provider cannot reach it, because the provider is what supplies the verifier, and the only
entrance is the low-level seam this API does not publish — and which `0002` A16 decides v1 does not
keep internally either. **What a consumer without a provider meets is not this class**, which the
sentence used to leave implied and an adversarial pass read the other way: the request refuses with
`missing-provider` before a verifier is looked for, so the path that could have reached this one is
closed one step earlier. In v1 there is no entrance. A name a consumer can never need is a SemVer
surface taken on for nothing. And the abort reason for a query function that returned while it was
still streaming is a private teardown note that reaches no published surface — the _published_
failure for that case already has a code (`accumulator-contract`), and giving the cleanup mechanism
one too would classify the same event twice.

**`hasMatchEvidence` is published on purpose, and it is a promise about the request rather than
about the cache.** It is `true` once this request has accepted an event, in A-ε's sense of the word
and not a paraphrase of it: A-ε defines `accepted` in **two** clauses — past the signature gate, and
past it **before the wait the event's leg belonged to ended** — and those two are the whole of it.
It does not go back to `false` because the value later dropped what it accepted.

**This paragraph carried the word in three clauses, and the third was "one its filters asked for".**
That is a true sentence about which arrivals can become evidence and not part of the definition, so
stating it here was the paraphrase the one-term-one-definition-site rule exists to stop — the same
shape as the round in which this record defined the field without A-ε's timing clause and nothing
could see the disagreement. It is redundant as well as out of place: an event this request's filters
did not ask for is dropped by rx-nostr before it reaches the gate, so it never passes one. The
provider takes three configuration options and `skipValidateFilterMatching` is not among them
(`WR13`), so nothing here turns that check off.

The two-clause sentence is what a future accumulator inherits: A11 keeps the accumulation swappable,
so the field cannot mean "this `Map` is non-empty", and an implementation that stores nothing,
projects from elsewhere or evicts under pressure still owes the same answer. Today's engine derives
it from the stored set, and the derivation is sound rather than assumed: the fold only adds or
replaces, the bound keeps `min(retain, size)` with `retain` at least 1, and `retain: 0` is refused
before a REQ goes out, so no bound can empty a set that accepted anything (`EV1`, `EV3`).

**A port condition, and it is about how that soundness is held rather than whether it holds.** The
spike derives the field from `entries.size > 0`, so its monotonicity is a **conjunction of three
separate invariants** — `retain` is at least 1, `retain: 0` is refused before the REQ, and the
current fold never empties a set that has been non-empty — held in three places, none of which names
this field. What is promised above is monotone evidence about the **request**; what is stored is an
accumulator's storage, and A11 says that storage is swappable. So the promise survives today by
agreement between parts that are free to move independently: an accumulator that evicts, a bound
that later admits zero, or a fold that replaces rather than adds would each break it. **This
paragraph said "silently, and only `EV1` and `EV3` would notice", and that was measured too
pessimistic.** Moving the derivation from what is stored to what is projected — the exact shape "an
accumulator that evicts" names — turns `X8`, `EX6b` and `P9` red on both adapters, and those are
`C12-C4`'s witnesses. **So the field's value at a single settled read is contracted.** What is not
contracted is its value across two reads of one request: no row reads the field twice, so a port
that recomputes evidence per attempt satisfies every row and loses the promise. That is the half
this condition is about, and `C12-C7` is the row that carries it.

**The reason it is a condition on the port rather than a defect here is structural, and stronger
than "the invariants happen to hold".** The cached set carries no per-attempt attribution for its
entries — nothing on it records which attempt accepted a packet — so "what _this_ attempt found" is
not expressible over the value without adding a field to it. The spike's evidence is monotone
because its accumulator has no way to be otherwise; expiry hides entries at the projection rather
than removing them, and the fold only adds or replaces. **A port whose accumulator does have a way
inherits `C12-C7` and nothing else to hold it**, which is measured rather than supposed: clearing
the set when an attempt begins leaves `C12-C4`'s three witnesses green, because not one of them
refreshes. **The production implementation should carry an explicit monotonic bit on the cache
value** — set when the request first accepts an event and never cleared — so that the field is
correct by construction under any accumulator rather than by a compound invariant that a swap can
falsify. This does not block accepting the records: what they promise is already the right thing,
and the three invariants do hold on this tree, measured. It is a condition on the port because the
argument for the spike's derivation is an argument about today's accumulator, and the port is where
that accumulator changes.

The alternative was to keep it inside the components and let `useReq` consumers do without. That is
the same defect C12 names, moved: a consumer holding the state cannot tell "asked and told nothing
exists" from "accepted four and can show none", so their own empty-list branch renders "Nothing
found" over a request that found something. The cost of publishing it is that B-θ's silence is
narrower than it was — an empty answer now says whether anything was found — and 0003 records that
narrowing rather than letting this field outgrow it quietly.

**What `false` does not mean is that no relay sent anything.** An event whose signature the verifier
rejects, and an event the request's own filters did not ask for, are dropped and are not evidence:
measured, both reach `settled` with `false` and the `nodata` slot (`EV2`). **A third route reaches
the same place and is the one the boundary clause above is for**: a matching event admitted to the
forward gate and still being verified when that leg's wait was cut is discarded, and the verifier
answering `true` afterwards changes nothing. Measured — the answer is `settled` with no events,
`false`, and `nodata`, and it is indistinguishable from the same request with no event ever sent
(`EV4`). The discard is reported by `legEnded` and by nothing finer; 0002's A-ε is where that
silence is decided and what would falsify it. Counting arrivals instead would let any relay turn a
truthful "nothing found" into a blank `default` slot by sending one unverifiable event, and a claim
about the world that a hostile peer can suppress is worth less than the claim C12 asked for. It is
also the only reading under which the field is honest for every accumulator, because what an
accumulator sees is what the request accepted.

`error` carries `events` and they are always empty today. The field is there so that every state but
`loading` answers "what do I show" the same way — a consumer should not have to ask which shape it
is holding before reading the list. A failure over data already on screen does not reach this state
at all; it stays on the diagnostics axis, which is C5.

**"On screen" is read at the same instant the state is, and C5 and C13 cross there.** The events
that keep a failure on the diagnostics axis are the ones the projection is showing, not the ones the
cache is holding: an event that has passed its deadline is not on screen, so a failed request left
with nothing but expired events is `error` rather than `streaming` over an empty list. Read the
other way it is a spinner over a request that has failed and stopped — nothing displayable, nothing
being fetched, a failure recorded, and the `loading` slot — which is the state C5's error branch
exists to prevent, arrived at through C13. `C5-C3` is the contract, and 0003 records the round that
read the stored set instead and what it cost.

**The events are on the state, not beside it.** Two independent readers — a status here, a list
there — would let a consumer hold a status from one generation and a list from the next, and the
slot mapping would have no way to tell. One projection, read once, so both describe the same
instant.

**They are `ReqEvent`, not the dependency's packet type.** A packet carries the subscription id and
the relay it came from, and publishing it makes the relay client's representation part of this API —
the same mistake the export list closes for the query library, on the other dependency. If
provenance is wanted later it goes on the diagnostics axis, which is additive; widening the element
type is not.

**There is no `select<T>`.** Publishing one publishes when a selector re-runs, how equality is
decided, what happens when it throws, what it sees across a descriptor change, and how it interacts
with the cache lifetime — which is the operator argument again, in a new shape. If single-event
access needs sugar, a pure helper over `ReqState` can be added without any of that.

### The rest of the published types

**A name on the export list decides that a symbol exists and not what it promises**, which this
record says above the list and then did not do for most of what is on it: seventeen of the
twenty-three published types had no declaration **at the time that count was taken** — the published
**types** are **45** today and the whole surface is **60** names, so the twenty-three is the sweep's
own figure and not a count of anything current.

**The pair said 38/52 for three rounds and matched no tree in any of them.** It was written from a
count taken by eye, restated twice as "unchanged", and the sentence around it claimed it matched
`surface.ts` exactly — which was the part that made it look checked. What it actually counted was
every quoted name inside the `types` block **including the ones in its comments**; three of those
are prose. A figure in a record that nobody re-derives is a figure that rots, and this one rotted in
the direction that flatters. `SUR15` reads these two numbers out of this paragraph and compares them
with `MAIN_SURFACE`, so the next reader gets a failure rather than a sentence. **That arm dies with
the spike, and this paragraph does not**, which is a port condition rather than a detail: a port
that keeps these two figures owes the same check beside its own surface declaration, and a port that
does not want the check deletes the figures with it. A number in a record with nothing reading it is
what this paragraph is about. (It was 45/60, then 44/58, then this: the failure channel's variant
interfaces, both base interfaces, its recognition guard, the captured and rejection aliases and the
two door unions all came off across three rounds, and the surface aliases each published field is
declared with went on.) **The sentence here said "the surface is 30 names" and 30 was the size of
the _types_ group**, not of the surface: a count that names the wrong population reads as
re-derivable and is not. It is kept with that said, because a number a port cannot re-derive is the
failure `0001` names, and the re-derivable one is the list itself in any of these records, so a port
had the name and nothing to read but a spike that does not travel with them. Some were glossed in a
sentence — `RelayConnection` as "the nine socket states", `Refusal` as carrying "the relay, the leg,
the relay's message and the classified reason" — and a gloss is not a shape: it names neither the
fields nor their types, and nothing compares it to anything. Eight were reported by a reviewer; the
other nine came out of counting the list against this file, which is the difference between
repairing an instance and repairing the class. The rule is what the sentence above the list already
implies: **every name published here has its shape here.**

`LK13` is what makes that checkable rather than stated **for the types**, and `LK22` for the hooks —
the split matters because it was not made for four rounds. `LK13` discovers each type this record
writes a shape for, resolves it through the published entry and compares member for member, in order
— so a shape written here wrongly fails rather than misleads, and the block below is inside its
scope by being written at all. What is outside it is said rather than left to be noticed: it reads
type aliases and interfaces, so the **four classes still exported as values** —
`IncompleteResultError`, `RelayConfigurationError`, `MissingProviderError` and
`MissingRandomnessError` — are compared by nothing here. "The two classes" stood in this sentence
after the count reached four, which a reviewer read back to us, and it then said five while the
failure channel's class was being taken off the entry. The number is written once, here, because
`LK17` is what reads them **from the published entry**: the class is exported, and its `code` is
still a literal inside its own emitted body rather than widened to `string`. Both halves were
measured by breaking them.

**A `function` declaration is not a named type shape, and that is the gap `LK22` fills.** `LK13`'s
population is the shapes this record writes for named types; `useReq`'s signature sat here in two
contradictory spellings for four rounds with every surface arm green, because a function is in
nobody's population. `LK22` takes the published hook list as its population — not a name somebody
remembered — after a first version held `useReq` alone and left `useRelayDiagnostics`'s signature
checked by nothing: giving it a parameter it does not take left the whole suite green, measured.

**`LK17` reads the four classes still exported as values, each inside its own emitted body.**
`MissingProviderError`, `MissingRandomnessError` and `IncompleteResultError` carry a single literal
`code`; `RelayConfigurationError`'s is `RelayConfigurationErrorCode`, a union of five that `CF1`
reads cause by cause, and it is read _as the union_. The failure channel is no longer on that list
at all: what a consumer names there is the shape, and `ReqFailure` the class is off the entry.

**Each literal is read inside its class's body because the unscoped search could not decide it.** It
was a substring test over the whole emitted blob, and swapping `MissingProviderError`'s literal with
`MissingRandomnessError`'s left it green; so did widening `ReqFailure.code` to `string`, because one
sibling declaration still mentioned the union. Before that the sentence said "every published class"
while the arm read three, and said `IncompleteResultError` carries no `code` while the
implementation had just been given one — the record, the type and the class disagreeing three ways
at once.

**The four members `Error` gives a published class are `readonly` in the emitted types.** `message`,
`name`, `stack` and `cause` are inherited, so a class that re-declares nothing let
`err.message = '[redacted]'` compile — legal-looking code the run time refuses. `declare readonly`
fields say it in the type and emit nothing into the run time; a merged `interface` says the same
thing and is what `@typescript-eslint/no-unsafe-declaration-merging` exists to stop. `LK16` cannot
see this: it walks a class's _declared_ members, and these arrive from the base.

**And the premise all of it rests on is measured, by `LK19`.** "A duplicate install hands a consumer
an object whose prototype is not the one their `instanceof` names" is the sentence every literal
`code` in this record is justified by, and for a long time nothing ran it. `LK19` imports the module
twice — the same specifier with a cache-busting query is a second evaluation with its own class
objects, which is what a duplicate install _is_ — and reads both halves: `instanceof` is false
across the two copies, and `code` is unchanged. (It read a recognition guard's answer too, until the
guard came off the surface — a sentence about a function that no longer exists is the drift this
paragraph is otherwise about.)

**And none of that decides the sentence it quotes, which `LK18` does.** The expression the
deep-`readonly` promise exists to refuse is `state.error.message = '[redacted]'`, and `state.error`
is not typed as any of those classes — for a round it was typed `Error`, so every class-shaped
assertion here was green while the write compiled and `state.error.code` did not. `LK18` compiles a
consumer against the emitted declarations: branching on `code` must produce no diagnostic, writing
any of the four members must produce `TS2540`, and `status: 'error'` narrowed to
`code: 'incomplete-result'` must not type-check. A check that only asserted failures would pass on a
fixture that fails to resolve its import, so the positive control is part of it.

**`ReqDescriptor` was outside it and is not any more.** The record said the descriptor's shape could
not be written down here because two modules in the spike declared that name — the published one and
the engine's, which carries a transport, a client, a clock, a relay scope and the accumulator seam —
so a shape recorded here would be compared against both and fail whichever it matched. That was a
naming collision, and it was left as the port's to clear. It is cleared: the engine's is
`EngineRequest`, and the shape below is checked like every other.

**What that closes is bigger than a name.** Two hooks that agree on every keyed field and disagree
about anything _outside_ the key share one entry, one attempt and one gate, and which mounted first
decides what both of them read — `OM6` is the measurement, on `verifyEvent`, in both orders,
rostered as `A16-C7`. That is safe only while a consumer cannot spell any of them, and "cannot spell
them" was an argument about the published surface with nothing checking it. **`WR34` is that check,
and naming it is this round's** — the sentence said "it is a check now" and named none, which sends
a port looking for an arm nobody can find. What held the claim until then was two steps with no arm
across them: the published descriptor's fields are pinned and none of them happens to be one of the
complement's. `OF3` is the nearest arm and it measures a different set — the query library's own
options, four of which overlap the complement and eleven of which do not. `WR34` derives both things
a consumer writes, the descriptor and the provider's props, and asserts neither can spell a field
outside the key.

**The list is a complement, and naming four of its members read as naming it.** This said "the seams
— `verifyEvent`, `clock`, `accumulator` — and `environment`", which is four of fifteen. What is _in_
the key is `canonicalKey`'s members: `filters`, `live`, `namespace`, `settleTimeoutMs`, `retain` and
the scope generation. Everything else the spike's option bag carries is outside it.

**One option is in neither set, and it is the one a consumer _can_ spell.** `deferred` decides
whether this hook has a key at all: a plan that is not asking holds one inert entry carrying no
question, so two hooks that disagree about it are not two hooks sharing an entry — which is the
whole of what the complement below is about. `WR31` names it as its own category rather than
counting it outside the key, and holds that the name is still one the seam declares.

**The scope generation is one descriptor field, and the key's relay axis is computed from `relays`
and `scope`** — it is where `relays` is folded rather than a seventh member beside it.
`resolveTargets` answers the scope's own generation when a request names no relays, and the named
set's identity when it does. A separate key member would split a request naming every readable relay
from one naming none — the same effective targets, the same REQ, two entries. `WR31` maps the
descriptor field back to **both** caller names, so neither is in the complement below.

Outside the key, in the spike's option bag: `rxNostr`, `client`, `attempts`, `verifyEvent`, `clock`,
`accumulator`, `environment`, `reqIdBase`, `staleTime`, `refetchOnMount`, `enabled`, `initialData`,
`consumeSignal`, `poisonId`, `passiveAbort` — fifteen, and `WR31` derives them rather than reading
this sentence: it takes the option bag's fields, subtracts what `canonicalKey` folds, and compares
the remainder to the line above. A field added to the bag joins this list until somebody keys it.
`WR19` is a different check with a similar shape — it classifies each field by _how it is read_
(guarded, seam, raw), which is not the same partition and cannot stand in for it.

**What makes the whole complement safe is two sentences, not one.** The published `ReqDescriptor`
below has exactly six fields and every one of them is in the key, so a consumer cannot put anything
on the other side of the line. And where the values on that side come from is **the provider or this
library**, not the caller: `C6` gives a cache one provider, so two hooks sharing an entry are handed
the same six by it — `rxNostr`, `client`, `attempts`, `verifyEvent`, `clock`, `environment` — and
the other nine are spike seams a v1 consumer has no way to set. **They do not all have a library
default standing in, and a first version of this sentence said they did**: `reqIdBase` is a
_required_ option on the spike's hook with no default at all, and `enabled` and `initialData` have
none either — so in the spike two hooks sharing an entry can hold different values for them, and the
first to reach the entry decides what goes on the wire. That is the same hazard `OM6` measures for
the verifier, on three more members. It is out of a v1 consumer's reach for the reason above and not
because the values agree; `0002` records that a port mints the request id itself rather than taking
one. **This said "those are the provider's" of all fifteen**, which is true of six: `accumulator` in
particular is `0001`'s escape route rather than the provider's, and the provider has no field for
it. `OM6` exhibits the hazard by breaking the second sentence: it drives the low-level seam **`A16`
withdrew from v1**, where a request took its runtime from the caller, and puts two such requests
over one client. Nothing a v1 consumer can write reaches that arrangement. A v2 that publishes a
seam breaks the first, at which point the seam joins the key or the design owes a reason it does
not.

```ts
// **What a consumer writes**, and the only published type they build rather than
// read. Six fields: what is asked, whether it stays open, which partition it is
// filed under, how long it waits, how much it keeps, and where it is asked.
//
// **The absences are the load-bearing part.** No transport, no client, no clock,
// no verifier, no `environment`, no attempt registry — those six are the
// provider's — and no accumulator, which the spike calls a required seam and
// defaults to a module constant rather than taking from the provider. All seven
// are outside the cache key, and so are the eight the paragraph above lists
// beside them: this is seven of the fifteen, not the roster. Two requests that agree on these six fields
// *are* the same request, which is what makes one entry for both of them
// correct; if a consumer could spell a seam here, two hooks agreeing on all six
// and disagreeing about a verifier would share one entry, one attempt and one
// gate, and mount order would decide what both of them read.
// **`relays` ships**, and it is one change with three decisions in it: `C3`
// (what `req` was reached for), `C6` (a provider is a resource domain rather
// than an identity) and `B3` (the key uses the set a request is actually asked
// over). A subset field added to the single scope-generation key ruling 15 replaced leaves the
// NIP-65 loop standing, which is why they are one change and not three.
//
// **What it does not buy**: connecting to a relay the provider has not accepted.
// A bare `nevent1…` hint needs a request-scoped lease, diagnostics membership and
// a release rule, and is not v1; an application adds the relay to the universe
// first and moves a deferred plan to an active one.
// **What a consumer hands `useReq`**: a request, or the fact that they are not
// asking yet. A union rather than a field on the descriptor, and the whole
// difference is what cannot be written — a deferred plan carries no descriptor,
// so "not asking, with these filters" has no representation and there is no
// ordering question about validating a descriptor nobody is asking with.
//
// `filters: []` and `authors: []` are **not** this: they are genuine empty-set
// questions, and this library answers them without asking anybody. The waiting
// state of a dependent query — resolve a NIP-05, then load the profile — is
// this.
//
// A deferred plan builds no key for the question it would have asked, no
// attempt and no REQ; it reports `loading` with `activity: 'idle'`; `refresh()`
// resolves `{ kind: 'not-started', reason: 'deferred' }`. Becoming a request
// applies the ordinary mount triggers; going back releases the observer without
// deleting the entry. **What it does occupy is one inert entry per client**,
// shared by every deferred hook, because the query library builds an entry when
// an observer is constructed — a price, stated, rather than a promise of none.
type ReqPlan = { kind: 'deferred' } | { kind: 'request'; descriptor: ReqDescriptor };

interface ReqDescriptor {
  // **The dependency's type, and the one place this surface accepts more than
  // it takes.** `Nostr.Filter` admits `search`, a `since` of `0`, a negative
  // `until`, a fractional `limit` and multi-character tag keys; the boundary
  // refuses all of them with `unsupported-filter`, so this is legal-looking
  // code that fails at run time — the failure this record removes everywhere
  // else. It is written this way on purpose: the accepted subset is `0003`'s
  // `B4`, it moves with what relays accept rather than with this design, and a
  // hand-written copy would be a second declaration of somebody else's protocol
  // that goes stale silently. What a port owes instead is the refusal, which is
  // in the matrix above. An adversarial pass compiled the four shapes.
  filters: Nostr.Filter[];
  live?: boolean;
  namespace?: string;
  settleTimeoutMs?: number;
  retain?: Retention;
  // The relays *this request* is asked of, as a subset of what the provider
  // reads from. The consumer's spelling is taken and the same canonicalization
  // applies; order and duplicates do not affect identity; a target outside the
  // provider's readable set — unconfigured, or configured write-only — is a
  // **typed refusal before the wire** (`relay-not-in-scope`) rather than a
  // request that quietly goes to the rest.
  //
  // Absent means the provider's default readable set. `[]` does not: it is
  // "nowhere", asked on purpose, and it answers `not-started` with reason
  // `no-readable-relay` rather than `nodata`.
  //
  // **It is the relay axis of the cache key, replacing the provider's
  // generation rather than joining it.** A request that names its own relays is
  // not re-keyed when a relay outside that set joins or leaves the provider,
  // which is what stops the first request every Nostr client makes — fetch the
  // user's NIP-65 list from bootstrap relays, then set the provider's relays to
  // the answer — from being keyed by its own answer. An explicit set equal to
  // the whole readable set is the same key as naming none: two requests with
  // the same effective targets are the same request.
  //
  // The caller says *where to ask*; the socket, the lease, the retry and the
  // diagnostics stay the provider's, so `C9` and `A16` are intact — this is not
  // a low-level entry.
  relays?: readonly string[];
}

// The activity axis (C4a). Orthogonal to `ReqState` on purpose: the primary
// state says what the consumer has, this says whether anything is being done
// about it, and merging them is what makes "settled, and a refresh is running"
// unrepresentable.
type QueryActivity = 'idle' | 'refreshing' | 'live';

// The four outlets, as a value. What chooses between them is the table below.
type Slot = 'loading' | 'error' | 'nodata' | 'default';

// How much of the answer to keep (B6). A number bounds the set newest-first;
// `'unbounded'` says so out loud, so that a live request can be required to
// choose without the requirement being a silent truncation.
type Retention = number | 'unbounded';

// Which leg a fact belongs to. The forward one exists only when the request is
// live.
type LegName = 'backward' | 'forward';

// Why an answer is not the whole answer, sized by what a consumer must be able
// to act on differently — see the paragraph on the four, below.
// **The fifth member arrived with the implementation, and not before it.** It
// was named in prose while `B7a`'s ruling was recorded and the fold did not yet
// raise it, because this block is what the library ships and `LK13` holds it to
// that — printing a member a consumer cannot receive would have made the record
// promise something. `LK13` refused it then and requires it now, which is the
// same check reading the same rule from both sides.
//
// `'ephemeral-event-omitted'` says the answer had an arrival taken out of it: a
// non-live request may omit `kinds`, so it can match an ephemeral event, and the
// fold drops one rather than storing what no surface could show. Adding a member
// to a union an exhaustive consumer switches over is a breaking change, which is
// why it arrives with the behaviour rather than ahead of it.
type IncompleteCause =
  'timeout' | 'verification-timeout' | 'refused' | 'ended' | 'ephemeral-event-omitted';

// Non-empty by construction: several relays can time out, refuse and die at
// once, and with one relay a `timeout` and a `verification-timeout` can hold
// together. Reporting one of them would store a presentation decision as a fact.
type IncompleteCauses = readonly [IncompleteCause, ...IncompleteCause[]];

// How an attempt finished, with the failure and the never-asked cases removed.
// **No published declaration names this type**, and that is the whole of what a
// port has to decide about it: it is reachable *to* rather than merely
// nameable, because a `RefreshOutcome` narrowed to these two kinds is one. The
// construction, since nothing in the suite holds it: a function returning
// `Completion` may return a `RefreshOutcome` it has narrowed to `complete` and
// `incomplete`, and the compiler rejects the same return without the narrowing.
// So it is kept, as the name for a helper over "how did it finish"
// that a consumer would otherwise have to spell as a subset of `RefreshOutcome`.
// The argument the other way is C9's, and it is real: nothing on this surface
// hands one over, so publishing it could be deferred and adding it later is
// additive. It is not deferred because the subset already exists in the values
// this record hands out, and a name for a shape consumers already hold costs
// less than the two ways they would spell it themselves.
type Completion =
  | { readonly kind: 'complete' }
  | { readonly kind: 'incomplete'; readonly causes: IncompleteCauses };

// A relay refusing at the protocol level, attributed by subscription id. It
// carries no attempt identity, which is the fact the detached-handle passage
// above rests on: nothing here distinguishes a refusal this consumer caused
// from one a sibling did.
// **What a relay said, as much of it as this library keeps.**
//
// A relay is outside the trust boundary and its words are retained: a refusal
// enters the cache and survives for the collection window, and a notice lives as
// long as the relay is in the scope. What was bounded was the *count* — four
// wordings per relay, per leg, per classification — and never the size of any of
// them, so a relay that reworded at length decided how much memory a page held.
//
// The bound is **4096 UTF-16 code units**, and it is on the type rather than
// applied silently: a cut string presented as the whole thing is a diagnostics
// value that lies, and `truncated` is what a consumer renders differently. The
// cut never lands between the halves of a surrogate pair.
//
// **What this does not do**, since a bound invites the stronger reading: it
// bounds what is *kept*, not what is *received*. A very large frame is still
// received and parsed by the transport before this library sees it; refusing
// that is a limit on the socket, which this library does not own.
interface RelayMessage {
  readonly text: string;
  readonly truncated: boolean;
}

interface Refusal {
  readonly from: string;
  readonly leg: LegName;
  // `CLOSED`'s message — `auth-required: ...`, `rate-limited: ...`.
  readonly notice: RelayMessage;
  readonly reason: RefusalReason;
}

// NIP-01's vocabulary for the prefix of a `CLOSED` message, and `'unknown'` for
// a message that carries none. Total, because a relay may say anything.
type RefusalReason =
  | 'duplicate'
  | 'pow'
  | 'blocked'
  | 'rate-limited'
  | 'invalid'
  | 'restricted'
  | 'mute'
  | 'error'
  | 'auth-required'
  | 'unknown';

// What a consumer may hand `NostrApp`'s `relays` prop, and what the accepted
// scope holds one of per relay. The string form is read/write; the object form
// is how a relay is named read-only or write-only, which B-γ and the relay
// diagnostics both branch on.
interface RelayConfig {
  readonly url: string;
  readonly read: boolean;
  readonly write: boolean;
}

type RelayInput = string | RelayConfig;

// This library's name for the nine socket states, re-declared rather than
// re-exported from the transport: `RelayDiagnostic.connection` was the
// dependency's `ConnectionState` until `LK10` found it, which put that
// dependency's type on this surface while this record forbade exactly that for
// the other one. `LK11` and `SEN20` pin the two halves to the same nine names.
//
// **And a tenth is possible, which this record has to say because the type
// cannot.** The dependency's state set is a range this library declares, not a
// contract it owns: a transport whose set has moved — or a stub — can answer a
// string, an object or a number none of these nine names. It is published as
// `error` rather than as `initialized`, because the two are not symmetric to a
// consumer: one is a spinner that waits for ever, the other is a condition
// somebody sees. An **absent** state is `initialized`. So this union reads as
// "nine names and a total mapping into them", and a version drift shows up as a
// relay reported `error` rather than as a value the type says cannot exist.
type RelayConnection =
  | 'initialized'
  | 'connecting'
  | 'connected'
  | 'waiting-for-retrying'
  | 'retrying'
  | 'dormant'
  | 'error'
  | 'rejected'
  | 'terminated';

// What is known about one relay, whether or not anything has happened to it.
// `read` and `write` come from the accepted scope, so "cannot read from this" is
// visible; `connection` is the one field that needs a socket to observe, and is
// `initialized` for every relay on the server (C6).
// **`lastRefusal` closes `C4b`'s falsifier.** A relay's failure used to be
// readable only through a request, so a panel opened *because* a relay is
// misbehaving could not say which relay was refusing — the defect `lastNotice`
// was moved here to close, left unclosed for `CLOSED`, which is the message
// relays actually use.
//
// It means **"the last `CLOSED` observed on this relay"**, not "this relay is
// refusing everything now": a `CLOSED` refuses one subscription, and a relay
// that refused an authenticated read an hour ago may be answering ordinary reads
// now. The timestamp is what lets a consumer tell those apart, which is why it
// is published rather than left to whenever a panel mounted. The unit is in the
// field's name so a port cannot pick another one, and it is sampled from the
// **provider's** clock, so one provider has one notion of time and a test can
// hold it still. One per relay, the existing `RelayMessage` bound for the text,
// gone when the relay leaves the accepted scope and at provider teardown. The
// request-scoped `Refusal` stays, because completion still has to be attributed.
interface RelayRefusalDiagnostic {
  readonly reason: RefusalReason;
  readonly notice: RelayMessage;
  readonly observedAtUnixSeconds: number;
}

interface RelayDiagnostic {
  readonly url: string;
  // **The spellings the consumer wrote that resolved to this relay**, and the
  // only bridge between the two names this API uses for one relay. The map is
  // keyed by the transport's name; what a consumer holds is what they typed, so
  // `diagnostics[whatIConfigured]` came back `undefined` for a trailing slash,
  // a capitalised host or a reordered query — measured — while the type said
  // every string was a key. A list rather than a string, because two spellings
  // can be one relay.
  //
  // It names the spellings in the **accepted** scope, not everything ever
  // offered: a refused update's URLs are not here, and a consumer joining
  // `RelayConfigurationError.urls` against this map will not always find a row.
  // That is the refusal working — those relays are not this provider's.
  // **A copy the consumer owns**, for the reason the events are: `readonly` is
  // a TypeScript rule and cuts no run-time alias, so this was the accepted
  // scope's own array and a `push` on it — from JavaScript, or from anywhere
  // the types were erased — rewrote the provider's metadata. What is contracted
  // is that a write here reaches neither the provider's state nor the next
  // reader; freezing is how, not what.
  //
  // **What is contracted is the set, and one thing about the order.** The set
  // is every spelling the consumer wrote that resolved here, exact duplicates
  // removed. The order is not: an implementation that lists them the other way
  // round conforms, and a port need not match this one's.
  //
  // **The one ordering clause is stability**: the same accepted scope, read
  // twice, answers the same order — a consumer rendering a keyed list depends
  // on that, and it costs an implementation nothing that a deterministic
  // derivation does not already give.
  //
  // **This paragraph used to say both "not part of this contract" and that
  // answering differently between builds was a violation**, which is two
  // answers to one question. What is written above is the reading the arms
  // hold: `RD21` pins this implementation's order as an implementation fact and
  // says so, and stability across reads is what a consumer may rely on.
  readonly configuredUrls: readonly string[];
  readonly connection: RelayConnection;
  readonly read: boolean;
  readonly write: boolean;
  // The last `NOTICE` this relay sent, under the lifetime decided above.
  //
  // **Its length is this library's to decide, and it is decided**: 4096 UTF-16
  // code units, with `truncated` saying whether there was more. See
  // `RelayMessage` above for why the bound is on the type rather than applied
  // silently, and for what it does not do.
  //
  // **This paragraph said the opposite for a round**, and that is the failure
  // worth recording: it read "its length is the relay's to decide, and that is
  // not contracted either way… listed as residue rather than closed here",
  // while the `RelayMessage` declaration a few lines above already carried the
  // cap. A port reading this file top to bottom got two answers about one
  // field. A correction has to land in every artifact that carries the old one,
  // and this file carried it twice.
  readonly lastNotice: RelayMessage | undefined;
  readonly lastRefusal: RelayRefusalDiagnostic | undefined;
}

// Every relay in the scope, always, keyed by the URL the transport named it by.
//
// **Partial in the type, complete as an invariant.** The two sentences that
// stood here first — "a map rather than a list because C-δ's *never a partial
// answer* is then a property of the type" and "there is no shape here that can
// represent some of them" — said the opposite of the paragraph they introduced,
// and both were wrong in the same way: a map's *type* cannot carry completeness
// (an empty object inhabits it), which is exactly what the rest of this note
// works out. They are gone rather than softened. The keys are the
// transport's names for the accepted scope's relays — a finite set a consumer
// does not hold — so indexing with a string of their own may find nothing, and
// `Record<string, RelayDiagnostic>` said the opposite: it made
// `relays[url].connection` type-check for every `url` and throw for most of
// them. That every relay in the scope *is* in the map is held by the module and
// by `RD*`, which is where a completeness claim can be measured; a type cannot
// carry it, and the sentence that said a `Record` could was wrong twice over —
// an empty object inhabits it too.
// **And a lookup answers one of those two, for every string.** The value is a
// dictionary with no prototype: built the ordinary way, `relays['toString']`
// came back a function and `relays['__proto__']` came back the prototype —
// neither of them a `RelayDiagnostic` and neither of them `undefined`, so the
// type was wrong about the keys every object has while being right about the
// ones a consumer thinks of.
type RelayDiagnostics = Readonly<Record<string, RelayDiagnostic | undefined>>;

// The Error the `error` slot is handed for an incomplete answer with nothing to
// show, and one object per answer (C15). Not compared against the shipped
// declaration by `LK13`, which reads type aliases and interfaces.
class IncompleteResultError extends Error {
  // The three `Error` gives it, re-declared read-only — inherited members are
  // where "readonly to the depth a consumer can reach" was false — and `cause`
  // narrowed from `Error`'s `unknown`, without which an instance is **not
  // assignable to `ReqOutletError`** and the class the record prints cannot be
  // handed to the `error` slot the record hands it to. Compile-checked by an
  // adversarial pass, which built this shape from this page and could not pass
  // it to a snippet.
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  declare readonly cause?: undefined;
  readonly code: 'incomplete-result';
  readonly incompleteCauses: IncompleteCauses;
}
```

**And the two classes a consumer meets before a request exists.** They were published names with no
shape written anywhere on this page — the one exception to "every name published here has its shape
here", found by an adversarial pass, and the two a consumer is told to branch on by `code` rather
than by `instanceof`:

```ts
// Thrown by `useRelayDiagnostics` when there is no provider above it, and
// **published** by a request that has none — the same class, on the channel,
// because `'missing-provider'` is a `ReqErrorCode`. **The class is a subtype of
// that variant, not the variant**: the union's member allows
// `cause?: ReqError | undefined` and this class narrows it to `undefined`, so a
// consumer holding one has the class's shape and a consumer branching on
// `state.error.code` has the union's. An earlier sentence here said the two were
// one shape while both were printed in this record, four hundred lines apart. It read "not on the request channel: a request refuses
// instead" for the round in which the request said `invalid-descriptor`, and
// the sentence outlived that by one commit.
class MissingProviderError extends Error {
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  declare readonly cause?: undefined;
  readonly code: 'missing-provider';
}

// Thrown when the runtime has no cryptographic randomness, at the point the
// attempt registry is built — before any request exists, which is why it is a
// throw rather than a refusal.
class MissingRandomnessError extends Error {
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  declare readonly cause?: undefined;
  readonly code: 'missing-randomness';
}
```

### The slot mapping

Four slots, and one total function from the state to them. This table is the contract; a component
does not get to hold its own copy of it (C7).

**The pair that function returns — the slot and its argument — has a name in the implementation and
is not on the published list** — `LK7`'s equality is what would report it appearing — which is a
decision rather than an omission: a consumer never calls the mapping, they write snippets and the
component selects. What they name is `Slot`, which is published. A port that does hand consumers the
mapping owes them the pair's type as well, and that is a wider surface than this record chose.

| `state.status` | `events` | `hasMatchEvidence` | Slot      | Slot argument           |
| -------------- | -------- | ------------------ | --------- | ----------------------- |
| `loading`      | —        | —                  | `loading` | none                    |
| `streaming`    | none     | —                  | `loading` | none                    |
| `streaming`    | some     | —                  | `default` | `T`                     |
| `settled`      | some     | either             | `default` | `T`                     |
| `settled`      | none     | `true`             | `default` | `T`                     |
| `settled`      | none     | `false`            | `nodata`  | none                    |
| `incomplete`   | some     | —                  | `default` | `T`                     |
| `incomplete`   | none     | —                  | `error`   | `IncompleteResultError` |
| `error`        | —        | —                  | `error`   | `error`                 |

The last column is what the mapping itself hands over. Every outlet is also handed the request as
`RequestOutletContext` (ruling 10), so "none" means no argument beyond that.

**A deferred request renders the `loading` snippet for as long as it is deferred, and the table is
where that has to be said.** `loading` is what the primary state reports when nothing has been asked
— a server render (0002 A12), or a provider whose relay list has not arrived (0003 B-γ) — and the
table takes `state` alone, so the slot cannot distinguish it from a request that _is_ in flight. The
distinction is on `activity`, which is `idle` in the first case and `refreshing`/`live` in the
second, and since ruling 10 the `loading` snippet is handed the request, so a consumer who needs it
reads `request.activity` there. **The cost is a spinner over an empty relay list**, and it is
chosen: the alternatives were a sixth `ReqState` member (which every consumer's `switch` would have
to grow, for a case that resolves itself the moment relays arrive) and admitting `activity` as a
column of this table (which makes the slot mapping a function of two axes and hands the components a
reason to disagree with each other). Named here because a port reading "reports so" (B-γ) will
otherwise invent a published state for it.

**The `default` row's argument is `Outlets<T>`'s parameter, and this column said `events`, `status`
instead for as long as the table has existed.** That pair is the vocabulary of the components being
replaced — their default slot takes a `status: ReqStatus`, a type this surface does not publish and
this record names nowhere but here — and it disagreed with this record's own component declarations
twice over: the state is not a `status`, and eight of the eleven request components are not handed a
list at all. `T` is `{ events: readonly ReqEvent[] }` for `EventList`, `UniqueEventList` and
`UserReactionList`, and `{ event: ReqEvent }` for the other eight, both declared above, and the
snippet is handed `T & RequestOutletContext`: the state is `request.state`, the one route to it
since ruling 10 took `state` off `Events` and `Event`. The prop types were taken as the true half
because they are what a consumer compiles against and because `ReqStatus` does not survive the
redesign; what changed here is the table. **Eight of the eleven also lose a name in the migration**
— the default slot's argument is `metadata`, `contacts`, `article`, `relayListMetadata`, `reactions`
and so on today, and is `event` or `events` for every component here. That is a rename in every
consumer's markup, and it is said here because the type block above is otherwise the only place this
surface mentions it.

**Why it stood: the check reads four columns of five.** `LK14` turns each row into the state it
describes and puts it through the shipped mapping, which observes `state.status`, `events`,
`hasMatchEvidence` and Slot; the argument column is not read by it, or by anything else. It is the
same hole the second column had before `deriveOutlet` derived it — a table nothing runs is a comment
— narrowed to one column rather than closed, because what the argument column describes is a
component layer that does not exist yet.

Two rows are the ones the current components cannot express: a stream that has started and produced
nothing, and an answer that arrived and is not the whole answer. The second renders what it has —
the same discipline that keeps a failed background refresh from clearing a list — and says it is
partial through the status and the diagnostics rather than by hiding the events.

**The second column is derived by the library, from the state, beside the slot.** It was written
here and derived nowhere for as long as this table has existed, and that is not a gap a component
fills later: the `incomplete` row's argument is an Error that exists on no state, so a component had
exactly one published Error to reach for — `diagnostics.lastError` — and that field answers a
different question. The two coincide on every value where nothing threw and part company on one that
is reachable: an attempt whose backlog ends refused and whose forward leg then throws carries an
incomplete answer _and_ a failure, so the status said `incomplete`, the slot said `error`, and the
Error handed to it was the throw. Both facts are true; asking one field for both is what was wrong.
So the mapping is a function to a slot **and its argument**, and a consumer is told: the state and
the slot's argument describe the answer, and the diagnostics describe what most recently went wrong,
which on that row may be a different Error about the same attempt (`C5-C4`).

**The argument is one object per answer, and that is a contract rather than an implementation detail
(C15).** The slot's argument and `diagnostics.lastError` were both _synthesised on read_, so an
incomplete answer that nothing had touched handed a consumer a new `IncompleteResultError` every
time it looked — and a `#key`, a memo or an equality guard in an effect keys on exactly that. "It is
derived, so its identity is not promised" was not available as an answer: the field's other two
sources are references the library hands straight through, and `C5-C2` reads one of them with
`toBe`, so stability was already promised on two thirds of one field and denied on the third
depending on which source happened to be filling it.

What the object tracks is **the answer, not the causes**. The unit is the backlog attempt that
ended: while that record stands, folding a forward event in or recording a failure against the
request changes the value and changes nothing about the answer already handed out, so the same Error
comes back. A later attempt that reaches an end of its own is a different answer, and gets a new
Error even when its causes are identical — a consumer that re-asked and was told "partial" a second
time has been told something new. The rows are `C15-C1` to `C15-C5`.

`C5-C4` is untouched by this. On the value where an attempt answers incompletely _and_ throws, the
slot still carries the incompleteness and the diagnostics still carry the throw, and they are
deliberately different objects; what changed is that the first of the two is now the same object
across reads.

**It is the answer's causes as well as its Error, and finding that took a sweep rather than a fix.**
`causes` is published on `ReqState.incomplete` and on `RefreshOutcome`, was rebuilt on every read,
and is the same defect one field across; nothing had said so, because the round that opened this
looked at the field it was holding rather than at the axis. So the whole handle was read twice,
getter by getter, and what came back is stated here rather than left implicit. **The object that was
read is the spike's, and it is wider than the handle this record publishes** — a distinction the
lists below did not make until `ReqHandle` was declared above. `raw` hands back the query library's
own result and `projected` is declared on a separate interface the engine marks as outside this
record; neither is a member of `ReqHandle`, and C8 is what stops the first from becoming one. So
they are named here and left out of both lists rather than dropped silently, because a list of
members is also a claim about which members there are. Stable: `activity`, `refresh`, `state.error`,
`state.causes`, `diagnostics.lastError`, `diagnostics.legEnded`, and the elements of
`diagnostics.refusals`. **Identity is not guaranteed, and is not repaired here:** the two derived
containers `state` and `diagnostics`, and the two lists `state.events` and `diagnostics.refusals`.
What makes the two carried here different is that they belong to the answer: they are what the
answer _is_, they outlive every write that does not change it, and an Error in particular cannot be
compared any other way.

**What the members mean is 0002's and 0003's to say, and what a consumer does with them is this
record's.** `IncompleteCause` has five: `timeout`, `verification-timeout`, `refused`, `ended` and
`ephemeral-event-omitted`. This surface publishes them because a partial answer is not one thing to
a caller — retry copy, failure classification and telemetry all branch on _which_ partial — so the
union is sized by what a consumer must be able to distinguish rather than by how often each member
is reached. The pair that most needs distinguishing is the two the request owns, and they are
independent facts rather than two classes. `timeout` says this request stopped hearing from a
backward target — its own settle timer drew the boundary, or a target was still undetermined when
the outcome was derived — and what it points at is the relays and the network.
`verification-timeout` says the backward leg's signature gate was cut with candidates still inside
it (A-ε), and what it points at is the verifier or the device. **Neither implies anything about the
other, and one relay produces both** (`A-ε-C14`), so a consumer handed both has two things to act on
rather than a classification to make. **Raising `settleTimeoutMs` is not the recovery for the
second**: the drain budget is A-ζ's, it belongs to the gate, and no caller sets it. They were one
word for a round; a consumer reading it could act on neither, and the branch a caller could not
write is the cost that decided it. **A consumer that wants one word writes the fold itself** —
`causes` is the non-empty list, and choosing a representative from it is a pure function this
library does not have to pick for them.

**And it is one array across the surfaces, not one array per surface.** An incomplete answer
publishes its causes three times — `state.causes`, the `incompleteCauses` of the Error the error
slot is handed, and the `causes` of the `RefreshOutcome` a `refresh()` over that answer resolves
with — and all three are the same array. This is the same claim as the Error's, read across surfaces
rather than across reads, and it is stated because it is the half a contract test can lose without
anything failing: every publication point reads the completion memoised on **the answer's own
identity** — a token minted where the answer is decided and carried by every writer that does not
decide a new one — so a `[...causes]` at any one of them would leave equal contents everywhere and
break nothing a `toEqual` can see. What a consumer gains is the discriminator `toEqual` cannot give
it — two attempts that both end refused publish equal causes and different arrays (`C15-C4`), so
`===` answers "is the state I am looking at the answer my `refresh()` returned?" — and what it costs
is a rule at the publication points and nowhere else: pass the array through, do not copy it, do not
re-derive it outside the memo. Refusing it would put this field where `lastError` was: one fact,
three surfaces, identity on some of them, which is the self-contradiction this decision exists to
remove. `C15-C5` is the row.

**Why the four are unpromised rather than being the same bug four times over.** They were recorded
as open with no argument for it, and "we ran out of round" is not one. The published statement is
that their identity is **not guaranteed** — not that they are new each time. As implemented today
they are in fact new on every read, and that is a fact about this implementation rather than a
promise: a consumer may no more rely on a container being new than on it being the same, which is
what leaves memoising them later a compatible optimisation instead of a breaking change. Two things
separate them from the Error, and both are properties of the code rather than of the intent.

_They are uniformly unstable; `lastError` was intermittently stable._ The Error's defect was never
that a derived value churns. It was that **one published field had three sources and they did not
agree**: two of them hand a reference straight through — the failure record on the value, and the
query entry's error, which `C5-C2` reads with `toBe` at `X4` — while the third was minted on every
read. A consumer's equality guard therefore worked or did not work depending on which internal
source happened to be filling the field, which is self-contradictory rather than merely weak, and is
why "it is derived, so identity is not promised" was not available as an answer. The four have no
such split, and this was checked against the code rather than assumed: `deriveState` returns a
freshly built object at every one of its five `return`s, `project` allocates its array before the
loop and unconditionally, and `refusalsOf` returns a fresh array on both of its paths — the empty
literal for no value, the spread for a value. The churn is total and path-independent, so there is
no reading under which one of them is stable, and nothing can have come to rely on stability the way
a guard on `lastError` could. That measurement is what makes leaving the identity unpromised safe
rather than a hedge: there is no consumer whose guard works today and would stop working, in either
direction, whichever way this is later decided.

_They are containers of stable elements; an Error is a leaf._ Everything inside them is now a
reference the library hands through or a primitive: `state.error` is the failure record's Error or
the entry's; `state.causes` and the incomplete answer's Error are memoised per **`AnswerIdentity`**
(C15) — **not per `BacklogRecord`, and the difference is a defect this design already paid for**: a
refusal arriving after the backlog ended rebuilds the record without changing the answer, so a key
on the record hands a consumer a new Error and a new causes array on a wire event. The token is
minted in the writer that ends the backlog and spread through by the writers that do not (`C15-C3`),
and it carries the attempt that decided the answer, because a token with no content is collapsed
onto the previous answer's by the query library's structural sharing (`C15-C4`). A port that keys on
the record re-implements the defect; `diagnostics.lastError` now has all three of its sources
reading rather than constructing; `diagnostics.legEnded` is `forward.end` off the value;
`nextExpiryAt` is a number; the `ReqEvent`s are pushed straight off the stored packets; and each
`Refusal` is built once, where the `CLOSED` packet is classified, and carried by reference from
there. So a consumer of any of the four always has both a content key and elementwise `===` —
`{#each events as event (event.id)}` is the shape, which is what this repository's own demos do
(`src/routes/timeline/+page.svelte`) — and a container being new costs a diff over stable elements
rather than a remount. An `IncompleteResultError` offered no such handle: it is a leaf, its message
is not an identity, and before C15 even its `causes` array was rebuilt on every read.

_The tripwire, so this is a decision and not a permission._ They stay unpromised **because** they
are uniformly unstable and their elements are content-keyable. Which of the two later moves is
allowed follows from that, and they are not symmetric. Memoising all four, unconditionally, is the
compatible optimisation this wording exists to keep open: nothing was told they churn, so nothing
can be broken by them ceasing to. The day any one of them becomes _conditionally_ stable — memoised
on one branch, derived on another; stable while a value stands and not while it is replaced — it
stops being this case and becomes `lastError`'s, and is repaired rather than recorded, because that
is the split the wording does not cover and no consumer can guard against. Verified absent today at
every getter: the engine's `projected` — not a published member, and the getter `state` reads
through — calls `deriveState` on each read and memoises nothing, so `state` is a fresh object per
read, and `diagnostics` is built field by field with no cache anywhere on the path.

**A completed answer stays an answer, and that decides `nodata` — but only one of the two ways of
reaching an empty one earns it.** A later attempt that fails keeps it. That is C5 with a list of
length zero: a failed refresh does not empty a list of three, so it may not empty a list of none,
and treating them differently restores the "how visible the failure is depends on how many events
happened to arrive" asymmetry the fifth state exists to remove. What the consumer is told about the
failure is on the diagnostics axis, and that nothing is being done about it is on the activity axis;
`refresh()` still reports its own attempt's `error`, which is C11 answering for an attempt rather
than for the request. `C12-C3` is the contract.

**The second way does not, and this record said it did for two rounds.** An answer whose every event
has passed its NIP-40 deadline renders the default slot over its empty list, not `nodata`. The
argument for keeping it was that C13 hides what the answer contained reversibly while the answer
itself stands — and reversibly is exactly what disqualifies it. C12 requires evidence that nothing
exists **and keeps it**, and a `nodata` that a corrected clock retracts was never keeping anything;
the events were found, and "nothing found" is a claim about the world rather than about the read
model. The retention bound makes the same value cheap to reach: the newest arrivals hold every slot
and may all be expired, so a request that received six events and shows none was rendering "Nothing
found" (`EX6`, `EX6b`, `B7b-C4`, `B-θ-C1`).

**Nothing distinguishes those two routes, and that is why one rule covers both.** `CachedEventSet`
records no eviction, so "one event that expired" and "four received, two discarded by the bound, two
expired" are the same value: entries held, nothing projected, backlog complete. The rule is
therefore about the value and not about how it got there — `nodata` requires that the request
accepted nothing, not merely that it is showing nothing. What that costs is a consumer seeing a bare
default slot where it used to see "Nothing found", with the reason on neither axis it owns: the
request did not fail and is not working, it is simply hiding something. A fifth outlet would say so
and C1 forbids one, so this is residue rather than a closed corner.

### Consequences

- Good: the state-to-slot mapping is decided once, and a component cannot disagree with it.
- Good: a provider that comes and goes leaves nothing behind — no listeners, no cache, no connection
  — which a module-level store cannot do.
- Good: an application that renders "nothing found" is one that was told so.
- Bad: every consumer changes. 95 call sites across this repository's demos and README — which is
  what `tools/measure-break-surface.mjs` counts — **on this branch only; the program does not
  survive it**, so what a reader inherits is the method 0001's More Information states rather than
  the command. What consumers outside this repository use is not measured; the earlier "four of five
  dependent projects" is withdrawn rather than restated, because nothing recorded which five.
- Bad: nineteen hooks become **three** — `useReq` and `useRelayDiagnostics`, since
  `useConnections`'s successor is a hook of its own (C-δ), and `useSend`, which replaces the `app`
  store rather than any of the nineteen — against twelve components, so the migration is not a
  rename and the guide has to say so. It read "become one" while the published entry beside it
  listed two.
- Bad: the removed extension point has no replacement on the surface. No consumer of it is known to
  us, which is the input C9's absence was weighed against — this line read "nobody was found using
  it", asserting a search that More Information below records as never having been made, and whoever
  needed it has to wait for an entry designed on purpose rather than one shipped as a hedge.

**What would reopen `C9`, fixed here rather than left as "later".** Adjudicated 2026-09-11: the
entry stays closed in v1, and deferring it vaguely is its own defect — an absence with no stated
condition is one that gets reopened by whoever is most inconvenienced. All five have to hold
together:

1. a **named consumer operation** exists — not a wish for an escape hatch;
2. that operation has a **counterexample**: it cannot be expressed with `ReqDescriptor`, `ReqPlan`
   or the published components;
3. its contracts can be **decided** — owner and lifetime, abort/dispose/SSR, relay scope and
   diagnostics membership, completion/refusal/partial result, backpressure and ephemeral events, and
   its relation to the cache and to an existing `ReqHandle`;
4. a **stable public shape** can be proposed that does not hand out a dependency's types (rx-nostr's
   `RxNostr`, query-core's `QueryClient`);
5. a **consumer-level contract witness** can be written, and the operation is shown not to duplicate
   the high-level API.

"an escape hatch is convenient", "I want `operator` back" and "exposing the internal stream is
easier to implement" are **not** triggers. When a real use appears, the round it opens compares the
smallest high-level API that serves it against a low-level one — it is not `createEventStream`
returning — and it is a separate ADR, because every contract in (3) is one this record does not
make.

### Confirmation

Every decision in the table above has at least one contract in [0005](0005-contract-catalogue.md),
stated as what would be observed rather than as the name of a test. A check fails if a decision here
has no contract there, if a contract names a decision that does not exist, or if one points at a
witness that does not.

Contracts are of six kinds, and only two of them are tests of this design: `behavior` and
`architecture`. The rest are `sentinel` — watching the dependency — `rationale`, for the measurement
a choice was made on rather than the behaviour it produces, `reconsideration`, for a claim that
cannot be settled here, and `non-goal`, for what is deliberately not done. Reading the catalogue by
kind is how to see what this record is actually promising.

## Framework scope, and what "port" means in these records

**Svelte 5 only, and that is a decision rather than an accident.** `C14`, snippets, context and
effect lifetime were chosen knowing that lifting this design unchanged into React, Vue or Solid is
**not** a goal. Two decisions are therefore marked `svelte-behavior` rather than presented as
contracts a re-implementer must satisfy:

- **`A12-C4`** requires that the framework's context read _throws_ outside initialisation, and
  neither answer a helpful `catch` produces. React's `useContext` returns a default and Vue's
  `inject` returns `undefined`, so that requirement is about Svelte and not about this design.
  Another framework's version is another ADR with another public API — React returning a default is
  **not** a counterexample to `A12-C4`.
- **`C13`'s derived read** — "what it answers is derived on every read" — is a signals assumption,
  and the repair that made the clock publish the reaching `now` is a signal-graph fix for a
  signal-graph problem. The record also rejects an alternative because it "makes an ordinary read a
  `$state` write, which the framework refuses outright"; that argument does not carry to a framework
  without that refusal, and is marked as Svelte's rather than as general.

**And "port" is fixed to one meaning**: from this branch's spike to a production **Svelte**
implementation. Every "a port inherits…" in these records is that port. Cross-framework portability
is out of scope, and saying so is what stops a reader taking a framework-shaped decision for a
universal one.

## The three units the next round changes

The adjudication asks for these to be designed together rather than patched one at a time, because
patching them separately is how the contradictions were built. Each unit below names the questions
it closes and the invariant it has to keep.

### Unit A — request plan and identity

Closes **1, 3, 4, 8, 14, 15** and 16's component table. The pieces:

1. deferred or active descriptor (`ReqPlan`);
2. an active descriptor's **effective relay target set**;
3. a canonical key over that target set;
4. live/ephemeral admissibility;
5. the complete descriptor every component builds.

**The invariant it exists to keep is that equal key implies equal wire semantics.** Each piece alone
breaks it: a subset field on the generation-counter key ruling 15 replaced leaves an explicit
request re-keyed by an unrelated relay (15); a boolean `defer` on the active descriptor makes a key
for a question nobody asked (4); and a component whose descriptor is unstated cannot be shown to
land on the same key as the `useReq` a consumer writes beside it (16).

**What `Closes` enumerates, and where the rulings that are in no unit went.** It lists the public
decisions a slice takes _implementation responsibility_ for — not a classification of each ruling's
state, which is what a reviewer measured it against and found it is not: `2` and `8` are both "kept"
and only `8` was listed. `2` is the `error` outlet, whose implementation responsibility is the
outlet lifetime Unit B carries, so it is listed there. **`6` and `7` are in no unit on purpose**:
they are v1 non-goals whose obligation is documentation rather than a runtime slice, which the
ruling table already says and this sentence now says too. With those named, the three `Closes` sets
and the two non-goals cover the seventeen (14 is split between Units A and C), and a ruling that
falls out of every unit is visible by arithmetic rather than by nobody noticing.

### Unit B — handle and outlet lifetime

Closes **2, 5, 10, 11**. All four outlets reach the same handle; expected cancellations are typed
outcomes rather than rejections; the write capability is revoked when the root is released. **The
invariant is that the component surface and `useReq` have one failure and lifetime contract** —
before ruling 10 they had two, because a component consumer could not reach the axis the failures
were routed to.

### Unit C — provider liveness and diagnostics

Closes **9, 12, 13, 17** and the resource-domain half of **14**. Provider-owned retry scheduling
with browser resume as a hint; recovery as a **new attempt**; a provider-owned last-refusal summary
per relay; a non-throwing first construction; and the provider-bound send operation, whose every
outcome is a value. **The invariant is that one owner holds every socket, timer and listener** —
which is what makes teardown, SSR and test isolation answerable.

### What has to be true before any of it is accepted

The adjudication lists thirteen observations, one per unit-critical behaviour, and says explicitly
that unit tests over new internal functions are not enough: each has to combine the public
declarations, the Svelte call site, the wire, and timer or resource ownership, so that the **changed
decision** can be made false. **They were drafted rows when this paragraph was written, and ten of
them are contracts now.** They sat in `0005` under "Drafted for the next round" with ids the
catalogue's parser deliberately does not pick up, because a row whose witness does not exist yet is
not a contract this branch is claiming. Ten have since landed as parsed rows with witnesses and
three are half-landed; the drafted table in `0005` carries the strike-through per row, and this
sentence is kept in the past tense rather than deleted because the reasoning above it — why a
drafted id is invisible to the parser — is still the rule.

## What a reviewer is being asked to rule on

**Adjudicated on 2026-09-10.** The adjudication document is
`docs/redesign/questions-for-review-answer.md`, **which does not survive this branch** — so what a
port inherits is the table below and the contract rows it names, not that file. It is cited for
provenance rather than as a reference a reader will be able to follow. Eleven are changes, two are
kept with their price stated (2, 8), two are declared v1 non-goals (6, 7), and one is redefined
rather than answered as posed (14) — sixteen. **Ruling 17 came later**: it was raised by this record
after that adjudication, left open for the reviewer, and closed in the round after R58 by the
maintainer, once the reviewer asked what v1 is for and the answer included posting (the send section
above). The seat's gates were: rulings **Go**, ADR repair and contract-row drafting **Go**, phase 1
accept **No-Go**, production port **No-Go** — the last because the key, the provider's liveness, the
handle's lifetime and the component descriptors all move. Each section below keeps the question as
it was asked, and carries the ruling under it; the record's own decision rows are rewritten to the
ruling, which is where a port reads them.

**Where each ruling stands.** A verdict word is a claim per row, so this table is the one place that
carries them and `DOC6` reads it: every row marked landed has to name a contract this catalogue
actually declares. "Landed" means the decision is implemented and contracted **here**; the port
column is what phase 2 owes on top of it.

| #   | The ruling                                        | State                             | Contracts                          |
| --- | ------------------------------------------------- | --------------------------------- | ---------------------------------- |
| 1   | `B7a` splits on `live`                            | landed                            | `B7a-C1`                           |
| 2   | the `error` outlet is kept                        | kept — the price is stated        | `C12-C3`                           |
| 3   | the optional relay target set                     | landed                            | `C3-C2`, `B3-C6`, `B3-C8`          |
| 4   | a public request plan                             | landed                            | `C3-C4`, `C3-C5`, `C3-C6`, `C3-C8` |
| 5   | a lifecycle end is a resolved outcome             | landed                            | `C11-C9`                           |
| 6   | paging is a v1 non-goal                           | non-goal — documentation is owed  | `B-δ-N1`                           |
| 7   | no planning layer, the ceiling published          | non-goal — documentation is owed  | `C7-C1`                            |
| 8   | `retain` and `settleTimeoutMs` stay keyed         | kept — the price is stated        | `B3-C1`                            |
| 9   | a provider-owned liveness policy                  | landed                            | `A13-C6`, `A13-C7`                 |
| 10  | four outlets, all carrying the request            | landed as the printed shape       | `C4b-C2`                           |
| 11  | the write capability is revoked                   | landed                            | `C11-C19`                          |
| 12  | a bounded last-refusal per relay                  | landed                            | `C-δ-C13`                          |
| 13  | first construction stops throwing                 | landed                            | `C16-C1`, `C16-C4`                 |
| 14  | `C6` is redefined as a resource domain            | redefined — the row is rewritten  | `C6-C7`                            |
| 15  | the key uses the effective target set             | landed                            | `B3-C7`                            |
| 16  | scope kept, environment fixed, the table          | the table landed; the rest stated | `C7-C2`, `C7-C3`, `C7-C4`          |
| 17  | v1 publishes a send operation, not the connection | landed                            | `C6-C11`–`C6-C17`                  |

**What the unlanded rulings owe, and to whom.** 2, 6 and 7 owe _documentation_ — the component docs
separating "not found" from "could not establish", the feed components not claiming they can page,
and the README stating that subscriptions grow per component, per descriptor and per target relay.
None of those is a behaviour this branch can witness, and all three are phase-2 deliverables rather
than open questions. 8 and 14 are decisions whose whole content is in the rows above, and so is the
unlanded half of 16.

**These are not residue and they are not defects in the writing.** Every other known weakness in
this set is a limit of an instrument or a figure nobody re-derives. The sixteen below are
consequences of the **decisions**, found by two readers attacking the design rather than the prose —
the first over the request, cache-identity and failure-channel decisions, the second over the
provider, the lifecycle, the diagnostics axis and what a port inherits. Each is reproduced rather
than argued, and each is something a consumer of this library would meet. They are listed here
because a phase-1 acceptance is exactly the seat that can rule on them, and because shipping the
records without them would put the reviewer's round to work finding what one lens found in an hour.

Each says what was run, what came back, and what the options are. Nothing here is fixed: which way
each goes is a scope decision, which is the seat's.

### 1. `B7a` refuses the by-id request three published components are specified to make

**Measured.** `normalizeDescriptor` on `[{ ids: [<64 hex>], limit: 1 }]` — the filter `0004` says
`Event`, `EventList` and `UniqueEventList` build — comes back refused: _the filter field "kinds"
must exclude ephemeral kinds_. `B7a` refuses a filter that **could** select an ephemeral event, and
a filter with no `kinds` matches every kind. Adding `kinds` makes it pass.

**What a consumer meets.** An id arrives from an `e` tag, a `nevent1…` link, a quote or a bookmark,
and it does not arrive with a kind. The consumer must guess one; when the guess is wrong the answer
is empty with no match evidence, which `C12`'s own slot table renders as `nodata` — "this does not
exist". `C12` exists to forbid exactly that sentence.

**Options.** (a) Narrow `B7a` to refuse a filter that _names_ an ephemeral kind, accept an absent
`kinds`, and drop ephemeral arrivals at the fold with an `IncompleteCause` — the fold-side handling
`0003` rejects in one line without pricing what refusing costs. (b) Withdraw the three components
from v1 and say that by-id retrieval requires a kind. **Owner: this reviewer.**

**Ruling: (a), split on `live`.** A descriptor whose `kinds` names an ephemeral kind is still
refused; a **live** descriptor with no `kinds` is refused too, because a forward leg can deliver an
ephemeral event and v1 has no transient channel to show it in; a **non-live** descriptor with no
`kinds` is accepted, and an ephemeral arrival on its backlog is dropped and raises a new
`'ephemeral-event-omitted'` cause — so the answer is `incomplete` rather than `settled`, and an
empty one is not `nodata`. Option (b) is refused: an id without a kind is ordinary Nostr input and
withdrawing by-id retrieval costs too much. `B7a`'s decision row and its section in `0003` are
rewritten to this. The cause is raised only on the backward leg, where information was actually
dropped, so `B10`'s forward/backward separation is untouched. The live refusal is what gets
reconsidered when a transient channel exists.

### 2. An answer that is `incomplete` and empty renders the `error` outlet

**Measured.** A request over two relays where one is unreachable, the other answering `EOSE` with
nothing: `status: 'incomplete'`, `causes: ['timeout','ended']`, `events: 0`. `deriveOutlet`'s last
line sends every `incomplete` state to `slot: 'error'`.

**What a consumer meets.** Real NIP-65 relay lists carry dead entries — users do not prune them — so
`A5`'s all-or-nothing completeness makes `incomplete` the ordinary state and `settled` close to
unreachable. "This user has no profile yet" renders the **error** slot, `hasMatchEvidence` and
`nodata` never fire, and `diagnostics.lastError` holds an `IncompleteResultError` on every request.

**The tension is with `C4a`**, which separates "what I have" from "what is being done": folding "not
everyone answered" into the primary axis undoes that separation. **Options.** (a) Send an empty
`incomplete` answer to `nodata` or `default` and leave degradation on the diagnostics axis. (b) Keep
it and price it here. **Owner: this reviewer.**

**Ruling: keep the `error` outlet.** Sending an unanswered-relay state to `nodata` violates `C12`
directly; an empty `default` cannot be expressed for a single-event component, whose `T` has no
event to hand over, so it cannot be the common rule for four outlets. `error` is defined as the slot
for **"could not establish absence"** rather than "a relay broke", and it keeps carrying
`IncompleteResultError.causes`. This is not a conflict with `C4a`, which separates primary state
from activity and does not erase the primary answer's completeness; nor with `C5`, which is about a
failure not clearing data that exists — there is none here. **The price is stated rather than
removed**: a scope holding a dead relay shows `error` where it would otherwise show `nodata`, and
the component documentation has to separate "not found" from "could not establish".

### 3. Nothing can be asked of a particular relay, and `C3`'s falsifier is met

The record already says this — per-relay selection is "the one `req` use case the descriptor does
not cover, and `C3`'s falsifier names exactly that shape". Said plainly: **the falsifier is met, not
merely named.** Outbox/NIP-65 routing, relay hints on `nevent1…`/`e`/`p` tags, NIP-17 inbox relays
and NIP-50 search relays are all unreachable, and the offered escape — a second provider — is
forbidden from sharing by `C6`, so it costs a second socket, a second cache and a second copy of
every event, and does not compose per author.

**Options.** (a) A sixth optional descriptor field naming a relay subset, folded into the key
exactly as `B-α` folds the scope. (b) Ship v1 without it and say so in the README rather than only
here. **Owner: this reviewer.**

**Ruling: add the optional relay target set. Landed.** `ReqDescriptor.relays` is printed above with
the shape below, `resolveTargets` is the boundary, and `B3-C6`, `B3-C8`, `C3-C2` and `C3-C3` are the
contracts (`RT1`, `RT4`, `RM27`, `RM28`, `RT2`). `C3`'s falsifier is met, so the gap cannot stay as
an omission that reads like support. The contract: `relays?: readonly string[]` takes the consumer's
spelling; the same canonicalization applies; it resolves as a **subset of the readable universe the
provider accepted**; order and duplicates do not affect identity; a target outside the scope,
write-only, or not canonicalizable is a typed refusal **before the wire**; absent means the
provider's default readable set; an empty effective set is `not-started / no-readable-relay` rather
than `nodata`. This is not a low-level entry — the caller says _where to ask_, and the socket,
lease, retry and diagnostics stay the provider's — so `C9` and `A16` are intact. **What it does not
buy**: connecting to an unconfigured relay hint. That needs a request-scoped lease, diagnostics
membership and a release rule, and is not v1.

### 4. There is no way to say "not yet", and the natural encoding asserts a falsehood

**Measured.** `[{ kinds: [0], authors: [] }]` is accepted, and `B8` answers it without reaching the
wire: `status: 'settled'`, `events: 0`, no match evidence — which `deriveOutlet` renders as
`nodata`. `filters: []` does the same.

**What a consumer meets.** The commonest dependent query on Nostr is "resolve a NIP-05 or an npub,
then load the profile". Both obvious encodings of the waiting state render "not found" while the
lookup is in flight. `C12`'s falsifier lists _a request never sent_ as a case it must not call
`nodata`, and `B8` produces exactly that. The library already sets `enabled` per query for `A12`'s
server branch, so the mechanism exists and is withheld.

**Options.** (a) A `defer` field on the descriptor, occupying no entry, as `B-γ` already models "not
asked". (b) Keep the prohibition and say that a deferred query is a component boundary. **Owner:
this reviewer.**

**Ruling: a public request plan, not a component boundary and not a boolean.** `useReq` takes
`() => ReqPlan` where `ReqPlan` is `{ kind: 'deferred' } | { kind: 'request'; descriptor }`. A
deferred plan makes **no key for the question it would have asked, no attempt and no REQ**, and
occupies **one inert entry per client** shared by every deferred hook; it reports `loading` with
`activity: 'idle'`; `refresh()` resolves `{ kind: 'not-started', reason: 'deferred' }`; becoming a
request applies the ordinary mount triggers; going back releases the observer without deleting the
entry. `filters: []` and `authors: []` are **not** the encoding — they stay `B8`'s genuine empty-set
questions — and making the plan a discriminated union also removes the ordering question of
validating a descriptor nobody is asking with.

### 5. The idiomatic retry button produces an unhandled rejection

`onclick={() => handle.refresh()}` is what an application writes. `refresh()` **rejects** with
`attempt-abandoned` when the consumer goes away — an ordinary navigation on a slow feed — so the
page produces an unhandled promise rejection for a case where nothing went wrong, and the rejection
is deliberately untypeable (`catch (value: unknown)`, six codes, no exported alias, no guard). A
consumer must handle failures in two places with two disciplines for one call.

**Options.** (a) Move `attempt-abandoned` onto `RefreshOutcome` as a resolved kind — this record's
own closing line points at it. (b) Keep it and document the `.catch` a consumer owes. **Owner: this
reviewer.**

**Ruling: move it to a resolved outcome, and take `provider-disposed` with it. Landed**, as `C11-C9`
rewritten and `C11-C19` added (`P34`, `P37`, `P50`, `AC11`, `AC13`, `RM2`, `RM8`, `LC12`, `LC14`,
`LC15`, `LC16`), with two aimed ledger entries. **The union shrank by one and not by two**, and the
"if" in the clause below is why: `attempt-abandoned` reaches no published channel any more, so its
`ReqError` variant is deleted; `provider-disposed` still reaches the rejection, because a call made
_after_ the provider is gone is refused rather than cancelled — a call the provider disposes _under_
is the cancellation. That reading is the one the code takes, and it is written here rather than left
to a reader of the clause. An ancestor provider disappearing on navigation is not the consumer's
failure either. `RefreshOutcome` gains
`{ kind: 'cancelled'; reason: 'consumer-released' | 'provider-disposed' }` and `not-started` gains
`'released'` and `'deferred'`. Root or provider gone after the call is `cancelled`; a call on an
already-released handle is `not-started / released`; a failure the attempt itself answered stays the
typed `error` outcome. **The promise is bounded**: lifecycle cancellations move to the value
channel, and caller errors and unexpected exceptions are not promised never to reject. **And the
union shrinks**: if `attempt-abandoned` and `provider-disposed` no longer reach any published
channel, their `ReqError` variants are deleted rather than left as unreachable members.

### 6. A feed cannot page, and any descriptor change flashes the loading state

**Measured.** Two `until` cursors over one filter are two entries; so are two `retain` values and
two `settleTimeoutMs` values. A hook reads one descriptor, so advancing a cursor **replaces** what
it reads: the first page disappears and the list returns to `loading`. The same edge hits every
ordinary filter change — a feed tab, a hashtag, a profile tab — and `A4` forbids the standard remedy
by name, because `placeholderData` is a freshness option and the allowlist excludes the whole
family.

**Options.** (a) Let a hook hold a cursor without changing identity. (b) Admit `placeholderData` to
the allowlist, which is about freshness rather than presentation continuity. (c) Ship without paging
and price the flash. **Owner: this reviewer.**

**Ruling: a declared v1 non-goal, and the cache identity is not weakened.** Taking the cursor out of
the key merges two different questions into one entry; publishing `placeholderData` lets a new
descriptor's handle answer with the old descriptor's data, which makes "what is this an answer to"
ambiguous — neither is a paging fix. v1's contract: a descriptor change is a new entry and shows
`loading`; page accumulation is the application's, over several finite `useReq` results;
library-managed paging is a later `usePaginatedReq` with a cursor owner and a page aggregate;
presentation continuity, if it is ever added, is observer-local and returns the previous descriptor
as an identifiable type. **The documentation must not claim a feed component can page**, and the
flash is written down as a known price.

### 7. One request per component, and nothing merges them

**Measured.** Fifty per-author `{ kinds: [0], authors: [<one>] }` descriptors are fifty cache
entries; the one batched descriptor is one. A fifty-note timeline with an avatar per note therefore
opens fifty subscriptions to every relay in scope, and relays cap subscriptions per connection
(strfry and nostr-rs-relay default near twenty). Per `A-α` the resulting refusals are terminal, so
the avatars that lose the race stay blank for the life of the entry — and by finding 2 they render
the error outlet rather than a placeholder. Nothing on this surface can express the merge, because
identity **is** the descriptor and there is no selector.

**Options.** (a) A request-planning layer beneath the cache identity. (b) Ship without it and name
the ceiling. **Owner: this reviewer.**

**Ruling: no planning layer in v1, and the ceiling is published.** Transparent merging looks like an
optimisation and is a new state machine — EOSE, timeout, refusal, refresh and retention all have to
be demultiplexed back to the original requests — which is too large for this accept unit. But
shipping it in silence is also refused: the README's component section states that subscriptions
grow per component, per descriptor and per target relay and that relay-side caps are
implementation-specific and not something this library can promise; the examples stop mounting
`<Metadata>` N times in a list; the guidance is to batch many authors into one `useReq` and
distribute in the application; and the built-in components declare themselves standalone /
small-cardinality with no automatic batching. **No universal number is invented** — measured
per-relay values and the conditions for reopening this are what the record carries.

### 8. `retain` and `settleTimeoutMs` split two views of one feed

**Measured.** `retain: 3` and `retain: 200` over one filter are two entries, as are two settle
timeouts. A sidebar showing three latest notes and a main column showing the feed are two
subscriptions, two accumulations, two verifications — and, because the bound is applied to the
stored set, two answers that can disagree about what exists. Both fields are properties of the
_asker_ rather than of the question: how much I display, and how long I will wait.

**Options.** (a) Take them out of the key and apply `retain` per observer over one generously
bounded set — `B6` already makes the bound a pure function of the events, which is what would allow
it. (b) Keep them and price the split. **Owner: this reviewer.**

**Ruling: both stay in the key.** `retain` changes the stored canonical set and `settleTimeoutMs`
changes when the backward leg ends and what completion means, so the same filters are **not** the
same answer. Removing them because they are "the asker's business" propagates the first observer's
values to every later one. Sharing would need a two-layer design — one unbounded raw set, retention
and completion derived per observer — which redefines the memory owner, GC, per-observer timeouts
and refresh outcomes, and is a different ADR. v1 accepts the split request's cost, and consumers are
told to share a descriptor policy or slice a larger `retain` themselves.

### 9. A sleep, a tunnel, or any gap past the retry ceiling kills every live feed on the page — and the frozen feed renders as healthy

**Measured, link by link.** rx-nostr's default retry is bounded (`maxCount: 5`); retries exhausted
is `error`; `error` maps to `terminal`; `terminal` is absorbing, and when every relay in the target
set is terminal the live leg ends. `reconnect()` has exactly one caller in the engine and it is the
**preflight** — it runs when a _new_ request starts. `A13` sets `refetchOnWindowFocus`,
`refetchOnReconnect` and `refetchInterval` all `false`.

**What a consumer meets.** A laptop sleeps for ten minutes, a phone backgrounds the tab, a train
enters a tunnel. Every socket dies, the five retries are spent in about half a minute, every relay
parks in `error`, the leg ends. The machine wakes: `online` and `focus` fire and this library has
switched both off, no timer re-asks, and nothing calls `reconnect()` because nothing starts a
request. The subscription is gone for the life of the page — and the slot table reads `status`
alone, so a state holding events renders `default`. **The user sees their timeline exactly as they
left it, indefinitely.**

**Why this is a decision and not a bug.** `A5`'s whole ground for not ending a leg on a disconnect
is that "rx-nostr reconnects on its own and re-sends the ongoing REQ" — true five times. The one
option that would raise the ceiling is `retry`, which this record withholds, and the row that
withholds it argues only the other direction (a consumer setting `retry: 'off'` would end a leg on a
momentary blip); it never asks what happens when the default's ceiling is reached. `A13-C1` records
that the reconnect trigger "has no behavioural witness at all" because the live case is immune to it
— that measurement is filed as an instrument limitation and no consequence is drawn.

**This is `0001`'s own sentence, through a different door**: "a request nothing can reach goes on
calling itself live" is what the rebuild exists to remove.

**Options.** (a) The provider owns a liveness policy — an online/visibility listener that calls
`reconnect()` and re-opens ended legs. (b) `retry` stops being withheld. (c) `A5` admits a
revive-on-reconnect transition it currently forbids by name. **Owner: this reviewer.**

**Ruling: a phase-1 blocker, fixed by a provider-owned liveness policy. Landed**, as `A13-C6` and
`A13-C7` (`RC1`, `RC2`, `RC3`) with three aimed ledger entries. The provider owns a `ResumeHints` —
listeners in a browser, **none** on a server, removed by its teardown — and a live request whose
forward leg ended with no refusal under it schedules a backoff against the provider's clock, then
refetches when it passes. **The single-flight clause for a user `refresh()` arriving mid-recovery is
witnessed too**, as `A13-C9` (`RC5`): it was argued here as one flight "by construction rather than
by an arm" and listed as residue, and writing the arm found a defect that argument had hidden — a
successful request reporting `cancelled / consumer-released` to the caller. The arm is differential,
because a lone recovery costs the same frames a shared flight does. Calling this "live" as it stands
is refused. The policy: it applies to live requests with an active observer; retry exhaustion or a
transient terminal schedules a provider-owned backoff recovery; the browser's `online` and
visibility-return are **hints that bring the wait forward**, not the trigger, because relying on
them alone cannot recover from a relay-specific failure; recovery starts a **new attempt** rather
than reviving an ended leg, so `A5`'s absorbing rule stays true within an attempt; data is kept and
the recovery is visible on activity/diagnostics; overlapping recovery, a user `refresh()` and mount
triggers all enter the same single-flight rule; and `rejected` or a protocol `CLOSED` is not retried
unconditionally — transient transport exhaustion and consumer-actionable refusal are separated.
Handing `retry` to the consumer (b) is refused for leaking ownership again; reviving the same leg
(c) is refused for rewriting a terminal outcome after the fact. The trigger is added to `A13`; `A5`
stays attempt-local.

### 10. Every one of the eleven request components cannot reach the diagnostics axis that degradation is routed onto

**Measured.** `Outlets<T>` hands a snippet `T`, and `T` is `{ events, state }` or
`{ event, state }`. No `activity`, no `diagnostics`, no `refresh()`. The slot mapping is a function
of `state` alone, by decision.

**The count is eleven and not "eleven of twelve", which is a distinction the adjudication of
2026-09-11 required.** `MAIN_SURFACE` lists **twelve** components, and one of them — `NostrApp` — is
the **provider**: it makes no request, has no outlets, and is not what this finding is about. The
population here, and in `NA-6` and `NB-1`, is the **eleven request components**; `NostrApp`'s own
lifecycle witness is a separate thing and is counted separately.

**What a consumer meets.** `C5` says a failure over data already shown "stays on the diagnostics
axis" — for a component consumer that means it is not reported at all. Unreachable from a component:
`legEnded` (finding 9's only signal), `refusals` (which relay refused and why), `lastError` over
shown data, and `activity: 'idle'`. The sharpest case: a relay list that is all write-only makes
every request "not asked", reported as `loading` with `activity: 'idle'`, so the component renders
the `loading` snippet for ever — and the published string that explains it, `'no-readable-relay'`,
lives on `RefreshOutcome`, reachable only through a handle a component consumer does not have.

**And the escape does not compose**: a consumer cannot mount a sibling `useReq` on the same entry,
because the per-kind descriptors are not published (finding 16), which `LK6` and `LK7` hold between
the record, the manifest and the entry.

**Options.** (a) The outlets gain the handle, or a fifth outlet — which `C1` forbids by name. (b)
`C4b` is restated as "a third axis available to `useReq` consumers", which is a smaller decision
than the one being accepted. **Owner: this reviewer.**

**Ruling: four outlets, all of them carrying the request. Landed as the printed shape**, held by
`C4b-C2` (`CD4`) with an aimed ledger entry. What a port still owes is the components themselves:
the spike has none, so the arm reads the block this record publishes rather than a snippet being
rendered. No fifth outlet. Every outlet's snippet takes a `RequestOutletContext` with
`request: ReqHandle`, and `Events`/`Event` **lose their `state` field** — the one route to state is
`request.state`, because two routes would need a contract that they are the same snapshot and buy
nothing. The `error` argument stays, as the slot's own discrimination, fixed to be the same object
as `request.state.error`. `loading` and `nodata` need the handle too: the all-write-only
`loading + idle` case never reaches the default slot. Storing a handle outside the slot is closed by
11's revocation rule. Retreating `C4b` to a `useReq`-only claim is refused as inconsistent with
`C1`/`C7` keeping the component layer as a primary surface.

### 11. The rebuild carries forward the one defect group `0001` admits nothing pins

`0001`'s driver is that the library owns what it created, and the group it names is "the
subscription's lifetime belongs to a `req` the caller passes in, so it outlives its consumer,
starves other consumers of the same object" (`#61`, `#73`, `#82`). This record's own words for the
detached handle are "a **write capability on a shared entry with no read-back**", and it measures
what one does to a bystander: settled-with-an-event to `incomplete`, leg ended, `lastError` set,
`activity` to `idle`, live subscription stopped — "and its slot does not move." That is _outlives
its consumer_ and _starves other consumers_, on a different object, and the response here is advice
rather than a decision.

`0001` concedes this group has **no characterization arm**. So the group with nothing pinning the
old behaviour is the group whose symptom the new design carries, which makes the comparison `0001`
rests on narrower than it states.

**Options.** (a) Decide the handle's lifetime — reject `refresh()` once the caller's root is gone,
and price the lost cache-warming. (b) Restate `0001`'s driver to exclude this shape. **Owner: this
reviewer.**

**Ruling: revoke the write capability when the root is released. Landed**, as `C11-C19` (`LC12`,
`LC14`, `LC15`, `LC16`) — the four arms that _recorded_ the defect now hold the repair, in the same
arrangements, each with the positive control the inversion needs. Each handle holds a lease on the
effect root that created it; root disposal revokes it irreversibly; a refresh already in flight ends
as 5's `cancelled / consumer-released`; a refresh after disposal is `not-started / released`
immediately. Provider-level cache warming, if it is ever wanted, is a separate explicit owner API
rather than a component handle. Option (b) — narrowing `0001`'s driver — is refused: it does not
remove the defect, only the sentence comparing against it.

### 12. `C-δ` cannot build the relay-status UI it exists for, and `C4b`'s falsifier is met

`C4b` is falsified "if a relay-level fact has to be attributed to a request". `RelayDiagnostic`
carries `url`, `configuredUrls`, `connection`, `read`, `write`, `lastNotice`. So: _why_ a relay is
in `error` is not on the axis (no reason, no close code, no time); **`Refusal` — which carries
`from`, the relay — lives on `ReqDiagnostics.refusals`, per request**; nothing anywhere carries a
timestamp; and "never tried" and "connected long ago" are both `initialized`.

`auth-required:` is the commonest reason a relay is useless to a user. It arrives as a `CLOSED`, is
classified as a `RefusalReason`, and is readable only through a request — so a panel opened
_because_ a relay is misbehaving cannot say which relay is refusing. **This is the defect already
repaired one field over**: `lastNotice` moved to the provider precisely because a panel mounted
after a notice showed nothing. The repair was applied to `NOTICE` and not to `CLOSED`.

**Options.** (a) A per-relay refusal record on the provider's map. (b) `C4b` restated so relay-level
failure facts are admittedly request-scoped, which contradicts the row. **Owner: this reviewer.**

**Ruling: a bounded last-refusal observation on the provider's per-relay map.** The request-scoped
`Refusal` stays, because completion has to be attributed; the provider keeps a diagnostic summary
beside it: `lastRefusal?: { reason, notice, observedAtUnixSeconds }`. It means **"the last `CLOSED`
observed on this relay"**, not "this relay is refusing everything now". The unix-seconds field is
named in full so the unit is not left to the port and a stale `auth-required` is not read as the
current connection reason. One per relay, the existing `RelayMessage` bound for the text, cleared
when the relay leaves the accepted scope and at provider teardown, and never dependent on a hook's
mount time. Retreating `C4b` to request scope is refused.

### 13. A refused relay list is a 500 on the server and a torn-down subtree on the client, and relay lists are user data

This record says "a relay list the boundary refuses is a programming error", and first construction
throws. But relay lists come from a signed NIP-65 event, a settings row, a `nprofile1…` hint —
untrusted input where `"wss//relay.example"` is an ordinary typo class. `C16-C4` measured that
neither boundary shape a consumer writes catches it. **And there is no way to check first**:
`createRelayScope` is correctly unexported and nothing replaced it, so a consumer can classify the
crash they already had but cannot avoid it.

Multi-account amplifies it: the natural `{#key accountId}` reset makes every account switch a first
construction, so the caught-and-published path never runs.

**Options.** (a) Publish a total validator. (b) Make first construction refuse-and-publish with an
empty accepted scope, which `B-γ` already renders as "not asked". **Owner: this reviewer.**

**Ruling: first construction stops throwing. Landed**, as `C16-C1` and `C16-C4` rewritten to it
(`CF1`, `CF3`, `CF3b`, `SS1`, `SS5`, `CX11`, `TD11`, `TK1`), with two aimed ledger entries — one
that puts the throw back, one that keeps the refusal and never publishes it. An invalid list at
first construction creates no socket, leaves the accepted scope empty, still mounts the children,
and publishes the error through the diagnostics hook. A later invalid update keeps the previous
accepted scope and client and publishes the error, as now; a valid update clears it. A partially
valid list is **not** partially accepted — the whole list is refused. A published total validator
can be added later as an aid but is refused as _the_ answer: it cannot prevent the crash when a
consumer forgets to call it, when the value changes between validation and a reactive update, or
when SSR builds the provider from another entry. Making the library boundary itself total is what
`C16` is for.

### 14. `C6` binds three things with different lifetimes, and multi-identity has no non-destructive move

A real client has two identities on screen constantly — mine, and whoever I am reading — with
different relay sets. `C6` offers two moves and both are destructive. **Changing `relays`** makes a
new scope generation, so every cache key on the page changes at once: every mounted request returns
to `loading`, `A4` forbids `placeholderData`, and the previous generation's entries are unreachable
for `gcTime`. **A second provider** shares nothing: two sockets per common relay, two caches, two
clocks — and two diagnostics maps with no way to combine them, so an app-shell relay panel silently
omits the inner provider's relays while `C-δ` promises "a complete map of the scope's relays".

There is no third move: no invalidation verb is published — `LK7`'s equality is what would notice
one arriving — and `namespace` may only split.

**Options.** (a) The connection stops being co-owned with the cache and the scope — sockets pooled
by canonical relay name, which `B-α` already makes safe. (b) `C6` states plainly that this library
supports one identity per page. **Owner: this reviewer.**

**Ruling: neither option — `C6` is redefined.** A provider is **one resource ownership domain**, not
one identity: one connection pool, one cache, one clock, one diagnostics map. Its `relays` prop
defines the default and accepted relay universe; a request selects an effective subset of it (3);
sockets for a common relay are shared **within** a provider; `namespace` separates identities on the
cache where filters do not already; two providers remain an isolation boundary and share nothing,
and an app-shell panel is complete for its own provider's scope. A multi-account application passes
one provider the union of the default relay sets and selects a subset per request. A process-global
pool is refused for making teardown, SSR and test isolation ambiguous again; "one identity per page"
is refused for not matching how Nostr UIs are built. There is no authenticator in v1, so
per-identity connection ownership does not have to be fixed now.

### 15. The first request every Nostr client makes is keyed by its own answer

The app boots with bootstrap relays `B` and fetches the user's NIP-65 list. The answer is `L`, so
the app sets `relays={L}` — which changes the scope identity, so **the relay-list request is
re-keyed and re-asked under `L`**. If `L`'s relays hold an older kind-10002 the answer is `L'`, the
app sets `relays={L'}`, whose entry may still be warm, so it flips back with no network delay to
damp it. `gcTime` keeps both entries warm.

There is no `enabled` to break the cycle (finding 4) and no way to say "this request is not a
function of the scope". **Options.** The descriptor field finding 3 proposes fixes this **only if**
the record says a request naming its own relay subset is keyed by that subset _instead of_ the
provider's scope; folded in beside it, the loop survives. **Owner: this reviewer.**

**Ruling: the key uses the request's effective target set. Landed**, as `B3-C7` (`RT3`) with `B3-C8`
(`RT4`) beside it. The generation a descriptor carries is `resolveTargets`' answer rather than the
scope's, so a request that named its relays keeps its entry, its data and its observer while the
provider's list moves, and one that named none does not.
`effectiveTargets = descriptor.relays ?? provider.defaultReadableRelays`, and the relay part of the
key is `canonicalIdentity(effectiveTargets)`. So while the provider's accepted universe, clock and
client owner are the same and the selected relays' read semantics are unchanged, adding or removing
a relay _outside_ the selected set does not re-key an explicit request. A selected relay that leaves
the scope or stops being readable is a scope refusal, typed, per 3 — an empty explicit target set is
`not-started / no-readable-relay`, and a non-empty but invalid one is **not** folded into that
state. **The key must therefore not also carry the provider's generation counter**, and if a valid
universe update swaps the transport the provider is responsible for carrying existing entries over
to it. `B → B ∪ L` keeping the key, the data and the observer identity for `relays: B`, not
re-sending the bootstrap REQ, and leaving no subscription on the old transport, is one contract
scenario. **This must land with 3 and 14**: a subset field added to today's single scope-generation
key leaves the loop standing.

### 16. Three decisions are stated in Svelte's vocabulary without being marked, and the twelve components are undefined

- **Environment detection is un-overridable by decision and undefined by the records.** The only
  definition is a `typeof window` test in a spike file the records outlive — which is the exact
  failure `0002` names for `gcTime`. A runtime where the heuristic misfires (extension service
  worker, Web Worker, Deno, React Native) takes the server branch and reports every request "not
  asked" for ever, with the escape closed by decision.
- **`A12-C4` is a Svelte behaviour, not a contract.** It requires that the context read _throws_
  outside initialisation. React's `useContext` returns a default, Vue's `inject` returns
  `undefined`. A port cannot implement it as written and must invent the decision.
- **"Derived on every read" is a signals assumption**, and `C13`'s repair is a signal-graph fix for
  a signal-graph problem. Worse, the record _rejects_ an alternative because it "makes an ordinary
  read a `$state` write, which the framework refuses outright" — an argument that does not apply to
  a framework without that refusal.
- **`C7` says the components are one implementation and never says what they ask.** Only
  `EventList`'s descriptor is specified. For the other eight the records say nothing about `kinds`,
  `live`, `retain` or `settleTimeoutMs` — **and all four are in the cache key**. So two ports
  produce different cache identities for the same published component name, and a consumer's own
  `useReq` cannot share an entry with `<Metadata>` unless they guess all four.

**What would tip the last one**: a four-column table here — component → filters, `live`, `retain`,
`settleTimeoutMs`. It is the difference between `C7` being a decision and being an intention.
**Owner: this reviewer.**

**Ruling: framework scope kept, environment semantics fixed, component table a blocker. The table
has landed as a checked artifact** — `C7-C2`, `C7-C3` and `C7-C4` parse it out of this record and
put every row through the descriptor boundary (`CD1`–`CD3`), so an unbuildable row, a computed
retention that refuses an empty list, and a cell that drifts from what a consumer would key are each
a red arm rather than a reading. What is still owed is that a component _builds_ its row, which
needs components: that is `NA-6`, and it is the port's first run. Svelte 5 only stays, and is
stated: `C14`, snippets, context and effect lifetime were chosen knowing cross-framework portability
is not a goal. `A12-C4`'s throwing context read and `C13`'s derived read are marked
`svelte-behavior`, and **"port" is fixed to mean spike → production Svelte**, not cross-framework —
so React's `useContext` returning a default is not a counterexample to `A12-C4`; another framework
is another ADR and another public API. But leaving `typeof window` as the only definition of the
environment is refused: server means _Svelte server render, where the client lifecycle capability
does not exist_; the transport capability is minted by the provider in a client-only lifecycle and
is absent from an SSR context; a server render validates the scope and creates no socket, timer or
listener; the supported hosts are the Svelte 5 DOM client and Svelte SSR, with Web Worker, service
worker, React Native and Deno declared v1 non-goals; and contract tests run against real server
compiler output and browser hydration. **The descriptor table for every request component is a
phase-1 blocker**, and the adjudication supplies it — including the correction that the first eight
rows leave `retain` absent rather than `ids.length`, because `retain: 0` is refused by the boundary
and would make an empty `EventList` unable to reach `B8`'s answered-empty state. Each row owes an
architecture/contract test that the component's descriptor and the same descriptor passed to
`useReq` produce the same key — `C7-C4` is the half of that this branch can run, and `NA-6` is the
half that needs a component.

### And one that turned out to be a wording defect rather than a design one

`B4` announces itself as an allowlist — "what is accepted is written down: `ids`, `authors`, `#e`
and `#p` …" — and a port reading it as one would refuse `#d`, `#t`, `#a` and `#r`, which would make
the published `Article` component refuse its own descriptor. **Measured: all four are accepted.**
The prose is what is wrong, and it is corrected in `0003` rather than listed here.

## More Information

The eleven hand-written mappings and the count of hooks against components were measured rather than
assumed. **The absence of any consumer using the removed `operator` argument was not**, and this
sentence claimed it was for seven rounds — it survived a sweep for "dependent projects" because it
does not use the phrase, which is the difference between sweeping a phrase and sweeping a claim.

No consumer of `operator` is known to us. That is a low-confidence input to the migration risk and
it is not what C3 or C9 rest on: C3 rests on a compatibility layer for the removed arguments either
reproducing the defects they cause or silently changing what they mean, and C9 on a low-level entry
being something that can be added later and not withdrawn later. The first of those decided C7: "the
components are generated" reads as a build-time convenience, and what it is actually deciding is
that a component does not get to choose the semantics.
