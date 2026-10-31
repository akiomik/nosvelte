/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of what a request reports when an attempt throws part
 * way through, and of what the library writes to the console (C5), and its
 * landings:
 * - `C5-C3` on `TH1`;
 * - `C5-C5` on `TH2`, with `TH4` for the one value a rejection is published as;
 * - `C5-C6` on `RA1`, with the supporting arms read after each;
 * - `C5-C7` on `TH3`;
 * - `C5-C8` on `CW1`.
 *
 * An id begins with the row it is read against, `C<n>-` for `C5-C<n>`, and one
 * beginning `I-` edits an arm's own instrument.
 */
import type { Ledger } from '../ledger.ts';

const ENGINE = 'src/lib/v1/engine.ts';
const EVENTSET = 'src/lib/v1/eventset.ts';
const OWN = 'src/lib/v1/own.ts';
const STREAMED = 'src/lib/v1/useStreamedReq.svelte.ts';
const REQERROR = 'src/lib/v1/reqerror.ts';
const WATCH = 'src/tests/contracts/engine/helpers/console.ts';
const REACH = 'src/tests/contracts/engine/reach.test.ts';
const WRITTEN = 'src/tests/contracts/engine/written.test.ts';

/** What counts as something to show. */
const HAS_ANSWER = '  const hasAnswer = events.length > 0 || answer !== undefined;';
/** The branch that makes a failure the state. */
const ERROR_BRANCH = '  if (failure !== undefined && !hasAnswer) {';
/** The state that branch reports, with the projection's deadline. */
const ERROR_STATE =
  "      state: { status: 'error', events: NO_EVENTS, error: failure },\n      nextExpiryAt";
/** The one line every outcome that is a failure leaves through. */
const OUTCOME_ERROR =
  "  if (error !== undefined) return Object.freeze({ kind: 'error', error } as const);";
/** What the waiter hands `outcomeOf`. */
const WAITER = '      const outcome = outcomeOf(data, ended ? undefined : data?.failure?.error);';
/** The record a thrown fold leaves on the value. */
const RECORD =
  "  return { ...set, failure: { attemptId, error: recordedFailure(capture(error, 'unspecified')) } };";
/** What the query function does with what it caught. */
const CAUGHT = "          const error = capture(thrown, 'unspecified');\n";
/** The test the memo of a rejection is kept behind. */
const REJECTION_KEY =
  '    if (rejection === undefined || rejection.source !== source || rejection.count !== count) {';
/** Where a rejection stops being an error of the moment. */
const NOT_REJECTED = "    if (query.status !== 'error') return undefined;\n";
/** The query, just built, which the `$derived` read. */
const QUERY_BUILT = '  const query = createQuery(queryOptions, ownedClient);\n';
/** The rejection as a `$derived`, as it was before a kept handle was read. */
const DERIVATION = `${QUERY_BUILT}  const queryRejection = $derived(\n    query.status === 'error' ? terminalFailure(capture(query.error, 'unspecified')) : undefined\n  );\n`;
/** The `live` a released handle answers with. */
const LIVE_READ = '      if (!released) lastLive = safely(() => getOpts().live) ?? false;\n';
/** What `activity` maps through that. */
const ACTIVITY = "      return deriveActivity(lastLive, query.fetchStatus === 'fetching');\n";
/** The cleanup that marks the release. */
const RELEASE = '  $effect.pre(() => () => {\n    released = true;\n';
/** The answer of a released handle. */
const RELEASED =
  "      if (released) return Object.freeze({ kind: 'not-started', reason: 'released' } as const);\n";
/** A leg's end, as the value records it. */
const LEG_END = '  return { ...set, forward: { ...forward, end: Object.freeze(end) } };';
/** The refusal of a request with no provider above it. */
const NO_PROVIDER = '        ? ownedByLibrary(new MissingProviderError())\n';
/** The incomplete branch of the state. */
const INCOMPLETE = "  if (answer.completion.kind === 'incomplete') {\n";
/** The failure of a refresh under a provider that is going. */
const DISPOSED = '  return ownedByLibrary(new ProviderDisposedError(message));';
/** The watch's own recording. */
const RECORDING = "      written.push(`${String(method)}: ${args.map(textOf).join(' ')}`);\n";
/** The function every state's failure leaves through, at the top level of its module. */
const TERMINAL = 'export function terminalFailure(value: ReqError): ReqStateError {\n';
/** A seam that could not be read. */
const SEAM_REFUSED = '    return { read: false };\n';
/** The watch of `reach.test.ts`, as it is put on. */
const HOISTED = '  return watchConsole();\n';

