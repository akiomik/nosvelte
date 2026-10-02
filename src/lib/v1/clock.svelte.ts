/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The clock the public read model is projected against.
 *
 * NIP-40 says an event should be considered expired at its timestamp, by relays
 * and by clients. An earlier reading treated both of the specification's gates
 * as being about arrival; that is not what it says, and a library that keeps
 * showing an event after its deadline is deviating from a SHOULD rather than
 * implementing it.
 *
 * So the public projection reads the current time — and that makes the clock
 * something the library has to own, because "excluded at its expiry" and
 * "excluded the next time something else happens to redraw" are different
 * contracts. The second is what a projection without a scheduler provides, and
 * adding the scheduler later changes observable behaviour.
 *
 * **There is one reader, and the second call is not a second reader.** The
 * projection asks "is this expired as of the last timer or the last arrival",
 * and re-asks whenever a deadline passes, so it wants the reactive `now`.
 * **That sentence said "right now" and it was not the same claim**: `now` moves
 * only when a timer fires, so an event whose deadline passes with nobody
 * reading stays shown until something arms one. Which used to be the
 * projection's own getter, so nobody reading meant nobody arming — the request
 * hook now arms it at construction, and `RH3` holds that. The arrival path calls
 * {@link ExpiryClock.sample} for what it publishes rather than for what it
 * answers: `now` between timers is the last instant a timer left behind, and
 * timers are armed only for deadlines already on screen, so without that call a
 * chunk arriving an hour later is projected against whenever the last one
 * fired.
 *
 * This paragraph named retention as the second reader for several rounds after
 * it stopped being one. Retention consults no clock and no deadline (B6, B7b) —
 * which is why the correction that took expiry out of the ranking had to reach
 * this file too, and did not.
 *
 * What is deliberately absent: the clock takes no part in cache identity or in
 * query generations, and nothing it says removes an event from the stored value
 * — no arrival is rejected for having expired, no deadline passing evicts
 * anything, and expiry decides nothing about which entry gives up a slot when
 * the bound overflows. The fold is a function of the events seen, which is what
 * keeps it idempotent and order-independent under replay, and the bound is a
 * function of the same events and of nothing else.
 *
 * So the clock is **not** in what is stored, and there is no instant for the
 * stored value to be relative to. What stood here was the opposite — that a
 * bounded set is order-independent at a fixed instant and not across a moving
 * one — citing `E6c`, which moves the clock between arrivals and measures that
 * the two orders agree. The witness quoted for the qualifier was the falsifier
 * of it.
 */

/** Unix seconds, which is what NIP-40's tag carries. */
export type UnixSeconds = number;

export interface ExpiryClock {
  /** Reactive: reading this in a derivation re-runs it when a deadline passes. */
  readonly now: UnixSeconds;
  /**
   * Ask to be woken once `at` has passed.
   *
   * Only the nearest pending deadline is armed. Every consumer re-arms when it
   * re-derives, so the set of interesting deadlines is rebuilt rather than
   * tracked — the alternative is a registry with removal, for a gain of one
   * timer.
   */
  wakeAt(at: UnixSeconds): void;
  /**
   * Read the source **now**, publish what it read, and return it.
   *
   * `now` is not a clock in the sense "what time is it": it only moves when a
   * timer fires, and timers are armed only for the deadlines of events that are
   * currently projected. So a provider built at T0 whose consumer has shown
   * nothing with a deadline still reports T0 an hour later, so a projection
   * reading it judges an *arriving* event against a stale instant. That is the
   * defect the review named, and this is the repair: the arrival path samples
   * rather than reads.
   *
   * Publishing is not the second half — it is the whole of it. The one caller
   * discards what this returns: `sampleNow(clock)` sits in the accumulator's
   * reducer and is invoked for its effect, so the only thing that reaches
   * anybody is the assignment to `now`. This used to say a sample that only
   * returned would leave *retention* and the projection judging one chunk
   * against two instants. Retention judges no instant at all (B6, B7b), and
   * B7b's one-reading rule is about the tag — read by the projection and by
   * nothing else. Re-measured for this sentence rather than quoted from the two
   * other places that record it: with the call deleted, `EX8` fails at
   * `expected [ 'ex8-dead' ] to deeply equal []` — the expired event is shown.
   * It is the witness that holds the source still and arms no timer, so the
   * sample is the only thing that could notice.
   *
   * **Required.** It was optional for one reason only — the parity harness built
   * a frozen clock as an object literal and would not have compiled — and an
   * optional method with a `?? clock.now` fallback is the two-readings shape
   * itself, kept alive for a fixture's convenience. A clock fixed at one instant
   * has nothing to re-read, so it answers with exactly its `now`; writing that
   * one line is what the fixture owes, and it is what makes "the arrival path
   * samples" true of every clock rather than of the ones that implement it.
   */
  sample(): UnixSeconds;
  /**
   * Re-read the source now.
   *
   * For a clock that does not schedule — the server's, and the tests' — where
   * advancing time is something the caller does rather than something that
   * happens. Named for what it is rather than hidden behind `wakeAt`, so a
   * reader of the production path can see it is not on it.
   *
   * Not the same thing as {@link sample}, which is on the production arrival
   * path: this one exists so a test can move the source *and* say when the move
   * becomes visible, which is how a clock correction is written.
   */
  tickForTest(): void;
  dispose(): void;
}

