/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The outlets every request component publishes (0004 C1, C4b, ruling 10):
 * four snippets, each handed the request, so a component consumer reaches the
 * same state, activity, diagnostics and `refresh()` a `useReq` consumer does.
 */
import type { Snippet } from 'svelte';

import type { ReqHandle } from '../engine.js';
import type { ReqEvent } from '../event.js';
import type { ReqOutletError } from '../reqerror.js';

export interface RequestOutletContext {
  readonly request: ReqHandle;
}

export type Outlets<T> = {
  children: Snippet<[T & RequestOutletContext]>;
  loading?: Snippet<[RequestOutletContext]>;
  error?: Snippet<[{ readonly request: ReqHandle; readonly error: ReqOutletError }]>;
  nodata?: Snippet<[RequestOutletContext]>;
};

export type Events = { readonly events: readonly ReqEvent[] };
export type Event = { readonly event: ReqEvent };

export type EventListProps = { namespace?: string; ids: readonly string[] } & Outlets<Events>;
export type UniqueEventListProps = EventListProps;
export type UserReactionListProps = {
  namespace?: string;
  pubkey: string;
  limit?: number;
} & Outlets<Events>;
export type ContactsProps = { namespace?: string; pubkey: string } & Outlets<Event>;
export type MetadataProps = ContactsProps;
export type MuteProps = ContactsProps;
export type PinProps = ContactsProps;
export type RelayListMetadataProps = ContactsProps;
export type ArticleProps = {
  namespace?: string;
  pubkey: string;
  identifier: string;
} & Outlets<Event>;
export type EventProps = { namespace?: string; id: string } & Outlets<Event>;
export type TextProps = EventProps;
