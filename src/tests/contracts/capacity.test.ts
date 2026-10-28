/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * A relay that allows one subscription at a time: the landing of `A5-C3`
 * (`CP1`).
 *
 * **Through the published entry**, because the row is `public`: `NostrApp`
 * with `relays` only, two consumers' own `useReq` under it
 * (`descriptor/Host.svelte`), and a relay that says, in its NIP-11 document,
 * that it allows one subscription. The document is the relay's HTTP answer:
 * `fetch` is stubbed to give it for the relay's own URL asked as
 * `application/nostr+json`, and nothing else, so what reads it is the
 * dependency the provider builds, as it would read a real relay's. Each case
 * has a relay of its own, so that no document is remembered from another.
 *
 * Port band 10420-10459.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { ReqDescriptor, ReqHandle, ReqPlan } from '$lib/v1/index.js';

import Host from './descriptor/Host.svelte';
import { urlsFrom } from './engine/helpers/request.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.unstubAllGlobals();
  WS.clean();
});

const nextUrl = urlsFrom(10420);

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** The relay's NIP-11 document: a cap of one subscription, or no limitation at all. */
type Document = { limitation: { max_subscriptions?: number } };

/**
 * A relay that is listening, whose HTTP URL answers `document` when asked for
 * its NIP-11 document, and the kinds each `REQ` it was sent asks for.
 */
function relayWith(document: Document) {
  const url = nextUrl();
  const server = new WS(url, { jsonProtocol: true });
  const http = url.replace(/^ws/, 'http');
  const documentsAsked: string[] = [];
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const asked = String(input instanceof Request ? input.url : input).replace(/\/$/, '');
    const accept = new Headers(init?.headers).get('accept');
    if (asked === http && accept === 'application/nostr+json') {
      documentsAsked.push(asked);
      return Promise.resolve(new Response(JSON.stringify(document), { status: 200 }));
    }
    return Promise.resolve(new Response('{}', { status: 404 }));
  });
  const reqs = (): unknown[][] =>
    (server.messages as unknown[][]).filter((frame) => frame[0] === 'REQ');
  return {
    url,
    server,
    /** Whether the relay's document was asked for. */
    documentRead: (): boolean => documentsAsked.length > 0,
    /** The kinds each `REQ` asked for, in the order they were sent. */
    asked: (): number[][] =>
      reqs().map((frame) => (frame[2] as { kinds?: number[] } | undefined)?.kinds ?? []),
    /** End the backlog of the `REQ` that asked for `kind`. */
    answer: (kind: number): void => {
      const frame = reqs().find(
        (each) => (each[2] as { kinds?: number[] } | undefined)?.kinds?.includes(kind) === true
      );
      server.send(['EOSE', frame?.[1]]);
    }
  };
}

/** Two requests under one provider on `url`: the first for notes, the second for reactions. */
function twoRequests(url: string, first: ReqDescriptor, second: ReqDescriptor) {
  const handles: (ReqHandle | undefined)[] = [undefined, undefined];
  const view = render(Host, {
    relays: [url],
    plans: [first, second].map((descriptor) => (): ReqPlan => ({ kind: 'request', descriptor })),
    seen: (index: number, request: ReqHandle) => {
      handles[index] = request;
    }
  });
  return {
    view,
    first: () => handles[0] as ReqHandle,
    second: () => handles[1] as ReqHandle
  };
}

const failed = (error: unknown) => ({
  failed: error instanceof Error ? error.message : String(error)
});

const statusOf = (handle: ReqHandle) => {
  const { state } = handle;
  return {
    status: state.status,
    causes: state.status === 'incomplete' ? [...state.causes] : undefined,
    events: state.status === 'loading' ? undefined : state.events.map((each) => each.id)
  };
};

describe('a relay that allows one subscription at a time', () => {
  // @contracts A5-C3
  it('CP1: a second request held back by a relay’s cap reports incomplete, and goes out when the first finishes', async () => {
    // **Three arrangements, each its own relay.** Under a cap of one, a second
    // request whose deadline passes while it is held back is `incomplete` under
    // `timeout`, not `settled` with nothing: it was never asked, so it cannot
    // say that nothing exists. Under the same cap, a second request with time
    // to wait is sent once the first's backlog has ended, and not before. And
    // without a cap, both are sent at once — which is what makes the one `REQ`
    // above the cap's doing rather than the arrangement's.
    const notes = (settleTimeoutMs: number): ReqDescriptor => ({
      filters: [{ kinds: [1] }],
      settleTimeoutMs
    });
    const reactions = (settleTimeoutMs: number): ReqDescriptor => ({
      filters: [{ kinds: [7] }],
      settleTimeoutMs
    });
    const capped: Document = { limitation: { max_subscriptions: 1 } };
    const readings: Record<string, unknown> = {};

    {
      const relay = relayWith(capped);
      const { view, second } = twoRequests(relay.url, notes(4000), reactions(300));
      try {
        await delay(1000);
        readings['held past its deadline'] = {
          documentRead: relay.documentRead(),
          asked: relay.asked(),
          second: statusOf(second())
        };
      } catch (error) {
        readings['held past its deadline'] = failed(error);
      } finally {
        view.unmount();
        vi.unstubAllGlobals();
      }
    }

    {
      const relay = relayWith(capped);
      const { view, first } = twoRequests(relay.url, notes(4000), reactions(4000));
      try {
        await vi.waitFor(() => expect(relay.asked()).toHaveLength(1), { timeout: 3000 });
        await delay(300);
        const whileTheFirstRuns = relay.asked();
        relay.answer(1);
        await vi.waitFor(() => expect(relay.asked()).toHaveLength(2), { timeout: 3000 });
        readings['sent when the first finishes'] = {
          documentRead: relay.documentRead(),
          whileTheFirstRuns,
          asked: relay.asked(),
          first: first().state.status
        };
      } catch (error) {
        readings['sent when the first finishes'] = failed(error);
      } finally {
        view.unmount();
        vi.unstubAllGlobals();
      }
    }

    {
      const relay = relayWith({ limitation: {} });
      const { view } = twoRequests(relay.url, notes(4000), reactions(4000));
      try {
        await vi.waitFor(() => expect(relay.asked()).toHaveLength(2), { timeout: 3000 });
        await delay(300);
        readings['the control: no cap'] = {
          documentRead: relay.documentRead(),
          asked: [...relay.asked()].sort()
        };
      } catch (error) {
        readings['the control: no cap'] = failed(error);
      } finally {
        view.unmount();
        vi.unstubAllGlobals();
      }
    }

    expect(readings, 'held back, reported incomplete, and sent once the first ends').toEqual({
      'held past its deadline': {
        documentRead: true,
        asked: [[1]],
        second: { status: 'incomplete', causes: ['timeout'], events: [] }
      },
      'sent when the first finishes': {
        documentRead: true,
        whileTheFirstRuns: [[1]],
        asked: [[1], [7]],
        first: 'settled'
      },
      'the control: no cap': { documentRead: true, asked: [[1], [7]] }
    });
  }, 30_000);
});
