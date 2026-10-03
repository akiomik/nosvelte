/**
 * What a provider does with the relay list a consumer hands it (0003 B-α):
 * through `NostrApp`'s `relays` prop, read back from `useRelayDiagnostics` —
 * the relays it holds and the refusal it publishes — and from a request beside
 * it. Nothing here reaches past the published entry.
 */
import { render, waitFor } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { RelayInput, ReqHandle, ReqPlan, useRelayDiagnostics } from '$lib/v1/index.js';

import { cell } from './descriptor/cell.svelte.js';
import Host from './descriptor/Host.svelte';

vi.unmock('svelte');

/**
 * What the relay transport was asked: every list handed to `setDefaultRelays`
 * on any client rx-nostr builds, the provider's own and the ones it asks what
 * a relay is called. This is the transport's input, read where it crosses into
 * the dependency, as the wire is its output; nothing of this library's is
 * replaced. **It is supporting evidence, not a public witness**: what it reads
 * depends on which transport call the library makes, so it holds the internal
 * halves of B-α-C17 and B-α-C21, which no published value reflects, and the
 * catalogue rows say so. A module-level array because `vi.mock`'s factory is
 * hoisted above every `const` in this file.
 */
const asked: unknown[][] = [];

vi.mock('rx-nostr', async () => {
  const actual = await vi.importActual<typeof import('rx-nostr')>('rx-nostr');
  return {
    ...actual,
    createRxNostr: (...args: Parameters<typeof actual.createRxNostr>) => {
      const client = actual.createRxNostr(...args);
      const set = client.setDefaultRelays.bind(client);
      client.setDefaultRelays = (relays) => {
        (globalThis as unknown as Record<string, unknown[][]>)['__nosvelteAsked']?.push([
          ...(relays as unknown[])
        ]);
        set(relays);
      };
      return client;
    }
  };
});

beforeEach(() => {
  asked.length = 0;
  (globalThis as unknown as Record<string, unknown[][]>)['__nosvelteAsked'] = asked;
});

afterEach(() => {
  WS.clean();
  vi.unstubAllGlobals();
});

const browserLike = (): void => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
};

type Diagnostics = ReturnType<typeof useRelayDiagnostics>;

/** A provider over `relays`, with a request under it, and what a consumer reads. */
const mounted = (
  relays: unknown,
  plans: (() => ReqPlan)[] = []
): {
  diagnostics: () => Diagnostics;
  request: (index: number) => ReqHandle | undefined;
  rerender: (relays: unknown) => Promise<void>;
  unmount: () => void;
} => {
  let held: Diagnostics | undefined;
  const handles: (ReqHandle | undefined)[] = [];
  const view = render(Host, {
    relays: relays as readonly RelayInput[],
    plans,
    seen: (index: number, handle: ReqHandle) => (handles[index] = handle),
    diagnostics: (made: Diagnostics) => (held = made)
  });
  return {
    diagnostics: () => held as Diagnostics,
    request: (index) => handles[index],
    rerender: async (next) => {
      await view.rerender({ relays: next as readonly RelayInput[] });
    },
    unmount: () => view.unmount()
  };
};

const held = (diagnostics: Diagnostics): string[] => Object.keys(diagnostics.relays).sort();

const errorOf = (handle: ReqHandle | undefined): { readonly code: string } | undefined =>
  handle?.state.status === 'error' ? handle.state.error : undefined;

