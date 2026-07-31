import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import type { EventPacket } from 'rx-nostr';
import { createRxForwardReq, createRxNostr, latest } from 'rx-nostr';
import { map, pipe } from 'rxjs';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { scanArray } from '$lib/stores/operators.js';
import { useReq } from '$lib/stores/useReq.js';

import {
  createTestRelay,
  fakeEvent,
  nextReqSubId,
  respondWithEose,
  respondWithEvent
} from '../helpers/relay.js';
import { activate, toArray, waitFor } from '../helpers/store.js';

describe('useReq', () => {
  const queryKey = ['useReq'];
  const rxNostr = createRxNostr();
  const filters = [{}];
  const operator = pipe();
  const initData = undefined;

  beforeEach(() => {
    setQueryClientContext(new QueryClient());
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('when relays are empty', () => {
    it('emits initData as .data', async () => {
      const initData = {};
      const result = useReq({ rxNostr, queryKey, filters, operator, initData });
      const actual = await toArray(result.data, 250);
      expect(actual).toEqual([initData]);
    });

    it('emits "success" as .status', async () => {
      const result = useReq({ rxNostr, queryKey, filters, operator, initData });
      const actual = await toArray(result.status, 250);
      expect(actual).toEqual(['success']);
    });

    it('emits undefined as .error', async () => {
      const result = useReq({ rxNostr, queryKey, filters, operator, initData });
      const actual = await toArray(result.error, 250);
      expect(actual).toEqual([undefined]);
    });
  });

  describe('when relays are configured', () => {
    beforeEach(() => {
      setQueryClientContext(new QueryClient({ defaultOptions: { queries: { retry: false } } }));
    });

    afterEach(() => {
      WS.clean();
    });

    it('resolves .data with the first event and transitions .status to "success"', async () => {
      const { rxNostr, server } = createTestRelay('ws://localhost:9001');
      const result = useReq({
        rxNostr,
        queryKey: ['useReq', 'success'],
        filters: [{ kinds: [1] }],
        operator: pipe(),
        initData: undefined
      });
      activate(result.status);

      const subId = await nextReqSubId(server);
      const event = fakeEvent();
      respondWithEvent(server, subId, event);

      const data = await waitFor(result.data, (v) => v !== undefined);
      expect(data?.event).toEqual(event);
      // The underlying query resolves as soon as the first matching event
      // arrives; EOSE isn't required for .status to become "success".
      expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');

      respondWithEose(server, subId);
    });

    it('updates .data with subsequent events received before EOSE', async () => {
      const { rxNostr, server } = createTestRelay('ws://localhost:9002');
      const result = useReq({
        rxNostr,
        queryKey: ['useReq', 'streaming'],
        filters: [{ kinds: [1] }],
        operator: pipe(),
        initData: undefined
      });
      activate(result.status);

      const subId = await nextReqSubId(server);
      const first = fakeEvent();
      const second = fakeEvent();
      respondWithEvent(server, subId, first);
      await waitFor(result.data, (v) => v?.event.id === first.id);

      respondWithEvent(server, subId, second);
      const data = await waitFor(result.data, (v) => v?.event.id === second.id);
      expect(data?.event).toEqual(second);

      respondWithEose(server, subId);
      expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
    });

    it('settles the query when the REQ completes without emitting anything', async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      setQueryClientContext(queryClient);

      const { rxNostr, server } = createTestRelay('ws://localhost:9005');
      const queryKey = ['useReq', 'empty'];
      const result = useReq({
        rxNostr,
        queryKey,
        filters: [{ kinds: [1] }],
        // `latest()` scans without a seed, so a REQ that matches nothing
        // reaches EOSE having emitted no value at all.
        operator: pipe(latest()),
        initData: undefined
      });
      activate(result.status);
      activate(result.data);

      const subId = await nextReqSubId(server);
      respondWithEose(server, subId);

      expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
      // The local `status` store reaching 'success' isn't enough: the query
      // behind it must settle too, or it stays pending (and fetching) forever
      // while .status already claims success.
      await vi.waitFor(() => {
        expect(queryClient.getQueryState(queryKey)?.status).toBe('success');
      });
      expect(queryClient.getQueryState(queryKey)?.fetchStatus).toBe('idle');
      expect(get(result.data)).toBeUndefined();
    });

    it('resolves with initData when the REQ completes without emitting anything', async () => {
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      setQueryClientContext(queryClient);

      const { rxNostr, server } = createTestRelay('ws://localhost:9006');
      const queryKey = ['useReq', 'empty-list'];
      const result = useReq<EventPacket[]>({
        rxNostr,
        queryKey,
        filters: [{ kinds: [1] }],
        // `scanArray()`'s `[]` seed is only surfaced once the source emits, so
        // this operator is just as silent as `latest()` on an empty result.
        operator: pipe(scanArray()),
        initData: []
      });
      activate(result.status);
      activate(result.data);

      const subId = await nextReqSubId(server);
      respondWithEose(server, subId);

      expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
      // Asserted against the cache rather than `.data`, which falls back to
      // `initData` while pending and so can't tell resolution apart from it.
      await vi.waitFor(() => {
        expect(queryClient.getQueryData(queryKey)).toEqual([]);
      });
      expect(get(result.data)).toEqual([]);
    });

    it('closes the REQ when the last subscriber leaves before the fetch settles', async () => {
      const { rxNostr, server } = createTestRelay('ws://localhost:9007');
      const result = useReq({
        rxNostr,
        queryKey: ['useReq', 'cancel'],
        filters: [{ kinds: [1] }],
        operator: pipe(),
        initData: undefined
      });
      const unsubscribe = activate(result.status);

      const subId = await nextReqSubId(server);

      // Dropping the only subscriber while the query is still fetching stands
      // in for a component unmounting before the relay reaches EOSE.
      unsubscribe();

      await vi.waitFor(() => {
        expect(server.messages.at(-1)).toEqual(['CLOSE', subId]);
      });
    });

    it('sets .status to "error" and .error when the operator throws', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { rxNostr, server } = createTestRelay('ws://localhost:9003');
      const result = useReq({
        rxNostr,
        queryKey: ['useReq', 'error'],
        filters: [{ kinds: [1] }],
        operator: pipe(
          map(() => {
            throw new Error('boom');
          })
        ),
        initData: undefined
      });
      activate(result.status);

      const subId = await nextReqSubId(server);
      respondWithEvent(server, subId, fakeEvent());

      const status = await waitFor(result.status, (s) => s === 'error');
      expect(status).toBe('error');
      const error = await waitFor(result.error, (e) => e !== undefined);
      expect(error?.message).toBe('boom');
      expect(consoleError).toHaveBeenCalled();
    });

    it('clears .error when a retried request succeeds', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      setQueryClientContext(
        new QueryClient({ defaultOptions: { queries: { retry: 1, retryDelay: 0 } } })
      );

      const { rxNostr, server } = createTestRelay('ws://localhost:9008');
      let attempt = 0;
      const result = useReq<EventPacket>({
        rxNostr,
        queryKey: ['useReq', 'recovered'],
        filters: [{ kinds: [1] }],
        operator: map((packet: EventPacket) => {
          if (attempt === 1) {
            throw new Error('boom');
          }
          return packet;
        })
      });
      activate(result.status);
      activate(result.data);
      activate(result.error);

      attempt = 1;
      respondWithEvent(server, await nextReqSubId(server), fakeEvent());
      await waitFor(result.error, (e) => e !== undefined);

      attempt = 2;
      const retrySubId = await nextReqSubId(server);
      const event = fakeEvent();
      respondWithEvent(server, retrySubId, event);
      respondWithEose(server, retrySubId);

      expect((await waitFor(result.data, (v) => v !== undefined))?.event).toEqual(event);
      expect(await waitFor(result.status, (s) => s === 'success')).toBe('success');
      // The failed attempt's error must not outlive it.
      expect(get(result.error)).toBeUndefined();
      expect(consoleError).toHaveBeenCalled();
    });

    it('reports "error" as .status when the stream fails after the query resolved', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { rxNostr, server } = createTestRelay('ws://localhost:9009');
      let poisoned = false;
      const result = useReq<EventPacket>({
        rxNostr,
        queryKey: ['useReq', 'late-error'],
        filters: [{ kinds: [1] }],
        operator: map((packet: EventPacket) => {
          if (poisoned) {
            throw new Error('late boom');
          }
          return packet;
        })
      });
      activate(result.status);
      activate(result.data);
      activate(result.error);

      const subId = await nextReqSubId(server);
      respondWithEvent(server, subId, fakeEvent());
      await waitFor(result.data, (v) => v !== undefined);

      // The query has already resolved, so this failure can never reach it.
      // `.status` has to follow the local store or it would claim success
      // while `.error` is set.
      poisoned = true;
      respondWithEvent(server, subId, fakeEvent());

      expect(await waitFor(result.status, (s) => s === 'error')).toBe('error');
      expect(get(result.error)?.message).toBe('late boom');
      expect(consoleError).toHaveBeenCalled();
    });

    it('reuses a given req to emit filters instead of creating a new oneshot req', () => {
      const { rxNostr } = createTestRelay('ws://localhost:9004');
      const req = createRxForwardReq();
      const emitSpy = vi.spyOn(req, 'emit');
      const filters = [{ kinds: [1] }];

      // `req`'s own packet stream is the source of truth for what useReq()
      // asked it to emit, independent of whether/when the internal query
      // machinery subscribes to it.
      const packets: unknown[] = [];
      const subscription = req.getReqPacketObservable().subscribe((packet) => packets.push(packet));

      useReq({
        rxNostr,
        queryKey: ['useReq', 'req-reuse'],
        filters,
        operator: pipe(),
        req,
        initData: undefined
      });

      expect(emitSpy).toHaveBeenCalledWith(filters);
      expect(packets).toEqual([{ filters }]);

      subscription.unsubscribe();
    });
  });
});
