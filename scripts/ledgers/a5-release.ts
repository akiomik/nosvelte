/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of what a request lets go of when each leg ends (A5),
 * and its landings:
 * - `A5-C21` on `RL1`;
 * - `A5-C23` on `RL2`;
 * - `A5-C24` on `RL3`.
 *
 * An id begins with the row it is read against, `C<n>-` for `A5-C<n>`. Two
 * entries may carry the same edit when two rows each owe a failure under it;
 * each is judged by its own arm.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const ARM = 'src/tests/contracts/engine/release.test.ts';

/** The library's release of the backlog's subscription, where its outcome is queued and at the end. */
const RELEASE = '    backward?.unsubscribe();\n    backward = undefined;\n';
/** The backlog's subscription kept among the ones the end closes. */
const KEPT = '  if (backward !== undefined) subscriptions.push(backward);\n';
/** The backlog asked as a oneshot, which the dependency closes on `EOSE`. */
const ONESHOT =
  '  const backwardReq = createRxOneshotReq({ filters, rxReqId: `${reqIdBase}-b` });\n';
/** The request's own timer, the line after the backlog's subscription. */
const TIMER =
  '  if (timeoutMs !== undefined) {\n    timer = setTimeout(() => settle(true), timeoutMs);';
/** The backlog asked on a subscription the dependency keeps open past `EOSE`. */
const KEPT_OPEN_BY_THE_DEPENDENCY = [
  {
    file: MACHINE,
    from: ONESHOT,
    to: '  const backwardReq = createRxForwardReq(`${reqIdBase}-b`);\n'
  },
  { file: MACHINE, from: TIMER, to: `  backwardReq.emit(filters);\n${TIMER}` }
];
/** The backlog's subscription no longer unsubscribed where its outcome is queued. */
const UNRELEASED = { file: MACHINE, from: RELEASE, to: '    backward = undefined;\n' };
/** The backlog's subscription not kept among the ones the end closes. */
const UNKEPT = { file: MACHINE, from: KEPT, to: '' };
/** Nothing in the library unsubscribes the backlog's subscription. */
const NEVER_RELEASED = [UNRELEASED, UNKEPT];
/** The backlog's end, closing its own subscription. */
const BACKLOG_END_CLOSE = '        closeBackward();\n        // Released before';
/** The consumer's abort, closing everything the request holds. */
const ABORT_CLOSE = '  const onAbort = () => {\n    ended = true;\n    closeAll();\n';
/** The generator's `finally`, closing everything the request holds. */
const FINALLY_CLOSE = "      signal.removeEventListener('abort', onAbort);\n      closeAll();\n";
/** The backlog asked again, on the same name, as soon as its subscription is closed. */
const ASKED_AGAIN = {
  file: MACHINE,
  from: BACKLOG_END_CLOSE,
  to:
    '        closeBackward();\n' +
    '        const reopened = createRxForwardReq(`${reqIdBase}-b`);\n' +
    '        transport.use(reopened, routeToTargets)?.subscribe({});\n' +
    '        reopened.emit(filters);\n' +
    '        // Released before'
};
/** The backlog asked again, on the same name, a second after its subscription is closed. */
const ASKED_AGAIN_LATER = {
  file: MACHINE,
  from: BACKLOG_END_CLOSE,
  to:
    '        closeBackward();\n' +
    '        setTimeout(() => {\n' +
    '          const reopened = createRxForwardReq(`${reqIdBase}-b`);\n' +
    '          transport.use(reopened, routeToTargets)?.subscribe({});\n' +
    '          reopened.emit(filters);\n' +
    '        }, 1000);\n' +
    '        // Released before'
};
/**
 * The backlog asked on a subscription the dependency keeps open, and released
 * by the library only at the request's deadline — for a request that is not
 * live, which is also when it ends.
 */
