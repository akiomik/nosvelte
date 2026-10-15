/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * A request that runs out of patience: the landing of `A-γ-C1` (`ST1`).
 *
 * **Through the published entry and nothing else**, because the row's route is
 * `public`: `NostrApp` with `relays` only, so the verifier is the one the
 * library supplies and the event the relay sends is signed for real; a
 * consumer's own `useReq`, and a published `EventList`, under it; and a relay
 * that never sends `EOSE`.
 *
 * Port band 9500-9519.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { getEventHash, getPublicKey, getSignature } from 'rx-nostr-crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { IncompleteResultError, type ReqHandle, type ReqPlan } from '$lib/v1/index.js';

import ListedEvents from './fixtures/ListedEvents.svelte';
import PublishedRequest from './fixtures/PublishedRequest.svelte';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.unstubAllGlobals();
  WS.clean();
});

let port = 9500;
const nextUrl = (): string => `ws://localhost:${String((port += 1))}`;

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const SECKEY = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';

/** An event signed correctly over its own fields, as a relay would carry one. */
const signed = (content: string): Nostr.Event => {
  const unsigned = { kind: 1, created_at: 1000, tags: [], content, pubkey: getPublicKey(SECKEY) };
  const id = getEventHash(unsigned);
  return { ...unsigned, id, sig: getSignature(id, SECKEY) };
};

/** A relay the published entry connects to, and the subscription it was first asked for. */
async function relayFor(url: string) {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  const relay = new WS(url, { jsonProtocol: true });
  const subId = async (): Promise<string> => {
    let found: string | undefined;
    await vi.waitFor(
      () => {
        found = (relay.messages as unknown[][])
          .filter((frame) => frame[0] === 'REQ')
          .map((frame) => String(frame[1]))[0];
        expect(found, 'the relay was asked').toBeDefined();
      },
      { timeout: 3000 }
    );
    return found as string;
  };
  return { relay, subId };
}

const failed = (error: unknown) => ({
  failed: error instanceof Error ? error.message : String(error)
});

describe('a request that runs out of patience', () => {
  // @contracts A-γ-C1
  it('ST1: a relay that never sends EOSE leaves the request incomplete under timeout, keeping what it had', async () => {
    // **Twice.** A consumer's own `useReq`, with a short settle timeout of its
    // own, reads the answer: `incomplete` under `timeout` alone, the event the
    // relay did send still there, and an `IncompleteResultError` among the
    // diagnostics. A published `EventList` reads the slot — the one claim
    // about a component rather than a handle — under the default timeout,
    // with the request the outlet is handed read alongside the events, so the
    // outlet that shows events before the timeout cannot pass for the one that
    // shows them after it.
    const event = signed('the only event the relay sends');
    const runs: Record<string, unknown> = {};

    {
      const url = nextUrl();
      const { relay, subId } = await relayFor(url);
      let handle: ReqHandle | undefined;
      const plan: ReqPlan = {
        kind: 'request',
        descriptor: { filters: [{ kinds: [1] }], settleTimeoutMs: 300 }
      };
      const view = render(PublishedRequest, {
        relays: [url],
        plan: () => plan,
        seen: (request: ReqHandle) => {
          handle = request;
        },
        published: () => {}
      });
      try {
        const backward = await subId();
        relay.send(['EVENT', backward, event]);
        await vi.waitFor(() => expect(handle?.state.status).toBe('incomplete'), {
          timeout: 3000
        });
        const request = handle as ReqHandle;
        const { state, diagnostics } = request;
        runs['aConsumersRequest'] = {
          status: state.status,
          causes: state.status === 'incomplete' ? [...state.causes] : undefined,
          events: state.status === 'loading' ? undefined : state.events.map((each) => each.id),
          lastError: diagnostics.lastError?.name,
          anIncompleteResultError: diagnostics.lastError instanceof IncompleteResultError
        };
      } catch (error) {
        runs['aConsumersRequest'] = failed(error);
      } finally {
        view.unmount();
      }
    }

    {
      const url = nextUrl();
      const { relay, subId } = await relayFor(url);
      const outlets: [string, unknown][] = [];
      const view = render(ListedEvents, {
        relays: [url],
        ids: [event.id],
        held: (outlet: string, argument: unknown) => {
          outlets.push([outlet, argument]);
        }
      });
      const latest = () => {
        const [outlet, argument] = outlets.at(-1) ?? ['none', undefined];
        const { events, request } = (argument ?? {}) as {
          events?: readonly { id: string }[];
          request?: ReqHandle;
        };
        return { outlet, events: events?.map((each) => each.id), request };
      };
      try {
        const backward = await subId();
        relay.send(['EVENT', backward, event]);
        // The component's own default settle timeout, five seconds.
        await vi.waitFor(() => expect(latest().request?.state.status).toBe('incomplete'), {
          timeout: 8000
        });
        await delay(50);
        const { outlet, events, request } = latest();
        const state = request?.state;
        runs['aPublishedList'] = {
          outlet,
          events,
          status: state?.status,
          causes: state?.status === 'incomplete' ? [...state.causes] : undefined
        };
      } catch (error) {
        runs['aPublishedList'] = failed(error);
      } finally {
        view.unmount();
      }
    }

    expect(
      runs,
      'incomplete under timeout, the event kept, the default slot, and the error that says so'
    ).toEqual({
      aConsumersRequest: {
        status: 'incomplete',
        causes: ['timeout'],
        events: [event.id],
        lastError: 'IncompleteResultError',
        anIncompleteResultError: true
      },
      aPublishedList: {
        outlet: 'events',
        events: [event.id],
        status: 'incomplete',
        causes: ['timeout']
      }
    });
  }, 20_000);
});
