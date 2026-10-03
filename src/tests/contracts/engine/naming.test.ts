/**
 * How relays are named (0003 B-α): by the transport, once per input, checked
 * for shape, for contradiction and for a fixed point — at a provider's
 * construction, on a later change of its relay list, and when a request or a
 * send names a relay of its own. One landing per row, each holding that row's
 * clauses itself; the ported arms beside these (`drift`, `relayconfig`,
 * `transportkey`, `relaykey`) stay as the finer-grained witnesses they were.
 *
 * Transports that disagree with this library are reached through the
 * `transportKeys` seam: the rx-nostr this repository resolves names every relay
 * exactly as `canonicalUrl` does, so no other path meets them.
 */
import { render, waitFor } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type { RxNostr } from 'rx-nostr';
import { createRxNostr } from 'rx-nostr';
import { seckeySigner } from 'rx-nostr-crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { NostrContext } from '$lib/v1/context.svelte.js';
import { deriveOutlet } from '$lib/v1/engine.js';
import type { NostrSigner, ReqHandle, ReqPlan, Send, SendResult } from '$lib/v1/index.js';
import { capture } from '$lib/v1/own.js';
import { ownedByLibrary } from '$lib/v1/owned.js';
import type { TransportKeys } from '$lib/v1/scope.svelte.js';
import {
  canonicalUrl,
  createRelayScope,
  NonIdempotentRelayUrlError,
  RelayConfigurationError,
  resolveTargets,
  TransportIncompatibleError,
  TransportKeyMismatchError
} from '$lib/v1/scope.svelte.js';

import { cell } from '../descriptor/cell.svelte.js';
import KeyedProvider from './fixtures/KeyedProvider.svelte';
import KeyedRequest from './fixtures/KeyedRequest.svelte';
import { HARNESS_DIVERGENCES, transportOf } from './helpers/relay.js';

vi.unmock('svelte');

afterEach(() => {
  WS.clean();
  vi.unstubAllGlobals();
});

const browserLike = (): void => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
};

const signer = seckeySigner(
  '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a'
) as unknown as NostrSigner;

/** A client that is never connected, for measurements of what the scope writes. */
const bareClient = (): RxNostr =>
  createRxNostr({ ...HARNESS_DIVERGENCES, skipVerify: true } as Parameters<
    typeof createRxNostr
  >[0]);

/** A transport that answers from a table and names everything else itself, recording what it was asked. */
const tabled = (rewrites: Record<string, string>): { keys: TransportKeys; asked: string[][] } => {
  const asked: string[][] = [];
  const keys: TransportKeys = (urls) => {
    asked.push([...urls]);
    return urls.map((url) => rewrites[url] ?? url);
  };
  return { keys, asked };
};

/** What a refused call threw, as the fields a consumer branches on. */
const refusalOf = (
  call: () => unknown
): { code?: string; url?: string; configured?: boolean; message: string } => {
  try {
    call();
  } catch (thrown) {
    return thrown as { code?: string; message: string };
  }
  throw new Error('nosvelte test: the call was expected to be refused');
};

/** A provider under a naming seam, and what a consumer of it can read. */
const provider = (
  relays: readonly string[],
  transportKeys: TransportKeys
): { context: NostrContext; unmount: () => void } => {
  let context: NostrContext | undefined;
  const view = render(KeyedProvider, {
    relays,
    transportKeys,
    seen: (made: NostrContext) => (context = made)
  });
  return { context: context as NostrContext, unmount: () => view.unmount() };
};

/** What the live transport has been told, as plain data. */
const written = (context: NostrContext) => {
  const live = transportOf(context);
  return {
    defaults: Object.keys(live.getDefaultRelays()).sort(),
    status: Object.keys(live.getAllRelayStatus()).sort()
  };
};

/**
 * A refused change of relay list leaves the provider as it was: the same scope
 * object, the same live transport configuration, no cache entry, and the
 * refusal published.
 */
const expectRefusedUpdate = (
  context: NostrContext,
  relays: readonly string[],
  refusal: new (...args: never[]) => RelayConfigurationError,
  label: string
): RelayConfigurationError => {
  const scope = context.scope;
  const wrote = written(context);
  const entries = context.client.getQueryCache().getAll().length;
  context.setRelays(relays);
  expect(context.configurationError, label).toBeInstanceOf(refusal);
  expect(context.scope, `${label}: the previous generation is the same object`).toBe(scope);
  expect(written(context), `${label}: the live transport was not written`).toEqual(wrote);
  expect(context.client.getQueryCache().getAll().length, `${label}: no cache entry`).toBe(entries);
  return context.configurationError as RelayConfigurationError;
};

/**
 * A refused construction: the provider stands with an empty scope and the
 * refusal published, and nothing reached the live transport or the cache.
 */
