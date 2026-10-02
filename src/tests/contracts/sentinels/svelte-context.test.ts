/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * When Svelte's context functions can be called at all.
 *
 * **This directory exists so that a claim about a dependency is measured against
 * the dependency, and this file is the first one where the suite itself was the
 * thing in the way.** `src/tests/setup.ts` replaces `svelte`'s `getContext`,
 * `setContext` and `hasContext` with a process-wide `Map` for every test file in
 * the run. That mock has always documented the *scoping* it diverges on — one
 * map for the process, so no test can show that a descendant finds its own
 * provider. It did not document the *lifecycle* one, which is larger: the real
 * functions are legal in two windows and throw everywhere else, and a `Map` is
 * legal everywhere. Under that mock "may this be called here?" is not a question
 * any test in this repository could ask, let alone get wrong.
 *
 * So this file asks it, through {@link vi.importActual} — which returns the real
 * module rather than the mocked one — and answers it in every window a hook can
 * run code in. The component fixture imports nothing from `svelte` for the same
 * reason: it is handed the real functions and contributes only the *when*.
 *
 * **The positive control is the `init` arm, and it is what makes the negative
 * ones mean anything.** A blind probe and a real prohibition both throw. The
 * `init` arm calls the same imported `setContext`/`getContext` and requires a
 * round trip, so a passing run proves the functions are reachable, that the
 * module `importActual` returned is the same instance the compiled component
 * pushed its context onto, and therefore that a throw anywhere else is about the
 * window and not about the wiring.
 */
import { render } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import ContextWindows from './fixtures/ContextWindows.svelte';

/**
 * The real module, not the one `setup.ts` installed.
 *
 * Under `vite.config.ts`'s test-only `resolve.conditions: ['browser']` this is
 * `svelte/src/index-client.js`. The `default`/`worker` condition resolves to
 * `index-server.js`, whose `getContext` is a different function in a different
 * file — and it guards itself identically, on `ssr_context === null` instead of
 * `component_context === null`. Both were measured directly at 5.56.8, and re-run at the 5.57.1 this tree resolves:
 *
 * ```
 * $ node --input-type=module -e "import {getContext} from 'svelte'; getContext(Symbol())"
 * Error: https://svelte.dev/e/lifecycle_outside_component
 * $ node --conditions browser --input-type=module -e "import {getContext} from 'svelte'; getContext(Symbol())"
 * Error: https://svelte.dev/e/lifecycle_outside_component
 * ```
 *
 * so there is no condition under which the throw is avoidable, and this file
 * therefore does not need to run twice to say so.
 */
const svelte = await vi.importActual<typeof import('svelte')>('svelte');

/**
 * What `lifecycle_outside_component` looks like from outside.
 *
 * Matched on the documentation URL rather than on the code name: the production
 * build of Svelte throws `new Error('https://svelte.dev/e/lifecycle_outside_component')`
 * with no name and no prose at all, and only the DEV build prefixes the code and
 * sets `error.name = 'Svelte error'`. Asserting on the DEV text would make this
 * sentinel a statement about which build the harness resolved.
 */
// **The identifier, wherever the build puts it.** A production build throws
// `new Error('https://svelte.dev/e/lifecycle_outside_component')`; a
// development one reports the identifier on its own line with the prose
// below it. Matching the URL alone pins this arm to one of the two — which
// is what the arms in `lifecycle.test.ts` did until it was measured — so the
// pattern is the identifier, which both forms contain.
const OUTSIDE_COMPONENT = /lifecycle_outside_component/;

describe('svelte context functions outside a component', () => {
  it('DS29: all three throw `lifecycle_outside_component` when nothing is initialising', () => {
    const key = Symbol('sentinel');

    // All three, because the library has a reader written on the belief that
    // they differ: `getNostrContext` chose `getContext` over `hasContext` on the
    // stated grounds that "the two behave differently outside a component — one
    // returns undefined, the other throws". They do not differ. Both reach the
    // same `get_or_init_context_map`, and so does `setContext`.
    expect(() => svelte.getContext(key)).toThrow(OUTSIDE_COMPONENT);
    expect(() => svelte.hasContext(key)).toThrow(OUTSIDE_COMPONENT);
    expect(() => svelte.setContext(key, 1)).toThrow(OUTSIDE_COMPONENT);
  });
});

/** One window's answer: what the call did, rather than what it returned. */
type Attempt =
  | { readonly kind: 'threw'; readonly message: string }
  | { readonly kind: 'returned'; readonly value: unknown };

const attempt = (fn: () => unknown): Attempt => {
  try {
    return { kind: 'returned', value: fn() };
  } catch (error) {
    return { kind: 'threw', message: error instanceof Error ? error.message : String(error) };
  }
};

describe('svelte context functions inside a component', () => {
  it('DS30: legal during initialisation and inside an effect, illegal in a handler or a later task', async () => {
    const key = Symbol('sentinel');
    const windows: Record<string, Attempt> = {};

    const { getByRole } = render(ContextWindows, {
      // The positive control. If this throws, or round-trips nothing, then the
      // module under `importActual` is not the one the component pushed to and
      // every other arm below is measuring a broken import instead of a window.
      atInit: () => {
        windows['init'] = attempt(() => {
          svelte.setContext(key, 'set at init');
          return svelte.getContext(key);
        });
      },
      // `update_reaction` saves `component_context`, sets it to the reaction's
      // own `ctx` and restores it (`internal/client/runtime.js`), and a reaction
      // created during initialisation captured the component's. So an effect is
      // the *second* legal window, and this is the arm that says the rule is
      // "initialisation or a reaction" rather than "initialisation".
      inEffect: () => {
        windows['effect'] = attempt(() => svelte.getContext(key));
      },
      // The arm this sentinel was written for. A click handler runs from the
      // DOM, under no `push()` and inside no reaction.
      inHandler: () => {
        windows['handler'] = attempt(() => svelte.getContext(key));
      },
      // The same fact one turn later: anything an initialisation *scheduled* has
      // left the window by the time it runs, which is the shape every async
      // continuation has — a query function past its first `await` included.
      laterInATask: () => {
        windows['task'] = attempt(() => svelte.getContext(key));
      }
    });

    getByRole('button').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(windows['init']).toEqual({ kind: 'returned', value: 'set at init' });
    expect(windows['effect']).toEqual({ kind: 'returned', value: 'set at init' });
    expect(windows['handler']?.kind).toBe('threw');
    expect((windows['handler'] as { message: string }).message).toMatch(OUTSIDE_COMPONENT);
    expect(windows['task']?.kind).toBe('threw');
    expect((windows['task'] as { message: string }).message).toMatch(OUTSIDE_COMPONENT);
  });
});
