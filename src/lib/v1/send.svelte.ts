/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Sending an event through the provider, without handing anyone the connection.
 *
 * Ruling 17 (`0004`). Today's surface publishes `app`, the store holding the
 * transport itself, and that is the only way a consumer posts. `C6` takes the
 * transport away from consumers and keeps it that way: no published name
 * returns the connection, in either direction (`C6-C11`). What replaces `app` is
 * an *operation* bound to the provider — this module — so posting survives the
 * ownership move without the connection leaking back out through it.
 *
 * Three decisions shape it, each the maintainer's:
 *
 * - **Signing.** An already-signed event goes out as it is; an unsigned
 *   template is signed by the provider's `signer`, and is refused when there is
 *   none. The dependency never signs: it is handed a signer that returns the
 *   event this module already holds, so what goes on the wire is exactly what
 *   was checked here.
 * - **Targets.** By default every relay in the provider's scope that is
 *   writable. An explicit list is allowed and must be a subset of those; a relay
 *   outside the scope is refused rather than connected to, because a connection
 *   the provider does not own is one its diagnostics cannot see and its teardown
 *   cannot close.
 * - **Reads are untouched.** A sent event is not inserted into any request's
 *   answer. It appears there when a subscription receives it from a relay, the
 *   way any other event does, so a send owes nothing to cache identity, refresh
 *   or retry.
 *
 * The answer is a value, never a throw: either nothing went out (`refused`, with
 * a code) or something did (`settled`, with one outcome per target relay). That
 * is the read side's rule — a closed structural union rather than classes a
 * duplicate install would split — applied to an operation.
 */

import type Nostr from 'nostr-typedef';

import type { NostrContext } from './context.svelte.js';
import { getNostrContext } from './context.svelte.js';
import type { ReqEvent } from './event.js';
import type { RelayMessage } from './normalize.js';
import { relayMessage } from './normalize.js';
import { resolveRelayName, TransportIncompatibleError, unnameableRelay } from './scope.svelte.js';

/**
 * What the provider signs with. Structurally the `signEvent` half of NIP-07, so
 * `window.nostr` is one; nothing else of the signer is read.
 */
export interface NostrSigner {
  signEvent(template: {
    readonly kind: number;
    readonly content: string;
    readonly tags: string[][];
    readonly created_at: number;
  }): Promise<ReqEvent>;
}

/** An event to be signed by the provider's signer. `created_at` defaults to now. */
export interface EventTemplate {
  readonly kind: number;
  readonly content: string;
  readonly tags?: readonly (readonly string[])[];
  readonly created_at?: number;
}

/**
 * Either a template, or an event that is already signed. An input carrying any
 * of `id`, `pubkey` or `sig` is read as signed and must carry all three.
 *
 * **`ReqEvent`, this library's own event type, rather than the dependency's** —
 * the rule `SUR12` holds for everything the surface hands out, kept for what it
 * takes in too. Any signed event is assignable to it, including one a request
 * just answered with, so re-sending what was read needs no conversion.
 */
export type SendInput = EventTemplate | ReqEvent;

export interface SendOptions {
  /** A subset of the scope's writable relays. Omitted: all of them. */
  readonly relays?: readonly string[];
}

/** Why nothing went out. */
export type SendRefusalCode =
  /** The input is neither a well-formed template nor a well-formed, verifying signed event. */
  | 'invalid-event'
  /** A template was given and the provider has no signer. */
  | 'no-signer'
  /** The signer threw, or returned an event that does not verify or is not the template. */
  | 'signer-failed'
  /** The scope has no writable relay, or an explicit list was empty. */
  | 'no-writable-relay'
  /**
   * An explicit relay is not one of the scope's writable relays: not relay
   * input, renamed a second time by the transport, outside the scope, or in it
   * and not writable.
   */
  | 'relay-outside-scope'
  /**
   * The transport could not name an explicit relay: it threw, answered
   * something that is not one relay URL, or contradicted an answer it had
   * given before. No relay list changes it; pin or upgrade rx-nostr or this
   * library, or report what it said.
   */
  | 'transport-incompatible'
  /** The provider is rendering on the server, where there is no connection. */
  | 'not-in-browser'
  /** The provider was destroyed before anything went out. */
  | 'provider-disposed';

