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
const CONTEXT = 'src/lib/v1/context.svelte.ts';
const DIAGNOSTICS = 'src/lib/v1/diagnostics.svelte.ts';
const ESCAPES = 'src/tests/contracts/engine/helpers/escapes.ts';
/** Where the machine judges the filters, on the checked copy. */
const MATCHED = '    if (!isFiltered(packet.event as unknown as Nostr.Event, filters)) return;';
/** The `ots` spread at the end of the copy. */
const OTS = '    ...(snapshot.ots === undefined ? {} : { ots: snapshot.ots })';

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
    seconds: { WB1: 9 }
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
        'a tag list that is not a list is walked anyway, which throws: out of the boundary when it is called directly, and out of the subscription callback on the wire, while the events after it still arrive',
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
      id: 'C15-malformed-thrown-later',
      arm: 'WB1',
      describe:
        'a candidate that is not an event is dropped and settles as it should, and an error is thrown out of the subscription for it',
      edits: [
        {
          file: MACHINE,
          from: DROPPED,
          to: "    if (packet === undefined) {\n      queueMicrotask(() => {\n        throw new Error('a candidate that was not an event');\n      });\n      return;\n    }"
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
      describe:
        'a control message whose subId is not a string is attributed anyway, and the attribution throws out of the subscription',
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
      id: 'C15-dependency-matching-on',
      arm: 'WB1',
      describe: "the provider's client matches events against the filters before delivering them",
      edits: [
        {
          file: CONTEXT,
          from: '    skipValidateFilterMatching: true',
          to: '    skipValidateFilterMatching: false'
        }
      ]
    },
    {
      id: 'C15-matching-dropped',
      arm: 'WB1',
      describe: 'nothing matches events against the filters at all',
      edits: [{ file: MACHINE, from: MATCHED, to: '    void isFiltered;' }]
    },
    {
      id: 'C15-matching-before-copy',
      arm: 'WB1',
      describe:
        "the machine matches the wire's event against the filters before the boundary checks it",
      edits: [
        {
          file: MACHINE,
          from: '    const packet = ownPacket(incoming);',
          to: '    if (!isFiltered(incoming.event, filters)) return;\n    const packet = ownPacket(incoming);'
        }
      ]
    },
    {
      id: 'C15-relay-axis-stringified',
      arm: 'WB1',
      describe: 'a `CLOSED` reason on the relay axis is turned into text by `String`, not rendered',
      edits: [
        {
          file: DIAGNOSTICS,
          from: '        const notice = relayMessage(packet.notice);',
          to: '        const notice = relayMessage(String(packet.notice));'
        }
      ]
    },
    {
      id: 'C15-relay-axis-classify-raw',
      arm: 'WB1',
      describe:
        'a `CLOSED` reason on the relay axis is classified as the relay sent it, not as rendered',
      edits: [
        {
          file: DIAGNOSTICS,
          from: '          reason: classifyRefusal(notice.text),',
          to: '          reason: classifyRefusal(packet.notice),'
        }
      ]
    },
    {
      id: 'C15-refusal-state-dropped',
      arm: 'WB1',
      describe:
        'a refusal whose reason classifies as nothing does not answer the backlog, which waits out its timer',
      edits: [
        {
          file: MACHINE,
          from: "      if (leg === 'backward') advanceBackward(packet.from, 'refused');",
          to: "      if (leg === 'backward' && reason !== 'unknown') advanceBackward(packet.from, 'refused');"
        }
      ]
    },
    {
      id: 'C15-copy-extras',
      arm: 'WB1',
      describe: 'the copy carries the fields NIP-01 does not name, as the wire had them',
      edits: [
        {
          file: EVENT,
          from: OTS,
          to: `${OTS},\n    ...(Object.fromEntries(\n      Object.keys(source)\n        .filter((key) => !['id', 'sig', 'kind', 'pubkey', 'content', 'created_at', 'tags', 'ots'].includes(key))\n        .map((key) => [key, source[key]])\n    ) as object)`
        }
      ]
    },
    {
      id: 'C15-seal-wire',
      arm: 'WB1',
      describe: "the boundary seals the dependency's event",
      edits: [{ file: EVENT, from: RETURNED, to: `  Object.seal(value);\n${RETURNED}` }]
    },
    {
      id: 'C15-source-written',
      arm: 'WB1',
      describe: "the boundary writes to the dependency's event before it takes its snapshot",
      edits: [
        {
          file: EVENT,
          from: '  const snapshot = {',
          to: "  if (typeof source['sig'] === 'string') source['sig'] = 'tampered-signature';\n  const snapshot = {"
        }
      ]
    },
    {
      id: 'C15-sig-read-twice',
      arm: 'WB1',
      describe: 'the copy reads `sig` off the candidate again, after the check',
      edits: [
        { file: EVENT, from: '    sig: snapshot.sig,', to: "    sig: source['sig'] as string," }
      ]
    },
    {
      id: 'C15-kind-read-twice',
      arm: 'WB1',
      describe: 'the copy reads `kind` off the candidate again, after the check',
      edits: [
        { file: EVENT, from: '    kind: snapshot.kind,', to: "    kind: source['kind'] as number," }
      ]
    },
    {
      id: 'C15-pubkey-read-twice',
      arm: 'WB1',
      describe: 'the copy reads `pubkey` off the candidate again, after the check',
      edits: [
        {
          file: EVENT,
          from: '    pubkey: snapshot.pubkey,',
          to: "    pubkey: source['pubkey'] as string,"
        }
      ]
    },
    {
      id: 'C15-content-read-twice',
      arm: 'WB1',
      describe: 'the copy reads `content` off the candidate again, after the check',
      edits: [
        {
          file: EVENT,
          from: '    content: snapshot.content,',
          to: "    content: source['content'] as string,"
        }
      ]
    },
    {
      id: 'C15-created-at-read-twice',
      arm: 'WB1',
      describe: 'the copy reads `created_at` off the candidate again, after the check',
      edits: [
        {
          file: EVENT,
          from: '    created_at: snapshot.created_at,',
          to: "    created_at: source['created_at'] as number,"
        }
      ]
    },
    {
      id: 'C15-ots-read-twice',
      arm: 'WB1',
      describe: 'the copy reads `ots` off the candidate again, after the check',
      edits: [
        {
          file: EVENT,
          from: OTS,
          to: "    ...(snapshot.ots === undefined ? {} : { ots: source['ots'] as string })"
        }
      ]
    },
    {
      id: 'C15-malformed-verified-forward',
      arm: 'WB1',
      describe: 'a candidate that is not an event is handed to the verifier on the forward leg',
      edits: [
        {
          file: MACHINE,
          from: DROPPED,
          to: "    if (packet === undefined) {\n      if (leg === 'forward')\n        void Promise.resolve()\n          .then(() => verifyEvent(incoming.event))\n          .catch(() => undefined);\n      return;\n    }"
        }
      ]
    },
    {
      id: 'C15-subid-coerced',
      arm: 'WB1',
      describe: 'a control message whose subId is not a string is turned into text, and attributed',
      edits: [
        {
          file: LEASE,
          from: ATTRIBUTABLE,
          to: "        if (typeof held.from !== 'string' || held.subId == null) return undefined;"
        },
        {
          file: LEASE,
          from: '          subId: held.subId,',
          to: '          subId: String(held.subId),'
        }
      ]
    },
    {
      id: 'C15-inner-slice-doubled',
      arm: 'WB1',
      describe: 'the inner rendering keeps twice the bound it states',
      edits: [
        {
          file: NORMALIZE,
          from: '  const cut = rendered.slice(0, MAX_RENDERED);',
          to: '  const cut = rendered.slice(0, MAX_RENDERED * 2);'
        }
      ]
    },
    {
      id: 'I-collector-deaf-to-uncaught',
      arm: 'WB1',
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
      arm: 'WB1',
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
      id: 'I-part-skipped',
      arm: 'WB1',
      describe: "the arm's runner skips one part",
      edits: [
        {
          file: ARM,
          from: '        await body();',
          to: "        if (!name.startsWith('E:')) await body();"
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
          from: '          if (scribble(wire, `changed-${content}`).every(Boolean))\n            verifier.log.push(`written:${content}`);\n          verifier.release(content);',
          to: '          verifier.release(content);\n          if (scribble(wire, `changed-${content}`).every(Boolean))\n            verifier.log.push(`written:${content}`);'
        }
      ]
    },
    {
      id: 'I-read-counter-deaf',
      arm: 'WB1',
      describe: 'the probe does not count reads of a packet',
      edits: [
        {
          file: ARM,
          from: '            reads.set(own, (reads.get(own) ?? 0) + 1);',
          to: '            reads.set(own, 0);'
        }
      ]
    },
    {
      id: 'I-read-counter-marks',
      arm: 'WB1',
      describe: 'the probe marks a packet as read rather than counting its reads',
      edits: [
        {
          file: ARM,
          from: '            reads.set(own, (reads.get(own) ?? 0) + 1);',
          to: '            reads.set(own, 1);'
        }
      ]
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
      describe: "the arm's changing getters answer the same both times",
      edits: [
        {
          file: ARM,
          from: '              return reads === 1 ? first : second;',
          to: '              return reads > 0 ? first : second;'
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