const RELEASED_AT_THE_DEADLINE = [
  ...KEPT_OPEN_BY_THE_DEPENDENCY.slice(0, 1),
  {
    file: MACHINE,
    from: TIMER,
    to:
      '  backwardReq.emit(filters);\n' +
      '  if (timeoutMs !== undefined) {\n' +
      '    timer = setTimeout(() => {\n' +
      '      settle(true);\n' +
      '      closeBackward();\n' +
      '      if (!live) finish();\n' +
      '    }, timeoutMs);'
  },
  {
    file: MACHINE,
    from: BACKLOG_END_CLOSE,
    to: '        if (viaTimer) closeBackward();\n        // Released before'
  },
  {
    file: MACHINE,
    from: '        if (!live || forwardEnded) finish();\n',
    to: '        if (forwardEnded || (!live && viaTimer)) finish();\n'
  }
];
/** The request's deadline, as the machine sets it. */
const DEADLINE = '    timer = setTimeout(() => settle(true), timeoutMs);';
/** The deadline closing every subscription the request holds, a live leg included. */
const DEADLINE_CLOSES_ALL =
  '    timer = scheduleDeadline(() => {\n      settle(true);\n      closeAll();\n    }, timeoutMs);';
/** The arm's reader of the wire, folding the frames in the order they were sent. */
const FOLDED =
  "    if (kind === 'REQ') open.add(String(subId));\n" +
  "    if (kind === 'CLOSE') open.delete(String(subId));\n" +
  '  }\n';
/** The arm's `delay`, after which the clock a run is held up on is taken. */
const DELAY =
  'const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));\n';
/**
 * The run with no event, retained without bound, on the fake clock or on the
 * real one, held up in real time a little past that clock's budget for what is
 * prompt, right after `then` — on a clock taken as the arm was loaded, which
 * the fake one does not move.
 */
const HELD_UP = (
  then: string,
  clock: 'fake' | 'real',
  only = ''
): { file: string; from: string; to: string }[] => [
  {
    file: ARM,
    from: DELAY,
    to: `${DELAY}const pauseInRealTime = globalThis.setTimeout.bind(globalThis);\n`
  },
  {
    file: ARM,
    from: then,
    to:
      then +
      `            if (${clock === 'fake' ? '' : '!'}clock.fake${only} && nameOf(ending) === '0 event, retaining unbounded') {\n` +
      '              await new Promise<void>((done) => pauseInRealTime(done, clock.promptMs + 100));\n' +
      '            }\n'
  }
];
/** The arm's wrapper, which passes the dependency's errors on and not its completion. */
const NO_COMPLETION =
  '        error: (reason: unknown) => subscriber.error(reason)\n' +
  '        // No `complete`: the dependency finishing does not finish this.\n';

