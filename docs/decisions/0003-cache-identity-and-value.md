---
status: accepted
date: 2026-10-02
decision-makers: akiomik
consulted:
  redesign review rounds 1-30, the r7 review of rounds 31-32, and the external reviews of r33 and
  r34
informed: nosvelte users
---

# What identifies a request, and what is stored for it

## Context and Problem Statement

The cache key is currently a `queryKey` the caller writes. Two consumers that write the same key
share an entry whatever they asked for, so a list keyed `['timeline']` with one set of filters is
served to a component asking with another. This paragraph used to add that the shape is live in a
dependent project today — a fixed key with a filter that varies by route — and that reading is
withdrawn along with the survey it belongs to (0001). Nothing is lost by withdrawing it: the shape
is reachable from this repository alone, because the shipped engine reaches it — `useReq()` hands
the caller's `queryKey` to the query client untouched, so two hooks that write the same key share an
entry whatever their filters are. The paragraph below records that. Whether anyone outside this
repository is standing in it is **not known to us**.

What is stored is a flat array deduplicated by event id. Nostr does not work that way: replaceable
events supersede earlier ones, addressable events are identified by a coordinate rather than an id,
and ephemeral events are defined as not-for-storage. An array of ids keeps all three.

## Decision Drivers

- **Splitting a cache is safe; merging one is not.** A duplicated request costs a round trip. A
  merged one hands a consumer another consumer's data.
- **What is stored has to match how Nostr identifies events**, or the library shows superseded
  content and grows without bound.
- **A property proved of a function is not proved of the library** unless the library calls it.

## Considered Options

- **Keep caller-supplied keys**, documented more carefully.
- **Derive the key from the descriptor**, with an optional caller-supplied namespace that can only
  split.
- **Derive the key, and allow an explicit override** for callers who want to merge deliberately.

## Decision Outcome

Chosen: **derive the key**, with a namespace that partitions and no override, because an override is
exactly the operation that is unsafe, and the reason to want one — the same filters against
different relays — is answered by the relay scope being part of the identity.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Falsified if                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1  | Two descriptors the boundary **accepts** that are not equivalent never share a key. A refused one has no canonical form and is keyed by **`['nosvelte', 'refused', namespace, scope identity, rejection message]`** — the message alone was measured to merge two consumers in different namespaces asking different questions — so two that fail the same way _in one namespace and one relay scope_ do share an entry: one that holds an error and never a value. The message on that key is the **rendered** one, bounded (4 096 UTF-16 code units for the whole message, 200 characters for any value rendered inside it), because it is a value this library stores rather than a string it prints. **That is the mechanism on the path where a caller's value reaches the message**; the other two refusals — an unreadable field, and an owner input that is missing — build the key from names this library chose, and are bounded by that rather than by the renderer. A port adding a refusal whose message quotes caller input owes it the renderer, which is where the bound lives                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | any generated pair of accepted descriptors collides, or a refused descriptor's entry is given a value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| B2  | The key is derived from the descriptor; `namespace` may only split it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | a caller can make two different requests share an entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| B3  | The relay set a request is **actually asked over** is part of the identity, and its identity is a **deterministic function of that set** — the sorted, deduplicated readable URLs, injective on the set and on nothing wider. That set is `descriptor.relays ?? provider.defaultReadableRelays`, so a request that names its own targets is keyed by **those**, and the provider's generation counter is **not** in the key                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | data fetched under one relay set is served under another, or a relay added or removed **outside** an explicit request's targets re-keys it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| B-γ | A request with nowhere to ask is not asked, and reports so — **as `loading` with `activity: 'idle'`**, which is the same "not asked" report the server render gives (0002 A12): the primary state says nothing is known and the activity axis says nobody is doing anything about it. It is deliberately **not** `settled` and empty, which would be "nothing found"; it is deliberately not a sixth `ReqState` member either, and the cost of that is in 0004 beside the slot table — a component-layer consumer renders the `loading` snippet for as long as the relay list is empty, because slots are a function of `state` alone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | it reports an empty answer when the relay list is empty **and the filters could have matched something**, or when every relay is write-only. A request whose filters can match nothing is the other cell and is not this one: it answers `settled` and empty without asking, because the answer is known — putting the relay count first is what made such a request say "not asked yet" for ever, measured. The clause used to be written without that qualification, so a port implementing it re-shipped the never-settling request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| B4  | Input that cannot be honoured is rejected, not ignored, over a stated subset of NIP-01                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | a filter the relays read one way and the library reads another is accepted, or a value is silently defaulted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| B5  | The stored value is a set keyed by each event's replacement identity — `kind:pubkey:d`, which is one-to-one **only because a pubkey that is not 32 hex bytes cannot carry a valid signature**, so the verifier is what upholds it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | a superseded replaceable event is still shown                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| B6  | The set can be bounded: the newest `retain` entries, newest first, under the ordering the views use. **The bound reads no clock, so the result is a function of the events and not of their arrival order** — unconditionally, at any instant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | bounding changes the answer depending on arrival order                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| B8  | A request that can only match nothing is answered without reaching the wire                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | such a request sends a REQ, or is widened on the way out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| B7a | A descriptor whose `kinds` **names** an ephemeral kind is refused, and so is a **live** descriptor with no `kinds`; a non-live descriptor with no `kinds` is accepted, and an ephemeral event that arrives on its backlog is not retained and raises the `ephemeral-event-omitted` cause; deletions are not interpreted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | a request matches an event this surface can never show **and says nothing about it**, or a non-live by-id request is refused for a kind it did not name, or a `kind: 5` arrival removes an event the set was already holding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| B7b | **No arrival is rejected for having expired, no deadline passing evicts anything, and expiry decides nothing about which entry keeps a slot.** The library reads NIP-40 in one place and applies it in one — the projection; the dependency's own arrival check is turned off **on the client this library builds**, which is the only client v1 has (`A16`). A port that also accepts a caller's client owes the same configuration on it: at the resolved version the dependency defaults that check _on_, reads the tag with `Number` against the system clock rather than this library's, and drops the event at arrival — two rules for one tag, which is this row's own falsifier, on a path v1 does not publish                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | the fold or the bound consults a clock, the tag is read by two different rules, or an event is dropped on the way in or removed by a deadline passing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| B9  | The settle timeout is part of the identity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | two descriptors that settle differently share an entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| B10 | Termination, refusals and a failed attempt are on the value — one record per leg and one for the failure; completeness is derived from the backward record alone, which a new attempt replaces whole, and whose end is a **cause set**; the failure record is **kept when an attempt begins and cleared when a _later_ attempt ends**, the ending attempt's own failure being kept because a failure is the last thing an attempt writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | a value says it settled while its backlog is still running, a live-leg refusal makes a finished backlog incomplete, a refresh withdraws an answer it has not yet replaced, a backlog missing two things reports one, or a failure is cleared by an attempt _starting_, survives a _later_ attempt that ended, is dropped by the ending attempt that threw it, or is reported for an attempt other than the one that threw                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| B-η | Two refusals are the same when one relay says the same **thing** on one leg of **one attempt** — the notice, not the fact it spoke. The list is bounded per attempt, per relay, per leg and **per classification**; within an attempt it holds the earliest wordings and drops later ones rather than evicting, so a list already published never comes back shorter or reordered while the attempt that produced it is still the one on show. **A classification the leg is not already holding is never dropped**, whatever came before it. **Across attempts the list is withdrawn rather than extended**, at three moments and not two: a new attempt's _start_ replaces both the forward record and the still-running backward one, and a new attempt's _end_ replaces the backlog record. Refusals move with the record whose answer they explain and never before it — which is what keeps C12 true, since a refusal that outlived its attempt pinned a request to `error` for the life of the entry, and is why the list is bounded at all rather than a transcript that grows with every retry. **The flat list the diagnostics publish is a concatenation of those records and not a set**: one relay saying one thing under two attempts is two entries, and no published field tells them apart, because the record a refusal explains is itself not published. **And the record that has ended carries a second bucket, `late`, which this row did not name for as long as the bucket has existed.** A refusal from the attempt the value is on that arrives _after_ that attempt's backlog ended goes there: the backward subscription is closed by the end and the message channel is not, so a relay that EOSEs and then says `restricted:` on a live request is answering the attempt still on show. **Who writes it** — `addRefusal`, on the backward branch, once no _running_ attempt carries that id and the ended `BacklogRecord`'s does; a refusal naming any other attempt is still dropped, on both legs. **What it is keyed on** — nothing of its own: admission is the same per-relay, per-classification test as the record's own list, counted over the two buckets _together_, so four wordings per relay per classification is the leg's whole budget and not each bucket's. **What a reader sees** — the flat published list holds it, second in the concatenation, after the ended backlog's own refusals and before the running attempt's and the forward leg's; `computeCompletion` never reads it, so the answer it arrived after keeps its causes and stays complete. It is withdrawn only with the record that carries it: `endBacklog` builds the next backlog record with an empty `late`, and the spread that appends one carries that record's `AnswerIdentity` through unchanged, so a late `restricted:` does not mint a fresh `IncompleteResultError` and a fresh `causes` array for an answer whose content has not moved (C15). Dropping it instead is not a smaller answer but a false one: it rendered a consumer `nodata` — the claim that nothing exists — with the published list empty and the relay having said why (`RF15`, rostered `B-η-C5`) | a relay's second, differently worded refusal is discarded; a repeat lengthens the list its own attempt published; **a published list comes back shorter or reordered while the attempt that produced it is still the one on show**; **a relay decides how long the kept text is** — the list is bounded in count _and_ each entry in size, at 4096 UTF-16 code units with the truncation published beside it (0004 `RelayMessage`), and this clause was satisfied for two rounds while only the count was bounded; a refusal in a class this leg is not holding is dropped because another class had filled a shared cap; or **a refusal is still published against an answer whose own attempt nobody refused**; or the flat list drops a refusal whose own record is still on show in order to keep itself free of duplicates; or a refusal from the attempt the value is on, arriving after that attempt's backlog ended, is dropped rather than published, is counted among that answer's causes, survives the record that carries it being replaced, or is admitted past a bound the same relay's earlier refusals on that leg have already spent |
| B-α | The relay scope is owned by the provider, immutable per generation, and its identity is a **deterministic function of the readable set that is injective on that set and on nothing wider**. Both directions are measured and neither is inferred from the other: order and duplicates do not change it (`SC1`, rostered `B-α-C1`), and two different readable sets never share it — the encoding is `JSON.stringify` over the sorted, deduplicated readable URLs rather than a join, which merged `['wss://h/x', 'wss://h/y,wss://h/z']` with `['wss://h/x,wss://h/y', 'wss://h/z']` into one key (`SC7`, rostered `B-α-C5`). **It is not injective on the scope, and that is decided rather than overlooked**: `identityOf` is applied to `RelayScope.urls`, so two scopes differing only outside the readable set — a write-only relay added or dropped, a readable relay's `write` flag flipped — are one identity, because neither change alters what any request can be told and splitting the cache over it would re-ask every question for nothing. The exclusion is a contract rather than a habit now — `B-α-C22`, witnessed at both edges by `SC25`: a write-only relay joining the scope makes nobody ask again and is itself never asked, and a readable relay _losing_ its read flag is a new question. A port that reads "injective" as a property of the scope _object_ builds a key that splits on `write`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | a consumer of the **published surface** can make the scope and the connection disagree about which relays are in use, or two different readable sets share an identity, the reached form of the first being a relay whose canonicalization here and in the transport differ, so an `EOSE` from a relay that answered arrives under a key the request does not hold                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| B-θ | **A bounded set spends its slots on the newest events, expired or not.** An event past its deadline keeps the slot its recency earns it, and the valid older event it displaces is evicted from the value. So the published answer can be **empty while valid events were received**, and correcting the clock recovers the expired entries that took the slots — **never the valid ones they displaced**. `retain` bounds what is kept, and nothing promises that what is kept is showable. **The omission is silent about how many and about why, and that is decided rather than overlooked**: the value carries no count of what expiry hides, none of what the bound discarded, and no reason for either, so an empty answer never says how much of it is loss or which mechanism took it. **This is narrower than the row first stated, and the narrowing is this round's**: it used to say that an empty answer does not say which it is, and the published `hasMatchEvidence` (0004) now says one bit of exactly that — whether the request accepted an event at all — because C12's "nothing found" is a claim about the world that cannot be made without it. The clause is deleted because the shipping code steps on it, not because it stopped applying, and what is left is silence about every count and every reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | a bounded request shows an entry whose deadline has passed, an event is evicted for having expired rather than for being older, a valid event displaced by a newer expired one reappears after a clock correction, the caller is given any guarantee that the visible count relates to `retain`, or **a count of what expiry hid is published without one of what the bound discarded**, which would read as "nothing else was lost", or the value publishes anything about an empty answer beyond the one bit `hasMatchEvidence` carries — a count, a reason, or which mechanism emptied it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| B-δ | Pagination is **a declared non-goal**, not an omission: a descriptor change is a new entry and shows `loading`, page accumulation is the application's over several finite requests, and library-managed paging is a later design with a cursor owner and a page aggregate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | adding it later would require a different cache value, **or the documentation claims a feed component can page**, or presentation continuity is added by letting one descriptor's handle answer with another's data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| B-ε | Retention is an explicit choice, and a live request must make one                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | a live request can be made without saying what it keeps, or an unstated bound shortens a list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| B-ζ | Time windows are a contract on the input, not a mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | the library can prevent a moving window without breaking B1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Raw input is checked once, before anything reads it.** The key, the request plan, the wire
filters, the retention bound the fold applies and the `live` flag the stream opens with all take one
normalized descriptor. They used to read the caller's object separately and disagree: `undefined`,
`null`, `NaN` and `Infinity` produced one key while behaving as four different requests. Types do
not prevent this — the published API is a JavaScript API — so the check is a function and its output
is what the rest of the _request_ is built from.

