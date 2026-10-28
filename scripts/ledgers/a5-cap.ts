/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of a relay that allows one subscription at a time
 * (`A5-C3`), and its landing, `CP1`: a second request held back by the cap
 * reports `incomplete` when its deadline passes, and goes out when the first
 * finishes.
 *
 * An id begins with the row it is read against, `C3-` for `A5-C3`. Holding the
 * second request back is the dependency's doing, once the provider lets it
 * read the relay's NIP-11 document; the first entry is the provider that does
 * not. Removing the backlog's close at its end leaves `CP1` passing: its first
 * request is not live, so its end closes every leg anyway. A live request's
 * timer leaving its backlog open is `A-γ-C7`'s, `C7-the-backward-leg-left-open`
 * in `a-gamma`.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const CONTEXT = 'src/lib/v1/context.svelte.ts';

export default {
  name: 'a5-cap',
  subject:
    '`A5-C3` (a second request held back by a relay’s cap reports incomplete rather than nothing-found, and goes out when the first finishes): its landing, `CP1`',
  files: ['src/tests/contracts/capacity.test.ts'],
  calibration: {
    measured:
      "one run of the arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { CP1: 6 }
  },
  entries: [
    {
      id: 'C3-the-relays-document-is-not-read',
      arm: 'CP1',
      describe:
        "the provider's client skips the relay's NIP-11 document, so the cap is never known and both requests go out at once",
      edits: [
        {
          file: CONTEXT,
          from: '    eoseTimeout: LIBRARY_EOSE_TIMEOUT_MS,\n',
          to: '    eoseTimeout: LIBRARY_EOSE_TIMEOUT_MS,\n    skipFetchNip11: true,\n'
        }
      ]
    },
    {
      id: 'C3-the-timer-reports-complete',
      arm: 'CP1',
      describe:
        'a request whose deadline passes while it is held back says its empty answer is complete, though nothing was asked',
      edits: [
        {
          file: MACHINE,
          from: '    const present = new Set<IncompleteCause>();\n',
          to: '    const present = new Set<IncompleteCause>();\n    if (viaTimer) return backlogEndOf(present, undefined);\n'
        }
      ]
    }
  ]
} satisfies Ledger;
