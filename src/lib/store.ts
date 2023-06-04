import { writable, type Readable } from 'svelte/store';
import { pipe } from 'rxjs';
import type { Observable, OperatorFunction } from 'rxjs';
import { createRxOneshotReq, Nostr, verify, latest, uniq, filterKind } from 'rx-nostr';
import type { RxNostr, RxReq, RxReqController, EventPacket } from 'rx-nostr';

import {
  filterId,
  filterTextList,
  filterPubkey,
  filterMetadataList,
  filterNaddr,
  latestEachPubkey,
  latestEachNaddr,
  scanArray
} from './operator';

export type RxReqBase = RxReq & RxReqController;
export enum SortOrder {
  Asc = 'Asc',
  Desc = 'Desc'
}

export interface ReqResult<A> {
  data: Observable<A>;
  isLoading: Readable<boolean>;
  isSuccess: Readable<boolean>;
  isError: Readable<boolean>;
  error: Readable<Error | undefined>;
}

export const app = writable<{ client: RxNostr }>();

// TODO: Add cache support
// TODO: Add timeout support
export function useEvents<A>(
  client: RxNostr,
  filters: Nostr.Filter[],
  opeartor: OperatorFunction<EventPacket, A>,
  req?: RxReqBase | undefined
): ReqResult<A> {
  let _req: RxReq;
  if (req) {
    req.emit(filters);
    _req = req;
  } else {
    _req = createRxOneshotReq({ filters });
  }

  const data = client.use(_req).pipe(opeartor);
  const isLoading = writable(true);
  const isSuccess = writable(false);
  const isError = writable(false);
  const error = writable<Error | undefined>(undefined);

  data.subscribe({
    complete: () => {
      isLoading.set(false);
      isSuccess.set(true);
    },
    error: (e) => {
      isError.set(true);
      error.set(e);
    }
  });

  return {
    data,
    isLoading,
    isSuccess,
    isError,
    error
  };
}

export function useLatestEvent(
  client: RxNostr,
  filters: Nostr.Filter[],
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  const operator = pipe(verify(), latest());
  return useEvents(client, filters, operator, req);
}

export function useMetadata(
  client: RxNostr,
  pubkey: string,
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  // TODO: Add npub support
  const filters = [{ kinds: [Nostr.Kind.Metadata], authors: [pubkey], limit: 1 }];
  const operator = pipe(filterKind(Nostr.Kind.Metadata), filterPubkey(pubkey), verify(), latest());
  return useEvents(client, filters, operator, req);
}

export function useMetadataList(
  client: RxNostr,
  pubkeys: string[],
  req?: RxReqBase | undefined
): ReqResult<EventPacket[]> {
  // TODO: Add npub support
  const filters = [{ kinds: [Nostr.Kind.Metadata], authors: pubkeys, limit: pubkeys.length }];
  const operator = pipe(filterMetadataList(pubkeys), verify(), latestEachPubkey(), scanArray());
  return useEvents(client, filters, operator, req);
}

export function useText(
  client: RxNostr,
  id: string,
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  // TODO: Add note1 support
  const filters = [{ kinds: [Nostr.Kind.Text], ids: [id], limit: 1 }];
  const operator = pipe(filterKind(Nostr.Kind.Text), filterId(id), uniq(), verify());
  return useEvents(client, filters, operator, req);
}

export function useTextList(
  client: RxNostr,
  ids: string[],
  req?: RxReqBase | undefined
): ReqResult<EventPacket[]> {
  // TODO: Add note1 support
  const filters = [{ kinds: [Nostr.Kind.Text], ids }];
  const operator = pipe(filterTextList(ids), uniq(), verify(), scanArray());
  return useEvents(client, filters, operator, req);
}

export function useUserTextList(
  client: RxNostr,
  pubkey: string,
  limit: number,
  req?: RxReqBase | undefined
): ReqResult<EventPacket[]> {
  // TODO: Add note1 support
  const filters = [{ kinds: [Nostr.Kind.Text], authors: [pubkey], limit }];
  const operator = pipe(
    filterKind(Nostr.Kind.Text),
    filterPubkey(pubkey),
    uniq(),
    verify(),
    scanArray()
  );
  return useEvents(client, filters, operator, req);
}

export function useArticle(
  client: RxNostr,
  pubkey: string,
  identifier: string,
  req?: RxReqBase | undefined
): ReqResult<EventPacket> {
  const filters = [
    { kinds: [Nostr.Kind.Article], authors: [pubkey], '#d': [identifier], limit: 1 }
  ];
  const operator = pipe(filterNaddr(Nostr.Kind.Article, pubkey, identifier), verify(), latest());
  return useEvents(client, filters, operator, req);
}

export function useUserArticleList(
  client: RxNostr,
  pubkey: string,
  limit: number,
  req?: RxReqBase | undefined
): ReqResult<EventPacket[]> {
  const filters = [{ kinds: [Nostr.Kind.Article], authors: [pubkey], limit }];
  const operator = pipe(
    filterKind(Nostr.Kind.Article),
    filterPubkey(pubkey),
    verify(),
    latestEachNaddr(),
    scanArray()
  );
  return useEvents(client, filters, operator, req);
}
