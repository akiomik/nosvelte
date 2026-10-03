import { describe, expect, it } from 'vitest';

import type { OwnedPacket } from '$lib/v1/event.js';
import type { CachedEventSet } from '$lib/v1/eventset.js';
import { emptyEventSet, foldEvent, project, retainNewest, selectMany } from '$lib/v1/eventset.js';

import { arbitraryEvents, mulberry32, shuffled, winnersOf } from './helpers/nip01.js';
import { ownedEventPacket } from './helpers/relay.js';

/**
 * A bounded set that carries a replacement (0003 B5, B6), against the fold and
 * the bound themselves.
 *
 * Ported from the spike's bounded-replacement suite onto `src/lib/v1`, with the
 * arms renamed from `E6<x>` to `ES6<x>`: 0005 records the old names as spike
 * witnesses, and a production arm carries a name of its own. **The comments
 * keep the spike's names**, because what they record — which arm a mutation
 * killed, what a sweep counted — was measured there: `M16`, `P3` and every
 * other arm name in a comment is the spike's as 0005 records it, not a file in
 * this repository.
 *
 * The axis every existing retention witness holds still.
 *
 * `retain` is exercised in sixteen places and every one of them feeds `kind: 1`
 * only — where `replacementKey(event) === event.id`, so entries and events are
 * one to one and the bound can never collapse two events into one slot. The two
 * tests named for this very harm, `M16` ("a replacement arriving in a later
 * fetch cannot resurrect an older one") and `P3` ("the cache value is the
 * canonical set, not the arrival order"), both run with `retain` absent. The
 * property was witnessed; the bound was the one axis never varied against it.
 *
 * These are the witnesses for that crossing. Both fail on the bound as it stood
 * before this change — measured, not assumed.
 */

const PUBKEY = 'ab'.repeat(32);

const ev = (fields: Parameters<typeof ownedEventPacket>[0]): OwnedPacket =>
  ownedEventPacket(fields);

/** One replaceable coordinate, superseded; plus a regular event to compete for the slot. */
const OLD = ev({ id: 'old', kind: 10002, pubkey: PUBKEY, created_at: 100 });
const NEW = ev({
  id: 'new',
  kind: 10002,
  pubkey: PUBKEY,
  created_at: 200,
  tags: [['expiration', '150']]
});
const REGULAR = ev({ id: 'regular', kind: 1, pubkey: PUBKEY, created_at: 50 });

const NOW = 1_000;

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])
  );
}

/**
 * Fold and bound each arrival, handing the bound the instant it sampled —
 * which nothing reads. `RetentionOptions.now` is kept for exactly this: a
 * change that put expiry back into the ranking would read it from here, and
 * these arms would see that change rather than a bound that was never offered
 * a clock. Dropping the instant from this call left all four arms green under
 * that change, which is the regression they were written for.
 */
const foldBoundedAt =
  (retain: number) =>
  (arrivals: readonly (readonly [OwnedPacket, number])[]): CachedEventSet =>
    arrivals.reduce(
      (acc, [packet, now]) => retainNewest(foldEvent(acc, packet), { retain, now }),
      emptyEventSet
    );

/**
 * Which of the given ids are published at `at`.
 *
 * **The superseded ids are written out per fixture, never derived.** An oracle
 * that computed them with the library's own functions agreed with every
 * mutation of those functions, and it was repaired one function at a time:
 * first `laterWins` — reversed, the fold published `old` and the oracle named
 * `old` the winner — then `replacementKey` — keyed by id, the fold kept both
 * revisions and the oracle called each the winner of its own key. What each
 * fixture supersedes is a fact about the fixture, so it is stated beside it.
 */
function shownOf(set: CachedEventSet, at: number, superseded: readonly string[]): string[] {
  return project(set, at)
    .events.map((event) => event.id)
    .filter((id) => superseded.includes(id));
}

/**
 * The bounds both landing arms below are run at. One alone cannot see a fold that
 * keeps both revisions: the bound throws one of them away and hides the
 * defect, so the larger bounds are where a revision that should have been
 * replaced shows up beside its replacement.
 */
const BOUNDS = [1, 2, 3] as const;

/**
 * The ids among `events` that NIP-01 supersedes — every revision but the one
 * its coordinate keeps — by `helpers/nip01.ts`, which calls nothing of the
 * library's.
 */
function supersededAmong(events: readonly OwnedPacket[]): string[] {
  const kept = new Set(
    [...winnersOf(events.map(({ event }) => event)).values()].map(({ id }) => id)
  );
  return events.map(({ event }) => event.id).filter((id) => !kept.has(id));
}

