/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { AttemptId } from './attempt.js';
import { isOlderAttempt } from './attempt.js';
import type { UnixSeconds } from './clock.svelte.js';
import type { OwnedPacket, ReqEvent } from './event.js';
import { isOwnedPacket } from './event.js';
import type { NonEmptyList } from './list.js';
import type { RelayMessage, Retention } from './normalize.js';
import { isEphemeralKind } from './normalize.js';
import { capture, recordedFailure } from './own.js';
import type { RefusalReason } from './refusal.js';
import type { RefreshOutcomeError, RelayLegError } from './reqerror.js';

/**
 * The canonical cache value, and the projections taken from it.
 *
 * The descriptor cannot say what shape the caller wants: `{ ids: [id], limit: 1 }`
 * is the same wire request whether the caller wants one event or a list of one.
 * So the cache stores a canonical set keyed by each event's *replacement
 * identity*, and the public shape is a pure function of that set. Keeping the
 * projection out of the cache identity is what lets a single-event view and a
 * list view share one fetch.
 */

export type EventClass = 'regular' | 'replaceable' | 'ephemeral' | 'addressable';

/** NIP-01 kind ranges. */
export function classifyKind(kind: number): EventClass {
  if (kind === 0 || kind === 3) return 'replaceable';
  if (kind >= 10000 && kind < 20000) return 'replaceable';
  if (isEphemeralKind(kind)) return 'ephemeral';
  if (kind >= 30000 && kind < 40000) return 'addressable';
  return 'regular';
}

function identifierOf({ tags }: ReqEvent): string {
  return tags.find(([name]) => name === 'd')?.[1] ?? '';
}

/**
 * The key under which an event replaces a previous one, per its class.
 *
 * **The addressable form is injective because `pubkey` is 64 hex characters,
 * and that premise is here rather than assumed.** `${kind}:${pubkey}:${d}` is
 * built from a `d` tag the author chooses and does not escape: with a pubkey
 * that could contain a colon, `p="a", d="b:c"` and `p="a:b", d="c"` would be one
 * key. What keeps them apart is the signature gate — a non-hex pubkey cannot
 * produce a valid schnorr signature — so this is a property of *what reaches
 * the fold*, not of the string. `byRecency` states its sibling premise (no two
 * stored entries share an id) in the same way, and a port whose verifier is a
 * seam a caller supplies inherits both.
 *
 * **Three arms, three premises**, and this block gave one for a round. The
 * `kind:pubkey` arm needs the same hex premise without the escaping question;
 * the id arm needs `byRecency`'s instead — a hash, not an alphabet. **And the
 * arms do not separate each other by shape**, which a first repair claimed:
 * `d = 'b:c'` gives an addressable key three colons, and a regular event whose
 * `id` reads `10000:<pubkey>` collides with the replaceable coordinate
 * `(10000, pubkey)` — constructed, both. What forbids the second is that a
 * valid id is a hash, which is the verifier gate a caller supplies. `0003`
 * carries all of it with the port's freedoms named; this comment is deleted
 * with the spike.
 */
export function replacementKey(event: ReqEvent): string {
  switch (classifyKind(event.kind)) {
    case 'replaceable':
      return `${event.kind}:${event.pubkey}`;
    case 'addressable':
      return `${event.kind}:${event.pubkey}:${identifierOf(event)}`;
    default:
      return event.id;
  }
}

/**
 * Which of two events for the same replacement key wins.
 *
 * NIP-01: the newer `created_at` wins; on a tie the lower id wins. The tie-break
 * is what makes the fold order-independent — without it, two relays delivering
 * the same pair in different orders would leave different values in the cache.
 */
export function laterWins(a: ReqEvent, b: ReqEvent): ReqEvent {
  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;
  return a.id <= b.id ? a : b;
}

/** The two legs a request runs. The forward one only exists when it is live. */
export type LegName = 'backward' | 'forward';

/**
 * Why the forward leg stopped producing.
 *
 * One shape, because the two ways it happens are the same fact to a consumer:
 * there is nothing left to receive from. A live subscription has no EOSE to
 * complete on and no timer of its own, so what ends it is either the transport
 * underneath giving out or **every readable relay refusing it** (`RF4`) —
 * `DIAG-2` says one relay's `CLOSED` does not end the leg, which is a different
 * sentence from the one that used to stand here: this said what reaches here is
 * *always* the transport giving out, and an arm that has been green throughout
 * ends the leg with two refusals and a live socket.
 *
 * This type used to carry `complete` and `timeout` as well, for the backlog's
 * sake; the backlog's end is {@link BacklogEnd} now, and neither variant
 * described anything a forward leg could reach.
 */
export type LegEnd = { readonly kind: 'ended'; readonly error: RelayLegError | undefined };

/**
 * How this attempt's backward leg finished, over every relay it asked.
 *
 * Not one reason, and that is the correction Step 3 makes. The backlog used to
 * end on a single signal — rx-nostr completing the subscription, or the
 * request's own timer — and one relay's socket dying arrived on the first of
 * those, indistinguishable from every relay having answered. With several relays
 * the timer can fire while another relay is already gone, so reporting one of
 * the two stores a presentation decision as a fact. That is the same argument
 * {@link IncompleteCauses} is built on, applied one layer earlier.
 *
 * `refused` is deliberately **not** among the causes here. A refusal is already
 * on the record, per attempt and per relay, and {@link completionOf} reads it
 * there — producing it twice would be two sources for one claim, which is the
 * shape this file keeps removing.
 */
export type BacklogEnd =
  | { readonly kind: 'complete' }
  | {
      readonly kind: 'incomplete';
      /**
       * Non-empty. `timeout`, `verification-timeout` and/or `ended`; see the
       * note above about `refused`.
       */
      readonly causes: IncompleteCauses;
      /** The transport failure behind an `ended` relay, when there was one to name. */
      readonly error: RelayLegError | undefined;
    };

/** A relay refusing at the protocol level, attributed by subId. */
export interface Refusal {
  readonly from: string;
  readonly leg: LegName;
  /**
   * `CLOSED`'s message — `auth-required: ...`, `rate-limited: ...`, and so on.
   *
   * **Bounded, and the type says so.** A relay is outside the trust boundary and
   * this value enters the cache: the *count* of refusals was bounded and the
   * size of each was not, so a relay could decide how much memory a page holds
   * by rewording at length. `RelayMessage` carries how much of what it said is
   * here, so a consumer rendering it is never shown a cut string as the whole
   * one.
   */
  readonly notice: RelayMessage;
  /** What the relay said, by NIP-01's vocabulary. See {@link classifyRefusal}. */
  readonly reason: RefusalReason;
}

/**
 * A backward attempt that has begun and not yet ended.
 *
 * The slot the flat arrays had nowhere to put. A refusal arrives before the end
 * that it explains — often several turns before, with more than one relay — so
 * an attempt needs somewhere to accumulate what is attributed to it while it is
 * still running, and that somewhere cannot be {@link CachedEventSet.backlog}:
 * writing there is what takes the primary state out of `settled` for the whole
 * of every refresh.
 */
export interface RunningBacklog {
  readonly attemptId: AttemptId;
  /** This attempt's, and only this attempt's. */
  readonly refusals: readonly Refusal[];
}

/**
 * The last backward attempt that *ended*, and everything attributed to it.
 *
 * This is what decides completeness, and it is replaced whole. A new attempt
 * accumulates in {@link RunningBacklog} and takes this slot only when it reaches
 * an end — so nothing about completeness moves while a refresh runs, and the
 * refusals here can never be a mixture of two attempts'.
 */
/**
 * The identity of one answer, minted where the answer is decided.
 *
 * **A memo about an answer has to be keyed on the answer, and the record is not
 * it.** C15's memos hung on the {@link BacklogRecord} because "the record is
 * replaced only by `endBacklog`" — which was true of the two writers that were
 * in hand (`foldEvent`, `noteFailure`) and false of the third: `addRefusal`
 * spreads a new record when a refusal arrives *after* the backlog ended, a
 * change {@link computeCompletion} deliberately ignores. So a relay saying
 * `restricted:` after its own EOSE — ordinary on a live request — minted a
 * fresh `IncompleteResultError` and a fresh `causes` array for an answer whose
 * content had not moved, which is the churn C15 exists to remove arriving on a
 * wire event instead of on a read.
 *
 * This token is minted once, in `endBacklog`, and carried through by every
 * writer that does not decide a new answer. Keying on it says what the memo
 * means; keying on the record said where the memo's value happened to live.
 */
