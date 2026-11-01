/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What a consumer's console sees of a failure and of a handle it kept: the
 * landing of `C5-C8` (`CW1`), the edge of what that row excludes (`CW2`), and
 * the landing of `C5-C9` (`CW3`).
 *
 * **Public, which is why this is not `C5-C6`.** That row's population is the
 * reach arm's, and it goes through seams no consumer has. Everything here but
 * the control of `CW2`, which has no library in it, is built from `NostrApp`,
 * `useReq` and the relay's wire.
 *
 * **`npm test` runs all three again with `NODE_ENV=production`**, since a build's
 * console is not a development one's. `CW2` is what says that run is that build.
 *
 * Port band 10580-10599.
 */
import { render } from '@testing-library/svelte';
import type Nostr from 'nostr-typedef';
import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { NostrContext } from '$lib/v1/context.svelte.js';
import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
import { REQ_ERROR_CODES, type ReqErrorCode } from '$lib/v1/reqerror.js';

import DerivedRequest from './fixtures/DerivedRequest.svelte';
import KeptEffect from './fixtures/KeptEffect.svelte';
import KeptRequest from './fixtures/KeptRequest.svelte';
import { NOTHING_WRITTEN } from './helpers/console.js';
import { leaseOf, respondWithEose } from './helpers/relay.js';
import { signed } from './helpers/request.js';
import { box } from './helpers/runes.svelte.js';

vi.unmock('svelte');

const watch = await vi.hoisted(async () => {
  const { watchConsole } = await import('./helpers/console.js');
  return watchConsole();
});

afterAll(() => {
  watch.release();
});

let port = 10580;
const nextUrl = (): string => `ws://localhost:${String((port += 1))}`;

afterEach(() => {
  WS.clean();
});

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

async function settle(ms = 120): Promise<void> {
  await delay(ms);
  flushSync();
}

/** The subscriptions the relay has been asked for, oldest first. */
const asked = (server: WS): string[] =>
  (server.messages as unknown[][])
    .filter((frame) => frame[0] === 'REQ')
    .map((frame) => String(frame[1]));

/** The `count`th subscription the relay was asked for on `leg`, once it has been. */
async function subscription(server: WS, leg: '-b:' | '-f:', count: number): Promise<string> {
  const onTheLeg = (): string[] => asked(server).filter((name) => name.includes(leg));
  await vi.waitFor(() => expect(onTheLeg().length).toBeGreaterThanOrEqual(count), {
    timeout: 3000
  });
  return onTheLeg()[count - 1] as string;
}

/** The refused and the rejected say `code`, so an answer is read as one line. */
const answerOf = (call: Promise<unknown>): Promise<string> =>
  call.then(
    (outcome) => {
      const { kind, reason } = outcome as { kind: string; reason?: string };
      return reason === undefined ? kind : `${kind} ${reason}`;
    },
    (rejected: { code?: string }) => `rejected ${String(rejected.code)}`
  );

/** What these rows read off a handle, at one instant. */
interface Reading {
  readonly status: string;
  readonly code: ReqErrorCode | undefined;
  readonly activity: string;
  readonly last: ReqErrorCode | undefined;
  readonly ended: ReqErrorCode | undefined;
}

const failureOf = ({ state }: ReqHandle) =>
  state.status === 'error' || state.status === 'incomplete' ? state.error : undefined;

const readingOf = (handle: ReqHandle): Reading => {
  const { state } = handle;
  return {
    status: state.status,
    code: failureOf(handle)?.code,
    activity: handle.activity,
    last: handle.diagnostics.lastError?.code,
    ended: (handle.diagnostics.legEnded as { error?: { code: ReqErrorCode } } | undefined)?.error
      ?.code
  };
};

/** How each failure a consumer can reach is built, and what it answers. */
interface Path {
  readonly name: string;
  readonly plan: ReqPlan;
  /** No provider above the consumer. */
  readonly bare?: boolean;
  /** What the relay does with the `attempt`th request. */
  readonly relay?: (server: WS, attempt: number) => Promise<void>;
  /** What the handle says, at every reading. */
  readonly reads: Reading;
  /** What `refresh()` answers while the consumer is mounted. */
  readonly answers: string;
}