One read is taken from the caller's object rather than from the descriptor, and it is named here
rather than left for a reader to find: the `activity` axis reads the caller's `live` flag, because
normalising in a getter would put the boundary's exception on the render path for a refused
descriptor. **It is not a _raw_ read, and this paragraph called it one for as long after the guard
landed as nobody re-read it.** The site is `safely(() => getOpts().live) ?? false`: guarded, because
it sits inside a **published getter**, so a `live` whose getter throws would throw at whoever reads
`activity` rather than being refused — and the descriptor half of `live` still refuses that same
value by name on `state.error`. Everything the request is _made of_ comes off the normalized
descriptor. This paragraph said "the only thing the rest accepts" while the engine still read the
caller's raw `retain` and `live` elsewhere.

What replaces the tally is not a shorter tally but the rule 0005 states at `B4-C6`, which is this
record's too rather than a second one: **every read of the caller's object is classified — guarded,
seam, or deliberately raw — and a field in none of the three is the falsifier.** The **guarded** set
is the caller fields whose getter can refuse the request by name — `filters`, `live`, `namespace`,
`environment`, `settleTimeoutMs`, `retain`, `scope`, `relays` and `deferred`, **nine of them** — and
the first unreadable one is refused **by name**; note that this is not the published
`ReqDescriptor`, which has six fields and neither `environment` nor `scope`: `WR19`'s three-way
split is over the _spike hook's_ option bag, and the public descriptor is a different population
that `0004` states; the seams read where nothing can be refused are guarded and _default_ rather
than refusing — `clock` at its three sites and `live` in `activity` were the original two, and the
owner bundle added `rxNostr`, `verifyEvent`, `client` and `attempts` as each became a read with no
error channel; the spike-only pass-throughs are raw, because a throw there has nowhere to be
reported. **This paragraph said "the two seams" for three rounds after the arm said six**, which an
adversarial pass measured: the record's three-way table and the check's had drifted apart, and the
check is the one that runs. `WR19` is what fails when a new read disagrees: it takes the population
from the spike hook's options type (`UseStreamedReqOpts`, not a published one), classifies each of
its 23 fields out of the file's own text, and asserts
`seam: ['rxNostr', 'verifyEvent', 'client', 'live', 'clock', 'attempts']` — so the mutation this
paragraph used to describe, an unguarded `getOpts().live` in `activity`, moves the field out of
`seam` and kills it. What the guard _does_ with an unreadable `live` is **not** observable, and the
claim stops there: such a descriptor is refused as well, so nothing is in flight and either default
renders `idle`, measured with a surgical `catch { return true }` that passes every arm. The
normalizer's own call site reads `live` and `retain` off the caller's object too, which is not an
exception — handing raw values to the function whose job is to normalize them is the boundary
working, and stating the rule as "no raw read anywhere" would make it false on sight.

**A relay named twice with different capabilities is refused.** Identical repeats are a spelling and
are deduplicated, which follows from the identity being order- and duplicate-insensitive — and "the
same relay" has to be decided before either rule means anything. The client normalizes a relay URL
before it connects and keys its own maps by the result, so a scope that did not normalize would see
two entries where the connection sees one: the identity splits a cache the transport does not, and
the duplicate rule stops being a rule about the same relay. So the boundary canonicalizes first, and
the rules below run on the result.

**Canonicalizing first is only half of it, and the other half is an agreement this record cannot
enforce by writing it down.** The transport's normalizer is not exported, so the boundary
reimplements it, and **two implementations of one function agreeing is a fact to be measured, not a
property to be assumed** — which is what it had been. Measured, and false: at the resolved version
the dependency decodes the query string after sorting it and this one did not, so a relay written
with any percent-escape in its query was one relay to the connection and a different one to the
scope. The visible end of that is not a mismatch anybody sees; it is a healthy relay's `EOSE`
arriving under a key the request's table does not hold, so the answer reports the request having
timed out on a relay that answered it. **That is this decision's own falsifier — the scope and the
connection disagreeing about which relays are in use — reached without a consumer doing anything
unusual.**

**One application of it, and a refusal for anything that would need a second.** The transport's
normalization is not idempotent — a run of trailing slashes loses **two** per pass while the query
is empty and one per pass when it is not, a run of trailing dots on the host loses one per pass, and
a nested percent-escape loses one layer per pass — so the output of one pass is not always something
that can be handed back. **Those rates were written here as one rate and that was wrong** — measured
against the resolved version, `//` settles in a single pass while `///` becomes `/` and `////`
becomes `//`, because with no query the path's own strip and the serialized string's strip both
fire. **The correct model was already in the tree, in a test comment, when this sentence was
written**, which is the shape this record keeps repeating: a correction reaches the artefact it was
found in and not the records that state it.

**That matters because the boundary does hand it back**: the scope gives the transport its canonical
url, and the transport normalizes what it is given. So the rule is two evaluations and a decision,
not a loop:

1. Apply the transport-compatible normalization **once** to what the caller wrote. That result is
   the relay's name.
2. Apply it **once more, to that name**. If the name is unchanged, it is a name the transport will
   agree with when the boundary hands it over, and it is used for the scope's identity, for routing,
   for attribution and for diagnostics.
3. If it changed, **refuse the configuration** — before a connection, a cache entry or a request
   exists.

**The second evaluation is a check and never a result.** Taking it as the result is a repair this
record tried and withdrew, and the reason is worth keeping: converging is not obeying the transport,
it is choosing a different route. Measured at the resolved version, `?x=%2526y=1` is one query
parameter after one pass (`x` = `&y=1`) and **two** after convergence (`x` = empty, `y` = `1`); a
relay that reads its query for auth, tenancy or routing is then a different endpoint from the one
the caller named. A library may not silently re-address a request, and "stable however many times
you hand it back" is an internal property that says nothing about which endpoint that is.

**What the refusal costs is a spelling the caller cannot use**, and that is the price rather than an
oversight: `wss://h/?x=%257E` names a relay this design will not talk to, and the answer is a
configuration error at construction rather than a different relay at run time. It is B4's
fail-closed rule on the other input the library takes — refuse what cannot be honoured end to end
rather than guess — and it is a v1 position. Accepting those spellings needs a transport adapter
that keeps the route and the key apart, which is more than a wrapper: the transport re-applies its
normalizer in several places, so such an adapter has to own every operation that transforms a route
and report the key actually opened.

**And then the version range makes even that too weak, which is what moved the decision one step
further.** This library declares a range, so a consumer's lockfile can resolve a transport whose
rules this repository never ran, and comparing our transcription against it only asks whether the
transport agrees with a name **we** chose. **The name is the transport's own answer now**: the
boundary hands it the string the caller wrote, one relay at a time, and takes back what it calls
that relay. There is no second implementation left to agree or disagree, and the transcription
survives only as a sentinel and as the spike-only fallback that has no caller string to ask about.
**What is still owed is the stability check and the set** — a name the transport would not return
unchanged is refused, and a set it reports differently from the sum of its per-relay answers is
refused — with a refusal that leaves nothing partially applied: **on the first construction and on
every later change of the relay list**, since a provider's list can move and a check that only runs
once lets a drifting spelling in through the second generation. A refusal that has already written
the live client is not a refusal; the comparison happens before anything a request could be routed
by is replaced, and a failed change keeps the previous generation whole. **"They will diverge and it
will time out later" is not a guard**; it is the defect, described. That obligation is a contract
row rather than this paragraph — a port can implement every other row and skip a comparison nobody
observes, which is what happened to this one when it was only prose. **Two questions are asked of
the transport here and only one of them can ever be answered "no", which is worth stating precisely
because this paragraph got it wrong once.** It said the probe's answer never differs from what it
was asked. It does — routinely, and for a reason rather than by accident: trimmed, de-fragmented,
query-sorted, escape-decoded, because **the first question is asked with the caller's own string**
and the caller's string is usually not the transport's name for it. **The figure that used to sit
here is gone rather than softened.** It said 45 of 281, which came from a measurement taken in a
session and written down nowhere that runs; `0001` makes that the rule — _a figure whose only
definition is a script that ships on a branch nobody keeps is not re-runnable, it is remembered_ —
and this record broke it in the same paragraph where it corrected itself. What survives is the
shape, which is what the decision turns on, and the two spellings this section constructs, which are
in the paragraph rather than in a file. **This sentence used to promise "the shipped corpus below,
which anybody can count", and there is no corpus below** — forty lines further down the same section
says no size is quoted here at all and that the list `TD12` walks dies with the spike, which is the
discipline this paragraph was written to state. A sentence about what a record contains elsewhere is
a copy that nothing checks, and it rotted inside its own section.

