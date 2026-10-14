/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of `A-ε-C15`'s landing, `WB1` (the boundary where an
 * event off the wire becomes this library's own): each entry an edit `WB1`
 * must fail under. An id beginning `C15-` edits the library; one beginning
 * `I-` edits one of `WB1`'s own instruments.
 */
import type { Ledger } from '../ledger.ts';

const EVENT = 'src/lib/v1/event.ts';
const MACHINE = 'src/lib/v1/machine.ts';
const LEASE = 'src/lib/v1/lease.ts';
const NORMALIZE = 'src/lib/v1/normalize.ts';
const ARM = 'src/tests/contracts/engine/boundary.test.ts';

/** The one line `ownEvent` freezes and returns its copy on. */
const RETURNED = '  return Object.freeze(owned);';
/** How the copy's tag list is built and frozen. */
const FROZEN_TAGS = '    tags: Object.freeze(tags.map((tag) => Object.freeze(tag))),';
/** The materialised tag list, and its check. */
const MATERIALISED =
  '  const tags = Array.isArray(wire)\n    ? Array.from(wire as unknown[], (tag) => (Array.isArray(tag) ? [...(tag as unknown[])] : tag))\n    : wire;\n  if (!isWireTags(tags)) return undefined;';
/** What `ownEvent` does with a candidate that is not an event. */
const DROPPED = '    if (packet === undefined) return;';
/** How a relay message is rendered first. */
const RENDERED =
  "  const rendered = typeof value === 'string' ? whole(value) : renderValue(value);";
/** The seam's check that a control message is attributable. */
const ATTRIBUTABLE =
  "        if (typeof held.from !== 'string' || typeof held.subId !== 'string') return undefined;";

