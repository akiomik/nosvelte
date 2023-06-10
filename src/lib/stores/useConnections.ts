/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { ConnectionStatePacket } from 'rx-nostr';
import type { Observable } from 'rxjs';
import { from, startWith } from 'rxjs';

import { scanLatestEach } from './operators.js';
import type { UseConnectionsOpts } from './types.js';

export function useConnections({
  client,
  relays
}: UseConnectionsOpts): Observable<ConnectionStatePacket[]> {
  if (relays.length === 0) {
    return from([[]]);
  }

  const init = relays.map((relay) => {
    const from = typeof relay === 'string' ? relay : relay.url;
    const state = client.hasRelay(from) ? client.getRelayState(from) : 'not-started';

    return { from, state };
  });

  return client.createConnectionStateObservable().pipe(
    startWith(...init),
    scanLatestEach(({ from }) => from)
  );
}
