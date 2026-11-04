# Phase 2: a three-week trial of working by consumer operation

**Status:** in trial from 2026-10-28 to 2026-11-17. At its end the maintainer reads the trial
record below and keeps this way of working, changes it, or drops it.

This document changes no decision record. The rule that ends phase 2 and the rule a landing is held
to stand as `docs/decisions/0005-contract-catalogue.md` writes them; what changes is how the work
toward them is grouped, reviewed and tracked.

## Why

Measured on 2026-10-27, at `88692fc`:

- **Issues accumulate.** 30 issues were opened after #126 and 3 were closed. Of the 27 open, two
  are library behaviour a consumer can reach (#156, #164). The rest are:
  - gaps in the arms or the checking apparatus;
  - records out of step with the tree;
  - decisions only the maintainer can take;
  - disclosures about the legacy surface;
  - tooling.
- **No recent landing fixed a demonstrated consumer defect.** From #173 to #194, nine landings
  reduced the `TBD` count by 41 (250 to 209), and none of them fixed a demonstrated consumer
  defect. The landings before them did: #134, #142, #155, #162 and #171. This does not show that
  the code is correct: two landed arms are known to pass a plausible wrong library (#179, #193).
- **Progress is the net `TBD` drop.** The rows owing a disposition grew from 342 to 351 over the
  phase, so the number of rows landed overstates progress. At the recent rate, the 209 rows left
  take roughly 66 to 109 more calendar days.
- **Users still meet the legacy bugs.** 13 lines of 0005's legacy map are `gap`: bugs that users of
  the published 0.x surface still meet, and that no row yet reproduces. v1 cannot become the
  package's entry while any of them remains.

**What generates the issues.**

- **Every finding that is not cheap becomes an issue.** The stopping rule sends it there, and no
  regular cycle disposes of it afterwards: one triage on 2026-10-15 commented on fourteen issues
  and closed none.
- **Universal clauses multiply the evidence a row owes.**
- **Instruments start their own repair stream.** An instrument built to hold a universal clause
  gets repaired round after round.
- **Phase-1 routes surface as decisions halfway through a landing** (#167, #175, #181).
- **Evidence cells mix the current obligation with the history of how it was reached.** So every
  new sentence is one more claim a reviewer can falsify, whether or not the library changed.

## What does not change

- **Phase 2 is complete when no row's evidence is `TBD`** (0005, "Phase 2 is complete when …").
- **The landing rule.** A landing fails under a mutation of each of its row's Then clauses. The
  mutations are kept as a ledger under `scripts/ledgers/` and rerun at the commit.
- **`npm test` still checks** that every landing runs once, at its declared place, and passes.
- **The order 0005 adjudicated.** Slices are added in dependency and ownership order, and each
  slice terminates the rows it covers as it lands. The groups below are such slices.

## What the trial changes

### 1. The unit of work is a consumer operation

The trial has three groups, one a week. Each group's plan fixes its rows from the candidates below,
and checks each candidate legacy gap against the map. A group is complete when all of the following
hold:

- its operation is witnessed end to end through the published entry;
- each issue assigned to it is closed, or disposed of with a written reason;
- the legacy gaps it takes read `covered`.

If an operation does not fit its week, it is finished first and the next group starts later. A
partial operation is not credited to make a week.

| Group  | Operation                                       | Issues                                                   | Legacy gaps (candidates)     | `TBD` rows (candidates)                                                                                                                                  |
| ------ | ----------------------------------------------- | -------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1** | receive, replace, settle, end                   | #193, #179, #186, #177, #191; decisions on #175 and #181 | #90, #78, #86, #68, #85      | `A5-C12`, `A5-C13`, `A-ε-C3` (once routed), `A-α-C1`–`C4`, `B-γ-C1`, `C3-C2`, `C5-C3`, `A5-C3`, `A5-S4`                                                  |
| **G2** | change a descriptor, refresh, unmount           | #149 (its `refresh()` paths); the decision on #167       | #61, #73, #81, #87, #95, #77 | `C6-C10`, `A6-C5`, `B-η-C5`, `B10-C5`, `A11-C10`, `C6-C3`, `C6-C9`, `A15-C3`                                                                             |
| **G3** | server render, a send's round trip, the package | #160, #164, #156, #157, #149 (its send paths)            | #69, #91                     | `C3-C1`, `C8-C2`, `C8-C3`, `A6-C2`, `A6-C7`, and a rehearsal of the package a consumer would install: manifest, declarations, browser and server entries |

**The package rehearsal belongs to G3, not to the release.** v1 imports `tanstack-svelte-query-v6`,
which is a devDependency today, and the manifest's `svelte` peer still admits 4. Both are expected
release changes, and the rehearsal is where they stop being a surprise.

### 2. Review depth follows what a miss would cost

- **The plan** goes to an outside reviewer only when the group changes a row's text or route, or
  builds a shared instrument. Otherwise the plan is written in the PR, and the full review reads it
  there.
- **The full review** is one integrated pass by an outside reviewer on a frozen candidate. A second
  reader is added only for a question its prompt names, which the first reader cannot answer.
- **The repairs** get one narrow pass over the repair diff. **From G2**, a repair that is only
  wording gets none. It is only wording when it changes no code, arm or instrument, nor what a row
  or a promise says, nor what an Evidence cell says is read. The PR names each such repair.
- **From G2, the questions on repair directions that one review raises go to the maintainer
  together**, with one second opinion covering them.
- **Where the depth goes:**
  - Consumer behaviour, event ownership, admission, and what the package publishes get a review of
    the outcome a consumer sees, whatever the owning row's route is.
  - A purely internal distinction with no consumer consequence gets one focused review against its
    row.
  - A shared instrument is reviewed once, as a component, against the forms it declares it supports.
    It is not reviewed again in every landing that uses it.

### 3. The stopping rule

**A finding reopens a round only when it names one of two things:**

- **(a)** a library defect; or
- **(b)** a plausible implementation that breaks a consumer promise through a supported entry or
  environment, and that the group's required witnesses accept.

**Every other finding is fixed if it is cheap.** **From G2**, the cheap findings of one review are
fixed together, in one repair round, and a fix is cheap only with the verification it brings counted
in. If it is not, it is written down as an accepted
limitation in the PR's **Accepted limitations** section: one line each, naming the instrument or the
promise it concerns, so that limitations can be counted like issues. It goes into the row as well
only where it bounds what the row claims.

**An instrument states the forms it supports and refuses the rest.** A further spelling it refuses
is a limitation, not a reopening.

**A candidate is ready for review when its known in-scope defects are closed and its limitations are
written down.** It does not have to wait for a search that finds nothing more.

This section goes verbatim into every review prompt.

### 4. Issues

**An issue is filed only for one of these:**

- a library defect a consumer can reach;
- a gap of kind (b) above that the group could not close;
- a decision only the maintainer can take.

Every other residue is an accepted limitation in its PR. The 27 issues open on 2026-10-27 are
disposed of as follows:

| Disposition                                                   | Issues                                                                                                                                                |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Close under §3**, each with its reason written              | #150 (the cache reader is kept as redundant support), #158 (unsupported constructions are refused), #168 (unsupported marker formatting fails closed) |
| **Close once the maintainer decides on pre-ledger evidence**  | #148                                                                                                                                                  |
| **Keep** until the release that switches the entry            | #163, #166                                                                                                                                            |
| **G1**                                                        | #175, #177, #179, #181, #186, #191, #193                                                                                                              |
| **G2**                                                        | #149 (its `refresh()` paths), #167                                                                                                                    |
| **G3**                                                        | #149 (its send paths), #156, #157, #160, #164                                                                                                         |
| **Records and instruments**, one batch beside the groups      | #161, #169, #178, #187, #188                                                                                                                          |
| **Tooling and cost**, one batch beside the groups, #154 first | #140, #151, #154                                                                                                                                      |

**The two batches beside the groups** get a fixed share of each week, and stop at it. #154 comes
first, because the trial runs the suite more often.

### 5. Evidence cells

A row landed during the trial writes four things in its Evidence cell:

- what is read;
- where and when it is read;
- the ledger entries that matter;
- the limitations.

**Aim for under 1 500 characters.** How the cell was reached — earlier arrangements, reviewers'
edits, dates — goes in the PR body. Cells landed before the trial are left as they are.

## How the trial is checked

Each group records three measures in the trial record below. The baseline is measured before G1.

1. **Detection, by seeded defects.**
   - **Who picks them.** Before G1, and after each group, an outside reviewer who has not read the
     ledgers proposes realistic defects against promises the maintainer picks. Each defect must
     compile and give a wrong consumer outcome through a supported entry, which the reviewer shows
     with a probe of its own. The baseline round also carries three known defects:
     - the replacement loss of #193;
     - the early settlement of #179;
     - the impossible-leg refusal of #186.
   - **How each is run.** Each defect is applied alone, and the arms for its operation are run.
     The whole suite is run only for a defect that survives them.
   - **What is recorded**, for each defect, is what caught it: a consumer assertion, an internal
     assertion, a source-shape check, an infrastructure failure — or nothing.
   - **A survivor blocks its operation.** One that survives in an operation called complete is
     repaired before that operation counts as complete.
   - **After a round, the defects become regressions.** They are kept as a ledger,
     `scripts/ledgers/trial-seeds.ts`, and each later round gets fresh ones.
   - **A round is timeboxed** to one working day.
2. **Delivery.**
   - The net `TBD` drop, reported apart from obligations reopened and limitations accepted.
   - The legacy gaps covered.
   - The release checks, which include G3's package rehearsal.
3. **Cost and recurrence.**
   - Per group: reviewer invocations, repair rounds and ledger run time.
   - **The residue, counted together:** issues filed, by kind, **and** limitations accepted, each
     named by the instrument or the promise it concerns. An issue closed under §3 or by a decision
     is reported as disposed of, not as fixed.
   - Whether one instrument family left residue — an issue or a limitation — in two groups running.

**The trial has failed if any of these happens:**

- a seeded defect survives every required witness in an operation called complete;
- an instrument family leaves residue — an issue or an accepted limitation — in two successive
  groups;
- reviewer invocations and repair rounds per group are not below the baseline;
- a group closes rows without covering the legacy gaps it took.

**Detection is what judges the trial.** The trial lowers the issue count by itself: §4 files fewer
issues, three close under §3, and a fourth closes on a decision. It lowers the number of reviews by
itself too, since §2 prescribes fewer. So neither number falling is evidence that the trial worked.
They are recorded to show what the trial spent and what it left, read beside what detection found.

**What a failure changes.** The depth comes back at the boundary that escaped. A failure does not
bring back every step the trial removed.

## Decisions the trial needs, and when

| Decision                                                                                | Needed before                            |
| --------------------------------------------------------------------------------------- | ---------------------------------------- |
| The routes of `A-ε-C3` (#175) and of `A5-C12`/`A5-C13` (#181)                           | G1's plan; **taken 2026-10-27**, below   |
| `0002` A16's standalone arm, kept by the code (#167)                                    | G2                                       |
| Refusal text bounds, a send's verifier failure, and `ots` (#156, #157, #164)            | G3                                       |
| Whether evidence from the landings before the ledgers had a home stands as it is (#148) | any time                                 |
| A narrow patch of the legacy surface for #163, ahead of v1                              | any time; worth more the sooner it comes |
| What follows G1's cost failure                                                          | G2; **taken 2026-11-04**, below          |

**Taken on 2026-10-27, before G1's plan:**

- **#175.** `A-ε-C3` is re-accepted as `internal`. **For refusals, the stream's end decision is
  the delivery boundary**: a refusal routed after the instant the stream's end is decided, when
  the producer's release is queued, is not delivered, including one in the same batch as the frame
  that decided it. Events are not cut there: an event that arrived before that frame is still
  delivered (`A-ε-C5`). Both orders are the order frames arrive in, since two relays share no wire
  order. The public arrangement that delivers such a refusal on this tree is therefore a library
  defect, and G1 fixes it.
- **#181.** `A5-C12` and `A5-C13` are split. The cause clauses stay `public`, and the attribution
  clauses become `internal` rows on the machine seam, as `A5-C18` and `A5-C26` were in #190.

**Taken on 2026-11-04, after G1:**

- **G1 met the third failure condition** (its record, below), and the trial goes on to G2 under
  three changes, marked "From G2" in §2 and §3: a repair that is only wording gets no narrow pass;
  the cheap findings of one review are fixed in one repair round, counting the verification a fix
  brings; and the direction questions of one review go to the maintainer together, with one second
  opinion. Full reviews, the narrow pass on any other repair, the seed rounds and what makes a group
  complete do not change. G1's measure is not rewritten, and G2's is read as taken under these
  changes.

## Trial record

**Baseline: the last two landings before the trial**, from their PR bodies.

| PR   | Rows (net `TBD`) | Reviewer invocations                                         | Repair rounds | Ledger                                                            | Issues filed | Limitations in the PR |
| ---- | ---------------- | ------------------------------------------------------------ | ------------- | ----------------------------------------------------------------- | ------------ | --------------------- |
| #192 | −3               | 8: plan 2 (rejected, then revised), full 2 readers, narrow 4 | 4             | 38 entries, 5.4 min                                               | 0            | 2 ("Known limits")    |
| #194 | −3               | 5: plan 1, full 2 readers, repair plan 1, narrow 1           | 1             | 36 entries, 2.5 min, plus a neighbouring 38-entry ledger, 5.4 min | 1 (#193)     | 2 ("Known limits")    |

**The seeded-defect baseline**, measured 2026-10-27 at `88692fc`.

- **The defects.** The maintainer picked two promises: receiving and display, and how a request
  ends. An outside reviewer who had not read the ledgers proposed five defects against them, two
  more against a stratum it proposed itself (the admission boundary), and wrote the three known
  ones. The list was frozen before any test was opened. Each defect compiles, and a probe of the
  reviewer's own showed each giving a wrong consumer outcome through the published entry: the probe
  passed without the defect and failed with it, at the consumer assertion it was written for. Its
  blindness was partial: a search of local notes showed it historical arm names, which it reports
  it did not use.
- **How they were run.** Each defect alone, against the arm files of its operation, without the
  probe. With no defect applied, each operation's arms passed. Only an assertion failure counts as
  a catch. A catch is a consumer assertion when the arm's row is `public`, and an internal one when
  it is `internal`. The two survivors were then run against the whole suite, without the probes.

| Defect | Stratum              | What it breaks                                           | Caught by                                                                               |
| ------ | -------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| S1     | receive              | the newer revision of a replaceable event wins           | **internal assertions only** (`B5-C1`, `B5-C2`, `B5-C4`, `B5-C5`)                       |
| S2     | receive              | a live event is shown while the backlog is running       | a consumer assertion (`A5-C1`), and internal ones                                       |
| S3     | receive              | the list is newest first                                 | consumer assertions (`A5-C1`, `A5-C16`), and internal ones                              |
| S4     | ending               | only the backlog's `EOSE` completes the backlog          | consumer assertions (`B-α-C11`, `A5-C1`)                                                |
| S5     | ending               | one relay's refusal does not discard another's answer    | consumer assertions (`A5-C6`, `A5-C9`, `A5-C10`, `A5-C15`, `A5-C18`), and internal ones |
| S6     | admission (proposed) | an id inconsistent with the hashed fields is refused     | a consumer assertion (`A-ε-C18`)                                                        |
| S7     | admission (proposed) | a published event's tags cannot be written               | **internal assertions only** (`B5-C6`, `B5-C8`, `A-ε-C15`)                              |
| K1     | known: #193          | the hook keeps the older revision on a replacement       | **nothing**, in its operation's arms or in the whole suite                              |
| K2     | known: #179          | the settle timer fires at 0.8 of the caller's timeout    | a consumer assertion of another row (`A5-C16`), whose wait reaches the deadline         |
| K3     | known: #186          | a `CLOSED` naming a forward leg never opened is acted on | **nothing**, in its operation's arms or in the whole suite                              |

- **Detection:** 5 of 5 fresh defects in the picked promises were caught, 4 of them by a consumer
  assertion. 2 of 2 in the proposed stratum were caught, 1 by a consumer assertion. 1 of 3 known
  defects was caught.
- **For G1:** the replacement promise has no consumer witness. S1 is caught only below the hook,
  and K1, in the hook, is not caught at all. K3 is the claim of #186, which no row holds. K2 is
  caught, but not by `A-γ-C1`'s own landing, which #179 is about.
- **Cost:** one reviewer invocation to propose the defects and probe them, and 9.1 minutes of runs:
  15 runs, of which 3 were baselines and 2 were the whole suite. Three more runs of the one arm that
  caught K2, 10 seconds in all, read what it was handed, to rule out a timing accident.

**G1: receive, replace, settle, end**, from #197, #198, #201, #203 and G1's closing PR, and the seed
rounds of 2026-11-04.

| PR      | Sub-operation                  | Rows (net `TBD`) | Reviewer invocations                            | Repair rounds | Ledger, as the body reports | Issues filed | Limitations in the PR |
| ------- | ------------------------------ | ---------------- | ----------------------------------------------- | ------------- | --------------------------- | ------------ | --------------------- |
| #197    | replace                        | 0                | 5: full 1, narrow 3, second opinion 1           | 4             | 1.2 min                     | 1 (#196)     | 3                     |
| #198    | settle                         | −3               | 6: full 2 readers, second opinion 1, narrow 3   | 4             | 22.5 min                    | 0            | 8                     |
| #201    | end                            | −8               | 4: second opinion 1, full 2 readers, narrow 1   | 3             | 25.1 min                    | 0            | 6                     |
| #203    | failure                        | −1               | 14: full 2 readers, narrow 4, second opinions 8 | 8             | 45.3 min                    | 1 (#202)     | 17                    |
| closing | replace, at the public surface | 0                | 5: second opinions 2, full 1, narrow 2          | 3             | 1.6 min                     | 0            | 5                     |

- **The plan** had two more invocations: one full review and one narrow pass.
- **What the bodies leave out.** #201's body names three invocations and #203's thirteen. Each
  leaves out one second opinion on a repair direction: #201's on a backward `CLOSED` after `EOSE`,
  #203's on the design of the memo. One of #203's second opinions was stopped on a false premise and
  reissued, and both are counted. #203's ledger time is its last runs; with the runs on its earlier
  candidates it is 96.5 min.
- **Repair rounds** are counted as passes of repairs, each answering one review or one finding, the
  maintainer's and the author's own checks included. #203's last two are in one commit, `d2ee9f3`.
- **The closing PR** adds `B5-C11`, the consumer's half of `B5-C1`, `B5-C2` and `B5-C4`, landed by
  `RP1`, for the reason under **Detection**. It adds a row and lands it, so the `TBD` count does not
  move. Its repair rounds are `B5-C11` itself and one answering each pass, and each repair had a
  narrow pass. It also adds `C5-C9` and `C5-C10` to 0005's list of rows whose port column
  carries a condition, which they had been missing from since #203 added them; nothing on main reads
  that list until #187.

**Delivery.**

- **Net `TBD`:** −12, as the plan said. No obligation was reopened.
- **Legacy gaps:** all five taken read `covered` in 0005's map: #68, #78, #85, #86 and #90. They
  stay open under the `legacy` label until v1 replaces the code they were filed against.
- **Issues assigned to G1:** all closed: #193, #179, #186, #177 and #191, and #175 and #181 on the
  decisions above.
- **Release checks:** none in G1. The package rehearsal is G3's.
- **Time:** the plan and the baseline were made on 2026-10-27, and the last of the four landings was
  ready on 2026-11-01. G1 did not fit its week: the seed rounds and the closing PR came on
  2026-11-04, with #203 not yet merged.

**Residue: 2 issues and 39 limitations**, by the instrument or promise each names. Where one family
left more than one:

- a request kept past `NostrApp`: 7 limitations in #203 (a request built after the provider went,
  one running when it went, the earlier result kept, a later deferral, later validation, no signal
  that the provider went, and the adapter handed the same object), and #202;
- the Evidence cells repeating ledger ids nothing checks: 4 (#198, #201, #203, the closing PR);
- `RP1`'s population: 3 (its delivery turn in #197; one author and two events per coordinate, and
  the kinds it reads, in the closing PR);
- the fake clock's readings of a deadline and of live delivery: 3 (#198);
- the console watch: 2 (#203);
- `CP1` and the dependency's NIP-11 registry: 2 (#198).

The other 18 are one each: four rows' domain declarations, `CM3` (#196, also an issue), `NW1`/`NW2`'s
instant, rows landed before the trial keeping their cells, `RJ3`'s window, `DT4`'s task, `OR4`'s
timer, `A-α-C6`'s source search, `A5-C27`'s forced status, a root kept under a provider that
stands, a caller-owned request's extra read, `CW3`'s ways, an idle read of `activity`, the
production run, the placed codes, `TH2`'s message, the ephemeral kinds left to `B5-C7` and `ES7`,
and the arms `trial-seeds` holds three seeds to. Whether a family leaves residue in two groups
running is first readable after G2.

**Detection, after G1.**

- **How the seeds were run.** As in the baseline: each defect alone, against G1's required witness
  files (the plan's lists and the six test files G1 added, 23 files), with no defect applied first.
  Every catch below is an assertion failure, read against the rows 0005's roster names the arm
  under at `59fee0b`. The column **Since `B5-C11`** is a second measurement, taken after the closing
  PR gave the replacement promise a public row: `scripts/ledgers/trial-seeds.ts` at `e207622`, which
  holds each defect to one arm, killed all 21. The first measurement is not rewritten.
- **The retained panel**, the baseline's ten seeds and `TIE`, each ported to `59fee0b` with the same
  lines changed:

| Defect | Caught by, at `59fee0b`                                                                                                         | Since `B5-C11`                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| S1     | **internal assertions only** (`B5-C1`, `B5-C2`, `B5-C4`, `B5-C5`)                                                               | a consumer assertion (`B5-C11`), and the internal ones |
| S2     | consumer assertions (`A5-C1`, `A5-C10`, `A5-C18`), and internal ones                                                            | as before                                              |
| S3     | consumer assertions (`A5-C1`, `A5-C16`), and internal ones                                                                      | as before                                              |
| S4     | consumer assertions (`B-α-C11`, `A5-C1`)                                                                                        | as before                                              |
| S5     | consumer assertions (`A5-C6`, `A5-C9`, `A5-C10`, `A5-C12`, `A5-C13`, `A5-C15`, `A5-C18`, `A5-C29`, `A-α-C4`), and internal ones | as before                                              |
| S6     | a consumer assertion (`A-ε-C18`)                                                                                                | as before                                              |
| S7     | **internal assertions only** (`A-ε-C15`)                                                                                        | as before                                              |
| K1     | **internal assertions only** (`B5-C1`, `B5-C2`, `B5-C4`, through `RP1`)                                                         | a consumer assertion (`B5-C11`)                        |
| K2     | consumer assertions (`A-γ-C1`, its own landing, `A-γ-C7`, `A5-C12`, `A5-C16`)                                                   | as before                                              |
| K3     | a consumer assertion (`A-α-C5`)                                                                                                 | as before                                              |
| TIE    | **internal assertions only** (`B5-C1`, `B5-C2`, `B5-C4`, through `RP1`)                                                         | a consumer assertion (`B5-C11`)                        |

- **The fresh panel.** An outside reviewer who had read no test and no ledger wrote five defects
  against G1's promises (`F1`–`F5`) and five against G2's (`H1`–`H5`), at `59fee0b`, each with a
  probe of its own through the published entry that passed without the defect and failed with it.
  The test files and the ledgers were not checked out in its tree. **Its blindness had one
  exception**: after its list and probes were written and validated, a search of 0005 showed it the
  Evidence cells of eleven rows. It changed no definition after that.

| Defect | Promise | What it breaks                                                 | Caught by, at `59fee0b`                                                                              | Since `B5-C11`                                         |
| ------ | ------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| F1     | receive | two addressable events under different `d` are two coordinates | **internal assertions only** (`B5-C1`, `B5-C2`, `B5-C4`)                                             | a consumer assertion (`B5-C11`), and the internal ones |
| F2     | receive | kind 10000 is replaceable                                      | **internal assertions only** (`B5-C1`, `B5-C2`, `B5-C4`, `B5-C5`, `B5-C7`), not `RP1`                | a consumer assertion (`B5-C11`), and the internal ones |
| F3     | ending  | a backward `CLOSED` ends only the backward leg                 | consumer assertions (`A-α-C2`, `A5-S4`, `A5-C18`, `A5-C29`, `A-ε-C19`, `C5-C8`), and an internal one | as before                                              |
| F4     | ending  | a relay's refusal is reported as a refusal                     | consumer assertions (`A-ε-C1`, `A5-S4`, `A5-C18`, `A5-C29`), and an internal one                     | as before                                              |
| F5     | ending  | the settle timer runs to the timeout                           | a consumer assertion (`B-α-C11`)                                                                     | as before                                              |

- **Against G2's promises**, before G2, with the arm files the reviewer named for them: `H1`, a plan
  read once and kept, consumer assertions (`C5-C8`, `C5-C9`) and internal ones; `H2`, a refresh
  reusing the ids of the attempt before it, consumer assertions (`A5-C6`, `A5-C20`, `A5-S4`); `H3`, a
  new attempt keeping the old forward leg, **only arms on no roster line** (`ES14`, `ES16`, `ES18`,
  `ES19`); `H4`, an unmounted consumer's request not cancelled, a consumer assertion (`A5-C21`) and
  internal ones; `H5`, the query client not cleared when the provider goes, **internal assertions
  only** (`C5-C6`, `B5-C10`). These are G2's starting point.
- **Detection:** no defect survived, so no run of the whole suite was needed. At `59fee0b`, 11 of 11
  retained defects were caught, 7 by a consumer assertion, and 5 of 5 fresh ones in G1's promises,
  3 by a consumer assertion. Since `B5-C11`, 10 of the 11 and all 5 are caught by a consumer
  assertion.
- **For the replacement promise, the plan's gap closed only with the closing PR.** The plan said it
  had no consumer witness; #197 added `RP1` through the published entry, and its body said `K1`,
  `TIE` and `S1` "each fail a consumer assertion (`RP1`)". By this record's rule they did not: `RP1`
  was a supporting arm of three `internal` rows, so at `59fee0b` every defect in the promise — `S1`,
  `K1`, `TIE`, `F1`, `F2` — counted as internal, and `F2` was not caught through the published
  entry at all. The closing PR gave the promise a public row, `B5-C11`, landed by `RP1`, and
  extended `RP1` to each kind where a class that replaces begins or ends.
- **The seeds are kept** as `scripts/ledgers/trial-seeds.ts`, each held to an arm that catches it.
- **Cost of the rounds:** one reviewer invocation to propose the fresh defects and probe them; 9.0
  minutes of runs for the retained panel and 8.6 for the fresh one, baselines included; and 8.3
  minutes of `trial-seeds`, its first run on the retained entries and its full run.

**Cost.** **The third failure condition is met.** G1 spent 36 reviewer invocations and 22 repair
rounds over five landings for a net `TBD` drop of 12, against the baseline's 13 and 5 over two
landings for a drop of 6: above it per group, which is the condition, and also per landing (7.2 and
4.4 against 6.5 and 2.5) and per row removed (3.0 and 1.83 against 2.17 and 0.83).

- **13 of the 36 are second opinions**, asked under a rule the maintainer set on 2026-10-28, after
  the baseline: that a question about a repair direction carries one. The baseline's landings have
  none. Without them G1's invocations are 23, below the baseline per landing (4.6) and per row
  (1.92) and above it per group. The repair rounds are above it however they are read, and they
  drive the narrow passes. The scored figure stays 36.
- **Ledger time**, as the bodies report it, is 95.7 minutes against the baseline's 13.3, and 146.9
  with #203's runs on earlier candidates.
- **The other conditions:** no seeded defect survived, and the legacy gaps G1 took are covered.
  Whether a family recurs is first readable after G2.
- **What follows** was decided on 2026-11-04, under "Decisions the trial needs": G2 goes on under
  three changes to §2 and §3, and this measure is not rewritten.

G2 and G3 are added here as each is done.