export default {
  name: 'a-epsilon-c15',
  subject:
    '`A-ε-C15` (the boundary where an event off the wire becomes this library’s own): its landing, `WB1`',
  files: [ARM],
  calibration: {
    measured:
      "one run of WB1's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { WB1: 7 }
  },
  entries: [
    {
      id: 'C15-verify-wire',
      arm: 'WB1',
      describe: "the verifier is handed the wire's object, not this library's copy",
      edits: [
        {
          file: MACHINE,
          from: '      .then(() => verifyEvent(packet.event as unknown as Nostr.Event))',
          to: '      .then(() => verifyEvent(incoming.event))'
        }
      ]
    },
    {
      id: 'C15-recopy-on-leave',
      arm: 'WB1',
      describe: 'what passed the gate is copied again, off the wire, when it is handed on',
      edits: [
        {
          file: MACHINE,
          from: "      if (deliver && !admission.discarded) push({ type: 'event', packet });",
          to: "      if (deliver && !admission.discarded) push({ type: 'event', packet: ownPacket(incoming) ?? packet });"
        }
      ]
    },
    {
      id: 'C15-project-recopy',
      arm: 'WB1',
      describe: 'the hook publishes a copy of what the cache holds',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    events.push(packet.event);',
          to: '    events.push(Object.freeze({ ...packet.event }));'
        }
      ]
    },
    {
      id: 'C15-freeze-wire',
      arm: 'WB1',
      describe: "the boundary freezes the dependency's event as well as its own copy",
      edits: [{ file: EVENT, from: RETURNED, to: `  Object.freeze(value);\n${RETURNED}` }]
    },
    {
      id: 'C15-alias-wire-tags',
      arm: 'WB1',
      describe: "the copy keeps the wire's tag arrays, so its freeze lands on the dependency's",
      edits: [
        {
          file: EVENT,
          from: MATERIALISED,
          to: '  const tags = wire;\n  if (!isWireTags(tags)) return undefined;'
        }
      ]
    },
    {
      id: 'C15-event-unfrozen',
      arm: 'WB1',
      describe: 'the copy itself is not frozen',
      edits: [{ file: EVENT, from: RETURNED, to: '  return owned;' }]
    },
    {
      id: 'C15-tags-unfrozen',
      arm: 'WB1',
      describe: "the copy's tag list is not frozen",
      edits: [
        {
          file: EVENT,
          from: FROZEN_TAGS,
          to: '    tags: tags.map((tag) => Object.freeze(tag)),'
        }
      ]
    },
    {
      id: 'C15-tag-unfrozen',
      arm: 'WB1',
      describe: "the copy's tags are not frozen",
      edits: [
        { file: EVENT, from: FROZEN_TAGS, to: '    tags: Object.freeze(tags.map((tag) => tag)),' }
      ]
    },
    {
      id: 'C15-sig-miscopied',
      arm: 'WB1',
      describe: 'the copy takes its signature from another field',
      edits: [{ file: EVENT, from: '    sig: snapshot.sig,', to: '    sig: snapshot.id,' }]
    },
    {
      id: 'C15-created-at-miscopied',
      arm: 'WB1',
      describe: 'the copy takes its timestamp from another field',
      edits: [
        {
          file: EVENT,
          from: '    created_at: snapshot.created_at,',
          to: '    created_at: snapshot.kind,'
        }
      ]
    },
    {
      id: 'C15-ots-dropped',
      arm: 'WB1',
      describe: '`ots` is not carried when the wire had one',
      edits: [
        {
          file: EVENT,
          from: '    ...(snapshot.ots === undefined ? {} : { ots: snapshot.ots })',
          to: '    ...{}'
        }
      ]
    },
    {
      id: 'C15-ots-always',
      arm: 'WB1',
      describe: '`ots` is written when the wire had none',
      edits: [
        {
          file: EVENT,
          from: '    ...(snapshot.ots === undefined ? {} : { ots: snapshot.ots })',
          to: "    ...(snapshot.ots === undefined ? { ots: '' } : { ots: snapshot.ots })"
        }
      ]
    },
    {
      id: 'C15-tags-null-thrown',
      arm: 'WB1',
      describe:
        'a tag list that is not a list is walked anyway, and throws out of the subscription',
      edits: [
        {
          file: EVENT,
          from: '  if (!Array.isArray(value)) return false;',
          to: '  if (value === undefined) return false;'
        }
      ]
    },
    {
      id: 'C15-tag-list-unchecked',
      arm: 'WB1',
      describe: 'a tag that is a string is taken for a list',
      edits: [
        {
          file: EVENT,
          from: '    if (!Array.isArray(tag)) return false;',
          to: "    if (!Array.isArray(tag) && typeof tag !== 'string') return false;"
        }
      ]
    },
    {
      id: 'C15-tag-element-unchecked',
      arm: 'WB1',
      describe: 'a tag element that is not a string is kept',
      edits: [
        {
          file: EVENT,
          from: "    for (const item of tag) if (typeof item !== 'string') return false;",
          to: "    for (const item of tag) if (typeof item === 'symbol') return false;"
        }
      ]
    },
    {
      id: 'C15-id-unchecked',
      arm: 'WB1',
      describe: 'an id that is not a string is kept',
      edits: [
        {
          file: EVENT,
          from: "  if (typeof event['id'] !== 'string') return false;",
          to: "  if (event['id'] === undefined) return false;"
        }
      ]
    },
    {
      id: 'C15-sig-unchecked',
      arm: 'WB1',
      describe: 'a missing signature is kept',
      edits: [
        {
          file: EVENT,
          from: "  if (typeof event['sig'] !== 'string') return false;",
          to: "  if (event['sig'] === null) return false;"
        }
      ]
    },
    {
      id: 'C15-pubkey-unchecked',
      arm: 'WB1',
      describe: 'a pubkey that is null is kept',
      edits: [
        {
          file: EVENT,
          from: "  if (typeof event['pubkey'] !== 'string') return false;",
          to: "  if (event['pubkey'] === undefined) return false;"
        }
      ]
    },
    {
      id: 'C15-content-unchecked',
      arm: 'WB1',
      describe: 'content that is not a string is kept',
      edits: [
        {
          file: EVENT,
          from: "  if (typeof event['content'] !== 'string') return false;",
          to: "  if (event['content'] === undefined) return false;"
        }
      ]
    },
    {
      id: 'C15-kind-unchecked',
      arm: 'WB1',
      describe: 'a kind that is not finite is kept',
      edits: [
        {
          file: EVENT,
          from: "  if (typeof event['kind'] !== 'number' || !Number.isFinite(event['kind'])) return false;",
          to: "  if (typeof event['kind'] !== 'number') return false;"
        }
      ]
    },
    {
      id: 'C15-created-at-unchecked',
      arm: 'WB1',
      describe: 'a created_at that is not finite is kept',
      edits: [
        {
          file: EVENT,
          from: "  if (typeof event['created_at'] !== 'number' || !Number.isFinite(event['created_at']))\n    return false;",
          to: "  if (typeof event['created_at'] !== 'number') return false;"
        }
      ]
    },
    {
      id: 'C15-ots-unchecked',
      arm: 'WB1',
      describe: 'an ots that is not a string is kept',
      edits: [
        {
          file: EVENT,
          from: "  if (event['ots'] !== undefined && typeof event['ots'] !== 'string') return false;",
          to: "  if (event['ots'] !== undefined && event['ots'] === null) return false;"
        }
      ]
    },
    {
      id: 'C15-malformed-verified',
      arm: 'WB1',
      describe: 'a candidate that is not an event is handed to the verifier before it is dropped',
      edits: [
        {
          file: MACHINE,
          from: DROPPED,
          to: '    if (packet === undefined) {\n      void Promise.resolve()\n        .then(() => verifyEvent(incoming.event))\n        .catch(() => undefined);\n      return;\n    }'
        }
      ]
    },
    {
      id: 'C15-malformed-held',
      arm: 'WB1',
      describe: 'a candidate that is not an event is counted against the gate and never released',
      edits: [
        {
          file: MACHINE,
          from: DROPPED,
          to: '    if (packet === undefined) {\n      gate.holding.add({ discarded: false });\n      return;\n    }'
        }
      ]
    },
    {
      id: 'C15-closed-reason-dropped',
      arm: 'WB1',
      describe: 'a `CLOSED` whose reason is not text is dropped at the seam',
      edits: [
        {
          file: LEASE,
          from: ATTRIBUTABLE,
          to: `${ATTRIBUTABLE}\n        if (held.type === 'CLOSED' && typeof held.notice !== 'string') return undefined;`
        }
      ]
    },
    {
      id: 'C15-subid-unchecked',
      arm: 'WB1',
      describe: 'a control message whose subId is not a string is attributed anyway',
      edits: [
        {
          file: LEASE,
          from: ATTRIBUTABLE,
          to: "        if (typeof held.from !== 'string') return undefined;"
        },
        {
          file: LEASE,
          from: '          subId: held.subId,',
          to: '          subId: held.subId as string,'
        },
        {
          file: MACHINE,
          from: "    if (typeof subId !== 'string') return undefined;\n    if (subId.startsWith(`${reqIdBase}-b:`)) return 'backward';\n    if (subId.startsWith(`${reqIdBase}-f:`)) return 'forward';",
          to: "    if ((subId as string).startsWith(`${reqIdBase}-b:`)) return 'backward';\n    if ((subId as string).startsWith(`${reqIdBase}-f:`)) return 'forward';"
        }
      ]
    },
    {
      id: 'C15-relay-message-cast',
      arm: 'WB1',
      describe: "a relay's words are read as text whatever arrived, the bare cast",
      edits: [{ file: NORMALIZE, from: RENDERED, to: '  const rendered = whole(value as string);' }]
    },
    {
      id: 'C15-notice-stringified',
      arm: 'WB1',
      describe: 'a `NOTICE` body is turned into text by `String`, not rendered',
      edits: [
        {
          file: 'src/lib/v1/diagnostics.svelte.ts',
          from: '        notices[packet.from] = relayMessage(packet.notice);',
          to: '        notices[packet.from] = relayMessage(String(packet.notice));'
        }
      ]
    },
    {
      id: 'C15-flag-not-or',
      arm: 'WB1',
      describe: "the inner rendering's cut is not carried into the published flag",
      edits: [
        {
          file: NORMALIZE,
          from: RENDERED,
          to: "  const rendered = typeof value === 'string' ? whole(value) : whole(renderValue(value).text);"
        }
      ]
    },
    {
      id: 'C15-outer-bound-bypassed',
      arm: 'WB1',
      describe: 'text is kept whole, however long',
      edits: [
        {
          file: NORMALIZE,
          from: '  if (rendered.text.length <= MAX_RELAY_MESSAGE_UNITS) return rendered;',
          to: '  if (rendered.text.length <= MAX_RELAY_MESSAGE_UNITS || rendered.text.length > 0) return rendered;'
        }
      ]
    },
    {
      id: 'C15-outer-flag-lost',
      arm: 'WB1',
      describe: 'text cut at the cap says it was not cut',
      edits: [
        {
          file: NORMALIZE,
          from: '  return Object.freeze({ text: kept, truncated: true });',
          to: '  return Object.freeze({ text: kept, truncated: rendered.truncated });'
        }
      ]
    },
    {
      id: 'C15-copy-before-gate',
      arm: 'WB1',
      describe: 'the copy is taken before the gate is read',
      edits: [
        {
          file: MACHINE,
          from: "    if (gate.phase !== 'open') return;",
          to: "    void ownPacket(incoming);\n    if (gate.phase !== 'open') return;"
        }
      ]
    },
    {
      id: 'C15-id-read-twice',
      arm: 'WB1',
      describe: 'the copy reads `id` off the candidate again, after the check',
      edits: [{ file: EVENT, from: '    id: snapshot.id,', to: "    id: source['id'] as string," }]
    },
    {
      id: 'C15-tags-read-twice',
      arm: 'WB1',
      describe: 'the copy reads the tag list off the candidate again, after the check',
      edits: [
        {
          file: EVENT,
          from: FROZEN_TAGS,
          to: "    tags: Object.freeze((source['tags'] as string[][]).map((tag) => Object.freeze([...tag]))),"
        }
      ]
    },
    {
      id: 'C15-tags-walked-twice',
      arm: 'WB1',
      describe: "the wire's tag list is checked and then walked again to copy it",
      edits: [
        {
          file: EVENT,
          from: MATERIALISED,
          to: '  if (!isWireTags(wire)) return undefined;\n  const tags = Array.from(wire, (tag) => [...tag]);'
        }
      ]
    },
    {
      id: 'I-write-after-answer',
      arm: 'WB1',
      describe:
        "the arm writes to the wire's object after the gate answers rather than while it holds",
      edits: [
        {
          file: ARM,
          from: '          if (scribble(wire, `changed-${content}`)) verifier.log.push(`written:${content}`);\n          verifier.release(content);',
          to: '          verifier.release(content);\n          if (scribble(wire, `changed-${content}`)) verifier.log.push(`written:${content}`);'
        }
      ]
    },
    {
      id: 'I-read-counter-deaf',
      arm: 'WB1',
      describe: 'the probe does not count reads of `event`',
      edits: [{ file: ARM, from: '            reads += 1;', to: '            reads += 0;' }]
    },
    {
      id: 'I-wire-cloned',
      arm: 'WB1',
      describe: "the probe keeps a clone of the wire's object rather than the object",
      edits: [
        {
          file: ARM,
          from: '        received.push(own as unknown as Wire);',
          to: '        received.push(structuredClone(own) as unknown as Wire);'
        }
      ]
    },
    {
      id: 'I-shifty-stable',
      arm: 'WB1',
      describe: "the arm's id getter answers the same both times",
      edits: [
        {
          file: ARM,
          from: "                return idReads === 1 ? 'the-checked-id' : 'somebody-elses-id';",
          to: "                return 'the-checked-id';"
        }
      ]
    },
    {
      id: 'I-malformed-well-formed',
      arm: 'WB1',
      describe: "one of the arm's malformed candidates is well-formed",
      edits: [
        {
          file: ARM,
          from: "          ['tags that are null', wireish({ tags: null })],",
          to: "          ['tags that are null', wireish({})],"
        }
      ]
    },
    {
      id: 'I-cache-reads-hook',
      arm: 'WB1',
      describe: 'the arm reads the hook a second time and calls it the cache',
      edits: [
        {
          file: ARM,
          from: '        const cached = context === undefined ? [] : cachedPackets(context.client);',
          to: '        const cached = context === undefined ? [] : published.map((event) => ({ event }));'
        }
      ]
    }
  ],
  retired: []
} satisfies Ledger;
