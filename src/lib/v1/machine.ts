/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type Nostr from 'nostr-typedef';
import type { EventPacket } from 'rx-nostr';
import { createRxForwardReq, createRxOneshotReq } from 'rx-nostr';
import type { Subscription } from 'rxjs';
import { EMPTY } from 'rxjs';

import type { OwnedPacket } from './event.js';
import { ownPacket } from './event.js';
import type { BacklogEnd, IncompleteCause, LegName, Refusal } from './eventset.js';
import { backlogEndOf } from './eventset.js';
import type { TransportCapability } from './lease.js';
import { InvalidDescriptorError, relayMessage } from './normalize.js';
import { captureFromRelay, relayFailure } from './own.js';
import { ownedByLibrary } from './owned.js';
import type { RelayPhase } from './refusal.js';
import { approachFor, classifyRefusal, phaseOfConnectionState } from './refusal.js';
import type { RelayLegError } from './reqerror.js';
import type { MachineChunk } from './stream.js';

/**
 * The reference state machine for a request's lifetime.
 *
 * It exists to settle, by measurement, the questions the design document could
 * not answer from prose:
 *
 * - what a settle timeout does to each subscription and to late data
 * - whether the two stages can be consumed concurrently rather than in sequence
 * - who closes what, at every phase, when the consumer goes away
 *
 * Rules:
 *
 * 1. non-live: only a backward req. EOSE/down or timeout settles it, and the
 *    stream ends. A timeout closes the backward req rather than leaving it open.
 * 2. live: backward and forward start together and are **consumed together**.
 *    The sequential shape (drain the backlog, then move to the forward
 *    iterator) is what left the forward queue growing unbounded and left a
 *    subscription owned by no running `for await`.
 * 3. live timeout: close the backward req only; the forward one stays.
 * 4. abort at any phase: the owner closes everything it opened.
 * 5. the forward req uses the descriptor's filters unchanged. Narrowing it with
 *    an internal `since` would drop backdated and delayed events, which no
 *    accumulator can recover; duplicates, by contrast, fold away.
 * 6. the end, however it is reached, is a contract in three clauses:
 *    everything queued before it is delivered, the producer is released
 *    synchronously with the decision, and nothing arriving after that is
 *    delivered. The three are why the queue is drained past `end` rather than
 *    returned on, and why the release is not left to the `finally`.
 */
export interface MachineParams {
  transport: TransportCapability;
  filters: Nostr.Filter[];
  live: boolean;
  /**
   * The relays this request is asked of, decided before it starts.
   *
   * Supplied rather than read from the client, and that is B3 reaching the wire.
   * This used to be `getDefaultRelays()` filtered by `read`, taken once at the
   * start — which fixes the set for the request's lifetime but takes it from the
   * wrong place: the request was keyed by a `RelayScope`, and the client's
   * defaults are only equal to it while nothing has moved them. The REQ itself
   * named no relays at all, so it went wherever the client pointed at the moment
   * it was sent, which need not even be this set.
   *
   * Both tables below and both REQs are built from this one list now, so "the
   * request was asked of the relays it was keyed for" holds by construction
   * rather than by three reads agreeing.
   */
  targets: readonly string[];
  reqIdBase: string;
  signal: AbortSignal;
  /** Query-local settle timeout. rx-nostr's own cannot be used (it is global). */
  timeoutMs?: number | undefined;
  /**
   * Spike-only knob for measuring the alternative discussed for the duplicate
   * backlog: ask the relay for no stored events on the forward leg. The
   * relay-side half of this cannot be measured here.
   */
  forwardLimitZero?: boolean | undefined;
  /**
   * Spike-only. When true the abort listener is not registered, so nothing
   * unwinds until the generator is resumed. That is what relying on
   * `streamedQuery`'s own cancellation looks like: it sets a flag and checks it
   * on the next chunk, so a stream with nothing left to deliver never cleans up.
   * Exists to measure that, not because anything should set it.
   */
  passiveAbort?: boolean | undefined;
  /**
   * The signature gate, and it is the library's rather than the dependency's.
   *
   * rx-nostr verifies inside `use()`, behind an `await` that puts every event
   * one microtask further from the raw message channel than the marker this
   * machine defers by exactly one — so the backward subscription was released
   * before the events **the dependency's own verifier had already passed** were
   * handed downstream, and an EOSE arriving with its own event lost that event
   * outright (measured at 3.7.5, `AE1`). No amount of deferral fixes that: it
   * is not a race whose margin can be widened, it is a barrier inferred from a
   * signal the dependency happens to emit.
   *
   * So the client is built with `skipVerify: true` and the gate is here, where
   * what is still inside it is something this machine holds rather than
   * something it guesses. That is why both legs go through {@link admitEvent}
   * and why the two moments that end a wait — {@link settle} and
   * {@link finish} — consult it. **Each consults its own leg's**, which is the
   * difference between a wait that ends and one a live subscription can hold
   * open forever; see {@link gates}.
   *
   * **Required, and that is the repair rather than a detail.** It was optional,
   * so a caller that forgot it got a machine with no gate at all — and the
   * configuration that produces is the dangerous one, because the client is
   * built with `skipVerify: true` precisely *because* this exists. Forgetting
   * it meant nothing verified anywhere, silently.
   *
   * The dependency's own default was `emptyVerifier`, which throws: absent a
   * verifier, rx-nostr refused to deliver anything. Moving the gate here and
   * leaving the parameter optional turned that fail-closed default into a
   * fail-open one, which is a strictly worse posture than the one being
   * replaced. A required parameter is how the absence stops being
   * representable; a test that wants no verification has to say so.
   */
  verifyEvent: (event: Nostr.Event) => Promise<boolean>;
}

/**
 * How long the gate may make no progress before the wait is cut.
 *
 * A *per-event* bound rather than a total one, and that is the whole of why it
 * is not a constant. Verification is CPU-bound and does not benefit from being
 * started concurrently — 100 real events cost 126.7ms started all at once and
 * 126.0ms one after another, measured against `rx-nostr-crypto` at 3.1.3 — so a
 * gate holding N events needs about N times one event's cost. Across every run
 * 0002 records — `tools/verifier-p95.mjs` is the measurement — the p95 sits
 * between 1.275 and 1.467ms, so that is between 127 and 147ms for 100 events
 * and between 637 and 734ms for 500, and 500 is an ordinary relay `limit`. **The
 * range rather than a central figure**, because the record's own forty runs do
 * not support one: 1.4 was quoted here as typical while it is the top of the
 * envelope. **A fixed total, whatever it is, is therefore wrong
 * for some perfectly normal backlog**, which is what `AE7` fails on.
 *
 * The bound is re-armed every time an event leaves the gate, so N does not
 * enter it: what is bounded is a gate that has stopped moving. `slowest`
 * rather than the first or the mean, because a cost already paid cannot be
 * un-learned by a faster sample afterwards — a bound taken from the first
 * event would be set by whichever event happened to be quick.
 */
const VERIFY_DRAIN_SAFETY = 4;
/**
 * The bound that applies before anything has been measured — the gate's first
 * event, which is the one case `slowest` cannot speak for.
 *
 * **It bounds a verifier that has stopped, not one that is slow**, and the two
 * need very different numbers. The verification this library ships costs
 * milliseconds, so the gate empties and this timer is cleared before it fires;
 * a small value, meanwhile, cuts the first event of any verifier slower than
 * itself, which is a working verifier being treated as a hung one. One second
 * is between 681 and 785 times the measured p95 of a real verification
 * (1.275-1.467ms; `tools/verifier-p95.mjs` measures it), which
 * is what makes it firing *evidence* of a gate that will never drain rather
 * than a threshold anybody has to tune.
 *
 * **"Costs nothing" was written here without a qualifier and is false with
 * one.** This is a hard cutoff wherever the armed deadline is the floor itself
 * — every leg whose slowest sample is at or below a quarter of it, since
 * {@link VERIFY_DRAIN_SAFETY} is 4 — and a leg that has verified nothing has a
 * sample of zero, which is one instance of that rather than the case itself. So
 * a single verification slower than a second is cut on a leg that has only seen
 * quick ones, working or not. What makes the number acceptable is a policy
 * about the verifier this library supplies, not a proof that no Promise takes
 * longer.
 */
const VERIFY_DRAIN_FLOOR_MS = 1000;