**The second question is the one that cannot fail.** After each relay has been named and each name
checked for stability, the whole set is offered again and compared with the sum of the per-relay
answers. That comparison is silent by construction rather than by luck, and **the construction is
not the one this paragraph claimed for several rounds.** It said the transport's key is an
element-wise function of one url. **It is not.** Naming a list has three list-level steps, keyed
three different ways: the caller's array is folded into an object on the **raw** string, last wins;
the map that holds it applies the dependency's normalization **twice**, last wins; and the
connection the status map is read from carries **one** application of the raw url the survivor still
had. The transport really does merge — two spellings can name one relay whether or not the steps
agree — and what the disagreement between steps two and three buys is sharper: **which name survives
depends on the order the caller wrote them in** — measured directly: `wss://h.example///` alone is
named `wss://h.example/`, `wss://h.example//` alone is named `wss://h.example`, the pair together
comes back as one name, and swapping the two inputs swaps which one.

**The conclusion survives the premise, and it survives for a better reason.** Only fixed points are
ever offered as a set — one application and two coincide on a fixed point, so all three collapses
degenerate to a dedupe on the same value — and the scope has already deduped on the transport's own
connection key before it asks. So the set probe cannot disagree on the resolved transport **by
construction**, and that is a reading of the dependency's three sites rather than an induction from
a corpus — **which is the only form of backing this paragraph is allowed to cite.** A search was run
and **none of its figures ship**, because none of them is re-runnable from anything that survives;
writing them here would have been the defect this same section corrects thirty lines above. What
ships is the reading, which anybody can check against the dependency's own source, and `TD12`, which
constructs the two spellings above from the transport rather than from a written-out expectation and
asserts that they are named differently alone, come back as one name together, and swap which one
when the inputs swap.

**And the probe is shadowed rather than dead**, which is the part that decides whether it earns its
place. Disable the per-relay stability check and the same two spellings reach the set probe, which
refuses them with a transport-key mismatch; disable the refusal and let the name converge instead,
and two relays become a one-relay scope with nothing raised at all. So this comparison defends a
behaviour the resolved transport really has, standing one line behind a stricter gate — not only a
transport this repository has never run.

**Three sentences stood here instead and each was wrong.** They said every subset of a twenty-name
corpus, four client configurations, and a control that merged a hundred and ten pairs. The corpus
was a different one; the configurations were re-measured and answer identically, so the breadth
bought nothing; and _merge_ was the wrong verb for the control's predicate, which is disagreement.
The numbers came from a scratch measurement and grew on the way — that one offered every 2- and
3-subset, not every subset.

**So no size is quoted here at all**, and the discipline is worth stating once because this
paragraph broke it twice. A figure belongs here only if something that outlives the branch produces
it. The corpus `TD12` walks does not: it is a list in a file that dies with the spike. What does
outlive it is the pair of spellings above, which are in this paragraph, and the three collapse
steps, which are in the dependency. **`TD12` does assert exact counts** — that the two are one name
each alone and one name together — and those are the two numbers this argument needs; it asserts
everything else as a threshold or an emptiness.

**So the set comparison is kept for the transport this repository has never run**, not for this one,
and what says when that changes is a measurement rather than an argument. What `TD12` observes is a
fact about rx-nostr 3.7.5 — and a port's transport is by construction not that one, so **a port
re-runs the measurement and never inherits its answer**. That is also why it is not a contract row:
a row obliges a port to preserve something, and there is nothing here for a port to preserve. **A
port owes both probes, the set one after the per-relay ones**, which is what `B-α-C16` says and what
this paragraph said the opposite of: it argued that the alarm was what a port must carry _instead
of_ the check. That is wrong in the way that matters — the alarm does nothing on the day it fires
except say why the check could not fire before, and a port that kept the alarm and dropped the check
would meet that morning with a red test and a shipped defect.

**The price, counted rather than described.** Naming one generation costs **2n+1** throwaway
transports for n **entries** — two per entry, since each URL is asked about alone and then its own
answer is asked about alone (the stability pass), plus one for the set probe. Entries rather than
relays: a caller who lists one relay twice pays for it twice. **This enumeration said `n+1` for a
round** — it named the naming call and the set probe and left the stability pass out, in the
paragraph whose whole subject is the price. Each of them opens no socket and is disposed in a
`finally`. **At `n = 0` it is 0 rather than 1**: a generation with no relays has no set that could
be renamed, so it is not probed at all, which is what keeps a refusal from having to name a relay
that is not there (`B-α-C20`). The `2n` per-entry calls are paid **on every accepted prop write,
including one that changes nothing**: the early return that skips a no-op sits above the set probe
and below the naming, so a re-render handing back the same list still pays `2n`. That is the shape a
port should price before deciding whether to cache the transport's answers.

If the transport ever exports its normalizer, that adapter is one call and the reimplementation goes
away, which is the outcome to prefer over any amount of checking. A disagreement is not: the obvious
repair is to OR the capabilities, and OR-ing `{read: false, write: true}` with
`{read: true, write: false}` produces a relay that is both — a capability neither entry asked for,
granted silently, from configuration two sources merged. Last-write-wins is worse, because it makes
the result depend on the order they were merged in. This is B4's fail-closed rule applied to the
other input the library takes.

**B3 is about the scope the request was made under, not about a field named after one.** The key
input has carried `scopeGeneration` since B1 and `canonicalKey` has honoured it throughout — and for
most of that time the call sites passed a constant naming themselves, so two requests asked of
genuinely different readable relay sets produced the same key. A decision, a unit test and nothing
in between: the property held of the function and the function was never given the fact. So the
scope is an input an engine is handed, the way the clock and the attempt registry are, and it
arrives as the immutable value B-α owns (frozen to every level, which `SC31` reads) rather than
being read back off the connection — which is the untrackable read B-α exists to remove.

**The engine does not take a key from its caller, and a draft of this one did.** A spike round put
the relay scope on the cache identity by appending it to whatever the caller had written, so entries
were keyed by the caller's `queryKey` plus the scope id and nothing else: `namespace`, the settle
timeout, the retention bound and the filters themselves were outside cache identity on the only path
where an entry is shared at all — and the reason that was hard to see is that it made B3 look
handled, since the scope _was_ in the key. **That composition is a fact about a draft of this
redesign's engine and not about the shipped one**, which has no scope in its key at all: `useReq()`
passes the caller's `queryKey` through to `createQuery` untouched. Both key on the caller's key, so
both share an entry between two hooks that wrote one key with different filters — which is the
defect this record's Context section opens with — but a sentence that attributes the draft's
composition to the shipped engine is describing a tree that no longer exists as though it were the
one being replaced. The key is derived from the normalized descriptor now — from those of its fields
that shape the wire request and the cache scope, `environment` deliberately excepted — so the caller
supplies `namespace` and nothing else.

**The qualifier, in full, because a record that delegates it to a code comment delegates it to
something that does not outlive this branch.** `environment` is on the normalized descriptor and it
changes what the request _means_: `planRequest` answers `defer` for `'server'`, so a server-side
descriptor sends no REQ at all. Two descriptors alike but for it therefore share a key while having
different wire semantics, which is the direction this record otherwise calls a defect. **It stays
out because keying on it is the worse trade**: it is absent from the published `ReqDescriptor` and
the provider detects it once and holds it as a provider-level fact, so descriptors sharing one cache
agree on it and the qualifier costs nothing — while keying on it would split one cache owner's
entries on a fact that cannot vary inside that owner: C6 gives a cache one provider, and a provider
detects its environment once.

**The reason this paragraph gave until now was hydration handoff, and it was measured false.** It
read: "keying on it would guarantee that the entry a server render fills is not the entry the
browser then looks for, which is hydration handoff made structurally impossible." Under A12 a server
render fills no entry — the plan is `defer`, the query is disabled, and a rendered provider's cache
carries one entry with `data: undefined` and `fetchStatus: 'idle'` — and no cache value can cross a
realm from here at all: nothing in this library dehydrates, persists or structured-clones, and the
published entry hands out no `QueryClient` and no context. A reason that names an event the design
makes impossible is not a reason; **the conclusion stands on the sentence above it instead**. If a
port adds server-side fetching, it changes A12, and that is the trigger to re-derive this row rather
than a cost this row is already paying. **The hole a port has to watch** is the one the spike leaves
open by taking `environment` per request rather than per provider: one provider passing both values
would put two meanings under one key, and nothing here refuses that. **The exception is a correction
and not a detail**: this sentence read "from those of its fields that shape the wire request and the
cache scope" with nothing excepted, which is a claim that every such field is in the key, and one is
not. There is one derivation because there is one engine: the accumulation is the only thing A11
swaps (0002 A11), and identity sits above it, so B1's sweep is a sweep over the one function that
both accumulators run beneath.

**And the key and the wire are the same snapshot of it.** Putting the scope in the key is only half
the decision, and the first version stopped there: the plan counted the client's readable relays,
the machine built its per-relay tables from `getDefaultRelays()` when the stream started, and the
REQ named no relays at all, so it was sent to whatever the client pointed at when it went out. A
client whose default set moved from one scope to another between the key being computed and the
request being sent therefore put the second scope's answers under the first scope's key — which is
B3's own falsifier, reached from inside the library instead of through a caller's key, and invisible
to any test in which the scope and the client agree.

So the relay set is resolved once, from the scope, at the same moment the key is, and the same list
is what the plan counts, what both per-relay tables are built from and what the REQ is routed to.

**"Once" is per resolution, not once per request, and the difference is a trade paid in work.** The
two entry points that need a resolved descriptor — building the query's options, and `refresh()` —
each run the boundary themselves rather than reading a stored result. That costs a second
normalisation pass over the filters on every refresh, and it buys the thing a stored key cannot
give: the two paths cannot disagree because a descriptor moved between the moment one cached its
answer and the moment the other ran. A port that memoises to save the pass owes the invalidation,
and the failure it is buying is silent — two paths, one key, different wire requests. The dependency
does support the last of those, measured at rx-nostr 3.7.5: `use(req, { on: { relays } })` sends to
exactly the named relays, including ones that are not defaults (SEN17), and such a request is not
re-issued to relays added to the defaults afterwards (SEN18) — which is the target set being fixed
at the start, so it is what A5 asks for rather than something to work around. Two reads agreeing is
now one value being read, which is the difference between a property and a coincidence.

**B9 and B-ε keep `retain` and `settleTimeoutMs` in the key, and the price is stated rather than
removed.** They were argued to be the asker's business rather than the question's — a sidebar
wanting three notes and a column wanting two hundred are two subscriptions over one feed. The ruling
keeps them, because they are not presentational here: `retain` changes the **stored** canonical set
and `settleTimeoutMs` changes when the backward leg ends and therefore what completeness means, so
the same filters are not the same answer. Taking them out of the key would propagate whichever
observer mounted first to every later one — the defect this whole section exists to remove, arriving
through a different field. Sharing would need a two-layer design: one unbounded raw set, with
retention and completion derived per observer, which redefines the memory owner, the collection
rule, per-observer timeouts and refresh outcomes, and is a different ADR. **What v1 owes instead is
guidance**: two views of one feed either share a descriptor policy or take the larger `retain` and
slice it themselves.

