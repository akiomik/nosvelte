/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What a request reports when an attempt throws part way through: the landings
 * of `C5-C3` (`TH1`), `C5-C5` (`TH2`, and `TH4` for the one value a rejection is
 * published as) and `C5-C7` (`TH3`).
 *
 * **Internal, because no relay reaches this.** A relay's failures never throw
 * out of the stream, so each arm puts the throw in a real accumulator's reducer
 * (`poisonId`), which is a seam the descriptor does not have.
 *
 * Port band 10560-10579.
 */
import { render } from '@testing-library/svelte';
import { QueryClient } from 'tanstack-svelte-query-v6';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { createAttemptRegistry } from '$lib/v1/attempt.js';
import { createExpiryClock } from '$lib/v1/clock.svelte.js';
import type { ReqHandle } from '$lib/v1/engine.js';
import { isOwnedByLibrary } from '$lib/v1/owned.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import Outlets from './fixtures/Outlets.svelte';
import { NOTHING_WRITTEN } from './helpers/console.js';
import {
  acceptAnyEvent,
  createTestRelay,
  fakeEvent,
  respondWithEose,
  respondWithEvent
} from './helpers/relay.js';
import { flush, mount } from './helpers/runes.svelte.js';

const watch = await vi.hoisted(async () => {
  const { watchConsole } = await import('./helpers/console.js');
  return watchConsole();
});

afterAll(() => {
  watch.release();
});

const attempts = createAttemptRegistry();

let port = 10560;
const nextUrl = (): string => `ws://localhost:${String((port += 1))}`;

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  client.clear();
  WS.clean();
});

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function settle(ms = 80): Promise<void> {
  await delay(ms);
  flush();
}

/** The backward subscriptions the relay has been asked for, oldest first. */
const askedBackward = (server: WS): string[] =>
  (server.messages as unknown[][])
    .filter((frame) => frame[0] === 'REQ' && String(frame[1]).includes('-b:'))
    .map((frame) => String(frame[1]));

/** The relay's newest backward subscription, once it has been asked for more than `beyond`. */
async function nextBackward(server: WS, beyond = 0): Promise<string> {
  await vi.waitFor(() => expect(askedBackward(server).length).toBeGreaterThan(beyond), {
    timeout: 3000
  });
  return askedBackward(server).at(-1) as string;
}

/** The outlets a request component renders for `handle`. */
function outletsOf(handle: ReqHandle): string[] {
  const rendered: string[] = [];
  const view = render(Outlets, {
    props: { request: handle, single: false, held: (outlet: string) => rendered.push(outlet) }
  });
  flush();
  view.unmount();
  return rendered;
}

/** What these rows read off a handle, at one instant. */
const readingOf = (handle: ReqHandle) => ({
  status: handle.state.status,
  events:
    handle.state.status === 'loading' ? [] : handle.state.events.map((event) => event.content),
  activity: handle.activity,
  outlets: outletsOf(handle),
  failed: handle.diagnostics.lastError !== undefined
});

