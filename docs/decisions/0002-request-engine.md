---
status: accepted
date: 2026-10-02
decision-makers: akiomik
consulted:
  redesign review rounds 1-30, the r7 review of rounds 31-32, and the external reviews of r33 and
  r34
informed: nosvelte users
---

# How a request runs

## Context and Problem Statement

A Nostr request has two halves that behave differently: a backlog that ends, and a live subscription
that does not. The current implementation runs one subscription and hands its lifetime to a `req`
object the caller supplies, which is why it cannot close what it opened, cannot tell those two
halves apart, and cannot say whether a request is still running.

It also has to be built on something. The query library provides caching, deduplication and
lifetimes; it does not provide a way to feed a query from a stream, except through an API marked
experimental.

## Decision Drivers

- **A request that cannot be reached must not report that it is running.** Most of the visible
  defects are this one sentence.
- **The library closes what it opened.** Teardown cannot depend on the caller.
- **Reversibility.** The heaviest choice here is a dependency on an experimental API; it is only
  acceptable if leaving is possible.

## Considered Options

- **Keep the query library, confine the experimental API to one wrapper.**
- **Drop the query library, implement caching directly on RxJS.**
- **Keep the query library, avoid the experimental API** by collecting the stream outside the query
  and pushing snapshots in.

## Decision Outcome

Chosen: **keep the query library and confine `experimental_streamedQuery` to a single wrapper**,
because the third option reintroduces the ownership problem — something outside the query owns the
subscription — and the second gives up deduplication and caching, which are most of what is being
bought.

