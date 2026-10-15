/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of the ordering rows of A-ε and their landings:
 * `A-ε-C1` on `OR1`, `A-ε-C2` on `OR2` and `A-ε-C5` on `OR3`. An id beginning
 * `C<n>-` edits the library; one beginning `I-` edits one of the arms' own
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

export default {
  name: 'a-epsilon-order',
  subject:
    '`A-ε-C1`, `A-ε-C2` and `A-ε-C5` (what reaches a consumer around the end of a stream): their landings, `OR1`–`OR3`',
  files: [ARMS],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that last changed the arms, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { OR1: 5, OR2: 5, OR3: 4 }
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
          from: "      await vi.waitFor(() => expect(shape()).toContain('settled'), { timeout: 3000 });\n",
          to: ''
        }
      ]
    }
  ]
} satisfies Ledger;
