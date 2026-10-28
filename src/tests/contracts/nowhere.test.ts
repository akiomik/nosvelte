/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Where a request cannot be asked: the landings of `B-γ-C1` (`NW1`) and
 * `C3-C2` (`NW2`).
 *
 * **Through the published entry**, because both rows are `public`: `NostrApp`
 * with `relays`, and consumers' own `useReq` under it (`descriptor/Host.svelte`),
 * over relays that are listening. So each "nothing was asked" is read off a
 * socket that would have heard a `REQ`, beside an arrangement that differs in
 * one input and does ask.
 *
 * Port band 10460-10499.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { RelayInput, ReqDescriptor, ReqHandle, ReqPlan } from '$lib/v1/index.js';

import Host from './descriptor/Host.svelte';
import { urlsFrom } from './engine/helpers/request.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.unstubAllGlobals();
  WS.clean();
});

const nextUrl = urlsFrom(10460);

/** The settle timeout each request asks for. */
const TIMEOUT_MS = 300;

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A relay that is listening, and the `REQ`s it has been sent. */
function listening() {
  const url = nextUrl();
  const server = new WS(url, { jsonProtocol: true });
  return {
    url,
    server,
    asked: (): number =>
      (server.messages as unknown[][]).filter((frame) => frame[0] === 'REQ').length
  };
}

const readable = (url: string): RelayInput => ({ url, read: true, write: true });
const writeOnly = (url: string): RelayInput => ({ url, read: false, write: true });

/** Requests under one provider, each handle as its consumer holds it. */
function provided(relays: readonly RelayInput[], descriptors: readonly ReqDescriptor[]) {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  const handles: (ReqHandle | undefined)[] = descriptors.map(() => undefined);
  const view = render(Host, {
    relays,
    plans: descriptors.map((descriptor) => (): ReqPlan => ({ kind: 'request', descriptor })),
    seen: (index: number, request: ReqHandle) => {
      handles[index] = request;
    }
  });
  return { view, handle: (index = 0) => handles[index] as ReqHandle };
}

/** What `refresh()` came to: its outcome's kind and reason, or the code it rejected with. */
const refreshed = async (handle: ReqHandle): Promise<unknown> =>
  handle.refresh().then(
    (outcome) => {
      const { kind, reason } = outcome as { kind: string; reason?: string };
      return { resolved: kind, reason };
    },
    (error: unknown) => ({ rejected: (error as { code?: unknown }).code })
  );

const failed = (error: unknown) => ({
  failed: error instanceof Error ? error.message : String(error)
});