The engine is a two-legged reference state machine behind that wrapper.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Falsified if                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | The query library stays; the experimental API appears in one wrapper                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | a second module imports it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A2  | The wrapper pins the streaming refetch mode to `append`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | one `refresh()` empties an accumulated list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A3  | The stream terminates actively rather than waiting to be cancelled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | a quiet stream leaves a subscription open after teardown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A4  | Published options are an allowlist; freshness options are not in it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | a **published** option makes a remount skip re-subscribing, or any freshness option of the query library is nameable on the published surface at all                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A4b | Library-owned keys are **not in the allowlist a caller can express**; the ordering that makes the library's own last write win is a property of the query library, and nothing public rides on it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | a library-owned key becomes nameable on the published descriptor, or the library's own per-query write stops outranking its own client-wide default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A5  | Six events: backlog end, live end, timeout, abort, refusal, leg end. **Both legs are decided per relay**, over a target set fixed when the request starts, and **a determined relay stays determined**: the first state that ends a relay's part of a leg is the one the attempt keeps, and every later signal naming that relay is dropped                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | a request no relay can reach still reports itself as live, **one relay disconnecting ends it** — the failure the argument below is about, and the word here was "reconnecting", which no implementation of this design can produce — a backlog that reached nobody reports its answer whole, or a signal arriving after a relay was determined moves it off that state — a socket dying after that relay's `EOSE` or `CLOSED` and adding `ended` and an error naming it to the answer, or an observed REQ putting a relay that has already answered back among those the backlog is waiting on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A6  | A fresh id per attempt, minted by the provider and named before the attempt starts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | two attempts of one request share a wire subscription id, or a caller cannot say which attempt it started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A7a | The live leg is sent with the caller's filters, no internal `since`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | an event backdated past any window would have been delivered and was not                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A7b | The library does not inject `limit: 0` into the live leg; the caller's normalized filters are sent unchanged — **with one exception, and it is the library's own edit**: a filter that can match nothing (an empty set field) is dropped from the wire when another filter in the same request can match something, because rx-nostr strips the empty field and the filter would otherwise reach the relay _wider_ than it was written. Measured (`P12`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | a filter reaches the live leg differing from the normalized one the caller wrote                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A11 | The escape route is the **accumulation seam**: a function that turns an `AsyncIterable` of chunks into the cache value, in `append` and no other mode. The client, request identity, the observer lifecycle, staleness, GC and refresh coalescing are common to both sides of it, so the fallback replaces the experimental helper and nothing else                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | a second module imports the experimental helper; **the selected accumulator is bypassed** — a request that named one is served by another, so the suite that runs against both proves nothing about either; or one expectation over `ReqHandle` passes on one accumulator and fails on the other — how many REQs go out, whether two hooks share an accumulation, whether their `refresh()` calls share an attempt and an outcome object; **or the engine needs the accumulator to reach its `streamFn`, to drive it to an ending, or — once an external cancel has arrived — to return at all** — a type-legal accumulator whose invocation ends without reaching it, or that folds a prefix and returns before the attempt has ended, leaves a `refresh()` that settles with an answer belonging to no attempt; one that never resolves leaves a `refresh()` that never settles **though its consumer went away or its fetch was cancelled**. A pending invocation whose consumer _stays_ is not falsifying here, whether it never reached `streamFn` or reached it and stopped taking chunks: it is bounded by nothing, and what it violates is a postcondition of the two accumulators this library ships (`A11-P1`, `A11-P2`) rather than anything the engine prevents. **The engine's guarantee is failure containment for an invocation that returned, threw or was externally cancelled; parity is a measurement over the two implementations that exist, and the two are not one claim** (`A11-P3`) |
| A12 | The server does not subscribe, and reports "not asked" — unless the descriptor is refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | a server-rendered page shows "nothing found" before hydration, or hides a refusal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| A13 | Freshness triggers are chosen, not inherited. **The mount trigger is the observer count**, and the **provider owns a liveness trigger the query library does not have**: a live request whose relays have exhausted their retries is recovered on a provider-scheduled backoff, with the browser's `online` and visibility-return used as hints that bring that wait forward rather than as the trigger itself                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | returning to a tab re-requests every settled request on screen; a second component mounting over a settled request re-asks; **or a live request whose transport gave out stays silent with nothing scheduled to recover it**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A14 | No retry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | one wrapper bug produces more than one request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A15 | The library builds and owns its query client                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | **its defaults are not a caller's to override field by field.** Under a provider the client is the provider's, and in v1 there is no other way to get one: nothing published takes a client, and `A16` decides the port keeps no caller-owned standalone arm. The spike's arm, which serves such a caller from its own inputs and refuses the ones it cannot resolve, is a measurement of the spike and not a rule a port implements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A16 | **A request is served by exactly one runtime, and in v1 that runtime is the provider's.** The capability is minted where the provider is — its transport, scope, client, verifier, side, clock and attempt registry — and **v1 has no caller-owned standalone arm at all**: nothing published takes an owner input — `ReqDescriptor`'s six fields and the provider's two props are the whole surface, and `0004` C9 keeps a low-level entry from being added beside them, which is a **different** proposition and not the ground for this one, and the port keeps no internal constructor for one either. A request without a provider is a mistake a consumer can make and the library refuses it; it is not a second shape of runtime. **The spike has one**, because it drives the engine without building a provider, and what that arm does is recorded below as a measurement of the spike rather than as a rule a port implements. The obligation returns two ways, and they are not the same: a decision that adds a **published** entry taking an owner input reopens this row, and reopens `0004` C9 as well when that entry is a low-level one — C9 forbids the entry, not the input, and conflating the two is what an adversarial pass found here; a port that adds an **internal** standalone constructor reopens this row alone, since C9 is about the published surface and says nothing about internals                              | a published entry, or an internal constructor, that builds a request from caller-supplied inputs — that is the state this decision says v1 does not have, and `A16-C2`–`A16-C5` are `absent` against **this** row rather than owed. **The spike's arm, recorded and not required:** it reads no field of a provider, resolves three inputs itself (it detects the side, takes the relays the caller's own client carries when no scope is given, and treats an absent clock as no expiry judgement at all) and refuses the four it cannot — the client and the attempt registry by name on the outcome channel, the verifier and the transport by failing the request, measured as `status: 'error'` carrying "this request has no signature verifier" and "no usable client". Two of those resolutions were never v1's even as behaviour: the moving default relay set, and the low-level option bag itself. What the arm buys this branch is isolation — a request cannot wear a provider's value and a caller's at once, which `OM2` measures by counting provider reads                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A-α | A refusal is classified by its protocol prefix; the policy is separate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | a refusal's class comes from anything but its prefix, or the recovery policy reads the notice text instead of the class. Not falsified by every class mapping to the same action today — that is v1's policy, recorded below, and keeping the split is what lets it change without re-parsing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A-γ | The settle timeout is finite, per request, overridable and **capped**, and the library holds rx-nostr's own EOSE timer above that cap                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | a single silent relay keeps a request from ever settling, or a timer the caller did not set closes the backlog first                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A-δ | The provider owns a clock and a scheduler, and disposes both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | a timer outlives the provider that armed it, or two providers share one clock                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A-ε | An attempt's outcome is observable only once everything causally prior to it is reflected — **the events it accepted included**, where an event is `accepted` once it has passed the signature gate and only if it passed before the wait it belongs to ended — **that clause is the definition of the word, and every other record states `hasMatchEvidence` in it rather than paraphrasing it** — and the end of a stream releases its producer as it is decided, **without discarding what that producer had already accepted**. A wait belongs to **one leg**, and covers what that leg was holding when the boundary was drawn. **A cut is reported per leg, and the two legs do not report the same way — which is two clauses rather than one compressed into `legEnded`.** A **backward** cut is the end of the backlog, so it is reported on the answer's causes, under `verification-timeout`: a cause of its own, separate from `timeout`, which says this request stopped waiting on a backward target rather than hearing from it — its own settle timer drew the boundary (A-γ), or a target was still undetermined when the outcome was derived. A **forward** cut is reported by the leg end around it and by nothing finer — `legEnded`, which is forward-only, says the leg is over and does not distinguish one that ended discarding a candidate from one that ended discarding none. Neither leg publishes anything per candidate | an outcome is observed that a signal already sent would have changed; a signal arriving after the end is delivered; **an event the attempt had already accepted is not delivered because the wait it belonged to ended**; or one leg's outcome waits on the other leg's gate. **Not falsified by a candidate that was still being verified when its wait was cut**: it never became `accepted`, and the wait's finiteness is A-ζ. Falsified instead by **a published field that separates a forward leg end which discarded a candidate from one that discarded none** — the marker a hostile relay would buy with one event it never lets verify — by a leg that ended and published no end at all, or by a backward cut reported under `timeout`, the cause that says this request stopped waiting on a backward target rather than hearing from it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A-ζ | The signature gate's drain runs on a budget of its own, and it is not A-γ's. It belongs to the **gate**, so there is one per leg. It is a **no-progress deadline**, re-armed by every candidate that clears rather than spent once over a boundary; it is the **floor** while that leg has verified nothing and `max(floor, ceil(min(this leg's slowest verification, floor) × safety))` once it has; and **no caller sets it**. Where a cut is published is A-ε's                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | a gate that has stopped moving is waited on for as long as it stays stopped; a deadline is armed outside `[floor, floor × safety]` — reached by extrapolating from a sample nothing clamps, which leaves the wait finite only in the sense that a timer exists; a deadline is the floor whatever that leg has measured, which cuts the working verifier the adaptive form is for; one budget is held outside both gates, so a deadline armed over one leg is computed from what the other leg paid; or the cutoff becomes a value a caller names, `settleTimeoutMs` included. **Not falsified by a whole drain having no constant bound**: what is promised is the interval each arming falls in, and how many armings there are is the count that leg was already holding — the relay's number rather than this record's. **Not falsified by a leg's first candidate being cut at the floor**: that is what the floor is, and the section below says on whose evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**And the sentence above says "unchanged" with an exception, which was written in a code comment and
nowhere else.** `wireFilters` is `filters.filter(isSatisfiable).map(cloneFilter)`: a filter carrying
an **empty set field** — `{ kinds: [1], authors: [] }` — is removed on the way out. It has to be.
rx-nostr deletes an empty set field before sending, so that filter would arrive as `{ kinds: [1] }`
and match every note of that kind; dropping it is the library keeping the wire from being _wider_
than what the caller wrote. When **every** filter is like that the request is answered without a REQ
at all (`B8-C1`), and that case is recorded; the mixed case — one unsatisfiable filter riding along
with a satisfiable one — is this one, and `P12` is the arm. A port that implements A7b literally
re-ships the widening this drop was measured against.

**A7b is about what the library adds, not about what a caller may write.** An earlier wording said
"no `limit: 0` on the live leg", which contradicts A7a: `limit: 0` is a valid filter, it is
accepted, it takes part in cache identity, and A7a sends the caller's filters through unchanged — so
a caller who writes it gets it. What is decided is that the library does not add one of its own. The
reason is interoperability rather than protocol ambiguity: NIP-01 says `limit` applies to the
initial query and is ignored afterwards, so the specification is clear and implementations were
observed not to agree. That observation is not reproducible now, which is why it is recorded as
history below rather than as a falsifier.

**A6 is three claims: a fresh id per attempt, an id named before the attempt runs, and an owner for
both.** (It read "two claims, and the second one is about ownership" while the sentence after it
named _timing_ as the second — the lead was counting a list it then contradicted, which the two
paragraphs later in this file legislate against.)

A fresh wire id per attempt is why a re-request reaches the relay at all: rx-nostr's
per-subscription counter restarts at 0, so a fixed `rxReqId` re-sends the id the previous attempt
used and the duplicate is dropped. The second claim is that the id is _named before the attempt
runs_, and that is what makes `refresh()`'s Promise expressible: 0003's stamp can only mean "the
attempt I started" if the caller holds the id it is waiting for at the moment it asks for the
attempt.

**Every subscription this library opens is named by it, and the id has a character budget.**
rx-nostr draws an `rxReqId` at random when it is given none, out of a space of 10^6 — small enough
for two requests in one session to collide, and a collision there is two subscriptions sharing a
name on the wire. So this library always supplies one, and never depends on the width of that space
— `WR18` reads this spike's modules for a subscription opened without a name, and `A6-C7` is the
row.

What it supplies rides inside a NIP-01 subscription id, whose cap is **64 characters**. The
library's own share is
`25 + digits(the registry's attempt counter) + digits(the dependency's leg counter)` — the `-`
joining the caller's base, `r`, the origin token, `a`, the counter, `-b`, `:` and the dependency's
number, which is `0` for every request made here because the backward leg is a oneshot req. The
origin token is **19 characters of base 36, carrying 96 bits**; at a three-digit counter the share
is 29 and a 32-character base sits at 61 of the 64. **Both numbers are here rather than only in the
code**, for the reason the `gcTime` paragraph below gives: widening the token spends a budget the
protocol sets, and a port that mints longer bases owes the arithmetic again.

**The 96 bits are what the platform's CSPRNG gives, and what happens without one is part of the
decision.** `getRandomValues` first; then `randomUUID`, which carries the same **96** — the version
and variant nibbles are fixed, so both are dropped _before_ the first 24 hex characters are taken,
leaving 30 free characters to take 24 of; a naive slice of the raw UUID would carry **90**, and that
number stood in this paragraph for a round after the code stopped taking it; and then **nothing**. A
runtime with neither is refused where the registry is built, with `MissingRandomnessError` on the
published surface, carrying `code: 'missing-randomness'`.

**A third fallback stood there and is deleted, which is the decision rather than a detail.** It
composed three `Math.random()` draws into the same 96 characters, and this record admitted at the
time that the entropy behind them is one host PRNG's — so two realms whose seed agrees draw the same
token, which is exactly the boundary the value exists to separate. Keeping it meant keeping a wrong
answer for a runtime nobody supports yet, and a reviewer refused the trade. The alternative for a
product that needs such a runtime is an **issuer**: a generation handed in across the hydration
boundary, which is the design exact identity would need anyway.

**Both remaining branches and the refusal are witnessed by one arm** (`E26`), which takes the two
functions off `globalThis.crypto`. Every host this suite runs on has `getRandomValues`, so without
that arm neither the UUID branch nor the refusal is reachable from here — which is why it exists
rather than leaving the nibble arithmetic checked by hand and by the record. What `E26` does **not**
measure is _which_ nibbles are taken: two real UUIDs differ under any slice, so the 96 above was a
claim the arms were silent on, and the record carried 90 for a round without anything noticing.
`E27` is that arm — a known UUID handed to `randomUUID`, and the token compared against the base 36
of the 24 characters this branch is supposed to take.

**Where the caller's base comes from is a port's decision, and the arithmetic above assumes an
answer.** The spike takes `reqIdBase` as a required option on the hook, which is a spike shape: the
published descriptor has six fields and none of them is a subscription-id prefix, and 0004 gives the
provider everything else of this kind. So a port mints the base beside the attempt id, which makes
the whole wire id the library's and the budget above entirely its own arithmetic. **The second
option this paragraph used to offer — taking a base from the consumer — is one `A16` forbids**, and
saying otherwise here was a contradiction a port would meet only after implementing it: the
descriptor's six fields and the provider's two props are the whole surface, and a caller-supplied
prefix is a seventh field or a third prop. What it would cost is kept because it is the arithmetic
that reopens this: at a 32-character base the wire id is 61 of the 64 available, with no room left
for a second caller-supplied part. Publishing that input is therefore a change to `A16` and to
`C9`'s surface, not an addition to this decision. Written here because the paragraph above computes
a budget against a value the records otherwise never mention.

That puts the mint on the provider rather than on the hook or on the module. Per hook is not enough
because two hooks over one cache entry is what the query layer is kept for, and two minters would
hand that one entry overlapping ids; a module global is one per process, shared between
server-rendered requests and between test suites, which is the shape C6 exists to remove.

**The id is opaque to everyone except the module that mints it, and this record said "everyone" for
a round.** Two readers, and separating them is what makes the sentence true and `B-η-C5`
implementable at the same time:

- **A general reader — every consumer, and every part of this library that is not the registry —
  reads an id by equality only.** "Is this the attempt I started?" is the only question the value
  answers there, and nothing downstream reads a sequence into it.
- **The minting module owns one comparator**, `isOlderAttempt`, and it answers a narrower question
  than "which came first": _may this chunk move the value backwards on this lane?_ It is defined
  only between ids from the same registry — different origins have no order at all, which it reports
  as `false` rather than as a guess — and its call sites are an **authorized set of two**, both in
  the value's own module: the rewind guard in `beginAttempt`, and the failure writer, which drops a
  superseded attempt's late failure for the same reason the fold drops its late chunk (`B10-C6`).
  **It was one, and the second is a decision rather than a drift**: the writer had no order at all,
  an older attempt's Error overwrote the current generation's, and the round that found that
  declined to guard it _because_ this sentence said one — which is the instrument choosing the
  contract instead of watching it. Mint order is not a claim about when attempts _ran_: two attempts
  on different lanes may run in any order, and the comparator is not asked about them.

So "no sequence is read into the id" is a rule about the general reader, and the supersession rule
needs an owner rather than a format. The record used to state the wider version and the tree
contradicted it the moment the comparator was written.

**That last clause is a discipline and not a type guarantee, which this record claimed for several
rounds and is residue.** `AttemptId` is a branded string, and a branded string is a subtype of
`string`: measured under this project's own `tsconfig` (tsc 5.9.3, `strict`), `a > b` and
`[a, b].sort()` over two minted ids compile at exit 0. The failure is quiet rather than loud, which
is what makes it worth recording — ids are minted `a1`, `a2`, …, so `'a10' > 'a9'` is `false`, and
among the first dozen every id from `a2` to `a9` compares as greater than each of `a10`, `a11` and
`a12`, which is the reverse of the order they were minted in. **A count stood here and its
denominator was wrong**: it gave the ordered pairs among twelve ids as 144, which is twelve squared
and counts each id against itself. The disagreement is stated as the rule that produces it now, so
there is nothing to recompute. A future reader who reaches for `>` is answered wrongly instead of
being stopped.

**The falsifier is narrower than it was, because the wide one is now false.** It used to be "a grep
for a relational operator or a `sort` over an `AttemptId` finds nothing in the tree" — and
`isOlderAttempt` is exactly such a read, by design. What holds today is: **the only order reader is
the designated comparator, and its call sites are the two authorized above.** A second reader, or a
_third_ call site, is what the grep looks for — `WR17` counts both, and the number is a contract
rather than a tally: widening it is how the failure writer got its guard, and narrowing it back
would be a decision about `B10-C6` rather than a tidy-up. The `>` a third party can still write
compiles and answers wrongly; that is the residue above, and it is the reason the comparator exists
in the minting module rather than as a rule everyone is asked to follow.

**The only type that refuses `>` is `symbol`** (TS2469, measured), and the near misses were measured
too — an object type carrying a `unique symbol` brand compiles `>` clean, as does a class instance,
so the cheaper-looking fixes buy nothing. Adopting `symbol` is cheap in source: two lines, the mint
and the interpolation of the id into the wire `reqIdBase`, plus two catalogue rows and no new tests.
**It was rejected on a price that does not exist, and the rejection is withdrawn.** The recorded
price read: a `symbol` crosses neither `structuredClone` nor a JSON dehydration — the first throws
`DataCloneError`, the second drops the property with no error at all — and the id is written onto a
cache value, so an SSR handoff of that cache would rehydrate values whose stamp had silently
vanished. The two measurements are true and the conclusion was not. **A12 is why no such handoff
happens**: the server does not subscribe, a server render fills no entry — measured, the entry it
leaves carries `data: undefined` and `fetchStatus: 'idle'` — and no cache value crosses a realm from
this design at all, because nothing here dehydrates, persists or structured-clones and the published
entry hands out neither the `QueryClient` nor the context. The sentence above said A12 was the
reason to keep that boundary open; A12 is the reason the boundary is not there.

So the decision is **re-opened rather than restated**, and the obligations it owes before a `symbol`
can be taken are the list below — which is the whole of them. This used to point at the file the
mint lives in for the authority, and that file is the spike: a port has the record and not
`attempt.ts`, so a pointer there is the failure this record names elsewhere as "a figure whose only
definition is a script that ships on a branch nobody keeps". The list: who owns the before-and-after
judgement inside one registry; that ids from different registries are given no order at all; how
provenance rides **on the value**, since the readers that compare ids are pure functions of a cached
value and cannot ask a registry anything; an explicit function from the stamp to the wire
subscription id; the 64-character budget recomputed against it; the stale-chunk and stale-failure
guards re-derived; a type witness that `>` is refused; and the rows that describe the current id —
`B-η-C5` names the format, the 96-bit token and the absence of cross-registry order — re-derived
with it. Until that is done the stamp stays a string, and the reason is the work, not a price.

**A13's numbers, since a policy with an inherited number is half a policy.** The library sets, on
the client it owns:

- `refetchOnWindowFocus: false`, `refetchOnReconnect: false`, `refetchInterval: false` — a settled
  request is not re-asked because a tab came back.
- `refetchOnMount`: the observer count, as the paragraphs below derive.
- `networkMode: 'always'` — the query layer does not stand between a `refresh()` and an attempt;
  being unable to reach a relay is what `timeout`, `ended` and `incomplete` say.
- **`gcTime`: `Infinity` on a server, and `300_000` (five minutes) in a browser.** An entry with an
  observer is never collected; one whose last observer let go stays reusable for that long, and a
  hook mounting inside the window shows the events it already had and starts exactly one attempt.
  After it, the entry may be collected — the precise instant is the runtime's and is not contracted.
  On a server nothing is scheduled for collection at all, because nothing there is created that
  would need releasing. **The number is here rather than only in the code**: a value that lives in a
  spike this record outlives is not a decision a port can inherit, and "the library's own finite
  window" would be satisfied by thirty seconds or thirty minutes. Changing it is an API change with
  a consumer-visible effect (what a remount shows), so it moves by review rather than by taste.

**A13 named a policy and left the mount trigger inherited**, which is the one that decides the most.
The library set `refetchOnWindowFocus`, `refetchOnReconnect` and `refetchInterval` and set nothing
about mounting, so query-core's `refetchOnMount: true` applied over an entry that is stale the
instant it settles: a second component rendering the same request sent a second REQ, minted a second
attempt, and moved the _first_ component's `activity` to `refreshing`. None of that was asked for by
either consumer, and "two hooks are one request" — the property A11 is written around — was true of
`refresh()` and false of mounting.

The two obvious settings each buy one case and sell the other. `refetchOnMount: false` and
`staleTime: 'static'` stop the second mount and also stop a *re*mount after the last holder let go,
which for a live request is a subscription that is never re-established (A4-C1, and `M10`/`M11`
measure exactly that). Leaving it `true` keeps the remount and keeps the unasked REQ.

What tells the two apart is how many observers the entry has, and query-core makes that readable at
the only moment it matters: `onSubscribe` calls `addObserver(this)` **before** it asks
`shouldFetchOnMount`, so a predicate sees a count that already includes the observer being mounted.
`1` is "nobody else is here" — a first mount, or a remount over what the last holder left — and
anything above it is a request to join. The chosen trigger is therefore

```ts
staleTime: 0,
refetchOnMount: (query) => query.getObserversCount() === 1
```

**and those two lines are one setting, not two.** `shouldFetchOn` reaches the predicate's answer
only through `isStale(query, options)`; with a staleTime the entry is still inside, the predicate
goes on returning `true` for a remount and nothing fetches, and with `'static'` it is not called at
all. So a freshness window here would not soften the trigger, it would switch it off — the same
failure `refetchOnMount: false` produces, reached by a different door.

Four facts about the dependency hold this up: the mount order, that a function in this field is
handed the `Query`, that its answer is gated on staleness, and that a query with no data loads
without consulting it at all. They are the resolved copy's behaviour rather than its documented
contract — measured at `@tanstack/query-core` 5.101.4, the copy `tanstack-svelte-query-v6` 6.1.38
resolves and not the 5.90.2 at the top level — so `SEN21` pins all four and `A13-S1` records it.
What a consumer sees of the decision is `A13-C2`, `A13-C3` and `A13-C4`, on both accumulators.

**The fourth of those facts became visible when a failed request acquired a value.** A query with no
data loads without consulting the predicate, and a request whose attempt threw used to have no data
— so the trigger was never consulted over one, and a second component rendering the same failed
request sent a REQ of its own. 0003's failure record is written onto the value, so there is a value
there, the predicate decides as it does everywhere else, and the joining hook asks nothing. That is
a behaviour change rather than a restatement of A13, which is why `A13-C4` witnesses it with a
control: the same after-state with the first hook gone still asks, so "nothing was sent" is not
"nothing mounts". What the mutation ledger measured about it is worth carrying beside it — what the
joining hook turns on is the presence of a _value_, and the failure record is what leaves one; a
mutation that keeps the write and drops the record leaves `A13-C4` green.

**A11 is a seam, and the seam has to sit where the risk is.** For nine rounds it sat at the top: the
escape route was a whole second engine — `useDirectReq` over `createRequestCoordinator`, with no
query cache at all — and the parity suite ran against that. It measured the wrong boundary twice
over.

**The dependency this record is exposed to is `experimental_streamedQuery`, not the TanStack
cache.** The name says the API is outside semver, and it is reached through a prerelease adapter;
the cache is not what the risk bullet below is about. Replacing the cache to escape a helper is
replacing the building to escape the door.

**And the pair was not interchangeable, so nothing it passed meant what it looked like.** An engine
with its own store keeps a value while somebody holds the request; a query cache keeps it until GC.
Mount-time refetch, retention across unmounts and collection therefore stay visible differences
whatever else is repaired — and "the inside is replaceable" cannot be claimed on a pair a consumer
can tell apart by unmounting a component and mounting it again. The same reading killed the
intermediate position: `P42` and `P43` — two hooks over one identity being one request on the engine
with an entry and two on the engine without — were filed as a documented cost of that engine, and
they were a counterexample to the decision they were filed under. How many REQs go out, whether two
hooks see one accumulation, whether their `refresh()` calls share an attempt and whether they are
handed the same outcome object are all things a consumer can see. Defining "request" per engine does
not remove the difference; it moves it into the definition.

(**`P43` is history and resolves to nothing in the tree**: `P42` is an arm and `P43` is a name
`parity-refresh.test.ts` uses in the past tense for the pair it once was. It is left in the sentence
because the sentence is about the round in which the position was killed, and it is flagged here
because an id that resolves nowhere reads as a witness a reader can go and check.)

**So the seam moved down to the accumulation, and the second engine is deleted.** What A11 now names
is a `queryFn` factory — `StreamAccumulator` in `accumulate.ts` — with two implementations:

- **A**, `experimental_streamedQuery`, which ships, and is the only import of the helper anywhere in
  the library (`A1-C1`, `WR1`);
- **B**, written over `QueryClient.setQueryData`/`getQueryData`, API that carries no `experimental_`
  prefix and has been in query-core since v4.

Both run under the same `QueryClient`, the same query identity, the same observer lifecycle, the
same staleness, the same GC and the same refresh coalescing, because they are the same engine. Only
the accumulation differs, which is exactly the part that would have to be rewritten if the helper
disappeared. `A11-C1` is one suite executed against both, and `A11-C3` is the observation that would
show a difference if there were one.

**The seam carries `append`, and that is what makes the fallback small.** It used to carry all three
of the helper's refetch modes, and the falsifier column then covered behaviour no request in this
library can produce: `'reset'` and `'replace'` are defined in terms of query _state_ — blank the
entry as the refetch begins, hold the value until the stream ends — so the fallback reproduced them
through the query cache's `find`, `isFetched`, `setState` and `resetState` while this record
described it as written over `setQueryData` / `getQueryData`. The description was false as written,
and the price of making it true was paid in internals copied from a version of the dependency, for
two modes A2 forbids. So A2's `'append'` is fixed inside adapter A, `AccumulateParams` has no mode
on it, and the fallback is four calls: set, get, the stream function, and reading the abort signal
once. What the other modes do is a fact about upstream and is measured against upstream
(`CTR-5`..`CTR-8`), which is also where it can be re-checked when upstream moves.

**A seam is only an escape route if every request goes through it.** The parity suite running twice
says the fallback answers the same way; it does not say that the second run reached the fallback,
and a hook that ignored the accumulator it was handed passes the whole suite because the shipping
accumulator passes it. That is measured — the mutation exists and killed nothing for several rounds
— so the falsifier names it and `A11-C5` observes it: an accumulator that delegates to the real
fallback and records that it was asked, with the answer of the request asserted beside the record.
It is a run, not a reading of the hook's source.

**The attempt boundary is the engine's entry into the query function, not the seam's cooperation.**
`StreamAccumulator` is "params in, a `QueryFunction` out", and nothing in that type makes the
returned function call the `streamFn` it was handed. So the id `refresh()` claims must be picked up
at the query function's entry — before the accumulator is built and before it is run — and the
stream function is handed the id rather than taking one. Construction and execution sit inside one
`catch`, so all three ways a query function can fail attribute the same way: the reducer throwing
part way through the stream, the returned `QueryFunction` throwing before it reaches `streamFn`, and
the factory throwing synchronously without returning a function at all (`A11-C6`, `A11-C7`,
`A11-C8`).

**Both ends of the query function are boundaries, and the second one was added because the first
alone made the failure worse.** Claiming at the entry closed the invocations that _throw_ without
reaching `streamFn` and opened their mirror: one that _resolves_ without reaching it. Nothing else
caught that. A-γ's settle timer lives inside the reference stream, so with no machine there is no
REQ, no timer and no end; the stream's own teardown never runs, so nothing abandons; and the rescue
that asks whether the claim was picked up now answers _yes_, because the entry picked it up.
`refresh()` hung, a second call joined the same flight, and the request became permanently
un-refreshable behind a spinner. So the return is a boundary too (`A11-C9`).

**The return boundary answers two questions and the first version of it answered one.** "Is there an
attempt for the waiter" is a question about the value, and the returned value can answer it. "Is
there anything still running" is a question about the engine, and the value cannot answer it at all:
an accumulator that pulls its stream once and returns without closing the iterator has opened a REQ
and left a live subscription, while returning a value with no attempt on it. That one satisfied the
first check and every other end of its producer's life is out of reach — `context.signal` is not
aborted, because query-core cancels a query function that _failed_ and this one succeeded;
`iterator.return()` is never called, so the stream's `finally` never runs; and the machine sits
suspended holding the subscription and the settle timer.

**So the producer's lifetime is the invocation's, and the engine owns it.** One `AbortController`
per invocation, aborted in a `finally` that wraps the accumulator's construction _and_ its
execution, so it fires on a return and on a throw alike; the reference stream is bound to it and
closes what it opened the moment it fires. Query-core's own cancellation is linked into that
controller rather than replaced by it — and _where_ that link is made is part of the decision, not a
detail.

**It is made at the query function's entry, and the previous round made it one call deeper.** The
argument for the deeper placement was that reading `context.signal` is what sets query-core's
`abortSignalConsumed`, so a library that read it for every query function would change how the
dependency cancels one that never asked for a signal — which is the failure mode `M5` exists to keep
reachable. That argument decided the wrong thing. `consumeSignal: false` is a spike-only option
whose entire purpose is to reproduce a defect; **a defect-reproduction path does not get to decide
where the shipping design owns cancellation**, and the way to keep both is an exemption exactly one
option wide. So the normal path links at the entry, and `consumeSignal: false` is the one path that
declines to read the signal at all. `M5`'s shape is unchanged and it still reproduces #61 through
the option that names it; the ledger carries an entry in each direction — one that puts the link
back inside the stream function, one that removes the exemption — so that both halves of that are
measurements rather than claims.

What the deeper placement cost is the case the seam never reaches. An accumulator that does not call
its stream function and simply **stays pending** was reached by nothing at all: the signal was never
read, so `removeObserver()` took `cancelRetry()`, which does not abort; the invocation never
returned, so its `finally` never ran; and there was no stream, so there was no stream teardown
either. The consumer went away and the attempt was still outstanding, with `refresh()` waiting on it
for ever. Cancellation cannot be owned on the far side of a seam whose type cannot require the seam
to reach it — the same argument that moved the attempt boundary to the entry, applied to the other
end of the same lifetime — and the abandonment is the engine's own, made immediately on the abort
rather than left to the stream's `finally` (`A11-C16`).

The read's timing bounds what may stand between the accumulator and the stream: the stream is built
at the moment the accumulator calls for it, and nothing wraps it, because a wrapper whose body runs
on the first pull defers that read past the moment the observer goes away — measured, and it
re-opened #61 for a consumer torn down promptly. A wrapper generator did stand there for a round,
taking a note when the iteration unwound; the note is gone with the predicate that read it, and so
is the hazard.

**Which side of C11 an invocation that left no attempt lands on is the decision, not the mechanism,
and the previous round put it on the wrong side.** It abandoned the claim, so `refresh()` rejected
with an abort — and where nobody was waiting, which is every first mount, abandoning a claim that
does not exist did nothing at all: the invocation had returned normally, so the entry was
`status: 'success'` over a value with nothing in it, and the surface reported `streaming([])` with
`activity: idle`. A spinner over a request that had stopped, which is the defect the round before
had just closed, reached through the seam instead of through the wait. The argument for rejecting
was "nothing was attempted", and that contradicts the decision three paragraphs above: entry into
the query function _is_ the attempt boundary, so an invocation that entered ran an attempt whatever
it did afterwards. An attempt that ran and produced nothing is an attempt that went wrong, which C11
puts on the resolving side. It is recorded as that attempt's failure, by the same write every other
failure of an attempt uses, so `refresh()` resolves `{kind: 'error'}` and a first mount reaches the
primary `error` state and the `error` slot (`A11-C9`, `A11-C10`, `A11-C11`, `A11-C12`, `A11-C13`).
Synthesising a _different_ outcome remains rejected for the reason it always was: `RefreshOutcome`'s
`not-started` carries reasons the engine decides _before_ asking (`server`, `no-readable-relay`),
which is a different fact from one discovered after the query function returned.

**The alternative was named by the reviewer and is rejected.** Redefine the attempt as starting when
the stamp first appears on the value, and this case becomes "no attempt ran" honestly rather than by
assertion. It is coherent, and it costs the two rows either side of it: `A11-C7` and `A11-C8` — the
returned function that throws before `streamFn`, and the factory that throws — would move onto the
call-rejection side with it, because neither stamps anything either. Those are attempts by every
other reading: they entered, they ran, they failed, and the failure is attributable. Moving three
rows to keep one is the wrong trade, and it would put the boundary back on the far side of a seam
whose type cannot require it to be reached.

The test the boundary applies is therefore "**did this attempt end** on the value it returned, or
was this invocation torn down". The second half is what tells a contract violation from an abort: an
attempt torn down or replaced before its first chunk leaves the same value behind as one that never
ran, and it _has_ run — the teardown abandoned it already, which is the abort side. Invocations in
the parity suite reach this boundary in that state, and reading only the value would file every one
of them as a failure. **A tally of them stood here and does not now**: the figure was taken against
a suite that has gained arms since, and what the argument needs is that the state is reached at all,
not how often.

**Two counts of the rounds this boundary has cost stood below and disagreed with each other** — one
sentence said two where another said four, in the same words about the same boundary and the same
defect. Both figures are gone rather than one being corrected, because there is no way to tell which
was right and neither had anything to notice the next round with. Where the number mattered the
shape is stated instead.

**"Ended" and not "reached", and the difference is a shipped defect rather than a nicety of
wording.** The first half read as "is this attempt named anywhere on the value" for two rounds — all
four of `running`, `forward`, `backlog` and `failure`. The first two are written by `beginAttempt`
on the **first chunk** of an attempt, so an accumulator that folds one chunk with the reducer it was
handed and returns satisfied the test while leaving no end and no failure at all: with a backward
refusal as that chunk, the REQ goes out, both legs are stamped, `break` closes the stream and the
wire, and the query **succeeds** over a value carrying no outcome — `streaming([])` with
`activity: idle` behind the `loading` slot, while `refresh()` rejects with an abandonment
`AbortError`. The stopped-request spinner, for the fourth round running. A stamp says a chunk
arrived; the boundary needs the attempt to have ended, which is `backlog` or `failure` under this id
— the same pair the wait itself reads. `A11-C15` is the row and `AC12` is the witness.

**That second half has been answered wrongly twice, and the record carries both, because this
boundary has moved in consecutive rounds.** The first version asked only the first half. The second
asked "did a stream this invocation opened unwind", read off a `finally` wrapped around the
iteration — and that predicate is false. It answers "did the iteration end", and **a stream that
simply finished ends exactly as one that was torn down does**: the machine yields its settle marker,
the reference stream returns, the wrapper's `for await` completes and its `finally` runs. So the
discriminator was _true_ for the ordinary case, and an accumulator that drove the stream to its end
and returned a stampless value was filed as an abort. Measured through a non-live request against a
relay: the entry stayed `success` over an empty value, the surface read `streaming([])` with
`activity: idle` and the `loading` slot, and `refresh()` rejected with an `AbortError` — a spinner
over a request that had _completed_, which is the same defect every version of this boundary has
been about. Breaking out of the loop reproduces it identically, because `break` calls
`iterator.return()`.

The two are correlated only for an accumulator that folds with the reducer it was handed, which is
exactly what A11's seam is not allowed to assume. Nothing could see it: every witness then aimed at
this boundary left the stream un-unwound, so all of them exercised the same arm, and the two
predicates instrumented against each other over the whole suite never disagreed anywhere.

**The third version asks the invocation's own `AbortController`**, which is already there for the
producer's lifetime. Every legitimate abort path — a torn-down consumer, a cancelled fetch, a
superseded generation, `refresh()`'s reset — reaches the boundary with that signal aborted, because
query-core's cancellation is forwarded into it. A stream that ran to its end, or that the
accumulator broke out of, reaches it unaborted. The `finally` that aborts the same controller runs
strictly after this read, so it cannot answer its own question.

**This was called "the one thing that knows the difference", and that is a sentence about ownership
which has to be earned rather than asserted.** A controller is not the engine's because the engine
declared the variable; it is the engine's only if every route that can abort it is one the engine
holds. **Enumerated, because that is the only form the claim has**: exactly two things abort this
controller — the `finally` at the end of the invocation, and the listener the entry link installs on
query-core's cancellation signal. **`WR33` counts them**, and names both, because an enumeration
that _is_ the argument and that nobody re-derives is an argument with a shelf life: a third route
added to the module left every arm of the spike suite green when this was measured. The controller
is never handed anywhere; what crosses the seam is its **signal**, and a signal offers no route back
to the controller that owns it. So the enumeration turns entirely on the second route, and **that
route runs through an object the accumulator is holding**. An `AbortSignal` is an `EventTarget`, so
anything with a reference to it can dispatch an `abort` event at it, and a listener that treats
having fired as meaning the signal aborted is a listener the far side of the seam can trigger at
will — while `aborted` stays false, which is precisely the state the return boundary reads. **The
consequence was measured and is the defect this records**: one dispatched event turned a stampless
return from a contract failure into an abandonment, and put the whole stopped-request surface back —
`success` over an empty value, `streaming([])`, the `loading` slot, `idle`, no error, and a
`refresh()` rejecting with an `AbortError`. That is the same defect every version of this boundary
has been about, reached this time from the accumulator's side. **So the obligation is on the link
and not on the boundary**: it must decide on the signal's actual aborted state rather than on an
event having arrived, and the two are different facts. **A second falsifier applies to how that
state is read**, and it was measured too: `aborted` is an accessor inherited from the prototype, so
a caller can shadow it on the instance and a link that consults the property is fooled exactly as
the one that consulted the event was. Reading through the accessor captured from the prototype
closes that, and the residue is a signal that has no such accessor to capture — a polyfill defining
`aborted` as an own data property, where the instance read _is_ the true one and the shadow is
indistinguishable from the fact. **The same treatment is owed to the abort _reason_ and for a
different failure**, which is worth separating because the first one suggests the wrong remedy. A
shadowed `aborted` makes the link believe a lie; a `reason` accessor that **throws** makes the link
raise inside an event listener, where the exception is reported to the host and swallowed — so the
listener never reaches its abort, the invocation is left running, and the failure is silent rather
than wrong. One is an integrity problem and the other is an availability one, and a repair aimed
only at the first leaves an accumulator able to keep its invocation alive by making one getter
throw. **Where the enumeration stops** is a caller that patches `AbortSignal.prototype` itself
before this module loads: that is not a route through the seam, it breaks query-core's own reads
identically, and the difference is the whole of what "the far side cannot manufacture this" is
claiming. **What would disprove the ownership claim** is a third route to this controller, which is
why it is stated as an enumeration: adding one is a change to two lines and would not otherwise
announce itself. `A11-C13` is the contract for the first direction and `A11-C14` for the second,
because a discriminator is worth only what both of its directions are worth.

One supporting fact, stated because the boundary now rests on it: **a stream that completes normally
always yields at least the settle marker.** **What holds it up is the drain and not an ordering, and
the ordering is what this used to claim.** The sentence here was that every path to `finish()` runs
after the settle marker has been queued, and that is false: `settle()` queues its marker a microtask
late while `finish()` pushes `end` at once, so a single connection-state packet that both completes
the last relay's backlog and ends the forward leg reaches `end` with the marker not yet in the
queue. The machine says so itself, and the next sentence here always did. What makes the conclusion
true anyway is that the queue is drained to exhaustion before the end is acted on — **a marker
queued behind the end is still delivered, because the drain continues past `end` rather than
returning on it** — so the marker is yielded whichever side of the end it landed on. The exception
is an abort, which returns without a marker and is the case the controller reports; that path leaves
without reaching `finish()` at all rather than through it. So "no terminal outcome" after a normal
completion _implies_ the accumulator dropped or truncated what it was given, which is what makes the
failure attributable to the accumulator rather than to a race. It is checked and not only argued:
`A11-C13`'s witness asserts that the chunks it collected contain the settle marker, on the shape
that drives the stream to its end.

**The exit space, since a list of accumulators has been wrong in round after round.** The rows above
are witnesses, not a partition, and the partition is stated over what the engine decides rather than
over what accumulators do. An invocation of the query function leaves by throwing or by resolving,
because those are the ways an `async` function leaves, and the cells below split the resolving side
by what the returned value and the invocation's controller say. **The lead is not a count of the
list**: it read "exactly one of two ways" immediately above cells the text goes on to call "the four
cells above", which is the disagreement between a lead and its own list that A11's attack list
carried in this same round:

- **it throws** — the `catch` records a failure under this attempt whatever threw, so a terminal
  outcome exists (`A11-C6`, `A11-C7`, `A11-C8`);
- **it resolves and a terminal outcome for its attempt is on the value it returned** — a backlog end
  or a failure under that id. Nothing to do;
- **it resolves with no terminal outcome, and this invocation's controller is aborted** — an abort,
  because C11 puts a torn-down attempt on the rejecting side (`A11-C14`);
- **it resolves with no terminal outcome and that controller is not aborted** — an
  `AccumulatorContractError`, recorded as that attempt's failure (`A11-C9`, `A11-C10`, `A11-C13`,
  `A11-C15`).

Total, because "throws or resolves" is exhaustive of leaving, "a terminal outcome is recorded under
this id" is a reading of two fields, and given that the invocation's controller is aborted or it is
not. **What the argument rests on** is that all three are decidable at the return from what the
engine holds.

