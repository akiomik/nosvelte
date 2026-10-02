/**
 * The request components (0004 C7's descriptor table, C4b's outlets, ruling
 * 18), each mounted for real under a provider, over a relay that speaks the
 * wire. What each one should ask is written out here from 0004's table rather
 * than taken from the implementation's, so the two are compared rather than
 * one copied into the other.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render, waitFor, within } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { getPublicKey, seckeySigner } from 'rx-nostr-crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import {
  Article,
  Contacts,
  Event,
  EventList,
  Metadata,
  Mute,
  type NostrSigner,
  Pin,
  RelayListMetadata,
  type ReqDescriptor,
  type ReqHandle,
  Text,
  UniqueEventList,
  UserReactionList
} from '$lib/v1/index.js';

import Mounted from './components/Mounted.svelte';
import Twin from './components/Twin.svelte';
import type { RequestComponent } from './components/types.js';

vi.unmock('svelte');

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const SECKEY = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';
const PUBKEY = getPublicKey(SECKEY);
const signer = seckeySigner(SECKEY) as unknown as NostrSigner;

afterEach(() => {
  WS.clean();
  vi.unstubAllGlobals();
});

const browserLike = (): void => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
};

const nextOf = async (relay: WS, type: string): Promise<unknown[]> => {
  for (;;) {
    const frame = (await relay.nextMessage) as unknown[];
    if (frame[0] === type) return frame;
  }
};

const sign = async (kind: number, tags: string[][] = []): Promise<Nostr.Event> =>
  (await signer.signEvent({
    kind,
    content: `kind ${kind}`,
    tags,
    created_at: Math.floor(Date.now() / 1000)
  })) as Nostr.Event;

/** What one mounted component shows under a test id. */
const shownIn =
  (container: HTMLElement) =>
  (id: string): string | null =>
    within(container).getByTestId(id).textContent;

/** The REQ frames a relay has received so far. */
const requestsTo = (relay: WS): unknown[][] =>
  (relay.messages as unknown[][]).filter((frame) => frame[0] === 'REQ');

/** Whether a relay holding `event` would send it for `filter`. */
const matches = (filter: Record<string, unknown>, event: Nostr.Event): boolean => {
  const ids = filter['ids'] as string[] | undefined;
  const kinds = filter['kinds'] as number[] | undefined;
  const authors = filter['authors'] as string[] | undefined;
  const d = filter['#d'] as string[] | undefined;
  return (
    (ids === undefined || ids.includes(event.id)) &&
    (kinds === undefined || kinds.includes(event.kind)) &&
    (authors === undefined || authors.includes(event.pubkey)) &&
    (d === undefined || event.tags.some((tag) => tag[0] === 'd' && d.includes(tag[1] ?? '')))
  );
};

/** Answer every REQ the relay receives from `pool`, then end the backlog. */
const serve = (relay: WS, pool: () => Nostr.Event[]): void => {
  relay.on('connection', (socket) => {
    socket.on('message', (data) => {
      const [type, id, ...filters] = JSON.parse(String(data)) as [
        string,
        string,
        ...Record<string, unknown>[]
      ];
      if (type !== 'REQ') return;
      for (const event of pool())
        if (filters.some((filter) => matches(filter, event)))
          socket.send(JSON.stringify(['EVENT', id, event]));
      socket.send(JSON.stringify(['EOSE', id]));
    });
  });
};

interface Row {
  name: string;
  component: RequestComponent;
  shape: 'event' | 'events';
  /** The props, given the event the relay will hold for it. */
  props: (event: Nostr.Event) => Record<string, unknown>;
  /** 0004's row for those props, written out by hand. */
  descriptor: (event: Nostr.Event) => ReqDescriptor;
  /** The kind and tags of the event the row asks for. */
  kind: number;
  tags?: string[][];
  /** Props the descriptor boundary refuses. */
  refused: Record<string, unknown>;
}

const latest = (name: string, component: RequestComponent, kind: number): Row => ({
  name,
  component,
  shape: 'event',
  props: () => ({ pubkey: PUBKEY }),
  descriptor: () => ({ filters: [{ kinds: [kind], authors: [PUBKEY], limit: 1 }] }),
  kind,
  refused: { pubkey: 'not-a-pubkey' }
});
const byId = (name: string, component: RequestComponent): Row => ({
  name,
  component,
  shape: 'event',
  props: (event) => ({ id: event.id }),
  descriptor: (event) => ({ filters: [{ ids: [event.id], limit: 1 }] }),
  kind: 1,
  refused: { id: 'not-an-id' }
});
/**
 * A second id beside the row's own, so a list asks for two: with one, a
 * `limit` of `ids.length` and a fixed `1` are the same filter.
 */