type Signal =
  | { type: 'event'; packet: OwnedPacket }
  /**
   * The backlog's wait is over. What it was *missing* is not in here.
   *
   * It used to be: `backwardEnd()` ran where the marker was queued, and the
   * outcome a consumer got was therefore a photograph of the per-relay table
   * taken at that instant. That makes the answer depend on when the dependency
   * happens to tell us things — rx-nostr completes a subscription before it
   * routes the same turn's `EOSE` (measured), so a table read at queue time can
   * still have the relay that just answered as `active`. Deriving it where the
   * marker is *delivered* is the same rule the record states: an attempt's
   * outcome is observable only once everything causally prior to it is
   * reflected. `viaTimer` rides along because it is the one input the table
   * cannot hold.
   */
  | { type: 'settled'; viaTimer: boolean }
  | { type: 'legEnded'; leg: 'forward'; reason: RelayLegError | undefined }
  | { type: 'refused'; refusal: Refusal }
  | { type: 'end' };

/**
 * What one relay's backward leg is doing, which is the table this step adds.
 *
 * The forward leg has had one since A5 and the backward leg had none, so the
 * backlog's outcome was whatever single signal happened to arrive first. Three
 * of these are *determined* — the relay is done, one way or another — and the
 * cause set is derived once every relay is.
 *
 * | state      | reached by                                |
 * | ---------- | ----------------------------------------- |
 * | `pending`  | the request has begun, no REQ observed    |
 * | `active`   | a matching backward REQ went out          |
 * | `complete` | a matching `EOSE`                         |
 * | `refused`  | a matching `CLOSED`                       |
 * | `ended`    | a terminal connection state before `EOSE` |
 *
 * `timeout` is not among them because it is not a relay's state: it is the
 * request's own timer firing while a relay is still `pending` or `active`.
 */
type BackwardPhase = 'pending' | 'active' | 'complete' | 'refused' | 'ended';

const DETERMINED: ReadonlySet<BackwardPhase> = new Set<BackwardPhase>([
  'complete',
  'refused',
  'ended'
]);

/**
 * What one leg's signature gate is doing, and it is a state rather than a flag
 * beside a counter.
 *
 * | phase      | means                                                        |
 * | ---------- | ------------------------------------------------------------ |
 * | `open`     | the leg admits events, and nothing is waiting on it           |
 * | `draining` | a boundary was drawn: no new admissions, and a wait is on     |
 * | `drained`  | everything the boundary caught was decided                    |
 * | `cut`      | the wait ended first, and what was still inside is discarded  |
 *
 * **`drained` and `cut` are absorbing, and that is the whole of the second
 * repair.** The cut used to be a boolean set beside the waiters being released,
 * which left the gate itself open: a verification finishing afterwards still
 * pushed its event — behind the outcome it was supposed to be part of, measured
 * as `settled, event` — and the next thing to want a wait registered a second
 * one over the same gate, so a request that had already given up on its
 * verifier sat through another full drain period before its stream ended.
 * Neither is reachable from a phase that cannot leave itself: after `cut`
 * nothing is delivered, nothing is admitted, no waiter is taken and no deadline
 * is armed.
 */
type GatePhase = 'open' | 'draining' | 'drained' | 'cut';

/**
 * One event admitted to the gate from the wire and not yet decided.
 *
 * **Admitted is not `accepted`** — A-ε defines that word and this does not
 * restate it. Everything in this set is still pending verification, and a
 * candidate the cut finds here never reached it.
 */
interface Admission {
  /** It was still inside the gate when the wait over that leg was cut. */
  discarded: boolean;
}

interface Gate {
  phase: GatePhase;
  /** What this leg admitted and is still holding pending verification. */
  readonly holding: Set<Admission>;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** What the boundary is waiting to run. It runs once, whichever way it ends. */
  then: (() => void) | undefined;
  /**
   * The slowest verification **this leg** has seen, in ms, and it is per-leg
   * for the reason `phase` and `holding` are.
   *
   * It was one value outside both gates, on the argument that it measures the
   * verifier and the verifier is one object. That confuses the identity of the
   * *policy* with the identity of the individual latencies: the same verifier
   * costs different amounts on different events, on a busy scheduler, and
   * across a suspended tab. Every leg's `leave()` wrote it and both `armCut`s
   * read it, so one leg's history set the other's deadline — measured, and it
   * is the sharpest form of the defect the split was for. Same backward EVENT,
   * same EOSE, same verifier, differing only in whether one forward event had
   * been verified first: `incomplete(['verification-timeout'])` with the event
   * dropped, or `complete` with it delivered — the verifier's cause and not the
   * timer's, since every relay answered. A backlog outcome that is a function of
   * the forward leg's history is not a function of the backward leg alone,
   * whatever the phases do.
   */
  slowestVerifyMs: number;
}

