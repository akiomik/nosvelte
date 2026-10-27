/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of what a live request's forward leg delivers, and what
 * its end does to the request (A5), and its landings:
 * - `A5-C1` on `FL1`;
 * - `A5-C16` on `FL2`, and on `CS1` for the other order, which its record
 *   credits to `A5-C2`'s arm;
 * - `A5-C17` on `FL3`.
 *
 * An id begins with the row it is read against, `C<n>-` for `A5-C<n>`.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const HOOK = 'src/lib/v1/useStreamedReq.svelte.ts';
const ENGINE = 'src/lib/v1/engine.ts';
const EVENTSET = 'src/lib/v1/eventset.ts';
const ARM = 'src/tests/contracts/engine/forward.test.ts';

/** The live leg's events, handed to the gate as they arrive. */
const LIVE_NEXT = "          next: (packet) => admitEvent('forward', packet),\n";
/** The backlog's outcome, queued. */
const SETTLED = "        push({ type: 'settled', viaTimer });\n";
/** The machine's state, where a queue of its own can be declared beside it. */
const STATE = '  let forwardEnded = false;\n';
/** A queue for the live leg's events, and what decides when it is let go. */
const QUEUE = {
  file: MACHINE,
  from: STATE,
  to: `${STATE}  const queuedLive: EventPacket[] = [];\n  let liveSeen = 0;\n  let liveAnswered = false;\n`
};
/** The queue let go once the backlog's outcome is queued. */
const LET_GO_AT_THE_OUTCOME = {
  file: MACHINE,
  from: SETTLED,
  to: `${SETTLED}        for (const queued of queuedLive.splice(0)) admitEvent('forward', queued);\n`
};
/** The live leg's events queued unless `when` holds. */
const LIVE_QUEUED_UNLESS = (when: string) => ({
  file: MACHINE,
  from: LIVE_NEXT,
  to:
    '          next: (packet) => {\n' +
    `            if (${when}) admitEvent('forward', packet);\n` +
    '            else queuedLive.push(packet);\n' +
    '          },\n'
});
/** An `EOSE` routed to the backlog's table. */
const EOSE_ROUTED =
  "        if (legOf(packet.subId) === 'backward') advanceBackward(packet.from, 'complete');\n        return;\n";
/** The forward leg's end, which ends the request only if the backlog is already over. */
const FORWARD_END = '    if (settled) finish();\n  };\n';
/** The backlog's end, which ends a request that is not live, or whose forward leg is over. */
const BACKLOG_END = '        if (!live || forwardEnded) finish();\n';
/** The end of the request, at once: every subscription closed, and the stream ended. */
const ENDED_AT_ONCE = "closeAll();\n      ended = true;\n      push({ type: 'end' });\n";
/** The machine's last import, after which a clock can be taken as it is loaded. */
const LAST_IMPORT = "import type { MachineChunk } from './stream.js';\n";
/** A clock taken as the machine is loaded, which a fake one installed later does not move. */
const TAKEN_AT_LOAD = {
  file: MACHINE,
  from: LAST_IMPORT,
  to: `${LAST_IMPORT}\nconst scheduleLater = globalThis.setTimeout.bind(globalThis);\n`
};
/** The hook's fold of an event chunk, the last thing `collect` does. */
const EVENT_FOLD = '  return retainNewest(foldEvent(base, chunk.packet), options);\n}';
/** The hook's fold of the backlog's outcome. */
const OUTCOME_FOLD =
  "  if (chunk.type === 'settled') return endBacklog(base, chunk.attempt, chunk.end);";
/** The hook's activity axis, read off the query's fetch status. */
const ACTIVITY =
  '      return deriveActivity(\n' +
  '        safely(() => getOpts().live) ?? false,\n' +
  "        query.fetchStatus === 'fetching'\n" +
  '      );';