const OTHER_ID = 'f'.repeat(64);
const byIds = (name: string, component: RequestComponent): Row => ({
  name,
  component,
  shape: 'events',
  props: (event) => ({ ids: [event.id, OTHER_ID] }),
  descriptor: (event) => ({ filters: [{ ids: [event.id, OTHER_ID], limit: 2 }] }),
  kind: 1,
  refused: { ids: ['not-an-id'] }
});

/** The eleven, as 0004's table lists them. */
const ROWS: Row[] = [
  byId('Event', Event),
  byId('Text', Text),
  byIds('EventList', EventList),
  byIds('UniqueEventList', UniqueEventList),
  latest('Metadata', Metadata, 0),
  latest('Contacts', Contacts, 3),
  latest('Mute', Mute, 10000),
  latest('Pin', Pin, 10001),
  latest('RelayListMetadata', RelayListMetadata, 10002),
  {
    name: 'Article',
    component: Article,
    shape: 'event',
    props: () => ({ pubkey: PUBKEY, identifier: 'an-article' }),
    descriptor: () => ({
      filters: [{ kinds: [30023], authors: [PUBKEY], '#d': ['an-article'], limit: 1 }]
    }),
    kind: 30023,
    tags: [['d', 'an-article']],
    refused: { pubkey: 'not-a-pubkey', identifier: 'an-article' }
  },
  {
    name: 'UserReactionList',
    component: UserReactionList,
    shape: 'events',
    props: () => ({ pubkey: PUBKEY }),
    descriptor: () => ({
      filters: [{ kinds: [7], authors: [PUBKEY], limit: 100 }],
      retain: 100
    }),
    kind: 7,
    refused: { pubkey: 'not-a-pubkey' }
  }
];