/** What one target relay did with the event. */
export type SendRelayOutcome =
  | { readonly relay: string; readonly outcome: 'accepted'; readonly message: RelayMessage }
  | { readonly relay: string; readonly outcome: 'rejected'; readonly message: RelayMessage }
  /** No `OK` within the library's wait. */
  | { readonly relay: string; readonly outcome: 'no-response' }
  /** The provider was destroyed before this relay answered. */
  | { readonly relay: string; readonly outcome: 'aborted' };

export type SendResult =
  | { readonly status: 'refused'; readonly code: SendRefusalCode; readonly message: string }
  | {
      readonly status: 'settled';
      /** The event that went out, as this library's own frozen copy. */
      readonly event: ReqEvent;
      /** One per target relay, in the order the targets were resolved. */
      readonly relays: readonly SendRelayOutcome[];
    };

export type Send = (input: SendInput, options?: SendOptions) => Promise<SendResult>;

/**
 * The provider's send operation.
 *
 * Called where a hook may be called; the provider is captured here, so the
 * returned function can be called later from an event handler. With no provider
 * above it this throws `MissingProviderError`, as `useRelayDiagnostics` does —
 * it is a wiring error, not an outcome of a send.
 */
export function useSend(): Send {
  const context = getNostrContext();
  // **The fields a send reads, and nothing else of the provider.** Each is a
  // getter, so a send reads the provider as it stands when it is made — the
  // scope after a relay change, the lease after a teardown — and passing this
  // rather than the context keeps every read on a named field, which is how
  // `PROV1` knows what this module reaches.
  const port: SendPort = {
    get environment() {
      return context.environment;
    },
    get transportLease() {
      return context.transportLease;
    },
    get scope() {
      return context.scope;
    },
    get signer() {
      return context.signer;
    },
    verifyEvent: (event) => context.verifyEvent(event)
  };
  // Frozen: the function is what a consumer holds, and one it could hang a
  // member on would be one every other holder of it read (`B5-C8`).
  return Object.freeze((input: SendInput, options?: SendOptions) =>
    sendThrough(port, input, options)
  );
}

/** What a send reads off its provider. A provider's context is one. */
export type SendPort = Pick<
  NostrContext,
  'environment' | 'transportLease' | 'scope' | 'signer' | 'verifyEvent'
>;

const refused = (code: SendRefusalCode, message: string): SendResult =>
  Object.freeze({ status: 'refused', code, message: `nosvelte: ${message}` });

const isInteger = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const isTags = (value: unknown): value is readonly (readonly string[])[] =>
  Array.isArray(value) &&
  value.every((tag) => Array.isArray(tag) && tag.every((item) => typeof item === 'string'));

/** An input read field by field, before anything about its shape is known. */
interface Loose {
  readonly id?: unknown;
  readonly pubkey?: unknown;
  readonly sig?: unknown;
  readonly kind?: unknown;
  readonly content?: unknown;
  readonly tags?: unknown;
  readonly created_at?: unknown;
}

const MAX_KIND = 65_535;
const MAX_SECONDS = Number.MAX_SAFE_INTEGER;

/**
 * Every field read **once**, into plain values, with the tag arrays copied as
 * they are read: what is checked afterwards is what is kept and sent. An input
 * whose getter answers one thing to the check and another to the copy has
 * nothing to answer to after this. A read that throws is the caller's to catch,
 * and both callers turn it into a refusal.
 */
function snapshot(value: object): Loose {
  const held = value as Loose;
  const tags = held.tags;
  return {
    id: held.id,
    pubkey: held.pubkey,
    sig: held.sig,
    kind: held.kind,
    content: held.content,
    created_at: held.created_at,
    tags: Array.isArray(tags) ? copyTags(tags) : tags
  };
}