**The third cell used to be labelled "the invocation was torn down", and the label did not follow
from the predicate.** What the boundary reads is whether one controller is aborted; "torn down" is
an account of _why_ it is, and the two part company as soon as anything but a teardown can abort it.
Something could: the link's listener fired on a dispatched event while the signal it was listening
to was not aborted, so a stampless return the accumulator itself provoked was labelled a teardown
and sent to the abort side. **The cells are stated over the predicate now, and the account is what
the enumeration above has to earn** — with the link made honest the two coincide again, but they
coincide because of that argument and not because the words are synonyms. It is the same correction
the second question needed two rounds earlier: a stamp says a chunk arrived, and a cell must be
named for what it reads.

**Two things are not decidable there, and both are stated rather than assumed away.**

The first is an invocation that **never leaves**. It is not a fourth cell; it has not reached the
return at all, so the boundary has no question to answer about it. It is bounded from outside, by
the cancellation link at the entry — a consumer that goes away cancels the fetch, and the engine
abandons the attempt itself (`A11-C16`). A pending invocation whose consumer _stays_ is bounded by
nothing — whether it never reached `streamFn` or reached it and stopped taking what it yields — and
what speaks about it is `A11-P1` below, a postcondition of the two accumulators this library ships,
rather than any guarantee of the engine's.

The second is that **the value is the accumulator's to construct**, so the second question is a fact
about the value and never about the wire. The engine can see that an end for this attempt is
recorded; it cannot see that the request behind it is over. They come apart for a **live**
invocation that folds the backlog completion and returns with the forward leg still open: an end
_is_ recorded, truthfully, and the request is not finished. That invocation takes the "terminal
outcome present" arm and is right to by this test, and a runtime check here cannot correct it —
`refresh()` may already have resolved `complete` on the very end that makes the answer yes.

**So A11 is not correct by construction for an arbitrary type-conforming function, and the record no
longer says it is.** What is guaranteed by the engine is what the four cells above say, and it is
guaranteed **of an invocation that returned, threw, or was externally cancelled** and of no other:
such an invocation does not leave without either an outcome attributable to its attempt or an abort,
and nothing it started outlives it. An invocation that has done none of the three has not reached
the boundary at all, and no cell speaks about it — that is the paragraph above, recorded as a limit
rather than repaired. What is _not_ guaranteed by the type is that the value handed back describes
the request. Three postconditions carry the difference. **Two of them are postconditions of the
internal accumulator** — the two this library ships and tests — rather than obligations the seam's
type can enforce; **the third is one every accumulator owes**, including a port's own, and it is the
one with a boundary behind it. Part of the correctness moved onto them when the guarantee was
narrowed, so they are bridged into the catalogue with witnesses of their own
([0005](0005-contract-catalogue.md), `A11-P1`, `A11-P2` and `A11-P4`) rather than left as prose
here:

- **`A11-P1` — it drives the stream, and exactly three things end the driving.** For **every**
  request it is given, live or not, the query function these accumulators return calls its
  `streamFn` and then goes on taking the chunks that stream makes available and folding **each** of
  them into the value it will hand back, **until the iterator completes, until an external cancel
  arrives, or until an error propagates out of the invocation** — and until nothing else.
  **Returning is not on that list, because a return is not a reason to have stopped driving: it _is_
  the stop**, and this clause is what says the stop was unlicensed. **External cancel** means this
  invocation's own signal aborted through the link the engine makes at the query function's entry —
  a fact the engine holds rather than a decision the accumulator takes for itself. **"And not a
  signal it can manufacture on its own" stood here and was false.** The accumulator is handed
  query-core's signal, an `AbortSignal` is an `EventTarget`, and one dispatched `abort` event fired
  the link's listener while `aborted` stayed false — manufacturing exactly the cancel this clause
  says it cannot. What makes the sentence true is not the seam's shape but the link deciding on the
  signal's actual aborted state rather than on an event having arrived; see the return boundary
  above for the enumeration that argues the controller is the engine's, and for the
  shadowed-accessor falsifier that applies to the reading itself. It is worth keeping visible that
  the clause was only ever as true as that one read. Calling `streamFn` at all is part of this
  obligation rather than a preamble to it: an invocation that is driving the engine's stream is
  bounded by that request's own legs and timers, and one that never touched it — or that touched it
  and stopped taking what it yields — is bounded by nothing. **And it calls `streamFn` exactly
  once.** One invocation opens one stream and drives that one. "The stream" and "its iterator" are
  written in the singular throughout both clauses, and the singular is load-bearing rather than
  grammatical: an invocation that opens a second stream corrupts the answer the first one produced —
  measured, and nothing reports the corruption, because every report the request does emit is true
  of the leg it came from (below). `AC18` is the witness that both shipping accumulators call it
  once. **And one call is not one iterator — the step between them is this clause's to make and not
  the reader's.** `streamFn` returns an `AsyncIterable`, and taking an iterator from an
  `AsyncIterable` is a second act that a count of calls cannot see: an accumulator may call
  `streamFn` once, ask what came back for `[Symbol.asyncIterator]()` twice and drive both, and on a
  **re-iterable** iterable — which the seam's type permits and says nothing against — the second
  acquisition opens its own producer and its own subscriptions. That is the corruption of the
  paragraph above reached through the other door, with the call count still reading one. So the
  obligation is both: **one call to `streamFn`, and exactly one iterator taken from what that call
  returned.** `AC19` is the witness that both shipping accumulators take one, counted **on the
  object `streamFn` returned** rather than on whatever the accumulator chooses to iterate: an
  accumulator that wraps that object in one of its own and drives the wrapper twice takes two
  acquisitions from the real stream while its own loop shows nothing, so a count taken at the loop
  measures which object it picked instead of how many producers it opened. It is an arm of its own
  rather than an assertion inside `AC18`, because either half is satisfiable while the other is
  broken. **What would disprove that counting point** is a shape that forks the request without
  taking a second iterator from the returned object; the ones tried all take two — a wrapper
  iterated twice, two sequential `for await`s over the stream, two concurrent drains, and an
  `Array.fromAsync` alongside a loop. The count is read **after the invocation has settled**, for
  the same reason `AC18`'s is: an acquisition taken after the return is a producer the invocation
  never closed, and a count read at the fold's end does not see it. **What no single read can see is
  an acquisition taken strictly later than the read**, and this clause does not close that and
  cannot be made to: a count is a reading taken at a moment, and the interval after that moment is
  not something a reading bounds. It is closed by the two clauses stated after this pair — the
  producer's shape (`A11-C17`) and the revocation at the invocation's end (`A11-C10`) — and the
  three are set out together below as one property rather than left to compose in a reader's head.
  **What the singular does not forbid is a second consumer of the one iterator**: two loops pulling
  the same iterator alternately take each chunk once between them, because they are pulling one
  producer and nothing forked — whether that iterator tolerates overlapping `next()` calls is the
  producer's business and an async generator queues them. The clause counts acquisitions because an
  acquisition is what can open a producer. **What no count here can see** is an accumulator that
  opens a subscription by a route that never passes through its inputs — importing the request
  machinery and calling it directly. That shape is outside this seam rather than caught by it, and
  is recorded as a limit of where the counting is done. **The third of the three is an error that
  leaves, not an error that happens.** An error out of the iterator or out of the reducer ends the
  driving by _propagating_ out of the invocation, which is the exit the engine contains (`A11-C6`);
  an accumulator that absorbed one and went on, or absorbed one and returned a value, has reached
  none of the three and has broken this clause, because the failure the engine is required to record
  would be gone. **The cancel clause is observed in one direction only**: the witnesses see a drive
  that stopped with no cancel to excuse it and never a cancel exercising the leave the second of the
  three grants, which an invocation whose consumer went away already has elsewhere (`A11-C16`, and
  `P2` for what it closes).
- **`A11-P2` — the invocation's lifetime is its iterator's.** On the path where nothing throws and
  nothing cancels: the query function does not resolve while the iterator it is draining is still
  going, and once that iterator has completed it does resolve, rather than staying pending on a
  stream it has already drained. **"Completed" means the iterator exhausted itself** — a `next()`
  the accumulator asked for came back `done` — and not that the accumulator closed it, so an
  iterator finished off by a `break`, an explicit `return()` or a `throw()` from this side of the
  seam has been _stopped_ and has not completed. Without that sentence the first half launders the
  `A11-P1` violation it is supposed to be independent of: breaking out of the loop calls the
  generator's `return()`, so a fold that takes a prefix and leaves would otherwise be resolving with
  a completed iterator and satisfying this clause to the letter. **The other two ways out are other
  clauses' subjects, and stating this one over the quiet path is what stops it contradicting them**:
  an external cancel may bring the return forward, and the stampless value that then leaves is read
  as an abort rather than as a violation (`A11-C14`) or finds an invocation that never resolves at
  all (`A11-C16`); a throw leaves without resolving, and that is `A11-C6`.

- **`A11-P4` — a leg end is not a terminal failure.** A conforming accumulator does not re-publish
  the reason on a `legEnded` chunk as its invocation's own throw. A leg ending is a fact about one
  relay's subscription; what it leaves behind is a partial answer, and `status: 'incomplete'` is
  what says so. An accumulator that throws it instead makes the **same** request come back
  `incomplete` under the two this library ships and `error` under a third — which is the one thing
  A11 exists to prevent, because the public answer's semantics would then depend on which
  implementation a port installed.

  **The postcondition is not the defence, and this is the pair `A11-P1` and `A11-P2` do not have.**
  A postcondition binds a conforming implementation; it cannot make a non-conforming one safe, and
  this seam takes an arbitrary function. So the terminal doors carry the other half: a
  `relay-failed` value arriving at one can only have come back out of the seam — the relay door is
  the only place a value with that code is minted — and it is published as `accumulator-contract`,
  with the relay's own value on the `cause`. The remedy a consumer is handed is about the seam their
  port installed, rather than a relay that is down or "this library cannot say". `RM9` drives the
  violation, `RM10` drives a conforming accumulator over the same wire history, and
  [0005](0005-contract-catalogue.md) carries both as one row.

  **It is a new id rather than a sharpening of `A11-P3`.** `A11-P3` says something else — that the
  engine's containment guarantee and the parity measurement over two implementations are separate
  pieces of evidence — and for a round this postcondition was written under that id, which left one
  id meaning "not a postcondition at all" in one place and "a postcondition a port owes" in another.

**Singularity is three clauses with three subjects, and no one of them closes it.** What is being
claimed is that **a producer cannot be forked out of one invocation**, and not that an accumulator
was well behaved at the moment something counted. A postcondition on its own cannot say the first,
and this record spent several rounds trying to make it: `AC18` and `AC19` are read once, after the
invocation settles, and an acquisition taken later than that read satisfies the counting while
forking the request. The repair is not a later read, because no read is late enough. It is three
clauses that are silent in three different places:

1. **Inside the invocation — what the accumulator did with what it was handed** (`A11-P1` above).
   One call to `streamFn`, and one iterator taken from what that call returned, counted on the
   returned object rather than on whatever the accumulator chose to iterate. `AC18` and `AC19` are
   the witnesses, and both are read at settlement. **Its limit is that it is a reading and not a
   bound**: it is true of the moment it looked at, and says nothing about the moment after. **What
   would disprove it**: a shape that forks the request with neither a second call nor a second
   acquisition from the returned object — the ones tried all take one or the other.
2. **The shape of what crosses the seam — what `streamFn` hands over is a capability the engine
   owns** (`A11-C17`). Not the producer itself: the engine mints one facade per invocation, and the
   accumulator never holds the producer at all. Four properties hold **of that object**, rather than
   being counts taken of a caller that behaved. The **call is idempotent** — the first one opens the
   producer, every later one hands back the same facade without opening a second. The **underlying
   is acquired once**, by the engine, at that first call: never at a door the accumulator chooses,
   and never twice however many times the facade is asked for an iterator. The facade has **no
   injection point**: the module's only runtime export is the factory and no function in the engine
   accepts a capability as an argument, so an accumulator cannot get a forged one taken from it and
   a test that holds one holds the engine's. **This clause said "not constructible from outside"**,
   which the attack list below withdrew in the same breath as running it — the interface describing
   what the engine hands out is exported and is therefore implementable, so a hostile object of that
   shape can be written and what it cannot be is used. Leaving the strong form standing here while
   the narrow one stood there is the sweep going unfinished rather than a second defect. And a
   **withdrawn** capability **does not delegate**: a pull returns `done` without reaching the
   underlying. **That fourth property is stated over the object's state and not over a time** — it
   says what a withdrawn facade does, while what withdraws one, and when, belongs to (3). This
   clause therefore still carries no clock; the draft that read "once (3) has fired" did carry one,
   which is what the paragraph below had to be corrected for. So an acquisition is not an act that
   can open anything — not because the object handed back is always the same one, but because
   nothing behind it is reached. **This clause was identity for one round, and identity was not
   enough.** What stood here was that asking the returned object for an iterator hands back the same
   iterator every time, so an acquisition could not open anything. The observation was true and the
   inference was not. It held only because `twoStageStream` is an `async function*` and a generator
   is its own iterator, which is a fact about our code rather than about the seam's type: the
   general `AsyncIterableIterator` that type accepts may write
   `[Symbol.asyncIterator]() { open(); return this; }`, returning an identical object out of every
   acquisition and opening a subscription on each one. **Identity is not absence of effect**, and a
   witness that compares two acquisitions by identity passes against that shape while the request
   forks behind it. So the observation moved with the clause: what is watched is the **wire** — one
   set of subscriptions per leg — and not the identity of anything. **Its limit is the pull that is
   neither a call nor an acquisition**: a producer whose `next()` starts a fresh internal producer
   each time is called once and acquired once and forks the request anyway, which is residue below
   rather than something these four properties close. **What would disprove it** is any of the four
   failing against a producer or an accumulator written to break it, which is what the shapes below
   were run for.
3. **After the invocation — the capability is revoked** (`A11-C10`, extended from what an invocation
   closes to what it can still open; witnesses `AC7` and `AC21`). Two acts in the `finally` that
   ends every path out of the query function, in this order: the engine **withdraws the capability**
   of (2), and then **aborts the invocation's own `AbortController`**. Nothing between them can
   yield, so no accumulator runs in a state where one has happened and the other has not, and the
   order says that the capability dies first — no arrangement of the teardown can hand a chunk
   across the seam on its way out. The withdrawal shuts the seam: a later **call** to the `streamFn`
   the accumulator kept hands back a facade that opens nothing, a later **acquisition** reaches that
   facade and not the producer, and a later **pull** returns `done` **without reaching the
   underlying at all**. The abort closes the wire beneath it — that is what ends a producer the
   accumulator opened and never drove — and the machine states the case twice: its first line
   returns on a signal that is already aborted, before a subscription exists, and its abort handler
   fires at once rather than waiting for an event that an already-aborted signal will never send.
   What the stream's `finally` then abandons is keyed by the attempt id this invocation was handed —
   released as that attempt's flight settled, or never registered at all when no `refresh()` claimed
   the lane — so a late pull cannot reach past its own dead attempt into a live one. **The
   withdrawal is strong, and the strength is the decision.** The weaker form — "nothing new opens" —
   was what the abort alone bought, and it left "nothing it started outlives it" true except for a
   drain: the machine drains what it has already queued before it checks that it has ended,
   deliberately, because a marker queued behind an end is the state a `refresh()` waits on for ever,
   so a late pull could be answered out of chunks queued before the abort arrived. **The machine is
   unchanged and the queue is left exactly as it was; what changed is that the answer no longer
   crosses the seam.** A pull that was already in flight when the withdrawal landed is checked again
   on the way back and its chunk is dropped — data loss by construction, bounded to the interval
   after the invocation has already ended, where nothing is entitled to fold it. **Its limit is its
   antecedent**: it says nothing until an invocation has ended, and one that never ends never
   reaches it — which is (2)'s door now, not an open one.

**Why the three do not collapse into one, and where two of them now overlap.** (1) counts what the
accumulator did, and a count cannot bound what happens after it. (2) is structural and carries no
clock: three of its properties hold of the facade throughout, and the fourth holds of it once
withdrawn — a state rather than an instant, and one (3) is the only thing that produces. **The
stronger word this sentence used to carry was "timeless", and the round that gave (2) its fourth
property made it false**: a clause that says what a withdrawn object does is not one that "neither
knows nor cares whether the invocation ended", and the repair is to say which of the two it is
rather than to keep the word. (3) has an antecedent and speaks only once an invocation has ended.
**What changed is that (2) now closes the call door as well as the acquisition door**, which is
where it used to be silent and (1) used to be the only thing speaking. So the three no longer
partition: on a second _call_ inside a running invocation, (1) and (2) now say the same thing, and
(2) says it structurally while (1) says it of the moment it looked at. **That is not a reason to
retire the count.** (1) is a postcondition of the two accumulators this library ships and remains
the only clause that is about their behaviour rather than about what they are handed — an
accumulator that calls twice is misbehaving whether or not the capability makes it harmless — and it
is what would report the capability having dropped out of the path, since a count taken on the
object `streamFn` returned reads one only while something is making it read one. **Read together
they state the property as structure rather than at a point**: while the invocation runs, neither a
second call nor a second acquisition forks anything (2), and what the accumulator actually did is on
the record either way (1); once it has ended, nothing it still holds opens or yields anything (3).

**The door that was left open is closed, and the refusal that left it open is overturned rather than
quietly dropped.** What stood here was an invocation that **never ends** and calls its `streamFn` a
second time — (2) did not apply because two calls were not two acquisitions, (1)'s counts were read
at a settlement that never arrives, and (3)'s antecedent never arrived either. **What would close
it** was named here as a one-shot `streamFn`, and refused: the seam is a non-public internal
substitution point (0004 C9), so a clause over the two functions this library ships was held to be
the instrument and a mechanism aimed at a function no consumer can supply was held not to be. **That
argument was sound about cost and wrong about scope.** The same closure that makes a second call
idempotent is what makes an acquisition reach nothing, and an acquisition reaching nothing is the
only form in which the shape clause survives contact with the seam's actual type — identity does not
survive it. One mechanism therefore answers three things that were being carried by three different
instruments: the second call from an invocation that never ends, the acquisition with a side effect
that identity could not see, and the interval after the return that a count read at settlement
cannot reach. **A mechanism that closes one hole against a function no consumer can supply is a poor
trade; the same mechanism closing three, one of which is a false inference rather than a missing
check, is not the same trade**, and the cost is unchanged from the estimate that was already
recorded here — a closure holding the producer it already made.

**The weaker option was available and is recorded as refused.** It was to keep what the abort alone
buys and narrow the prose to match: "nothing new opens", with "nothing it started outlives it" and
"the whole capability is revoked" taken out of this record and out of the code. That would have been
honest, and it was refused because the narrowing does not stay local. "Nothing it started outlives
it" is the sentence the return boundary's contract failure message is written against and the
sentence `A11-C10` is a row about; weakening it leaves a late pull able to deliver a chunk into a
fold that no longer has an attempt to attribute it to, which is a state this record would then have
to describe rather than forbid. The strong form costs one re-read of a boolean on the way back from
each pull and one dropped chunk in an interval where nothing is entitled to fold one. **What would
show the choice wrong** is a consumer with a legitimate reason to receive a chunk after the
invocation that asked for it has ended; none is reachable through the published surface, because the
value that fold would produce is not written to the cache by anything.

**What the three do not close, recorded as residue rather than as coverage.**

- **The route that never passes through the seam's inputs.** An accumulator that imports the request
  machinery, or the relay client under it, and opens a subscription directly is outside all three:
  nothing counted a call it never made through `streamFn`, no acquisition of ours is involved, and
  the capability the engine can revoke is the one the engine handed over. All three clauses are
  stated over what crossed the seam, which is the limit `A11-P1` already records for where the
  counting is done, now applying to the structure as well.
- **A producer that opens something on the _pull_ rather than on the call or the acquisition.** An
  `AsyncIterableIterator` whose `next()` starts a fresh internal producer each time is called once,
  acquired once, and forks the request anyway: none of the three doors these clauses hold shut is
  the one it goes through. **Measured, not reasoned**: driven through the capability, such a source
  opened four producers behind one call and one acquisition, and every property in (2) held
  throughout. It is left as residue rather than closed because closing it means counting or
  rationing pulls, and a pull is the one thing the seam exists to permit — the capability cannot
  tell a pull that advances one producer from a pull that starts another without knowing what the
  producer is, which is the knowledge the seam is there to give up. **What reports it is the wire
  and nothing else**: one set of subscriptions per leg is the observation, which is why the
  witnesses for (2) and (3) watch frames rather than identities, and a port whose producer has this
  shape will see it there.
- **The facade's `return()` and `throw()` doors are contracted and unwitnessed.** Both check the
  withdrawal before delegating, so neither reaches the underlying once the invocation has ended —
  measured, and one of the two has a consequence worth naming: a `throw()` taken after the
  withdrawal **resolves `done` instead of raising**, which is the opposite of what the same call
  does while the capability is live and the opposite of what the in-flight rejection below does. The
  asymmetry is deliberate — a `throw()` after the end is the accumulator asking a dead capability to
  unwind, and there is nothing left to unwind — but **no test drives either door past the
  invocation's end**, so it is recorded as an edge rather than as coverage. Both doors are asserted
  in the other direction, which is a different claim and does not stand in for this one: `AC29` and
  `AC30` issue `return()` and `throw()` while the capability is live and revoke before the answer
  arrives, so what they measure is an answer crossing back after the end rather than a call crossing
  out after it. **What it would take to witness this one** is a producer instrumented to count
  `return`/`throw` arrivals, driven past the invocation's end, with both counts required to stay at
  zero — `AC27` is exactly that for `next`, and the two doors have no equivalent; without it they
  could start delegating again and only a reader would notice.
- **A revocation that lands while `open()` is running discards what the acquisition produced.** The
  caller waiting on `open()` gets whatever the withdrawal raises and never the iterator, and if the
  acquisition failed it never sees that failure either. It is unreachable in this engine — nothing
  revokes from inside `open()` — so it is written down rather than closed, and a port that gains
  such a path inherits a case where a real failure is replaced by a revocation notice.