export async function* referenceStream({
  transport,
  filters,
  live,
  targets: targetUrls,
  reqIdBase,
  signal,
  timeoutMs,
  forwardLimitZero = false,
  passiveAbort = false,
  verifyEvent
}: MachineParams): AsyncGenerator<MachineChunk> {
  // Nothing is opened when the consumer is already gone. Without this the
  // subscriptions are created and torn down in the same tick, which puts CLOSE
  // frames on the wire for REQs that never went out — invisible to a
  // one-directional invariant, and measured as two orphan CLOSEs before this
  // guard existed.
  //
  // **It carries a second job now, and the two are one line by luck rather than
  // by design.** The invocation's controller is aborted when the query function
  // returns (`useStreamedReq`'s `finally`), so this line is also what makes a
  // producer opened *after* that return start nothing: a stale `streamFn` called
  // late, or a stale iterator pulled late, reaches here with the signal already
  // aborted and no REQ goes out. That is the second half of `A11-C10` —
  // singularity stated as a revoked capability rather than as a count read at
  // one moment — and `AC21` is the witness. The two jobs fail differently, which
  // is why the witness watches every frame rather than the REQ list: with this
  // line gone the abort handler below still tears the subscriptions down inside
  // the tick, so no REQ reaches the relay and what does is a `CLOSE` for a
  // subscription nobody asked to open.
  if (signal.aborted) return;

  const queue: Signal[] = [];
  const subscriptions: Subscription[] = [];
  let backward: Subscription | undefined;
  let wake: (() => void) | undefined;
  let settled = false;
  /** The forward leg is over. A live request ends when both legs are. */
  let forwardEnded = false;
  let ended = false;
  /** The end is decided and the gate is being drained before it is announced. */
  let ending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  // --- the signature gate ---------------------------------------------------
  /**
   * One gate per leg, and the split is the repair rather than a tidying.
   *
   * It was a single counter over both legs, and the backlog's wait was "the
   * counter is zero". A live request's forward leg is, by definition, traffic
   * that does not stop, and the bound below re-arms whenever anything clears —
   * so a backlog whose own relays had all answered was held by events with no
   * causal relation to it, for as long as the forward leg kept arriving.
   * Measured: no outcome 1.5s after the EOSE, and one the instant the feed was
   * switched off (`AE13`). That breaks A-γ's finite settlement and `C11-C6`,
   * and it cannot be repaired by bounding the forward leg harder: a bound that
   * cut *it* would be cutting a working live subscription.
   *
   * So a wait is over one leg, and over what that leg was holding when the
   * boundary was drawn — never over what it admits afterwards, because there
   * is nothing after: drawing the boundary closes the leg. `AE14` is what makes
   * this a separation rather than merely a shorter wait: the backlog answers
   * the same thing whatever order the two legs verify in, including the order
   * where the forward leg never finishes at all.
   */
  const newGate = (): Gate => ({
    phase: 'open',
    holding: new Set(),
    timer: undefined,
    then: undefined,
    slowestVerifyMs: 0
  });
  const gates: Record<LegName, Gate> = { backward: newGate(), forward: newGate() };
  /**
   * The backlog's outcome is in the queue.
   *
   * The end waits on this, and that is the ordering the shared counter used to
   * provide by accident: both deferred pushes waited on one gate, and the
   * marker's wait was registered first. Separated, the forward gate can be
   * empty while the backward one is still draining — a live request whose
   * relays all die with a backlog event still being verified — and the end
   * would then be announced ahead of the outcome it follows, which is the state
   * `SM14b` says cannot happen and the one a `refresh()` waits on forever. So
   * it is stated as a causal order between the two rather than inferred from
   * them sharing a counter.
   *
   * **This used to cite `SM14` beside it, and `SM14` does not say it.** Its
   * gate is empty, so `finish()`'s microtask runs after `settle()`'s and the
   * wait below has already been satisfied when it is asked. Measured:
   * `end-announced-without-waiting-for-the-outcome-it-follows` removes exactly
   * this wait, has `machine.test.ts` in its scope, and kills `SM14b` alone.
   */
  let backlogReported = false;
  let afterBacklog: (() => void)[] = [];

  const notify = () => {
    const resume = wake;
    wake = undefined;
    resume?.();
  };

  const push = (s: Signal) => {
    queue.push(s);
    notify();
  };

  const closeBackward = () => {
    backward?.unsubscribe();
    backward = undefined;
  };

  const closeAll = () => {
    closeBackward();
    for (const sub of subscriptions) sub.unsubscribe();
    subscriptions.length = 0;
    if (timer !== undefined) clearTimeout(timer);
    // The gates' own deadlines are **not** cleared here, and that is a
    // correction rather than an omission. `finish()` calls this while the
    // backward gate may still be draining, and the end waits for that gate to
    // resolve — so clearing its deadline here is how the end stops being
    // finite. What releases them is {@link abandonGate}, at the two moments
    // nothing inside the gate can reach a consumer any more.
  };

  /**
   * Give up on both gates outright: the consumer is gone, or the stream has
   * already returned, so nothing still being verified can reach anybody.
   *
   * `open` and the two resolved phases are left alone. `draining` is the only
   * one that moves, because it is the only one holding a wait that will now
   * never be answered — and moving it is what stops the next verification to
   * land from arming a fresh deadline behind a stream nobody is reading. A gate
   * that has already answered keeps the answer it gave, so an outcome queued
   * before the abort still reads the same when the consumer drains it.
   */
  const abandonGate = () => {
    for (const gate of [gates.backward, gates.forward]) {
      if (gate.timer !== undefined) clearTimeout(gate.timer);
      gate.timer = undefined;
      gate.then = undefined;
      for (const each of gate.holding) each.discarded = true;
      if (gate.phase === 'draining') gate.phase = 'cut';
    }
    afterBacklog = [];
  };

  /**
   * The gate, and both legs go through it — into a gate of their own.
   *
   * A forged event reaching a consumer is worse than a lost one — the loss is
   * visible as an absence and the forgery is not — so this is not an
   * improvement on the dependency's verification but the replacement for it:
   * the client is built with `skipVerify: true`, and nothing else checks. That
   * is why the forward leg is here too. Routing only the backward leg through
   * it, which an earlier round of this change did, hands the consumer live
   * events nobody verified (`AE3` is the witness, and it fails that way).
   *
   * **Both legs verify; neither waits on the other.** The two are separate
   * claims and one counter conflated them — see {@link gates}. `leg` is a
   * parameter rather than a lookup because the caller is the only thing that
   * knows which subscription an event came off: nothing on the packet says.
   */
  const admitEvent = (leg: LegName, incoming: EventPacket) => {
    const gate = gates[leg];
    // **Nothing enters a leg whose boundary has been drawn**, and that is the
    // narrowing of A-ε made operational. **A-ε defines `accepted` and this does
    // not restate it** — the word has one definition site precisely because a
    // paraphrase here and another in 0004 is how it came to mean two things at
    // once. Under that definition an event the wire offers after this request
    // stopped waiting was never accepted by this attempt and is not owed
    // delivery. Admitting it would put it either ahead of an outcome it is not
    // part of or behind one it was never in, and it would extend a wait that
    // has already ended. `AE18` is the witness, over the one boundary that
    // leaves the subscription open behind it — A-γ's timer.
    if (gate.phase !== 'open') return;
    // **After the gate, and before anything reads the event.** The copy is
    // taken here rather than at the top for two reasons measured separately: a
    // candidate arriving on a leg whose boundary is already drawn is not
    // allocated for, and a *malformed* one is refused rather than thrown over.
    // `rx-nostr` packets `message[2]` without checking its shape, so a relay can
    // put `{"id":"x","tags":null}` on the wire; with the copy at the top that
    // reached `tags.map` in a subscription callback and left as an uncaught
    // `TypeError` — a defect this boundary introduced by moving in front of the
    // verifier, which is where the shape used to be somebody else's problem.
    //
    // `undefined` is "this never was an event": not verified, not stored, not
    // delivered, and not counted against the gate either. The relay's EOSE and
    // CLOSED are read as usual, so the request still reaches an outcome.
    const packet = ownPacket(incoming);
    if (packet === undefined) return;
    const admission: Admission = { discarded: false };
    gate.holding.add(admission);
    const startedAt = Date.now();
    const leave = (deliver: boolean) => {
      // A candidate the cut discarded is not delivered late. That is what
      // `settled, event` was, and it is the half of A-ε this round narrowed:
      // the alternative — an event kept until whenever it passes — is the
      // unbounded wait the finite cutoff exists to refuse.
      if (deliver && !admission.discarded) push({ type: 'event', packet });
      const took = Date.now() - startedAt;
      // Onto this leg's own measurement. `gate` is the one `admitEvent` was
      // called for, so the leg that paid the cost is the leg that learns it.
      if (took > gate.slowestVerifyMs) gate.slowestVerifyMs = took;
      gate.holding.delete(admission);
      // `open` has no wait to answer; `drained` and `cut` have answered. Only a
      // draining gate has anything to do here, which is what makes the two
      // resolved phases absorbing rather than merely final-looking.
      if (gate.phase !== 'draining') return;
      if (gate.holding.size > 0) {
        // Progress: the bound is about a gate that has stopped, so re-arm it
        // rather than letting one deadline cover an unbounded number of events.
        armCut(gate);
        return;
      }
      resolveGate(gate, 'drained');
    };
    // **Synchronous throw and rejection onto one path, and the type permits
    // both.** `(): Promise<boolean> => { throw error }` satisfies the parameter
    // — the annotation promises a Promise and the body never gets as far as
    // making one — and called bare, that throw leaves through an RxJS `next`
    // callback: reported as an uncaught error, with the admission it was
    // counted as never coming back, so the gate held an event that no longer
    // existed until the wait was cut (measured, `AE17`). `AE8` could not see it
    // because an `async` function turns the same `throw` into a rejection.
    //
    // **The verifier is handed this library's frozen copy**, which is the same
    // object the cache will hold — that identity is the point of taking the
    // snapshot before verifying rather than after. The cast is the dependency's
    // type, not a doubt about the value: a verifier written against
    // `Nostr.Event` is what a consumer has, and `ReqEvent` differs from it only
    // by being `readonly`.
    Promise.resolve()
      .then(() => verifyEvent(packet.event as unknown as Nostr.Event))
      .then(
        // **`true` and nothing else delivers.** The annotation says
        // `Promise<boolean>` and the function is a consumer's, which is the
        // same premise every other prop on this boundary is checked under: a
        // verifier that resolved `'nope'`, `{ ok: false }` or any other truthy
        // value published the event as verified, because the answer was read
        // for truthiness rather than checked — measured. This is the one seam
        // where reading a value loosely means publishing an unverified event,
        // so it fails closed: an answer this library cannot read as `true` is
        // an event that did not pass, which is where a rejection already went.
        (ok) => leave(ok === true),
        // A verifier that fails drops the event and must not wedge the gate.
        //
        // Not a hypothetical: rx-nostr's own default verifier is
        // `emptyVerifier`, which throws. With verification inside `use()` that
        // rejection had nowhere to go — it escaped as an uncaught exception
        // while the backlog waited out A-γ and said nothing. Here it is an
        // event that does not pass and a gate that keeps draining, which is
        // what `AE8` measures.
        () => leave(false)
      );
  };

  /**
   * See {@link VERIFY_DRAIN_SAFETY}: measured, re-armed, never a constant — and
   * **from this leg's own measurement, between two ends that do not move.**
   *
   * `Math.min` is the second half, and it is what makes A-ζ's "finite and
   * capped" true of the implementation rather than only of the shape — this
   * budget is the gate's, and A-γ's cap is over the settle timeout instead. The
   * sample is `Date.now()` elapsed across a `Promise`, which is wall time: a
   * suspended tab, a stopped debugger or a verifier that hangs and then answers
   * writes minutes into it, and four times a minute is the next wait. Nothing
   * downstream bounds that, so a single anomalous sample made the next wait
   * effectively unbounded.
   *
   * **The premise that used to carry that sentence — "the request's own timer
   * has already fired by the time a gate is draining" — is true of one path
   * only, and the conclusion holds on every path.** Where A-γ's timer drew the
   * boundary it has indeed fired. Where an EOSE drew it the timer is still
   * armed, and what makes its later firing harmless is `settled` rather than
   * the clock. On the forward leg `finish()` reaches `closeAll()`, which clears
   * it outright. And a request given no settle timeout at all never armed one —
   * reachable here, though not through the public surface, which normalizes a
   * missing one (A-γ). On no path does anything outside this deadline
   * end the wait, which is the property; the reason differs per path, and
   * stating the wrong one invites a port to rely on it.
   *
   * The clamp is on the *sample* rather than on the product, so the bound reads
   * as one sentence: believe a per-event cost up to the floor, and wait
   * {@link VERIFY_DRAIN_SAFETY} times what you believe, never less than the
   * floor. That puts every deadline in `[VERIFY_DRAIN_FLOOR_MS,
   * VERIFY_DRAIN_FLOOR_MS * VERIFY_DRAIN_SAFETY]` — 1000ms to 4000ms — by
   * construction rather than by a second constant needing its own derivation.
   *
   * **The floor is the right ceiling for the sample because of what the floor
   * already is**: the number past which a gate not moving is *evidence* that it
   * never will, between 681 and 785 times the measured p95 of a real
   * verification. **725 stood here**, which is a point derived from a single
   * run's 1.379ms and is not derivable from the envelope at all; and "680 to
   * 780" stood here after that, which is the envelope **rounded outward** and
   * then divided, so neither end matched its own citation; then "682 to 784",
   * which divides the right two numbers and rounds the quotients **inward**, so
   * the interval excludes both of its own endpoints. **The rule these now
   * follow**: round the low end down and the high end up, so an interval always
   * contains every value it is derived from. A
   * sample above it is not a slow verifier being described, it is a stopped one
   * — or a clock that jumped. And the clamp itself costs a working verifier
   * nothing: a sample at or above the floor produces a 4000ms deadline either
   * way, so a per-event cost below four seconds is waited out in full. What is
   * refused is only the extrapolation *from* such a sample.
   *
   * **What the floor costs is a separate question, and the answer is not
   * "nothing".** The deadline is the floor itself wherever the sample is at or
   * below a quarter of it, so a leg that has only seen quick verifications cuts
   * one that takes longer than a second — and a leg that has verified nothing
   * has a sample of zero, which is an instance of that rather than the whole of
   * it. See {@link VERIFY_DRAIN_FLOOR_MS} on why that is a policy about the
   * verifier this library ships.
   */
  const armCut = (gate: Gate) => {
    if (gate.timer !== undefined) clearTimeout(gate.timer);
    const believed = Math.min(gate.slowestVerifyMs, VERIFY_DRAIN_FLOOR_MS);
    const cap = Math.max(VERIFY_DRAIN_FLOOR_MS, Math.ceil(believed * VERIFY_DRAIN_SAFETY));
    gate.timer = setTimeout(() => {
      gate.timer = undefined;
      // T2, and only here: the wait was cut with events still being verified,
      // so the answer says it is incomplete rather than silently shedding them.
      //
      // **The other arm is unreachable, and it is kept for the direction it
      // fails in.** A deadline is armed only over a non-empty gate, and the one
      // statement that empties one resolves the gate and clears the deadline in
      // the same breath — so nothing takes the `drained` arm here. Measured, and
      // recorded in the ledger as `an-empty-gate-at-the-deadline-is-reported-as-cut`
      // with the falsification attempts. Written unconditionally, this line
      // would report a clean drain as a cut if any of that ever stopped holding;
      // the test keeps it answering correctly instead.
      resolveGate(gate, gate.holding.size > 0 ? 'cut' : 'drained');
    }, cap);
  };

  /**
   * End a leg's wait, once, and let nothing follow it.
   *
   * The guard is the absorption: a gate that is not draining has either never
   * had a wait or has already answered one, and in both cases there is nothing
   * here to do. That is what stops a cut from being followed by a second
   * deadline over the same gate (`AE16`) and what stops a discarded candidate
   * from being delivered after the outcome it missed (`AE15`).
   */
  const resolveGate = (gate: Gate, phase: 'drained' | 'cut') => {
    if (gate.phase !== 'draining') return;
    gate.phase = phase;
    if (gate.timer !== undefined) clearTimeout(gate.timer);
    gate.timer = undefined;
    if (phase === 'cut') for (const each of gate.holding) each.discarded = true;
    const then = gate.then;
    gate.then = undefined;
    then?.();
  };

  /**
   * Draw a boundary over one leg: it admits nothing more, and `then` runs once
   * what it was already holding has been decided — or once the wait is cut.
   *
   * Each leg's boundary is drawn at most once, by construction: the backward
   * one by `settle()`, which `settled` makes idempotent, and the forward one by
   * `finish()`, which `ending` does. So the early exit is only ever reached
   * with a gate that has already resolved.
   */
  const drawBoundary = (leg: LegName, then: () => void) => {
    const gate = gates[leg];
    if (gate.phase !== 'open') {
      then();
      return;
    }
    gate.phase = 'draining';
    gate.then = then;
    if (gate.holding.size === 0) {
      resolveGate(gate, 'drained');
      return;
    }
    armCut(gate);
  };

  /** Run `then` once the backlog's outcome is in the queue, or now if it is. */
  const whenBacklogReported = (then: () => void) => {
    if (backlogReported) {
      then();
      return;
    }
    afterBacklog.push(then);
  };

  /**
   * The stream is over: release everything it opened, then say so.
   *
   * Clauses two and three of the drain contract, and they are one line: the
   * producer is released at the instant the end is decided, so nothing arriving
   * afterwards can be queued — which is what makes "nothing after the end is
   * delivered" true rather than hoped for. It used to be released in the
   * `finally` below, which runs when the consumer next asks; between those two
   * moments the subscriptions were live and everything they carried was queued
   * and then handed over, so a refusal that arrived after the stream had ended
   * was delivered to an attempt that was over (SM16) — and, because the outcome
   * is derived where it is handed over, a late `EOSE` rewrote an answer that had
   * already been decided.
   *
   * **That second half used to cite `SM17`, and `SM17` does not observe it.**
   * Its subject is the forward leg ending the stream, which is cited further
   * down; its relay answers the backlog before anything has ended, so the answer
   * it wants *is* `complete` and no rewrite is visible from there. Measured:
   * `producer-released-at-the-drain-instead-of-the-decision` puts the release
   * back in the `finally`, has `machine.test.ts` in its scope, and kills `SM16`
   * alone — which is what that entry already records, having dropped the same
   * citation on its own side.
   *
   * `closeAll()` before the marker rather than after, so there is no instant at
   * all in which the end is decided and the producer is not yet gone.
   *
   * **The second clause splits in two once the library holds the gate, and both
   * halves are stronger than the sentence they replace**: nothing new may enter
   * (the producer is released) and nothing already inside may be dropped (the
   * gate is drained first). Releasing synchronously does the first and breaks
   * the second — an event rx-nostr has taken off the wire reaches `use()` a
   * turn after the raw message that decided the end, so a synchronous release
   * cancels a delivery that was causally *prior* to the decision (`AE2`).
   *
   * What the extra turn can admit is a question rather than a judgement call: a
   * socket message is a macrotask, so nothing that had not already arrived can
   * be processed inside one microtask. `AE4` is the witness — an event sent in a
   * later macrotask than the end is not delivered — and the third clause is
   * therefore kept rather than traded away.
   *
   * **The end waits on the backlog's outcome, and that is now said rather than
   * inherited.** Both deferred pushes used to wait on one counter, with the
   * marker's wait registered first; with a gate per leg the forward one can be
   * empty while the backward one is still draining — a live request whose
   * relays all die with a backlog event still being verified — and the end
   * would be announced ahead of the outcome it follows, which is `SM14b`'s
   * failure. Every path here runs after `settle()` has been called (its own
   * continuation, and `endForward` only when `settled`), so
   * {@link whenBacklogReported} waits rather than hangs.
   */
  const finish = () => {
    if (ended || ending) return;
    ending = true;
    queueMicrotask(() => {
      closeAll();
      whenBacklogReported(() => {
        drawBoundary('forward', () => {
          if (ended) return;
          ended = true;
          push({ type: 'end' });
        });
      });
    });
  };

  /**
   * The backward leg is over: stop waiting, and let the marker say so.
   *
   * `viaTimer` is the one input the per-relay table cannot hold. A-γ's timer
   * firing is the request giving up on relays that have not answered, which is a
   * different claim from having heard from all of them — and it is the only
   * claim that is about the request rather than about a relay.
   */
  const settle = (viaTimer: boolean) => {
    if (settled) return;
    settled = true;
    // Deferred by a turn, and what that still carries is the marker's *position*
    // rather than the outcome it names.
    //
    // rx-nostr completes the backward subscription *before* it routes the
    // `CLOSED` that refused it (measured). Pushed synchronously, the settle
    // marker therefore lands ahead of the refusal explaining it — and the
    // reducer can only attribute a backward refusal to the attempt that is
    // still running, so a refusal delivered after its own attempt's end is
    // dropped and the answer reports itself complete (P28). The same turn is
    // also where a same-turn `EOSE` reaches the per-relay table, and ending the
    // stream is what releases the channel carrying it: for a non-live request
    // this block *is* the end, so running it synchronously would tear down the
    // message channel before the `EOSE` that explains the end had been routed.
    //
    // What it no longer carries is the answer itself. That is derived where the
    // marker is delivered, which is strictly later than here.
    //
    // **The turn is also what makes the gate readable.** An event arriving off
    // the wire reaches `admitEvent` one microtask after the raw `EOSE` that
    // determined the last relay, so a count taken where that `EOSE` lands says
    // zero about an event that has not arrived yet — measured, and it is how an
    // earlier form of this change still lost the event it was written to keep.
    // After the turn the count is a fact.
    queueMicrotask(() => {
      // The events **this backlog** validated are causally prior to its
      // outcome, so the marker waits for them (A-ε) — and for nothing else.
      // Bounded by `armCut`, not by hope: if the leg stops moving the wait is
      // cut and the answer says so.
      drawBoundary('backward', () => {
        push({ type: 'settled', viaTimer });
        // Rule 1/3: the timeout is what closes the backward leg. For a non-live
        // request that also ends the stream; for a live one the forward leg stays
        // — unless it has already gone, in which case this is the last leg and
        // ending here is what `endForward` deferred.
        closeBackward();
        // Released before `finish()` rather than after, because `finish()` may
        // already be waiting here: `endForward` reaches it in the same turn
        // this marker was queued in, and its microtask runs before this one.
        backlogReported = true;
        const waiting = afterBacklog;
        afterBacklog = [];
        for (const each of waiting) each();
        if (!live || forwardEnded) finish();
      });
    });
  };

  /**
   * The forward leg is gone.
   *
   * For a live request that is the end of the stream: the backward leg has
   * already finished or will, and nothing else can produce an event. Ending
   * here is what lets the query resolve, which drops the activity axis to
   * `idle` — a request that says `live` while nothing can reach it is the
   * experience #90 and #83 are about.
   *
   * The Observable is not the input. rx-nostr routes transport failures to
   * `createAllErrorObservable()` and leaves the subscription untouched: on an
   * abrupt disconnect the forward stream neither errors nor completes
   * (measured, DIAG-3), so subscribing to it and waiting was the shape that
   * left a query saying `live` with nothing behind it. Its `error` and
   * `complete` handlers stay for the cases where it does signal — a dispose,
   * for instance — and the connection-state channel is what actually feeds
   * this, through the per-relay table below. That is why the table had to come
   * first: with several relays, one of them dying is partial degradation, and
   * only the last one is the end of the leg.
   *
   * **This does not settle the backlog, and an earlier version did.** Ending
   * the stream here closes the backward subscription with it, so settling
   * looked like the repair for a request that produced no outcome at all — a
   * relay refusing the *forward* subscription left its backward leg `active`
   * with nothing to wait for (SM18, P32). **This used to say "two relays…both
   * backward legs", which neither cited witness runs**: both drive one relay,
   * and one is enough. It repaired that and paid
   * for it in answers: a relay may refuse the live subscription and answer the
   * backlog it never refused, and those events were discarded (SM17, P33).
   *
   * So the end is recorded and the stream ends when the last leg does — here
   * if the backlog is already over, in `settle` if it is not. A relay that
   * refuses the live subscription and then says nothing is bounded by A-γ.
   */
  const endForward = (reason: unknown) => {
    forwardEnded = true;
    push({
      type: 'legEnded',
      leg: 'forward',
      // Frozen where it is taken, like the failure on the value: this Error is
      // stored on the record and republished as `ReqDiagnostics.legEnded.error`
      // to every reader of it, so it is shared the moment it is kept. The
      // ownership boundary is here — a reason handed over by the transport is
      // nobody else's afterwards.
      reason: reason === undefined ? undefined : captureFromRelay(reason)
    });
    // Only if the backlog is already over. If it is not, `settle` ends the
    // stream when it finishes — the last leg out turns off the light.
    if (settled) finish();
  };

  // A5's fifth event.
  //
  // A relay refusing at the protocol level neither errors nor completes the
  // subscription (DIAG-2), and `CLOSED` is the only protocol-level refusal that
  // carries a subId at all (CONST-R9) — `NOTICE` and `OK` have nowhere to say
  // which request they are about. So this channel is not one option among
  // several; it is the only place a refusal can be attributed to a request.
  //
  // Matching is on the wire subId, which rx-nostr composes as `<rxReqId>:<n>`.
  // That composition is why A6 insists on explicit ids: without them the id is
  // drawn from a random space and nothing here could tell whose refusal it is.
  const legOf = (subId: unknown): LegName | undefined => {
    // **`subId` is off the wire too**, and this is the function every packet is
    // attributed by: a relay answering with a number here would throw
    // `startsWith is not a function` from the message channel rather than being
    // ignored. A packet nobody can attribute belongs to no leg, which is what
    // `undefined` already means.
    if (typeof subId !== 'string') return undefined;
    if (subId.startsWith(`${reqIdBase}-b:`)) return 'backward';
    if (subId.startsWith(`${reqIdBase}-f:`)) return 'forward';
    return undefined;
  };

  // Which relays have no live forward subscription.
  //
  // A `CLOSED` ends the subscription on the relay's side and rx-nostr routes it
  // to `fin(subId)`, so after one there is nothing outstanding there whatever
  // the notice said. This used to exclude the refusals that "clear by waiting",
  // which meant a rate limit from every relay left the request reporting `live`
  // with no subscription anywhere and nothing that would ever open one — the
  // classification was applied and nothing acted on it.
  //
  // Membership is cleared by a REQ actually going back out, not by a guess about
  // what might happen. That matters for `auth-required:`: rx-nostr re-sends
  // after a successful AUTH when an authenticator is configured, whether one is
  // configured is not readable from the client, and the re-send is observable.
  // So the recovery this library does not perform is still recognised when
  // something else performs it.
  // A5's per-relay state, over the target set this request was planned and keyed
  // for.
  //
  // The rule used to be "every relay refused", which is too narrow in one
  // direction and whose obvious repair is too wide in the other. A relay that
  // drops off is not a refusal and must not end the leg: rx-nostr reconnects and
  // re-sends the ongoing request on its own, so ending there breaks the
  // recovery. A relay that is gone for good must end its part, or a request
  // nothing can reach goes on calling itself live.
  //
  // Fixed for the request's lifetime because otherwise a scope change decides
  // the fate of a request that was never asking those relays — `getDefaultRelays()`
  // was read at judgement time, so a relay added after the request began counted
  // towards whether that request could still be answered. Fixing it here was the
  // first half of that repair and left the second open: read from the client,
  // the set was whatever the client held when the stream started rather than
  // what the request was keyed for. It is the caller's now (B3).
  //
  // The urls are the scope's spelling and they have to be the client's too:
  // these keys are matched against `packet.from` / `packet.to` below, which
  // arrive spelled the way the connection spells them.
  //
  // **Two sentences stood here and both were false, and the second is why the
  // first survived a whole branch.** The first said the two spellings agree
  // because `canonicalUrl` writes out the dependency's normalization — they did
  // not agree: the dependency decodes the query string after sorting it and this
  // library did not, so any relay written with a percent-escape in its query was
  // two relays. The second said a divergence would be *loud* — "no relay would
  // ever match and every request would time out with everything pending". It is
  // not loud and it is not every request: only the relays whose spelling differs
  // drop out, their `EOSE` lands under a key this table does not hold, and what
  // the consumer sees is an ordinary partial answer blaming a network timeout on
  // a relay that answered. **Being indistinguishable from a real timeout is the
  // whole of why nothing found it**, and "it will be obvious later" was the
  // argument that kept it unmeasured for the length of this arc.
  //
  // What holds the agreement up now is not an agreement at all: **the name is
  // the transport's own answer**, asked for per relay at the boundary that
  // mints the scope, so there are no longer two implementations to keep in
  // step. `SEN25` and `SEN26` record what that transport does and that its
  // answer is not idempotent; `SC10` is not evidence here and never was — it
  // builds its scope over a hand-rolled stub, so no dependency code runs in
  // it, and it measures this library's own transformation.
  const targets = new Map<string, RelayPhase>(
    targetUrls.map((url) => [url, 'pending' as RelayPhase])
  );

  /**
   * The same table for the backward leg, over the same fixed target set.
   *
   * The backlog used to have no table at all: its outcome was whichever signal
   * arrived first, and rx-nostr's backward observable *completes* when every
   * target relay reaches `error` / `rejected` / `terminated` (measured at 3.7.5,
   * SEN13) rather than erroring. So a relay whose socket died reached the same
   * `complete` handler an answered relay does, and the answer reported itself
   * whole. An `error` handler cannot see that path; only the connection-state
   * channel can, and only per relay.
   */
  const backwardTargets = new Map<string, BackwardPhase>(
    [...targets.keys()].map((url) => [url, 'pending' as BackwardPhase])
  );

  const advanceBackward = (url: string, phase: BackwardPhase) => {
    const current = backwardTargets.get(url);
    if (current === undefined) return;
    // Determined is determined, for the reason `advance` says about `terminal`:
    // the first answer is the one this attempt got, and a relay that reconnects
    // afterwards belongs to whatever attempt `refresh()` opens next.
    if (DETERMINED.has(current)) return;
    backwardTargets.set(url, phase);
    if (!DETERMINED.has(phase)) return;
    if ([...backwardTargets.values()].every((each) => DETERMINED.has(each))) settle(false);
  };

  const backwardEnd = (viaTimer: boolean): BacklogEnd => {
    const present = new Set<IncompleteCause>();
    // **Two ways to run out of time, and they are two independent predicates
    // over two different things.** `timeout` is about the relays this request
    // stopped waiting on: A-γ's settle timer drew the boundary here, and the
    // loop below adds the same word for a target still undetermined when the
    // outcome is derived. `verification-timeout` is about this request's own
    // gate: it was holding candidates admitted inside that boundary and still
    // pending verification when the drain cutoff cut the wait, so they were
    // discarded — never `accepted` in A-ε's sense, and so never owed delivery.
    //
    // **Neither reading implies anything about the other, and the code says so
    // by adding them separately.** All four combinations occur: neither, on a
    // backlog that reaches EOSE and drains; the gate's alone (`AE15`); the
    // timer's alone (`AE18`); and both, from a single relay that sends an EVENT
    // and no EOSE while the verifier holds it (`AE21`). So a consumer cannot
    // read `verification-timeout` as "the relays are fine" — that is one trace
    // it appears in rather than what it means — and has to read the whole set.
    // The recoveries still differ, which is why the two are published as
    // separate words: one points at the relays and the network, the other at
    // the verifier and the device.
    if (viaTimer) present.add('timeout');
    if (gates.backward.phase === 'cut') present.add('verification-timeout');
    const gone: string[] = [];
    for (const [url, phase] of backwardTargets) {
      if (phase === 'ended') gone.push(url);
      // Still undetermined at the moment the wait ended. Three ways to reach it,
      // and they are all the request giving up rather than a relay saying
      // something: the timer above; the forward leg ending, which ends the
      // stream and with it any chance of an answer; and rx-nostr completing the
      // subscription with a relay outstanding, which its own `eoseTimeout` used
      // to do — the library now sets that far above any settle timeout it will
      // accept, so the last is the honest report of a case we do not expect.
      else if (!DETERMINED.has(phase)) present.add('timeout');
    }
    if (gone.length > 0) present.add('ended');
    return backlogEndOf(
      present,
      gone.length === 0
        ? undefined
        : relayFailure(`the connection to ${gone.join(', ')} ended before the backlog did`)
    );
  };

  // Before anything is asked: a relay this attempt is about to talk to may be in
  // a state where asking does nothing. rx-nostr does not re-open a socket
  // because a REQ arrived for it, so an attempt over a relay left in `error`
  // reaches nowhere and the request reports itself stopped again — which would
  // make "`refresh()` is the way back" false exactly when it is needed.
  //
  // **`status` is a plain object keyed by the spelling the transport uses, and
  // the lookup below uses ours.** That is safe because of a precondition rather
  // than because the two are the same kind of string: **every url in `targets`
  // is a name the transport itself produced** — the scope asks it, one relay at
  // a time, for what it calls the string the caller wrote, and refuses a name
  // the transport would not return unchanged. So "ours" and "the transport's"
  // are the same string by construction rather than by two implementations
  // agreeing.
  //
  // **Two earlier versions of this paragraph were false and are worth the
  // line.** The first said the two agree because this file's own transcription
  // writes out the transport's rule — they did not agree, and a healthy relay's
  // `EOSE` landed under a key this table did not hold. The second said the
  // scope canonicalizes on the way in and that `SC15` measures the property;
  // the canonicalization no longer decides the name, so both halves went stale
  // in the change that moved the decision to the transport.
  //
  // **Nothing checks it here, and a miss would be silent** — `?? 'initialized'`
  // is a relay that has not been heard from, which is exactly what a wrong key
  // looks like. The check belongs at the boundary that mints the targets rather
  // than at each reader, and a port that mints them somewhere else owes it
  // there; 0005 carries that as the obligation. Stated because this file has
  // three such lookups and the last one to be found had been wrong for the
  // length of the branch.
  // **Guarded, and the reason written here was wrong about the dependency.**
  // This said `rxNostr.getAllRelayStatus()` raises
  // `RxNostrAlreadyDisposedError`. It does not: rx-nostr 3.7.5 has no guard on
  // that accessor and a disposed client answers `{}` — which `lease.ts` records
  // correctly, so two records inside one branch disagreed. What throws is
  // `getDefaultRelays()`. The guard stays, because the capability answers
  // `undefined` for an **absent** client and for a **revoked** one, and both
  // reach here; what it does not have is an entrance from a disposed client, and
  // saying so is the difference between a guard with a reason and a guard with a
  // story.
  //
  // **It is not `provider-disposed`, and that is the second repair.** A provider
  // that disposes its own client revokes the lease first, so no request can get
  // this far (`lease.ts`); what is left here is a *caller* who handed this
  // library a client at the spike's low-level seam and then disposed it. That is an
  // unusable seam, and it is refused by the name of the seam like any other.
  const status = transport.relayStatus();
  if (status === undefined) {
    throw ownedByLibrary(
      new InvalidDescriptorError(
        'rxNostr',
        'could not be used — this request has no usable client: either none was supplied ' +
          'with the other owner inputs, or the one supplied has since been disposed'
      )
    );
  }
  /** Relays that were terminal before the request began. Applied after `advance` exists. */
  const preflightTerminal: string[] = [];
  for (const url of targets.keys()) {
    switch (approachFor(status[url]?.connection ?? 'initialized')) {
      case 'reconnect-then-ask':
        transport.reconnect(url);
        break;
      case 'give-up':
        // The relay refused the connection. Nothing to re-open, and retrying it
        // on every refresh would argue with an answer. Recorded rather than
        // acted on here: `advance()` below is the only writer of `terminal`,
        // because it is also what notices that the last relay has gone. Setting
        // the phase directly left a request whose whole target set was already
        // `rejected` with nothing to run the all-terminal check — so the leg
        // never ended and the request called itself live with no subscription
        // anywhere, which is the failure A5 exists to remove.
        preflightTerminal.push(url);
        break;
      case 'disposed':
        throw ownedByLibrary(
          new InvalidDescriptorError(
            'rxNostr',
            `could not be used — the connection to ${url} is terminated`
          )
        );
      default:
        break;
    }
  }

  const advance = (url: string, phase: RelayPhase) => {
    if (!targets.has(url)) return;
    // Terminal is terminal. A relay that reconnects after being gone does not
    // revive this attempt's leg — the leg is what this request holds open, and
    // `refresh()` is what opens a new one.
    if (targets.get(url) === 'terminal') return;
    targets.set(url, phase);
    if (phase !== 'terminal') return;
    if ([...targets.values()].every((each) => each === 'terminal')) {
      endForward(
        relayFailure(
          `every relay in scope stopped the live request: ${[...targets.keys()].join(', ')}`
        )
      );
    }
  };

  // The relays that were already terminal when this request began, applied
  // through the one writer so the all-terminal check sees them.
  //
  // The backward half runs for every request rather than only a live one, and
  // that is the difference from before. A relay that refused the connection is
  // one this attempt's backlog will never hear from, so leaving it `pending`
  // made the answer's incompleteness read as a timeout — the request waiting out
  // A-γ for a relay that was never going to answer. The forward half stays
  // live-only because a non-live request has no forward leg to end.
  for (const url of preflightTerminal) {
    advanceBackward(url, 'ended');
    if (live) advance(url, 'terminal');
  }

  subscriptions.push(
    (transport.outgoingRequests() ?? (EMPTY as never)).subscribe((packet) => {
      // The seam hands over the two strings this reads and nothing else — no
      // frame, no filters. It used to hand over the client's own outgoing
      // packet, and the `REQ` test that stood here is in the projection now.
      const leg = legOf(packet.subId);
      // `active` on either table means the same thing: this relay has been
      // asked. On the backward one it is the state a `timeout` is measured
      // against — a relay that was asked and said nothing, as opposed to one a
      // subscription cap held back so that no REQ ever went out (CAP5).
      if (leg === 'forward') advance(packet.to, 'active');
      else if (leg === 'backward') advanceBackward(packet.to, 'active');
    })
  );
  subscriptions.push(
    (transport.connectionState() ?? (EMPTY as never)).subscribe((packet) => {
      const phase = phaseOfConnectionState(packet.state);
      if (phase === undefined) return;
      // The backward table first, because `advance` can end the forward leg and
      // with it the whole stream, while the settle marker this triggers is
      // pushed a microtask later. The order turns out not to decide anything —
      // measured, by swapping these two lines and re-running SM14, which is the
      // case where one packet both determines the backlog and ends the leg — and
      // two separate things make it not decide anything: the drain below hands
      // over a marker that landed behind `end`, and the outcome that marker
      // carries is read off the table where it is delivered rather than where it
      // was queued. Written this way round anyway, so a reader does not have to
      // reconstruct either argument to see that the outcome survives.
      //
      // Only `terminal` determines anything, for the reason the forward table
      // has: rx-nostr reconnects and re-sends on its own, so a socket that is
      // retrying must not end either leg.
      if (phase === 'terminal') advanceBackward(packet.from, 'ended');
      // The forward half is live-only, and this is the one writer of that table
      // that has to say so out loud. The other three already know the leg before
      // they write: the preflight loop asks `live` itself, and the outgoing-REQ
      // and `CLOSED` handlers read it off the composed subId, which only names
      // `-f:` when a forward req was created. This channel is keyed by *relay*
      // — a packet here says a socket moved and cannot say which leg was riding
      // on it — so unguarded it advanced the live table of a request that has no
      // live subscription at all. Every relay of a non-live request going
      // terminal then satisfied the all-terminal check below and published a leg
      // end reading `every relay in scope stopped the live request`, on the
      // public diagnostics axis, for a request that is not live (P51).
      //
      // Nothing else reads `targets`' phases, so skipping the write costs a
      // non-live request nothing: the backlog's own table is the line above.
      if (live) advance(packet.from, phase);
    })
  );
  subscriptions.push(
    (transport.controlMessages() ?? (EMPTY as never)).subscribe((packet) => {
      if (packet.type === 'EOSE') {
        // The signal the backward table is built on. An `EOSE` reaches this
        // channel carrying the relay that sent it and the composed subId
        // (measured, SEN12) — without the `from` there would be no way to tell
        // "one relay finished" from "every relay finished", and the leg would be
        // back to a single completion signal.
        if (legOf(packet.subId) === 'backward') advanceBackward(packet.from, 'complete');
        return;
      }
      // **No entrance today, kept as the reader's own narrowing.** The seam
      // hands over `EOSE` and `CLOSED` only and the branch above returns for
      // `EOSE`, so this line cannot be reached — measured: disabled with
      // `if (false && …)`, ninety-one arms stay green. It is kept because it is
      // what makes this reader independent of the seam's union rather than
      // trusting it, and a ledger entry says the property is held twice over.
      // The rule here is "an entranceless branch is deleted"; this is the
      // exception, and an exception has to be written where it is.
      if (packet.type !== 'CLOSED') return;
      const leg = legOf(packet.subId);
      if (leg === undefined) return;
      // **A relay that is not this request's does not refuse it.** Both table
      // writers beside this one test membership (`advance`, `advanceBackward`)
      // and the `NOTICE` channel one file over filters by scope for the same
      // reason; the refusal path was the one that did not, and `subId` is a
      // string the relay chose. Measured: a second relay, in the transport
      // because another request uses it, naming this request's backward subId
      // put itself on `diagnostics.refusals` and turned a clean answer into
      // `incomplete(['refused'])`.
      if (!targets.has(packet.from)) return;
      // **And a leg this request never opened cannot end or be refused.** The
      // channel below is guarded by `live` with a comment arguing that this
      // handler needs no guard because it reads the leg off the composed subId,
      // "which only names `-f:` when a forward req was created". That is true
      // of the outgoing-REQ handler, whose string is ours, and false here:
      // `legOf` reads what the relay sent. Measured — a `CLOSED` naming a
      // never-opened `-f:` subId published `every relay in scope stopped the
      // live request` on a one-shot request, which is P51 reached through the
      // other writer.
      if (leg === 'forward' && !live) return;
      // **Bounded before it is classified and before it is kept**, so the
      // classification reads the same text a consumer will: the prefix NIP-01
      // puts before the colon is at the front, so a cut cannot move it, and a
      // relay cannot make this library hold more by saying more.
      // The seam renders it — bounded, frozen and this library's — so what
      // arrives here is already a `RelayMessage`. It was rendered at this line
      // when the seam handed over the relay's own value.
      const notice = packet.notice ?? relayMessage(undefined);
      const reason = classifyRefusal(notice.text);
      // **Frozen where it is built once and carried by reference.**
      // `ReqDiagnostics.refusals` publishes these objects and the cache holds the
      // same ones — measured: a consumer writing `refusal.notice` changed what
      // the cached record answered afterwards. The list around them is frozen in
      // `refusalsOf`; this is the element half of the boundary the events and the
      // diagnostics rows already have.
      push({
        type: 'refused',
        refusal: Object.freeze({ from: packet.from, leg, notice, reason })
      });
      // After the refusal is queued, never before: determining the last relay
      // settles the backlog, and a settle marker ahead of the refusal explaining
      // it is what P28 was.
      if (leg === 'backward') advanceBackward(packet.from, 'refused');
      if (leg !== 'forward') return;
      // Terminal whatever the prefix says, `auth-required:` included. rx-nostr
      // re-sends after a successful AUTH when an authenticator is configured,
      // and neither the authenticator nor a failed AUTH is readable from here —
      // so treating the prefix as recoverable, with no state for waiting on it,
      // means a request that resurrects after reporting itself stopped.
      advance(packet.from, 'terminal');
    })
  );

  // Where both REQs go, named rather than left to the client's defaults.
  //
  // rx-nostr does route a request to a named set: `use(req, { on: { relays } })`
  // takes the urls and opens a connection for any that is not already there,
  // and the default that was *not* named is not asked (measured at 3.7.5,
  // `SEN17`). Without it the REQ is sent to
  // `defaultReadableConnections`, read at send time — so a request keyed under
  // one scope could be answered by a relay set the client moved to afterwards,
  // and a relay in this request's scope that the client had since dropped would
  // not be asked at all despite sitting in the table above as `pending`.
  //
  // **This used to say `SEN17` measured that it "normalizes each", and it does
  // not** — it names one relay, in one spelling, and varies nothing about how it
  // is written. **The sentence that followed it here is now false as well, and
  // it was true when written**: it said nothing in the suite compares
  // rx-nostr's normalization against this library's, so the two spellings
  // reaching one connection rested on an argument rather than a witness. That is
  // what `SEN25`, `SEN26` and `SC15` were built for — the first two record what
  // the transport calls a relay and that its answer is not idempotent, the third
  // takes both sides in one run — and the boundary refuses a name the transport
  // would not return unchanged (`B-α-C13`) rather than converging on one of its
  // own.
  //
  // The one behaviour it costs: rx-nostr re-issues its *default* subscriptions
  // to a relay added to the defaults later, and a named one is `temporary` and
  // is not re-issued (`SEN18`). **This used to cite `SEN17` for that too, and it
  // never observed it**: `SEN17` stops at the routing, and `SEN18` — added in the
  // same commit, which is why this was a misquote rather than something that
  // went stale — is the one that adds a relay to the defaults afterwards and
  // reads which of the two requests is re-issued to it. That is the behaviour A5-C5 asks for — the target
  // set is fixed when the request begins — so it is the reason this is safe
  // rather than a price. A relay added mid-flight was already outside both
  // tables; now it is outside the wire as well, instead of receiving a REQ whose
  // answers no table would account for.
  //
  // Copied, because the option's type is a mutable `string[]` and the array here
  // is the request's own.
  const routeToTargets = { on: { relays: [...targetUrls] } };

  if (live) {
    const forwardReq = createRxForwardReq(`${reqIdBase}-f`);
    // **The capability, and `undefined` means the owner took it back.** There is
    // no expression here that yields a client a caller could keep past a revoke
    // — that was the hole in the first lease — so a leg that cannot be opened is
    // a leg that never starts rather than one that opens against a client this
    // library is about to dispose.
    const forwardStream = transport.use(forwardReq, routeToTargets);
    if (forwardStream !== undefined)
      subscriptions.push(
        forwardStream.subscribe({
          // Through the gate, for the reason `admitEvent` gives: with the client
          // on `skipVerify: true` this leg is where forged live events would
          // otherwise arrive already trusted.
          next: (packet) => admitEvent('forward', packet),
          // The forward leg is not supposed to end. A relay refusing the
          // subscription neither errors nor completes it (measured), so anything
          // arriving here is the transport underneath giving out — and without
          // these two handlers the stream waited for an abort instead, leaving a
          // query that says `live` while nothing can reach it.
          error: (reason: unknown) => endForward(reason),
          complete: () => endForward(undefined)
        })
      );
    forwardReq.emit(
      forwardLimitZero ? filters.map((filter) => ({ ...filter, limit: 0 })) : filters
    );
  }

  const backwardReq = createRxOneshotReq({ filters, rxReqId: `${reqIdBase}-b` });
  backward = transport.use(backwardReq, routeToTargets)?.subscribe({
    next: (packet) => admitEvent('backward', packet),
    // Kept, and no longer the thing that decides the outcome. It completes both
    // when every relay reached EOSE and when every relay's socket died (SEN13),
    // so on its own it cannot tell a whole answer from no answer at all — the
    // table above is what says which. It stays as the trigger of last resort:
    // if the client and this machine ever disagreed about the target set, a
    // relay would stay `pending` and only the request's timer would end the
    // wait, which is a long time to be wrong for.
    // **The asymmetry this closes is itself a finding.** The forward leg has had
    // an error handler since A5 and this one had none, so anything that errored
    // the backward observable escaped as an unhandled rejection and the backlog
    // waited out A-γ with nothing said — which is exactly what the dependency's
    // own default verifier produces, since `emptyVerifier` throws (measured,
    // `AE8`). An observable that errors has ended, so the backlog has too, and
    // the honest report is a leg that ended rather than a relay that was slow.
    error: () => {
      for (const url of backwardTargets.keys()) advanceBackward(url, 'ended');
      settle(false);
    },
    complete: () => settle(false)
  });
  if (backward !== undefined) subscriptions.push(backward);

  if (timeoutMs !== undefined) {
    timer = setTimeout(() => settle(true), timeoutMs);
  }

  const onAbort = () => {
    ended = true;
    closeAll();
    abandonGate();
    notify();
  };
  if (!passiveAbort) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort);
  }

  // **The owner taking the transport back ends this invocation too, and no
  // listener here does it.** A listener stood here for a round, reading the
  // capability's abort signal — and once the capability began *ending what it
  // handed out* rather than only refusing the next call, the listener stopped
  // being reachable: measured, removing it left every arm in this directory
  // green, `RM15` included. A branch nothing can falsify is a branch that goes,
  // which is the rule this round has applied four times.
  //
  // What ends this machine on a revoke is the transport's own teardown: the
  // observables it lent complete, the subscriptions close, and the leg ends
  // through the same path a relay going away takes. `RM15` reads that with a
  // consumer signal nobody aborts, so what it measures is the capability rather
  // than a cancellation.

  // `end` stops the stream after the queue is drained, not at the moment it is
  // dequeued. That is the drain contract's first clause, and what it protects is
  // this machine's own deferred work rather than the dependency's: `settle()`
  // above pushes its marker a turn late while `finish()` pushes `end` at once,
  // so a connection-state packet that both determines the last relay's backlog
  // and ends the forward leg produces a marker that lands *behind* the end.
  //
  // **This used to cite `SM14` and `SM18` for that shape, and it used to give
  // one condition for both. One is not enough.** `SM14`'s citation held while
  // `finish()` pushed synchronously: a single connection-state packet
  // determines the last relay's backlog *and* ends the forward leg, so the
  // marker's microtask is still pending when the end is queued. `SM18`'s needed
  // a second thing that is also gone — `endForward` used to call `settle(false)`
  // itself, so a forward `CLOSED` settled the backlog and ended the leg in one
  // turn. **It was not a misquote when it was written, and that comes off the
  // record rather than out of the argument above**: the commit that added the
  // citation recorded `['P31', 'P32', 'SM14', 'SM17', 'SM18']` as this ledger
  // entry's kill set, and `SM18` left it at the next re-measurement — the round
  // that followed `endForward` no longer settling, which is what moved `SM18`'s
  // outcome to A-γ's timer. That is the trace it runs today, and it queues its
  // marker before `finish()` is reached at all, so it would not produce the bad
  // ordering even under a `finish()` that pushed synchronously.
  //
  // Neither shape survives: `finish()` wraps itself in a microtask and a gate
  // wait, so the end is the last thing queued in every shape those two reach.
  // The clause is still what the drain protects —
  // `end-returns-instead-of-draining` is the edit that would break it — but that
  // entry records `killed: []` for exactly this reason, so what is written here
  // is the contract and not a claim that a test observes it.
  // Returning on sight of `end` throws it away, and the attempt
  // finishes carrying a leg end and no outcome at all — which is the state a
  // `refresh()` waits on forever.
  //
  // Nothing the *producer* sends can land there, because `finish()` released it
  // before queueing the end. That is the difference between this and the
  // version that closed everything in the `finally` below.
  let finished = false;
  try {
    for (;;) {
      while (queue.length > 0) {
        const next = queue.shift() as Signal;
        if (next.type === 'end') {
          finished = true;
          continue;
        }
        // Derived here, where it is handed over, rather than where it was
        // queued. See {@link Signal}: the outcome is a function of the per-relay
        // table, and this is the last moment before a consumer can act on it.
        if (next.type === 'settled') yield { type: 'settled', end: backwardEnd(next.viaTimer) };
        else if (next.type === 'legEnded')
          yield { type: 'legEnded', leg: next.leg, reason: next.reason };
        else if (next.type === 'refused') yield { type: 'refused', refusal: next.refusal };
        else yield { type: 'event', packet: next.packet };
      }
      // **Two conditions, not three, and the third was unreachable here.** It
      // read `finished || ended || signal.aborted`, and dropping `ended` left
      // all 847 arms of the spike suite green — found by flipping every `&&`
      // and `||` in the library one at a time, 117 of them, ten of which
      // nothing observed.
      //
      // It is unreachable rather than merely unwitnessed, which is why it is
      // deleted instead of given an arm. `ended` is set in two places: the
      // abort handler, where `signal.aborted` is true in the same breath; and
      // inside `drawBoundary`, immediately before `push({ type: 'end' })`. The
      // loop above drains the queue before reaching this line, so by the time
      // it is asked the `end` signal has been read and `finished` is true. The
      // one state the term would have caught — `end` pushed and not yet read —
      // cannot exist here.
      if (finished || signal.aborted) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    if (!passiveAbort) {
      signal.removeEventListener('abort', onAbort);
      closeAll();
      abandonGate();
    }
  }
}
