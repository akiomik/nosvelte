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
 * so an arm reads the call the provider actually made — selected by the
 * provider's own client, because the relay-scope probe calls the factory too.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { FilledRxNostrConfig, RxNostr, RxNostrConfig } from 'rx-nostr';
import { createRxNostr } from 'rx-nostr';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HarnessOverrides, NostrContext } from '$lib/v1/context.svelte.js';
import { createNostrContext } from '$lib/v1/context.svelte.js';
import { LIBRARY_EOSE_TIMEOUT_MS, MAX_SETTLE_TIMEOUT_MS } from '$lib/v1/normalize.js';

import { propsTypeOf } from './helpers/components.js';
import { consumerDiagnostics } from './helpers/declarations.js';
import { HARNESS_DIVERGENCES, transportOf } from './helpers/relay.js';
import { mount } from './helpers/runes.svelte.js';

interface Built {
  readonly config: Partial<RxNostrConfig>;
  readonly client: RxNostr;
}

/** Every call the wrapped factory saw, in order. */
function handed(): Built[] {
  const holder = globalThis as unknown as Record<symbol, Built[]>;
  const key = Symbol.for('nosvelte:test-transport-configs');
  holder[key] ??= [];
  return holder[key] as Built[];
}

/**
 * The configuration the provider's own client was built from. Exactly one:
 * none would mean the seam had stopped seeing the call, which is how a wrapped
 * factory fails, and it shows here rather than as an `undefined` below.
 */
function configOf(context: NostrContext): Partial<RxNostrConfig> {
  const built = handed().filter((call) => call.client === transportOf(context));
  expect(built, 'the provider built its client through the factory, once').toHaveLength(1);
  return (built[0] as Built).config;
}

vi.mock('rx-nostr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('rx-nostr')>();
  return {
    ...actual,
    createRxNostr: (config?: RxNostrConfig) => {
      const client = actual.createRxNostr(config);
      handed().push({ config: config ?? {}, client });
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
 * A call to the provider's factory with `harness` written as `literal`: the
 * input itself, so a widening at the parameter is read however the named
 * interface stands.
 */
const callErrors = (literal: string): string[] =>
  refusals([
    "import { createNostrContext } from '$lib/v1/context.svelte.js';",
    `export const build = () => createNostrContext({ relays: ['wss://a.example'], harness: ${literal} });`
  ]);

describe('A-γ: the provider owns the upstream EOSE timer', () => {
  beforeEach(() => {
    handed().length = 0;
  });

  // @contracts A-γ-C4
  it('TC1: the transport is handed the library’s EOSE timer, above the settle cap, and no input moves it', () => {
    // **Four readings.** The provider's own call is handed the library's
    // timer, and it is above the largest settle timeout a request may ask for,
    // so the request's timer always ends the backlog first — **with no harness
    // at all**, as the published `NostrApp` builds its provider, and with one.
    // A harness that names a timer anyway — past the type, as a JavaScript
    // caller would — does not win. And no type a caller writes names it: the
    // internal harness, as its interface and as the factory's parameter takes
    // it, and the props of the published `NostrApp`, whose `$props()` is read
    // off the component to be the outlet type asked about.
    // Each is asked of the compiler from here, with a value the type accepts as
    // the control, because a `@ts-expect-error` in this file is read by
    // `npm run check` and not by this arm.
    const observed: Record<string, unknown> = {};
    {
      const { value: context, destroy } = mount(() =>
        createNostrContext({ relays: ['wss://a.example'] })
      );
      observed['handedWithoutAHarness'] = configOf(context).eoseTimeout;
      destroy();
    }
    {
      const { value: context, destroy } = mount(() =>
        createNostrContext({ relays: ['wss://a.example'], harness: HARNESS_DIVERGENCES })
      );
      const config = configOf(context);
      observed['handed'] = config.eoseTimeout;
      observed['aboveTheCap'] = (config.eoseTimeout as number) > MAX_SETTLE_TIMEOUT_MS;
      destroy();
    }
    {
      const { value: context, destroy } = mount(() =>
        createNostrContext({
          relays: ['wss://a.example'],
          harness: { ...HARNESS_DIVERGENCES, eoseTimeout: 20 } as unknown as HarnessOverrides
        })
      );
      const config = configOf(context);
      observed['smuggledPastTheType'] = config.eoseTimeout;
      // The rest of that harness did arrive, so what lost was the timer alone.
      observed['theRestOfThatHarness'] = config.retry;
      destroy();
    }
    const harness = ['$lib/v1/context.svelte.js', 'HarnessOverrides'] as const;
    const props = ['$lib/v1/components/outlets.js', 'Partial<NostrAppProps>'] as const;
    observed['typeErrors'] = {
      harnessNamesTheTimer: typeErrors(...harness, '{ eoseTimeout: 20 }'),
      harnessControl: typeErrors(...harness, '{ okTimeout: 20 }'),
      theFactoryNamesTheTimer: callErrors('{ eoseTimeout: 20 }'),
      theFactoryControl: callErrors('{ okTimeout: 20 }'),
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
        theFactoryControl: [],
        theProvidersPropsAre: 'NostrAppProps',
        propsNameTheTimer: ['excess property eoseTimeout'],
        propsControl: []
      }
    });
  });

  // @contracts A-γ-C6
  it('TC2: the library’s timer is above the one the dependency would have used', () => {
    // **The dependency's default is produced, not restated.** A second client
    // is built from a copy of the provider's own configuration with the timer
    // deleted, so the dependency fills in its own, and that is read off the
    // instance. What this catches that `TC1` cannot is the dependency raising
    // its default, which no edit to this library can stage; the ledger stages
    // it in its copy of the dependency instead.
    // The provider as the published `NostrApp` builds it, with no harness.
    const { value: context, destroy } = mount(() =>
      createNostrContext({ relays: ['wss://a.example'] })
    );
    const config = configOf(context);
    const withoutTheTimer: Partial<RxNostrConfig> = { ...config };
    delete withoutTheTimer.eoseTimeout;
    const counterfactual = createRxNostr(withoutTheTimer);
    const dependencyDefault = (counterfactual as unknown as { config: FilledRxNostrConfig }).config
      .eoseTimeout;
    counterfactual.dispose();
    destroy();
    expect(
      {
        aNumber: typeof dependencyDefault === 'number' && dependencyDefault > 0,
        theLibrarysIsGreater: (config.eoseTimeout as number) > dependencyDefault
      },
      `the library’s ${String(config.eoseTimeout)} against the dependency’s ${String(dependencyDefault)}`
    ).toEqual({ aNumber: true, theLibrarysIsGreater: true });
  });
});
