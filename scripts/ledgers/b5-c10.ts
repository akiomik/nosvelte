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
      id: 'C10-state-alias-drops-a-code',
      arm: 'RA1',
      requires: ['LE20'],
      describe: '`ReqStateError` drops `transport-incompatible`, which reaches `state.error`',
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "export type ReqStateError = Extract<\n  ReqError,\n  {\n    readonly code:\n      | 'invalid-descriptor'\n      | 'unsupported-filter'\n      | 'relay-not-in-scope'\n      | 'transport-incompatible'\n",
          to: "export type ReqStateError = Extract<\n  ReqError,\n  {\n    readonly code:\n      | 'invalid-descriptor'\n      | 'unsupported-filter'\n      | 'relay-not-in-scope'\n"
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
      id: 'C10-last-error-alias-narrowed',
      arm: 'RA1',
      requires: ['LE20'],
      describe: '`ReqLastError` drops the partial answer, which `lastError` carries',
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: 'export type ReqLastError = ReqStateError | IncompleteError;',
          to: 'export type ReqLastError = ReqStateError;'
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
      id: 'C10-last-error-declared-narrower',
      arm: 'RA1',
      describe: '`ReqDiagnostics.lastError` is declared without the partial answer it carries',
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: '  readonly lastError: ReqLastError | undefined;',
          to: '  readonly lastError: ReqStateError | undefined;'
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
      id: 'C10-class-codes-swapped',
      arm: 'RA1',
      requires: ['LE17', 'LE19'],
      describe: "`MissingProviderError` and `MissingRandomnessError` carry each other's code",
      edits: [
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: "  readonly code = 'missing-provider' as const;",
          to: "  readonly code = 'missing-randomness' as const;"
        },
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
      requires: ['RX1'],
      describe: "`lastError` does not read the query's rejection",
      edits: [
        {
          file: 'src/lib/v1/engine.ts',
          from: '      entryError ??\n',
          to: ''
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
          from: "    case 'missing-provider':\n    case 'incomplete-result':\n    case 'provider-disposed':\n      // **`provider-disposed` is a rejection, not a record.**",
          to: "    case 'missing-provider':\n      return value as never;\n    case 'incomplete-result':\n    case 'provider-disposed':\n      // **`provider-disposed` is a rejection, not a record.**"
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
          to: "        ? ownedByLibrary(new InvalidDescriptorError('client', 'is missing'))"
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
          from: 'new RelayNotInScopeError(resolution.name, resolution.relay !== undefined, scope.urls)',
          to: "new InvalidDescriptorError('relays', 'is not in scope')"
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
          from: '    if (INHERITED[code][surface] === undefined && seen === code)',
          to: "    if (INHERITED[code][surface] === undefined && seen === Symbol.for('never'))"
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
          from: '    if (seen !== undefined && INHERITED[seen as ReqErrorCode]?.[surface] === undefined)',
          to: "    if (seen === Symbol.for('never'))"
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
          to: "    if (path === '\\0') {"
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
    }
  ]
} satisfies Ledger;
