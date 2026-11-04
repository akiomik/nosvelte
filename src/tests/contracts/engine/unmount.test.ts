/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Unmount, and what a provider leaves behind: the landings of `C6-C3` (`UM2`
 * and `UM3`, with `UM1` the instrument's control) and `C6-C9` (`UM4` and
 * `UM5`).
 *
 * **Through the published entry**: `NostrApp` with `relays` only and a
 * consumer's own `useReq` under it (`fixtures/PublishedRequest.svelte`). The
 * rows are `internal` because what they read is the dependency's and the
 * host's, not anything a consumer is handed.
 *
 * Port band 10700-10779.
 */
import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import { focusManager, onlineManager, QueryClient } from 'tanstack-svelte-query-v6';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { NostrContext } from '$lib/v1/context.svelte.js';
import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';

import MountedRequest from './fixtures/MountedRequest.svelte';
import PublishedRequest from './fixtures/PublishedRequest.svelte';
import { type Relay, relayAt, urlsFrom } from './helpers/request.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.unstubAllGlobals();
  WS.clean();
});

const nextUrl = urlsFrom(10700);

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A wait long enough for a mount, a relay change or a teardown to have run its effects. */
const A_TURN_MS = 100;

/** A request that ends, far from its deadline in every reading here. */
const plan = (): ReqPlan => ({
  kind: 'request',
  descriptor: { filters: [{ kinds: [1] }], settleTimeoutMs: 30_000 }
});

/**
 * **The listeners a manager of the dependency holds, read off the set it keeps
 * them in.** A count of `subscribe` calls would miss a subscription taken
 * through a reference held from before the count began; the set holds every
 * listener however it was added. It is the dependency's own field and not its
 * published surface, so the form is checked rather than assumed: anything but
 * a `Set` refuses the reading.
 */
const listenersOf = (manager: object): number => {
  const held = (manager as { listeners?: unknown }).listeners;
  if (!(held instanceof Set)) {
    throw new Error('nosvelte test: the dependency keeps its listeners in no Set this arm reads');
  }
  return held.size;
};

/** The focus and online listeners held now. */
const listeners = () => ({ focus: listenersOf(focusManager), online: listenersOf(onlineManager) });

/** `count` more of each than `base`. */
const more = (base: ReturnType<typeof listeners>, count: number) => ({
  focus: base.focus + count,
  online: base.online + count
});

/** A consumer's own request on `relays`, under the published entry. */
function consumerOn(relays: readonly string[]) {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  return render(PublishedRequest, {
    relays,
    plan,
    seen: () => {},
    published: () => {}
  });
}

describe('C6-C3: a provider holds one focus and one online listener while it is mounted, whatever its relays, and none once it has gone', () => {
  it('UM1: the instrument reads the managers a client subscribes to: a client mounted by hand is counted, and unmounted is not', () => {
    const base = listeners();
    const client = new QueryClient();
    client.mount();
    const mounted = listeners();
    client.unmount();
    expect({ mounted, after: listeners() }).toEqual({ mounted: more(base, 1), after: base });
  });

  // @contracts C6-C3
  it('UM2: one provider whose relays change four times, then torn down', async () => {
    const a = relayAt(nextUrl());
    const b = relayAt(nextUrl());
    const base = listeners();
    const view = consumerOn([a.url]);
    await delay(A_TURN_MS);
    const readings: Record<string, ReturnType<typeof listeners>> = { mounted: listeners() };
    for (const [name, relays] of [
      ['moved to b', [b.url]],
      ['both', [a.url, b.url]],
      ['none', []],
      ['back to a', [a.url]]
    ] as const) {
      await view.rerender({ relays });
      await delay(A_TURN_MS);
      readings[name] = listeners();
    }
    view.unmount();
    await delay(A_TURN_MS);
    readings['torn down'] = listeners();
    expect(readings).toEqual({
      mounted: more(base, 1),
      'moved to b': more(base, 1),
      both: more(base, 1),
      none: more(base, 1),
      'back to a': more(base, 1),
      'torn down': base
    });
  });

  it('UM3: three providers mounted and torn down in turn, each moving its relays once', async () => {
    const a = relayAt(nextUrl());
    const b = relayAt(nextUrl());
    const base = listeners();
    const readings: string[] = [];
    for (const each of [1, 2, 3]) {
      const view = consumerOn([a.url]);
      await delay(A_TURN_MS);
      await view.rerender({ relays: [b.url] });
      await delay(A_TURN_MS);
      readings.push(`provider ${String(each)} mounted: ${JSON.stringify(listeners())}`);
      view.unmount();
      await delay(A_TURN_MS);
      readings.push(`provider ${String(each)} gone: ${JSON.stringify(listeners())}`);
    }
    const once = JSON.stringify(more(base, 1));
    const none = JSON.stringify(base);
    expect(readings).toEqual(
      [1, 2, 3].flatMap((each) => [
        `provider ${String(each)} mounted: ${once}`,
        `provider ${String(each)} gone: ${none}`
      ])
    );
  });
});

