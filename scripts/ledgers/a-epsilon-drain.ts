/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of the drain-and-cut rows of A-ε and their landings:
 * `A-ε-C6` on `DC1`, `A-ε-C7` on `DC2`, `A-ε-C8` on `DC3`, `A-ε-C9` on `DC4`,
 * `A-ε-C10` on `DC5`, `A-ε-C12` on `DC6`, `A-ε-C13` on `DC7` and `A-ε-C14` on
 * `DC8`. An id beginning `C<n>-` edits the library; one beginning `I-` edits
 * one of the arms' own instruments. Entries ported from the spike's ledger keep
 * its id after the row's prefix; their kill sets here are measured afresh, not
 * copied.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const ENGINE = 'src/lib/v1/engine.ts';
const EVENTSET = 'src/lib/v1/eventset.ts';
const OWN = 'src/lib/v1/own.ts';
const OUTLETS = 'src/lib/v1/components/RequestOutlets.svelte';
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
/** A gate whose boundary is drawn admits nothing more. */
const CLOSED_TO_ADMISSION = "    if (gate.phase !== 'open') return;\n";
/** The same, with the late candidate handed to the verifier and then dropped. */
const VERIFIED_AND_DROPPED =
  "    if (gate.phase !== 'open') {\n      void Promise.resolve()\n        .then(() => verifyEvent(incoming.event as unknown as Nostr.Event))\n        .catch(() => undefined);\n      return;\n    }\n";
/** A cut backward gate, as a cause of the outcome. */
const CUT_IS_A_CAUSE =
  "    if (gates.backward.phase === 'cut') present.add('verification-timeout');";