export interface AnswerIdentity {
  readonly minted: 'answer';
  /**
   * The attempt whose backlog decided this answer.
   *
   * **Carried because the token has to differ in *content*, not only in
   * reference.** The query library's structural sharing (`replaceEqualDeep`)
   * hands a write back the previous subtree whenever the new one is deeply
   * equal — so a token spelled `{ minted: 'answer' }` alone is collapsed onto
   * the previous answer's token, and the memo then hands a second incomplete
   * answer the first one's Error. Measured: `X12` fails on exactly that, which
   * is what that arm was written for one key earlier.
   */
  readonly of: AttemptId;
}

export interface BacklogRecord {
  readonly attemptId: AttemptId;
  readonly end: BacklogEnd;
  /**
   * This answer's identity — see {@link AnswerIdentity}. Not the record's: two
   * records can carry one answer, because a late refusal is published without
   * being a cause.
   */
  readonly answer: AnswerIdentity;
  /** This attempt's, and only this attempt's. */
  readonly refusals: readonly Refusal[];
  /**
   * This attempt's refusals that arrived **after** its backlog ended.
   *
   * **They used to be dropped, and dropping them made `nodata` a lie.** The
   * backward subscription is closed when the leg ends and the message channel
   * is not, so on a live request a relay that EOSEs with nothing and then says
   * `restricted: you may not read this` is answering the same attempt —
   * `addRefusal` routed it through the wrong-attempt guard because `running`
   * had been cleared. Measured end to end: the consumer was rendered `nodata`,
   * the claim that nothing exists, while `ReqDiagnostics.refusals` was empty
   * and the relay had said why.
   *
   * Kept apart from {@link BacklogRecord.refusals} rather than appended to it,
   * because the two answer different questions. {@link computeCompletion} reads
   * the refusals that *prevented* an answer; one that arrives after the answer
   * is in cannot have prevented it, and counting it would relabel a complete
   * answer as incomplete — which is what `B10-C2` refuses one leg over. So:
   * published, because the relay said it, and not a cause, because it caused
   * nothing.
   */
  readonly late: readonly Refusal[];
  /**
   * Whether this attempt's backlog dropped an ephemeral arrival.
   *
   * A fact about the answer rather than a count: what a consumer can act on is
   * that the answer is not everything the filter matched, and one omission
   * establishes that as well as ten. It rides on the record beside the refusals
   * for the same reason they do — {@link computeCompletion} is the one place
   * that turns what happened into what is published.
   */
  readonly ephemeralOmitted: boolean;
}

/**
 * The live subscription of the attempt that is running now.
 *
 * `end` is optional and the backlog's is not, and the asymmetry is measured
 * rather than stylistic: a relay refusing at the protocol level neither errors
 * nor completes a forward subscription (DIAG-2), so a forward record routinely
 * holds refusals over a leg that is still open (RF3). A backward record only
 * exists once its attempt is over.
 *
 * **`attemptId` is here for a different reader than the backlog's.** 0003 said
 * the id sat on the backward record alone, because only that one is compared
 * against an attempt a caller started — which is true of `refresh()` and was
 * taken to mean the forward leg needed no attribution at all. It does: with the
 * record cleared and rebuilt per attempt but its writers taking no id, a signal
 * belonging to a superseded attempt lands on the record of the one that
 * replaced it. Reachable through the pure functions alone (E16): begin A, begin
 * B, apply A's forward refusal or end, and B's record carries it. So this id is
 * compared against *the attempt the value is on* rather than against a caller's,
 * and the two branches of {@link addRefusal} now read the same way.
 */
export interface ForwardRecord {
  /**
   * The attempt whose live subscription this is.
   *
   * Written by {@link beginAttempt} and never by a signal. A record built
   * lazily by the first refusal would take its id from whatever arrived, which
   * is the defect rather than the fix: a stale attempt's refusal would name
   * itself as the current record and drop the refusals that follow it.
   */
  readonly attemptId: AttemptId;
  /** Absent while the leg is still open. */
  readonly end: LegEnd | undefined;
  readonly refusals: readonly Refusal[];
}

/**
 * The attempt that failed, and what it threw.
 *
 * The stamp is the whole of it. `refresh()` attributes a *success* by comparing
 * the id on {@link BacklogRecord} with the one it claimed before starting, and
 * it attributed a *failure* by time order instead — "the previous error was
 * cleared when this attempt started, so the error I can see is mine". That is a
 * runtime invariant over the query library's reset behaviour rather than
 * something the value says, and `SEN22` measures how narrow it is: an entry is
 * cleared at the start of a fetch **only while it holds no data**, so the moment
 * a failure is recorded anywhere on the value the reasoning stops applying to
 * itself.
 *
 * With the failure recorded here, both halves of the attribution are the same
 * equality, and the diagnostics' `lastError` can mean "the most recent failure"
 * without its lifetime contradicting its name.
 */
export interface FailureRecord {
  /** The attempt that threw. Compared against a caller's, like the backlog's. */
  readonly attemptId: AttemptId;
  /**
   * **Narrower than a state's error, and the narrowing is measured.** What is
   * recorded here is what a request *threw inside* the query function; a
   * descriptor refusal is thrown above that `try`, so `refresh()` rejects with
   * one and this record never holds one. `recordedFailure` is the total function
   * into this type.
   */
  readonly error: RefreshOutcomeError;
}

/**
 * The cache value: what was received, and what happened to the legs receiving it.
 *
 * There is no `settled` field, and that absence is the design. It used to be a
 * boolean set beside the entries, which made "settled, with the backward leg
 * still open" a writable state — and the thing that would have caught it is a
 * test, not the type. {@link completionOf} derives it from the backlog record
 * instead, so the two cannot disagree.
 *
 * Termination and refusal live *here*, on the value, rather than on the hook, and
 * that is C12's consequence rather than a convenience. `nodata` asserts that
 * nothing exists, so it may only be shown when nothing **prevented an answer** —
 * which makes "was anything refused" an input to the slot.
 *
 * **"Refused" means refused before the answer was in**, and that qualifier is
 * measured rather than stylistic. A relay that answers `EOSE` and *then* says
 * `restricted:` has already given what it had; counting that as a refusal would
 * relabel a complete answer as incomplete, which is exactly what `B10-C2`
 * refuses one leg over — a complete set relabelled by a signal that could not
 * have removed anything from it. So a late refusal is **published** (a consumer
 * reading the diagnostics sees the relay's words) and is **not a cause**. What
 * used to happen is neither: it was dropped, so `nodata` was shown over a
 * `restricted:` nobody could see. A slot input held outside the
 * cache value lets two consumers of one key render differently, which is the
 * same non-determinism that put the settle timeout into the key. It was also not
 * hypothetical: held per hook, it was carried across descriptors twice
 * (P16, P18/P18b).
 *
 * **The two legs have opposite lifetimes across an attempt, and that is the
 * whole shape.** A new attempt keeps the backlog record and swaps it when its
 * own end arrives; it clears the forward record outright. Both directions were
 * measured. Clearing the backlog at the start is what let the primary state fall
 * back to `streaming` from the first new event until the new EOSE, which is the
 * defect the activity axis exists to prevent (C4a, P30). Keeping the forward
 * record would leave a request that reported itself stopped once reporting
 * itself stopped forever, because a new attempt's forward leg has not ended.
 *
 * This is one field more than the record's sketch, which had three. The fourth
 * is {@link running}: with `backlog` kept until the swap, the attempt in flight
 * has nowhere else to put the refusals it collects, and they arrive before the
 * end rather than with it.
 */
