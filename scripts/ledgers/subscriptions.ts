/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of a request's subscriptions as its plan and its
 * attempts change, and its landings:
 * - `B-η-C5` on `SB1`;
 * - `A5-C30` on `SB2`;
 * - `B2-C3` on `SB3`;
 * - `A6-C5` on `SB4`;
 * - `A6-C8` on `SB5`;
 * - `C6-C10` on `SB6`;
 * - `B10-C5` on `ES16`;
 * - `B-η-C7` on `ES21`, with `ES22`, `ES23`, `ES26` and `ES27`.
 *
 * An id begins with the arm its entry is held to, and each entry names its row
 * in `rows`. Every entry edits the library.
 */
import type { Edit, Ledger } from '../ledger.ts';

const ENGINE = 'src/lib/v1/useStreamedReq.svelte.ts';
const EVENT_SET = 'src/lib/v1/eventset.ts';
const MACHINE = 'src/lib/v1/machine.ts';
const STREAM = 'src/lib/v1/stream.ts';
const CONTEXT = 'src/lib/v1/context.svelte.ts';
const ATTEMPT = 'src/lib/v1/attempt.ts';

/** Every invocation of the hook leaves the signal it was handed unread. */
const SIGNAL_UNREAD: Edit = {
  file: ENGINE,
  from: '      consumeSignal = true,',
  to: '      consumeSignal = false,'
};
/** A leg's name, from the request's base and its attempt. */
const ATTEMPT_NAME = '      reqIdBase: `${reqIdBase}-${attemptId}`,';
/** The registry's origin token, drawn from the platform's randomness. */
const ORIGIN = 'const originToken = (): string => {\n';

