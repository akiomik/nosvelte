/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of what an invocation hands an accumulator, and of what
 * the library's accumulators write once the request is gone, and their
 * landings:
 * - `A11-C10` on `LS1`, with `LS2` to `LS11`: nothing an invocation handed out
 *   outlives it;
 * - `A11-C19` on `LW1`, with `LW2`: from the collection of a request's entry
 *   on, nothing it was delivered adds an entry for its key.
 *
 * An id begins with the arm its entry is held to, and each entry names its row
 * in `rows`. Every entry edits the library, and two of `A11-C10`'s take away
 * a premise its landing reads by rather than its promise: that the doors
 * delegate at all, and that the backlog's marker is queued behind the iterator.
 */
import type { Edit, Ledger } from '../ledger.ts';

const CAPABILITY = 'src/lib/v1/capability.ts';
const ENGINE = 'src/lib/v1/useStreamedReq.svelte.ts';
const STREAM = 'src/lib/v1/stream.ts';
const MACHINE = 'src/lib/v1/machine.ts';
const ACCUMULATE = 'src/lib/v1/accumulate.ts';

/** The read the three doors share: the iterator, while the capability is opened. */
const SHARED_READ =
  "const live = (): AsyncIterator<Chunk> | undefined =>\n    state.name === 'opened' ? state.iterator : undefined;";
/** A rejection at a door, raised again as a new error of the capability's making. */
const RAISED_AFRESH = '((reason: unknown) => {\n        throw new Error(String(reason));\n      })';
/** A late call to the kept `streamFn`, answered with the first object. */
const LATE_CALL = "      if (state.name !== 'unopened') return facade;";

/** Adapter A, as it ships. */
const ADAPTER_A =
  "export const streamedQueryAccumulator: StreamAccumulator = ({ initialValue, reducer, streamFn }) =>\n  experimental_streamedQuery<Chunk, CachedEventSet, QueryKey>({\n    refetchMode: 'append',\n    initialValue,\n    reducer,\n    streamFn\n  });";
/**
 * Adapter A over a client whose writes the `defer` expression decides, given
 * the write and whether the chunk it is for is the first event: deferred
 * writes are made 20 ms later, on the host's timer, or by `later` when given.
 */
const adapterADeferring = (defer: string, later = 'setTimeout(write, 20)'): string =>
  `export const streamedQueryAccumulator: StreamAccumulator = ({ initialValue, reducer, streamFn }) => {
  let last: string | undefined;
  const helper = experimental_streamedQuery<Chunk, CachedEventSet, QueryKey>({
    refetchMode: 'append',
    initialValue,
    reducer,
    streamFn: async function* (context) {
      for await (const chunk of streamFn(context)) {
        last = chunk.type;
        yield chunk;
      }
    }
  });
  return (context) => {
    let events = 0;
    const client = new Proxy(context.client, {
      get: (target, name) => {
        if (name === 'setQueryData')
          return (...args: Parameters<typeof target.setQueryData>) => {
            const write = () => target.setQueryData(...args);
            if (${defer}) ${later};
            else write();
          };
        const value: unknown = Reflect.get(target, name, target);
        return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      }
    });
    return helper(
      Object.defineProperties({} as typeof context, {
        client: { value: client },
        queryKey: { get: () => context.queryKey },
        meta: { get: () => context.meta },
        signal: { get: () => context.signal }
      })
    );
  };
};`;
/** Adapter B's write of one chunk. */
const ADAPTER_B_WRITE =
  '      context.client.setQueryData<CachedEventSet>(context.queryKey, (prev) =>\n        reducer(prev ?? initialValue, chunk)\n      );';
/**
 * An accumulator's listener that puts back what the entry held when the cache
 * lets it go, inside the removal's own notification, and then stops listening.
 */
const PUT_BACK = `    const putBack = context.client.getQueryCache().subscribe((event) => {
      if (event.type !== 'removed') return;
      if (JSON.stringify(event.query.queryKey) !== JSON.stringify(context.queryKey)) return;
      putBack();
      const kept = event.query.state.data as CachedEventSet | undefined;
      if (kept !== undefined) context.client.setQueryData<CachedEventSet>(context.queryKey, kept);
    });`;
