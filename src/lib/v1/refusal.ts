/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * A-α: what a relay's refusal means, and what this library does about it.
 *
 * Those are two questions and the first version of this file answered them with
 * one type. It sorted the prefixes into "clears by waiting" and "does not", and
 * nothing acted on the distinction — so a request refused by every relay with
 * `rate-limited:` sat reporting `live` with no subscription anywhere and no
 * timer that would ever open one again. The classification was applied
 * faithfully and the behaviour was a lie; the tests checked the former.
 *
 * They are separated here. {@link RefusalReason} is what the relay said, taken
 * from the specification's own vocabulary and nothing more. {@link recoveryFor}
 * is this library's policy, which is a decision rather than a fact — NIP-01
 * defines the prefixes and says nothing about retrying, so "`rate-limited:`
 * clears by waiting" is a reasonable reading while "`error:` is permanent" is
 * not a reading at all: the specification offers a database failure and an idle
 * subscription shutdown as examples of that same prefix.
 */

/**
 * What the relay said, in the specification's words.
 *
 * > The standardized machine-readable prefixes for `OK` and `CLOSED` are:
 * > `duplicate`, `pow`, `blocked`, `rate-limited`, `invalid`, `restricted`,
 * > `mute` and `error` for when none of that fits.
 * > — NIP-01
 *
 * NIP-42 adds `auth-required:`. `unknown` is not one of theirs: NIP-01 does not
 * require a prefix at all, so a notice with none, or with one nobody has
 * standardized, has to land somewhere that does not claim to know what it means.
 * Folding those into `error` would put a guess where the vocabulary belongs.
 */
export type RefusalReason =
  | 'duplicate'
  | 'pow'
  | 'blocked'
  | 'rate-limited'
  | 'invalid'
  | 'restricted'
  | 'mute'
  | 'error'
  | 'auth-required'
  | 'unknown';

const REASONS: ReadonlySet<string> = new Set<RefusalReason>([
  'duplicate',
  'pow',
  'blocked',
  'rate-limited',
  'invalid',
  'restricted',
  'mute',
  'error',
  'auth-required'
]);

/** Read the prefix, and nothing more. Total, because a notice may have none. */
export function classifyRefusal(notice: string): RefusalReason {
  const separator = notice.indexOf(':');
  if (separator < 0) return 'unknown';
  const prefix = notice.slice(0, separator);
  return REASONS.has(prefix) ? (prefix as RefusalReason) : 'unknown';
}

/**
 * What this library does about a refusal.
 *
 * v1 does one thing: it stops. There is no protocol-level retry, and that is a
 * decision rather than an omission — a retry needs an owner for the timer, the
 * attempt count, the cancellation and the ceiling, which is a state machine this
 * design does not have. The query library's own retry is off by decision for an
 * unrelated reason (a wrapper bug should not become four requests), so reusing
 * it here would inherit a policy chosen for a different failure.
 *
 * `selfClearing` is kept apart from the action because it is the part that is
 * about the world rather than about us: asking again after `rate-limited:` could
 * plausibly succeed with the caller doing nothing, and asking again after
 * `blocked:` could not. Nothing reads it today. It is what a retry policy would
 * be written against, and recording it now is what makes adding one a change to
 * this function rather than a re-derivation of the whole classification.
 */
export interface Recovery {
  /** Could asking again succeed without the caller doing anything? */
  readonly selfClearing: boolean;
  /** What v1 does. Always `stop`: this library owns no retry timer. */
  readonly action: 'stop';
}

export function recoveryFor(reason: RefusalReason): Recovery {
  // `auth-required:` is the one case something else may recover: rx-nostr
  // re-sends the REQ after a successful AUTH when an authenticator is
  // configured. That is not this library's recovery and cannot be assumed —
  // whether one is configured is not readable from the client — so the leg is
  // recorded as stopped either way, and an actual re-send clears it. The
  // evidence used is a REQ going back out, not an inference. See `machine.ts`.
  return { selfClearing: reason === 'rate-limited', action: 'stop' };
}

