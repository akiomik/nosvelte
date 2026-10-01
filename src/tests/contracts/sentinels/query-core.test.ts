/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What this design assumes the query library does, asked of the query library.
 */
import { QueryClient, QueryObserver } from 'tanstack-svelte-query-v6';
import { describe, expect, it } from 'vitest';

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

describe('query-core, exercised directly', () => {
  // @contracts A1-S1
  it('DS7: a query function is cancelled only if it read the abort signal', async () => {
    // The reason the wrapper touches `context.signal` at all. Measured through
    // the wrapper before, with an option that exists only for the spike — which
    // measures the wrapper's option rather than the library's rule.
    const results: Record<string, boolean> = {};

    for (const consume of [true, false]) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      let aborted = false;
      const observer = new QueryObserver(client, {
        queryKey: [`sen7-${String(consume)}`],
        queryFn: async (context: { signal: AbortSignal }) => {
          const signal = consume ? context.signal : undefined;
          signal?.addEventListener('abort', () => (aborted = true));
          await new Promise((resolve) => setTimeout(resolve, 500));
          return 1;
        }
      });
      const unsubscribe = observer.subscribe(() => undefined);
      await settle();
      unsubscribe();
      await settle();
      results[String(consume)] = aborted;
      client.clear();
    }

    // Reading the signal is what makes removing the observer cancel the work.
    expect(results).toEqual({ true: true, false: false });
  });

  // @contracts A2-S1
  it('DS8: the streaming helper starts from the seed unless told otherwise', async () => {
    const { experimental_streamedQuery } = await import('tanstack-svelte-query-v6');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const chunks = ['a', 'b'];

    const run = async (mode?: 'append' | 'reset' | 'replace'): Promise<unknown> => {
      const queryFn = experimental_streamedQuery<string, string[], string[]>({
        ...(mode === undefined ? {} : { refetchMode: mode }),
        initialValue: [],
        reducer: (acc: string[], chunk: string) => [...acc, chunk],

        streamFn: async function* () {
          for (const chunk of chunks) yield chunk;
        } as never
      });
      return client.fetchQuery({ queryKey: ['sen8'], queryFn: queryFn as never });
    };

    await run();
    const afterFirst = client.getQueryData(['sen8']);
    await run();
    const afterSecond = client.getQueryData(['sen8']);

    // Two fetches, and the second did not grow the first — which is why the
    // wrapper pins the mode rather than taking this default.
    expect(afterFirst).toEqual(['a', 'b']);
    expect(afterSecond).toEqual(['a', 'b']);
    client.clear();
  });

  // @contracts A6-C4
  it('DS11: a refetch runs the last observer options set, not the caller of it', async () => {
    // What decides where an attempt id has to be handed over. A6 says the
    // caller names its attempt before starting it, and the name has to reach
    // the query function the refetch re-runs — so "which hook's query function
    // is that" is the question the hand-off's design rests on.
    //
    // The answer is that the query holds one set of options, replaced by every
    // observer that sets its own, and a `refetchQueries` call passes none — so
    // the function that runs is the one belonging to whichever observer updated
    // last, whoever asked for the refetch. That is why the claim is kept
    // against the cache entry rather than beside the hook that made it.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ran: string[] = [];
    const observerFor = (name: string) =>
      new QueryObserver(client, {
        queryKey: ['sen11'],
        staleTime: 0,
        queryFn: async () => {
          ran.push(name);
          return name;
        }
      });

    const first = observerFor('first');
    const unsubscribeFirst = first.subscribe(() => undefined);
    const second = observerFor('second');
    const unsubscribeSecond = second.subscribe(() => undefined);
    await settle();

    // Both are mounted on one entry; the second one set its options last.
    ran.length = 0;
    await client.refetchQueries({ queryKey: ['sen11'], exact: true });
    await settle();

    expect(ran).toEqual(['second']);

    unsubscribeFirst();
    unsubscribeSecond();
    client.clear();
  });

  // @contracts C11-S1
  it('DS15: a refetch joins the fetch in flight while the entry holds no value', async () => {
    // What `refresh()` has to work around to keep its promise that it starts a
    // new attempt. `cancelRefetch` is switched off while `data` is undefined, so
    // between a mount and its first chunk a refetch opens nothing at all — and a
    // caller waiting for the attempt it named waits for one that never ran.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let runs = 0;
    let release: (value: string) => void = () => undefined;
    const observer = new QueryObserver(client, {
      queryKey: ['sen15'],
      staleTime: 0,
      queryFn: async () => {
        runs += 1;
        return await new Promise<string>((resolve) => {
          release = resolve;
        });
      }
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await settle();
    expect(runs).toBe(1);

    // Nothing has been written under this key yet, which is the whole condition.
    expect(client.getQueryData(['sen15'])).toBeUndefined();
    void client.refetchQueries({ queryKey: ['sen15'], exact: true });
    await settle();
    expect(runs).toBe(1);

    // And `resetQueries` is the way out: it puts the entry back to idle first,
    // so the refetch that follows is a fetch of its own.
    void client.resetQueries({ queryKey: ['sen15'], exact: true });
    await settle();
    expect(runs).toBe(2);

    release('done');
    unsubscribe();
    client.clear();
  });

  // @contracts C11-S2
  it('DS16: a silently cancelled fetch resolves with the promise of the one replacing it', async () => {
    // Why the wait cannot simply await the trigger it fired. A refetch over an
    // entry that *does* hold a value cancels the fetch in flight — and the
    // cancelled fetch's promise does not settle there: query-core deliberately
    // piggybacks it onto the replacement. So awaiting one's own trigger is
    // awaiting somebody else's attempt.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const releases: ((value: string) => void)[] = [];
    const observer = new QueryObserver(client, {
      queryKey: ['sen16'],
      staleTime: 0,
      queryFn: async () =>
        await new Promise<string>((resolve) => {
          releases.push(resolve);
        })
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await settle();
    releases[0]?.('first');
    await settle();
    expect(client.getQueryData(['sen16'])).toBe('first');

    // The one that gets cancelled, and a record of whether its promise settled.
    let firstSettled = false;
    void client
      .refetchQueries({ queryKey: ['sen16'], exact: true })
      .then(() => (firstSettled = true));
    await settle();
    void client.refetchQueries({ queryKey: ['sen16'], exact: true });
    await settle();

    // Two fetches have been started and the cancelled one is still pending,
    // because what it is now waiting on is the second one's result.
    expect(releases.length).toBe(3);
    expect(firstSettled).toBe(false);

    releases[2]?.('third');
    await settle();
    expect(firstSettled).toBe(true);

    unsubscribe();
    client.clear();
  });

  // @contracts A13-S1
  it('DS21: the mount-time predicate counts the mounting observer, and decides nothing alone', async () => {
    // The joint A13's mount-time trigger is built on. `refetchOnMount` as a
    // predicate over the observer count is what lets one setting answer two
    // questions — "join the request that is already here" and "re-ask when
    // nobody is holding one" — and every step of that rests on how query-core
    // mounts, none of which is in its published contract.
    //
    // Four facts, and the third is the one that is easy to miss: the predicate's
    // `true` is not a fetch. `shouldFetchOn` reaches it through
    // `isStale(query, options)`, so a staleTime the entry is still inside
    // silently discards the answer, and `staleTime: 'static'` returns before
    // asking at all. `staleTime: 0` and this predicate are one decision; the
    // library spells both out for that reason.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    /**
     * Mount `observers` observers over one key and report what was asked.
     *
     * `seed` puts a value under the key without fetching, because the fourth
     * fact is that an entry with no data never consults the predicate at all —
     * so a scenario about the predicate has to arrange for data first.
     */
    const run = async (scenario: {
      key: string;
      seed: boolean;
      staleTime: number | 'static';
      answer: boolean;
      observers: number;
    }): Promise<{ counts: number[]; keys: unknown[]; runs: number }> => {
      const counts: number[] = [];
      const keys: unknown[] = [];
      let runs = 0;
      if (scenario.seed) client.setQueryData([scenario.key], 'seeded');

      const unsubscribes: (() => void)[] = [];
      for (let index = 0; index < scenario.observers; index += 1) {
        const observer = new QueryObserver(client, {
          queryKey: [scenario.key],
          staleTime: scenario.staleTime,
          refetchOnMount: (query) => {
            counts.push(query.getObserversCount());
            keys.push(query.queryKey);
            return scenario.answer;
          },
          queryFn: async () => {
            runs += 1;
            return 'fetched';
          }
        });
        unsubscribes.push(observer.subscribe(() => undefined));
        await settle();
      }
      for (const unsubscribe of unsubscribes) unsubscribe();
      return { counts, keys, runs };
    };

    // 1. No data: `shouldFetchOnMount` short-circuits through
    //    `shouldLoadOnMount`, so a brand-new query loads however the predicate
    //    would have answered — and is never asked.
    const cold = await run({
      key: 'sen21-cold',
      seed: false,
      staleTime: 0,
      answer: false,
      observers: 1
    });

    // 2. The count already includes the observer being mounted: `onSubscribe`
    //    calls `addObserver(this)` before `shouldFetchOnMount`. `1` is the first
    //    mount, `2` is the one with a request to join. And the predicate is
    //    handed the `Query`, which is where the count comes from.
    const counted = await run({
      key: 'sen21-counted',
      seed: true,
      staleTime: 0,
      answer: false,
      observers: 2
    });

    // 3. Stale and asked and answered yes — the control, without which the two
    //    below would be evidence of nothing.
    const stale = await run({
      key: 'sen21-stale',
      seed: true,
      staleTime: 0,
      answer: true,
      observers: 1
    });

    // 4. The same `true`, over an entry that is not stale. Asked, and ignored.
    const fresh = await run({
      key: 'sen21-fresh',
      seed: true,
      staleTime: 60_000,
      answer: true,
      observers: 1
    });

    // 5. And `'static'` does not even ask.
    const isStatic = await run({
      key: 'sen21-static',
      seed: true,
      staleTime: 'static',
      answer: true,
      observers: 1
    });

    expect({
      cold: { counts: cold.counts, runs: cold.runs },
      counted: { counts: counted.counts, keys: counted.keys, runs: counted.runs },
      stale: { counts: stale.counts, runs: stale.runs },
      fresh: { counts: fresh.counts, runs: fresh.runs },
      static: { counts: isStatic.counts, runs: isStatic.runs }
    }).toEqual({
      cold: { counts: [], runs: 1 },
      counted: {
        counts: [1, 2],
        keys: [['sen21-counted'], ['sen21-counted']],
        runs: 0
      },
      stale: { counts: [1], runs: 1 },
      fresh: { counts: [1], runs: 0 },
      static: { counts: [], runs: 0 }
    });

    client.clear();
  });

  // @contracts C11-S3
  it('DS22: a rejected fetch keeps the value, and the next fetch clears the error only when there is none', async () => {
    // What error attribution rests on, and the reason it cannot rest on time
    // order. Three facts, measured against the resolved copy, each one holding
    // up a different decision — and the third is the one nothing pinned.
    //
    // Read together they say why "the error on screen is this attempt's,
    // because the last one was cleared when this attempt started" is true only
    // for an entry with no value. The moment a failure is recorded *into* the
    // value, `data` stops being undefined, the clear-at-start stops happening,
    // and attribution by time order stops being sound — which is the reasoning
    // an attempt id in the record replaces.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const snapshotOf = (
      key: string
    ): { status: string; fetchStatus: string; data: unknown; error: string | null } => {
      const state = client.getQueryCache().find({ queryKey: [key] })?.state;
      return {
        status: String(state?.status),
        fetchStatus: String(state?.fetchStatus),
        data: state?.data,
        error: state?.error === null || state?.error === undefined ? null : String(state.error)
      };
    };

    // (a) `refetchQueries` re-runs an entry that has stopped in `error`.
    //
    // What `refresh()`'s branch on a failed request was, and was not, needed
    // for. The branch took `resetQueries` when `query.status === 'error'`, and
    // it reasoned from `backlogOutcome` reading a stale error rather than from
    // the trigger being unable to re-run the entry. This measured the trigger
    // half on its own — an errored, idle entry with an observer on it is re-run
    // by `refetchQueries` like any other — so the reset was there for what it
    // *cleared*, not for what it started, and once the failure carried an
    // attempt id there was nothing left holding the branch up. That is what
    // this measurement licensed, and the branch is now deleted.
    //
    // The measurement stays because the deletion rests on it: every
    // `refresh()` that is not joining an unwritten fetch now goes through
    // `refetchQueries`, including over an entry that has stopped in `error`.
    // If upstream ever stopped re-running one, that path would silently do
    // nothing and this is what would say so.
    let runsA = 0;
    let failsA = true;
    const observerA = new QueryObserver(client, {
      queryKey: ['sen22-a'],
      staleTime: 0,
      queryFn: async () => {
        runsA += 1;
        if (failsA) throw new Error('sen22-a failed');
        return 'sen22-a recovered';
      }
    });
    const unsubscribeA = observerA.subscribe(() => undefined);
    await settle();
    const stopped = { ...snapshotOf('sen22-a'), runs: runsA };

    failsA = false;
    await client.refetchQueries({ queryKey: ['sen22-a'], exact: true });
    await settle();
    const restarted = { ...snapshotOf('sen22-a'), runs: runsA };

    expect({ stopped, restarted }).toEqual({
      // The precondition, asserted rather than assumed: this is the state
      // nothing but a `refresh()` reaches, so a witness that did not check it
      // could be measuring a re-run of an entry that had never stopped.
      stopped: {
        status: 'error',
        fetchStatus: 'idle',
        data: undefined,
        error: 'Error: sen22-a failed',
        runs: 1
      },
      restarted: {
        status: 'success',
        fetchStatus: 'idle',
        data: 'sen22-a recovered',
        error: null,
        runs: 2
      }
    });
    unsubscribeA();

    // (b) The error is cleared at the *start* of the next fetch only while
    // `data` is undefined.
    //
    // The premise `backlogOutcome` used to read an error under, stated as the
    // dependency's rule rather than as ours: `fetchState()` folds `{ error:
    // null, status: 'pending' }` into the fetch action only under `data ===
    // undefined`. An entry holding a value carries its previous error straight
    // through the new fetch — which is why no outcome is read off the entry's
    // error any more, and why C11-C15 no longer asks for a clear at the start
    // of an attempt: the failure carries the id of the attempt that threw and
    // is superseded by an attempt that *ends*. The rule below is also what
    // `X4` and `P49` depend on from the other side, since a failed entry here
    // does hold a value — the record the query function writes — so its error
    // survives the retry rather than being blanked at the start of it.
    const failThenHang = async (
      key: string,
      seed: string | undefined
    ): Promise<{
      failed: ReturnType<typeof snapshotOf>;
      during: ReturnType<typeof snapshotOf>;
    }> => {
      let hasFailed = false;
      let release: (value: string) => void = () => undefined;
      if (seed !== undefined) client.setQueryData([key], seed);
      const observer = new QueryObserver(client, {
        queryKey: [key],
        staleTime: 0,
        queryFn: async () => {
          if (!hasFailed) {
            hasFailed = true;
            throw new Error(`${key} failed`);
          }
          return await new Promise<string>((resolve) => {
            release = resolve;
          });
        }
      });
      const unsubscribe = observer.subscribe(() => undefined);
      await settle();
      const failed = snapshotOf(key);

      // The second fetch never settles, which is the whole point: a live
      // request's query function does not either, so what a consumer sees for
      // the life of the new attempt is this instant and not the one after it.
      void client.refetchQueries({ queryKey: [key], exact: true });
      await settle();
      const during = snapshotOf(key);

      release('done');
      await settle();
      unsubscribe();
      return { failed, during };
    };

    const empty = await failThenHang('sen22-b-empty', undefined);
    const held = await failThenHang('sen22-b-held', 'sen22-b seeded');

    expect({ empty, held }).toEqual({
      empty: {
        failed: {
          status: 'error',
          fetchStatus: 'idle',
          data: undefined,
          error: 'Error: sen22-b-empty failed'
        },
        // Cleared, and the status went back to `pending` with it.
        during: { status: 'pending', fetchStatus: 'fetching', data: undefined, error: null }
      },
      held: {
        failed: {
          status: 'error',
          fetchStatus: 'idle',
          data: 'sen22-b seeded',
          error: 'Error: sen22-b-held failed'
        },
        // Not cleared. The fetch is running and the previous attempt's error is
        // still the one a reader would attribute to it.
        during: {
          status: 'error',
          fetchStatus: 'fetching',
          data: 'sen22-b seeded',
          error: 'Error: sen22-b-held failed'
        }
      }
    });

    // (c) A fetch that rejects does not disturb the value.
    //
    // The one the failure record is built on, and the one nothing pinned. C5
    // says a background failure over a settled list leaves the list on screen,
    // and that is only expressible because the `error` action carries `data`
    // through untouched — the reducer spreads the previous state and adds
    // `error`, and never writes `data`. If it cleared the value instead, a
    // failure record living *in* the value could not survive the failure that
    // wrote it, and every state derived from the value would fall back to
    // `loading` on any failed refresh.
    let failsC = false;
    const observerC = new QueryObserver(client, {
      queryKey: ['sen22-c'],
      staleTime: 0,
      queryFn: async () => {
        if (failsC) throw new Error('sen22-c failed');
        return 'sen22-c value';
      }
    });
    const unsubscribeC = observerC.subscribe(() => undefined);
    await settle();
    const succeeded = snapshotOf('sen22-c');

    failsC = true;
    await client.refetchQueries({ queryKey: ['sen22-c'], exact: true });
    await settle();
    const rejected = snapshotOf('sen22-c');
    const seenByObserver = {
      data: observerC.getCurrentResult().data,
      status: observerC.getCurrentResult().status
    };

    expect({ succeeded, rejected, seenByObserver }).toEqual({
      succeeded: {
        status: 'success',
        fetchStatus: 'idle',
        data: 'sen22-c value',
        error: null
      },
      rejected: {
        status: 'error',
        fetchStatus: 'idle',
        // The value the rejection did not touch.
        data: 'sen22-c value',
        error: 'Error: sen22-c failed'
      },
      // And an observer reads the same pair, so this is not a cache-only fact
      // that a hook would never see.
      seenByObserver: { data: 'sen22-c value', status: 'error' }
    });
    unsubscribeC();

    client.clear();
  });

  // @contracts A4b-S1
  it('DS28: a per-query option beats both layers of default it collides with', () => {
    // **A dependency's precedence rule, recorded as a literal. What this
    // comment used to say A12 rests on it for is false.**
    //
    // It read: the published descriptor carries no query-library option, so the
    // two sets never meet (`OF3`) — but under a peer dependency the
    // `QueryClient` belongs to the consumer's application, so
    // `defaultOptions.queries` and `setQueryDefaults` are inputs this library
    // neither owns nor can refuse, and the fold below is what makes the server's
    // `enabled: false` win over them.
    //
    // **Neither half survives measurement.** The query library is a *direct*
    // dependency (0002 A15 chooses it over a peer deliberately), the provider
    // builds its own client, and no module reaches for an ambient one — so a
    // consumer's client serves no request of this library's and its option
    // layers enter no fold of ours. `CL6` and `CL7` are the pair: with a
    // consumer's client above the provider carrying `enabled` on both layers,
    // the entries are not on it and a browser request goes out regardless of
    // what it says. And independently, `LIBRARY_QUERY_DEFAULTS` carries no
    // `enabled` at all, so the server's per-query `enabled: false` has nothing
    // to outrank whichever way the fold runs.
    //
    // **What the sentinel is still for.** The fold is a real dependency
    // behaviour this library stands on wherever its own two layers meet, and
    // today they meet on `staleTime` and `refetchOnMount` — the client-wide
    // `refetchOnMountUnlessJoining` joint that `DS21` measures. Both are
    // reachable only from `UseStreamedReqOpts` and from no published input, so
    // as of this tree **no public path depends on this order**. Kept, because a
    // sentinel exists to fail when a bump moves the dependency out from under a
    // rule, and that is worth having before something starts depending on it —
    // not because A12 needs it. It is measured against the resolved query-core
    // (`DS10` pins the version).
    const client = new QueryClient({
      defaultOptions: { queries: { enabled: true, staleTime: 111, refetchOnWindowFocus: false } }
    });
    client.setQueryDefaults(['nosvelte'], {
      enabled: true,
      gcTime: 222,
      refetchOnWindowFocus: true
    });

    // The library's own options, as `useStreamedReq` composes them on the
    // server: our key, and the one value A12 turns on.
    const ours = { queryKey: ['nosvelte', 'sen28'], enabled: false };
    const resolved = client.defaultQueryOptions(ours);

    // The fold, recorded as a literal:
    //
    //     { ...defaultOptions.queries, ...getQueryDefaults(queryKey), ...options }
    //
    // Three claims, one per layer, and the last two are what stop this being
    // satisfied by a client that ignored its defaults entirely: where the
    // per-query options say nothing, each layer of default survives.
    expect(resolved.enabled).toBe(false);
    expect(resolved.staleTime).toBe(111);
    expect(resolved.gcTime).toBe(222);

    // **The boundary between the two default layers, on a key only they
    // contest.** `enabled` is `true` in both and the other keys are disjoint, so
    // without this key the two layers could fold in either order with every
    // assertion above unchanged — a reviewer reversed them and measured that.
    // `refetchOnWindowFocus` is set by both, differently, and left unset per
    // query: the per-key value is the one that wins, and the reverse order of
    // the same two layers would answer the other way.
    expect(resolved.refetchOnWindowFocus).toBe(true);
    const clientWide = { refetchOnWindowFocus: false };
    const perKey = { refetchOnWindowFocus: true };
    expect({ ...clientWide, ...perKey }.refetchOnWindowFocus).toBe(true);
    expect({ ...perKey, ...clientWide }.refetchOnWindowFocus).toBe(false);

    // **The control, in the same run: the reverse fold answers differently on
    // this very input.** Without it, `enabled: false` winning is equally
    // satisfied by an input on which both orders agree — which is the shape of
    // every accidental pass this repository has recorded. Written as two
    // spreads rather than as a second client, because what is being controlled
    // for is the order and nothing else.
    const defaults = { enabled: true, staleTime: 111 };
    expect({ ...defaults, ...ours }.enabled).toBe(false);
    expect({ ...ours, ...defaults }.enabled).toBe(true);

    // And the per-key layer alone, so the middle term of the literal above is
    // not taken on trust: with the per-query value absent, the consumer's
    // default is what the query runs under.
    expect(client.defaultQueryOptions({ queryKey: ['nosvelte', 'sen28b'] }).enabled).toBe(true);
    expect(
      client.defaultQueryOptions({ queryKey: ['nosvelte', 'sen28b'] }).refetchOnWindowFocus
    ).toBe(true);

    client.clear();
  });
});
