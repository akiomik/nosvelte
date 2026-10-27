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
 * `forward.test.ts`.
 *
 * An id begins with the row it is read against, `C<n>-` for `B5-C<n>`.
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
    '`B5-C1`, `B5-C2` and `B5-C4` (which revision of a coordinate a consumer holds) through the hook: their supporting arm `RP1`',
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
        'a bounded request keeps the events that arrived last rather than the newest, so the newer revision can be let go before the older arrives, and the older is then held',
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
    }
  ]
} satisfies Ledger;