export interface CachedEventSet {
  /** Replacement key -> packet. Covers regular (keyed by id) and replaceables. */
  entries: Map<string, OwnedPacket>;
  /**
   * The backward attempt whose end this value reports. Absent until one ends.
   *
   * The `attemptId` is what lets `refresh()` keep its promise. It resolves on
   * the outcome of the attempt it started, and a value that already carries a
   * finished backlog would otherwise answer immediately with the previous
   * attempt's result — measured (P28).
   *
   * Compared, never ordered: this was a counter and the wait was `>`, which
   * cannot express "mine" at all, since two calls on one key read the same
   * number before either attempt runs.
   *
   * **The type is not what holds that, and this used to say it was.**
   * {@link AttemptId} is a branded `string` — a subtype of `string`, so `>`
   * compiles on it and means what it means for strings. The ids are minted
   * `a1`, `a2`, …, so an ordering that came back would not even fail loudly:
   * `'a10' > 'a9'` is `false`, and the tenth attempt of one request is where it
   * would start being wrong. What holds the rule is a discipline `tsc` cannot
   * check and grep can: the order has **one** reader, {@link isOlderAttempt} in
   * the minting module, and every read outside it — here included — is `===`.
   * The comparator's own call sites are two, both in this module (the rewind
   * guard in {@link beginAttempt} and {@link noteFailure}); `WR17` counts them,
   * and 0002's A6 is the rule they discharge.
   */
  readonly backlog: BacklogRecord | undefined;
  /**
   * Whether the fold has dropped an ephemeral arrival into this value.
   *
   * **On the value rather than on the running attempt**, because the fold is
   * where the drop happens and the fold is handed the value. `endBacklog` moves
   * it onto the record, which is where {@link computeCompletion} reads causes
   * from; carrying it here in the meantime is what lets an arrival that lands
   * before the leg ends still be reported.
   *
   * Optional so that a value built before this field existed — one already in a
   * consumer's cache across a version — reads as "nothing was dropped" rather
   * than as `undefined` reaching a boolean position.
   */
  readonly ephemeralOmitted?: boolean;
  /** The backward attempt in flight, if one is. */
  readonly running: RunningBacklog | undefined;
  /**
   * The forward leg of the attempt in flight. Absent until an attempt begins.
   *
   * It used to be absent until a forward signal arrived, so a non-live attempt
   * never had one. The record is opened by {@link beginAttempt} now, because
   * that is the only moment that knows which attempt the value is on — see
   * {@link ForwardRecord.attemptId}. An attempt that never opens a live
   * subscription therefore carries an empty record with no end, which is what a
   * leg that was never opened should say: nothing reads the record's presence,
   * only its `end` (`deriveDiagnostics`) and its refusals (`refusalsOf`).
   */
  readonly forward: ForwardRecord | undefined;
  /**
   * The most recent attempt that failed, until a *later* attempt that ends
   * supersedes it.
   *
   * A third lifetime, and it is neither leg's. The backlog record is kept across
   * a new attempt and swapped when that attempt ends; the forward record is
   * dropped when one begins. This is kept across a new attempt like the backlog
   * and cleared by {@link endBacklog} when the attempt that ends is a **later**
   * one — so what a consumer reads while a retry runs is the failure that is
   * still the most recent thing that happened to this request, rather than
   * nothing.
   *
   * The qualifier is the exception this summary used to drop, and it is not a
   * corner: `endBacklog` keeps a failure stamped with the attempt that reached
   * the end, because a failure is the last thing an attempt writes and is
   * therefore later than its own answer rather than evidence against it. Stated
   * on `endBacklog` itself, contracted as `B10-C6`, witnessed by `E17b`.
   *
   * Written by {@link noteFailure} and by nothing else, because there is one
   * place a failure is visible: the query function unwinding.
   */
  readonly failure: FailureRecord | undefined;
}

/**
 * The value every request starts from — **one object, shared by every one of
 * them**, and its `entries` is a real `Map`.
 *
 * `Object.freeze` does not stop `Map.prototype.set`, so what keeps this safe is
 * not the type: it is that every write copies first. `foldEvent` is the only
 * writer, and it builds `new Map(set.entries)` before it sets anything, so this
 * Map is never the one written to. **That is a property of the code rather than
 * of the value**, which is why `WR20` counts the writes rather than leaving the
 * rule in this sentence: one careless `entries.set(` anywhere would corrupt the
 * initial value of every future request in the process, and the failure would
 * appear in requests that have nothing to do with the edit.
 *
 * A frozen wrapper was considered and not taken: it would make the type a lie in
 * the other direction (a `ReadonlyMap` that throws where the type says it
 * cannot), and the copy is what the fold wants anyway.
 */
export const emptyEventSet: CachedEventSet = {
  entries: new Map(),
  backlog: undefined,
  running: undefined,
  forward: undefined,
  failure: undefined
};

/**
 * Every refusal the value holds, whichever leg or attempt it belongs to.
 *
 * The diagnostics axis publishes one flat list, and it used to *be* one flat
 * list — which is what made attribution unexpressible. It is a projection now:
 * stored per leg and per attempt, flattened for the one reader that wants them
 * all. The previous attempt's refusals stay visible while a new one runs,
 * because the completeness they explain is still the previous attempt's until
 * the swap.
 *
 * **"Both move at the same instant" stood here and is not what happens.** The
 * forward list and the still-running backward list are emptied at the *start* of
 * the next attempt, and the backlog's list is replaced at its *end* — three
 * distinct moments, which is `B-η`'s own decision and which `E16` measures. A
 * port reading this function for "the list only grows" builds a different
 * contract from the one the records make.
 */
export function refusalsOf(set: CachedEventSet | undefined): readonly Refusal[] {
  if (set === undefined) return EMPTY_REFUSALS;
  return Object.freeze([
    ...(set.backlog?.refusals ?? []),
    ...(set.backlog?.late ?? []),
    ...(set.running?.refusals ?? []),
    ...(set.forward?.refusals ?? [])
  ]);
}

/** One frozen empty list rather than a new mutable one per call. */
const EMPTY_REFUSALS: readonly Refusal[] = Object.freeze([]);

/**
 * Why an answer is not the whole answer.
 *
 * **Each member is a state that held, and none of them says anything about the
 * others.** They are not failure classes, and reading one as though it excluded
 * its neighbours is the mistake this list is written to prevent: a consumer
 * deciding what to do next has to read the whole array.
 *
 * | member                 | what held                                                                                                                                                       |
 * | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
 * | `timeout`              | the request stopped waiting on a backward target rather than hearing from it — its own settle timer drew the boundary (A-γ), or a target was still undetermined when the outcome was derived |
 * | `verification-timeout` | the backward gate was holding candidates it had admitted and not yet verified inside that boundary when the drain cutoff cut the wait, so they were discarded (A-ε) |
 * | `refused`              | a relay said no, which leaves the answer partial whether or not anything came back from the others                                                                |
 * | `ended`                | the leg died underneath                                                                                                                                          |
 *
 * `timeout` also covers a REQ that never went out — a relay advertising a
 * subscription cap holds it back and the request settles having asked nobody
 * (CAP5).
 *
 * **`verification-timeout` does not mean the relay answered, and it took a
 * review to notice that this comment said it did.** It is a fact about the
 * local gate: candidates were inside it and the wait over them was cut. Whether
 * the relays finished is a separate question with a separate member, and one
 * relay is enough to make both hold — an EVENT and no EOSE, held in the
 * verifier, the settle timer drawing the boundary and the drain cutoff cutting
 * the gate that follows it, is `['timeout', 'verification-timeout']` (`AE21`).
 * A backlog that reached EOSE and was then cut is one *example* of
 * `verification-timeout` (`AE15`), not the definition of it.
 *
 * **Nothing this member reports was ever `accepted`, and the two words are not
 * interchangeable.** A-ε defines `accepted` and this does not restate it; what
 * that definition excludes is exactly the case here — a candidate still pending
 * verification when the cutoff cut its leg's wait. So what this member reports
 * is the discard of something the gate had only **admitted**, never an event
 * A-ε promised to deliver and then dropped. Read the other way round it would
 * contradict A-ε's own falsifier.
 *
 * **Separating them from one word is a decision rather than a rename**, and the
 * reason is that they are separately actionable rather than that they are
 * mutually exclusive. Folded together, a consumer reading `timeout` could not
 * tell "we stopped waiting on a relay" from "what came back could not be
 * checked in time"; the first points at the relays and the network, and the
 * second is local and CPU-bound, where the verifier or the device is what has
 * to give. Folding them also put the caller's own `settleTimeoutMs` and an
 * internal cutoff the caller cannot set under one name.
 *
 * **`settleTimeoutMs` is not the knob for `verification-timeout`.** The drain
 * cutoff is armed after the boundary, per gate, from that gate's own
 * measurement, so raising the settle timeout does not widen it: where an EOSE
 * drew the boundary it changes nothing at all, and where the timer drew it, it
 * only changes when the boundary is drawn.
 */
