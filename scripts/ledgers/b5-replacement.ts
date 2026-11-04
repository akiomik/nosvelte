/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of which revision of a coordinate a consumer holds, read
 * through the published entry: `RP1`, the landing of `B5-C11`, the consumer's
 * half of `B5-C1`, `B5-C2` and `B5-C4`, and a supporting arm of those three.
 * Their landings, `ES28`, `ES5` and `ES6d`, call the fold and the bound
 * directly. Before `RP1`, the first entry below (#193) passed the whole
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
 * own text names. `C1-a-live-replacement-lost-while-the-leg-is-open` is an edit
 * an outside reviewer wrote against its third form, which ended the live leg at
 * once after the revision, so that the revision was folded on a leg already
 * ended; it passed that. `C1-a-live-revision-replaces-what-it-meets` is its
 * mirror. It fails `RP1` at both of its live readings, and passes a copy of the
 * arm without the delivery turn before `CLOSED` (measured).
 * `C11-the-replaceable-class-begins-past-10000` is a defect an outside reviewer
 * seeded after G1 without reading the tests, and `RP1` passed it while its
 * cases were at two kinds alone, 10002 and 30023.
 *
 * An id begins with the row it is read against: `C1-`, `C2-` and `C4-` for the
 * halves of `B5-C1`, `B5-C2` and `B5-C4` that `B5-C11` holds, `C11-` for the
 * edges of the classes, which only `B5-C11` names, and `B6-C1-` for
 * `B6-C1`'s ordering at a tie, which `RP1` reads and does not land, since
 * `B6-C1` has no landing yet. Each `C11-` entry moves one edge of a class
 * that replaces by one kind, drops a special kind or makes its neighbour one,
 * wherever a request can name the kind on the other side. The two it cannot,
 * 20000 and 29999, are ephemeral: a request naming one is refused, and one
 * naming no kinds does not keep them, so `B5-C7` reads them on the classifier
 * and `ES7` at the descriptor. Moving the addressable range down to 29999
 * changes nothing, since the ephemeral range is decided first.
 */
import type { Ledger } from '../ledger.ts';

const HOOK = 'src/lib/v1/useStreamedReq.svelte.ts';
const EVENTSET = 'src/lib/v1/eventset.ts';

/** The lines of `classifyKind` that decide a class that replaces. */
const SPECIALS = "  if (kind === 0 || kind === 3) return 'replaceable';";
const REPLACEABLE = "  if (kind >= 10000 && kind < 20000) return 'replaceable';";
const ADDRESSABLE = "  if (kind >= 30000 && kind < 40000) return 'addressable';";

/** The hook's fold of an event chunk, the last thing `collect` does. */
const EVENT_FOLD = '  return retainNewest(foldEvent(base, chunk.packet), options);\n}';
/** The hook's last import from the event set. */
const LAST_EVENTSET_IMPORT = "  retainNewest\n} from './eventset.js';";

export default {
  name: 'b5-replacement',
  subject:
    "`B5-C11` (which revision of a coordinate a consumer holds, the consumer's half of `B5-C1`, `B5-C2` and `B5-C4`) through the hook, and `B6-C1`'s ordering at a tie: `RP1`, `B5-C11`'s landing",
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
      rows: ['B5-C11'],
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
      rows: ['B5-C11'],
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
      rows: ['B5-C11'],
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
      id: 'C1-a-replaceable-coordinate-without-its-kind',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe:
        "a replaceable event is replaced by author alone, so one author's lists of two replaceable kinds are one coordinate",
      edits: [
        {
          file: EVENTSET,
          from: '      return `${event.kind}:${event.pubkey}`;',
          to: '      return `${event.pubkey}`;'
        }
      ]
    },
    {
      id: 'C1-an-addressable-coordinate-without-its-kind',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe:
        "an addressable event is replaced by author and `d` alone, so one author's events of two addressable kinds under one `d` are one coordinate",
      edits: [
        {
          file: EVENTSET,
          from: '      return `${event.kind}:${event.pubkey}:${identifierOf(event)}`;',
          to: '      return `${event.pubkey}:${identifierOf(event)}`;'
        }
      ]
    },
    {
      id: 'C1-a-regular-event-replaced-by-its-authors-next',
      arm: 'RP1',
      rows: ['B5-C11'],
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
      rows: ['B5-C11'],
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
      rows: ['B5-C11'],
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
      rows: ['B5-C11'],
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
      rows: ['B5-C11'],
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
      rows: ['B5-C11'],
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
      rows: ['B5-C11'],
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
      rows: ['B5-C11'],
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
      rows: ['B5-C11'],
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
      rows: ['B5-C11'],
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
    },
    {
      id: 'C1-a-live-replacement-lost-while-the-leg-is-open',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe:
        'once the backlog has settled, a request retaining one keeps what it held whenever a fold replaces rather than adds while its forward leg is open, so a revision that arrives live is lost, and one folded after the leg ended is not',
      edits: [
        {
          file: HOOK,
          from: EVENT_FOLD,
          to:
            '  const folded = foldEvent(base, chunk.packet);\n' +
            '  if (\n' +
            '    base.backlog !== undefined &&\n' +
            '    options.retain === 1 &&\n' +
            '    base.forward?.end === undefined &&\n' +
            '    folded.entries.size === base.entries.size\n' +
            '  )\n' +
            '    return base;\n' +
            '  return retainNewest(folded, options);\n}'
        }
      ]
    },
    {
      id: 'C1-a-live-revision-replaces-what-it-meets',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe:
        'once the backlog has settled and while its forward leg is open, the hook lets an arriving event replace whatever it holds under the same coordinate, so a live revision older than the one held, or losing its tie, replaces it',
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
            '  const key = replacementKey(chunk.packet.event);\n' +
            '  if (base.backlog !== undefined && base.forward?.end === undefined && base.entries.has(key)) {\n' +
            '    const entries = new Map(base.entries);\n' +
            '    entries.set(key, chunk.packet);\n' +
            '    return retainNewest({ ...base, entries }, options);\n' +
            '  }\n' +
            `${EVENT_FOLD}`
        }
      ]
    },
    {
      id: 'C11-kind-0-not-replaceable',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe:
        "kind 0 is not replaceable, so an author's earlier metadata is held beside the later",
      edits: [{ file: EVENTSET, from: SPECIALS, to: "  if (kind === 3) return 'replaceable';" }]
    },
    {
      id: 'C11-kind-3-not-replaceable',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe:
        "kind 3 is not replaceable, so an author's earlier follow list is held beside the later",
      edits: [{ file: EVENTSET, from: SPECIALS, to: "  if (kind === 0) return 'replaceable';" }]
    },
    {
      id: 'C11-kind-1-replaceable',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe: 'kind 1 is replaceable, as the special kind beside it is',
      edits: [
        {
          file: EVENTSET,
          from: SPECIALS,
          to: "  if (kind <= 1 || kind === 3) return 'replaceable';"
        }
      ]
    },
    {
      id: 'C11-kind-2-replaceable',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe: 'kind 2 is replaceable, as the special kind beside it is',
      edits: [
        {
          file: EVENTSET,
          from: SPECIALS,
          to: "  if (kind === 0 || (kind >= 2 && kind <= 3)) return 'replaceable';"
        }
      ]
    },
    {
      id: 'C11-kind-4-replaceable',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe: 'kind 4 is replaceable, as the special kind beside it is',
      edits: [
        {
          file: EVENTSET,
          from: SPECIALS,
          to: "  if (kind === 0 || (kind >= 3 && kind <= 4)) return 'replaceable';"
        }
      ]
    },
    {
      id: 'C11-the-replaceable-class-begins-past-10000',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe:
        'the replaceable range begins one past 10000, so two revisions at kind 10000 are both held',
      edits: [
        {
          file: EVENTSET,
          from: REPLACEABLE,
          to: "  if (kind > 10000 && kind < 20000) return 'replaceable';"
        }
      ]
    },
    {
      id: 'C11-the-replaceable-class-begins-at-9999',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe:
        'the replaceable range begins at 9999, so two events of one author at that regular kind are one coordinate',
      edits: [
        {
          file: EVENTSET,
          from: REPLACEABLE,
          to: "  if (kind >= 9999 && kind < 20000) return 'replaceable';"
        }
      ]
    },
    {
      id: 'C11-the-replaceable-class-ends-before-19999',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe:
        'the replaceable range ends before 19999, so two revisions at kind 19999 are both held',
      edits: [
        {
          file: EVENTSET,
          from: REPLACEABLE,
          to: "  if (kind >= 10000 && kind < 19999) return 'replaceable';"
        }
      ]
    },
    {
      id: 'C11-the-addressable-class-begins-past-30000',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe:
        'the addressable range begins one past 30000, so two revisions at kind 30000 are both held',
      edits: [
        {
          file: EVENTSET,
          from: ADDRESSABLE,
          to: "  if (kind > 30000 && kind < 40000) return 'addressable';"
        }
      ]
    },
    {
      id: 'C11-the-addressable-class-ends-before-39999',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe:
        'the addressable range ends before 39999, so two revisions at kind 39999 are both held',
      edits: [
        {
          file: EVENTSET,
          from: ADDRESSABLE,
          to: "  if (kind >= 30000 && kind < 39999) return 'addressable';"
        }
      ]
    },
    {
      id: 'C11-the-addressable-class-takes-40000',
      arm: 'RP1',
      rows: ['B5-C11'],
      describe:
        'the addressable range takes 40000, so two events of one author there under one `d` are one coordinate',
      edits: [
        {
          file: EVENTSET,
          from: ADDRESSABLE,
          to: "  if (kind >= 30000 && kind <= 40000) return 'addressable';"
        }
      ]
    }
  ]
} satisfies Ledger;
