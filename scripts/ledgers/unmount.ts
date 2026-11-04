/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of what a provider holds and leaves behind, and of the
 * inputs a request is served from, and their landings:
 * - `C6-C3` on `UM2`, with `UM3`: one focus and one online listener while a
 *   provider is mounted, whatever its relays, and none once it has gone;
 * - `C6-C9` on `UM4`, with `UM5`: no collection timer and no entry left by a
 *   provider torn down, its request settled or in flight;
 * - `A15-C3` on `AM1`, with `AM2` to `AM5`: no module reads a client it was
 *   not handed, and none is put where a descendant could take it;
 * - `A-ε-C16` on `SA1`, with `SA2`: a standalone request with no verifier is
 *   refused before a relay is asked;
 * - `C11-C18` on `RX4`: a transport the caller disposed is refused as the
 *   caller's.
 *
 * An id begins with the arm its entry is held to, and each entry names its row
 * in `rows`. Every entry edits the library; `D7-` edits the dependency too,
 * in the ledger's copy of it.
 */
import type { Edit, Ledger } from '../ledger.ts';

const CLIENT = 'src/lib/v1/client.svelte.ts';
const CONTEXT = 'src/lib/v1/context.svelte.ts';
const ENGINE = 'src/lib/v1/useStreamedReq.svelte.ts';
const PROVIDER = 'src/lib/v1/components/NostrApp.svelte';
const STREAM = 'src/lib/v1/stream.ts';
/** The cache of the query-core copy `tanstack-svelte-query-v6` resolves, 5.101.4, as Vitest loads it. */
const QUERY_CACHE =
  'node_modules/tanstack-svelte-query-v6/node_modules/@tanstack/query-core/build/modern/queryCache.js';

/** The token a provider puts in the framework's context, as it ships. */
const TOKEN = "  const token: ProviderToken = Object.freeze({ nosvelte: 'provider' });";
/** The token, carrying `members` beside its tag. */
const tokenWith = (members: string): string =>
  `  const token = Object.freeze({ nosvelte: 'provider', ${members} }) as unknown as ProviderToken;`;
/** The engine's query, created on the client its accessor hands it. */
const CREATED = '  const query = createQuery(queryOptions, ownedClient);';

/** The request's query, created on the client the engine resolved. */
const CREATED_ON_ITS_CLIENT: Edit = {
  file: ENGINE,
  from: '  const query = createQuery(queryOptions, ownedClient);',
  to: '  const query = createQuery(queryOptions);'
};
/** The options the engine hands its query, defaulted by the client it resolved. */
const DEFAULTED_BY_ITS_CLIENT: Edit = {
  file: ENGINE,
  from: '    lastOptions = ownedClient().defaultQueryOptions(built) as typeof built;',
  to: '    lastOptions = built;'
};
/** The refusal of a request with no verifier, in the words that name both ways out. */
const NO_VERIFIER_WORDS =
  "      'nosvelte: this request has no signature verifier, so nothing would check the ' +\n        'events it returns. Either use it inside a `NostrApp` provider, which supplies ' +\n        'one, or pass `verifyEvent` explicitly. Tests that are not about verification ' +\n        'can pass `acceptAnyEvent` from the relay helpers to say so out loud.'";
/** The refusal of a caller's transport that answers no relays, as the stream raises it. */
const NO_USABLE_CLIENT =
  "    throw ownedByLibrary(\n      new InvalidDescriptorError(\n        'rxNostr',\n        'could not be used — this request has no usable client: either none was supplied ' +\n          'with the other owner inputs, or the one supplied has since been disposed'\n      )\n    );";