export type IncompleteCause =
  | 'timeout'
  | 'verification-timeout'
  | 'refused'
  | 'ended'
  /**
   * An ephemeral event arrived on this backlog and was not retained.
   *
   * **`B7a` splits on `live` now**, so a non-live descriptor with no `kinds` is
   * accepted — that is the by-id request the published components make, and the
   * shape a consumer holds whenever an id arrives without a kind beside it. Such
   * a request can match an ephemeral event, this surface has no channel that
   * could show one, and an answer that quietly left one out would be the silent
   * omission the whole row exists to prevent. So the fold drops it and says so,
   * which a *finite* answer can do and a forward leg cannot — which is why the
   * live case is still refused at the boundary.
   */
  | 'ephemeral-event-omitted';

/**
 * Non-empty by construction.
 *
 * With several relays a timeout, a refusal and a leg end can all hold at once —
 * and with one relay, a `timeout` and a `verification-timeout` can (`AE21`), so
 * this is not a shape that only a multi-relay request reaches. Reporting one of
 * them stores a presentation decision as if it were a fact. A `primaryCause` beside a list would make the contradictory pair — a
 * primary that is not in the list — representable, which is the shape this
 * design spends its length avoiding. Choosing a representative is a pure
 * function a consumer can apply, and one that can be added without changing
 * what is stored.
 */
export type IncompleteCauses = NonEmptyList<IncompleteCause>;

export type Completion =
  | { readonly kind: 'complete' }
  | { readonly kind: 'incomplete'; readonly causes: IncompleteCauses };

/**
 * Deduplicated, in a canonical order that carries no meaning.
 *
 * **A rank per member rather than a list beside the union, because a list is a
 * second place to forget.** This was `readonly IncompleteCause[]` and
 * {@link causesOf} filtered it, so a member added to {@link IncompleteCause}
 * and not added here was *dropped* from every answer that held it — the answer
 * still said `incomplete`, with one fewer word in it, and no compiler could see
 * that. `Record<IncompleteCause, number>` makes the omission unrepresentable:
 * widening the union without ranking the new member does not compile, and
 * {@link causesOf} sorts the set it is handed rather than filtering a copy of
 * the members it knows about, so there is nothing left to drop.
 *
 * **Falsified rather than argued, in the two steps the same repair to
 * `REFUSAL_PREFIX_OF` took.** With a fifth member added to
 * {@link IncompleteCause} and nothing else, `npm run check` fails here —
 * `Property 'stalled' is missing in type '{ refused: number; timeout: number;
 * 'verification-timeout': number; ended: number; }' but required in type
 * 'Record<IncompleteCause, number>'`. The suite fails too, and it is worth
 * knowing *how*: `leak.test.ts` builds the public declarations with `tsc -p
 * tsconfig.dts.json` and that build carries the same error. No assertion
 * anywhere says anything about the member — nothing can, since nothing
 * produces it — so what the tests report is the type, arriving twice.
 *
 * Rank the member and both go quiet: `npm run check` at 0 errors, the suite
 * green. That is the intended end of it. The type's whole job is to make
 * someone choose where the new word sits rather than inherit a position from a
 * list they never opened, and it has been done by the time the compiler stops
 * complaining.
 *
 * `verification-timeout` sits beside `timeout` because a reader comparing two
 * answers reads them together, not because the adjacency means anything.
 */
const CAUSE_ORDER: Record<IncompleteCause, number> = {
  refused: 0,
  timeout: 1,
  'verification-timeout': 2,
  ended: 3,
  // Last, because it is the only one that is not about a relay failing to
  // answer: the relays did answer, and this library took something out of what
  // they said. A reader scanning a cause list for "what went wrong on the wire"
  // should reach the wire's causes first.
  'ephemeral-event-omitted': 4
};

function causesOf(present: ReadonlySet<IncompleteCause>): IncompleteCauses | undefined {
  const ordered = [...present].sort((a, b) => CAUSE_ORDER[a] - CAUSE_ORDER[b]);
  // **Frozen because it is published and memoised**: `ReqState.incomplete.causes`
  // and `RefreshOutcome` hand a consumer this array, and it is kept per answer
  // (C15), so a `push` on it would reach every later reader of that record.
  // Same boundary as the events and the diagnostics lists — found by counting
  // the published containers rather than by looking at this one.
  return ordered.length === 0 ? undefined : (Object.freeze(ordered) as unknown as IncompleteCauses);
}

/**
 * Build a backward end from what the machine's per-relay table says is missing.
 *
 * Here rather than in the machine so that the canonical order and the
 * "nothing missing means complete" rule have one implementation. The machine
 * knows which relays did what; it does not need to know how causes are ordered,
 * and a second copy of that is how the two would come to disagree.
 */
export function backlogEndOf(
  present: ReadonlySet<IncompleteCause>,
  error: RelayLegError | undefined
): BacklogEnd {
  const causes = causesOf(present);
  // **Frozen where it is built, which is the rule one boundary over.** The
  // published leg end is frozen at the site that builds it and this record was
  // not frozen anywhere: a reviewer measured `Object.isFrozen` on what the two
  // end-writers hand back and found the freeze living at one call site rather
  // than in the function. `causes` was already frozen by `causesOf`; the record
  // around it was not. The `error` inside stays as it arrived — it is read by
  // the machine's own witnesses and is published nowhere, and freezing a value
  // from outside is a decision this design takes only where the value crosses
  // to a consumer (`B5-C6`).
  return Object.freeze(
    causes === undefined
      ? ({ kind: 'complete' } as const)
      : ({ kind: 'incomplete', causes, error } as const)
  );
}

/**
 * Whether the backlog is over, and whether what it produced is everything.
 *
 * These were two separate reads — a settled flag plus a refusal check inside the
 * slot mapping — and they disagreed about what the primary state should say.
 * A request that timed out reported `settled`, the slot mapping said `error`,
 * and the diagnostics had no failure to show: three surfaces, three answers,
 * and no Error to hand the `error` slot.
 *
 * Returning it as one value is what makes the three agree. `undefined` means the
 * backlog is still running.
 */
export function completionOf(set: CachedEventSet): Completion | undefined {
  const backlog = set.backlog;
  return backlog === undefined ? undefined : completionOfRecord(backlog);
}

/**
 * The same answer, read off the record rather than off the value around it.
 *
 * Split out because the record **is** the answer, and a caller that needs to say
 * so needs to hold the two together. `deriveState` is the one: it keys the
 * published {@link IncompleteResultError} on this record, so it has to bind the
 * record and the completion from a single read. Written as
 * `set.backlog` beside a `completionOf(set)` those are two reads of one value,
 * and nothing in the types says they saw the same one.
 *
 * There is still one implementation. {@link completionOf} is the same question
 * asked of a value that may not have an answer yet, and it delegates here.
 *
 * **Memoised per answer, for C15's reason and by C15's key.** The causes are
 * published — on `ReqState.incomplete.causes` and on `RefreshOutcome` — and they
 * were rebuilt on every read, so an answer nothing had touched handed a consumer
 * a new array each time it looked. That is the same defect as the
 * `IncompleteResultError` being minted per read, on the same answer, one field
 * across; a sweep of the published handle is what found it, and fixing only the
 * Error would have been fixing the field that was in hand rather than the axis.
 * **The unit is the answer, and it was the record for one round.** A forward
 * event or a failure does not change what the backlog answered — and neither
 * does a refusal arriving after the end, which is the case that broke the
 * record's version: `addRefusal` spreads a new `BacklogRecord` for it, so the
 * memo missed and the answer's causes were rebuilt on a wire event. See
 * {@link AnswerIdentity}.
 */
const completions = new WeakMap<AnswerIdentity, Completion>();

export function completionOfRecord(backlog: BacklogRecord): Completion {
  const memoised = completions.get(backlog.answer);
  if (memoised !== undefined) return memoised;
  const computed = computeCompletion(backlog);
  completions.set(backlog.answer, computed);
  return computed;
}

