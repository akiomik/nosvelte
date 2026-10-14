/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of three rows of the verification gate and their
 * landings: `A-ε-C4` on `VG1` (only `true` delivers, on either leg),
 * `A-ε-C11` on `VG2` (a verifier that throws synchronously) and `A-ε-C17` on
 * `AH2` (the provider's verifier is the one a request is checked by). An id
 * beginning `C4-`, `C11-` or `C17-` edits the library; one beginning `I-` edits
 * one of the arm's own instruments.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const GATE = 'src/tests/contracts/engine/gate.test.ts';
const ADMISSION = 'src/tests/contracts/admission.test.ts';
const ESCAPES = 'src/tests/contracts/engine/helpers/escapes.ts';

/** The answer the machine reads off the verifier, and what it does with it. */
const FULFILLED = '        (ok) => leave(ok === true),';
/** What the machine does when the verifier fails. */
const REJECTED = '        () => leave(false)';

export default {
  name: 'a-epsilon-gate',
  subject:
    '`A-ε-C4` (only `true` delivers), `A-ε-C11` (a verifier that throws synchronously) and `A-ε-C17` (the provider’s verifier reaches the engine): their landings, `VG1`, `VG2` and `AH2`',
  files: [GATE, ADMISSION],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { VG1: 4, VG2: 5, AH2: 4 }
  },
  entries: [
    {
      id: 'C4-truthy',
      arm: 'VG1',
      describe: "the verifier's answer is read for truthiness",
      edits: [{ file: MACHINE, from: FULFILLED, to: '        (ok) => leave(Boolean(ok)),' }]
    },
    {
      id: 'C4-loose-equal',
      arm: 'VG1',
      describe: "the verifier's answer is compared with `true` loosely, which takes `1`",
      edits: [{ file: MACHINE, from: FULFILLED, to: '        (ok) => leave(ok == true),' }]
    },
    {
      id: 'C4-not-false',
      arm: 'VG1',
      describe: 'anything but `false` delivers',
      edits: [{ file: MACHINE, from: FULFILLED, to: '        (ok) => leave(ok !== false),' }]
    },
    {
      id: 'C4-unverified',
      arm: 'VG1',
      describe: "the verifier's answer is not read at all",
      edits: [{ file: MACHINE, from: FULFILLED, to: '        () => leave(true),' }]
    },
    {
      id: 'C4-forward-unverified',
      arm: 'VG1',
      describe: 'the forward leg delivers an event its verifier refused',
      edits: [
        {
          file: MACHINE,
          from: FULFILLED,
          to: "        (ok) => leave(ok === true || (leg === 'forward' && ok === false)),"
        }
      ]
    },
    {
      id: 'C4-backward-unverified',
      arm: 'VG1',
      describe:
        'the backward leg delivers an event its verifier refused, and still only `true` delivers otherwise',
      edits: [
        {
          file: MACHINE,
          from: FULFILLED,
          to: "        (ok) => leave(ok === true || (leg === 'backward' && ok === false)),"
        }
      ]
    },
    {
      id: 'C4-forward-drops',
      arm: 'VG1',
      describe: 'the forward leg delivers nothing, the genuine event included',
      edits: [
        {
          file: MACHINE,
          from: FULFILLED,
          to: "        (ok) => leave(ok === true && leg !== 'forward'),"
        }
      ]
    },
    {
      id: 'C4-backward-drops',
      arm: 'VG1',
      describe: 'the backward leg delivers nothing, the genuine event included',
      edits: [
        {
          file: MACHINE,
          from: FULFILLED,
          to: "        (ok) => leave(ok === true && leg !== 'backward'),"
        }
      ]
    },
    {
      id: 'C4-forward-truthy',
      arm: 'VG1',
      describe: "the forward leg reads the verifier's answer for truthiness",
      edits: [
        {
          file: MACHINE,
          from: FULFILLED,
          to: "        (ok) => leave(leg === 'forward' ? Boolean(ok) : ok === true),"
        }
      ]
    },
    {
      id: 'C4-nullish',
      arm: 'VG1',
      describe: 'a verifier that answers nothing has passed',
      edits: [
        {
          file: MACHINE,
          from: FULFILLED,
          to: '        (ok) => leave(ok === true || ok === undefined || ok === null),'
        }
      ]
    },
    {
      id: 'C4-null',
      arm: 'VG1',
      describe: 'a verifier that answers `null` has passed',
      edits: [
        { file: MACHINE, from: FULFILLED, to: '        (ok) => leave(ok === true || ok === null),' }
      ]
    },
    {
      id: 'C4-spelled-true',
      arm: 'VG1',
      describe: 'anything that renders as `true` delivers',
      edits: [
        { file: MACHINE, from: FULFILLED, to: "        (ok) => leave(String(ok) === 'true')," }
      ]
    },
    {
      id: 'C4-forward-during-backlog',
      arm: 'VG1',
      describe: 'the forward leg delivers what it is handed while the backlog is still being read',
      edits: [
        {
          file: MACHINE,
          from: FULFILLED,
          to: "        (ok) => leave(ok === true || (leg === 'forward' && gates.backward.phase === 'open')),"
        }
      ]
    },
    {
      id: 'I-forward-refused-not-sent',
      arm: 'VG1',
      describe:
        'the forward leg’s refused event is sent on the backward leg instead, after its EOSE',
      edits: [
        {
          file: GATE,
          from: "    respondWithEvent(live.server, forward, fakeEvent({ content: 'REFUSED-forward' }));",
          to: "    respondWithEvent(live.server, backward, fakeEvent({ content: 'REFUSED-forward' }));"
        }
      ]
    },
    {
      id: 'I-gate-refuses-nothing',
      arm: 'VG1',
      describe: "the arm's verifier answers `true` for every event",
      edits: [
        {
          file: GATE,
          from: "      if (event.content.startsWith('REFUSED')) return false;\n      if (event.content.startsWith('LOOSE')) return 'nope';\n",
          to: ''
        }
      ]
    },
    {
      id: 'I-true-control-missing',
      arm: 'VG1',
      describe: 'the verifier answering `true` is left out of the answers',
      edits: [
        {
          file: GATE,
          from: "      ['a boxed true', Object(true) as unknown],\n      ['true', true]\n",
          to: "      ['a boxed true', Object(true) as unknown]\n"
        }
      ]
    },
    {
      id: 'C11-bare-call',
      arm: 'VG2',
      describe:
        'the verifier is called bare, so a synchronous throw leaves through the subscription’s callback',
      edits: [
        {
          file: MACHINE,
          from: '    Promise.resolve()\n      .then(() => verifyEvent(packet.event as unknown as Nostr.Event))\n',
          to: '    verifyEvent(packet.event as unknown as Nostr.Event)\n'
        }
      ]
    },
    {
      id: 'C11-no-rejection-handler',
      arm: 'VG2',
      describe:
        'a verifier that fails has no handler: the rejection is unhandled and the gate held',
      edits: [{ file: MACHINE, from: `${REJECTED}\n      );`, to: '      );' }]
    },
    {
      id: 'C11-rejection-delivers',
      arm: 'VG2',
      describe: 'a verifier that fails delivers the event',
      edits: [{ file: MACHINE, from: REJECTED, to: '        () => leave(true)' }]
    },
    {
      id: 'C11-rejection-wedges',
      arm: 'VG2',
      describe: 'a verifier that fails never releases the admission',
      edits: [{ file: MACHINE, from: REJECTED, to: '        () => undefined' }]
    },
    {
      id: 'C11-rejection-rethrows',
      arm: 'VG2',
      describe:
        'a verifier that fails drops the event and releases the admission, and the failure is thrown on as an unhandled rejection',
      edits: [
        {
          file: MACHINE,
          from: REJECTED,
          to: '        (error: unknown) => {\n          leave(false);\n          throw error;\n        }'
        }
      ]
    },
    {
      id: 'C11-throw-escapes-next',
      arm: 'VG2',
      describe:
        "the verifier is also called bare after the guarded call, so a synchronous throw leaves through the subscription's callback while the outcome stays right",
      edits: [
        {
          file: MACHINE,
          from: `${REJECTED}\n      );\n`,
          to: `${REJECTED}\n      );\n    void verifyEvent(packet.event as unknown as Nostr.Event);\n`
        }
      ]
    },
    {
      id: 'C11-rejection-throws-later',
      arm: 'VG2',
      describe:
        'a verifier that fails drops the event and releases the admission, and the failure is thrown again from a microtask',
      edits: [
        {
          file: MACHINE,
          from: REJECTED,
          to: '        (error: unknown) => {\n          leave(false);\n          queueMicrotask(() => {\n            throw error;\n          });\n        }'
        }
      ]
    },
    {
      id: 'C11-extra-chunk',
      arm: 'VG2',
      describe:
        'a verifier that fails drops the event and puts a chunk of its own beside the outcome',
      edits: [
        {
          file: MACHINE,
          from: REJECTED,
          to: "        () => {\n          leave(false);\n          push({ type: 'legEnded', leg: 'forward', reason: undefined });\n        }"
        }
      ]
    },
    {
      id: 'I-throwing-verifier-async',
      arm: 'VG2',
      describe: "the arm's throwing verifier is an `async` function, which rejects instead",
      edits: [
        {
          file: GATE,
          from: "          (): Promise<boolean> => {\n            throw new Error('nosvelte test: thrown by the verifier');",
          to: "          async (): Promise<boolean> => {\n            throw new Error('nosvelte test: thrown by the verifier');"
        }
      ]
    },
    {
      id: 'I-collector-deaf-to-uncaught',
      arm: 'VG2',
      describe: 'the collector drops what reaches `uncaughtException`',
      edits: [
        {
          file: ESCAPES,
          from: '    (error: unknown): void => {\n      seen.push(',
          to: "    (error: unknown): void => {\n      if (channel === 'uncaughtException') return;\n      seen.push("
        }
      ]
    },
    {
      id: 'I-collector-deaf-to-rejections',
      arm: 'VG2',
      describe: 'the collector drops what reaches `unhandledRejection`',
      edits: [
        {
          file: ESCAPES,
          from: '    (error: unknown): void => {\n      seen.push(',
          to: "    (error: unknown): void => {\n      if (channel === 'unhandledRejection') return;\n      seen.push("
        }
      ]
    },
    {
      id: 'C17-runtime-accepts',
      arm: 'AH2',
      describe:
        "a provider's request is handed a verifier that accepts everything, not the provider's",
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '          verifierOf: () => inputs.verifyEvent,',
          to: '          verifierOf: () => async () => true,'
        }
      ]
    },
    {
      id: 'C17-bundle-accepts',
      arm: 'AH2',
      describe: "the provider's bundle hands its requests a verifier that accepts everything",
      edits: [
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: '    get verifyEvent() {\n      return context.verifyEvent;',
          to: '    get verifyEvent() {\n      return async () => true;'
        }
      ]
    },
    {
      id: 'C17-default-accepts',
      arm: 'AH2',
      describe: "the provider's default verifier accepts everything",
      edits: [
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: '  const verifyEvent = options.verifyEvent ?? libraryVerifier;',
          to: '  const verifyEvent = options.verifyEvent ?? (async () => true);\n  void libraryVerifier;'
        }
      ]
    },
    {
      id: 'C17-gate-bypassed',
      arm: 'AH2',
      describe: 'the machine never asks the verifier it was given',
      edits: [
        {
          file: MACHINE,
          from: '      .then(() => verifyEvent(packet.event as unknown as Nostr.Event))',
          to: '      .then(() => {\n        void verifyEvent;\n        return true;\n      })'
        }
      ]
    },
    {
      id: 'C17-verifier-absent',
      arm: 'AH2',
      describe:
        "a provider's request is handed no verifier, so it refuses before asking the relay: the arm fails on its bounded wait for the REQs, which names the refusal",
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '          verifierOf: () => inputs.verifyEvent,',
          to: '          verifierOf: () => undefined,'
        }
      ]
    },
    {
      id: 'C17-refresh-rereads-context',
      arm: 'AH2',
      describe:
        'each attempt looks the provider up again for its verifier, which a refresh outside the component cannot',
      edits: [
        {
          file: 'src/lib/v1/useStreamedReq.svelte.ts',
          from: '        verifyEvent: verifyEvent ?? noVerifier(),',
          to: '        verifyEvent: (() => {\n          void verifyEvent;\n          return tryGetNostrContext()?.verifyEvent ?? noVerifier();\n        })(),'
        }
      ]
    },
    {
      id: 'C17-stream-drops-verifier',
      arm: 'AH2',
      describe: 'the stream hands the machine a verifier that passes whatever its own answered',
      edits: [
        {
          file: 'src/lib/v1/stream.ts',
          from: '      verifyEvent,\n      ...(settleTimeoutMs',
          to: '      verifyEvent: async (event) => (await verifyEvent(event)) || true,\n      ...(settleTimeoutMs'
        }
      ]
    },
    {
      id: 'I-changed-equals-genuine',
      arm: 'AH2',
      describe: "the arm's changed event is the genuine one, unchanged",
      edits: [
        {
          file: ADMISSION,
          from: '        return { door, genuine, changed: { ...genuine, content: `changed on the ${door} leg` } };',
          to: '        return { door, genuine, changed: { ...genuine } };'
        }
      ]
    },
    {
      id: 'I-whole-reads-the-id',
      arm: 'AH2',
      describe: "the arm's comparison reads the id and nothing else",
      edits: [
        {
          file: ADMISSION,
          from: 'const whole = (event: Nostr.Event | ReqEvent) => ({\n  id: event.id,\n  pubkey: event.pubkey,\n  created_at: event.created_at,\n  kind: event.kind,\n  tags: event.tags.map((tag) => [...tag]),\n  content: event.content,\n  sig: event.sig\n});',
          to: 'const whole = (event: Nostr.Event | ReqEvent) => ({\n  id: event.id\n});'
        }
      ]
    }
  ],
  retired: []
} satisfies Ledger;
