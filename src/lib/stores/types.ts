/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { RxReq, RxReqController } from 'rx-nostr';
import type { Readable } from 'svelte/store';

export type RxReqBase = RxReq & RxReqController;

export interface ReqResult<A> {
  data: Readable<A>;
  isLoading: Readable<boolean>;
  isSuccess: Readable<boolean>;
  isError: Readable<boolean>;
  error: Readable<Error | undefined>;
}