/**
 * What a relay's connection state means for the live leg it is carrying.
 *
 * A5's table, as data. It replaces `everyRelayRefused`, which could only see
 * refusals — and a refusal is not the case the sixth event was written for:
 * rx-nostr leaves the subscription untouched on a transport failure and reports
 * it here instead (DIAG-3).
 *
 * The distinction that matters is between gone and going: rx-nostr reconnects
 * and re-sends the ongoing request on its own, so a socket that is retrying
 * must keep the leg alive or the recovery is broken. `error` is the state it
 * reaches when the retries are used up, which is a different claim.
 *
 * `dormant` **should not** be reached while a forward subscription is open, and
 * "should not" rather than "cannot" is 0002's wording, settled there. **This
 * paragraph kept the stronger word after that** — "not reachable", and a state
 * that "cannot occur" — which is how the constant below could be renamed out of
 * `IMPOSSIBLE_…` while the doc beside it went on saying the thing the rename
 * removed, and why 0004's "the code agrees with 0002" was true of the name and
 * not of this.
 *
 * What holds the state away is the dependency's: rx-nostr has one
 * `setState('dormant')`, in the socket's close handler, and it is taken only
 * when the close code is its own `WebSocketCloseCode.RX_NOSTR_IDLE` — which
 * rx-nostr sends only for a connection nothing was communicating over, which is
 * the whole of why the state means "asleep". That is an invariant of its
 * connection code and not one this library enforces, so `terminal` is the safe
 * branch taken *because* the invariant is unenforced rather than despite it: a
 * leg riding a socket that went to sleep has ended.
 *
 * **The falsifier was drafted, and then run.** That code is in the WebSocket
 * private-use range, so a *relay* may send it, and a relay closing the socket
 * with it reaches that same close handler with the subscription still open —
 * the handler reads the code off the close event and does not ask who sent it.
 * `N8` sends it, and the state does arrive: `dormant`, with the forward leg on
 * the wire. So "should not" is the right modality and the mapping is a decision
 * about an idle socket rather than a bet on an unreachable state. What a
 * consumer gets on that trace is the ordinary terminal answer — the leg ends as
 * `ended` naming the relay, the request is `incomplete`, a relay returning at
 * the same URL revives nothing (`A5-C20`), and `refresh()` opens a new attempt
 * on the socket that came back.
 *
 * **Nothing reports it, and this paragraph used to say the caller does.** No
 * module imports {@link SHOULD_NOT_HAPPEN_WITH_AN_OPEN_SUBSCRIPTION} — only
 * `refusal.test.ts` does — and 0002 defers the channel on the grounds that a
 * surface for a state the suite cannot produce is built on a guess. What a
 * consumer sees instead is the ordinary terminal report: `machine.ts` ends the
 * backward leg on this phase and, on a live request, the forward one too, so
 * the answer names the relay as gone rather than waiting A-γ out for it.
 *
 * **Why the state has a `case` at all**, since a port that drops it does not
 * fall back to a slower answer: `default` returns `undefined`, and the
 * connection-state handler in `machine.ts` returns on `undefined`, so both legs
 * stay open and the request waits out its settle timer for a socket that has
 * gone quiet. Mapping it to `recovering` instead is the ledger's
 * `dormant-treated-as-alive`, and `RF10` and `N8` are what die under it.
 *
 * **`dormant` is the last of four cases falling through to one `return`, and
 * that made the entry above lie for a round.** Edited as two lines it moved
 * `error`, `rejected` and `terminated` with it, so the program under test was
 * "no connection state is terminal" and its kill set — `N7`, `RF12` — was the
 * collateral rather than this case. The edit splits the fall-through now, and
 * the sibling that does move `error` is its own entry
 * (`a-dead-connection-is-treated-as-recovering`), which is the classification a
 * dying socket actually meets.
 *
 * **`dormant` is terminal here and `ask` in {@link approachFor}, on purpose.**
 * That was left unsaid, which made the two look inconsistent. They answer
 * different questions; see the fourth bullet there.
 */
