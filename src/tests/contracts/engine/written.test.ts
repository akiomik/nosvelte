/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What a consumer's console sees of a failure and of a handle it kept: the
 * landing of `C5-C8` (`CW1`).
 *
 * **Public, which is why this is not `C5-C6`.** That row's population is the
 * reach arm's, and it goes through seams no consumer has. Everything here is
 * built from `NostrApp`, `useReq` and the relay's wire.
 *
 * Port band 10580-10599.
 */
import { render } from '@testing-library/svelte';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
import { REQ_ERROR_CODES, type ReqErrorCode } from '$lib/v1/reqerror.js';

import DerivedRequest from './fixtures/DerivedRequest.svelte';
import KeptRequest from './fixtures/KeptRequest.svelte';
import { watchConsole } from './helpers/console.js';
import { respondWithEose } from './helpers/relay.js';

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

const readingOf = (handle: ReqHandle): Reading => {
  const { state } = handle;
  const error = state.status === 'error' || state.status === 'incomplete' ? state.error : undefined;
  return {
    status: state.status,
    code: error?.code,
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

/** The codes no consumer reaches, each for the reason `C5-C8` gives. */
const NOT_PUBLIC: readonly ReqErrorCode[] = [
  'accumulator-contract',
  'unspecified',
  'transport-incompatible',
  'provider-disposed'
];

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
    //
    // **The population is checked against the code list**, so a code added to
    // the library is placed here or named as out of a consumer's reach.
    const watch = watchConsole();
    const silent = watch.control();
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
      const error = held.state.status === 'error' ? held.state.error : undefined;
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
          held.state.status === 'error'
            ? held.state.error === error && held.diagnostics.lastError === error
            : 'not an error'
      };
    };

    // **And one that goes before its effects ran**: mounted and unmounted in
    // one tick, with Svelte's own two calls, read in between so that there is a
    // value to go stale. Nothing is opened for it, and its `refresh()` says so.
    const early = async () => {
      const url = nextUrl();
      const server = new WS(url, { jsonProtocol: true });
      let handle: ReqHandle | undefined;
      const consumer = mount(KeptRequest, {
        target: document.body.appendChild(document.createElement('div')),
        props: {
          relays: [url],
          plan: () => request({ settleTimeoutMs: 300 }),
          mounted: true,
          seen: (request: ReqHandle): void => {
            handle = request;
          }
        }
      });
      const held = handle as unknown as ReqHandle;
      const reading = readingOf(held);
      await unmount(consumer);
      const answer = await answerOf(held.refresh());
      await settle(40);
      return { reading, left: readingOf(held), answer, asked: asked(server) };
    };

    try {
      const readings: Record<string, unknown> = {};
      for (const path of PATHS) readings[path.name] = await run(path);
      const leftEarly = await early();
      const placed = new Set<string>([
        ...PATHS.flatMap(({ reads: { code, ended } }) => [code, ended]),
        ...NOT_PUBLIC
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
          silent,
          unwatched: watch.unwatched(),
          written: watch.written,
          unplaced: REQ_ERROR_CODES.filter((code) => !placed.has(code)),
          readings,
          leftEarly
        },
        'every method watched, nothing written, and every reading what the path says'
      ).toEqual({
        silent: [],
        unwatched: [],
        written: [],
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
              oneError: reads.status === 'error' ? true : 'not an error'
            }
          ])
        ),
        leftEarly: {
          reading: waiting,
          left: waiting,
          answer: 'not-started released',
          asked: []
        }
      });
    } finally {
      watch.release();
    }
  }, 30_000);
});