/** The value's rule for a forward leg told it ended: the first end wins. */
const FIRST_END_WINS = '  if (forward.end !== undefined) return set;\n';
/** The arm's own setup, after which the clock a run is held up on is taken. */
const UNMOCKED = "vi.unmock('svelte');\n";

/**
 * One run of an arm on the fake clock or on the real one, held up in real time
 * a little past that clock's budget for what is prompt, right before `reading`
 * — on a clock taken as the arm was loaded, which the fake one does not move.
 * `which` picks the run.
 */
const HELD_UP = (
  reading: string,
  clock: 'fake' | 'real',
  which: string
): { file: string; from: string; to: string }[] => [
  {
    file: ARM,
    from: UNMOCKED,
    to: `${UNMOCKED}const pauseInRealTime = globalThis.setTimeout.bind(globalThis);\n`
  },
  {
    file: ARM,
    from: reading,
    to:
      `            if (${clock === 'fake' ? '' : '!'}clock.fake && ${which}) {\n` +
      '              await new Promise<void>((done) => pauseInRealTime(done, clock.promptMs + 100));\n' +
      '            }\n' +
      reading
  }
];
/** `FL1`'s reading before the backlog's `EOSE`, a delivery turn after the live events. */
const FL1_READ = '            const beforeTheEose = {\n';
/** `FL1`'s run with one live event, before any `EOSE`, retained without bound. */
const FL1_RUN = "liveEose === 'never' && events === 1 && retain === 'unbounded'";
/** `FL2`'s reading at the backlog's answer. */
const FL2_ANSWER_READ = '            const atTheAnswer = {\n';
/** `FL2`'s run with no event, retained without bound. */
const FL2_RUN = "nameOf(ending) === '0 event, retaining unbounded'";
/** The live leg's events queued until the backlog's outcome, or until `ms` have passed since the first was queued. */
const LIVE_QUEUED_FOR_AT_MOST = (ms: number) => ({
  file: MACHINE,
  from: LIVE_NEXT,
  to:
    '          next: (packet) => {\n' +
    "            if (settled) admitEvent('forward', packet);\n" +
    '            else {\n' +
    '              queuedLive.push(packet);\n' +
    '              if (queuedLive.length === 1)\n' +
    "                setTimeout(() => { for (const queued of queuedLive.splice(0)) admitEvent('forward', queued); }, " +
    `${String(ms)});\n` +
    '            }\n' +
    '          },\n'
});
/** The hook keeping the last events to arrive, rather than the newest, while `when` holds of the value. */
const LAST_TO_ARRIVE_KEPT_WHILE = (when: string) => ({
  file: HOOK,
  from: EVENT_FOLD,
  to:
    '  const folded = foldEvent(base, chunk.packet);\n' +
    `  if (${when} && typeof options.retain === 'number') {\n` +
    '    return { ...folded, entries: new Map([...folded.entries].slice(-options.retain)) };\n' +
    '  }\n' +
    '  return retainNewest(folded, options);\n}'
});
/** The value's record of a backlog that ended, swapped in for the running one. */
const BACKLOG_SWAPPED_IN = '    running: undefined,\n    failure\n  };';
/** A refusal on the live leg, added to the forward record. */
const FORWARD_REFUSAL_ADDED =
  '    return { ...set, forward: { ...forward, refusals: [...forward.refusals, refusal] } };\n';

