/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The provider owns the upstream EOSE timer: the landings of `A-γ-C4` (`TC1`)
 * and `A-γ-C6` (`TC2`).
 *
 * **The value is read where it crosses into the dependency.** `rx-nostr`'s
 * factory is wrapped for this file alone: it delegates to the real one and
 * records the configuration it was handed together with the client it built,
 * and counts each subscription made through that client. So an arm reads the
 * call whose client a request the provider runs is subscribed through — not
 * the client the provider's context names, which a provider could keep while
 * running its requests on another, and not the relay-scope probe's, which
 * calls the factory too and runs no request (#177).
 *
 * Port band 10400-10419.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type { FilledRxNostrConfig, RxNostr, RxNostrConfig } from 'rx-nostr';
import { createRxNostr } from 'rx-nostr';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { HarnessOverrides } from '$lib/v1/context.svelte.js';
import type { ReqPlan } from '$lib/v1/index.js';
import { LIBRARY_EOSE_TIMEOUT_MS, MAX_SETTLE_TIMEOUT_MS } from '$lib/v1/normalize.js';

import HarnessedRequest from './fixtures/HarnessedRequest.svelte';
import PublishedRequest from './fixtures/PublishedRequest.svelte';
import { propsTypeOf } from './helpers/components.js';
import { consumerDiagnostics } from './helpers/declarations.js';
import { HARNESS_DIVERGENCES } from './helpers/relay.js';
import { urlsFrom } from './helpers/request.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.unstubAllGlobals();
  WS.clean();
});

const nextUrl = urlsFrom(10400);

interface Built {
  readonly config: Partial<RxNostrConfig>;
  readonly client: RxNostr;
  /** The subscriptions made through the client. */
  used: number;
}

/** Every call the wrapped factory saw, in order. */
function handed(): Built[] {
  const holder = globalThis as unknown as Record<symbol, Built[]>;
  const key = Symbol.for('nosvelte:test-transport-configs');
  holder[key] ??= [];
  return holder[key] as Built[];
}

/**
 * The configuration of the client a request is run on, under a provider built
 * with `harness`, or with none — and with none, the provider is the published
 * `NostrApp` itself (`PublishedRequest`), so the reading is of the factory call
 * it makes, whatever it does around it. One request is made under it, on a
 * relay that is listening, and once the relay has been asked, exactly one
 * client built through the factory has been subscribed through. None would
 * mean the seam had stopped seeing the call, which is how a wrapped factory
 * fails, and it shows here rather than as an `undefined` below.
 */
async function configRunOn(harness: HarnessOverrides | undefined): Promise<Partial<RxNostrConfig>> {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  const url = nextUrl();
  const relay = new WS(url, { jsonProtocol: true });
  const plan = (): ReqPlan => ({ kind: 'request', descriptor: { filters: [{ kinds: [1] }] } });
  const view =
    harness === undefined
      ? render(PublishedRequest, { relays: [url], plan, seen: () => {}, published: () => {} })
      : render(HarnessedRequest, { relays: [url], harness, plan, ready: () => {}, seen: () => {} });
  try {
    await vi.waitFor(
      () =>
        expect(
          (relay.messages as unknown[][]).some((frame) => frame[0] === 'REQ'),
          'the request was asked of its relay'
        ).toBe(true),
      { timeout: 3000 }
    );
    const subscribed = handed().filter((call) => call.used > 0);
    expect(subscribed, 'one client built through the factory runs the request').toHaveLength(1);
    return (subscribed[0] as Built).config;
  } finally {
    view.unmount();
    vi.unstubAllGlobals();
  }
}

vi.mock('rx-nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('rx-nostr')>();
  return {
    ...actual,
    createRxNostr: (config?: RxNostrConfig) => {
      const client = actual.createRxNostr(config);
      const built: Built = { config: config ?? {}, client, used: 0 };
      const use = client.use.bind(client);
      client.use = ((...args: Parameters<RxNostr['use']>) => {
        built.used += 1;
        return use(...args);
      }) as RxNostr['use'];
      handed().push(built);
      return client;
    }
  };
});

/**
 * What the compiler reports for a consumer's `source`, each diagnostic read as
 * the property it refuses: an excess property is `2353`, or `2561` when the
 * compiler can suggest a near spelling, and which of the two it picks is the
 * compiler's business rather than this row's.
 */
const refusals = (source: readonly string[]): string[] =>
  consumerDiagnostics([...source, ''].join('\n')).map((diagnostic) =>
    diagnostic.code === 2353 || diagnostic.code === 2561
      ? `excess property ${/'(\w+)'/.exec(diagnostic.message)?.[1] ?? '?'}`
      : `TS${String(diagnostic.code)}: ${diagnostic.message}`
  );

/** A value of `type`, imported from `module`, written as `literal`. */
const typeErrors = (module: string, type: string, literal: string): string[] =>
  refusals([
    `import type { ${type.replace(/^Partial<|>$/g, '')} } from '${module}';`,
    `export const value: ${type} = ${literal};`
  ]);

/**
 * A call to the provider's factory with `extra` written among its options: the
 * input itself, so a widening at the parameter is read however the named
 * interface stands — the timer as an option of its own, or inside `harness`.
 */