export default {
  name: 'a5-release',
  subject:
    '`A5-C21`, `A5-C23` and `A5-C24` (what a request lets go of when each leg ends): their landings, `RL1`–`RL3`',
  files: ['src/tests/contracts/engine/release.test.ts'],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { RL1: 9, RL2: 9, RL3: 9 }
  },
  entries: [
    {
      id: 'C21-the-backlog-left-open-on-the-wire',
      arm: 'RL1',
      describe:
        'the backlog is asked on a subscription the dependency keeps open past `EOSE`, and nothing in the library releases it, so the backward subscription is still open on the wire after the backlog has ended',
      edits: [...KEPT_OPEN_BY_THE_DEPENDENCY, ...NEVER_RELEASED]
    },
    {
      id: 'C21-the-backlog-end-closes-the-live-leg',
      arm: 'RL1',
      describe:
        'the backlog’s end closes every subscription the request holds rather than its own, so the live leg’s `CLOSE` reaches the wire with the backlog’s',
      edits: [
        {
          file: MACHINE,
          from: BACKLOG_END_CLOSE,
          to: '        closeAll();\n        // Released before'
        }
      ]
    },
    {
      id: 'C21-the-live-leg-closed-by-its-eose',
      arm: 'RL1',
      describe:
        'the live leg is asked on a subscription the dependency closes on `EOSE`, so the relay answering it — as a relay answers every subscription — closes the live leg with the backlog',
      edits: [
        {
          file: MACHINE,
          from: "import { createRxForwardReq, createRxOneshotReq, isFiltered } from 'rx-nostr';",
          to: "import { createRxBackwardReq, createRxForwardReq, createRxOneshotReq, isFiltered } from 'rx-nostr';"
        },
        {
          file: MACHINE,
          from: '    const forwardReq = createRxForwardReq(`${reqIdBase}-f`);\n',
          to: '    const forwardReq = createRxBackwardReq(`${reqIdBase}-f`);\n'
        }
      ]
    },
    {
      id: 'C21-the-live-leg-asked-as-a-oneshot',
      arm: 'RL1',
      describe:
        'the live leg is asked as a oneshot carrying its filters, so the relay answering it with `EOSE` closes the live leg with the backlog — the same door as `C21-the-live-leg-closed-by-its-eose`, through the producer the backlog is asked on',
      edits: [
        {
          file: MACHINE,
          from: '    const forwardReq = createRxForwardReq(`${reqIdBase}-f`);\n',
          to:
            '    const forwardReq = createRxOneshotReq({\n' +
            '      filters: forwardLimitZero ? filters.map((filter) => ({ ...filter, limit: 0 })) : filters,\n' +
            '      rxReqId: `${reqIdBase}-f`\n' +
            '    });\n'
        },
        {
          file: MACHINE,
          from:
            '    forwardReq.emit(\n' +
            '      forwardLimitZero ? filters.map((filter) => ({ ...filter, limit: 0 })) : filters\n' +
            '    );\n',
          to: ''
        }
      ]
    },
    {
      id: 'C21-the-teardown-leaves-the-live-leg-open',
      arm: 'RL1',
      describe:
        'neither the abort handler nor the generator’s `finally` closes anything, so the consumer’s teardown leaves the live subscription open on the wire',
      edits: [
        { file: MACHINE, from: ABORT_CLOSE, to: '  const onAbort = () => {\n    ended = true;\n' },
        {
          file: MACHINE,
          from: FINALLY_CLOSE,
          to: "      signal.removeEventListener('abort', onAbort);\n"
        }
      ]
    },
    {
      id: 'C21-the-backlog-released-at-its-deadline',
      arm: 'RL1',
      describe:
        'the backlog is asked on a subscription the dependency keeps open past `EOSE`, and the library releases it only at the request’s deadline, so the backlog is open on the wire from its end to that deadline',
      edits: RELEASED_AT_THE_DEADLINE
    },
    {
      id: 'C21-the-drain-closes-both-legs',
      arm: 'RL1',
      describe:
        'the gate, once it has drained a backlog’s events, closes every subscription the request holds, so a live leg whose backlog carried an event is closed with it',
      edits: [
        {
          file: MACHINE,
          from: "      resolveGate(gate, 'drained');\n    };",
          to: "      closeAll();\n      resolveGate(gate, 'drained');\n    };"
        }
      ]
    },
    {
      id: 'C21-the-bounded-request-ends-at-its-settle',
      arm: 'RL1',
      describe:
        'a request that retains a bounded number of events is read as a finite stream and stops at its `settled`, so its live leg is closed with the backlog',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '      return twoStageStream({\n',
          to: '      const source = twoStageStream({\n'
        },
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '        settleTimeoutMs: (descriptor as NormalizedDescriptor).settleTimeoutMs\n      });\n    };',
          to:
            '        settleTimeoutMs: (descriptor as NormalizedDescriptor).settleTimeoutMs\n' +
            '      });\n' +
            "      if ((descriptor as NormalizedDescriptor).retain === 'unbounded') return source;\n" +
            '      return (async function* () {\n' +
            '        for await (const chunk of source) {\n' +
            '          yield chunk;\n' +
            "          if (chunk.type === 'settled') return;\n" +
            '        }\n' +
            '      })();\n' +
            '    };'
        }
      ]
    },
    {
      id: 'C21-the-partial-drain-closes-both-legs',
      arm: 'RL1',
      describe:
        'the gate, each time it has drained one of a backlog’s events with another still held, closes every subscription the request holds, so a live leg whose backlog carried two events is closed with it',
      edits: [
        {
          file: MACHINE,
          from: '      if (gate.holding.size > 0) {\n',
          to: '      if (gate.holding.size > 0) {\n        closeAll();\n'
        }
      ]
    },
    {
      id: 'C21-the-bounded-request-ends-past-its-bound',
      arm: 'RL1',
      describe:
        'a request that retains a bounded number of events stops once it has received more than it retains, so a live leg whose backlog overflowed the bound is closed with it',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '      return twoStageStream({\n',
          to: '      const source = twoStageStream({\n'
        },
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '        settleTimeoutMs: (descriptor as NormalizedDescriptor).settleTimeoutMs\n      });\n    };',
          to:
            '        settleTimeoutMs: (descriptor as NormalizedDescriptor).settleTimeoutMs\n' +
            '      });\n' +
            '      const retain = (descriptor as NormalizedDescriptor).retain;\n' +
            "      if (retain === 'unbounded') return source;\n" +
            '      return (async function* () {\n' +
            '        let received = 0;\n' +
            '        for await (const chunk of source) {\n' +
            '          yield chunk;\n' +
            "          if (chunk.type === 'event' && ++received > retain) return;\n" +
            '        }\n' +
            '      })();\n' +
            '    };'
        }
      ]
    },
    {
      id: 'C21-the-deadline-closes-the-live-leg',
      arm: 'RL1',
      describe:
        'the request’s deadline closes every subscription it holds, even once its backlog has settled, so a live leg is closed when the deadline passes',
      edits: [
        {
          file: MACHINE,
          from: DEADLINE,
          to: DEADLINE_CLOSES_ALL.replace('scheduleDeadline', 'setTimeout')
        }
      ]
    },
    {
      id: 'C21-the-deadline-on-a-loaded-clock-closes-the-live-leg',
      arm: 'RL1',
      describe:
        'the deadline that closes the live leg is scheduled through a `setTimeout` the machine took hold of as it was loaded, so it runs on whatever clock was there then — the same defect as `C21-the-deadline-closes-the-live-leg`, which a fake clock installed after the machine was loaded never moves and only the real clock reads',
      edits: [
        {
          file: MACHINE,
          from: 'export interface MachineParams {',
          to: 'const scheduleDeadline = globalThis.setTimeout.bind(globalThis);\n\nexport interface MachineParams {'
        },
        { file: MACHINE, from: DEADLINE, to: DEADLINE_CLOSES_ALL }
      ]
    },
    {
      id: 'C21-the-deadline-as-an-abort-signal-closes-the-live-leg',
      arm: 'RL1',
      describe:
        'the deadline that closes the live leg is `AbortSignal.timeout`, which no fake clock moves — the same defect as `C21-the-deadline-closes-the-live-leg`, which only the real clock reads',
      edits: [
        {
          file: MACHINE,
          from: DEADLINE,
          to:
            '    const deadline = AbortSignal.timeout(timeoutMs);\n' +
            "    deadline.addEventListener('abort', () => {\n" +
            '      settle(true);\n' +
            '      closeAll();\n' +
            '    }, { once: true, signal });'
        }
      ]
    },
    {
      id: 'C21-the-deadline-read-off-temporal-closes-the-live-leg',
      arm: 'RL1',
      describe:
        'the deadline that closes the live leg is read off `Temporal.Now`, which the fake clock does not move, and waited for a step at a time — the same defect as `C21-the-deadline-closes-the-live-leg`, which only the real clock reads',
      edits: [
        {
          file: MACHINE,
          from: DEADLINE,
          to:
            '    const expiresAt = Temporal.Now.instant().epochMilliseconds + timeoutMs;\n' +
            '    const onDeadline = () => {\n' +
            '      const remaining = expiresAt - Temporal.Now.instant().epochMilliseconds;\n' +
            '      if (remaining > 0) {\n' +
            '        timer = setTimeout(onDeadline, remaining);\n' +
            '        return;\n' +
            '      }\n' +
            '      settle(true);\n' +
            '      closeAll();\n' +
            '    };\n' +
            '    timer = setTimeout(onDeadline, timeoutMs);'
        }
      ]
    },
    {
      id: 'C21-the-empty-backlog-closes-everything-at-a-native-deadline',
      arm: 'RL1',
      describe:
        'a backlog that ends with no event to drain arms `AbortSignal.timeout` for the request’s deadline, which closes every subscription the request holds — the same defect as `C21-the-deadline-as-an-abort-signal-closes-the-live-leg`, on the path of a backlog with nothing to drain alone, which only the real clock reads',
      edits: [
        {
          file: MACHINE,
          from: "    if (gate.holding.size === 0) {\n      resolveGate(gate, 'drained');",
          to:
            '    if (gate.holding.size === 0) {\n' +
            "      if (leg === 'backward' && timeoutMs !== undefined) {\n" +
            "        AbortSignal.timeout(timeoutMs).addEventListener('abort', () => closeAll(), { once: true, signal });\n" +
            '      }\n' +
            "      resolveGate(gate, 'drained');"
        }
      ]
    },
    {
      id: 'C21-the-unbounded-request-ends-at-a-native-deadline',
      arm: 'RL1',
      describe:
        'a request that retains without bound runs on its invocation’s signal joined with `AbortSignal.timeout` for its deadline, so the request is aborted, and its live leg closed, when that fires — the same defect as `C21-the-deadline-as-an-abort-signal-closes-the-live-leg`, on the path of a request that retains without bound alone, which only the real clock reads',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '      const signal = invocation.signal;',
          to:
            "      const signal = (descriptor as NormalizedDescriptor).retain === 'unbounded'\n" +
            '        ? AbortSignal.any([invocation.signal, AbortSignal.timeout((descriptor as NormalizedDescriptor).settleTimeoutMs)])\n' +
            '        : invocation.signal;'
        }
      ]
    },
    {
      id: 'C21-the-run-on-the-fake-clock-held-up',
      arm: 'RL1',
      describe:
        'the arm’s run on the fake clock with no event, retained without bound, is held up in real time a little past that clock’s budget for what is prompt, a fifth of the library’s default deadline, before the backlog’s end is read: the wire reads as it should, and the run is read as held up rather than as prompt — so a release made while it was held up, later than what is prompt, on a clock the fake one does not move, is not read as prompt',
      edits: HELD_UP(
        '            relay.answerLive();\n            relay.answerBacklog();\n',
        'fake'
      )
    },
    {
      id: 'C21-the-run-on-the-real-clock-held-up',
      arm: 'RL1',
      describe:
        'the arm’s run on the real clock with no event, retained without bound, is held up in real time a little past that clock’s budget for what is prompt, half the deadline it gives, before the backlog’s end is read: the wire reads as it should, and the run is read as held up rather than as prompt — so a release made while it was held up, later than what is prompt, is not read as prompt',
      edits: HELD_UP(
        '            relay.answerLive();\n            relay.answerBacklog();\n',
        'real'
      )
    },
    {
      id: 'C21-the-teardown-read-on-the-fake-clock-held-up',
      arm: 'RL1',
      describe:
        'the arm’s run on the fake clock with no event, retained without bound, is held up in real time a little past that clock’s budget for what is prompt, a fifth of the library’s default deadline, between the consumer’s teardown and the read after it: the wire reads as it should, and the run is read as held up rather than as prompt — so a close made while it was held up, later than what is prompt, on a clock the fake one does not move, is not read as prompt',
      edits: HELD_UP('            await consumer.tearDown();\n', 'fake')
    },
    {
      id: 'C21-the-teardown-read-on-the-real-clock-held-up',
      arm: 'RL1',
      describe:
        'the arm’s run on the real clock with no event, retained without bound, is held up in real time a little past that clock’s budget for what is prompt, half the deadline it gives, between the consumer’s teardown and the read after it: the wire reads as it should, and the run is read as held up rather than as prompt — so a close made while it was held up, later than what is prompt, is not read as prompt',
      edits: HELD_UP('            await consumer.tearDown();\n', 'real')
    },
    {
      id: 'C21-the-live-leg-asked-again-on-its-name',
      arm: 'RL1',
      describe:
        'the live leg is asked again on its own name once the backlog has ended, which replaces the subscription with no `CLOSE` on the wire',
      edits: [
        {
          file: MACHINE,
          from:
            '    forwardReq.emit(\n' +
            '      forwardLimitZero ? filters.map((filter) => ({ ...filter, limit: 0 })) : filters\n' +
            '    );\n',
          to:
            '    forwardReq.emit(\n' +
            '      forwardLimitZero ? filters.map((filter) => ({ ...filter, limit: 0 })) : filters\n' +
            '    );\n' +
            '    afterBacklog.push(() => forwardReq.emit(filters.map((filter) => ({ ...filter, since: 1 }))));\n'
        }
      ]
    },
    {
      id: 'C21-the-backlog-asked-again-later',
      arm: 'RL1',
      describe:
        'the backlog is asked again on the same name a second after its subscription is closed, so it is open again inside the span the request is held for',
      edits: [ASKED_AGAIN_LATER]
    },
    {
      id: 'C21-the-backlog-asked-again-after-its-close',
      arm: 'RL1',
      describe:
        'the backlog is asked again on the same name the moment its subscription is closed, so a `CLOSE` is on the wire and the backlog is open after it',
      edits: [ASKED_AGAIN]
    },
    {
      id: 'C21-the-reader-subtracts-every-close',
      arm: 'RL1',
      requires: ['RL2'],
      describe:
        'the arms’ reader of the wire takes a name closed once as closed for good, so a backlog asked again after its `CLOSE` reads closed — its control, frames that close a backlog and ask it again, reads nothing open',
      edits: [
        {
          file: ARM,
          from: FOLDED,
          to:
            "    if (kind === 'REQ') open.add(String(subId));\n" +
            '  }\n' +
            '  for (const [kind, subId] of frames) {\n' +
            "    if (kind === 'CLOSE') open.delete(String(subId));\n" +
            '  }\n'
        }
      ]
    },
    {
      id: 'C23-the-backlog-left-open-on-the-wire',
      arm: 'RL2',
      describe:
        'a request that is not live keeps its backlog’s subscription open on the wire after it settles: asked on a subscription the dependency keeps open, and released by nothing in the library',
      edits: [...KEPT_OPEN_BY_THE_DEPENDENCY, ...NEVER_RELEASED]
    },
    {
      id: 'C23-the-backlog-asked-again-after-its-close',
      arm: 'RL2',
      describe:
        'a request that is not live asks its backlog again on the same name the moment its subscription is closed, so it settles with the backlog open on the wire',
      edits: [ASKED_AGAIN]
    },
    {
      id: 'C23-the-backlog-released-at-its-deadline',
      arm: 'RL2',
      describe:
        'a request that is not live keeps its backlog’s subscription open on the wire from its settle to its deadline: asked on a subscription the dependency keeps open, and released by the library, and ended, only then',
      edits: RELEASED_AT_THE_DEADLINE
    },
    {
      id: 'C23-the-backlog-asked-again-later',
      arm: 'RL2',
      describe:
        'a request that is not live asks its backlog again on the same name a second after it settles, so the backlog is open again with the consumer still mounted',
      edits: [ASKED_AGAIN_LATER]
    },
    {
      id: 'C23-the-run-on-the-fake-clock-held-up',
      arm: 'RL2',
      describe:
        'the arm’s run on the fake clock with no event, retained without bound, is held up in real time a little past that clock’s budget for what is prompt, a fifth of the library’s default deadline, before the request’s outcome is read: the wire reads as it should, and the run is read as held up rather than as prompt — so a release made while it was held up, later than what is prompt, on a clock the fake one does not move, is not read as prompt',
      edits: HELD_UP(
        "            relay.sendBacklog(ending.events, 'rl2');\n            relay.answerBacklog();\n",
        'fake'
      )
    },
    {
      id: 'C23-the-run-on-the-real-clock-held-up',
      arm: 'RL2',
      describe:
        'the arm’s run on the real clock with no event, retained without bound, is held up in real time a little past that clock’s budget for what is prompt, half the deadline it gives, before the request’s outcome is read: the wire reads as it should, and the run is read as held up rather than as prompt — so a release made while it was held up, later than what is prompt, is not read as prompt',
      edits: HELD_UP(
        "            relay.sendBacklog(ending.events, 'rl2');\n            relay.answerBacklog();\n",
        'real'
      )
    },
    {
      id: 'C24-the-library-never-releases-the-backlog',
      arm: 'RL3',
      describe:
        'nothing in the library unsubscribes the backlog’s subscription — the dependency’s oneshot still closes it on the wire — so a producer that does not complete is never let go of',
      edits: NEVER_RELEASED
    },
    {
      id: 'C24-the-backlog-released-only-at-the-end',
      arm: 'RL3',
      describe:
        'the backlog’s outcome no longer unsubscribes its subscription, so a live request lets go of it only when it ends — the dependency’s oneshot still closes it on the wire at `EOSE`',
      edits: [UNRELEASED]
    },
    {
      id: 'C24-the-backlog-held-until-the-teardown',
      arm: 'RL3',
      describe:
        'the backlog’s outcome releases nothing and a request that is not live no longer ends at it, so its subscription is let go of only when the consumer goes away — the shipped v1 defect, which the wire does not show, since the dependency’s oneshot still closes it there',
      edits: [
        UNRELEASED,
        {
          file: MACHINE,
          from: '        if (!live || forwardEnded) finish();\n',
          to: '        if (forwardEnded) finish();\n'
        }
      ]
    },
    {
      id: 'C24-the-backlog-taken-twice',
      arm: 'RL3',
      describe:
        'the backlog’s producer is subscribed a second time, to watch for its completion: two taken, with still one `REQ` on the wire — on a request that is not live both released at its end, and on a live one the second held until the teardown — evidence about what is taken, not a release repeated, which is the dependency’s to refuse',
      edits: [
        {
          file: MACHINE,
          from: KEPT,
          to:
            KEPT +
            '  const completion = transport.use(backwardReq, routeToTargets)?.subscribe({ complete: () => settle(false) });\n' +
            '  if (completion !== undefined) subscriptions.push(completion);\n'
        }
      ]
    },
    {
      id: 'C24-the-run-on-the-fake-clock-held-up',
      arm: 'RL3',
      describe:
        'the arm’s live run on the fake clock with no event, retained without bound, is held up in real time a little past that clock’s budget for what is prompt, a fifth of the library’s default deadline, before the request’s outcome is read: the counts read as they should, and the run is read as held up rather than as prompt — so a release made while it was held up, later than what is prompt, on a clock the fake one does not move, is not read as prompt',
      edits: HELD_UP(
        '            if (live) relay.answerLive();\n            relay.answerBacklog();\n',
        'fake',
        ' && live'
      )
    },
    {
      id: 'C24-the-run-on-the-real-clock-held-up',
      arm: 'RL3',
      describe:
        'the arm’s live run on the real clock with no event, retained without bound, is held up in real time a little past that clock’s budget for what is prompt, half the deadline it gives, before the request’s outcome is read: the counts read as they should, and the run is read as held up rather than as prompt — so a release made while it was held up, later than what is prompt, is not read as prompt',
      edits: HELD_UP(
        '            if (live) relay.answerLive();\n            relay.answerBacklog();\n',
        'real',
        ' && live'
      )
    },
    {
      id: 'C24-the-wrapper-completes-with-the-dependency',
      arm: 'RL3',
      describe:
        'the arm’s wrapper passes the dependency’s completion on, so a release it counts may be the dependency finishing rather than anybody letting go — its control, a oneshot of the arm’s own answered with `EOSE`, is counted released',
      edits: [
        {
          file: ARM,
          from: NO_COMPLETION,
          to:
            '        error: (reason: unknown) => subscriber.error(reason),\n' +
            '        complete: () => subscriber.complete()\n'
        }
      ]
    },
    {
      id: 'C24-the-release-uncounted',
      arm: 'RL3',
      describe:
        'the arm’s wrapper counts no teardown, so no release could be read — its control, the arm’s own `unsubscribe()`, counts nothing',
      edits: [{ file: ARM, from: '        held.released += 1;\n', to: '' }]
    }
  ],
  retired: [
    {
      id: 'C23-the-backlog-kept-open-by-the-dependency',
      arm: 'RL2',
      describe:
        'the backlog is asked on a subscription the dependency keeps open past `EOSE`, with the library’s release in place',
      reason:
        'The library’s own release closes it, which is what that release is for: measured, it survived `RL1`, `RL2` and `RL3`. With the release removed as well it is `C21-the-backlog-left-open-on-the-wire` and `C23-the-backlog-left-open-on-the-wire`.',
      edits: KEPT_OPEN_BY_THE_DEPENDENCY
    },
    {
      id: 'C23-the-library-never-releases-the-backlog',
      arm: 'RL2',
      describe: 'nothing in the library unsubscribes the backlog’s subscription',
      reason:
        'The dependency closes its oneshot on `EOSE`, so the wire reads the same: measured, it survived `RL1` and `RL2`. That is why `A5-C24` was split from `A5-C21`, and `C24-the-library-never-releases-the-backlog` is the same edit read where the producer does not complete.',
      edits: NEVER_RELEASED
    },
    {
      id: 'C24-the-backlog-not-kept-for-the-end',
      arm: 'RL3',
      describe: 'the backlog’s subscription is not kept among the ones the end closes',
      reason:
        'The outcome releases it first, in `closeBackward`. Measured, `{ taken: 1, released: 1 }` at the outcome.',
      edits: [UNKEPT]
    },
    {
      id: 'C24-one-subscription-released-twice',
      arm: 'RL3',
      describe: 'the backlog’s outcome unsubscribes its subscription twice',
      reason:
        'RxJS runs a subscription’s teardown once, so a second `unsubscribe()` of it releases nothing — and the shipping code already makes one, since the backlog’s subscription stays in `subscriptions` after `closeBackward` and `closeAll()` walks it. Measured, `{ taken: 1, released: 1 }`. That half of "exactly once" is the dependency’s, and `RL3` reads it in its control, whose own `unsubscribe()` is made twice and counted once.',
      edits: [
        {
          file: MACHINE,
          from: RELEASE,
          to: '    backward?.unsubscribe();\n    backward?.unsubscribe();\n    backward = undefined;\n'
        }
      ]
    },
    {
      id: 'C21-the-abort-closes-nothing',
      arm: 'RL1',
      describe: 'the consumer’s abort closes nothing',
      reason:
        'In this arrangement, where the hook is draining the stream when the consumer goes, the generator’s `finally` closes the live leg as the aborted stream returns, a turn later. Measured, it survived `RL1`.',
      edits: [
        { file: MACHINE, from: ABORT_CLOSE, to: '  const onAbort = () => {\n    ended = true;\n' }
      ]
    },
    {
      id: 'C21-the-finally-closes-nothing',
      arm: 'RL1',
      describe: 'the generator’s `finally` closes nothing',
      reason:
        'The abort handler has already closed the live leg by then. Measured, it survived `RL1`.',
      edits: [
        {
          file: MACHINE,
          from: FINALLY_CLOSE,
          to: "      signal.removeEventListener('abort', onAbort);\n"
        }
      ]
    }
  ]
} satisfies Ledger;
