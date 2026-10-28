/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of a relay that allows one subscription at a time
 * (`A5-C3`), and its landing, `CP1`: a second request held back by the cap
 * reports `incomplete` when its deadline passes, and goes out when the first
 * finishes.
 *
 * An id begins with the row it is read against, `C3-` for `A5-C3`, and one
 * beginning `D3-` edits the dependency for it, inside the ledger's own copy of
 * `node_modules`. Holding the second request back is the dependency's doing,
 * once the provider lets it read the relay's NIP-11 document; the first entry
 * is the provider that does not. **Letting it go is the dependency's doing
 * too**, for a first request that is not live: a library whose request ends
 * closing nothing at all leaves `CP1` passing (measured), because the
 * dependency closes a backward subscription at its `EOSE` and frees the slot
 * itself. So the clause "goes out when the first finishes" is staged in the
 * dependency, as the queue that never moves on. A live request's timer leaving
 * its backlog open is `A-γ-C7`'s, `C7-the-backward-leg-left-open` in
 * `a-gamma`.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const CONTEXT = 'src/lib/v1/context.svelte.ts';
const RX_NOSTR = 'node_modules/rx-nostr/dist/rx-nostr.js';

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
    },
    {
      id: 'D3-the-queue-never-moves-on',
      arm: 'CP1',
      describe:
        "the dependency's queue for a capped relay does not move on when a subscription is dropped, so a request held back stays held after the first finishes — staged in the ledger's copy of rx-nostr 3.7.6's ESM build",
      edits: [
        {
          file: RX_NOSTR,
          from: '    this.count$.next((v) => v - (droppedX + droppedY));\n    this.shift();\n',
          to: '    this.count$.next((v) => v - (droppedX + droppedY));\n'
        }
      ]
    }
  ]
} satisfies Ledger;
