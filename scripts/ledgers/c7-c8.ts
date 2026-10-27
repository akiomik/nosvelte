/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of what a component asking by id shows of the event its
 * relay answers with, whatever its kind (`C7-C8`), and its landing, `CM9`.
 * The legacy `EventList` asked for the ids and then dropped every event that
 * was not a text note (#68). The second and third entries are that shape in
 * v1, and `CM1`–`CM8` pass under both, since they read the request's key and
 * its outlets over text notes. The fourth is an edit an outside reviewer wrote
 * against `CM9`'s first form, which read only the id the outlet showed; it
 * passed it.
 *
 * An id begins with the row it is read against, `C8-` for `C7-C8`.
 */
import type { Ledger } from '../ledger.ts';

const COMPONENTS = 'src/lib/v1/components';
const OUTLETS = `${COMPONENTS}/RequestOutlets.svelte`;
/** A list component's outlets. */
const LIST = '<RequestOutlets {request} events={children} {loading} {error} {nodata} />';
/** A single-event component's outlets. */
const SINGLE = '<RequestOutlets {request} event={children} {loading} {error} {nodata} />';

export default {
  name: 'c7-c8',
  subject:
    '`C7-C8` (a component asking by id shows the event its relay answers with, whatever its kind): its landing, `CM9`',
  files: ['src/tests/contracts/components.test.ts'],
  calibration: {
    measured:
      "one run of the arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { CM9: 4 }
  },
  entries: [
    {
      id: 'C8-by-id-asks-only-for-text-notes',
      arm: 'CM9',
      describe: 'the components that ask by id put `kinds: [1]` in the filter beside the ids',
      edits: [
        {
          file: `${COMPONENTS}/descriptors.ts`,
          from: '  filters: [{ ids: [id], limit: 1 }],',
          to: '  filters: [{ ids: [id], kinds: [1], limit: 1 }],'
        },
        {
          file: `${COMPONENTS}/descriptors.ts`,
          from: '  filters: [...filtersForIds(read, {})],',
          to: '  filters: [...filtersForIds(read, { kinds: [1] })],'
        }
      ]
    },
    {
      id: 'C8-a-by-id-request-keeps-only-text-notes',
      arm: 'CM9',
      describe:
        'a request whose every filter names ids and no kinds drops an arriving event that is not a text note, the key and the REQ unchanged',
      edits: [
        {
          file: 'src/lib/v1/machine.ts',
          from: '    if (!isFiltered(packet.event as unknown as Nostr.Event, filters)) return;\n',
          to:
            '    if (!isFiltered(packet.event as unknown as Nostr.Event, filters)) return;\n' +
            '    if (\n' +
            '      filters.every((filter) => filter.ids !== undefined && filter.kinds === undefined) &&\n' +
            '      packet.event.kind !== 1\n' +
            '    )\n' +
            '      return;\n'
        }
      ]
    },
    {
      id: 'C8-a-by-id-component-shows-only-text-notes',
      arm: 'CM9',
      describe:
        'the components that ask by id hand their outlets only the text notes among the events the request holds',
      edits: [
        {
          file: OUTLETS,
          from: '    nodata?: Snippet<[RequestOutletContext]> | undefined;\n  } & (',
          to:
            '    nodata?: Snippet<[RequestOutletContext]> | undefined;\n' +
            '    textOnly?: boolean | undefined;\n' +
            '  } & ('
        },
        {
          file: OUTLETS,
          from: '  let { request, event, events, loading, error, nodata }: Props = $props();',
          to: '  let { request, event, events, loading, error, nodata, textOnly }: Props = $props();'
        },
        {
          file: OUTLETS,
          from: "  const shown = $derived(request.state.status === 'loading' ? [] : request.state.events);",
          to:
            '  const shown = $derived(\n' +
            "    request.state.status === 'loading'\n" +
            '      ? []\n' +
            '      : request.state.events.filter((one) => textOnly !== true || one.kind === 1)\n' +
            '  );'
        },
        {
          file: `${COMPONENTS}/EventList.svelte`,
          from: LIST,
          to: LIST.replace(' />', ' textOnly />')
        },
        {
          file: `${COMPONENTS}/UniqueEventList.svelte`,
          from: LIST,
          to: LIST.replace(' />', ' textOnly />')
        },
        {
          file: `${COMPONENTS}/Event.svelte`,
          from: SINGLE,
          to: SINGLE.replace(' />', ' textOnly />')
        }
      ]
    },
    {
      id: 'C8-a-by-id-component-hands-its-outlet-other-content',
      arm: 'CM9',
      describe:
        'the outlets hand on each event the request holds with its `content` emptied, so a component shows the id it was answered with over other content',
      edits: [
        {
          file: OUTLETS,
          from: "  const shown = $derived(request.state.status === 'loading' ? [] : request.state.events);",
          to:
            '  const shown = $derived(\n' +
            "    request.state.status === 'loading'\n" +
            '      ? []\n' +
            "      : request.state.events.map((one) => ({ ...one, content: '' }))\n" +
            '  );'
        }
      ]
    }
  ]
} satisfies Ledger;