**B4 states the subset rather than the exceptions.** "Rejected, not ignored" is only a contract if
what is accepted is written down, so it is. **The value rules first**: `ids`, `authors`, `#e` and
`#p` carry 64-character lowercase hex; `kinds` carries integers 0-65535, which is what NIP-01
defines a kind to be; `since`, `until` and `limit` carry non-negative safe integers, with
`since > until`, `until: 0` and `since: 0` all refused. **And the field rule, which this paragraph
left to be inferred**: any **single-character** tag field is accepted — `#d`, `#t`, `#a`, `#r` and
the rest — with no value rule beyond the two named above, and a multi-character one is refused. An
adversarial pass read the list above as the field allowlist it announces itself to be and concluded
that the published `Article` component, which addresses NIP-23 by `#d`, refuses its own descriptor;
measured, all four are accepted. A port that inherits the narrow reading ships a library that cannot
express a hashtag feed. **`since: 0` was accepted for a round**, on the argument that ignoring it
cannot change the answer because `created_at >= 0` holds for every event — an assumption this
library's own ingest boundary does not make, since `isWireEvent` admits any finite value, and one a
validly signed event with a negative `created_at` falsifies. Both falsy bounds go out through the
same truthiness test, so both reach relays as no bound at all.

**And what is accepted is split by what a field _is_, which is the correction this round.** The rule
read "anything that cannot be decided locally is rejected", and that is a universal `limit`
satisfies while being accepted: `isFiltered()` does not evaluate `limit` either. The distinction is
between a field that constrains **membership** — which events belong to the answer, and which
therefore has to be reproducible by the predicate that accepts them locally, `search` being the one
that cannot be — and a field that **shapes the response** — how much of the same membership the
relay is asked for, which no local predicate needs to reproduce. `limit` is the second kind:
normalized, passed to the wire unchanged, and part of the cache identity because two requests asking
for different amounts are different requests. **What is not promised is a local re-application of
`limit`**: a relay that sends more than it was asked for is not corrected here, and a top-N of the
stored set is `retain`'s job.

The neighbouring refusals are not that rule, and saying so is what keeps the class one class:
`since > until` is refused because the dependency deletes the filter itself; `retain: 0` is refused
by a rule about what a consumer could observe; and an empty set field is a membership that is
_known_ to be empty, which `planRequest` answers without asking anybody. **The reasons behind those
are not one reason, and this sentence gave them as one.** For `ids` and `authors`, rx-nostr matches
a prefix locally where relays match exactly, so a short value is a request whose local and remote
answers disagree. For `since > until`, the filter really is deleted on the way out —
`normalizeFilter` returns `null` for an inverted window — and a request whose filters have all been
deleted is never sent. For `until: 0` nothing is deleted: `normalizeFilter` keeps it, its guard
admitting any non-negative number, and the REQ builder then drops the **field** on a truthiness
test, so the request goes out **widened** to an unbounded window rather than not going out at all.
That is why the boundary refuses it instead of passing it through (`NZ9` is the arm): a caller who
asked for nothing later than the epoch would otherwise be sent everything, silently. Measured at
rx-nostr 3.7.5 (`rx-nostr/rx-req.ts`, `lazy-filter.ts`). That refusal happens _before_ B8: a
descriptor the boundary rejects never reaches the question of whether it could match anything, so
the two rules do not compete for the same input. B8's case is a filter that is well-formed and empty
— `authors: []` — which is answered rather than refused, because asking for nothing is a question
with an answer while an inverted window is a request nobody can send. Everything else — a field this
library cannot honour end to end, a value of the wrong type, a `live` that is not a boolean, a
`namespace` that is not a string — is refused rather than coerced. A silent default is the same
defect as a silently dropped field: two descriptors that behave differently arriving at one
normalized value.

The rule applies to the _class_, not to the instances noticed first — **and applying it here reached
a member the argument does not cover.** The prefix argument was written for `ids` and `authors` and
is theirs alone: at rx-nostr 3.7.5, `nostr/filter.ts` matches those two with `startsWith` and
matches `#`-tag values with an exact `includes`, so there is no local-prefix-against-remote-exact
divergence for `#e` and `#p` to inherit. This record said it "holds identically" for them, which
generalized a correction past its own evidence. They carry the same 64-character hex all the same,
for the plainer reason that they reference an event id and a pubkey — where a short value is not a
prefix matching too much but a value matching nothing — so the requirement survives and only its
reason changes. **What would falsify the split** is rx-nostr giving tag filters prefix semantics,
which would make the divergence real for `#e` and `#p` too.

**And the normalized descriptor is a snapshot, not a view.** A `readonly` type is a rule about a
reference, not about the object behind it. A caller who keeps the array they passed can rewrite it
after the key is computed, and then one descriptor produces two different wire requests — the
divergence between key and wire this boundary exists to remove, reached through the door the type
system leaves open. So the boundary copies.

**How deep, because "copies" is not the same claim as "is a snapshot."** It unwraps one level of
array. That is complete only because every field a filter carries today is a primitive or an array
of primitives — the moment one gains structure, the copy shares a reference again and this paragraph
is quietly false of it. A port that adds such a field owes the depth, and the cheapest form is a
check over the field list rather than a deeper copy.

**B7a refuses what it can name, and reports what it cannot.** Ephemeral events are not retained and
this surface has no channel that could show one, so a request able to match one must not omit part
of what it matched and still report "nothing found". A filter naming a kind in 20000-29999 is
refused, at the request, which is the right end of the pipe for a fault the caller can see in their
own descriptor.

**An absent `kinds` is a different case, and refusing it was a defect.** It matches every kind, so
the old rule refused it — and `{ ids, limit }` has no `kinds`, so **the by-id request three
published components are specified to make was refused by its own library**, measured. An id arrives
from an `e` tag, a `nevent1…` link, a quote or a bookmark and carries no kind; a consumer forced to
guess one is answered "this does not exist" when they guess wrong, which is the sentence `C12`
exists to forbid. The rule now splits on `live`:

- **`live: true` with no `kinds` is refused.** A forward leg can deliver an ephemeral event, and v1
  has no transient channel to show it in, so accepting one would be the silent omission this row is
  about.
- **`live: false` with no `kinds` is accepted.** The backlog is a finite answer, and an omission
  from a finite answer can be _reported_.
- **An ephemeral event that arrives on that backlog is not retained, and raises
  `ephemeral-event-omitted`** — an `IncompleteCause`, so the answer is `incomplete` rather than
  `settled`, and an empty one is not `nodata`.

The cause is not the request being refused; it is the fact that this answer had at least one arrival
taken out of it. It is raised only where information was actually dropped, on the backward leg, so
`B10`'s separation of forward and backward completeness is untouched. When a transient channel
exists, the live refusal is what gets reconsidered. **`kinds: []` is a different case and is
accepted**: it is a well-formed empty set field, which matches nothing, so it is B8's class rather
than this one — answered without a REQ when it is the only filter, and dropped on the way out when
it rides with a satisfiable one (0002 A7b). The distinction is written here because "a filter with
no `kinds` at all" stood in this sentence and reads as both: a port that refuses `kinds: []` refuses
a request B8 says has an answer, and one that accepts _absent_ `kinds` while sending the caller's
filters through unchanged puts `{}` — every kind, ephemeral included — on the wire, which is this
row's own falsifier reached through the other row's example. NIP-01 says only that relays are not
expected to store them; what a client does with one it receives is undecided, and this record
decides that v1's materialized read model is not the place. Supporting them means a transient
channel and a revision here, not relaxing the check.

**B10 splits completeness from liveness.** A refusal used to make the answer incomplete whichever
leg it arrived on, so a backlog that ran to EOSE and a live subscription that was later refused
produced an incomplete answer over a complete set. They are different questions: whether everything
that existed was fetched is decided by the backward leg — its end, its timeout, its refusals — and
whether anything can still arrive is decided by the forward leg. The first is on the value's
completeness; the second is the activity axis and the diagnostics, which 0004 owns.

**The completeness axis has all five of its inputs now, and one of them used to be unreachable.**
`IncompleteCause` names `timeout`, `verification-timeout`, `refused`, `ended` and
`ephemeral-event-omitted` — the last is B7a's, above: an arrival this library took out of the
answer. `ended` had a variant in the type, a branch in the derivation and no code path that could
set it. The backward leg ended on a single signal — rx-nostr completing the subscription, or the
request's own timer — and rx-nostr _completes_ that subscription when every target relay's
connection has died (measured at rx-nostr 3.7.5, SEN13), so a backlog that reached nobody was
reported as one that had heard from everybody. 0002's A5 is where that is fixed; what changes here
is what the backlog record holds.

`verification-timeout` is the fourth, and it is an input that is **not** about a relay: it says the
backward leg's signature gate was cut while still holding candidates it had admitted and not yet
verified inside the boundary (0002's A-ε defines that boundary, and why such a candidate was never
`accepted`), and it says nothing about how far any relay got. Every relay can have answered and the
answer still carry it — and so can a relay that sent one EVENT and no EOSE at all (`A-ε-C14`). It is
a separate member from `timeout`, which says this request stopped hearing from a backward target:
its own settle timer drew the boundary, or a target was still undetermined when the outcome was
derived. **The two are separate because they are separately actionable, not because they are
exclusive.** One relay produces both, so neither member implies anything about the other, and this
axis exists so that a consumer can act on each rather than choose between them.

**The backward end is a cause set rather than a reason.** One relay's timer and another relay's dead
socket are both true at once with more than one relay, so storing one of them makes the record
decide which to show — the argument this record already makes about `primaryCause`, one layer
earlier. The record therefore stores `complete`, or `incomplete` with the causes the per-relay table
derived. `refused` is not among those: it is already on the record, per attempt and per relay, and a
second source for one claim is how two readers come to disagree.

**So the value carries a record per leg, not a leg table and a flat list.** The split above is a
rule about where a signal belongs, and a `Partial<Record<leg, end>>` beside `readonly Refusal[]`
cannot hold it: every reader had to re-establish which leg a refusal was aimed at, by filtering on a
field, and a reader that forgot to filter reproduced exactly the defect B10 removes. Storing them
apart moves the filter from every reader to the one writer that files them, so a reader cannot
forget it.

That is narrower than what this said, which was that storing them apart makes the mixture
"unrepresentable rather than merely wrong". It is not. `Refusal` still carries `leg`,
`ForwardRecord.refusals` is still a `readonly Refusal[]` that would hold a backward one, and what
keeps them apart is a branch in `addRefusal`. Making the sentence literally true needs `Refusal` to
drop the field and the two records to hold different types — a change to the value, not an edit —
and the gain that was actually banked is the reader-side one, which is real and is what is claimed
now.

**The backward record is named by the attempt that produced it.** `refresh()` promises to resolve on
the outcome of the attempt it started, and an end with no name cannot express that: a value that
already carries a finished backlog answers the next call immediately, with the previous answer.
Measured on the spike's cached engine — the doubled article left here by an earlier edit was
standing where that qualifier used to be, and the qualifier is load bearing, because the shipped
`useReq` has no `refresh()`, no attempts and no Promise outcome to measure: a settled live request
was refreshed, the new attempt was refused, and the Promise resolved `complete` while the refusal
was still in flight — the same setup without `live` resolved `incomplete`, so one call meant two
things.

