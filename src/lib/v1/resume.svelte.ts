/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The provider's answer to "the machine came back".
 *
 * **What this exists for, measured link by link.** rx-nostr's default retry is
 * bounded (`maxCount: 5`); retries exhausted is an `error`; an `error` on the
 * forward leg is terminal; and terminal is absorbing within an attempt (`A5`),
 * because a relay that reconnects does not revive a leg. So a laptop lid closed
 * for longer than five backoffs, a tunnel, or any gap past the ceiling ends
 * every live feed on the page — permanently — and the state that reports it is
 * a `settled` answer with events in it, which `deriveOutlet` renders as
 * `default`. Silence reading as health, which this library refuses everywhere
 * else.
 *
 * **The trigger is a timer and the browser's events are hints.** Relying on
 * `online` and `visibilitychange` alone cannot recover from a relay-specific
 * failure — the machine never went offline and the tab never went away, one
 * relay simply stopped — so the recovery is a provider-owned backoff and these
 * bring the wait *forward*. That is why this publishes a generation rather than
 * an event: a reader that has a recovery pending re-reads it and stops waiting;
 * a reader with nothing pending is unaffected.
 *
 * **One per provider, and it is the provider's to release.** `C6` gives the
 * provider one resource domain, and a listener is a resource: nothing here is
 * registered on a server, and {@link ResumeHints.dispose} removes what was.
 */
export interface ResumeHints {
  /**
   * Reactive. Increments when the host says it is worth trying again.
   *
   * A **generation** rather than a callback, for the reason the diagnostics map
   * is a value rather than an Observable: a reader subscribes by reading, and a
   * reader that is not interested holds nothing. It is also what makes "a hint
   * arrived while nothing was waiting" a no-op rather than a lost event.
   */
  readonly generation: number;
  /** How many listeners are registered. Zero on a server, and after disposal. */
  readonly listeners: number;
  dispose(): void;
}

/**
 * The events a browser gives that mean "try again".
 *
 * `online` is the network coming back. `visibilitychange` is the tab returning,
 * which is when a phone or a laptop resumes — and it fires for *leaving* too,
 * which is why the handler reads the state rather than treating the event as
 * the signal.
 */
const HINTS = ['online', 'visibilitychange'] as const;

export function createResumeHints(environment: 'browser' | 'server'): ResumeHints {
  let generation = $state(0);
  let registered: (() => void)[] = [];

  if (environment === 'browser' && typeof globalThis.addEventListener === 'function') {
    const bump = (): void => {
      // **The state, not the event.** `visibilitychange` fires when a tab is
      // hidden as well as when it returns, and a hint on the way out is a wake
      // for a page nobody is looking at. `document` may be absent in a host
      // that has `addEventListener` and no DOM, so an unreadable visibility is
      // read as "visible" — a hint too many costs one wake-up, a hint too few
      // costs a feed.
      const hidden = (globalThis as { document?: { hidden?: boolean } }).document?.hidden;
      if (hidden === true) return;
      generation += 1;
    };
    for (const event of HINTS) {
      globalThis.addEventListener(event, bump);
      registered.push(() => globalThis.removeEventListener(event, bump));
    }
  }

  return {
    get generation() {
      return generation;
    },
    get listeners() {
      return registered.length;
    },
    dispose() {
      for (const off of registered) off();
      registered = [];
    }
  };
}