const callErrors = (extra: string): string[] =>
  refusals([
    "import { createNostrContext } from '$lib/v1/context.svelte.js';",
    `export const build = () => createNostrContext({ relays: ['wss://a.example'], ${extra} });`
  ]);

describe('A-γ: the provider owns the upstream EOSE timer', () => {
  beforeEach(() => {
    handed().length = 0;
  });

  // @contracts A-γ-C4
  it('TC1: the transport is handed the library’s EOSE timer, above the settle cap, and no input moves it', async () => {
    // **Four readings.** The call whose client a request runs on is handed the
    // library's timer, and it is above the largest settle timeout a request may ask for,
    // so the request's timer always ends the backlog first — **with no harness
    // at all**, as the published `NostrApp` builds its provider, and with one.
    // A harness that names a timer anyway — past the type, as a JavaScript
    // caller would — does not win. And no type a caller writes at the provider
    // names it: the internal harness as its interface, the factory's options
    // and the harness inside them as a caller's call meets them, and the props
    // of the published `NostrApp`, whose `$props()` is read off the component
    // to be the outlet type asked about.
    // Each is asked of the compiler from here, with a value the type accepts as
    // the control, because a `@ts-expect-error` in this file is read by
    // `npm run check` and not by this arm.
    const observed: Record<string, unknown> = {};
    observed['handedWithoutAHarness'] = (await configRunOn(undefined)).eoseTimeout;
    handed().length = 0;
    {
      const config = await configRunOn(HARNESS_DIVERGENCES);
      observed['handed'] = config.eoseTimeout;
      observed['aboveTheCap'] = (config.eoseTimeout as number) > MAX_SETTLE_TIMEOUT_MS;
    }
    handed().length = 0;
    {
      const config = await configRunOn({
        ...HARNESS_DIVERGENCES,
        eoseTimeout: 20
      } as unknown as HarnessOverrides);
      observed['smuggledPastTheType'] = config.eoseTimeout;
      // The rest of that harness did arrive, so what lost was the timer alone.
      observed['theRestOfThatHarness'] = config.retry;
    }
    const harness = ['$lib/v1/context.svelte.js', 'HarnessOverrides'] as const;
    const props = ['$lib/v1/components/outlets.js', 'Partial<NostrAppProps>'] as const;
    observed['typeErrors'] = {
      harnessNamesTheTimer: typeErrors(...harness, '{ eoseTimeout: 20 }'),
      harnessControl: typeErrors(...harness, '{ okTimeout: 20 }'),
      theFactoryNamesTheTimer: callErrors('eoseTimeout: 20'),
      theFactorysHarnessNamesTheTimer: callErrors('harness: { eoseTimeout: 20 }'),
      theFactoryControl: callErrors('harness: { okTimeout: 20 }'),
      theProvidersPropsAre: propsTypeOf(
        readFileSync(resolve(process.cwd(), 'src/lib/v1/components/NostrApp.svelte'), 'utf8')
      ),
      propsNameTheTimer: typeErrors(...props, '{ eoseTimeout: 20 }'),
      propsControl: typeErrors(...props, "{ relays: ['wss://a.example'] }")
    };
    expect(observed, 'the library’s timer, above the cap, whatever a caller passes').toEqual({
      handedWithoutAHarness: LIBRARY_EOSE_TIMEOUT_MS,
      handed: LIBRARY_EOSE_TIMEOUT_MS,
      aboveTheCap: true,
      smuggledPastTheType: LIBRARY_EOSE_TIMEOUT_MS,
      theRestOfThatHarness: { strategy: 'off' },
      typeErrors: {
        harnessNamesTheTimer: ['excess property eoseTimeout'],
        harnessControl: [],
        theFactoryNamesTheTimer: ['excess property eoseTimeout'],
        theFactorysHarnessNamesTheTimer: ['excess property eoseTimeout'],
        theFactoryControl: [],
        theProvidersPropsAre: 'NostrAppProps',
        propsNameTheTimer: ['excess property eoseTimeout'],
        propsControl: []
      }
    });
  });

  // @contracts A-γ-C6
  it('TC2: the library’s timer is above the one the dependency would have used', async () => {
    // **The dependency's default is produced, not restated.** A second client
    // is built from a copy of the provider's own configuration with the timer
    // deleted, so the dependency fills in its own, and that is read off the
    // instance. What this catches that `TC1` cannot is the dependency raising
    // its default, which no edit to this library can stage; the ledger stages
    // it in its copy of the dependency instead.
    // The provider as the published `NostrApp` builds it, with no harness, and
    // the client a request it runs is run on.
    const config = await configRunOn(undefined);
    const withoutTheTimer: Partial<RxNostrConfig> = { ...config };
    delete withoutTheTimer.eoseTimeout;
    const counterfactual = createRxNostr(withoutTheTimer);
    const dependencyDefault = (counterfactual as unknown as { config: FilledRxNostrConfig }).config
      .eoseTimeout;
    counterfactual.dispose();
    expect(
      {
        aNumber: typeof dependencyDefault === 'number' && dependencyDefault > 0,
        theLibrarysIsGreater: (config.eoseTimeout as number) > dependencyDefault
      },
      `the library’s ${String(config.eoseTimeout)} against the dependency’s ${String(dependencyDefault)}`
    ).toEqual({ aNumber: true, theLibrarysIsGreater: true });
  });
});
