/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of `A-ε-C18`'s landing, `AH1` (an event is admitted or
 * sent only when its id is the hash of its fields and its signature is over
 * that hash): each entry an edit `AH1` must fail under. An id beginning `C18-`
 * edits the library; one beginning `I-` edits one of `AH1`'s own instruments.
 */
import type { Ledger } from '../ledger.ts';

export default {
  name: 'a-epsilon-c18',
  subject: '`A-ε-C18` (what an event has to be to be admitted or sent): its landing, `AH1`',
  files: ['src/tests/contracts/admission.test.ts'],
  calibration: {
    measured:
      "one run of AH1's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { AH1: 4 }
  },
  entries: [
    {
      id: 'C18-id-unchecked',
      arm: 'AH1',
      describe:
        "the verifier checks the signature over the hash and never compares the hash with `id`, as the dependency's did",
      edits: [
        {
          file: 'src/lib/v1/verify.ts',
          from: '    return hash === event.id && schnorr.verify(event.sig, hash, event.pubkey);',
          to: '    return schnorr.verify(event.sig, hash, event.pubkey);'
        }
      ]
    },
    {
      id: 'C18-id-case-insensitive',
      arm: 'AH1',
      describe: 'the id is compared to the hash without regard to case',
      edits: [
        {
          file: 'src/lib/v1/verify.ts',
          from: '    return hash === event.id && schnorr.verify(event.sig, hash, event.pubkey);',
          to: '    return hash === event.id.toLowerCase() && schnorr.verify(event.sig, hash, event.pubkey);'
        }
      ]
    },
    {
      id: 'C18-signature-unchecked',
      arm: 'AH1',
      describe: 'the verifier compares the id with the hash and ignores the signature',
      edits: [
        {
          file: 'src/lib/v1/verify.ts',
          from: '    return hash === event.id && schnorr.verify(event.sig, hash, event.pubkey);',
          to: '    return hash === event.id && (schnorr.verify(event.sig, hash, event.pubkey) || true);'
        }
      ]
    },
    {
      id: 'C18-throw-escapes',
      arm: 'AH1',
      describe:
        'a schnorr check that throws leaves the verifier as a rejection rather than `false`',
      edits: [
        {
          file: 'src/lib/v1/verify.ts',
          from: '  } catch {\n    return false;\n  }',
          to: '  } finally {\n    void 0;\n  }'
        }
      ]
    },
    {
      id: 'C18-throw-reported',
      arm: 'AH1',
      describe:
        "the verifier writes what it caught to the console, as the dependency's `verify` does",
      edits: [
        {
          file: 'src/lib/v1/verify.ts',
          from: '  } catch {\n    return false;\n  }',
          to: "  } catch (caught) {\n    console.warn('verify failed', caught);\n    return false;\n  }"
        }
      ]
    },
    {
      id: 'C18-default-is-dependency',
      arm: 'AH1',
      describe: "the provider's default verifier is the dependency's again",
      edits: [
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: "import { createRxNostr } from 'rx-nostr';\n",
          to: "import { createRxNostr } from 'rx-nostr';\nimport { verifier } from 'rx-nostr-crypto';\n"
        },
        {
          file: 'src/lib/v1/context.svelte.ts',
          from: '  const verifyEvent = options.verifyEvent ?? libraryVerifier;',
          to: '  const verifyEvent = options.verifyEvent ?? verifier;\n  void libraryVerifier;'
        }
      ]
    },
    {
      id: 'C18-backward-unverified',
      arm: 'AH1',
      describe: 'the backward leg admits what it is handed without asking the verifier',
      edits: [
        {
          file: 'src/lib/v1/machine.ts',
          from: '      .then(() => verifyEvent(packet.event as unknown as Nostr.Event))',
          to: "      .then(() => leg === 'backward' || verifyEvent(packet.event as unknown as Nostr.Event))"
        }
      ]
    },
    {
      id: 'C18-forward-unverified',
      arm: 'AH1',
      describe: 'the forward leg admits what it is handed without asking the verifier',
      edits: [
        {
          file: 'src/lib/v1/machine.ts',
          from: '      .then(() => verifyEvent(packet.event as unknown as Nostr.Event))',
          to: "      .then(() => leg === 'forward' || verifyEvent(packet.event as unknown as Nostr.Event))"
        }
      ]
    },
    {
      id: 'C18-backward-id-only',
      arm: 'AH1',
      describe:
        'the backward leg compares the id with the hash and asks nothing about the signature',
      edits: [
        {
          file: 'src/lib/v1/machine.ts',
          from: "import { ownPacket } from './event.js';",
          to: "import { ownPacket } from './event.js';\nimport { getEventHash } from 'rx-nostr-crypto';"
        },
        {
          file: 'src/lib/v1/machine.ts',
          from: '      .then(() => verifyEvent(packet.event as unknown as Nostr.Event))',
          to: "      .then(() =>\n        leg === 'backward'\n          ? getEventHash(packet.event as unknown as Nostr.Event) === packet.event.id\n          : verifyEvent(packet.event as unknown as Nostr.Event)\n      )"
        }
      ]
    },
    {
      id: 'C18-forward-id-only',
      arm: 'AH1',
      describe:
        'the forward leg compares the id with the hash and asks nothing about the signature',
      edits: [
        {
          file: 'src/lib/v1/machine.ts',
          from: "import { ownPacket } from './event.js';",
          to: "import { ownPacket } from './event.js';\nimport { getEventHash } from 'rx-nostr-crypto';"
        },
        {
          file: 'src/lib/v1/machine.ts',
          from: '      .then(() => verifyEvent(packet.event as unknown as Nostr.Event))',
          to: "      .then(() =>\n        leg === 'forward'\n          ? getEventHash(packet.event as unknown as Nostr.Event) === packet.event.id\n          : verifyEvent(packet.event as unknown as Nostr.Event)\n      )"
        }
      ]
    },
    {
      id: 'C18-backward-signature-only',
      arm: 'AH1',
      describe: "the backward leg asks the dependency's verifier, which never compares the id",
      edits: [
        {
          file: 'src/lib/v1/machine.ts',
          from: "import { ownPacket } from './event.js';",
          to: "import { ownPacket } from './event.js';\nimport { verifier } from 'rx-nostr-crypto';"
        },
        {
          file: 'src/lib/v1/machine.ts',
          from: '      .then(() => verifyEvent(packet.event as unknown as Nostr.Event))',
          to: "      .then(() =>\n        leg === 'backward'\n          ? verifier(packet.event as unknown as Nostr.Event)\n          : verifyEvent(packet.event as unknown as Nostr.Event)\n      )"
        }
      ]
    },
    {
      id: 'C18-forward-signature-only',
      arm: 'AH1',
      describe: "the forward leg asks the dependency's verifier, which never compares the id",
      edits: [
        {
          file: 'src/lib/v1/machine.ts',
          from: "import { ownPacket } from './event.js';",
          to: "import { ownPacket } from './event.js';\nimport { verifier } from 'rx-nostr-crypto';"
        },
        {
          file: 'src/lib/v1/machine.ts',
          from: '      .then(() => verifyEvent(packet.event as unknown as Nostr.Event))',
          to: "      .then(() =>\n        leg === 'forward'\n          ? verifier(packet.event as unknown as Nostr.Event)\n          : verifyEvent(packet.event as unknown as Nostr.Event)\n      )"
        }
      ]
    },
    {
      id: 'C18-input-unverified',
      arm: 'AH1',
      describe: 'a signed input to `useSend` goes out without asking the verifier',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '    const copy = ownCopy(held);\n    return (await port.verifyEvent(copy))',
          to: "    const copy = ownCopy(held);\n    return String(copy.id) !== '\\0' || (await port.verifyEvent(copy))"
        }
      ]
    },
    {
      id: 'C18-signer-unverified',
      arm: 'AH1',
      describe: 'what a signer returns goes out without asking the verifier',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "  return (await port.verifyEvent(copy))\n    ? copy\n    : refused(\n        'signer-failed',",
          to: "  return String(copy.id) !== '\\0' || (await port.verifyEvent(copy))\n    ? copy\n    : refused(\n        'signer-failed',"
        }
      ]
    },
    {
      id: 'C18-input-id-only',
      arm: 'AH1',
      describe: 'a signed input is checked for its id and not its signature',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "import { relayMessage } from './normalize.js';",
          to: "import { relayMessage } from './normalize.js';\nimport { getEventHash } from 'rx-nostr-crypto';"
        },
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '    const copy = ownCopy(held);\n    return (await port.verifyEvent(copy))',
          to: '    const copy = ownCopy(held);\n    return getEventHash(copy) === copy.id'
        }
      ]
    },
    {
      id: 'C18-signer-id-only',
      arm: 'AH1',
      describe: 'what a signer returns is checked for its id and not its signature',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "import { relayMessage } from './normalize.js';",
          to: "import { relayMessage } from './normalize.js';\nimport { getEventHash } from 'rx-nostr-crypto';"
        },
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "  return (await port.verifyEvent(copy))\n    ? copy\n    : refused(\n        'signer-failed',",
          to: "  return getEventHash(copy) === copy.id\n    ? copy\n    : refused(\n        'signer-failed',"
        }
      ]
    },
    {
      id: 'C18-input-signature-only',
      arm: 'AH1',
      describe:
        "a signed input is checked by the dependency's verifier, which never compares the id",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "import { relayMessage } from './normalize.js';",
          to: "import { relayMessage } from './normalize.js';\nimport { verifier } from 'rx-nostr-crypto';"
        },
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '    const copy = ownCopy(held);\n    return (await port.verifyEvent(copy))',
          to: '    const copy = ownCopy(held);\n    return (await verifier(copy))'
        }
      ]
    },
    {
      id: 'C18-signer-signature-only',
      arm: 'AH1',
      describe:
        "what a signer returns is checked by the dependency's verifier, which never compares the id",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "import { relayMessage } from './normalize.js';",
          to: "import { relayMessage } from './normalize.js';\nimport { verifier } from 'rx-nostr-crypto';"
        },
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "  return (await port.verifyEvent(copy))\n    ? copy\n    : refused(\n        'signer-failed',",
          to: "  return (await verifier(copy))\n    ? copy\n    : refused(\n        'signer-failed',"
        }
      ]
    },
    {
      id: 'C18-input-refused-as-signer',
      arm: 'AH1',
      describe: "a signed input that does not verify is refused `'signer-failed'`",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "          'invalid-event',\n          'the event does not verify:",
          to: "          'signer-failed',\n          'the event does not verify:"
        }
      ]
    },
    {
      id: 'C18-signer-refused-as-input',
      arm: 'AH1',
      describe: "a signer's event that does not verify is refused `'invalid-event'`",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "        'signer-failed',\n        \"the signer's event does not verify:",
          to: "        'invalid-event',\n        \"the signer's event does not verify:"
        }
      ]
    },
    {
      id: 'C18-input-refused-but-sent',
      arm: 'AH1',
      describe: 'a signed input that does not verify is refused, and put on the wire anyway',
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: '    const copy = ownCopy(held);\n    return (await port.verifyEvent(copy))',
          to: '    const copy = ownCopy(held);\n    return (await port.verifyEvent(copy)) ||\n      (port.transportLease\n        ?.send(copy, { signer: { signEvent: async () => copy, getPublicKey: async () => copy.pubkey } } as never)\n        ?.subscribe(),\n      false)'
        }
      ]
    },
    {
      id: 'C18-signer-refused-but-sent',
      arm: 'AH1',
      describe: "a signer's event that does not verify is refused, and put on the wire anyway",
      edits: [
        {
          file: 'src/lib/v1/send.svelte.ts',
          from: "  return (await port.verifyEvent(copy))\n    ? copy\n    : refused(\n        'signer-failed',",
          to: "  return (await port.verifyEvent(copy)) ||\n    (port.transportLease\n      ?.send(copy, { signer: { signEvent: async () => copy, getPublicKey: async () => copy.pubkey } } as never)\n      ?.subscribe(),\n    false)\n    ? copy\n    : refused(\n        'signer-failed',"
        }
      ]
    },
    {
      id: 'I-wire-reader-blind',
      arm: 'AH1',
      describe: "the arm's wire reader finds no EVENT frame",
      edits: [
        {
          file: 'src/tests/contracts/admission.test.ts',
          from: "    (relay.messages as unknown[][]).filter((frame) => frame[0] === 'EVENT');",
          to: "    (relay.messages as unknown[][]).filter((frame) => frame[0] === 'EVENTS');"
        }
      ]
    },
    {
      id: 'I-comparison-by-id',
      arm: 'AH1',
      describe:
        "the arm compares events by id alone, which reads the takeover as the victim's event",
      edits: [
        {
          file: 'src/tests/contracts/admission.test.ts',
          from: 'const whole = (event: Nostr.Event | ReqEvent) => ({\n  id: event.id,\n  pubkey: event.pubkey,\n  created_at: event.created_at,\n  kind: event.kind,\n  tags: event.tags.map((tag) => [...tag]),\n  content: event.content,\n  sig: event.sig\n});',
          to: 'const whole = (event: Nostr.Event | ReqEvent) => ({\n  id: event.id\n});'
        }
      ]
    },
    {
      id: 'I-console-unread',
      arm: 'AH1',
      describe: 'the arm reads no console call',
      edits: [
        {
          file: 'src/tests/contracts/admission.test.ts',
          from: '        console_.flatMap((spy) => spy.mock.calls),',
          to: '        console_.flatMap(() => []),'
        }
      ]
    }
  ],
  retired: [
    {
      id: 'C18-signature-over-id',
      arm: 'AH1',
      reason:
        'Equivalent: it is reached only once the hash equals `id`, so the two messages are one string. The falsifier is a verifier that checks the signature before or without the comparison, which is `C18-id-unchecked`.',
      describe: 'the signature is checked over `id` rather than over the hash',
      edits: [
        {
          file: 'src/lib/v1/verify.ts',
          from: '    return hash === event.id && schnorr.verify(event.sig, hash, event.pubkey);',
          to: '    return hash === event.id && schnorr.verify(event.sig, event.id, event.pubkey);'
        }
      ]
    },
    {
      id: 'C18-admits-unless-false',
      arm: 'AH1',
      reason:
        "Equivalent under this row's arrangements: the library's verifier answers a boolean on every path, so `ok !== false` and `ok === true` agree on it. What separates them is a caller-supplied verifier that answers something else, which is the engine's seam and not a door this row arranges.",
      describe: 'the admission gate delivers on any answer but `false`',
      edits: [
        {
          file: 'src/lib/v1/machine.ts',
          from: '        (ok) => leave(ok === true),',
          to: '        (ok) => leave(ok !== false),'
        }
      ]
    }
  ]
} satisfies Ledger;