/**
 * A caller's array as **this realm's plain array**, element by element, by
 * `length` and index alone. `map`, spread and `slice` all consult the caller:
 * `map` builds through the receiver's species, so an `Array` subclass came back
 * an instance of itself — with its `every`, its `toJSON` — and spread runs the
 * caller's iterator. A reviewer sent a subclass whose `toJSON` rewrote the tags
 * while the fidelity check serialised them, and a correctly signed rewrite went
 * out.
 *
 * **What still runs is reads, and every one is inside the caller's guard**:
 * getters, and a Proxy's traps. `length` is read once and must be a safe
 * non-negative integer, so it is not coerced again on every step; and an index
 * that is absent ends the copy, since a hole is not a tag and would be refused
 * anyway. **For an ordinary array** that stops at the first hole, so a
 * `length` of `2 ** 32 - 1` over an almost empty array costs what was stored
 * rather than four billion `undefined`s. **A Proxy is different**: it answers
 * `length`, presence and every value itself, so a target with nothing in it
 * can still present any number of tags — each copied correctly into owned
 * data. No bound on CPU or allocation is claimed for such a list, and none is
 * published for the number or size of tags.
 */
function plain(list: readonly unknown[]): unknown[] | typeof NOT_A_LIST {
  const length: unknown = list.length;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    return NOT_A_LIST;
  }
  const copy: unknown[] = [];
  for (let at = 0; at < length; at += 1) {
    if (!(at in list)) return NOT_A_LIST;
    copy.push(list[at]);
  }
  return copy;
}

/**
 * What a list that could not be copied becomes: a value no check accepts as
 * tags or as a tag, and not `undefined` — a template's absent tags mean none,
 * and a list with a hole must not be read as no tags at all. A value rather
 * than a thrown error, because nothing here constructs one.
 */
const NOT_A_LIST = 'not a list' as const;

/** The outer list and each inner one, each by {@link plain}. */
function copyTags(tags: readonly unknown[]): unknown {
  const outer = plain(tags);
  return outer === NOT_A_LIST
    ? NOT_A_LIST
    : outer.map((tag) => (Array.isArray(tag) ? plain(tag as readonly unknown[]) : tag));
}

/** A checked snapshot, frozen to every level. */
function ownCopy(event: Nostr.Event): Nostr.Event {
  return Object.freeze({
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: Object.freeze(event.tags.map((tag) => Object.freeze(tag))) as unknown as string[][],
    content: event.content,
    sig: event.sig
  });
}

function isSignedShape(input: Loose): input is Loose & Nostr.Event {
  return (
    typeof input.id === 'string' &&
    typeof input.pubkey === 'string' &&
    typeof input.sig === 'string' &&
    isInteger(input.kind, 0, MAX_KIND) &&
    typeof input.content === 'string' &&
    isTags(input.tags) &&
    isInteger(input.created_at, 0, MAX_SECONDS)
  );
}

/**
 * Element by element, over this library's own plain arrays of strings. No
 * serialisation: a fidelity check that called anything a caller could have
 * supplied would be asking the caller whether it was faithful.
 */
const sameTags = (
  a: readonly (readonly string[])[],
  b: readonly (readonly string[])[]
): boolean => {
  if (a.length !== b.length) return false;
  for (let at = 0; at < a.length; at += 1) {
    const left = a[at] as readonly string[];
    const right = b[at] as readonly string[];
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return false;
    }
  }
  return true;
};

/** Whether a signed event is the template it was asked for, field by field. */
const isTheTemplate = (
  event: Nostr.Event,
  basis: {
    readonly kind: number;
    readonly content: string;
    readonly tags: readonly (readonly string[])[];
    readonly created_at: number;
  }
): boolean =>
  event.kind === basis.kind &&
  event.content === basis.content &&
  event.created_at === basis.created_at &&
  sameTags(event.tags, basis.tags);

/**
 * The targets, resolved against the scope as it stands at the call. A send does
 * not follow a later change to the relay list: what it was sent to is decided
 * here, once.
 */
