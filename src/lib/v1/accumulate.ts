/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The seam A11 names, lowered to where the dependency risk actually is.
 *
 * A11's escape route used to be a whole second engine — `useDirectReq` over a
 * request coordinator, with no query cache at all. That proved something nobody
 * was worried about. The risk 0002 opens with is not the TanStack cache: it is
 * `experimental_streamedQuery`, an API whose *name* says it is outside semver
 * and which is reached through a prerelease adapter. Replacing the cache to
 * escape a helper is replacing the building to escape the door.
 *
 * It also could not be made honest. An engine with its own store keeps a value
 * for as long as somebody holds the request; a query cache keeps it until GC.
 * So mount-time refetch, retention across unmounts and collection stay visible
 * differences between the two, whatever else is repaired — and "the engine is
 * replaceable" cannot be claimed on a pair that a consumer can tell apart by
 * unmounting a component and mounting it again. Both files are deleted rather
 * than kept as exploration: an Accept witness that nothing runs is the shape
 * this record exists to refuse.
 *
 * The seam is here instead: **a function that turns an `AsyncIterable` of chunks
 * into a value in the query cache**. Both implementations run under the same
 * `QueryClient`, the same query identity, the same observer lifecycle, the same
 * staleness, the same GC and the same refresh coalescing, because they are the
 * same engine. What differs is the accumulation and nothing else, which is what
 * makes "swap the implementation" a thing the parity suite can execute rather
 * than a thing the record asserts.
 *
 * - {@link streamedQueryAccumulator} is what ships, and this module is the only
 *   place in the library that names the experimental helper (`WR1`).
 * - {@link setQueryDataAccumulator} is the fallback, written over
 *   `QueryClient.setQueryData` / `getQueryData` — API that carries no
 *   `experimental_` prefix and has been in query-core since v4.
 *
 * **The seam carries `append` and nothing else.** It used to carry all three of
 * the helper's refetch modes, and the record then claimed a fallback "written
 * over `setQueryData`/`getQueryData`" while `'reset'` and `'replace'` needed the
 * query cache's `find`, `isFetched`, `setState` and `resetState` — four calls
 * into query state internals, to reproduce two modes A2 forbids and nothing in
 * the library selects. The claim was false as written, and the cost of making
 * it true was carried by the mode this library never uses. So the modes left
 * the seam: A2's `'append'` is fixed inside adapter A, and what the other two do
 * is measured where it belongs, against the dependency itself (`CTR-5`,
 * `CTR-6`, `CTR-7`, `CTR-8`) rather than through a parity pair.
 */

import {
  experimental_streamedQuery,
  type QueryFunction,
  type QueryFunctionContext,
  type QueryKey
} from 'tanstack-svelte-query-v6';

import type { CachedEventSet } from './eventset.js';
import type { Chunk } from './stream.js';

/**
 * What an accumulator is given.
 *
 * Deliberately the same fields the experimental helper takes, so adapter A is a
 * rename and nothing more. A seam whose shape had to be translated on the way in
 * would be measuring the translation as well as the implementation.
 *
 * There is deliberately no `refetchMode` here. A re-fetch appends, because that
 * is what A2 decides, and a seam that could be handed another mode would be a
 * seam whose two sides have to agree about behaviour the library forbids.
 */
export interface AccumulateParams {
  initialValue: CachedEventSet;
  reducer: (acc: CachedEventSet, chunk: Chunk) => CachedEventSet;
  /**
   * A general `AsyncIterable`, which is what the obligation on the *other* side
   * of this seam is written against: `A11-P1` requires one call to this and
   * exactly one iterator taken from what the call returns. **The type still
   * cannot say either half** — a re-iterable iterable is a conforming
   * `AsyncIterable`, and on one of those a second `[Symbol.asyncIterator]()` may
   * open its own producer, so "called once" does not carry "opened one".
   *
   * **What closes the gap is the value rather than the type.** The engine hands
   * over `oneShotStream`'s capability: the second call returns the first
   * object, the underlying is acquired once by the engine, and a pull after the
   * invocation ends yields nothing. So an accumulator that calls twice or takes
   * two iterators drives the one producer instead of forking the request, and
   * `AC19`'s count now measures whether the accumulator kept its side of
   * `A11-P1` rather than standing between it and a second subscription.
   *
   * **The protection is the engine's, not this type's, and the difference is
   * reachable**: anything that builds this field itself — a harness, a test that
   * drives an adapter against a stream of its own — gets whatever it supplied,
   * with none of the four properties. Both accumulators below take one iterator
   * either way.
   */
  streamFn: (context: QueryFunctionContext<QueryKey>) => AsyncIterable<Chunk>;
}

/**
 * The seam itself: params in, a `queryFn` out.
 *
 * A `QueryFunction` rather than anything of ours, because that is what makes the
 * two implementations interchangeable *inside* the engine — the caller hands the
 * result to `createQuery` and cannot tell which one produced it.
 */
export type StreamAccumulator = (
  params: AccumulateParams
) => QueryFunction<CachedEventSet, QueryKey>;

