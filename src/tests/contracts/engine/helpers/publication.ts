/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The publication discipline `B5-C8` holds a published value to, read by
 * reflection rather than by writing.
 *
 * **Why not write and compare.** The instrument this replaces wrote to every own
 * member of every container it could reach and compared a snapshot of each
 * reader before and after. Five independent reviews found writes it never
 * attempted (adding a key, a numeric `length`, a `Map`'s operations, a
 * function's own members, a method replacement on a list) and observations its
 * snapshot could not make (a list's non-index members, two symbol keys
 * collapsing into one, every function equal to every other). Each was a
 * representative write standing in for a storage rule. This asks the storage
 * rules directly: a value whose every reachable object is closed — not
 * extensible, every own slot non-writable and non-configurable, no setter
 * anywhere on its own or inherited path — cannot be changed through any write a
 * consumer spells, so it cannot carry a write to the cache or another reader.
 *
 * **What it is, and what it is not.** It enforces a *sufficient* discipline,
 * chosen so the guarantee is decidable here — not a decision procedure for the
 * contract over arbitrary JavaScript. It rejects some values that would keep
 * the promise (a frozen accessor whose setter refuses everything, a transparent
 * `Proxy` over a closed record) because admitting them would need behaviour this
 * cannot read off a descriptor. And it cannot see behaviour at all: a frozen
 * function that changes a closure is a command, and a command's effects are its
 * own contract (`refresh()` is meant to change shared state). So functions are
 * admitted only where a live interface names a command, and what a command
 * resolves with is checked by calling it, in the arrangement, as a value.
 *
 * **Two roles.** A *snapshot* — a state, a diagnostics value, an outcome, an
 * Error, a refusal, an outlet's argument — is a closed graph of plain records,
 * lists and this library's own Errors, with no accessor and no function. A
 * *live interface* — a handle, `useRelayDiagnostics()`'s object — is closed
 * too, but may hold the getters and commands it names and nothing else; each
 * getter's function object is checked as an object, each getter is read once
 * and what it returns is checked under the same rules, and an exemption is one
 * named edge of one interface rather than a property name.
 *
 * **Prototypes are out of scope, with two exceptions.** A consumer who rewrites
 * a shared prototype (an Error class's `toString`, `Array.prototype.map`)
 * changes what every reader of every value computes, and that is not a write
 * *through a published value* — the same exclusion as tampering with
 * `WeakSet.prototype`. But an ordinary assignment reaches the prototype chain
 * without anyone rewriting it: an inherited **setter** runs on assignment even
 * when the receiver is frozen, and inherited **object data** on a library
 * prototype is shared by every instance. Both are read here, on every object.
 */
import { types } from 'node:util';

/** A live interface a hook hands out: the getters and commands it names, and nothing else. */
export interface LiveInterface {
  /** Accessors this interface may hold: each getter's output is checked, read once. */
  readonly getters: readonly string[];
  /** Data members this interface may hold, each a function — what it resolves with is the arrangement's to check. */
  readonly commands: readonly string[];
  /**
   * Getters whose output is **not** walked. One edge of one interface: the
   * engine handle's `raw`, the query library's own object, priced in `B5-C8`
   * rather than promised. A property of the same name anywhere else is walked.
   */
  readonly unwalked?: readonly string[];
}

export interface Discipline {
  /** The live interfaces in this arrangement, by identity; every other object is a snapshot. */
  readonly interfaces: ReadonlyMap<object, LiveInterface>;
  /** The prototypes a published Error may have: this library's own classes, and no other. */
  readonly errors: ReadonlySet<object>;
}

/**
 * The setters every function inherits from `Function.prototype` — `caller` and
 * `arguments`, the language's restricted properties. They run only on a
 * function with no own member of that name, which is a strict one — every
 * function module code makes — and there they refuse every write; a sloppy
 * function shadows them with own members, which this walk reads like any
 * other. **Not `%ThrowTypeError%`**: the specification
 * installs that intrinsic here, and V8 installs a `get caller`/`set caller`
 * pair of its own for sloppy callers — measured, the identity check this
 * started with answered `false` on Node 26.
 */
const RESTRICTED_SETTERS: ReadonlySet<unknown> = new Set(
  ['caller', 'arguments'].map(
    (key) => Reflect.getOwnPropertyDescriptor(Function.prototype, key)?.set
  )
);

/**
 * `Object.prototype.__proto__`'s setter, which every record and list inherits.
 * On a receiver that is not extensible it refuses every change of prototype —
 * the extensibility rule below is what makes it harmless, and that rule is read
 * on the same object.
 */
const PROTO_SETTER = Reflect.getOwnPropertyDescriptor(Object.prototype, '__proto__')?.set;

/** The platform's own prototypes, whose data is the language's rather than this library's. */
const INTRINSIC: ReadonlySet<object> = new Set<object>([
  Object.prototype,
  Array.prototype,
  Function.prototype,
  Error.prototype,
  Object.getPrototypeOf(async () => undefined) as object
]);

/**
 * Every host kind whose state lives in internal slots, which no descriptor
 * shows and a frozen shell does not close (`Map.prototype.set.call(held, …)`
 * writes into a frozen `Map`). **Enumerated from `util.types`**, not written out:
 * every predicate there but the four this discipline judges another way — a
 * `Proxy` first, an Error by its prototype, a function by its position.
 */
const SLOTTED = Object.entries(types)
  .filter(
    ([name]) =>
      !['isProxy', 'isNativeError', 'isAsyncFunction', 'isGeneratorFunction'].includes(name)
  )
  .map(([name, is]) => [name, is as (value: unknown) => boolean] as const);

const memberOf = (path: string, holder: object, key: string | symbol): string => {
  if (typeof key === 'symbol') return `${path}[${String(key)}]`;
  if (Array.isArray(holder) && /^(0|[1-9][0-9]*)$/.test(key)) return `${path}[${key}]`;
  return `${path}.${key}`;
};

/**
 * Every place under `root` where the discipline does not hold, as
 * `path: rule` — an empty list is the discipline kept.
 *
 * Reads descriptors, never data through a getter, except the getters a live
 * interface names; those are called once each, guarded, and a throw is a
 * finding rather than the end of the walk.
 */
export function breachesOf(root: unknown, at: string, discipline: Discipline): string[] {
  const found: string[] = [];
  const seen = new Set<object>();
  const inheritedFrom = (value: object, path: string): void => {
    for (
      let proto = Reflect.getPrototypeOf(value);
      proto !== null;
      proto = Reflect.getPrototypeOf(proto)
    ) {
      for (const key of Reflect.ownKeys(proto)) {
        const slot = Reflect.getOwnPropertyDescriptor(proto, key);
        if (slot === undefined) continue;
        const refusing =
          (proto === Function.prototype && RESTRICTED_SETTERS.has(slot.set)) ||
          (slot.set === PROTO_SETTER && !Reflect.isExtensible(value));
        if (slot.set !== undefined && !refusing)
          found.push(`${path}: inherits a setter, ${String(key)}`);
        if (
          !INTRINSIC.has(proto) &&
          'value' in slot &&
          typeof slot.value === 'object' &&
          slot.value !== null
        )
          found.push(`${path}: inherits data, ${String(key)}`);
      }
    }
  };
  const visit = (value: unknown, path: string, admitted: 'value' | 'function'): void => {
    if (typeof value !== 'function' && (typeof value !== 'object' || value === null)) return;
    if (seen.has(value)) return;
    seen.add(value);
    // First, and alone: every other question below runs a trap on a proxy.
    if (types.isProxy(value)) {
      found.push(`${path}: a proxy`);
      return;
    }
    const named = discipline.interfaces.get(value);
    if (typeof value === 'function') {
      if (admitted !== 'function' && named === undefined)
        found.push(`${path}: a function in a snapshot`);
    } else {
      const slotted = SLOTTED.find(([, is]) => is(value));
      if (slotted !== undefined) {
        found.push(`${path}: a host object with internal state (${slotted[0]})`);
        return;
      }
      const proto = Reflect.getPrototypeOf(value);
      const admittedKind =
        named !== undefined ||
        proto === Object.prototype ||
        proto === null ||
        (Array.isArray(value) && proto === Array.prototype) ||
        (proto !== null && discipline.errors.has(proto));
      if (!admittedKind) {
        found.push(`${path}: a kind this discipline does not admit`);
        return;
      }
    }
    if (Reflect.isExtensible(value)) found.push(`${path}: extensible`);
    inheritedFrom(value, path);

    const keys = Reflect.ownKeys(value);
    const isInterface = named !== undefined && typeof value !== 'function';
    if (isInterface) {
      for (const member of [...named.getters, ...named.commands])
        if (!keys.includes(member)) found.push(`${path}.${member}: named and absent`);
    }
    for (const key of keys) {
      const where = memberOf(path, value, key);
      const slot = Reflect.getOwnPropertyDescriptor(value, key);
      if (slot === undefined) continue;
      if (slot.configurable === true) found.push(`${where}: configurable`);
      if ('value' in slot) {
        if (slot.writable === true) found.push(`${where}: writable`);
        const command = isInterface && typeof key === 'string' && named.commands.includes(key);
        if (isInterface && !command) found.push(`${where}: a member the interface does not name`);
        visit(slot.value, where, command ? 'function' : 'value');
        continue;
      }
      if (slot.set !== undefined) {
        found.push(`${where}: a setter`);
        visit(slot.set, `${where} (its setter)`, 'function');
      }
      const getter = isInterface && typeof key === 'string' && named.getters.includes(key);
      if (!getter)
        found.push(
          `${where}: ${isInterface ? 'an accessor the interface does not name' : 'an accessor in a snapshot'}`
        );
      if (slot.get === undefined) continue;
      visit(slot.get, `${where} (its getter)`, 'function');
      if (!getter || named.unwalked?.includes(key as string) === true) continue;
      let output: unknown;
      try {
        output = Reflect.apply(slot.get, value, []);
      } catch {
        found.push(`${where}: a getter that throws`);
        continue;
      }
      visit(output, where, 'value');
    }
  };
  visit(root, at, 'value');
  return found;
}
