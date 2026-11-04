/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The standalone arm, kept as an internal seam (`0002` A16): the landing of
 * `A-ε-C16` (`SA1`, with `SA2` its control).
 *
 * A request that brings an owner input is served from what it brings and not
 * from a provider. Nothing published reaches it; `useStreamedReq` does, with
 * the inputs a caller would bring.
 *
 * Port band 10780-10799.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import { QueryClient } from 'tanstack-svelte-query-v6';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { createAttemptRegistry } from '$lib/v1/attempt.js';
import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
import type { ReqError } from '$lib/v1/reqerror.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import PublishedRequest from './fixtures/PublishedRequest.svelte';
import { createTestRelay } from './helpers/relay.js';
import { relayAt, urlsFrom } from './helpers/request.js';
import { mount } from './helpers/runes.svelte.js';

afterEach(() => {
  vi.unstubAllGlobals();
  WS.clean();
});

const nextUrl = urlsFrom(10780);

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A wait long enough for a request to have put what it asks on the wire. */
const A_TURN_MS = 200;

/**
 * The sentence that offers the two ways out, each as enough on its own.
 * **Read as one sentence, and not as a pattern of names**: a refusal that names
 * both can still deny one — "you must pass `verifyEvent` even inside
 * `NostrApp`", or an "either … or" whose two arms both ask for the option —
 * and every pattern tried was satisfied by one of those. So the arm supports
 * this wording and refuses every other.
 */
const THE_WAYS_OUT =
  'Either use it inside a `NostrApp` provider, which supplies one, or pass `verifyEvent` explicitly.';

/** Whether `message` offers the two ways out, in {@link THE_WAYS_OUT}'s words. */
const offersBoth = (message: string): boolean => message.includes(THE_WAYS_OUT);

/** The `REQ`s a relay was sent. */
const reqsTo = (server: WS): unknown[][] =>
  (server.messages as unknown[][]).filter((frame) => frame[0] === 'REQ');

describe('A-ε-C16: a request built with neither a verifier nor a provider is refused before anything is asked of a relay, and the refusal names the two ways out', () => {
  // @contracts A-ε-C16
  it('SA1: standalone, with a transport, a client and an attempt registry, and no `verifyEvent`', async () => {
    const { rxNostr, server } = createTestRelay(nextUrl());
    // Built once, outside the options: what the caller brings is the caller's.
    const attempts = createAttemptRegistry();
    // **The client a caller ordinarily brings retries**, and every retry
    // re-enters the query function: query-core's default is three. Kept, so
    // the count below covers four invocations and not the first one only; only
    // the wait between them is taken away.
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    const held = mount(() =>
      useStreamedReq(() => ({
        attempts,
        rxNostr,
        client,
        namespace: 'sa1',
        filters: [{ kinds: [1] }],
        reqIdBase: 'sa1',
        settleTimeoutMs: 30_000
      }))
    );
    const entry = () => client.getQueryCache().getAll()[0]?.state;
    try {
      // Until every invocation the client makes has run and none is still
      // under way — or until a relay has been asked, which is the breach, so
      // that it is read where the claim is and not as a wait that ran out.
      await vi.waitFor(
        () =>
          expect(
            reqsTo(server).length > 0 ||
              (entry()?.fetchStatus === 'idle' && (entry()?.fetchFailureCount ?? 0) > 0)
          ).toBe(true),
        { timeout: 3000 }
      );
      await delay(A_TURN_MS);
      const state = held.value.state as { status: string; error?: ReqError };
      const message = state.error?.message ?? '';
      expect({
        asked: reqsTo(server).length,
        status: state.status,
        offersBoth: offersBoth(message),
        // **The reading's control**: refusals that name both and deny one.
        refusesTheDenials: [
          'You must pass `verifyEvent` even inside a `NostrApp` provider.',
          'Either pass `verifyEvent` explicitly, or use `NostrApp` and still pass `verifyEvent` explicitly.'
        ].map(offersBoth),
        // **The instrument's control**: the count covers four invocations.
        invocations: entry()?.fetchFailureCount
      }).toEqual({
        asked: 0,
        status: 'error',
        offersBoth: true,
        refusesTheDenials: [false, false],
        invocations: 4
      });
    } finally {
      held.destroy();
      rxNostr.dispose();
    }
  });

  it('SA2: the control: the same descriptor under a provider, which supplies one, is asked', async () => {
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
    const relay = relayAt(nextUrl());
    let handle: ReqHandle | undefined;
    const plan = (): ReqPlan => ({
      kind: 'request',
      descriptor: { filters: [{ kinds: [1] }], settleTimeoutMs: 30_000 }
    });
    const view = render(PublishedRequest, {
      relays: [relay.url],
      plan,
      seen: (held: ReqHandle) => {
        handle = held;
      },
      published: () => {}
    });
    // Each wait ends on the answer or on its refusal, so a request refused
    // where the control expects it asked fails at the reading below.
    const until = (done: () => boolean): Promise<void> =>
      vi.waitFor(() => expect(done()).toBe(true), { timeout: 3000 }).catch(() => undefined);
    try {
      await until(() => relay.asked('backward').length > 0 || handle?.state.status === 'error');
      const asked = relay.asked('backward').length;
      if (asked > 0) relay.answerBacklog();
      await until(() => handle?.state.status === 'settled' || handle?.state.status === 'error');
      expect({ asked, status: handle?.state.status }).toEqual({ asked: 1, status: 'settled' });
    } finally {
      view.unmount();
    }
  });
});