/**
 * Adapter A — the experimental helper, and the only import of it.
 *
 * A thin wrapper on purpose. Anything this added would be behaviour the
 * fallback would then have to reproduce for reasons that had nothing to do with
 * the dependency.
 *
 * The one thing it does add is A2: the mode is fixed **here**, in the adapter
 * that names the helper, rather than defaulted at the call site or carried on
 * the seam. Leaving it out took upstream's `'reset'`, which empties the cache
 * before re-accumulating — measured: one `refresh()` and the settled list was
 * gone (`CTR-5`, `SEN8`).
 */
export const streamedQueryAccumulator: StreamAccumulator = ({ initialValue, reducer, streamFn }) =>
  experimental_streamedQuery<Chunk, CachedEventSet, QueryKey>({
    refetchMode: 'append',
    initialValue,
    reducer,
    streamFn
  });

/**
 * A context whose `signal` is consumed on first read, not on construction.
 *
 * This is upstream's `addConsumeAwareSignal`, hand-rolled, and it is not a
 * detail: two things hang off *whether the query function touched the signal*.
 * query-core's own `removeObserver()` aborts only when it did, and the helper's
 * cancellation flag is armed only when it did. An adapter that read
 * `context.signal.aborted` in its loop would therefore consume the signal on
 * behalf of a stream that never asked for it, and `consumeSignal: false` — the
 * option that exists to measure #61's failure mode (M5) — would stop reproducing
 * it under this adapter while still reproducing it under the other. The two
 * adapters would then differ on something a consumer can see.
 *
 * `cancelled` rather than re-reading `signal.aborted` for the same reason
 * upstream does it: once the listener has been attached, the abort is a fact
 * about this run, and reading the property again would consume it a second time
 * on a context that may have handed it out already.
 */
function consumeAwareContext(
  context: QueryFunctionContext<QueryKey>,
  onCancelled: () => void
): QueryFunctionContext<QueryKey> {
  let consumed = false;
  let signal: AbortSignal | undefined;
  return {
    client: context.client,
    queryKey: context.queryKey,
    meta: context.meta,
    get signal(): AbortSignal {
      signal ??= context.signal;
      if (consumed) return signal;
      consumed = true;
      if (signal.aborted) onCancelled();
      else signal.addEventListener('abort', onCancelled, { once: true });
      return signal;
    }
  };
}

/**
 * Adapter B — the same accumulation over API that is not experimental.
 *
 * **Four calls and no more**: `setQueryData`, `getQueryData`, the stream
 * function, and reading the signal once through
 * {@link consumeAwareContext}. Nothing here reaches the query cache, a `Query`
 * or its state — no `find`, no `isFetched`, no `setState`, no `resetState` —
 * which is what makes "written over `setQueryData`/`getQueryData`" a description
 * of the code rather than of the two calls a reader happens to notice first.
 *
 * That was not true while the seam carried `'reset'` and `'replace'`. Both
 * modes are defined in terms of query *state* — blank the entry as the refetch
 * begins, or hold the value until the stream ends — and reproducing them meant
 * copying the internals above, pinned to a version of them, for behaviour A2
 * forbids. Narrowing the seam to `'append'` is what deleted them.
 *
 * The append path is still written against the **resolved** helper rather than
 * the one at the top of `node_modules`. Both copies are present here:
 * `@tanstack/query-core@5.90.2` under the shipping dependency — which is a
 * direct dependency and not a peer one (0002 A15), and this line said peer —
 * and
 * `5.101.4` under `tanstack-svelte-query-v6`, which is the one this library's
 * code path actually calls. Two differences survive the narrowing, and each is
 * observable:
 *
 * - cancellation is a flag armed by reading the signal, not a read of
 *   `context.signal.aborted` per chunk. See {@link consumeAwareContext}.
 * - an empty stream returns `initialValue` rather than a non-null assertion on
 *   `getQueryData`.
 *
 * The other two differences the older copy has — `isRefetch` read as
 * `state.data !== undefined` rather than `query.isFetched()`, and `'reset'`
 * hand-building a pending state instead of writing `query.resetState` — are
 * gone with the modes that consulted them. What they *say* about the dependency
 * is kept as a measurement against the dependency (`CTR-5`, `CTR-8`), which is
 * where a fact about upstream can be re-checked when upstream moves.
 *
 * Following the older copy would have produced an adapter that passes its own
 * tests and diverges from the one that ships, which is the failure mode this
 * whole seam exists to detect.
 */
export const setQueryDataAccumulator: StreamAccumulator =
  ({ initialValue, reducer, streamFn }) =>
  async (context) => {
    let cancelled = false;
    const streamContext = consumeAwareContext(context, () => {
      cancelled = true;
    });
    const stream = await streamFn(streamContext);

    for await (const chunk of stream) {
      if (cancelled) break;

      context.client.setQueryData<CachedEventSet>(context.queryKey, (prev) =>
        reducer(prev ?? initialValue, chunk)
      );
    }

    // Read back rather than accumulated into a local. The cache is the thing
    // being accumulated into — a local copy returned at the end would be a
    // second answer, and the two would disagree the moment anything else wrote
    // to the entry while the stream was running.
    return context.client.getQueryData<CachedEventSet>(context.queryKey) ?? initialValue;
  };