describe('where a request cannot be asked', () => {
  // @contracts B-γ-C1
  it('NW1: a request with no readable relay is not asked, and one whose filters match nothing is answered', async () => {
    // **Two arrangements with nowhere to ask**: a provider with no relays, and
    // one whose every relay is write-only, each over a relay that is listening.
    // For a request that could match something, read once its settle timeout
    // has passed: still `loading`, `refresh()` resolving `not-started` with
    // `no-readable-relay`, and no `REQ` on the socket — beside the same
    // provider with that relay readable, which does send one. For a request
    // whose every filter is an empty set, in the same two arrangements: the
    // answer is `settled` and empty, since it needs no relay to be given.
    const anything: Nostr.Filter[] = [{ kinds: [1] }];
    const nothing: Nostr.Filter[] = [{ kinds: [1], authors: [] }];
    const arrangements = {
      'none configured': (): RelayInput[] => [],
      'every configured relay write-only': (url: string): RelayInput[] => [writeOnly(url)],
      'the control: that relay readable': (url: string): RelayInput[] => [readable(url)]
    };
    const readings: Record<string, unknown> = {};
    for (const [arrangement, relaysOf] of Object.entries(arrangements))
      for (const [question, filters] of [
        ['a filter that can match', anything],
        ['every filter an empty set', nothing]
      ] as const) {
        const name = `${arrangement}, ${question}`;
        const relay = listening();
        const { view, handle } = provided(relaysOf(relay.url), [
          { filters, settleTimeoutMs: TIMEOUT_MS }
        ]);
        try {
          await delay(TIMEOUT_MS + 700);
          const { state } = handle();
          const control = arrangement.startsWith('the control');
          readings[name] = {
            asked: relay.asked(),
            ...(control && filters === anything
              ? {}
              : {
                  status: state.status,
                  events:
                    state.status === 'loading' ? undefined : state.events.map((each) => each.id),
                  ...(filters === anything ? { refreshed: await refreshed(handle()) } : {})
                })
          };
        } catch (error) {
          readings[name] = failed(error);
        } finally {
          view.unmount();
          vi.unstubAllGlobals();
        }
      }
    const notAsked = {
      asked: 0,
      status: 'loading',
      events: undefined,
      refreshed: { resolved: 'not-started', reason: 'no-readable-relay' }
    };
    const answered = { asked: 0, status: 'settled', events: [] };
    expect(
      readings,
      'not asked where nothing is readable, and settled and empty where nothing can match'
    ).toEqual({
      'none configured, a filter that can match': notAsked,
      'none configured, every filter an empty set': answered,
      'every configured relay write-only, a filter that can match': notAsked,
      'every configured relay write-only, every filter an empty set': answered,
      'the control: that relay readable, a filter that can match': { asked: 1 },
      'the control: that relay readable, every filter an empty set': answered
    });
  }, 20_000);

  // @contracts C3-C2
  it('NW2: a request naming a relay the provider does not read from is refused before the wire', async () => {
    // **Named, and not readable**: a relay the provider does not have, and
    // separately one it has as write-only, each listening, beside one the
    // provider reads from that is listening too. The request is refused as
    // `relay-not-in-scope`, naming the relay and saying which of the two it
    // is, on its state and its diagnostics, and `refresh()` rejects with the
    // same code; neither relay is sent a `REQ`. The control names the relay
    // the provider has, and that one is asked. **And a named relay that later
    // leaves the provider, or becomes write-only there**, is refused the same
    // way, after a reading while it was still readable that was not.
    type Arrangement = { provider: (a: string, b: string) => RelayInput[]; later?: boolean };
    const arrangements: Record<string, Arrangement> = {
      'a relay the provider does not have': { provider: (a) => [readable(a)] },
      'a relay the provider has as write-only': {
        provider: (a, b) => [readable(a), writeOnly(b)]
      },
      'a relay that leaves the provider': { provider: (a) => [readable(a)], later: true },
      'a relay that becomes write-only': {
        provider: (a, b) => [readable(a), writeOnly(b)],
        later: true
      }
    };
    const refusalOf = (handle: ReqHandle, named: string) => {
      const { state, diagnostics } = handle;
      const read = (error: unknown) => {
        const { code, url, configured } = (error ?? {}) as Record<string, unknown>;
        return { code, namesTheRelay: url === named, configured };
      };
      return {
        status: state.status,
        error: state.status === 'error' ? read(state.error) : undefined,
        lastError: read(diagnostics.lastError)
      };
    };
    const readings: Record<string, unknown> = {};
    for (const [name, { provider, later }] of Object.entries(arrangements)) {
      const a = listening();
      const b = listening();
      const { view, handle } = provided(
        later === true ? [readable(a.url), readable(b.url)] : provider(a.url, b.url),
        [{ filters: [{ kinds: [1] }], relays: [b.url], settleTimeoutMs: TIMEOUT_MS }]
      );
      try {
        let whileReadable: unknown;
        if (later === true) {
          await vi.waitFor(() => expect(b.asked(), 'the named relay was asked').toBe(1), {
            timeout: 3000
          });
          whileReadable = { status: handle().state.status };
          await view.rerender({ relays: provider(a.url, b.url) });
        }
        await delay(TIMEOUT_MS + 700);
        readings[name] = {
          ...(later === true ? { whileReadable } : {}),
          ...refusalOf(handle(), b.url),
          refreshed: await refreshed(handle()),
          asked: { theProvidersRelay: a.asked(), theNamedRelay: b.asked() }
        };
      } catch (error) {
        readings[name] = failed(error);
      } finally {
        view.unmount();
        vi.unstubAllGlobals();
      }
    }
    {
      const a = listening();
      const { view, handle } = provided(
        [readable(a.url)],
        [{ filters: [{ kinds: [1] }], relays: [a.url], settleTimeoutMs: TIMEOUT_MS }]
      );
      try {
        await vi.waitFor(() => expect(a.asked()).toBe(1), { timeout: 3000 });
        readings['the control: the relay the provider has'] = {
          status: handle().state.status === 'error' ? 'error' : 'not refused',
          asked: a.asked()
        };
      } catch (error) {
        readings['the control: the relay the provider has'] = failed(error);
      } finally {
        view.unmount();
        vi.unstubAllGlobals();
      }
    }
    const refused = (configured: boolean) => {
      const error = { code: 'relay-not-in-scope', namesTheRelay: true, configured };
      return {
        status: 'error',
        error,
        lastError: error,
        refreshed: { rejected: 'relay-not-in-scope' }
      };
    };
    const neverAsked = { theProvidersRelay: 0, theNamedRelay: 0 };
    const askedWhileReadable = { theProvidersRelay: 0, theNamedRelay: 1 };
    expect(readings, 'refused before the wire, naming the relay and why').toEqual({
      'a relay the provider does not have': { ...refused(false), asked: neverAsked },
      'a relay the provider has as write-only': { ...refused(true), asked: neverAsked },
      'a relay that leaves the provider': {
        whileReadable: { status: 'loading' },
        ...refused(false),
        asked: askedWhileReadable
      },
      'a relay that becomes write-only': {
        whileReadable: { status: 'loading' },
        ...refused(true),
        asked: askedWhileReadable
      },
      'the control: the relay the provider has': { status: 'not refused', asked: 1 }
    });
  }, 30_000);
});
