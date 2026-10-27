/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What a live request's forward leg delivers, and what its end does to the
 * request: the landings of `A5-C1` (`FL1`), `A5-C16` (`FL2`) and `A5-C17`
 * (`FL3`).
 *
 * **`FL1` and `FL2` go through the published entry**, as `release.test.ts`'s
 * arms do, on its harness (`helpers/request.ts`): `NostrApp` with `relays`
 * only, one consumer's `useReq` under it, and each case on a fake clock and on
 * the real one, its prompt readings bounded on the clock's own time and, where
 * the arm reads `inRealTime` beside them, in real time as well. **`FL3` is an
 * internal seam**: the leg constructors over a value the arm builds.
 *
 * Port band 10140–10219: no other test file names a port in it, and every one
 * that counts from a first port starts below 10000.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { type AttemptId, createAttemptRegistry } from '$lib/v1/attempt.js';
import {
  addRefusal,
  beginAttempt,
  type CachedEventSet,
  emptyEventSet,
  endBacklog,
  endForward
} from '$lib/v1/eventset.js';
import type { ReqHandle } from '$lib/v1/index.js';
import { relayMessage } from '$lib/v1/normalize.js';
import { relayFailure } from '$lib/v1/own.js';
import type { RelayLegError } from '$lib/v1/reqerror.js';

import {
  ARM_TIMEOUT_MS,
  ENDINGS,
  expectedOnEachClock,
  nameOf,
  onEachClock,
  type Order,
  planned,
  published,
  relayAt,
  urlsFrom
} from './helpers/request.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  WS.clean();
});

const nextUrl = urlsFrom(10140);

/** The two orders two events can be sent in, by their dates. */
type Arrival = Exclude<Order, 'one instant'>;
const ARRIVALS: readonly Arrival[] = ['oldest first', 'newest first'];

/** Which of `sent` the consumer's request holds, each by its place in the order they were sent. */
const heldOf = (handle: ReqHandle | undefined, sent: readonly string[]): number[] =>
  (handle === undefined || handle.state.status === 'loading' ? [] : handle.state.events)
    .map((event) => sent.indexOf(event.id))
    .sort((one, other) => one - other);

/**
 * Which of `events` sent in `order` a request keeps, by their place in the
 * order sent: every one without a bound, and the newest with one — the last
 * sent oldest first, the first sent newest first.
 */
const owedOf = (events: 0 | 1 | 2, retain: 'unbounded' | 1, order: Arrival): number[] =>
  retain === 'unbounded' || events === 0
    ? [0, 1].slice(0, events)
    : [order === 'oldest first' ? events - 1 : 0];

/** One event, or two in each order they can be sent in. */
const SENDINGS: readonly { events: 1 | 2; order: Arrival }[] = [
  { events: 1, order: 'oldest first' },
  ...ARRIVALS.map((order) => ({ events: 2 as const, order }))
];

/** How many events were sent, and in which order when there were two. */
const sendingOf = ({ events, order }: { events: number; order: Arrival }): string =>
  events === 2 ? `${String(events)} events, ${order}` : `${String(events)} event`;

/** The outcomes a request's primary state can reach. */
const OUTCOMES: readonly (string | undefined)[] = ['settled', 'incomplete', 'error'];

/**
 * How far the consumer's request has got: its activity, and the outcome its
 * primary state has reached, or `none` while it is still loading or streaming.
 */
const progressOf = (handle: ReqHandle | undefined) => ({
  activity: handle?.activity,
  outcome: OUTCOMES.includes(handle?.state.status) ? handle?.state.status : 'none'
});

