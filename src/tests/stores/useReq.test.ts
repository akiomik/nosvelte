import { QueryClient, setQueryClientContext } from '@tanstack/svelte-query';
import { createRxForwardReq, createRxNostr } from 'rx-nostr';
import { map, pipe } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

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