const expectRefusedConstruction = (
  relays: readonly string[],
  keys: TransportKeys,
  refusal: new (...args: never[]) => RelayConfigurationError,
  label: string
): RelayConfigurationError => {
  const { context, unmount } = provider(relays, keys);
  expect(context.configurationError, label).toBeInstanceOf(refusal);
  expect(context.scope.urls, `${label}: an empty scope`).toEqual([]);
  expect(written(context), `${label}: the live transport was not written`).toEqual({
    defaults: [],
    status: []
  });
  expect(context.client.getQueryCache().getAll(), `${label}: no cache entry`).toEqual([]);
  const error = context.configurationError as RelayConfigurationError;
  unmount();
  return error;
};

describe('relay naming, by the transport', () => {
  // @contracts B-α-C13
  it('NA1: a name the transport would rename again is refused before it is applied', async () => {
    browserLike();
    // The control's relay, made first: a mock server puts its own socket class
    // on the global when it is made, which would replace the recording below.
    const open = 'ws://localhost:9171';
    new WS(open, { jsonProtocol: true });
    // Every socket anything opens, recorded by its URL.
    const dialed: string[] = [];
    vi.stubGlobal(
      'WebSocket',
      class extends MockWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          dialed.push(String(url));
          super(url, protocols);
        }
      }
    );
    const RAW = 'wss://h.example/raw';
    const FIRST = 'wss://h.example/first';
    const SECOND = 'wss://h.example/second';
    const SETTLED = 'wss://h.example/settled';
    const renaming = tabled({ [RAW]: FIRST, [FIRST]: SECOND, 'wss://h.example/once': SETTLED });

    // At construction: refused as the input's fault, and nothing applied.
    const constructed = expectRefusedConstruction(
      [RAW],
      renaming.keys,
      NonIdempotentRelayUrlError,
      'construction'
    );
    expect(constructed.code).toBe('non-idempotent-url');
    expect(constructed.urls, 'it names what the consumer wrote').toEqual([RAW]);
    expect(dialed, 'no socket to either candidate spelling').toEqual([]);

    // On a change: refused, with the accepted generation and client in place.
    const { context, unmount } = provider(['wss://h.example/kept'], renaming.keys);
    expect(context.configurationError).toBeUndefined();
    expect(context.scope.urls).toEqual(['wss://h.example/kept']);
    expectRefusedUpdate(context, [RAW], NonIdempotentRelayUrlError, 'update');
    expect(dialed, 'nor on a change').toEqual([]);

    // The control: a spelling the transport settles in one application is
    // accepted, at construction and as a change, under the same transport.
    context.setRelays(['wss://h.example/once']);
    expect(context.configurationError).toBeUndefined();
    expect(context.scope.urls).toEqual([SETTLED]);
    expect(written(context).defaults).toEqual([SETTLED]);
    unmount();
    const accepted = provider(['wss://h.example/once'], renaming.keys);
    expect(accepted.context.configurationError).toBeUndefined();
    expect(accepted.context.scope.urls).toEqual([SETTLED]);
    accepted.unmount();

    // The positive control for "no socket": an accepted relay a request is
    // asked of is dialled, so the recording sees a dial when there is one.
    const asking = render(KeyedRequest, {
      relays: [open],
      transportKeys: (urls) => [...urls],
      plans: [(): ReqPlan => ({ kind: 'request', descriptor: { filters: [{ kinds: [1] }] } })]
    });
    await waitFor(() => expect(dialed.some((url) => url.startsWith(open))).toBe(true));
    asking.unmount();
  });

  // @contracts B-α-C14
  it('NA2: a set answer that disagrees with the names given one by one is refused before anything sees it', () => {
    browserLike();
    // Each relay names itself alone; asked about the pair, the transport
    // reports names this library did not compute.
    const disagreeing: TransportKeys = (urls) =>
      urls.length === 1 ? [...urls] : urls.map((url) => `${url}/elsewhere`);
    const pair = ['wss://a.example', 'wss://b.example'];

    const constructed = expectRefusedConstruction(
      pair,
      disagreeing,
      TransportKeyMismatchError,
      'construction'
    );
    expect(constructed.code).toBe('transport-key-mismatch');

    const { context, unmount } = provider(['wss://a.example'], disagreeing);
    expect(context.configurationError).toBeUndefined();
    expectRefusedUpdate(context, pair, TransportKeyMismatchError, 'update');
    unmount();

    // The control: the same pair under a transport whose set answer agrees.
    const agreeing = provider(pair, (urls) => [...urls]);
    expect(agreeing.context.configurationError).toBeUndefined();
    expect(agreeing.context.scope.urls).toEqual(pair);
    expect(written(agreeing.context).defaults).toEqual(pair);
    agreeing.unmount();
  });

  // @contracts B-α-C16
  it('NA3: two relays the transport merges as a set are refused, by what the consumer wrote, read once', () => {
    browserLike();
    const merging: TransportKeys = (urls) => (urls.length === 1 ? [...urls] : [urls[0] as string]);
    const pair = ['wss://a.example', 'wss://b.example'];

    // At construction and on a change.
    expectRefusedConstruction(pair, merging, TransportKeyMismatchError, 'construction');
    const { context, unmount } = provider(['wss://a.example'], merging);
    const refusal = expectRefusedUpdate(context, pair, TransportKeyMismatchError, 'update');
    // Whose answer is whose: the names given one at a time, and the set's.
    expect((refusal as TransportKeyMismatchError).expected).toEqual(pair);
    expect((refusal as TransportKeyMismatchError).actual).toEqual(['wss://a.example']);

    // The refusal is the consumer's to hold and no one's to rewrite.
    const urls = refusal.urls as string[];
    expect(() => urls.push('wss://nobody.example')).toThrow();
    expect(() => {
      (refusal as { code: string }).code = 'conflicting-capabilities';
    }).toThrow();
    expect(refusal.code).toBe('transport-key-mismatch');
    unmount();

    // It names the relays the consumer configured, not the transport's names
    // for them: under a transport that renames each relay, `urls` holds what
    // was written.
    const renamingMerge: TransportKeys = (urls) =>
      urls.length === 1
        ? urls.map((url) => (url.endsWith('/named') ? url : `${url}/named`))
        : [urls[0] as string];
    const named = expectRefusedConstruction(
      pair,
      renamingMerge,
      TransportKeyMismatchError,
      'renamed'
    );
    expect([...named.urls].sort()).toEqual(pair);

    // The set is asked about what the entrance read, and the caller is not
    // asked again: an entry answering once and then nothing is refused the
    // same way, not accepted because the second read found nothing to name.
    let reads = 0;
    const shifting = {
      get url() {
        reads += 1;
        return reads === 1 ? 'wss://a.example' : undefined;
      },
      read: true,
      write: true
    };
    const client = bareClient();
    expect(() => createRelayScope(client, [shifting as never, 'wss://b.example'], merging)).toThrow(
      TransportKeyMismatchError
    );
    expect(reads).toBe(1);
    expect(client.getDefaultRelays()).toEqual({});
    client.dispose();

    // Refused at construction, the provider still mounts its children.
    let mounted = false;
    const refusedTree = render(KeyedRequest, {
      relays: pair,
      transportKeys: merging,
      plans: [(): ReqPlan => ({ kind: 'deferred' })],
      request: () => (mounted = true),
      seen: (made: NostrContext) =>
        expect(made.configurationError).toBeInstanceOf(TransportKeyMismatchError)
    });
    expect(mounted, 'the children mounted under the refused provider').toBe(true);
    refusedTree.unmount();

    // The control: the same pair under a transport that keeps them apart.
    const apart = provider(pair, (urls) => [...urls]);
    expect(apart.context.scope.urls).toEqual(pair);
    apart.unmount();
  });

  // @contracts B-α-C18
  it('NA4: a transport that cannot name a relay is refused as transport-incompatible, wherever it is asked', async () => {
    browserLike();
    const A = 'wss://a.example';

    // **At construction**, every way of not giving back one usable name —
    // and the stability pass, which asks about the first answer.
    const shapes: [string, TransportKeys][] = [
      ['none', () => []],
      ['several', (urls) => [...urls, 'wss://extra.example']],
      ['not a string', () => [42 as unknown as string]],
      ['not a relay URL', () => ['http://a.example']],
      [
        'threw',
        () => {
          throw new Error('the transport said why');
        }
      ],
      ['returned', () => ['the transport said why']],
      [
        'the stability pass',
        (urls) => {
          if (urls[0] === `${A}/first`) throw new Error('asked about its own answer');
          return [`${A}/first`];
        }
      ]
    ];
    const messages = new Map<string, string>();
    for (const [label, keys] of shapes) {
      const refusal = expectRefusedConstruction([A], keys, TransportIncompatibleError, label);
      expect(refusal.code, label).toBe('transport-incompatible');
      // The URL the consumer wrote, on the stability pass too.
      expect(refusal.urls, label).toEqual([A]);
      // What to do, and that the relay list is not it.
      expect(refusal.message, label).toContain('Pin or upgrade rx-nostr');
      expect(refusal.message, label).toContain('nothing about the relay list changes it');
      expect(refusal.message, label).not.toContain('Rewrite');
      messages.set(label, refusal.message);
    }
    // Threw and returned the same words: told apart.
    expect(messages.get('threw')).toContain('it threw');
    expect(messages.get('returned')).toContain('it answered');
    expect(messages.get('threw')).not.toBe(messages.get('returned'));
    // Refused the same way again, it is the same refusal: a provider
    // re-applying a list its transport cannot name keeps the refusal it
    // published, and a different refusal replaces it.
    const again = provider([A], () => {
      throw new Error('the transport said why');
    });
    const first = again.context.configurationError;
    expect(first).toBeInstanceOf(TransportIncompatibleError);
    again.context.setRelays([A]);
    expect(again.context.configurationError, 'the same refusal is kept').toBe(first);
    again.context.setRelays(['wss://other.example']);
    expect(again.context.configurationError).toBeInstanceOf(TransportIncompatibleError);
    expect(again.context.configurationError, 'a different one replaces it').not.toBe(first);
    again.unmount();

    // A disagreeing set is the other code, with the other remedy.
    const mismatch = expectRefusedConstruction(
      [A, 'wss://b.example'],
      (urls) => (urls.length === 1 ? [...urls] : [A]),
      TransportKeyMismatchError,
      'mismatch'
    );
    expect(mismatch.code).toBe('transport-key-mismatch');

    // **A contradiction at construction**: one input, two answers. The refusal
    // says the input, the earlier answer and this one, and whose configured
    // spelling was being named.
    const contradicting: TransportKeys = (urls) => {
      const url = urls[0] as string;
      if (url === 'wss://r0.example') return ['wss://s.example'];
      if (url === 'wss://s.example' && urls.length === 1)
        return [contradictions++ === 0 ? url : 'wss://w2.example'];
      return [url];
    };
    let contradictions = 0;
    const contradiction = expectRefusedConstruction(
      ['wss://r0.example', 'wss://s.example'],
      contradicting,
      TransportIncompatibleError,
      'contradiction'
    );
    expect(contradiction.message).toContain('wss://s.example');
    expect(contradiction.message).toContain('having answered "wss://s.example"');
    expect(contradiction.message).toContain('"wss://w2.example"');

    // The same, where the input is not the earlier answer — one spelling
    // configured twice, named one way and then another — and where it is the
    // stability question asked for another configured spelling, which the
    // refusal attributes to that spelling.
    let xAsks = 0;
    const twice = expectRefusedConstruction(
      ['wss://x.example', 'wss://x.example'],
      (urls) => {
        if (urls.length === 1 && urls[0] === 'wss://x.example') {
          xAsks += 1;
          return [xAsks === 1 ? 'wss://a.example' : 'wss://b.example'];
        }
        return [...urls];
      },
      TransportIncompatibleError,
      'one input, two names'
    );
    expect(twice.message).toContain('Asked what it calls wss://x.example');
    expect(twice.message).toContain('it answered "wss://b.example"');
    expect(twice.message).toContain('having answered "wss://a.example"');
    let sAsks = 0;
    const stability: TransportKeys = (urls) => {
      const url = urls[0] as string;
      if (urls.length > 1)
        return [
          ...new Set(
            urls.map((each) =>
              each === 'wss://q.example'
                ? 'wss://s.example'
                : each === 'wss://p.example'
                  ? 'wss://s.example'
                  : each
            )
          )
        ];
      if (url === 'wss://p.example' || url === 'wss://q.example') return ['wss://s.example'];
      if (url === 'wss://s.example') {
        sAsks += 1;
        return [sAsks === 1 ? url : 'wss://t.example'];
      }
      return [url];
    };
    const attributed = expectRefusedConstruction(
      ['wss://p.example', 'wss://q.example'],
      stability,
      TransportIncompatibleError,
      'attributed'
    );
    expect(attributed.message).toContain('Asked what it calls wss://s.example');
    expect(attributed.message).toContain('which is what it had named wss://q.example');
    expect(attributed.urls).toEqual(['wss://q.example']);
    // And on a change, which keeps the generation and the client.
    xAsks = 0;
    const changing = provider(['wss://kept.example'], (urls) => {
      if (urls.length === 1 && urls[0] === 'wss://x.example') {
        xAsks += 1;
        return [xAsks === 1 ? 'wss://a.example' : 'wss://b.example'];
      }
      return [...urls];
    });
    expectRefusedUpdate(
      changing.context,
      ['wss://x.example', 'wss://x.example'],
      TransportIncompatibleError,
      'contradiction on a change'
    );
    changing.unmount();

    // **When a request names a relay**, the same fault is the request's
    // `transport-incompatible` — on the state, the last error, the error
    // slot's argument and what `refresh()` rejects with; not as an incomplete
    // answer, not as a refresh outcome, and not as a leg end. The transport
    // here fails on one string in a way the test chooses.
    const UNNAMEABLE = 'wss://unnameable.example';
    let mode = 'threw';
    let unnameableAsks = 0;
    const faulty: TransportKeys = (urls) => {
      if (urls[0] !== UNNAMEABLE && !(urls[0] ?? '').startsWith(`${UNNAMEABLE}/`)) {
        return [...urls];
      }
      unnameableAsks += 1;
      switch (mode) {
        case 'none':
          return [];
        case 'several':
          return [UNNAMEABLE, 'wss://other.example'];
        case 'not a string':
          return [42 as unknown as string];
        case 'not a relay URL':
          return ['http://unnameable.example'];
        case 'contradicts itself':
          return [unnameableAsks % 2 === 1 ? UNNAMEABLE : 'wss://other.example'];
        default:
          throw new Error('cannot name this one');
      }
    };
    const relay = new WS(A, { jsonProtocol: true });
    let refused: ReqHandle | undefined;
    let context: NostrContext | undefined;
    let send: Send | undefined;
    render(KeyedRequest, {
      relays: [A],
      transportKeys: faulty,
      signer,
      plans: [
        (): ReqPlan => ({
          kind: 'request',
          descriptor: { filters: [{ kinds: [1] }], relays: [UNNAMEABLE] }
        }),
        // The control beside it, asked of the provider's relay.
        (): ReqPlan => ({ kind: 'request', descriptor: { filters: [{ kinds: [2] }] } })
      ],
      request: (index: number, handed: ReqHandle) => {
        if (index === 0) refused = handed;
      },
      send: (made: Send) => (send = made),
      seen: (made: NostrContext) => (context = made)
    });
    await waitFor(() => expect(refused?.state.status).toBe('error'));
    const state = refused?.state;
    const error = state?.status === 'error' ? state.error : undefined;
    expect(error?.code).toBe('transport-incompatible');
    expect(error && 'field' in error ? error.field : undefined).toBe('relays');
    expect(error?.message).toContain('cannot name this one');
    expect(error?.message).toContain('Pin or upgrade rx-nostr');
    expect(refused?.diagnostics.lastError).toBe(error);
    const outlet = deriveOutlet(state as NonNullable<typeof state>);
    expect(outlet.slot).toBe('error');
    expect(outlet.error).toBe(error);
    await expect(refused?.refresh()).rejects.toMatchObject({ code: 'transport-incompatible' });
    // After the refusal was published: no leg-end record carries it — a leg
    // end records a forward leg's end, which a refused request never had.
    expect(refused?.diagnostics.legEnded).toBeUndefined();
    expect(state?.status).not.toBe('incomplete');
    // And, separately, on the wire: the control's REQ reaches the provider's
    // relay, and nothing the refused request asked for does.
    await waitFor(() =>
      expect(
        (relay.messages as unknown[][]).some(
          (frame) => frame[0] === 'REQ' && JSON.stringify(frame[2]) === '{"kinds":[2]}'
        )
      ).toBe(true)
    );
    expect(
      (relay.messages as unknown[][]).filter(
        (frame) => frame[0] === 'REQ' && JSON.stringify(frame[2]) === '{"kinds":[1]}'
      )
    ).toEqual([]);

    // **The request's value and the provider's are told apart by where they
    // were made, not by the literal they share.** The provider's refusal
    // handed to the request's failure boundary is not taken as a request value
    // — it is re-said — while the request's own passes through as itself.
    const providers = ownedByLibrary(new TransportIncompatibleError([A], [A], 'not a name'));
    const captured = capture(providers, 'descriptor');
    expect(captured).not.toBe(providers);
    expect(captured.code).not.toBe('transport-incompatible');
    expect(capture(error, 'descriptor')).toBe(error);

    // **Every fault, on a request and on a send.** A refused naming is not
    // recorded, so the same string is asked again under each.
    const scope = (context as NostrContext).scope;
    for (const each of [
      'threw',
      'none',
      'several',
      'not a string',
      'not a relay URL',
      'contradicts itself'
    ]) {
      mode = each;
      unnameableAsks = 0;
      expect(refusalOf(() => resolveTargets([UNNAMEABLE], scope)).code, each).toBe(
        'transport-incompatible'
      );
      unnameableAsks = 0;
      const sent = (await send?.(
        { kind: 1, content: each, tags: [], created_at: Math.floor(Date.now() / 1000) },
        { relays: [UNNAMEABLE] }
      )) as SendResult;
      expect(sent.status === 'refused' && sent.code, each).toBe('transport-incompatible');
    }

    // **Bounded**: a string of a hundred thousand characters is not one in
    // the message, on either path.
    mode = 'threw';
    const long = `${UNNAMEABLE}/${'x'.repeat(100_000)}`;
    const longRefusal = refusalOf(() => resolveTargets([long], scope));
    expect(longRefusal.code).toBe('transport-incompatible');
    expect(longRefusal.message.length).toBeLessThan(2_000);
    const longSend = (await send?.(
      { kind: 1, content: 'long', tags: [], created_at: Math.floor(Date.now() / 1000) },
      { relays: [long] }
    )) as SendResult;
    expect(longSend.status === 'refused' && longSend.message.length).toBeLessThan(2_000);
  });

  // @contracts B-α-C20
  it('NA5: the set question is refused by the whole list it asked, and a list of nothing is not asked', () => {
    browserLike();
    const pair = ['wss://a.example', 'wss://b.example'];
    // Every relay names itself alone; the set question throws.
    const throwsOnSets: TransportKeys = (urls) => {
      if (urls.length > 1) throw new Error('not about several at once');
      return [...urls];
    };
    const refusal = expectRefusedConstruction(
      pair,
      throwsOnSets,
      TransportIncompatibleError,
      'set throws'
    );
    expect(refusal.code).toBe('transport-incompatible');
    expect([...refusal.urls].sort(), 'every relay it asked about').toEqual(pair);
    expect(refusal.message).toContain('2 relays, together');
    // Under a transport that renames each relay, the refusal still names what
    // the consumer wrote rather than the names the set was asked about.
    const renamedThrows: TransportKeys = (urls) => {
      if (urls.length > 1) throw new Error('not about several at once');
      return urls.map((url) => (url.endsWith('/named') ? url : `${url}/named`));
    };
    const renamed = expectRefusedConstruction(
      pair,
      renamedThrows,
      TransportIncompatibleError,
      'renamed, set throws'
    );
    expect([...renamed.urls].sort()).toEqual(pair);

    // An answer of the wrong shape is this code; a well-formed one that
    // disagrees is the mismatch.
    const shaped = expectRefusedConstruction(
      pair,
      (urls) => (urls.length === 1 ? [...urls] : (null as unknown as string[])),
      TransportIncompatibleError,
      'not a list'
    );
    expect(shaped.code).toBe('transport-incompatible');
    // And a list of the right length whose members are not names.
    expectRefusedConstruction(
      pair,
      (urls) => (urls.length === 1 ? [...urls] : [42 as unknown as string, 'wss://b.example']),
      TransportIncompatibleError,
      'not names'
    );
    expectRefusedConstruction(
      pair,
      (urls) => (urls.length === 1 ? [...urls] : [...urls].reverse().map((url) => `${url}/x`)),
      TransportKeyMismatchError,
      'disagrees'
    );

    // A scope of no relays is not probed at all, so an adapter that throws on
    // any question does not refuse it — and the same adapter does refuse one
    // relay, which is the control.
    let asked = 0;
    const throwsAlways: TransportKeys = () => {
      asked += 1;
      throw new Error('asked anything at all');
    };
    const client = bareClient();
    expect(createRelayScope(client, [], throwsAlways).current.urls).toEqual([]);
    expect(asked).toBe(0);
    expect(() => createRelayScope(client, ['wss://a.example'], throwsAlways)).toThrow(
      TransportIncompatibleError
    );
    expect(asked).toBeGreaterThan(0);
    client.dispose();
  });

  // @contracts B-α-C15
  it('NA6: a relay a request or a send names is the transport’s name for it, matched against every relay', async () => {
    browserLike();
    // The scope carries the transport's answers.
    const ELSEWHERE = 'wss://h.example/tenant-b';
    const RAW = 'wss://h.example/?x=%7E';
    const { keys, asked } = tabled({ [RAW]: ELSEWHERE });
    const client = bareClient();
    const scope = createRelayScope(client, [RAW], keys).current;
    expect(scope.urls).toEqual([ELSEWHERE]);
    expect(Object.keys(client.getDefaultRelays())).toEqual([ELSEWHERE]);
    client.dispose();

    // A request names it the transport's way or the consumer's, and reaches it.
    expect(resolveTargets([ELSEWHERE], scope).requested).toEqual([ELSEWHERE]);
    expect(resolveTargets([RAW], scope).requested).toEqual([ELSEWHERE]);
    // Both were already in the generation's table: nothing more was asked.
    const askedSoFar = asked.length;
    resolveTargets([RAW, ELSEWHERE], scope);
    expect(asked.length).toBe(askedSoFar);

    // **A name this library's canonicalisation would rewrite is still the
    // name**, and a spelling the transport names as one relay is routed there
    // even where canonicalisation would pick another.
    const urlTransport: TransportKeys = (urls) => urls.map((url) => new URL(url).toString());
    const two = createRelayScope(
      bareClient(),
      ['wss://a.example/x/', 'wss://a.example/x'],
      urlTransport
    ).current;
    expect(two.urls).toEqual(['wss://a.example/x', 'wss://a.example/x/']);
    expect(resolveTargets(['wss://a.EXAMPLE/x/'], two).requested).toEqual(['wss://a.example/x/']);
    expect(resolveTargets(['wss://a.EXAMPLE/x'], two).requested).toEqual(['wss://a.example/x']);

    // **Every relay, then the capability.** A write-only relay named exactly
    // is refused for a request as configured but not readable — by its name —
    // not routed to a readable neighbour.
    const withWriteOnly = createRelayScope(
      bareClient(),
      [
        { url: 'wss://A.example/x/', read: false, write: true },
        { url: 'wss://a.example/x', read: true, write: true }
      ],
      urlTransport
    ).current;
    expect(refusalOf(() => resolveTargets(['wss://a.example/x/'], withWriteOnly))).toMatchObject({
      code: 'relay-not-in-scope',
      url: 'wss://a.example/x/',
      configured: true
    });

    // **A refused naming is not remembered.** A transport that fails the first
    // time it is asked about a string, and not the second, is asked again —
    // and the second answer is then judged on its own (not in this scope).
    let failures = 1;
    const flaky: TransportKeys = (urls) => {
      if (urls[0] === 'wss://late.example' && failures-- > 0) throw new Error('not yet');
      return [...urls];
    };
    const late = createRelayScope(bareClient(), ['wss://b.example'], flaky).current;
    expect(refusalOf(() => resolveTargets(['wss://late.example'], late)).code).toBe(
      'transport-incompatible'
    );
    expect(refusalOf(() => resolveTargets(['wss://late.example'], late)).code).toBe(
      'relay-not-in-scope'
    );

    // **A contradiction with what the generation already knows refuses the
    // request and leaves the generation as it was.** Two inputs naming one
    // relay is an alias, and accepted; one input given two names is not.
    let turned = false;
    const turning: TransportKeys = (urls) => {
      const url = urls[0] as string;
      if (urls.length === 1 && url === 'wss://alias.example') return ['wss://c.example'];
      if (urls.length === 1 && url === 'wss://other.example') return ['wss://c.example'];
      if (urls.length === 1 && turned && url === 'wss://c.example') return ['wss://d.example'];
      return [...urls];
    };
    const shared = createRelayScope(
      bareClient(),
      ['wss://c.example', 'wss://d.example'],
      turning
    ).current;
    expect(resolveTargets(['wss://alias.example'], shared).requested).toEqual(['wss://c.example']);
    turned = true;
    const contradicted = refusalOf(() => resolveTargets(['wss://other.example'], shared));
    expect(contradicted.code).toBe('transport-incompatible');
    expect(contradicted.message).toContain('having answered "wss://c.example"');
    // Not remembered either: asked again, it is refused again rather than
    // answered from what the refused naming saw part-way through.
    expect(refusalOf(() => resolveTargets(['wss://other.example'], shared)).code).toBe(
      'transport-incompatible'
    );
    expect(resolveTargets(['wss://c.example'], shared).requested).toEqual(['wss://c.example']);
    expect(resolveTargets(['wss://alias.example'], shared).requested).toEqual(['wss://c.example']);

    // **Asking costs nothing that outlives the asking**, on the side with no
    // transport at all: a server scope names every new string through the
    // default probe, a throwaway client disposed in a `finally`, and fifty
    // resolutions leave the process holding what it held before.
    const server = createRelayScope(undefined, ['wss://server.example']).current;
    const before = process.getActiveResourcesInfo().length;
    for (let at = 0; at < 50; at += 1) {
      expect(refusalOf(() => resolveTargets([`wss://s${at}.example`], server)).code).toBe(
        'relay-not-in-scope'
      );
    }
    expect(process.getActiveResourcesInfo().length).toBe(before);

    // **And a send** names a relay the same way: the transport's name and the
    // consumer's spelling reach it, and a relay it holds without writing to is
    // refused rather than replaced.
    const relay = new WS('ws://localhost:9161', { jsonProtocol: true });
    let send: Send | undefined;
    render(KeyedRequest, {
      relays: [
        'ws://localhost:9161',
        // Held, readable, and not written to.
        { url: 'ws://localhost:9162', read: true, write: false }
      ],
      transportKeys: (urls) => urls.map((url) => `${canonicalUrl(url)}/`),
      signer,
      plans: [(): ReqPlan => ({ kind: 'deferred' })],
      send: (made: Send) => (send = made)
    });
    for (const named of ['ws://localhost:9161/', 'ws://localhost:9161']) {
      const outcome = send?.(
        { kind: 1, content: named, tags: [], created_at: Math.floor(Date.now() / 1000) },
        { relays: [named] }
      ) as Promise<SendResult>;
      const first = await Promise.race([
        relay.nextMessage.then((frame) => ({ frame })),
        outcome.then((result) => ({ result }))
      ]);
      expect('frame' in first ? 'sent' : first.result, named).toBe('sent');
      const frame = (first as { frame: [string, { id: string }] }).frame;
      relay.send(['OK', frame[1].id, true, '']);
      expect((await outcome).status, named).toBe('settled');
    }
    // The capability is the operation's: a relay held for reading is refused
    // to a send by both its names, rather than replaced by one that writes.
    for (const named of ['ws://localhost:9162/', 'ws://localhost:9162']) {
      const result = (await send?.(
        { kind: 1, content: named, tags: [], created_at: Math.floor(Date.now() / 1000) },
        { relays: [named] }
      )) as SendResult;
      expect(result.status === 'refused' && result.code, named).toBe('relay-outside-scope');
    }

    // **The table belongs to the generation, not to its identity.** Two
    // scopes over one readable set share an id; under the one whose transport
    // renames `q` to `a`, `q` is that relay, and under the other it is not in
    // the scope at all — whichever is built or asked first.
    const renamesQ: TransportKeys = (urls) =>
      urls.map((url) => (url === 'wss://q.example' ? 'wss://a.example' : url));
    const viaQ = createRelayScope(bareClient(), ['wss://q.example'], renamesQ).current;
    const plain = createRelayScope(bareClient(), ['wss://a.example'], (urls) => [...urls]).current;
    expect(viaQ.id).toBe(plain.id);
    expect(refusalOf(() => resolveTargets(['wss://q.example'], plain)).code).toBe(
      'relay-not-in-scope'
    );
    expect(resolveTargets(['wss://q.example'], viaQ).requested).toEqual(['wss://a.example']);

    // A name outside the scope is refused under its own name, and bounded:
    // the name comes from what the caller wrote.
    const outside = refusalOf(() =>
      resolveTargets([`wss://far.example/${'y'.repeat(100_000)}`], plain)
    );
    expect(outside.code).toBe('relay-not-in-scope');
    expect(outside.message.length).toBeLessThan(2_000);

    // Two such names that differ only past the bound are two refusals, each
    // carrying its own relay — under one provider, where a refused request's
    // entry is keyed by its refusal.
    const stem = `wss://far.example/${'z'.repeat(300)}`;
    const longs = [`${stem}/one`, `${stem}/two`];
    new WS('ws://localhost:9165', { jsonProtocol: true });
    const refusedPair: (ReqHandle | undefined)[] = [];
    const pairView = render(KeyedRequest, {
      relays: ['ws://localhost:9165'],
      transportKeys: (urls) => [...urls],
      plans: longs.map((url) => (): ReqPlan => ({
        kind: 'request',
        descriptor: { filters: [{ kinds: [5] }], relays: [url] }
      })),
      request: (index: number, handed: ReqHandle) => (refusedPair[index] = handed)
    });
    await waitFor(() => {
      for (const handle of refusedPair) expect(handle?.state.status).toBe('error');
    });
    const urlsSeen = refusedPair.map((handle) => {
      const failed = handle?.state;
      return failed?.status === 'error' && 'url' in failed.error ? failed.error.url : undefined;
    });
    expect(urlsSeen).toEqual(longs);
    pairView.unmount();

    // **A naming that fails its fixed point is not recorded either**: asked
    // again, it is refused again and the transport is asked again.
    let renameAsks = 0;
    const drifting: TransportKeys = (urls) =>
      urls.map((url) => {
        if (url.startsWith('wss://drift.example')) {
          renameAsks += 1;
          return `${url}/again`;
        }
        return url;
      });
    const drifted = createRelayScope(bareClient(), ['wss://b.example'], drifting).current;
    expect(refusalOf(() => resolveTargets(['wss://drift.example'], drifted)).code).toBe(
      'invalid-descriptor'
    );
    const asksAfterFirst = renameAsks;
    expect(refusalOf(() => resolveTargets(['wss://drift.example'], drifted)).code).toBe(
      'invalid-descriptor'
    );
    expect(renameAsks).toBeGreaterThan(asksAfterFirst);

    // **A contradiction refuses that request alone**: under a provider whose
    // transport turns on a name after the generation was built, a request
    // naming it is refused, while the provider keeps its generation and its
    // `configurationError`, and a request beside it is asked as usual.
    const C = 'ws://localhost:9163';
    const cRelay = new WS(C, { jsonProtocol: true });
    let turnedOn = false;
    const turnsOn: TransportKeys = (urls) =>
      urls.map((url) => {
        if (url === 'wss://points-at-c.example') return C;
        if (turnedOn && url === C && urls.length === 1) return 'ws://localhost:9164';
        return url;
      });
    const later = cell<ReqPlan>({ kind: 'deferred' });
    let held: NostrContext | undefined;
    let turnedRequest: ReqHandle | undefined;
    render(KeyedRequest, {
      relays: [C],
      transportKeys: turnsOn,
      plans: [
        () => later.value,
        (): ReqPlan => ({ kind: 'request', descriptor: { filters: [{ kinds: [3] }] } })
      ],
      request: (index: number, handed: ReqHandle) => {
        if (index === 0) turnedRequest = handed;
      },
      seen: (made: NostrContext) => (held = made)
    });
    await waitFor(() =>
      expect(
        (cRelay.messages as unknown[][]).some(
          (frame) => frame[0] === 'REQ' && JSON.stringify(frame[2]) === '{"kinds":[3]}'
        )
      ).toBe(true)
    );
    const generation = held?.scope;
    turnedOn = true;
    later.value = {
      kind: 'request',
      descriptor: { filters: [{ kinds: [4] }], relays: ['wss://points-at-c.example'] }
    };
    await waitFor(() => expect(turnedRequest?.state.status).toBe('error'));
    const failed = turnedRequest?.state;
    expect(failed?.status === 'error' && failed.error.code).toBe('transport-incompatible');
    expect(held?.scope, 'the generation is the same object').toBe(generation);
    expect(held?.configurationError).toBeUndefined();
    // The request beside it still resolves under the generation it was asked in.
    expect(resolveTargets([C], held?.scope as NonNullable<typeof generation>).requested).toEqual([
      C
    ]);
  });
});