/**
 * Publish the current instant on whatever clock there is, and return it.
 *
 * The return is vestigial and the publish is the point — see {@link
 * ExpiryClock.sample}. This used to be described as "the instant an arriving
 * chunk is judged against", which was true when retention ranked by expiry; the
 * arriving chunk is judged against nothing now (B6, B7b), and what the sample
 * decides is what the *projection* shows next.
 *
 * `undefined` when there is no clock, which is no expiry judgement at all — the
 * same direction every other trade here takes: a caller with no provider sees
 * what arrived, rather than a projection filtered against the epoch. Nothing is
 * dropped either way, because the fold never consults it.
 */
export function sampleNow(clock: ExpiryClock | undefined): UnixSeconds | undefined {
  if (clock === undefined) return undefined;
  return clock.sample();
}

export interface ClockOptions {
  /** Injectable so tests do not wait, and so the server can be fixed in time. */
  source?: () => UnixSeconds;
  /**
   * Whether deadlines are scheduled at all.
   *
   * The server renders once at a fixed instant: a timer there would fire after
   * the response has gone, holding the request open for nothing.
   */
  schedule?: boolean;
}

const systemClock = (): UnixSeconds => Math.floor(Date.now() / 1000);

/**
 * The clock a server-rendered provider gets: one instant, and no timer.
 *
 * A-δ said the provider owns a clock "fixed and unscheduled when rendering on a
 * server, so that a timer cannot outlive the response that armed it", and for
 * six rounds nothing detected the server. `schedule` defaulted to `true` and
 * `source` to the system clock, so the sentence described a capability that
 * existed and was never invoked — the option had to be passed by hand, and only
 * the tests passed it.
 *
 * Read once rather than per call, because a projection that reads a moving
 * clock during a single render can exclude an event partway through it and
 * produce markup no consistent instant would have produced.
 */
export function serverClockOptions(): ClockOptions {
  const at = systemClock();
  return { source: () => at, schedule: false };
}

/**
 * The largest delay `setTimeout` holds: 2^31 - 1 milliseconds, 24.855 days.
 *
 * Written out rather than reached for from the runtime because there is nowhere
 * to reach: the limit is in the specification of the host timer, not in an
 * export. Above it every runtime this library targets clamps to 1ms rather than
 * throwing, which is why the overflow shows up as a busy loop instead of an
 * error. See {@link createExpiryClock}'s `delayUntil`.
 */
const MAX_DELAY_MS = 2_147_483_647;