- **An in-flight pull that _throws_ still raises at the caller after revocation.** The strong
  boundary turns a late chunk into `done`; it does not turn a late rejection into one. Swallowing it
  would be the engine deciding that an error which happened is an error that did not, which is a
  worse failure than delivering one to a caller that has finished — and the rejection carries no
  chunk and opens nothing, so it is the one thing crossing a revoked seam that costs nothing to let
  cross. **Measured**: a producer that rejects a pull already in flight when the withdrawal lands
  rejects at the accumulator, revoked or not. It is recorded here rather than left in the code
  because a boundary that is strong for values and permeable for errors is exactly the asymmetry a
  reader would otherwise have to discover.

**The clause was attacked before it was written down, and the attacks were run rather than argued.**
Type-conforming shapes were driven through the capability — hostile producers on one side of it,
hostile accumulators on the other — because the previous version of this clause was falsified by a
shape nobody had run. **The list is not counted in its lead**, for the reason no table in these
records is counted in its heading: this lead said ten shapes with nine stopped, over a list carrying
neither figure, and the round that wrote the miscount is the round that was correcting miscounts
elsewhere. It is also not a figure the list fixes — one bullet below covers `return()` and `throw()`
together, so whether that is one shape or two is a reading rather than a count. Each bullet stands
on its own, and the one that escapes says so:

- an acquisition that returns the identical object and opens a subscription each time, driven
  through two calls and two `for await`s — one call reached the producer, one acquisition of it was
  taken, one subscription existed. This is the shape that falsified the identity clause, and it is
  the reason the clause moved.
- an accumulator that wraps the facade in an iterable of its own and iterates it twice — one
  producer, and the chunks split between the two loops rather than doubled, which is the shape A11
  already permits.
- a second call from an invocation that has not ended — the same object back, no second producer.
  That was the open door.
- a late pull with a chunk still queued behind the end — `done`, with the underlying not reached and
  its queue left untouched.
- a pull already in flight when the withdrawal lands — its chunk dropped.
- `[Symbol.asyncIterator]` detached from the facade and called bare — the facade back, because it
  hands over the named binding rather than `this`.
- forging a facade from outside — the module's only runtime export is the factory. **The precise
  claim is narrower than "nothing can be built", and the narrower one is what holds**: the interface
  describing what the engine hands out _is_ exported and is therefore implementable, so a hostile
  object of that shape can certainly be written. What it cannot be is used, because no function in
  the engine accepts a capability as an argument — the one that exists is minted at the point it is
  needed and never taken from a caller. The property is "there is no injection point", not "there is
  no way to write one", and a parameter added anywhere that took one would end it.
- `return()` and `throw()` taken after the withdrawal — neither reaches the underlying.
- **the one that escapes**: `next()` opening a fresh producer per pull, four producers behind one
  call and one acquisition. It is the residue above.

**Two mechanisms now defend one property, and that has a price the ledger has to be told about.**
The property is the second half of `A11-C10` — nothing the accumulator still holds can open anything
once the invocation has ended — and it is now held by the withdrawal in (2) _and_ by the abort in
(3). Where they used to be one mechanism in two lines, each individually load bearing, they are two
mechanisms whose coverage overlaps on the wire: **remove the abort and the withdrawal still stops
the pull from reaching the machine, so no REQ and no `CLOSE` appear; remove the withdrawal and the
abort still stops a producer from starting, so no REQ appears either.** An arm that watches the
frames a relay heard is expected to stay green under either edit taken alone, where it used to die
under both and die differently. **This is a prediction and is written as one** — it follows from
reading the two lines, and what would settle it is the ledger, whose `also` form exists for exactly
a property two mechanisms defend and whose rule is that the pair carries an entry and each half
carries one of its own. **What the two do not both cover is where the separate falsifiers now
live**, and naming them is the useful half of this: only the withdrawal stops a **queued chunk**
from crossing the seam, so an arm that pulls after the end with something still in the queue dies on
removing it alone; only the abort **closes** what a producer opened, since the withdrawal
deliberately sends no `return()`, so the arm that reads a `CLOSE` for an abandoned producer dies on
removing that alone. A witness set that carries only the wire arm measures neither line.

**What a violation would do on this tree was written here as a prediction, and the aimed mutations
have since answered it.** The prediction, from the producer not forking, was that an accumulator
taking two iterators answers a relay-driven request exactly as one taking a single iterator does.
Aimed entries were then written for both adapters, and every parity file stayed green under them —
the prediction held. **The order is kept rather than tidied away**: it was a prediction when this
paragraph was written and it is a measurement now, and a record that silently rewrites the first
into the second loses the only evidence that the clause was not fitted to its result. **Nor does
green mean the clause is idle.** A mutation that moves no observable answer is the signature of a
clause protecting the **port** rather than a defect reachable here, which is what this section says
the clause is for; the entries stay in the ledger with the parity files in scope for a reason that
is not bookkeeping. **What the prediction rested on has since been replaced, and the prediction
survives the replacement for a better reason than it was made for.** It rested on `twoStageStream`
being an `async function*`, so that two acquisitions were two references to one generator; that fact
is still true of `twoStageStream` and is no longer what holds the property up, because what crosses
the seam is not `twoStageStream` any more. A port that replaces it with a source that mints a
producer per acquisition used to be the day these entries started dying; it now changes nothing,
because the capability in (2) acquires the underlying once whatever the underlying is. **That is a
real narrowing of what these entries measure and it is recorded as one**: they were a standing check
on the producer's shape, and the shape they were checking no longer reaches the accumulator. **What
a reader will find in the ledger is the arithmetic of that**: the entry that turns this library's
producer into one that mints per acquisition is expected to kill nothing at all now, where it used
to kill the row written for exactly it. An empty kill set there is the capability working rather
than a gap in the suite — the edit is absorbed one call deeper than any witness looks — and the
honest way to carry it is as a measurement with that reason attached rather than as an entry still
declaring a contract it no longer breaks. **What would show this reading wrong** is that same edit
killing something: it would mean an acquisition was reaching the producer after all, which is the
one thing (2) says cannot happen. What they still measure is the **composition** — an accumulator
that would fork meeting a seam that cannot be forked — and what would report the capability dropping
out of the path is the count in (1) together with the wire arms of (2) and (3), none of which
depends on the producer behind the facade being a generator.

**The producer side was refused for a reason that does not hold, and the refusal is corrected here
rather than quietly dropped.** What stood here was that a producer-side guarantee cannot port: the
producer is **this library's own**, a port replaces `twoStageStream` with whatever its own client
yields, so a sentence about that function arrives at the port as a sentence about a stream it does
not have — while an accumulator-side obligation travels with the functions it is about. **The
mistake is in the subject.** What a contract ports is a property, not an implementation, and every
port has something for this property to be about: the seam is an `AsyncIterable` of chunks on one
side and a fold on the other, so whatever a port puts on the producing side **is** that request's
chunk producer, whatever it is called and however it is built. "Whatever produces the chunks is
reached once, by the engine, and what the fold is handed is a capability the engine can withdraw" is
a sentence about that thing, and a port builds it in the same few lines this one does. The
accumulator-side clauses port with the accumulators, the producer-side clause ports with the
producer, and neither of them ports as a name. **The clause ports better than its predecessor did**:
an identity check ports as an assertion a port may satisfy by accident and may satisfy while
forking, whereas a capability ports as a thing the port has to build, and a port that has not built
it has nothing to run the row against.

**The choice was false as well as wrongly argued.** The paragraph read as an either/or — put the
guarantee here or there and pay the cost of the side chosen — and the two sides do not catch the
same thing. A count **records** what an accumulator did and can only do so afterwards and once; the
producer side **disarms** it, and does so at the moment of the act rather than at a settlement.
Putting the whole property on either side leaves the other's door open, which is why the section
above states three clauses rather than a winner between two — and the producer side of it grew from
disarming an acquisition to disarming a call, an acquisition and a late pull once it stopped being a
remark about a generator and became an object the engine builds.

**What survives from that paragraph is the asymmetry, which was never an argument against the
producer-side clause.** The seam's type already fixes the producer as an `AsyncIterable` and can say
nothing whatever about an accumulator's behaviour, so the accumulator side is where a type check
runs out first and why `A11-P1` and `A11-P2` are postconditions rather than type constraints. That
argues for the accumulator-side clauses existing; it never argued that the producer-side one should
not. **What would disprove the correction** is a seam whose producing side is not a producer — then
the property would have nothing to attach to on the far side and would indeed be this library's
private fact. That shape is unreachable while A11's seam is "an `AsyncIterable` of chunks into a
value": take the `AsyncIterable` away and it is a different seam with a different A11 above it.

**One weakness of the accumulator-side clauses is not repaired by any of this, and it is worth
keeping visible.** An obligation stated over "both shipping accumulators" is unenforceable against a
function that arrives from outside — a consumer-supplied accumulator, or a third shipped one
(`A11-P3`) — while `A11-C17` holds against all of them at once, because its subject is ours. That is
an argument for the producer-side clause carrying more of the weight the day this seam is opened,
not for retiring the counts: the call door is still the accumulator's, and nothing about it improves
by being outside.

**`A11-P1`'s bound is three events and not the invocation's own lifetime, and one shape is the whole
reason.** A draft of this clause made the duty run "for as long as that invocation is pending",
which reads well and is **vacuously satisfied** by a query function that returns at once and hands
the folding to a task it does not await: its pending window is empty, so there is no chunk it failed
to take _inside_ that window, and the only clause left with anything to say was `A11-P2`. The
objection is the same one the ledger's attribution gets wrong one level down — **the return itself
closes the stream, through the engine's `finally`, so stopping the supply by one's own act is not an
excuse for having stopped it.** Stated over three events the reading is gone: the iterator had not
completed, nothing cancelled and nothing threw, so the driving was owed and did not happen, and the
shape breaks `A11-P1` and `A11-P2` both. **The overlap is not a defect to be designed away.** A
shape that breaks two clauses is recorded as breaking two; a clause set whose members never overlap
is one drawn to keep them apart rather than to carve the failures, and the assertion that happens to
fail first is a fact about the witness rather than about the edit. **What would disprove the
tightening** is an accumulator that stops driving for a fourth reason and is right to — none is
known, and if one is found it is the list that has to grow, not the duration that has to come back.

**Neither clause says when the stream is entitled to end, and that is the division of labour rather
than an omission.** When the iterator ought to complete is `A5`'s question and is answered there,
per leg and per relay: for a request that is not live, the backlog's outcome; for a live one, the
backlog's outcome **and** the forward leg's end, in whichever order the two arrive. A11 is stated
over the seam, whose subject is an `AsyncIterable` and a fold; A5 is stated over the request, whose
subject is legs and relays. They multiply:

```text
A5          — when the stream is semantically over
  ×
A11-P1/P2   — that the iterator is driven, and that the query function's
              lifetime is that iterator's
  =
the normal end of a request
```

A defect in either factor is a request that does not end properly, and neither factor has to restate
the other in order to say so. **What would disprove the factorisation** is a defect that belongs to
neither: a stream that ends when A5 says it should, driven and awaited exactly as A11 requires, over
a request whose answer is still wrong. **One has been found, and widening a factor is what absorbed
it** — two streams, each ending exactly where A5 says it should and each driven and awaited exactly
as `A11-P1` and `A11-P2` require, over a request that answers its own `refresh()` and its own
consumer differently. It belonged to neither factor until `A11-P1` was widened to say _one_ stream,
which is what the factorisation costs when it is wrong, and is the reason to keep stating it as a
claim that can fail rather than as a definition that cannot.

**This pair said something else for one round, and what it said made two of this library's own
passing tests into violations.** Both clauses were then stated over a **horizon** of the
accumulator's own — the attempt's terminal outcome for a request that is not live, _the forward
leg's end_ for a live one — with an external cancel named as the only thing that could stop the
drive short or bring the return forward. Both halves of that are corrected above, and each is
corrected against a path this library's shipping code takes rather than against an argument.

- **The live horizon was named as the forward leg's end, and A5 had already decided otherwise in
  this same document.** A request ends when its **last** leg does and the forward one is not always
  last: a relay may refuse the _live_ subscription and still answer the backlog it never refused.
  `P32` (`parity-wire.test.ts`) is that shape run on both shipping accumulators — the forward leg is
  `CLOSED` at once, the backlog then runs its settle timeout out, and the invocation goes on taking
  chunks across the whole of that interval before returning with `incomplete: ['timeout']` and an
  `activity` of `idle`. Read literally, the previous `A11-P2` made that conforming run a violation —
  it did not return when the forward leg ended — and the previous `A11-P1` left the folding it did
  afterwards outside the clause's scope. **A postcondition that a passing witness breaks is a defect
  in the postcondition**, and this one needed no new counterexample to find: it is two sections of
  one record read against each other.
- **The exemption was "an external cancel and nothing else", and the exception route this record
  designs is not a cancel.** `P48` (`parity-refresh.test.ts`) poisons the fold, so both shipping
  accumulators leave by throwing, with every leg still open and nothing cancelled. That is
  `A11-C6`'s intended path — the seam reaches `streamFn`, the reducer throws, and the engine records
  the error as that attempt's outcome. Under the previous wording it was a stop short of the horizon
  with no cancel to excuse it, which is exactly what `A11-P1` used to forbid. The repair is not a
  wider exemption but a narrower subject: `A11-P1` governs what a **running** invocation must keep
  doing, and a throw is the invocation ending rather than a running one going quiet.

**One mistake produced both, and it is worth naming because it is available again.** The clauses
were written in the request's vocabulary — live or not, which leg, which end — while their subject
is a function whose entire input is `initialValue`, `reducer` and `streamFn` (`accumulate.ts`).
**The overstated version of that complaint is refused here**: it is not that an accumulator _cannot_
see those things. `live` is recoverable from the canonical string inside the query key, and the
chunk union carries both the settle marker and `{ type: 'legEnded', leg: 'forward' }`, so an
accumulator determined to compute a horizon could compute one. The objection is that it would then
be the **second** derivation of a fact A5's tables already own, sitting on the far side of a seam
whose whole purpose is that either implementation may be dropped in — and two derivations of one
fact are free to disagree, which is the shape this record removes everywhere else it appears. **What
would disprove the objection** is the two derivations being the same expression: they are not,
because A5's runs per relay over a target set fixed when the request started, and all the chunk
stream shows is the aggregate end.

**They separate in one direction, and the other was attempted and could not be built — which is
worth more than the symmetry this paragraph claimed for a round.** An invocation can satisfy
`A11-P1` to its last chunk and still never return: that is the second half of `A11-P2`, and `P32`
and `P45` are what catch it. The converse — returning early while the driving goes on, handed to a
task the invocation does not await — does not exist on this engine, and the attempt to build it is a
ledger row rather than an argument. Instrumented, the detached loop began after the return, folded
**nothing**, and ended by itself with no cancel involved: the invocation's own lifetime ends every
subscription the request opened, at the return (`A11-C10`, and `AC7` for what the wire shows), so
there was nothing left to take.

**That shape was readable as _satisfying_ `A11-P1` rather than breaking it, and closing the reading
is what the three-event bound is for.** While the duty ran only for as long as the invocation was
pending, this one's pending window was empty, no chunk went untaken inside it, and the clause was
vacuously satisfied — leaving `A11-P2` to carry the attribution alone for a shape whose defining
move is that it stopped driving. It does not read that way now: the iterator had not completed,
nothing cancelled, nothing threw, so the stop was unlicensed and the shape breaks **both** clauses.
**An early return is therefore a stopped drive here as well, and the two stay two clauses because
that coupling is the engine's and not the seam's.** What would disprove the reading is the coupling
going away, and it is worth saying what that does to the attribution rather than only to the
separation: on a port whose return does **not** close its legs, the detached loop really does go on
folding, `A11-P1` is satisfied in substance instead of vacuously, and `A11-P2` alone is broken. So
such a port owes both clauses a check rather than inheriting one from the other, and it owes this
row a re-derivation rather than the verdict recorded here.

**What the engine sees of an early return is not one single thing, and this document said it was for
a round.** The sentence here read "what the engine sees in every early return is the same thing: no
terminal outcome on the value it was handed", and it is false of the case this file separates for
itself above — the live invocation that folds the backlog completion and returns with the forward
leg still open. A return _before_ the attempt's terminal outcome leaves no ending on the value,
which is the boundary's `AccumulatorContractError`; a live return _at_ the backlog end leaves a true
ending, because the completion was folded before the loop stopped. The first is visible on the
value; the second is not visible there at all. That difference is why the two clauses are witnessed
on two axes rather than by reading one failure message.

**What would disprove the pair**, measured on both shipping accumulators rather than argued from the
shapes: an event published on a live request's forward leg after its backlog end that does not reach
the consumer (`P25`); a request that is not live whose state does not reach `settled` after its EOSE
(`P1`); and a request whose stream has ended whose `activity` does not fall back to `idle` (`P32`,
`P45`). **Three disproofs, four witnesses** — the last one is measured on two accumulators and so
names two ids. `A11-P1` is bridged to the first two disproofs, which is `P25` and `P1`; `A11-P2` is
bridged to all three, which is those two plus `P32` and `P45`. The sentence that stood here said
"the first two … and all four" over a three-item list, switching from disproofs to ids without
saying so; the arithmetic was right and the unit was not, which in a record whose counts are meant
to be checkable is the same defect as being wrong.

**The second half of `A11-P2` is asserted, and what asserts it is not the value.** It was held back
for a round while its falsifier was run, on the rule that a clause whose mutation has not been
measured is a claim of evidence that has not arrived. The measurement: an accumulator that folds
every chunk, lets the stream end where it should and then hangs instead of returning leaves an
answer that is complete and correct in every field. Nothing on the data axis moves — every
`refresh()` over such an invocation still resolves, because the folding finished before the hang, so
no observation of the answer sees it at all. What moves is `activity`, which is
`deriveActivity(live, isFetching)` over query-core's `isFetching`, so a fetch that never finishes is
a request that is done and still reports work: `P32` reads `expected 'live' to be 'idle'` and `P45`
reads `expected 'refreshing' to be 'idle'`, on both accumulators. **A more direct observation exists
and is not evidence for this clause.** A witness that waits on a non-live `refresh()` resolving dies
under the same defect — that is the call itself never coming back — but only on the default adapter,
because those tests mount the hook without an accumulator and the fallback is never the function
they run. So what is measured across _both_ implementations is the activity axis and nothing else,
which is a bound on the clause rather than a gap in it; 0005 names the witnesses and why they are
not the row's.

**Whether an invocation returned is therefore unreadable from the value and readable from the
handle**, and that is what makes both halves of `A11-P2` observable: the first half by what the
value does or does not carry, the second by the axis the query library already publishes through us.
**What would disprove this reading** is a change of source for that axis — derive `activity` from
the value's own legs instead of from `isFetching`, and both observations go quiet while the defect
stands.

**Two pending invocations, each violating a different half of `A11-P1`, and neither of them a state
the engine prevents.** The first never opens the stream:

```ts
const accumulator = () => async () => new Promise<never>(() => undefined);

const pending = handle.refresh(); // the consumer stays; neither ends
```

The second opens it, takes one chunk and stops:

```ts
const accumulator =
  ({ streamFn }) =>
  async (context) => {
    const iterator = streamFn(context)[Symbol.asyncIterator]();
    await iterator.next(); // one chunk, and nothing after it
    return await new Promise<never>(() => undefined);
  };
```

Both violate `A11-P1` — the first by never reaching `streamFn`, the second by stopping with none of
the three endings reached: its iterator is suspended at a `yield`, nothing cancelled it and nothing
threw — and neither violates `A11-P2` as stated above. Not its first half, because neither returns
at all; and not its second either, because that half is conditioned on an iterator that has
completed, and the second exhibit's iterator is one nothing will ever ask past that `yield`. **The
rewrite was re-checked against both of them rather than assumed to inherit their coverage**, since
they are the two shapes that walked through earlier wordings: the second exhibit is the one that
satisfied "reaches its `streamFn`" word for word, so the clause it has to die on is the continuing
one, and "until the iterator completes, until an external cancel arrives, or until an error
propagates out of the invocation — and until nothing else" is the whole of what kills it. The other
direction was re-checked too: an accumulator that folds everything, lets the stream end where A5
says it should and then hangs still breaks `A11-P2`'s second half, which is now stated over an
iterator that exhausted itself rather than over a horizon, and the stream in that shape did exhaust
itself. **That is why `A11-P1` is stated over every request and not over live ones**: the first
exhibit is a non-live request's violation as much as a live one's, and while `A11-P1` spoke only
about a live query function there was no clause the non-live case broke. **And it is why the drive
is stated as continuing rather than as reaching**: the second exhibit reaches `streamFn`, returns
neither early nor at all, and satisfies the previous wording of both clauses word for word, while
the settle marker and the settle timeout are generated behind the chunk it stopped at and are folded
into nothing. A `refresh()` whose consumer stays is then pending for good.

No cell above is reached by either, because there is no return, no throw and no external cancel: the
consumer is still there, so nothing removes the observer and nothing cancels the fetch. They are
outside `A11-C16` for exactly that reason — that row destroys the consumer, and the cancellation
link at the entry is what bounds it. Making these cases impossible would need an engine-side
deadline or the engine owning the iteration, which is a **different design** and is recorded below
with its cost; the seam is a non-public internal substitution point (0004 C9, and C8 on what the one
entry may name), so what is owed here is a postcondition on the two accumulators this library ships
and a witness that they satisfy it, rather than a mechanism against a function no consumer can
supply.

**Type-legal accumulators, each read against both clauses rather than against the suite.** A
rewritten clause inherits nothing from the counterexamples the old one caught, so the verdicts below
are derived from the sentences above one shape at a time. For a seam, the hostile implementation is
not an attacker but a badly written substitute. **The table is not counted in its heading**, because
a heading that counts its own rows is a second derivation of the table and free to disagree with it
— and this one has gained rows in consecutive rounds, which is exactly when a written count goes
stale without anything noticing.

