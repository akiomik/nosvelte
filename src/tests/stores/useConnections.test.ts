import type { ConnectionStatePacket } from 'rx-nostr';
import { createRxForwardReq } from 'rx-nostr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import { useConnections } from '$lib/stores/useConnections.js';

import { createTestRelay } from '../helpers/relay.js';

describe('useConnections', () => {
  afterEach(() => {
    WS.clean();
  });

  describe('when relays are empty', () => {
    it('emits an empty snapshot once', async () => {
      const { rxNostr } = createTestRelay('ws://localhost:9201');

      const snapshots: ConnectionStatePacket[][] = [];
      const subscription = useConnections({ rxNostr, relays: [] }).subscribe((s) =>
        snapshots.push(s)
      );
      subscription.unsubscribe();

      expect(snapshots).toEqual([[]]);
    });
  });

  describe('when relays are configured', () => {
    it('seeds the initial snapshot from current relay status, then keeps only the latest state per relay', async () => {
      const url = 'ws://localhost:9202';
      const { rxNostr, server } = createTestRelay(url);

      const snapshots: ConnectionStatePacket[][] = [];
      const subscription = useConnections({ rxNostr, relays: [url] }).subscribe((s) =>
        snapshots.push(s)
      );

      expect(snapshots[0]).toEqual([{ from: url, state: 'initialized' }]);

      const req = createRxForwardReq();
      rxNostr.use(req).subscribe();
      req.emit([{}]);
      await server.connected;

      await vi.waitFor(() => {
        expect(snapshots.at(-1)).toEqual([{ from: url, state: 'connected' }]);
      });

      server.close();

      // With retries turned off, an unexpected close is a terminal "error".
      await vi.waitFor(() => {
        expect(snapshots.at(-1)).toEqual([{ from: url, state: 'error' }]);
      });

      subscription.unsubscribe();
    });
  });
});