The repair is a named record rather than a reset. Clearing on a new attempt would also work and
would be worse: the primary state would leave `settled` for the whole of every refresh, which is
exactly what the activity axis exists to prevent — and not hypothetically, because the fold _did_
clear, on the first chunk of the attempt rather than at its start, which moved the window to "from
the first new event until the new EOSE" without closing it (P30). So the end is recorded with the
attempt that produced it, and a reader asks for the end of the attempt it started — by equality, on
an id it holds before that attempt begins.

**The two legs therefore have opposite lifetimes, and that asymmetry is the shape.** A new attempt
_keeps_ the backward record and swaps it whole when its own end arrives; it _replaces_ the forward
record with an empty one of its own. The reason is what each one decides. The backward record
decides completeness, which is a question about an answer already given and does not stop being
answered because someone asked again. The forward record decides liveness, which is a question about
a subscription — and a new attempt's forward leg has not ended, so an inherited end would leave a
request that stopped once reporting itself stopped for as long as the entry lives. E14 is the
witness for both halves and P30 for the first end to end.

The attempt in flight needs a slot of its own — refusals arrive before the end that explains them,
sometimes several turns before — so the value has a fourth field holding the running attempt, which
the swap consumes.

**Both records carry the attempt's name, for two different readers.** This paragraph used to say the
id sat on the backward record alone, because only that one is ever compared against an attempt a
caller started. That is true of `refresh()` and it is not a reason for the forward record to be
anonymous. The forward record is replaced per attempt but its writers took no id, so a refusal or an
end belonging to the attempt that was replaced landed on the record of the attempt that replaced it
— reachable through the fold's own functions, with no engine involved: begin A, begin B, apply A's
forward signal, read B's record (E16). The comparison is a different one, and that is what the
earlier reading missed: the backward id answers "is this the attempt I started", the forward id
answers "is this signal about the subscription this record is for". So the record is _replaced_
rather than emptied when an attempt begins, since the name has to be written by the only step that
knows it — a record built by the first signal to arrive takes its name from whatever that signal
was.

**And the backlog record carries the answer's identity, which is not the record's.** The record is
rebuilt for a change the answer does not see — a refusal arriving after the end is published and is
not a cause (B-η) — so the memos that keep an answer's `causes` and its `IncompleteResultError`
stable (C15) cannot hang on the record: keyed there, an ordinary `restricted:` after EOSE mints a
new Error and a new frozen array for an answer whose content has not moved, which is the churn C15
exists to remove arriving on a wire event. The token is **minted by the writer that decides the
answer** — the one that ends the backlog — and **carried unchanged by every writer that does not**,
and it carries the deciding attempt inside it, because a token whose content is empty is deeply
equal to the previous answer's and the query library's structural sharing hands that one back. That
is the value shape a port inherits: owner, mint moment, carry rule. 0004 states the same fact from
the consumer's side and 0005 rows it as `C15-C3`/`C15-C4`.

What stays asymmetric is the end. `BacklogRecord.end` is total and `ForwardRecord.end` is optional,
because a protocol refusal neither errors nor completes a forward subscription (DIAG-2): a forward
record routinely holds refusals over a leg that is still open, while a backward record only exists
once its attempt is over.

**A failure is a third record on the value, and it is neither received data nor a leg's.** An
attempt can end by throwing, and what it leaves behind is nothing either leg can say: no chunk was
folded, so there is no end to record and no refusal to file. It is written onto the value all the
same — `FailureRecord`, the id of the attempt that threw and the Error it threw — rather than being
read off the query entry afterwards. The entry's error is on the dependency's lifetime, not this
record's: it is cleared at the start of the next fetch whenever the entry holds no value (`C11-S3`),
which is precisely the shape a request that failed before its first chunk is in. So a reader that
took the entry's error for the current attempt's was relying on time order, and time order can
attribute a failure only while there is no value to attribute it with.

**Its lifetime is a third one, because neither leg's fits.** A new attempt keeps the backward record
and replaces the forward one; the failure is kept like the backward record and cleared by the same
event that swaps it — a _later_ attempt reaching an end. **The word "later" is a correction to B10's
row, which said "cleared when one ends" until this round.** Read literally that clears the failure
the ending attempt itself just threw, since a failure is the last thing an attempt writes and its
own end is an end — which is the case B10's own falsifier already forbade, so the row was falsified
by its own falsifier column. Kept, because while a retry runs the previous failure is still the most
recent thing that has happened to this request. Cleared by an end, because an attempt that reached
one has asked the question again and been answered. Two judgements come with it that neither leg
makes, and `B10-C6` is where both are read: a failure is recorded whatever attempt the value is
currently on, because the attempt that threw may never have reached the value at all — a fold that
throws on the attempt's first chunk throws before anything is folded, so the value has not seen that
attempt begin — and an attempt that ends drops every failure but its own, because a failure stamped
with the attempt that just ended is what happened after the answer rather than evidence against it.
0004 carries the consumer-facing half, where the field's name and its lifetime had to be made to
agree.

**What is derived from the value moved with the record.** The primary state's `error` branch asked
two things of two sources — does the query entry carry an error, and is the value absent — and the
second stopped meaning "there is nothing to show" the moment a failure began writing a value. It
reads the value's record first now, and asks whether the value carries an _answer_: the events **as
projected at the instant the state is read**, or a backlog that ended. One failure class has no
record and is still read off the entry, which is the exception rather than a second source for the
same fact — a descriptor the boundary refused never reaches an attempt, so there is nothing to
stamp, and it is keyed by the refusal key rather than by `canonicalKey` —
`['nosvelte', 'refused', namespace, scope identity, message]`, see B1 — so the entry holding it
never holds a value.

**The projection and not the stored set, and the round that chose otherwise is withdrawn.** The
first version of that branch counted `entries.size`, to keep the question clock-free, and recorded
the difference as one accepted corner. It is not a corner: it is where this record's expiry rule and
0004's C5 cross. An attempt that failed while holding one event, whose event then expired, still
counted an event nothing can show — so the request reported `streaming` over an empty list, which
renders the loading slot, while nothing was being fetched and a failure stood. That is the state
C5's error branch exists to prevent, reached through C13 rather than through the failure record, and
`C5-C3` is the contract that now forbids it.

Nothing was bought by the clock-free reading, which is why this is a reversal rather than a
re-trade. The derivation already takes the instant and already projects: the events every other
branch reports are the projected ones, so the primary state was time-dependent in all of them and
the exception bought consistency for none. What the stored set is for is unchanged — no deadline
evicts anything, so a corrected clock brings back the events _and_ the state that reported them,
which is why "nothing to show at this instant" is still not the claim "nothing was received".

**Not by ordering, which cannot express "mine".** The stamp was a number and the wait was `>`, and a
`>` over "what was on the value when I was called" says only that _some_ attempt has finished since.
Two `refresh()` calls on one key read the same number before either attempt runs, so either can be
answered by the other's outcome — and neither is told which it got. The id is therefore opaque
(`AttemptId`, a branded string), and it is read **two ways**: every reader outside the minting
module asks equality, and the minting module owns the one comparison there is. That comparison
answers a _lane rewind_ — "was this id minted before the one the value is on, by the same registry"
— and it is authorized at two call sites, both in the value's own module: the rewind guard in the
fold, and the failure writer. **0002 A6 owns this split and this record delegates to it**; the
sentence here read "every read of it is an equality" for several rounds after the comparator
existed, which is the shape of staleness two records derive the same population separately.

**That is a discipline and not something the brand enforces, which this said it was.** A branded
string is a `string`, so `>` over two ids compiles clean under this project's `tsconfig`, and
because an id ends in a decimal counter — `r<token>a1`, `r<token>a2`, … — it then answers wrongly
rather than loudly: `'…a10' > '…a9'` is `false`. (The illustration here read `a1`, `a2` for several
rounds, which is not the format: the origin token in front of the counter is what 0002 A6 spends its
width budget on, and an id without it cannot express "two registries have no order at all" — the
clause A6 states one page earlier.) So the comparison _can_ quietly become a size again; what stops
it is not "nothing in the tree orders an id" — something does, deliberately — but that **the order
has one reader and an authorized set of call sites**, checkable by grep and by nothing stronger
(`WR17`). 0002 A6 carries the measurement, the one type that would refuse the operator (`symbol`),
and why that type costs more here than the guarantee is worth.

Equality only holds if the caller knows its own id before its attempt runs, which makes minting a
decision about ownership rather than about uniqueness. 0002 A6 puts it on the provider: two hooks
over one cache entry is what the query layer is kept for, and two minters would hand that entry
overlapping ids. The caller claims an id for the entry, the query function that runs for that entry
picks it up — the same entry, because the function that runs belongs to whichever observer of the
key set its options last, not to the hook that asked.

The name is on the value for the same reason the leg records are — a reader outside it is one two
consumers of a shared entry can disagree about — and it is not a second identity: it takes no part
in the key, because two consumers asking the same question share an entry whatever either of them
has already asked.

**Incompleteness carries every cause, not a chosen one.** With several relays a timeout, a backward
refusal and a leg end can all hold at once, and reporting one of them is a presentation decision
stored as if it were a fact. The value carries a non-empty list, deduplicated by cause and in a
canonical order that carries no meaning; picking a representative is a pure function a consumer can
apply, and one that can be added later without changing what is stored. A `primaryCause` beside a
list would make the contradictory pair representable, which is the shape this record spends its
length avoiding.

**A port condition on how that canonical order is held.** The list is sorted by a total rank, one
number per member of the cause union, and the union's exhaustiveness is enforced by the type: the
rank table is keyed by the union itself, so adding a member without ranking it stops the build, and
a new cause cannot silently fall out of the order it was never given a place in. What the type does
not enforce is that the ranks are **distinct**. Two members given the same number compile, and where
they tie the sort is stable, so what survives is the order the causes were collected in — derivation
order, which is not canonical and is exactly what the rank exists to replace. On this tree the five
ranks are pairwise distinct and behavior tests assert the exact array for the pairs that co-occur,
so the order is fixed by measurement rather than by construction. **And the order itself is here,
because a port cannot re-derive it from anything else in these records**: `refused`, `timeout`,
`verification-timeout`, `ended`, `ephemeral-event-omitted` — the last because the relays did answer
and this library took something out of what they said. That was measured by reading these records as
a port would — the rank table is argued at length and its contents were nowhere, so "a canonical
order" was a promise with no way to keep it.

**And the gap is narrower than that reads, which is worth knowing before paying to close it.**
Derivation order here already ascends through the ranks, so a tie alone changes nothing observable:
measured in three arms, tying two ranks leaves the cause tests green, leaving the ranks distinct and
swapping the two insertion sites also leaves them green — the control that shows the rank rather
than luck is doing the work today — and only tying the ranks _and_ reversing the sites publishes
derivation order. So what a witness would need is two derivation orders reaching one cause set,
which nothing here can produce.

