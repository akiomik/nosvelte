/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Which objects this library made.
 *
 * **The failure channel publishes values this library constructed and never one
 * it was handed** (`own.ts` says why). That rule needs a way to tell the two
 * apart, and the way has to be one a hostile value cannot answer for itself: a
 * `name`, a `code` or a prototype are all things a caller can copy, and a
 * `Proxy` can answer any read. Membership of a `WeakSet` is decided by object
 * identity, which nothing can trap — a proxy *wrapping* one of our errors is not
 * in the set, and that is the right answer: what a consumer would hold is the
 * wrapper.
 *
 * A leaf module on purpose. Every error class in this library calls
 * {@link ownedByLibrary}, including the ones in `normalize.ts` and `key.ts`
 * that `own.ts` itself depends on, so the registry cannot import anything.
 */

const OURS = new WeakSet<object>();

/**
 * Close what freezing cannot, and hand the value back. **No authority.**
 *
 * Called from the constructor of every error class here, because that is where
 * the value is complete enough to freeze and the close has to come first. It
 * says nothing about who made the object, which is the whole point: this runs
 * on a `RelayConfigurationError` a *consumer* constructed too.
 */
export function hardenOwned<T extends object>(value: T): T {
  closeStack(value);
  return value;
}

/**
 * Say that **this library made this object, on this occasion**.
 *
 * **Membership used to be minted in each class's constructor, and those classes
 * are exported.** `RelayConfigurationError`, `IncompleteResultError`,
 * `MissingProviderError` and `MissingRandomnessError` are on the published
 * entry, so `new RelayConfigurationError('duplicate-relay', [], 'a message I
 * chose')` handed a consumer a value this registry called ours — and `capture`
 * passes ours through untouched. Measured end to end through the hook:
 * `state.error === theirs`, their `code`, their `message`, their live object on
 * `cause`, and this library *freezing their object* on the way out. That is
 * every promise on this channel, falsified from the published surface, by the
 * same door `PO8` closed on `ReqFailure` alone — the correction was applied to
 * the instance a reviewer named and not to the class of it.
 *
 * So the question this registry answers is not "is it an instance of one of our
 * classes" — a consumer can make one of those — but "did *this library*
 * construct it here". Only the library's own construction sites call this;
 * `WR23` is the check — it reads the construction sites rather than the
 * class bodies now — and a constructor that calls it is a door in the wall.
 */
export function ownedByLibrary<T extends object>(value: T): T {
  closeStack(value);
  OURS.add(value);
  return value;
}

/**
 * The whole sequence for a value that is complete when it is made: **close,
 * mint, freeze**, in that order.
 *
 * **Order is a correctness property here and it was shared implicitly.** Each
 * class did its own registration and its own freeze, and `ReqFailure`'s factory
 * did them in the other order — the constructor froze, and `closeStack`'s
 * `defineProperty` then threw `Cannot redefine property: stack` into a `catch`
 * and left the setter live. Measured: `Object.isFrozen` `true`, the `stack`
 * descriptor non-configurable, and `snapshot.stack = '…'` accepted. `PO9` was
 * green because the value it built was an `UnsupportedFilterError`, whose
 * constructor happens to register before it freezes — the right order, arrived
 * at by accident, in one of two places.
 *
 * So a caller that wants a sealed owned value asks for one, and nobody spells
 * the sequence twice.
 */
export function sealOwned<T extends object>(value: T): T {
  ownedByLibrary(value);
  Object.freeze(value);
  return value;
}

