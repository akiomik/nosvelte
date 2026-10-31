/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of the ordering rows of A-ε and their landings:
 * `A-ε-C1` on `OR1`, `A-ε-C2` on `OR2`, `A-ε-C5` on `OR3`, `A-ε-C3` on `OR4` and
 * `A-ε-C19` on `OR5`. An id beginning `C<n>-` edits the library; one beginning `I-` edits one of the arms' own
 * instruments. Kill sets are measured here, not copied from the spike.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const HOOK = 'src/lib/v1/useStreamedReq.svelte.ts';
const ARMS = 'src/tests/contracts/engine/order.test.ts';

/** The settle callback's opening, queued behind the turn that decided it. */
const SETTLE_QUEUED = '    // After the turn the count is a fact.\n    queueMicrotask(() => {\n';
/** And its closing. */
const SETTLE_QUEUED_END = '        if (!live || forwardEnded) finish();\n      });\n    });\n  };';
/** The line that ends a refusal's route at the stream's end, with the comment that closes above it. */
const REFUSAL_GUARD = '      // and it is owed delivery (`A-ε-C5`).\n      if (ending) return;\n';

export default {
  name: 'a-epsilon-order',
  subject:
    '`A-ε-C1`, `A-ε-C2`, `A-ε-C3`, `A-ε-C5` and `A-ε-C19` (what reaches a consumer around the end of a stream): their landings, `OR1`–`OR5`',
  files: [ARMS],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that last changed the arms, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { OR1: 5, OR2: 5, OR3: 4, OR4: 4, OR5: 5 }
  },
  entries: [
    {
      id: 'C1-the-marker-overtakes-its-refusal',
      arm: 'OR1',
      describe:
        "the backlog's end is pushed in the turn that decided it, ahead of the refusal the dependency routes after completing the subscription — so the refusal reaches an attempt that has already ended and the answer says `complete`",
      edits: [
        {
          file: MACHINE,
          from: SETTLE_QUEUED,
          to: '    // After the turn the count is a fact.\n    (() => {\n'
        },
        {
          file: MACHINE,
          from: SETTLE_QUEUED_END,
          to: '        if (!live || forwardEnded) finish();\n      });\n    })();\n  };'
        }
      ]
    },
    {
      id: 'C1-the-end-derived-when-it-is-decided',
      arm: 'OR1',
      describe:
        'the outcome is a photograph of the per-relay table taken when the end is decided, before the refusal has been routed into it — `timeout` beside `refused`',
      edits: [
        {
          file: MACHINE,
          from: "  | { type: 'settled'; viaTimer: boolean }",
          to: "  | { type: 'settled'; viaTimer: boolean; end?: BacklogEnd }"
        },
        {
          file: MACHINE,
          from: '    if (settled) return;\n    settled = true;\n',
          to: '    if (settled) return;\n    settled = true;\n    const decided = backwardEnd(viaTimer);\n'
        },
        {
          file: MACHINE,
          from: "        push({ type: 'settled', viaTimer });",
          to: "        push({ type: 'settled', viaTimer, end: decided });"
        },
        {
          file: MACHINE,
          from: "if (next.type === 'settled') yield { type: 'settled', end: backwardEnd(next.viaTimer) };",
          to: "if (next.type === 'settled') yield { type: 'settled', end: next.end ?? backwardEnd(next.viaTimer) };"
        }
      ]
    },
    {
      id: 'C1-refresh-answers-on-any-attempt',
      arm: 'OR1',
      describe:
        "a refresh resolves on whichever attempt's end is already on the value — the previous answer, `complete`, before its own attempt is refused",
      edits: [
        {
          file: HOOK,
          from: '      const ended = data?.backlog?.attemptId === mine;',
          to: '      const ended = data?.backlog !== undefined;'
        }
      ]
    },
    {
      id: 'C1-the-diagnostics-a-task-behind',
      arm: 'OR1',
      describe:
        'the diagnostics read a copy of the value one task behind the state, so the outcome is reported before the refusal explaining it is — every read made after a wait still agrees',
      edits: [
        {
          file: HOOK,
          from: "  $effect(() => {\n    // Guarded like every other read of the caller's object: this one arms a",
          to: "  let laggedData = $state.raw(query.data);\n  $effect(() => {\n    const data = query.data;\n    setTimeout(() => {\n      laggedData = data;\n    }, 0);\n  });\n  $effect(() => {\n    // Guarded like every other read of the caller's object: this one arms a"
        },
        {
          file: HOOK,
          from: '      return deriveDiagnostics(this.state, query.data, rejectedWith() ?? refusedOnServer);',
          to: '      return deriveDiagnostics(this.state, laggedData, rejectedWith() ?? refusedOnServer);'
        }
      ]
    },
    {
      id: 'C2-the-forward-end-tears-down-a-waiting-backlog',
      arm: 'OR2',
      describe:
        "the forward leg's end ends the stream even while the backlog is still waiting, which closes the backward subscription and its timer — no outcome at all, `streaming` and `live` for ever",
      edits: [
        {
          file: MACHINE,
          from: '    if (settled) finish();\n  };',
          to: '    finish();\n  };'
        }
      ]
    },
    {
      id: 'C2-the-forward-end-counts-the-backlog-answered',
      arm: 'OR2',
      describe:
        "the forward leg's end marks every backlog relay as having answered, so the outcome says `complete` for a backlog nobody answered",
      edits: [
        {
          file: MACHINE,
          from: '    forwardEnded = true;\n',
          to: "    forwardEnded = true;\n    for (const url of backwardTargets.keys()) advanceBackward(url, 'complete');\n"
        }
      ]
    },
    {
      id: 'C5-the-end-decided-synchronously',
      arm: 'OR3',
      describe:
        'the end releases the producer in the turn that decided it, before the event the relay sent in the same batch has been routed — the event is lost',
      edits: [
        {
          file: MACHINE,
          from: '    ending = true;\n    queueMicrotask(() => {\n      closeAll();',
          to: '    ending = true;\n    (() => {\n      closeAll();'
        },
        {
          file: MACHINE,
          from: "          push({ type: 'end' });\n        });\n      });\n    });\n  };",
          to: "          push({ type: 'end' });\n        });\n      });\n    })();\n  };"
        }
      ]
    },
    {
      id: 'C5-forward-events-refused-once-the-end-is-decided',
      arm: 'OR3',
      describe:
        'a forward event that reaches the gate after the end was decided is refused entry, though the relay sent it before',
      edits: [
        {
          file: MACHINE,
          from: '  const admitEvent = (leg: LegName, incoming: EventPacket) => {\n    const gate = gates[leg];',
          to: "  const admitEvent = (leg: LegName, incoming: EventPacket) => {\n    const gate = gates[leg];\n    if (leg === 'forward' && ending) return;"
        }
      ]
    },
    {
      id: 'I-or2-the-first-attempt-refused-on-a-refresh',
      arm: 'OR2',
      describe:
        "the refresh run refuses the first attempt's forward subscription instead of the refreshed one, so the refreshed attempt's forward leg goes on and the request never goes idle",
      edits: [
        {
          file: ARMS,
          from: "        one.relay.send(['CLOSED', againForward, 'blocked: aRefreshedAttempt']);",
          to: "        void againForward;\n        one.relay.send(['CLOSED', forward, 'blocked: aRefreshedAttempt']);"
        }
      ]
    },
    {
      id: 'I-or3-the-batch-before-the-backlog-settled',
      arm: 'OR3',
      describe:
        'the batch is sent without waiting for the backlog to settle, which the arm reads as its arrangement and fails on',
      edits: [
        {
          file: ARMS,
          from: "          respondWithEose(server, backward);\n          await vi.waitFor(() => expect(shape()).toContain('settled'), { timeout: 3000 });\n        }\n        const beforeTheBatch",
          to: '          respondWithEose(server, backward);\n        }\n        const beforeTheBatch'
        }
      ]
    },
    {
      id: 'C5-a-late-verdict-is-dropped',
      arm: 'OR3',
      describe:
        'the end marks the forward candidates discarded one task after it is decided, and keeps its wait — a verdict that comes inside the wait after that is dropped, which only the run answering late can see',
      edits: [
        {
          file: MACHINE,
          from: '    ending = true;\n',
          to: '    ending = true;\n    setTimeout(() => {\n      for (const candidate of gates.forward.holding) candidate.discarded = true;\n    }, 0);\n'
        }
      ]
    },
    {
      id: 'I-or2-the-refusal-after-the-timeout',
      arm: 'OR2',
      describe:
        "the first attempt's forward refusal is sent after the 300ms timer has already answered the backlog, so the Given — a backlog still waiting when the forward leg ends — is no longer what runs; killed where the arm reads that it was waiting",
      edits: [
        {
          file: ARMS,
          from: '        // The backlog is still waiting when the forward leg ends.\n',
          to: '        await delay(400);\n        // The backlog is still waiting when the forward leg ends.\n'
        }
      ]
    },
    {
      id: 'C5-the-end-never-decided',
      arm: 'OR3',
      describe:
        "a live request whose forward leg ends after its backlog settled never ends its stream — the leg's end is still published, so only the stream's own end can tell",
      edits: [
        { file: MACHINE, from: '    if (settled) finish();\n  };', to: '    void settled;\n  };' }
      ]
    },
    {
      id: 'C2-the-forward-end-marks-the-backlog-ended',
      arm: 'OR2',
      describe:
        "the forward leg's end marks every backlog relay as gone, so the answer says `ended` rather than that the request stopped waiting — the status and the outcome's kind are unchanged, so only the exact cause can tell",
      edits: [
        {
          file: MACHINE,
          from: '    forwardEnded = true;\n',
          to: "    forwardEnded = true;\n    for (const url of backwardTargets.keys()) advanceBackward(url, 'ended');\n"
        }
      ]
    },
    {
      id: 'I-or1-the-refusal-for-another-subscription',
      arm: 'OR1',
      describe:
        "the backlog's refusal is sent under a subId with another request's prefix, which the machine attributes to no leg — so where the refusal was the backlog's only end nothing ends it before its timer, and where an EOSE came in the same turn the EOSE ends it as `complete`; both runs read the wrong outcome. It shows the arm's refusal is attributed by the request's prefix it carries: `<the backlog's id>-not` keeps that prefix and is still this backlog's refusal (measured), which gives a relay nothing it lacks, since it can refuse its own subscription",
      edits: [
        {
          file: ARMS,
          from: "        one.relay.send(['CLOSED', backward, `blocked: ${name}`]);",
          to: "        one.relay.send(['CLOSED', 'another-request:0', `blocked: ${name}`]);"
        }
      ]
    },
    {
      id: 'I-or1-the-refresh-refusal-on-the-first-subscription',
      arm: 'OR1',
      describe:
        "the refresh's refusal is sent to the first attempt's subscription, which is already over, so the refreshed attempt is never refused — the arm's reading is bound to the attempt the refresh started",
      edits: [
        {
          file: ARMS,
          from: "        one.relay.send(['CLOSED', again, 'blocked: onARefresh']);",
          to: "        void again;\n        one.relay.send(['CLOSED', first, 'blocked: onARefresh']);"
        }
      ]
    },
    {
      id: 'I-or2-the-refresh-after-the-first-attempt-answered',
      arm: 'OR2',
      describe:
        "the refresh is made after the first attempt's 300ms timer has answered, so the refreshed attempt does not start while one is waiting — killed where the arm reads that the first attempt was still waiting",
      edits: [
        {
          file: ARMS,
          from: "        const waitingAtTheRefresh = one.request().state.status === 'loading';",
          to: "        await delay(400);\n        const waitingAtTheRefresh = one.request().state.status === 'loading';"
        }
      ]
    },
    {
      id: 'C5-the-candidate-discarded-as-the-end-is-decided',
      arm: 'OR3',
      describe:
        "the forward candidates are marked discarded the moment the end is decided — invisible where the forward leg's end decides it, since the event is then still in the dependency's routing, and caught where the backlog's EOSE decides it after the event was admitted",
      edits: [
        {
          file: MACHINE,
          from: '    ending = true;\n',
          to: '    ending = true;\n    for (const each of gates.forward.holding) each.discarded = true;\n'
        }
      ]
    },
    {
      id: 'C3-the-release-waits-for-the-consumer',
      arm: 'OR4',
      describe:
        "the end is decided and the machine's subscriptions to the client are left open until the generator returns, which is when the consumer next asks",
      edits: [
        {
          file: MACHINE,
          from: '    queueMicrotask(() => {\n      closeAll();\n      whenBacklogReported(() => {\n',
          to: '    queueMicrotask(() => {\n      whenBacklogReported(() => {\n'
        }
      ]
    },
    {
      id: 'C3-the-release-waits-for-the-outcome-to-be-taken',
      arm: 'OR4',
      describe:
        "a request that is not live releases its subscriptions when the consumer is handed the outcome rather than at the decision, so a `next()` outstanding at the decision reads as prompt: the live path's release is unchanged",
      edits: [
        {
          file: MACHINE,
          from: '    queueMicrotask(() => {\n      closeAll();\n      whenBacklogReported(() => {\n',
          to: '    queueMicrotask(() => {\n      if (live) closeAll();\n      whenBacklogReported(() => {\n'
        },
        {
          file: MACHINE,
          from: "        if (next.type === 'settled') yield { type: 'settled', end: backwardEnd(next.viaTimer) };\n",
          to: "        if (next.type === 'settled') {\n          if (!live) closeAll();\n          yield { type: 'settled', end: backwardEnd(next.viaTimer) };\n        }\n"
        }
      ]
    },
    {
      id: 'C3-a-listener-outlives-the-decision',
      arm: 'OR4',
      describe:
        'the machine takes a revocation listener it never lets go of, which a count of the observables alone would not see',
      edits: [
        {
          file: MACHINE,
          from: '    ending = true;\n',
          to: '    ending = true;\n    transport.onRevoke(() => {});\n'
        }
      ]
    },
    {
      id: 'C19-a-refusal-after-the-decision-is-delivered',
      arm: 'OR5',
      describe:
        'nothing ends the refusal route at the decision, so a backward `CLOSED` behind the forward one in a batch is published',
      edits: [
        { file: MACHINE, from: REFUSAL_GUARD, to: '      // and it is owed delivery (`A-ε-C5`).\n' }
      ]
    },
    {
      id: 'C19-late-refusals-are-not-published',
      arm: 'OR5',
      describe:
        'a backward refusal is dropped once the backlog has settled, whichever side of the decision it fell on: what the order the other way round separates from the rule',
      edits: [
        {
          file: MACHINE,
          from: REFUSAL_GUARD,
          to: "      // and it is owed delivery (`A-ε-C5`).\n      if (ending || (leg === 'backward' && settled)) return;\n"
        }
      ]
    },
    {
      id: 'C19-an-event-behind-the-decision-is-cut',
      arm: 'OR5',
      describe:
        'the refusal guard copied to event admission, so an `EVENT` the relay sent before the deciding frame is lost',
      edits: [
        {
          file: MACHINE,
          from: '  const admitEvent = (leg: LegName, incoming: EventPacket) => {\n',
          to: '  const admitEvent = (leg: LegName, incoming: EventPacket) => {\n    if (ending) return;\n'
        }
      ]
    }
  ]
} satisfies Ledger;
