/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of what a request answers when the relays it is asking
 * are gone (A5), and its landings:
 * - `A5-C9` on `GN1`;
 * - `A5-C11` on `GN2`;
 * - `A5-C14` on `GN3`;
 * - `A5-C10` on `GN4`;
 * - `A5-C15` on `GN5`;
 * - `A5-C22` on `GN6`.
 *
 * An id begins with the row it is read against, `C<n>-` for `A5-C<n>`. Two
 * entries may carry the same edit when two rows each owe a failure under it;
 * each is judged by its own arm.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const ENGINE = 'src/lib/v1/engine.ts';
const REFUSAL = 'src/lib/v1/refusal.ts';
const ACCUMULATE = 'src/lib/v1/accumulate.ts';

/** The preflight's record of a relay that refused the connection before the request began. */
const GIVE_UP = '        preflightTerminal.push(url);\n';
/** The preflight's relays, applied through the backward table's one writer. */
const PREFLIGHT_BACKWARD =
  "  for (const url of preflightTerminal) {\n    advanceBackward(url, 'ended');";
/** A terminal connection state, read into the backward table. */
const TERMINAL_STATE = "      if (phase === 'terminal') advanceBackward(packet.from, 'ended');\n";
/** `error` — the dependency's retries used up — classified terminal. */
const ERROR_TERMINAL = "    case 'error':\n    case 'rejected':";
/** The cause a relay that went terminal adds to the backlog's outcome. */
const GONE_CAUSE = "    if (gone.length > 0) present.add('ended');\n";

