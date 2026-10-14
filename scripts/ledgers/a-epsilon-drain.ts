/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of the drain-and-cut rows of A-ε and their landings:
 * `A-ε-C6` on `DC1`, `A-ε-C7` on `DC2`, `A-ε-C8` on `DC3` and `A-ε-C9` on
 * `DC4`. An id beginning `C<n>-` edits the library; one beginning `I-` edits
 * one of the arms' own instruments. Entries ported from the spike's ledger keep
 * its id after the row's prefix; their kill sets here are measured afresh, not
 * copied.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const ARMS = 'src/tests/contracts/engine/drain.test.ts';
/** The end of the outcome's callback, once the backlog is reported. */
const SETTLE_END = '        if (!live || forwardEnded) finish();\n      });\n    });\n  };';

/** The backward boundary, and the outcome pushed once it has drained or been cut. */
const SETTLE =
  "      drawBoundary('backward', () => {\n        push({ type: 'settled', viaTimer });";
/** What the gate does with a candidate's verdict. */
const DELIVERED = "      if (deliver && !admission.discarded) push({ type: 'event', packet });";
/** The cut's own decision, when the deadline fires. */
const CUT = "      resolveGate(gate, gate.holding.size > 0 ? 'cut' : 'drained');";
/** The last candidate leaving a draining gate. */
const EMPTIED = "      resolveGate(gate, 'drained');\n    };";
/** A boundary drawn over a gate holding nothing. */
const EMPTY_AT_THE_BOUNDARY =
  "    if (gate.holding.size === 0) {\n      resolveGate(gate, 'drained');\n      return;\n    }";
/** A cut backward gate, as a cause of the outcome. */
const CUT_IS_A_CAUSE =
  "    if (gates.backward.phase === 'cut') present.add('verification-timeout');";

