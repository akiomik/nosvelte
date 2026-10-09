/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of `B5-C10`'s landing, `RA1` (which failure code reaches
 * which surface, and the types a consumer compiles against): each entry an
 * edit that `RA1` must fail under, and, where it names them, the supporting
 * arms that must fail under it too. An id beginning `C10-` edits the library
 * or the record; one beginning `I-` edits one of `RA1`'s own instruments.
 */
import type { Ledger } from '../ledger.ts';

export default {
  name: 'b5-c10',
  subject:
    '`B5-C10` (failure reachability and the published error types): its landing, `RA1`, and the supporting arms each entry requires',
  files: [
    'src/tests/contracts/engine/reach.test.ts',
    'src/tests/contracts/engine/published.test.ts',
    'src/tests/contracts/catalogue.test.ts'
  ],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: {
      RA1: 10.4,
      RX1: 3.6,
      RX2: 3.7,
      RX3: 3.9,
      RX4: 3.7,
      RX5: 3.8,
      RX6: 3.7,
      RX7: 3.5,
      RX8: 3.8,
      RX11: 3.7,
      RX12: 4.1,
      LE17: 4.4,
      LE18: 5.2,
      LE19: 3.6,
      LE20: 3.9,
      CAT43: 4.7
    }
  },
  entries: [
    {
      id: 'C10-state-alias-widened',
      arm: 'RA1',
      requires: ['LE20'],
      describe: '`ReqStateError` admits `incomplete-result`, which never reaches the error state',
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "export type ReqStateError = Extract<\n  ReqError,\n  {\n    readonly code:\n      | 'invalid-descriptor'\n",
          to: "export type ReqStateError = Extract<\n  ReqError,\n  {\n    readonly code:\n      | 'incomplete-result'\n      | 'invalid-descriptor'\n"
        }
      ]
    },
    {
      id: 'C10-incomplete-alias-widened',
      arm: 'RA1',
      requires: ['LE20'],
      describe: '`IncompleteError` admits `unspecified`, which no incomplete state carries',
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "export type IncompleteError = Extract<ReqError, { readonly code: 'incomplete-result' }>;",
          to: "export type IncompleteError = Extract<\n  ReqError,\n  { readonly code: 'incomplete-result' | 'unspecified' }\n>;"
        }
      ]
    },
    {
      id: 'C10-outcome-alias-widened',
      arm: 'RA1',
      requires: ['LE20'],
      describe:
        '`RefreshOutcomeError` admits `missing-provider`, which refuses before an outcome exists',
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "  { readonly code: 'accumulator-contract' | 'unspecified' }",
          to: "  { readonly code: 'accumulator-contract' | 'unspecified' | 'missing-provider' }"
        }
      ]
    },
    {
      id: 'C10-last-error-alias-widened',
      arm: 'RA1',
      requires: ['LE20'],
      describe: "`ReqLastError` admits `relay-failed`, which reaches only the leg's end",
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: 'export type ReqLastError = ReqStateError | IncompleteError;',
          to: 'export type ReqLastError = ReqStateError | IncompleteError | RelayLegError;'
        }
      ]
    },
    {
      id: 'C10-error-state-declared-wider',
      arm: 'RA1',
      describe: "the error state's `error` is declared to carry the partial answer too",
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: "      readonly status: 'error';\n      readonly events: readonly ReqEvent[];\n      readonly error: ReqStateError;",
          to: "      readonly status: 'error';\n      readonly events: readonly ReqEvent[];\n      readonly error: ReqStateError | IncompleteError;"
        }
      ]
    },
    {
      id: 'C10-last-error-declared-wider',
      arm: 'RA1',
      describe: '`ReqDiagnostics.lastError` is declared as any `Error`',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: '  readonly lastError: ReqLastError | undefined;',
          to: '  readonly lastError: ReqLastError | Error | undefined;'
        }
      ]
    },
    {
      id: 'C10-message-writable',
      arm: 'RA1',
      requires: ['LE18'],
      describe: "the `unspecified` variant's `message` is writable",
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly message: string;\n      readonly stack?: string;\n      readonly cause?: ReqError | undefined;\n      readonly thrownName: string;\n      readonly truncated: boolean;\n      readonly source: 'unspecified';",
          to: "      message: string;\n      readonly stack?: string;\n      readonly cause?: ReqError | undefined;\n      readonly thrownName: string;\n      readonly truncated: boolean;\n      readonly source: 'unspecified';"
        }
      ]
    },
    {
      id: 'C10-source-decorrelated',
      arm: 'RA1',
      requires: ['LE17'],
      describe:
        "the relay variant's `source` admits `descriptor`, so a captured value's door and code can disagree",
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly source: 'relay';",
          to: "      readonly source: 'relay' | 'descriptor';"
        }
      ]
    },
    {
      id: 'C10-variant-branded',
      arm: 'RA1',
      describe: 'a variant requires a member no plain object of its shape carries',
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly source: 'unspecified';\n      readonly code: 'unspecified';\n    };",
          to: "      readonly source: 'unspecified';\n      readonly code: 'unspecified';\n      readonly brand: 'nosvelte';\n    };"
        }
      ]
    },
    {
      id: 'C10-snapshot-published',
      arm: 'RA1',
      describe: 'the entry gives out `ReqFailure`',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export { useSend } from './send.svelte.js';",
          to: "export { useSend } from './send.svelte.js';\nexport { ReqFailure } from './own.js';"
        }
      ]
    },
    {
      id: 'C10-snapshot-published-renamed',
      arm: 'RA1',
      describe: 'the entry gives out `ReqFailure` under another name',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export { useSend } from './send.svelte.js';",
          to: "export { useSend } from './send.svelte.js';\nexport { ReqFailure as CapturedFailure } from './own.js';"
        }
      ]
    },
    {
      id: 'C10-rejection-alias-published',
      arm: 'RA1',
      describe: 'the entry gives out `RefreshRejection`, which no signature can hold',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export { useSend } from './send.svelte.js';",
          to: "export { useSend } from './send.svelte.js';\nexport type { RefreshRejection } from './reqerror.js';"
        }
      ]
    },
    {
      id: 'C10-guard-published',
      arm: 'RA1',
      describe: 'the entry gives out a recognition guard under a name of its own',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export { useSend } from './send.svelte.js';",
          to: "export { useSend } from './send.svelte.js';\nexport const recognise = (value: unknown): value is import('./reqerror.js').ReqError =>\n  typeof value === 'object' && value !== null && 'code' in value;"
        }
      ]
    },
    {
      id: 'C10-recogniser-published',
      arm: 'RA1',
      describe:
        'the entry gives out a recogniser that answers `boolean`, which no predicate scan sees',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export { useSend } from './send.svelte.js';",
          to: "export { useSend } from './send.svelte.js';\nexport const looksLikeAFailure = (value: unknown): boolean =>\n  typeof value === 'object' && value !== null && 'code' in value;"
        }
      ]
    },
    {
      id: 'C10-class-code-taken',
      arm: 'RA1',
      requires: ['LE17', 'LE19'],
      describe: "`MissingRandomnessError` carries `missing-provider`, another class's code",
      edits: [
        {
          file: 'src/lib/v1/attempt.ts',
          from: "  readonly code = 'missing-randomness' as const;",
          to: "  readonly code = 'missing-provider' as const;"
        }
      ]
    },
    {
      id: 'C10-class-code-widened',
      arm: 'RA1',
      describe:
        '`UnsupportedFilterError.code` is typed `string`, which promises a consumer nothing to branch on',
      edits: [
        {
          file: 'src/lib/v1/key.ts',
          from: "  readonly code = 'unsupported-filter' as const;",
          to: "  readonly code: string = 'unsupported-filter';"
        }
      ]
    },
    {
      id: 'C10-request-transport-code',
      arm: 'RA1',
      describe: "the request's transport refusal carries `invalid-descriptor`",
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "  readonly code = 'transport-incompatible' as const;",
          to: "  readonly code = 'invalid-descriptor' as const;"
        }
      ]
    },
    {
      id: 'C10-descriptor-refusal-resolves',
      arm: 'RA1',
      requires: ['RX1', 'RX11'],
      describe: '`refresh()` resolves where a descriptor refusal should reject it',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '      if (rejection !== undefined) throw rejection;\n\n      // Nothing to start.',
          to: "      if (rejection !== undefined)\n        return Object.freeze({ kind: 'not-started', reason: 'deferred' } as const);\n\n      // Nothing to start."
        }
      ]
    },
    {
      id: 'C10-last-error-misses-the-entry',
      arm: 'RA1',
      requires: ['RX1', 'RX5'],
      describe: "`lastError` does not read the query's rejection",
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: '      entryError ??\n',
          to: '      (entryError && undefined) ??\n'
        }
      ]
    },
    {
      id: 'C10-abandoned-rejects',
      arm: 'RA1',
      requires: ['RX2'],
      describe: 'an abandoned attempt rejects `refresh()` instead of resolving as a cancellation',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "  if (code === 'attempt-abandoned') {\n    return Object.freeze({ kind: 'cancelled', reason: 'consumer-released' } as const);\n  }",
          to: "  if (code === 'attempt-abandoned') {\n    return undefined;\n  }"
        }
      ]
    },
    {
      id: 'C10-disposed-in-flight-rejects',
      arm: 'RA1',
      requires: ['RX8'],
      describe:
        'a call in flight when the provider goes away rejects instead of resolving as a cancellation',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "  if (code === 'provider-disposed') {\n    return Object.freeze({ kind: 'cancelled', reason: 'provider-disposed' } as const);\n  }",
          to: "  if (code === 'provider-disposed') {\n    return undefined;\n  }"
        }
      ]
    },
    {
      id: 'C10-absent-seam-refused',
      arm: 'RA1',
      requires: ['RX6'],
      describe:
        '`refresh()` refuses a transport that is absent, the way it refuses one it cannot read',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '      if (!readTransport.read) {',
          to: '      if (!readTransport.read || readTransport.value === undefined) {'
        }
      ]
    },
    {
      id: 'C10-revoke-skipped',
      arm: 'RA1',
      requires: ['RX8'],
      describe: 'a provider going away disposes without revoking first',
      edits: [
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: '    ownedTransport?.revoke();\n    clock.dispose();',
          to: '    clock.dispose();'
        }
      ]
    },
    {
      id: 'C10-relay-failure-on-state',
      arm: 'RA1',
      requires: ['RX7'],
      describe: "a relay's failure reaching a terminal door is published as itself",
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: "    // {@link accumulatorBroke}.\n    case 'relay-failed':\n      return accumulatorBroke(value);",
          to: "    // {@link accumulatorBroke}.\n    case 'relay-failed':\n      return value as never;"
        }
      ]
    },
    {
      id: 'C10-outcome-keeps-missing-provider',
      arm: 'RA1',
      requires: ['RX7'],
      describe: 'the record narrowing keeps `missing-provider`, which no outcome carries',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: 'export function recordedFailure(value: ReqError): RefreshOutcomeError {',
          to: "export function recordedFailure(value: ReqError): RefreshOutcomeError {\n  if (String(value.code) === 'missing-provider') return value as unknown as RefreshOutcomeError;"
        }
      ]
    },
    {
      id: 'C10-missing-provider-as-descriptor',
      arm: 'RA1',
      describe: 'a request with no provider is refused as a descriptor fault',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '        ? ownedByLibrary(new MissingProviderError())',
          to: "        ? ownedByLibrary(\n            new InvalidDescriptorError(MissingProviderError.name === '' ? 'rxNostr' : 'client', 'is missing')\n          )"
        }
      ]
    },
    {
      id: 'C10-not-in-scope-as-descriptor',
      arm: 'RA1',
      describe: 'a target the provider cannot read is refused as a descriptor fault',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: '        throw ownedByLibrary(\n          new RelayNotInScopeError(resolution.name, resolution.relay !== undefined, scope.urls)\n        );',
          to: "        void RelayNotInScopeError;\n        throw ownedByLibrary(new InvalidDescriptorError('relays', 'is not in scope'));"
        }
      ]
    },
    {
      id: 'C10-record-cell-moved',
      arm: 'RA1',
      requires: ['CAT43'],
      describe: "the record's table moves a cell to another witness",
      edits: [
        {
          file: 'docs/decisions/0005-contract-catalogue.md',
          from: '| code `invalid-descriptor`     | RM5                                  | —                                         | —                        | RM4                               | RM5              | RM5         | —                |',
          to: '| code `invalid-descriptor`     | RM4                                  | —                                         | —                        | RM4                               | RM5              | RM5         | —                |'
        }
      ]
    },
    {
      id: 'C10-record-row-dropped',
      arm: 'RA1',
      requires: ['CAT43'],
      describe: "the record's table drops the `relay-failed` row",
      edits: [
        {
          file: 'docs/decisions/0005-contract-catalogue.md',
          from: '| code `relay-failed`           | —                                    | —                                         | —                        | —                                 | —                | —           | RM10             |\n',
          to: ''
        }
      ]
    },
    {
      id: 'I-bridge-any-arm',
      arm: 'RA1',
      describe: 'the bridge accepts an observation from an arm the record does not list',
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: '  if (!(HELD_BY[witness] ?? []).includes(arm))',
          to: "  if (arm === '\\0' && HELD_BY[witness] === undefined)"
        }
      ]
    },
    {
      id: 'I-bridge-any-code',
      arm: 'RA1',
      describe: 'the bridge accepts any code at a cell',
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: '    else if (codeOf(observed[surface]) !== code)',
          to: "    else if (codeOf(observed[surface]) === Symbol.for('never'))"
        }
      ]
    },
    {
      id: 'I-bridge-empty-cells-unread',
      arm: 'RA1',
      describe: "the bridge does not read a code's empty cells",
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: '    if (INHERITED[code][surface] === undefined && codeOf(observed[surface]) === code)',
          to: "    if (INHERITED[code][surface] === undefined && codeOf(observed[surface]) === Symbol.for('never'))"
        }
      ]
    },
    {
      id: 'I-bridge-column-unread',
      arm: 'RA1',
      describe: 'the bridge does not ask whether a code it saw is one the column allows',
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: '    return seen !== undefined && INHERITED[seen as ReqErrorCode]?.[surface] === undefined',
          to: "    return seen === Symbol.for('never')"
        }
      ]
    },
    {
      id: 'I-bridge-unminted-accepted',
      arm: 'RA1',
      describe: 'the bridge accepts a value nobody minted',
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: '    else if (!isOwnedByLibrary(observed[surface]))',
          to: "    else if (observed[surface] === Symbol.for('never'))"
        }
      ]
    },
    {
      id: 'I-completeness-off',
      arm: 'RA1',
      describe: "the landing's completeness reader finds nothing missing",
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: '    .filter((witness) => !(observedBy.get(name)?.has(witness) ?? false));',
          to: "    .filter(() => name === '\\0');"
        }
      ]
    },
    {
      id: 'I-withholding-off',
      arm: 'RA1',
      describe: "the emitted program reads the library's source",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/emitted.ts',
          from: '    if (path === SOURCE || path.startsWith(`${SOURCE}/`)) {',
          to: '    if (path === `${SOURCE}\\0`) {'
        }
      ]
    },
    {
      id: 'I-equality-mutual',
      arm: 'RA1',
      describe: 'the type equality probe is two-way assignability, which `any` passes',
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: "'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;',",
          to: "'type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;',"
        }
      ]
    },
    {
      id: 'I-stray-lines-ignored',
      arm: 'RA1',
      describe: 'diagnostics on a line no probe stands on are ignored',
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: '        const stray = [...byLine].filter(([line]) => !expected.has(line));',
          to: '        const stray = [...byLine].filter(([line]) => line === 0 && !expected.has(line));'
        }
      ]
    },
    {
      id: 'I-guards-unread',
      arm: 'RA1',
      describe: 'the export reader answers that nothing is a guard',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '      guards = callables.some((type) =>',
          to: '      guards = callables.length < 0 && callables.some((type) =>'
        }
      ]
    },
    {
      id: 'I-defines-by-name',
      arm: 'RA1',
      describe: 'the export reader names an export by its own spelling, not what it resolves to',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: 'defines: resolved.getName()',
          to: 'defines: symbol.getName()'
        }
      ]
    },
    {
      id: 'I-population-by-spelling',
      arm: 'RA1',
      describe: 'the class population reads how a base is spelled',
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: "          if (bases(instance).includes('Error')) {",
          to: '          if (/extends \\w*Error\\b/.test(node.getText().slice(0, 200))) {'
        }
      ]
    },
    {
      id: 'I-outlets-unbound',
      arm: 'RA1',
      describe: "the components' outlet types are not read",
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: '          outletTypes.add(props);',
          to: '          void props;'
        }
      ]
    },
    {
      id: 'C10-public-refresh-resolves',
      arm: 'RA1',
      describe:
        "`useReq`'s own `refresh` resolves where the engine's rejects, so a consumer is never refused",
      edits: [
        {
          file: 'src/lib/v1/req.svelte.ts',
          from: '    refresh: () => handle.refresh()',
          to: "    refresh: async () => {\n      try { return await handle.refresh(); }\n      catch { return { kind: 'not-started', reason: 'deferred' } as const; }\n    }"
        }
      ]
    },
    {
      id: 'C10-handle-refresh-wider',
      arm: 'RA1',
      describe: '`ReqHandle.refresh` is declared to resolve the partial answer as an error outcome',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: '  readonly refresh: () => Promise<RefreshOutcome>;',
          to: "  readonly refresh: () => Promise<RefreshOutcome | { readonly kind: 'error'; readonly error: IncompleteError }>;"
        }
      ]
    },
    {
      id: 'C10-diagnostics-wider',
      arm: 'RA1',
      describe: '`ReqHandle.diagnostics` declares `lastError` as any `Error`, behind every alias',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: '  readonly diagnostics: ReqDiagnostics;\n',
          to: "  readonly diagnostics: Omit<ReqDiagnostics, 'lastError'> & {\n    readonly lastError: ReqLastError | Error | undefined;\n  };\n"
        }
      ]
    },
    {
      id: 'C10-error-slot-withheld',
      arm: 'RA1',
      describe: 'the request components withhold the error snippet from the partial answer',
      edits: [
        {
          file: 'src/lib/v1/components/RequestOutlets.svelte',
          from: '  {@render error?.(Object.freeze({ request, error: outlet.error }))}',
          to: '  {@render (outlet.error.code === "incomplete-result" ? undefined : error)?.(Object.freeze({ request, error: outlet.error }))}'
        }
      ]
    },
    {
      id: 'C10-last-error-only-on-error',
      arm: 'RA1',
      describe:
        '`lastError` reads the failure only while the state is `error`, so a failed refresh over a kept answer leaves it empty',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: '      data?.failure?.error ??\n      entryError ??',
          to: "      (state.status === 'error' ? data?.failure?.error : undefined) ??\n      (state.status === 'error' ? entryError : undefined) ??"
        }
      ]
    },
    {
      id: 'C10-cause-fresh',
      arm: 'RA1',
      describe:
        "a relay's failure named as the contract violation carries a fresh copy on its cause rather than the relay's value",
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '  return ownedByLibrary(new AccumulatorContractError(said.text, value));',
          to: '  return ownedByLibrary(new AccumulatorContractError(said.text, captureFromRelay(new Error(value.message))));'
        }
      ]
    },
    {
      id: 'C10-cause-typed-error',
      arm: 'RA1',
      describe:
        "every variant's `cause` is declared as `Error`, so a consumer cannot branch on a nested code",
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly cause?: ReqError | undefined;\n      readonly code: 'incomplete-result';",
          to: "      readonly cause?: Error | undefined;\n      readonly code: 'incomplete-result';"
        },
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly cause?: ReqError | undefined;\n      readonly code: 'invalid-descriptor';",
          to: "      readonly cause?: Error | undefined;\n      readonly code: 'invalid-descriptor';"
        },
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly cause?: ReqError | undefined;\n      readonly code: 'unsupported-filter';",
          to: "      readonly cause?: Error | undefined;\n      readonly code: 'unsupported-filter';"
        },
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly cause?: ReqError | undefined;\n      readonly code: 'relay-not-in-scope';",
          to: "      readonly cause?: Error | undefined;\n      readonly code: 'relay-not-in-scope';"
        },
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly cause?: ReqError | undefined;\n      readonly code: 'transport-incompatible';",
          to: "      readonly cause?: Error | undefined;\n      readonly code: 'transport-incompatible';"
        },
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly cause?: ReqError | undefined;\n      readonly code: 'accumulator-contract';\n    }\n  | {\n      readonly name: string;\n      readonly message: string;\n      readonly stack?: string;\n      readonly cause?: ReqError | undefined;\n      readonly code: 'provider-disposed';\n    }\n  | {\n      readonly name: string;\n      readonly message: string;\n      readonly stack?: string;\n      readonly cause?: ReqError | undefined;\n      readonly code: 'missing-provider';\n    }\n  | {\n      readonly name: string;\n      readonly message: string;\n      readonly stack?: string;\n      readonly cause?: ReqError | undefined;",
          to: "      readonly cause?: Error | undefined;\n      readonly code: 'accumulator-contract';\n    }\n  | {\n      readonly name: string;\n      readonly message: string;\n      readonly stack?: string;\n      readonly cause?: Error | undefined;\n      readonly code: 'provider-disposed';\n    }\n  | {\n      readonly name: string;\n      readonly message: string;\n      readonly stack?: string;\n      readonly cause?: Error | undefined;\n      readonly code: 'missing-provider';\n    }\n  | {\n      readonly name: string;\n      readonly message: string;\n      readonly stack?: string;\n      readonly cause?: Error | undefined;"
        },
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly cause?: ReqError | undefined;\n      readonly thrownName: string;\n      readonly truncated: boolean;\n      readonly source: 'relay';",
          to: "      readonly cause?: Error | undefined;\n      readonly thrownName: string;\n      readonly truncated: boolean;\n      readonly source: 'relay';"
        },
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly cause?: ReqError | undefined;\n      readonly thrownName: string;\n      readonly truncated: boolean;\n      readonly source: 'unspecified';",
          to: "      readonly cause?: Error | undefined;\n      readonly thrownName: string;\n      readonly truncated: boolean;\n      readonly source: 'unspecified';"
        }
      ]
    },
    {
      id: 'C10-static-tools',
      arm: 'RA1',
      describe:
        'a published class holds a static object with a recognition guard and a factory resolving to the snapshot class',
      edits: [
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: '  /**\n   * The three members `Error` gives this class, re-declared as `readonly`.',
          to: "  static readonly failureTools = {\n    snapshot: () => import('./own.js').then(({ ReqFailure }) => ReqFailure),\n    recognises: (value: unknown): value is import('./reqerror.js').ReqError =>\n      typeof value === 'object' && value !== null && 'code' in value\n  };\n  /**\n   * The three members `Error` gives this class, re-declared as `readonly`."
        }
      ]
    },
    {
      id: 'C10-instance-guard',
      arm: 'RA1',
      describe: 'a published class gives out a recognition guard on every instance',
      edits: [
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: "  readonly code = 'missing-provider' as const;\n",
          to: "  readonly code = 'missing-provider' as const;\n\n  /** A recognition guard, given out on every instance. */\n  recognises(value: unknown): value is import('./reqerror.js').ReqError {\n    return typeof value === 'object' && value !== null && 'code' in value;\n  }\n"
        }
      ]
    },
    {
      id: 'C10-static-snapshot',
      arm: 'RA1',
      describe: 'a published class holds the snapshot class as a static',
      edits: [
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: "import { providerDisposed } from './own.js';",
          to: "import { providerDisposed, ReqFailure } from './own.js';"
        },
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: "  readonly code = 'missing-provider' as const;\n",
          to: "  readonly code = 'missing-provider' as const;\n\n  /** The snapshot class, handed out as a member. */\n  static readonly Snapshot = ReqFailure;\n"
        }
      ]
    },
    {
      id: 'C10-namespace-guard',
      arm: 'RA1',
      describe: 'the entry gives out a recognition guard inside a namespace',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export { useSend } from './send.svelte.js';",
          to: "export { useSend } from './send.svelte.js';\n// eslint-disable-next-line @typescript-eslint/no-namespace\nexport namespace Recognise {\n  export const reqError = (value: unknown): value is import('./reqerror.js').ReqError =>\n    typeof value === 'object' && value !== null && 'code' in value;\n}"
        }
      ]
    },
    {
      id: 'C10-enum-published',
      arm: 'RA1',
      describe: 'the entry gives out an enum, a value no list of values had',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export { useSend } from './send.svelte.js';",
          to: "export { useSend } from './send.svelte.js';\nexport enum FailureKind {\n  Descriptor = 'descriptor',\n  Relay = 'relay'\n}"
        }
      ]
    },
    {
      id: 'C10-snapshot-as-component-name',
      arm: 'RA1',
      describe:
        "the entry gives out the snapshot class under a component's name, which it does not use",
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export { useSend } from './send.svelte.js';",
          to: "export { useSend } from './send.svelte.js';\nimport { ReqFailure } from './own.js';\nexport const Article = ReqFailure;"
        }
      ]
    },
    {
      id: 'C10-recogniser-as-component-name',
      arm: 'RA1',
      describe: "the entry gives out a `boolean` recogniser under a component's name",
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export { useSend } from './send.svelte.js';",
          to: "export { useSend } from './send.svelte.js';\nexport const Article = (value: unknown): boolean =>\n  typeof value === 'object' && value !== null && 'code' in value;"
        }
      ]
    },
    {
      id: 'C10-rejection-renamed-type',
      arm: 'RA1',
      describe: 'the entry publishes the rejection set as a type alias of a new name',
      edits: [
        {
          file: 'src/lib/v1/public-entry.ts',
          from: "export { useSend } from './send.svelte.js';",
          to: "export { useSend } from './send.svelte.js';\nexport type RefreshFailure = import('./reqerror.js').RefreshRejection;"
        }
      ]
    },
    {
      id: 'C10-failure-code-string',
      arm: 'RA1',
      describe: '`FailureCode` widens to `string` under its own name',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: "export type FailureCode = CapturedReqError['code'];",
          to: 'export type FailureCode = string;'
        }
      ]
    },
    {
      id: 'C10-relay-family-string',
      arm: 'RA1',
      describe: '`RelayConfigurationErrorCode` widens to `string` under its own name',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: 'export type RelayConfigurationErrorCode =',
          to: 'export type RelayConfigurationErrorCode = string'
        }
      ]
    },
    {
      id: 'C10-copy-code-wrong',
      arm: 'RA1',
      requires: ['LE19'],
      describe:
        '`MissingRandomnessError` carries `missing-provider` at run time, in every copy, while its type says otherwise',
      edits: [
        {
          file: 'src/lib/v1/attempt.ts',
          from: "    (this as { name: string }).name = 'MissingRandomnessError';",
          to: "    (this as { name: string }).name = 'MissingRandomnessError';\n    Object.assign(this, { code: 'missing-provider' });"
        }
      ]
    },
    {
      id: 'C10-caught-message-writable',
      arm: 'RA1',
      requires: ['LE17'],
      describe:
        '`MissingRandomnessError.message` is writable in the declaration a consumer compiles against',
      edits: [
        {
          file: 'src/lib/v1/attempt.ts',
          from: '  declare readonly message: string;\n  declare readonly name: string;\n  declare readonly stack?: string;\n  /**',
          to: '  declare message: string;\n  declare readonly name: string;\n  declare readonly stack?: string;\n  /**'
        }
      ]
    },
    {
      id: 'C10-disposed-client-unowned',
      arm: 'RA1',
      requires: ['RX4'],
      describe:
        '`refresh()` on a client the caller disposed rejects with an error this library did not mint',
      edits: [
        {
          file: 'src/lib/v1/stream.ts',
          from: '  if (relays === undefined) {\n    throw ownedByLibrary(\n      new InvalidDescriptorError(',
          to: "  if (relays === undefined) {\n    if (String(relays) === 'undefined') throw new Error('the client is gone');\n    throw ownedByLibrary(\n      new InvalidDescriptorError("
        }
      ]
    },
    {
      id: 'C10-incomplete-misses-last-error',
      arm: 'RA1',
      requires: ['RX3'],
      describe: "`lastError` does not carry the partial answer's error",
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: "      (state.status === 'incomplete' ? state.error : undefined),",
          to: "      (state.status === 'incomplete' ? undefined : undefined),"
        }
      ]
    },
    {
      id: 'C10-opaque-fault-as-broken-accumulator',
      arm: 'RA1',
      requires: ['RX12'],
      describe:
        'the record narrowing names a fault this library cannot attribute as a broken accumulator',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: "  // thing that notices a tenth code.\n  switch (value.code) {\n    case 'accumulator-contract':\n    case 'unspecified':\n      return value;",
          to: "  // thing that notices a tenth code.\n  switch (value.code) {\n    case 'accumulator-contract':\n      return value;\n    case 'unspecified':\n      return accumulatorBroke(value);"
        }
      ]
    },
    {
      id: 'I-kind-by-callable',
      arm: 'RA1',
      describe:
        'the export reader calls only a function or a variable a value, so an enum and a namespace are types',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '        : resolved.flags & ts.SymbolFlags.Value\n',
          to: '        : resolved.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable)\n'
        }
      ]
    },
    {
      id: 'I-fixture-members-dropped',
      arm: 'RA1',
      describe:
        "the export reader reads members declared in the library only, so a fixture's are dropped",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/declarations.ts',
          from: '          each.getSourceFile().fileName.startsWith(`${library}/`) ||\n          each.getSourceFile().fileName === home',
          to: "          each.getSourceFile().fileName.startsWith(`${library}/`) ||\n          (each.getSourceFile().fileName === home && home === '\\0')"
        }
      ]
    },
    {
      id: 'I-walk-members-skipped',
      arm: 'RA1',
      describe: 'the reachability walk does not follow members',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/emitted.ts',
          from: '      if (ours(property)) next(',
          to: "      if (ours(property) && property.getName() === '\\0') next("
        }
      ]
    },
    {
      id: 'I-walk-returns-skipped',
      arm: 'RA1',
      describe: 'the reachability walk does not follow what a signature returns',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/emitted.ts',
          from: '        next(kind, checker.getReturnTypeOfSignature(signature));',
          to: "        if (String(kind) === '\\0') next(kind, checker.getReturnTypeOfSignature(signature));"
        }
      ]
    },
    {
      id: 'I-walk-rejection-unread',
      arm: 'RA1',
      describe: 'the reachability walk does not ask whether a type is the rejection set',
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: '              found.push(`rejection: ${path}`);',
          to: '              void path;'
        }
      ]
    },
    {
      id: 'I-silent-unread',
      arm: 'RA1',
      describe: "the bridge does not read the surfaces a witness's arrangement leaves silent",
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: '  for (const surface of SILENT_AT[witness] ?? [])',
          to: "  for (const surface of (SILENT_AT[witness] ?? []).filter(() => arm === '\\0'))"
        }
      ]
    },
    {
      id: 'I-family-by-spelling',
      arm: 'RA1',
      describe:
        "the class population reads a code's annotation by its name rather than its members",
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: 'annotated === undefined ? { literals } : { family: annotated, literals };',
          to: 'annotated === undefined ? { literals } : { family: annotated, literals: [annotated] };'
        }
      ]
    },
    {
      id: 'I-same-codes-subset',
      arm: 'RA1',
      describe: 'the per-line comparison accepts a line whose codes include the expected ones',
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: '          JSON.stringify(found) === JSON.stringify(codes);',
          to: '          codes.every((one) => found.includes(one));'
        }
      ]
    },
    {
      id: 'C10-public-release-rejects',
      arm: 'RA1',
      describe:
        "`useReq`'s own `refresh` rejects when the consumer releases the request, where the engine resolves a cancellation",
      edits: [
        {
          file: 'src/lib/v1/req.svelte.ts',
          from: "import type { ReqHandle } from './engine.js';",
          to: "import { AttemptAbandonedError } from './attempt.js';\nimport type { ReqHandle } from './engine.js';"
        },
        {
          file: 'src/lib/v1/req.svelte.ts',
          from: '    refresh: () => handle.refresh()',
          to: "    refresh: async () => {\n      const outcome = await handle.refresh();\n      if (outcome.kind === 'cancelled' && outcome.reason === 'consumer-released')\n        throw new AttemptAbandonedError('the consumer released its request');\n      return outcome;\n    }"
        }
      ]
    },
    {
      id: 'C10-public-refusal-swallowed-over-answer',
      arm: 'RA1',
      describe:
        "`useReq`'s own `refresh` swallows a descriptor refusal once the request holds an answer",
      edits: [
        {
          file: 'src/lib/v1/req.svelte.ts',
          from: '    refresh: () => handle.refresh()',
          to: "    refresh: async () => {\n      const state = handle.state;\n      const hasAnswer = state.status === 'settled' && state.events.length > 0;\n      try {\n        return await handle.refresh();\n      } catch (reason) {\n        if (hasAnswer && (reason as { code?: unknown }).code === 'unsupported-filter')\n          return { kind: 'not-started', reason: 'deferred' } as const;\n        throw reason;\n      }\n    }"
        }
      ]
    },
    {
      id: 'C10-component-wrapped',
      arm: 'RA1',
      describe: 'the index wraps a component with a member that hands out the snapshot class',
      edits: [
        {
          file: 'src/lib/v1/index.ts',
          from: "export { default as Article } from './components/Article.svelte';",
          to: "import ArticleComponent from './components/Article.svelte';\nimport { ReqFailure } from './own.js';\nexport const Article = Object.assign(ArticleComponent, { snapshot: () => ReqFailure });"
        }
      ]
    },
    {
      id: 'C10-component-instance-export',
      arm: 'RA1',
      describe:
        "a published component's instance script exports a recognition guard, reached through `bind:this`",
      edits: [
        {
          file: 'src/lib/v1/components/Article.svelte',
          from: "  import RequestOutlets from './RequestOutlets.svelte';\n",
          to: "  import RequestOutlets from './RequestOutlets.svelte';\n  export function recognise(value: unknown): value is import('../reqerror.js').ReqError {\n    return typeof value === 'object' && value !== null && 'code' in value;\n  }\n"
        }
      ]
    },
    {
      id: 'C10-generic-default-snapshot',
      arm: 'RA1',
      describe:
        "a published class's static method hands out the snapshot class as its type parameter's default",
      edits: [
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: "import { providerDisposed } from './own.js';",
          to: "import { providerDisposed, ReqFailure } from './own.js';"
        },
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: '  /**\n   * The three members `Error` gives this class, re-declared as `readonly`.',
          to: '  static snapshot<T = typeof ReqFailure>(): T {\n    return ReqFailure as T;\n  }\n  /**\n   * The three members `Error` gives this class, re-declared as `readonly`.'
        }
      ]
    },
    {
      id: 'I-walk-defaults-skipped',
      arm: 'RA1',
      describe: "the reachability walk does not follow a type parameter's default",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/emitted.ts',
          from: "      if (fallback !== undefined) next('<default>', fallback);",
          to: "      if (fallback !== undefined && String(fallback) === '\\0') next('<default>', fallback);"
        }
      ]
    },
    {
      id: 'I-index-reader-blind',
      arm: 'RA1',
      describe: 'the index reader takes any statement for a re-export',
      edits: [
        {
          file: 'src/tests/contracts/engine/reach.test.ts',
          from: "                return `not a re-export: ${statement.getText().split('\\n')[0] ?? ''}`;",
          to: "                return 'useReq from ./req.svelte.js';"
        }
      ]
    },
    {
      id: 'C10-component-event',
      arm: 'RA1',
      describe: 'a published component dispatches a typed event whose detail is the snapshot class',
      edits: [
        {
          file: 'src/lib/v1/components/Article.svelte',
          from: "  import { useReq } from '../req.svelte.js';\n  import { article } from './descriptors.js';\n  import type { ArticleProps } from './outlets.js';\n  import RequestOutlets from './RequestOutlets.svelte';\n\n  let { namespace, pubkey, identifier, children, loading, error, nodata }: ArticleProps = $props();",
          to: "  import { createEventDispatcher, onMount } from 'svelte';\n  import { ReqFailure } from '../own.js';\n  import { useReq } from '../req.svelte.js';\n  import { article } from './descriptors.js';\n  import type { ArticleProps } from './outlets.js';\n  import RequestOutlets from './RequestOutlets.svelte';\n\n  let { namespace, pubkey, identifier, children, loading, error, nodata }: ArticleProps = $props();\n\n  const dispatch = createEventDispatcher<{ snapshot: typeof ReqFailure }>();\n  onMount(() => dispatch('snapshot', ReqFailure));"
        }
      ]
    },
    {
      id: 'C10-conditional-default-snapshot',
      arm: 'RA1',
      describe:
        "a published class's static method hands out the snapshot class through a type parameter's default, behind a conditional return",
      edits: [
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: "import { providerDisposed } from './own.js';",
          to: "import { providerDisposed, ReqFailure } from './own.js';"
        },
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: '  /**\n   * The three members `Error` gives this class, re-declared as `readonly`.',
          to: '  static snapshot<T = typeof ReqFailure>(): T extends new (...args: any[]) => any ? T : never {\n    return ReqFailure as unknown as T extends new (...args: any[]) => any ? T : never;\n  }\n  /**\n   * The three members `Error` gives this class, re-declared as `readonly`.'
        }
      ]
    },
    {
      id: 'I-components-unemitted',
      arm: 'RA1',
      describe:
        'the emit types every component through the `.svelte` shim instead of its generated declaration',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/emitted.ts',
          from: '  if (existsSync(path) || !existsSync(component)) return undefined;',
          to: '  if (existsSync(path) || existsSync(component)) return undefined;'
        }
      ]
    },
    {
      id: 'I-walk-signature-parameters-skipped',
      arm: 'RA1',
      describe: "the reachability walk does not read a signature's own type parameters",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/emitted.ts',
          from: '        for (const parameter of signature.getTypeParameters() ?? [])\n          next(`<${parameter.symbol.getName()}>`, parameter);',
          to: "        for (const parameter of signature.getTypeParameters() ?? [])\n          if (String(parameter) === '\\0') next(`<${parameter.symbol.getName()}>`, parameter);"
        }
      ]
    },
    {
      id: 'I-walk-type-arguments-skipped',
      arm: 'RA1',
      describe: "the reachability walk does not follow a type reference's arguments",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/emitted.ts',
          from: "        next('<>', argument);",
          to: "        if (String(argument) === '\\0') next('<>', argument);"
        }
      ]
    }
  ],
  retired: [
    {
      id: 'I-script-exports-unread',
      arm: 'RA1',
      reason:
        'The script reader was removed: what a component hands out beyond its props is read off its generated declaration, whose `Exports` and `Events` type arguments the reachability walk follows; `C10-component-instance-export` and `C10-component-event` are killed there.',
      describe: 'the component reader finds no export in any script',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/components.ts',
          from: "      .filter((statement) => statement.type.startsWith('Export'))",
          to: "      .filter((statement) => statement.type === '\\0')"
        }
      ]
    }
  ]
} satisfies Ledger;