function computeCompletion(backlog: BacklogRecord): Completion {
  // Only the backward leg decides this. Completeness asks whether everything
  // that existed was fetched, and that question is over and done with when the
  // backlog ends; whether anything can *still* arrive is the forward leg's, and
  // it is reported on the activity axis and the diagnostics. Consulting both
  // meant a backlog that ran cleanly to EOSE became incomplete the moment a
  // live subscription was later refused — a complete set relabelled by an event
  // that could not have removed anything from it.
  //
  // The leg filter that used to stand here is gone because the shape now says
  // it: this record only ever holds refusals aimed at its own attempt's
  // backward leg, so there is nothing to filter out. A `set.refusals.length > 0`
  // written against the old flat array was the same line with the filter
  // dropped, and it read as a simplification.
  const present = new Set<IncompleteCause>();
  if (backlog.refusals.length > 0) present.add('refused');
  // `timeout` and `ended` come as a set rather than as a kind, because the
  // per-relay table can hold both at once: the request's timer firing while one
  // relay's connection is already gone is two different things missing from the
  // same answer. Reading a single `end.kind` here is what made `ended`
  // unreachable — the backlog's end was decided by whichever signal arrived
  // first, and a dead socket arrived as rx-nostr completing the subscription.
  if (backlog.end.kind === 'incomplete') for (const cause of backlog.end.causes) present.add(cause);
  // Independent of how the backlog *ended*: an answer can reach EOSE on every
  // relay, be complete in the leg's sense, and still not be everything the
  // filter matched.
  if (backlog.ephemeralOmitted) present.add('ephemeral-event-omitted');
  const causes = causesOf(present);
  return causes === undefined ? { kind: 'complete' } : { kind: 'incomplete', causes };
}

export interface RetentionOptions {
  /**
   * How many entries to keep. Unset means unbounded, which is what a request
   * that ends gets by default and the reason a live one must say something.
   *
   * The number is policy. What is decided here is that bounding happens over
   * the stored set, under the total order, rather than in the view — a
   * view-side cap bounds what is displayed and leaves the set growing, and a
   * cap by arrival order breaks the ordering laws at every instant. This one
   * does neither, and keeps the ordering laws **unconditionally**: the bound is
   * a function of the events and of nothing else.
   */
  retain?: Retention | undefined;
  /**
   * The instant the chunk sampled. **Retention no longer reads it**, since
   * expiry takes no part in the ranking (B6, B7b).
   *
   * **Three things look removable here and only one of them is. Measured, in
   * this order, because it is the order the next person will try them in.**
   *
   * 1. **The argument** — `collect` passing `now` into these options. Removable.
   *    Nothing in this module consults it, and the mutations that need an
   *    instant get it from the witnesses, which call `retainNewest` directly.
   * 2. **The call** — `sampleNow(clock)` in the reducer. **Not removable.** It
   *    is invoked for its side effect, not its value: it re-reads the source
   *    and *publishes* the result as the reactive `now` the projection reads.
   *    `clock.now` on its own only moves when a timer fires, and timers are
   *    armed only for deadlines already on screen, so dropping the call leaves
   *    a provider reporting the instant it was built. Deleting it was expected
   *    to break `EX1` and broke `EX8` instead — `EX1` moves the source and lets
   *    a timer notice, while `EX8` holds the source still with `schedule:
   *    false`, which makes the sample the only path that can see anything.
   * 3. **The field** — this property. **Not removable.** The ledger entry
   *    `expiry-returns-to-the-ranking-at-the-sampled-instant` destructures it
   *    to put expiry back into the ranking, which is the only mutation that
   *    reaches `E6f`. Without the field it fails to compile, never runs, and
   *    that witness goes unguarded.
   *
   * A fourth thing is worth knowing because it bit once: an entry that *reads*
   * a removed argument does not break loudly. `expired-dropped-on-arrival`
   * guarded on `options.now`, kept matching and kept compiling after (1), and
   * silently stopped killing anything.
   */
  now?: UnixSeconds | undefined;
}

/**
 * Fold one packet into the set.
 *
 * Idempotent (replaying a packet changes nothing), commutative (the result does
 * not depend on arrival order) and monotonic (an entry is only ever added or
 * replaced by a newer one). Those three are what make "re-request without
 * clearing the accumulator" safe.
 *
 * They are properties of **this function**, and they now carry unqualified to
 * the composition `collect` performs, because {@link retainNewest} reads no
 * clock either. Fold-then-bound is order-independent at any instant. That
 * sentence used to carry a qualifier — order-independent only at a fixed
 * sampled instant — and the qualifier went when expiry left the ranking (B6).
 *
 * It takes **no clock and no bound**. The clock was never here; the bound was,
 * and moving it out is what once let retention start judging expiry — a
 * `trim` called from inside the fold would have had to read the time, which is
 * exactly what B7b's first clause forbids. Retention no longer judges it
 * either, so the fold inserts and replaces, {@link retainNewest} decides what
 * survives on recency alone, and neither of them consults a deadline.
 *
 * **Ephemeral events (20000-29999) are dropped here, and the drop is recorded.**
 * This has been all three positions in turn, so the reason matters more than the
 * rule: they were dropped **silently**, which let a request match an event and
 * never show it; then the descriptor boundary refused any request that *could*
 * select one, which refused `{ ids, limit }` — the by-id request the published
 * components make; now the boundary refuses only a request that **names** an
 * ephemeral kind, or a **live** one that names no kinds at all, and a non-live
 * request with no `kinds` is accepted. Such a request can match an ephemeral
 * event, so this function drops it and sets {@link CachedEventSet.ephemeralOmitted},
 * which {@link computeCompletion} turns into `ephemeral-event-omitted`. **A
 * finite answer can say what it left out; that is the whole reason the live case
 * is still refused at the boundary rather than handled here.**
 *
 * v1 does **not** interpret kind 5 deletions, so a deletion is stored like any
 * other regular event and nothing removes what it references. NIP-40 expiration
 * is not interpreted here either, and that is now true of the library as well
 * as of this function: nothing is dropped on the way in, so an event past its
 * deadline is stored, hidden by the projection, and keeps whatever retention
 * slot its recency earns it. **Not last in the queue for one**, which is what
 * this said while expiry still ranked: the bound reads no clock (B6, B7b), so
 * an expired event can hold a slot a valid older one would have taken.
 *
 * **A `const`, and its check is its first statement.** A function declaration
 * is an assignable binding: a wrapper assigned to it at module level would be
 * what every caller reaches, reading the packet before any check. As a `const`
 * nothing can rebind it, and the check before anything else is what lets no
 * path through the fold, today's or a later one, precede it.
 */
export const foldEvent = (set: CachedEventSet, packet: OwnedPacket): CachedEventSet => {
  // **Only the packets this library made are stored, checked at run time too.**
  // The type refuses a wire packet and a rebuilt one; a cast, a
  // `structuredClone` or a spread that keeps an owned event beside the
  // transport's fields gets past any type, so the fold asks the set the
  // ownership boundary writes to. A foreign packet here is a defect in this
  // library, not an input.
  if (!isOwnedPacket(packet))
    throw new TypeError('foldEvent was handed a packet this library did not make');
  // **Dropped and recorded, never dropped silently.** See the docblock: the
  // boundary now accepts a non-live request with no `kinds`, so an ephemeral
  // event can reach here, and there is no surface that could show one. The flag
  // is what keeps this from being the silent omission the first version was —
  // and it is set even when the entry map does not change, because the fact
  // being reported is about the *answer* rather than about the store.
  if (classifyKind(packet.event.kind) === 'ephemeral') {
    return set.ephemeralOmitted === true ? set : { ...set, ephemeralOmitted: true };
  }

  const key = replacementKey(packet.event);
  const current = set.entries.get(key);
  if (current) {
    const winner = laterWins(current.event, packet.event);
    if (winner === current.event) return set;
  }

  const entries = new Map(set.entries);
  entries.set(key, packet);
  return { ...set, entries };
};

