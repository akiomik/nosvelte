/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The event this library owns, and the moment it starts owning it.
 *
 * **What a hook publishes used to be the dependency's object.** `ReqState.events`
 * is typed `readonly Nostr.Event[]`, and `readonly` covers the array: the
 * elements are `Nostr.Event`, whose every field is mutable and whose `tags` is
 * `Tag.Any[]`. So `state.events[0].content = '…'` and `tags.push(…)` type-check
 * with no cast, reach **the object in the shared cache**, are visible to every
 * other hook on the same key, and survive `refresh()` — measured end to end
 * through `useStreamedReq`. The library had already stated this hazard for the
 * *input* direction and closed it (see `normalize.ts`: "a `readonly` type does
 * not stop the caller from holding the same objects and mutating them"); the
 * output direction had no snapshot and no record either way.
 *
 * **The snapshot is taken before verification, not after**, and that is a
 * second defect rather than an implementation detail: the verifier was handed
 * the wire's object and the *same* object was pushed later, so an event mutated
 * while verification was in flight made "what was verified" and "what was
 * stored" two different values. Owning it first closes that window and makes
 * the verifier's subject and the cache's entry the same frozen object.
 *
 * **Copied field by field rather than with `structuredClone`.** What is copied
 * is then a decision this file records rather than whatever the host clones:
 * the seven fields NIP-01 gives an event, plus `ots` when it is present —
 * deprecated in `nostr-typedef`, still on the wire, and a field a consumer can
 * render, so dropping it would silently change what they see.
 *
 * **The freeze is how the runtime keeps the promise the type makes.** The
 * contract is not "mutating throws" — that is one host's way of refusing —
 * but that a change to a published event reaches neither the cache, nor
 * another hook, nor a later projection.
 */
import type * as Nostr from 'nostr-typedef';
import type { EventPacket } from 'rx-nostr';

/**
 * An event as this library publishes it: immutable to the depth a consumer can
 * reach, and **written out rather than derived from the dependency's type**.
 *
 * `Readonly<Omit<Nostr.Event, 'tags'>>` was the first form, and it published
 * whatever `nostr-typedef` adds next: a field appearing upstream would appear
 * here, while {@link ownEvent} went on copying the eight it knows — so the
 * declaration and what a consumer actually receives would drift apart with no
 * change in this repository. The fields are NIP-01's, and `ots` is deprecated
 * upstream and still on the wire.
 */
export interface ReqEvent {
  readonly id: string;
  readonly sig: string;
  readonly kind: number;
  readonly pubkey: string;
  readonly content: string;
  readonly created_at: number;
  readonly tags: readonly (readonly string[])[];
  /** @deprecated by NIP-03; carried when the wire had one. */
  readonly ots?: string;
}

/**
 * The scalar half of the shape NIP-01 gives an event, at the depth the copy
 * touches.
 *
 * **The wire is not the type.** `rx-nostr` packets `message[2]` without
 * checking its shape, so `["EVENT","id",{"id":7}]` arrives typed `Nostr.Event`
 * and is none of it — and this boundary runs *before* the verifier, so what a
 * field is has to be asked here or not at all. The signature is still the
 * verifier's business; what is checked is only what the copy has to touch.
 */
function isWireScalars(
  value: unknown
): value is Omit<Nostr.Event, 'tags'> & { readonly ots?: string } {
  // **Unreachable from `ownEvent`, and kept for this function's own contract.**
  // The only caller hands it a snapshot object built three lines earlier, so no
  // primitive and no `null` arrives here any more — `ownEvent` makes that check
  // itself, on the caller's value, before it reads anything. It was measured as
  // redundant even then (with the line gone, a string was refused two lines
  // later because `'EVENT?'['id']` is `undefined`), and the first clause of a
  // shape check should still be the shape.
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  if (typeof event['id'] !== 'string') return false;
  if (typeof event['sig'] !== 'string') return false;
  if (typeof event['pubkey'] !== 'string') return false;
  if (typeof event['content'] !== 'string') return false;
  if (typeof event['kind'] !== 'number' || !Number.isFinite(event['kind'])) return false;
  if (typeof event['created_at'] !== 'number' || !Number.isFinite(event['created_at']))
    return false;
  if (event['ots'] !== undefined && typeof event['ots'] !== 'string') return false;
  return true;
}

/**
 * The tag half of the shape, split out so that it can run **after** the
 * scalars, and the half the wire actually attacks: `["EVENT","id",{"id":"x",
 * "tags":null}]` is typed `Nostr.Event` and threw `tags.map is not a function`
 * out of a subscription callback where nothing catches it (`OW8`).
 *
 * **Why the split is here rather than inline.** The copy has to be taken before
 * the check — that is what makes the checked value and the kept value the same
 * one — and a tag list is the only part of an event whose size a relay
 * chooses. Materialising it for a candidate whose `id` is already not a string
 * is work an attacker picks the size of, on a packet that was never going to be
 * kept. So the scalars are checked on the snapshot first, and this runs on the
 * materialised list after them.
 */
function isWireTags(value: unknown): value is readonly (readonly string[])[] {
  if (!Array.isArray(value)) return false;
  for (const tag of value as unknown[]) {
    if (!Array.isArray(tag)) return false;
    for (const item of tag) if (typeof item !== 'string') return false;
  }
  return true;
}

/**
 * This library's own copy of an event off the wire, frozen — or nothing.
 *
 * Called once per event, at the boundary where it arrives, before the verifier
 * sees it. **`undefined` means the candidate never was an event**: it is not
 * verified, not stored, not delivered, and not thrown either. A relay that
 * sends a malformed EVENT loses that event and nothing else — its EOSE and its
 * CLOSED are read as usual and the request still reaches an outcome.
 */
export function ownEvent(value: unknown): ReqEvent | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const source = value as Record<string, unknown>;

  // **Read once, then check what was read.** This used to check `value` and
  // then copy `value` — every field read twice, the tag list walked twice —
  // which is the defect `B4-C7` names at the descriptor boundary, standing
  // here at the event boundary. The wire's own events are `JSON.parse` output
  // and cannot do anything between the two reads; that is an argument about
  // *this* producer, not about the boundary, and the boundary is what a port
  // reimplements. The tags are materialised before they are walked for the
  // same reason: a list that answers `[['t','ok']]` to the check and
  // `[['t',null]]` to the copy would put a `null` inside a frozen `ReqEvent`.
  //
  // **What it costs, since this runs once per event off every relay.** One
  // object of seven fields per *candidate*, malformed ones included, and one
  // list for the tags of a candidate whose scalars are already right. It is not
  // two copies of each tag: the snapshot's tags are this library's own arrays,
  // so the freeze below is applied to them in place rather than to copies of
  // them — the same number of arrays allocated per kept event as before this
  // repair, plus the two.
  //
  // **And the order is part of the price.** The scalars are checked before the
  // tags are materialised, because a tag list is the one part of an event whose
  // size a relay chooses: copying it for a candidate whose `id` is not even a
  // string would be work an attacker picks the size of, on a packet that was
  // never going to be kept.
  const snapshot = {
    id: source['id'],
    sig: source['sig'],
    kind: source['kind'],
    pubkey: source['pubkey'],
    content: source['content'],
    created_at: source['created_at'],
    ots: source['ots']
  };
  if (!isWireScalars(snapshot)) return undefined;

  const wire = source['tags'];
  const tags = Array.isArray(wire)
    ? Array.from(wire as unknown[], (tag) => (Array.isArray(tag) ? [...(tag as unknown[])] : tag))
    : wire;
  if (!isWireTags(tags)) return undefined;
  const owned: ReqEvent = {
    id: snapshot.id,
    sig: snapshot.sig,
    kind: snapshot.kind,
    pubkey: snapshot.pubkey,
    content: snapshot.content,
    created_at: snapshot.created_at,
    // Frozen in place, not copied again: these arrays were built above and
    // nothing else has a reference to them. `OW4` is the arm that says the
    // wire's own lists are not what is being frozen here.
    tags: Object.freeze(tags.map((tag) => Object.freeze(tag))),
    // Only when the wire carried one: `exactOptionalPropertyTypes` makes
    // `ots: undefined` a different value from an absent `ots`, and a consumer
    // rendering `'ots' in event` would see one where there was none.
    ...(snapshot.ots === undefined ? {} : { ots: snapshot.ots })
  };
  return Object.freeze(owned);
}