const request = (descriptor: object): ReqPlan =>
  ({ kind: 'request', descriptor: { filters: [{ kinds: [1] }], ...descriptor } }) as ReqPlan;

const live = (settleTimeoutMs: number): ReqPlan =>
  request({ live: true, retain: 'unbounded', settleTimeoutMs });

/** A request refused before it reached a relay. */
const refused = (code: ReqErrorCode): Pick<Path, 'reads' | 'answers'> => ({
  reads: { status: 'error', code, activity: 'idle', last: code, ended: undefined },
  answers: `rejected ${code}`
});

/** An answer that is partial, with `activity` beside it. */
const partial = (activity: 'idle' | 'live'): Pick<Path, 'reads' | 'answers'> => ({
  reads: {
    status: 'incomplete',
    code: 'incomplete-result',
    activity,
    last: 'incomplete-result',
    ended: undefined
  },
  answers: 'incomplete'
});

/** A request settled with nothing on the failure axes but `ended`. */
const settled = (
  activity: 'idle' | 'live',
  ended?: ReqErrorCode
): Pick<Path, 'reads' | 'answers'> => ({
  reads: { status: 'settled', code: undefined, activity, last: undefined, ended },
  answers: 'complete'
});

const PATHS: readonly Path[] = [
  { name: 'no provider', bare: true, plan: request({}), ...refused('missing-provider') },
  {
    name: 'a refused field',
    plan: request({ settleTimeoutMs: -1 }),
    ...refused('invalid-descriptor')
  },
  {
    name: 'a refused filter',
    plan: request({ filters: [{ search: 'x' }] }),
    ...refused('unsupported-filter')
  },
  {
    name: 'a relay outside the scope',
    plan: request({ relays: ['ws://outside.test'] }),
    ...refused('relay-not-in-scope')
  },
  {
    name: 'a descriptor that throws',
    plan: {
      kind: 'request',
      get descriptor(): never {
        throw new Error('the descriptor blew up');
      }
    } as ReqPlan,
    ...refused('descriptor-unreadable')
  },
  { name: 'a timeout', plan: request({ settleTimeoutMs: 100 }), ...partial('idle') },
  { name: 'a live timeout', plan: live(100), ...partial('live') },
  {
    name: 'a relay that refuses',
    plan: request({ settleTimeoutMs: 300 }),
    relay: async (server, attempt) => {
      server.send(['CLOSED', await subscription(server, '-b:', attempt), 'blocked: not you']);
    },
    ...partial('idle')
  },
  {
    name: 'a relay that ends the live leg',
    plan: live(300),
    relay: async (server, attempt) => {
      respondWithEose(server, await subscription(server, '-b:', attempt));
      server.send(['CLOSED', await subscription(server, '-f:', attempt), 'error: going away']);
    },
    ...settled('idle', 'relay-failed')
  },
  {
    name: 'nothing wrong',
    plan: request({ settleTimeoutMs: 300 }),
    relay: async (server, attempt) => {
      respondWithEose(server, await subscription(server, '-b:', attempt));
    },
    ...settled('idle')
  },
  {
    name: 'a live request still running',
    plan: live(300),
    relay: async (server, attempt) => {
      respondWithEose(server, await subscription(server, '-b:', attempt));
    },
    ...settled('live')
  }
];

/** The codes none of `PATHS` reach, each for the reason `C5-C8` gives. */
const NOT_PUBLIC: readonly ReqErrorCode[] = [
  'accumulator-contract',
  'unspecified',
  'transport-incompatible'
];

/** The code of a request its own root keeps past `NostrApp`, which only a `refresh()` carries. */
const OUTLIVED: ReqErrorCode = 'provider-disposed';