describe('the relay list a consumer hands the provider', () => {
  // @contracts B-α-C3
  it('RI1: one relay named twice is one relay, and named with two capabilities is refused', () => {
    browserLike();
    const A = 'wss://a.example';
    // An identical repeat is a spelling, not a second relay.
    const repeated = mounted([A, A]);
    expect(repeated.diagnostics().configurationError).toBeUndefined();
    expect(held(repeated.diagnostics())).toEqual([A]);
    repeated.unmount();

    // Two capabilities for one relay is refused, whichever comes first, and
    // the refusal names both spellings the consumer wrote — and the
    // transport's name for them, as the transport's, when it differs.
    const readOnly = { url: `${A}/`, read: true, write: false };
    const both = { url: A, read: true, write: true };
    const writeOnly = { url: `${A}/`, read: false, write: true };
    for (const list of [
      [readOnly, both],
      [both, readOnly],
      // Differing in `read` alone is a contradiction as much as in `write`.
      [writeOnly, both],
      [both, writeOnly]
    ]) {
      const label = JSON.stringify(list.map((entry) => entry.url));
      const conflicting = mounted(list);
      const refusal = conflicting.diagnostics().configurationError;
      expect(refusal?.code, label).toBe('conflicting-capabilities');
      expect([...(refusal?.urls ?? [])].sort(), label).toEqual([A, `${A}/`].sort());
      expect(refusal?.message, label).toContain(list.map((entry) => entry.url).join(' and '));
      expect(refusal?.message, label).toContain('conflicting read/write capabilities');
      expect(held(conflicting.diagnostics()), label).toEqual([]);
      // One of the two is the transport's own name, so there is no other to say.
      expect(refusal?.message, label).not.toContain('by the transport');
      conflicting.unmount();
    }
    // Neither spelling is the transport's name: it is said, and said as its.
    const renamed = mounted([
      { url: `${A}/`, read: true, write: false },
      { url: ` ${A} `, read: true, write: true }
    ]);
    const named = renamed.diagnostics().configurationError;
    expect(named?.code).toBe('conflicting-capabilities');
    expect([...(named?.urls ?? [])].sort()).toEqual([` ${A} `, `${A}/`].sort());
    expect(named?.message).toContain(`both named ${A} by the transport`);
    // And the message names both entries the consumer can find in their source.
    expect(named?.message).toContain(`${A}/ and  ${A} `);
    renamed.unmount();
    // Spelled identically, there is no other name to give.
    const same = mounted([
      { url: A, read: true, write: false },
      { url: A, read: true, write: true }
    ]);
    const plain = same.diagnostics().configurationError;
    expect(plain?.code).toBe('conflicting-capabilities');
    expect(plain?.urls).toEqual([A]);
    same.unmount();
  });

  // @contracts B-α-C4
  it('RI2: a consumer writing to the list they passed does not move the provider', async () => {
    browserLike();
    const A = 'ws://localhost:9201';
    const B = 'ws://localhost:9202';
    const a = new WS(A, { jsonProtocol: true });
    const b = new WS(B, { jsonProtocol: true });
    const entry = { url: A, read: true, write: true };
    const list: RelayInput[] = [entry];
    // A request the consumer names a relay for only after they have written.
    const named = cell<string | undefined>(undefined);
    const provider = mounted(list, [
      (): ReqPlan => ({ kind: 'request', descriptor: { filters: [{ kinds: [1] }] } }),
      (): ReqPlan =>
        named.value === undefined
          ? { kind: 'deferred' }
          : { kind: 'request', descriptor: { filters: [{ kinds: [2] }], relays: [named.value] } }
    ]);
    await waitFor(() =>
      expect((a.messages as unknown[][]).some((frame) => frame[0] === 'REQ')).toBe(true)
    );
    const before = provider.diagnostics().relays;

    // The consumer keeps their objects and writes to them.
    entry.url = B;
    entry.read = false;
    list.push(B);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(provider.diagnostics().relays, 'the provider holds what it was given').toBe(before);
    expect(held(provider.diagnostics())).toEqual([A]);
    expect((b.messages as unknown[][]).filter((frame) => frame[0] === 'REQ')).toEqual([]);
    // And refreshed, the request is asked where it was.
    void provider.request(0)?.refresh();
    await waitFor(() =>
      expect((a.messages as unknown[][]).filter((frame) => frame[0] === 'REQ').length).toBe(2)
    );
    expect((b.messages as unknown[][]).filter((frame) => frame[0] === 'REQ')).toEqual([]);
    // A request naming a relay is matched against what the provider was
    // given: the relay the entry named then is still there, and the one it
    // was rewritten to is not.
    named.value = B;
    await waitFor(() => expect(errorOf(provider.request(1))?.code).toBe('relay-not-in-scope'));
    named.value = A;
    await waitFor(() =>
      expect(
        (a.messages as unknown[][]).some(
          (frame) => frame[0] === 'REQ' && JSON.stringify(frame).includes('"kinds":[2]')
        )
      ).toBe(true)
    );
    expect(errorOf(provider.request(1))).toBeUndefined();
    provider.unmount();
  });

  // @contracts B-α-C7
  it('RI3: one relay spelled three ways is one relay, and the conflict rule sees through the spelling', () => {
    browserLike();
    const A = 'wss://a.example';
    // A trailing slash, surrounding space, a fragment: one relay, and no
    // refusal — which is also the price: written differently and named the
    // same, they are silently one, and the map holds fewer than were written.
    const spelled = mounted([`${A}/`, ` ${A} `, `${A}#frag`]);
    expect(spelled.diagnostics().configurationError).toBeUndefined();
    expect(held(spelled.diagnostics())).toEqual([A]);
    expect(spelled.diagnostics().relays[A]?.configuredUrls).toEqual(
      [`${A}/`, ` ${A} `, `${A}#frag`].sort()
    );
    spelled.unmount();

    // Two capabilities under two spellings are still one relay's conflict.
    const conflict = mounted([
      { url: `${A}#frag`, read: true, write: false },
      { url: ` ${A} `, read: false, write: true }
    ]);
    expect(conflict.diagnostics().configurationError?.code).toBe('conflicting-capabilities');
    conflict.unmount();
  });

  // @contracts B-α-C17
  it('RI4: input that is not a relay is refused by this library, distinctly, before the transport is asked', async () => {
    browserLike();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    const malformed: [string, unknown][] = [
      ['a number', 42],
      ['a url that is not a string', { url: 42, read: true, write: true }],
      ['not a URL', 'not a url'],
      ['no scheme', 'example.com'],
      ['the wrong scheme', 'https://a.example'],
      ['a capability that is not a boolean', { url: 'wss://a.example', read: 'yes', write: true }]
    ];
    const messages = new Set<string>();
    for (const [label, entry] of malformed) {
      asked.length = 0;
      const provider = mounted([entry]);
      // Never handed to the transport's naming: nothing the transport was
      // handed names a relay. The empty list a provider refused at
      // construction still writes to its client is the one write this admits.
      expect(asked.flat(), label).toEqual([]);
      const refusal = provider.diagnostics().configurationError;
      expect(refusal?.code, label).toBe('invalid-relay-input');
      // It says who refused it: this library, before the transport.
      expect(refusal?.message, label).toContain(
        'nosvelte refused this, before the relay transport was asked'
      );
      expect(held(provider.diagnostics()), label).toEqual([]);
      messages.add(refusal?.message ?? '');
      provider.unmount();
    }
    expect(messages.size, 'six refusals, not one').toBe(malformed.length);

    // The controls: the same shapes, well-formed — and these the transport
    // is asked about, which is what says the record above can see an ask.
    asked.length = 0;
    const control = mounted([
      'wss://a.example',
      { url: 'wss://b.example', read: true, write: false }
    ]);
    expect(control.diagnostics().configurationError).toBeUndefined();
    expect(held(control.diagnostics())).toEqual(['wss://a.example', 'wss://b.example']);
    expect(asked.flat()).toEqual(expect.arrayContaining(['wss://a.example', 'wss://b.example']));
    control.unmount();

    // A value the refusal cannot render is refused all the same, and named.
    const unrenderable: [string, unknown, string][] = [
      ['a bigint', 1n, '1n'],
      ['an object holding itself', circular, 'an unserialisable object'],
      [
        'one whose toJSON throws',
        {
          toJSON() {
            throw new Error('the consumer’s own error');
          }
        },
        'an unserialisable object'
      ],
      ['a symbol', Symbol('s'), 'Symbol(s)']
    ];
    for (const [label, value, rendered] of unrenderable) {
      const provider = mounted([{ url: 'wss://a.example', read: value, write: true }]);
      const refusal = provider.diagnostics().configurationError;
      expect(refusal?.code, label).toBe('invalid-relay-input');
      expect(refusal?.message, label).toContain(`and was ${rendered}`);
      expect(refusal?.message, label).not.toContain('the consumer’s own error');
      provider.unmount();
    }

    // A field whose read throws is this library's refusal too — at
    // construction, and as a later change, which leaves the provider standing.
    const throwing = Object.defineProperty({ read: true, write: true }, 'url', {
      enumerable: true,
      get() {
        throw new Error('unreadable');
      }
    });
    const atConstruction = mounted([throwing]);
    expect(atConstruction.diagnostics().configurationError?.code).toBe('invalid-relay-input');
    atConstruction.unmount();
    const changed = mounted(['wss://a.example']);
    const standing = changed.diagnostics().relays;
    await changed.rerender([throwing]);
    expect(changed.diagnostics().configurationError?.code).toBe('invalid-relay-input');
    expect(changed.diagnostics().relays, 'the accepted generation stands').toBe(standing);
    changed.unmount();
  });

  // @contracts B-α-C19
  it('RI5: a capability left out is refused as absent, and one given wrong as what it was', () => {
    browserLike();
    const absent = mounted([{ url: 'wss://a.example' }]);
    const missing = absent.diagnostics().configurationError;
    expect(missing?.code).toBe('invalid-relay-input');
    expect(missing?.message).toContain('a relay read flag must be a boolean, and was absent');
    expect(missing?.message).not.toContain('was undefined');
    absent.unmount();
    // The control shows the value it was given.
    const wrong = mounted([{ url: 'wss://a.example', read: 'yes', write: true }]);
    expect(wrong.diagnostics().configurationError?.message).toContain('and was "yes"');
    wrong.unmount();
  });

  // @contracts B-α-C21
  it('RI6: a relays prop that is not a dense array is refused, and as a change leaves the provider standing', async () => {
    browserLike();
    const A = 'ws://localhost:9211';
    const a = new WS(A, { jsonProtocol: true });
    const notALists: [string, unknown][] = [
      ['one URL string', 'wss://a.example'],
      ['a Set', new Set(['wss://a.example'])],
      ['an array-like', { 0: 'wss://a.example', length: 1 }],
      ['null', null],
      ['a number', 42],
      // eslint-disable-next-line no-sparse-arrays
      ['an array with a hole', [, 'wss://a.example']]
    ];
    for (const [label, relays] of notALists) {
      // At construction: refused with a code, the children mounted.
      const constructed = mounted(relays, [(): ReqPlan => ({ kind: 'deferred' })]);
      expect(constructed.diagnostics().configurationError?.code, label).toBe('invalid-relay-input');
      expect(constructed.request(0), `${label}: the children mounted`).toBeDefined();
      constructed.unmount();

      // As a change: the previous generation, its relays and its request stand.
      const reached = (a.messages as unknown[][]).filter((frame) => frame[0] === 'REQ').length;
      const provider = mounted(
        [A],
        [(): ReqPlan => ({ kind: 'request', descriptor: { filters: [{ kinds: [1] }] } })]
      );
      await waitFor(() => {
        const frames = (a.messages as unknown[][]).filter((frame) => frame[0] === 'REQ');
        // This provider's own REQ: the server outlives the iterations.
        expect(frames.length).toBeGreaterThan(reached);
      });
      const before = provider.diagnostics().relays;
      asked.length = 0;
      await provider.rerender(relays);
      // Nothing was written to the transport: not the refused list, and not
      // an emptied one in its place. This is the internal half of "the client
      // standing"; the published half is the refresh below.
      expect(asked, `${label}: the client was not written to`).toEqual([]);
      expect(provider.diagnostics().configurationError?.code, label).toBe('invalid-relay-input');
      expect(provider.diagnostics().relays, `${label}: the generation stands`).toBe(before);
      const request = provider.request(0);
      expect(request, `${label}: the request is still mounted`).toBeDefined();
      expect(request?.state.status, `${label}: the request stands`).not.toBe('error');
      // And the client still has the relays: asked again, it asks the relay.
      const sent = (a.messages as unknown[][]).filter((frame) => frame[0] === 'REQ').length;
      void request?.refresh();
      await waitFor(() =>
        expect(
          (a.messages as unknown[][]).filter((frame) => frame[0] === 'REQ').length,
          `${label}: the client still reaches the relay`
        ).toBeGreaterThan(sent)
      );
      provider.unmount();
    }

    // The control: the same bad value inside a dense array is refused with a
    // code too — the container's shape is the only difference.
    const dense = mounted([42]);
    expect(dense.diagnostics().configurationError?.code).toBe('invalid-relay-input');
    dense.unmount();
  });
});