function targetsOf(
  port: SendPort,
  requested: readonly unknown[] | 'not-a-list' | undefined
): readonly string[] | SendResult {
  const writable = port.scope.relays.filter((relay) => relay.write).map((relay) => relay.url);
  if (requested === undefined) {
    return writable.length > 0
      ? writable
      : refused('no-writable-relay', 'the provider has no writable relay to send to.');
  }
  if (requested === 'not-a-list') {
    return refused('relay-outside-scope', '`relays` must be an array of relay URLs.');
  }
  // **Named as a request's relays are** (B-α-C15): by the scope's transport,
  // through the generation's table, matched against every relay and then
  // checked for writing. This library's canonicalisation is not consulted, so a
  // send is not refused for a spelling the transport accepts, nor routed by one
  // it does not. A transport that cannot name the string is its own refusal.
  const chosen: string[] = [];
  for (const each of requested) {
    let url: string | undefined;
    try {
      const resolution = typeof each === 'string' ? resolveRelayName(port.scope, each) : undefined;
      url = resolution?.relay?.write === true ? resolution.name : undefined;
    } catch (thrown) {
      if (thrown instanceof TransportIncompatibleError) {
        return refused(
          'transport-incompatible',
          `this send names ${unnameableRelay(each as string, thrown)}`
        );
      }
      url = undefined;
    }
    if (url === undefined || !writable.includes(url)) {
      return refused(
        'relay-outside-scope',
        `${typeof each === 'string' ? JSON.stringify(each) : `a ${typeof each}`} is not one of ` +
          "the provider's writable relays; a send goes only to relays the provider already " +
          'holds a connection for.'
      );
    }
    if (!chosen.includes(url)) chosen.push(url);
  }
  return chosen.length > 0
    ? chosen
    : refused('no-writable-relay', 'the explicit relay list is empty.');
}

/** The input as an event this library will send, or why it will not. */
async function signedEventOf(port: SendPort, input: SendInput): Promise<Nostr.Event | SendResult> {
  if (typeof input !== 'object' || input === null) {
    return refused('invalid-event', 'the input is not an event or an event template.');
  }
  let held: Loose;
  try {
    held = snapshot(input);
  } catch {
    return refused('invalid-event', 'reading the input threw.');
  }
  const claimsSigned = held.id !== undefined || held.pubkey !== undefined || held.sig !== undefined;

  if (claimsSigned) {
    if (!isSignedShape(held)) {
      return refused(
        'invalid-event',
        'a signed event needs a string id, pubkey and sig and well-formed fields.'
      );
    }
    const copy = ownCopy(held);
    return (await port.verifyEvent(copy))
      ? copy
      : refused('invalid-event', "the event's signature does not verify.");
  }

  const createdAt = held.created_at ?? Math.floor(Date.now() / 1000);
  const tags = held.tags ?? [];
  if (
    !isInteger(held.kind, 0, MAX_KIND) ||
    typeof held.content !== 'string' ||
    !isTags(tags) ||
    !isInteger(createdAt, 0, MAX_SECONDS)
  ) {
    return refused(
      'invalid-event',
      'an event template needs an integer kind, string content and string tags.'
    );
  }

  const signer = port.signer;
  if (signer === undefined) {
    return refused('no-signer', 'this event is unsigned and the provider was given no `signer`.');
  }
  // **Two copies, and the signer gets the one that is not compared.** The
  // basis of the fidelity check is frozen and never leaves this function; the
  // signer is handed a fresh copy it may do anything to. Handing it the basis
  // let a signer rewrite a tag in place, sign the rewritten event correctly,
  // and be compared against its own edit — a reviewer measured it going out.
  const expected = Object.freeze({
    kind: held.kind,
    content: held.content,
    tags: Object.freeze(tags.map((tag) => Object.freeze([...tag]))),
    created_at: createdAt
  });
  const handed = {
    kind: expected.kind,
    content: expected.content,
    tags: expected.tags.map((tag) => [...tag]),
    created_at: expected.created_at
  };
  let returned: Loose;
  try {
    const signed: unknown = await signer.signEvent(handed);
    if (typeof signed !== 'object' || signed === null) {
      return refused('signer-failed', 'the signer did not return a signed event.');
    }
    returned = snapshot(signed);
  } catch {
    return refused('signer-failed', 'the signer threw, or reading what it returned did.');
  }
  if (!isSignedShape(returned)) {
    return refused('signer-failed', 'the signer did not return a signed event.');
  }
  const copy = ownCopy(returned);
  if (!isTheTemplate(copy, expected)) {
    return refused(
      'signer-failed',
      'the signer returned a different event from the one it was asked to sign.'
    );
  }
  return (await port.verifyEvent(copy))
    ? copy
    : refused('signer-failed', "the signer's event does not verify.");
}