export default {
  name: 'a5-forward',
  subject:
    '`A5-C1`, `A5-C16` and `A5-C17` (what a live request’s forward leg delivers, and what its end does): their landings, `FL1`–`FL3`, and the arm `CS1` that the `A5-C16` record credits with the other order',
  files: [
    'src/tests/contracts/engine/forward.test.ts',
    'src/tests/contracts/engine/connection.test.ts'
  ],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine; CS1's from `a5-connection`",
    seconds: { FL1: 4, FL2: 6, FL3: 4, CS1: 5 }
  },
  entries: [
    {
      id: 'C1-the-live-leg-queued-until-the-backlog-settles',
      arm: 'FL1',
      describe:
        'the live leg’s events are queued until the backlog’s outcome is queued, and handed to the gate only then',
      edits: [QUEUE, LET_GO_AT_THE_OUTCOME, LIVE_QUEUED_UNLESS('settled')]
    },
    {
      id: 'C1-all-but-the-first-live-event-queued-until-the-backlog-settles',
      arm: 'FL1',
      describe:
        'the live leg’s first event is handed to the gate as it arrives, and every one after it is queued until the backlog’s outcome',
      edits: [QUEUE, LET_GO_AT_THE_OUTCOME, LIVE_QUEUED_UNLESS('settled || liveSeen++ === 0')]
    },
    {
      id: 'C1-the-live-leg-queued-until-its-own-eose',
      arm: 'FL1',
      describe:
        'the live leg’s events are queued until the relay answers the live subscription with `EOSE`, or the backlog’s outcome, whichever comes first — so a relay that sends a live event before answering the live subscription has it held',
      edits: [
        QUEUE,
        LET_GO_AT_THE_OUTCOME,
        LIVE_QUEUED_UNLESS('settled || liveAnswered'),
        {
          file: MACHINE,
          from: EOSE_ROUTED,
          to:
            "        if (legOf(packet.subId) === 'backward') advanceBackward(packet.from, 'complete');\n" +
            "        if (legOf(packet.subId) === 'forward') {\n" +
            '          liveAnswered = true;\n' +
            "          for (const queued of queuedLive.splice(0)) admitEvent('forward', queued);\n" +
            '        }\n' +
            '        return;\n'
        }
      ]
    },
    {
      id: 'C1-a-bounded-request-holds-back-what-arrives-before-its-backlog-ends',
      arm: 'FL1',
      describe:
        'a request that retains at most a number of events holds back every event that arrives before its backlog has ended, since which are the newest is not known until then, and folds them in with the outcome',
      edits: [
        {
          file: HOOK,
          from: 'export function collect(\n',
          to: 'const heldBack = new Map<unknown, unknown[]>();\nexport function collect(\n'
        },
        {
          file: HOOK,
          from: OUTCOME_FOLD,
          to:
            "  if (chunk.type === 'settled') {\n" +
            '    let flushed = base;\n' +
            '    for (const packet of heldBack.get(chunk.attempt) ?? []) flushed = retainNewest(foldEvent(flushed, packet as never), options);\n' +
            '    heldBack.delete(chunk.attempt);\n' +
            '    return endBacklog(flushed, chunk.attempt, chunk.end);\n' +
            '  }'
        },
        {
          file: HOOK,
          from: EVENT_FOLD,
          to:
            "  if (typeof options.retain === 'number' && base.backlog === undefined) {\n" +
            '    heldBack.set(chunk.attempt, [...(heldBack.get(chunk.attempt) ?? []), chunk.packet]);\n' +
            '    return base;\n' +
            '  }\n' +
            EVENT_FOLD
        }
      ]
    },
    {
      id: 'C1-the-live-leg-held-back-a-moment',
      arm: 'FL1',
      describe:
        'the live leg’s events are handed to the gate 300 ms after they arrive, on the machine’s own clock — later than the backlog’s `EOSE`, which follows them by a delivery turn',
      edits: [
        {
          file: MACHINE,
          from: LIVE_NEXT,
          to: "          next: (packet) => void setTimeout(() => admitEvent('forward', packet), 300),\n"
        }
      ]
    },
    {
      id: 'C1-the-live-leg-queued-until-the-backlog-settles-or-a-moment-passes',
      arm: 'FL1',
      describe:
        'the live leg’s events are queued until the backlog’s outcome, or until 500 ms have passed since the first was queued — so an arm that withholds the backlog’s `EOSE` until they are delivered sees them delivered, and an `EOSE` that follows them by a delivery turn finds them queued',
      edits: [QUEUE, LET_GO_AT_THE_OUTCOME, LIVE_QUEUED_FOR_AT_MOST(500)]
    },
    {
      id: 'C1-a-bounded-request-keeps-the-last-to-arrive-before-its-backlog-ends',
      arm: 'FL1',
      describe:
        'a request that retains at most a number of events keeps the last to arrive rather than the newest while its backlog is running, so two live events sent newest first leave it holding the older',
      edits: [LAST_TO_ARRIVE_KEPT_WHILE('base.running !== undefined')]
    },
    {
      id: 'C1-the-events-shown-only-with-the-outcome',
      arm: 'FL1',
      describe:
        'the primary state shows no events until the backlog has an answer, so what the request holds is shown to the consumer only with the outcome',
      edits: [
        {
          file: ENGINE,
          from: "  if (answer === undefined) return { state: { status: 'streaming', events }, nextExpiryAt };",
          to: "  if (answer === undefined) return { state: { status: 'streaming', events: NO_EVENTS }, nextExpiryAt };"
        }
      ]
    },
    {
      id: 'C1-the-run-on-the-fake-clock-held-up',
      arm: 'FL1',
      describe:
        'the arm’s run on the fake clock with one live event before any `EOSE`, retained without bound, is held up in real time a little past that clock’s budget for what is prompt, after the delivery turn and before the request is read: the request reads as it should, and the run is read as held up rather than as prompt',
      edits: HELD_UP(FL1_READ, 'fake', FL1_RUN)
    },
    {
      id: 'C1-the-run-on-the-real-clock-held-up',
      arm: 'FL1',
      describe:
        'the arm’s run on the real clock with one live event before any `EOSE`, retained without bound, is held up in real time a little past that clock’s budget for what is prompt, after the delivery turn and before the request is read: the request reads as it should, and the run is read as held up rather than as prompt',
      edits: HELD_UP(FL1_READ, 'real', FL1_RUN)
    },
    {
      id: 'C16-the-forward-end-ends-the-stream',
      arm: 'FL2',
      describe:
        'the forward leg’s end ends the stream whether or not the backlog is over, which closes the backlog’s subscription before it answers — and, since the end waits for a backlog that is never reported, leaves the request waiting with nothing to wait on',
      edits: [{ file: MACHINE, from: FORWARD_END, to: '    finish();\n  };\n' }]
    },
    {
      id: 'C16-the-forward-end-ends-the-request-at-once',
      arm: 'FL2',
      describe:
        'the forward leg’s end ends the request at once: every subscription closed and the stream ended, before the backlog has answered',
      edits: [{ file: MACHINE, from: FORWARD_END, to: `    ${ENDED_AT_ONCE}  };\n` }]
    },
    {
      id: 'C16-the-forward-end-ends-the-request-a-moment-later',
      arm: 'FL2',
      describe:
        'the forward leg’s end ends the request 300 ms later, on the machine’s own clock — inside what is prompt on either clock, and before the backlog is answered',
      edits: [
        {
          file: MACHINE,
          from: FORWARD_END,
          to: `    setTimeout(() => {\n      ${ENDED_AT_ONCE}    }, 300);\n${FORWARD_END}`
        }
      ]
    },
    {
      id: 'C16-the-forward-end-ends-the-request-later',
      arm: 'FL2',
      describe:
        'the forward leg’s end ends the request 2 300 ms later, on the machine’s own clock — past what is prompt on either clock, so only a backlog answered later than that can read it: the fake clock’s, answered once the request is its deadline less what is prompt old, 4 000 ms, where the real clock’s is answered at about 2 000 ms',
      edits: [
        {
          file: MACHINE,
          from: FORWARD_END,
          to: `    setTimeout(() => {\n      ${ENDED_AT_ONCE}    }, 2300);\n${FORWARD_END}`
        }
      ]
    },
    {
      id: 'C16-the-forward-end-ends-the-request-a-moment-later-on-a-clock-taken-at-load',
      arm: 'FL2',
      describe:
        'the forward leg’s end ends the request 300 ms later on a clock taken as the machine was loaded, which the fake one does not move — so only a run that waits in real time can read it',
      edits: [
        TAKEN_AT_LOAD,
        {
          file: MACHINE,
          from: FORWARD_END,
          to: `    scheduleLater(() => {\n      ${ENDED_AT_ONCE}    }, 300);\n${FORWARD_END}`
        }
      ]
    },
    {
      id: 'C16-the-forward-end-closes-the-backlog',
      arm: 'FL2',
      describe:
        'the forward leg’s end closes the backlog’s subscription as well, so the backlog’s events never reach the request and only its deadline ends it',
      edits: [{ file: MACHINE, from: FORWARD_END, to: `    closeBackward();\n${FORWARD_END}` }]
    },
    {
      id: 'C16-the-forward-end-settles-the-backlog',
      arm: 'FL2',
      describe:
        'the forward leg’s end settles the backlog with what it holds, as an earlier version of the machine did, so what the backlog answers afterwards is discarded',
      edits: [
        { file: MACHINE, from: FORWARD_END, to: `    if (!settled) settle(false);\n${FORWARD_END}` }
      ]
    },
    {
      id: 'C16-the-forward-end-settles-the-backlog-as-timed-out',
      arm: 'FL2',
      describe:
        'the forward leg’s end settles the backlog as its deadline would, so the request reports an incomplete answer and discards what the backlog answers afterwards',
      edits: [
        { file: MACHINE, from: FORWARD_END, to: `    if (!settled) settle(true);\n${FORWARD_END}` }
      ]
    },
    {
      id: 'C16-the-backlog-end-ends-only-a-request-that-is-not-live',
      arm: 'FL2',
      describe:
        'the backlog’s end ends only a request that is not live, so a live request whose forward leg ended first is never ended once its backlog has answered',
      edits: [{ file: MACHINE, from: BACKLOG_END, to: '        if (!live) finish();\n' }]
    },
    {
      id: 'C16-events-after-the-forward-end-dropped',
      arm: 'FL2',
      describe:
        'the hook drops every event that arrives once the forward leg has ended, the backlog’s among them',
      edits: [
        {
          file: HOOK,
          from: EVENT_FOLD,
          to: `  if (base.forward?.end !== undefined) return base;\n${EVENT_FOLD}`
        }
      ]
    },
    {
      id: 'C16-a-full-bounded-answer-frozen-after-the-forward-end',
      arm: 'FL2',
      describe:
        'a bounded request whose forward leg has ended takes no more events once it holds as many as it keeps, so it keeps the oldest of its backlog rather than the newest — and holds as many events as it should',
      edits: [
        {
          file: HOOK,
          from: EVENT_FOLD,
          to:
            '  if (\n' +
            '    base.forward?.end !== undefined &&\n' +
            "    typeof options.retain === 'number' &&\n" +
            '    base.entries.size >= options.retain\n' +
            '  ) return base;\n' +
            EVENT_FOLD
        }
      ]
    },
    {
      id: 'C16-a-bounded-request-drops-what-arrives-after-the-forward-end',
      arm: 'FL2',
      describe:
        'a bounded request drops every event that arrives once its forward leg has ended, the backlog’s among them',
      edits: [
        {
          file: HOOK,
          from: EVENT_FOLD,
          to: `  if (base.forward?.end !== undefined && typeof options.retain === 'number') return base;\n${EVENT_FOLD}`
        }
      ]
    },
    {
      id: 'C16-a-bounded-request-keeps-the-last-to-arrive-after-the-forward-end',
      arm: 'FL2',
      describe:
        'a bounded request whose forward leg has ended keeps the last events to arrive rather than the newest, so a backlog sent newest first leaves it holding the older',
      edits: [LAST_TO_ARRIVE_KEPT_WHILE('base.forward?.end !== undefined')]
    },
    {
      id: 'C16-the-forward-end-never-ends-a-settled-request',
      arm: 'CS1',
      describe:
        'the forward leg’s end never ends the request, so a live request whose backlog has already answered stays live after its forward leg ends — the other order from this row’s, which `A5-C16`’s record credits to `A5-C2`’s arm: `CS1` reads `activity: live` once every relay has stopped over a settled backlog',
      edits: [{ file: MACHINE, from: FORWARD_END, to: '  };\n' }]
    },
    {
      id: 'C16-a-live-request-reads-idle-once-its-forward-leg-ends',
      arm: 'FL2',
      describe:
        'the activity axis reads `idle` as soon as the forward leg has ended, while the backlog is still being waited on',
      edits: [
        {
          file: HOOK,
          from: ACTIVITY,
          to: `      if (query.data?.forward?.end !== undefined) return 'idle';\n${ACTIVITY}`
        }
      ]
    },
    {
      id: 'C16-the-refusal-leaves-the-live-leg-running',
      arm: 'FL2',
      describe:
        'a relay’s `CLOSED` on the live subscription is recorded as a refusal and does not end the forward leg, so the premise — a forward leg that ended — is never reached',
      edits: [
        {
          file: MACHINE,
          from: "      advance(packet.from, 'terminal');\n    })\n",
          to: '    })\n'
        }
      ]
    },
    {
      id: 'C16-the-answer-read-on-the-fake-clock-held-up',
      arm: 'FL2',
      describe:
        'the arm’s run on the fake clock with no event, retained without bound, is held up in real time a little past that clock’s budget for what is prompt, once the backlog’s answer is read settled and before what it holds is read: the request reads as it should, and the run is read as held up rather than as prompt',
      edits: HELD_UP(FL2_ANSWER_READ, 'fake', FL2_RUN)
    },
    {
      id: 'C16-the-answer-read-on-the-real-clock-held-up',
      arm: 'FL2',
      describe:
        'the arm’s run on the real clock with no event, retained without bound, is held up in real time a little past that clock’s budget for what is prompt, once the backlog’s answer is read settled and before what it holds is read: the request reads as it should, and the run is read as held up rather than as prompt',
      edits: HELD_UP(FL2_ANSWER_READ, 'real', FL2_RUN)
    },
    {
      id: 'C17-the-last-end-wins',
      arm: 'FL3',
      describe: 'the value keeps whichever end it was told last',
      edits: [{ file: EVENTSET, from: FIRST_END_WINS, to: '' }]
    },
    {
      id: 'C17-only-a-blank-end-refused',
      arm: 'FL3',
      describe:
        'the value refuses a second end only when it carries no reason, so an explanation is replaced by another',
      edits: [
        {
          file: EVENTSET,
          from: FIRST_END_WINS,
          to: '  if (forward.end !== undefined && end.error === undefined) return set;\n'
        }
      ]
    },
    {
      id: 'C17-only-an-explained-end-kept',
      arm: 'FL3',
      describe:
        'the value keeps a first end only when it carries a reason, so a blank end is replaced by an explanation',
      edits: [
        {
          file: EVENTSET,
          from: FIRST_END_WINS,
          to: '  if (forward.end?.error !== undefined) return set;\n'
        }
      ]
    },
    {
      id: 'C17-the-first-end-kept-only-while-the-backlog-runs',
      arm: 'FL3',
      describe:
        'the value keeps a first end only while the backlog is running, so once the backlog has ended a second end is written over it',
      edits: [
        {
          file: EVENTSET,
          from: FIRST_END_WINS,
          to: '  if (set.running !== undefined && forward.end !== undefined) return set;\n'
        }
      ]
    },
    {
      id: 'C17-the-backlog-end-clears-the-forward-end',
      arm: 'FL3',
      describe:
        'the backlog’s end, swapping its record in, clears the forward leg’s end, so a second end after it is recorded as though it were the first',
      edits: [
        {
          file: EVENTSET,
          from: BACKLOG_SWAPPED_IN,
          to:
            '    running: undefined,\n' +
            '    failure,\n' +
            '    forward: set.forward === undefined ? undefined : { ...set.forward, end: undefined }\n' +
            '  };'
        }
      ]
    },
    {
      id: 'C17-a-forward-refusal-rebuilds-the-forward-record',
      arm: 'FL3',
      describe:
        'a refusal on the live leg rebuilds the forward record as an attempt’s beginning builds one, with no end, so a second end after a second refusal is recorded as though it were the first',
      edits: [
        {
          file: EVENTSET,
          from: FORWARD_REFUSAL_ADDED,
          to: '    return { ...set, forward: { attemptId, end: undefined, refusals: [...forward.refusals, refusal] } };\n'
        }
      ]
    },
    {
      id: 'C17-the-first-end-kept-only-before-any-refusal',
      arm: 'FL3',
      describe:
        'the value keeps a first end only while the live leg holds no refusal, so a leg refused before its ends, as a `CLOSED` refuses one, has its first end written over',
      edits: [
        {
          file: EVENTSET,
          from: FIRST_END_WINS,
          to: '  if (forward.refusals.length === 0 && forward.end !== undefined) return set;\n'
        }
      ]
    },
    {
      id: 'C17-no-end-recorded',
      arm: 'FL3',
      describe:
        'the value records no end at all, so the first end is kept only in the sense that nothing replaced it — the arm’s control, the value after the first end, reads it unrecorded',
      edits: [
        {
          file: EVENTSET,
          from: '  return { ...set, forward: { ...forward, end: Object.freeze(end) } };\n}',
          to: '  return set;\n}'
        }
      ]
    }
  ],
  retired: [
    {
      id: 'C16-the-forward-end-never-ends-a-settled-request-read-by-this-arm',
      arm: 'FL2',
      describe:
        'the forward leg’s end never ends the request, so a live request whose backlog has already answered stays live after its forward leg ends',
      reason:
        'That is the other order — the backlog first, then the forward leg — and this row’s Given is the forward leg first. Measured, it survived `FL2`; the entry `C16-the-forward-end-never-ends-a-settled-request` holds the same edit against `CS1`, `A5-C2`’s arm, which fails it.',
      edits: [{ file: MACHINE, from: FORWARD_END, to: '  };\n' }]
    },
    {
      id: 'C17-two-blank-ends-written-over',
      arm: 'FL3',
      describe: 'the value replaces a blank end with a second blank end',
      reason:
        'Two blank ends carry the same kind and the same absent reason, so under this row’s reading — the end the value keeps, and the explanation it carries — the first is kept either way: measured, it survived `FL3`, which does not make that order. Only a reader of the end’s object identity could tell them apart, and this row does not promise one.',
      edits: [
        {
          file: EVENTSET,
          from: FIRST_END_WINS,
          to: '  if (forward.end !== undefined && !(forward.end.error === undefined && end.error === undefined)) return set;\n'
        }
      ]
    },
    {
      id: 'C1-the-live-leg-held-back-inside-a-turn',
      arm: 'FL1',
      describe:
        'the live leg’s events are handed to the gate 50 ms after they arrive, on the machine’s own clock',
      reason:
        'That is inside the delivery turn the arm lets pass before it sends the backlog’s `EOSE`, so the events are still delivered ahead of it, which is what the arm reads: the bound is the turn, and this is its near edge. Measured, it survived `FL1` on both clocks, while the same hold-back at 300 ms fails it.',
      edits: [
        {
          file: MACHINE,
          from: LIVE_NEXT,
          to: "          next: (packet) => void setTimeout(() => admitEvent('forward', packet), 50),\n"
        }
      ]
    }
  ]
} satisfies Ledger;