describe('the request components', () => {
  // @contracts C7-C7
  it('CM1: each component lands on the entry its descriptor, handed to useReq, lands on', async () => {
    browserLike();
    const url = 'ws://localhost:9841';
    new WS(url, { jsonProtocol: true });
    for (const row of ROWS) {
      const event = await sign(row.kind, row.tags);
      for (const [given, descriptor, entries] of [
        // The row as written: one entry between them.
        [row.props(event), row.descriptor(event), 1],
        // And under a namespace, which the component passes on.
        [
          { ...row.props(event), namespace: 'elsewhere' },
          { ...row.descriptor(event), namespace: 'elsewhere' },
          1
        ],
        // The controls: one keyed field guessed differently is a second entry,
        // with and without the namespace — the namespaced arm above is
        // satisfied by the hand-written entry alone if the component makes
        // none, and this is what says it does.
        [row.props(event), { ...row.descriptor(event), settleTimeoutMs: 4_999 }, 2],
        [
          { ...row.props(event), namespace: 'elsewhere' },
          { ...row.descriptor(event), namespace: 'elsewhere', settleTimeoutMs: 4_999 },
          2
        ]
      ] as const) {
        let keys = (): string[] => [];
        const view = render(Twin, {
          relays: [url],
          which: row.component,
          given,
          descriptor,
          expose: (read: () => string[]) => (keys = read)
        });
        await waitFor(() => expect(keys(), row.name).toHaveLength(entries));
        view.unmount();
      }
    }
  });

  // @contracts C4b-C3
  it('CM2: every outlet of every component is handed the one request, and it is a working handle', async () => {
    browserLike();
    const url = 'ws://localhost:9851';
    const relay = new WS(url, { jsonProtocol: true });
    let pool: Nostr.Event[] = [];
    serve(relay, () => pool);
    for (const row of ROWS) {
      const event = await sign(row.kind, row.tags);
      const arrangements: [string, Nostr.Event[], Record<string, unknown>, string[], string][] = [
        // Answered: loading while asked, then the default outlet with the event.
        ['answered', [event], row.props(event), ['loading', 'default'], `${row.shape}:${event.id}`],
        // Asked and told nothing exists: nodata.
        ['empty', [], row.props(event), ['loading', 'nodata'], 'settled:0:false'],
        // Refused before the wire: the error outlet, with the state's own Error.
        ['refused', [], row.refused, ['loading', 'error'], 'unsupported-filter:same']
      ];
      for (const [name, held, given, outlets, shown] of arrangements) {
        pool = held;
        const handed: [string, ReqHandle, string][] = [];
        const view = render(Mounted, {
          relays: [url],
          which: row.component,
          given,
          seen: (outlet: string, request: ReqHandle) =>
            handed.push([outlet, request, request.activity])
        });
        const read = shownIn(view.container);
        const label = `${row.name} ${name}`;
        await waitFor(() => expect(read('outlet'), label).toBe(outlets.at(-1)));
        expect(read('shown'), label).toBe(shown);
        // Each outlet the arrangement passes through was rendered, and every
        // one was handed a request — the same one, with the four members a
        // consumer's own handle has.
        expect([...new Set(handed.map(([outlet]) => outlet))], label).toEqual(outlets);
        const requests = new Set(handed.map(([, request]) => request));
        expect(requests.size, label).toBe(1);
        const [request] = requests;
        expect(Object.keys(request ?? {}).sort(), label).toEqual([
          'activity',
          'diagnostics',
          'refresh',
          'state'
        ]);
        // And it is the request itself rather than a view of its state: the
        // loading outlet of an asked request reads it fetching, the default
        // outlet is handed nothing but the event or events and the request,
        // its diagnostics are the request's (empty, for a clean answer, in the
        // published shape), and its `refresh()` asks the relay again.
        if (name === 'answered') {
          expect(handed.find(([outlet]) => outlet === 'loading')?.[2], label).toBe('refreshing');
          expect(read('argument'), label).toBe(`${row.shape},request`);
          expect(request?.diagnostics, label).toStrictEqual({
            lastError: undefined,
            legEnded: undefined,
            refusals: []
          });
          const before = requestsTo(relay).length;
          expect(await request?.refresh(), label).toEqual({ kind: 'complete' });
          expect(requestsTo(relay).length, label).toBe(before + 1);
        }
        view.unmount();
      }
    }
  });

  // @contracts C12-C8
  it('CM3: a single-event component over an expired answer renders nodata; a list renders it empty', async () => {
    browserLike();
    const url = 'ws://localhost:9861';
    const relay = new WS(url, { jsonProtocol: true });
    const pool: Nostr.Event[] = [];
    serve(relay, () => pool);
    // Every event expires a few seconds from now, after the backlog has ended.
    const deadline = Math.floor(Date.now() / 1000) + 3;
    const views: [Row, Nostr.Event, (id: string) => string | null][] = [];
    for (const row of ROWS.filter(
      (candidate) => candidate.shape === 'event' || candidate.name === 'EventList'
    )) {
      const event = await sign(row.kind, [...(row.tags ?? []), ['expiration', String(deadline)]]);
      pool.push(event);
      const view = render(Mounted, {
        relays: [url],
        which: row.component,
        given: row.props(event)
      });
      views.push([row, event, shownIn(view.container)]);
    }
    expect(views.map(([row]) => row.name)).toHaveLength(9);

    // Before the deadline, each shows its event.
    for (const [row, event, read] of views) {
      await waitFor(() => expect(read('outlet'), row.name).toBe('default'));
      expect(read('shown'), row.name).toBe(`${row.shape}:${event.id}`);
    }
    expect(Date.now() / 1000, 'the first read was before the deadline').toBeLessThan(deadline);

    // After it, the eight render nodata over a request that still reports the
    // match, and the list control renders its default outlet over nothing.
    for (const [row, , read] of views) {
      await waitFor(
        () => {
          if (row.shape === 'event') {
            expect(read('outlet'), row.name).toBe('nodata');
            expect(read('shown'), row.name).toBe('settled:0:true');
          } else {
            expect(read('outlet'), row.name).toBe('default');
            expect(read('shown'), row.name).toBe('events:');
          }
        },
        { timeout: 6_000 }
      );
    }
  }, 15_000);

  // @contracts C7-C6
  it('CM4: UserReactionList puts one limit in the filter and the retention, and refuses a bad one', async () => {
    browserLike();
    const reactionsOf = (limit: number): ReqDescriptor => ({
      filters: [{ kinds: [7], authors: [PUBKEY], limit }],
      retain: limit
    });
    let port = 9871;

    // Omitted is 100 and `5` is 5, on the wire and in the retention: the
    // component lands on the entry the hand-written descriptor lands on, and a
    // retention guessed differently does not.
    for (const [given, limit] of [
      [{ pubkey: PUBKEY }, 100],
      [{ pubkey: PUBKEY, limit: 5 }, 5]
    ] as const) {
      for (const [descriptor, entries] of [
        [reactionsOf(limit), 1],
        [{ ...reactionsOf(limit), retain: limit + 1 }, 2]
      ] as const) {
        const url = `ws://localhost:${port++}`;
        const relay = new WS(url, { jsonProtocol: true });
        let keys = (): string[] => [];
        const view = render(Twin, {
          relays: [url],
          which: UserReactionList,
          given,
          descriptor,
          expose: (read: () => string[]) => (keys = read)
        });
        expect((await nextOf(relay, 'REQ'))[2]).toEqual({
          kinds: [7],
          authors: [PUBKEY],
          limit
        });
        await waitFor(() => expect(keys(), `limit ${limit}`).toHaveLength(entries));
        view.unmount();
      }
    }

    // Each bad value is a typed refusal naming the descriptor field the
    // boundary checks first, and nothing is asked: `0` passes as a filter
    // bound and is refused as the retention; the others are refused as the
    // filter's `limit`.
    for (const [limit, refusal] of [
      [0, 'invalid-descriptor:retain'],
      [1.5, 'unsupported-filter:limit'],
      [Number.NaN, 'unsupported-filter:limit'],
      [-1, 'unsupported-filter:limit']
    ] as const) {
      const url = `ws://localhost:${port++}`;
      const relay = new WS(url, { jsonProtocol: true });
      // Mounted beside it, the same component with a valid limit: the wait for
      // its REQ is what makes "none was sent" a reading taken after one would
      // have been, rather than one taken early.
      const controlUrl = `ws://localhost:${port++}`;
      const controlRelay = new WS(controlUrl, { jsonProtocol: true });
      let handed: ReqHandle | undefined;
      const view = render(Mounted, {
        relays: [url],
        which: UserReactionList,
        given: { pubkey: PUBKEY, limit },
        seen: (_outlet: string, request: ReqHandle) => (handed = request)
      });
      const control = render(Mounted, {
        relays: [controlUrl],
        which: UserReactionList,
        given: { pubkey: PUBKEY, limit: 5 }
      });
      await waitFor(() => expect(shownIn(view.container)('outlet')).toBe('error'));
      const error = handed?.state.status === 'error' ? handed.state.error : undefined;
      expect(`${error?.code}:${error !== undefined && 'field' in error ? error.field : ''}`).toBe(
        refusal
      );
      await nextOf(controlRelay, 'REQ');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(requestsTo(relay), `limit ${limit}`).toHaveLength(0);
      view.unmount();
      control.unmount();
    }

    // A getter answering differently per read is taken once per question: the
    // filter's bound and the retention are one of its answers, never two.
    let answers = 0;
    const url = `ws://localhost:${port}`;
    const relay = new WS(url, { jsonProtocol: true });
    let keys = (): string[] => [];
    render(Mounted, {
      relays: [url],
      which: UserReactionList,
      given: {
        pubkey: PUBKEY,
        get limit() {
          return 10 + ++answers;
        }
      },
      expose: (read: () => string[]) => (keys = read)
    });
    const asked = (await nextOf(relay, 'REQ'))[2] as { limit: number };
    let control = (): string[] => [];
    const twin = render(Twin, {
      relays: [url],
      which: UserReactionList,
      given: { pubkey: PUBKEY, limit: asked.limit },
      descriptor: reactionsOf(asked.limit),
      expose: (read: () => string[]) => (control = read)
    });
    await waitFor(() => expect(control()).toHaveLength(1));
    // One value reached the cache and the wire, however often the plan was
    // read: the component's entry is the hand-written one for that value, and
    // it is the only entry and the only question asked.
    expect(keys()).toEqual(control());
    expect(requestsTo(relay)).toHaveLength(1);
    twin.unmount();
  });

  it('CM5: a list reads its ids once per question, so its limit counts the ids it asks for', async () => {
    browserLike();
    for (const [index, component] of [EventList, UniqueEventList].entries()) {
      const url = `ws://localhost:${9891 + index}`;
      const relay = new WS(url, { jsonProtocol: true });
      // A source that grows on every read: two reads would ask for one list
      // and bound it by the length of the next.
      let reads = 0;
      render(Mounted, {
        relays: [url],
        which: component,
        given: {
          get ids() {
            reads += 1;
            return Array.from({ length: reads + 1 }, (_, at) => String(at).repeat(64));
          }
        }
      });
      const [, , filter] = (await nextOf(relay, 'REQ')) as [string, string, Nostr.Filter];
      expect(reads, 'the source was read').toBeGreaterThan(0);
      expect(filter.ids?.length).toBeGreaterThan(1);
      expect(filter.limit).toBe(filter.ids?.length);
    }
  });

  it('CM6: the table is the entry: every component it exports, each under its own name', async () => {
    const entry = (await import('$lib/v1/index.js')) as Record<string, unknown>;
    const source = readFileSync(join(REPO, 'src/lib/v1/index.ts'), 'utf8');
    const exported = [...source.matchAll(/default as (\w+) \} from '\.\/components\//g)]
      .map((match) => match[1])
      .filter((name) => name !== 'NostrApp');
    // 0004's published list, besides the provider.
    expect(exported.sort()).toEqual(
      [
        'Article',
        'Contacts',
        'Event',
        'EventList',
        'Metadata',
        'Mute',
        'Pin',
        'RelayListMetadata',
        'Text',
        'UniqueEventList',
        'UserReactionList'
      ].sort()
    );
    expect(ROWS.map((row) => row.name).sort()).toEqual(exported.sort());
    for (const row of ROWS) expect(row.component, row.name).toBe(entry[row.name]);
    expect(new Set(ROWS.map((row) => row.component)).size).toBe(ROWS.length);
  });
});