export default {
  name: 'subscriptions',
  subject:
    'a request’s subscriptions as its plan and its attempts change: `B-η-C5`, `A5-C30`, `B2-C3`, `A6-C5`, `A6-C8`, `C6-C10`, `B10-C5` and `B-η-C7`, and their landings',
  files: [
    'src/tests/contracts/engine/subscriptions.test.ts',
    'src/tests/contracts/engine/identity.test.ts'
  ],
  calibration: {
    measured:
      'each arm alone and passing, process start included, one run at a time on a shared 10-core machine, on the tree that added this ledger',
    seconds: {
      SB1: 3.1,
      SB2: 2.9,
      SB3: 2.9,
      SB4: 1.8,
      SB5: 3.2,
      SB6: 1.9,
      ES16: 1.5,
      ES21: 1.5,
      ES22: 1.5,
      ES23: 1.5,
      ES26: 1.6,
      ES27: 1.4
    }
  },
  entries: [
    {
      id: 'SB1-the-start-withdraws-nothing',
      arm: 'SB1',
      rows: ['B-η-C5'],
      describe:
        'a new attempt withdraws nothing when it starts, only at its first chunk, as before the change this ledger was written with',
      edits: [
        {
          file: ENGINE,
          from: '          if (!invocation.signal.aborted) {\n            client.setQueryData<Collected>(key, (previous) =>\n              previous === undefined ? undefined : beginAttempt(previous, attemptId)\n            );\n          }\n',
          to: ''
        }
      ]
    },
    {
      id: 'SB1-the-forward-record-kept',
      arm: 'SB1',
      rows: ['B-η-C5'],
      describe: 'a new attempt keeps the last one’s forward refusals',
      edits: [
        {
          file: EVENT_SET,
          from: '    forward: { attemptId, end: undefined, refusals: [] }',
          to: '    forward: { attemptId, end: undefined, refusals: set.forward?.refusals ?? [] }'
        }
      ]
    },
    {
      id: 'SB1-the-running-backlog-kept',
      arm: 'SB1',
      rows: ['B-η-C5'],
      describe: 'a new attempt keeps the refusals of a backlog that never ended',
      edits: [
        {
          file: EVENT_SET,
          from: '    running: { attemptId, refusals: [] },',
          to: '    running: { attemptId, refusals: set.running?.refusals ?? [] },'
        }
      ]
    },
    {
      id: 'SB1-the-ended-backlog-withdrawn-at-the-start',
      arm: 'SB1',
      rows: ['B-η-C5'],
      describe:
        'a new attempt withdraws an ended backlog’s record at its start, before the answer it explains is replaced',
      edits: [
        {
          file: EVENT_SET,
          from: '    running: { attemptId, refusals: [] },',
          to: '    backlog: undefined,\n    running: { attemptId, refusals: [] },'
        }
      ]
    },
    {
      id: 'SB1-the-ended-backlog-kept-at-the-end',
      arm: 'SB1',
      rows: ['B-η-C5'],
      describe: 'a new attempt’s end keeps the last backlog’s refusals beside its own',
      edits: [
        {
          file: EVENT_SET,
          from: '      refusals: running.refusals,\n      late: [],',
          to: '      refusals: [...(set.backlog?.refusals ?? []), ...running.refusals],\n      late: [],'
        }
      ]
    },
    {
      id: 'SB1-a-late-refusal-dropped',
      arm: 'SB1',
      rows: ['B-η-C5'],
      describe: 'a refusal arriving after its own attempt’s backlog ended is dropped',
      edits: [
        {
          file: EVENT_SET,
          from: '    return { ...set, backlog: { ...backlog, late: [...backlog.late, refusal] } };',
          to: '    return set;'
        }
      ]
    },
    {
      id: 'SB1-a-late-refusal-a-cause',
      arm: 'SB1',
      rows: ['B-η-C5'],
      describe:
        'a refusal arriving after its own attempt’s backlog ended makes a new answer, which it marks `refused`',
      edits: [
        {
          file: EVENT_SET,
          from: '    return { ...set, backlog: { ...backlog, late: [...backlog.late, refusal] } };',
          to: "    return {\n      ...set,\n      backlog: {\n        ...backlog,\n        late: [...backlog.late, refusal],\n        answer: Object.freeze({ minted: 'answer', of: attemptId, late: backlog.late.length + 1 })\n      }\n    };"
        },
        {
          file: EVENT_SET,
          from: "  if (backlog.ephemeralOmitted) present.add('ephemeral-event-omitted');",
          to: "  if (backlog.late.length > 0) present.add('refused');\n  if (backlog.ephemeralOmitted) present.add('ephemeral-event-omitted');"
        }
      ]
    },
    {
      id: 'SB2-the-first-forward-left-open',
      arm: 'SB2',
      rows: ['A5-C30'],
      describe:
        'a moved plan leaves its first subscriptions open on the wire while the consumer stays, the signal that would close them never read (#61)',
      edits: [SIGNAL_UNREAD]
    },
    {
      id: 'SB2-the-first-forward-written-to-the-second',
      arm: 'SB2',
      rows: ['A5-C30'],
      describe:
        'a moved plan leaves its first subscriptions open, and what they deliver is written to the entry the hook is on now',
      edits: [
        SIGNAL_UNREAD,
        {
          file: ENGINE,
          from: "import { streamedQueryAccumulator } from './accumulate.js';\n",
          to: "import { streamedQueryAccumulator } from './accumulate.js';\nlet latestKey: unknown;\n"
        },
        {
          file: ENGINE,
          from: '          const data = (await inner(context as never)) as Collected | undefined;',
          to: '          latestKey = key;\n          const data = (await inner(\n            Object.create(context as object, { queryKey: { get: () => latestKey } }) as never\n          )) as Collected | undefined;'
        }
      ]
    },
    {
      id: 'SB3-the-first-answer-shown-after-the-move',
      arm: 'SB3',
      rows: ['B2-C3'],
      describe: 'a moved plan shows the first descriptor’s answer until the second has one',
      edits: [
        {
          file: ENGINE,
          from: '      queryFn: rejectsWithOurs(async (context: unknown) => {',
          to: '      placeholderData: (previous: unknown) => previous as never,\n      queryFn: rejectsWithOurs(async (context: unknown) => {'
        }
      ]
    },
    {
      id: 'SB3-the-second-answer-built-on-the-first',
      arm: 'SB3',
      rows: ['B2-C3'],
      describe: 'a moved plan’s first attempt starts from the answer another entry holds',
      edits: [
        {
          file: ENGINE,
          from: '            initialValue: initialCollected,',
          to: '            initialValue:\n              (client\n                .getQueryCache()\n                .getAll()\n                .map((entry) => entry.state.data)\n                .find((data) => data !== undefined) as Collected | undefined) ?? initialCollected,'
        }
      ]
    },
    {
      id: 'SB4-the-forward-asked-twice',
      arm: 'SB4',
      rows: ['A6-C5'],
      describe: 'each attempt of a live request puts its forward `REQ` on the wire twice',
      edits: [
        {
          file: MACHINE,
          from: '    forwardReq.emit(\n      forwardLimitZero ? filters.map((filter) => ({ ...filter, limit: 0 })) : filters\n    );\n  }',
          to: '    forwardReq.emit(\n      forwardLimitZero ? filters.map((filter) => ({ ...filter, limit: 0 })) : filters\n    );\n    forwardReq.emit(\n      forwardLimitZero ? filters.map((filter) => ({ ...filter, limit: 0 })) : filters\n    );\n  }'
        }
      ]
    },
    {
      id: 'SB4-an-attempt-named-as-the-last',
      arm: 'SB4',
      rows: ['A6-C5'],
      describe: 'a refresh names its legs as the attempt before it did',
      edits: [{ file: STREAM, from: ATTEMPT_NAME, to: '      reqIdBase,' }]
    },
    {
      id: 'SB5-names-drawn-from-six-digits',
      arm: 'SB5',
      rows: ['A6-C8'],
      describe:
        'a request’s subscriptions are named by six digits drawn from `Math.random`, as the legacy hook’s were (#95)',
      edits: [
        {
          file: STREAM,
          from: ATTEMPT_NAME,
          to: "      reqIdBase: `r${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`,"
        }
      ]
    },
    {
      id: 'SB6-a-socket-per-request',
      arm: 'SB6',
      rows: ['C6-C10'],
      describe: 'each request under a provider is served by a connection pool of its own',
      edits: [
        {
          file: CONTEXT,
          from: '    get transport() {\n      return context.transportLease;\n    },',
          to: '    get transport() {\n      return context.transportLease === undefined\n        ? undefined\n        : ownTransport(createLiveTransport(undefined)).capability;\n    },'
        }
      ]
    },
    {
      id: 'ES16-a-forward-refusal-unattributed',
      arm: 'ES16',
      rows: ['B10-C5'],
      describe: 'a forward refusal is filed on the forward record whichever attempt it belongs to',
      edits: [
        {
          file: EVENT_SET,
          from: "  if (refusal.leg === 'forward') {\n    const forward = set.forward;\n    if (forward?.attemptId !== attemptId) return set;",
          to: "  if (refusal.leg === 'forward') {\n    const forward = set.forward;\n    if (forward === undefined) return set;"
        }
      ]
    },
    {
      id: 'ES16-a-forward-end-unattributed',
      arm: 'ES16',
      rows: ['B10-C5'],
      describe: 'a forward end is applied to the forward record whichever attempt it belongs to',
      edits: [
        {
          file: EVENT_SET,
          from: '  const forward = set.forward;\n  if (forward?.attemptId !== attemptId) return set;\n  if (forward.end !== undefined) return set;',
          to: '  const forward = set.forward;\n  if (forward === undefined) return set;\n  if (forward.end !== undefined) return set;'
        }
      ]
    },
    {
      id: 'ES21-an-older-attempt-begun-again',
      arm: 'ES21',
      rows: ['B-η-C7'],
      describe: 'an older attempt’s first chunk, replayed, begins it again over the newer one',
      edits: [
        {
          file: EVENT_SET,
          from: '  const current = set.running?.attemptId ?? set.backlog?.attemptId;\n  if (current !== undefined && isOlderAttempt(attemptId, current)) return set;\n',
          to: '  const current = set.running?.attemptId ?? set.backlog?.attemptId;\n'
        }
      ]
    },
    {
      id: 'ES21-the-current-attempt-begun-again',
      arm: 'ES21',
      rows: ['B-η-C7'],
      describe: 'the attempt already current, begun again, withdraws its own records',
      edits: [{ file: EVENT_SET, from: '  if (current === attemptId) return set;\n', to: '' }]
    },
    {
      id: 'ES21-another-registry-read-as-older',
      arm: 'ES21',
      rows: ['B-η-C7'],
      describe: 'an attempt of a second registry is ordered by its number against this one’s',
      edits: [{ file: ATTEMPT, from: '  if (one[1] !== two[1]) return false;\n', to: '' }]
    },
    {
      id: 'ES21-an-unminted-id-read-as-older',
      arm: 'ES21',
      rows: ['B-η-C7'],
      describe: 'an id no registry minted is read as older than every attempt',
      edits: [
        {
          file: ATTEMPT,
          from: '  if (one === null || two === null) return false;',
          to: '  if (one === null || two === null) return true;'
        }
      ]
    },
    {
      id: 'ES22-an-origin-counted-per-module',
      arm: 'ES22',
      rows: ['B-η-C7'],
      describe:
        'a registry’s origin is counted from the module’s start, so a second module instance mints the first one’s ids',
      edits: [
        {
          file: ATTEMPT,
          from: ORIGIN,
          to: 'let originsMinted = 0;\nconst originToken = (): string => {\n  originsMinted += 1;\n  return base36(originsMinted.toString(16));\n'
        }
      ]
    },
    {
      id: 'ES23-an-origin-of-32-bits',
      arm: 'ES23',
      rows: ['B-η-C7'],
      describe: 'a registry’s origin is drawn from four bytes rather than twelve',
      edits: [
        {
          file: ATTEMPT,
          from: 'random(new Uint8Array(12))',
          to: 'random(new Uint8Array(4))'
        }
      ]
    },
    {
      id: 'ES26-the-clock-for-randomness',
      arm: 'ES26',
      rows: ['B-η-C7'],
      describe: 'a runtime with no cryptographic randomness is served an origin read off the clock',
      edits: [
        {
          file: ATTEMPT,
          from: '  throw ownedByLibrary(new MissingRandomnessError());\n};',
          to: '  return base36(Date.now().toString(16));\n};'
        }
      ]
    },
    {
      id: 'ES27-the-uuid-version-nibble-taken',
      arm: 'ES27',
      rows: ['B-η-C7'],
      describe: 'the UUID branch takes the first 24 nibbles, its fixed version nibble among them',
      edits: [
        {
          file: ATTEMPT,
          from: 'return base36(`${hex.slice(0, 12)}${hex.slice(13, 16)}${hex.slice(17)}`.slice(0, 24));',
          to: 'return base36(hex.slice(0, 24));'
        }
      ]
    }
  ]
} satisfies Ledger;