/**
 * An accumulator's listener that puts the removed entry itself back for a
 * turn, inside the removal's own notification, and then stops listening: the
 * cache is empty again by the end.
 */
const REVIVED = `    const cache = context.client.getQueryCache();
    const revive = cache.subscribe((event) => {
      if (event.type !== 'removed') return;
      if (JSON.stringify(event.query.queryKey) !== JSON.stringify(context.queryKey)) return;
      revive();
      cache.add(event.query);
      setTimeout(() => cache.remove(event.query), 0);
    });`;
/** Adapter A with `listener` put on the client's cache as each invocation begins. */
const adapterAListening = (listener: string): string =>
  `export const streamedQueryAccumulator: StreamAccumulator = ({ initialValue, reducer, streamFn }) => {
  const helper = experimental_streamedQuery<Chunk, CachedEventSet, QueryKey>({
    refetchMode: 'append',
    initialValue,
    reducer,
    streamFn
  });
  return (context) => {
${listener}
    return helper(context);
  };
};`;
/** The set named `set`, its events copies with their content emptied: as many, and not as delivered. */
const altered = (set: string): string =>
  `{\n        ...${set},\n        entries: new Map(\n          [...${set}.entries].map(([id, packet]) => [id, { ...packet, event: { ...packet.event, content: '' } }])\n        )\n      }`;
/** The engine forwarding query-core's cancellation into the invocation. */
const UNLINKED: Edit = {
  file: ENGINE,
  from: '          ? linkCancellation((context as { signal: AbortSignal }).signal, attemptId, invocation)\n          : undefined;',
  to: '          ? (void (context as { signal: AbortSignal }).signal, undefined)\n          : undefined;'
};

