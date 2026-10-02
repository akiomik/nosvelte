/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The stream A11's seam hands over, as a capability the **engine** owns.
 *
 * What stood here before was the producer itself: `streamFn` called
 * `twoStageStream` and handed the generator straight across. Singularity — "one
 * invocation drives one producer" — was then carried by three clauses between
 * them, and two of the three were reachable around.
 *
 * - **The shape clause covered our own producer and nothing else.** "Asking for
 *   an iterator hands back the same iterator" was read as "so an acquisition
 *   cannot open anything", and that step is false for a general
 *   `AsyncIterableIterator`: `[Symbol.asyncIterator]() { open(); return this; }`
 *   returns an identical object out of every acquisition and opens a
 *   subscription on each one, and an iterator whose `next()` starts a fresh
 *   internal producer needs no second acquisition at all. **Identity is not
 *   absence of effect.** It held on this tree only because `twoStageStream` is
 *   an `async function*`, which is a fact about our code rather than a property
 *   anything porting this inherits.
 * - **The counting is read at a settlement a pending invocation never reaches.**
 *   An invocation that never returns could call `streamFn` a second time and get
 *   a second producer, with nothing having counted and nothing having ended.
 *
 * Both are closed here, from the engine's side, rather than by asking the far
 * side of the seam to behave — which is the move that matters, because the seam
 * cannot be required to reach anything and an accumulator is not ours. What
 * crosses is this facade:
 *
 * 1. **The call is idempotent, and the first outcome is the one it keeps.** The
 *    first call opens the producer; every later call hands back that same object
 *    without opening a second one. A first call that *fails* — `open()` throws,
 *    or the acquisition throws — fixes the failure as the answer: for as long as
 *    the capability is live, every later call re-throws that same error by
 *    identity, and none of them retries the acquisition. **Idempotence on the
 *    success path only is what stood here**,
 *    and it was one `??=`: a throw left the binding unset, so an accumulator
 *    that caught and asked again opened the underlying a second time inside one
 *    invocation, which is the thing the whole file exists to make impossible.
 * 2. **The underlying is acquired at most once**, by the engine, at that first
 *    call — never at a door the accumulator chooses, never twice however many
 *    times the facade is asked for an iterator, and not again after an
 *    acquisition that threw.
 * 3. **The facade the engine returns is closure-bound and cannot be
 *    re-pointed, and no route injects a capability into the engine.** The
 *    iterator lives in this function's closure with no door onto it, and the
 *    object is frozen, so a holder cannot swap what the *next* holder iterates.
 *    **"Not constructible from outside" is what stood here, and it was too
 *    strong**: {@link StreamCapability} is a structural interface and
 *    {@link oneShotStream} is exported, so anyone can build an object of this
 *    shape. What actually holds is the narrower pair the engine rests on — it
 *    builds its capability from its own `streamFn` and takes one from nowhere,
 *    so a forged capability reaches no invocation; and whoever holds the object
 *    the engine returned holds the engine's, because that object cannot be
 *    re-pointed.
 * 4. **Revocation is strong, at all three doors.** After
 *    {@link StreamCapability.revoke}, `next`, `return` and `throw` answer
 *    `done` — including for chunks the producer had already queued, and
 *    including for a call that was already in flight when the revocation
 *    landed. That is what makes 0002's "nothing it started outlives it" true of
 *    every value that crosses, instead of true except for a drain.
 *
 * **What would disprove each of the four** is a hostile source rather than a
 * green suite: (1) and (2) die to a source that counts calls and acquisitions
 * and is driven through two calls and two `for await`s — the counts must read
 * one and one — and to a source that *throws*, at the call and at the
 * acquisition, driven through a catch and a second call: the counts must still
 * read one, and the error the second call raises must be the first one by
 * identity rather than a fresh one minted by a second attempt; (3) dies to a
 * `stream[Symbol.asyncIterator] = …` that is *permitted* — the assignment has
 * to throw, and a pull taken after it has to still arrive at the engine's own
 * underlying; (4) dies to a source with a chunk still queued behind its end,
 * pulled once, revoked, and pulled again, and to each of the three doors called
 * and left in flight while the revocation lands — a `return` and a `throw` may
 * both answer `{done: false, value}`, so the value boundary is three doors wide
 * and not one. A suite that never builds those measures the accumulators we
 * ship, which were not the ones in question.
 *
 * **What (4) is not, said where the claim is made.** It bounds *values*, not
 * effects already asked for. A `return()` or `throw()` that reached the
 * underlying before the revocation landed has started an unwind, and that
 * unwind finishes: `twoStageStream`'s `finally` runs and abandons the attempt.
 * Nothing here undoes it, and nothing should — the accumulator asked for it
 * while it still held a live capability, and the abandonment is idempotent with
 * the two other mechanisms that end an attempt. The interval is bounded by the
 * revocation being the last thing before the invocation's abort, which closes
 * the wire anyway.
 *
 * **What this does not do, recorded rather than implied.**
 *
 * - **It does not close the underlying on revocation.** No `return()` is sent,
 *   because the wire is closed by the invocation's abort in the same `finally`
 *   and a second unwind started from here could not be awaited by anything. A
 *   producer the accumulator opened and never drove is therefore ended by the
 *   abort, exactly as before this existed.
 * - **It does not reach a producer opened by a route that never passed through
 *   `streamFn`.** An accumulator that imports the request machinery directly is
 *   outside this the same way it is outside the counting.
 * - **It does not bound what one iterator does per pull.** A producer whose
 *   `next()` opens a fresh internal subscription every time needs neither a
 *   second call nor a second acquisition, so it passes through this facade
 *   untouched — measured: one call, one acquisition, and four `SUBSCRIBE`s on
 *   the wire. Nothing in the engine forbids it; what forbids it for the producer
 *   we ship is that `twoStageStream` opens inside one `for await`. Singularity,
 *   as a property of an arbitrary producer, stops at the door and not at the
 *   pull.
 * - **A chunk the underlying produced for a pull that was still in flight when
 *   the revocation landed is dropped.** That is the strong boundary being
 *   strong, and it is data loss by construction — bounded to the interval after
 *   the invocation has already ended, where nothing is entitled to fold it.
 * - **A failure is terminal until the withdrawal; the withdrawal is terminal
 *   absolutely.** While the capability is live a fixed failure is raised at
 *   every later call, which is the interval in which a caller can still act on
 *   it. Once the engine withdraws it, every call hands back the facade and every
 *   door answers `done` — with **no exception for a capability that had
 *   failed**, because 0005 says without qualification that after that end a
 *   later call hands back the object the first call returned, and a decision
 *   that survives only by rewording the sentence that would falsify it has not
 *   survived. **0002 says something weaker there** — a facade that opens
 *   nothing — so the two records were not saying the same thing and a claim
 *   here that they were is what this sentence used to make. The stronger one is
 *   the one to hold to, and it is now asserted rather than assumed: identity,
 *   across the withdrawal, in the row whose Given is that interval. The
 *   alternative — the failure outliving the withdrawal —
 *   was written and measured, and is kept as the ledger's
 *   `failure-survives-the-withdrawal` so the choice stays a measurement rather
 *   than a preference.
 * - **The other order drops the acquisition's outcome.** A revocation landing
 *   while `open()` is still running leaves the state withdrawn: the iterator or
 *   the failure is discarded, and the caller that was mid-acquisition still
 *   receives whatever it raised. That order needs a `revoke()` called from
 *   inside `open()`, which the engine has no route to do; it is stated because a
 *   rule with an unstated half is the shape this file keeps correcting.
 */

