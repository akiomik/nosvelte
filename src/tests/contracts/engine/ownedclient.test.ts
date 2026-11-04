/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The client a provider owns, and the one a consumer owns above it: the
 * landing of `A15-C3` (`AM1`, with `AM2`–`AM5`). `AM5` alone is on the
 * standalone seam (`0002` A16), since only a request that brings its own
 * inputs can bring every one but the client.
 *
 * **Through the published entry**: the dependency's own `QueryClientProvider`
 * around `NostrApp` with `relays` only, and a consumer's `useReq` under it
 * (`fixtures/AmbientClient.svelte`), which is the arrangement a consumer
 * writes. The row is `internal` because what it reads is the provider's cache,
 * the framework's context and the library's source, none of which a consumer
 * is handed.
 *
 * Port band 10800-10839.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import { parse } from 'svelte/compiler';
import { type QueryClient as Client, QueryClient } from 'tanstack-svelte-query-v6';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { createAttemptRegistry } from '$lib/v1/attempt.js';
import type { NostrContext } from '$lib/v1/context.svelte.js';
import { libraryQueryDefaults } from '$lib/v1/engine.js';
import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
import type { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import AmbientCallerOwned from './fixtures/AmbientCallerOwned.svelte';
import AmbientClient from './fixtures/AmbientClient.svelte';
import type { Walked } from './fixtures/ContextWalker.svelte';
import PlantedWalk from './fixtures/PlantedWalk.svelte';
import { acceptAnyEvent, createTestRelay } from './helpers/relay.js';
import { relayAt, urlsFrom } from './helpers/request.js';

// The framework's own context, which is what a consumer's provider writes to
// and what a descendant enumerates — not the setup's stand-in, which has no
// `getAllContexts`.
vi.unmock('svelte');

afterEach(() => {
  vi.unstubAllGlobals();
  WS.clean();
});

const nextUrl = urlsFrom(10800);

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** A wait long enough for a request to have put what it asks on the wire. */
const A_TURN_MS = 200;

/** A request that ends, far from its deadline in every reading here. */
const plan = (): ReqPlan => ({
  kind: 'request',
  descriptor: { filters: [{ kinds: [1] }], settleTimeoutMs: 30_000 }
});

/**
 * **A consumer's own client that disagrees with the provider's on every option
 * an entry carries**, on both layers a consumer can reach — its defaults and
 * the defaults for the prefix this library's entries live under, which are
 * separate inputs to the dependency's fold. `enabled` is the one that decides
 * whether a request runs, so it is the caller's to set.
 */
function consumerClient(enabled: boolean): Client {
  const disagreeing = {
    enabled,
    retry: 5,
    gcTime: 1234,
    staleTime: 99,
    networkMode: 'online' as const,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    refetchInterval: 60_000
  };
  const client = new QueryClient({ defaultOptions: { queries: disagreeing } });
  client.setQueryDefaults(['nosvelte'], disagreeing);
  return client;
}

/**
 * Every notification a client's caches make from the call on, so "untouched"
 * is read as nothing having happened there rather than as nothing being left.
 */
function notificationsOf(client: Client): () => number {
  let count = 0;
  client.getQueryCache().subscribe(() => {
    count += 1;
  });
  client.getMutationCache().subscribe(() => {
    count += 1;
  });
  return () => count;
}

/**
 * The published entry on `relay`, under `consumer`'s query provider when one
 * is given, with the provider's context handed over before the request exists.
 * On `'server'` the host's `window` is taken away while it is built, which is
 * what the provider reads to decide its side; it is put back once the tree is
 * built.
 */
function provided(
  relay: { url: string },
  side: 'browser' | 'server',
  consumer?: Client,
  walked?: (report: Walked) => void
) {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  let context: NostrContext | undefined;
  let handle: ReqHandle | undefined;
  const host = globalThis.window;
  if (side === 'server') vi.stubGlobal('window', undefined);
  try {
    const view = render(AmbientClient, {
      consumer,
      relays: [relay.url],
      plan,
      seen: (held: ReqHandle) => {
        handle = held;
      },
      ready: (held: NostrContext) => {
        context = held;
      },
      walked
    });
    return {
      view,
      context: () => context as NostrContext,
      handle: () => handle as ReqHandle
    };
  } finally {
    if (side === 'server') vi.stubGlobal('window', host);
  }
}

/**
 * The options the entry runs with, read off the dependency's own entry, for
 * every option the library defaults on that side: the ones that arrived, and
 * the whole list beside them. **Against the library's defaults and not the
 * provider client's own**, since a client built with none would carry all of
 * its own and none of this library's.
 */
function carried(context: NostrContext, side: 'browser' | 'server') {
  const defaults = libraryQueryDefaults(side) as Record<string, unknown>;
  const [entry] = context.client.getQueryCache().getAll();
  const options = (entry?.options ?? {}) as Record<string, unknown>;
  return {
    arrived: Object.keys(defaults).filter((name) => Object.is(options[name], defaults[name])),
    defaults: Object.keys(defaults)
  };
}

describe('A15-C3: a request runs on the provider’s client with its defaults, and a consumer’s client above the provider can neither start it nor stop it', () => {
  // @contracts A15-C3
  it('AM1: on the browser, under a consumer’s client that turns every query off', async () => {
    const relay = relayAt(nextUrl());
    const consumer = consumerClient(false);
    const touched = notificationsOf(consumer);
    const one = provided(relay, 'browser', consumer);
    try {
      await delay(A_TURN_MS);
      const { arrived, defaults } = carried(one.context(), 'browser');
      expect({
        side: one.context().environment,
        asked: relay.asked('backward').length,
        entries: one.context().client.getQueryCache().getAll().length,
        arrived,
        consumer: { entries: consumer.getQueryCache().getAll().length, notifications: touched() }
      }).toEqual({
        side: 'browser',
        asked: 1,
        entries: 1,
        arrived: defaults,
        consumer: { entries: 0, notifications: 0 }
      });
    } finally {
      one.view.unmount();
    }
  });

  it('AM2: on the server, under a consumer’s client that turns every query on', async () => {
    const relay = relayAt(nextUrl());
    const consumer = consumerClient(true);
    const touched = notificationsOf(consumer);
    const one = provided(relay, 'server', consumer);
    try {
      await delay(A_TURN_MS);
      const { arrived, defaults } = carried(one.context(), 'server');
      const [entry] = one.context().client.getQueryCache().getAll();
      expect({
        side: one.context().environment,
        // **Whether the query function ever ran**, read off the entry rather
        // than off the wire: a provider on a server owns no transport, so a
        // request turned on there asks nothing either way, and is refused.
        ran: {
          fetching: entry?.state.fetchStatus,
          answered: entry?.state.dataUpdateCount,
          failed: entry?.state.errorUpdateCount,
          failures: entry?.state.fetchFailureCount
        },
        status: one.handle().state.status,
        entries: one.context().client.getQueryCache().getAll().length,
        arrived,
        consumer: { entries: consumer.getQueryCache().getAll().length, notifications: touched() }
      }).toEqual({
        side: 'server',
        ran: { fetching: 'idle', answered: 0, failed: 0, failures: 0 },
        status: 'loading',
        entries: 1,
        arrived: defaults,
        consumer: { entries: 0, notifications: 0 }
      });
    } finally {
      one.view.unmount();
    }
  });

  it('AM3: a descendant that imports no key finds a consumer’s client through the framework’s context, and never the provider’s', async () => {
    const reports: Record<string, unknown> = {};
    // **The walk's own control**, with no library in the tree: a value that
    // holds a client each way a walk can miss one — reached first deep down
    // and then from the value itself, behind a closure, in a `Map`'s slots,
    // in a class's private field, and behind a member that throws when read.
    // The first is found, and each of the others is reported where it is.
    const planted = new QueryClient();
    const services = { client: planted };
    let control: Walked | undefined;
    render(PlantedWalk, {
      planted: {
        nosvelte: 'provider',
        debug: { a: { b: { c: { d: { services } } } } },
        services,
        resolve: () => planted,
        held: new Map([['client', planted]]),
        boxed: new (class Boxed {
          readonly #client = planted;
          client(): Client {
            return this.#client;
          }
        })(),
        get refusing(): never {
          throw new Error('nosvelte test: not to be read');
        }
      },
      walked: (report: Walked) => {
        control = report;
      }
    }).unmount();
    reports['the walk’s control'] = {
      clients: control?.clients.length,
      thePlanted: control?.clients.includes(planted),
      unlooked: control?.unlooked
    };
    for (const [name, consumer] of [
      ['under a consumer’s client', new QueryClient()],
      ['under none', undefined]
    ] as const) {
      const relay = relayAt(nextUrl());
      let walked: Walked | undefined;
      const one = provided(relay, 'browser', consumer, (report) => {
        walked = report;
      });
      await delay(A_TURN_MS);
      const found = walked as Walked;
      reports[name] = {
        // **The instrument's controls**: the provider put something in the
        // map and the walk reached it, so an empty answer is about a graph
        // that was walked.
        walkedSomething: found.entries > 0 && found.objects > 0,
        clients: found.clients.length,
        theConsumers: consumer !== undefined && found.clients.includes(consumer),
        theProviders: found.clients.includes(one.context().client),
        unlooked: found.unlooked
      };
      one.view.unmount();
    }
    expect(reports).toEqual({
      'the walk’s control': {
        clients: 1,
        thePlanted: true,
        unlooked: [
          'Symbol(planted).resolve',
          'Symbol(planted).held',
          'Symbol(planted).boxed',
          'Symbol(planted).refusing'
        ]
      },
      'under a consumer’s client': {
        walkedSomething: true,
        clients: 1,
        theConsumers: true,
        theProviders: false,
        unlooked: []
      },
      'under none': {
        walkedSomething: true,
        clients: 0,
        theConsumers: false,
        theProviders: false,
        unlooked: []
      }
    });
  });
});

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const LIB = resolve(ROOT, 'src/lib/v1');

/** The query library, in each copy this repository resolves, and the core both build on. */
const QUERY_LIBRARY =
  /\/node_modules\/(?:.*\/)?(?:tanstack-svelte-query-v6|@tanstack\/svelte-query|@tanstack\/query-core)\//;

/** The specifiers a module can name the query library by. */
const QUERY_SPECIFIER =
  /^(?:tanstack-svelte-query-v6|@tanstack\/svelte-query|@tanstack\/query-core)(?:\/|$)/;

/** The framework's context readers. */
const CONTEXT_READERS = new Set(['getContext', 'hasContext', 'getAllContexts']);

/** Every file of the library, relative to it. */
function libraryFiles(): string[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(join(LIB, directory), { withFileTypes: true })) {
      const name = directory === '' ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory()) walk(name);
      else files.push(name);
    }
  };
  walk('');
  return files;
}