export function createExpiryClock(options: ClockOptions = {}): ExpiryClock {
  // **A source that does not advance and `schedule: true` is a pair nothing
  // forbids, and it re-arms for ever.** `fire` re-arms whenever the source has
  // not reached the deadline, and its only exit is the source reaching it — so
  // a frozen clock books one sleep a second for the provider's life. It is the
  // right behaviour for a clock told that time is not moving, and it is cheap
  // (no reader is invalidated: the bump belongs to the branch where the arming
  // is dropped), but it is a pairing a caller can reach through the published
  // `clock` option. `serverClockOptions()` is the only place that sets the two
  // together, and it sets `schedule: false`.
  const source = options.source ?? systemClock;
  const schedule = options.schedule ?? true;

  let now = $state(source());
  /**
   * Bumped whenever a deadline is reached, and read by {@link ExpiryClock.now}.
   *
   * **A reader re-derives when the second moves, and that is not the same thing
   * as a deadline passing.** Something other than this clock moves the second:
   * the accumulator's reducer samples the source as each chunk lands, so by the
   * time the timer for a deadline fires, the second that deadline falls in can
   * already be the current one. `fire` then reads the same number back, Svelte
   * does not notify on a primitive re-assigned its own value, and the arming it
   * has just dropped is never re-offered — so the *next* deadline, refused
   * while a nearer one was armed, is never armed at all.
   *
   * Measured (`EX11`): two deadlines a chunk apart, and the farther one booked
   * no sleep for the rest of the run. The event behind it stays shown until
   * something unrelated redraws, which is the failure this file exists to
   * remove rather than a smaller version of it.
   *
   * Reading it from the `now` getter rather than publishing it is deliberate:
   * every reader of the clock is a reader of "a deadline passed", and none of
   * them has to know that.
   */
  let fired = $state(0);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let armedFor: UnixSeconds | undefined;
  // Disposal has to stop future arming, not only clear what is armed: a
  // consumer that re-derives once more on the way out would otherwise leave a
  // timer behind the provider that owned it.
  let disposed = false;

  /**
   * How long to sleep for a deadline, in a delay `setTimeout` can hold.
   *
   * **An `expiration` is a relay's number, and this is where it reaches a host
   * primitive whose domain is narrower than its type.** `setTimeout` takes a
   * 32-bit signed delay; anything past 2 147 483 647ms — 24.855 days — is
   * clamped by the runtime to **1ms**. The timer then fires at once, finds the
   * deadline still ahead, and re-arms: a permanent loop that invalidates every
   * reader of this clock, for the provider's whole life. Measured: 2 147 483
   * seconds out arms nothing extra, 2 147 484 fires five times in 1.2 seconds,
   * and node prints `TimeoutOverflowWarning`.
   *
   * **The rate belongs to the re-arm rather than to this line**, which is worth
   * saying because the two are edited separately. The shape that shipped
   * re-armed at a literal 250ms, so it spun four times a second; with the
   * `max` below and only this clamp taken away, the re-arm computes the same
   * out-of-domain delay and the host clamps that too — measured at 433 sleeps
   * in 500ms. Both are in the ledger, and the ledger used to carry a sentence
   * saying either edit alone was bounded.
   *
   * It arrives from outside — `foldEvent` accepts any safe integer as an
   * `expiration` — so a single relay can do this to a page with one event, and
   * a request nobody renders is enough since the wake-up is armed at
   * construction. Every other timer in this library is already bounded; this
   * was the one path where an untrusted number reached the primitive raw.
   *
   * Clamping rather than refusing, because the deadline is not wrong — it is
   * far away. The clamped hop re-enters `fire`, which re-arms for what is left.
   */
  const delayUntil = (at: UnixSeconds): number =>
    Math.min(Math.max(0, (at - now) * 1_000), MAX_DELAY_MS);

  return {
    get now() {
      // `fired` is read here and nowhere else: it puts every reader of the
      // clock on the signal that a deadline was reached, which the second alone
      // does not carry when something else has already moved it.
      void fired;
      return now;
    },
    /**
     * Arm for `at`, keeping the nearest deadline offered (`C13-C5`).
     *
     * **Its domain is what `expiresAt` admits**: a non-negative safe integer of
     * seconds. That is not defended here and cannot be, because this is not
     * where the untrusted number arrives — the tag parser two files away is,
     * and it refuses anything else before a deadline exists. What a value from
     * outside that domain does is worth knowing before this is ever published:
     * `NaN` passes all three guards below, clears a pending timer and arms one
     * for `NaN` — which the host clamps to 1 ms, with a `TimeoutNaNWarning` on
     * node. **"Arms nothing" stood here and is not what happens**, measured: a
     * real deadline of 100 s armed, then `wakeAt(NaN)`, gives `clearTimeout`
     * followed by `setTimeout(fire, NaN)`. It does not spin — the immediate
     * fire moves `fired`, every reader re-derives, and `project` re-arms the
     * deadline it still holds — but the deadline that was armed is dropped and
     * a wake-up happens at once instead. `armedFor` is `NaN` afterwards, so the
     * nearest-deadline guard admits the next offer rather than swallowing it,
     * which is what makes the re-arm work. `Infinity` and `Number.MAX_SAFE_INTEGER` are clamped like any far
     * deadline and hop for ever, which is the safe side.
     *
     * So: publishing this clock means either checking `at` here or carrying
     * `expiresAt`'s guarantee into the published type. Listed as residue rather
     * than defended, because a check here today is a branch no caller can reach.
     */
    wakeAt(at: UnixSeconds) {
      if (disposed || !schedule) return;
      // **Not reachable from inside this library, and kept for the caller it
      // does not have yet.** `project` drops every deadline that is already past
      // before it reports the next one, and both callers read `clock.now` and
      // hand it to `deriveState` in the same synchronous turn, so what arrives
      // here is always ahead of `now`. A comment elsewhere used to cite this
      // line as the reason the reducer samples the clock; what makes that
      // necessary is `project`'s own exclusion, which `EX8` measures.
      if (at <= now) return;
      if (armedFor !== undefined && armedFor <= at) return;

      if (timer !== undefined) clearTimeout(timer);
      armedFor = at;
      // Fire when the deadline has been reached, not a second after it. The
      // projection excludes on `at <= now`, so waking at `at` is exactly the
      // moment the event stops being valid — an earlier version added a second
      // of slack and made every exclusion up to a second late, which is not
      // what "at their expiry" says.
      //
      // If the source has not caught up when it fires, re-arm rather than drop
      // the deadline: one-second resolution means the boundary can be read as
      // the previous second, and losing the wake-up would leave the event
      // showing until something else redrew.
      const fire = () => {
        timer = undefined;
        armedFor = undefined;
        now = source();
        if (now < at) {
          armedFor = at;
          // 250ms is the slack for the one-second boundary; anything further out
          // is a deadline this run could not reach in one hop, and re-arming at
          // 250ms for it is the spin `MAX_DELAY_MS` exists to stop.
          //
          // **The floor binds only for a source that answers in fractions.**
          // With whole seconds on both sides, `at - now >= 1` and `delayUntil`
          // is at least 1 000, so the `max` returns its second argument every
          // time — the deadline parser gives integers, and a caller who passes
          // `Date.now() / 1000` as the source is the one this floor is for.
          timer = setTimeout(fire, Math.max(250, delayUntil(at)));
        } else {
          // Here and not above the branch: this is the one path that ends with
          // nothing armed, so it is the one that has to ask for another
          // derivation. Bumping unconditionally would also fire on every hop of
          // a clock whose source does not advance — a re-arm that used to cost
          // nothing but a timer would then invalidate every reader once a
          // second, which is a price this repair has no reason to charge.
          fired += 1;
        }
      };
      timer = setTimeout(fire, delayUntil(at));
    },
    sample() {
      // **Disposal is read here as well as in `wakeAt`, and the two together are
      // what "stopped" means.** Stopping only the arming leaves a clock that
      // still moves and can never schedule again: a handle held across its
      // provider's teardown samples on every chunk a refresh brings in, so its
      // projection hides everything whose deadline has passed since — and
      // nothing will ever arm a wake-up to bring the next one round, because
      // that half is off. The old shape hid events on a clock that had been
      // disposed and called it time passing.
      if (disposed) return now;
      const at = source();
      // Assigned only when it moved, and the guard is about the update graph
      // rather than about speed. This writes reactive state from a path a
      // derivation's result flows into — the projection reads `now`, and a
      // chunk that lands during a flush would otherwise re-invalidate every
      // reader of the clock once per event in the same second. Svelte does not
      // notify on a primitive re-assigned its own value, so the guard states
      // the intent; it is not what makes it safe. What makes it safe is where
      // it is called: the accumulator's reducer, which is neither an effect nor
      // a derivation, so nothing here reads `now` and writes it in one pass.
      if (at !== now) now = at;
      return at;
    },
    tickForTest() {
      if (disposed) return;
      now = source();
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      armedFor = undefined;
    }
  };
}