/** Exported for the arms, which drive it without mounting a component. */
export async function sendThrough(
  port: SendPort,
  input: SendInput,
  options?: SendOptions
): Promise<SendResult> {
  const lease = port.transportLease;
  if (port.environment === 'server' || lease === undefined) {
    return refused('not-in-browser', 'there is no relay connection while rendering on the server.');
  }
  if (lease.revoked) {
    return refused('provider-disposed', 'the provider that owned this send has been destroyed.');
  }
  // **The caller's options are read once, inside the boundary, into a list this
  // library owns** — the property and the array's iteration both — and that
  // list is what is validated and what the send goes to. A getter or an
  // iterator that throws is a refusal, not a rejected promise.
  let requested: readonly unknown[] | 'not-a-list' | undefined;
  try {
    const raw: unknown = options?.relays;
    requested =
      raw === undefined ? undefined : Array.isArray(raw) ? [...(raw as unknown[])] : 'not-a-list';
  } catch {
    return refused('relay-outside-scope', 'reading `relays` threw.');
  }
  const targets = targetsOf(port, requested);
  if (!Array.isArray(targets)) return targets as SendResult;

  // **The provider's lifetime covers the send from the call**, signing and
  // verification included, not only the wait for relays once something went
  // out. A signer that never returns, or a verifier that never answers, would
  // otherwise leave a destroyed provider's send pending for ever; and a late
  // signature must not start a send. One registration, removed however this
  // ends.
  let removeListener: () => void = () => undefined;
  const ended = new Promise<'revoked'>((resolve) => {
    removeListener = lease.onRevoke(() => resolve('revoked'));
  });
  const signing = signedEventOf(port, input);
  // A signing that loses the race may still settle later; nothing waits on it.
  signing.catch(() => undefined);
  let event: Nostr.Event;
  try {
    const first = await Promise.race([signing, ended]);
    if (first === 'revoked' || lease.revoked) {
      return refused(
        'provider-disposed',
        'the provider was destroyed while the event was being signed or verified.'
      );
    }
    if ('status' in first) return first;
    event = first;
  } finally {
    removeListener();
  }

  // The dependency signs with whatever it is handed; this hands it the event
  // already checked above, so nothing it could do to the input reaches the wire.
  const passThrough = {
    signEvent: async () => event,
    getPublicKey: async () => event.pubkey
  };
  const answers = lease.send(event, {
    signer: passThrough as never,
    on: { relays: [...targets] },
    completeOn: 'all-ok',
    errorOnTimeout: false
  });
  if (answers === undefined) {
    return refused('provider-disposed', 'the provider was destroyed before the event went out.');
  }

  return new Promise<SendResult>((resolve) => {
    // **A relay's answer is unknown until it is read, whatever the dependency's
    // types say.** rx-nostr 3.7.5 passes an `OK`'s fields through as they
    // arrived, so a reason that is an object reached a field declared `string`,
    // unfrozen — a reviewer measured it. `ok` counts as acceptance only when it
    // is the boolean `true`; the reason becomes this library's `RelayMessage`,
    // bounded and frozen, the vocabulary `CLOSED` notices already use.
    const latest: Record<string, { ok: boolean; message: RelayMessage } | undefined> =
      Object.create(null) as Record<string, { ok: boolean; message: RelayMessage } | undefined>;
    const finish = (): void => {
      const aborted = lease.revoked;
      const relays = targets.map((relay): SendRelayOutcome => {
        const answer = latest[relay];
        if (answer !== undefined) {
          return Object.freeze({
            relay,
            outcome: answer.ok ? 'accepted' : 'rejected',
            message: answer.message
          });
        }
        return Object.freeze({ relay, outcome: aborted ? 'aborted' : 'no-response' });
      });
      resolve(Object.freeze({ status: 'settled', event, relays: Object.freeze(relays) }));
    };
    answers.subscribe({
      next: (packet) => {
        const from: unknown = packet.from;
        if (typeof from === 'string' && targets.includes(from)) {
          latest[from] = {
            ok: (packet.ok as unknown) === true,
            message: relayMessage((packet.notice as unknown) ?? '')
          };
        }
      },
      error: finish,
      complete: finish
    });
  });
}
