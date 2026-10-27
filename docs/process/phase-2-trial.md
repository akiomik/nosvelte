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
- **The repairs** get one narrow pass over the repair diff.
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

**Every other finding is fixed if it is cheap.** If it is not, it is written down as an accepted
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
| The routes of `A-ε-C3` (#175) and of `A5-C12`/`A5-C13` (#181)                           | G1's plan                                |
| `0002` A16's standalone arm, kept by the code (#167)                                    | G2                                       |
| Refusal text bounds, a send's verifier failure, and `ots` (#156, #157, #164)            | G3                                       |
| Whether evidence from the landings before the ledgers had a home stands as it is (#148) | any time                                 |
| A narrow patch of the legacy surface for #163, ahead of v1                              | any time; worth more the sooner it comes |

## Trial record

**Baseline: the last two landings before the trial**, from their PR bodies.

| PR   | Rows (net `TBD`) | Reviewer invocations                                         | Repair rounds | Ledger                                                            | Issues filed | Limitations in the PR |
| ---- | ---------------- | ------------------------------------------------------------ | ------------- | ----------------------------------------------------------------- | ------------ | --------------------- |
| #192 | −3               | 8: plan 2 (rejected, then revised), full 2 readers, narrow 4 | 4             | 38 entries, 5.4 min                                               | 0            | 2 ("Known limits")    |
| #194 | −3               | 5: plan 1, full 2 readers, repair plan 1, narrow 1           | 1             | 36 entries, 2.5 min, plus a neighbouring 38-entry ledger, 5.4 min | 1 (#193)     | 2 ("Known limits")    |

The seeded-defect baseline, then G1, G2 and G3, are added here as each is done.
