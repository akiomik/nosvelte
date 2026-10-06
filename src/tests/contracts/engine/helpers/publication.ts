/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The publication discipline `B5-C8` holds a published value to, read by
 * reflection rather than by writing.
 *
 * **Why not write and compare.** The instrument this replaces, for one commit,
 * wrote to every own member of every container it could reach and compared a
 * snapshot of each reader before and after. It never attempted adding a key, a
 * numeric `length`, a `Map`'s operations, a function's own members or a method
 * replacement on a list, and its snapshot could not see a list's non-index
 * members, told two symbol keys apart from one, or one function from another.
 * Each write stood in for a storage rule. This asks the storage rules directly:
 * a value whose every reachable object is closed — not extensible, every own
 * slot non-writable and non-configurable, no setter anywhere on its own or
 * inherited path — cannot be changed through any write a consumer spells, so it
 * cannot carry a write to the cache or another reader.
 *
 * **What it is, and what it is not.** It enforces a *sufficient* discipline,
 * chosen so the guarantee is decidable here — not a decision procedure for the
 * contract over arbitrary JavaScript. It rejects some values that would keep
 * the promise (a frozen accessor whose setter refuses everything, a transparent
 * `Proxy` over a closed record) because admitting them would need behaviour this
 * cannot read off a descriptor. And it cannot see behaviour at all: a frozen
 * function that changes a closure is a command, and a command's effects are its
 * own contract (`refresh()` is meant to change shared state). So a function is
 * admitted in four places only — a command a live interface names, a getter's
 * own function object, a live interface that is itself a function
 * (`useSend()`'s), and a library class reached as its prototype's
 * `constructor`, the one function a consumer may construct — and what a
 * command resolves with is checked by calling it, in the arrangement, as a
 * value.
 *
 * **Two roles, and what they carry.** A *snapshot* — a state, a diagnostics
 * value, an outcome, an Error, a refusal, an outlet's argument — is a closed
 * graph of plain records, lists and this library's own Errors, with no
 * accessor and no function of its own; it may carry a live interface by
 * reference (an outlet's `request`), which is then judged as one. A *live
 * interface* — a handle, `useRelayDiagnostics()`'s object — is a closed plain
 * object holding the getters and commands it names and nothing else; each
 * getter's function object is checked as an object, each getter is read twice
 * and what it returns each time is checked under the same rules, and an
 * exemption is one named edge of one interface rather than a property name.
 *
 * **The platform's built-ins are assumed; this library's prototypes are not.**
 * The discipline, like the library, takes the platform's built-ins to be as
 * the language defines them: a consumer who rewrites `Array.prototype.map`,
 * `WeakSet.prototype.has` or `Error`'s `Symbol.hasInstance` changes what every
 * reader of every value computes, this library's decisions included, and that
 * is outside `B5-C8` rather than a write *through a published value*. Every
 * prototype on a value's chain that is not the platform's — this library's
 * classes' — is read like any other object: closed, holding its class and
 * nothing else, and its class, reached as `error.constructor`, closed as a
 * function. And an inherited **setter** runs on assignment even when the
 * receiver is frozen, so every setter on the chain is read, the platform's
 * included: a setter a consumer installed on a built-in is not assumed away
 * where a published value inherits it.
 *
 * **What reflection cannot see.** A host object keeps its state in internal
 * slots or private fields that no descriptor shows. Those `util.types` can name
 * are refused even under a borrowed prototype; one it cannot — a `URL` whose
 * prototype was swapped for `Object.prototype` — reads as a plain record. This
 * library builds its records as literals, which is what the discipline leans on
 * there.
 */
import { types } from 'node:util';

/** A live interface a hook hands out: the getters and commands it names, and nothing else. */
export interface LiveInterface {
  /** Accessors this interface may hold: each getter's output is checked, read twice. */
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
 * `arguments`, the language's restricted properties. On Node 26 they refuse
 * every write whatever the receiver: a strict function, a sloppy one (which has
 * no own member of those names and reads them through the inherited getters),
 * a record. **Not `%ThrowTypeError%`**: the specification installs that
 * intrinsic here, and V8 installs a `get caller`/`set caller` pair of its own —
 * measured, the identity check this started with answered `false`.
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

/**
 * The platform's own objects on a published value's chain: out of scope, as
 * the header says, except for the setters they hold. Each is on the chain of a
 * value this library publishes — a record's, a list's, an Error's, a
 * function's, an async function's, and a class's (`Error`, the constructor its
 * own classes extend).
 */
const INTRINSIC: ReadonlySet<object> = new Set<object>([
  Object.prototype,
  Array.prototype,
  Function.prototype,
  Error.prototype,
  Error,
  Object.getPrototypeOf(async () => undefined) as object
]);

/**
 * The host kinds whose state lives in internal slots `util.types` can name,
 * which no descriptor shows and a frozen shell does not close
 * (`Map.prototype.set.call(held, …)` writes into a frozen `Map`). **Enumerated
 * from `util.types`**, not written out: every predicate there but the four this
 * discipline judges another way — a `Proxy` first, an Error by its prototype, a
 * function by its position. Asked of a value already admitted by its
 * prototype, so it is what catches a host object wearing a borrowed one.
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
 * Whether `value` can be called with `new`, asked without calling it:
 * `Reflect.construct` checks its third argument is a constructor before it
 * builds anything, and builds with `String`, not with `value`. A command or a
 * getter that can be constructed hands a consumer an instance whose prototype
 * is the function's own — a regular function's open `prototype`, or a bound
 * function's target's — shared by every instance.
 */
const constructible = (value: object): boolean => {
  try {
    Reflect.construct(String, [], value as () => unknown);
    return true;
  } catch {
    return false;
  }
};

/** What a prototype's own `constructor` calls itself, read without running anything. */
const nameOf = (prototype: object): string => {
  const constructor: unknown = Reflect.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  const name: unknown =
    typeof constructor === 'function'
      ? Reflect.getOwnPropertyDescriptor(constructor, 'name')?.value
      : undefined;
  return typeof name === 'string' && name !== '' ? name : 'a prototype';
};

/**
 * How an object was reached, which decides what it may hold: a `value` is a
 * snapshot or, when the arrangement names it, a live interface; a `function`
 * is a command, a getter's own function object, or a class reached as a
 * prototype's `constructor`; a `prototype` is a link of a chain, or a class's
 * own `prototype`.
 */
type Role = 'value' | 'function' | 'prototype';

/**
 * Every place under `root` where the discipline does not hold, as
 * `path: rule` — an empty list is the discipline kept.
 *
 * Reads descriptors, never data through a getter, except the getters a live
 * interface names; those are called twice each, guarded, and a throw is a
 * finding rather than the end of the walk. An object reached in two roles is
 * judged in each, so the order of a value's keys decides nothing.
 */
export function breachesOf(root: unknown, at: string, discipline: Discipline): string[] {
  const found: string[] = [];
  const seen = new Map<object, Set<Role>>();
  const first = (value: object, role: Role): boolean => {
    let roles = seen.get(value);
    if (roles === undefined) seen.set(value, (roles = new Set()));
    if (roles.has(role)) return false;
    roles.add(role);
    return true;
  };
  // The chain: every setter on it, and every link that is not the platform's
  // read as a prototype in its own right.
  const chain = (value: object, path: string): void => {
    for (
      let link = Reflect.getPrototypeOf(value);
      link !== null;
      link = Reflect.getPrototypeOf(link)
    ) {
      for (const key of Reflect.ownKeys(link)) {
        const slot = Reflect.getOwnPropertyDescriptor(link, key);
        if (slot?.set === undefined) continue;
        const refusing =
          (link === Function.prototype && RESTRICTED_SETTERS.has(slot.set)) ||
          (slot.set === PROTO_SETTER && !Reflect.isExtensible(value));
        if (!refusing) found.push(`${path}: inherits a setter, ${String(key)}`);
      }
      if (!INTRINSIC.has(link))
        visit(link, `${path} (inherited from ${nameOf(link)})`, 'prototype');
    }
  };
  const visit = (value: unknown, path: string, role: Role): void => {
    if (typeof value !== 'function' && (typeof value !== 'object' || value === null)) return;
    const named = discipline.interfaces.get(value);
    // Before the role is remembered, so a function a command also holds is
    // still a function in this snapshot.
    if (typeof value === 'function' && role === 'value' && named === undefined)
      found.push(`${path}: a function in a snapshot`);
    if (!first(value, role)) return;
    // First, and alone: every other question below runs a trap on a proxy.
    if (types.isProxy(value)) {
      found.push(`${path}: a proxy`);
      return;
    }
    const isFunction = typeof value === 'function';
    const isInterface = named !== undefined && !isFunction;
    // **In every role**: a host object wearing a borrowed prototype is one
    // whether it is held, inherited, or a function's own `prototype`.
    if (!isFunction) {
      const slotted = SLOTTED.find(([, is]) => is(value));
      if (slotted !== undefined) {
        found.push(`${path}: a host object with internal state (${slotted[0]})`);
        return;
      }
    }
    if (!isFunction && role === 'value') {
      const proto = Reflect.getPrototypeOf(value);
      const admitted = isInterface
        ? proto === Object.prototype || proto === null
        : proto === Object.prototype ||
          proto === null ||
          proto === Array.prototype ||
          (proto !== null && discipline.errors.has(proto));
      if (!admitted) {
        found.push(`${path}: a kind this discipline does not admit`);
        return;
      }
    }
    // A command, a getter's function and a function interface are called,
    // never constructed — a class reached through a prototype is the one
    // function a consumer may construct.
    if (isFunction && role !== 'prototype' && named !== undefined && constructible(value))
      found.push(`${path}: a constructible function`);
    if (Reflect.isExtensible(value)) found.push(`${path}: extensible`);
    chain(value, path);

    const keys = Reflect.ownKeys(value);
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
        const held: unknown = slot.value;
        if (isFunction && key === 'prototype') {
          // A function's own `prototype` is an object its instances inherit;
          // one that is itself a function is a second function no rule here
          // names, handed out through the first.
          if (typeof held === 'function') found.push(`${where}: a function as a prototype`);
          visit(held, where, 'prototype');
        } else if (isInterface) {
          const command = typeof key === 'string' && named.commands.includes(key);
          if (!command) found.push(`${where}: a member the interface does not name`);
          else if (typeof held !== 'function')
            found.push(`${where}: a command that is not a function`);
          else if (constructible(held)) found.push(`${where}: a constructible function`);
          visit(held, where, command ? 'function' : 'value');
        } else if (role === 'prototype' && !isFunction) {
          // **A library prototype holds its class and nothing else**: any other
          // member — a method, whose answer nothing here can read, data every
          // instance shares, even a primitive — is one more thing each instance
          // inherits that no rule names. And its `constructor` is the class
          // whose `prototype` it is, not some other function wearing the name.
          if (key !== 'constructor') found.push(`${where}: a member every instance inherits`);
          else if (
            typeof held !== 'function' ||
            Reflect.getOwnPropertyDescriptor(held, 'prototype')?.value !== value
          )
            found.push(`${where}: a constructor that is not this prototype's class`);
          // Walked either way: a class as a function, and anything else in its
          // place as the value every instance reaches it as.
          visit(held, where, typeof held === 'function' ? 'function' : 'value');
        } else {
          visit(held, where, 'value');
        }
        continue;
      }
      if (slot.set !== undefined) {
        found.push(`${where}: a setter`);
        visit(slot.set, `${where} (its setter)`, 'function');
      }
      const getter = isInterface && typeof key === 'string' && named.getters.includes(key);
      if (!getter)
        found.push(
          `${where}: ${
            isInterface
              ? 'an accessor the interface does not name'
              : role === 'prototype' && !isFunction
                ? 'a member every instance inherits'
                : 'an accessor in a snapshot'
          }`
        );
      if (slot.get === undefined) continue;
      if (getter && constructible(slot.get))
        found.push(`${where} (its getter): a constructible function`);
      visit(slot.get, `${where} (its getter)`, 'function');
      if (!getter || named.unwalked?.includes(key as string) === true) continue;
      // **Twice**: a getter that hands out a closed value on its first read and
      // an open one after is not kept to the discipline by one reading.
      for (const read of ['', ' (read again)']) {
        let output: unknown;
        try {
          output = Reflect.apply(slot.get, value, []);
        } catch {
          found.push(`${where}${read}: a getter that throws`);
          continue;
        }
        visit(output, `${where}${read}`, 'value');
      }
    }
  };
  visit(root, at, 'value');
  return found;
}