/** The repository's own options, so `$lib` resolves as the library's build resolves it. */
const CHECKER_OPTIONS: ts.CompilerOptions = {
  ...ts.parseJsonConfigFileContent(
    ts.readConfigFile(join(ROOT, 'tsconfig.json'), (name) => ts.sys.readFile(name)).config,
    ts.sys,
    ROOT
  ).options,
  noEmit: true
};

/**
 * **Where the library could read a client it was not handed**, over every
 * module it ships, as four lists:
 *
 * - `named`: each name of the query library a module refers to, resolved by
 *   the type checker to the declaration it binds — so an alias, a namespace
 *   member or a re-export is the name it came in as, and a local that shadows
 *   one is not it. Read against an allow-list, because the names that read the
 *   ambient context are not one spelling: the accessors do, and so does every
 *   creator left without a client.
 * - `unnamedClient`: each reference to `createQuery` that is not a call
 *   handing it a client — it reads the ambient context when the second
 *   argument is left out, and when the one given is typed to admit no client:
 *   `undefined`, or an accessor whose return type admits it.
 * - `contextReads`: each call to the framework's context readers, with what it
 *   asks for: the library's own key, or anything else — a consumer's client
 *   sits in that same context under the query library's key. A namespace of
 *   the framework that carries a reader is every reader at once, whichever way
 *   a member is then taken from it, so each reference to one is reported as
 *   `*`.
 * - `dynamic`: each `import()`, which no binding above would see.
 *
 * A component is read by its syntax alone, since the checker is not handed
 * `.svelte` files: each import it takes from the query library or a context
 * reader, and each `import()`. `virtual` holds the text of a module that is
 * not on disk, for the control.
 */
