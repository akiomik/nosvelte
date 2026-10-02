/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Building a request out of what a consumer gave a high-level component.
 *
 * **This is where the v1 defect lived, and it had no home in the spike.**
 * `useEventList` built `[{ ids, limit: ids.length }]`, and the two halves came
 * from two reads of the caller's source: a `REQ` went out asking for two ids
 * with `limit: 1` — a filter this library never constructed, and one no
 * after-the-fact mutation can produce. `B4-C9` says the key, the wire and the
 * `limit` come from one snapshot, and the arm that read it composed the filter
 * **in the test**, so what it measured was the engine and never the composition
 * that had been wrong.
 *
 * **Both arguments are the caller's**, and the guard reaches both: the reader
 * because it is re-evaluated, and `rest` because it is a prop object whose
 * every read is a trap a component owns.
 *
 * So the composition is here, in the library, and it takes a **reader** rather
 * than a value: the caller's source is a prop, a store, a getter — something a
 * component re-evaluates — and "read it once" is a claim about this function
 * rather than about its call site. `P57` drives it, and an implementation that
 * reads twice is what the ledger's `the-high-level-composition-reads-twice`
 * makes.
 */
import type Nostr from 'nostr-typedef';

import { safely } from './own.js';

/**
 * How many ids one composition will carry.
 *
 * A number rather than a guard against a shape, because the shape is legal: a
 * `Proxy` over an array answers `Array.isArray` with `true` and can answer
 * `length` with anything a safe integer can hold. Ten thousand is above every
 * list a component builds from props and below anything that blocks a frame.
 */
const MAX_IDS = 10_000;

/**
 * The filters a list of ids asks for, from one read of the caller's source.
 *
 * `limit` is `ids.length` because a list of ids is a request for those ids and
 * nothing more — which is only true if the `limit` counts the ids beside it.
 * Reading the source twice makes the pair describe two different lists, and the
 * relay answers the second while the consumer is told about the first.
 *
 * **`rest` has no default.** It carried `{}`, and a filter with no `kinds` is
 * refused by the descriptor boundary — so the default value of a parameter on
 * the library's own composition could only ever build a request that fails.
 */
export function filtersForIds(
  readIds: () => readonly string[],
  rest: Omit<Nostr.Filter, 'ids' | 'limit'>
): readonly Nostr.Filter[] {
  // One read. Everything below is derived from `ids`, never from `readIds()`
  // again — the whole of what this module is for.
  //
  // **Total, because it runs where a throw has nowhere to go.** A component's
  // prop getter can throw, and this is called while the caller's options are
  // being built — outside the guarded read that turns an unreadable field into
  // `state.error`. Measured: a throwing source came out of the *render path* as
  // an exception, which is the shape every boundary in this library was
  // repaired away from. So the read is guarded and an unreadable source becomes
  // an empty list, which the descriptor boundary refuses **by name** on the
  // channel a consumer reads.
  // **One guarded read, and every operation on what it returned is inside it.**
  // The first version guarded the *call* and then reached into the value: a
  // revoked `Array.isArray` threw out of the render path — the same shape that
  // moved the failure channel to snapshots in the first place, reproduced in
  // this module a round later. A foreign array is a foreign graph: `isArray`,
  // the iteration, and every element read are traps.
  const owned = safely((): readonly string[] | null => {
    const raw = readIds();
    if (!Array.isArray(raw)) return null;
    // **`length` is read once, and that is not tidiness.** `Array.isArray`
    // answers `true` for a `Proxy` whose target is an array, and `for…of` asks
    // the iterator for `length` on **every step**: a trap that returns `n++`
    // drove 134 million iterations in 16.8s and never returned (measured). A
    // throw this guard turns into a refusal; a source that never finishes it
    // cannot, so the loop is bounded by the first answer instead. What the
    // caller pays for a genuinely long list is still their own list's length,
    // which is residue rather than contract.
    const length = raw.length;
    if (!Number.isSafeInteger(length) || length < 0) return null;
    // **And the answer itself is bounded, which reading it once is not.** The
    // loop below was bounded by the *first* `length`, and nothing bounded that:
    // a proxy answering `2 ** 40` is a safe integer, and the walk ran 134
    // million element reads and blocked for 17.9s before an engine limit on
    // `push` ended it — the same figure as the growing-`length` trap this read
    // was moved to stop. Reading once changed which trap reproduces it, not
    // whether one can. So there is a declared maximum, like every other bound
    // here: **10 000 ids**, which is far above any list a component derives from
    // props and far below anything that can be waited on. A longer list is
    // refused by name rather than truncated, because a silently shorter request
    // is the narrower question this module exists to refuse.
    if (length > MAX_IDS) return null;
    const copied: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const id = (raw as readonly unknown[])[index];
      // **A member that is not a string is a refusal, not a deletion.** Dropping
      // it turned `[valid, 42]` into a request for one id — a silently narrower
      // question than the consumer asked, which is what every other boundary
      // here refuses to do.
      if (typeof id !== 'string') return null;
      copied.push(id);
    }
    return copied;
  });
  // **The other argument is the caller's object too, and it was spread raw.**
  // `rest` is a component's prop: a getter on it can throw, an `ownKeys` trap
  // can throw, and a revoked `Proxy` makes the spread itself throw — measured,
  // five shapes came out of the render path as the caller's own exception, on
  // *both* branches below. The reader was guarded because a reviewer named it;
  // its sibling in the same signature was not. So it is copied once, here, and
  // both branches use the copy.
  const others = safely(() => ({ ...rest }));
  // **Unreadable, not a list, or carrying something that is not an id** — all
  // one answer, and it is a filter the descriptor boundary refuses **by name**.
  // Not an empty list: `ids: []` is a legal request for nothing and it *settles*
  // (measured), so an unreadable prop would come back as an empty answer with
  // nothing said. Silence is the worse of the two failures.
  //
  // An unreadable `rest` refuses the same way, with nothing of the caller's on
  // the filter: there is no copy to carry, and `ids` is the name it is refused
  // by either way.
  if (others === undefined || owned === undefined || owned === null) {
    // **Nothing of the caller's rides on the refusal, and it used to.** The
    // frame was `{ ...others, ids: null }`, so the descriptor boundary refused
    // whichever field it reached first: measured, an unreadable id source with
    // `{ kinds: [1], since: 10, until: 1 }` beside it came back telling the
    // consumer that `since` must not be later than `until` — a field they wrote
    // correctly — and a `limit` of theirs survived on this branch while the
    // accepted branch overwrites it. The refusal is about `ids`, so `ids` is
    // the whole frame.
    return [{ ids: null as unknown as string[] }];
  }
  // **Deduplicated, because `limit` counts what is actually asked for.** Two
  // copies of one id asked a relay for that id with `limit: 2`.
  const ids = [...new Set(owned)];
  return [{ ...others, ids, limit: ids.length }];
}
