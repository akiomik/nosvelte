---
status: accepted
date: 2026-10-02
decision-makers: akiomik
consulted:
  redesign review rounds 1-30, the r7 review of rounds 31-32, and the external reviews of r33 and
  r34
informed: nosvelte users
---

# Rebuild `useReq` rather than patch it

## Context and Problem Statement

`useReq` is the single request primitive under all but one of the `use*` stores and all but one of
the components this library publishes — 18 of 19 and 11 of 12, the exceptions being
`useConnections`, which reads relay state rather than making a request, and `NostrApp`, which is the
provider the rest run under.

**The rule that produces those two numbers, because a figure without one is not re-runnable.**
Denominators: every `use*` name `src/lib` exports outside the spike directory — **counting re-export
aliases**, which is where a first attempt at this went wrong and produced 17 instead of 19, since
`useText` and `useTextList` are exported as `export { useEvent as useText }` rather than declared;
and every `.svelte` file in `src/lib/components`. Numerators: reachability to `useReq` by following
names transitively, not a direct mention — the rule also says "and relative component imports",
which is inert today because no component imports another, and is written down so a port that adds
one does not have to guess — eight of the nineteen never write `useReq`, and seven of those eight
reach it through another one; the eighth is `useConnections`. **A figure that fails to re-derive
indicts the rule first**: both of these did, under a rule that only looked for `export function`.
**And the first statement of this rule got its own number wrong**, saying six where the count is
seven — which is the same defect one level down, and the reason the rule is written as something to
run rather than as a sentence to trust. The open issues describing its behaviour are what this
rebuild started from, and working through them found that they are not that many independent bugs.
They are a small number of structural choices, each producing several symptoms:

- the cache key is supplied by the caller, so two different requests can be merged into one entry
  and a request whose filters change can keep another's answer (#81, #74);