export default {
  name: 'unmount',
  subject:
    'what a provider holds and leaves behind, and the inputs a request is served from: `C6-C3`, `C6-C9`, `A15-C3`, `A-ε-C16` and `C11-C18`, and their landings',
  files: [
    'src/tests/contracts/engine/unmount.test.ts',
    'src/tests/contracts/engine/ownedclient.test.ts',
    'src/tests/contracts/engine/standalone.test.ts',
    'src/tests/contracts/engine/reach.test.ts'
  ],
  calibration: {
    measured:
      'each arm alone and passing, process start included, one run at a time on a shared 10-core machine, on the tree that added this ledger',
    seconds: {
      UM2: 2.2,
      UM3: 2.4,
      UM4: 2.0,
      UM5: 1.9,
      AM1: 2.1,
      AM2: 2.2,
      AM3: 2.2,
      AM4: 3.0,
      SA1: 1.8,
      AM5: 2.0,
      SA2: 1.6,
      RX4: 2.0
    }
  },
  entries: [
    {
      id: 'UM2-the-client-left-mounted',
      arm: 'UM2',
      requires: ['UM3'],
      rows: ['C6-C3'],
      describe: 'a provider torn down leaves its client mounted, so its two listeners stay',
      edits: [{ file: CLIENT, from: '      client.unmount();\n', to: '' }]
    },
    {
      id: 'UM2-the-client-never-mounted',
      arm: 'UM2',
      requires: ['UM3'],
      rows: ['C6-C3'],
      describe: 'a provider never mounts its client, so it holds no listener while it stands',
      edits: [
        {
          file: CLIENT,
          from: '  $effect(() => {\n    client.mount();\n',
          to: '  $effect(() => {\n'
        }
      ]
    },
    {
      id: 'UM2-a-client-per-relay-list',
      arm: 'UM2',
      requires: ['UM3'],
      rows: ['C6-C3'],
      describe:
        'every relay list a provider accepts mounts a client of its own, which nothing unmounts',
      edits: [
        {
          file: CONTEXT,
          from: "import type { QueryClient } from 'tanstack-svelte-query-v6';",
          to: "import { QueryClient } from 'tanstack-svelte-query-v6';"
        },
        {
          file: CONTEXT,
          from: '      // be found equal.\n      diagnostics.accept();\n',
          to: '      // be found equal.\n      diagnostics.accept();\n      new QueryClient().mount();\n'
        }
      ]
    },
    {
      id: 'UM5-no-release-after-settlement',
      arm: 'UM5',
      rows: ['C6-C9'],
      describe:
        'a provider torn down does not wait for a fetch in flight to settle before it lets the entry go',
      edits: [
        {
          file: CLIENT,
          from: '      for (const query of client.getQueryCache().getAll()) {\n        void query.promise?.finally(() => query.destroy()).catch(() => undefined);\n      }\n',
          to: ''
        }
      ]
    },
    {
      id: 'UM4-no-clear',
      arm: 'UM4',
      requires: ['UM5'],
      rows: ['C6-C9'],
      describe: 'a provider torn down does not clear its cache',
      edits: [{ file: CLIENT, from: '      client.clear();\n', to: '' }]
    },
    {
      id: 'D7-the-removal-keeps-its-timer',
      arm: 'UM4',
      rows: ['C6-C9'],
      describe:
        'the dependency’s cache lets a settled entry go without clearing its collection timer, and the teardown destroys late only the entries with no answer yet, so nothing of the library’s clears it either',
      edits: [
        {
          file: QUERY_CACHE,
          from: '    if (queryInMap) {\n      query.destroy();\n',
          to: '    if (queryInMap) {\n'
        },
        {
          file: CLIENT,
          from: '        void query.promise?.finally(() => query.destroy()).catch(() => undefined);\n',
          to: "        if (query.state.status === 'pending')\n          void query.promise?.finally(() => query.destroy()).catch(() => undefined);\n"
        }
      ]
    },
    {
      id: 'AM1-the-ambient-client-consulted',
      arm: 'AM1',
      requires: ['AM2', 'AM4'],
      rows: ['A15-C3'],
      describe:
        'the request’s query is created and defaulted on whatever client the query library’s own context holds',
      edits: [CREATED_ON_ITS_CLIENT, DEFAULTED_BY_ITS_CLIENT]
    },
    {
      id: 'AM1-the-entry-on-the-ambient-client',
      arm: 'AM1',
      requires: ['AM2', 'AM4'],
      rows: ['A15-C3'],
      describe:
        'the request’s query is created on the ambient client, its options still defaulted by the provider’s',
      edits: [CREATED_ON_ITS_CLIENT]
    },
    {
      id: 'AM2-the-server-turned-on',
      arm: 'AM2',
      requires: ['AM1', 'AM4'],
      rows: ['A15-C3'],
      describe:
        'a request on the server runs on the ambient client, and nothing of the library’s own turns it off',
      edits: [
        CREATED_ON_ITS_CLIENT,
        DEFAULTED_BY_ITS_CLIENT,
        { file: ENGINE, from: "      ...(plan === 'defer' ? { enabled: false } : {}),\n", to: '' }
      ]
    },
    {
      id: 'AM3-the-provider-writes-its-client',
      arm: 'AM3',
      requires: ['AM4'],
      rows: ['A15-C3'],
      describe: 'the provider puts its client in the query library’s own context',
      edits: [
        {
          file: PROVIDER,
          from: "  import { createNostrContext, setNostrContext } from '../context.svelte.js';",
          to: "  import { setQueryClientContext } from 'tanstack-svelte-query-v6';\n  import { createNostrContext, setNostrContext } from '../context.svelte.js';"
        },
        {
          file: PROVIDER,
          from: '  setNostrContext(context);',
          to: '  setNostrContext(context);\n  setQueryClientContext(context.client);'
        }
      ]
    },
    {
      id: 'AM3-the-client-behind-a-deeper-path',
      arm: 'AM3',
      rows: ['A15-C3'],
      describe:
        'the token holds the client in an object it reaches first six levels down and then from the token itself',
      edits: [
        {
          file: CONTEXT,
          from: TOKEN,
          to: `  const services = { client: context.client };\n${tokenWith('debug: { a: { b: { c: { d: { services } } } } }, services')}`
        }
      ]
    },
    {
      id: 'AM3-the-token-resolves-the-context',
      arm: 'AM3',
      rows: ['A15-C3'],
      describe: 'the token carries a resolver of the provider’s context beside the side table',
      edits: [{ file: CONTEXT, from: TOKEN, to: tokenWith('resolve: () => context') }]
    },
    {
      id: 'AM3-the-client-in-a-map',
      arm: 'AM3',
      rows: ['A15-C3'],
      describe: 'the token carries a `Map` that holds the provider’s client',
      edits: [
        { file: CONTEXT, from: TOKEN, to: tokenWith("held: new Map([['client', context.client]])") }
      ]
    },
    {
      id: 'AM1-no-library-defaults',
      arm: 'AM1',
      requires: ['AM2'],
      rows: ['A15-C3'],
      describe: 'the provider’s client carries none of the library’s query defaults',
      edits: [
        {
          file: CLIENT,
          from: '    defaultOptions: { queries: { ...libraryQueryDefaults(environment) } }',
          to: '    defaultOptions: { queries: {} }'
        }
      ]
    },
    {
      id: 'AM4-an-accessor-imported',
      arm: 'AM4',
      rows: ['A15-C3'],
      describe:
        'a module the library ships exports a reader of the ambient client that no request calls',
      edits: [
        {
          file: CONTEXT,
          from: "import type { QueryClient } from 'tanstack-svelte-query-v6';",
          to: "import { type QueryClient, useQueryClient } from 'tanstack-svelte-query-v6';\nexport const ambientClient = (): QueryClient => useQueryClient();"
        }
      ]
    },
    {
      id: 'AM4-a-component-reads-the-query-library-context',
      arm: 'AM4',
      rows: ['A15-C3'],
      describe: 'the provider reads the query library’s own context, and discards what it finds',
      edits: [
        {
          file: PROVIDER,
          from: "  import { createNostrContext, setNostrContext } from '../context.svelte.js';",
          to: "  import { getContext } from 'svelte';\n  import { createNostrContext, setNostrContext } from '../context.svelte.js';"
        },
        {
          file: PROVIDER,
          from: '  setNostrContext(context);',
          to: "  setNostrContext(context);\n  void getContext('$$_queryClient');"
        }
      ]
    },
    {
      id: 'AM4-a-reader-taken-by-element',
      arm: 'AM4',
      rows: ['A15-C3'],
      describe:
        'a module the library ships reads the query library’s context through a namespace of the framework, its reader taken by element',
      edits: [
        {
          file: CONTEXT,
          from: "import { getContext, setContext } from 'svelte';",
          to: "import * as framework from 'svelte';\nimport { getContext, setContext } from 'svelte';\nexport const peek = (): unknown => framework['getContext']('$$_queryClient');"
        }
      ]
    },
    {
      id: 'AM4-an-accessor-that-may-hand-no-client',
      arm: 'AM4',
      requires: ['AM5'],
      rows: ['A15-C3'],
      describe:
        'the engine hands its query no client when a request brings none, so the creator reads the ambient one',
      edits: [
        {
          file: ENGINE,
          from: CREATED,
          to: '  const query = createQuery(\n    queryOptions,\n    runtime.clientOf() === undefined ? undefined : ownedClient\n  );'
        }
      ]
    },
    {
      id: 'AM5-the-missing-client-read-from-context',
      arm: 'AM5',
      rows: ['A15-C3'],
      describe:
        'the engine hands its query the client a request brings, cast to be present, so one that brings none is created on the ambient client',
      edits: [
        {
          file: ENGINE,
          from: CREATED,
          to: '  const query = createQuery(queryOptions, () => runtime.clientOf() as QueryClient);'
        }
      ]
    },
    {
      id: 'SA1-fails-open',
      arm: 'SA1',
      rows: ['A-ε-C16'],
      describe: 'a standalone request with no verifier accepts every event',
      edits: [
        {
          file: ENGINE,
          from: '        verifyEvent: verifyEvent ?? noVerifier(),',
          to: '        verifyEvent: verifyEvent ?? (() => true),'
        }
      ]
    },
    {
      id: 'SA1-refused-on-the-first-invocation-only',
      arm: 'SA1',
      rows: ['A-ε-C16'],
      describe:
        'the refusal is raised once, and every later invocation of the query function accepts every event',
      edits: [
        {
          file: ENGINE,
          from: 'function noVerifier(): never {\n',
          to: 'let refusedOnce = false;\nfunction noVerifier(): never {\n  if (refusedOnce) return (() => true) as never;\n  refusedOnce = true;\n'
        }
      ]
    },
    {
      id: 'SA1-the-refusal-names-neither-way-out',
      arm: 'SA1',
      rows: ['A-ε-C16'],
      describe: 'the refusal says what is missing and neither of the two ways to supply it',
      edits: [
        {
          file: ENGINE,
          from: NO_VERIFIER_WORDS,
          to: "      'nosvelte: this request has no signature verifier, so nothing would check the events it returns.'"
        }
      ]
    },
    {
      id: 'SA1-the-refusal-denies-the-provider',
      arm: 'SA1',
      rows: ['A-ε-C16'],
      describe: 'the refusal names both ways out and denies one of them',
      edits: [
        {
          file: ENGINE,
          from: NO_VERIFIER_WORDS,
          to: "      'nosvelte: this request has no signature verifier. You must pass `verifyEvent` even inside a `NostrApp` provider.'"
        }
      ]
    },
    {
      id: 'SA1-either-way-the-option',
      arm: 'SA1',
      rows: ['A-ε-C16'],
      describe:
        'the refusal offers two ways out in an “either … or”, and both of them ask for the option',
      edits: [
        {
          file: ENGINE,
          from: NO_VERIFIER_WORDS,
          to: "      'nosvelte: this request has no signature verifier. Either pass `verifyEvent` explicitly, or use `NostrApp` and still pass `verifyEvent` explicitly.'"
        }
      ]
    },
    {
      id: 'SA2-the-providers-verifier-not-carried',
      arm: 'SA2',
      rows: ['A-ε-C16'],
      describe: 'a request under a provider is not handed the provider’s verifier',
      edits: [
        {
          file: ENGINE,
          from: '          verifierOf: () => inputs.verifyEvent,',
          to: '          verifierOf: () => undefined,'
        }
      ]
    },
    {
      id: 'RX4-the-disposal-read-as-no-relay',
      arm: 'RX4',
      rows: ['C11-C18'],
      describe:
        'a `refresh()` reads a transport the caller disposed as one with no relay to ask, and resolves rather than rejects',
      edits: [
        {
          file: ENGINE,
          from: "      const asked = requestTargets(transport, request.scope);\n      if (planned === 'defer' || asked.length === 0) {",
          to: "      const asked = safely(() => requestTargets(transport, request.scope)) ?? [];\n      if (planned === 'defer' || asked.length === 0) {"
        }
      ]
    },
    {
      id: 'RX4-the-callers-disposal-told-as-the-providers',
      arm: 'RX4',
      rows: ['C11-C18'],
      describe:
        'a transport the caller disposed is refused as a provider’s disposal, whose remedy is not the caller’s',
      edits: [
        {
          file: STREAM,
          from: "import { ownedByLibrary } from './owned.js';",
          to: "import { providerDisposed } from './own.js';\nimport { ownedByLibrary } from './owned.js';"
        },
        {
          file: STREAM,
          from: NO_USABLE_CLIENT,
          to: "    throw providerDisposed('the provider has been disposed');"
        }
      ]
    }
  ]
} satisfies Ledger;
