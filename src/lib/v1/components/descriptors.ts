/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What each request component asks (0004's component descriptor table, C7).
 *
 * **One table, here, and every component reads its row from it.** The kinds,
 * `live`, `retain` and `settleTimeoutMs` are all in the cache key, so two
 * components that wrote their own descriptors would give one published name
 * two cache identities — and a consumer's own `useReq` could not land on the
 * same entry as a component without guessing all four (`C7-C7`). Every row is
 * non-live, takes the provider's readable set, and leaves `retain` and
 * `settleTimeoutMs` at their non-live defaults, except `UserReactionList`,
 * whose `limit` is both the filter's bound and the retention.
 *
 * **A value used twice in one descriptor is taken through a reader, and read
 * once here.** In Svelte a prop read is a re-evaluation, so reading `ids` for
 * the filter and again for `limit: ids.length` can describe two lists — a `REQ`
 * asking for three ids with `limit: 4` — and reading `limit` for the filter and
 * again for `retain` can bound the two by different numbers (`B4-C9`,
 * `C7-C6`). Taking a reader makes "read once" a property of these functions
 * rather than of every component that calls them. A value used once is passed
 * as it is.
 */
import type { ReqDescriptor } from '../public-entry.js';

/** The default `UserReactionList` bound, from 0004. */
export const DEFAULT_REACTION_LIMIT = 100;

/** `namespace` is passed on only when given, so an absent one keys as absent. */
const within = (namespace: string | undefined): Pick<ReqDescriptor, 'namespace'> =>
  namespace === undefined ? {} : { namespace };

/** `Event`, `Text`: one event by id. */
export const byId = (id: string, namespace?: string): ReqDescriptor => ({
  filters: [{ ids: [id], limit: 1 }],
  ...within(namespace)
});

/** `EventList`, `UniqueEventList`: those ids and nothing more. */
export const byIds = (read: () => readonly string[], namespace?: string): ReqDescriptor => {
  const ids = read();
  return { filters: [{ ids: [...ids], limit: ids.length }], ...within(namespace) };
};

/**
 * The replaceable kinds one author publishes once each: `Metadata` (0),
 * `Contacts` (3), `Mute` (10000), `Pin` (10001), `RelayListMetadata` (10002).
 */
export const latestOf = (kind: number, pubkey: string, namespace?: string): ReqDescriptor => ({
  filters: [{ kinds: [kind], authors: [pubkey], limit: 1 }],
  ...within(namespace)
});

/** `Article`: one long-form article, addressed by author and `d` tag. */
export const article = (pubkey: string, identifier: string, namespace?: string): ReqDescriptor => ({
  filters: [{ kinds: [30023], authors: [pubkey], '#d': [identifier], limit: 1 }],
  ...within(namespace)
});

/**
 * `UserReactionList`: one author's reactions, `limit` of them.
 *
 * The one row with a `retain`, and it is the same value as the filter's
 * `limit`: one read of the caller's value is both. It is not checked
 * here either — a value that is not a safe integer of at least 1 is refused by
 * the descriptor boundary before anything is sent (see `UserReactionList`).
 */
export const reactions = (
  pubkey: string,
  read: () => number,
  namespace?: string
): ReqDescriptor => {
  const limit = read();
  return {
    filters: [{ kinds: [7], authors: [pubkey], limit }],
    retain: limit,
    ...within(namespace)
  };
};