- the subscription's lifetime belongs to a `req` object the caller passes in, so it outlives its
  consumer, starves other consumers of the same object, and cannot be closed by the library (#61,
  #73, #82);
- there is no state for "asked and heard nothing yet" that is distinct from "asked and there is
  nothing", so the library reports absence it has no evidence for (#74, #78, #79, #83, #90);
- the client is a module-level store, which is one per process — the wrong number for server
  rendering, for tests, and for a page with two providers (#77, #80, #88, #89).

Patching them individually was the starting assumption and was withdrawn. Three of the issues
classified as non-breaking turned out not to be fixable without changing the public API, and that is
the whole of what carries the withdrawal now. **How far a patch release would reach is not known to
us.** This paragraph said the dependent projects we are aware of pin a range that no release in five
minor versions has satisfied, so a fix published today arrives nowhere — and nothing records which
projects, which ranges, or how either was read. The survey behind it is withdrawn; see More
Information. What is checkable is the release side alone: five minor lines have shipped since 0.1,
which is in this repository's tags. Where any consumer sits inside that is not.

## Decision Drivers

- **A wrong answer costs more than a slow one.** Several of these issues make the library state
  something false — that nothing exists, that a request is running — rather than being slow or
  wasteful.
- **The library owns what it created.** Lifetime, cache identity and connection state are the
  library's to manage; each issue above is a place where they were handed to the caller or to no
  one.
- **One breaking change, not a sequence.** A staged migration is several breaking moves where a
  rebuild is one, and a consumer pays for each stage separately. This driver used to lead with
  "users are already five minor versions behind", which is a claim about where consumers sit rather
  than about what has shipped; it rests on the withdrawn survey and is dropped rather than restated.

## Considered Options

- **Patch the non-breaking subset first, then redesign** — the original plan.
- **Redesign `useReq` and keep the surrounding API** — replace the internals, leave `req`,
  `queryKey` and `operator` in place.
- **Rebuild, and take one clean break across the whole surface.**

## Decision Outcome

Chosen: **rebuild, with one clean break**, because three of the first option's patches are not
patches — they cannot be made without changing the public API, so the staged plan's first stage is
not a stage — and the second leaves the three arguments that cause the defects in place. This
sentence used to lead with "the first option's patches reach nobody", and that ground goes with the
survey it rested on: how far a patch release reaches is not known to us, and the option is rejected
without it. The reason the rejection survives the withdrawal is that the surviving ground is about
the issues rather than about the audience — it is re-derivable from the tracker and from this
repository, which is what the withdrawn one never was.

The rebuild is recorded as four decisions that are **accepted together with this one**:

- [0002](0002-request-engine.md) — how a request runs.
- [0003](0003-cache-identity-and-value.md) — what identifies a request and what is stored for it.
- [0004](0004-public-svelte-api.md) — what consumers see.
- [0005](0005-contract-catalogue.md) — what each of those decisions obliges an implementation to do,
  and how that obligation is confirmed after the spike that witnessed it is deleted.

**They form one implementation and release unit: no subset of them is implemented or shipped on its
own.** That is a stronger and more accurate claim than "none can be accepted separately" — each is a
coherent document, and the reason they travel together is that their contracts reference each other
in both directions.

Forward, from what a consumer sees to what is stored: 0004 decides that "nothing found" may only be
shown with evidence that nothing exists; that makes "was anything refused" an input to what is
rendered; a rendering input outside the cached value lets two consumers of one key render
differently, which is what 0003 forbids; so refusals are part of the cached value, and its shape
depends on an event defined in 0002.

Backward, from the engine to the surface:

- 0002's escape route is not a way out of the query library — that would need a second cache
  implementation and is a different record. It is one seam, the accumulation, with the experimental
  helper on one side of it and stable `setQueryData`/`getQueryData` on the other. **0002's
  helper-swap seam holds as an internal-implementation swap only while 0004 publishes no
  accumulator- or helper-specific type**: publishing one makes taking the fallback a breaking
  change, which withdraws the escape route, so the engine record depends on the API record.
- 0002 and 0003 both place ownership — of the client, of the relay scope, of the clock — in a
  provider that only 0004 defines. Without it they name an owner that does not exist.
- 0004 removes the caller-supplied cache key, which is only safe because 0003 derives one that
  cannot merge unrelated requests. Removing it without that is removing the only control a caller
  had over a real hazard.

Acceptance is recorded by updating **0001 through 0005** in one commit, with this record as the
gate.

**What is normative, and what is not.** The normative unit is exactly those five records. A reviewer
asked for this because it was not decided: 0001 named three documents, a submission asked whether to
accept "0004 and 0005", and the submission documents under `docs/redesign/` — a tree that does not
survive this branch — called themselves the accept unit as well. Those submissions are **provenance
and evidence** — what was measured, by whom, and what was ruled — and several of them deliberately
keep claims that a later round withdrew. A specification assembled from them is not one
specification, so they bind nobody: **if a submission and a record disagree, the record is the
contract and the submission is history.** That is also why 0005 is in the unit rather than beside
it: it is the only record that survives the spike whose arms every other record cites, so accepting
0002–0004 without it accepts contracts with no stated way to confirm them afterwards.

### Consequences

- Good: the open issues close as a group rather than individually, and the ones that cannot be
  patched close at all.
- Good: the failure modes move in one direction — the library does duplicate work rather than losing
  data or asserting absence it cannot support.
- Bad: every consumer changes. Measured: **95 pattern matches over 94 distinct call sites**, across
  the demos and README, in six kinds. The 95 is what `tools/measure-break-surface.mjs` prints —
  under the label "call sites that break", which is the tool naming matches as sites — and the 94 is
  derived from it in More Information: one `let:connections` is also a `let:` slot prop and both
  patterns count it. **This line attributed both numbers to the tool**, which is what let the
  difference between them go unsaid. The difference is **one**: over those nine files the eight
  patterns produce 95 matches at 94 distinct text spans, and exactly one span is matched by two
  patterns — the `let:connections` that is also a `let:` slot prop. **Two of the eight answer zero,
  and they were added because their absence read as zero.** They are `app` — the published
  `writable<{ rxNostr }>`, which is the only path a consumer has to the connection and therefore the
  only way they send an event — and the exported `latest`/`latestEach`. Both are removed by this
  rebuild and neither had a pattern, so the bill said nothing about them; the tool now starts every
  pattern at zero so that a question asked and a question never written are different lines. Neither
  is used by this repository's demos or README, which is what the zero says and all it says: a
  consumer outside this repository who publishes events through `app` is not counted by any figure
  here, and [0004](0004-public-svelte-api.md) records what v1 leaves them. (A draft of this
  correction cited "18 lines carrying two or more patterns" as evidence the difference is not rare;
  those 18 lines contribute nothing to it, because on them the patterns sit on disjoint spans. Line
  co-occurrence and span sharing are different quantities.) **It is not re-runnable in this record's
  own sense**, and two versions of this line have now claimed some form of it: the program that
  defines it ships on the branch nobody keeps, and nothing runs it — no script, no CI step, no arm.
  What the figure has is a stated method (More Information) and a program that produced it once;
  what it does not have is a reader. Use outside this repository is not measured; "four of the five
  dependent projects" is withdrawn rather than restated.
- Bad: no compatibility layer, so there is no gradual path. The alternative was a layer that either
  reproduces the defects or silently changes behaviour.

### Confirmation

An earlier version of this section said the decision is falsified if any one of the listed issues
can be fixed without changing the public API. That is wrong and has counterexamples: the guard for a
filter that can only match nothing is an internal change, and so is pinning the streaming refetch
mode. **One symptom being locally fixable does not make the group independent** — which is what the
argument above actually rests on.

Reconsider this decision if any of the following becomes true:

- a compatibility layer can be written for the removed arguments that neither reproduces a defect
  nor silently changes what they mean;
- a set of changes that keeps the published surface intact closes the ownership, identity and
  absence problems _together_, rather than one symptom at a time;
- the cross-references between 0002, 0003 and 0004 above stop holding, so those three runtime
  decisions no longer have to move as one. **0005 is not part of that test, and a reviewer asked for
  the difference to be stated here.** It is in the accept unit for a different reason — it is the
  catalogue of what the other records oblige and the only one that survives the spike whose arms
  they cite — so it follows whichever decisions remain rather than being one of the three whose
  coupling is under review. If the three do come apart, 0005 is re-cut to the decisions that stay.

Some of the current implementation's behaviour is pinned by characterization tests that assert the
defects as they are, so a fix to _those_ landing without replacing them fails. **"The behaviour … is
pinned" stood here and is an overclaim**, which an external reviewer measured: the arms are `#74`,
`#81`, `#78`, `#80` and `#68` — four of the numbers this record lists, plus `#68`, which the groups
above do not mention at all — and **two** of the four groups have no arm rather than one. The
subscription-lifetime group (`#61`, `#73`, `#82`) has none, and neither does the module-level-store
group: `#80` builds its own client and passes it in, so it never reaches the singleton, and no arm
in the characterization suite **characterises** `src/lib/stores/app.ts`. This said "nothing touches"
it, and that is false in the way that matters to a reader counting on it: eleven component test
files call `app.set(…)` — the store is their arrangement, and every component under test reads it.
What none of them does is assert anything about the store itself. Measured: giving the singleton an
initial value (`writable<{ rxNostr: RxNostr }>({ rxNostr: null as … })`), which changes what a
consumer reading before any `set` receives, leaves all 13 component files and 55 arms green. Nor is
there an arm for `#77`, `#79`, `#83`, `#88`, `#89` or `#90` — and `#90` was in neither of this
sentence's two lists until an adversarial pass counted them. A fix to any of those lands with the
suite green, which is exactly what this sentence promised could not happen. The group with no arms
is not the harmless one: the reviewer measured the reachable form of it — a request that settles
leaves its `REQ` open, because the only handle to the subscription is inside the query function's
promise and the query library's cancel is a no-op once that promise resolves. Those tests die with
the old code; what replaces them is the contract catalogue in [0005](0005-contract-catalogue.md).

## More Information

The count of call sites was measured by matching the removed patterns against this repository's
demos and README, and `tools/measure-break-surface.mjs` is that measurement — **runnable while this
branch lives and not after it, which is the qualification the Decision Outcome above insists on**:
the program ships on the branch nobody keeps, so what survives is the method stated here and not the
command. Scoped to this repository by its own header.

**The method is written here and not only in the tool, because the tool is on the spike branch and
these records are meant to outlive it.** The population is `src/routes/**/*.svelte` plus `README.md`
— nine files — and each kind is counted by matching one pattern over each whole file. **What this
paragraph does not make reproducible are the patterns themselves**: "per-kind components" is a
twelve-name alternation of this repository's own components, and a re-implementer would have to
choose their own. The figures are this repository's, at this commit; the method is the shape of the
measurement, not a definition that reproduces the number elsewhere. Over those nine files: `let:`
slot props 26, `slot="…"` attributes 26 (both C1 / CONST-S2), `queryKey=` 19 (C3), per-kind
components 19 (C7), `req` or `createRxForwardReq` 4 (C3), `let:connections` 1 (C-δ). Six kinds,
ninety-five matches — and **ninety-four distinct sites**, because the one `let:connections` is also
a `let:` slot prop and is counted by both patterns. Two more things an adversarial pass measured and
this paragraph did not say: the `req=` half of the fifth kind matches nothing in this repository
(the demos write the `{req}` shorthand), so all four of those matches are `createRxForwardReq` and
two of them are import lines; and nothing runs the tool — no script, no CI step, no arm — so the
number is remembered between re-runs, which is what the sentence below warns about. **A figure whose
only definition is a script that ships on a branch nobody keeps is not re-runnable, it is
remembered** — the defect this round found five times in these records, and once in the first draft
of this paragraph, which specified `use*` store names and an `operator` argument. The tool matches
neither: the break is at the component boundary and the cache key, not at the hook names. That draft
would have reproduced no number at all, and it was written while arguing that a figure must not
depend on something that can disappear. **The counts above are the tool's own output, read rather
than recalled.**

An earlier version of this paragraph also claimed a count of dependent projects "measured on
2026-08-01 by reading their published sources". No such record exists: no names, no output, no step
anyone can repeat.

**A second figure is dropped for a weaker reason and the difference matters.** This record opened
with a count of open issues and repeated it in the Consequences. Unlike the survey, there is nothing
wrong with it — it is a claim about the tracker, which is a real source anyone with the repository
can read. What it is not is checkable from this checkout, and a figure that only an external system
can settle goes stale here without anything noticing, exactly as the counts inside these records
did. So it is left to the tracker rather than restated as ours. **This is residue and not a
withdrawal**: the issues are still what the rebuild started from, and a reader who wants the number
should count them where they live.

**What is withdrawn is the reading and not just the number**, and that decides how far the sweep
goes. A claim about one dependent project is sourced the same way as a claim about five, so it does
not survive by being smaller. **The sweep took two forms, and this sentence used to name only one**
— it said the claims were restated as "not known to us" wherever they stand, which sends a reader to
0004 looking for words that are not there. Where a weaker claim survives the withdrawal it is
restated at that strength: 0004's removed extension point ("no consumer of the removed extension
point is known to us"), this record's Context and Decision Outcome, and 0003's Context and More
Information. Where nothing survives, the ground is dropped rather than restated: this record's
Decision Drivers no longer argues from where consumers sit, and 0004's break-surface consequence
keeps the figure it can re-run over this repository and says the dependent-project one is withdrawn
rather than restated. Restating one record and leaving the others is what made this a second finding
rather than a closed one, so the sweep is recorded here by location **and form**, and a claim that
turns up outside this list — or a location whose wording does not match the form claimed for it — is
a defect in the sweep.

### A defect the shipped path has and the rebuilt one does not, measured

Not offered as the reason for this decision — the decision was taken on the argument above and this
arrived four rounds after it. It is here because it is the shape that argument predicts, and because
it was measured rather than reasoned about.

The transport normalizes a relay URL before it connects and reports connection state under the
normalized spelling, while the record it returns for the configured defaults keeps the caller's
spelling on both key and value. **A plain trailing slash is enough to make those two disagree** —
measured against the resolved version, with a fresh client per case. The shipped `useConnections`
seeds its list from the configured spelling and then merges connection-state packets keyed by
whatever they carry, grouping on that field. So a relay configured as `ws://host:9988/` comes out
**twice**, reproduced end to end:

```
["ws://localhost:9988/=initialized", "ws://localhost:9988=connected"]
```

The seeded half never updates, because no packet will ever carry that spelling. A consumer rendering
a connection list sees one relay as two, one of them permanently `initialized`.

**That block is read by `CN1`, and this record is the only copy of it.** It was a quoted output with
nothing behind it for as long as it stood here — the one counterexample in current public behaviour,
in the record that outlives every test that could have checked it, with the characterization suite
exercising a spelling that has no trailing slash and so never walking the branch. `CN1` locates this
fence by its shape and takes both the configured input and the expected output from it, so a
character changed here fails rather than drifts; and it fails on the comparison rather than on a
timeout if the duplication ever stops, which is what a characterization test is for. **Which
direction that runs matters and was chosen deliberately**: the test reads the record because the
record is what survives, and a record citing a test id it cannot check is the same unchecked claim
one level indirect. **`CN1` itself is the spike branch's**: these records reached the library's main
line without it, and carrying it there is the port's (`0005`'s roster, the `src/tests/stores/`
line); until it lands, nothing on that line checks this fence.

**What makes it evidence about the split rather than a bug report** is where the fix has to go. On
the shipped path the relay's identity is whatever string the caller wrote, established nowhere and
agreed with nothing; there is no boundary at which to canonicalize it, which is what "the identity
is not owned" means in practice. The rebuilt path has that boundary — the scope canonicalizes on the
way in and the request's tables are keyed by the result — and the same class of defect appeared
there too, twice, and was closed by changing one function. **Being fixable in one place is the
property being bought.**

The defect above is not fixed here. It belongs to a released surface these records replace rather
than repair, and repairing it in place would need its own decision about what a released
`useConnections` may change.

### What these records narrowed, when, and at whose instruction

A decision that admits fewer implementations than it did has cost somebody something, and the way to
stop paying that silently is to write down that it was paid. Each of 0002–0004 argues its own
narrowings where they happen. What could not be read anywhere was the list — which row, in which
review round, and whether the change was asked for or chosen — and 0002 pointed at such a list twice
while the only one that existed was in a submission. **A submission is correspondence: it does not
survive this branch, and a record that points at correspondence for its own accounting points at
nothing.** So the list is here, in a record that ships.

**Strengthened** means the decision admits fewer implementations than it did; **relaxed** means it
admits more. The falsifier is tracked in its own column because the two come apart, and the
combination worth catching is a claim strengthened while its falsifier quietly loses a case.

| Round     | Row              | The edit                                                                                                                                                                                                                                                                                                                                               | Decision                                                                                                          | Falsifier                                                                                                                                                                                         | Whose call                                                                                                                                              |
| --------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r23       | `A-ε` (0002)     | the outcome's causal list gains **the events the attempt accepted**, and the end releases its producer without discarding what it had                                                                                                                                                                                                                  | strengthened                                                                                                      | pure extension — both original clauses kept verbatim, a third added                                                                                                                               | **reviewer** — the r22 review reproduced the loss against the shipped dependency. The clause chosen to repair it is this set's                          |
| r24       | `A-ε` (0002)     | `accepted` limited to past the signature gate **and only if it passed before the wait it belongs to ended**                                                                                                                                                                                                                                            | strengthened                                                                                                      | one case deleted, two disjuncts added                                                                                                                                                             | **reviewer** — their first recommendation, adopted as offered                                                                                           |
| r24       | `A-ε` (0002)     | the release clause's object follows that definition: what the producer had **accepted**, not what it handed over                                                                                                                                                                                                                                       | relaxed                                                                                                           | unchanged                                                                                                                                                                                         | **author** — a consequence of the row above, and it is a relaxation rather than a tidy-up                                                               |
| r24       | `B-θ` (0003)     | the silence limited to **counts and reasons**, with one bit (`hasMatchEvidence`) published instead                                                                                                                                                                                                                                                     | strengthened                                                                                                      | gains a disjunct                                                                                                                                                                                  | **reviewer** — a blocker, and their first option adopted                                                                                                |
| r24       | `B-η` (0003)     | the clause scoped to the attempt that published the list                                                                                                                                                                                                                                                                                               | relaxed — a correction                                                                                            | easier                                                                                                                                                                                            | **reviewer** — a blocker                                                                                                                                |
| r24       | `B-η` (0003)     | the flat list contracted as a **concatenation rather than a set**                                                                                                                                                                                                                                                                                      | strengthened                                                                                                      | harder                                                                                                                                                                                            | **author** — closing that blocker by scoping alone is the move these records refuse elsewhere: the falsifier got easier, so something had to get harder |
| r25       | `A-ε` (0002)     | a backward cut reported under `verification-timeout` rather than folded into `timeout`, and the cut's report split per leg                                                                                                                                                                                                                             | strengthened                                                                                                      | gains a disjunct — a backward cut reported under `timeout`, the cause that says the request stopped waiting on a backward target rather than hearing from it, now falsifies it                    | **reviewer** — a blocker, and their first recommendation adopted as offered                                                                             |
| r28       | `A5` (0002)      | the states that end a relay's part of a leg made **absorbing in the decision itself**, over both tables rather than in one table's prose and the other's code: the first such state a relay reaches is what the attempt keeps, and every later signal naming that relay is dropped                                                                     | strengthened                                                                                                      | pure extension — nothing deleted, two disjuncts added (a determined relay moved off its state by a later signal; an observed REQ putting an answered relay back among those the backlog waits on) | **reviewer** — a blocker, and their minimum condition 1 adopted, widened from the backward table to both                                                |
| r29       | `B-α` (0003)     | the falsifier names the reached form of "the scope and the connection disagree" — a relay whose canonicalization differs between this library and the transport, so an `EOSE` from a relay that answered lands under a key the request does not hold — and the decision text gains the agreement obligation and a port's construction-time refusal     | unchanged in what it admits: the decision already forbade the disagreement                                        | pure extension — one disjunct made concrete, none deleted                                                                                                                                         | **reviewer** — a blocker, and reproduced as a counterexample in current public behaviour rather than predicted                                          |
| r30       | `B-α` (0003)     | the relay's name is the transport's own answer to the caller's input, applied **once**, and a name the transport would not return unchanged is refused rather than converged on. The round before had iterated to a fixed point, which re-addressed the request — `?x=%2526y=1` is one query parameter after one application and two after convergence | **strengthened** — spellings this design accepted last round are refused now                                      | extension: a spelling that should be refused being accepted now falsifies it, and nothing was deleted                                                                                             | **reviewer** — a blocker, with the counterexample measured against the resolved transport                                                               |
| r31       | `B-α` (0003)     | the relay's name is the **transport's own answer to the caller's string**, asked one relay at a time, rather than this library's transcription checked against the transport. The transcription stops deciding anything a scope depends on                                                                                                             | **relaxed** — a transport that names a relay differently is obeyed rather than refused, so the accepted set grows | gains a disjunct: routing to a name the transport did not give                                                                                                                                    | **reviewer** — a blocker, with the counterexample measured as a future transport the old comparison could not see                                       |
| r31       | `B-α` (0003)     | an input that is not a `ws:`/`wss:` URL with boolean capabilities is refused **before the transport is asked anything**                                                                                                                                                                                                                                | **strengthened** — inputs that used to become relays are refused                                                  | gains a disjunct: a non-URL becoming a relay, and several of them becoming one                                                                                                                    | **author** — found by an adversarial pass with no brief, not by the review                                                                              |
| r31       | `C16` (0004)     | a refused relay list throws at first construction and is caught on a later prop change, where the previous generation stays and the refusal is published on the diagnostics hook                                                                                                                                                                       | **new decision** — the published surface gains one error class and a code union                                   | its falsifier is the row's own: a refused update that tears the subtree down, or a refusal a consumer cannot tell the cause of                                                                    | **reviewer** — a blocker                                                                                                                                |
| r20       | `A11-P1` (0002)  | the counting rows made about **the act that opens the producer** rather than the call beside it: one call to `streamFn` and exactly one iterator, where the row had counted calls alone                                                                                                                                                                | **strengthened** — an implementation that called once and acquired twice used to satisfy it                       | gains a disjunct: a second acquisition of one call's value                                                                                                                                        | **author** — found by a pass with no brief, and the round's own lesson (“count the act that opens the resource”)                                        |
| r21       | `A11-C17` (0002) | singularity written as **three clauses** rather than one reading, and the weaker option — closing the acquisition door and leaving the call door open — refused rather than carried as residue                                                                                                                                                         | **strengthened** — a conforming source that mints a producer per acquisition is now outside it                    | gains a disjunct: a late acquisition that starts a second subscription                                                                                                                            | **author** — the ledger produced the counterexample: an entry whose mutant is a normal shape for a port                                                 |
| r33       | `C16` (0004)     | a **fifth** code, `transport-incompatible`, for the case that used to be reported as the consumer's own list being wrong                                                                                                                                                                                                                               | **new** — the published union grows one member                                                                    | unchanged in shape; the added case is a refusal a consumer could not have told the cause of                                                                                                       | **author**, and the _shape_ of the fifth code was escalated as a product decision rather than settled in the record                                     |
| r34       | `B-η` (0003)     | the relay's message bounded by **size** — 4 096 UTF-16 code units — and not only by count                                                                                                                                                                                                                                                              | **strengthened** — a relay that rewords at length used to satisfy it                                              | gains a disjunct: a published notice longer than the bound, or a cut one presented as whole                                                                                                       | **reviewer** — the clause was satisfied for two rounds while only the count was bounded                                                                 |
| ruling 13 | `C16` (0004)     | the r31 row reversed: a refused **first** relay list no longer throws — the provider stands with an empty accepted scope and the refusal is published on the diagnostics hook, as a later refusal already was                                                                                                                                          | **relaxed** — a provider whose first list is refused now mounts its subtree                                       | replaced: a refused list that tears the subtree down, at first construction or later, now falsifies it                                                                                            | **reviewer** — 0004's ruling 13, because a relay list is untrusted input                                                                                |

**The deleted falsifier case is entered as a cost and not netted against the row above it.** `A-ε`
lost "not falsified by a candidate still being verified when the wait was cut". Deleting a falsifier
is worse than narrowing a claim rather than smaller than it — a narrowed claim is still refutable
and a deleted one is not — and the defence available here is weaker than it looks: the case went
because the definition of `accepted` moved under it, not because the shipping code satisfied it, and
"the definition changed, so the counterexample stopped being one" sits next to closing a blocker by
rewording its falsifier. What is offered against that is that the same edit added two disjuncts, one
of them built so that a defect found in the same round had a falsifier at all.

**This table does not restate the arguments.** Each row's case is made in the record that owns it:
0002's `A-ε`, `A5` and `A11` sections, 0003's `B-θ`, `B-η` and relay-naming sections, 0004's
"Refusing a relay list". So there is one place to correct when one of them changes. **A narrowing
argued in its own record and missing from this table is a defect in this table**, which is the only
claim the table itself makes — **with one class excepted, and named**: the eighteen rulings in 0004
change decisions too, and 0004's own "Where each ruling stands" table is their list, so they are not
copied here. The one entered above is the ruling that reversed a row of this table.

**It was that defect, and an external reviewer read it before this table's own author did.** The
list stopped at r31 while four narrowings had been argued in their records since — two of them
_before_ the table's first row, which is worse than the stale end: `A11-P1` and `A11-C17` were the
rounds where singularity stopped being a reading and became a bound, and the table began at r23
without saying that it did. The pointer sentence above was wrong too, and in a way that sends a
reader to the wrong file: it accounted for seven of thirteen rows and named 0003's `B-θ`/`B-η`
sections for "the rest", while the `A5` row is argued in 0002, the four `B-α` rows in 0003's
relay-naming section, and the `C16` row in 0004. Both are repaired above, and the rounds were
recovered from `git log -S` against the introducing commit rather than from memory.