| The accumulator                                                                                                                                          | `A11-P1`                                                                                                                                           | `A11-P2`                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| drains the stream to exhaustion, folds nothing, returns `initialValue`                                                                                   | **broken** — "folding **each** of them"                                                                                                            | **satisfied**, exactly: it resolves when the iterator completed and not before                                                                                                                                                                                                                                                                                                                                                                                   |
| folds one chunk, stops pulling, awaits a promise nothing settles                                                                                         | **broken** — the iterator has not completed, nothing cancelled, nothing threw                                                                      | **satisfied** — its iterator never completes, so the second half has no antecedent (the second exhibit above)                                                                                                                                                                                                                                                                                                                                                    |
| folds a prefix, `break`s, returns what it has                                                                                                            | **broken** — the `break` is a stop none of the three licensed                                                                                      | **broken** — a `break` closes the iterator instead of exhausting it                                                                                                                                                                                                                                                                                                                                                                                              |
| returns at once, folding handed to a task it does not await                                                                                              | **broken** — the return _is_ the stop, and a return is not on the list                                                                             | **broken** — it resolved with its iterator still going                                                                                                                                                                                                                                                                                                                                                                                                           |
| drains to exhaustion, then never returns                                                                                                                 | **satisfied** — the iterator completed, which is the first of the three                                                                            | **broken** — the second half, on the activity axis (`P32`, `P45`)                                                                                                                                                                                                                                                                                                                                                                                                |
| swallows the reducer's error and returns what it had folded so far                                                                                       | **broken** — an error ends the driving by propagating, and this one did not                                                                        | silent: it is stated over the path where nothing throws. If the error landed after the backlog end the value carries a true ending, so the boundary sees a well-formed return and the failure is simply gone                                                                                                                                                                                                                                                     |
| forges an already-aborted `AbortController`, hands it to `streamFn`, returns at once                                                                     | **broken** twice — the cancel is not the engine's link at the entry, and the return is a fourth reason to stop                                     | silent: it drains no iterator. The boundary catches it independently (`A11-C9`), the value carrying no terminal outcome with nothing having torn the invocation down                                                                                                                                                                                                                                                                                             |
| calls `streamFn` **twice** and drives both                                                                                                               | **broken** — one invocation opens one stream, and the second stream's `fresh` marker re-arms an attempt the first leg had already ended            | **satisfied** — both iterators exhaust themselves and it resolves after they do. That is exactly why the singularity had to be said rather than read out of the sentences already there                                                                                                                                                                                                                                                                          |
| calls `streamFn` **once** and takes **two iterators** from what came back — the first pulled once and abandoned, the second drained (`AC19`'s falsifier) | **broken** — one call is not one iterator; on a re-iterable stream the second acquisition is a second producer, and the call count still reads one | **satisfied, on the iterator it drained** — it resolved on a `done` that a `next()` it asked for came back with, and not before. The one it abandoned after a single pull never returns `done` at all: it is left neither exhausted nor closed, which is `A11-P1`'s subject and not this clause's. This clause says _its_ iterator in the singular because `A11-P1` supplies the singular; where `A11-P1` is broken the phrase resolves to the one being drained |

**Two rows break both clauses, and they are recorded as breaking both.** Which assertion dies first
is a fact about the witness; which clauses an edit breaks is a fact about the edit, and a record
that lets the first stand in for the second is measuring its own instrument. The two rows are also
the two that the previous wording attributed to one clause each — the `break` because the first half
of `A11-P2` had no exhaustion sentence, the detached fold because `A11-P1` was bounded by a duration
it could make empty.

**The twice-called row was carried as residue for one round and is a clause now, because it was
measured.** It would satisfy every other sentence in both postconditions — it calls `streamFn`, it
takes and folds each chunk the streams make available, and it resolves only after both iterators
have exhausted themselves — which is why the singularity is stated outright above rather than left
to the singular nouns. It splits in two, and only one half is harmless.

Calling it twice and driving **one** is inert, for the reason the detached-drive instrument found:
`twoStageStream` is an `async function*`, so the generator nobody asks for a chunk never enters its
body, never sends a REQ and never runs its `finally`. A second call is not a second request until
somebody pulls on it.

Driving **both** produces a request whose answer contradicts the answer its own `refresh()` gave,
under the same attempt id, with nothing anywhere that reports the contradiction. Measured on a
type-legal accumulator differing from `setQueryDataAccumulator` only in calling `streamFn` twice and
draining both: the call resolved `{ kind: 'complete' }`, and about half a second later the same
request read `incomplete` with a `lastError` reporting a timeout, while query-core's own status
stayed `success`. No `AccumulatorContractError` was raised and the return boundary took its "a
terminal outcome is recorded for this attempt" arm both times — correctly, by the only test that
boundary can run. **`refresh()` is decided by the leg that finishes first and the value by the leg
that finishes last**, and nothing between them notices they disagree.

**What is missing is not an error but a comparison, and saying it the other way round understates
this rather than overstating it.** The `incomplete` and its `timeout` cause are an honest report
about the leg that finished last; the `{ kind: 'complete' }` was an honest report about the leg that
finished first. Every axis is telling the truth about the half of the request it can see. That is
exactly why nothing catches it: a boundary or a diagnostics channel detects a report that is
_wrong_, and there is no wrong report here to detect — there is a consumer holding two right ones
that cannot both describe the same request. **Corruption that is silent is not corruption with no
errors on the wire; it is corruption where every error the system does raise is correct.**

The mechanism is three parts of this engine meeting, each right on its own. `twoStageStream` marks
the first chunk of _its own generator instance_ `fresh`, so a second call emits a second
`fresh: true` under the same attempt id (`stream.ts`); `fresh` is what runs `beginAttempt`, which
re-arms `running` (`useStreamedReq.svelte.ts`); and `endBacklog`'s "the first end wins" is
implemented as a guard on `running` naming this attempt, which it then clears (`eventset.ts`) — so a
re-armed `running` makes the second leg's end **overwrite** the first's instead of being ignored. On
the wire the same duplication shows up as colliding sub ids, both legs taking `…-b:0` and `…-f:0`,
and a live request sending its forward REQ twice under one subId and closing it once. Whether
rx-nostr dedupes that pair depends on how far apart the two opens fall, so the wire half is
deterministic per timing rather than fixed.

**Only the ordinary return path is exposed, which is why nothing already here caught it.** On the
throw and the teardown paths the invocation's `AbortController` has aborted by the time a second
stream could be opened, so the late leg opens and exhausts itself at zero chunks. Every route that
would have surfaced this is a route the engine already closes.

**An engine-side repair exists and was measured, and it is not the one taken.** Honouring `fresh`
once per attempt id fixes the overwrite — with the second generator's marker read as `fresh: false`,
the late leg's end no longer displaces the early one. It is refused for the reason this record
already refuses an engine-side deadline for the pending invocation: the seam is a non-public
internal substitution point (0004 C9), so a postcondition on the two functions this library ships,
with a witness over them, is a better instrument than a mechanism in the engine aimed at a function
no consumer can supply. It would also be paying in the wrong currency, and that is the sharper
objection — a guard there makes the _overwrite_ impossible while leaving the colliding sub ids and
the forward leg opened twice and closed once exactly as they are, so the engine would look repaired
and the wire would not be. **What it would buy** is a narrower blast radius if a future accumulator
gets this wrong anyway, which is worth reconsidering the moment the seam stops being internal.

**What would disprove the way this clause is argued**: make `beginAttempt`'s re-arming happen once
per attempt id, and the value-overwrite half of the defect disappears without the clause. What
survives is the wire half — two REQs under one sub id, a forward leg opened twice and closed once —
so the sentence would still be owed, for a reason the paragraphs above are not currently resting on.
A clause that outlives its own repair on a second reason is one to keep and to restate on that
second reason, not one to delete with the first.

**The row below it is that same corruption one grain lower, and it is in the table because the
table's columns are the two clauses.** Calling once and taking two iterators breaks `A11-P1` and
satisfies `A11-P2` for the same reasons the twice-called row does — the mechanism above needs a
second `fresh` marker under one attempt id, and a second acquisition on a re-iterable stream
produces exactly that — while the call count, which is what the earlier row is caught by, still
reads one. Its verdict is derived in `A11-P1` above rather than here, and what is inert about it on
this tree is the producer's shape — which is `A11-C17` now rather than a fact standing beside the
clauses, so a row that is inert here is inert **because a contract says so** and would report it if
that stopped being true.

**Two enumerations of hostile accumulators live in this record, on different axes, and it is worth
saying which answers what.** This table takes whole accumulator shapes and reads each against the
two clauses — the drive axis and the lifetime axis — so its question is _which clause does this
shape break_. The list inside `A11-P1` takes the singularity axis instead: which shapes take a
second acquisition, where the count has to be read to see them, and which shapes deliberately are
not forbidden. A reader asking whether a shape is a violation wants the table; a reader asking
whether the witness would catch it wants the list.

**The two singularity witnesses were falsified by two different shapes, one per grain, and which is
which is recorded with them rather than restated here.** `AC18` counts calls, and what was run
against it asks for its stream **twice** and drives the one it uses to the end — the nearest shape
that harness can hold, since a source that is one queue behind one object cannot make two
independent streams to drain. That is the shape this section calls inert on the wire above: the
generator nobody pulls never enters its body, sends no REQ and runs no `finally`. **It is inert on
the wire and still fatal at the seam**, which is the argument for a counter there rather than an
end-to-end observation — the count sees the cause where the request shows nothing. `AC19` counts
acquisitions, and what was run against it is the head/rest counterexample this clause was written
from: one call, two `[Symbol.asyncIterator]()`, the first pulled once and the second drained. It was
run as a third entry beside the two shipping adapters, folding into the cache exactly as the
fallback does so that the two acquisitions were the only difference between them, and it **passed
every other row in that file** — folding, pending, resolving, both throws, and the call count —
failing `AC19` alone. That is what makes the singularity independent of the obligations around it
rather than a corollary of any: an accumulator can satisfy every other clause those rows state and
still fork the request. It passed them **because that harness shares one queue between the iterators
it hands out**, which is the deliberate choice — the silent version is the one worth being able to
see.

**`A11-P3` is not a postcondition of an accumulator at all, and was written as one for a round.** It
is about what evidence means, which is why it is stated here rather than in the list above:
**failure containment guaranteed by the engine and parity between the two known adapters are
different claims.** The engine's guarantee is the four cells, over an invocation that returned,
threw or was externally cancelled. Parity is a measurement over exactly two implementations
(`A11-C1`, `A11-C3`) and says nothing about a third. The record has been treating them as one claim,
and a reader who took "the suite passes on both accumulators" as evidence that a future accumulator
is safe was being misled by this document rather than by the tests.

**The alternative that would make the stronger claim available, named by the reviewer and not
required by them, recorded so the next round does not rediscover it.** If correct-by-construction is
genuinely wanted, the iteration has to be owned by the engine and the seam lowered to the fold: the
engine runs `for await` over its own stream, and the accumulator supplies only `(acc, chunk) => acc`
and whatever it needs to publish a value. Then `A11-P1` and `A11-P2` are unstatable rather than
unenforced, because the accumulator never holds the loop. **Its cost is the whole of why the seam is
where it is.** A11's escape route is "the experimental helper disappears and we replace it", and
`experimental_streamedQuery` _is_ a `queryFn` factory that owns its own iteration — so a seam below
the loop could no longer be filled by the helper at all, and adapter A would become a
reimplementation of it rather than a rename. The parity suite would then be measuring our loop
against our loop, which is the failure the seam moved down to escape in the first place: a pair that
agrees because it shares the code the risk is about. It is also a larger surface, since
`setQueryData`'s per-chunk write and the helper's are different publication strategies and the fold
alone cannot express the difference. The trade is therefore "a stronger internal guarantee, paid for
with a seam that no longer sits at the dependency", and it is refused for that reason rather than
for effort.

**So the decision, stated as what A11 _is_ rather than as what it gave up.** A11 is **not a public
extension point**. It is an internal verified-adapter boundary, and it exists for one purpose:
exchanging the dependency. Nothing on the published surface takes an accumulator, no accumulator- or
helper-specific type is exported (`SUR10`), and a consumer has no way to supply one. What
"substitutable" means here is therefore **not** "any type-conforming function is safe" — it is "an
implementation this library or a port **owns**, that has been run against the A11 conformance arms,
can be swapped for another". A reader who took the first reading was being misled by this record,
which is the same defect `A11-P3` is about one paragraph up.

**The guarantees split in two, and the split is the point.** What the engine's doors preserve
**structurally**, whatever the accumulator does:

- attempt identity — the claim is taken at the query function's entry, above every path into the
  seam;
- the one-shot stream capability — one `streamFn` call, one iterator, and an invocation that has
  ended opens nothing (`A11-C10`, `A11-C17`);
- cancellation containment — the invocation's controller ends the machine, and a producer the
  accumulator walked away from ends with it;
- the published failure union — every terminal door is a total function into the surface's own type,
  so an accumulator cannot put a code on a surface the record says it cannot reach;
- and `relay-failed` crossing a terminal door, which is re-published as `accumulator-contract`
  rather than passed on (`A11-P4`).

What the **conformance suite** preserves, as behavioural contracts on the implementations we own:

- `A11-P1` — every chunk is folded, and the drive stops for one of the three allowed reasons and no
  other;
- `A11-P2` — the invocation's lifetime is its iterator's;
- `A11-P4` — a leg end is not re-published as a terminal failure;
- the singularity of the `streamFn` call and of the iterator taken from it;
- and the public trace parity between the accumulators that ship.

**The residue is named rather than absorbed.** `A11-P1` and `A11-P2` are _not_ correct by
construction and this record does not claim they are: an accumulator whose consumer is still there
and which simply stops pulling leaves an invocation pending for ever, and no door can see it — the
counterexample is written out above `A11-P1`. That is a behavioural contract on an internal,
verified adapter, which is a thing a port inherits as an obligation rather than as a guarantee.

**What makes the split payable rather than a phrase**: an accumulator this library ships and the
suite does not run would carry the postconditions asserted of the other two and measured of nobody.
`WR25` compares the exports of `accumulate.ts` with **one** roster, by identity, in both directions,
and walks the syntax of the two suites that iterate it to require the roster be used whole; `AC36`
reads, from inside the conformance suite, which rows it actually drove. It said "both rosters" —
there were two hand-written lists for a round, and a reviewer got a third accumulator past the check
that was supposed to bind them.

**When to reopen it.** Narrowing the seam to a fold becomes the better trade if any of these
happens, and they are listed so the next reader has a test rather than a mood:

1. the accumulator becomes a **public** extension point a consumer or plugin can inject;
2. a port accepts third-party implementations unconditionally;
3. a `A11-P1`/`A11-P2` violation gets past the conformance suite and does damage **in a form
   somebody can report** — which excludes the one class this record says no door can see: an
   accumulator whose consumer stays and simply stops pulling, whose damage is a `refresh()` pending
   behind a spinner for ever. That one is residue rather than a tripwire, and an adversarial pass
   found it standing here as though it were the latter;
4. the upstream helper is retired, so being able to plug it in directly is worth nothing;
5. the helper's per-chunk publication and `setQueryData`'s stop being two strategies — at which
   point one engine-owned loop can express both, which is the thing the fold cannot express today.

The reason it is a decision and not a detail: the claim used to be taken inside the stream function,
which made "every success and every failure is attributed by id equality" true only _after_
`streamFn` was reached — a cooperation between the two sides of the seam that the seam's type cannot
require. An accumulator that is legal by the type and never calls `streamFn` then ran an attempt
nothing had claimed, and its failure was filed under a minted id. **What that produced was measured
before it was changed, and it was not what it looked like**: `refetchQueries` swallows the query
function's rejection (`throwOnError` is unset, so query-core `.catch(noop)`s it), so the trigger
resolves, the claim is seen to be unbegun, and `refresh()` _rejected_ with "asked for an attempt
that never began" rather than hanging. Both halves of that message were false — an attempt began and
it failed — and C11 divides exactly there: a failure of the call rejects, an attempt that ran and
went wrong is an outcome.

**The message survives, on the two entrances it is true of**, which this paragraph never said and an
adversarial pass asked about: a `refresh()` over an entry the cache does not hold, and one over a
request the caller has disabled. The third entrance — a query the layer had paused — is closed by
configuring `networkMode: 'always'`, which is why that configuration is not an optimisation. A port
reading only the paragraph above deletes a message it still owes. The alternative considered and
rejected was to define a pre-`streamFn` failure as a "call failure" that must always reject; it
needs A14 and C11 narrowed to exclude a state a consumer can reach with a type-legal accumulator,
which is narrowing the contract to fit the implementation.

**Request identity is still defined once** — `canonicalKey` over the normalized descriptor — and a
lane is a cache entry, so `refresh()` resolves, rejects and single-flights the same way on both
sides of the seam by construction rather than by two implementations agreeing. Two calls made at
once over one request are one attempt and one outcome object; two hooks over one identity are one
request. That used to be true on one engine and false on the other, which is what made it a
counterexample rather than a cost.

**What the escape route does not cover, stated rather than discovered.** Leaving TanStack entirely
is a different decision and needs a second cache implementation; nothing here demonstrates it, and
the deleted engine did not demonstrate it either. What is claimed is what the risk bullet says this
record is exposed to: the helper can go and the library still works.

**The deleted files are not kept as exploration.** An engine nothing runs against is not a witness,
and one left in the tree is a cherry-pick target that looks like one. Deleting
`coordinator.svelte.ts` also closes four defects an adversarial review reproduced by execution
rather than repairing them: a reference leaked on the boundary-rejection path, a superseded run left
un-aborted so events were lost silently, `planRequest` reading a field outside the request identity
and wiping another hook's accumulation, and waiters bound to a hook's current entry rather than to
the attempt's request.

**A-δ is here because the clock is a lifetime, and lifetimes are this record's subject.** What the
clock is _for_ belongs to 0003 and 0004: the fold stays time-independent, **the bound is
time-independent too** — it ranks by recency, so a bounded stored value is order-independent without
the qualifier this sentence used to carry — and the published read model excludes events that have
expired. The clock therefore reaches what is shown and never what is stored, which is the
single-reader shape 0003 B7b asks for. The provider owns one clock, fixed and unscheduled when
rendering on a server, so that a timer cannot outlive the response that armed it.

**That sentence described a branch nothing took, and the branch now has something that takes it.**
`createExpiryClock` defaults to scheduling against the system clock, the option that turns both off
had to be passed by hand, and nothing in the library detected a server at all — so for six rounds
"when rendering on a server" named a capability rather than a behaviour. The provider asks once, and
a server-rendered one is fixed at the instant of the request and arms nothing. Witness `CX9`, row
`A-δ-C3`.

Two things about that are worth keeping. The first is that **the detection has to be observed from
both sides**: a test asserting only that a browser is detected as a browser is satisfied by a
function that returns `'browser'` and nothing else, which is what the ledger measured before `CX9`
was made to render with no `window`. The second is that A12 has the same shape one level down and is
**not** closed by this — the engine still takes `environment` per request, because the spike calls
it directly and there is no published hook to carry a context into it. The provider is where the
answer comes from once there is.

**A-α's policy for this version is to stop.** There is no protocol-level retry: a retry needs an
owner for the timer, the attempts, the cancellation and the ceiling, and this design has no state
machine for that. Every refusal ends that relay's leg, and `refresh()` is the way back. The
classification is still recorded, because it is what a retry policy would later be written against,
and because exactly one of the nine standardized prefixes clears by waiting — so a two-way reading
is wrong eight times or once, whichever way it is taken.

**A-γ's claim was conditional, and the condition was 30 seconds.** "The request owns its settle
timeout" is only true while nothing else closes the subscription first, and something else does:
rx-nostr runs its own `eoseTimeout`, which _completes_ the backward observable rather than erroring
(measured at rx-nostr 3.7.5, `SEN14`), and defaults to 30s — **a number nothing asserts**, and the
citation that stood here made it look otherwise. `A-γ-C6` reads the dependency's own filled value
and compares it with the library's, so what is checked is the **inequality**; any default below the
library's timer keeps it green and leaves this figure wrong. `SEN14` passes `40` explicitly, because
a sentinel that waits out the real default is a sentinel nobody runs. So the figure is orientation,
dated to that version, and the thing a port inherits is the comparison rather than the number. A
caller passing `settleTimeoutMs: 45_000` therefore got a backlog ended by the dependency at 30 —
with no EOSE, no CLOSED and nothing on the connection-state channel to say why, which is
indistinguishable at the subscription from a clean finish.

Two mitigations, and both are taken, because either alone leaves the claim conditional on the other.
The library sets `eoseTimeout` far above any settle timeout it will accept, and the boundary refuses
a `settleTimeoutMs` above that cap, which `NZ11` drives.

**The three numbers, here rather than only in the code**, for the reason the `gcTime` paragraph
gives: a value that lives in a spike this record outlives is not a decision a port can inherit. A
settle timeout defaults to **5 000 ms**, has a **floor of 1 ms** — `settleTimeoutMs: 0` is refused,
not treated as "do not wait", for the reason `retain: 0` is — and is capped at **60 000 ms**; the
library writes rx-nostr's `eoseTimeout` at **600 000 ms**, ten times that cap. What a port inherits
is the _ordering_ — the dependency's own completion must sit far enough above the cap that a request
the boundary accepts cannot be ended by it — and these are the values this library chose for it.
Moving any of the three is an API change with a consumer-visible effect: the first changes what an
unconfigured request waits, the second changes which requests are refused, and the third changes
whether A-γ's claim holds at all. Setting it is consistent with 0004 rather than a contradiction of
it: `eoseTimeout` is one of the four options the provider deliberately stopped exposing, and the
reason it stopped is precisely that this decision owns it. The cap **refuses** rather than clamping,
for the reason the whole normalization boundary exists: a caller silently given a different number
than they asked for is told nothing, and the cache key agrees with neither request.

**A4b now leads with the allowlist, and the ordering is the half that is left over.** It used to
read "caller options are applied first, library values last", which describes a fold and therefore
describes a collision that has already happened. The stronger statement is that on the surface this
record publishes, the collision cannot happen: `ReqDescriptor` has six fields, none of them names a
query-library option, and a library-owned key is not something a caller can spell (`OF3` measures
the two sets disjoint, `C16`'s refusal is the shape used elsewhere for inputs a caller _can_ spell).

**What holds the allowlist in place is a discipline no type expresses, and it has a cost.** Nothing
on the path from the caller's descriptor to the query options ever spreads the caller's object:
every field is written out by name, at each of the two sites that build a request. So an input the
allowlist does not name cannot arrive by accident — and adding a legitimate one means writing it in
both places, which is duplication accepted on purpose. A port that reaches for a spread to remove
that duplication removes the allowlist with it, and no test here would say so.

That is correct by construction, and the fold is not needed to reach it.

**The reason the ordering clause survives is not the one written here first, and the first one was
false.** It said A15 makes the query client the application's, so a consumer's own client can name
`enabled` through `defaultOptions.queries` or `setQueryDefaults` without going through this
library's descriptor — and that on that path A12 stands on the dependency's fold order rather than
on disjointness. **Measured, all of it is wrong on this tree**: the query library is a direct
dependency rather than a peer, the provider builds its own client, no module below it reads an
ambient one (`A15-C3`, whose browser arm is the one that shows a consumer's client cannot even
_stop_ a request), and `enabled` is absent from the library's client-wide defaults — so A12 would
survive a reversed fold. **The paragraph is kept rather than deleted** because the claim it made is
the one a reader of A15 will make next, and because it was written, published to a reviewer and
believed for part of a session before anyone measured it.

**What the ordering really holds up is smaller and entirely internal.** The library stacks two
layers of its own: client-wide defaults (`retry`, `staleTime`, `refetchOnMount`, the three refetch
triggers, and — the two this enumeration missed for several rounds — `networkMode` and `gcTime`,
both of them decisions this record argues elsewhere) and a per-query object (`queryKey`, `queryFn`,
and conditionally `staleTime`, `refetchOnMount`, `enabled`, `initialData`). They share **`staleTime`
and `refetchOnMount`**, and the fold order is what makes the per-query value win on those two.
Neither is reachable from the published descriptor, so **no public path turns on the fold today** —
which is a stronger position than the one this record claimed, and `A4b-S1` records it as such
rather than leaving the ordering to look load-bearing.

### What an attempt has to do before it can ask

`refresh()` is the way back from a stopped request, and that is only true if the way back exists.
rx-nostr does not re-open a socket because a REQ arrived for it: a relay left in `error` — its
retries used up — stays there until something calls `reconnect()`. An attempt that merely re-sends
is an attempt to nowhere, and the request reports itself stopped again having done nothing, which is
the failure `refresh()` exists to remove reappearing one layer down. Measured while writing the
reconnect tests: after a bounce with retries off, the re-send reached the relay only once
`reconnect()` had been called.

So the four terminal states are four cases, decided rather than collapsed:

| State        | Before the attempt                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`      | `reconnect()`, then ask — re-opening is what the caller asked for                                                                                          |
| `rejected`   | leave it terminal — the relay refused the connection, and reconnecting on every refresh turns a user gesture into a retry loop against a host that said no |
| `terminated` | fail the attempt — the client is disposed, so no later attempt succeeds                                                                                    |
| `dormant`    | **ask** — the socket is asleep, not gone, and a REQ wakes it                                                                                               |

**`dormant` answers this question differently from the leg table, and the row was missing here for
several rounds.** The two tables ask different things of the same word: the leg table asks whether a
subscription that was already open is still alive, and a socket that went to sleep under one has
ended that leg; this table asks whether the relay can be asked anything _now_, and it can. It is not
a corner. The dependency's default connection strategy is lazy with a ten-second idle timeout and
this library overrides neither, so ten seconds after a request goes quiet every relay in its scope
is `dormant` — which makes this the state preflight meets on the _ordinary_ `refresh()`, and the one
a port deriving "the terminal states" from the leg table alone would map to `give-up` or to a failed
attempt. Either mapping refuses every refresh after a pause, permanently, and neither would look
like a defect.

**And `terminated` has no entrance in v1, which is worth saying beside the row rather than leaving
to be discovered.** A relay reaches it only when the client itself is disposed, and under `A16` the
only client is the provider's — whose disposal revokes the capability first, so a request reaches no
preflight loop afterwards. The row is what a port owes if it ever hands a request a client of its
own; today it is unreachable, and `0004` routes the disposed-provider case a consumer _can_ reach to
`provider-disposed` on `refresh()` rather than to this branch's `invalid-descriptor`.

A `CLOSED` needs nothing beyond a new wire id, which A6 already gives every attempt.

**`auth-required:` is terminal like the rest, and that is a choice against the dependency's
behaviour rather than an oversight.** rx-nostr re-sends the request after a successful AUTH when an
authenticator is configured — read from its source rather than measured, and unsentinelled for a
reason the other unsentinelled ones do not share: reaching the path needs a relay that demands AUTH
and a signer to satisfy it, which the sentinel harness cannot stand up. **This claimed to be the
only dependency claim in this record with no sentinel behind it, and it is not** — A6's reading of
rx-nostr's per-subscription counter carries none either, and 0005's sentinel rows cover neither. The
distinction worth recording is reachability rather than scarcity: that one could be sentinelled and
has not been, this one cannot be with the harness this repository has. **What would falsify the
reason** is a sentinel for it appearing without a live AUTH relay behind it. The decision is the
conservative one either way: if the re-send happens, ending the leg is what stops a request
resurrecting after it reported itself stopped; if it does not, ending the leg is simply correct.
Whether one is configured is not readable from the client, and neither is a failed AUTH, so a
version that treated the prefix as recoverable would need a fourth per-relay state — `awaiting-auth`
— with no way to observe leaving it. Without that state the leg ends and the dependency re-sends
underneath: a request that resurrects after reporting itself stopped, which is worse than one that
stays stopped. Supporting AUTH means adding the state and revising this record, not relaxing the
rule.

### A5: when a leg ends, per relay

Both legs, and that is the correction. This section was about the live leg only, and the backlog had
no per-relay state at all: its outcome was whichever signal arrived first. That is not a gap in
coverage but a wrong answer, because rx-nostr's backward observable **completes** once every target
relay reaches `error` / `rejected` / `terminated` (measured at 3.7.5, SEN13). A backlog that reached
nobody therefore arrived at the same completion an answered one does, and the request reported its
answer whole. An `error` handler cannot see that path; only the connection-state channel can, and
only per relay.

The earlier rule — every relay refused — was too narrow in one direction and the obvious repair is
too wide in the other. A relay that drops off is not a refusal and must not end the leg, because
rx-nostr reconnects on its own and re-sends the ongoing request; ending on a disconnect would break
that recovery. A relay that is gone for good must end its part of the leg, or a request nothing can
reach goes on calling itself live, which is the sentence this whole record is about.

So the leg is not one state but a set of them, one per relay, over a target set **fixed when the
request starts**, and it is the set the request was keyed for rather than the client's. Reading the
client's list once was the first half of that: it stops a scope change mid-flight deciding the fate
of a request that was never asking those relays, and it leaves the set being whatever the client
held when the stream started rather than what the request was planned and keyed under. The two are
the same list only while nothing has moved the client, so the target set is handed in by whoever
made the request (0003 B3), and the REQ is routed to exactly those relays rather than to the
client's defaults at send time.

Forward:

| Per-relay state | Reached by                                                            | The leg                               |
| --------------- | --------------------------------------------------------------------- | ------------------------------------- |
| `pending`       | the request has begun, no REQ observed yet                            | alive                                 |
| `active`        | a matching forward REQ went out, **or the relay reports `connected`** | alive                                 |
| `recovering`    | `connecting`, `waiting-for-retrying`, `retrying`                      | alive, and degraded on the relay axis |
| `terminal`      | `CLOSED`, `error`, `rejected`, `terminated`                           | ended, for this relay                 |

**The "Reached by" column is what a port builds the machine from, so the second reacher of `active`
is in it**: `connected` on the connection-state channel maps to the same phase. Both are "alive", so
nothing about a leg's end moves for it — but which states are non-absorbing is load-bearing, because
the absorbing rule below is what decides whether a later `connected` can revive a leg, and a port
reading only "a REQ went out" would build a different set.

The live leg ends when, and only when, every relay in the target set is `terminal`. One relay
stopping is degradation and belongs to diagnostics, not to the completeness of an answer.

Backward:

| Per-relay state | Reached by                                | Determined |
| --------------- | ----------------------------------------- | ---------- |
| `pending`       | the request has begun, no REQ observed    | no         |
| `active`        | a matching backward REQ went out          | no         |
| `complete`      | a matching `EOSE`                         | yes        |
| `refused`       | a matching `CLOSED`                       | yes        |
| `ended`         | a terminal connection state before `EOSE` | yes        |

The backlog is over when every relay is determined, and what it was missing is derived from the
table at that moment rather than named by whichever signal triggered it. `timeout` is not in this
table because it is not a relay's state: it says the request stopped waiting on a backward target
rather than hearing from it — its own timer drew the boundary, or a target was still undetermined
when the outcome was derived — which is a claim about the request rather than about a relay.

`verification-timeout` is not in this table either, and for a stronger reason — it is not about the
relays **at all**. It says the backward gate was holding candidates it had admitted and not yet
verified inside that boundary when the drain cutoff cut the wait, so what it held was discarded
(A-ε) — never `accepted`, and so never owed delivery — and it says nothing about how far any relay
got. Every relay can be `complete` and the answer still carry it, and **one relay that sends an
EVENT and no EOSE makes both members hold at once** (`A-ε-C14`). The two request-owned causes are
therefore separate members rather than one word, and separately actionable rather than mutually
exclusive: the first points at the relays and the network, the second is local and CPU-bound. **A
consumer decides what to do next by reading the whole array**, not by switching on a first member.

**The result is a set, not a reason.** With several relays a timer can fire while another relay is
already gone, and reporting one of those two stores a presentation decision as a fact — the argument
0003's `IncompleteCauses` is built on, applied one layer earlier. `refused` is deliberately not
among the causes derived here: a refusal is already recorded on the value, per attempt and per
relay, and deriving it twice would be two sources for one claim.

The same asymmetry as the forward table applies to a relay that was terminal before the request
began, and it applies to **every** request rather than only a live one: the backlog of a request
whose relay refused the connection ends on that fact, instead of waiting out the settle timeout for
an answer that was never coming.

**Determined is determined, and it is one rule over both tables rather than a habit each of them
has.** A relay's state is absorbing once it is one that ends that relay's part of a leg — `terminal`
on the forward table, and `complete`, `refused` or `ended` on the backward one. **The first such
state a relay reaches is the one this attempt holds until the attempt ends** — from any state, not
only from `pending` or `active`. That qualification stood here for several rounds and is wrong in
the direction that matters: under the dependency's shipping retry configuration the ordinary death
of a socket is `active → recovering → … → recovering → terminal`, so **the route the qualification
left out is the one a real network takes**. Not the only one, and this said "every real transition"
for a commit, and **two enumerations that replaced it were each wrong again** — which is why the
rule below is written over the state a relay is _in_. The routes, in full:

1. **A connection state that maps to `terminal`** — `error`, `rejected`, `terminated` **or
   `dormant`**. This is the ordinary one: under the shipping retry configuration a socket dies
   `active → recovering → … → recovering → error`, so `error` is where the ordinary death lands, and
   an enumeration that called `CLOSED` "the ordinary witnessed one" contradicted the sentence above
   it. `terminated` has no entrance in v1 (the preflight section says why).
2. **A forward `CLOSED`** for this relay, which is the first thing the `terminal` row's "Reached by"
   cell names.
3. **A relay the preflight gave up on** — and only that. This route is narrower than "already
   terminal": the preflight asks `approachFor` and acts on the answer, so a relay that is
   **`rejected`** when the request begins is recorded terminal, a relay that is `error` is
   **reconnected and asked** (the preflight table four hundred lines up says so, and a port that
   reads this route as "the terminal set" never reconnects one), `terminated` throws `disposed`, and
   `dormant` falls through to `ask`. It is also the only route that is **live-only** in both halves:
   the backward table is written for every request, the phase write is not. A third rewrite of this
   list said "already terminal" over the whole set; the code has said `give-up` alone since the
   preflight was written.

**`dormant` is in the mapping and not in the table above, and that gap is the defect the mapping's
own `default` records**: a port that builds its connection-state classifier from the "Reached by"
column alone answers nothing for `dormant`, the handler returns on that, and both legs stay open
waiting out the settle timer for a socket that has gone quiet. The table is the leg's vocabulary;
the classifier answers for every state the leg has a phase for, which is eight of the dependency's
nine. **`initialized` is the ninth and it answers nothing on purpose** — a socket that has not been
anywhere yet says nothing about a leg — so "total" is the wrong word for the classifier and was used
here: what is total is the _decision_, which is that every state either maps to a phase or is one
the leg does not act on, and both halves are written down.

And "from `active`" is not a property of the code. The writer that advances a relay has exactly
**one** source-state condition and it is the rule this paragraph is arguing for — a relay already
`terminal` is left alone, which is what makes the state absorbing — and it is called from `pending`,
`active`, `recovering` and `terminal`. A previous version said it had no source-state condition at
all, which contradicted the absorbing rule three lines below it. What holds over all of them is the
rule, not the arrival.

**And the recovery this rule assumes is bounded, which is `A13`'s to fix rather than this row's.**
`A5` does not end a leg on a disconnect _because_ the transport reconnects and re-sends the ongoing
REQ — true five times, which is rx-nostr's shipped ceiling. Past it every relay is `error`, `error`
is terminal, terminal is absorbing, and the leg ends with nothing scheduled to reopen it: the one
`reconnect()` in the engine is the preflight, and a preflight runs when a new request starts. A tab
that slept therefore holds a subscription-less request that renders `default`, which is the
silence-reading-as-health this design refuses everywhere else. **The repair belongs to the
provider**: `A13` now owns a liveness trigger that schedules recovery on a backoff, with the
browser's `online` and visibility-return as hints that bring the wait forward rather than as the
trigger — relying on them alone cannot recover from a relay-specific failure. **Recovery starts a
new attempt** rather than reviving an ended leg, so this row's absorbing rule stays true _within_ an
attempt, which is the scope it was always about. Handing `retry` to the consumer would leak the
ownership `A16` just took back; rewriting a terminal outcome after the fact would make "terminal"
mean nothing.

A port that implements the narrow reading absorbs nothing on a real network, and a later `connected`
— which another request's `refresh()` can cause on the shared client — writes `active` back over
`terminal`, leaving a request that reports itself live with no subscription anywhere. The rule is
over the state a relay is **in**, not the state it came from, and every later signal naming that
relay is dropped: whichever of the determined states it would write, and whether it would determine
the relay or take it back out of the determined set. A relay that comes back after being gone does
not revive the leg it was part of: the leg is what one attempt holds open, and `refresh()` is what
opens the next. The alternative — a leg that can be revived by a reconnection — makes "is this
request still running" a question with two answers, one held by the request and one by the transport
underneath it, which is the shape this record exists to remove.

**Stated as a rule over the whole table rather than as the pairs that are easy to reach, because a
table is read at the end and written all the way through.** The outcome above is derived from these
states at the moment the wait ends, so a table that took the last write would answer with a relay's
most recent news rather than with the answer that relay gave. Three failures follow from that, one
per direction the rule blocks, and they are different failures rather than three readings of one:

- **A relay that answered and whose socket then died would report the death instead of the answer.**
  `ended` names relays the backlog never heard from, so a socket dying after its `EOSE` would put a
  relay that answered into that list and hang an error naming it off an answer it had completed.
- **A relay that refused and whose socket then died would be counted twice, in two vocabularies.**
  The refusal is recorded on the value, per attempt and per relay; overwriting `refused` with
  `ended` would leave the value saying the relay refused and the outcome saying the connection to it
  ended before the backlog did, which is one event and two sources that are free to disagree.
- **A relay that is already decided and is then asked would be taken back off the decision.** An
  observed REQ writes `active`, and the writer of that state cannot tell which it is: it reads
  outgoing messages, which carry a relay and a subscription id and no history. A table that accepted
  the write would move a determined relay back into the undetermined set, and the backlog — which is
  over when every relay is determined — would go back to waiting for an answer it is not going to
  get. **This one arrives today, and by a shorter route than a re-send.** The preflight determines a
  relay that was terminal before the request began, and the REQ this request then sends goes out to
  that relay all the same, so the outgoing-message channel writes `active` over the `ended` the
  preflight had just recorded. Measured with the guard removed: the only overwrite in that trace is
  `ended → active` from the outgoing-REQ handler, and the answer loses `ended` — a relay this
  request could never reach, dropped out of the report that says so. The **other** route into this
  cell is a REQ re-sent after an answer, and it does not currently arrive: a reconnection re-sends
  the live leg and not the backlog, because the backlog is no longer ongoing by then (`N2`, which
  asserts a re-sent `-f:` and no re-sent `-b:`). That is a habit of the dependency rather than a
  guarantee this record owns, which is why the rule is stated over the write: a version that starts
  re-sending is one this table already answers rather than one that would need finding.

**What the rule costs is a report this record chooses not to make.** Nothing in the outcome
distinguishes "the relay answered" from "the relay answered and then its socket died", because the
second half is not about how complete the answer is. On a live request the death is still published:
it ends the forward leg, which is what the contract's arms read as the receipt that the death
arrived at all, and what a consumer reads as `diagnostics.legEnded`. On a request that is not live
there is no forward leg to end and no report is made: by then the relay's part of the backlog is
decided and the attempt is on its way out, so the only thing such a report could change is an answer
that is already correct.

**A relay can already be terminal before the request begins**, and that case is the same rule rather
than an exception. The check that ends the leg is the request's own, run over its own table, so a
target set that was terminal on arrival ends the leg immediately instead of waiting for a transition
that has already happened. Stating it separately is worth the line because it is the one path with
no signal to hang off: every other route into `terminal` arrives as an event, and this one arrives
as a fact.

`dormant` is not in the table. A relay with an active forward subscription **should not** reach it,
so it is treated as terminal — choosing the safe branch rather than assuming the state away.

**"Should not" rather than "cannot", and the difference is settled here because this paragraph used
to hold both.** Three lines below its own "should not" it called the state one that "cannot happen"
and one "nothing can produce", and 0005's `A5-C6` said `dormant` is terminal "because it cannot
occur". Those are different claims: one is an invariant nothing enforces, the other is a structural
impossibility, and the second owes a witness that the first does not.

**A witness exists, and it refutes the stronger claim.** `N8` closes the socket with rx-nostr's own
idle code while a forward REQ is on the wire and reads `dormant` off the connection channel — so the
state _is_ reachable with a subscription open, and "because it cannot occur" was false rather than
merely unmeasured. This paragraph said "no such witness exists" for a round after `N8` was written
to be exactly that witness. So "should not" is not a hedge about what could be measured — it is the
accurate word: the state occurs, nothing in this library prevents it, and the terminal
classification is the safe branch taken _because_ the invariant is unenforced.

Reporting it is a separate question and is deferred: there is no diagnostics channel for "something
happened that should not", and the shape such a channel should take is not decided by one reachable
state. It is recorded here instead, which is where the next person to see one will look.

This is what the sixth event connects to. It had no input before: rx-nostr routes transport failures
to a separate channel and leaves the subscription untouched, so nothing ended a leg whose relays had
simply gone away. The connection-state channel is that input, and the tables above are the
semantics.

**A request ends when its last leg does, and the forward one is not always last.** An earlier
version of this paragraph said the backlog was over as soon as the forward leg was, on the reasoning
that ending the forward leg ends the stream and closes the backward subscription with it. Both
halves were true and the conclusion was wrong: what it repaired was a request that produced no
outcome at all, and what it cost was the answers a relay was still sending.

A relay may refuse the _live_ subscription and answer the backlog it never refused — which is what a
relay limiting live subscriptions does. Measured through both accumulators, and what was measured is
**the defect this repaired**: before it, an event and its EOSE sent after a forward `CLOSED` were
**dropped**, and the consumer was handed `incomplete: ['timeout']` over an empty list. **The
sentence here used to say those events "reached the consumer as" that**, which cannot be true of
anything — an event that reached the consumer is not an empty list — and it read as a present
measurement while the witness asserts the opposite: the request reaches `settled` and the event is
in the answer. So the forward end is recorded and the stream ends when the _last_ leg does. A relay
that refuses the live subscription and then says nothing is bounded by A-γ, which is what A-γ is
for, and the answer it produces says the request stopped waiting rather than that everybody
answered.

Losing data is the one direction 0001 says this design does not fail in, and an answer already on
the wire is data.

**`ended` on the backward leg was a cause that existed and could not be produced.** The type carried
it, the derivation had a branch for it, and no code path could set it — so a backward transport
failure was reported as whatever the single end signal happened to say. It is reachable now, and the
two things that make it reachable are the connection-state channel and the per-relay `EOSE`: a relay
that answered must not be counted among the ones that did not, and only the `EOSE`'s `from` can tell
them apart.

### A-ε: what is observable, and when

The rule, and it is about the answer rather than about how the answer is produced:

> An attempt's outcome becomes observable only after everything causally prior to it — the EOSE, the
> refusal, the terminal connection state, **and the events the attempt accepted** — is reflected.

**The four words in bold were missing, and their absence is the most expensive thing in this
record.** The list named the three signals that decide _what_ the outcome is and left out the thing
the outcome is _about_. That is not a gap a reader would notice, because every one of those three is
something a relay says and an event is too — but the implementation had to enumerate the list, and
what it enumerated it satisfied.

What that cost: rx-nostr routes every event through an asynchronous verifier inside `use()`, so a
validated event reaches the machine one microtask after the raw message that carried it, and the
settle marker was deferred by exactly one. A backlog whose `EOSE` arrived alongside its own event
therefore released the backward subscription before that event was handed over. **The event was
lost, the answer reported itself complete, and A-ε as written was satisfied** — the EOSE was
reflected, the refusal was reflected, the connection state was reflected. A verifier that awaits
nothing at all is still late, so this was never a race whose deferral could be widened; `AE1`
measures the ordering and `AE5` measures the loss it produced.

**The two columns moved in opposite directions, and an earlier draft of this paragraph claimed
otherwise.** It said "nothing that satisfied the old sentence stops satisfying the new one", which
is contradicted seven lines above by this record's own account: the implementation this round
replaced satisfied the old sentence and does not satisfy the new one. A record cannot write a test
and fail it on the same page, so the claim is withdrawn and replaced by the split.

**The falsifier column is a pure extension.** Both original clauses are kept verbatim — an outcome
observed that a signal already sent would have changed, and a signal arriving after the end being
delivered — and a third is added. Nothing that failed to falsify before falsifies now.

**The decision column is a narrowing, and it is counted as one.** "The end of a stream releases its
producer as it is decided" gained "without discarding what that producer had already accepted", so
an implementation that released synchronously satisfied the old decision and does not satisfy this
one. That is the point — it is the defect being fixed — but it is a decision that admits fewer
implementations than it did, and it is entered in the narrowing table under 0001's More Information
rather than presented as free. **That object was "handed over" when this clause was written and is
"accepted" now**, which the row below narrowed under it; the table carries both edits as separate
lines because they move the decision in opposite directions. What it is _not_ is a narrowing that
closes a blocker by making the falsifier easier to pass: the falsifier got harder, which is the
direction that costs the author something. A round that had answered this by rewording the falsifier
— "outcome" narrowed to mean the marker rather than the answer, say — would have closed the blocker
and kept the defect.

**The grammatical acceptor in that object is the producer, and A-ε's acceptor is the attempt — left
standing on purpose, and recorded here so the next reader can tell that from a miss.** The gap is
grammar rather than meaning: what the clause names is an event already past the gate, which is
exactly the sense A-ε defines, so it is not the confusion the narrowing below exists to prevent.
What holds it in place is that the wording is load-bearing elsewhere — it is reproduced in A-ε's own
row and in this paragraph, and 0001's narrowing table carries it in its **r24** row, "what the
producer had accepted, not what it handed over", which that table enters as a _relaxation_ rather
than as a tidy-up. The **r23** row above it is the separate one claiming a pure extension with both
original clauses kept verbatim, and it names the producer too — there as the thing the end releases.
Re-pointing the actor would rewrite the one row and spend the other's claim, to fix a reading
nothing depends on. A port rewriting these clauses from scratch should make the attempt the acceptor
throughout.

#### `accepted` means past the gate, and that is a second narrowing

The clause added above was **unconditional** — an event the attempt had already accepted is not
dropped because the wait it belonged to ended — and the Consequences below decide the opposite in
the same record: the gate's wait is bounded, and if events are still being verified when the bound
expires the attempt ends incomplete. **Both cannot hold once the verifier is an arbitrary Promise,
and the counterexample is one line:**

```ts
const verifyEvent = () => new Promise<boolean>(() => {});
```

Nothing resolves it. Under the unconditional reading the outcome may never be observed, because an
event the gate has merely **admitted** off the wire is owed delivery ahead of it; under the bound,
the wait ends and that event is not delivered. A record cannot require both, and for a round it did.

**The narrowing chosen is on `accepted`, and it is counted as one.** An event is `accepted` when it
has passed the signature gate, and only if it passed before the wait it belongs to ended. A
candidate that reached the gate off the wire and was still inside it at the cut was never accepted
by this attempt, and is discarded rather than delivered behind the outcome it missed. So the clause
admits fewer implementations than the unconditional one did — an implementation that held every
candidate until it resolved satisfied the old sentence and does not satisfy this one — and the
falsifier column loses a case it used to have. That is the direction that costs the author something
and it is written down as such rather than presented as a clarification: both halves — the narrowing
and the deleted case — are entered in the narrowing table under 0001's More Information, which is
also where it is recorded that this one was the reviewer's first recommendation rather than a choice
made here.

**What made the choice rather than the wording**: the two sides fail differently. Keeping the
unconditional clause means withdrawing the finite cutoff, and a request whose verifier hangs then
has no outcome at all — a `refresh()` that never resolves and a query stuck in `streaming`, which is
the failure 0001 rules out. Narrowing `accepted` means a pathological verifier costs the events it
was still holding, reported as an incomplete answer. Losing an event is the direction this design
says it does not fail in, so it is worth saying plainly that this is that failure, bounded: it is
reachable only from a verifier slower than its own re-armed bound, which `VERIFY_DRAIN_FLOOR_MS`
carries the measurement for. **How it is reported depends on which leg was cut, and this paragraph
used to end "and it is reported rather than silent" over both.** That is true of the backward leg
and false of the forward one, measured below.

**And "not delivered" is the whole of it: a discarded candidate is not delivered late either.** That
was the defect this narrowing was found through. The cut used to set a flag beside releasing the
waiters, leaving the gate open, so a verification finishing afterwards still pushed its event —
after the outcome it was supposed to be part of, measured as the chunk order `settled, event`. A
clause that says "an accepted event is not dropped" is satisfied by delivering it late, and
delivering it late is worse than dropping it: the consumer has already been handed an answer the
event was not in. So the cut discards, and `AE15` releases the held verifier with `true`, `false`
and a rejection to say that all three add nothing.

#### The forward cut is reported by its leg's end and by nothing finer

Measured on the shipped tree. A live request whose backlog `EOSE`s empty, with one matching event
admitted to the forward gate and still being verified when the relay's socket dies:

```
status           : settled
events           : 0
hasMatchEvidence : false
slot             : nodata
legEnded         : { kind: 'ended', error: <Error> }
refusals         : []
lastError        : undefined
```

The verifier answered `true` after the cut — held 2500ms against a drain floor of 1000ms — and
nothing changed. The control arm — the same request with **no event ever sent** — publishes those
same seven values, field for field. So a discarded candidate is today invisible below the leg's end,
and the paragraph above used to claim the opposite for both legs.

**The legs are not symmetric, and the asymmetry is one line.** A backward gate that is cut adds
`verification-timeout` to the cause set — `if (gates.backward.phase === 'cut')` — so its answer is
`incomplete`, carries a cause, and never reaches the `settled` variant `hasMatchEvidence` lives on.
The forward gate has no such line and cannot be given one: B10's falsifier is "a live-leg refusal
makes a finished backlog incomplete", and a forward cut pushing a cause would be that failure one
mechanism over. **`settled` therefore coexists with a discarded candidate only through the forward
leg**, which is the one shape in which the two records could disagree about what `accepted`
promises.

**That cause is the backward cut's own, and not the timer's.** It read `timeout` for a round, under
one branch — `if (viaTimer || gates.backward.phase === 'cut')` — which put two unrelated failures
under one published word: a backward target this request stopped waiting on, and a gate of its own
it cut with candidates still inside. **Unrelated rather than exclusive** — one relay produces both,
with an EVENT it never lets verify and no EOSE (`A-ε-C14`), so neither member can be read as a
statement about how far the relays got. The two are now separate members, and the Consequences below
record what that cost and why the earlier fold was wrong to keep. The forward side of this paragraph
is unchanged by the split: a forward cut still publishes no cause at all, for the three reasons
under it.

**Three reasons the silence is decided rather than left**, in the order that decides it:

1. **The leg's end already says the true thing, and says all of it.** A forward cut is reachable
   only from `finish()` — the boundary is drawn once, when the leg is over — so every discarded
   candidate has a dead live subscription behind it. `legEnded` is published at that moment, in both
   arms above, and what it says is that this request has stopped receiving live events. The
   candidate inside the gate is one member of an unbounded set: every event that relay would have
   sent afterwards is equally undelivered.
2. **Singling that member out is the half-answer B-θ refuses.** "One candidate was discarded" counts
   the loss that happens to be countable and publishes it beside no count of the losses that are
   not, so it reads as "one event was lost" when the truth is "live delivery stopped, and what did
   not arrive is not knowable". That is B-θ's last disjunct in a different mechanism.
3. **The trigger is the relay's, and it is cheap.** Any relay can produce a discarded candidate by
   sending one event it never lets verify — the cheapest event there is, since it never has to be
   valid — and then dropping the connection. A field separating "ended holding one" from "ended
   holding none" is thus a marker a hostile peer can attach to a truthful "nothing found" at will.
   That is the boundary `EV2` contracts for arrivals the verifier rejected, and a cut candidate is
   an arrival that was never accepted: it falls inside that boundary rather than beside it.

**Contracted silence is not hidden silence, and the falsifier is two-sided.** The decision is that
the leg's end is the whole of the report, so a leg that ends and publishes no end falsifies A-ε
exactly as a per-candidate field does. `EV4` measures both directions.

**The middle course does not exist.** Delivering the candidate once it verifies is the
`settled, event` ordering this narrowing was found through, and it is worse than the loss: the
consumer has already been handed an answer the event was not in.

#### A wait belongs to one leg

The other half is which events a wait is over, and the record did not say. It was implemented as one
counter across both legs, which reads as a detail and is a decision: **the backlog's outcome then
waits on the forward leg**, and a live request's forward leg is by definition traffic that does not
stop. The bound is re-armed whenever anything clears — correctly, since what it bounds is a gate
that has stopped moving — so a backlog whose own relays had every one answered was held open by
events causally unrelated to it, indefinitely. Measured on the implementation this replaces: no
outcome 1.5s after the EOSE, and one the instant the forward feed was switched off. `AE13` is the
witness that survives, and it asserts the outcome is _prompt_ rather than merely eventual — a bound
that existed but was set by the forward leg would still be this defect. That is A-γ's finite
settlement gone — through the budget A-ζ owns rather than through A-γ's own timer — and `C11-C6` — a
live `refresh()` does not wait on the forward leg — false.

**It only reproduces with the forward leg already in flight**, which is worth recording because it
is why the shipped suite never saw it: a gate that is empty when the boundary is drawn resolves at
once whatever it is shared with, so the first attempt at this witness passed against the defect. A
live request that has been up for a moment is the ordinary case rather than the corner.

It cannot be repaired by bounding harder. A bound that cut the forward leg would be cutting a
working live subscription, which is the one thing that leg is for. So the boundary is per leg and
over what that leg was holding when it was drawn: the backlog waits for the candidates its own leg
was holding — admitted and not yet decided — at the moment an EOSE, a refusal, a terminal connection
state or A-γ's timer decided it, and the stream's end waits for the forward leg's. `AE14` states the
consequence as an equality rather than as a wait — the backlog answers the same thing however the
two legs interleave, the order where the forward leg has not finished at all included — because a
shorter wait and an independent one are not the same claim.

**The bound over that boundary is measured, and the measurement is per leg for the same reason the
boundary is.** What a draining gate waits under is the slowest verification _that leg_ has seen
times a safety factor, and for a round it was one value outside both gates, on the argument that it
measures the verifier and the verifier is one object. That confuses the identity of the _policy_
with the identity of the individual latencies: the same verifier costs different amounts on
different events, on a busy scheduler, and across a suspended tab. Every leg's departure wrote it
and both boundaries read it, so one leg's history set the other's deadline. `A-ε-C8` carries the
pair that measures it — the same backward event, the same EOSE and the same verifier, differing only
in whether one forward event had been verified first — because separating the phases and sharing the
estimate leaves the outcome exactly as coupled as before, and the row claims the backlog answers on
its own leg alone.

**The bound itself is A-ζ's and the independence it buys is this one's**, which is the division the
split below draws. What number a stopped gate is waited under — where it comes from, what clamps it,
and that no caller supplies it — is decided under A-ζ. That the backlog's answer is a function of
its own leg alone is decided here, and `A-ε-C8` is what measures it. The two met in one place while
one estimate served both gates, and that is exactly why the estimate had to move onto the gate.

**What that pair does not reach, recorded as residue rather than as coverage.** It runs one
direction: a forward verification's cost deciding the backward gate's cutoff, observed as a backlog
outcome that moves. The reverse — a backward verification's cost deciding the forward gate's, which
would be observable as a forward candidate discarded at the end rather than delivered — is closed by
the same single field, and no hostile pair was built for it. That it is closed is an inference from
where the field now lives rather than a measurement, and this record's own rule is that those are
different states. The enumeration underneath is no stronger and is worth stating at its real
strength: every read and write of the estimate was walked to conclude that nothing else a transition
reads crosses a gate, which is a claim about the sites found rather than a proof that there are no
others. Only the class actually found has a control arm against it; every other value has a
structural argument and nothing measured.

**Drawing the boundary closes the leg**, and that is the operational form of the narrowing above:
what the wire offers a leg after its wait has ended was never accepted, so it is not admitted at
all. `AE18` measures it over A-γ's timer, which is the boundary that leaves the subscription open
behind it.

**One order survives the split and is now stated rather than inherited**: the end of the stream
follows the backlog's outcome. Sharing a counter used to provide it by accident, since the marker's
wait was registered first. Separated, the forward gate can be empty while the backward one still
holds something — a live request whose relays all die with a backlog event mid-verification — and
the end would otherwise be announced ahead of the outcome it follows, which is the attempt finishing
with a leg end and no answer that `SM14`/`SM14b` exist for.

It is here because the alternative is not "slightly stale" but "wrong, and wrong in the direction
that matters". The dependency tells us things in an order that is not the order they happened in:
rx-nostr completes a backward subscription _before_ it routes the `CLOSED` that refused it or the
`EOSE` that finished it (measured). An outcome decided at the moment the completion arrives
therefore reports a backlog nobody refused and nobody answered — a clean, complete answer that is
about to become an incomplete one, handed to a `refresh()` that resolves on exactly that read.

The end of a stream is the same question asked about the other side, and it is three clauses:

| The clause                                     | Why it is not the obvious one                                                                                                                                                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| everything queued before the end is delivered  | the outcome can be decided a turn after the end is queued, so stopping at the end throws away the answer and leaves an attempt that finished with none                                                                                            |
| the producer is released as the end is decided | released when the consumer next asks instead, the subscriptions stay live across a window nobody is watching, and what arrives in it is delivered to a request that has stopped                                                                   |
| nothing arriving after that is delivered       | this is the second clause's consequence rather than a separate mechanism, and it is written down because the failure it names is not "an extra chunk": a signal that reaches the per-relay table after the end rewrites an answer already decided |

**The third clause has no independent falsifier, and that is stated rather than implied.** Once the
producer is released there is nothing left that could deliver a late signal, so what a test can
break is the release — twice over, once as a chunk that should not appear and once as an answer that
should not move.

#### Where an event may reach a consumer, exhaustively

The barrier above is only worth as much as the number of doors it stands in, so the doors are
counted here rather than left to a reader to find. **Two paths carry an event into
`ReqState.events`, and both go through the library's gate**: the forward leg's `use()` subscription
and the backward leg's. Nothing else does, and the list of things that do not is the part that has
to be maintained:

| Origin                              | Carries events? | Reaches a consumer                                                      |
| ----------------------------------- | --------------- | ----------------------------------------------------------------------- |
| `use()`, forward leg                | yes             | **yes, gated**                                                          |
| `use()`, backward leg               | yes             | **yes, gated**                                                          |
| `createAllMessageObservable()`      | yes, unverified | no — the machine reads `EOSE` and `CLOSED` off it and discards the rest |
| `createConnectionStateObservable()` | no              | no                                                                      |
| `createOutgoingMessageObservable()` | no              | no                                                                      |
| `createAllEventObservable()`        | yes, unverified | **not subscribed anywhere**                                             |
| `createAllErrorObservable()`        | no              | **not subscribed anywhere**                                             |

**The last two are the reason this is a table and not a sentence.** They exist on the dependency,
they would deliver events that no gate has seen, and today the only thing standing between them and
a consumer is that nobody has called them. A comment saying so would be a note about this month's
code; `AE10` reads the engine's source and fails if either name is **called** — a call, not a
mention, because a comment discussing one is not a subscription and `machine.ts` contains exactly
such a comment — so adding a subscription is a decision somebody makes on purpose rather than a hole
somebody opens by accident. (This sentence said "if either name appears" for several rounds. A port
building the check that sentence describes gets a red suite out of this record's own prose.)

Two further doors are open in principle and shut by packaging: `NostrContext` exposes the client,
and the handle `useStreamedReq` returns carries two members its own interface does not declare —
`raw`, the query library's object and under it the cache's `Map`, and `projected`, one read's state
and next expiry. Neither is reachable from the published entry — spike-v6 is absent from it entirely
— so they are recorded here as what would have to be closed when it is published, rather than
claimed as safe. `0004` says the same thing beside the interface, and `PO2` keeps the list at two.
**What the cache holds is no longer part of this**: since the ownership boundary, an entry holds
this library's own owned packets rather than the wire's objects (0003).

**What is not decided here is the mechanism.** Deferring a decision by a turn, and reading the
per-relay table where the outcome is handed over rather than where it was queued, are two ways this
implementation keeps the rule; both are about the dependency's ordering and neither is a property of
the design. A record that named them would have to be revised when the dependency changed its
ordering, which is precisely when the rule above should not move.

#### What the gate is handed, and what the cache keeps

**The event that passes the gate is the event that is stored, by identity.** The verifier used to be
handed the transport's object and the _same_ object was pushed onward afterwards, so an event
written to while verification was in flight made "what was verified" and "what was stored" two
different values. The window is small and the consequence is not: what a consumer renders would not
be what the signature was checked against.

So the boundary takes **this library's own copy first** — field by field, tags included, frozen,
which `OW2` reads at run time — and everything after that point holds it: the verifier, the fold,
the cache, and `ReqState.events`. Two properties come out of one move:

- the verifier's subject and the cached entry are the same object, so there is no interval in which
  they can differ (`A-ε-C15`);
- a consumer cannot write into the cache through what a hook handed them, which is 0003's invariant
  and 0004's published type (`B5-C6`).

**The dependency's own event is not frozen** — `CF11b` reads that on the refusal path, where
freezing somebody else's object was the defect — and that is deliberate: freezing it would reach
into data rx-nostr and any other subscriber own. The copy is what makes the promise cost them
nothing.

**What is copied is written down** rather than left to `structuredClone`: the seven fields NIP-01
gives an event, plus `ots` when the wire carried one — deprecated in `nostr-typedef`, still sent,
and a field a consumer can render, so dropping it would silently change what they see. `OW5` is the
arm that pins the list.

### A-ζ: the budget a drain runs under

**Two waits run in series, and only the first was written down.** A-γ decides when a _backlog_ gives
up: finite, per request, overridable, capped, and held above rx-nostr's own EOSE timer. It decides
nothing about what happens after that boundary is drawn, and something has to — the leg's gate may
still be holding candidates at that instant, and the outcome waits for them (A-ε). That second
budget was contracted under A-γ for a round, and it is not derivable from it. Read literally, A-γ's
own falsifier is the drain cutoff's job description: a timer the caller did not set, closing the
backlog first.

**In series rather than nested, which is the fact that keeps them apart.** A gate is open until its
boundary is drawn and admits nothing after it, so the drain budget starts where the settle budget
stops and never runs beside it. Nor can the settle timer reach past that point to bound anything: on
the backward leg it has either fired — drawing the boundary itself — or something else drew the
boundary and the settle marker's idempotence makes a later firing a no-op; on the forward leg the
end clears it; and a request given no settle timeout at all never armed one. **Nothing downstream
bounds a draining gate.** That is why it needs a budget of its own rather than a share of somebody
else's, and it is the correction to this record's own "the request's settle timer has already fired
by the time a gate is draining" — true where that timer drew the boundary, false where anything else
did, and the conclusion drawn from it holds either way.

**Widening A-γ was the alternative and it is refused for the reason the cause split was taken.**
`timeout` and `verification-timeout` are two words because the owner and the recovery differ.
Folding the two budgets back onto one line would leave two owners inside one decision while the
causes they produce stayed apart — the same confusion one layer up and harder to see, since a
decision's text is not a thing a consumer branches on.

#### What A-ζ decides

1. **The budget belongs to the gate**, so there is one per leg. That is ownership rather than
   outcome: that a backlog's answer does not move with the other leg's history is A-ε's claim and
   `A-ε-C8` measures it, and A-ζ is why there are two numbers for it to be true of.
2. **It is a no-progress deadline and not a total.** Every candidate that clears re-arms it, so how
   many events a gate holds does not enter it. What is bounded is a gate that has stopped.
   **"Clears" is leaving the gate, whether the candidate passes, fails, or rejects** — a verifier
   answering `false` and a verifier rejecting shrink what the gate holds exactly as a pass does, so
   all three are progress: the deadline is re-armed if anything is still held, and the gate resolves
   drained if nothing is. A port that treated only a pass as progress would hold one deadline over
   an unbounded number of failing candidates, which is the arming interval this decision promises,
   gone.
3. **Before that leg has verified anything the deadline is the floor.** There is no sample to
   extrapolate from — the slowest verification it has seen is zero — so the floor is not a minimum
   under something larger here. It is the whole of the deadline.
4. **After it has, the deadline is
   `max(floor, ceil(min(that leg's slowest verification, floor) × safety))`.** The clamp is on the
   sample rather than on the product, which is what makes the interval below arithmetic instead of a
   second constant needing its own derivation.
5. **Each arming falls inside `[floor, floor × safety]`, and a whole drain is bounded by no constant
   here — while still being finite.** A gate whose boundary is drawn admits nothing further, so what
   it holds only shrinks and the drain ends after at most one deadline per candidate it was already
   holding. That count is the relay's rather than this record's — an ordinary `limit` is in the
   hundreds — so the product is not something to promise, and what is promised is the interval one
   arming falls in.
6. **No caller sets any of it, and it publishes nothing of its own** — neither the floor nor the
   safety factor is a field the option bag carries, which `WR34` derives from the type rather than
   from this sentence. The floor and the safety factor are the engine's: `settleTimeoutMs` does not
   move them and no other option does either. What a cut is _observed_ as is A-ε's —
   `verification-timeout` on the backward leg, the leg's own end on the forward one — so raising a
   settle timeout is not the recovery for a cut gate.
7. **The budget exists only between a boundary and that gate's answer.** Before the boundary the
   gate is open and what it holds is bounded by whatever ends the leg; once the gate has answered
   there is nothing left to bound. Without this clause a reader cannot tell whether the two budgets
   overlap, and that they do not is the whole of the argument for a second decision.

#### What the floor costs, and on whose evidence

**The floor is a hard cutoff before anything has been measured, and this record claimed the
opposite.** The sentence was that the clamp costs a working verifier nothing, "since a per-event
cost below four seconds is still waited out in full". The formula says otherwise. With the deadline
at `max(floor, ceil(min(slowest, floor) × safety))`, a leg whose slowest sample is at or below a
quarter of the floor waits under the floor itself — and a leg that has verified nothing has a sample
of zero. A first verification slower than the floor is therefore cut although it would have
returned, which is the arm `AE14` drives on purpose with a candidate held past that deadline.

Three claims, each true on its own, replace it:

- **Extrapolating from a sample clamps that sample at the floor**, and that is the part which costs
  a working verifier nothing: the clamp binds only above the floor, and where it binds the deadline
  is the top of the interval.
- **Where a leg has no sample yet, the floor _is_ the deadline.** It is a hard cutoff rather than an
  allowance, and it is the only thing between a slow first verification and a discarded candidate.
- **The floor is a policy judgement about the verifier this library ships**, not a construction
  proving that an arbitrary `Promise` returns inside it. Nothing here makes a verification fast;
  what the number rests on is a measurement of one verifier.

**The support envelope.** The provider defaults the gate to `rx-nostr-crypto`'s verifier — **3.1.3
resolved, which is the version every figure below was taken against**, and a measurement of a
dependency without the version it was taken against is not one. Its p95 is 1.275-1.467ms across
every run this record carries — the measured ends, unrounded, because rounding them outward gives a
ratio below that does not divide from the numbers beside it. **That range is wider than the
"1.3-1.4ms" written here before**, which ten of eighteen fresh runs fell outside — eight under it
and two over. A figure quoted narrower than the runs behind it is a figure somebody will fail to
reproduce and report as drift. **The method is stated here rather than only the figure**, which it
was not for several rounds: generate a key, sign a thousand events with it, run a hundred warm-up
verifications untimed to get past the cold path, then time **all thousand** end to end through the
same `verifier` export the provider installs — not the schnorr primitive underneath it, which leaves
out the hashing and the serialisation the gate also pays for — check that each one comes back `true`
so a verifier rejecting its own signatures is not timed on its fast path, sort, and take the 95th
percentile. **The warm-up is untimed rather than taken out of the sample**, and this paragraph said
otherwise — "then time each remaining event" — which a port reading it at the two hundred below
would implement as a hundred timed samples instead of two hundred. `tools/verifier-p95.mjs` —
branch-local, like every program under `tools/` — times every event it signed and prints that whole
number as the sample count.

Four runs on an Apple M1 Max under node 26 gave p95s between 1.29ms and 1.45ms, and four more after
the script moved gave 1.29, 1.30, 1.34 and 1.37. Fourteen more on that machine under node 26.3.1,
**at load averages between 2.3 and 3.3 rather than idle**, gave 1.275 to 1.388. Eighteen more on the
same machine and node, at one-minute load averages between 4.0 and 5.5, gave 1.282 to 1.467, in two
batches: ten inside 1.282 to 1.316, and eight spread over 1.288 to 1.467. **This paragraph used to
read that off as "the bottom of the range moves and the top holds", and forty runs do not support a
sentence about either end.** They support one about the envelope: across forty runs none has come in
below 1.275 or above 1.467, and two batches taken minutes apart on the same machine put their tops
0.15ms apart. Nothing recorded here separates that from what else the machine was doing, so quote
the envelope rather than an end — and quote it wide enough that an ordinary run does not read as
drift. A run's `max` wanders further than its p95 — one of the fourteen recorded 2.408ms, one of the
eighteen 6.214ms — and that is the machine rather than the method; the floor's ratio is taken
against the quantile, not the worst sample.

**The sample count is part of the method, and not for the reason this used to give.** It said the
same script at two hundred samples reports 1.285, "outside the range by less than the spread between
runs, so a figure quoted without the sample count is not comparable with this one" — which is an
argument that the two _are_ comparable, since agreeing inside each other's noise is what comparable
means. The reason that holds is the estimator: the p95 is the ⌈0.95n⌉-th of n sorted samples, so at
two hundred it is the 190th with ten samples above it and at a thousand the 950th with fifty, and
one slow verification moves the smaller sample's answer further. Measured rather than argued, ten
interleaved pairs — one run at each size per pair, so the two share whatever load the machine is
under instead of being compared across batches — put two hundred between 1.278 and 1.319 and a
thousand between 1.275 and 1.299: the same figure, over 0.041ms of spread against 0.024ms. So quote
`n` because a quantile without it cannot be reproduced, not because two hundred reports something
else. A single figure was what this paragraph used to carry, and a "Reconsider when" resting on a
number nobody can re-derive is not a condition anybody can check.

The floor is 1000ms, which is 681 to 785 times that — the two ends of the envelope above, divided,
with the low end rounded **down** and the high end **up** so that the interval contains every
quotient rather than excluding both of its own endpoints, which "682 to 784" did. It is written as a
range because it is one: "some seven hundred times", which this used to say, is a single number
standing in for 714 to 769, and those were the ends of a p95 range already quoted narrower than its
own runs. The ratio is what the choice rests on — a gate still holding after it is evidence of one
that will never drain rather than a threshold somebody tunes, and nothing in that argument needs the
ratio to two significant figures. The verifier is replaceable all the same. The provider takes one
and the engine requires one, so a slower verifier is a value somebody can supply rather than a case
the types exclude — internal today only because nothing of this engine is on the published entry at
all. The envelope is therefore the shipped verifier on ordinary hardware, and a consumer outside it
is outside a policy rather than outside a proof.

`tools/verifier-p95.mjs` is that method as a script, and **where it lives is part of the claim.** It
sat under `src/tests/stores/spike-v6/` for several rounds, which made the paragraph above
self-refuting in the way `0003` names thirty lines into its own corpus section — _a figure whose
only definition is a script that ships on a branch nobody keeps is not re-runnable, it is
remembered_. The spike does not outlive the decision; `tools/` does, and the script imports nothing
but `node:crypto` and `rx-nostr-crypto`, which is a dependency of the published library rather than
a spike fixture. So the trigger below stays runnable on the branch that ships, and stays
re-derivable from the method above if the script does not travel with it.

**Reconsider when** either end of that is observed to move: a p95 for the shipped verifier on a
low-end device within an order of magnitude of the floor — run the script above on that device,
which is what makes this trigger checkable rather than rhetorical — or a main-thread stall long
enough to put a working verification past it. **Said that way it is true on any ordinary day**,
which an adversarial pass pointed out: a suspended tab, a stopped debugger and a long task are
exactly what the clamp below exists to absorb, so "a stall happened" is the design working. What
reopens this is a stall the clamp does _not_ absorb — a verification that answers and is discarded
anyway, because the wait it belonged to was cut — which is an observation of this library's
behaviour rather than of the machine's, and is the shape the sibling trigger already has. The sample
is wall time across a `Promise` rather than work, so a stall counts in full — against the deadline
it is measured under, and against the sample the next deadline is built from. Publishing the
verifier override is the third trigger, because it turns one measured verifier into an open set.

#### The three waits, side by side

Nothing is added by this table: all three already exist. What it separates is owner, whether a
caller can set it, and what each is observed as — the three columns that decide which decision a
contract belongs under. The row that measures the third wait sat under A-γ for a round under an id
that family has since reissued, and is `A-ζ-C1` now; the first and third rows below differ in every
one of those columns.

| The wait                 | Owner                                               | A caller sets it                                                                                 | Bound                                                                                | Published as                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| settle timeout           | the request (A-γ)                                   | yes, per request — and a value above the cap is refused rather than clamped                      | a normalized integer, defaulted when absent, capped below the dependency's own timer | `timeout` — but as one of the two independent predicates that add that word, not as its mechanism: this timer having drawn the boundary is the first. The second is a target still undetermined when the outcome is derived, which belongs to no wait in this table and holds without this timer, so neither predicate implies the other and the word does not say how far a relay got (`AE21`) |
| rx-nostr's `eoseTimeout` | the provider, on the dependency (A-γ's second half) | no — not a prop, and the provider writes its own value after whatever configuration it is handed | ten times the settle cap, so the request's own timer is always the one that fires    | nothing of its own, and it is not expected to fire first at all: if it did, the backlog would complete with no EOSE and no CLOSED, which `SEN14` measured at 3.7.5 and `A-γ-C4` holds the provider to                                                                                                                                                                                           |
| verification drain       | the gate, so the leg (A-ζ)                          | no                                                                                               | `[floor, floor × safety]` per arming, re-armed on every candidate that clears        | backward, `verification-timeout`; forward, the leg's end and nothing finer                                                                                                                                                                                                                                                                                                                      |

### Consequences

- Good: a request that nothing can reach stops saying otherwise, and there is a finite way out of
  every stopped state a refresh can reach. Two per-relay states are terminal on purpose and this
  bullet used to imply otherwise: A5's table decides that `rejected` is left alone, because
  reconnecting on every refresh turns a user gesture into a retry loop against a host that said no,
  and that `terminated` fails the attempt, because the client is disposed and no later attempt can
  succeed, while `dormant` is asked — the socket is asleep, not gone. `approachFor` is where all
  four are, and only `error` is reconnected.
- **And "finite" is the settle timeout plus the drain, not the settle timeout.** A caller who sets
  `settleTimeoutMs` and reads the cap will take it for the longest a request can take, and it is
  not: the verification drain re-arms per candidate that clears, so the number of arms is a relay's
  `limit` rather than anything here, and each may be up to the clamp. `A-ζ`'s clause 5 says so from
  the other side and this bullet did not; an adversarial pass read the two together. What is bounded
  is that every wait ends, not that the request ends inside the timeout a caller chose.
- Good: an outcome a consumer is handed cannot be overtaken by something that had already happened
  when it was decided.
- Bad: **the published cause union has a fourth member for a case a hung verifier reaches, and a
  slow one can reach too.** The backward leg's wait is bounded — a floor of one second, or the
  slowest verification that leg has seen times a safety factor, re-armed whenever an event clears —
  and if candidates are still being verified when it expires they are discarded and the attempt ends
  incomplete. That is `verification-timeout`, and every consumer that switches on a cause now has a
  branch for it. **"Pathological" stood here and is withdrawn**: A-ζ's floor is the deadline
  outright for a leg that has verified nothing, so a first verification slower than a second is cut
  whether or not anything is wrong with it. What makes that acceptable is a policy about the shipped
  verifier rather than a case nobody can reach. **The alternative was worse, and this bullet is the
  record of the round it was taken.** For a round the two arrived under one word —
  `if (viaTimer || gates.backward.phase === 'cut')` — so "nothing came back" and "what came back
  could not be checked in time" were both `'timeout'`. The argument for keeping them folded was that
  the union should not grow for a rare case, which is the growth `B-η` and the drain's own design
  both declined. What that argument missed is that `IncompleteCause` is not an internal enum:
  consumers branch on it for retry copy, for failure classification and for telemetry, and the two
  failures point somewhere different — at the relays and the network for one, at the verifier or the
  device for the other. **They are not opposite classes, and this bullet used to imply they were.**
  Both can hold of one relay (`A-ε-C14`), so what folding them cost is not a misclassification but
  the whole reading: a consumer that gets both has two things to act on, and under one word it could
  see neither. Folded, it also put the caller's own `settleTimeoutMs` and an internal cutoff the
  caller cannot set under one name. **Rarity is an argument about how often a branch is taken, not
  about whether a consumer can write it**, and the compatibility cost of fixing the word later is
  only zero before this record is accepted. The fold's own history is worth keeping: it was decided
  in `machine.ts` and pinned by the ledger for a round while the code comment claimed it was
  "recorded as residue" and no residue list carried it — a compromise written only in a comment is
  not written down, which is this record's own rule, applied late to itself. It then survived a
  second round in this bullet, where it _was_ written down and still contradicted the per-relay
  table above and the published type's own comment. **Recording a compromise is not the same as it
  being right**, and a record that disagrees with its own detail section is the defect either way.
- Bad: **the verifier is one object and the cost of using it is now measured twice**, once per leg.
  A backlog whose forward leg has already learned that verifications here take 300ms still starts
  from the floor, so the two legs can be draining under different deadlines for the same verifier at
  the same moment, and a leg pays for its own first slow verification however much the other one
  knows. This is A-ε's price and A-ζ's shape rather than an oversight — the independence is what A-ε
  asks for, and the number living on the gate is how A-ζ pays for it. The estimate is an input to a
  deadline that decides an observable outcome, so a value both legs write is a value by which one
  leg's history moves the other's answer — measured on the implementation this replaces, where the
  same backward event, EOSE and verifier answered `incomplete` with the event dropped when nothing
  had run before them and `complete` with it delivered when one forward event had been verified
  first. Sharing buys nothing a per-leg estimate does not: what an estimate is for is the next wait
  on the leg it came from.
- Good: **every drain deadline falls inside an interval this record can name** —
  `[floor, floor × safety]`, which is 1000ms to 4000ms as those are set — **the floor is 1 000 ms
  and the safety factor is 4**, named here because the product was the only thing these records gave
  and a port cannot split it — and it does so by construction rather than by a second constant with
  its own derivation. **The ceiling is a clamp on the _sample_ before the multiplication rather than
  a cap on the product**, so the bound reads as one sentence: believe a per-event cost up to the
  floor, and wait the safety factor times what you believe. It is needed because the sample is
  `Date.now()` elapsed across a `Promise`, which is wall time and not work — a suspended tab, a
  stopped debugger or a verifier that hangs and then answers writes minutes into it, and four times
  a minute was the next wait, with nothing downstream to bound it: by the time a gate is draining,
  the request's settle timer can no longer end anything — it either fired and drew this boundary, or
  a boundary something else drew makes its later firing a no-op, or the leg's end cleared it, or
  none was ever armed. Clamping the product instead would leave the pathological number in the
  estimate and need its own justification for the cap; clamping the sample makes the upper end
  arithmetic. The floor is the right ceiling for a sample because of what the floor already is — the
  point past which a gate not moving is evidence that it never will — and **the clamp** costs no
  working verifier anything, since it binds only above the floor and the deadline it then produces
  is the top of the interval. **What the _floor_ costs is a different question and the answer is not
  "nothing"**, which this bullet used to say by running the two together: a leg whose slowest sample
  is at or below a quarter of the floor waits under the floor itself, and an unmeasured leg's sample
  is zero, so a first verification slower than the floor is cut although it would have returned. A-ζ
  carries that and says on whose evidence it is acceptable.
- Good: the two legs are distinguishable, so "the backlog is done" and "the subscription is alive"
  are separate facts.
- Bad: a dependency on an API named experimental, reachable through one module. A11 is the
  mitigation and it is exercised rather than asserted — the same expectations run against an
  accumulator that does not name the helper at all. **The mitigation is worth only as much as the
  list of things that differ across it is short, and nothing a consumer can observe is on it**: both
  implementations share the client, the query identity, the observer lifecycle, staleness, GC and
  refresh coalescing, so anything a consumer of `ReqHandle` can tell apart is a defect in one of the
  two rather than a documented cost. **The list is not empty, which this said for a round.** Driving
  the seam directly measured two differences on the far side of it — the shape of the context each
  adapter hands to `streamFn`, and one adapter making a call into query state the other does not —
  and [0005](0005-contract-catalogue.md) records both as measurements rather than as rows, precisely
  because neither is reachable from `ReqHandle` today. One of them stops being unobservable under an
  infinite query, which is the reason they are written down at all. The parity harness keeps
  `onlyOn` for a divergence to be written in honestly and nothing uses it. What the escape route
  does _not_ cover is leaving the query library, which would need a second cache implementation and
  is a different record. The seam is internal, and stays internal only if nothing is published that
  names it: accumulator replaceability and a low-level API for consumers are separate questions,
  publishing the second is not how the first is demonstrated, and publishing an accumulator- or
  helper-specific type would withdraw the first outright. See 0004 C8.
- Bad: no retry means a rate-limited request stays stopped until asked again.

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

**Every claim in this record about what a dependency does is a measurement at a version, and these
are the versions**: rx-nostr 3.7.5, `rx-nostr-crypto` 3.1.3, `tanstack-svelte-query-v6` 6.1.38, and
the `@tanstack/query-core` 5.101.4 that resolves underneath that one rather than the 5.90.2 at the
top level — and the top-level copy is on the list because this record reads the two query libraries'
context keys against each other, which is a claim about that copy and not only about the aliased
one. `SEN10` asserts all five against the installed tree, so a bump fails a test rather than being
inherited quietly. Some claims carry their version inline, where the figure beside it is doing work;
the rest are dated by this one.

**Two of the five were added because this paragraph said they were missing.** `rx-nostr-crypto` and
the top-level `@tanstack/svelte-query` were prose here and in nothing that runs, which made the p95
and the string-key reading the two figures in this record a bump could carry forward silently.
Recording that as residue was the right first move and the wrong last one: **a version claim with no
assertion behind it is the state this record's own rule forbids**, so it was pinned rather than left
listed.

## More Information

### A7b's history, and when to reconsider it

**Historical evidence.** Relay implementations were observed treating `limit: 0` on a live
subscription differently from each other. The observation is dated and cannot be re-derived from
anything citable here: it is a fact about deployed software rather than about this library, its
dependency, or the protocol.

**Reconsider when** the observation this decision was made from is reproduced against a relay
somebody names — the trigger is an observation, not an inventory. **And the instrument for taking
one is in the tree, which this paragraph did not say**: `tools/measure-limit-zero.mjs` opens one
connection per relay, subscribes twice — once with `limit: 0` and once without — and judges by
comparing the two subscriptions' live counts rather than by counting events after EOSE, because a
relay that never EOSEs the subscription under test makes that count an artefact of the instrument. A
run of it against a named relay **is** the second sighting this paragraph asks for. It is
branch-local like every program under `tools/`, so what survives is this description of the method;
and nothing in the suite runs it, which is why the sentence above says the dated observation cannot
be re-derived from anything citable here — that is true of the _historical_ one and not of a new
one. "All relay implementations agree" is not a condition anyone can check, because the set is open;
the version of this sentence that scoped it to "a supported-relay matrix this project defines and
keeps" replaced one uncheckable condition with another, because no such matrix exists here, none is
planned, and the record never defines what would be in it. An adversarial pass named that, and the
honest form is that this decision is unconditional in practice: the behaviour it declines to rely on
was seen once, is recorded as history rather than as a falsifier, and a second sighting is what
would move it.

A15 chooses a direct dependency over a peer dependency for one reason: a peer turns an internal
detail into a constraint the consumer must satisfy, and once a consumer has to satisfy it, every
version of it this library moves through is a version they have to move through too. **This is not
A11.** A11 records one seam — the accumulation — inside the query library, not a route out of it;
what a peer dependency forecloses is changing the query library at all, which no record here
promises and which a direct dependency leaves as an ordinary internal change. Version range and
update policy are a separate concern, not settled by this.

**Owning the client and using it are two things, and only the first was built.** The provider
constructed a client with `LIBRARY_QUERY_DEFAULTS` on it and installed it nowhere: the engine read
`useQueryClient()`, so every request ran under whatever was in the query library's own Svelte
context, and the defaults this decision exists to apply reached nothing. The engine takes the client
as an option now, the way it takes the clock, the attempt registry and the relay scope — each of
which the **provider** owns and none of which is reached for behind the caller's back. **In v1 that
is the only shape** (`A16`): a request is served by the provider's runtime, and there is no
caller-owned standalone arm for these inputs to arrive through. The spike has one, and what it does
is recorded on `A16` as a measurement of this branch rather than as a rule a port implements. Not
installed into the query library's context, which was the other candidate.

**The premise that ruled that candidate out was false of one of the two copies this project
resolves.** It said that context is one `Symbol` under a peer dependency, so a provider that set it
would take over a consumer's own queries written inside the provider's subtree — and that the
collision therefore needed a peer to happen. Read from the resolved sources, two lines:

- `tanstack-svelte-query-v6@6.1.38`, `dist/context.js:2` —
  `const _contextKey = Symbol('QueryClient');`
- `@tanstack/svelte-query@5.90.2`, `dist/context.js:3` — `const _contextKey = '$$_queryClient';`

The engine resolves the first; the stores this package publishes today resolve the second. A
`Symbol` is module-local, so **two** instances of the v6 adapter hold two distinct keys; a string is
not, so two copies of the 5.x adapter agree on `'$$_queryClient'` however they got there.

**This record has now been wrong twice about npm, so it stops asserting a rule about npm.** It first
said the takeover "takes a peer dependency, which collapses them to one instance, to make the
takeover possible at all". The correction said instead that **what decides how many copies exist is
range compatibility, not peer-ness**, on the ground that "the installer hoists a single copy
whenever the declared ranges overlap". Both of that version's citations are mischaracterised, and a
counterexample to it sits in the same tree:

- `mock-socket` was offered as compatible ranges yielding one copy. It is a direct `devDependency`
  of this package (`^9.3.1`) as well as an ordinary dependency of `vitest-websocket-mock`
  (`^9.2.1`), and npm places a root declaration at the root whatever else is in the tree.
  `npm ls mock-socket --all` reports the transitive one `deduped` against it, which is deduplication
  against a mandatory placement rather than a hoist that range arithmetic chose.
- `yaml` falsifies the stated rule outright. It has exactly one ordinary declaration in the
  installed tree — `postcss-load-config@3.1.4` → `^1.10.2`, the other two are `devDependencies` of
  installed packages and are therefore not installed — so the ranges are trivially compatible, and
  it is **not** hoisted: the only copy is at `node_modules/postcss-load-config/node_modules/yaml`,
  with the root slot empty. What sits beside it is an **optional peer**: `vite@8.2.0` declares
  `yaml@^2.4.2` under `peerDependenciesMeta.yaml.optional`. Measured as an A/B under npm 11.16.0,
  two throwaway projects differing in one line — one depending on `postcss-load-config@3.1.4` alone,
  the other on that plus `vite@8.2.0` — went from one hoisted `yaml@1.10.3` to **two** copies,
  `yaml@2.9.0` at the root and `yaml@1.10.3` nested. The only relation the added package has to
  `yaml` is that optional peer range.

So peer-ness is not what collapses copies, and range compatibility is not what decides how many
there are. **What npm does in general is not something this record settles, and it should not have
tried** — twice the paragraph reached for a rule when the decision needed a fact.

The fact it needs is narrower and this repository supplies it. **Under at least one arrangement this
repository actually contains, two consumers resolve to one copy of a package**: `mock-socket`,
declared by the root and by `vitest-websocket-mock`, with a single `node_modules/mock-socket` that
both load and no nested copy anywhere. A context key is module-scope state of the copy that declares
it — that is what the two `context.js` lines above are — so wherever two consumers share one copy of
an adapter they hold one key, and the `Symbol` is not a protection anyone can rely on: one copy is
one key, and the takeover is available with no peer arrangement. Under the string copy it is
available whatever the copy count. The counter-shape is also here and is uncontested:
`@tanstack/query-core` is pinned to `5.90.2` by `@tanstack/svelte-query@5.90.2` and to `5.101.4` by
`tanstack-svelte-query-v6@6.1.38`, the pins do not overlap, and there are two copies on disk —
`node_modules/@tanstack/query-core` at `5.90.2` and
`node_modules/tanstack-svelte-query-v6/node_modules/@tanstack/query-core` at `5.101.4`.

**The decision is unchanged and better supported than by any version of this paragraph**: the engine
takes the client as an option and sets no context, which is correct whichever way an installer
resolves — which is exactly why this record has no business predicting how it will.

**`OWN-2` measures something narrower than it was cited for**, and it is the citation that is
corrected here. It sets the context to one client, reads it back, sets a second and reads that back
— all inside one module copy. That is last-write-wins within a copy, which holds for a string key
and a `Symbol` alike; a test importing one alias never loads two copies, so it cannot see whether a
key is shared across them. The cross-copy fact is the reading above and nothing else.

**`OWN-1`'s method and its result**, written down because the file holding it does not outlive this
branch: mount `createQuery` and hand it a client through its second argument — the explicit-client
parameter — while a _different_ client sits in the query library's Svelte context, let the query
resolve, then ask both clients for the same key. The explicit one holds what the query function
returned; the context one answers `undefined`, having never seen the query. So passing the client in
works whatever the context key is, which is what makes "take it as an option" a choice rather than
the only thing left.
