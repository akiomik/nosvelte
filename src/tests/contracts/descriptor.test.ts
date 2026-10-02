/**
 * The descriptor boundary through the published hook (0003 B4): `useReq` under
 * a mounted `NostrApp`, and the published `EventList`, over a relay that speaks
 * the wire. Everything here is read from what a consumer can see — the handle's
 * state, the frames a relay receives, and whether a second request with the
 * same question is asked again — and nothing from the provider's cache. The
 * boundary's own seam is witnessed beside this, in `engine/normalize.test.ts`.
 */
import { render, waitFor } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { seckeySigner } from 'rx-nostr-crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import {
  EventList,
  type NostrSigner,
  type ReqDescriptor,
  type ReqHandle,
  type ReqPlan
} from '$lib/v1/index.js';

import Mounted from './components/Mounted.svelte';
import Beside from './descriptor/Beside.svelte';
import { cell } from './descriptor/cell.svelte.js';
import Host from './descriptor/Host.svelte';

vi.unmock('svelte');

afterEach(() => {
  WS.clean();
  vi.unstubAllGlobals();
});

const browserLike = (): void => {
  vi.stubGlobal('WebSocket', MockWebSocket);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
};

/**
 * The next frame of one type a relay receives, or a failure naming what was
 * waited for: a wait with no bound turns a missing frame into a timeout that
 * says nothing about which one.
 */