import type { AccumulateParams } from './accumulate.js';
import type { Chunk } from './stream.js';

/**
 * What the engine hands over, and what it keeps.
 *
 * Two halves rather than one object with a method, because they go to different
 * places: `stream` crosses the seam and `revoke` never does. An accumulator
 * holding the capability could otherwise revoke it, which is the engine's
 * decision and not one the far side gets a say in.
 */
export interface StreamCapability {
  /** Given to the accumulator as its `streamFn`. Idempotent; see the module header. */
  readonly stream: AccumulateParams['streamFn'];
  /**
   * Kept by the engine, called from the invocation's `finally`.
   *
   * **An explicit call rather than a signal this reads.** Both would work — the
   * invocation's controller is aborted on the same line — but a state this
   * module sets is checkable by reading this file, while a signal read makes the
   * boundary a fact about two files agreeing. The origin is one call from one
   * place, which is the property a reviewer can confirm without running
   * anything.
   */
  readonly revoke: () => void;
}

/**
 * Where the one acquisition has got to — written down, rather than inferred
 * from a boolean beside a maybe-undefined binding.
 *
 * **The pair this replaces had a state it could not name.** `revoked` and
 * `iterator` gave four combinations for three intended situations, and the
 * fourth — not revoked, no iterator — was reachable in exactly one way: an
 * `open()` or an acquisition that *threw*. `iterator ??=` then read that as
 * "nothing has been opened yet", so the next call opened the underlying again.
 * The bug was not a missing check; it was that the failure had nowhere to be
 * recorded, so the code inferred the wrong thing from its absence.
 *
 * - `unopened` — nobody has called. The only state a call opens from.
 * - `opening` — a call is inside `open()` right now. It exists because `open` is
 *   a stranger's function: one that calls back into `stream` would otherwise
 *   find `unopened` and buy a second acquisition through the front door. A call
 *   that arrives here is refused with a throw rather than handed the facade,
 *   because the facade's doors answer `done` in every state but `opened`, and a
 *   caller re-entering its own acquisition would be told the stream had ended
 *   when it had not started.
 * - `opened` — the acquisition returned. The only state a door opens in.
 * - `failed` — it threw, and the `reason` is kept so every later call raises the
 *   same error object rather than a fresh one from a retry that must not happen.
 * - `revoked` — the engine withdrew it. **It carries whatever had been
 *   acquired**, which is not an oversight and not a lifetime this adds: the
 *   binding it replaces was never cleared either, and the underlying is ended by
 *   the invocation's abort. What it buys is that the door's refusal stays a
 *   *check* — something one edit can remove, and a witness can therefore catch —
 *   rather than a consequence of the state no longer holding the reference, in
 *   which case "a late pull never reaches the underlying" would be a claim
 *   nothing could falsify.
 */