**The production port should close it in construction** — derive the union from a canonical tuple,
so that positions replace ranks and the order is the single source the union follows from. **Applied
and run rather than recommended from a distance**: with the tuple in place `svelte-check` reports
**0 errors**, and every test file naming these causes passes. **Neither count is quoted, and the
sentence here used to name only one of them** — leaving a reader to decide whether "the file count"
meant `svelte-check`'s own total or the number of test files, which are different numbers with
different reasons for moving. Both were taken in a scratch tree rather than this one; either would
read as rotted the first time somebody ran the command here. The control is the instructive part —
writing a duplicate into the tuple does not create a duplicate rank, it drops a member from the
union, and the build fails at the site that adds that cause. The alternative of checking rank
uniqueness is weaker for the same reason the current type is: it guards a table that would no longer
exist.

**One thing the porter must not inherit.** The falsifier recorded beside the rank table — add a
sixth member and nothing else, and the build fails right there — is true and re-runnable for as long
as the `Record` stands, which is why it is not being replaced here. It changes character the day the
tuple lands: the failure moves from "does not compile at the table" to "cannot be written at all",
and it lands at the site that adds the unranked cause rather than at the table. A port reading that
paragraph as inherited would be looking for a compiler error in a place its own construction no
longer has. This does not block accepting the records: what they promise is a canonical order
carrying no meaning, and that holds here, measured. It is a condition on the port because the
argument for it is an argument about the current values rather than about the shape that produces
them.

**Retention is a choice, and a live request has to make it.** The concern is real and is not about
correctness: a live subscription that nobody bounds has no memory ceiling, and it is the one shape
in this design that runs indefinitely.

An earlier version of this record declined to require a bound, on two arguments. The second holds
and the first does not. It said that `{ kinds: [1] }` live and the same filter with a bound ask
relays the same question — true, and beside the point: **what goes on the wire and what the client
may keep are different claims**, and the second is not answered by the first. The argument that does
hold is that a number cannot be defaulted on the caller's behalf, because B6 bounds newest-first, so
a default silently discards events the caller asked for and was told nothing about — the same defect
as a silently dropped filter field, arriving from the other direction.

So the answer is not a default. It is to make unbounded **sayable**:

```ts
type Retention = number | 'unbounded';
```

with `retain` optional on a request that ends and **required on one that does not**. Nothing is
truncated implicitly, the caller can ask for everything on purpose, and the requirement lands where
the growth actually is. Making it required later would be a breaking change; making it required now
is free.

`'unbounded'` and an absent `retain` on a non-live request normalize to the same value, so the two
spellings share a cache entry rather than splitting one.

An earlier reconsider-trigger — "measure whether a live request's set grows without bound" — is
withdrawn as unmeasurable in the sense it was written. A retained set that only grows does grow
without bound while events arrive; that follows from the shape and needs no experiment. What is
worth measuring, if the default ever needs revisiting, is event rate, mean packet size and the
memory budget an application will accept.

**B7b keeps expiry out of the stored value, and that is not the same as ignoring it.** NIP-40 says
an event should be considered expired at its timestamp; the published read model applies that, and
0004 records it. What this record decides is where it may not be applied: not in the fold. A fold
that consulted the clock would return different results for the same events at two moments, and
every property relied on downstream — replaying an event changes nothing, arrival order does not
matter, a reconnection's replay is absorbed — assumes it does not. Measured: the same packet folded
before and after its deadline gives two different sets.

So the stored value keeps what arrived, and the projection over it decides what is currently valid.
That is **reversible**, and the reversibility is the point: an event excluded by the clock is still
there when a later question needs it — a corrected clock, a wider read model, a decision that NIP-40
should be advisory — where an event dropped at ingestion could not be recovered by anything. `EX5`
is the observation, and it is the same test that used to assert the opposite.

An earlier version of this record justified a different design with a reading of NIP-40 in which
both of its gates are about arrival. The specification does not say that, and the reading has been
withdrawn.

**There is one reading of the tag, and one place that applies it.** The record claimed for six
rounds that "the dependency's arrival gate is relied on rather than reimplemented", which was true
of arrival and false as written: `expiresAt` is a second reading of the same tag at projection time,
and nothing compared the two until `EX4`. They disagree — rx-nostr takes `Number(tag[1])` and keeps
it if `Number.isInteger`, this library requires a non-negative decimal integer, so `''`, `'  '`,
`'0x10'`, `'1e3'`, `' 12 '`, `'-1'`, `'+7'` and `'007'` were deadlines to one and no expiry to the
other.

**Recording that disagreement was not enough, and the counterexample says why.** An event tagged
`expiration: '1e3'` arriving at 999 was admitted by the dependency — deadline 1000, not yet reached
— and read by `expiresAt` as malformed, so nothing ever removed it and it stayed visible for ever.
The same event arriving at 1000 was dropped on the way in. Whether an event could be seen depended
on **when it arrived** rather than on the event, which is not a contract anyone can state, and it is
what an earlier version of this section wrote down as a residue instead of a defect.

So the dependency's check is off — `createNostrContext` sets `skipExpirationCheck: true`
unconditionally — and `expiresAt` is the only reading of the tag this library has. Its comparison is
one function too (`isPast`), because two copies of `at <= now` is how a boundary comes to be off by
one on one path only. NIP-40 does not specify how a malformed value is read, so choosing "no
deadline" over "expired at the epoch" is ours to make; what is not defensible is making it twice,
differently, at two points on one path.

**Off does not mean this library drops them instead.** A round of this design put a gate at arrival:
an event already past its deadline was refused before the fold saw it. That is withdrawn, and the
three reasons are recorded rather than summarised, because each one on its own would have been
enough.

- It loses data irrecoverably on a wrong client clock. A browser an hour fast discards an hour of
  events and nothing downstream can get them back — and 0001 says this design must not fail in that
  direction.
- The instant it judged against was not the arrival time. `clock.now` moves only when a timer fires,
  and timers are armed only for the deadlines of events **currently projected**, so a provider built
  at T0 whose consumer has shown nothing with a deadline judged an event arriving at T0+3600 against
  T0.
- It did not close what it was added for. `EX2c` — an event evicted for one that later expires — is
  untouched by it, which is the residue named below.

**Expiry took a say in retention for five days, and this round takes it back out.** The sequence is
worth writing down, because the record did not notice any of it at the time and the shape recurs.

`0526cde` gave B7b's falsifier a third clause — _an expired event can take a retention slot from a
live one_ — to close `EX6`. **The decision column said nothing about retention when that clause was
added; it spoke only of arrival gates, projection gates and the fold's independence from the
clock.** So for a day the falsifier tested a mechanism its own decision did not mention. `b3fed64`
then put the preference into B6's decision and into the bound, and narrowed the new clause to "one
retention decision, at the sampled instant". `5edd3eb`, six commits later, added _"At a fixed
sampled instant the result is a function of the events and not of their arrival order"_ to B6 and
narrowed B6's falsifier to fire only "with the sampled instant held still".

**That narrowing was aimed at the wrong counterexample.** It was written to accommodate a moving
clock. But `b3fed64` had already made the _fixed_-instant case false, and nobody had looked: six
arrival orders of one bounded set, at one fixed instant, `retain: 1`, an old replaceable, a newer
expired revision of it and a regular event produce **three different stored sets and three different
published answers, two of which show the superseded revision**. That is B6's falsifier and B5's
falsifier at once, and it survived to a twenty-second review round because no test had ever combined
a numeric `retain` with a replaceable kind — every site naming a numeric `retain` either fed
`kind: 1` or fed no events at all, an intersection of exactly zero. **The breakdown that stood here
— a count of `retain` sites and the split between those two groups — is deleted rather than
repaired.** It stated no counting rule, and what it counts is a spike test tree that does not
outlive this branch, so nobody downstream can re-take it; tried against the commit that wrote it and
against that commit's parent, one of its three numbers comes back under one candidate rule and the
other two come back under none. The claim the paragraph rests on is the intersection, which is
checkable site by site rather than by a total, and that is what is kept. `M16` and `P3` are named
for this very harm and both run unbounded.

The cause is one property. A destructive bound holding `retain` payloads and no history can only be
correct if **an entry's standing never falls**: an entry it evicted is an entry it cannot reinstate.
Recency alone never falls, because a replacement is newer than what it replaces. Expiry-preferring
rank does fall — a valid entry superseded by an expired one drops below entries that were already
evicted — and every symptom above follows from that one fact.

So expiry leaves the ranking. **B6 returns to the decision it held before `b3fed64`** — the newest
`retain`, under the ordering the views use — and gains back the unconditional form of its falsifier.
**B7b's clause 3 is removed**, returning that row to the subject it had before `0526cde`. NIP-40 is
now read in one place and applied in one: the projection.

**This round first claimed a narrowing balance of −2, and that count was wrong.** It counted two
deletions as withdrawals of narrowings without checking whether the shipping code satisfies the
clauses being deleted. It does — see the correction below — so the honest accounting separates three
different edits that a single number hid:

- **Two genuine widenings.** B6's falsifier loses "with the sampled instant held still", so it now
  fires at any instant. B7b's loses "rather than by an overflow" and gains "or the bound" — so it
  fires on any deadline-driven removal, and on a clock read anywhere in fold or bound.
- **Two deletions of disjuncts the design fails.** B6's "an expired candidate keeps a slot a valid
  one is dropped from" and B7b's clause 3. Both are satisfied by the shipping bound, and deleting a
  falsifier one fails is not a narrowing at all — it is worse, because a narrowed claim is still
  refutable and a deleted one is not.
- **Net, counted as disjuncts across the two rows: seven to five.** Counted as what it means: two
  claims strengthened, two claims that should have failed removed instead.

The deletions are repaired by `B-θ` — in the decision table at the head of this record, not below,
which is where this sentence pointed for as long as it stood — which states the outcome the deleted
clauses named and can be failed by it. **The number is left in the record rather than edited away,
because a balance that improved by deleting the evidence is the finding.**

This record argues its narrowings where they happen and does not carry the list of them. That list —
which row, in which round, and whether the change was asked for or chosen — is the table under
0001's More Information, and this record's `B-θ` and `B-η` rows are in it. **A narrowing made here
and not entered there is a defect in that table**, which is the reason to look at it when one of
these rows moves.

**The instant is sampled at arrival, and published.** `clock.sample()` re-reads the source and
assigns the reactive `now`, and the accumulator's reducer calls it per chunk. **Retention is no
longer what needs it** — the bound reads no clock — but the projection does, and reading `clock.now`
instead of sampling would leave what a consumer is shown an hour behind the events it is shown
against: `clock.now` only moves when a timer fires, and timers are armed only for deadlines already
on screen. `EX8` is the witness, and it is re-pointed onto exactly that reading: it moves the source
with no timer armed, so only a sample can notice, and what notices is now the published list rather
than a retention decision. The write is safe because of where it happens: the reducer is neither an
effect nor a derivation, so nothing reads `now` and writes it in one pass.

**The gap that used to be named here is closed by deletion rather than by a fix.** A second engine
read `clock.now` at this point instead of sampling, so it judged arrivals against whatever instant a
timer last left behind; that engine is deleted (0002 A11). `ExpiryClock.sample` is required rather
than optional for the same reason: it was optional only so that a test fixture's frozen clock could
be an object literal, and an optional method with a `?? clock.now` fallback behind it is the
two-readings shape written into the interface.