describe('C5: what a consumer’s console sees', () => {
  // @contracts C5-C8
  it('CW1: no public failure writes to the console, and neither does reading a handle its consumer left behind', async () => {
    // **Every path is read the same way**, and the read after the consumer has
    // gone is the row's other half, so a request with nothing wrong is on the
    // list: the write this row was found by needs no failure at all. The plan
    // reads a `$derived` of the consumer, as an ordinary one does.
    //
    // **The consumer goes twice**: from under a provider left standing, read
    // twice since one read says nothing about the next, and then with the whole
    // tree, read again. Every reading is the one from before, which is
    // `A12-C5`'s rule for a released handle, and the last answer is `C11-C19`'s.
    // The Error is one object at all of them, on the state and in the diagnostics.
    //
    // **The population is checked against the code list**, so a code added to
    // the library is placed here or named as none of these paths'.
    const run = async (path: Path) => {
      const url = nextUrl();
      const server = new WS(url, { jsonProtocol: true });
      let handle: ReqHandle | undefined;
      const seen = (request: ReqHandle): void => {
        handle = request;
      };
      const plan = (): ReqPlan => path.plan;
      const view =
        path.bare === true
          ? render(DerivedRequest, { plan, seen })
          : render(KeptRequest, { relays: [url], plan, mounted: true, seen });
      const held = handle as unknown as ReqHandle;
      await path.relay?.(server, 1);
      await settle();
      const reading = readingOf(held);
      const call = answerOf(held.refresh());
      await path.relay?.(server, 2);
      const answer = await Promise.race([call, delay(2000).then(() => 'unanswered')]);
      await settle();
      const answered = readingOf(held);
      const error = failureOf(held);
      if (path.bare !== true) {
        await view.rerender({ mounted: false } as never);
        await settle(40);
      }
      const left = [readingOf(held), readingOf(held)];
      view.unmount();
      await settle(40);
      left.push(readingOf(held));
      return {
        reading,
        answer,
        answered,
        left,
        again: await answerOf(held.refresh()),
        oneError:
          error === undefined
            ? 'no failure'
            : failureOf(held) === error && held.diagnostics.lastError === error
      };
    };

    // **And one that goes before its effects ran**: mounted and unmounted in
    // one tick, with Svelte's own two calls, read in between so that there is a
    // value to go stale. Nothing is opened for it, and its `refresh()` says so.
    const mounted = (plan: () => ReqPlan) => {
      const url = nextUrl();
      const server = new WS(url, { jsonProtocol: true });
      let handle: ReqHandle | undefined;
      const consumer = mount(KeptRequest, {
        target: document.body.appendChild(document.createElement('div')),
        props: {
          relays: [url],
          plan,
          mounted: true,
          seen: (request: ReqHandle): void => {
            handle = request;
          }
        }
      });
      return { server, consumer, held: handle as unknown as ReqHandle };
    };

    const early = async () => {
      const { server, consumer, held } = mounted(() => request({ settleTimeoutMs: 300 }));
      const reading = readingOf(held);
      await unmount(consumer);
      const answer = await answerOf(held.refresh());
      await settle(40);
      return { reading, left: readingOf(held), answer, asked: asked(server) };
    };

    // **A kept handle says the last `live` it actually observed**, which is
    // `A12-C5`'s last value observed, and the handle's rather than the
    // consumer's. So the plan changes as the consumer goes, and three ways: read
    // by `activity`, built by the options with `activity` last read before that,
    // and neither, which leaves it out. The first and the last differ only by a
    // read, and that is the row's to say. Then `activity` is never read at all.
    const changed = async (way: 'read' | 'built' | 'neither') => {
      const plan = box(request({ settleTimeoutMs: 30_000 }));
      const { server, consumer, held } = mounted(() => plan.current);
      await subscription(server, '-b:', 1);
      const before = held.activity;
      plan.current = live(30_000);
      if (way === 'built') flushSync();
      const read = way === 'read' ? held.activity : 'not read';
      await unmount(consumer);
      return { before, read, left: held.activity };
    };

    const unread = async () => {
      const { server, consumer, held } = mounted(() => live(30_000));
      await subscription(server, '-b:', 1);
      flushSync();
      await unmount(consumer);
      return held.activity;
    };

    // **And one that outlives `NostrApp`**, in a root of its own, which is the
    // way a consumer reaches `provider-disposed`. Its plan is left as it was: a
    // request that is alive reads its plan, and one that changes reads the
    // `$derived` of a component that has gone, which is `C5-C8`'s exclusion.
    const outlived = async () => {
      const url = nextUrl();
      const server = new WS(url, { jsonProtocol: true });
      let handle: ReqHandle | undefined;
      let stop = (): void => undefined;
      const view = render(KeptRequest, {
        relays: [url],
        plan: () => request({ settleTimeoutMs: 300 }),
        mounted: true,
        seen: (request: ReqHandle): void => {
          handle = request;
        },
        rooted: (ending: () => void): void => {
          stop = ending;
        }
      });
      const held = handle as unknown as ReqHandle;
      respondWithEose(server, await subscription(server, '-b:', 1));
      await settle();
      const reading = readingOf(held);
      view.unmount();
      await settle(40);
      const left = readingOf(held);
      const answer = await answerOf(held.refresh());
      const after = readingOf(held);
      stop();
      await settle(40);
      return { reading, left, answer, after };
    };

    const readings: Record<string, unknown> = {};
    for (const path of PATHS) readings[path.name] = await run(path);
    const leftEarly = await early();
    const leftChanged = await changed('read');
    const leftBuilt = await changed('built');
    const leftPending = await changed('neither');
    const leftUnread = await unread();
    const leftOutlived = await outlived();
    const placed = new Set<string>([
      ...PATHS.flatMap(({ reads: { code, ended } }) => [code, ended]),
      ...NOT_PUBLIC,
      OUTLIVED
    ] as string[]);
    const waiting = {
      status: 'loading',
      code: undefined,
      activity: 'refreshing',
      last: undefined,
      ended: undefined
    };
    expect(
      {
        written: watch.reading(),
        unplaced: REQ_ERROR_CODES.filter((code) => !placed.has(code)),
        readings,
        leftEarly,
        leftChanged,
        leftBuilt,
        leftPending,
        leftUnread,
        leftOutlived
      },
      'nothing written, every method watched, and every reading what the path says'
    ).toEqual({
      written: NOTHING_WRITTEN,
      unplaced: [],
      readings: Object.fromEntries(
        PATHS.map(({ name, reads, answers }) => [
          name,
          {
            reading: reads,
            answer: answers,
            answered: reads,
            left: [reads, reads, reads],
            again: 'not-started released',
            oneError: reads.code === undefined ? 'no failure' : true
          }
        ])
      ),
      leftEarly: {
        reading: waiting,
        left: waiting,
        answer: 'not-started released',
        asked: []
      },
      leftChanged: { before: 'refreshing', read: 'live', left: 'live' },
      leftBuilt: { before: 'refreshing', read: 'not read', left: 'live' },
      leftPending: { before: 'refreshing', read: 'not read', left: 'refreshing' },
      leftUnread: 'live',
      leftOutlived: {
        reading: settled('idle').reads,
        left: settled('idle').reads,
        answer: `rejected ${OUTLIVED}`,
        after: settled('idle').reads
      }
    });
  }, 30_000);

  it('CW2: with the provider standing, a plan over a `$derived` that went is read at the next read and a live one is followed, and Svelte’s line says which build ran', async () => {
    // **The other edge of `C5-C8`'s exclusion, and what shows a production run
    // is one.** The provider stands and the consumer's root is kept, so the
    // request is alive and has to go on reading its plan: a source that stays
    // alive is followed. Nothing tells it that a plan's `$derived` went with the
    // component, so the first read of it writes Svelte's line, and that is
    // `activity` and not the flush. The same read with no library is the last
    // case. Which line is read too: only Svelte's production branch writes the
    // bare URL, and a run that says it is production and is not fails here
    // rather than passing `CW1` under the wrong build.
    //
    // **And the other edge of `C5-C9`'s.** A request built after its provider
    // went has never been told anything it could stop on, so it runs once and
    // publishes `unspecified`. That is #202's to decide, and this says what it
    // does until it is. **And the controls of `CW3`'s later plans:** a plan that
    // no longer asks, or that the boundary refuses, is followed while the
    // provider stands, and `CW3` cannot tell them apart because it reads neither.
    const during = (change: () => void): readonly string[] => {
      const from = watch.reading().written.length;
      change();
      return watch.reading().written.slice(from);
    };

    const kept = async (direct: boolean) => {
      const url = nextUrl();
      const server = new WS(url, { jsonProtocol: true });
      const plan = box(request({ settleTimeoutMs: 300 }));
      let handle: ReqHandle | undefined;
      let stop = (): void => undefined;
      const view = render(KeptRequest, {
        relays: [url],
        plan: () => plan.current,
        mounted: true,
        seen: (kept: ReqHandle): void => {
          handle = kept;
        },
        rooted: (ending: () => void): void => {
          stop = ending;
        },
        direct
      });
      respondWithEose(server, await subscription(server, '-b:', 1));
      await settle();
      await view.rerender({ mounted: false });
      await settle(40);
      return {
        server,
        plan,
        held: handle as unknown as ReqHandle,
        end: async (): Promise<void> => {
          stop();
          view.unmount();
          await settle(40);
        }
      };
    };

    const standing = async (direct: boolean) => {
      const { server, plan, held, end } = await kept(direct);
      const flushed = during(() => {
        plan.current = request({ filters: [{ kinds: [2] }], settleTimeoutMs: 300 });
        flushSync();
      });
      const read = during(() => {
        void held.activity;
      });
      await settle(40);
      const wire = asked(server).filter((name) => name.includes('-b:')).length;
      await end();
      return { flushed, read, wire };
    };

    const followed = async (to: ReqPlan) => {
      const { plan, held, end } = await kept(true);
      plan.current = to;
      await settle(40);
      const { status, code } = readingOf(held);
      const answer = await answerOf(held.refresh());
      await end();
      return { status, code, answer };
    };

    const withNone = () => {
      const source = box(1);
      let stop = (): void => undefined;
      const view = render(KeptEffect, {
        read: () => source.current,
        rooted: (ending: () => void): void => {
          stop = ending;
        }
      });
      flushSync();
      view.unmount();
      flushSync();
      const lines = during(() => {
        source.current = 2;
        flushSync();
      });
      stop();
      return lines;
    };

    const builtAfter = async () => {
      const url = nextUrl();
      const server = new WS(url, { jsonProtocol: true });
      let contexts = new Map<unknown, unknown>();
      const view = render(KeptRequest, {
        relays: [url],
        plan: () => ({ kind: 'deferred' }),
        mounted: false,
        seen: () => undefined,
        contexts: (read: Map<unknown, unknown>): void => {
          contexts = read;
        }
      });
      flushSync();
      view.unmount();
      await settle(40);
      let handle: ReqHandle | undefined;
      const late = mount(DerivedRequest, {
        target: document.body,
        context: contexts,
        props: {
          plan: () => request({ settleTimeoutMs: 300 }),
          seen: (kept: ReqHandle): void => {
            handle = kept;
          }
        }
      });
      await settle(40);
      const held = handle as unknown as ReqHandle;
      const { status, code } = readingOf(held);
      const answer = await answerOf(held.refresh());
      await unmount(late);
      await settle(40);
      return { status, code, answer, wire: asked(server).length };
    };

    const line =
      process.env['NODE_ENV'] === 'production'
        ? 'warn: https://svelte.dev/e/derived_inert'
        : expect.stringMatching(/^warn: %c\[svelte\] derived_inert/);
    expect(
      {
        dead: await standing(false),
        alive: await standing(true),
        none: withNone(),
        late: await builtAfter(),
        toDeferred: await followed({ kind: 'deferred' }),
        toRefused: await followed(request({ relays: ['ws://outside.test'] }))
      },
      'the dead one at the read and asking nothing, the live one followed in silence, and the same line with no library'
    ).toEqual({
      dead: { flushed: [], read: [line], wire: 1 },
      alive: { flushed: [], read: [], wire: 2 },
      none: [line],
      late: { status: 'error', code: 'unspecified', answer: `rejected ${OUTLIVED}`, wire: 0 },
      toDeferred: { status: 'loading', code: undefined, answer: 'not-started deferred' },
      toRefused: {
        status: 'error',
        code: 'relay-not-in-scope',
        answer: 'rejected relay-not-in-scope'
      }
    });
  }, 10_000);

  // @contracts C5-C9
  it('CW3: a request kept past `NostrApp` stops reading its plan, however it read it, and goes on reading as it did', async () => {
    // **The plan changes after the provider has gone, and nothing follows it.**
    // Each way below reads the plan differently, so that one that still asks
    // has a way to be seen: `reads` counts the plan and `fields` a field of its
    // descriptor. The relay is not asked, which is the wire's half of "no
    // attempt"; the state not moving is the other, since an attempt on a revoked
    // capability fails rather than reaching a relay.
    //
    // **Counted from the revocation itself, so the teardown is inside the
    // reading.** A listener on the lease is the one anchor for that instant,
    // and it is taken before any consumer exists, so it runs ahead of theirs. A
    // plan changed in the tick the provider goes is flushed before the teardown
    // starts, and that read is the provider's still.
    let reads = 0;
    let fields = 0;

    const countingAField = (): ReqPlan =>
      ({
        kind: 'request',
        descriptor: {
          filters: [{ kinds: [1] }],
          settleTimeoutMs: 300,
          get live() {
            fields += 1;
            return false;
          }
        }
      }) as ReqPlan;

    interface Way {
      readonly from: ReqPlan;
      readonly answers: boolean;
      readonly direct?: boolean;
      readonly watched?: boolean;
      readonly beside?: boolean;
      readonly before?: ReqPlan;
      readonly together?: boolean;
      readonly atOnce?: boolean;
      readonly holding?: Nostr.Event;
      readonly then?: ReqPlan;
    }

    const changed = (): ReqPlan => request({ filters: [{ kinds: [2] }], settleTimeoutMs: 300 });

    const WAYS: Record<string, Way> = {
      'through the `$derived`': { from: request({ settleTimeoutMs: 300 }), answers: true },
      'from a source that stays alive': {
        from: request({ settleTimeoutMs: 300 }),
        answers: true,
        direct: true
      },
      'with an `$effect` that read `activity`': {
        from: request({ settleTimeoutMs: 300 }),
        answers: true,
        watched: true
      },
      'with a getter on the descriptor': { from: countingAField(), answers: true, direct: true },
      'beside another on the entry, which goes first': {
        from: request({ settleTimeoutMs: 300 }),
        answers: true,
        beside: true
      },
      'holding an event': {
        from: request({ settleTimeoutMs: 300 }),
        answers: true,
        holding: signed('kept')
      },
      'holding an event, told not to ask after it went': {
        from: request({ settleTimeoutMs: 300 }),
        answers: true,
        holding: signed('kept past a deferral'),
        then: { kind: 'deferred' }
      },
      'holding an event, refused after it went': {
        from: request({ settleTimeoutMs: 300 }),
        answers: true,
        holding: signed('kept past a refusal'),
        then: request({ relays: ['ws://outside.test'] })
      },
      'with the plan changed in the tick it went': {
        from: request({ settleTimeoutMs: 300 }),
        answers: true,
        together: true
      },
      'asked in the tick it went': {
        from: request({ settleTimeoutMs: 300 }),
        answers: true,
        direct: true,
        atOnce: true
      },
      'not asking': { from: { kind: 'deferred' }, answers: false },
      'told not to ask before it went': {
        from: request({ settleTimeoutMs: 300 }),
        answers: true,
        before: { kind: 'deferred' }
      },
      'refused by the boundary': {
        from: request({ relays: ['ws://outside.test'] }),
        answers: false
      },
      'still running': { from: live(30_000), answers: false }
    };

    const outlast = async (way: Way) => {
      const url = nextUrl();
      const server = new WS(url, { jsonProtocol: true });
      const plan = box(way.from);
      let handle: ReqHandle | undefined;
      let other: ReqHandle | undefined;
      const stops: (() => void)[] = [];
      const atRevocation = { reads: 0, fields: 0 };
      const view = render(KeptRequest, {
        relays: [url],
        plan: () => {
          reads += 1;
          return plan.current;
        },
        mounted: true,
        seen: (kept: ReqHandle): void => {
          handle = kept;
        },
        rooted: (ending: () => void): void => {
          stops.push(ending);
        },
        direct: way.direct ?? false,
        watched: way.watched ?? false,
        ready: (context: NostrContext): void => {
          leaseOf(context).onRevoke(() => {
            atRevocation.reads = reads;
            atRevocation.fields = fields;
          });
        },
        ...(way.beside === true
          ? {
              beside: (kept: ReqHandle): void => {
                other = kept;
              }
            }
          : {})
      });
      const held = handle as unknown as ReqHandle;
      const contents = (): readonly string[] =>
        (held.state as { events?: readonly Nostr.Event[] }).events?.map(({ id }) => id) ?? [];
      if (way.answers) {
        const named = await subscription(server, '-b:', 1);
        if (way.holding !== undefined) server.send(['EVENT', named, way.holding]);
        respondWithEose(server, named);
      }
      await settle();
      if (way.before !== undefined) {
        plan.current = way.before;
        await settle(40);
      }
      const wire = asked(server).length;
      const kept = [contents()];
      const from = watch.reading().written.length;
      if (way.together === true) plan.current = changed();
      view.unmount();
      const readBefore = reads;
      const atOnce = way.atOnce === true ? answerOf(held.refresh()) : undefined;
      const readAtOnce = reads - readBefore;
      await settle(40);
      const left = readingOf(held);
      kept.push(contents());
      if (other !== undefined) (stops.pop() as () => void)();

      plan.current = way.then ?? changed();
      flushSync();
      await settle(40);
      const moved = readingOf(held);
      kept.push(contents());
      const answer = await answerOf(held.refresh());
      await settle(40);
      const after = readingOf(held);
      kept.push(contents());

      const outcome = {
        left,
        moved: JSON.stringify([moved, after]) !== JSON.stringify([left, left]),
        kept,
        answer,
        planRead: reads - atRevocation.reads,
        fieldRead: fields - atRevocation.fields,
        asked: asked(server).length - wire,
        written: watch.reading().written.slice(from),
        ...(other === undefined ? {} : { beside: await answerOf(other.refresh()) }),
        ...(atOnce === undefined ? {} : { atOnce: await atOnce, readAtOnce })
      };
      for (const stop of stops) stop();
      await settle(40);
      return outcome;
    };

    const seen: Record<string, unknown> = {};
    for (const [name, way] of Object.entries(WAYS)) seen[name] = await outlast(way);

    const quiet = {
      moved: false,
      kept: [[], [], [], []],
      planRead: 0,
      fieldRead: 0,
      asked: 0,
      written: []
    };
    const notAsking = {
      status: 'loading',
      code: undefined,
      activity: 'idle',
      last: undefined,
      ended: undefined
    };
    const gone = `rejected ${OUTLIVED}`;
    const left = settled('idle').reads;
    // What an attempt the provider's going caught reads is #202's to decide, and
    // only that it stays is this row's.
    const running = (): object => ({ ...quiet, left: expect.anything(), answer: gone });
    // What answered the earlier plan stays, and the later one is not heard.
    const holding = (name: string): object => ({
      ...quiet,
      left,
      answer: gone,
      kept: Array.from({ length: 4 }, () => [(WAYS[name]?.holding as Nostr.Event).id])
    });
    expect(seen, 'the same reading, and no read of the plan, no attempt and no write').toEqual({
      'through the `$derived`': { ...quiet, left, answer: gone },
      'from a source that stays alive': { ...quiet, left, answer: gone },
      'with an `$effect` that read `activity`': { ...quiet, left, answer: gone },
      'with a getter on the descriptor': { ...quiet, left, answer: gone },
      'beside another on the entry, which goes first': {
        ...quiet,
        left,
        answer: gone,
        beside: 'not-started released'
      },
      'holding an event': holding('holding an event'),
      'holding an event, told not to ask after it went': holding(
        'holding an event, told not to ask after it went'
      ),
      'holding an event, refused after it went': holding('holding an event, refused after it went'),
      'with the plan changed in the tick it went': running(),
      'asked in the tick it went': { ...quiet, left, answer: gone, atOnce: gone, readAtOnce: 0 },
      'not asking': { ...quiet, left: notAsking, answer: 'not-started deferred' },
      'told not to ask before it went': {
        ...quiet,
        left: notAsking,
        answer: 'not-started deferred'
      },
      'refused by the boundary': {
        ...quiet,
        left: refused('relay-not-in-scope').reads,
        answer: 'rejected relay-not-in-scope'
      },
      'still running': running()
    });
  }, 20_000);
});