type CapabilityState =
  | { readonly name: 'unopened' }
  | { readonly name: 'opening' }
  | { readonly name: 'opened'; readonly iterator: AsyncIterator<Chunk> }
  | { readonly name: 'failed'; readonly reason: unknown }
  | { readonly name: 'revoked'; readonly iterator: AsyncIterator<Chunk> | undefined };

/**
 * Wrap what the engine would have handed over in a capability it can withdraw.
 *
 * `open` is called at most once. **The context reaches it and configures
 * nothing**, which is a statement about the engine's producer rather than about
 * this wrapper: the machine takes its lifetime from the invocation's controller,
 * so there was never anything for a caller's context to decide.
 *
 * **The read that context is for happens outside this, once per call**, and it
 * moved there because of this function. `context.signal` being read is what arms
 * an adapter's own cancellation, and a read taken inside `open` would be a read
 * taken on the first call and on no other. "The shipping adapters only call
 * once" would have made that safe and is the argument this seam has been wrong
 * about before, so the engine reads at the door instead — see the `streamFn` it
 * builds for the accumulator.
 */
export function oneShotStream(open: AccumulateParams['streamFn']): StreamCapability {
  let state: CapabilityState = { name: 'unopened' };

  // A fresh object per answer rather than one shared constant: what is returned
  // crosses the seam, and a shared result an accumulator mutated would be this
  // module handing the next caller someone else's value.
  const done = (): IteratorResult<Chunk> => ({ done: true, value: undefined });

  /**
   * The underlying when a door may reach it, and `undefined` when none may.
   *
   * **One question asked in one place**, where the three doors each wrote out
   * `revoked || iterator === undefined`. That was two reads of two bindings and
   * it was defended as "one case said twice"; with five states it is one case
   * said once, and the sharing costs nothing the old shape was protecting —
   * what the doors need narrowed is the local this returns, and that narrowing
   * is the compiler's own rather than a cast either way.
   *
   * **`revoked` is a door this closes, not a state it cannot see.** The
   * revoked state still carries the iterator, so removing the clause below is
   * one edit and a late pull then arrives at the underlying — which is what
   * makes the row that counts arrivals able to die.
   */
  const live = (): AsyncIterator<Chunk> | undefined =>
    state.name === 'opened' ? state.iterator : undefined;

  /**
   * Leave `opening` for whatever the acquisition turned out to be.
   *
   * The guard is the whole of "the first ending to land is the one that holds":
   * if a revocation arrived while `open()` was running, the state is no longer
   * `opening` and neither the iterator nor the failure replaces it.
   */
  const settle = (outcome: CapabilityState): void => {
    if (state.name === 'opening') state = outcome;
  };

  /**
   * The object the accumulator drives.
   *
   * It is its own iterator, and it hands back **the named binding rather than
   * `this`**. `this` is decided by how the method was called, so an accumulator
   * that pulls `[Symbol.asyncIterator]` off the object and calls it standalone
   * would get `undefined` from a `this`-based version and the same object from
   * this one. The identity being independent of the call form is the point of
   * the property, not a detail of it.
   */
  const facade: AsyncIterable<Chunk> & AsyncIterator<Chunk> = {
    [Symbol.asyncIterator]() {
      // No acquisition happens here. The underlying was taken once, by the
      // engine, at the call that opened it — so this door, which is the one the
      // reviewer's counterexample opens a subscription through, reaches nothing.
      return facade;
    },
    async next() {
      // The door, which is `live()` and nothing else — see it for why the
      // three doors now share one read of one state.
      const iterator = live();
      if (iterator === undefined) return done();
      const result = await iterator.next();
      // **Checked again on the way back**, because the first check bounds pulls
      // that *start* after the revocation and this one bounds pulls that were
      // already in flight when it landed. Without it an accumulator that starts
      // a pull and then lets the invocation return still receives what the
      // producer had queued, which is the state 0002 said could not exist. The
      // shipping path never reaches this arm: the `finally` that revokes runs
      // after the accumulator's own loop has finished.
      //
      // **What it does not turn back is a rejection**, and that is a boundary
      // rather than an omission. A pull in flight whose producer *throws* raises
      // at whoever asked, revoked or not: swallowing it would be this module
      // deciding that an error which happened is an error that did not, which is
      // a worse failure than delivering one to a caller that has finished. It
      // carries no chunk, opens nothing, and is unchanged from before this
      // facade existed.
      return state.name === 'revoked' ? done() : result;
    },
    async return() {
      const iterator = live();
      if (iterator === undefined) return done();
      // Delegated, because a `break` out of the accumulator's loop is how the
      // stream learns it has been stopped — `twoStageStream`'s `finally`
      // abandons the attempt there, and swallowing this would leave a
      // `refresh()` waiting on an attempt nothing ends. An underlying without
      // `return` is already as closed as it can be made.
      //
      // **Re-read on the way back, for `next()`'s reason and with one clause
      // of its own.** The unwind this started is not undone by the revocation
      // landing mid-flight — `twoStageStream`'s `finally` runs and abandons the
      // attempt, which the accumulator asked for while it still held the
      // capability — and what this bounds is the *value*: `return()` may answer
      // `{done: false, value}` just as `next()` may, so a chunk could otherwise
      // cross the seam through this door after the invocation ended.
      const result = (await iterator.return?.()) ?? done();
      return state.name === 'revoked' ? done() : result;
    },
    async throw(reason?: unknown) {
      const iterator = live();
      if (iterator === undefined) return done();
      // What delegation does when the target has no `throw`: the reason is
      // raised at the caller rather than swallowed into a `done`.
      if (iterator.throw === undefined) throw reason;
      // The third door, bounded like the other two. A rejection still reaches
      // the caller — see `next()` for why an error that happened is not turned
      // into an error that did not.
      const result = await iterator.throw(reason);
      return state.name === 'revoked' ? done() : result;
    }
  };

  // **Frozen, so that holding this object is holding what the engine built.**
  // Without it `stream[Symbol.asyncIterator] = () => somethingElse` is one
  // assignment, and while that reaches no producer — the iterator is closure
  // private and there is no door to it — it does re-point what the *next*
  // holder of this object iterates. Property (3) above is that the engine's
  // facade is closure-bound and not re-pointable; this is the whole of the
  // second half, and an assignment in strict mode (which every module is) now
  // throws rather than passing silently. It is not what makes the facade
  // unforgeable, because nothing does — see (3) for what replaced that claim.
  //
  // What it does not make true is that a value crossing the seam comes back
  // unwrapped: an accumulator may hand *its own* object to anything downstream
  // of it. That is outside this the same way an accumulator that imports the
  // request machinery is.
  Object.freeze(facade);

  // **The pair itself is frozen too, and it was not for a round.** The header
  // above sells property (3) as "the object is frozen, so a holder cannot swap
  // what the *next* holder iterates" — true of the facade, and this is the
  // object the engine holds: `capability.stream = …` is one assignment and
  // re-points what the engine's own `finally` and the accumulator receive.
  // Found by a reviewer measuring `Object.isFrozen` on what this returns.
  return Object.freeze<StreamCapability>({
    stream: (context) => {
      // **The failure fixed, and raised again by identity.** A retry here is
      // the hole this state machine was built for: the accumulator that caught
      // the first error and called again used to open the underlying a second
      // time, inside one invocation, with nothing having counted. Raising the
      // same object rather than a fresh one is what lets a caller tell "the
      // acquisition that failed" from "an acquisition that failed again".
      if (state.name === 'failed') throw state.reason;
      // **A call from inside `open()` is refused rather than served.** The
      // facade would answer `done` at every door until the acquisition
      // returned, which is a stream saying it ended before it started; an
      // accumulator that re-enters its own acquisition is better told so.
      if (state.name === 'opening') {
        throw new Error('oneShotStream: the capability was asked for from inside its own opening');
      }
      // **The same object back, rather than a refusal.** Throwing would turn a
      // second call into a rejection of the invocation, which C11 records as a
      // failure of the attempt — so a shape that today merely forks would start
      // reporting an error the request did not have. Handing back the one
      // capability makes the second call a no-op instead, and two loops over one
      // iterator split the chunks between them, which A11 already permits.
      //
      // `revoked` answers here too, and **not opening after revocation** is
      // stronger than the producer-that-will-not-start this used to build: a
      // producer that is never constructed cannot put a frame on the wire under
      // any later edit, where one built against an aborted signal is safe only
      // for as long as the machine keeps checking that signal first.
      if (state.name !== 'unopened') return facade;
      // Opened here and only here, with the state moved *before* the call so
      // that `open` re-entering finds `opening` rather than `unopened`.
      state = { name: 'opening' };
      try {
        settle({ name: 'opened', iterator: open(context)[Symbol.asyncIterator]() });
      } catch (reason) {
        // Both throwing sites, deliberately in one `try`: `open()` and the
        // acquisition are one acquisition as far as this capability's promise
        // goes, and a version that caught only the first would leave the second
        // retrying — which is half the bug rather than none of it.
        settle({ name: 'failed', reason });
        throw reason;
      }
      return facade;
    },
    revoke: () => {
      // **Absorbing, from every state including `failed`** — see the module
      // header. The version that returned early here, keeping a fixed failure
      // alive past the withdrawal, is `failure-survives-the-withdrawal` in the
      // ledger: it reads well ("an error that happened is not an error that did
      // not") and it puts an exception inside a sentence the records state
      // without one, which is the more expensive of the two.
      state = {
        name: 'revoked',
        iterator: state.name === 'opened' ? state.iterator : undefined
      };
    }
  });
}
