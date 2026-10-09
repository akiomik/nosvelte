/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of `B5-C9`'s landing, `FC1` (the failure channel
 * publishes a value this library made, never one it was handed): each entry an
 * edit that `FC1` must fail under, and, where it names them, the supporting
 * arms that must fail under it too — the measured connection that puts each of
 * them on the row's roster line. An id beginning `C9-` edits the library; one
 * beginning `I-` edits one of `FC1`'s own instruments.
 */
import type { Ledger } from '../ledger.ts';

export default {
  name: 'b5-c9',
  subject:
    '`B5-C9` (the failure channel): its landing, `FC1`, and the supporting arms each entry requires',
  files: [
    'src/tests/contracts/engine/failure.test.ts',
    'src/tests/contracts/engine/published.test.ts',
    'src/tests/contracts/engine/wiring.test.ts',
    'src/tests/contracts/engine/drift.test.ts',
    'src/tests/contracts/engine/relayconfig.test.ts'
  ],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at 45de427 — FC1's again after it was rewritten, 3.4 s — plus 3.5 s for a run's start-up, measured as one run of one fast arm; one worker, on a shared 10-core machine",
    seconds: {
      FC1: 6.9,
      PB6: 3.9,
      PB7: 3.5,
      PB8: 3.7,
      PB10: 3.9,
      PB12: 3.5,
      TR20: 3.5,
      TR21: 3.5,
      CG1: 3.5,
      CG11b: 3.5,
      WI23: 3.7,
      WI24: 3.6,
      WI28: 3.6
    }
  },
  entries: [
    {
      id: 'C9-descriptor-door-keeps',
      arm: 'FC1',
      describe: 'the descriptor boundary publishes the value thrown at it',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "    const thrown = capture(e, 'descriptor');",
          to: '    const thrown = e as ReqError;'
        }
      ]
    },
    {
      id: 'C9-writer-keeps',
      arm: 'FC1',
      requires: ['PB6'],
      describe: 'the failure writer records the value it was handed',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return { ...set, failure: { attemptId, error: recordedFailure(capture(error, 'unspecified')) } };",
          to: '  return { ...set, failure: { attemptId, error: error as RefreshOutcomeError } };'
        }
      ]
    },
    {
      id: 'C9-forward-leg-keeps',
      arm: 'FC1',
      requires: ['PB10'],
      describe: "the forward leg's end publishes the transport's own reason",
      edits: [
        {
          file: 'src/lib/v1/machine.ts',
          from: '      reason: reason === undefined ? undefined : captureFromRelay(reason)',
          to: '      reason: reason === undefined ? undefined : (reason as RelayLegError)'
        }
      ]
    },
    {
      id: 'C9-message-read-unguarded',
      arm: 'FC1',
      requires: ['TR20'],
      describe: 'what a thrown value says is read without a guard',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '  const message = safely(() => (thrown as { message?: unknown }).message);',
          to: '  const message = (thrown as { message?: unknown }).message;'
        }
      ]
    },
    {
      id: 'C9-bound-widened',
      arm: 'FC1',
      requires: ['PB7'],
      describe: 'the bound on a message and a name is 512, not 200',
      edits: [
        {
          file: 'src/lib/v1/normalize.ts',
          from: 'export const MAX_RENDERED = 200;',
          to: 'export const MAX_RENDERED = 512;'
        }
      ]
    },
    {
      id: 'C9-depth-four',
      arm: 'FC1',
      requires: ['PB7'],
      describe: 'the cause chain is copied four nodes deep',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: 'const MAX_CAUSE_DEPTH = 3;',
          to: 'const MAX_CAUSE_DEPTH = 4;'
        }
      ]
    },
    {
      id: 'C9-depth-two',
      arm: 'FC1',
      requires: ['PB7'],
      describe: 'the cause chain is copied two nodes deep',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: 'const MAX_CAUSE_DEPTH = 3;',
          to: 'const MAX_CAUSE_DEPTH = 2;'
        }
      ]
    },
    {
      id: 'C9-name-unbounded',
      arm: 'FC1',
      describe: 'what the thrown value called itself is not bounded',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '  const named = boundedMessage(nameOf(thrown));',
          to: '  const named = { text: nameOf(thrown), truncated: false };'
        }
      ]
    },
    {
      id: 'C9-message-first-unbounded',
      arm: 'FC1',
      requires: ['TR21'],
      describe: 'a message read off the thrown value is not bounded',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: "  if (typeof message === 'string') return boundedMessage(message);",
          to: "  if (typeof message === 'string') return { text: message, truncated: false };"
        }
      ]
    },
    {
      id: 'C9-truncated-not-message',
      arm: 'FC1',
      requires: ['PB7'],
      describe: '`truncated` does not say a cut message',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '      said.truncated ||\n',
          to: ''
        }
      ]
    },
    {
      id: 'C9-truncated-not-name',
      arm: 'FC1',
      requires: ['PB7'],
      describe: '`truncated` does not say a cut name',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '      named.truncated ||\n',
          to: ''
        }
      ]
    },
    {
      id: 'C9-truncated-not-kept',
      arm: 'FC1',
      describe: 'a value already cut forgets it when captured again',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '      wasTruncated ||\n',
          to: ''
        }
      ]
    },
    {
      id: 'C9-truncated-not-depth',
      arm: 'FC1',
      requires: ['PB7'],
      describe: '`truncated` does not say a chain cut at the depth',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '      (hasCause && depth <= 1) ||\n',
          to: ''
        }
      ]
    },
    {
      id: 'C9-truncated-not-below',
      arm: 'FC1',
      describe: '`truncated` does not say a cut below the root',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '      cause?.truncated === true,',
          to: '      false,'
        }
      ]
    },
    {
      id: 'C9-code-not-of-source',
      arm: 'FC1',
      requires: ['PB7'],
      describe: "a snapshot's code is `unspecified` whatever its door",
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '    this.code = CODE_OF[fields.source];',
          to: "    this.code = 'unspecified';"
        }
      ]
    },
    {
      id: 'C9-any-door-passes',
      arm: 'FC1',
      requires: ['PB12'],
      describe: 'one of ours passes through at any door',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: "    if (already !== source && source !== 'unspecified') {",
          to: '    if (false) {'
        }
      ]
    },
    {
      id: 'C9-unspecified-erases',
      arm: 'FC1',
      requires: ['PB12'],
      describe: 'the door that cannot attribute re-derives what already says where it came from',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: "    if (already !== source && source !== 'unspecified') {",
          to: '    if (already !== source) {'
        }
      ]
    },
    {
      id: 'C9-door-read-off-source',
      arm: 'FC1',
      requires: ['PB12'],
      describe: 'the door a value belongs to is read off its own `source`',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '    const already = DOOR_OF[thrown.code];',
          to: '    const already = (thrown as unknown as { source: FailureSource }).source;'
        }
      ]
    },
    {
      id: 'C9-door-moved',
      arm: 'FC1',
      requires: ['PB12'],
      describe: '`provider-disposed` belongs to the descriptor door',
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "  'provider-disposed': 'unspecified',",
          to: "  'provider-disposed': 'descriptor',"
        }
      ]
    },
    {
      id: 'C9-memo',
      arm: 'FC1',
      requires: ['PB7'],
      describe: 'a thrown object captured once is answered with that snapshot ever after',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: "  // record's, not the thrown object's — which is what `C15` says about answers.\n  return copyOf(thrown, source, MAX_CAUSE_DEPTH);\n}",
          to: "  // record's, not the thrown object's — which is what `C15` says about answers.\n  if (typeof thrown === 'object' && thrown !== null) {\n    const remembered = REMEMBERED.get(thrown);\n    if (remembered !== undefined) return remembered;\n    const made = copyOf(thrown, source, MAX_CAUSE_DEPTH);\n    REMEMBERED.set(thrown, made);\n    return made;\n  }\n  return copyOf(thrown, source, MAX_CAUSE_DEPTH);\n}\nconst REMEMBERED = new WeakMap<object, ReqError>();"
        }
      ]
    },
    {
      id: 'C9-ours-any-code',
      arm: 'FC1',
      describe: 'any value of ours passes through, whatever its code',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '    isOwnedByLibrary(thrown) &&\n    isChannelValue(thrown)\n  ) {',
          to: '    isOwnedByLibrary(thrown)\n  ) {'
        }
      ]
    },
    {
      id: 'C9-shared-code-shared-channel',
      arm: 'FC1',
      describe: "the provider's transport refusal passes as the request's, sharing its code",
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: "  return code !== 'transport-incompatible' || REQUEST_TRANSPORT_REFUSALS.has(value);",
          to: '  return true;'
        }
      ]
    },
    {
      id: 'C9-membership-forgeable',
      arm: 'FC1',
      requires: ['PB8'],
      describe: 'a value with any `code` counts as ours',
      edits: [
        {
          file: 'src/lib/v1/owned.ts',
          from: "    return typeof value === 'object' && value !== null && OURS.has(value);",
          to: "    return typeof value === 'object' && value !== null && (OURS.has(value) || 'code' in value);"
        }
      ]
    },
    {
      id: 'C9-constructor-mints',
      arm: 'FC1',
      requires: ['PB8', 'WI23'],
      describe: 'every constructor mints the value it builds',
      edits: [
        {
          file: 'src/lib/v1/owned.ts',
          from: 'export function hardenOwned<T extends object>(value: T): T {\n  closeStack(value);\n  return value;',
          to: 'export function hardenOwned<T extends object>(value: T): T {\n  closeStack(value);\n  OURS.add(value);\n  return value;'
        }
      ]
    },
    {
      id: 'C9-site-unminted',
      arm: 'FC1',
      requires: ['WI23'],
      describe: 'the disposed-provider factory does not mint what it builds',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '  return ownedByLibrary(new ProviderDisposedError(message));',
          to: '  return new ProviderDisposedError(message) as never;'
        }
      ]
    },
    {
      id: 'C9-seal-freezes-first',
      arm: 'FC1',
      requires: ['WI24'],
      describe: '`sealOwned` freezes before it closes `stack`',
      edits: [
        {
          file: 'src/lib/v1/owned.ts',
          from: '  ownedByLibrary(value);\n  Object.freeze(value);\n  return value;',
          to: '  Object.freeze(value);\n  ownedByLibrary(value);\n  return value;'
        }
      ]
    },
    {
      id: 'C9-constructor-freezes-first',
      arm: 'FC1',
      requires: ['WI24'],
      describe: '`ProviderDisposedError` freezes before it closes `stack`',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: "    (this as { name: string }).name = 'ProviderDisposedError';\n    hardenOwned(this);\n    Object.freeze(this);",
          to: "    (this as { name: string }).name = 'ProviderDisposedError';\n    Object.freeze(this);\n    hardenOwned(this);"
        }
      ]
    },
    {
      id: 'C9-close-only-strings',
      arm: 'FC1',
      requires: ['WI28'],
      describe: '`stack` is closed only when the getter answers a string',
      edits: [
        {
          file: 'src/lib/v1/owned.ts',
          from: "  try {\n    Object.defineProperty(value, 'stack', {",
          to: "  if (typeof held !== 'string') return;\n  try {\n    Object.defineProperty(value, 'stack', {"
        }
      ]
    },
    {
      id: 'C9-stack-read-unguarded',
      arm: 'FC1',
      requires: ['WI28'],
      describe: 'the read of `stack` before the close is not guarded',
      edits: [
        {
          file: 'src/lib/v1/owned.ts',
          from: '  try {\n    held = (value as { stack?: unknown }).stack;\n  } catch {',
          to: '  {\n    held = (value as { stack?: unknown }).stack;\n  }\n  if (false) {'
        }
      ]
    },
    {
      id: 'C9-refusal-unfrozen',
      arm: 'FC1',
      requires: ['CG1'],
      describe: '`InvalidRelayInputError` does not freeze itself',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: '    if (new.target === InvalidRelayInputError) Object.freeze(this);\n',
          to: ''
        }
      ]
    },
    {
      id: 'C9-answer-kept',
      arm: 'FC1',
      requires: ['CG11b'],
      describe: "the transport's refusal keeps the object the transport answered with",
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: '    this.answered = rendered;',
          to: '    this.answered = answered as never;'
        }
      ]
    },
    {
      id: 'I-walk-reads-nothing',
      arm: 'FC1',
      describe: "FC1's walk stops at the object it is handed",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: "      else if ('value' in slot) visit(slot.value, `${path}.${String(key)}`);",
          to: "      else if ('value' in slot) void slot;"
        }
      ]
    },
    {
      id: 'I-shape-is-the-root',
      arm: 'FC1',
      describe: "FC1's shape reads the object it is handed and nothing under it",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '  const { nodes, unread } = walk(root);\n  return JSON.stringify({',
          to: '  const { nodes, unread } = { nodes: new Set<object>([root]), unread: [] as string[] };\n  return JSON.stringify({'
        }
      ]
    },
    {
      id: 'C9-query-function-unwrapped',
      arm: 'FC1',
      describe:
        "the query function rejects with what it threw before its `try`, the attempt registry's own value included",
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: 'queryFn: rejectsWithOurs(async (context: unknown) => {',
          to: 'queryFn: (async (context: unknown) => {'
        }
      ]
    },
    {
      id: 'C9-rejection-per-read',
      arm: 'FC1',
      describe:
        "the query's rejection is copied again by every reader, so no two reads are one object",
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '  const rejectedWith = (): ReqStateError | undefined => queryRejection;',
          to: "  const rejectedWith = (): ReqStateError | undefined =>\n    query.status === 'error' ? terminalFailure(capture(query.error, 'unspecified')) : undefined;"
        }
      ]
    },
    {
      id: 'C9-state-uncaptured',
      arm: 'FC1',
      describe:
        "the state hands the query's error to `terminalFailure` uncaptured, so the query library's own cancellation is published as itself",
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "    query.status === 'error' ? terminalFailure(capture(query.error, 'unspecified')) : undefined\n  );",
          to: "    query.status === 'error' ? terminalFailure(query.error as unknown as ReqError) : undefined\n  );"
        }
      ]
    },
    {
      id: 'C9-set-answer-reread',
      arm: 'FC1',
      describe:
        "the set probe's mismatch refusal reads the transport's answer again instead of the copy it judged",
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: 'throw ownedByLibrary(new TransportKeyMismatchError({ wrote, expected, actual: names }));',
          to: 'throw ownedByLibrary(new TransportKeyMismatchError({ wrote, expected, actual: actual as string[] }));'
        }
      ]
    },
    {
      id: 'C9-answer-read-unguarded',
      arm: 'FC1',
      describe:
        "reading the transport's answer is outside the guard, so what a read of it throws leaves as itself",
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: '    return Array.isArray(answer) ? Array.from(answer as unknown[]) : undefined;\n  } catch {\n    return undefined;',
          to: '    return Array.isArray(answer) ? Array.from(answer as unknown[]) : undefined;\n  } catch (thrown) {\n    throw thrown;'
        }
      ]
    },
    {
      id: 'C9-source-declared',
      arm: 'FC1',
      describe: '`FailureSource` is written out beside the variants instead of read off them',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: "export type FailureSource = CapturedReqError['source'];",
          to: "export type FailureSource = 'descriptor' | 'relay' | 'unspecified';"
        }
      ]
    },
    {
      id: 'C9-code-union-declared',
      arm: 'FC1',
      describe: '`ReqErrorCode` is written out beside the variants instead of read off them',
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "export type ReqErrorCode = ReqError['code'];",
          to: "export type ReqErrorCode =\n  | 'invalid-descriptor'\n  | 'unsupported-filter'\n  | 'relay-not-in-scope'\n  | 'transport-incompatible'\n  | 'descriptor-unreadable'\n  | 'relay-failed'\n  | 'incomplete-result'\n  | 'accumulator-contract'\n  | 'provider-disposed'\n  | 'missing-provider'\n  | 'unspecified';"
        }
      ]
    },
    {
      id: 'C9-variant-fourth-source',
      arm: 'FC1',
      describe: 'a published variant declares a source the channel does not have',
      edits: [
        {
          file: 'src/lib/v1/reqerror.ts',
          from: "      readonly source: 'relay';",
          to: "      readonly source: 'relay' | 'transport';"
        }
      ]
    },
    {
      id: 'C9-cause-unattributed',
      arm: 'FC1',
      describe:
        'a copied cause is attributed to the fallback rather than to the door its root arrived at',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: 'copyOf(nextCause, source, depth - 1)',
          to: "copyOf(nextCause, 'unspecified', depth - 1)"
        }
      ]
    },
    {
      id: 'C9-falsy-cause-dropped',
      arm: 'FC1',
      describe: "a cause of `0`, `false` or `''` is dropped as if there were none",
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: 'const hasCause = nextCause !== undefined && nextCause !== null;',
          to: 'const hasCause = Boolean(nextCause);'
        }
      ]
    },
    {
      id: 'C9-empty-message-dropped',
      arm: 'FC1',
      describe: 'an empty message is treated as no message',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: "if (typeof message === 'string') return boundedMessage(message);",
          to: "if (typeof message === 'string' && message.length > 0) return boundedMessage(message);"
        }
      ]
    },
    {
      id: 'C9-cut-keeps-the-end',
      arm: 'FC1',
      describe: 'a cut keeps the last 200 units rather than the first',
      edits: [
        {
          file: 'src/lib/v1/normalize.ts',
          from: 'const cut = rendered.slice(0, MAX_RENDERED);',
          to: 'const cut = rendered.slice(-MAX_RENDERED);'
        }
      ]
    },
    {
      id: 'C9-truncated-declared',
      arm: 'FC1',
      describe: "a value of anybody's that says it was cut is published as cut",
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: 'isOwnedByLibrary(thrown) && safely(() => (thrown as ReqFailure).truncated) === true;',
          to: 'safely(() => (thrown as ReqFailure).truncated) === true;'
        }
      ]
    },
    {
      id: 'C9-cause-left-open',
      arm: 'FC1',
      describe: 'a copied cause is an open object another reader can add to',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: 'this.cause = fields.cause;',
          to: 'this.cause =\n      fields.cause === undefined\n        ? undefined\n        : Object.create(Object.getPrototypeOf(fields.cause), Object.getOwnPropertyDescriptors(fields.cause));'
        }
      ]
    },
    {
      id: 'C9-answer-unbounded',
      arm: 'FC1',
      describe: 'the transport refusal renders what the transport answered without a bound',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: 'const rendered = describeValue(answered);',
          to: "const rendered = JSON.stringify(answered) ?? 'undefined';"
        }
      ]
    },
    {
      id: 'C9-relay-adapter-unguarded',
      arm: 'FC1',
      describe: "the per-relay adapter's throw is rendered by a read that can throw",
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: "new TransportIncompatibleError([reportAs], [url], saidBy(thrown, String), 'threw')",
          to: "new TransportIncompatibleError([reportAs], [url], String(thrown), 'threw')"
        }
      ]
    },
    {
      id: 'C9-set-adapter-unguarded',
      arm: 'FC1',
      describe: "the set adapter's throw is rendered by a read that can throw",
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: "new TransportIncompatibleError(wrote, expected, saidBy(thrown, String), 'threw')",
          to: "new TransportIncompatibleError(wrote, expected, String(thrown), 'threw')"
        }
      ]
    },
    {
      id: 'C9-relay-input-unguarded',
      arm: 'FC1',
      describe: 'an unreadable relay entry is rendered by a read that can throw',
      edits: [
        {
          file: 'src/lib/v1/scope.svelte.ts',
          from: "new InvalidRelayInputError('a relay', `could not be read: ${saidBy(thrown, describeValue)}`)",
          to: "new InvalidRelayInputError('a relay', `could not be read: ${String(thrown)}`)"
        }
      ]
    },
    {
      id: 'C9-chain-past-the-bound-cut',
      arm: 'FC1',
      describe: "the copy deletes the caller's link past the bound",
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: 'const hasCause = nextCause !== undefined && nextCause !== null;',
          to: 'const hasCause = nextCause !== undefined && nextCause !== null;\n  if (depth === 1)\n    safely(() => {\n      delete (thrown as { cause?: unknown }).cause;\n    });'
        }
      ]
    },
    {
      id: 'C9-thrown-retained',
      arm: 'FC1',
      describe: 'the boundary keeps every value it is handed in a module-private set',
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: 'export function capture(thrown: unknown, source: FailureSource): ReqError {',
          to: 'const RETAINED = new Set<unknown>();\nexport function capture(thrown: unknown, source: FailureSource): ReqError {\n  RETAINED.add(thrown);'
        }
      ]
    },
    {
      id: 'C9-registry-strong',
      arm: 'FC1',
      describe: 'membership is a strong set, which holds everything this library ever made',
      edits: [
        {
          file: 'src/lib/v1/owned.ts',
          from: 'const OURS = new WeakSet<object>();',
          to: 'const OURS = new Set<object>();'
        }
      ]
    },
    {
      id: 'C9-caller-frozen',
      arm: 'FC1',
      describe: "the boundary freezes the caller's object on the way past",
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: 'export function capture(thrown: unknown, source: FailureSource): ReqError {',
          to: 'export function capture(thrown: unknown, source: FailureSource): ReqError {\n  safely(() => Object.freeze(thrown));'
        }
      ]
    },
    {
      id: 'C9-channel-any-code',
      arm: 'FC1',
      describe:
        "a value of this library's with a code that is not this channel's is treated as this channel's",
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: "  if (typeof code !== 'string' || !(REQ_ERROR_CODES as readonly string[]).includes(code)) {",
          to: "  if (typeof code !== 'string') {"
        }
      ]
    },
    {
      id: 'C9-original-behind-a-getter',
      arm: 'FC1',
      describe: "the copy carries the caller's value behind a getter",
      edits: [
        {
          file: 'src/lib/v1/own.ts',
          from: '    this.cause = fields.cause;\n',
          to: "    this.cause = fields.cause;\n    const original = (fields as { original?: unknown }).original;\n    if (original !== undefined) Object.defineProperty(this, 'original', { get: () => original });\n"
        },
        {
          file: 'src/lib/v1/own.ts',
          from: '      cause?.truncated === true,\n    cause\n  });',
          to: '      cause?.truncated === true,\n    cause,\n    original: thrown\n  } as never);'
        }
      ]
    },
    {
      id: 'C9-minter-shadowed',
      arm: 'FC1',
      describe: "a module binds the minter's name to the function that only closes `stack`",
      edits: [
        {
          file: 'src/lib/v1/normalize.ts',
          from: "import { hardenOwned, ownedByLibrary, sealClass } from './owned.js';",
          to: "import { hardenOwned, hardenOwned as ownedByLibrary, sealClass } from './owned.js';"
        }
      ]
    },
    {
      id: 'C9-construct-reflectively',
      arm: 'FC1',
      describe: 'a refusal is constructed through `Reflect.construct`, unminted',
      edits: [
        {
          file: 'src/lib/v1/normalize.ts',
          from: "    throw ownedByLibrary(new InvalidDescriptorError('namespace', 'must be a string'));",
          to: "    throw Reflect.construct(InvalidDescriptorError, ['namespace', 'must be a string']);"
        }
      ]
    },
    {
      id: 'I-walk-skips-accessors',
      arm: 'FC1',
      describe: "FC1's walk does not reach an accessor's functions",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '        visit(slot.get, `${path}.get ${String(key)}`);\n        visit(slot.set, `${path}.set ${String(key)}`);',
          to: '        void slot;'
        }
      ]
    },
    {
      id: 'I-walk-skips-prototypes',
      arm: 'FC1',
      describe:
        "FC1's walk does not go into a prototype that is not the platform's or the library's",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '    if (!INTRINSIC.has(prototype)) visit(prototype, `${path}.[[Prototype]]`);',
          to: '    void prototype;'
        }
      ]
    },
    {
      id: 'I-walk-skips-maps',
      arm: 'FC1',
      describe: "FC1's walk does not open a Map",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '      Map.prototype.forEach.call(value, (member: unknown, key: unknown) => {\n        visit(key, `${path} key`);\n        visit(member, `${path} entry`);\n      });',
          to: '      void Map;'
        }
      ]
    },
    {
      id: 'I-walk-skips-sets',
      arm: 'FC1',
      describe: "FC1's walk does not open a Set",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '      Set.prototype.forEach.call(value, (member: unknown) => visit(member, `${path} member`));',
          to: '      void Set;'
        }
      ]
    },
    {
      id: 'I-walk-forgives-keys',
      arm: 'FC1',
      describe: "FC1's walk passes over an object whose keys refuse to be read",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '      unread.push(`${path}: its keys`);\n',
          to: ''
        }
      ]
    },
    {
      id: 'I-walk-forgives-slots',
      arm: 'FC1',
      describe: "FC1's walk passes over a slot whose descriptor refuses to be read",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '        unread.push(`${path}.${String(key)}`);\n',
          to: ''
        }
      ]
    },
    {
      id: 'I-walk-forgives-prototypes',
      arm: 'FC1',
      describe: "FC1's walk passes over a prototype that refuses to be read",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '      unread.push(`${path}: its prototype`);\n',
          to: ''
        }
      ]
    },
    {
      id: 'I-shape-by-position',
      arm: 'FC1',
      describe:
        "FC1's shape names an object by kind rather than by identity, a node and a token alike",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '    ? identityOf(value)',
          to: "    ? 'an object'"
        },
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '        node: identityOf(node),',
          to: "        node: 'a node',"
        }
      ]
    },
    {
      id: 'I-shape-no-prototype',
      arm: 'FC1',
      describe: "FC1's shape does not record a node's prototype",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '        prototype: tokenOf(Reflect.getPrototypeOf(node)),',
          to: "        prototype: '',"
        }
      ]
    },
    {
      id: 'I-shape-no-contents',
      arm: 'FC1',
      describe: "FC1's shape does not record a collection's contents",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '        contents\n      };',
          to: '        contents: []\n      };'
        }
      ]
    },
    {
      id: 'I-openings-allow-functions',
      arm: 'FC1',
      describe: "FC1's openings let a function through",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: "    if (typeof node === 'function') found.push(`${label}: a function reachable`);\n",
          to: ''
        }
      ]
    },
    {
      id: 'I-openings-allow-open',
      arm: 'FC1',
      describe: "FC1's openings let an open node through",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '    if (!Object.isFrozen(node)) found.push(`${label}: a node still open`);\n',
          to: ''
        }
      ]
    },
    {
      id: 'I-openings-allow-accessors',
      arm: 'FC1',
      describe: "FC1's openings let an accessor through",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '        found.push(`${label}: an accessor at ${String(key)}`);',
          to: '        void label;'
        }
      ]
    },
    {
      id: 'I-openings-allow-foreign',
      arm: 'FC1',
      describe: "FC1's openings let an Error of anybody's through",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '    if (node instanceof Error && !isOwnedByLibrary(node))\n      found.push(`${label}: an Error this library did not mint`);\n',
          to: ''
        }
      ]
    },
    {
      id: 'I-collector-idle',
      arm: 'FC1',
      describe: 'FC1 asks the collector without collecting',
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '    collectGarbage();',
          to: '    void collectGarbage;'
        }
      ]
    },
    {
      id: 'I-kept-empty',
      arm: 'FC1',
      describe: "FC1's reading of what the library keeps reads nothing",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '          .map((entry) => entry.state);',
          to: '          .map(() => undefined);'
        }
      ]
    },
    {
      id: 'I-closed-always',
      arm: 'FC1',
      describe: "FC1's check that `stack` is closed answers yes to anything",
      edits: [
        {
          file: 'src/tests/contracts/engine/failure.test.ts',
          from: '        return slot?.set === undefined && slot?.writable === false && after?.value === slot.value;',
          to: '        return slot === slot && after === after;'
        }
      ]
    },
    {
      id: 'I-scan-keeps-names',
      arm: 'FC1',
      describe: 'the scan reads a minter by the name it is called through, whatever is bound to it',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/errorclasses.ts',
          from: '            unread.push(`${at(node)}: \\`${node.text}\\` bound to something it may not be`);',
          to: '            void node;'
        }
      ]
    },
    {
      id: 'I-scan-allows-reflect',
      arm: 'FC1',
      describe: 'the scan lets a construction through `Reflect.construct` pass',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/errorclasses.ts',
          from: '        unread.push(`${at(node)}: a construction through \\`Reflect.construct\\``);',
          to: '        void node;'
        }
      ]
    },
    {
      id: 'I-scan-allows-computed-reflect',
      arm: 'FC1',
      describe: 'the scan lets `Reflect` read by a computed name pass',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/errorclasses.ts',
          from: '        unread.push(`${at(node)}: \\`Reflect\\` read by a computed name`);',
          to: '        void node;'
        }
      ]
    },
    {
      id: 'I-scan-allows-non-name-bases',
      arm: 'FC1',
      describe: 'the scan lets a class whose base is not a name pass',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/errorclasses.ts',
          from: '          unread.push(`${at(node)}: a class extending something that is not a name`);',
          to: '          void node;'
        }
      ]
    },
    {
      id: 'I-scan-allows-nameless',
      arm: 'FC1',
      describe: 'the scan lets a class with no name pass',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/errorclasses.ts',
          from: '          unread.push(`${at(node)}: a class with no name to be held by`);',
          to: '          void node;'
        }
      ]
    },
    {
      id: 'I-scan-one-root',
      arm: 'FC1',
      describe: 'the population reaches `Error` and no other platform class',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/errorclasses.ts',
          from: '      if (ERROR_ROOTS.has(each.extends) || reaching.has(each.extends)) {',
          to: "      if (each.extends === 'Error' || reaching.has(each.extends)) {"
        }
      ]
    },
    {
      id: 'I-scan-reads-the-callee-as-written',
      arm: 'FC1',
      describe: 'the site scan does not see through the parentheses around a constructor',
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/errorclasses.ts',
          from: '      const callee = ts.isNewExpression(node) ? unparenthesised(node.expression) : undefined;',
          to: '      const callee = ts.isNewExpression(node) ? node.expression : undefined;'
        }
      ]
    },
    {
      id: 'I-scan-top-level-only',
      arm: 'FC1',
      describe: "the scans read the library's top level and not its components",
      edits: [
        {
          file: 'src/tests/contracts/engine/helpers/errorclasses.ts',
          from: "  (readdirSync(lib, { recursive: true, encoding: 'utf8' }) as string[])",
          to: "  (readdirSync(lib, { recursive: false, encoding: 'utf8' }) as string[])"
        }
      ]
    }
  ],
  retired: [
    {
      id: 'C9-accumulator-door-keeps',
      arm: 'FC1',
      describe: "the accumulator's catch keeps the value the accumulator threw",
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "          const error = capture(thrown, 'unspecified');",
          to: '          const error = thrown as ReqError;'
        }
      ],
      reason:
        "Equivalent while the query function is wrapped in `rejectsWithOurs`: the catch hands what the accumulator threw to `noteFailure`, which copies it, and rethrows it through the query function's boundary, which copies it again; whichever of the two a surface reads — the record, or the rejection where an older attempt's record is dropped — nothing of the caller's is published or kept. The capture here only makes the record and the rejection one object. Killed at 07fa527, before the wrapper existed, and survived in the ledger's run at b72d34b; the falsifier is the wrapper removed, which `C9-query-function-unwrapped` holds."
    }
  ]
} satisfies Ledger;