export default {
  name: 'a5-gone',
  subject:
    '`A5-C9`, `A5-C10`, `A5-C11`, `A5-C14`, `A5-C15` and `A5-C22` (what a request answers when the relays it is asking are gone): their landings, `GN1`–`GN6`',
  files: ['src/tests/contracts/engine/gone.test.ts'],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { GN1: 7, GN2: 7, GN3: 5, GN4: 8, GN5: 7, GN6: 5 }
  },
  entries: [
    {
      id: 'C9-a-refused-relay-left-pending',
      arm: 'GN1',
      describe:
        'a relay that refused the connection before the request began is not recorded by the preflight, so the request waits for a transition that has already happened',
      edits: [{ file: MACHINE, from: GIVE_UP, to: '' }]
    },
    {
      id: 'C9-a-relay-in-error-given-up',
      arm: 'GN1',
      describe:
        'the preflight gives up on a relay in `error` as it does on one that refused, so relays that would answer once re-opened end the leg instead — the other edge of "refused"',
      edits: [
        {
          file: REFUSAL,
          from: "    case 'error':\n      return 'reconnect-then-ask';\n    case 'rejected':\n      return 'give-up';",
          to: "    case 'error':\n    case 'rejected':\n      return 'give-up';"
        }
      ]
    },
    {
      id: 'C9-the-preflight-writes-the-phase-directly',
      arm: 'GN1',
      describe:
        "the preflight sets a refused relay's live phase itself instead of going through `advance`, so the all-terminal check never runs",
      edits: [
        {
          file: MACHINE,
          from: "    if (live) advance(url, 'terminal');",
          to: "    if (live) targets.set(url, 'terminal');"
        }
      ]
    },
    {
      id: 'C11-a-refused-relay-left-pending',
      arm: 'GN2',
      describe:
        'a relay that refused the connection before the request began is not recorded by the preflight, so the backlog waits on it',
      edits: [{ file: MACHINE, from: GIVE_UP, to: '' }]
    },
    {
      id: 'C11-the-preflight-backlog-half-live-only',
      arm: 'GN2',
      describe:
        "the preflight records a refused relay's backlog only for a live request, so a request that is not live waits on it",
      edits: [
        {
          file: MACHINE,
          from: PREFLIGHT_BACKWARD,
          to: "  for (const url of preflightTerminal) {\n    if (live) advanceBackward(url, 'ended');"
        }
      ]
    },
    {
      id: 'C11-the-refused-relay-recorded-late',
      arm: 'GN2',
      describe:
        "the preflight records a refused relay's backlog five seconds late — the answer is right, and it is not the relay's state that produced it in time",
      edits: [
        {
          file: MACHINE,
          from: PREFLIGHT_BACKWARD,
          to: "  for (const url of preflightTerminal) {\n    setTimeout(() => advanceBackward(url, 'ended'), 5000);"
        }
      ]
    },
    {
      id: 'C14-the-outcome-dropped-behind-the-leg-end',
      arm: 'GN3',
      describe:
        'a backlog decided when the live leg has already ended is closed, reported and released without its outcome, so the attempt ends carrying the leg end alone',
      edits: [
        {
          file: MACHINE,
          from: "        push({ type: 'settled', viaTimer });",
          to: "        if (!(live && forwardEnded)) push({ type: 'settled', viaTimer });"
        }
      ]
    },
    {
      id: 'C14-a-terminal-state-leaves-the-backlog-undetermined',
      arm: 'GN3',
      describe:
        "a terminal connection state is not read into the backward table, so the relay's backlog is left undetermined",
      edits: [{ file: MACHINE, from: TERMINAL_STATE, to: '' }]
    },
    {
      id: 'C14-an-exhausted-relay-is-not-terminal',
      arm: 'GN3',
      describe:
        "`error` — the dependency's retries used up — is not classified at all, so a relay that has gone for good is never terminal",
      edits: [
        {
          file: REFUSAL,
          from: ERROR_TERMINAL,
          to: "    case 'rejected':"
        }
      ]
    },
    {
      id: 'C14-the-timer-shorter-than-the-retries',
      arm: 'GN3',
      describe:
        "the request's timer is armed at a third of what was asked — 20 s against thirty-odd seconds of retries — so on the exhausted run it is the timer that answers; the arrangement's premise",
      edits: [
        {
          file: MACHINE,
          from: '    timer = setTimeout(() => settle(true), timeoutMs);',
          to: '    timer = setTimeout(() => settle(true), timeoutMs / 3);'
        }
      ]
    },
    {
      id: 'C14-the-end-ahead-of-the-outcome',
      arm: 'GN3',
      describe:
        "the stream's end is pushed at once rather than after the backlog is reported, and the drain stops at the end rather than handing over what is queued behind it — the two defences of the one-packet case, removed together",
      edits: [
        {
          file: MACHINE,
          from: "    queueMicrotask(() => {\n      closeAll();\n      whenBacklogReported(() => {\n        drawBoundary('forward', () => {\n          if (ended) return;\n          ended = true;\n          push({ type: 'end' });\n        });\n      });\n    });",
          to: "    void whenBacklogReported;\n    closeAll();\n    ended = true;\n    push({ type: 'end' });"
        },
        {
          file: MACHINE,
          from: '          finished = true;\n          continue;',
          to: '          finished = true;\n          break;'
        }
      ]
    },
    {
      id: 'C10-the-events-dropped',
      arm: 'GN4',
      describe: 'an incomplete answer shows none of the events that arrived',
      edits: [
        {
          file: ENGINE,
          from: "        status: 'incomplete',\n        events,\n",
          to: "        status: 'incomplete',\n        events: NO_EVENTS,\n"
        }
      ]
    },
    {
      id: 'C10-a-gone-relay-reported-as-a-timeout',
      arm: 'GN4',
      describe: 'a relay that went terminal adds `timeout` to the outcome rather than `ended`',
      edits: [
        {
          file: MACHINE,
          from: GONE_CAUSE,
          to: "    if (gone.length > 0) present.add('timeout');\n"
        }
      ]
    },
    {
      id: 'C10-a-gone-relay-adds-no-cause',
      arm: 'GN4',
      describe:
        'a relay that went terminal adds no cause, so a backlog nobody answered reports itself complete',
      edits: [{ file: MACHINE, from: GONE_CAUSE, to: '' }]
    },
    {
      id: 'C10-a-held-event-discarded-at-the-end',
      arm: 'GN4',
      describe:
        'an event still being verified when the last relay goes is discarded as the stream ends, so what arrived is not all shown',
      edits: [
        {
          file: MACHINE,
          from: "      whenBacklogReported(() => {\n        drawBoundary('forward', () => {",
          to: "      whenBacklogReported(() => {\n        for (const each of gates.forward.holding) each.discarded = true;\n        drawBoundary('forward', () => {"
        }
      ]
    },
    {
      id: 'C10-an-exhausted-relay-is-not-terminal',
      arm: 'GN4',
      describe:
        "`error` — the ordinary death, once the dependency's retries are spent — is not classified, so the relays that died for good are never terminal",
      edits: [{ file: REFUSAL, from: ERROR_TERMINAL, to: "    case 'rejected':" }]
    },
    {
      id: 'C10-a-terminal-state-leaves-the-backlog-undetermined',
      arm: 'GN4',
      describe:
        "a terminal connection state is not read into the backward table, so the relays' backlogs are left undetermined",
      edits: [{ file: MACHINE, from: TERMINAL_STATE, to: '' }]
    },
    {
      id: 'C15-a-retrying-relay-counted-as-gone',
      arm: 'GN5',
      describe:
        'a socket waiting to retry, or retrying, is classified terminal — a first connection still is not — so the backlog ends over a relay the dependency is still bringing back, which the reading taken while the second relay waits to retry sees',
      edits: [
        {
          file: REFUSAL,
          from: "    case 'connecting':\n    case 'waiting-for-retrying':\n    case 'retrying':\n      return 'recovering';",
          to: "    case 'connecting':\n      return 'recovering';\n    case 'waiting-for-retrying':\n    case 'retrying':\n      return 'terminal';"
        }
      ]
    },
    {
      id: 'C15-an-exhausted-relay-is-not-terminal',
      arm: 'GN5',
      describe:
        "`error` — the ordinary death, once the dependency's retries are spent — is not classified, so the relays that died for good are never terminal",
      edits: [{ file: REFUSAL, from: ERROR_TERMINAL, to: "    case 'rejected':" }]
    },
    {
      id: 'C15-a-gone-relay-reported-as-a-timeout',
      arm: 'GN5',
      describe: 'a relay that went terminal adds `timeout` to the outcome rather than `ended`',
      edits: [
        {
          file: MACHINE,
          from: GONE_CAUSE,
          to: "    if (gone.length > 0) present.add('timeout');\n"
        }
      ]
    },
    {
      id: 'C15-a-gone-relay-adds-no-cause',
      arm: 'GN5',
      describe:
        'a relay that went terminal adds no cause, so a backlog nobody answered reports itself complete',
      edits: [{ file: MACHINE, from: GONE_CAUSE, to: '' }]
    },
    {
      id: 'C22-the-fallback-reports-a-whole-answer',
      arm: 'GN6',
      describe: "the fallback accumulator folds every backlog's outcome as complete",
      edits: [
        {
          file: ACCUMULATE,
          from: '        reducer(prev ?? initialValue, chunk)\n',
          to: "        reducer(\n          prev ?? initialValue,\n          chunk.type === 'settled' ? { ...chunk, end: { kind: 'complete' } } : chunk\n        )\n"
        }
      ]
    },
    {
      id: 'C22-the-streamed-accumulator-reports-a-whole-answer',
      arm: 'GN6',
      describe: "the shipping accumulator folds every backlog's outcome as complete",
      edits: [
        {
          file: ACCUMULATE,
          from: '    initialValue,\n    reducer,\n    streamFn\n',
          to: "    initialValue,\n    reducer: (value, chunk) =>\n      reducer(value, chunk.type === 'settled' ? { ...chunk, end: { kind: 'complete' } } : chunk),\n    streamFn\n"
        }
      ]
    }
  ]
} satisfies Ledger;