describe('A5: what a live request’s forward leg delivers, and what its end does', () => {
  // @contracts A5-C1
  it(
    'FL1: an event on the live subscription before the backlog’s EOSE is delivered then, rather than queued until the EOSE',
    async () => {
      // **The relay answers the backlog as an ordinary relay would: a delivery
      // turn after the live events, whatever they read by then.** The backlog
      // has no event, and the request is read just before its `EOSE` is sent:
      // the events it keeps are held, so they were delivered ahead of an `EOSE`
      // that followed them, rather than queued until it. The turn is this arm's
      // bound on what it can observe, not a latency the row promises: an `EOSE`
      // has to come at some time for an event queued until it to show, and this
      // one comes a turn after the events. **Before any EOSE,
      // and after the live one.** The live events are sent either before the
      // relay has answered either subscription — the arrangement the spike's
      // witness made — or after it has answered the live one with `EOSE`, as a
      // relay does when it is asked for no stored events, which is how the
      // library asks the live leg. One live event, and two in each order they
      // can be dated in, retaining without bound and at most one, so a request
      // that keeps one keeps the newest. After the backlog's `EOSE` the request
      // is read settled with the same events, which tells an event queued until
      // the `EOSE` from one never delivered.
      const cases = (['first', 'never'] as const).flatMap((liveEose) =>
        SENDINGS.flatMap(({ events, order }) =>
          (['unbounded', 1] as const).map((retain) => ({ liveEose, events, order, retain }))
        )
      );
      const caseName = ({ liveEose, retain, ...sending }: (typeof cases)[number]): string =>
        `live EOSE ${liveEose}, ${sendingOf(sending)} live, retaining ${String(retain)}`;
      const readings = await onEachClock(
        cases,
        caseName,
        (clock, { liveEose, events, order, retain }) => {
          const relay = relayAt(nextUrl());
          return published(relay, planned('fl1', true, retain, clock), clock, async (consumer) => {
            const asked = await clock.promptly(
              () => relay.asked('backward').length === 1 && relay.asked('forward').length === 1
            );
            if (liveEose === 'first') relay.answerLive();
            const sent = relay.sendLive(events, 'fl1', order).map((event) => event.id);
            consumer.acted();
            await clock.turn();
            const beforeTheEose = {
              status: consumer.handle()?.state.status,
              activity: consumer.handle()?.activity,
              held: heldOf(consumer.handle(), sent)
            };
            const inRealTime = consumer.inRealTime();
            relay.answerBacklog();
            await clock.promptly(() => consumer.handle()?.state.status === 'settled');
            return {
              asked,
              beforeTheEose,
              inRealTime,
              afterTheEose: {
                status: consumer.handle()?.state.status,
                held: heldOf(consumer.handle(), sent)
              }
            };
          });
        }
      );
      expect(
        readings,
        'an event on the live subscription is delivered before the backlog’s EOSE'
      ).toEqual(
        expectedOnEachClock(cases, caseName, ({ events, order, retain }) => {
          const held = owedOf(events, retain, order);
          return {
            asked: true,
            beforeTheEose: { status: 'streaming', activity: 'live', held },
            inRealTime: true,
            afterTheEose: { status: 'settled', held }
          };
        })
      );
    },
    ARM_TIMEOUT_MS
  );

  // @contracts A5-C16
  it(
    'FL2: a relay that refuses the live subscription and then answers the backlog: the answer is kept, and the request ends with the backlog rather than with the refusal',
    async () => {
      // **The refusal first, read as an end of the forward leg.** The relay
      // answers the live subscription with `CLOSED`, and the arm waits for the
      // request to say its forward leg ended — the premise, read on the
      // published diagnostics with the refusal on the live leg. Then the
      // request is read as a consumer reads an end, by its activity and its
      // outcome, **until it is its deadline less what is prompt old**, the
      // longest wait that still leaves a prompt reading inside the deadline,
      // counted from just before the provider is rendered: it has neither left
      // `live` nor reached an outcome, so the refusal did not end it, at once
      // or later. **Then the backlog it never refused**, answered then, in each
      // of `release.test.ts`'s endings, two events in each order they can be
      // dated in: the answer read settled, holding the events it keeps, by
      // which ones, since a bounded answer that stopped taking events once the
      // forward leg ended holds as many; and the request ended, inside its own
      // deadline. An answer the arm does not get is read beside whether the
      // request was younger than its deadline less a delivery turn as the
      // backlog was about to be answered: whether the run reached the answer in
      // time, not why the answer was then not read.
      const cases = ENDINGS.flatMap((ending) =>
        ending.events === 2
          ? ARRIVALS.map((order) => ({ ...ending, order }))
          : [{ ...ending, order: 'oldest first' as const }]
      );
      const caseName = (ending: (typeof cases)[number]): string =>
        ending.events === 2 ? `${nameOf(ending)}, ${ending.order}` : nameOf(ending);
      const readings = await onEachClock(cases, caseName, (clock, ending) => {
        const relay = relayAt(nextUrl());
        return published(
          relay,
          planned('fl2', true, ending.retain, clock),
          clock,
          async (consumer) => {
            const asked = await clock.promptly(
              () => relay.asked('backward').length === 1 && relay.asked('forward').length === 1
            );
            relay.refuseLive('blocked: no live subscriptions here');
            consumer.acted();
            const legEnded = await clock.promptly(
              () => consumer.handle()?.diagnostics.legEnded !== undefined
            );
            const atTheRefusal = {
              ...progressOf(consumer.handle()),
              legEnded: consumer.handle()?.diagnostics.legEnded?.kind,
              refusals: consumer.handle()?.diagnostics.refusals.map((refusal) => refusal.leg)
            };
            const endedByTheRefusal = await consumer.throughTheWait(() => {
              const now = progressOf(consumer.handle());
              return now.activity !== 'live' || now.outcome !== 'none';
            });
            const answeredBeforeTheDeadline = consumer.beforeTheDeadline();
            const sent = relay
              .sendBacklog(ending.events, 'fl2', ending.order)
              .map((event) => event.id);
            relay.answerBacklog();
            consumer.acted();
            const answered = await clock.promptly(() => {
              const now = progressOf(consumer.handle());
              return now.outcome === 'settled' && now.activity === 'idle';
            });
            const atTheAnswer = {
              ...progressOf(consumer.handle()),
              held: heldOf(consumer.handle(), sent)
            };
            return {
              asked,
              legEnded,
              atTheRefusal,
              endedByTheRefusal,
              answered,
              atTheAnswer,
              inRealTime: consumer.inRealTime(),
              // Only beside an answer the arm did not get, and never owed.
              ...(answered ? {} : { answeredBeforeTheDeadline })
            };
          }
        );
      });
      expect(
        readings,
        'the backlog’s answer is kept, and the request ends with the backlog rather than with the refusal'
      ).toEqual(
        expectedOnEachClock(cases, caseName, (ending) => ({
          asked: true,
          legEnded: true,
          atTheRefusal: {
            activity: 'live',
            outcome: 'none',
            legEnded: 'ended',
            refusals: ['forward']
          },
          endedByTheRefusal: false,
          answered: true,
          atTheAnswer: {
            activity: 'idle',
            outcome: 'settled',
            held: owedOf(ending.events, ending.retain, ending.order)
          },
          inRealTime: true
        }))
      );
    },
    ARM_TIMEOUT_MS
  );

  // @contracts A5-C17
  it('FL3: a forward leg told it ended twice keeps the first end', () => {
    // **Every order that tells the two apart**: an explanation and then a blank
    // end — the row's own case — an explanation and then another, and a blank
    // end and then an explanation. Two blank ends are not made: under this
    // row's reading, the end kept and the explanation it carries, they are the
    // same. **Wherever the two ends fall among the value's other writes**: with
    // nothing else written; with a refusal on the live leg before each end, as
    // a `CLOSED` writes one before the end it causes; with the backlog ended
    // before both; and with it ended between them. Each end is read on the value
    // after it, its kind and the error it carries by identity, so a second end
    // written over the first reads as the second's error; the value after the
    // first end is the control that an end is recorded at all.
    const why = relayFailure('every relay in scope stopped the live request');
    const other = relayFailure('the transport gave out');
    const orders: readonly (readonly [
      string,
      RelayLegError | undefined,
      RelayLegError | undefined
    ])[] = [
      ['an explanation, then a blank end', why, undefined],
      ['an explanation, then another', why, other],
      ['a blank end, then an explanation', undefined, why]
    ];
    /** A write the value takes from another of `collect`'s writers. */
    type Write = (value: CachedEventSet, attempt: AttemptId) => CachedEventSet;
    const refused =
      (notice: string): Write =>
      (value, attempt) =>
        addRefusal(
          value,
          {
            from: 'ws://relay.example',
            leg: 'forward',
            notice: relayMessage(notice),
            reason: 'blocked'
          },
          attempt
        );
    const backlogEnded: Write = (value, attempt) =>
      endBacklog(value, attempt, { kind: 'complete' });
    const phases: readonly (readonly [string, readonly (Write | 'first end' | 'second end')[]])[] =
      [
        ['nothing else written', ['first end', 'second end']],
        [
          'a refusal before each end',
          [
            refused('blocked: no live subscriptions here'),
            'first end',
            refused('blocked: still no live subscriptions here'),
            'second end'
          ]
        ],
        ['the backlog ended before both', [backlogEnded, 'first end', 'second end']],
        ['the backlog ended between them', ['first end', backlogEnded, 'second end']]
      ];
    const readings = Object.fromEntries(
      phases.flatMap(([phase, steps]) =>
        orders.map(([order, first, second]) => {
          const attempt = createAttemptRegistry().mint();
          let value = beginAttempt(emptyEventSet, attempt);
          const after = new Map<string, CachedEventSet>();
          for (const step of steps) {
            if (typeof step === 'function') value = step(value, attempt);
            else {
              const error = step === 'first end' ? first : second;
              value = endForward(value, attempt, { kind: 'ended', error });
              after.set(step, value);
            }
          }
          const read = (set: CachedEventSet | undefined) => ({
            kind: set?.forward?.end?.kind,
            error:
              set?.forward?.end?.error === first
                ? 'first'
                : set?.forward?.end?.error === second
                  ? 'second'
                  : 'other'
          });
          return [
            `${phase}, ${order}`,
            { once: read(after.get('first end')), twice: read(after.get('second end')) }
          ];
        })
      )
    );
    expect(readings, 'the first end is what the value keeps').toEqual(
      Object.fromEntries(
        phases.flatMap(([phase]) =>
          orders.map(([order]) => [
            `${phase}, ${order}`,
            { once: { kind: 'ended', error: 'first' }, twice: { kind: 'ended', error: 'first' } }
          ])
        )
      )
    );
  });
});