describe('a bounded set that carries a replacement', () => {
  it('ES6i: a set of exactly `retain` entries is returned untouched, and one more is cut', () => {
    // **The boundary nobody could move.** `keepNewest` returns early on
    // `entries.size <= retain`, and that `<=` could be changed to `<` with the
    // whole spike suite green — found by shifting every comparison operator in
    // the library one at a time, 355 of them, of which twelve turned nothing
    // red. B6 contracts "the newest `retain` entries", so a set already at the
    // bound is not over it, and the identity of what comes back is what says
    // so: `retainNewest` returns the *same* set object when nothing is cut, and
    // a caller downstream compares by identity to decide whether anything
    // moved.
    // Three entries that stay three: `OLD` and `NEW` are one replaceable and
    // fold together, so a set built from them is two, not three.
    const three = [
      REGULAR,
      ev({ id: 'second', kind: 1, pubkey: PUBKEY, created_at: 60 }),
      ev({ id: 'third', kind: 1, pubkey: PUBKEY, created_at: 70 })
    ];
    const at = foldBoundedAt(3)(three.map((packet) => [packet, NOW] as const));
    expect(at.entries.size, 'the fixture is not three entries').toBe(3);

    // Exactly at the bound: the early return, and the same object back.
    const held = retainNewest(at, { retain: 3 });
    expect(held, 'a set at the bound was rebuilt rather than returned').toBe(at);
    expect(held.entries.size).toBe(3);

    // One over it: a different object, and one entry fewer. Both halves,
    // because the early return passing is satisfied by a function that never
    // cuts anything at all.
    const cut = retainNewest(at, { retain: 2 });
    expect(cut, 'a set over the bound was returned untouched').not.toBe(at);
    expect(cut.entries.size).toBe(2);
  });

  // @contracts B5-C4
  it('ES6d: no arrival order of a bounded set publishes a superseded replaceable', () => {
    // Two neighbours for the coordinate to compete with: one older than both
    // revisions, and one between them, so a bound that keeps the oldest entry
    // rather than the newest evicts the newer revision too. And one fixture in
    // which everything shares a `created_at`, where B5's tie decides which
    // revision supersedes and the bound's own tie-break decides which entry
    // keeps the slot: `a` supersedes `c`, and `b` competes for the slot.
    const between = ev({ id: 'between', kind: 1, pubkey: PUBKEY, created_at: 150 });
    const winner = ev({ id: 'a', kind: 10002, pubkey: PUBKEY, created_at: 100 });
    const competitor = ev({ id: 'b', kind: 1, pubkey: PUBKEY, created_at: 100 });
    const loser = ev({ id: 'c', kind: 10002, pubkey: PUBKEY, created_at: 100 });
    for (const [packets, superseded] of [
      [[OLD, NEW, REGULAR], ['old']],
      [[OLD, NEW, between], ['old']],
      [[winner, competitor, loser], ['c']]
    ] as const) {
      for (const retain of BOUNDS) {
        const offenders = permutations(packets)
          .map((order) => {
            const set = foldBoundedAt(retain)(order.map((packet) => [packet, NOW] as const));
            return { order, shown: shownOf(set, NOW, superseded) };
          })
          .filter(({ shown }) => shown.length > 0);

        // The bound before this change published `old` — the event `new`
        // supersedes — in two of the six orders, because evicting `new` deleted
        // the only trace of the coordinate and the fold then had nothing to
        // compare `old` against.
        expect(
          offenders.map(({ order }) => order.map((packet) => packet.event.id).join(' -> ')),
          `retain ${retain}: orders publishing a superseded replaceable`
        ).toEqual([]);
      }
    }

    // **And over drawn events, not only these.** Every class with a coordinate
    // — the specials, the range, addressable under each kind of `d` — beside
    // regular competitors, ties common, at every bound and in several orders,
    // the instant held still: whatever the bound evicts, no revision NIP-01
    // supersedes is published. A fixture of one kind could not see a key that
    // broke for another.
    const rand = mulberry32(0xb5c4);
    for (let trial = 0; trial < 300; trial += 1) {
      const packets = arbitraryEvents(rand, 8).map(ev);
      const superseded = supersededAmong(packets);
      for (const retain of BOUNDS)
        for (const order of [packets, [...packets].reverse(), shuffled(packets, rand)]) {
          const set = foldBoundedAt(retain)(order.map((packet) => [packet, NOW] as const));
          expect(shownOf(set, NOW, superseded), `trial ${trial}, retain ${retain}`).toEqual([]);
        }
    }
  });

  it('ES6e: one stored set and one published answer, whatever the arrival order', () => {
    const answers = permutations([OLD, NEW, REGULAR]).map((order) => {
      const set = foldBoundedAt(1)(order.map((packet) => [packet, NOW] as const));
      return {
        stored: selectMany(set)
          .map((packet) => packet.event.id)
          .join(','),
        shown: project(set, NOW)
          .events.map((event) => event.id)
          .join(',')
      };
    });

    // B6's own words, which name no instant — the bound reads no clock, so the
    // agreement below holds at any. Three distinct stored sets and three
    // distinct published answers stood here before this change.
    // **The value, not the count of distinct values.** `size === 1` says every
    // order agreed and says nothing about what they agreed on, so a bound that
    // keeps *nothing* satisfies it — measured: with `keepNewest` returning an
    // empty map for any numeric bound, this arm and both its neighbours passed.
    expect([...new Set(answers.map((a) => a.stored))], 'the one stored set').toEqual(['new']);
    expect([...new Set(answers.map((a) => a.shown))], 'the one published answer').toEqual(['']);

    // And whatever the bound ranks on is bounded by the entries it describes,
    // so ordering was not bought with a structure that grows. That is the claim
    // `retain` makes, and it is the one thing such a structure has to promise:
    // an earlier draft of this repair pruned only on the path that evicts, so a
    // replacement — same size, different id — left the superseded id behind and
    // the structure outgrew the entries. That assertion found it on the spike,
    // in a design that ranked on a separate structure.
    //
    // **Neither the spike as it shipped nor this repository has that structure,
    // so the loop below is never entered here and holds nothing today.** It is
    // kept as the guard such a design would owe, read through an optional field
    // on purpose. Which structure the bound
    // ranks on differs between the designs still under consideration, and the
    // shape this file exists to pin — a bounded set carrying a replacement,
    // over every arrival order — is common to all of them. A design that ranks
    // on nothing extra has nothing to check here and should not fail for it.
    for (const order of permutations([OLD, NEW, REGULAR])) {
      const set = foldBoundedAt(1)(order.map((packet) => [packet, NOW] as const));
      const ranked: Map<string, unknown> | undefined = (set as { standing?: Map<string, unknown> })
        .standing;
      if (ranked !== undefined) {
        expect(ranked.size, 'ranking entries held per stored entry').toBeLessThanOrEqual(
          set.entries.size
        );
      }
    }
  });

  // @contracts B5-C5
  it('ES6f: nor does a clock that moves between arrivals', () => {
    // The same crossing reached the other way. `new` is evicted by a regular
    // event that is valid when it arrives and expired by the time `old` shows
    // up, so the slot the coordinate lost is free again at exactly the moment
    // an older event for it arrives.
    const lasting = ev({ id: 'new-plain', kind: 10002, pubkey: PUBKEY, created_at: 200 });
    const fading = (created_at: number): OwnedPacket =>
      ev({
        id: `regular-fading-${created_at}`,
        kind: 1,
        pubkey: PUBKEY,
        created_at,
        tags: [['expiration', '500']]
      });
    // And the other way round: the regular event is older than the newer
    // revision, so the revision keeps its slot through the clock's move and
    // `old` arrives to find it still there — the comparison has to be made.
    for (const competitor of [fading(300), fading(150)]) {
      for (const retain of BOUNDS) {
        const set = foldBoundedAt(retain)([
          [lasting, 400],
          [competitor, 400],
          [OLD, 600]
        ]);
        expect(
          shownOf(set, 600, ['old']),
          `${competitor.event.id}, retain ${retain}: superseded published after the clock moved`
        ).toEqual([]);
      }
    }

    // **And over drawn events whose regular members expire between the
    // arrivals**, so the clock moves across deadlines while revisions are
    // still arriving, at every bound and in several orders.
    const rand = mulberry32(0xb5c5);
    for (let trial = 0; trial < 300; trial += 1) {
      const packets = arbitraryEvents(rand, 8, { expiries: [150, 250, 350] }).map(ev);
      const superseded = supersededAmong(packets);
      for (const retain of BOUNDS)
        for (const order of [packets, [...packets].reverse(), shuffled(packets, rand)]) {
          const instants = order.map((_, at) => 100 + at * 50);
          const set = foldBoundedAt(retain)(
            order.map((packet, at) => [packet, instants[at] as number] as const)
          );
          const last = instants.at(-1) as number;
          expect(shownOf(set, last, superseded), `trial ${trial}, retain ${retain}`).toEqual([]);
        }
    }
  });
});
