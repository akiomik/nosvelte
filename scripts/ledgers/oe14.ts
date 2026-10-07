/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of `B5-C6`'s landing, `OE14` (event ownership): each
 * entry an edit of the library or of the arm's instruments that `OE14` must
 * fail under. Moved here from #140, where it was attached as a script, at
 * 807ea1e; the descriptions are the ones #139's table gave each entry.
 *
 * #142 publishes the tags as standard read-only arrays again, in place of
 * `ReadonlyList`, so the two entries about that mapped list are one here,
 * `C6-tags-not-arrays`, and the entries anchored on it or on code of the walk
 * #142 changed were re-anchored on that code.
 */
import type { Ledger } from '../ledger.ts';

export default {
  name: 'oe14',
  subject: '`B5-C6` (event ownership): its landing, `OE14`',
  files: ['src/tests/contracts/engine/ownership.test.ts'],
  calibration: {
    measured:
      'the median of each run in a full run at 1bcb5a9, one worker, on a shared 10-core machine',
    seconds: { OE14: 9.5 }
  },
  entries: [
    {
      id: 'C6-no-copy',
      arm: 'OE14',
      describe: "the boundary returns the wire's event",
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '  return Object.freeze(owned);\n}',
          to: '  return source as unknown as ReqEvent;\n}'
        }
      ]
    },
    {
      id: 'C6-no-freeze',
      arm: 'OE14',
      describe: 'the boundary does not freeze its copy',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '  return Object.freeze(owned);\n}',
          to: '  return owned;\n}'
        }
      ]
    },
    {
      id: 'C6-tags-not-frozen',
      arm: 'OE14',
      describe: 'the boundary does not freeze the tags',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '    tags: Object.freeze(tags.map((tag) => Object.freeze(tag))),',
          to: '    tags: tags as unknown as readonly (readonly string[])[],'
        }
      ]
    },
    {
      id: 'C6-tags-copied-shallow',
      arm: 'OE14',
      describe: "the tags are copied one level deep, sharing the wire's inner arrays",
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: 'Array.from(wire as unknown[], (tag) => (Array.isArray(tag) ? [...(tag as unknown[])] : tag))',
          to: 'Array.from(wire as unknown[])'
        }
      ]
    },
    {
      id: 'C6-no-brand',
      arm: 'OE14',
      describe: 'the brand is removed',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: 'export type OwnedEvent = ReqEvent & OwnedBrand;',
          to: 'export type OwnedEvent = ReqEvent;'
        }
      ]
    },
    {
      id: 'C6-brand-is-a-property',
      arm: 'OE14',
      describe: 'the brand is a symbol-keyed property again',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: 'declare class OwnedBrand {\n  // A type-level brand, read by nothing at run time: that is the point of it.\n  // eslint-disable-next-line no-unused-private-class-members\n  #owned: true;\n}',
          to: "declare const ownershipKey: unique symbol;\ntype OwnedBrand = { readonly [ownershipKey]: 'nosvelte' };"
        }
      ]
    },
    {
      id: 'C6-packet-not-registered',
      arm: 'OE14',
      describe: 'the packet is not registered',
      edits: [{ file: 'src/lib/v1/event.ts', from: '  OWNED_PACKETS.add(owned);\n', to: '' }]
    },
    {
      id: 'C6-no-run-time-check',
      arm: 'OE14',
      describe: "the fold's run-time check is removed",
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n",
          to: ''
        }
      ]
    },
    {
      id: 'C6-machine-wraps-the-packet',
      arm: 'OE14',
      describe: "the request machine wraps the owned packet in the wire's",
      edits: [
        {
          file: 'src/lib/v1/machine.ts',
          from: "push({ type: 'event', packet });",
          to: "push({ type: 'event', packet: { ...incoming, ...packet } });"
        }
      ]
    },
    {
      id: 'C6-packet-kept-whole',
      arm: 'OE14',
      describe: 'the packet is kept whole',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '  const owned = Object.freeze({ event: event as OwnedEvent });',
          to: '  const owned = Object.freeze({ ...packet, event: event as OwnedEvent }) as unknown as OwnedPacket;'
        }
      ]
    },
    {
      id: 'C6-packet-behind-a-prototype',
      arm: 'OE14',
      describe: "the packet sits behind a prototype that is the wire's packet",
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '  const owned = Object.freeze({ event: event as OwnedEvent });',
          to: '  const owned = Object.freeze(Object.assign(Object.create(packet) as object, { event: event as OwnedEvent })) as OwnedPacket;'
        }
      ]
    },
    {
      id: 'C6-symbol-key-alias',
      arm: 'OE14',
      describe: "a symbol key on the stored event aliases the wire's",
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '  return Object.freeze(owned);\n}',
          to: "  Object.defineProperty(owned, Symbol.for('transportEvent'), { value: source });\n  return Object.freeze(owned);\n}"
        }
      ]
    },
    {
      id: 'C6-accessor-alias',
      arm: 'OE14',
      describe: "an accessor on the stored event aliases the wire's",
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '  return Object.freeze(owned);\n}',
          to: "  Object.defineProperty(owned, 'transportEvent', { get: () => source });\n  return Object.freeze(owned);\n}"
        }
      ]
    },
    {
      id: 'C6-content-writable',
      arm: 'OE14',
      describe: '`content` is writable',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '  readonly content: string;\n  readonly created_at: number;',
          to: '  content: string;\n  readonly created_at: number;'
        }
      ]
    },
    {
      id: 'C6-tag-writable',
      arm: 'OE14',
      describe: 'each tag is writable',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '  readonly tags: readonly (readonly string[])[];\n  /** @deprecated',
          to: '  readonly tags: readonly string[][];\n  /** @deprecated'
        }
      ]
    },
    {
      id: 'C6-member-inherited-writable',
      arm: 'OE14',
      describe: 'an inherited `id` is writable',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: 'export interface ReqEvent {\n  readonly id: string;',
          to: "export interface ReqEvent extends Pick<Nostr.Event, 'id'> {"
        }
      ]
    },
    {
      id: 'C6-index-signature',
      arm: 'OE14',
      describe: 'an index signature is added',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: 'export interface ReqEvent {\n  readonly id: string;',
          to: 'export interface ReqEvent {\n  [key: string]: unknown;\n  readonly id: string;'
        }
      ]
    },
    {
      id: 'C6-symbol-member',
      arm: 'OE14',
      describe: 'a `Symbol.toStringTag` member is added',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: 'export interface ReqEvent {\n  readonly id: string;',
          to: 'export interface ReqEvent {\n  [Symbol.toStringTag]?: string;\n  readonly id: string;'
        }
      ]
    },
    {
      id: 'C6-public-alias-to-the-wire-type',
      arm: 'OE14',
      describe: "the public entry aliases `ReqEvent` to the wire's type",
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export type { ReqEvent } from './event.js';",
          to: "export type ReqEvent = import('nostr-typedef').Event;"
        }
      ]
    },
    {
      id: 'C6-handle-event-writable',
      arm: 'OE14',
      describe: "the handle's settled state hands out an event whose `content` is writable",
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: "      readonly status: 'settled';\n      readonly events: readonly ReqEvent[];",
          to: "      readonly status: 'settled';\n      readonly events: readonly (Omit<ReqEvent, 'content'> & { content: string })[];"
        }
      ]
    },
    {
      id: 'C6-fold-takes-any-packet',
      arm: 'OE14',
      describe: 'the fold takes any `{ event }`',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: 'export const foldEvent = (set: CachedEventSet, packet: OwnedPacket): CachedEventSet => {',
          to: 'export const foldEvent = (set: CachedEventSet, packet: { readonly event: ReqEvent }): CachedEventSet => {'
        }
      ]
    },
    {
      id: 'C6-registered-packet-not-frozen',
      arm: 'OE14',
      describe: 'the registered packet is not frozen',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '  const owned = Object.freeze({ event: event as OwnedEvent });',
          to: '  const owned = { event: event as OwnedEvent } as OwnedPacket;'
        }
      ]
    },
    {
      id: 'C6-tags-tuple-mutable-tail',
      arm: 'OE14',
      describe: 'the public tags are `readonly [readonly string[], ...string[][]]`',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export type { ReqEvent } from './event.js';",
          to: "export type ReqEvent = Omit<import('./event.js').ReqEvent, 'tags'> & { readonly tags: readonly [readonly string[], ...string[][]] };"
        }
      ]
    },
    {
      id: 'C6-tags-any',
      arm: 'OE14',
      describe: 'the public tags are `readonly any[]`',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export type { ReqEvent } from './event.js';",
          to: "export type ReqEvent = Omit<import('./event.js').ReqEvent, 'tags'> & { readonly tags: readonly any[] };"
        }
      ]
    },
    {
      id: 'C6-member-with-a-method',
      arm: 'OE14',
      describe: 'the event gains a `Readonly<Set<string>>` member',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: 'export interface ReqEvent {\n  readonly id: string;',
          to: 'export interface ReqEvent {\n  readonly seenOn?: Readonly<Set<string>>;\n  readonly id: string;'
        }
      ]
    },
    {
      id: 'I-any-ends-the-walk',
      arm: 'OE14',
      describe: 'the walk treats an `any` as read',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      writes.push(`${guard}${expression}.anything = ${expression};`);\n      return;',
          to: '      return;'
        }
      ]
    },
    {
      id: 'I-tuple-first-position-only',
      arm: 'OE14',
      describe: "the walk visits a tuple's first position only",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: 'for (const [at, element] of elements.entries()) {',
          to: 'for (const [at, element] of elements.slice(0, 1).entries()) {'
        }
      ]
    },
    {
      id: 'I-callable-not-reported',
      arm: 'OE14',
      describe: 'the walk does not report a callable value',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (callable(type)) writes.push(`${guard}void ${expression}.call;`);',
          to: '    if (callable(type)) void 0;'
        }
      ]
    },
    {
      id: 'C6-member-deeper-than-the-walk',
      arm: 'OE14',
      describe: 'the event gains a member whose list is five levels down',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export type { ReqEvent } from './event.js';",
          to: "export type ReqEvent = import('./event.js').ReqEvent & { readonly meta?: { readonly a: { readonly b: { readonly c: { readonly d: string[] } } } } };"
        }
      ]
    },
    {
      id: 'I-depth-passes-over',
      arm: 'OE14',
      describe: 'the walk returns at its depth limit',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (level > depth) throw new Error(`writesThrough: ${expression} is deeper than ${depth}`);',
          to: '    if (level > depth) return;'
        }
      ]
    },
    {
      id: 'I-union-passes-over',
      arm: 'OE14',
      describe: 'the walk returns on a union',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '        throw new Error(`writesThrough: ${expression} is a union of values and objects`);',
          to: '        return;'
        }
      ]
    },
    {
      id: 'I-unnamed-symbol-passes-over',
      arm: 'OE14',
      describe: 'the walk skips a symbol it cannot name',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '        throw new Error(`writesThrough: ${expression} has a symbol member the probe cannot name`);',
          to: '        return `${expression}[Symbol.iterator]`;'
        }
      ]
    },
    {
      id: 'C6-tags-leading-rest',
      arm: 'OE14',
      describe:
        "the public tags have a leading rest, `readonly [...['t', ...string[]][], readonly ['p', ...string[]]]`",
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export type { ReqEvent } from './event.js';",
          to: "export type ReqEvent = Omit<import('./event.js').ReqEvent, 'tags'> & { readonly tags: readonly [...['t', ...string[]][], readonly ['p', ...string[]]] };"
        }
      ]
    },
    {
      id: 'C6-tags-unknown',
      arm: 'OE14',
      describe: 'the public tags are `readonly unknown[]`',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export type { ReqEvent } from './event.js';",
          to: "export type ReqEvent = Omit<import('./event.js').ReqEvent, 'tags'> & { readonly tags: readonly unknown[] };"
        }
      ]
    },
    {
      id: 'C6-member-object',
      arm: 'OE14',
      describe: 'the event gains an `object` member',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export type { ReqEvent } from './event.js';",
          to: "export type ReqEvent = import('./event.js').ReqEvent & { readonly meta?: object };"
        }
      ]
    },
    {
      id: 'C6-function-alias',
      arm: 'OE14',
      describe: "a non-enumerable `toJSON` on the stored event returns the wire's",
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '  return Object.freeze(owned);\n}',
          to: "  Object.defineProperty(owned, 'toJSON', { value: () => source });\n  return Object.freeze(owned);\n}"
        }
      ]
    },
    {
      id: 'C6-provenance-is-frozenness',
      arm: 'OE14',
      describe: '`isOwnedPacket` asks whether the packet is frozen',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: 'packet !== null && OWNED_PACKETS.has(packet);',
          to: 'packet !== null && Object.isFrozen(packet);'
        }
      ]
    },
    {
      id: 'C6-provenance-is-frozenness+machine-copies',
      arm: 'OE14',
      describe: 'that, and the request machine stores a frozen copy of the packet',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: 'packet !== null && OWNED_PACKETS.has(packet);',
          to: 'packet !== null && Object.isFrozen(packet);'
        },
        {
          file: 'src/lib/v1/machine.ts',
          from: "push({ type: 'event', packet });",
          to: "push({ type: 'event', packet: Object.freeze({ ...packet }) });"
        }
      ]
    },
    {
      id: 'C6-fold-param-structural',
      arm: 'OE14',
      describe: 'the fold takes `{ readonly event: ReqEvent; readonly from?: never }`',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: 'export const foldEvent = (set: CachedEventSet, packet: OwnedPacket): CachedEventSet => {',
          to: 'export const foldEvent = (set: CachedEventSet, packet: { readonly event: ReqEvent; readonly from?: never }): CachedEventSet => {'
        }
      ]
    },
    {
      id: 'I-union-receiver-counted',
      arm: 'OE14',
      describe: 'the judge counts a refusal on a union receiver',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: "    if (type.isUnion()) return { write, verdict: 'through a union' };\n",
          to: ''
        }
      ]
    },
    {
      id: 'I-push-refusal-any-receiver',
      arm: 'OE14',
      describe: 'the judge counts TS2339 on a receiver that is no list',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '|| (push && !isReadonlyList(type))',
          to: '|| (push && false)'
        }
      ]
    },
    {
      id: 'I-unknown-passes-over',
      arm: 'OE14',
      describe: 'the walk returns on `unknown`',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (flags & ts.TypeFlags.Unknown) throw new Error(`writesThrough: ${expression} is unknown`);',
          to: '    if (flags & ts.TypeFlags.Unknown) return;'
        }
      ]
    },
    {
      id: 'I-nothing-to-enumerate-passes',
      arm: 'OE14',
      describe: 'the walk returns on an object with nothing to enumerate',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (writes.length === emitted)\n      throw new Error(`writesThrough: ${expression} has nothing the probe can enumerate`);',
          to: ''
        }
      ]
    },
    {
      id: 'I-plain-data-skips-functions',
      arm: 'OE14',
      describe: 'the plain-data check does not report a function',
      edits: [
        {
          file: 'src/tests/contracts/engine/ownership.test.ts',
          from: '      breaches.push(`${path} is a function`);\n      return;',
          to: '      return;'
        }
      ]
    },
    {
      id: 'I-any-code-refuses',
      arm: 'OE14',
      describe: 'the judge counts any code as a refusal',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '(one) => !refusedBy.has(one.code) || (push && !isReadonlyList(type))',
          to: '(one) => false || (push && !isReadonlyList(type))'
        }
      ]
    },
    {
      id: 'C6-projection-hands-out-mutable-copies',
      arm: 'OE14',
      describe: 'the projection hands out a fresh, writable copy of each event',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    events.push(packet.event);',
          to: '    events.push({ ...packet.event, tags: packet.event.tags.map((tag) => [...tag]) });'
        }
      ]
    },
    {
      id: 'C6-event-registered-shape-checked',
      arm: 'OE14',
      describe:
        '`ownPacket` registers the event, and `isOwnedPacket` accepts a frozen packet keyed `event` alone whose event is registered',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: "  typeof packet === 'object' && packet !== null && OWNED_PACKETS.has(packet);",
          to: "  typeof packet === 'object' && packet !== null && Object.isFrozen(packet)\n    && Reflect.ownKeys(packet).length === 1 && Object.hasOwn(packet, 'event')\n    && OWNED_PACKETS.has((packet as OwnedPacket).event);"
        },
        {
          file: 'src/lib/v1/event.ts',
          from: '  OWNED_PACKETS.add(owned);',
          to: '  OWNED_PACKETS.add(owned.event);'
        }
      ]
    },
    {
      id: 'C6-machine-wraps-and-no-run-time-check',
      arm: 'OE14',
      describe:
        "the request machine wraps the owned packet, and the fold's run-time check is removed",
      edits: [
        {
          file: 'src/lib/v1/machine.ts',
          from: "push({ type: 'event', packet });",
          to: "push({ type: 'event', packet: { ...incoming, ...packet } });"
        },
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n",
          to: ''
        }
      ]
    },
    {
      id: 'C6-packet-is-a-proxy',
      arm: 'OE14',
      describe: "the registered packet is a proxy whose `toJSON` returns the wire's packet",
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '  const owned = Object.freeze({ event: event as OwnedEvent });',
          to: "  const owned = new Proxy(Object.freeze({ event: event as OwnedEvent }), { get(target, key, receiver) { if (key === 'toJSON') return () => packet; return Reflect.get(target, key, receiver); } });"
        }
      ]
    },
    {
      id: 'C6-fold-throws-after-the-guard',
      arm: 'OE14',
      describe: 'the fold throws for an unrelated reason after its check',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n",
          to: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n  if (set.forward === undefined)\n    throw new TypeError('fold requires an active attempt');\n"
        }
      ]
    },
    {
      id: 'C6-guard-before-insert',
      arm: 'OE14',
      describe: "the fold's check moves below both early returns",
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n",
          to: ''
        },
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  const entries = new Map(set.entries);',
          to: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n  const entries = new Map(set.entries);"
        }
      ]
    },
    {
      id: 'C6-guard-after-ephemeral',
      arm: 'OE14',
      describe: "the fold's check moves below the ephemeral return",
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n",
          to: ''
        },
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  const key = replacementKey(packet.event);',
          to: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n  const key = replacementKey(packet.event);"
        }
      ]
    },
    {
      id: 'I-plain-data-misses-proxies',
      arm: 'OE14',
      describe: 'the plain-data check does not report a proxy',
      edits: [
        {
          file: 'src/tests/contracts/engine/ownership.test.ts',
          from: '      types.isProxy(value)',
          to: '      types.isProxy(value) &&\n      false'
        }
      ]
    },
    {
      id: 'C6-replacement-stores-a-copy',
      arm: 'OE14',
      describe: 'on a replacement, the fold stores a copy of the newcomer',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  entries.set(key, packet);',
          to: '  entries.set(key, current ? { ...packet } : packet);'
        }
      ]
    },
    {
      id: 'C6-replacement-keeps-the-incumbent',
      arm: 'OE14',
      describe: 'on a replacement, the fold stores a copy of the incumbent',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  entries.set(key, packet);',
          to: '  entries.set(key, current ? { ...current } : packet);'
        }
      ]
    },
    {
      id: 'C6-stale-version-shortcut',
      arm: 'OE14',
      describe: 'the fold returns early, before its check, for a version older than the incumbent',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n",
          to: "  const incumbent = set.entries.get(replacementKey(packet.event));\n  if (incumbent && incumbent.event.created_at > packet.event.created_at) return set;\n  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n"
        }
      ]
    },
    {
      id: 'C6-tie-shortcut',
      arm: 'OE14',
      describe: 'the fold returns early, before its check, for a version as old with a larger id',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n",
          to: "  const incumbent = set.entries.get(replacementKey(packet.event));\n  if (incumbent && incumbent.event.created_at === packet.event.created_at && incumbent.event.id < packet.event.id) return set;\n  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n"
        }
      ]
    },
    {
      id: 'C6-addressable-shortcut',
      arm: 'OE14',
      describe:
        'the fold returns early, before its check, for an addressable event it already holds',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n",
          to: "  if (classifyKind(packet.event.kind) === 'addressable' && set.entries.has(replacementKey(packet.event))) return set;\n  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n"
        }
      ]
    },
    {
      id: 'C6-replacement-copies-survivors',
      arm: 'OE14',
      describe: 'on a replacement, the fold copies every packet the set already held',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  const entries = new Map(set.entries);',
          to: '  const entries = new Map([...set.entries].map(([k, v]) => [k, current ? { ...v } : v]));'
        }
      ]
    },
    {
      id: 'C6-addressable-without-identifier-shortcut',
      arm: 'OE14',
      describe:
        'the fold returns early, before its check, for an addressable event with no `d` tag',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n",
          to: "  if (classifyKind(packet.event.kind) === 'addressable' && identifierOf(packet.event) === '') return set;\n  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n"
        }
      ]
    },
    {
      id: 'C6-unlisted-shortcut',
      arm: 'OE14',
      describe:
        'the fold returns early, before its check, for an event with more than five tags, a path no arrangement lists',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n",
          to: "  if (packet.event.tags.length > 5) return set;\n  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n"
        }
      ]
    },
    {
      id: 'C6-incumbent-wins-copies-bystanders-in-place',
      arm: 'OE14',
      describe:
        'when the incumbent wins, the fold copies every other packet the set holds, in place',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    if (winner === current.event) return set;',
          to: '    if (winner === current.event) {\n      for (const [heldKey, held] of set.entries) {\n        if (heldKey !== key) (set.entries as Map<string, OwnedPacket>).set(heldKey, { ...held });\n      }\n      return set;\n    }'
        }
      ]
    },
    {
      id: 'C6-isextensible-before-check',
      arm: 'OE14',
      describe: 'the fold asks whether the packet is extensible before its check',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n",
          to: "  void Object.isExtensible(packet);\n  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n"
        }
      ]
    },
    {
      id: 'C6-array-carrier-shortcut',
      arm: 'OE14',
      describe: 'the fold returns early, before its check, for a packet that is an array',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n",
          to: "  if (Array.isArray(packet)) return set;\n  if (!isOwnedPacket(packet))\n    throw new TypeError('foldEvent was handed a packet this library did not make');\n"
        }
      ]
    },
    {
      id: 'I-order-check-ignores-first-statement',
      arm: 'OE14',
      describe: 'the order check does not read the first statement',
      edits: [
        {
          file: 'src/tests/contracts/engine/ownership.test.ts',
          from: '    if (!isTheCheck)\n      breaches.push(',
          to: '    if (false)\n      breaches.push('
        }
      ]
    },
    {
      id: 'I-order-check-ignores-defaults',
      arm: 'OE14',
      describe: 'the order check does not read parameter defaults',
      edits: [
        {
          file: 'src/tests/contracts/engine/ownership.test.ts',
          from: '      if (parameter.initializer !== undefined)\n',
          to: '      if (false)\n'
        }
      ]
    },
    {
      id: 'I-order-check-ignores-redeclaration',
      arm: 'OE14',
      describe: 'the order check does not look for a redeclared `isOwnedPacket`',
      edits: [
        {
          file: 'src/tests/contracts/engine/ownership.test.ts',
          from: '  if (redeclared > 0) breaches.push(',
          to: '  if (false) breaches.push('
        }
      ]
    },
    {
      id: 'C6-tags-not-arrays',
      arm: 'OE14',
      describe: 'the tags are published as a mapped read-only list, which is not an array',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '  readonly tags: readonly (readonly string[])[];',
          to: '  readonly tags: { readonly [K in keyof ReadonlyArray<{ readonly [J in keyof ReadonlyArray<string>]: ReadonlyArray<string>[J] }>]: ReadonlyArray<{ readonly [J in keyof ReadonlyArray<string>]: ReadonlyArray<string>[J] }>[K] };'
        }
      ]
    },
    {
      id: 'C6-global-augmentation',
      arm: 'OE14',
      describe: 'the library adds `fill` to `ReadonlyArray` with `declare global`',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: 'export interface ReqEvent {\n',
          to: 'declare global {\n  interface ReadonlyArray<T> {\n    fill(value: T): this;\n  }\n}\nexport interface ReqEvent {\n'
        }
      ]
    },
    {
      id: 'C6-fold-is-a-function-declaration',
      arm: 'OE14',
      describe: '`foldEvent` is a function declaration again',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: 'export const foldEvent = (set: CachedEventSet, packet: OwnedPacket): CachedEventSet => {',
          to: 'export function foldEvent(set: CachedEventSet, packet: OwnedPacket): CachedEventSet {'
        }
      ]
    },
    {
      id: 'C6-isownedpacket-is-a-function-declaration',
      arm: 'OE14',
      describe: '`isOwnedPacket` is a function declaration again',
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: 'export const isOwnedPacket = (packet: unknown): packet is OwnedPacket =>\n',
          to: 'export function isOwnedPacket(packet: unknown): packet is OwnedPacket {\n  return '
        },
        {
          file: 'src/lib/v1/event.ts',
          from: 'OWNED_PACKETS.has(packet);\n',
          to: 'OWNED_PACKETS.has(packet);\n}\n'
        }
      ]
    },
    {
      id: 'C6-input-flag-written-in-place',
      arm: 'OE14',
      describe: 'when the incumbent wins, the fold sets the omission flag on the set it was handed',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    if (winner === current.event) return set;',
          to: '    if (winner === current.event) {\n      (set as { ephemeralOmitted?: boolean }).ephemeralOmitted = true;\n      return set;\n    }'
        }
      ]
    },
    {
      id: 'I-snapshot-ignores-fields',
      arm: 'OE14',
      describe: "the path control does not compare the value of each of the input's own fields",
      edits: [
        {
          file: 'src/tests/contracts/engine/ownership.test.ts',
          from: "          held.fields.every(([key, was]) => {\n            const is = now.fields.find(([one]) => one === key)?.[1];\n            return (\n              is !== undefined &&\n              was !== undefined &&\n              'value' in is &&\n              'value' in was &&\n              is.value === was.value\n            );\n          }) &&\n",
          to: ''
        }
      ]
    },
    {
      id: 'I-admission-ignores-lib',
      arm: 'OE14',
      describe: 'the walk admits a member wherever it is declared',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      declarations.every((one) => program.isSourceFileDefaultLibrary(one.getSourceFile()))\n',
          to: '      true\n'
        }
      ]
    },
    {
      id: 'I-admission-ignores-interface',
      arm: 'OE14',
      describe: "the walk admits every standard-library member, `Array`'s included",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: 'STANDARD_READ_ONLY.has(one.parent.name.text)',
          to: 'true'
        }
      ]
    },
    {
      id: 'I-snapshot-ignores-prototype',
      arm: 'OE14',
      describe: "the path control does not compare the input's prototype",
      edits: [
        {
          file: 'src/tests/contracts/engine/ownership.test.ts',
          from: '          now.prototype === held.prototype &&\n',
          to: ''
        }
      ]
    },
    {
      id: 'I-snapshot-ignores-added-keys',
      arm: 'OE14',
      describe: "the path control does not count the input's own keys",
      edits: [
        {
          file: 'src/tests/contracts/engine/ownership.test.ts',
          from: '          now.fields.length === held.fields.length &&\n',
          to: ''
        }
      ]
    },
    {
      id: 'I-order-check-reads-first-declarator',
      arm: 'OE14',
      describe: "the order check reads the first declarator of a `const` statement, not the fold's",
      edits: [
        {
          file: 'src/tests/contracts/engine/ownership.test.ts',
          from: '    const initializer = statement.declarationList.declarations.find(\n      (one) => ts.isIdentifier(one.name) && one.name.text === name\n    )?.initializer;',
          to: '    const initializer = statement.declarationList.declarations[0]?.initializer;'
        }
      ]
    },
    {
      id: 'C6-input-prototype-replaced',
      arm: 'OE14',
      describe: 'when the incumbent wins, the fold replaces the prototype of the set it was handed',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    if (winner === current.event) return set;',
          to: '    if (winner === current.event) {\n      Object.setPrototypeOf(set, { ephemeralOmitted: true });\n      return set;\n    }'
        }
      ]
    }
  ]
} satisfies Ledger;
