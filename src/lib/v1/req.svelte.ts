/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * `useReq`, the published request hook (0004 C2), over the engine's
 * `useStreamedReq`.
 *
 * The engine takes an option bag that is wider than what v1 publishes; this is
 * the narrowing. A plan is either deferred or a request with a descriptor of
 * six fields, and nothing else reaches the engine from the caller: the
 * provider supplies the transport, the verifier, the clock, the cache and the
 * attempt registry (0002 A16). What comes back is the four members of
 * `ReqHandle` and no more, so the engine's extras stay off the surface.
 */
import type { ReqHandle } from './engine.js';
import type { ReqDescriptor, ReqPlan } from './public-entry.js';
import { useStreamedReq, type UseStreamedReqOpts } from './useStreamedReq.svelte.js';

/**
 * The fixed part of every subscription id this hook opens.
 *
 * The id is `<base>-<attempt id>-…`, and the attempt id — minted by the
 * provider's registry from 96 random bits and a counter — is what makes it
 * unique (0002). The base is the library's, never the caller's (A16), and kept
 * short because the whole id has 64 characters to fit in.
 */
const WIRE_BASE = 'nv';

/**
 * The descriptor's fields, handed on as getters rather than copied.
 *
 * A copy reads every field here, unguarded, so a field whose read throws
 * threw out of the component; the engine reads each field once, behind its
 * own guard, and refuses one that throws by name (0003, the guarded reads;
 * 0004's failure table). Reading through to the descriptor keeps that, and
 * reads each field once rather than once to test it and again to copy it.
 */
const optionsOf = (descriptor: ReqDescriptor): UseStreamedReqOpts =>
  ({
    reqIdBase: WIRE_BASE,
    get filters() {
      return descriptor.filters;
    },
    get live() {
      return descriptor.live;
    },
    get namespace() {
      return descriptor.namespace;
    },
    get settleTimeoutMs() {
      return descriptor.settleTimeoutMs;
    },
    get retain() {
      return descriptor.retain;
    },
    get relays() {
      return descriptor.relays;
    }
  }) as UseStreamedReqOpts;

export function useReq(plan: () => ReqPlan): ReqHandle {
  const handle = useStreamedReq(() => {
    const current = plan();

    return current.kind === 'deferred'
      ? { deferred: true, filters: [], reqIdBase: WIRE_BASE }
      : optionsOf(current.descriptor);
  });

  return {
    get state() {
      return handle.state;
    },
    get activity() {
      return handle.activity;
    },
    get diagnostics() {
      return handle.diagnostics;
    },
    refresh: () => handle.refresh()
  };
}
