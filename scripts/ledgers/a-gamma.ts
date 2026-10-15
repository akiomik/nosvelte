/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of the request's own settle timeout (A-γ) and the bound
 * on a draining gate's wait (A-ζ), and their landings:
 * - `A-γ-C1` on `ST1`;
 * - `A-γ-C2` on `NM5`;
 * - `A-γ-C3` on `NM11`;
 * - `A-γ-C4` on `TC1`;
 * - `A-γ-C5` on `WI29`;
 * - `A-γ-C6` on `TC2`;
 * - `A-ζ-C1` on `DC9`.
 *
 * An id beginning `C<n>-` edits the library, and one beginning `D<n>-` edits
 * the dependency inside the ledger's own copy of `node_modules`, which the
 * runner clones per copy and restores after each entry.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const ENGINE = 'src/lib/v1/engine.ts';
const NORMALIZE = 'src/lib/v1/normalize.ts';
const CONTEXT = 'src/lib/v1/context.svelte.ts';
const STREAM = 'src/lib/v1/stream.ts';
const RX_NOSTR = 'node_modules/rx-nostr/dist/rx-nostr.js';

/** The engine's import of the normalizer's constants. */
const ENGINE_IMPORT =
  "import { cloneFilter, DEFAULT_SETTLE_TIMEOUT_MS, InvalidDescriptorError } from './normalize.js';";
/** Where a missing settle timeout is resolved and a present one bounded. */
const RESOLVED =
  "      : requireInteger('settleTimeoutMs', rawSettleTimeoutMs, 1, MAX_SETTLE_TIMEOUT_MS);";
/** The library's own upstream timer. */
const LIBRARY_TIMER = 'export const LIBRARY_EOSE_TIMEOUT_MS = 600_000;';