describe('C5: an attempt that throws part way through', () => {
  // @contracts C5-C3
  it('TH1: a failed attempt whose only event expires is the error state, not a spinner', async () => {
    // **Where the failure and an expiry meet.** The value holds one event, a
    // failure, and no backlog end. Until the deadline that is `streaming` over
    // the event, with the failure beside it, which is the control. At the
    // deadline the event leaves the read model, and what is left is a request
    // with nothing to show, nothing being fetched, and a failure recorded. All
    // three axes are read because the defect is only visible as the
    // combination: `streaming` alone is what a healthy request reports, and
    // `idle` alone is what a settled one does. The clock is the arm's, so the
    // deadline passes when this says, and nothing else happens at it.
    const { rxNostr, server } = createTestRelay(nextUrl());
    const poison = fakeEvent({ content: 'the throw' });
    const base = 1_000;
    let now = base;
    const clock = createExpiryClock({ source: () => now, schedule: false });
    const held = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        client,
        namespace: 'th1',
        filters: [{ kinds: [1] }],
        reqIdBase: 'th1',
        poisonId: poison.id,
        clock,
        // Far enough that the backlog has not ended: an answer is an answer
        // whether or not anything is left in it.
        settleTimeoutMs: 30_000
      }))
    );
    try {
      const backward = await nextBackward(server);
      respondWithEvent(
        server,
        backward,
        fakeEvent({ content: 'perishable', tags: [['expiration', String(base + 60)]] })
      );
      await vi.waitFor(
        () => {
          flush();
          expect(held.value.state.status).toBe('streaming');
        },
        { timeout: 3000 }
      );
      respondWithEvent(server, backward, poison);
      await vi.waitFor(
        () => {
          flush();
          expect(held.value.diagnostics.lastError).toBeDefined();
        },
        { timeout: 3000 }
      );
      await settle();
      const beforeTheDeadline = readingOf(held.value);
      const reported = held.value.diagnostics.lastError;
      now = base + 61;
      clock.tickForTest();
      await settle();
      const state = held.value.state;
      expect(
        {
          beforeTheDeadline,
          atTheDeadline: readingOf(held.value),
          theSameFailure: state.status === 'error' && state.error === reported
        },
        'streaming beside the failure until the event goes, then the error, and nothing running'
      ).toEqual({
        beforeTheDeadline: {
          status: 'streaming',
          events: ['perishable'],
          activity: 'idle',
          outlets: ['events'],
          failed: true
        },
        atTheDeadline: {
          status: 'error',
          events: [],
          activity: 'idle',
          outlets: ['error'],
          failed: true
        },
        theSameFailure: true
      });
    } finally {
      clock.dispose();
      held.destroy();
    }
  }, 20_000);

  // @contracts C5-C5
  it('TH2: an attempt that throws reports one outcome, whether or not an event came first', async () => {
    // **The legacy bug was a success and an error for one attempt**, so what a
    // consumer's `refresh()` resolves is read beside what the handle says, on
    // one request, its call made while the first attempt runs. **Two ways**,
    // with the same call: the throw on the attempt's first event, where there
    // is nothing to hide behind, and on the next, in one batch with it and
    // before the backlog ends, where the event stays and the failure goes
    // beside it. **The control is the same call with no throw**, which is
    // `complete`, so an arm that could only reach `error` reads differently.
    const run = async (frames: 'the first event' | 'the next event' | 'no throw') => {
      const { rxNostr, server } = createTestRelay(nextUrl());
      const poison = fakeEvent({ content: 'the throw' });
      const name = `th2-${frames.replaceAll(' ', '-')}`;
      const held = mount(() =>
        useStreamedReq(() => ({
          verifyEvent: acceptAnyEvent,
          attempts,
          rxNostr,
          client,
          namespace: name,
          filters: [{ kinds: [1] }],
          reqIdBase: name,
          poisonId: poison.id,
          settleTimeoutMs: 30_000
        }))
      );
      try {
        await nextBackward(server);
        const call = held.value.refresh();
        const backward = await nextBackward(server, 1);
        if (frames === 'the first event') respondWithEvent(server, backward, poison);
        else {
          respondWithEvent(server, backward, fakeEvent({ content: 'kept' }));
          if (frames === 'the next event') respondWithEvent(server, backward, poison);
          else respondWithEose(server, backward);
        }
        const outcome = await Promise.race([call, delay(3000)]);
        await settle();
        const handle = held.value;
        const told = handle.diagnostics.lastError;
        const { state } = handle;
        return {
          ...readingOf(handle),
          outcome: (outcome as { kind?: string } | undefined)?.kind,
          oneError:
            told === undefined
              ? 'none'
              : (outcome as { error?: unknown }).error === told &&
                (state.status !== 'error' || state.error === told),
          ours: told === undefined ? 'none' : isOwnedByLibrary(told),
          said: told === undefined ? 'none' : told.message === `collect failed on ${poison.id}`
        };
      } finally {
        held.destroy();
      }
    };
    expect(
      {
        'the first event': await run('the first event'),
        'the next event': await run('the next event'),
        'no throw': await run('no throw')
      },
      'one attempt, one outcome, and every surface carrying one Error'
    ).toEqual({
      'the first event': {
        status: 'error',
        events: [],
        activity: 'idle',
        outlets: ['error'],
        failed: true,
        outcome: 'error',
        oneError: true,
        ours: true,
        said: true
      },
      'the next event': {
        status: 'streaming',
        events: ['kept'],
        activity: 'idle',
        outlets: ['events'],
        failed: true,
        outcome: 'error',
        oneError: true,
        ours: true,
        said: true
      },
      'no throw': {
        status: 'settled',
        events: ['kept'],
        activity: 'idle',
        outlets: ['events'],
        failed: false,
        outcome: 'complete',
        oneError: 'none',
        ours: 'none',
        said: 'none'
      }
    });
  }, 20_000);

  // @contracts C5-C7
  it('TH3: an accumulator that throws writes nothing to the console, on the first attempt or on a retry', async () => {
    // **Every method the console has**, watched from before the library was
    // imported, read once the request has gone, and each shown to be watched by
    // a write of the arm's own after that. The legacy bug logged a stream error,
    // and in v1 the only failure that is a thrown error comes through the
    // accumulator. The retry is a `refresh()`, on a client that retries nothing
    // on its own, read to have reached the wire and to have failed again.
    const { rxNostr, server } = createTestRelay(nextUrl());
    const poison = fakeEvent({ content: 'the throw' });
    const held = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        client,
        namespace: 'th3',
        filters: [{ kinds: [1] }],
        reqIdBase: 'th3',
        poisonId: poison.id,
        settleTimeoutMs: 30_000
      }))
    );
    let retried: unknown;
    let anotherFailure: boolean | undefined;
    try {
      respondWithEvent(server, await nextBackward(server), poison);
      await vi.waitFor(
        () => {
          flush();
          expect(held.value.state.status).toBe('error');
        },
        { timeout: 3000 }
      );
      await settle();
      const first = held.value.state.status === 'error' ? held.value.state.error : undefined;
      const call = held.value.refresh();
      respondWithEvent(server, await nextBackward(server, 1), poison);
      retried = await Promise.race([call, delay(3000)]);
      await settle();
      anotherFailure = held.value.diagnostics.lastError !== first;
    } finally {
      held.destroy();
    }
    await settle();
    expect(
      {
        written: watch.reading(),
        retried: (retried as { kind?: string } | undefined)?.kind,
        anotherFailure
      },
      'nothing written and every method watched, with both attempts failed'
    ).toEqual({ written: NOTHING_WRITTEN, retried: 'error', anotherFailure: true });
  }, 20_000);

  it('TH4: a failure reported again is read again, though it is the same object', async () => {
    // **The key of what a rejection is published as**, and the value that can
    // only be told apart by reading it: a foreign object the query reports, then
    // a success, then the same object changed, then another object at the same
    // count, which is what a reset leaves. It is the one rejection that is
    // copied, so what a later report says is a new copy or an old one, and the
    // cache entry is written directly since nothing else reaches it twice.
    const { rxNostr, server } = createTestRelay(nextUrl());
    const held = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        client,
        namespace: 'th4',
        filters: [{ kinds: [1] }],
        reqIdBase: 'th4',
        settleTimeoutMs: 30_000
      }))
    );
    try {
      respondWithEose(server, await nextBackward(server));
      await vi.waitFor(
        () => {
          flush();
          expect(held.value.state.status).toBe('settled');
        },
        { timeout: 3000 }
      );
      const [entry] = client.getQueryCache().getAll();
      const foreign = new Error('reported once');
      const report = async (error: Error, count: number): Promise<string | undefined> => {
        entry?.setState({ status: 'error', error, errorUpdateCount: count });
        await settle();
        return held.value.diagnostics.lastError?.message;
      };
      const first = await report(foreign, 1);
      const oneValue = held.value.diagnostics.lastError === held.value.diagnostics.lastError;
      entry?.setState({ status: 'success', error: null });
      await settle();
      foreign.message = 'reported twice';
      const second = await report(foreign, 2);
      const third = await report(new Error('reported by another'), 2);
      expect(
        { first, oneValue, second, third },
        'one value for one report, and a later report read again'
      ).toEqual({
        first: 'reported once',
        oneValue: true,
        second: 'reported twice',
        third: 'reported by another'
      });
    } finally {
      held.destroy();
    }
  }, 20_000);
});