export default {
  name: 'accumulation',
  subject:
    'what an invocation hands an accumulator, and what the library’s accumulators write once the request is gone: `A11-C10` and `A11-C19`, and their landings',
  files: [
    'src/tests/contracts/engine/accumulation.test.ts',
    'src/tests/contracts/engine/latewrite.test.ts'
  ],
  calibration: {
    measured:
      'each arm alone and passing, process start included, one run at a time on a shared 10-core machine, on the tree that added this ledger',
    seconds: {
      LS1: 1.9,
      LS2: 2.2,
      LS3: 2.0,
      LS4: 2.0,
      LS5: 1.6,
      LS6: 1.6,
      LS7: 1.6,
      LS8: 1.5,
      LS9: 1.5,
      LS10: 1.5,
      LS11: 1.8,
      LW1: 2.1,
      LW2: 2.1
    }
  },
  entries: [
    {
      id: 'LS1-the-invocation-not-aborted',
      arm: 'LS1',
      rows: ['A11-C10'],
      describe:
        'the invocation’s end withdraws the capability and does not abort the invocation, so what its producer opened stays open',
      edits: [
        {
          file: ENGINE,
          from: '          unlinkCancellation?.();\n          invocation.abort(',
          to: '          unlinkCancellation?.();\n          void ('
        }
      ]
    },
    {
      id: 'LS3-the-capability-not-withdrawn',
      arm: 'LS3',
      rows: ['A11-C10'],
      describe:
        'the invocation’s end aborts the invocation and leaves the capability live, so a late pull is answered from the queue',
      edits: [
        {
          file: ENGINE,
          from: '          capability.revoke();\n          unlinkCancellation?.();',
          to: '          unlinkCancellation?.();'
        }
      ]
    },
    {
      id: 'LS8-the-next-door-reaches-the-producer',
      arm: 'LS8',
      requires: ['LS3'],
      rows: ['A11-C10'],
      describe:
        'a `next()` after the withdrawal is delegated to the producer, its answer still turned into `done` on the way back',
      edits: [
        {
          file: CAPABILITY,
          from: 'three doors now share one read of one state.\n      const iterator = live();',
          to: "three doors now share one read of one state.\n      const iterator = state.name === 'revoked' ? state.iterator : live();"
        }
      ]
    },
    {
      id: 'LS9-the-return-door-reaches-the-producer',
      arm: 'LS9',
      rows: ['A11-C10'],
      describe: 'a `return()` after the withdrawal is delegated to the producer',
      edits: [
        {
          file: CAPABILITY,
          from: '    async return() {\n      const iterator = live();',
          to: "    async return() {\n      const iterator = state.name === 'revoked' ? state.iterator : live();"
        }
      ]
    },
    {
      id: 'LS10-the-throw-door-reaches-the-producer',
      arm: 'LS10',
      rows: ['A11-C10'],
      describe: 'a `throw()` after the withdrawal is delegated to the producer',
      edits: [
        {
          file: CAPABILITY,
          from: '    async throw(reason?: unknown) {\n      const iterator = live();',
          to: "    async throw(reason?: unknown) {\n      const iterator = state.name === 'revoked' ? state.iterator : live();"
        }
      ]
    },
    {
      id: 'LS8-the-shared-read-lets-the-withdrawn-through',
      arm: 'LS8',
      requires: ['LS3', 'LS9', 'LS10'],
      rows: ['A11-C10'],
      describe: 'the read the three doors share hands out the iterator once it is withdrawn',
      edits: [
        {
          file: CAPABILITY,
          from: SHARED_READ,
          to: "const live = (): AsyncIterator<Chunk> | undefined =>\n    state.name === 'opened' || state.name === 'revoked' ? state.iterator : undefined;"
        }
      ]
    },
    {
      id: 'LS5-no-check-on-the-way-back-at-next',
      arm: 'LS5',
      rows: ['A11-C10'],
      describe: 'a `next()` in flight when the withdrawal lands delivers its chunk',
      edits: [
        {
          file: CAPABILITY,
          from: "      // facade existed.\n      return state.name === 'revoked' ? done() : result;",
          to: '      // facade existed.\n      return result;'
        }
      ]
    },
    {
      id: 'LS5-no-check-on-the-way-back-at-return',
      arm: 'LS5',
      rows: ['A11-C10'],
      describe: 'a `return()` in flight when the withdrawal lands delivers its chunk',
      edits: [
        {
          file: CAPABILITY,
          from: "      const result = (await iterator.return?.()) ?? done();\n      return state.name === 'revoked' ? done() : result;",
          to: '      const result = (await iterator.return?.()) ?? done();\n      return result;'
        }
      ]
    },
    {
      id: 'LS5-no-check-on-the-way-back-at-throw',
      arm: 'LS5',
      rows: ['A11-C10'],
      describe: 'a `throw()` in flight when the withdrawal lands delivers its chunk',
      edits: [
        {
          file: CAPABILITY,
          from: "      const result = await iterator.throw(reason);\n      return state.name === 'revoked' ? done() : result;",
          to: '      const result = await iterator.throw(reason);\n      return result;'
        }
      ]
    },
    {
      id: 'LS2-a-fresh-facade-per-late-call',
      arm: 'LS2',
      requires: ['LS8', 'LS9', 'LS10'],
      rows: ['A11-C10'],
      describe:
        'a late call to the kept `streamFn` hands back a fresh do-nothing object rather than the first',
      edits: [
        {
          file: CAPABILITY,
          from: LATE_CALL,
          to:
            "      if (state.name === 'revoked') return Object.freeze({ ...facade });\n" + LATE_CALL
        }
      ]
    },
    {
      id: 'LS2-a-late-call-reopens',
      arm: 'LS2',
      requires: ['LS8', 'LS9', 'LS10'],
      rows: ['A11-C10'],
      describe: 'a late call to the kept `streamFn` opens a second producer',
      edits: [
        {
          file: CAPABILITY,
          from: LATE_CALL,
          to: "      if (state.name !== 'unopened' && state.name !== 'revoked') return facade;"
        }
      ]
    },
    {
      id: 'LS2-a-late-acquisition-reaches-the-producer',
      arm: 'LS2',
      requires: ['LS8', 'LS9', 'LS10'],
      rows: ['A11-C10'],
      describe: 'an iterator taken after the withdrawal is the producer rather than the facade',
      edits: [
        {
          file: CAPABILITY,
          from: "      // reviewer's counterexample opens a subscription through, reaches nothing.\n      return facade;",
          to: "      // reviewer's counterexample opens a subscription through, reaches nothing.\n      return state.name === 'revoked' && state.iterator !== undefined ? state.iterator : facade;"
        }
      ]
    },
    {
      id: 'LS7-a-rejection-raised-afresh-at-next',
      arm: 'LS7',
      rows: ['A11-C10'],
      describe:
        'a rejection at `next()` reaches the caller as a new error rather than the producer’s',
      edits: [
        {
          file: CAPABILITY,
          from: '      const result = await iterator.next();',
          to: `      const result = await iterator.next().catch${RAISED_AFRESH};`
        }
      ]
    },
    {
      id: 'LS7-a-rejection-raised-afresh-at-return',
      arm: 'LS7',
      rows: ['A11-C10'],
      describe:
        'a rejection at `return()` reaches the caller as a new error rather than the producer’s',
      edits: [
        {
          file: CAPABILITY,
          from: '      const result = (await iterator.return?.()) ?? done();',
          to: `      const result =\n        (await iterator.return?.().catch${RAISED_AFRESH}) ?? done();`
        }
      ]
    },
    {
      id: 'LS7-a-rejection-raised-afresh-at-throw',
      arm: 'LS7',
      rows: ['A11-C10'],
      describe:
        'a rejection at `throw()` reaches the caller as a new error rather than the producer’s',
      edits: [
        {
          file: CAPABILITY,
          from: '      const result = await iterator.throw(reason);',
          to: `      const result = await iterator.throw(reason).catch${RAISED_AFRESH};`
        }
      ]
    },
    {
      id: 'LS7-a-rejection-swallowed-at-next',
      arm: 'LS7',
      rows: ['A11-C10'],
      describe: 'a rejection at `next()` is answered as the end of the stream',
      edits: [
        {
          file: CAPABILITY,
          from: '      const result = await iterator.next();',
          to: '      const result = await iterator.next().catch(() => done());'
        }
      ]
    },
    {
      id: 'LS11-the-latest-attempt-abandoned',
      arm: 'LS11',
      rows: ['A11-C10'],
      describe:
        'the stream an invocation opens is keyed by the request’s latest attempt rather than the one the invocation was handed',
      edits: [
        {
          file: ENGINE,
          from: '    const streamFn = (attemptId: AttemptId, invocation: AbortController) => {',
          to: '    let latestAttempt: AttemptId | undefined;\n    const streamFn = (attemptId: AttemptId, invocation: AbortController) => {'
        },
        {
          file: ENGINE,
          from: '        const capability = oneShotStream(() => streamFn(attemptId, invocation));',
          to: '        latestAttempt = attemptId;\n        const capability = oneShotStream(() => streamFn(latestAttempt as AttemptId, invocation));'
        }
      ]
    },
    {
      id: 'LS11-every-attempt-abandoned',
      arm: 'LS11',
      rows: ['A11-C10'],
      describe: 'the stream’s own `finally` abandons every attempt the registry holds',
      edits: [
        {
          file: STREAM,
          from: "    attempts.abandon(\n      attemptId,\n      'refresh() was waiting for an attempt that ended without an answer.",
          to: "    attempts.abandonAll(\n      'refresh() was waiting for an attempt that ended without an answer."
        }
      ]
    },
    {
      id: 'LS6-the-doors-never-delegate',
      arm: 'LS6',
      rows: ['A11-C10'],
      describe:
        'the premise: no door ever reaches the producer, so a refusal and an empty source read the same',
      edits: [
        {
          file: CAPABILITY,
          from: SHARED_READ,
          to: "const live = (): AsyncIterator<Chunk> | undefined =>\n    state.name === 'opened' && false ? state.iterator : undefined;"
        }
      ]
    },
    {
      id: 'LS4-no-marker-queued',
      arm: 'LS4',
      rows: ['A11-C10'],
      describe:
        'the premise: the backlog’s end queues no marker behind the iterator, so a late pull has nothing to refuse',
      edits: [
        {
          file: MACHINE,
          from: "        if (next.type === 'settled') yield { type: 'settled', end: backwardEnd(next.viaTimer) };\n        else if",
          to: "        if (next.type === 'settled') continue;\n        else if"
        }
      ]
    },
    {
      id: 'LS3-the-abort-empties-the-queue',
      arm: 'LS3',
      rows: ['A11-C10'],
      describe:
        'the abort empties the machine’s queue, so the machine is not left as it was and the withdrawal is not what refuses the marker',
      edits: [
        {
          file: MACHINE,
          from: '  const onAbort = () => {\n    ended = true;',
          to: '  const onAbort = () => {\n    queue.length = 0;\n    ended = true;'
        }
      ]
    },
    {
      id: 'LW1-every-write-deferred',
      arm: 'LW1',
      rows: ['A11-C19'],
      describe: 'adapter A puts every write off until after the work in hand',
      edits: [{ file: ACCUMULATE, from: ADAPTER_A, to: adapterADeferring('true') }]
    },
    {
      id: 'LW1-the-first-event-written-at-once',
      arm: 'LW1',
      rows: ['A11-C19'],
      describe: 'adapter A writes the first event at once and puts every later event’s write off',
      edits: [
        {
          file: ACCUMULATE,
          from: ADAPTER_A,
          to: adapterADeferring("last === 'event' && events++ > 0")
        }
      ]
    },
    {
      id: 'LW1-later-events-not-written',
      arm: 'LW1',
      rows: ['A11-C19'],
      describe: 'adapter A writes the first event and none after it',
      edits: [
        {
          file: ACCUMULATE,
          from: ADAPTER_A,
          to: adapterADeferring("last === 'event' && events++ > 0", 'void write')
        }
      ]
    },
    {
      id: 'LW1-the-stream-outlives-the-collection',
      arm: 'LW1',
      rows: ['A11-C19'],
      describe:
        'query-core’s cancellation is not forwarded into the invocation, and adapter A’s helper is handed a signal nothing aborts',
      edits: [
        UNLINKED,
        {
          file: ACCUMULATE,
          from: ADAPTER_A,
          to: "export const streamedQueryAccumulator: StreamAccumulator = ({ initialValue, reducer, streamFn }) => {\n  const helper = experimental_streamedQuery<Chunk, CachedEventSet, QueryKey>({\n    refetchMode: 'append',\n    initialValue,\n    reducer,\n    streamFn\n  });\n  return (context) =>\n    helper(\n      Object.defineProperties({} as typeof context, {\n        client: { get: () => context.client },\n        queryKey: { get: () => context.queryKey },\n        meta: { get: () => context.meta },\n        signal: { value: new AbortController().signal }\n      })\n    );\n};"
        }
      ]
    },
    {
      id: 'LW2-every-write-deferred',
      arm: 'LW2',
      rows: ['A11-C19'],
      describe: 'adapter B puts every write off until after the work in hand',
      edits: [
        {
          file: ACCUMULATE,
          from: ADAPTER_B_WRITE,
          to: `      setTimeout(() => {\n  ${ADAPTER_B_WRITE.split('\n').join('\n  ')}\n      }, 20);`
        }
      ]
    },
    {
      id: 'LW2-the-first-event-written-at-once',
      arm: 'LW2',
      rows: ['A11-C19'],
      describe: 'adapter B writes the first event at once and puts every later event’s write off',
      edits: [
        {
          file: ACCUMULATE,
          from: '    let cancelled = false;\n',
          to: '    let cancelled = false;\n    let events = 0;\n'
        },
        {
          file: ACCUMULATE,
          from: ADAPTER_B_WRITE,
          to: "      const write = () =>\n        context.client.setQueryData<CachedEventSet>(context.queryKey, (prev) =>\n          reducer(prev ?? initialValue, chunk)\n        );\n      if (chunk.type !== 'event' || events++ === 0) write();\n      else setTimeout(write, 20);"
        }
      ]
    },
    {
      id: 'LW2-later-events-not-written',
      arm: 'LW2',
      rows: ['A11-C19'],
      describe: 'adapter B writes the first event and none after it',
      edits: [
        {
          file: ACCUMULATE,
          from: '    let cancelled = false;\n',
          to: '    let cancelled = false;\n    let events = 0;\n'
        },
        {
          file: ACCUMULATE,
          from: ADAPTER_B_WRITE,
          to: `      if (chunk.type !== 'event' || events++ === 0)\n  ${ADAPTER_B_WRITE.split('\n').join('\n  ')}`
        }
      ]
    },
    {
      id: 'LW2-the-stream-outlives-the-collection',
      arm: 'LW2',
      rows: ['A11-C19'],
      describe:
        'query-core’s cancellation is not forwarded into the invocation, and adapter B reads past its own',
      edits: [UNLINKED, { file: ACCUMULATE, from: '      if (cancelled) break;\n', to: '' }]
    },
    {
      id: 'LW1-the-removal-written-back',
      arm: 'LW1',
      rows: ['A11-C19'],
      describe:
        'adapter A puts back what the entry held when the cache lets it go, inside the removal’s own notification',
      edits: [
        {
          file: ACCUMULATE,
          from: ADAPTER_A,
          to: adapterAListening(PUT_BACK)
        }
      ]
    },
    {
      id: 'LW2-the-removal-written-back',
      arm: 'LW2',
      rows: ['A11-C19'],
      describe:
        'adapter B puts back what the entry held when the cache lets it go, inside the removal’s own notification',
      edits: [
        {
          file: ACCUMULATE,
          from: '    const stream = await streamFn(streamContext);\n',
          to: `    const stream = await streamFn(streamContext);\n${PUT_BACK}\n`
        }
      ]
    },
    {
      id: 'LW1-the-removed-entry-put-back',
      arm: 'LW1',
      rows: ['A11-C19'],
      describe:
        'adapter A puts the removed entry itself back for a turn, inside the removal’s own notification',
      edits: [{ file: ACCUMULATE, from: ADAPTER_A, to: adapterAListening(REVIVED) }]
    },
    {
      id: 'LW2-the-removed-entry-put-back',
      arm: 'LW2',
      rows: ['A11-C19'],
      describe:
        'adapter B puts the removed entry itself back for a turn, inside the removal’s own notification',
      edits: [
        {
          file: ACCUMULATE,
          from: '    const stream = await streamFn(streamContext);\n',
          to: `    const stream = await streamFn(streamContext);\n${REVIVED}\n`
        }
      ]
    },
    {
      id: 'LW1-the-events-folded-altered',
      arm: 'LW1',
      rows: ['A11-C19'],
      describe:
        'adapter A folds copies of the events with their content emptied, as many as were delivered',
      edits: [
        {
          file: ACCUMULATE,
          from: ADAPTER_A,
          to: ADAPTER_A.replace(
            '    reducer,\n',
            `    reducer: (acc: CachedEventSet, chunk: Chunk) => {\n      const next = reducer(acc, chunk);\n      return ${altered('next')};\n    },\n`
          )
        }
      ]
    },
    {
      id: 'LW2-the-events-folded-altered',
      arm: 'LW2',
      rows: ['A11-C19'],
      describe:
        'adapter B writes copies of the events with their content emptied, as many as were delivered',
      edits: [
        {
          file: ACCUMULATE,
          from: ADAPTER_B_WRITE,
          to: `      context.client.setQueryData<CachedEventSet>(context.queryKey, (prev) => {\n        const next = reducer(prev ?? initialValue, chunk);\n        return ${altered('next')};\n      });`
        }
      ]
    }
  ]
} satisfies Ledger;