/**
 * Keep the newest `retain` entries, under the order the views use (B6).
 *
 * The bound reads no clock. That is the decision this round reversed, and it is
 * worth stating why rather than leaving it to look like an omission.
 *
 * A round of this design gave expiry a say in which entry gives up its slot, so
 * that an event past its deadline could not evict a live one (`EX6`). Measured
 * afterwards, that preference falsified two other decisions. It let a
 * *superseded* replaceable come back: evicting the newer revision deletes the
 * only trace of the coordinate, so an older revision arriving later finds no
 * incumbent and is stored as though it were new (B5). And it made the answer
 * depend on arrival order **even with the sampled instant held still**, because
 * a valid entry superseded by an expired one has its standing *lowered*, which
 * frees a slot whose rightful occupant was already discarded (B6).
 *
 * Both were measured before this was changed, not argued: six arrival orders of
 * one bounded set at one fixed instant produced three different stored sets and
 * three different published answers, two of them showing the superseded event.
 * `E6d`, `E6e` and `E6f` are the witnesses and they fail on the old bound.
 *
 * So expiry is out of the ranking and stays where it can be reversed: the
 * projection hides what has expired, and {@link project} is the only reader.
 * Nothing is dropped on the way in and no deadline evicts anything, so a
 * corrected clock brings back every entry that is still stored.
 *
 * What is given up is `EX6` itself, and it is contracted rather than hidden: a
 * newer expired event can hold a slot a valid older one would have taken, so a
 * consumer can be shown fewer entries than `retain` — or none — while valid
 * events are in the set. That is recoverable by raising `retain` or choosing
 * `'unbounded'`, where the old behaviour was not recoverable at all once a
 * coordinate had been forgotten.
 *
 * Returns the same set when nothing is cut, so a replayed packet still folds to
 * the identical object (E3) with this composed after the fold.
 */
export function retainNewest(
  set: CachedEventSet,
  { retain }: RetentionOptions = {}
): CachedEventSet {
  const entries = keepNewest(set.entries, retain);
  return entries === set.entries ? set : { ...set, entries };
}

function keepNewest(
  entries: Map<string, OwnedPacket>,
  retain: Retention | undefined
): Map<string, OwnedPacket> {
  if (retain === undefined || retain === 'unbounded' || entries.size <= retain) return entries;

  // The order the views use, and nothing else. The bound reads no clock, which
  // is what makes it a function of the events alone — and that is not a
  // simplification, it is the decision: expiry taking part in this ranking is
  // what let a superseded replaceable come back (B5) and what made the answer
  // depend on arrival order at a fixed instant (B6). Both measured.
  //
  // The reason it works out is that supersession can only ever *raise* an
  // entry's standing here: a replacement is newer by `created_at`, or equal
  // with a lower id, and `laterWins` and `byRecency` break that tie the same
  // way. Standing that never falls is standing an evicted entry can never
  // reclaim, which is the only thing a bound holding `retain` payloads and no
  // history is able to promise.
  const newestFirst = [...entries.entries()].sort(([, a], [, b]) => byRecency(a, b));
  return new Map(newestFirst.slice(0, retain));
}

/**
 * An attempt has begun: give both legs somewhere to accumulate, and drop the
 * previous attempt's forward leg.
 *
 * What it does *not* touch is {@link CachedEventSet.backlog} — nor the entries,
 * which is A2. Completeness goes on reporting the previous attempt's answer
 * until this one has one of its own, and that is the difference between a
 * refresh a consumer can see through and one that empties the screen.
 *
 * The forward slot is replaced rather than emptied, and that is what closes the
 * attribution hole E16 walks. Emptied, the next forward signal to arrive built
 * the record — so a refusal from the attempt this one replaced built *this*
 * attempt's record and was reported as its own. Replaced, the id is written by
 * the only step that knows it.
 *
 * **It does not touch {@link CachedEventSet.failure} either**, and that is the
 * blocker r11 names rather than an omission on the way past. A failure is
 * superseded when a later attempt *ends*, not when one starts: while this
 * attempt runs, the previous one's failure is still the most recent failure
 * there has been, so clearing it here would make a field called "the most recent
 * failure" empty for the whole of every retry. `endBacklog` is what clears it,
 * and `P47` is where the difference is read.
 */
export function beginAttempt(set: CachedEventSet, attemptId: AttemptId): CachedEventSet {
  // **A late `fresh` from a superseded producer does not rewind the value.**
  // This took whatever attempt a chunk named, so replaying an older attempt's
  // first chunk put the value back on that attempt — after which the newer
  // attempt's own end was dropped as belonging to somebody else, and a
  // published refusal list came back **shorter**, which is `B-η`'s falsifier
  // word for word. Measured through `collect`.
  //
  // It is unreachable through the shipped engine — `twoStageStream` emits
  // `fresh` once per generator, and the abort and `cancelled` checks stop a
  // superseded producer writing at all — so this was an unchecked precondition
  // rather than a defect, written in a docblock and enforced by nothing. This
  // repository's own test driver already violated it, which is what a port
  // would do first.
  //
  // **This is the first of the two authorized call sites of the one order
  // reader** (`isOlderAttempt`) — the other is {@link noteFailure}, and both
  // are in this module, which is what lets 0002 A6 say the order has a single
  // reader and every read outside it is an equality. `WR17` counts the calls.
  // An id the comparator cannot place — a different registry's, or one no
  // registry minted — is never refused: it answers `false` there, so the guard
  // costs nothing where it cannot judge, and a wrong `false` is the direction
  // the value's other guards cover.
  const current = set.running?.attemptId ?? set.backlog?.attemptId;
  if (current !== undefined && isOlderAttempt(attemptId, current)) return set;
  return {
    ...set,
    running: { attemptId, refusals: [] },
    forward: { attemptId, end: undefined, refusals: [] }
  };
}

/**
 * This attempt's backlog ended: swap its record in, whole.
 *
 * Named rather than positional. `attemptId` has to be the attempt that is
 * running, so a duplicate end is ignored (the first end wins — overwriting
 * would let a second answer's `complete` erase the first's `timeout`) and an
 * end belonging to an attempt this value never saw begin is not attributed to
 * whatever happens to be in flight.
 *
 * **This is also what clears a failure**, and it is the only thing that does. An
 * attempt that reached an end has asked the question again and been answered, so
 * an *earlier* attempt's failure is no longer the most recent thing that
 * happened to this request.
 *
 * Its own attempt's record is kept, and the order the two are written in is the
 * reason. A failure is the last thing an attempt writes — the throw ends the
 * stream, so no chunk follows it — so a record stamped with this attempt can
 * only have arrived *after* the end being recorded here. That is a reachable
 * pair rather than a contradiction: a live attempt whose backlog completed can
 * have its forward leg throw afterwards, and both records then name it.
 * Clearing here would delete a failure that is genuinely later than the answer,
 * which is the same loss {@link noteFailure}'s missing guard avoids, reached
 * from the other side.
 */
export function endBacklog(
  set: CachedEventSet,
  attemptId: AttemptId,
  end: BacklogEnd
): CachedEventSet {
  const running = set.running;
  if (running?.attemptId !== attemptId) return set;
  const failure = set.failure?.attemptId === attemptId ? set.failure : undefined;
  return {
    ...set,
    // **Frozen here too, and this is the writer the last sweep missed.** The
    // end this stores is built by the *caller* — the hook builds one for the
    // empty plan, and `backlogEndOf` builds the rest — so freezing it where it
    // is made left the call-site version writable, which a reviewer measured on
    // the ordinary `plan === 'empty'` path. The answer token goes with it: the
    // memos' correctness rests on its **content** (see {@link AnswerIdentity}),
    // so a consumer able to write `answer.of` could collapse the next answer
    // onto this one through the query library's structural sharing.
    backlog: {
      attemptId,
      end: Object.freeze(end),
      refusals: running.refusals,
      late: [],
      // Carried from what the fold saw while this attempt ran; see
      // {@link BacklogRecord.ephemeralOmitted}.
      ephemeralOmitted: set.ephemeralOmitted === true,
      answer: Object.freeze({ minted: 'answer', of: attemptId })
    },
    running: undefined,
    failure
  };
}