export default {
  name: 'a-epsilon-drain',
  subject:
    '`A-ε-C6`–`A-ε-C10` and `A-ε-C12`–`A-ε-C14` (the wait over what the gate holds, and its end): their landings, `DC1`–`DC8`',
  files: [ARMS],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that last changed the arms, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { DC1: 7, DC2: 4, DC3: 8, DC4: 9, DC5: 4, DC6: 5, DC7: 7, DC8: 7 }
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
        'the forward leg is admitted into the backward gate, so once its boundary is drawn no new forward candidate is admitted: what was already held drains and is delivered, and nothing sent after that is — prompt, and killed on the traffic sent after the outcome rather than on lateness',
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
      id: 'C8-backward-verdict-queued-behind-forward',
      arm: 'DC3',
      describe:
        'both verifications run, but a backward verdict is acted on only once every forward candidate admitted before it has been answered — a queue the machine owns, met only when the forward candidate is admitted first and never answered',
      edits: [
        {
          file: MACHINE,
          from: '  const admitEvent = (leg: LegName, incoming: EventPacket) => {',
          to: '  let forwardTail: Promise<unknown> = Promise.resolve();\n  const admitEvent = (leg: LegName, incoming: EventPacket) => {'
        },
        {
          file: MACHINE,
          from: '    Promise.resolve()\n      .then(() => verifyEvent(packet.event as unknown as Nostr.Event))\n      .then(\n',
          to: "    const ahead = forwardTail;\n    const verdict = Promise.resolve().then(() =>\n      verifyEvent(packet.event as unknown as Nostr.Event)\n    );\n    if (leg === 'forward') forwardTail = Promise.all([forwardTail, verdict.catch(() => undefined)]);\n    verdict\n      .then((ok) => (leg === 'backward' ? ahead.then(() => ok) : ok))\n      .then(\n"
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
    },
    {
      id: 'C10-the-end-waits-out-a-gate-that-has-already-answered',
      arm: 'DC5',
      describe:
        "the end draws its boundary over the backward gate, which the cut has already answered, and a resolved gate can be drawn over again — a second wait, one drain floor long. Each edit alone measured by hand: at `56595ed`, either left every drain arm green; since `DC7` reads the forward gate's wait, the first alone fails `DC7` (the end no longer waits for that gate) and the second alone still leaves every arm green, its early exit being unreachable while each leg is drawn once",
      edits: [
        {
          file: MACHINE,
          from: "      drawBoundary('forward', () => {",
          to: "      drawBoundary('backward', () => {"
        },
        {
          file: MACHINE,
          from: "    if (gate.phase !== 'open') {\n      then();\n      return;\n    }\n",
          to: ''
        }
      ]
    },
    {
      id: 'C10-a-candidate-leaving-after-the-cut-rearms-the-gate',
      arm: 'DC5',
      describe:
        'a candidate leaving a gate that has already answered arms a fresh deadline over it — absorbed, so the arming itself is the only trace',
      edits: [
        {
          file: MACHINE,
          from: "      if (gate.phase !== 'draining') return;\n      if (gate.holding.size > 0) {",
          to: '      if (gate.holding.size > 0) {'
        }
      ]
    },
    {
      id: 'C10-no-outcome',
      arm: 'DC5',
      describe: 'a non-live request whose wait was cut pushes no outcome',
      edits: [
        {
          file: MACHINE,
          from: SETTLE,
          to: "      drawBoundary('backward', () => {\n        if (live) push({ type: 'settled', viaTimer });"
        }
      ]
    },
    {
      id: 'C10-no-return-of-its-own',
      arm: 'DC5',
      describe: 'the generator returns only when aborted, never when its stream has ended',
      edits: [
        {
          file: MACHINE,
          from: '      if (finished || signal.aborted) return;',
          to: '      if ((finished && signal.aborted) || signal.aborted) return;'
        }
      ]
    },
    {
      id: 'C12-gate-stays-open-after-its-boundary',
      arm: 'DC6',
      describe: 'a candidate offered after the boundary is admitted into the gate',
      edits: [{ file: MACHINE, from: CLOSED_TO_ADMISSION, to: '' }]
    },
    {
      id: 'C12-late-candidate-verified-and-dropped',
      arm: 'DC6',
      describe:
        'a candidate offered after the boundary is handed to the verifier and then dropped, joining no gate: nothing delivered changes and no wait is extended, so only the arrivals see it',
      edits: [{ file: MACHINE, from: CLOSED_TO_ADMISSION, to: VERIFIED_AND_DROPPED }]
    },
    {
      id: 'C12-drained-gate-is-a-cause',
      arm: 'DC6',
      describe: 'a backward gate that drained cleanly is still reported as `verification-timeout`',
      edits: [
        {
          file: MACHINE,
          from: CUT_IS_A_CAUSE,
          to: "    if (gates.backward.phase !== 'open') present.add('verification-timeout');"
        }
      ]
    },
    {
      id: 'C12-drain-bound-is-a-fixed-total',
      arm: 'DC6',
      describe:
        'the wait after the timer boundary is a fixed 100ms, so the candidate it was holding is cut before it is answered',
      edits: [
        {
          file: MACHINE,
          from: '    const believed = Math.min(gate.slowestVerifyMs, VERIFY_DRAIN_FLOOR_MS);\n    const cap = Math.max(VERIFY_DRAIN_FLOOR_MS, Math.ceil(believed * VERIFY_DRAIN_SAFETY));',
          to: '    void VERIFY_DRAIN_SAFETY;\n    const cap = 100;'
        }
      ]
    },
    {
      id: 'C13-nothing-found-becomes-unreachable',
      arm: 'DC7',
      describe: 'every settled answer reports match evidence, so `nodata` is never chosen',
      edits: [
        {
          file: ENGINE,
          from: 'hasMatchEvidence: observed.data.entries.size > 0',
          to: 'hasMatchEvidence: true'
        }
      ]
    },
    {
      id: 'C13-forward-cut-publishes-the-discard',
      arm: 'DC7',
      describe: "the forward leg's end names how many candidates its gate was holding",
      edits: [
        {
          file: MACHINE,
          from: "          `every relay in scope stopped the live request: ${[...targets.keys()].join(', ')}`",
          to: "          `every relay in scope stopped the live request: ${[...targets.keys()].join(', ')} (discarded ${gates.forward.holding.size})`"
        }
      ]
    },
    {
      id: 'C13-discard-in-a-nested-field',
      arm: 'DC7',
      describe:
        "the forward leg's end carries the discard in its error's `cause`, with its own name and message unchanged",
      edits: [
        {
          file: OWN,
          from: "export function relayFailure(message: string): RelayLegError {\n  const said = boundedMessage(message);\n  return snapshot({\n    thrownName: 'RelayFailure',\n    message: said.text,\n    source: 'relay',\n    truncated: said.truncated,\n    cause: undefined\n  });",
          to: "export function relayFailure(message: string, discarded = 0): RelayLegError {\n  const said = boundedMessage(message);\n  return snapshot({\n    thrownName: 'RelayFailure',\n    message: said.text,\n    source: 'relay',\n    truncated: said.truncated,\n    cause: discarded > 0 ? relayFailure(`discarded ${String(discarded)}`) : undefined\n  });"
        },
        {
          file: MACHINE,
          from: "          `every relay in scope stopped the live request: ${[...targets.keys()].join(', ')}`\n        )",
          to: "          `every relay in scope stopped the live request: ${[...targets.keys()].join(', ')}`,\n          gates.forward.holding.size\n        )"
        }
      ]
    },
    {
      id: 'C13-leg-end-unpublished',
      arm: 'DC7',
      describe: "the forward leg's end is never pushed, so no run publishes it",
      edits: [
        {
          file: MACHINE,
          from: "    forwardEnded = true;\n    push({\n      type: 'legEnded',",
          to: "    forwardEnded = true;\n    if (reason === null)\n      push({\n      type: 'legEnded',"
        }
      ]
    },
    {
      id: 'C13-nodata-not-rendered',
      arm: 'DC7',
      describe: 'a list renders its events outlet over an empty answer that found nothing',
      edits: [
        {
          file: OUTLETS,
          from: "  {#if outlet.slot === 'nodata'}",
          to: "  {#if outlet.slot === 'nodata' && shown.length > 0}"
        }
      ]
    },
    {
      id: 'C14-timer-firing-is-not-a-cause',
      arm: 'DC8',
      describe:
        'the settle timer drawing the boundary is not itself a cause — seen only where the EOSE has determined every target',
      edits: [
        {
          file: MACHINE,
          from: "    if (viaTimer) present.add('timeout');\n",
          to: '    void viaTimer;\n'
        }
      ]
    },
    {
      id: 'C14-a-cut-backward-gate-is-not-a-cause',
      arm: 'DC8',
      describe: 'a cut backward gate is not a cause of the outcome',
      edits: [{ file: MACHINE, from: CUT_IS_A_CAUSE, to: '    void gates;' }]
    },
    {
      id: 'C14-causes-out-of-canonical-order',
      arm: 'DC8',
      describe: '`verification-timeout` is ranked ahead of `timeout`',
      edits: [
        {
          file: EVENTSET,
          from: "  timeout: 1,\n  'verification-timeout': 2,",
          to: "  timeout: 2,\n  'verification-timeout': 1,"
        }
      ]
    },
    {
      id: 'C14-gate-stays-open-after-its-boundary',
      arm: 'DC8',
      describe: 'a candidate offered after the boundary is admitted into the gate',
      edits: [{ file: MACHINE, from: CLOSED_TO_ADMISSION, to: '' }]
    },
    {
      id: 'C14-late-candidate-verified-and-dropped',
      arm: 'DC8',
      describe:
        'a candidate offered after the boundary is handed to the verifier and then dropped, joining no gate',
      edits: [{ file: MACHINE, from: CLOSED_TO_ADMISSION, to: VERIFIED_AND_DROPPED }]
    },
    {
      id: 'C14-cut-does-not-discard-what-it-gave-up-on',
      arm: 'DC8',
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
      id: 'I-dc5-recorder-blind',
      arm: 'DC5',
      describe:
        'the deadline recorder records nothing, so an empty list after the release is no longer absorption — killed on its positive control, the deadline at the boundary',
      edits: [
        {
          file: ARMS,
          from: '        if ((ms ?? 0) >= 1000 && (ms ?? 0) <= 4000) armed.push(ms ?? 0);',
          to: '        if ((ms ?? 0) < 0) armed.push(ms ?? 0);'
        }
      ]
    },
    {
      id: 'I-dc5-one-candidate-only',
      arm: 'DC5',
      describe:
        'the second run admits one candidate where it should admit two — killed where the arm records its own arrangement (`admitted`), which is what this entry shows: the run says what it arranged, so a run that no longer holds a second candidate to re-arm over cannot pass for one that does',
      edits: [
        {
          file: ARMS,
          from: "await run('dc5b', ['first', 'second'], 'first')",
          to: "await run('dc5b', ['first'], 'first')"
        }
      ]
    },
    {
      id: 'I-dc6-late-offer-before-the-boundary',
      arm: 'DC6',
      describe:
        'the second event is offered before the timer has drawn the boundary, so it is admitted as it should be',
      edits: [
        {
          file: ARMS,
          from: '        await delay(250);\n        const openAtTheLateOffer',
          to: '        const openAtTheLateOffer'
        }
      ]
    },
    {
      id: 'I-dc7-released-before-the-stream-ended',
      arm: 'DC7',
      describe:
        'the held candidate is answered before the socket dies, so it is verified and delivered rather than cut',
      edits: [
        {
          file: ARMS,
          from: "        server.error({ code: 1006, reason: 'gone', wasClean: false });",
          to: "        if (arm === 'discarded') await gate.release('discarded');\n        server.error({ code: 1006, reason: 'gone', wasClean: false });"
        }
      ]
    },
    {
      id: 'I-dc8-late-offer-before-the-boundary',
      arm: 'DC8',
      describe:
        'the late event is offered before the timer has drawn the boundary, so it is admitted as it should be',
      edits: [
        {
          file: ARMS,
          from: '        await delay(400);\n        const openAtTheLateOffer',
          to: '        const openAtTheLateOffer'
        }
      ]
    },
    {
      id: 'C10-a-timer-boundary-does-not-end-a-non-live-request',
      arm: 'DC5',
      describe:
        'a non-live request whose boundary the settle timer drew reports its outcome and never ends, where one whose EOSE drew it does',
      edits: [
        {
          file: MACHINE,
          from: '        if (!live || forwardEnded) finish();',
          to: '        if ((!live && !viaTimer) || forwardEnded) finish();'
        }
      ]
    },
    {
      id: 'C10-cut-forges',
      arm: 'DC5',
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
      id: 'C12-delivered-after-the-outcome',
      arm: 'DC6',
      describe:
        'a verified candidate is delivered a microtask late, behind the outcome it belonged ahead of',
      edits: [
        {
          file: MACHINE,
          from: DELIVERED,
          to: "      if (deliver && !admission.discarded) queueMicrotask(() => push({ type: 'event', packet }));"
        }
      ]
    },
    {
      id: 'C13-discard-in-an-inherited-field',
      arm: 'DC7',
      describe:
        "the forward leg's end carries the discard in a getter its class defines, which its own property names do not list",
      edits: [
        {
          file: OWN,
          from: 'export class ReqFailure extends Error {',
          to: 'const DISCARDED = new WeakMap<object, number>();\nexport class ReqFailure extends Error {'
        },
        {
          file: OWN,
          from: '  override readonly cause: CapturedReqError | undefined;\n',
          to: '  override readonly cause: CapturedReqError | undefined;\n  get discarded(): number | undefined {\n    return DISCARDED.get(this);\n  }\n'
        },
        {
          file: OWN,
          from: "export function relayFailure(message: string): RelayLegError {\n  const said = boundedMessage(message);\n  return snapshot({\n    thrownName: 'RelayFailure',\n    message: said.text,\n    source: 'relay',\n    truncated: said.truncated,\n    cause: undefined\n  });\n}",
          to: "export function relayFailure(message: string, discarded = 0): RelayLegError {\n  const said = boundedMessage(message);\n  const made = snapshot({\n    thrownName: 'RelayFailure',\n    message: said.text,\n    source: 'relay',\n    truncated: said.truncated,\n    cause: undefined\n  });\n  if (discarded > 0) DISCARDED.set(made, discarded);\n  return made;\n}"
        },
        {
          file: MACHINE,
          from: "          `every relay in scope stopped the live request: ${[...targets.keys()].join(', ')}`\n        )",
          to: "          `every relay in scope stopped the live request: ${[...targets.keys()].join(', ')}`,\n          gates.forward.holding.size\n        )"
        }
      ]
    },
    {
      id: 'C13-cut-forges',
      arm: 'DC7',
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
      id: 'C14-cut-forges',
      arm: 'DC8',
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
      id: 'I-dc8-closed-reader-blind',
      arm: 'DC8',
      describe:
        'the reader of a closed subscription never sees one, so an open subscription at the late offer is no longer measured — killed on its positive control, the subscription closed once the request ended',
      edits: [
        {
          file: ARMS,
          from: "  (server.messages as unknown[][]).some((frame) => frame[0] === 'CLOSE' && frame[1] === subId);",
          to: "  (server.messages as unknown[][]).some((frame) => frame[0] === 'CLOSE' && frame[1] === subId) &&\n  false;"
        }
      ]
    },
    {
      id: 'C10-a-cut-arms-a-deadline',
      arm: 'DC5',
      describe: 'the cut arms a fresh deadline over the gate it has just answered',
      edits: [
        {
          file: MACHINE,
          from: '    const then = gate.then;\n    gate.then = undefined;\n    then?.();\n  };',
          to: "    const then = gate.then;\n    gate.then = undefined;\n    then?.();\n    if (phase === 'cut') armCut(gate);\n  };"
        }
      ]
    },
    {
      id: 'C12-timer-firing-is-not-a-cause',
      arm: 'DC6',
      describe:
        'the settle timer drawing the boundary is not itself a cause — seen only in the run whose late EOSE has determined every target',
      edits: [
        {
          file: MACHINE,
          from: "    if (viaTimer) present.add('timeout');\n",
          to: '    void viaTimer;\n'
        }
      ]
    },
    {
      id: 'C13-the-end-does-not-wait-for-the-forward-gate',
      arm: 'DC7',
      describe:
        "the end draws its boundary over the backward gate, which has already answered, so the stream ends as the leg does and the forward gate's wait never happens — the candidate is let go by the generator's teardown instead of by a cut",
      edits: [
        {
          file: MACHINE,
          from: "      drawBoundary('forward', () => {",
          to: "      drawBoundary('backward', () => {"
        }
      ]
    },
    {
      id: 'I-dc6-closed-reader-blind',
      arm: 'DC6',
      describe:
        'the reader of a closed subscription never sees one, so an open subscription at the late offer is no longer measured — killed on its positive control, the subscription closed once the request ended',
      edits: [
        {
          file: ARMS,
          from: "  (server.messages as unknown[][]).some((frame) => frame[0] === 'CLOSE' && frame[1] === subId);",
          to: "  (server.messages as unknown[][]).some((frame) => frame[0] === 'CLOSE' && frame[1] === subId) &&\n  false;"
        }
      ]
    },
    {
      id: 'I-dc8-late-eose-dropped',
      arm: 'DC8',
      describe:
        "the second run sends no late EOSE, so both runs are the no-EOSE trace and the timer's own `timeout` is no longer separated — killed where the arm reads that the EOSE closed the backlog before the outcome",
      edits: [
        {
          file: ARMS,
          from: '        if (lateEose) respondWithEose(one.server, backward);\n        // The arrangement, read rather than trusted',
          to: '        // The arrangement, read rather than trusted'
        }
      ]
    },
    {
      id: 'C13-the-end-discards-what-its-wait-could-deliver',
      arm: 'DC7',
      describe:
        'the end marks every forward candidate discarded as it begins, and still waits — so a verdict passing inside the wait delivers nothing, which only the run answered inside the wait can see',
      edits: [
        {
          file: MACHINE,
          from: '    if (ended || ending) return;\n    ending = true;\n',
          to: '    if (ended || ending) return;\n    ending = true;\n    for (const each of gates.forward.holding) each.discarded = true;\n'
        }
      ]
    },
    {
      id: 'C13-the-wait-outlives-its-last-verdict',
      arm: 'DC7',
      describe:
        'a forward gate emptied by a passing verdict ends the stream a deadline later rather than then — the candidate is delivered, but the request stays `live` as if the wait had run out, which only the run answered inside the wait can see',
      edits: [
        {
          file: MACHINE,
          from: "        drawBoundary('forward', () => {\n          if (ended) return;\n          ended = true;\n          push({ type: 'end' });\n        });",
          to: "        drawBoundary('forward', () => {\n          const end = () => {\n            if (ended) return;\n            ended = true;\n            push({ type: 'end' });\n          };\n          if (gates.forward.phase === 'drained' && gates.forward.slowestVerifyMs > 0)\n            setTimeout(end, 1000);\n          else end();\n        });"
        }
      ]
    }
  ],
  retired: [
    {
      id: 'C13-cut-does-not-discard-what-it-gave-up-on',
      arm: 'DC7',
      describe:
        'a candidate inside the forward gate at the cut is delivered when its verification passes later',
      reason:
        "No entrance through this row's arrangement, measured: it survived `DC7`. Two things stand between the edit and any consumer. The forward gate's boundary is drawn only by `finish()`, and the cut that resolves it pushes the end in the same callback; the generator drains what is queued and returns, and `abandonGate` in its `finally` marks every forward admission still held discarded — so a verdict passing afterwards pushes nothing. And even without that teardown, the consumer has returned, so a later push would have no reader. Not measured: a verdict landing inside the cut's own macrotask, before the generator's continuation runs. The discard is the backward gate's to measure, which `C9-cut-does-not-discard-what-it-gave-up-on` and `C14-cut-does-not-discard-what-it-gave-up-on` do.",
      edits: [
        {
          file: MACHINE,
          from: "    if (phase === 'cut') for (const each of gate.holding) each.discarded = true;\n",
          to: ''
        }
      ]
    },
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
