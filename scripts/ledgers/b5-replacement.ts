/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of which revision of a coordinate a consumer holds, read
 * through the published entry: `RP1`, the supporting arm of `B5-C1`, `B5-C2`
 * and `B5-C4`. Their landings, `ES28`, `ES5` and `ES6d`, call the fold and the
 * bound directly. Before `RP1`, the first entry below (#193) passed the whole
 * suite, as the seeded-defect baseline in `docs/process/phase-2-trial.md`
 * records, and `C2-the-incumbent-kept-at-an-equal-created-at`, which an outside
 * reviewer wrote, passed `identity.test.ts`, `bounded.test.ts` and
 * `forward.test.ts`. `C4-the-bound-breaks-a-tie-toward-the-higher-id`,
 * `C1-a-live-replacement-keeps-the-older-revision` and
 * `C1-a-replacement-keeps-the-older-content` are edits an outside reviewer
 * wrote against `RP1`'s first form, which read only the backlog, only which
 * ids were held, and no tie of three; each passed it.
 * `C1-a-live-replacement-lost-retaining-one` and
 * `B6-C1-the-bound-prefers-a-text-note-at-a-tie` are edits an outside reviewer
 * wrote against its second form, which read the live leg only retaining two or
 * unbounded, and, retaining one at a tie of three, read the winner and the
 * regular event under one name; each passed that.
 * `B6-C1-the-bound-keeps-the-first-to-arrive-at-a-tie` is the edit `B6-C1`'s
 * own text names.
 *
 * An id begins with the row it is read against: `C<n>-` for `B5-C<n>`, and
 * `B6-C1-` for `B6-C1`'s ordering at a tie, which `RP1` reads and does not
 * land, since `B6-C1` has no landing yet.
 */
import type { Ledger } from '../ledger.ts';

const HOOK = 'src/lib/v1/useStreamedReq.svelte.ts';
const EVENTSET = 'src/lib/v1/eventset.ts';

/** The hook's fold of an event chunk, the last thing `collect` does. */
const EVENT_FOLD = '  return retainNewest(foldEvent(base, chunk.packet), options);\n}';
/** The hook's last import from the event set. */
const LAST_EVENTSET_IMPORT = "  retainNewest\n} from './eventset.js';";

export default {
  name: 'b5-replacement',
  subject:
    "`B5-C1`, `B5-C2` and `B5-C4` (which revision of a coordinate a consumer holds) through the hook, and `B6-C1`'s ordering at a tie: their supporting arm `RP1`",
  files: ['src/tests/contracts/engine/replacement.test.ts'],
  calibration: {
    measured:
      "one run of the arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { RP1: 4 }
  },
  entries: [
    {
      id: 'C1-a-replacement-keeps-the-older-revision',
      arm: 'RP1',
      describe:
        'the hook keeps what it held whenever a fold replaces rather than adds, so the revision that arrives second is lost (#193)',
      edits: [
        {
          file: HOOK,
          from: EVENT_FOLD,
          to:
            '  const folded = foldEvent(base, chunk.packet);\n' +
            '  if (folded.entries.size === base.entries.size) return base;\n' +
            '  return retainNewest(folded, options);\n}'
        }
      ]
    },
    {
      id: 'C1-the-older-revision-wins',
      arm: 'RP1',
      describe: 'of two revisions at different `created_at`, the older wins',
      edits: [
        {
          file: EVENTSET,
          from: 'return a.created_at > b.created_at ? a : b;',
          to: 'return a.created_at < b.created_at ? a : b;'
        }
      ]
    },
    {
      id: 'C1-an-addressable-coordinate-without-its-d',
      arm: 'RP1',
      describe:
        'an addressable event is replaced by kind and author alone, so two articles under different `d` tags are one coordinate',
      edits: [
        {
          file: EVENTSET,
          from: '      return `${event.kind}:${event.pubkey}:${identifierOf(event)}`;',
          to: '      return `${event.kind}:${event.pubkey}`;'
        }
      ]
    },
    {
      id: 'C1-a-regular-event-replaced-by-its-authors-next',
      arm: 'RP1',
      describe:
        'a regular event is replaced by kind and author, as a replaceable one is, so an author’s later note replaces the earlier',
      edits: [
        {
          file: EVENTSET,
          from: '    default:\n      return event.id;',
          to: '    default:\n      return `${event.kind}:${event.pubkey}`;'
        }
      ]
    },
    {
      id: 'C2-the-incumbent-kept-at-an-equal-created-at',
      arm: 'RP1',
      describe:
        'the hook keeps the revision it holds when another arrives at the same `created_at`, so the tie goes to whichever arrived first',
      edits: [
        {
          file: HOOK,
          from: LAST_EVENTSET_IMPORT,
          to: "  retainNewest,\n  replacementKey\n} from './eventset.js';"
        },
        {
          file: HOOK,
          from: EVENT_FOLD,
          to:
            '  const incumbent = base.entries.get(replacementKey(chunk.packet.event));\n' +
            '  if (\n' +
            '    incumbent !== undefined &&\n' +
            '    incumbent.event.id !== chunk.packet.event.id &&\n' +
            '    incumbent.event.created_at === chunk.packet.event.created_at\n' +
            '  )\n' +
            '    return base;\n' +
            `${EVENT_FOLD}`
        }
      ]
    },
    {
      id: 'C2-the-higher-id-wins-a-tie',
      arm: 'RP1',
      describe: 'of two revisions at an equal `created_at`, the higher id wins',
      edits: [
        {
          file: EVENTSET,
          from: '  return a.id <= b.id ? a : b;',
          to: '  return a.id >= b.id ? a : b;'
        }
      ]
    },
    {
      id: 'C4-the-bound-keeps-the-last-to-arrive',
      arm: 'RP1',
      describe:
        'a bounded request keeps the entries last in the set’s insertion order rather than the newest, a replacement keeping the place of the revision it replaced, so the newer revision can be let go before the older arrives, and the older is then held',
      edits: [
        {
          file: HOOK,
          from: EVENT_FOLD,
          to:
            '  const folded = foldEvent(base, chunk.packet);\n' +
            "  if (typeof options.retain === 'number') {\n" +
            '    return { ...folded, entries: new Map([...folded.entries].slice(-options.retain)) };\n' +
            '  }\n' +
            '  return retainNewest(folded, options);\n}'
        }
      ]
    },
    {
      id: 'C4-the-bound-breaks-a-tie-toward-the-higher-id',
      arm: 'RP1',
      describe:
        'the hook bounds the set itself, and of two events at one `created_at` keeps the higher id where the fold keeps the lower, so the winner can be let go for a regular event of that instant and the superseded revision then kept over it',
      edits: [
        {
          file: HOOK,
          from: EVENT_FOLD,
          to:
            '  const folded = foldEvent(base, chunk.packet);\n' +
            "  if (typeof options.retain === 'number') {\n" +
            '    const ranked = [...folded.entries].sort(([, a], [, b]) =>\n' +
            '      b.event.created_at - a.event.created_at || b.event.id.localeCompare(a.event.id)\n' +
            '    );\n' +
            '    return { ...folded, entries: new Map(ranked.slice(0, options.retain)) };\n' +
            '  }\n' +
            '  return folded;\n}'
        }
      ]
    },
    {
      id: 'C1-a-live-replacement-keeps-the-older-revision',
      arm: 'RP1',
      describe:
        'once the backlog has settled, the hook keeps what it held whenever a fold replaces rather than adds, so a revision that arrives on the live leg is lost',
      edits: [
        {
          file: HOOK,
          from: EVENT_FOLD,
          to:
            '  const folded = foldEvent(base, chunk.packet);\n' +
            '  if (base.backlog !== undefined && folded.entries.size === base.entries.size) return base;\n' +
            '  return retainNewest(folded, options);\n}'
        }
      ]
    },
    {
      id: 'C1-a-replacement-keeps-the-older-content',
      arm: 'RP1',
      describe:
        'where a fold replaces one revision with another, the hook keeps the replaced revision’s `content` under the winner’s id, so the consumer holds the winner’s id over the superseded content',
      edits: [
        {
          file: HOOK,
          from: EVENT_FOLD,
          to:
            '  const folded = foldEvent(base, chunk.packet);\n' +
            '  const entries = new Map(folded.entries);\n' +
            '  for (const [key, packet] of entries) {\n' +
            '    const previous = base.entries.get(key);\n' +
            '    if (previous !== undefined && previous.event.id !== packet.event.id) {\n' +
            '      entries.set(key, { ...packet, event: { ...packet.event, content: previous.event.content } });\n' +
            '    }\n' +
            '  }\n' +
            '  return retainNewest({ ...folded, entries }, options);\n}'
        }
      ]
    },
    {
      id: 'C1-a-live-replacement-lost-retaining-one',
      arm: 'RP1',
      describe:
        'once the backlog has settled, a request retaining one keeps what it held whenever a fold replaces rather than adds, so a revision that arrives on the live leg is lost',
      edits: [
        {
          file: HOOK,
          from: EVENT_FOLD,
          to:
            '  const folded = foldEvent(base, chunk.packet);\n' +
            '  if (\n' +
            '    base.backlog !== undefined &&\n' +
            '    options.retain === 1 &&\n' +
            '    folded.entries.size === base.entries.size\n' +
            '  )\n' +
            '    return base;\n' +
            '  return retainNewest(folded, options);\n}'
        }
      ]
    },
    {
      id: 'B6-C1-the-bound-prefers-a-text-note-at-a-tie',
      arm: 'RP1',
      describe:
        'the hook bounds the set itself, and of two events at one `created_at` keeps a text note over an event of another kind before it compares ids, so retaining one at a tie keeps the regular event where the winner’s id is the lower',
      edits: [
        {
          file: HOOK,
          from: EVENT_FOLD,
          to:
            '  const folded = foldEvent(base, chunk.packet);\n' +
            "  if (typeof options.retain === 'number') {\n" +
            '    const ranked = [...folded.entries].sort(\n' +
            '      ([, a], [, b]) =>\n' +
            '        b.event.created_at - a.event.created_at ||\n' +
            '        (a.event.kind === 1 ? -1 : 0) - (b.event.kind === 1 ? -1 : 0) ||\n' +
            '        (a.event.id < b.event.id ? -1 : 1)\n' +
            '    );\n' +
            '    return { ...folded, entries: new Map(ranked.slice(0, options.retain)) };\n' +
            '  }\n' +
            '  return folded;\n}'
        }
      ]
    },
    {
      id: 'B6-C1-the-bound-keeps-the-first-to-arrive-at-a-tie',
      arm: 'RP1',
      describe:
        'the bound’s comparator answers `0` for two events at one `created_at`, so the stable sort keeps whichever arrived first, and retaining one at a tie keeps it rather than the lower id',
      edits: [
        {
          file: EVENTSET,
          from:
            '  if (a.event.id !== b.event.id) return a.event.id < b.event.id ? -1 : 1;\n' +
            '  if (a.event.kind !== b.event.kind) return a.event.kind - b.event.kind;\n' +
            '  if (a.event.pubkey !== b.event.pubkey) return a.event.pubkey < b.event.pubkey ? -1 : 1;\n' +
            '  return 0;',
          to: '  return 0;'
        }
      ]
    }
  ]
} satisfies Ledger;