function ambientReads(virtual: ReadonlyMap<string, string> = new Map()) {
  const files = libraryFiles();
  const roots = [
    ...files.filter((name) => name.endsWith('.ts')).map((name) => join(LIB, name)),
    ...virtual.keys()
  ];
  const host = ts.createCompilerHost(CHECKER_OPTIONS, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  host.getSourceFile = (name, language, ...rest) => {
    const text = virtual.get(name);
    return text === undefined
      ? getSourceFile(name, language, ...rest)
      : ts.createSourceFile(name, text, language, true);
  };
  host.fileExists = (name) => virtual.has(name) || fileExists(name);
  host.readFile = (name) => virtual.get(name) ?? readFile(name);
  const program = ts.createProgram(roots, CHECKER_OPTIONS, host);
  const checker = program.getTypeChecker();
  const label = (file: string): string => relative(LIB, file);
  const bound = (node: ts.Node): ts.Symbol | undefined => {
    const symbol = checker.getSymbolAtLocation(node);
    return symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0
      ? checker.getAliasedSymbol(symbol)
      : symbol;
  };
  const homeOf = (symbol: ts.Symbol | undefined): string =>
    symbol?.declarations?.[0]?.getSourceFile().fileName ?? '';
  const admitsNone = (type: ts.Type): boolean =>
    (type.flags &
      (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !==
      0 ||
    (type.isUnion() && type.types.some(admitsNone));
  // **A client the type says is there**: an argument that may be `undefined`,
  // or an accessor that may return it, leaves the creator to read the ambient
  // context exactly as leaving it out does.
  const handsAClientIn = (call: ts.CallExpression): boolean => {
    const argument = call.arguments[1];
    if (argument === undefined || ts.isSpreadElement(argument)) return false;
    const type = checker.getTypeAtLocation(argument);
    return (
      !admitsNone(type) &&
      type.getCallSignatures().every((signature) => !admitsNone(signature.getReturnType()))
    );
  };
  // **A module's own export, and not a member of something it exports**: a
  // method of the client the library was handed is a name the query library
  // declares too, and reads nothing but that client.
  const isExportOfAModule = (symbol: ts.Symbol | undefined): boolean =>
    (symbol?.declarations ?? []).some((declaration) => {
      // The module itself, which a namespace import binds.
      if (ts.isSourceFile(declaration)) return true;
      const container = ts.isVariableDeclaration(declaration)
        ? declaration.parent.parent.parent
        : declaration.parent;
      return ts.isSourceFile(container) || ts.isModuleBlock(container);
    });
  const named = new Set<string>();
  const unnamedClient: string[] = [];
  const contextReads: string[] = [];
  const dynamic: string[] = [];
  const homeKey = join(LIB, 'context.svelte.ts');
  for (const root of roots) {
    const file = program.getSourceFile(root);
    if (file === undefined) {
      dynamic.push(`${label(root)}: not read`);
      continue;
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        dynamic.push(`${label(root)}: ${node.getText()}`);
      if (ts.isIdentifier(node)) {
        const symbol = bound(node);
        const home = homeOf(symbol);
        if (QUERY_LIBRARY.test(home) && isExportOfAModule(symbol)) {
          // A namespace is every name at once, so it is reported as one.
          named.add(
            symbol !== undefined && (symbol.flags & ts.SymbolFlags.ValueModule) !== 0
              ? '*'
              : (symbol?.name ?? node.text)
          );
          if (symbol?.name === 'createQuery') {
            const call = node.parent;
            const handsAClient =
              ts.isCallExpression(call) && call.expression === node && handsAClientIn(call);
            const isTheImport = ts.isImportSpecifier(node.parent);
            if (!handsAClient && !isTheImport)
              unnamedClient.push(`${label(root)}: ${node.parent.getText()}`);
          }
        }
        if (
          /\/node_modules\/svelte\//.test(home) &&
          symbol !== undefined &&
          (symbol.flags & ts.SymbolFlags.ValueModule) !== 0 &&
          // A rune is a namespace too, and carries no reader.
          checker.getExportsOfModule(symbol).some((each) => CONTEXT_READERS.has(each.name)) &&
          !ts.isNamespaceImport(node.parent)
        )
          contextReads.push(`${label(root)}: *`);
        if (
          /\/node_modules\/svelte\//.test(home) &&
          CONTEXT_READERS.has(symbol?.name ?? '') &&
          !ts.isImportSpecifier(node.parent)
        ) {
          const call = node.parent;
          const asked =
            ts.isCallExpression(call) && call.expression === node ? call.arguments[0] : undefined;
          const key = asked === undefined ? undefined : bound(asked);
          const isOwnKey = key?.name === 'KEY' && homeOf(key) === homeKey;
          contextReads.push(
            `${label(root)}: ${symbol?.name ?? node.text}(${isOwnKey ? 'the library’s own key' : (asked?.getText() ?? '')})`
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  for (const name of files.filter((each) => each.endsWith('.svelte'))) {
    const source = readFileSync(join(LIB, name), 'utf8');
    const parsed = parse(source, { modern: true });
    for (const script of [parsed.instance, parsed.module]) {
      const content = script?.content as unknown as { start: number; end: number } | undefined;
      if (content === undefined) continue;
      const text = source.slice(content.start, content.end);
      const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
      const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const from = node.moduleSpecifier.text;
          const bindings = node.importClause?.namedBindings;
          const names =
            bindings !== undefined && ts.isNamedImports(bindings)
              ? bindings.elements.map((element) => (element.propertyName ?? element.name).text)
              : ['*'];
          if (QUERY_SPECIFIER.test(from)) for (const each of names) named.add(`${name}: ${each}`);
          if (from === 'svelte')
            for (const each of names)
              if (CONTEXT_READERS.has(each) || each === '*') contextReads.push(`${name}: ${each}`);
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
          dynamic.push(`${name}: ${node.getText()}`);
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
  }
  return { named: [...named].sort(), unnamedClient, contextReads, dynamic };
}

/**
 * The names of the query library the library may refer to, as the checker
 * resolves them: the client class, the creator it hands that client to, the
 * key hash, the accumulation helper (imported as `experimental_streamedQuery`,
 * declared as `streamedQuery`), and types. None of them reads the framework's
 * context — the creator would, if it were not handed a client, which
 * `unnamedClient` reads apart.
 */
const ALLOWED_NAMES = [
  'QueryClient',
  'QueryFunction',
  'QueryFunctionContext',
  'QueryKey',
  'createQuery',
  'hashKey',
  'streamedQuery'
];

describe('A15-C3: no module in the library reads a client it was not handed', () => {
  it('AM4: every module the library ships, read by the type checker, and each component by its syntax', () => {
    // **The instrument's control**: a module that reads the ambient client
    // each way the readings name is reported each way.
    const control = join(LIB, 'ambient-control.ts');
    const reaching = ambientReads(
      new Map([
        [
          control,
          [
            "import { getContext } from 'svelte';",
            "import * as framework from 'svelte';",
            "import * as query from 'tanstack-svelte-query-v6';",
            "import { createQuery, type QueryClient, useQueryClient as reach } from 'tanstack-svelte-query-v6';",
            'export const a = reach();',
            'export const b = query.getQueryClientContext();',
            'export const c = createQuery(() => ({ queryKey: [] }));',
            "export const d = getContext('$$_queryClient');",
            "export const e = import('tanstack-svelte-query-v6');",
            "export const f = framework['getContext']('$$_queryClient');",
            'export const g = createQuery(() => ({ queryKey: [] }), undefined);',
            'export const h = createQuery(() => ({ queryKey: [] }), (): QueryClient | undefined => undefined);'
          ].join('\n')
        ]
      ])
    );
    // **The allow-list read both ways**: every name the library refers to is on
    // it, and every name on it is one the library refers to, so the reading
    // reaches the modules it says it reads and the list carries no slack.
    const shipped = ambientReads();
    // One reading, the control's beside the library's, so a reader that broke
    // fails where the claim is read and not as a kill of its own.
    expect({
      control: {
        named: reaching.named.filter((name) => !ALLOWED_NAMES.includes(name)),
        unnamedClient: reaching.unnamedClient.filter((each) => each.startsWith('ambient-control')),
        contextReads: reaching.contextReads.filter((each) => each.startsWith('ambient-control')),
        dynamic: reaching.dynamic.filter((each) => each.startsWith('ambient-control'))
      },
      shipped: {
        named: shipped.named,
        unnamedClient: shipped.unnamedClient,
        contextReads: shipped.contextReads,
        dynamic: shipped.dynamic
      }
    }).toEqual({
      control: {
        named: ['*', 'getQueryClientContext', 'useQueryClient'],
        unnamedClient: [
          'ambient-control.ts: createQuery(() => ({ queryKey: [] }))',
          'ambient-control.ts: createQuery(() => ({ queryKey: [] }), undefined)',
          'ambient-control.ts: createQuery(() => ({ queryKey: [] }), (): QueryClient | undefined => undefined)'
        ],
        contextReads: ["ambient-control.ts: getContext('$$_queryClient')", 'ambient-control.ts: *'],
        dynamic: ["ambient-control.ts: import('tanstack-svelte-query-v6')"]
      },
      shipped: {
        named: [...ALLOWED_NAMES].sort(),
        unnamedClient: [],
        contextReads: [
          'context.svelte.ts: getContext(the library’s own key)',
          'context.svelte.ts: getContext(the library’s own key)'
        ],
        dynamic: []
      }
    });
  });

  it('AM5: at run time, on the standalone seam: a request that brings no client, under a consumer’s, is refused and leaves the consumer’s untouched', async () => {
    // **What `AM4` reads by the type, read where it runs**: an accessor that
    // hands the creator nothing has every shape of a call that hands it a
    // client, and the creator then reads the ambient context. A caller-owned
    // request that brings every owner input but the client is the one
    // arrangement with no client to hand, and a consumer's above it is the
    // one an ambient read would find.
    const { rxNostr, server } = createTestRelay(nextUrl());
    const consumer = new QueryClient();
    const touched = notificationsOf(consumer);
    // Built once, outside the options: what the caller brings is the caller's.
    const attempts = createAttemptRegistry();
    let handle: ReturnType<typeof useStreamedReq> | undefined;
    const view = render(AmbientCallerOwned, {
      consumer,
      options: () => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        namespace: 'am5',
        filters: [{ kinds: [1] }],
        reqIdBase: 'am5',
        settleTimeoutMs: 30_000
      }),
      seen: (held: ReturnType<typeof useStreamedReq>) => {
        handle = held;
      }
    });
    try {
      await delay(A_TURN_MS);
      const state = handle?.state;
      const refused =
        state?.status === 'error'
          ? (state.error as { code?: unknown; field?: unknown })
          : undefined;
      expect({
        status: state?.status,
        refused: { code: refused?.code, field: refused?.field },
        asked: (server.messages as unknown[][]).filter((frame) => frame[0] === 'REQ').length,
        consumer: { entries: consumer.getQueryCache().getAll().length, notifications: touched() }
      }).toEqual({
        status: 'error',
        refused: { code: 'invalid-descriptor', field: 'client' },
        asked: 0,
        consumer: { entries: 0, notifications: 0 }
      });
    } finally {
      view.unmount();
      rxNostr.dispose();
    }
  });
});