/**
 * Turn `stack` into a value, so freezing the object actually closes it.
 *
 * **`Object.freeze` does not stop a setter, and `Object.isFrozen` says `true`
 * anyway.** On V8 an `Error`'s `stack` is an own **accessor** — a get/set pair
 * with no `writable` in its descriptor — so a frozen published Error still
 * accepted `error.stack = '…'`. Measured through two hooks on one key: one wrote
 * the other's `stack`, and `diagnostics.lastError.stack` came back with it. That
 * is `B5-C6`'s contract word for word — a consumer's change reaching another
 * reader — surviving the repair that was supposed to close it, because the
 * instrument asked `isFrozen` and the walk only opens containers.
 *
 * Redefining it as a data property with the value it already has is the whole
 * fix: the trace is kept, and the freeze that follows makes it read-only like
 * every other member.
 *
 * **What the getter answers decides nothing, and reading it as a precondition
 * was a hole on this very runtime.** This used to return early unless the getter
 * answered a string, with a comment calling that a non-V8 corner "no host in
 * this project's support matrix" reaches. It is not about the host: any
 * dependency can set `Error.prepareStackTrace`, and a function returning
 * `undefined` — the ordinary way to suppress traces — makes the getter answer
 * `undefined` while leaving the **setter** live. Measured on the published
 * `InvalidRelayInputError`: `Object.isFrozen` answered `true` and a second
 * reader's `error.stack = '…'` took. So the definition is unconditional, and
 * what the getter answered is used only for the value to keep.
 *
 * Still guarded, because a host that installs `stack` non-configurable (JSC)
 * refuses the redefinition — and on that host it was never writable to begin
 * with. **No branch is written for "the close failed"**: on the resolved runtime
 * `defineProperty` cannot fail here — the own `stack` V8 installs is
 * configurable, and nothing of this library's runs between the base
 * constructor and this call — so such a branch would have no entrance, and this
 * repository deletes branches that have none. `WR28` reads the **effect**
 * instead, over every class and under both hostile globals.
 *
 * **One thing that is not this library's does run here**: reading `stack` runs
 * whatever `Error.prepareStackTrace` holds, and a formatter that hangs an open
 * object on the Error it formats puts it on a value this library then
 * publishes. That is a consumer rewriting what the platform does for every
 * Error — `B5-C8` puts it with the platform's objects, outside — rather than a
 * write through a published value.
 */
function closeStack(value: object): void {
  let held: unknown;
  try {
    held = (value as { stack?: unknown }).stack;
  } catch {
    // A getter that throws is one more thing the value must not be published
    // with; it decides nothing here beyond leaving the trace behind.
    held = undefined;
  }
  try {
    Object.defineProperty(value, 'stack', {
      value: typeof held === 'string' ? held : undefined,
      writable: false,
      configurable: false,
      enumerable: false
    });
  } catch {
    // A host that will not let us. `PB1` reads the effect rather than this call.
  }
}

/** Did this library make it? Never throws, whatever it is asked about. */
export function isOwnedByLibrary(value: unknown): boolean {
  try {
    return typeof value === 'object' && value !== null && OURS.has(value);
  } catch {
    return false;
  }
}

/**
 * Close a live interface a hook hands out — a handle, `useRelayDiagnostics()`'s
 * object — and hand it back: every function on it first, each getter's and each
 * command, then the object itself (`B5-C8`). It closes no setter, because none
 * of them has one, and `B5-C8`'s discipline reports a setter wherever it is.
 *
 * **`Object.freeze` closes an object's own slots and nothing they point at.** A
 * handle frozen alone would keep its getters' function objects open, and one of
 * them is one call away for any consumer —
 * `Object.getOwnPropertyDescriptor(handle, 'state').get` — so whatever one
 * consumer hung on it, every other reader of that handle read. What a getter
 * *returns* is not closed here: each projection freezes its own, on every read.
 */
export function sealInterface<T extends object>(value: T): T {
  for (const key of Reflect.ownKeys(value)) {
    const member = Reflect.getOwnPropertyDescriptor(value, key);
    if (member?.get !== undefined) Object.freeze(member.get);
    if (typeof member?.value === 'function') Object.freeze(member.value);
  }
  return Object.freeze(value);
}

/**
 * Close one of this library's classes, and hand it back: its prototype, which
 * holds its class and nothing else, and the class itself (`B5-C8`).
 *
 * **A published Error inherits its class, and the class was open.** Every
 * instance reaches it as `error.constructor`, so one consumer's
 * `Object.defineProperty(error.constructor, Symbol.hasInstance, …)` rewrote
 * what this library's own `instanceof` answered — measured: the refused cache
 * key read `RelayNotInScopeError` that way, and two unrelated requests then
 * shared one entry. Closing the instance closed nothing it inherits. The
 * platform's classes are not this library's to close, so its decisions read a
 * brand rather than `instanceof` (`reqerror.ts`); its own classes are closed
 * besides.
 */
export function sealClass<T extends abstract new (...args: never[]) => unknown>(constructor: T): T {
  // Sealing the prototype closes the class too: it is the prototype's
  // `constructor`, a function on it. No class here has a static function of
  // its own, and the discipline reports one wherever it appears.
  sealInterface(constructor.prototype as object);
  return constructor;
}