/**
 * **Every timer armed on the host from the call on, and which of them are
 * still armed**: `setTimeout` and `clearTimeout` wrapped, each timer kept until
 * it is cleared or has fired. The dependency arms its collection timers through
 * a provider that calls the global `setTimeout` when it arms one, so a wrapper
 * put on before the provider mounts sees each of them.
 */
function hostTimers() {
  const setTimeoutOf = globalThis.setTimeout;
  const clearTimeoutOf = globalThis.clearTimeout;
  const armed = new Map<unknown, number>();
  vi.stubGlobal(
    'setTimeout',
    (callback: (...args: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
      const id: unknown = setTimeoutOf(() => {
        armed.delete(id);
        callback(...rest);
      }, ms);
      armed.set(id, ms ?? 0);
      return id;
    }
  );
  vi.stubGlobal('clearTimeout', (id: unknown) => {
    armed.delete(id);
    clearTimeoutOf(id as Parameters<typeof clearTimeout>[0]);
  });
  return {
    /** The timers armed now for `ms` exactly. */
    armedFor: (ms: number): number => [...armed.values()].filter((each) => each === ms).length
  };
}

/** How long the provider's client keeps an unobserved entry: its own default, read off it. */
const windowOf = (context: NostrContext): number => {
  const gcTime = context.client.getDefaultOptions().queries?.gcTime;
  if (typeof gcTime !== 'number' || !Number.isFinite(gcTime)) {
    throw new Error(`nosvelte test: the provider's collection window was ${String(gcTime)}`);
  }
  return gcTime;
};

/**
 * A consumer's own request on `relay` under the published entry, mounted while
 * `mounted` is set, with the provider's context handed over before it exists
 * and the timers on the host counted from before the provider mounts.
 */
function providedOn(relay: Relay) {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  const timers = hostTimers();
  let context: NostrContext | undefined;
  let handle: ReqHandle | undefined;
  const view = render(MountedRequest, {
    relays: [relay.url],
    plan,
    mounted: true,
    seen: (held: ReqHandle) => {
      handle = held;
    },
    ready: (held: NostrContext) => {
      context = held;
    }
  });
  return {
    view,
    timers,
    context: () => context as NostrContext,
    handle: () => handle as ReqHandle
  };
}

/**
 * Until `done` holds, for at most three seconds of real time. **It does not
 * throw**: a premise that never came to hold is read where the claim is, in
 * the arm's one reading, rather than as a wait that ran out.
 */
const until = (done: () => boolean): Promise<void> =>
  vi.waitFor(() => expect(done()).toBe(true), { timeout: 3000 }).catch(() => undefined);

/**
 * How long a teardown is given to settle before anything is counted: the
 * cancellation that follows it, and a collection timer the dependency arms from
 * the settlement.
 */
const SETTLE_AFTER_TEARDOWN_MS = 500;

describe('C6-C9: a provider torn down leaves no collection timer of its client armed and no entry in its cache, a request under it settled or in flight', () => {
  // @contracts C6-C9
  it('UM4: settled', async () => {
    const relay = relayAt(nextUrl());
    const one = providedOn(relay);
    await until(() => relay.asked('backward').length === 1);
    relay.answerBacklog();
    await until(() => one.handle().state.status === 'settled');
    const window = windowOf(one.context());
    // **The instrument's control**: the dependency arms an entry's collection
    // timer once a fetch has settled, observed or not, and reads whether to
    // collect when it fires. So the settled request's own is counted here.
    const before = {
      asked: relay.asked('backward').length,
      status: one.handle().state.status,
      armed: one.timers.armedFor(window),
      entries: one.context().client.getQueryCache().getAll().length
    };
    one.view.unmount();
    await delay(SETTLE_AFTER_TEARDOWN_MS);
    expect({
      before,
      after: {
        armed: one.timers.armedFor(window),
        entries: one.context().client.getQueryCache().getAll().length
      }
    }).toEqual({
      before: { asked: 1, status: 'settled', armed: 1, entries: 1 },
      after: { armed: 0, entries: 0 }
    });
  });

  it('UM5: in flight', async () => {
    const relay = relayAt(nextUrl());
    const one = providedOn(relay);
    await until(() => relay.asked('backward').length === 1);
    const window = windowOf(one.context());
    const before = {
      asked: relay.asked('backward').length,
      status: one.handle().state.status,
      entries: one.context().client.getQueryCache().getAll().length
    };
    one.view.unmount();
    await delay(SETTLE_AFTER_TEARDOWN_MS);
    expect({
      before,
      after: {
        armed: one.timers.armedFor(window),
        entries: one.context().client.getQueryCache().getAll().length
      }
    }).toEqual({
      before: { asked: 1, status: 'loading', entries: 1 },
      after: { armed: 0, entries: 0 }
    });
  });
});