const nextOf = async (relay: WS, type: string, label = type): Promise<unknown[]> => {
  const frame = (async () => {
    for (;;) {
      const next = (await relay.nextMessage) as unknown[];
      if (next[0] === type) return next;
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no ${type} arrived: ${label}`)), 2_000);
  });
  try {
    return await Promise.race([frame, late]);
  } finally {
    clearTimeout(timer);
  }
};

const requestsTo = (relay: WS): unknown[][] =>
  (relay.messages as unknown[][]).filter((frame) => frame[0] === 'REQ');

const A = 'a'.repeat(64);
const NOT_HEX = 'g'.repeat(64);
const signer = seckeySigner(
  '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a'
) as unknown as NostrSigner;
const noteOf = (content: string) => ({
  kind: 1,
  content,
  tags: [],
  created_at: Math.floor(Date.now() / 1000)
});

/** A distinct 64-character id per index. */
const idOf = (index: number): string => index.toString(16).padStart(64, '0');

let port = 9941;
/** A relay of its own for each arrangement, so frames are never another's. */
const freshRelay = (): { url: string; relay: WS } => {
  const url = `ws://localhost:${port++}`;
  return { url, relay: new WS(url, { jsonProtocol: true }) };
};

/** One request through the published hook, and the handle it returns. */
const ask = (
  url: string,
  descriptor: unknown
): { request: () => ReqHandle; unmount: () => void } => {
  let request: ReqHandle | undefined;
  const plan = (): ReqPlan => ({ kind: 'request', descriptor: descriptor as ReqDescriptor });
  const view = render(Host, {
    relays: [url],
    plans: [plan],
    seen: (_index: number, handed: ReqHandle) => (request = handed)
  });
  return { request: () => request as ReqHandle, unmount: () => view.unmount() };
};

/** A request plan for a descriptor, and the deferred plan. */
const asking = (descriptor: unknown): ReqPlan => ({
  kind: 'request',
  descriptor: descriptor as ReqDescriptor
});
const DEFERRED: ReqPlan = { kind: 'deferred' };

/**
 * Whether a second question lands on the entry the first is on, read from the
 * handle a consumer holds: the second is set on a plan that was deferred, under
 * the same provider, after the first has its answer. On that entry it shows the
 * answer at once; on an entry of its own it is `loading` until a relay answers,
 * and these relays answer nothing more. (The REQ count cannot say it: a plan
 * that becomes a request applies the mount triggers, 0004 ruling 4, so the
 * shared entry is asked again too.) The control is a question that differs only
 * in a keyed field, which has to come out `loading`.
 */
const expectSameEntry = async (
  later: { value: ReqPlan },
  handle: () => ReqHandle | undefined,
  same: unknown,
  label: string
): Promise<void> => {
  later.value = asking(same);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(handle()?.state.status, `${label}: not the entry with the answer`).toBe('settled');
  later.value = asking({ ...(same as object), settleTimeoutMs: 4_999 });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(handle()?.state.status, `${label}: the control`).toBe('loading');
};

/** The refusal on a handle, as `code:field`. */
const refusalOf = (request: ReqHandle): string => {
  const state = request.state;
  if (state.status !== 'error') return state.status;
  return `${state.error.code}:${'field' in state.error ? String(state.error.field) : ''}`;
};

/**
 * Refused before the wire: the handle says so, and nothing is asked — read
 * after a request beside it, under its own provider, has been asked, so the
 * absence is taken after a frame would have arrived.
 */
const expectRefused = async (descriptor: unknown, refusal: string, label: string) => {
  const refused = freshRelay();
  const control = freshRelay();
  const asked = ask(refused.url, descriptor);
  const beside = ask(control.url, { filters: [{ kinds: [1] }] });
  await waitFor(() => expect(refusalOf(asked.request()), label).toBe(refusal));
  await nextOf(control.relay, 'REQ');
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(requestsTo(refused.relay), label).toHaveLength(0);
  asked.unmount();
  beside.unmount();
};

describe('the descriptor boundary, through the published hook', () => {
  // @contracts B4-C1
  it('DN1: a filter field the library cannot honour is refused, not dropped', async () => {
    browserLike();
    // A name the boundary refuses outright, one it does not know, and a tag
    // name longer than the one letter NIP-01 gives a tag.
    await expectRefused(
      { filters: [{ kinds: [1], search: 'nostr' }] },
      'unsupported-filter:search',
      'search'
    );
    await expectRefused(
      { filters: [{ kinds: [1], nonsense: 'x' }] },
      'unsupported-filter:nonsense',
      'an unknown name'
    );
    await expectRefused(
      { filters: [{ kinds: [1], '#ab': ['x'] }] },
      'unsupported-filter:#ab',
      'a two-letter tag'
    );
    // The control: the same filter without it is asked.
    const { url, relay } = freshRelay();
    const asked = ask(url, { filters: [{ kinds: [1] }] });
    expect((await nextOf(relay, 'REQ'))[2]).toEqual({ kinds: [1] });
    asked.unmount();
  });

  // @contracts B4-C4
  it('DN2: tag values and kinds are held to the rule ids and authors are', async () => {
    browserLike();
    for (const [descriptor, refusal] of [
      // The rule itself, on the fields it was written for.
      [{ filters: [{ ids: ['not-an-id'] }] }, 'unsupported-filter:ids'],
      [{ filters: [{ kinds: [1], authors: ['A'.repeat(64)] }] }, 'unsupported-filter:authors'],
      // And on the tag values that reference an event or a pubkey.
      [{ filters: [{ kinds: [1], '#e': ['not-an-id'] }] }, 'unsupported-filter:#e'],
      [{ filters: [{ kinds: [1], '#p': ['A'.repeat(64)] }] }, 'unsupported-filter:#p'],
      // And a kind past the 16 bits NIP-01 gives it.
      [{ filters: [{ kinds: [65536] }] }, 'unsupported-filter:kinds'],
      // Sixty-four lowercase characters that are not hex, on every field the
      // rule covers: the length and the case are not the whole rule.
      [{ filters: [{ ids: [NOT_HEX] }] }, 'unsupported-filter:ids'],
      [{ filters: [{ kinds: [1], authors: [NOT_HEX] }] }, 'unsupported-filter:authors'],
      [{ filters: [{ kinds: [1], '#e': [NOT_HEX] }] }, 'unsupported-filter:#e'],
      [{ filters: [{ kinds: [1], '#p': [NOT_HEX] }] }, 'unsupported-filter:#p']
    ] as const)
      await expectRefused(descriptor, refusal, JSON.stringify(descriptor));
    // The control, covering every field above: well-formed values are asked as
    // written.
    const { url, relay } = freshRelay();
    const filter = { kinds: [65535], ids: [A], authors: [A], '#e': [A], '#p': [A] };
    const asked = ask(url, { filters: [filter] });
    expect((await nextOf(relay, 'REQ'))[2]).toEqual(filter);
    asked.unmount();
  });

  // @contracts B4-C7
  it('DN3: what is stored is what was checked, and names are checked before values are read', async () => {
    browserLike();
    // (i) A filter admitted on its first answer goes out as that answer, and
    // one whose first answer is ephemeral is refused whatever it says next.
    let reads = 0;
    const admitted = Object.defineProperty({}, 'kinds', {
      enumerable: true,
      get() {
        reads += 1;
        return reads === 1 ? [1] : [20001];
      }
    });
    const { url, relay } = freshRelay();
    const asked = ask(url, { filters: [admitted] });
    expect((await nextOf(relay, 'REQ'))[2]).toEqual({ kinds: [1] });
    // (iv) And the field was read once: a boundary that checked one read and
    // sent another would have read it twice.
    expect(reads).toBe(1);
    asked.unmount();
    let answers = 0;
    const ephemeralFirst = Object.defineProperty({}, 'kinds', {
      enumerable: true,
      get() {
        answers += 1;
        return answers === 1 ? [20001] : [1];
      }
    });
    await expectRefused({ filters: [ephemeralFirst] }, 'unsupported-filter:kinds', 'ephemeral');

    // (iii) What is checked is the filter's own fields, which is what goes on
    // the wire: a `kinds` reachable only through the prototype is not sent, so
    // it cannot stand in for one — a live request without `kinds` is refused,
    // and a non-live one is asked with no `kinds` at all.
    const inherited = (): object => Object.create({ kinds: [1] }) as object;
    await expectRefused(
      { filters: [inherited()], live: true, retain: 10 },
      'unsupported-filter:kinds',
      'a prototype kinds, live'
    );
    const plain = freshRelay();
    const nonLive = ask(plain.url, { filters: [inherited()] });
    expect((await nextOf(plain.relay, 'REQ', 'a prototype kinds'))[2]).toEqual({});
    nonLive.unmount();

    // (ii) An unsupported name is refused as one before its value is read:
    // a getter that throws is never called, and a name set to `undefined` is
    // refused too, whether the boundary knows the name or not.
    let called = false;
    const throwing = Object.defineProperty({ kinds: [1] }, 'search', {
      enumerable: true,
      get() {
        called = true;
        throw new Error('the caller’s own error');
      }
    });
    await expectRefused({ filters: [throwing] }, 'unsupported-filter:search', 'throwing');
    expect(called, 'the unsupported field was read').toBe(false);
    await expectRefused(
      { filters: [{ kinds: [1], search: undefined }] },
      'unsupported-filter:search',
      'search: undefined'
    );
    await expectRefused(
      { filters: [{ kinds: [1], nonsense: undefined }] },
      'unsupported-filter:nonsense',
      'nonsense: undefined'
    );
  });

  // @contracts B4-C8
  it('DN4: each refusal names its own value, bounded, and undefined is a field not set', async () => {
    browserLike();
    const messageOf = async (descriptor: unknown): Promise<string> => {
      const { url } = freshRelay();
      const asked = ask(url, descriptor);
      await waitFor(() => expect(asked.request().state.status).toBe('error'));
      const state = asked.request().state;
      asked.unmount();
      return state.status === 'error' ? state.error.message : '';
    };
    // Four values JSON renders alike are four messages.
    const four = await Promise.all(
      [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null].map((value) =>
        messageOf({ filters: [{ kinds: [1] }], settleTimeoutMs: value })
      )
    );
    expect(new Set(four).size).toBe(4);
    for (const [message, spelled] of four.map((message, at) => [
      message,
      ['NaN', 'Infinity', '-Infinity', 'null'][at]
    ]))
      expect(message).toContain(`and was ${spelled}.`);

    // A value of a million characters is cut, keeping the field, the rule and
    // its beginning; a small one is shown whole.
    const large = await messageOf({ filters: [{ kinds: [1] }], retain: { x: 'a'.repeat(1e6) } });
    const small = await messageOf({ filters: [{ kinds: [1] }], retain: { x: 'a' } });
    expect(large.length).toBeLessThan(1_000);
    expect(large).toContain('retain must be a safe integer of at least 1');
    expect(small).toContain('and was {"x":"a"}.');
    // The beginning kept is the beginning, not a token of it: a value whose
    // characters never repeat, and its first 150 in the message.
    const alphabet = Array.from({ length: 1e6 }, (_, at) =>
      String.fromCharCode(97 + (at % 26))
    ).join('');
    const begun = await messageOf({ filters: [{ kinds: [1] }], retain: { x: alphabet } });
    expect(begun).toContain(JSON.stringify({ x: alphabet }).slice(0, 150));
    // And the cut is at a character: a two-unit character straddling the
    // bound leaves no half of itself in the message.
    const straddling = await messageOf({
      filters: [{ kinds: [1] }],
      retain: { x: `${'A'.repeat(193)}😀${'B'.repeat(1_000)}` }
    });
    expect(straddling).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);

    // Both falsy bounds are refused, not one.
    for (const bound of ['since', 'until'])
      await expectRefused(
        { filters: [{ kinds: [1], [bound]: 0 }] },
        `unsupported-filter:${bound}`,
        bound
      );

    // A field written as `undefined` is one the caller did not set, on every
    // field of a filter that takes one: asked, and the frame carries none of
    // them.
    const { url, relay } = freshRelay();
    const unset = {
      kinds: [1],
      ids: undefined,
      authors: undefined,
      since: undefined,
      until: undefined,
      limit: undefined,
      '#e': undefined,
      '#p': undefined
    };
    const asked = ask(url, { filters: [unset] });
    expect((await nextOf(relay, 'REQ'))[2]).toEqual({ kinds: [1] });
    asked.unmount();
  });

  // @contracts B4-C9
  it('DN5: one snapshot per evaluation: a write after the REQ moves neither the frame nor the entry', async () => {
    browserLike();
    // The caller's own arrays, written to after the frame has gone out. The
    // write is not seen: no second frame, the answer is judged by the filter
    // that was asked — the event the write added is not taken — and the entry
    // is still the one the original question lands on. (Whether the boundary
    // itself copied the arrays is `NM8`'s: on this path the wire's own copy at
    // send time would hide a boundary that kept them.)
    const first = (await signer.signEvent(noteOf('asked'))) as Nostr.Event;
    const added = (await signer.signEvent(noteOf('added later'))) as Nostr.Event;
    const ids = [first.id];
    const filters = [{ ids, limit: 1 }];
    const later = cell<ReqPlan>(DEFERRED);
    const { url, relay } = freshRelay();
    let request: ReqHandle | undefined;
    let second: ReqHandle | undefined;
    const view = render(Host, {
      relays: [url],
      plans: [() => asking({ filters }), () => later.value],
      seen: (index: number, handed: ReqHandle) => {
        if (index === 0) request = handed;
        else second = handed;
      }
    });
    const [, subscription, sent] = await nextOf(relay, 'REQ', 'the first ask');
    expect(sent).toEqual({ ids: [first.id], limit: 1 });
    ids.push(added.id);
    filters.push({ ids: [added.id], limit: 1 });
    relay.send(['EVENT', subscription, first]);
    relay.send(['EVENT', subscription, added]);
    relay.send(['EOSE', subscription]);
    await waitFor(() => expect(request?.state.status).toBe('settled'));
    const state = request?.state;
    expect(state?.status === 'settled' && state.events.map((event) => event.id)).toEqual([
      first.id
    ]);
    expect(requestsTo(relay)).toHaveLength(1);
    await expectSameEntry(
      later,
      () => second,
      { filters: [{ ids: [first.id], limit: 1 }] },
      'the original question'
    );
    view.unmount();

    // A component's source that answers differently on every read: the frame's
    // `limit` belongs to the `ids` beside it, and the entry is the one a
    // consumer's own request for that pair lands on.
    let answers = 0;
    const source = freshRelay();
    const beside = cell<ReqPlan>(DEFERRED);
    let own: ReqHandle | undefined;
    const mounted = render(Beside, {
      relays: [source.url],
      given: Object.defineProperty({}, 'ids', {
        enumerable: true,
        get() {
          answers += 1;
          return Array.from({ length: answers + 1 }, (_, at) => idOf(100 + at));
        }
      }),
      plan: () => beside.value,
      seen: (handed: ReqHandle) => (own = handed)
    });
    const [, componentSubscription, componentFrame] = await nextOf(
      source.relay,
      'REQ',
      'the component'
    );
    const frame = componentFrame as { ids: string[]; limit: number };
    source.relay.send(['EOSE', componentSubscription]);
    expect(frame.ids.length).toBeGreaterThan(1);
    expect(frame.limit).toBe(frame.ids.length);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expectSameEntry(
      beside,
      () => own,
      { filters: [{ ids: frame.ids, limit: frame.limit }] },
      'the component'
    );
    mounted.unmount();
  });

  // @contracts B4-C11
  it('DN6: a list of exactly ten thousand ids is asked, and one more is refused by name', async () => {
    browserLike();
    const ten = Array.from({ length: 10_000 }, (_, at) => idOf(at));
    const { url, relay } = freshRelay();
    const view = render(Mounted, { relays: [url], which: EventList, given: { ids: ten } });
    const frame = (await nextOf(relay, 'REQ'))[2] as { ids: string[]; limit: number };
    expect(frame.ids).toEqual(ten);
    expect(frame.limit).toBe(10_000);
    view.unmount();

    const over = freshRelay();
    const control = freshRelay();
    let handed: ReqHandle | undefined;
    const refused = render(Mounted, {
      relays: [over.url],
      which: EventList,
      given: { ids: [...ten, idOf(10_000)] },
      seen: (_outlet: string, request: ReqHandle) => (handed = request)
    });
    const beside = render(Mounted, {
      relays: [control.url],
      which: EventList,
      given: { ids: ten }
    });
    await waitFor(() => expect(handed && refusalOf(handed)).toBe('unsupported-filter:ids'));
    await nextOf(control.relay, 'REQ');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requestsTo(over.relay)).toHaveLength(0);
    refused.unmount();
    beside.unmount();
  });
});