**What this does not buy is full recoverability, and the trade is stated rather than implied.**

- `retain: 'unbounded'` — recovery after a clock correction is guaranteed. Nothing is dropped and
  nothing is evicted, so every event a wrong clock hid comes back.
- Bounded retention — recovery for whatever is still stored, and what is stored is the newest
  `retain` whether or not a deadline has passed. An expired entry inside the bound is kept, hidden,
  and comes back when the clock is corrected.
- Over capacity — the entry that gives way is simply the oldest, so the event that becomes
  unrecoverable can be a **valid** one.

`retain = N` and "every event received stays recoverable" **cannot both hold**: N+1 recoverable
entries would break the bound. What changed this round is which candidate gives way. It used to be
the expired one, chosen by a preference that was afterwards measured to falsify B5 and B6; it is now
the oldest, chosen by the same order the views use. `EX7` witnesses it and is explicit that the
event dropped there is the valid one.

**Whether that fails towards losing data — 0001's direction — was answered here as "only in the
sense a declared bound always does", and that answer does not survive measurement.** It rested on
the caller having asked for one slot and got the newest event for it. Two measured facts break it.
The answer can be **empty** while valid events were received, so what the caller got for the bound
they declared is nothing at all. And the loss is **irrecoverable under a correct clock**: the
displaced valid events are out of the value, and no correction restores them — a clock correction
brings back the expired entries that took their slots instead.

That is a sharper form of an objection this record has already accepted once. The arrival gate was
withdrawn because "it loses data irrecoverably on a wrong client clock", one of three reasons each
said to be sufficient alone. The bound described here loses data irrecoverably on a **right** one.
The remedy differs — raising `retain` or asking for `'unbounded'` avoids this, where nothing avoided
the gate — but the direction is the one 0001 names, and "a declared bound working as declared" was a
reading that made it sound smaller than it is.

What survives of the comparison is narrower and still worth having: the behaviour this replaced
discarded an event _and_ the replacement identity it stood for, which nothing could recover by any
means because the coordinate itself had been forgotten. Both designs lose data. This one loses it
under a bound the caller set and leaves the identity intact. `B-θ` states that rather than leaving
this paragraph to imply it.

**`EX2c` stays, and this round does not close it.** An event evicted to make room for one that
_later_ expires does not come back, and the visible count can fall below `retain`. That is a
different case from the one the falsifier names: the evicted event was valid when it was evicted,
and the one that displaced it expired afterwards. Preventing it would need retention beyond
`retain`, or future-dated events de-prioritised while still valid, or a backfill from relays after
expiry — each a different design from B6 and C13. So the two facts stay contracted: `C13-C2` says
the evicted event does not come back, and the visible count can fall below the bound.

**The sequence-dependence this section used to carry is closed, and closing it cost nothing that had
to be bought.** The residue read: one slot; three arrivals sampling 8, 9 and 11; `B` (`created_at`
10, no deadline) and two newer events `A` and `C` (`created_at` 20 and 30) that both expire at 10 —
`B → A → C` stored `C` and showed nothing, `A → C → B` stored `B` and showed `B`. Same events, same
instants, different answer. It was described as what composing a pure fold with a time-dependent
destructive retention "necessarily gives".

It was not necessary. It was the expiry preference, which is the only thing that made the
composition time-dependent. With the preference gone the bound reads no clock, `C` is the newest in
both orders and takes the slot in both, and both orders show nothing at 11 because `C` is past its
deadline — the projection hiding it, which is a separate rule that no order can disagree about.
`E6c` is still the witness and still pins both halves; its assertions are inverted, and the old
expectations are recorded in it as what a reintroduced preference would produce.

**Three ways out were priced here and none of them is what was used.** Retaining evicted candidates
beyond `retain` — `retain` no longer bounding anything. Backfilling from relays once a deadline
passes — a projection rule issuing requests. Fixing one instant per attempt — order-independence
within an attempt only, at the cost of judging a chunk that arrived an hour later against the
attempt's start. The fourth way was not on the list: **take the clock out of the bound entirely.**
It costs `EX6` and nothing else, and it is the only one of the four that makes the bound a function
of the events alone.

**B7b now states the whole of what is enforced, and the sentence it opened with two rounds ago turns
out to have been right.** It read "nothing is removed from the stored value as time passes, and
nothing is dropped for having expired", which was narrowed on the grounds that expiry did remove
something — it chose which candidate gave up a slot. That choice is gone, so the original sentence
holds again without qualification: no arrival is rejected for having expired, no deadline passing
evicts anything, and expiry decides nothing about which entry keeps a slot. NIP-40 is read in one
place and applied in one.

**Clause 3 is withdrawn, and this is the second time it has moved.** It entered at `0526cde` as "an
expired event can take a retention slot from a live one" — added to the falsifier column of a
decision whose text said nothing about retention, so for a day it tested a mechanism its own
decision did not name. `b3fed64` narrowed it to "one retention decision, at the sampled instant",
the one narrowing this record has admitted to.

**This section claimed both were withdrawn "because the mechanism they described has been removed
rather than re-scoped", and that claim is false.** A review pass tested the withdrawn wording
against the shipping bound and it is satisfied verbatim, repeatedly. The clause names an _outcome_ —
which candidate is kept and which is evicted — not a mechanism, so removing expiry from the ranking
does not make it vacuous. It makes it **guaranteed**: whenever an expired entry is newer than a
valid one and the bound overflows, the expired one keeps the slot. Measured on the shipping code,
three valid events and three newer expired ones at `retain: 3` fire the clause **three times** in
six arrivals; one valid and one newer expired at `retain: 1` fire it once.

So a falsifier was deleted that the design fails, and the deletion was booked in this record as
withdrawing a narrowing. **That is the move this record spends its length forbidding, committed by
the round that named the pattern.** The row below is what the clause is replaced with — a decision
that states the outcome and can be failed — and the balance line further up is corrected with it.

**Whether the emptiness could explain itself was costed, and the answer is no — not because it is
expensive, but because the cheap version lies.** Counting what the projection hides is nearly free:
a field on `Projection`, three lines in `project`, and `npm run check` passes untouched, because the
one caller destructures. Publishing it is not free but is not large either — measured, it raises six
type errors across two files, since every `deriveState` return site has to carry the count and
`deriveDiagnostics` gains a parameter — and it grows the published surface by one field, which is a
product decision of the same class as the refusal cap. It is witnessable: `EX6`'s own scenario would
assert an empty answer beside a hidden count of two. None of that is what stops it.

What stops it is that **the silence is not about expiry.** A consumer who sees an empty answer
cannot tell it from: nothing matched the filter; events arrived and the bound discarded them for
being older (`EX2c`, `C13-C2`, already contracted as silent); or events arrived and all of them have
expired. Publish a count for the last case alone and `hiddenByExpiry: 0` starts reading as "nothing
was lost" — which is false whenever recency did the discarding, and recency does it constantly on
any bounded live request. A partial explanation is worse than none here, because it is the half a
consumer would trust.

The other half cannot be supplied at the same price. What expiry hides is derivable at projection
time, because the entries are still there; what the bound discarded is not, because they are gone.
Carrying it would mean the value remembering what it evicted — the same unbounded history that
`retain` exists not to keep, and the same structure that killed the high-water-mark design earlier
in this round. So the choice about the counts is silence or an unbounded ledger, and B-θ takes the
silence **and says so in its own text**, the way the refusal cap says that what it drops is not
reported. A silence that is contracted is not a silence that is hidden, and B-θ's falsifier now
fires on the half-answer as well as on the false guarantee.

**The silence is not uniform any more, and B-θ says which part of it went.** The round that closed
`C12` published one bit — whether the request accepted an event — so an empty answer distinguishes
"nothing matched" from "matched and none is showable", and the row is narrowed to the counts and the
reasons. The paragraph above is about the counts, and that argument is untouched: what expiry hid is
still not published, what the bound discarded is still not published, and neither is which of them
emptied the list. What changed is that the row no longer claims the empty answer says nothing at
all.

**It fired, on this round's own repair, and the pre-submission read is what caught it.** Closing
`C12` put a field on the settled state so the slot could tell an empty list from an empty value, and
it was written as a count: `entries.size - events.length`, where `project` withholds on a deadline
and nothing else. That is a count of what expiry hid, published with no count of what the bound
discarded — B-θ's last disjunct, verbatim, committed by the same round that wrote it, in the repair
for a different blocker. The field is a boolean now, and published under a name that says what it
means rather than where it is read: `hasMatchEvidence` says whether the request accepted an event,
which is the only thing the slot asks and the only thing every accumulator can honestly answer. **A
boolean was not on its own enough**, and the round after this one had to say so: a value that is
smaller than a count is still a published fact, so the row above is narrowed rather than left to
cover it. Two decisions written days apart would not have collided; two written in one round did,
and the only reason it did not ship is that the submission's numbers were re-derived from the tree
rather than from the round's own account of itself.

**What the withdrawal costs is `B-θ`, and it took a review pass to get it stated at full strength.**
This section first wrote it as "a consumer can be shown fewer entries than `retain`", which
understates it twice over. Measured: with three valid events and three newer expired ones at
`retain: 3`, the stored set is the three expired ones and **the answer is empty** — not merely
short. And the three valid events are gone from the value, so a clock correction brings back the
expired entries and none of the events they displaced. "Fewer than `retain`" is a true sentence
about a case that is not the bad one.

`EX6` and `EX7` are re-pointed onto exactly that: same inputs, inverted expectations, and each also
asserts the half the old design could not offer, that correcting the clock brings the hidden entries
back because no slot was ever spent on a deadline. `EX8` is re-pointed too, since the sampled
instant is now observed through the projection rather than through a retention decision.

**None of the three was deleted for being inconvenient.** They encoded a product judgement made at
`b3fed64` — that expiry should outrank recency for a slot — and that judgement was afterwards
measured to falsify B5 and B6 at a fixed instant, in six arrival orders of one bounded set.
Inverting them is what a measurement is for; `E6d`, `E6e` and `E6f` are the witnesses that made it
visible, and they fail on the bound as it stood.

Witnesses `EX5` (hidden and then shown again when the clock is corrected), `EX6`, `EX7` and `EX8`.
`EX4` stays, because the two readings still differ and that difference is now a fact about the
dependency rather than about this library.

#### `B-η`'s falsifier was written in a vocabulary its decision does not have

The decision is scoped to **one attempt** — "one relay says the same thing on one leg of one
attempt", bounded "per attempt, per relay, per leg and per classification". One clause of the
falsifier column was not: "a repeat lengthens the list" names _the list_, and the list a consumer
holds is the flat projection across every record. That subject has no attempt in it, and the shipped
tree walks straight through the clause as written. Measured:

```
length                                    : 2
distinguishable by any published field?   : no — the two entries are field-for-field identical
Refusal's own keys                        : from, leg, notice, reason
```

Attempt A's refusal sits in the backlog record, B's identical refusal in the running one, and the
flat projection concatenates both. `isNewRefusal` compares within one record and cannot see across
two.