export type RelayPhase = 'pending' | 'active' | 'recovering' | 'terminal';

export function phaseOfConnectionState(state: string): RelayPhase | undefined {
  switch (state) {
    case 'connecting':
    case 'waiting-for-retrying':
    case 'retrying':
      return 'recovering';
    case 'connected':
      return 'active';
    case 'error':
    case 'rejected':
    case 'terminated':
    case 'dormant':
      return 'terminal';
    default:
      return undefined;
  }
}

/**
 * The one state above that should never be seen with an open subscription.
 *
 * Renamed from `IMPOSSIBLE_WITH_AN_OPEN_SUBSCRIPTION`, which said something
 * stronger than the doc beside it and stronger than anything measured: nothing
 * in the suite drives a relay into `dormant` with a subscription open, so the
 * impossibility was asserted rather than shown. 0002 settles the modality —
 * "should not", and terminal *because* the invariant is unenforced rather than
 * despite it.
 */
export const SHOULD_NOT_HAPPEN_WITH_AN_OPEN_SUBSCRIPTION = 'dormant';

/**
 * What an attempt must do about a relay before it can ask it anything.
 *
 * A5 says `refresh()` is the way back from a stopped request, and that is only
 * true if the way back exists. rx-nostr does not re-open a socket because a REQ
 * arrived for it: a relay left in `error` — retries used up — stays there until
 * something calls `reconnect()`, so an attempt that just re-sends is an attempt
 * to nowhere, and the request would report itself stopped again having done
 * nothing. Measured while writing N2: after a bounce with retries off, the
 * re-send only reached the relay once `reconnect()` had been called.
 *
 * {@link phaseOfConnectionState} calls **four** states terminal, and they are
 * not the same problem. **This listed three of them and omitted `dormant`**,
 * which is the one whose answer here differs from its phase there:
 *
 * - `error` — the retries ran out. Re-opening is exactly what the caller asked
 *   for by calling `refresh()`, so the attempt does it.
 * - `rejected` — the relay refused the connection itself. Reconnecting would be
 *   arguing with an answer, and doing it on every refresh turns a user gesture
 *   into a retry loop against a host that said no.
 * - `terminated` — the client is disposed. There is no connection to re-open
 *   and no later attempt that could succeed, so the attempt fails rather than
 *   pretending.
 * - `dormant` — the only terminal state this answers `ask` for, which it does
 *   by falling through to the default rather than by a `case` of its own. Not
 *   an inconsistency with the table: the two functions ask different questions
 *   of the same string. This one asks **can this relay be asked anything now**,
 *   and `dormant` is rx-nostr's word for a socket it put to sleep because
 *   nothing was subscribed — a REQ wakes it, so the answer is yes and no
 *   reconnect is owed. The table asks **is the leg that was already open still
 *   alive**, and a socket that went to sleep under an open subscription has
 *   ended that leg, so terminal is right there. Preflight and mid-flight are
 *   different moments, and this is the one state that answers them differently.
 *
 * The falsifier for the paragraph above is both functions run over all four:
 * `dormant` is the only state that is `terminal` there and `ask` here, and the
 * other three terminals each answer something other than `ask`. An
 * explicit `case 'dormant': return 'ask'` would be indistinguishable from the
 * fall-through by any observation — same value, same wire, nothing to mutate —
 * so the distinction is recorded here rather than spelled in the switch.
 */
export type RelayApproach = 'ask' | 'reconnect-then-ask' | 'give-up' | 'disposed';

export function approachFor(state: string): RelayApproach {
  switch (state) {
    case 'error':
      return 'reconnect-then-ask';
    case 'rejected':
      return 'give-up';
    case 'terminated':
      return 'disposed';
    default:
      return 'ask';
  }
}