export default {
  name: 'a-epsilon-drain',
  subject:
    '`A-ε-C6`, `A-ε-C7`, `A-ε-C8` and `A-ε-C9` (the wait over what the gate holds, and its end): their landings, `DC1`–`DC4`',
  files: [ARMS],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that last changed the arms, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { DC1: 7, DC2: 4, DC3: 8, DC4: 9 }
  },
  entries: [
    {
      id: 'C6-settle-does-not-wait-for-the-gate',
      arm: 'DC1',
      describe: 'the outcome is pushed as the boundary is drawn, before the gate has answered',
      edits: [
        {
          file: MACHINE,
          from: SETTLE,
          to: "      ((run: () => void) => run())(() => {\n        push({ type: 'settled', viaTimer });"
        }
      ]
    },
    {
      id: 'C6-drain-bound-is-a-fixed-total',
      arm: 'DC1',
      describe: 'the wait over a draining gate is a fixed 100ms, whatever a verification costs',
      edits: [
        {
          file: MACHINE,
          from: '    const believed = Math.min(gate.slowestVerifyMs, VERIFY_DRAIN_FLOOR_MS);\n    const cap = Math.max(VERIFY_DRAIN_FLOOR_MS, Math.ceil(believed * VERIFY_DRAIN_SAFETY));',
          to: '    void VERIFY_DRAIN_SAFETY;\n    const cap = 100;'
        }
      ]
    },
    {
      id: 'C6-drain-bound-not-re-armed-on-progress',
      arm: 'DC1',
      describe: 'one deadline covers every candidate in the gate, however many leave before it',
      edits: [
        { file: MACHINE, from: '        armCut(gate);\n        return;', to: '        return;' }
      ]
    },
    {
      id: 'C6-verified-event-dropped',
      arm: 'DC1',
      describe: 'a candidate that passed is dropped when it leaves a gate still holding three',
      edits: [
        {
          file: MACHINE,
          from: DELIVERED,
          to: "      if (deliver && !admission.discarded && gate.holding.size !== 3) push({ type: 'event', packet });"
        }
      ]
    },
    {
      id: 'C6-clean-drain-reported-cut',
      arm: 'DC1',
      describe: 'a gate whose last candidate left is reported as cut, not drained',
      edits: [{ file: MACHINE, from: EMPTIED, to: "      resolveGate(gate, 'cut');\n    };" }]
    },
    {
      id: 'C7-one-gate-for-both-legs',
      arm: 'DC2',
      describe:
        'the forward leg is admitted into the backward gate, so once its boundary is drawn the forward leg delivers nothing — prompt, and killed on the traffic after the outcome rather than on lateness',
      edits: [
        {
          file: MACHINE,
          from: '  const admitEvent = (leg: LegName, incoming: EventPacket) => {\n    const gate = gates[leg];',
          to: "  const admitEvent = (leg: LegName, incoming: EventPacket) => {\n    const gate = gates[leg === 'forward' ? 'backward' : leg];"
        }
      ]
    },
    {
      id: 'C7-outcome-late',
      arm: 'DC2',
      describe:
        'a boundary drawn over a gate holding nothing answers 350ms later, while the forward leg is admitted and delivered as before',
      edits: [
        {
          file: MACHINE,
          from: EMPTY_AT_THE_BOUNDARY,
          to: "    if (gate.holding.size === 0) {\n      setTimeout(() => resolveGate(gate, 'drained'), 350);\n      return;\n    }"
        }
      ]
    },
    {
      id: 'C7-empty-gate-reported-cut',
      arm: 'DC2',
      describe: 'a boundary drawn over a gate holding nothing reports it cut',
      edits: [
        {
          file: MACHINE,
          from: EMPTY_AT_THE_BOUNDARY,
          to: "    if (gate.holding.size === 0) {\n      resolveGate(gate, 'cut');\n      return;\n    }"
        }
      ]
    },
    {
      id: 'C8-one-latency-estimator-for-both-legs',
      arm: 'DC3',
      describe: 'what one leg learns about the verifier’s cost sets the other leg’s deadline too',
      edits: [
        {
          file: MACHINE,
          from: '      if (took > gate.slowestVerifyMs) gate.slowestVerifyMs = took;',
          to: '      for (const each of [gates.backward, gates.forward])\n        if (took > each.slowestVerifyMs) each.slowestVerifyMs = took;'
        }
      ]
    },
    {
      id: 'C8-one-gate-for-both-legs',
      arm: 'DC3',
      describe: 'the forward leg is admitted into the backward gate',
      edits: [
        {
          file: MACHINE,
          from: '  const admitEvent = (leg: LegName, incoming: EventPacket) => {\n    const gate = gates[leg];',
          to: "  const admitEvent = (leg: LegName, incoming: EventPacket) => {\n    const gate = gates[leg === 'forward' ? 'backward' : leg];"
        }
      ]
    },
    {
      id: 'C8-settle-does-not-wait-for-the-gate',
      arm: 'DC3',
      describe: 'the outcome is pushed as the boundary is drawn, before the gate has answered',
      edits: [
        {
          file: MACHINE,
          from: SETTLE,
          to: "      ((run: () => void) => run())(() => {\n        push({ type: 'settled', viaTimer });"
        }
      ]
    },
    {
      id: 'C8-a-cut-wait-reports-itself-drained',
      arm: 'DC3',
      describe: 'a wait cut with a candidate still inside reports itself drained',
      edits: [{ file: MACHINE, from: CUT, to: "      resolveGate(gate, 'drained');" }]
    },
    {
      id: 'C8-a-cut-backward-gate-is-not-a-cause',
      arm: 'DC3',
      describe: 'a cut backward gate is not a cause of the outcome',
      edits: [{ file: MACHINE, from: CUT_IS_A_CAUSE, to: '    void gates;' }]
    },
    {
      id: 'C9-cut-does-not-discard-what-it-gave-up-on',
      arm: 'DC4',
      describe:
        'a candidate inside the gate at the cut is delivered when its verification passes later',
      edits: [
        {
          file: MACHINE,
          from: "    if (phase === 'cut') for (const each of gate.holding) each.discarded = true;\n",
          to: ''
        }
      ]
    },
    {
      id: 'C9-a-cut-wait-reports-itself-drained',
      arm: 'DC4',
      describe: 'a wait cut with a candidate still inside reports itself drained',
      edits: [{ file: MACHINE, from: CUT, to: "      resolveGate(gate, 'drained');" }]
    },
    {
      id: 'C9-a-cut-backward-gate-is-not-a-cause',
      arm: 'DC4',
      describe: 'a cut backward gate is not a cause of the outcome',
      edits: [{ file: MACHINE, from: CUT_IS_A_CAUSE, to: '    void gates;' }]
    },
    {
      id: 'C9-cut-reported-as-the-timer',
      arm: 'DC4',
      describe:
        'a cut backward gate is reported as the settle timer, not as the verifier running out of time',
      edits: [
        {
          file: MACHINE,
          from: CUT_IS_A_CAUSE,
          to: "    if (gates.backward.phase === 'cut') present.add('timeout');"
        }
      ]
    },
    {
      id: 'C9-late-delivery-when-refused',
      arm: 'DC4',
      describe:
        'a candidate the cut gave up on is delivered when its verifier later answers `false`',
      edits: [
        {
          file: MACHINE,
          from: '        (ok) => leave(ok === true),',
          to: "        (ok) =>\n          ok !== true && admission.discarded ? push({ type: 'event', packet }) : leave(ok === true),"
        }
      ]
    },
    {
      id: 'C9-late-delivery-when-rejected',
      arm: 'DC4',
      describe: 'a candidate the cut gave up on is delivered when its verifier later rejects',
      edits: [
        {
          file: MACHINE,
          from: '        () => leave(false)',
          to: "        () => (admission.discarded ? push({ type: 'event', packet }) : leave(false))"
        }
      ]
    },
    {
      id: 'C6-live-drain-budget',
      arm: 'DC1',
      describe: "a live request's wait over its draining gate is a fixed 100ms",
      edits: [
        {
          file: MACHINE,
          from: '    const cap = Math.max(VERIFY_DRAIN_FLOOR_MS, Math.ceil(believed * VERIFY_DRAIN_SAFETY));',
          to: '    const cap = live ? 100 : Math.max(VERIFY_DRAIN_FLOOR_MS, Math.ceil(believed * VERIFY_DRAIN_SAFETY));'
        }
      ]
    },
    {
      id: 'C7-forward-cost-delays-the-outcome',
      arm: 'DC2',
      describe:
        "the backlog's outcome waits half of the slowest forward verification, a bound the forward leg sets",
      edits: [
        {
          file: MACHINE,
          from: SETTLE,
          to: "      drawBoundary('backward', () => setTimeout(() => {\n        push({ type: 'settled', viaTimer });"
        },
        {
          file: MACHINE,
          from: SETTLE_END,
          to: '        if (!live || forwardEnded) finish();\n      }, gates.forward.slowestVerifyMs / 2));\n    });\n  };'
        }
      ]
    },
    {
      id: 'C7-shared-counter',
      arm: 'DC2',
      describe:
        "forward candidates are counted in the backlog's wait as well as their own: the outcome waits on traffic that has nothing to do with it",
      edits: [
        {
          file: MACHINE,
          from: '    gate.holding.add(admission);',
          to: "    gate.holding.add(admission);\n    if (leg === 'forward') gates.backward.holding.add(admission);"
        },
        {
          file: MACHINE,
          from: '      gate.holding.delete(admission);',
          to: '      gate.holding.delete(admission);\n      gates.backward.holding.delete(admission);'
        }
      ]
    },
    {
      id: 'C7-outcome-before-the-eose',
      arm: 'DC2',
      describe:
        'a backward REQ marks its relay as having answered, so the backlog settles before its EOSE',
      edits: [
        {
          file: MACHINE,
          from: "      else if (leg === 'backward') advanceBackward(packet.to, 'active');",
          to: "      else if (leg === 'backward') advanceBackward(packet.to, 'complete');"
        }
      ]
    },
    {
      id: 'C7-forward-held-until-the-outcome',
      arm: 'DC2',
      describe: 'the forward leg delivers nothing until the backlog has been reported',
      edits: [
        {
          file: MACHINE,
          from: DELIVERED,
          to: "      if (deliver && !admission.discarded && (leg !== 'forward' || backlogReported)) push({ type: 'event', packet });"
        }
      ]
    },
    {
      id: 'C7-stream-ends-at-the-outcome',
      arm: 'DC2',
      describe: 'a live request ends when its backlog is reported, closing the forward leg',
      edits: [
        {
          file: MACHINE,
          from: '        if (!live || forwardEnded) finish();',
          to: '        void forwardEnded;\n        finish();'
        }
      ]
    },
    {
      id: 'C8-cut-forges',
      arm: 'DC3',
      describe: 'the cut hands the candidates it gave up on over unverified',
      edits: [
        {
          file: MACHINE,
          from: '    const admission: Admission = { discarded: false };',
          to: "    const admission: Admission & { forge?: () => void } = {\n      discarded: false,\n      forge: () => push({ type: 'event', packet })\n    };"
        },
        {
          file: MACHINE,
          from: "    if (phase === 'cut') for (const each of gate.holding) each.discarded = true;",
          to: "    if (phase === 'cut')\n      for (const each of gate.holding) {\n        each.discarded = true;\n        (each as { forge?: () => void }).forge?.();\n      }"
        }
      ]
    },
    {
      id: 'C9-cut-forges',
      arm: 'DC4',
      describe: 'the cut hands the candidates it gave up on over unverified',
      edits: [
        {
          file: MACHINE,
          from: '    const admission: Admission = { discarded: false };',
          to: "    const admission: Admission & { forge?: () => void } = {\n      discarded: false,\n      forge: () => push({ type: 'event', packet })\n    };"
        },
        {
          file: MACHINE,
          from: "    if (phase === 'cut') for (const each of gate.holding) each.discarded = true;",
          to: "    if (phase === 'cut')\n      for (const each of gate.holding) {\n        each.discarded = true;\n        (each as { forge?: () => void }).forge?.();\n      }"
        }
      ]
    },
    {
      id: 'C9-stream-ends-at-the-outcome',
      arm: 'DC4',
      describe:
        'a live request ends when its backlog is reported, so it has already returned when the held candidate is answered',
      edits: [
        {
          file: MACHINE,
          from: '        if (!live || forwardEnded) finish();',
          to: '        void forwardEnded;\n        finish();'
        }
      ]
    },
    {
      id: 'I-eose-before-the-forward-gate-is-occupied',
      arm: 'DC2',
      describe: "the arm sends the backlog's EOSE before any forward event is inside the gate",
      edits: [
        {
          file: ARMS,
          from: '          for (let step = 0; step < 200 && events().length - before < 2; step += 1)',
          to: '          for (let step = 0; step < 200 && events().length - before < 0; step += 1)'
        }
      ]
    },
    {
      id: 'I-verifier-concurrent',
      arm: 'DC1',
      describe: "the arm's verifier answers every event at once rather than one after another",
      edits: [
        {
          file: ARMS,
          from: '          chain = chain.then(async () => {',
          to: '          chain = Promise.resolve().then(async () => {'
        }
      ]
    },
    {
      id: 'I-feed-stopped-before-the-eose',
      arm: 'DC2',
      describe: "the arm's forward feed stops before the backlog's EOSE",
      edits: [
        {
          file: ARMS,
          from: '          const eoseAt = Date.now();\n          respondWithEose(one.server, backward);',
          to: '          const eoseAt = Date.now();\n          if (feed !== undefined) clearInterval(feed);\n          respondWithEose(one.server, backward);'
        }
      ]
    },
    {
      id: 'I-forward-released-in-the-unfinished-order',
      arm: 'DC3',
      describe: "the arm's third order releases the forward candidate after all",
      edits: [
        {
          file: ARMS,
          from: "      await gate.release('b1');\n      await delay(300);",
          to: "      await gate.release('b1');\n      await gate.release('f1');"
        }
      ]
    },
    {
      id: 'I-not-live',
      arm: 'DC4',
      describe:
        "the arm's request is not live — killed by its premise, since a non-live request opens no forward leg for the arm to find",
      edits: [
        {
          file: ARMS,
          from: 'live: true, reqIdBase: `dc4-${how}`',
          to: 'live: false, reqIdBase: `dc4-${how}`'
        }
      ]
    }
  ],
  retired: [
    {
      id: 'an-empty-gate-at-the-deadline-is-reported-as-cut',
      arm: 'DC1',
      describe: 'a gate that is empty when its deadline fires is reported cut',
      reason:
        'No entrance: a deadline is armed only over a non-empty gate, and the one statement that empties a draining gate resolves it and clears the deadline in the same breath, so the cut never fires over an empty gate. The `drained` arm of the deadline is kept for the direction it would fail in, as `machine.ts` says.',
      edits: [{ file: MACHINE, from: CUT, to: "      resolveGate(gate, 'cut');" }]
    }
  ]
} satisfies Ledger;