/**
 * The brand that makes ownership a fact about the type rather than a habit.
 *
 * `Omit<EventPacket, 'event'> & { readonly event: ReqEvent }` was the first
 * form and it proved nothing: TypeScript assigns a mutable value to a readonly
 * field, so `const owned: OwnedPacket = wirePacket` compiled and the records'
 * "the types carry it" was false. A brand no other module can produce is what
 * closes it, and the cast that makes one lives in {@link ownPacket} alone.
 *
 * **The brand is on the event, not on the packet around it.** Branding the
 * packet left its payload open to replacement: `{ ...owned, ...wirePacket }`
 * kept the packet's brand, swapped in the wire's event, and type-checked as an
 * `OwnedPacket` with no cast — and folded, the cache held the transport's
 * object. A brand on the event goes wherever the event goes, so replacing the
 * event replaces the brand too.
 */
declare const ownership: unique symbol;

/** An event this library copied and froze: the only kind the cache stores. */
export type OwnedEvent = ReqEvent & { readonly [ownership]: 'nosvelte' };

/**
 * What the cache stores: an event this library owns, and nothing else.
 *
 * **The dependency's packet is not carried through.** It kept `message`, whose
 * `[2]` is the transport's own event object — so a cache entry held a reachable
 * alias to the value the copy exists to escape, and one internal change that
 * read `message` would have crossed the boundary again. What the fold and the
 * projections read is `event`; that is the whole type.
 */
export interface OwnedPacket {
  readonly event: OwnedEvent;
}

/** The wire's packet, reduced to this library's copy of the event — or nothing. */
export function ownPacket(packet: EventPacket): OwnedPacket | undefined {
  const event = ownEvent(packet.event);
  if (event === undefined) return undefined;
  // The one cast in the module, and the reason the brand is worth having: it is
  // here, in the factory, rather than at every call site.
  return Object.freeze({ event: event as OwnedEvent });
}
