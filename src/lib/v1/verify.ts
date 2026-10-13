/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The library's own event verifier: what every event a provider admits and
 * every event `useSend` sends has to pass (`A-ε-C18`).
 *
 * **The dependency's `verifier` checks the signature over the hash of the
 * fields and never compares that hash with `id`.** `rx-nostr-crypto` at 3.1.3
 * runs `schnorr.verify(sig, getEventHash(event), pubkey)` and stops there, so
 * an event signed correctly over its own fields, with its `id` rewritten to
 * anything at all, passed. The event set identifies a regular event by its id,
 * and keeps the first packet of an id it folds (`0003`, `B5-C3`): a relay that
 * put such an event first held another author's event of that id out of every
 * request that read it, and one whose id was rewritten to `10000:<pubkey>`
 * displaced that author's replaceable revision, since a regular event is keyed
 * by its id. Both measured through `useReq` under a provider, before this.
 *
 * **Here rather than at the admission boundary**, because the verifier is the
 * gate `0003` credits with the id premise, and a provider's is always this one:
 * `0004` publishes no verifier, so on the published surface nothing replaces
 * it. A verifier a caller supplies at the engine's own seam replaces this
 * check with it, which is the residue `0003` names.
 */
import type Nostr from 'nostr-typedef';
import { getEventHash, schnorr } from 'rx-nostr-crypto';

/**
 * Whether `event` is an event: its `id` is the hash of its fields, exactly,
 * and its signature verifies over that hash.
 *
 * - **The hash is computed once and used for both halves.** Once the two are
 *   equal, verifying over the hash is verifying over the `id`.
 * - **The serialization is the dependency's `getEventHash`**, the one its
 *   signature check already used. So an event whose id is its hash verifies
 *   exactly when it did before this check existed.
 * - **Compared exactly**: NIP-01's `id` is lower-case hex, and the hash is
 *   written that way, so an upper-case spelling of the right hash is refused.
 * - **A throw is `false`, and nothing is written.** The schnorr check throws on
 *   a signature or key that is not hex, and the dependency's own `verify`
 *   reports that with `console.warn`: a library deciding what reaches a
 *   consumer's console about a relay's input is a choice this one does not
 *   make.
 */
export async function verifyEvent(event: Nostr.Event): Promise<boolean> {
  try {
    const hash = getEventHash(event);
    return hash === event.id && schnorr.verify(event.sig, hash, event.pubkey);
  } catch {
    return false;
  }
}
