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
  error?: Snippet<[{ request: ReqHandle; error: ReqOutletError }]>;
  nodata?: Snippet<[RequestOutletContext]>;
};

export type Events = { events: readonly ReqEvent[] };
export type Event = { event: ReqEvent };

export type MetadataProps = { namespace?: string; pubkey: string } & Outlets<Event>;