/**
 * This attempt threw: record it against the attempt, whatever the legs say.
 *
 * **No *equality* guard on the running or forward attempt, and an order guard
 * that was added late.** {@link endForward} and {@link addRefusal} drop a
 * signal whose attempt is not the one the value is on, because a signal
 * arriving late describes a leg that has since been replaced. A failure is the
 * opposite case: the attempt that threw may never have reached the value at
 * all. `P47`'s is the reachable shape — the poison arrives as the attempt's
 * *first* chunk and the poison check runs before `collect`, so `beginAttempt`
 * has not run for the attempt that threw and `running`/`forward` still name the
 * attempt before it. An equality guard would discard exactly the failure that
 * expectation is about, which is why there is not one.
 *
 * Unconditional forwards, in the same sense: a newer failure replaces an older
 * one, because "the most recent failure" is what the field means. What bounds
 * it is {@link endBacklog}, not this.
 *
 * **What is *not* unconditional any more is backwards.** It was: a reviewer
 * built `noteFailure(noteFailure(set, newer, e1), older, e2)` directly and the
 * *older* attempt's Error came back published on `state.error`. The round that
 * found it left the guard out and gave the instrument as the reason —
 * `isOlderAttempt` has one call site, and `0002`'s A6 was discharged on that
 * being true — which is the derivation backwards: `WR17` watches the contract,
 * it does not choose it.
 *
 * So the guard is here, and A6's count is two: the rewind guard in the fold and
 * this writer, both in this module, which is what keeps the *reader* singular
 * (`A6-C2`, and `WR17` counts the calls rather than describing them). It is a
 * strict-order guard, not an equality one — a failure whose attempt is strictly
 * older than the one the value is on is dropped, and everything else is
 * recorded, which is what keeps `P47` working.
 *
 * The comparison inherits {@link isOlderAttempt}'s costs: an id from another
 * registry — or one no registry minted — is never refused, because the
 * comparator answers `false` where it cannot judge. What is still not
 * established is how wide the overlap is: query-core cancels the previous fetch
 * and the machine returns rather than throwing on abort, so several in-flight
 * attempts writing failures is narrow, and "narrow" is not "none". `E25` is the
 * arm; the ordering it reads is the contract a port owes.
 */
export function noteFailure(
  set: CachedEventSet,
  attemptId: AttemptId,
  error: unknown
): CachedEventSet {
  // **The failure is stored by reference and published to every reader**, on
  // `ReqState.error` and on `ReqDiagnostics.lastError`, so this is where the
  // library takes ownership of an Error somebody threw at it. Frozen rather
  // than copied, and the difference is load-bearing: a copy would be a plain
  // Error, and C16's whole point is that a consumer can tell the refusals apart
  // with `instanceof`. Measured before this line: two hooks on one key shared
  // the object, and `error.message = '…'` on one changed what the other read.
  //
  // Freezing a value this library did not make is the same trade the event
  // boundary makes at the other end — an object arriving from outside is
  // nobody's after it is handed over, and this one is not retained by whoever
  // threw it.
  // **The second authorized call site of the order reader, and it is a decision
  // rather than a tidy-up.** This writer had no order at all: a reviewer built
  // `noteFailure(noteFailure(set, newer, e1), older, e2)` and the *older*
  // attempt's Error came back on `state.error`. The round that found it left the
  // guard out and gave the instrument as the reason — `WR17` counts one call
  // site — which is the derivation backwards: the check watches the contract, it
  // does not choose it.
  //
  // What is chosen here is the second of the two readings 0003 and 0004 already
  // take elsewhere: `lastError` is **the failure of the generation the value is
  // on**, not the last failure the wall clock saw. A later attempt ending
  // supersedes an earlier answer, so a superseded attempt's late failure is
  // dropped for the same reason its late chunk is.
  //
  // The comparison is the same shape as `beginAttempt`'s and inherits its
  // costs: an id from another registry — or one no registry minted — is never
  // refused, because the comparator answers `false` where it cannot judge.
  const current = set.running?.attemptId ?? set.backlog?.attemptId ?? set.failure?.attemptId;
  if (current !== undefined && isOlderAttempt(attemptId, current)) return set;
  return { ...set, failure: { attemptId, error: recordedFailure(capture(error, 'unspecified')) } };
}

/**
 * Record that this attempt's forward leg ended. The first end wins, and the
 * refusals stay.
 *
 * Named by the attempt, exactly as {@link endBacklog} is. An end belonging to an
 * attempt that has been superseded is dropped rather than applied to whatever
 * record is in the slot: applied, it would leave the new attempt reporting a leg
 * it has not opened as stopped, which is the same lie the old record would have
 * told if `beginAttempt` had kept it — arrived at from the other side.
 */
export function endForward(set: CachedEventSet, attemptId: AttemptId, end: LegEnd): CachedEventSet {
  const forward = set.forward;
  if (forward?.attemptId !== attemptId) return set;
  if (forward.end !== undefined) return set;
  // Frozen here as well as at the one call site that builds it: this record is
  // what `ReqDiagnostics.legEnded` republishes on every read, and a rule kept
  // by one caller is a rule the second caller does not have. See
  // {@link backlogEndOf}.
  return { ...set, forward: { ...forward, end: Object.freeze(end) } };
}

/**
 * How many differently-worded refusals one relay may hold on one leg under one
 * classification.
 *
 * A bound rather than a policy, and it exists because {@link isNewRefusal}
 * widened the key to the notice. The notice is a string a relay chooses, these
 * arrays are retained on the cache value for the whole of an attempt, and they
 * are published — so without a bound the size of a public, retained list is
 * decided by a relay that keeps rewording itself. A relay repeating a `CLOSED`
 * is not hypothetical either: the frame ends the subscription on its side, so
 * anything after the first is already a relay doing something it need not do.
 *
 * Counted **per classification** rather than over the relay's whole list, and
 * that is the part carrying the weight. A flat cap would drop a refusal in a
 * class this relay had not used yet once it was full — which is the defect this
 * whole rule is about, moved to a threshold instead of removed. Per class, a
 * class with nothing in it is always under its own cap, so "a relay that changes
 * its mind is heard" holds however much came before it. What the bound can drop
 * is a re-wording of something already recorded, which is the case where the
 * classification, `recoveryFor`'s answer and this library's action are all
 * already held.
 *
 * The value is not load-bearing beyond being small: at four, one relay holds at
 * most forty refusals per leg across NIP-01's ten classifications, which is a
 * constant a reader can hold. `E18` is the witness and asserts the bound rather
 * than this number.
 */
const WORDINGS_PER_REASON = 4;

/**
 * Whether this refusal says something the leg is not already holding.
 *
 * "The same relay saying the same thing" is the rule {@link addRefusal} has
 * always stated, and the comparison was `from` alone — so a relay got one
 * refusal per leg per attempt and everything it said after that vanished. The
 * ordering that makes it a defect is `rate-limited:` then `blocked:`: the first
 * clears by waiting and the second does not, so the message a consumer most
 * needs was the one being discarded (`E18`).
 *
 * `leg` is not compared because it does not have to be: each array holds one
 * leg's refusals, and {@link addRefusal} is what routes them. `reason` is not
 * compared for identity either — it is `classifyRefusal(notice)`, so equal
 * notices already have equal reasons — but it is what the bound is counted over.
 */
function isNewRefusal(refusals: readonly Refusal[], refusal: Refusal): boolean {
  let wordings = 0;
  for (const held of refusals) {
    if (held.from !== refusal.from) continue;
    // **The same wording means the same published value**, which is what a
    // consumer can tell apart: same classification, same kept text, same
    // truncation flag. Two notices that differ only past the bound are one
    // wording here — the price of bounding what is retained, and it is paid in
    // the dimension a diagnostics list can afford.
    if (
      held.notice.text === refusal.notice.text &&
      held.notice.truncated === refusal.notice.truncated
    ) {
      return false;
    }
    if (held.reason === refusal.reason) wordings += 1;
  }
  return wordings < WORDINGS_PER_REASON;
}

/**
 * Record a refusal against the leg *and* the attempt it was aimed at. One per
 * relay per distinct notice; a repeat is the same relay saying the same thing.
 *
 * A refusal for an attempt that is not the one this value is on is dropped
 * rather than filed somewhere. There is nowhere honest to put it: on the
 * backward leg the record it would belong to has already been swapped in, and
 * adding it there would change an answer a consumer has already been given; on
 * the forward leg the record it would land in belongs to a subscription the
 * refusal was never about, so a relay that refused the previous attempt's live
 * leg would be reported as having refused this one's.
 *
 * The two branches used to disagree — this function took an `AttemptId` and the
 * forward branch ignored it — which is the half of the attribution work that
 * was left open. They read the same way now, and E16 is the difference.
 *
 * What "the same thing" means is {@link isNewRefusal}, and it used to mean "the
 * same relay". Appended rather than replaced when it is new, and dropped rather
 * than evicting when the bound is reached: this list is published, so a consumer
 * that has already rendered it is never handed a shorter one, and never one in
 * which two entries they have already seen have swapped.
 *
 * **Said that precisely, because the flat list is a concatenation and not a
 * log.** `refusalsOf` joins four per-record lists in a fixed order, each of
 * which grows only at its end **within one attempt**, so a refusal on one leg
 * can appear *before* refusals already shown from another — a forward refusal,
 * then a backward one, and the backward one is at index 0. No two shown entries
 * change places, which is what a consumer rendering a keyed list depends on;
 *
 * **and "nothing is removed" is false across attempts, deliberately.** This
 * paragraph said it flatly, and `B-η` decides the opposite one record over: the
 * lists are per attempt, `beginAttempt` empties `forward` and `running`, so the
 * published list comes back **shorter** at the start of the next attempt and
 * again when its backlog ends — three moments, and `E16` is where that is
 * measured. What is bounded within one attempt is what this paragraph is about;
 * the flat list is **not** in arrival order, and this is where that is written
 * down rather than left for somebody to infer from a run. `RF16` holds both
 * halves: the supersequence, and the insertion that is not at the end.
 */
