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
      "one run of each arm's duration in a single Vitest run at 45de427, plus 3.5 s for a run's start-up, measured as one run of one fast arm; one worker, on a shared 10-core machine",
    seconds: {
      FC1: 5.2,
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
      requires: ['PB6'],
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
      id: 'C9-accumulator-door-keeps',
      arm: 'FC1',
      requires: ['PB6'],
      describe: "the accumulator's catch keeps the value the accumulator threw",
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "          const error = capture(thrown, 'unspecified');",
          to: '          const error = thrown as ReqError;'
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
      id: 'C9-state-keeps',
      arm: 'FC1',
      describe: "the state publishes the query's error as it is",
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: "    query.status === 'error' ? terminalFailure(capture(query.error, 'unspecified')) : undefined;",
          to: "    query.status === 'error' ? (query.error as unknown as ReqStateError) : undefined;"
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
      requires: ['PB7'],
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
      describe: 'a value with a channel code counts as ours',
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
          from: "    if (slot !== undefined && 'value' in slot) reachable(slot.value, seen);",
          to: '    void slot;'
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
          from: '  const nodes = [...reachable(root)];',
          to: '  const nodes = [root];'
        }
      ]
    }
  ]
} satisfies Ledger;
