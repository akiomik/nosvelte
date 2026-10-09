/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of `B5-C8`'s landing, `PB13` (the publication
 * discipline): each entry an edit that `PB13` must fail under. An id
 * beginning `C8-` edits the library: a value a hook publishes left open, or a
 * published type that lets a write through. One beginning `I-` edits an
 * instrument: the arrangement, the run-time discipline, or the compile probe.
 *
 * Retired with no entry:
 * - unreachable from the repository: an exclusion looked up by an inherited
 *   key, which needs an export named after a member of `Object.prototype`.
 *   The entry has none, and `Object.hasOwn` guards the lookup.
 *
 * And gone, since what they edited was removed:
 * - the props premise's regular expression, replaced by a reading of Svelte's
 *   parse (`I-props-*`);
 * - the snippet reader's silent depth cut, replaced by a reader that reports
 *   past its depth (`I-handed-depth-*`);
 * - `sealClass`'s second call, which sealing the prototype made redundant,
 *   since the class is its prototype's `constructor`;
 * - the discipline's walk of a `constructor` that is not a function, as a
 *   value, and its clause reporting one on its own: the comparison with the
 *   class the arrangement imports reports it.
 */
import type { Ledger } from '../ledger.ts';

export default {
  name: 'b5-c8',
  subject: '`B5-C8` (the publication discipline): its landing, `PB13`',
  files: ['src/tests/contracts/engine/published.test.ts'],
  calibration: {
    measured:
      'the mean of each run in a full run at 7e33945, two runs at a time, on a shared 10-core machine; a kill ends PB13 at its first failing assertion, so runs took from 3 s to 67 s, and the mean predicts a full run where the median (7 s) does not',
    seconds: { PB13: 16.1 }
  },
  entries: [
    {
      id: 'C8-incomplete-error-open',
      arm: 'PB13',
      describe: 'the `IncompleteResultError` an incomplete answer carries is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: '    Object.freeze(this);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-outcome-error-open',
      arm: 'PB13',
      describe: 'a refresh that failed resolves with an unfrozen outcome',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: "  if (error !== undefined) return Object.freeze({ kind: 'error', error } as const);",
          to: "  if (error !== undefined) return ({ kind: 'error', error } as const);"
        }
      ]
    },
    {
      id: 'C8-outcome-incomplete-open',
      arm: 'PB13',
      describe: 'a refresh that timed out resolves with an unfrozen outcome',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: "    : Object.freeze({ kind: 'incomplete', causes: completion.causes } as const);",
          to: "    : ({ kind: 'incomplete', causes: completion.causes } as const);"
        }
      ]
    },
    {
      id: 'C8-outcome-complete-open',
      arm: 'PB13',
      describe: 'a refresh that completed resolves with an unfrozen outcome',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: "    ? Object.freeze({ kind: 'complete' } as const)",
          to: "    ? ({ kind: 'complete' } as const)"
        }
      ]
    },
    {
      id: 'C8-outcome-released-open',
      arm: 'PB13',
      describe: 'a refresh its consumer released resolves with an unfrozen outcome',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "    return Object.freeze({ kind: 'cancelled', reason: 'consumer-released' } as const);",
          to: "    return ({ kind: 'cancelled', reason: 'consumer-released' } as const);"
        }
      ]
    },
    {
      id: 'C8-outcome-disposed-open',
      arm: 'PB13',
      describe: 'a refresh the provider’s disposal cancelled resolves with an unfrozen outcome',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "    return Object.freeze({ kind: 'cancelled', reason: 'provider-disposed' } as const);",
          to: "    return ({ kind: 'cancelled', reason: 'provider-disposed' } as const);"
        }
      ]
    },
    {
      id: 'C8-not-started-released-open',
      arm: 'PB13',
      describe: 'a refresh on a released handle resolves with an unfrozen outcome',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "Object.freeze({ kind: 'not-started', reason: 'released' } as const)",
          to: "({ kind: 'not-started', reason: 'released' } as const)"
        }
      ]
    },
    {
      id: 'C8-not-started-deferred-open',
      arm: 'PB13',
      describe: 'a refresh of a deferred plan resolves with an unfrozen outcome',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "Object.freeze({ kind: 'not-started', reason: 'deferred' } as const)",
          to: "({ kind: 'not-started', reason: 'deferred' } as const)"
        }
      ]
    },
    {
      id: 'C8-not-started-server-open',
      arm: 'PB13',
      describe: 'a refresh on a server resolves with an unfrozen outcome',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "Object.freeze({ kind: 'not-started', reason: 'server' } as const)",
          to: "({ kind: 'not-started', reason: 'server' } as const)"
        }
      ]
    },
    {
      id: 'C8-not-started-nowhere-open',
      arm: 'PB13',
      describe: 'a refresh with no readable relay resolves with an unfrozen outcome',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "Object.freeze({ kind: 'not-started', reason: 'no-readable-relay' } as const)",
          to: "({ kind: 'not-started', reason: 'no-readable-relay' } as const)"
        }
      ]
    },
    {
      id: 'C8-projected-open',
      arm: 'PB13',
      describe: '`projected` hands out an unfrozen wrapper',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '      return Object.freeze(result);',
          to: '      return result;'
        }
      ]
    },
    {
      id: 'C8-projected-on-a-server-open',
      arm: 'PB13',
      describe: '`projected` hands out an unfrozen wrapper for a refusal on a server',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '        return Object.freeze(deriveState({ data: undefined, error: refusedOnServer }, now));',
          to: '        return deriveState({ data: undefined, error: refusedOnServer }, now);'
        }
      ]
    },
    {
      id: 'C8-state-open',
      arm: 'PB13',
      describe: 'the state a hook hands out is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: 'return { ...derived, state: Object.freeze(derived.state) };',
          to: 'return { ...derived, state: derived.state };'
        }
      ]
    },
    {
      id: 'C8-diagnostics-open',
      arm: 'PB13',
      describe: 'the diagnostics a hook hands out are left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: '  return Object.freeze({',
          to: '  return ({'
        }
      ]
    },
    {
      id: 'C8-refusal-open',
      arm: 'PB13',
      describe: 'a relay’s refusal record is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/machine.ts',
          from: 'refusal: Object.freeze({ from: packet.from, leg, notice, reason })',
          to: 'refusal: { from: packet.from, leg, notice, reason }'
        }
      ]
    },
    {
      id: 'C8-causes-open',
      arm: 'PB13',
      describe: 'the causes of an incomplete answer are left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '(Object.freeze(ordered) as unknown as IncompleteCauses)',
          to: '(ordered as unknown as IncompleteCauses)'
        }
      ]
    },
    {
      id: 'C8-events-open',
      arm: 'PB13',
      describe: 'the events list of a projection is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: 'return { events: Object.freeze(events), nextExpiryAt };',
          to: 'return { events, nextExpiryAt };'
        }
      ]
    },
    {
      id: 'C8-leg-end-open',
      arm: 'PB13',
      describe: 'the leg’s end is left unfrozen, at both the places it is made',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "Object.freeze({ kind: 'ended', error: chunk.reason })",
          to: "({ kind: 'ended', error: chunk.reason })"
        },
        {
          file: 'src/lib/v1/eventset.ts',
          from: 'return { ...set, forward: { ...forward, end: Object.freeze(end) } };',
          to: 'return { ...set, forward: { ...forward, end } };'
        }
      ]
    },
    {
      id: 'C8-failure-open',
      arm: 'PB13',
      describe: 'the failure an attempt stores is registered but not frozen',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: 'return sealOwned(new ReqFailure(fields))',
          to: 'return ownedByLibrary(new ReqFailure(fields))'
        }
      ]
    },
    {
      id: 'C8-stack-left-open',
      arm: 'PB13',
      describe: 'registration leaves an Error’s `stack` an accessor with a live setter',
      edits: [
        {
          file: 'src/lib/v1/owned.ts',
          from: 'function closeStack(value: object): void {\n',
          to: 'function closeStack(value: object): void {\n  return;\n'
        }
      ]
    },
    {
      id: 'C8-provider-refusal-open',
      arm: 'PB13',
      describe: 'the provider’s `conflicting-capabilities` refusal is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: '    if (new.target === InvalidRelayScopeError) Object.freeze(this);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-provider-refusal-input-open',
      arm: 'PB13',
      describe: 'the provider’s `invalid-relay-input` refusal is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: '    if (new.target === InvalidRelayInputError) Object.freeze(this);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-provider-refusal-idempotence-open',
      arm: 'PB13',
      describe: 'the provider’s `non-idempotent-url` refusal is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: '    if (new.target === NonIdempotentRelayUrlError) Object.freeze(this);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-provider-refusal-incompatible-open',
      arm: 'PB13',
      describe: 'the provider’s `transport-incompatible` refusal is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: '    if (new.target === TransportIncompatibleError) Object.freeze(this);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-provider-refusal-mismatch-open',
      arm: 'PB13',
      describe: 'the provider’s `transport-key-mismatch` refusal is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: '    if (new.target === TransportKeyMismatchError) Object.freeze(this);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-provider-refusal-urls-open',
      arm: 'PB13',
      describe: 'a provider refusal’s `urls` is the caller’s list, unfrozen',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: '    this.urls = Object.freeze([...urls]);',
          to: '    this.urls = [...urls];'
        }
      ]
    },
    {
      id: 'C8-relay-row-open',
      arm: 'PB13',
      describe: 'a row of `useRelayDiagnostics().relays` is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/diagnostics.svelte.ts',
          from: '  for (const [url, diagnostic] of entries) map[url] = Object.freeze(diagnostic);',
          to: '  for (const [url, diagnostic] of entries) map[url] = diagnostic;'
        }
      ]
    },
    {
      id: 'C8-relay-row-urls-open',
      arm: 'PB13',
      describe: 'a row’s `configuredUrls` is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/diagnostics.svelte.ts',
          from: '      configuredUrls: Object.freeze([...(scope.configuredUrls[relay.url] ?? [])]),',
          to: '      configuredUrls: [...(scope.configuredUrls[relay.url] ?? [])],'
        }
      ]
    },
    {
      id: 'C8-relay-refusal-open',
      arm: 'PB13',
      describe: 'a row’s `lastRefusal` is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/diagnostics.svelte.ts',
          from: '        refusals[packet.from] = Object.freeze({',
          to: '        refusals[packet.from] = ({'
        }
      ]
    },
    {
      id: 'C8-relay-message-open',
      arm: 'PB13',
      describe: 'a relay’s message, when nothing was cut from it, is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/normalize.ts',
          from: 'const whole = (text: string): RelayMessage => Object.freeze({ text, truncated: false });',
          to: 'const whole = (text: string): RelayMessage => ({ text, truncated: false });'
        }
      ]
    },
    {
      id: 'C8-send-refused-open',
      arm: 'PB13',
      describe: 'a refused send resolves with an unfrozen result',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "  Object.freeze({ status: 'refused', code, message: `nosvelte: ${message}` });",
          to: "  ({ status: 'refused', code, message: `nosvelte: ${message}` });"
        }
      ]
    },
    {
      id: 'C8-send-settled-open',
      arm: 'PB13',
      describe: 'a settled send resolves with an unfrozen result',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "      resolve(Object.freeze({ status: 'settled', event, relays: Object.freeze(relays) }));",
          to: "      resolve({ status: 'settled', event, relays: Object.freeze(relays) });"
        }
      ]
    },
    {
      id: 'C8-send-outcome-open',
      arm: 'PB13',
      describe: 'a settled send’s per-relay outcome is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '          return Object.freeze({\n            relay,',
          to: '          return ({\n            relay,'
        }
      ]
    },
    {
      id: 'C8-send-function-open',
      arm: 'PB13',
      describe: '`useSend()` hands out an unfrozen function',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  return Object.freeze((input: SendInput, options?: SendOptions) =>',
          to: '  return ((input: SendInput, options?: SendOptions) =>'
        }
      ]
    },
    {
      id: 'C8-handle-unsealed',
      arm: 'PB13',
      describe: 'the engine handle is frozen, and its functions are not',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '  sealInterface(handle);\n',
          to: '  Object.freeze(handle);\n'
        }
      ]
    },
    {
      id: 'C8-handle-open',
      arm: 'PB13',
      describe: 'the engine handle is left open',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '  sealInterface(handle);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-useReq-unsealed',
      arm: 'PB13',
      describe: '`useReq()`’s handle is frozen, and its functions are not',
      edits: [
        {
          file: 'src/lib/v1/req.svelte.ts',
          from: '  return sealInterface({',
          to: '  return Object.freeze({'
        }
      ]
    },
    {
      id: 'C8-relay-diagnostics-unsealed',
      arm: 'PB13',
      describe: '`useRelayDiagnostics()` hands out an open object',
      edits: [
        {
          file: 'src/lib/v1/diagnostics.svelte.ts',
          from: '  return sealInterface({',
          to: '  return ({'
        }
      ]
    },
    {
      id: 'C8-seal-skips-getters',
      arm: 'PB13',
      describe: '`sealInterface` leaves each getter’s function open',
      edits: [
        {
          file: 'src/lib/v1/owned.ts',
          from: '    if (member?.get !== undefined) Object.freeze(member.get);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-seal-skips-commands',
      arm: 'PB13',
      describe: '`sealInterface` leaves each command’s function open',
      edits: [
        {
          file: 'src/lib/v1/owned.ts',
          from: "    if (typeof member?.value === 'function') Object.freeze(member.value);\n",
          to: ''
        }
      ]
    },
    {
      id: 'C8-outlet-events-open',
      arm: 'PB13',
      describe: 'the `events` outlet’s argument is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/components/RequestOutlets.svelte',
          from: '{@render events(Object.freeze({ events: shown, request }))}',
          to: '{@render events({ events: shown, request })}'
        }
      ]
    },
    {
      id: 'C8-outlet-event-open',
      arm: 'PB13',
      describe: 'the `event` outlet’s argument is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/components/RequestOutlets.svelte',
          from: '{@render event?.(Object.freeze({ event: shown[0], request }))}',
          to: '{@render event?.({ event: shown[0], request })}'
        }
      ]
    },
    {
      id: 'C8-outlet-loading-open',
      arm: 'PB13',
      describe: 'the `loading` outlet’s argument is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/components/RequestOutlets.svelte',
          from: '{@render loading?.(Object.freeze({ request }))}',
          to: '{@render loading?.({ request })}'
        }
      ]
    },
    {
      id: 'C8-outlet-error-open',
      arm: 'PB13',
      describe: 'the `error` outlet’s argument is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/components/RequestOutlets.svelte',
          from: '{@render error?.(Object.freeze({ request, error: outlet.error }))}',
          to: '{@render error?.({ request, error: outlet.error })}'
        }
      ]
    },
    {
      id: 'C8-accumulator-contract-open',
      arm: 'PB13',
      describe: 'an `AccumulatorContractError` is left unfrozen by its constructor',
      edits: [
        {
          file: 'src/lib/v1/attempt.ts',
          from: "    this.code = 'accumulator-contract';\n    if (cause !== undefined) (this as { cause?: ReqError }).cause = cause;\n    hardenOwned(this);\n    Object.freeze(this);",
          to: "    this.code = 'accumulator-contract';\n    if (cause !== undefined) (this as { cause?: ReqError }).cause = cause;\n    hardenOwned(this);"
        }
      ]
    },
    {
      id: 'C8-missing-provider-open',
      arm: 'PB13',
      describe: 'a `MissingProviderError` is left unfrozen by its constructor',
      edits: [
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: "    (this as { name: string }).name = 'MissingProviderError';\n    hardenOwned(this);\n    Object.freeze(this);",
          to: "    (this as { name: string }).name = 'MissingProviderError';\n    hardenOwned(this);"
        }
      ]
    },
    {
      id: 'C8-invalid-descriptor-open',
      arm: 'PB13',
      describe: 'an `InvalidDescriptorError` is left unfrozen by its constructor',
      edits: [
        {
          file: 'src/lib/v1/normalize.ts',
          from: '    // object can be the answer to several requests.\n    Object.freeze(this);',
          to: '    // object can be the answer to several requests.'
        }
      ]
    },
    {
      id: 'C8-relay-message-cut-open',
      arm: 'PB13',
      describe: 'a relay’s message cut at its bound is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/normalize.ts',
          from: '  return Object.freeze({ text: kept, truncated: true });',
          to: '  return ({ text: kept, truncated: true });'
        }
      ]
    },
    {
      id: 'C8-relay-message-rendered-open',
      arm: 'PB13',
      describe:
        'a relay’s message rendered from a value that was not text, and cut, is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/normalize.ts',
          from: '  return Object.freeze({ text: `${kept}… (cut)`, truncated: true });',
          to: '  return ({ text: `${kept}… (cut)`, truncated: true });'
        }
      ]
    },
    {
      id: 'C8-send-unanswered-open',
      arm: 'PB13',
      describe: 'a send’s outcome for a relay that never answered is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "        return Object.freeze({ relay, outcome: aborted ? 'aborted' : 'no-response' });",
          to: "        return ({ relay, outcome: aborted ? 'aborted' : 'no-response' });"
        }
      ]
    },
    {
      id: 'C8-no-relays-open',
      arm: 'PB13',
      describe: 'the empty map diagnostics answer after their provider is gone is left unfrozen',
      edits: [
        {
          file: 'src/lib/v1/diagnostics.svelte.ts',
          from: 'const NO_RELAYS: RelayDiagnostics = Object.freeze(Object.create(null) as RelayDiagnostics);',
          to: 'const NO_RELAYS: RelayDiagnostics = Object.create(null) as RelayDiagnostics;'
        }
      ]
    },
    {
      id: 'C8-state-events-writable',
      arm: 'PB13',
      describe: 'a streaming state’s `events` is not `readonly`',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: "  | { readonly status: 'streaming'; readonly events: readonly ReqEvent[] }",
          to: "  | { readonly status: 'streaming'; events: readonly ReqEvent[] }"
        }
      ]
    },
    {
      id: 'C8-state-events-mutable',
      arm: 'PB13',
      describe: 'a streaming state’s `events` is a mutable list',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: "  | { readonly status: 'streaming'; readonly events: readonly ReqEvent[] }",
          to: "  | { readonly status: 'streaming'; readonly events: ReqEvent[] }"
        }
      ]
    },
    {
      id: 'C8-refresh-a-method',
      arm: 'PB13',
      describe: '`ReqHandle.refresh` is declared as a method',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: '  readonly refresh: () => Promise<RefreshOutcome>;',
          to: '  refresh(): Promise<RefreshOutcome>;'
        }
      ]
    },
    {
      id: 'C8-refusals-mutable',
      arm: 'PB13',
      describe: '`ReqDiagnostics.refusals` is a mutable list',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: "  /** Every relay that refused, with what it said. A5's fifth event. */\n  readonly refusals: readonly Refusal[];",
          to: "  /** Every relay that refused, with what it said. A5's fifth event. */\n  readonly refusals: Refusal[];"
        }
      ]
    },
    {
      id: 'C8-causes-mutable',
      arm: 'PB13',
      describe: '`IncompleteCauses` is a mutable tuple',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: 'export type IncompleteCauses = readonly [IncompleteCause, ...IncompleteCause[]];',
          to: 'export type IncompleteCauses = [IncompleteCause, ...IncompleteCause[]];'
        }
      ]
    },
    {
      id: 'C8-outcome-causes-writable',
      arm: 'PB13',
      describe: 'an incomplete outcome’s members are not `readonly`',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: "  | { readonly kind: 'incomplete'; readonly causes: IncompleteCauses }",
          to: "  | { kind: 'incomplete'; causes: IncompleteCauses }"
        }
      ]
    },
    {
      id: 'C8-refusal-reason-writable',
      arm: 'PB13',
      describe: '`Refusal.reason` is not `readonly`',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  /** What the relay said, by NIP-01's vocabulary. See {@link classifyRefusal}. */\n  readonly reason: RefusalReason;",
          to: "  /** What the relay said, by NIP-01's vocabulary. See {@link classifyRefusal}. */\n  reason: RefusalReason;"
        }
      ]
    },
    {
      id: 'C8-error-variant-field-writable',
      arm: 'PB13',
      describe: 'one variant’s `field` in the published error union is not `readonly`',
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly code: 'invalid-descriptor';\n      readonly field: string;",
          to: "      readonly code: 'invalid-descriptor';\n      field: string;"
        }
      ]
    },
    {
      id: 'C8-urls-mutable',
      arm: 'PB13',
      describe: '`RelayConfigurationError.urls` is a mutable list',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: '  readonly code: RelayConfigurationErrorCode;\n  readonly urls: readonly string[];',
          to: '  readonly code: RelayConfigurationErrorCode;\n  readonly urls: string[];'
        }
      ]
    },
    {
      id: 'C8-send-relays-mutable',
      arm: 'PB13',
      describe: '`SendResult.relays` is a mutable list',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '      readonly relays: readonly SendRelayOutcome[];',
          to: '      readonly relays: SendRelayOutcome[];'
        }
      ]
    },
    {
      id: 'C8-configured-urls-mutable',
      arm: 'PB13',
      describe: '`RelayDiagnostic.configuredUrls` is a mutable list',
      edits: [
        {
          file: 'src/lib/v1/diagnostics.svelte.ts',
          from: '  readonly configuredUrls: readonly string[];',
          to: '  readonly configuredUrls: string[];'
        }
      ]
    },
    {
      id: 'C8-relay-diagnostics-type-writable',
      arm: 'PB13',
      describe: '`useRelayDiagnostics()`’s `relays` is not `readonly`',
      edits: [
        {
          file: 'src/lib/v1/diagnostics.svelte.ts',
          from: 'export function useRelayDiagnostics(): {\n  readonly relays: RelayDiagnostics;',
          to: 'export function useRelayDiagnostics(): {\n  relays: RelayDiagnostics;'
        }
      ]
    },
    {
      id: 'C8-outlet-type-writable',
      arm: 'PB13',
      describe: 'an `events` outlet’s argument type has a writable `events`',
      edits: [
        {
          file: 'src/lib/v1/components/outlets.ts',
          from: 'export type Events = { readonly events: readonly ReqEvent[] };',
          to: 'export type Events = { events: readonly ReqEvent[] };'
        }
      ]
    },
    {
      id: 'C8-outlet-error-type-writable',
      arm: 'PB13',
      describe: 'the `error` outlet’s argument type has a writable `request`',
      edits: [
        {
          file: 'src/lib/v1/components/outlets.ts',
          from: '  error?: Snippet<[{ readonly request: ReqHandle; readonly error: ReqOutletError }]>;',
          to: '  error?: Snippet<[{ request: ReqHandle; readonly error: ReqOutletError }]>;'
        }
      ]
    },
    {
      id: 'C8-events-not-an-array',
      arm: 'PB13',
      describe: 'a settled state’s `events` is the mapped list that refuses its method slots',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: "      readonly status: 'settled';\n      readonly events: readonly ReqEvent[];",
          to: "      readonly status: 'settled';\n      readonly events: { readonly [K in keyof ReadonlyArray<ReqEvent>]: ReadonlyArray<ReqEvent>[K] };"
        }
      ]
    },
    {
      id: 'C8-causes-not-a-tuple',
      arm: 'PB13',
      describe: '`IncompleteCauses` is a read-only list rather than a non-empty tuple',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: 'export type IncompleteCauses = readonly [IncompleteCause, ...IncompleteCause[]];',
          to: 'export type IncompleteCauses = readonly IncompleteCause[];'
        }
      ]
    },
    {
      id: 'I-case-dropped',
      arm: 'PB13',
      describe: 'one case of the matrix is arranged and not checked',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: "        check('a send, settled', settledSend);",
          to: '        void settledSend;'
        }
      ]
    },
    {
      id: 'I-write-skips-redefinition',
      arm: 'PB13',
      describe: 'the Error write-back assigns and never redefines',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: "      Object.defineProperty(holder, key, { value: 'REDEFINED BY A CONSUMER' });",
          to: '      void key;'
        }
      ]
    },
    {
      id: 'I-members-skip-symbols',
      arm: 'PB13',
      describe: 'the Error write-back names string members alone',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: '    for (const key of Reflect.ownKeys(value)) {\n      paths.push([...path, key]);',
          to: '    for (const key of Object.getOwnPropertyNames(value)) {\n      paths.push([...path, key]);'
        }
      ]
    },
    {
      id: 'I-cache-reader-dropped',
      arm: 'PB13',
      describe: 'the Error write-back does not read the cache',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: "          ...(cache === undefined ? {} : { 'the cache': cache })\n",
          to: ''
        }
      ]
    },
    {
      id: 'I-code-dropped',
      arm: 'PB13',
      describe: 'one code’s Error is arranged and not counted',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: "        reached('relay-failed', held.value.diagnostics.legEnded?.error);\n",
          to: ''
        }
      ]
    },
    {
      id: 'I-union-not-walked',
      arm: 'PB13',
      describe: 'the probe walks no union variant',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      const fresh = new Set(constituents.filter((one) => !walked.has(one)));',
          to: '      const fresh = new Set<ts.Type>();'
        }
      ]
    },
    {
      id: 'I-method-result-not-walked',
      arm: 'PB13',
      describe: 'the probe does not walk what a method resolves with',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      visit(name, present(awaited), level + 1, `${guard}for (const ${name} of [${invoked}]) `);',
          to: '      void name; void invoked;'
        }
      ]
    },
    {
      id: 'I-no-cycle-claim',
      arm: 'PB13',
      describe: 'the probe walks a type it has already walked',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (walked.has(type) && !claimed && !callable(type)) return;',
          to: '    if (false) return;'
        }
      ]
    },
    {
      id: 'I-payload-not-reported',
      arm: 'PB13',
      describe: 'the probe passes over a collection’s payload without reporting it',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      throw new Error(`writesThrough: ${expression} holds a payload the probe does not walk`);',
          to: '      void 0;'
        }
      ]
    },
    {
      id: 'I-index-key-collides',
      arm: 'PB13',
      describe: 'the probe writes through an index signature under a key a member already has',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      while (named.has(free)) free = numeric ? `${free}9` : `${free}_`;',
          to: '      void named;'
        }
      ]
    },
    {
      id: 'I-judge-reads-no-for',
      arm: 'PB13',
      describe: 'the judge does not read through the `for` that binds a method’s result',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    while (ts.isIfStatement(guarded) || ts.isForOfStatement(guarded))',
          to: '    while (ts.isIfStatement(guarded) && !ts.isForOfStatement(guarded))'
        }
      ]
    },
    {
      id: 'I-read-only-collections-not-admitted',
      arm: 'PB13',
      describe: '`ReadonlyMap`’s operations are not admitted',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: "  'ReadonlyMap',\n",
          to: ''
        }
      ]
    },
    {
      id: 'C8-class-unsealed',
      arm: 'PB13',
      describe: 'one class this library publishes (`UnsupportedFilterError`) is left unsealed',
      edits: [
        {
          file: 'src/lib/v1/key.ts',
          from: 'sealClass(UnsupportedFilterError);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-subclass-unsealed',
      arm: 'PB13',
      describe: 'one subclass of the provider refusals (`InvalidRelayScopeError`) is left unsealed',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: 'sealClass(InvalidRelayScopeError);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-failure-class-unsealed',
      arm: 'PB13',
      describe: 'the class of an attempt’s failure (`ReqFailure`) is left unsealed',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: 'sealClass(ReqFailure);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-sealclass-skips-prototype',
      arm: 'PB13',
      describe: '`sealClass` leaves each prototype open',
      edits: [
        {
          file: 'src/lib/v1/owned.ts',
          from: '  sealInterface(constructor.prototype as object);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-outlet-single-nodata-open',
      arm: 'PB13',
      describe: 'the `nodata` outlet of a single-event component is handed an unfrozen argument',
      edits: [
        {
          file: 'src/lib/v1/components/RequestOutlets.svelte',
          from: "{:else if outlet.slot === 'nodata' || shown[0] === undefined}\n  {@render nodata?.(Object.freeze({ request }))}",
          to: "{:else if outlet.slot === 'nodata' || shown[0] === undefined}\n  {@render nodata?.({ request })}"
        }
      ]
    },
    {
      id: 'I-pub-no-extensible',
      arm: 'PB13',
      describe: 'the discipline does not ask whether an object is extensible',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '    if (Reflect.isExtensible(value)) found.push(`${path}: extensible`);',
          to: '    void 0;'
        }
      ]
    },
    {
      id: 'I-pub-no-writable',
      arm: 'PB13',
      describe: 'the discipline does not ask whether a slot is writable',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '        if (slot.writable === true) found.push(`${where}: writable`);',
          to: '        void 0;'
        }
      ]
    },
    {
      id: 'I-pub-no-configurable',
      arm: 'PB13',
      describe: 'the discipline does not ask whether a slot is configurable',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '      if (slot.configurable === true) found.push(`${where}: configurable`);',
          to: '      void 0;'
        }
      ]
    },
    {
      id: 'I-pub-no-setter',
      arm: 'PB13',
      describe: 'the discipline does not report an own setter',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '        found.push(`${where}: a setter`);\n',
          to: ''
        }
      ]
    },
    {
      id: 'I-pub-setter-function-not-walked',
      arm: 'PB13',
      describe: 'the discipline does not walk a setter’s function object',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: "        visit(slot.set, `${where} (its setter)`, 'function');",
          to: '        void 0;'
        }
      ]
    },
    {
      id: 'I-pub-accessors-admitted',
      arm: 'PB13',
      describe:
        'the discipline admits an accessor in a snapshot, and one an interface does not name',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '      if (!getter)\n        found.push(',
          to: '      if (false)\n        found.push('
        }
      ]
    },
    {
      id: 'I-pub-no-inherited-setter',
      arm: 'PB13',
      describe: 'the discipline does not read inherited setters',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '        if (!refusing) found.push(`${path}: inherits a setter, ${String(key)}`);',
          to: '        void refusing;'
        }
      ]
    },
    {
      id: 'I-pub-proto-setter-always-refusing',
      arm: 'PB13',
      describe:
        'the discipline takes `__proto__`’s setter as refusing on an extensible receiver too',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '          (slot.set === PROTO_SETTER && !Reflect.isExtensible(value));',
          to: '          slot.set === PROTO_SETTER;'
        }
      ]
    },
    {
      id: 'I-pub-chain-not-read',
      arm: 'PB13',
      describe: 'the discipline reads no link of a chain as an object',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '      if (!INTRINSIC.has(link))\n        visit(',
          to: '      if (false)\n        visit('
        }
      ]
    },
    {
      id: 'I-pub-chain-one-link',
      arm: 'PB13',
      describe: 'the discipline reads setters on the first link of a chain alone',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '      link = Reflect.getPrototypeOf(link)\n',
          to: '      link = null\n'
        }
      ]
    },
    {
      id: 'I-pub-intrinsic-error-dropped',
      arm: 'PB13',
      describe: '`Error`, the constructor, is not taken for the platform’s',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '  Error.prototype,\n  Error,\n',
          to: '  Error.prototype,\n'
        }
      ]
    },
    {
      id: 'I-pub-own-prototype-not-walked',
      arm: 'PB13',
      describe: 'the discipline does not walk a function’s own `prototype`',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: "          visit(held, where, 'prototype');",
          to: '          void 0;'
        }
      ]
    },
    {
      id: 'I-pub-proxy-not-reported',
      arm: 'PB13',
      describe: 'the discipline passes over a proxy without reporting it',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '      found.push(`${path}: a proxy`);\n      return;',
          to: '      return;'
        }
      ]
    },
    {
      id: 'I-pub-slots-admitted',
      arm: 'PB13',
      describe: 'the discipline admits host objects with internal state',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '      if (slotted !== undefined) {',
          to: '      if (false) {'
        }
      ]
    },
    {
      id: 'I-pub-any-error-admitted',
      arm: 'PB13',
      describe: 'the discipline admits any Error, not only this library’s',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '          (proto !== null && discipline.classes.has(proto));',
          to: '          value instanceof Error;'
        }
      ]
    },
    {
      id: 'I-pub-any-kind-admitted',
      arm: 'PB13',
      describe: 'the discipline admits an object of any class',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '      if (!admitted) {',
          to: '      if (false) {'
        }
      ]
    },
    {
      id: 'I-pub-any-interface-admitted',
      arm: 'PB13',
      describe: 'the discipline admits a live interface of any prototype',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '        ? proto === Object.prototype || proto === null\n',
          to: '        ? true\n'
        }
      ]
    },
    {
      id: 'I-pub-functions-admitted',
      arm: 'PB13',
      describe: 'the discipline admits a function in a snapshot',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '      found.push(`${path}: a function in a snapshot`);',
          to: '      void 0;'
        }
      ]
    },
    {
      id: 'I-pub-role-blind',
      arm: 'PB13',
      describe: 'an object reached in two roles is judged in the first alone',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '    if (roles.has(role)) return false;',
          to: '    if (roles.size > 0) return false;'
        }
      ]
    },
    {
      id: 'I-pub-unnamed-members-admitted',
      arm: 'PB13',
      describe: 'the discipline admits a data member an interface does not name',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '          if (!command) found.push(`${where}: a member the interface does not name`);',
          to: '          if (!command) void 0;'
        }
      ]
    },
    {
      id: 'I-pub-any-command-admitted',
      arm: 'PB13',
      describe: 'the discipline admits a command that is not a function',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '            found.push(`${where}: a command that is not a function`);',
          to: '            void 0;'
        }
      ]
    },
    {
      id: 'I-pub-absent-members-admitted',
      arm: 'PB13',
      describe: 'the discipline does not report a member an interface names and lacks',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '        if (!keys.includes(member)) found.push(`${path}.${member}: named and absent`);',
          to: '        void keys;'
        }
      ]
    },
    {
      id: 'I-pub-getter-output-not-walked',
      arm: 'PB13',
      describe: 'the discipline does not walk what a getter returns',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: "        visit(output, `${where}${read}`, 'value');",
          to: '        void output;'
        }
      ]
    },
    {
      id: 'I-pub-getter-read-once',
      arm: 'PB13',
      describe: 'the discipline reads each getter once',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: "      for (const read of ['', ' (read again)']) {",
          to: "      for (const read of ['']) {"
        }
      ]
    },
    {
      id: 'I-pub-getter-function-not-walked',
      arm: 'PB13',
      describe: 'the discipline does not walk a getter’s function object',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: "      visit(slot.get, `${where} (its getter)`, 'function');",
          to: '      void 0;'
        }
      ]
    },
    {
      id: 'I-pub-exemption-by-name',
      arm: 'PB13',
      describe: 'the exemption is a property name rather than one interface’s edge',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '      if (!getter || named.unwalked?.includes(key as string) === true) continue;',
          to: "      if (!getter || key === 'raw') continue;"
        }
      ]
    },
    {
      id: 'I-pub-skips-symbols',
      arm: 'PB13',
      describe: 'the discipline reads string keys alone',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '    const keys = Reflect.ownKeys(value);',
          to: '    const keys = Object.getOwnPropertyNames(value);'
        }
      ]
    },
    {
      id: 'I-pub-throwing-getter-unreported',
      arm: 'PB13',
      describe: 'a getter that throws is passed over without a finding',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '          found.push(`${where}${read}: a getter that throws`);\n',
          to: ''
        }
      ]
    },
    {
      id: 'I-standard-members-not-written',
      arm: 'PB13',
      describe: 'the probe writes to none of the members every value has',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      const access = accessOf(expression, property);\n      writes.push(`${guard}${access} = ${access}!;`);\n    }\n  };',
          to: '      void accessOf;\n    }\n  };'
        }
      ]
    },
    {
      id: 'I-standard-function-members-skipped',
      arm: 'PB13',
      describe: 'the probe writes to `Object`’s members alone, not a function’s',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    for (const property of [...objectMembers, ...(callable(type) ? functionMembers : [])]) {',
          to: '    for (const property of [...objectMembers]) {'
        }
      ]
    },
    {
      id: 'I-exception-object-only',
      arm: 'PB13',
      describe: 'the judge takes `Object`’s members alone for the exception',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: "      ...(callable ? ['Function', 'CallableFunction', 'NewableFunction'] : []),\n",
          to: ''
        }
      ]
    },
    {
      id: 'I-exception-any-library-member',
      arm: 'PB13',
      describe: 'the judge takes any member the default library declares for the exception',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '          declaring.includes(one.parent.name.text)\n',
          to: '          declaring.length >= 0\n'
        }
      ]
    },
    {
      id: 'I-list-not-array-unreported',
      arm: 'PB13',
      describe: 'the probe passes a list that is not an array without reporting it',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      throw new Error(`writesThrough: ${expression} is indexed by number and is not an array`);',
          to: '      void 0;'
        }
      ]
    },
    {
      id: 'I-snippet-first-argument-only',
      arm: 'PB13',
      describe: 'the probe walks the first argument a prop is handed alone',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    for (const [position, argument] of handed.entries()) {',
          to: '    for (const [position, argument] of handed.slice(0, 1).entries()) {'
        }
      ]
    },
    {
      id: 'C8-decision-reads-instanceof',
      arm: 'PB13',
      describe: 'the refused cache key decides by `instanceof` again',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '  if (!isRelayNotInScope(rejection)) return undefined;',
          to: '  if (!isRelayNotInScope(rejection) || !(rejection instanceof Error)) return undefined;'
        }
      ]
    },
    {
      id: 'I-hooks-not-walked',
      arm: 'PB13',
      describe: 'what two of the three hooks answer is not walked',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: '    ...MAIN_SURFACE.hooks.map((hook) => `ReturnType<typeof Published.${hook}>`),',
          to: '    ...MAIN_SURFACE.hooks.slice(0, 1).map((hook) => `ReturnType<typeof Published.${hook}>`),'
        }
      ]
    },
    {
      id: 'I-method-taken-for-data',
      arm: 'PB13',
      describe: 'the probe takes a command for data',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: "    if (callable(type) && callables === 'api' && ours(type) && command) {",
          to: '    if (false) {'
        }
      ]
    },
    {
      id: 'I-commands-everywhere',
      arm: 'PB13',
      describe: 'the probe takes every function for a command',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    const command =\n      level === 0 ||',
          to: '    const command =\n      true ||'
        }
      ]
    },
    {
      id: 'I-overloads-walked',
      arm: 'PB13',
      describe: 'the probe walks the first signature of an overloaded command',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      if (signatures.length !== 1 || call === undefined)',
          to: '      if (call === undefined)'
        }
      ]
    },
    {
      id: 'I-snippets-deduped-away',
      arm: 'PB13',
      describe: 'the outlets’ arguments are cut to the first one found',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      if (seen.has(argument)) continue;',
          to: '      if (seen.size > 0) continue;'
        }
      ]
    },
    {
      id: 'I-function-members-not-walked',
      arm: 'PB13',
      describe: 'the probe does not walk a command’s own members',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      members(expression, type, level, false, guard);\n      indexes(expression, type, level, guard);\n      standardMembers(expression, type, guard);\n      const returned',
          to: '      indexes(expression, type, level, guard);\n      standardMembers(expression, type, guard);\n      const returned'
        }
      ]
    },
    {
      id: 'I-lists-not-collected',
      arm: 'PB13',
      describe: 'the consumer’s checks are handed no list site',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      lists.push({ guard, expression, tuple: checker.isTupleType(type) });\n',
          to: ''
        }
      ]
    },
    {
      id: 'I-tuples-not-told',
      arm: 'PB13',
      describe: 'the consumer’s checks are told no list is a tuple',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      lists.push({ guard, expression, tuple: checker.isTupleType(type) });',
          to: '      lists.push({ guard, expression, tuple: false });'
        }
      ]
    },
    {
      id: 'I-spec-unchecked',
      arm: 'PB13',
      describe: '`useReq()`’s interface is not checked against `ReqHandle`',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: "      expect(named(REQ_HANDLE), 'useReq()’s handle is `ReqHandle`').toEqual(",
          to: "      expect(named(REQ_HANDLE), 'useReq()’s handle is `ReqHandle`').not.toEqual("
        }
      ]
    },
    {
      id: 'C8-outlet-event-never-rendered',
      arm: 'PB13',
      describe: 'a single-event component never renders its `event` outlet',
      edits: [
        {
          file: 'src/lib/v1/components/RequestOutlets.svelte',
          from: "{:else if outlet.slot === 'nodata' || shown[0] === undefined}",
          to: '{:else if true}'
        }
      ]
    },
    {
      id: 'C8-class-static',
      arm: 'PB13',
      describe: 'a class this library publishes gains a static member of its own',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: 'export class RelayConfigurationError extends Error {\n',
          to: 'export class RelayConfigurationError extends Error {\n  static registry: Record<string, unknown> = {};\n'
        }
      ]
    },
    {
      id: 'I-exception-table-shrunk',
      arm: 'PB13',
      describe: 'the exception’s pinned table loses one member',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: "  '.apply',\n",
          to: ''
        }
      ]
    },
    {
      id: 'C8-retired-phrase-back',
      arm: 'PB13',
      describe:
        'a phrase a replaced design was described in is written back into a library comment',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: '   * same call. The members TypeScript declares on every function',
          to: '   * same call (once a standard method slot). The members TypeScript declares on every function'
        }
      ]
    },
    {
      id: 'I-pub-function-prototype-admitted',
      arm: 'PB13',
      describe: 'the discipline admits a function as a function’s own `prototype`',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: "          if (typeof held === 'function') found.push(`${where}: a function as a prototype`);\n",
          to: ''
        }
      ]
    },
    {
      id: 'I-pub-prototype-members-admitted',
      arm: 'PB13',
      describe: 'the discipline admits any member on a library prototype',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: "          if (key !== 'constructor') found.push(`${where}: a member every instance inherits`);\n          else if (",
          to: '          if (false) void 0;\n          else if ('
        }
      ]
    },
    {
      id: 'I-pub-impostor-constructor-admitted',
      arm: 'PB13',
      describe: 'the discipline admits a prototype whose `constructor` is not its class',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '          else if (library !== undefined && held !== library)',
          to: '          else if (false)'
        }
      ]
    },
    {
      id: 'I-pub-inherited-methods-not-walked',
      arm: 'PB13',
      describe: 'the discipline does not walk a prototype’s functions',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: "          if (typeof held === 'function') visit(held, where, 'function');\n        } else {",
          to: '          void held;\n        } else {'
        }
      ]
    },
    {
      id: 'I-promise-required-dropped',
      arm: 'PB13',
      describe: 'the probe admits a command that returns no promise',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '        if (!platform)\n',
          to: '        if (false)\n'
        }
      ]
    },
    {
      id: 'I-promise-index-unreported',
      arm: 'PB13',
      describe: 'the probe passes a command’s promise with an index signature',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '        if (checker.getIndexInfosOfType(alternative).length > 0)\n          throw new Error(',
          to: '        if (false)\n          throw new Error('
        }
      ]
    },
    {
      id: 'I-promise-members-unreported',
      arm: 'PB13',
      describe: 'the probe passes a command’s promise with members of its own',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '        if (own.length > 0)\n',
          to: '        if (false)\n'
        }
      ]
    },
    {
      id: 'I-command-indexes-unwalked',
      arm: 'PB13',
      describe: 'the probe does not write through a command’s index signature',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      members(expression, type, level, false, guard);\n      indexes(expression, type, level, guard);\n      standardMembers(expression, type, guard);\n      const returned',
          to: '      members(expression, type, level, false, guard);\n      standardMembers(expression, type, guard);\n      const returned'
        }
      ]
    },
    {
      id: 'I-commands-by-name',
      arm: 'PB13',
      describe: 'a command is matched by its name alone, on any holder',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: "          one.includes('.') ? one === member : one === member.split('.').pop()",
          to: "          one.split('.').pop() === member.split('.').pop()"
        }
      ]
    },
    {
      id: 'I-snippet-variants-ignored',
      arm: 'PB13',
      describe: 'the probe reads the props one variant of a union shares alone',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    const variants = type.isUnion() ? type.types : [type];\n    const held',
          to: '    const variants = [type];\n    const held'
        }
      ]
    },
    {
      id: 'I-snippet-constructors-ignored',
      arm: 'PB13',
      describe: 'the probe reads no prop that is a class',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (held.getCallSignatures().length + held.getConstructSignatures().length > 0) {',
          to: '    if (held.getCallSignatures().length > 0) {'
        },
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '        else if (alternative.getConstructSignatures().length > 0)\n',
          to: '        else if (false)\n'
        }
      ]
    },
    {
      id: 'I-snippet-any-admitted',
      arm: 'PB13',
      describe: 'the probe passes a prop typed `any`',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (held.getFlags() & (ts.TypeFlags.Any | ts.TypeFlags.Unknown))\n      throw new Error(',
          to: '    if (false)\n      throw new Error('
        }
      ]
    },
    {
      id: 'I-callbacks-skipped',
      arm: 'PB13',
      describe: 'the probe reads Svelte’s `Snippet` props alone, not a callback',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (held.getCallSignatures().length + held.getConstructSignatures().length > 0) {',
          to: "    if ((held.getSymbol()?.getName() === 'Snippet' ? held.getCallSignatures().length : 0) + held.getConstructSignatures().length > 0) {"
        },
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '        if (alternative.getCallSignatures().length > 0)\n',
          to: "        if (alternative.getSymbol()?.getName() === 'Snippet' && alternative.getCallSignatures().length > 0)\n"
        }
      ]
    },
    {
      id: 'C8-promise-carries-members',
      arm: 'PB13',
      describe: '`useReq()`’s `refresh()` returns a promise with a member of its own',
      edits: [
        {
          file: 'src/lib/v1/req.svelte.ts',
          from: '    refresh: () => handle.refresh()',
          to: '    refresh: () => Object.assign(handle.refresh(), { progress: [] as string[] })'
        }
      ]
    },
    {
      id: 'C8-brand-without-ownership',
      arm: 'PB13',
      describe: 'the brand a refusal’s cache key reads answers for an instance a consumer built',
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: '  RELAY_NOT_IN_SCOPE.has(value) &&\n  isOwnedByLibrary(value);',
          to: '  RELAY_NOT_IN_SCOPE.has(value);\nvoid isOwnedByLibrary;'
        }
      ]
    },
    {
      id: 'C8-provider-brand-without-ownership',
      arm: 'PB13',
      describe: 'the brand the provider reads answers for a refusal a consumer built',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: '  RELAY_CONFIGURATION_REFUSALS.has(value) &&\n  isOwnedByLibrary(value);',
          to: '  RELAY_CONFIGURATION_REFUSALS.has(value);'
        }
      ]
    },
    {
      id: 'C8-class-static-platform-name',
      arm: 'PB13',
      describe: 'a class this library publishes declares a static under a name the platform uses',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: 'export class RelayConfigurationError extends Error {\n',
          to: 'export class RelayConfigurationError extends Error {\n  static override isError(value: unknown): value is Error {\n    return value instanceof Error;\n  }\n'
        }
      ]
    },
    {
      id: 'I-lists-after-dedupe',
      arm: 'PB13',
      describe: 'a list site is recorded only where the walk first meets its type',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (checker.isArrayType(type) || checker.isTupleType(type))\n      lists.push(',
          to: '    if ((checker.isArrayType(type) || checker.isTupleType(type)) && !walked.has(type))\n      lists.push('
        }
      ]
    },
    {
      id: 'I-callables-deduped',
      arm: 'PB13',
      describe: 'a function type is classified only where the walk first meets it',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (walked.has(type) && !claimed && !callable(type)) return;',
          to: '    if (walked.has(type) && !claimed) return;'
        },
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (!type.isUnion() && !callable(type)) walked.add(type);',
          to: '    if (!type.isUnion()) walked.add(type);'
        }
      ]
    },
    {
      id: 'I-promise-common-members-only',
      arm: 'PB13',
      describe: 'the probe asks a union of promises for the members every alternative shares',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      for (const alternative of returned.isUnion() ? returned.types : [returned]) {',
          to: '      for (const alternative of [returned]) {'
        }
      ]
    },
    {
      id: 'I-handed-lists-skipped',
      arm: 'PB13',
      describe: 'the reader of what is handed out reads no list or tuple',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (checker.isArrayType(held) || checker.isTupleType(held)) {\n      for',
          to: '    if (false) {\n      for'
        }
      ]
    },
    {
      id: 'I-handed-union-callables-skipped',
      arm: 'PB13',
      describe: 'the reader of what is handed out reads no callback that is a union’s alternative',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '        if (alternative.getCallSignatures().length > 0)\n',
          to: '        if (false)\n'
        }
      ]
    },
    {
      id: 'I-handed-depth-unbounded',
      arm: 'PB13',
      describe: 'the reader of what is handed out has no depth',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (depth > 4)',
          to: '    if (false)'
        }
      ]
    },
    {
      id: 'I-handed-depth-silent',
      arm: 'PB13',
      describe: 'the reader of what is handed out stops at its depth without reporting',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    if (depth > 4) throw new Error(`handedArgumentsOf: ${label} is deeper than the probe reads`);',
          to: '    if (depth > 4) return;'
        }
      ]
    },
    {
      id: 'I-handed-callable-members-unread',
      arm: 'PB13',
      describe: 'the reader of what is handed out reads nothing a callback holds',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      handedBy(held, text, label);\n      read(held, text, label, depth);\n',
          to: '      handedBy(held, text, label);\n'
        }
      ]
    },
    {
      id: 'I-handed-exemption-anywhere',
      arm: 'PB13',
      describe: 'the signer’s exemption takes any type under its name',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: "      (named.getDeclarations() ?? []).some((one) =>\n        one.getSourceFile().fileName.includes('/src/lib/v1/')\n      )",
          to: '      true'
        }
      ]
    },
    {
      id: 'I-handed-exemption-none',
      arm: 'PB13',
      describe: 'the signer’s exemption is never met',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      theirs.has(named.getName()) &&',
          to: '      false &&'
        }
      ]
    },
    {
      id: 'C8-hook-overloaded',
      arm: 'PB13',
      describe: '`useReq` gains a second signature whose answer has a mutable list',
      edits: [
        {
          file: 'src/lib/v1/req.svelte.ts',
          from: 'export function useReq(plan: () => ReqPlan): ReqHandle {',
          to: 'export function useReq(plan: () => ReqPlan, trace: true): ReqHandle & { readonly trace: string[] };\nexport function useReq(plan: () => ReqPlan): ReqHandle;\nexport function useReq(plan: () => ReqPlan): ReqHandle {'
        }
      ]
    },
    {
      id: 'C8-hook-parameter-callback',
      arm: 'PB13',
      describe: '`useReq`’s plan is handed a value with a mutable list',
      edits: [
        {
          file: 'src/lib/v1/req.svelte.ts',
          from: 'export function useReq(plan: () => ReqPlan): ReqHandle {',
          to: 'export function useReq(plan: (previous?: { events: string[] }) => ReqPlan): ReqHandle {'
        }
      ]
    },
    {
      id: 'C8-command-parameter-callback',
      arm: 'PB13',
      describe: '`refresh` takes a callback handed a value with a mutable list',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: '  readonly refresh: () => Promise<RefreshOutcome>;',
          to: '  readonly refresh: (progress?: (seen: { ids: string[] }) => void) => Promise<RefreshOutcome>;'
        }
      ]
    },
    {
      id: 'C8-provider-props-shadowed',
      arm: 'PB13',
      describe: '`NostrApp` annotates its props with a local type under the outlet type’s name',
      edits: [
        {
          file: 'src/lib/v1/components/NostrApp.svelte',
          from: "  import type { NostrAppProps } from './outlets.js';",
          to: "  import type { NostrAppProps as Given } from './outlets.js';\n  type NostrAppProps = Given & { onrefused?: (refusal: { urls: string[] }) => void };"
        }
      ]
    },
    {
      id: 'C8-provider-callback-prop',
      arm: 'PB13',
      describe: '`NostrApp` gains a callback prop handed a value with a mutable list',
      edits: [
        {
          file: 'src/lib/v1/components/outlets.ts',
          from: '  signer?: NostrSigner;\n',
          to: '  signer?: NostrSigner;\n  onrefused?: (refusal: { urls: string[] }) => void;\n'
        }
      ]
    },
    {
      id: 'C8-refused-promise-carries-members',
      arm: 'PB13',
      describe:
        '`useReq()`’s `refresh()` returns a promise with a member of its own on the error path alone',
      edits: [
        {
          file: 'src/lib/v1/req.svelte.ts',
          from: '    refresh: () => handle.refresh()',
          to: "    refresh: () =>\n      handle.state.status === 'error'\n        ? Object.assign(handle.refresh(), { progress: [] as number[] })\n        : handle.refresh()"
        }
      ]
    },
    {
      id: 'I-pub-constructor-class-unwalked',
      arm: 'PB13',
      describe: 'the discipline does not walk the class a prototype holds',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: "          if (typeof held === 'function') visit(held, where, 'function');",
          to: "          if (typeof held === 'function' && key !== 'constructor') visit(held, where, 'function');"
        }
      ]
    },
    {
      id: 'I-pub-chain-string-keys',
      arm: 'PB13',
      describe: 'the discipline reads a chain’s string-keyed setters alone',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '      for (const key of Reflect.ownKeys(link)) {',
          to: '      for (const key of Object.getOwnPropertyNames(link)) {'
        }
      ]
    },
    {
      id: 'C8-entry-hook-closed',
      arm: 'PB13',
      describe: '`useReq` is frozen where the entry exports it',
      edits: [
        {
          file: 'src/lib/v1/req.svelte.ts',
          from: 'export function useReq(plan: () => ReqPlan): ReqHandle {',
          to: 'Object.freeze(useReq);\nexport function useReq(plan: () => ReqPlan): ReqHandle {'
        }
      ]
    },
    {
      id: 'I-pub-function-setters-refusing',
      arm: 'PB13',
      describe: 'the discipline takes every setter on `Function.prototype` as refusing',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '          (link === Function.prototype && RESTRICTED_SETTERS.has(slot.set)) ||',
          to: '          link === Function.prototype ||'
        }
      ]
    },
    {
      id: 'I-props-bound-twice-admitted',
      arm: 'PB13',
      describe: 'the props premise admits a name bound twice across the scripts',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/components.ts',
          from: '  if (bound.length !== 1 || binding === undefined) return undefined;',
          to: '  if (binding === undefined) return undefined;'
        }
      ]
    },
    {
      id: 'I-props-module-unread',
      arm: 'PB13',
      describe: 'the props premise reads the instance script alone',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/components.ts',
          from: '  const scripts = module === undefined ? [instance] : [instance, module];',
          to: '  const scripts = [instance];'
        }
      ]
    },
    {
      id: 'I-props-any-source',
      arm: 'PB13',
      describe: 'the props premise admits an import from anywhere',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/components.ts',
          from: "    declaration?.source?.value === './outlets.js'",
          to: '    declaration !== undefined'
        }
      ]
    },
    {
      id: 'I-props-alias-admitted',
      arm: 'PB13',
      describe: 'the props premise admits an aliased import',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/components.ts',
          from: '    specifier.imported?.name === name &&\n',
          to: ''
        }
      ]
    },
    {
      id: 'I-props-read-twice-admitted',
      arm: 'PB13',
      describe: 'the props premise admits a second `$props()`',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/components.ts',
          from: '  if (calls.length !== 1 || only === undefined) return undefined;',
          to: '  if (only === undefined) return undefined;'
        }
      ]
    },
    {
      id: 'I-handed-index-unread',
      arm: 'PB13',
      describe: 'the reader of what is handed out reads no index signature',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    for (const variant of held)\n      for (const index of checker.getIndexInfosOfType(variant)) {',
          to: '    for (const variant of held)\n      for (const index of [] as readonly ts.IndexInfo[]) {'
        }
      ]
    },
    {
      id: 'I-handed-number-key-never',
      arm: 'PB13',
      describe: 'the reader looks a numeric key up by its text alone again, and finds `never`',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '    return `NonNullable<(${text}) extends infer V ? (V extends unknown ? (${key} extends \\`\\${Exclude<keyof V, symbol>}\\` ? (V extends { readonly [K in ${key}]?: infer E } ? E : never) : never) : never) : never>`;',
          to: '    return `NonNullable<(${text}) extends infer V ? (V extends unknown ? (${key} extends keyof V ? V[${key}] : never) : never) : never>`;'
        }
      ]
    },
    {
      id: 'I-handed-symbol-unreported',
      arm: 'PB13',
      describe: 'the reader passes a symbol-keyed member without reporting it',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: "      if ((property.getEscapedName() as string).startsWith('__@'))\n",
          to: '      if (false)\n'
        }
      ]
    },
    {
      id: 'I-handed-rest-unexpanded',
      arm: 'PB13',
      describe: 'the reader counts a rest tuple as one argument',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '        handed.push(...checker.getTypeArguments(type as ts.TypeReference));',
          to: '        handed.push(type);'
        }
      ]
    },
    {
      id: 'I-pub-classless-admitted',
      arm: 'PB13',
      describe: 'the discipline admits a library prototype without its class',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: "      else if (!keys.includes('constructor')) found.push(`${path}: a prototype without its class`);",
          to: "      else if (!keys.includes('constructor')) void 0;"
        }
      ]
    },
    {
      id: 'C8-exported-class-classless',
      arm: 'PB13',
      describe: '`RelayConfigurationError`’s prototype loses its `constructor` before sealing',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: 'sealClass(RelayConfigurationError);\n',
          to: "Reflect.deleteProperty(RelayConfigurationError.prototype, 'constructor');\nsealClass(RelayConfigurationError);\n"
        }
      ]
    },
    {
      id: 'C8-class-classless',
      arm: 'PB13',
      describe: '`UnsupportedFilterError`’s prototype loses its `constructor` before sealing',
      edits: [
        {
          file: 'src/lib/v1/key.ts',
          from: 'sealClass(UnsupportedFilterError);\n',
          to: "Reflect.deleteProperty(UnsupportedFilterError.prototype, 'constructor');\nsealClass(UnsupportedFilterError);\n"
        }
      ]
    },
    {
      id: 'C8-refresh-reuses-pending',
      arm: 'PB13',
      describe: '`useReq()`’s `refresh()` hands every caller the pending promise until it settles',
      edits: [
        {
          file: 'src/lib/v1/req.svelte.ts',
          from: '    refresh: () => handle.refresh()',
          to: '    refresh: (() => {\n      let pending: Promise<unknown> | undefined;\n      return () =>\n        (pending ??= handle.refresh().finally(() => {\n          pending = undefined;\n        }));\n    })() as never'
        }
      ]
    },
    {
      id: 'I-pub-foreign-prototype-admitted',
      arm: 'PB13',
      describe:
        "the discipline admits a prototype on a chain that is not one of this library's classes",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: "      if (library === undefined) found.push(`${path}: a prototype that is not this library's`);",
          to: '      if (library === undefined) void 0;'
        }
      ]
    },
    {
      id: 'I-pub-foreign-chain-function-admitted',
      arm: 'PB13',
      describe:
        "the discipline admits a function on a chain that is not one of this library's classes",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: "    if (role === 'prototype' && isFunction && !classes.has(value))",
          to: '    if (false)'
        }
      ]
    },
    {
      id: 'I-pub-constructor-judged-by-its-prototype',
      arm: 'PB13',
      describe:
        "the discipline takes a prototype's `constructor` for its class when its own `prototype` is that prototype",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/publication.ts',
          from: '          else if (library !== undefined && held !== library)',
          to: "          else if (\n            typeof held !== 'function' ||\n            Reflect.getOwnPropertyDescriptor(held, 'prototype')?.value !== value\n          )"
        }
      ]
    },
    {
      id: 'C8-signer-compared-against-its-copy',
      arm: 'PB13',
      describe:
        "a send compares the signer's event with the template the signer was handed, not its own frozen copy",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  if (!isTheTemplate(copy, expected)) {',
          to: '  if (!isTheTemplate(copy, handed)) {'
        }
      ]
    },
    {
      id: 'C8-signer-one-template',
      arm: 'PB13',
      describe: 'every send hands the signer one template object, refilled',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: 'async function signedEventOf(',
          to: "const HANDED = { kind: 0, content: '', tags: [] as string[][], created_at: 0 };\nasync function signedEventOf("
        },
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  const handed = {\n',
          to: '  const handed = Object.assign(HANDED, {\n'
        },
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '    created_at: expected.created_at\n  };',
          to: '    created_at: expected.created_at\n  });'
        }
      ]
    },
    {
      id: 'C8-signed-send-promise-carries-members',
      arm: 'PB13',
      describe: 'the promise a send of a signed event returns carries a member of its own',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  return Object.freeze((input: SendInput, options?: SendOptions) =>\n    sendThrough(port, input, options)\n  );',
          to: "  return Object.freeze((input: SendInput, options?: SendOptions) =>\n    'sig' in input\n      ? Object.assign(sendThrough(port, input, options), { progress: [] as string[] })\n      : sendThrough(port, input, options)\n  );"
        }
      ]
    },
    {
      id: 'I-signer-case-dropped',
      arm: 'PB13',
      describe: 'the send its signer refused is arranged and not checked',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: "        check('a send, refused by its signer', first);\n",
          to: ''
        }
      ]
    },
    {
      id: 'I-twins-never-shared',
      arm: 'PB13',
      describe: 'no Error two hooks on one descriptor read is written to',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: '          if (errorOf(twin) === errorOf(hook)) {',
          to: '          if (false) {'
        }
      ]
    },
    {
      id: 'I-unshared-not-recorded',
      arm: 'PB13',
      describe: 'a code two hooks on one descriptor do not share is not recorded',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: '          } else unshared.push(`${code}${door}`);',
          to: '          } else void 0;'
        }
      ]
    },
    {
      id: 'C8-provider-props-generic',
      arm: 'PB13',
      describe:
        "`NostrApp` declares a type parameter under its props type's name, with a callback the library calls with a mutable list",
      edits: [
        {
          file: 'src/lib/v1/components/NostrApp.svelte',
          from: '<script lang="ts">\n',
          to: '<script lang="ts" generics="NostrAppProps extends import(\'./outlets.js\').NostrAppProps & { onready?: (value: { mutable: number[] }) => void }">\n'
        },
        {
          file: 'src/lib/v1/components/NostrApp.svelte',
          from: '  let { relays = [], signer, children }: NostrAppProps = $props();',
          to: '  let { relays = [], signer, children, onready }: NostrAppProps = $props();'
        },
        {
          file: 'src/lib/v1/components/NostrApp.svelte',
          from: '  setNostrContext(context);\n',
          to: '  setNostrContext(context);\n  onready?.({ mutable: [] });\n'
        }
      ]
    },
    {
      id: 'I-props-generics-admitted',
      arm: 'PB13',
      describe: 'the props premise passes a component with a `generics` attribute',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/components.ts',
          from: "attribute.name === 'generics'",
          to: "attribute.name === 'not-generics'"
        }
      ]
    },
    {
      id: 'I-handed-unknown-member-hidden',
      arm: 'PB13',
      describe:
        'the reader of what is handed out strips nullability from a member before it asks whether it is `unknown`',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '        readHeld(\n          present(checker.getTypeOfSymbol(property)),\n          memberText(text, name),',
          to: '        readHeld(\n          checker.getNonNullableType(checker.getTypeOfSymbol(property)),\n          memberText(text, name),'
        }
      ]
    },
    {
      id: 'I-handed-unknown-index-hidden',
      arm: 'PB13',
      describe:
        'the reader of what is handed out strips nullability from what an index signature holds before it asks whether it is `unknown`',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: 'readHeld(present(index.type), ',
          to: 'readHeld(checker.getNonNullableType(index.type), '
        }
      ]
    },
    {
      id: 'I-handed-unknown-element-hidden',
      arm: 'PB13',
      describe:
        "the reader of what is handed out strips nullability from a list's element before it asks whether it is `unknown`",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '          present(element),\n',
          to: '          checker.getNonNullableType(element),\n'
        }
      ]
    },
    {
      id: 'C8-signer-template-frozen',
      arm: 'PB13',
      describe:
        "the template the signer is handed has its first tag frozen, so it is not the signer's to write",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '    const signed: unknown = await signer.signEvent(handed);',
          to: '    Object.freeze(handed.tags[0]);\n    const signed: unknown = await signer.signEvent(handed);'
        }
      ]
    },
    {
      id: 'C8-signed-send-promise-reused',
      arm: 'PB13',
      describe:
        'a send of a signed event answers a second call on the same input with the first promise',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  return Object.freeze((input: SendInput, options?: SendOptions) =>\n    sendThrough(port, input, options)\n  );',
          to: "  const pending = new WeakMap<object, Promise<SendResult>>();\n  return Object.freeze((input: SendInput, options?: SendOptions) => {\n    if (typeof input === 'object' && input !== null && 'sig' in input) {\n      const previous = pending.get(input);\n      if (previous !== undefined) return previous;\n      const sent = sendThrough(port, input, options);\n      pending.set(input, sent);\n      return sent;\n    }\n    return sendThrough(port, input, options);\n  });"
        }
      ]
    },
    {
      id: 'I-bare-brand-unchecked',
      arm: 'PB13',
      describe:
        "the promise check asks a returned value's prototype and own keys alone, not its promise slot",
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: 'types.isPromise(returned) && !types.isProxy(returned),',
          to: 'true,'
        }
      ]
    },
    {
      id: 'I-twins-not-written',
      arm: 'PB13',
      describe:
        'the Error two hooks on one descriptor share is not written to, though they are shown to share it',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: '            sharedAndKept(`an Error, ${code}${door}, two hooks share`, readers);',
          to: '            void readers;'
        }
      ]
    },
    {
      id: 'I-twins-readers-cut',
      arm: 'PB13',
      describe: 'the Error two hooks on one descriptor share is not read back through the cache',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: "              'the cache': cacheOf(client, namespace)\n",
          to: ''
        }
      ]
    },
    {
      id: 'I-provider-twins-not-written',
      arm: 'PB13',
      describe:
        'the Errors two hooks share under the transport that cannot name a relay are not written to',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: '          sharedAndKept(`an Error, ${code}, two hooks share`, readers);',
          to: '          void readers;'
        }
      ]
    },
    {
      id: 'I-promise-name-alone',
      arm: 'PB13',
      describe: "the probe takes any type named `Promise` for the platform's",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: "              symbol?.getName() === 'Promise' &&\n              (symbol.getDeclarations() ?? []).every((one) =>\n                program.isSourceFileDefaultLibrary(one.getSourceFile())\n              )\n",
          to: "              symbol?.getName() === 'Promise'\n"
        }
      ]
    },
    {
      id: 'I-handed-unnameable-index-skipped',
      arm: 'PB13',
      describe: 'the reader of what is handed out passes over an index signature it cannot name',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '        if (key === undefined)\n          throw new Error(\n            `handedArgumentsOf: ${label} has an index signature the probe cannot name`\n          );\n',
          to: '        if (key === undefined) continue;\n'
        }
      ]
    },
    {
      id: 'I-props-type-arguments-admitted',
      arm: 'PB13',
      describe: 'the props premise passes an annotation with type arguments',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/components.ts',
          from: '    reference.typeArguments !== undefined ||\n',
          to: ''
        }
      ]
    },
    {
      id: 'C8-template-send-promise-carries-members',
      arm: 'PB13',
      describe: 'the promise a send of a template returns carries a member of its own',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  return Object.freeze((input: SendInput, options?: SendOptions) =>\n    sendThrough(port, input, options)\n  );',
          to: "  return Object.freeze((input: SendInput, options?: SendOptions) =>\n    typeof input === 'object' && input !== null && 'kind' in input && !('sig' in input)\n      ? Object.assign(sendThrough(port, input, options), { progress: [] as string[] })\n      : sendThrough(port, input, options)\n  );"
        }
      ]
    },
    {
      id: 'C8-second-send-result-open',
      arm: 'PB13',
      describe:
        'a send asked again with the same input resolves with an open copy carrying a member of its own',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  return Object.freeze((input: SendInput, options?: SendOptions) =>\n    sendThrough(port, input, options)\n  );',
          to: "  const seen = new WeakSet<object>();\n  return Object.freeze((input: SendInput, options?: SendOptions) => {\n    const sent = sendThrough(port, input, options);\n    if (typeof input !== 'object' || input === null) return sent;\n    if (!seen.has(input)) {\n      seen.add(input);\n      return sent;\n    }\n    return sent.then((result) => ({ ...result, progress: [] as string[] }));\n  });"
        }
      ]
    },
    {
      id: 'C8-template-send-promise-reused',
      arm: 'PB13',
      describe:
        "a send of a template answers every later template's call with the first template's promise",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  return Object.freeze((input: SendInput, options?: SendOptions) =>\n    sendThrough(port, input, options)\n  );',
          to: "  let firstTemplate: Promise<SendResult> | undefined;\n  return Object.freeze((input: SendInput, options?: SendOptions) => {\n    const sent = sendThrough(port, input, options);\n    if (typeof input !== 'object' || input === null || 'sig' in input || !('kind' in input)) return sent;\n    firstTemplate ??= sent;\n    return firstTemplate;\n  });"
        }
      ]
    },
    {
      id: 'C8-signer-template-tags-frozen',
      arm: 'PB13',
      describe:
        "the template the signer is handed has its list of tags frozen, so it is not the signer's to write",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '    const signed: unknown = await signer.signEvent(handed);',
          to: '    Object.freeze(handed.tags);\n    const signed: unknown = await signer.signEvent(handed);'
        }
      ]
    },
    {
      id: 'C8-signer-template-sealed',
      arm: 'PB13',
      describe:
        "the template the signer is handed is frozen itself, so it is not the signer's to write",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '    const signed: unknown = await signer.signEvent(handed);',
          to: '    Object.freeze(handed);\n    const signed: unknown = await signer.signEvent(handed);'
        }
      ]
    },
    {
      id: 'I-writeback-cache-unsampled',
      arm: 'PB13',
      describe:
        'the write-back for the Errors two readers share leaves the cache out of what it reads back, while the cache is still shown to hold the Error',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: '            Object.entries(readers).map(([reader, read]) => [',
          to: "            Object.entries(readers).filter(([reader]) => reader !== 'the cache').map(([reader, read]) => ["
        }
      ]
    },
    {
      id: 'C8-signer-content-trusted',
      arm: 'PB13',
      describe:
        "a send compares the signer's event with its own copy, but takes the content from the template the signer was handed",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  if (!isTheTemplate(copy, expected)) {',
          to: '  if (!isTheTemplate(copy, { ...expected, content: handed.content })) {'
        }
      ]
    },
    {
      id: 'C8-signer-added-tag-trusted',
      arm: 'PB13',
      describe:
        "a send compares the signer's event with its own copy, but takes the tags from the template the signer was handed when the signer added one",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  if (!isTheTemplate(copy, expected)) {',
          to: '  if (!isTheTemplate(copy, { ...expected, tags: handed.tags.length > expected.tags.length ? handed.tags : expected.tags })) {'
        }
      ]
    },
    {
      id: 'C8-signer-tag-value-trusted',
      arm: 'PB13',
      describe:
        "a send compares the signer's event with its own copy, but takes the tags from the template the signer was handed when it has as many",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  if (!isTheTemplate(copy, expected)) {',
          to: '  if (!isTheTemplate(copy, { ...expected, tags: handed.tags.length === expected.tags.length ? handed.tags : expected.tags })) {'
        }
      ]
    },
    {
      id: 'C8-refused-send-promise-reused',
      arm: 'PB13',
      describe:
        'a send of an input that is not an event answers a second call on the same input with the first promise',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  return Object.freeze((input: SendInput, options?: SendOptions) =>\n    sendThrough(port, input, options)\n  );',
          to: "  const pending = new WeakMap<object, Promise<SendResult>>();\n  return Object.freeze((input: SendInput, options?: SendOptions) => {\n    if (typeof input !== 'object' || input === null || 'kind' in input) return sendThrough(port, input, options);\n    const previous = pending.get(input);\n    if (previous !== undefined) return previous;\n    const sent = sendThrough(port, input, options);\n    pending.set(input, sent);\n    return sent;\n  });"
        }
      ]
    },
    {
      id: 'I-writeback-cache-stale',
      arm: 'PB13',
      describe:
        "the write-back reads the cache after the write and compares the cache's earlier answer with itself",
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: '  const after = answers();',
          to: "  const after = { ...answers(), 'the cache': before['the cache'] };"
        }
      ]
    },
    {
      id: 'I-writeback-cache-read-once',
      arm: 'PB13',
      describe:
        'the write-back does not read the cache after the write, and takes its earlier answer for the later one',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: '  const after = answers();',
          to: "  const after = Object.fromEntries(\n    Object.entries(readers).map(([reader, read]) => {\n      if (reader === 'the cache') return [reader, before[reader]];\n      const root = read();\n      return [reader, paths.map((path) => readAt(root, path))];\n    })\n  ) as Record<string, unknown[]>;"
        }
      ]
    },
    {
      id: 'C8-signer-tags-shared',
      arm: 'PB13',
      describe:
        'every template the signer is handed holds one list of tags, refilled for each send',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: 'async function signedEventOf(',
          to: 'const SHARED_TAGS: string[][] = [];\nasync function signedEventOf('
        },
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '    tags: expected.tags.map((tag) => [...tag]),',
          to: '    tags: (SHARED_TAGS.splice(0, SHARED_TAGS.length, ...expected.tags.map((tag) => [...tag])), SHARED_TAGS),'
        }
      ]
    },
    {
      id: 'I-writeback-roots-read-early',
      arm: 'PB13',
      describe:
        'the write-back asks each reader twice before the write, and reads the members of what they answered after it',
      edits: [
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: '  const before = answers();',
          to: '  const early = Object.fromEntries(\n    Object.entries(readers).map(([reader, read]) => [reader, (read(), read())])\n  );\n  const sampled = (): Record<string, unknown[]> =>\n    Object.fromEntries(\n      Object.entries(early).map(([reader, root]) => [reader, paths.map((path) => readAt(root, path))])\n    );\n  const before = sampled();'
        },
        {
          file: 'src/tests/contracts/engine/published.test.ts',
          from: '  const after = answers();',
          to: '  const after = sampled();\n  void answers;'
        }
      ]
    },
    {
      id: 'C8-refused-send-settled-reused',
      arm: 'PB13',
      describe:
        'a send of an input that is not an event answers a later call on the same input with the first promise once it has settled',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  return Object.freeze((input: SendInput, options?: SendOptions) =>\n    sendThrough(port, input, options)\n  );',
          to: "  const settled = new WeakMap<object, Promise<SendResult>>();\n  return Object.freeze((input: SendInput, options?: SendOptions) => {\n    if (typeof input !== 'object' || input === null || 'kind' in input) return sendThrough(port, input, options);\n    const previous = settled.get(input);\n    if (previous !== undefined) return previous;\n    const sent = sendThrough(port, input, options);\n    void sent.then(() => {\n      if (!settled.has(input)) settled.set(input, sent);\n    });\n    return sent;\n  });"
        }
      ]
    },
    {
      id: 'C8-template-send-settled-reused',
      arm: 'PB13',
      describe:
        'a send of a template answers a later call on the same template with the first promise once it has settled',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '  return Object.freeze((input: SendInput, options?: SendOptions) =>\n    sendThrough(port, input, options)\n  );',
          to: "  const settled = new WeakMap<object, Promise<SendResult>>();\n  return Object.freeze((input: SendInput, options?: SendOptions) => {\n    if (typeof input !== 'object' || input === null || 'sig' in input || !('kind' in input)) return sendThrough(port, input, options);\n    const previous = settled.get(input);\n    if (previous !== undefined) return previous;\n    const sent = sendThrough(port, input, options);\n    void sent.then(() => {\n      if (!settled.has(input)) settled.set(input, sent);\n    });\n    return sent;\n  });"
        }
      ]
    }
  ],
  retired: [
    {
      id: 'C8-relay-not-in-scope-open',
      arm: 'PB13',
      reason:
        "Equivalent on every path a hook publishes through: this class is thrown by `resolveTargets` alone, whose one caller, `resolveRequest`, catches it and hands it to `capture`, which freezes an owned value on its way to the channel. The constructor's freeze is the second. The falsifier is a second caller of `resolveTargets` outside that catch; there is none.",
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: '    this.configured = configured;\n    Object.freeze(this);',
          to: '    this.configured = configured;'
        }
      ]
    },
    {
      id: 'C8-request-transport-open',
      arm: 'PB13',
      reason:
        "Equivalent on every path a hook publishes through: this class is thrown by `resolveTargets` alone, whose one caller, `resolveRequest`, catches it and hands it to `capture`, which freezes an owned value on its way to the channel. The constructor's freeze is the second. The falsifier is a second caller of `resolveTargets` outside that catch; there is none.",
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: '    REQUEST_TRANSPORT_REFUSALS.add(this);\n    Object.freeze(this);',
          to: '    REQUEST_TRANSPORT_REFUSALS.add(this);'
        }
      ]
    }
  ]
} satisfies Ledger;