**The accounting is two entries and not one, and they run in opposite directions.** Scoping the
clause to the attempt that published the list is a **correction**: the decision body already said
"one attempt", the body is untouched, and no implementation that satisfied the row stops satisfying
it. Adding the clause that the flat list is a concatenation rather than a set is a **narrowing**,
and it is this round's — a reader who took "a repeat does not lengthen the list" to mean "the
published list holds no duplicates" was reading something the shipped list does not do, and the row
now admits an implementation that reader would have ruled out. Closing this by scoping alone would
have been the move this record refuses elsewhere (a rule about how this record is written rather
than about the library, so no arm holds it): the falsifier got easier, so something has to have got
harder, and what got harder is the promise about the published list.

**The duplicate is kept rather than repaired, and the reason is what the two entries are for.** They
explain different records — A's backlog record, still the answer on show, and B's running one — so
removing either hides an explanation that is still standing or credits an answer with a refusal
aimed at a different attempt. That is the failure `B-η-C5` measures from the other side, and the row
now carries the falsifier for the repair as well: a flat list that drops a refusal whose record is
still on show, in order to keep itself free of duplicates, falsifies this.

**What is unpublished is which record a refusal explains, and the alternative was considered rather
than overlooked.** An `attemptId` on `Refusal` would make the two entries distinguishable at the
cost of putting attempt identity on the published surface, which invites exactly the cross-attempt
correlation B-η withholds — the transcript that grows with every retry, and which the same row
rejects for being unbounded. So the duplicate is contracted instead. `E20` is the witness. `E19`
shares its setup and cannot reach this: it begins the second attempt to observe the _withdrawal_ and
never adds a refusal under it, so the one arrangement in which two records are populated at once
never occurs there.

### What the cache is allowed to hold

**Only events this library owns.** The stored value's entries are keyed by replacement identity
(B5), and what sits under each key is a copy this library made at the boundary and froze — not the
object the transport handed over.

That is not decoration. Before it, `ReqState.events` published the cached objects themselves:
`state.events[0].content = '…'` type-checked with no cast, reached the entry in the shared cache,
was visible to every other hook on the same key, and survived `refresh()` — measured end to end. The
fold's algebra — idempotent, monotonic, order-independent — cannot be true of operands a reader can
write into, and mutating `id` or `created_at` would desynchronise an entry from the key it is filed
under, which is the identity everything here rests on.

**The types carry it rather than a comment**: what the fold accepts is an `OwnedPacket`, so a packet
off the wire cannot be folded without going through the copy first. 0002 records why the copy is
taken _before_ verification, and 0004 the published type a consumer sees. `B5-C6` is the row; `OW1`,
`OW2` and `OW6` are its witnesses.

**B5's key is injective on what reaches the fold, not on what a type allows.** `kind:pubkey:d`
separates two addressable coordinates only while `pubkey` is 32 hex bytes: the boundary checks that
it is a _string_ and that `kind` is finite, and nothing between the wire and the fold constrains its
alphabet. What upholds the premise is signature verification — which in this spike is a caller seam
and is outside the cache key — so a port with a lax or absent verifier gets silent replacement
collisions, one author's event overwriting another's under one key. That was written in a code
comment and nowhere else until an adversarial pass asked which record carried it; a trade-off
documented only beside the code is not recorded, and the code is what this branch deletes. **Owner:
the port. Re-opened by** a verifier that is optional, by a boundary that stops requiring a
signature, or by any second producer that reaches the fold.

**And the key has three arms, not one; the paragraph above closed the first of them.**
`replacementKey` answers `kind:pubkey:d` for an addressable event, `kind:pubkey` for a replaceable
one and the **event id** for everything else, and a port owes an argument for each — the first
version of this paragraph gave one and read as if it had given all three.

- `kind:pubkey` needs no `d`, so the escaping question does not arise; what it needs is the same hex
  premise, or two authors share a key.
- The **id** arm rests on a different premise entirely: that no two _distinct_ events reaching the
  fold carry one id. That is a hash, not an alphabet, and the same verifier gate is what makes it
  true — `byRecency` states it as its sibling premise. An unverified duplicate id silently replaces,
  exactly as above.
- **Across arms the separation rests on the same premise as within them, and a first draft of this
  bullet claimed otherwise.** It said the arms cannot collide "as a property of the shape rather
  than of the values" — an id has no `:`, a replaceable key one, an addressable key two. Both halves
  are false and both were constructed: a `d` tag of `b:c` gives an addressable key **three** colons,
  and a regular event whose `id` is the string `10000:<pubkey>` produces exactly the key of the
  replaceable coordinate `(10000, pubkey)`. What forbids the second is that a valid event's id is
  its own hash, which is the verifier gate again — so this is a value property, not a shape
  property, and it is the one bullet that cannot be exempted from the residue below. A port that
  renders `kind` in hex or joins with a character a `d` tag may contain loses even that.

The classification itself is a fourth freedom, and it has **no row of its own**: `B5-C1` and `B5-C2`
rest on the kind ranges without stating them, so a port that widens `replaceable` moves events
between the arms above while every row it can read stays satisfied. **So the ranges are written
here**, because "NIP-01's ranges" is not a specification a re-implementer can follow and the one
part they would miss is the first: `0` and `3` are **replaceable**; `[10000, 20000)` is replaceable;
`[20000, 30000)` is ephemeral; `[30000, 40000)` is addressable; everything else is regular. **The
ephemeral arm is a classification and not a refusal**, and a first draft of this sentence said "(and
refused, `B7b`)" — wrong twice: the contract is `B7a`, not `B7b` (which is NIP-40 expiry), and what
`B7a` refuses is a **descriptor that could select** an ephemeral event, at the boundary. An
ephemeral event that arrives at the fold is classified like any other; dropping one silently there
is the defect that made a request able to match an event and never show it. What no row can hold at
all is a verifier a caller supplies, which is the residue this whole paragraph is about.

### Consequences

- Good: a caller cannot merge two requests by accident, on either accumulator, **for any descriptor
  the boundary accepts** — where "descriptor" is the six published fields and nothing else. **The
  spike's hook takes twenty-three options and the key reads seven of them**, and the **fifteen**
  outside the key are a port's problem the day any of them becomes a published field. **All three
  figures are read back out of this paragraph now**, by `WR32`, and compared with what the file
  derives — because for three rounds they were transcriptions nothing read, which is how this
  sentence said "eleven", a number no arithmetic reaches, and then went on saying twenty-one and six
  for two rounds after the arm read twenty-three and seven. The restatement that used to stand here,
  naming the same two figures a second time, is deleted: a number copied twice in one paragraph is a
  number that rots in one of the two places. `0004` prints the roster of the fifteen and `WR31`
  derives it. What leaves with the spike is the shape: `initialData` is the sharpest, because two
  hooks agreeing on the descriptor and differing there share one entry whose _contents_ are decided
  by which mounted first — the same defect `OM6` measures for `verifyEvent` (`A16-C7`). An
  adversarial pass enumerated them; the record had named one (`environment`) in one place and four
  in another. The shape that merges today — a key the caller writes — is unrepresentable because
  there is no such argument: `namespace` splits and cannot merge, and everything else the key reads
  comes from the normalized descriptor. The qualifier is not decoration: a refused descriptor is
  keyed by the refusal key, so two different bad descriptors that fail the same way **within one
  namespace and one relay scope** do share an entry. (The key was the message alone for several
  rounds, and the namespace and scope were added because the merge across namespaces was measured —
  a published sentence, `namespace` "can only split, never merge", that was false in a corner. Three
  sentences in these records still said "keyed by its rejection message" afterwards, which is what a
  port would have built.) That entry holds an error and nothing else, which is a reason it is
  harmless rather than a reason the sentence was true without the clause. **B1's row carried the
  unqualified form until this round** — "two descriptors that are not equivalent never share a key",
  with no mention of refusal — so the row asserted something the refusal path falsifies; it now
  names the accepted ones and says what a refused one is keyed by, and its falsifier gained the case
  where such an entry holds a value.
- Good: what is stored matches how Nostr identifies events, so replacement and ordering are
  properties of the value rather than of each view. **Non-retention is not one of them and this line
  used to say it was**: the fold does not drop ephemeral events, the descriptor boundary refuses a
  request that could select one (`B7a`), and a port that reads non-retention as the fold's rebuilds
  the guard `eventset.ts` records as removed.
- Bad: two callers who wrote equivalent descriptors differently may still get two entries. That
  costs a round trip and is the safe direction.
- Bad: `retain` and any future pagination are in tension — bounding keeps the newest, and loading
  older discards what it fetches. Recorded rather than resolved.
- Good: a bounded set is order-independent unconditionally — the bound reads no clock, so the same
  events in any order, judged at any instants, leave the same set and publish the same answer
  (`E6c`, `E6d`, `E6e`, `E6f`). This was the residue the previous round recorded; it is closed
  rather than re-scoped, and the falsifier that stopped firing did so because the mechanism behind
  it was removed.
- Bad: a newer event that has expired holds its retention slot, and this is `B-θ` rather than a
  consequence, because a consequence cannot be failed. Measured at its worst rather than at its
  mildest: with three valid events and three newer expired ones at `retain: 3`, **the answer is
  empty**, and the three valid events are evicted from the value and do **not** return when the
  clock is corrected — what returns is the expired entries that displaced them (`EX6`, `EX7`). The
  remedy is the caller's: raise `retain`, or ask for `'unbounded'` — **and that is a new request,
  not a wider bound on this one**, because `retain` is part of the cache identity. The entry on
  screen is not re-bounded: a different key means a different entry, an empty one, and a fresh ask.
  This record gives the settle timeout its own row for being in the key (`B9`) and gave the
  retention bound none, so an adversarial pass read the remedy as re-bounding what was already held.
  Whether the bound belongs in the identity at all is a decision this record makes by having made it
  — two hooks that keep different amounts are two answers — and it is stated here rather than left
  to be found in `key.ts`. It is preferred to the alternative because the alternative showed
  **superseded** content, which is the failure this record exists to prevent, and because it keeps
  the replacement identity a forgotten coordinate destroyed for good. It is **not** preferred on the
  ground that it loses less: it can lose more, and under a correct clock.

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

**Every claim in this record about what the dependency does is a measurement at a version, and the
version is rx-nostr 3.7.5.** `SEN10` asserts it against the installed tree, so a bump fails a test
rather than being inherited quietly. Some of the sentences above carry it inline, where the figure
beside it is doing work; the rest are dated by this one. The rule is that a dependency-behaviour
claim in this record is dated somewhere, or it is not a measurement — which was not true of it until
this round: `SEN13` was cited here bare while 0002 cited the same measurement at its version, so one
correction had been applied to one of the two records that carry the claim.

## More Information

The failure this record is most concerned with is a component holding a fixed cache key while its
filters vary with the route it is on. This paragraph said it was visible in a dependent project
today and was found by re-reading their published source rather than by reasoning. **That is
withdrawn**, and by the same test 0001 applies to the dependent-project survey: no names, no output,
no step anyone can repeat — and the withdrawal there is of the reading itself, so a second claim
sourced the same way does not survive because it is about one project instead of five.

What is left in its place is not weaker as a reason. The shape is re-derivable from this repository:
the shipped engine keys entries with the caller's `queryKey` and nothing else — `useReq()` hands it
to the query client untouched — so two hooks with one key and different filters share an entry, and
the record above says where. Whether anyone outside this repository is standing in it is **not known
to us**.