export default {
  name: 'c5-failure',
  subject:
    '`C5-C3`, `C5-C5`, `C5-C6`, `C5-C7` and `C5-C8` (what a request reports when an attempt throws, and what the library writes to the console): their landings, `TH1`, `TH2`, `RA2`, `TH3` and `CW1`, and `TH4` beside them.',
  files: [
    'src/tests/contracts/engine/thrown.test.ts',
    'src/tests/contracts/engine/reach.test.ts',
    'src/tests/contracts/engine/written.test.ts'
  ],
  calibration: {
    measured: "one run of each arm's duration in a single Vitest run, plus 1.5 s for the process.",
    seconds: { TH1: 1.8, TH2: 2.1, TH3: 1.9, TH4: 1.9, RA1: 9.3, RX6: 1.6, CW1: 6.2 }
  },
  entries: [
    {
      id: 'C3-the-stored-set-counts-as-an-answer',
      arm: 'TH1',
      describe:
        'an expired event still counts: the state stays `streaming` over nothing, with nothing running and a failure recorded',
      edits: [
        {
          file: ENGINE,
          from: HAS_ANSWER,
          to: '  const hasAnswer = (observed.data?.entries.size ?? 0) > 0 || answer !== undefined;'
        }
      ]
    },
    {
      id: 'C3-a-recorded-failure-is-never-the-state',
      arm: 'TH1',
      requires: ['TH2'],
      describe: 'a failure over a value stays on the diagnostics, however little there is to show',
      edits: [{ file: ENGINE, from: ERROR_BRANCH, to: '  if (false as boolean) {' }]
    },
    {
      id: 'C3-a-failure-always-takes-the-state',
      arm: 'TH1',
      requires: ['TH2'],
      describe:
        'a control, not this Then: the failure takes the state while events are on screen, which `TH1` reads before the deadline and `TH2` on the next event',
      edits: [{ file: ENGINE, from: ERROR_BRANCH, to: '  if (failure !== undefined) {' }]
    },
    {
      id: 'C3-the-state-carries-a-copy',
      arm: 'TH1',
      describe: 'the error state and the diagnostics carry two objects',
      edits: [
        {
          file: ENGINE,
          from: ERROR_STATE,
          to: "      state: { status: 'error', events: NO_EVENTS, error: { ...failure } as typeof failure },\n      nextExpiryAt"
        }
      ]
    },
    {
      id: 'C3-the-state-ignores-the-clock',
      arm: 'TH1',
      describe: 'the deadline moves nothing the state reads, so the event never leaves',
      edits: [
        {
          file: STREAMED,
          from: '      const now = clock?.now;\n',
          to: '      const now = undefined;\n'
        }
      ]
    },
    {
      id: 'C5-a-failed-attempt-resolves-complete',
      arm: 'TH2',
      describe: 'the legacy bug: `complete` for an attempt that threw, however far it got',
      edits: [
        {
          file: ENGINE,
          from: OUTCOME_ERROR,
          to: "  if (error !== undefined) return Object.freeze({ kind: 'complete' } as const);"
        }
      ]
    },
    {
      id: 'C5-a-partial-attempt-resolves-complete',
      arm: 'TH2',
      describe:
        'the race: `complete` when the throw came after an event, `error` when it came first',
      edits: [
        {
          file: ENGINE,
          from: OUTCOME_ERROR,
          to: "  if (error !== undefined)\n    return Object.freeze(\n      (data?.entries.size ?? 0) > 0\n        ? ({ kind: 'complete' } as const)\n        : ({ kind: 'error', error } as const)\n    );"
        }
      ]
    },
    {
      id: 'C5-a-partial-attempt-resolves-incomplete',
      arm: 'TH2',
      describe: 'the other success: `incomplete` when the throw came after an event',
      edits: [
        {
          file: ENGINE,
          from: OUTCOME_ERROR,
          to: "  if (error !== undefined)\n    return Object.freeze(\n      (data?.entries.size ?? 0) > 0\n        ? ({ kind: 'incomplete', causes: ['timeout'] } as unknown as RefreshOutcome)\n        : ({ kind: 'error', error } as const)\n    );"
        }
      ]
    },
    {
      id: 'C5-the-waiter-never-reads-the-failure',
      arm: 'TH2',
      describe: 'a thrown attempt leaves the waiter nothing to answer with',
      edits: [
        { file: STREAMED, from: WAITER, to: '      const outcome = outcomeOf(data, undefined);' }
      ]
    },
    {
      id: 'C5-the-outcome-carries-a-copy',
      arm: 'TH2',
      describe: 'the outcome is an Error of its own, not the one the diagnostics carry',
      edits: [
        {
          file: STREAMED,
          from: WAITER,
          to: '      const failure = ended ? undefined : data?.failure?.error;\n      const outcome = outcomeOf(data, failure && Object.freeze(Object.create(failure) as typeof failure));'
        }
      ]
    },
    {
      id: 'C5-a-foreign-error-is-kept',
      arm: 'TH2',
      describe: 'the record keeps what the accumulator threw rather than the library’s copy',
      edits: [
        {
          file: STREAMED,
          from: CAUGHT,
          to: '          const error = thrown as ReturnType<typeof capture>;\n'
        },
        {
          file: EVENTSET,
          from: RECORD,
          to: '  return { ...set, failure: { attemptId, error: error as never } };'
        }
      ]
    },
    {
      id: 'C5-the-failure-is-a-generic-one',
      arm: 'TH2',
      describe: 'an owned Error, and not a copy of what was thrown, once something has been kept',
      edits: [
        {
          file: STREAMED,
          from: CAUGHT,
          to: "          const prior = ownedClient().getQueryData<Collected>(key);\n          const error = capture(\n            (prior?.entries.size ?? 0) > 0 ? new Error('stream interrupted') : thrown,\n            'unspecified'\n          );\n"
        }
      ]
    },
    {
      id: 'C5-the-failure-empties-the-value',
      arm: 'TH2',
      describe: 'the event that folded goes with the failure, so `(2)` reads as `(1)`',
      edits: [
        {
          file: EVENTSET,
          from: RECORD,
          to: "  return {\n    ...set,\n    entries: new Map(),\n    failure: { attemptId, error: recordedFailure(capture(error, 'unspecified')) }\n  };"
        }
      ]
    },
    {
      id: 'C5-the-attempt-outlives-its-throw',
      arm: 'TH2',
      describe: 'the fold’s throw is recorded and the attempt runs on, so the activity stays on',
      edits: [
        {
          file: STREAMED,
          from: '          throw error;\n        } finally {',
          to: '          await new Promise((done) => setTimeout(done, 2_000));\n          throw error;\n        } finally {'
        }
      ]
    },
    {
      id: 'C7-the-record-logs-the-failure',
      arm: 'TH3',
      describe: 'the legacy bug: the stream error goes to `console.error`',
      edits: [{ file: EVENTSET, from: RECORD, to: `  console.error(error);\n${RECORD}` }]
    },
    {
      id: 'C7-a-retry-logs-the-failure',
      arm: 'TH3',
      describe: 'only a failure over a failure writes, so the first attempt reads clean',
      edits: [
        {
          file: EVENTSET,
          from: RECORD,
          to: `  if (set.failure !== undefined) console.warn('failed again');\n${RECORD}`
        }
      ]
    },
    {
      id: 'C7-a-debug-line-on-the-catch',
      arm: 'TH3',
      describe: 'a method nobody reads in a console, at the query function’s catch',
      edits: [
        {
          file: STREAMED,
          from: CAUGHT,
          to: `${CAUGHT}          console.debug('attempt failed', attemptId);\n`
        }
      ]
    },
    {
      id: 'C7-a-write-bound-at-load',
      arm: 'TH3',
      describe:
        'a method bound as the module loads, which is what a watch put on after the imports cannot see',
      edits: [
        {
          file: OWN,
          from: TERMINAL,
          to: `const report = console.error.bind(console);\n${TERMINAL}  report('failed');\n`
        }
      ]
    },
    {
      id: 'C7-a-write-at-load',
      arm: 'TH3',
      describe: 'the module writes as it loads, before any request was made',
      edits: [{ file: OWN, from: TERMINAL, to: `console.warn('loaded');\n${TERMINAL}` }]
    },
    {
      id: 'C7-a-write-as-the-request-is-built',
      arm: 'TH3',
      describe: 'a write before the attempt, which a control run after the build cleared',
      edits: [{ file: STREAMED, from: QUERY_BUILT, to: `${QUERY_BUILT}  console.warn('built');\n` }]
    },
    {
      id: 'C7-a-write-on-release',
      arm: 'TH3',
      describe: 'a write as the request goes, after the attempts have ended',
      edits: [{ file: STREAMED, from: RELEASE, to: `${RELEASE}    console.warn('released');\n` }]
    },
    {
      id: 'I-C7-the-watch-is-one-method',
      arm: 'TH3',
      describe: 'the watch spies on `error` alone, which a list compared with itself cannot see',
      edits: [
        {
          file: WATCH,
          from: '  const spies = methodsOfConsole().map((method) =>',
          to: "  const spies = (['error'] as const).map((method) =>"
        }
      ]
    },
    {
      id: 'I-C7-the-watch-records-nothing',
      arm: 'TH3',
      describe: 'the spies stop recording, so nothing is written whatever is written',
      edits: [{ file: WATCH, from: RECORDING, to: '' }]
    },
    {
      id: 'I-C7-the-text-of-a-write-throws',
      arm: 'TH3',
      describe: 'the spy throws at a value `String()` refuses, which the control writes',
      edits: [{ file: WATCH, from: 'args.map(textOf)', to: 'args.map(String)' }]
    },
    {
      id: 'I-C7-the-console-lists-nothing',
      arm: 'TH3',
      describe:
        'no method is listed, so the named six are all that is watched, and one of them is written through',
      edits: [
        {
          file: WATCH,
          from: '...(Object.keys(console) as (keyof Console)[]).filter(',
          to: '...([] as (keyof Console)[]).filter('
        },
        { file: EVENTSET, from: RECORD, to: `  console.error(error);\n${RECORD}` }
      ]
    },
    {
      id: 'C6-the-rejection-is-a-derivation-again',
      arm: 'RA1',
      describe:
        'the write this row was found by: a released handle reads a `$derived` of its root, on a path `RA1` drives',
      edits: [
        { file: STREAMED, from: QUERY_BUILT, to: DERIVATION },
        {
          file: STREAMED,
          from: NOT_REJECTED,
          to: '    if (true as boolean) return queryRejection;\n'
        }
      ]
    },
    {
      id: 'C6-a-disposed-provider-logs',
      arm: 'RA1',
      describe: 'a path no public row reaches writes: the failure of a provider that went',
      edits: [{ file: OWN, from: DISPOSED, to: `  console.error(message);\n${DISPOSED}` }]
    },
    {
      id: 'C6-a-recorded-failure-logs',
      arm: 'RA1',
      describe: 'the accumulator’s failures write, through the seam a consumer does not have',
      edits: [{ file: EVENTSET, from: RECORD, to: `  console.info(error);\n${RECORD}` }]
    },
    {
      id: 'C6-a-write-bound-at-load',
      arm: 'RA1',
      describe:
        'a method bound as the module loads, which is what a watch put on after the imports cannot see',
      edits: [
        {
          file: OWN,
          from: TERMINAL,
          to: `const report = console.error.bind(console);\n${TERMINAL}  report('failed');\n`
        }
      ]
    },
    {
      id: 'C6-an-unreadable-seam-logs',
      arm: 'RX6',
      describe: 'a path a supporting arm drives writes, and that arm is the one that fails',
      edits: [
        {
          file: STREAMED,
          from: SEAM_REFUSED,
          to: `    console.warn('unreadable');\n${SEAM_REFUSED}`
        }
      ]
    },
    {
      id: 'I-C6-the-watch-goes-early',
      arm: 'RA1',
      describe: 'the file-wide watch is gone before the first arm runs',
      edits: [
        {
          file: REACH,
          from: HOISTED,
          to: '  const made = watchConsole();\n  made.release();\n  return made;\n'
        }
      ]
    },
    {
      id: 'I-C6-a-path-stopped-running',
      arm: 'RA1',
      describe: 'a path the file used to drive does not run, and watched nothing',
      edits: [
        {
          file: REACH,
          from: "          check('RM26', observe(held.value, await settledCall(held.value.refresh())));\n",
          to: '          await settledCall(held.value.refresh());\n'
        }
      ]
    },
    {
      id: 'C8-the-rejection-is-a-derivation-again',
      arm: 'CW1',
      describe:
        'the defect: `state` and `diagnostics` read a `$derived` of a root that has gone, and Svelte writes to the console',
      edits: [
        { file: STREAMED, from: QUERY_BUILT, to: DERIVATION },
        {
          file: STREAMED,
          from: NOT_REJECTED,
          to: '    if (true as boolean) return queryRejection;\n'
        }
      ]
    },
    {
      id: 'C8-a-released-handle-asks-the-plan',
      arm: 'CW1',
      describe:
        'the defect’s other half: `activity` runs the plan of a consumer that has gone, and its `$derived` writes',
      edits: [
        {
          file: STREAMED,
          from: LIVE_READ,
          to: '      lastLive = safely(() => getOpts().live) ?? false;\n'
        }
      ]
    },
    {
      id: 'C8-the-release-waits-for-the-effects',
      arm: 'CW1',
      describe: 'a root gone before its effects ran is never marked released',
      edits: [
        {
          file: STREAMED,
          from: RELEASE,
          to: '  $effect(() => () => {\n    released = true;\n'
        }
      ]
    },
    {
      id: 'C8-a-released-handle-forgets-it-was-live',
      arm: 'CW1',
      describe: 'the kept `live` is lost, so a released live request answers `refreshing`',
      edits: [
        {
          file: STREAMED,
          from: '    lastLive = descriptor?.live ?? false;\n',
          to: '    lastLive = false;\n'
        }
      ]
    },
    {
      id: 'C8-the-kept-live-is-the-one-built',
      arm: 'CW1',
      describe:
        'a released handle says what the options were last built from, which is not what it read',
      edits: [
        {
          file: STREAMED,
          from: LIVE_READ,
          to: '      const asked = released ? lastLive : (safely(() => getOpts().live) ?? false);\n'
        },
        {
          file: STREAMED,
          from: ACTIVITY,
          to: "      return deriveActivity(asked, query.fetchStatus === 'fetching');\n"
        }
      ]
    },
    {
      id: 'C8-the-diagnostic-is-built-at-its-reader',
      arm: 'CW1',
      describe:
        'an incomplete answer’s `lastError` is a new Error at each read, which only identity can see',
      edits: [
        {
          file: ENGINE,
          from: "      (state.status === 'incomplete' ? state.error : undefined),\n",
          to: "      (state.status === 'incomplete'\n        ? ownedByLibrary(new IncompleteResultError(state.causes))\n        : undefined),\n"
        }
      ]
    },
    {
      id: 'C8-a-released-handle-answers-idle',
      arm: 'CW1',
      describe:
        'the correction `A12-C5` declines: a released handle stops saying what it last saw on the activity axis',
      edits: [
        {
          file: STREAMED,
          from: ACTIVITY,
          to: `      if (released) return 'idle';\n${ACTIVITY}`
        }
      ]
    },
    {
      id: 'C8-a-released-handle-drops-the-value',
      arm: 'CW1',
      describe: 'a read after the release answers from nothing rather than the entry it last saw',
      edits: [
        {
          file: STREAMED,
          from: '      const result = deriveState(\n        {\n          data: query.data,\n          error: rejectedWith()\n        },\n        now\n      );\n      if (result.nextExpiryAt',
          to: '      const result = deriveState(\n        {\n          data: released ? undefined : query.data,\n          error: rejectedWith()\n        },\n        now\n      );\n      if (result.nextExpiryAt'
        }
      ]
    },
    {
      id: 'C8-a-refusal-logs',
      arm: 'CW1',
      describe: 'a refused request writes as it is published',
      edits: [
        {
          file: STREAMED,
          from: "      rejection = { source, count, value: terminalFailure(capture(source, 'unspecified')) };\n",
          to: "      console.warn(source);\n      rejection = { source, count, value: terminalFailure(capture(source, 'unspecified')) };\n"
        }
      ]
    },
    {
      id: 'C8-a-missing-provider-logs',
      arm: 'CW1',
      describe: 'the path with no provider writes, alone among the refusals',
      edits: [
        {
          file: STREAMED,
          from: NO_PROVIDER,
          to: "        ? (console.warn('no provider'), ownedByLibrary(new MissingProviderError()))\n"
        }
      ]
    },
    {
      id: 'C8-a-partial-answer-logs',
      arm: 'CW1',
      describe: 'an answer that is partial writes, which no refusal does',
      edits: [{ file: ENGINE, from: INCOMPLETE, to: `${INCOMPLETE}    console.info('partial');\n` }]
    },
    {
      id: 'C8-a-leg-end-logs',
      arm: 'CW1',
      describe: 'a relay ending the live leg writes, on the one code that reaches nothing else',
      edits: [{ file: EVENTSET, from: LEG_END, to: `  console.warn('leg ended');\n${LEG_END}` }]
    },
    {
      id: 'C8-a-disposed-provider-logs',
      arm: 'CW1',
      describe: 'the code a consumer reaches by a root of its own writes as it is refused',
      edits: [{ file: OWN, from: DISPOSED, to: `  console.error(message);\n${DISPOSED}` }]
    },
    {
      id: 'C8-a-write-bound-at-load',
      arm: 'CW1',
      describe: 'a method bound as the module loads, on the public row',
      edits: [
        {
          file: OWN,
          from: TERMINAL,
          to: `const report = console.error.bind(console);\n${TERMINAL}  report('failed');\n`
        }
      ]
    },
    {
      id: 'C8-a-write-at-load',
      arm: 'CW1',
      describe: 'the module writes as it loads, on the public row',
      edits: [{ file: OWN, from: TERMINAL, to: `console.warn('loaded');\n${TERMINAL}` }]
    },
    {
      id: 'C8-a-released-call-logs',
      arm: 'CW1',
      describe: 'a call on a released handle is answered and written about',
      edits: [
        {
          file: STREAMED,
          from: RELEASED,
          to: `      if (released) console.debug('released');\n${RELEASED}`
        }
      ]
    },
    {
      id: 'C5-the-key-forgets-the-source',
      arm: 'TH4',
      describe: 'another object at the same count, which a reset leaves, reads as the last report',
      edits: [
        {
          file: STREAMED,
          from: REJECTION_KEY,
          to: '    if (rejection === undefined || rejection.count !== count) {'
        }
      ]
    },
    {
      id: 'C5-the-key-forgets-the-count',
      arm: 'TH4',
      describe: 'error, success, error with the same object comes back to one key, and goes stale',
      edits: [
        {
          file: STREAMED,
          from: REJECTION_KEY,
          to: '    if (rejection === undefined || rejection.source !== source) {'
        }
      ]
    },
    {
      id: 'C5-a-copy-per-read',
      arm: 'TH4',
      describe: 'the memo is off, so one report is a new object at every read',
      edits: [{ file: STREAMED, from: REJECTION_KEY, to: '    if (true as boolean) {' }]
    },
    {
      id: 'I-C8-a-code-out-of-place',
      arm: 'CW1',
      describe: 'a code is on the library’s list and on neither of this arm’s',
      edits: [
        {
          file: REQERROR,
          from: "  'transport-incompatible'\n] as const satisfies readonly ReqErrorCode[];",
          to: "  'transport-incompatible',\n  'a new code'\n] as unknown as readonly ReqErrorCode[];"
        }
      ]
    },
    {
      id: 'I-C8-a-path-dropped',
      arm: 'CW1',
      describe: 'the path with no provider is taken off the list, and the code goes unplaced',
      edits: [
        {
          file: WRITTEN,
          from: "  { name: 'no provider', bare: true, plan: request({}), ...refused('missing-provider') },\n",
          to: ''
        }
      ]
    }
  ]
} satisfies Ledger;