export default {
  name: 'a-gamma',
  subject:
    "`A-γ-C1`–`A-γ-C6` and `A-ζ-C1` (the request's own settle timeout, the upstream timer the provider sets, and the bound on a draining gate's wait): their landings, `ST1`, `NM5`, `NM11`, `TC1`, `WI29`, `TC2` and `DC9`",
  files: [
    'src/tests/contracts/engine/settle.test.ts',
    'src/tests/contracts/engine/normalize.test.ts',
    'src/tests/contracts/engine/transportconfig.test.ts',
    'src/tests/contracts/engine/wiring.test.ts',
    'src/tests/contracts/engine/drain.test.ts'
  ],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { ST1: 9, NM5: 4, NM11: 4, TC1: 6, WI29: 4, TC2: 4, DC9: 13 }
  },
  entries: [
    {
      id: 'C1-the-timer-reports-complete',
      arm: 'ST1',
      describe: "the settle timer's outcome says the answer is complete",
      edits: [
        {
          file: MACHINE,
          from: '    const present = new Set<IncompleteCause>();\n',
          to: '    const present = new Set<IncompleteCause>();\n    if (viaTimer) return backlogEndOf(present, undefined);\n'
        }
      ]
    },
    {
      id: 'C1-the-wrong-cause',
      arm: 'ST1',
      describe:
        'the answer is incomplete, but under `ended` rather than `timeout` — from the timer and from the relay left undetermined alike',
      edits: [
        {
          file: MACHINE,
          from: "    if (viaTimer) present.add('timeout');\n",
          to: "    if (viaTimer) present.add('ended');\n"
        },
        {
          file: MACHINE,
          from: "      else if (!DETERMINED.has(phase)) present.add('timeout');",
          to: "      else if (!DETERMINED.has(phase)) present.add('ended');"
        }
      ]
    },
    {
      id: 'C1-the-events-dropped',
      arm: 'ST1',
      describe: 'an incomplete answer shows none of the events it had',
      edits: [
        {
          file: ENGINE,
          from: "        status: 'incomplete',\n        events,\n",
          to: "        status: 'incomplete',\n        events: NO_EVENTS,\n"
        }
      ]
    },
    {
      id: 'C1-no-incomplete-result-error',
      arm: 'ST1',
      describe: 'the diagnostics carry no error for an answer that ran out of time',
      edits: [
        {
          file: ENGINE,
          from: "      (state.status === 'incomplete' ? state.error : undefined),",
          to: "      (state.status === 'incomplete' ? undefined : undefined),"
        }
      ]
    },
    {
      id: 'C1-the-slot-turns-to-error',
      arm: 'ST1',
      describe:
        'an incomplete answer with events renders the error slot instead of the default one',
      edits: [
        {
          file: ENGINE,
          from: "  if (state.events.length > 0) return { slot: 'default', error: undefined };",
          to: "  if (state.events.length > 0 && state.status !== 'incomplete')\n    return { slot: 'default', error: undefined };"
        }
      ]
    },
    {
      id: 'C1-the-settle-timer-never-fires',
      arm: 'ST1',
      describe:
        "the request's own timer is armed for a thousand times its timeout, so a silent relay holds it open",
      edits: [
        {
          file: MACHINE,
          from: '    timer = setTimeout(() => settle(true), timeoutMs);',
          to: '    timer = setTimeout(() => settle(true), timeoutMs * 1000);'
        }
      ]
    },
    {
      id: 'C2-an-omitted-timeout-stays-absent',
      arm: 'NM5',
      describe: 'a descriptor with no settle timeout is normalized to none at all',
      edits: [
        {
          file: NORMALIZE,
          from: '      ? DEFAULT_SETTLE_TIMEOUT_MS\n',
          to: '      ? (undefined as unknown as number)\n'
        }
      ]
    },
    {
      id: 'C2-the-default-is-not-finite',
      arm: 'NM5',
      describe: 'the named default is infinite, so a silent relay holds the request for ever',
      edits: [
        {
          file: NORMALIZE,
          from: 'export const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;',
          to: 'export const DEFAULT_SETTLE_TIMEOUT_MS = Number.POSITIVE_INFINITY;'
        }
      ]
    },
    {
      id: 'C3-clamped-not-refused',
      arm: 'NM11',
      describe: 'a settle timeout above the cap is silently lowered to it',
      edits: [
        {
          file: NORMALIZE,
          from: RESOLVED,
          to: "      : Math.min(requireInteger('settleTimeoutMs', rawSettleTimeoutMs, 1, Number.MAX_SAFE_INTEGER), MAX_SETTLE_TIMEOUT_MS);"
        }
      ]
    },
    {
      id: 'C3-admitted-above-the-upstream-timer',
      arm: 'NM11',
      describe:
        'a settle timeout above the upstream timer the provider sets is admitted, while every value up to that timer is still refused above the cap',
      edits: [
        {
          file: NORMALIZE,
          from: RESOLVED,
          to: "      : typeof rawSettleTimeoutMs === 'number' && rawSettleTimeoutMs > LIBRARY_EOSE_TIMEOUT_MS\n        ? rawSettleTimeoutMs\n        : requireInteger('settleTimeoutMs', rawSettleTimeoutMs, 1, MAX_SETTLE_TIMEOUT_MS);"
        }
      ]
    },
    {
      id: 'C3-the-upstream-timer-below-the-cap',
      arm: 'NM11',
      describe:
        "the provider's upstream timer is set below the largest settle timeout a request may ask for",
      edits: [
        {
          file: NORMALIZE,
          from: LIBRARY_TIMER,
          to: 'export const LIBRARY_EOSE_TIMEOUT_MS = 50_000;'
        }
      ]
    },
    {
      id: 'C4-no-timer-handed',
      arm: 'TC1',
      describe: "the factory is handed no EOSE timer, so the dependency's own one runs",
      edits: [
        {
          file: CONTEXT,
          from: '    ...(harness ?? {}),\n    eoseTimeout: LIBRARY_EOSE_TIMEOUT_MS,\n',
          to: '    ...(harness ?? {}),\n    ...(LIBRARY_EOSE_TIMEOUT_MS > 0 ? {} : { eoseTimeout: LIBRARY_EOSE_TIMEOUT_MS }),\n'
        }
      ]
    },
    {
      id: 'C4-a-caller-moves-the-timer',
      arm: 'TC1',
      describe: "a harness that names a timer, past the type, wins over the library's",
      edits: [
        {
          file: CONTEXT,
          from: '    ...(harness ?? {}),\n    eoseTimeout: LIBRARY_EOSE_TIMEOUT_MS,\n',
          to: '    eoseTimeout: LIBRARY_EOSE_TIMEOUT_MS,\n    ...(harness ?? {}),\n'
        }
      ]
    },
    {
      id: 'C4-the-timer-below-the-cap',
      arm: 'TC1',
      describe: 'the timer handed is just below the largest settle timeout a request may ask for',
      edits: [
        {
          file: CONTEXT,
          from: '    eoseTimeout: LIBRARY_EOSE_TIMEOUT_MS,\n',
          to: '    eoseTimeout: Math.min(LIBRARY_EOSE_TIMEOUT_MS, 59_999),\n'
        }
      ]
    },
    {
      id: 'C4-the-type-names-the-timer',
      arm: 'TC1',
      describe: 'the harness type accepts an EOSE timer, so a consumer can write one',
      edits: [
        {
          file: CONTEXT,
          from: 'export interface HarnessOverrides {\n',
          to: 'export interface HarnessOverrides {\n  eoseTimeout?: number;\n'
        }
      ]
    },
    {
      id: 'C5-a-second-declaration',
      arm: 'WI29',
      describe:
        "the engine declares its own copy of the default instead of importing the normalizer's",
      edits: [
        {
          file: STREAM,
          from: ENGINE_IMPORT,
          to: "import { cloneFilter, InvalidDescriptorError } from './normalize.js';\nconst DEFAULT_SETTLE_TIMEOUT_MS = 5_000;"
        }
      ]
    },
    {
      id: 'C5-a-re-export',
      arm: 'WI29',
      describe:
        'the engine keeps its import and re-exports the default, making a second entry for it',
      edits: [
        {
          file: STREAM,
          from: ENGINE_IMPORT,
          to: `${ENGINE_IMPORT}\nexport { DEFAULT_SETTLE_TIMEOUT_MS };`
        }
      ]
    },
    {
      id: 'D6-the-dependency-raises-its-default',
      arm: 'TC2',
      describe:
        "the dependency's own EOSE timer default rises from 30 s to 3000 s, above the library's — the exposure this row exists for, staged in the ledger's copy of rx-nostr 3.7.6's ESM build",
      edits: [
        { file: RX_NOSTR, from: '  eoseTimeout: 30 * 1e3,', to: '  eoseTimeout: 3000 * 1e3,' }
      ]
    },
    {
      id: 'C6-the-library-timer-below-the-dependency-default',
      arm: 'TC2',
      describe: "the library's timer is lowered below the dependency's own default",
      edits: [
        {
          file: NORMALIZE,
          from: LIBRARY_TIMER,
          to: 'export const LIBRARY_EOSE_TIMEOUT_MS = 20_000;'
        }
      ]
    },
    {
      id: 'Z1-the-sample-unclamped',
      arm: 'DC9',
      describe:
        'a sample that spans a clock jump is believed whole, so the next wait is four times the jump',
      edits: [
        {
          file: MACHINE,
          from: '    const believed = Math.min(gate.slowestVerifyMs, VERIFY_DRAIN_FLOOR_MS);',
          to: '    const believed = gate.slowestVerifyMs;'
        }
      ]
    },
    {
      id: 'Z1-the-wait-pinned-to-the-floor',
      arm: 'DC9',
      describe: 'every wait is the floor, whatever a verification has cost',
      edits: [
        {
          file: MACHINE,
          from: '    const cap = Math.max(VERIFY_DRAIN_FLOOR_MS, Math.ceil(believed * VERIFY_DRAIN_SAFETY));',
          to: '    void believed;\n    void VERIFY_DRAIN_SAFETY;\n    const cap = VERIFY_DRAIN_FLOOR_MS;'
        }
      ]
    },
    {
      id: 'Z1-a-cut-reported-drained',
      arm: 'DC9',
      describe: 'a wait cut with a candidate inside reports itself drained',
      edits: [
        {
          file: MACHINE,
          from: "      resolveGate(gate, gate.holding.size > 0 ? 'cut' : 'drained');",
          to: "      resolveGate(gate, 'drained');"
        }
      ]
    },
    {
      id: 'Z1-the-cut-does-not-discard',
      arm: 'DC9',
      describe:
        'a candidate inside the gate at the cut is delivered when its verification passes later — seen only in the live run, where it is answered after the cut',
      edits: [
        {
          file: MACHINE,
          from: "    if (phase === 'cut') for (const each of gate.holding) each.discarded = true;\n",
          to: ''
        }
      ]
    }
  ]
} satisfies Ledger;