export function addRefusal(
  set: CachedEventSet,
  refusal: Refusal,
  attemptId: AttemptId
): CachedEventSet {
  if (refusal.leg === 'forward') {
    const forward = set.forward;
    if (forward?.attemptId !== attemptId) return set;
    if (!isNewRefusal(forward.refusals, refusal)) return set;
    return { ...set, forward: { ...forward, refusals: [...forward.refusals, refusal] } };
  }
  const running = set.running;
  if (running?.attemptId === attemptId) {
    if (!isNewRefusal(running.refusals, refusal)) return set;
    return { ...set, running: { ...running, refusals: [...running.refusals, refusal] } };
  }
  // **The same attempt, arriving after its backlog ended.** The backward
  // subscription is closed by then and the message channel is not, so on a live
  // request this is an ordinary shape rather than a corner: a relay that EOSEs
  // and then says `restricted:` is answering the attempt the value is on. It
  // used to fall through to the wrong-attempt guard below and be dropped, which
  // left a consumer looking at `nodata` — "nothing exists" — over a refusal
  // nothing published.
  //
  // Kept in `late`, which is what stops it relabelling an answer already given:
  // see the field's own note.
  const backlog = set.backlog;
  if (backlog?.attemptId === attemptId) {
    if (!isNewRefusal([...backlog.refusals, ...backlog.late], refusal)) return set;
    // The spread carries {@link BacklogRecord.answer} through, which is what
    // keeps this write off C15's axis: a new record, the same answer.
    return { ...set, backlog: { ...backlog, late: [...backlog.late, refusal] } };
  }
  return set;
}

/**
 * When an event stops being valid, if it says so.
 *
 * NIP-40's tag, read the way the specification defines it: a timestamp at which
 * the event should be considered expired. A malformed value is no expiry rather
 * than an immediate one — the alternative is hiding an event because its author
 * wrote something unparseable.
 */
export function expiresAt(event: ReqEvent): number | undefined {
  const tag = event.tags.find((entry) => entry[0] === 'expiration');
  if (tag === undefined) return undefined;
  // Parsed strictly rather than with `Number`, which accepts far more than a
  // timestamp: `Number('')` is 0, so an empty value became "expired at the
  // epoch" and hid the event forever; `'0x10'`, `'1e3'`, `' 12 '` and `'-1'`
  // all produce a number too. A NIP-40 value is a non-negative decimal integer
  // and nothing else, and anything else is no expiry rather than an immediate
  // one — the alternative is hiding an event because its author wrote
  // something unparseable.
  const raw = tag[1];
  if (typeof raw !== 'string' || !/^(0|[1-9][0-9]*)$/.test(raw)) return undefined;
  const at = Number(raw);
  return Number.isSafeInteger(at) ? at : undefined;
}

/**
 * NIP-40's comparison, in one place, for the one reader of the tag.
 *
 * B7b's second clause says the library reads the tag by one set of rules
 * wherever it reads it. `expiresAt` is the parser half; this is the other half,
 * and it used to be written out twice — once in the projection and once in the
 * gate that has since been removed. Two copies of `at <= now` is how a
 * boundary comes to be off by one on one path only.
 *
 * No clock is not the epoch: with `now` absent nothing has expired, which is
 * what a caller with no provider gets.
 */
function isPast(at: number | undefined, now: number | undefined): boolean {
  return now !== undefined && at !== undefined && at <= now;
}

/** What a consumer sees, and when it next changes on its own. */
export interface Projection {
  readonly events: readonly ReqEvent[];
  /** The nearest deadline among what is currently shown, if any. */
  readonly nextExpiryAt: number | undefined;
}

/**
 * The public read model: the events, newest first, minus anything expired.
 *
 * The fold above stays a function of the events seen, so replay and
 * reconnection keep working — and the exclusion happens here, where it can be
 * recomputed, rather than at ingestion, where it could not be undone. That is
 * why an event past its deadline is still in the value: a corrected clock, a
 * wider read model or a decision that NIP-40 should be advisory can all still
 * reach it.
 *
 * It is the **only** time-dependent function over the value, and that is the
 * whole of NIP-40's reach into this library. {@link retainNewest} briefly read
 * the same instant, to decide which entry gave up its slot; that is withdrawn,
 * because a bound that reads a clock made the stored set depend on the instants
 * the chunks arrived at and let a superseded replaceable return (B5, B6). So
 * time is consulted here and nowhere else, where the answer is recomputed on
 * every read and a corrected clock undoes it.
 */
export function project(set: CachedEventSet, now: number | undefined): Projection {
  const events: ReqEvent[] = [];
  let nextExpiryAt: number | undefined;

  for (const packet of selectMany(set)) {
    const at = expiresAt(packet.event);
    // The only comparison anything makes against a deadline. Retention used to
    // make it too, through this same function; it does not any more, and a
    // reader who remembers that pairing should not be told it still holds. No
    // clock means no expiry filtering: in production there is always one — the
    // provider owns it — so this is the shape a caller without a provider gets,
    // and it errs towards showing rather than hiding.
    if (isPast(at, now)) continue;
    if (at !== undefined && (nextExpiryAt === undefined || at < nextExpiryAt)) nextExpiryAt = at;
    events.push(packet.event);
  }

  // The array a consumer holds, frozen for the reason its elements are: two
  // readers of one state see the same object.
  return { events: Object.freeze(events), nextExpiryAt };
}

/**
 * Newest first, with the same tie-break the fold uses.
 *
 * **The last line used to answer `1` in both directions for two entries under
 * one event id**, which is not a comparator: `Array.sort` is then free to
 * produce either order, and it produced the arrival one. B6 says the bound
 * "reads no clock, so the result is a function of the events and not of their
 * arrival order — unconditionally, at any instant", and the word that was false
 * is *unconditionally*: two entries can carry one id, because
 * `replacementKey` files a regular event under its id and a replaceable one
 * under `kind:pubkey`. Measured end to end — the same two frames in the two
 * orders kept different events at `retain: 1`, and changed the display order at
 * `retain: 'unbounded'`.
 *
 * **Returning `0` there would not be enough**, and that is worth writing down
 * because it looks like the fix: `Array.sort` has been stable since ES2019, so
 * `0` leaves the two in the order the map yielded them — which is arrival
 * order, the very thing B6 says the answer does not depend on. So the tie-break
 * goes on, through `kind` and then `pubkey`, until it is deciding from the
 * events or the two events are equal on everything this order can see.
 *
 * What remains is two entries that agree on `created_at`, `id`, `kind` and
 * `pubkey` — the same event under two replacement keys, where either order is
 * the same list of events. Their being distinguishable at all rests on a
 * premise this module does not enforce (that no two stored entries share an
 * id), which the verifier upholds and a caller's own `verifyEvent` can drop.
 */
function byRecency(a: OwnedPacket, b: OwnedPacket): number {
  if (a.event.created_at !== b.event.created_at) return b.event.created_at - a.event.created_at;
  if (a.event.id !== b.event.id) return a.event.id < b.event.id ? -1 : 1;
  if (a.event.kind !== b.event.kind) return a.event.kind - b.event.kind;
  if (a.event.pubkey !== b.event.pubkey) return a.event.pubkey < b.event.pubkey ? -1 : 1;
  return 0;
}

export interface ProjectionOptions {
  /** Cap applied to the *view*, not to what the cache holds. */
  limit?: number | undefined;
}

export function selectMany(set: CachedEventSet, { limit }: ProjectionOptions = {}): OwnedPacket[] {
  const all = [...set.entries.values()].sort(byRecency);
  return limit === undefined ? all : all.slice(0, limit);
}

export function selectOne(set: CachedEventSet): OwnedPacket | undefined {
  return selectMany(set, { limit: 1 })[0];
}
