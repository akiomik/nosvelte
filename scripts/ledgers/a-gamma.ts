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
 * - `A-γ-C7` on `ST2`;
 * - `A-ζ-C1` on `DC9`.
 *
 * `ST1`, `ST2` and `DC9` each read their deadline twice, on a fake clock and
 * on the real one. The entries that move a deadline by less than the real
 * clock's margin — the timer a fifth early or late, the drain's multiplier at
 * four and a half — are killed by the fake clock's reading alone, and that is
 * the reading they are here for.
 *
 * An id beginning `C<n>-` edits the library for `A-γ-C<n>`, and one beginning
 * `Z1-` edits it for `A-ζ-C1`. One beginning `D<n>-` edits the dependency for
 * `A-γ-C<n>`, inside the ledger's own copy of `node_modules`, which the runner
 * clones per copy and restores after each entry as it restores the library.
 */
import type { Edit, Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const ENGINE = 'src/lib/v1/engine.ts';
const NORMALIZE = 'src/lib/v1/normalize.ts';
const CONTEXT = 'src/lib/v1/context.svelte.ts';
const STREAM = 'src/lib/v1/stream.ts';
const RX_NOSTR = 'node_modules/rx-nostr/dist/rx-nostr.js';
const OUTLETS = 'src/lib/v1/components/outlets.ts';
const EVENT_LIST = 'src/lib/v1/components/EventList.svelte';

/** The request's own settle timer, armed when the backlog begins. */
const SETTLE_TIMER = '    timer = setTimeout(() => settle(true), timeoutMs);';
/** The multiplier on what a verification is believed to cost. */
const DRAIN_SAFETY = 'const VERIFY_DRAIN_SAFETY = 4;';

/** The settle timer's outcome says the answer is complete. */
const REPORTS_COMPLETE: readonly Edit[] = [
  {
    file: MACHINE,
    from: '    const present = new Set<IncompleteCause>();\n',
    to: '    const present = new Set<IncompleteCause>();\n    if (viaTimer) return backlogEndOf(present, undefined);\n'
  }
];
/** An incomplete answer under `ended` rather than `timeout`. */
const WRONG_CAUSE: readonly Edit[] = [
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
];
/** A live request arms no settle timer. */
const LIVE_TIMER_NEVER_ARMED: readonly Edit[] = [
  {
    file: MACHINE,
    from: '  if (timeoutMs !== undefined) {\n    timer = setTimeout(() => settle(true), timeoutMs);',
    to: '  if (timeoutMs !== undefined && !live) {\n    timer = setTimeout(() => settle(true), timeoutMs);'
  }
];
/** The settle timer fires at `factor` times what the caller asked for. */
const TIMER_TIMES = (factor: number): readonly Edit[] => [
  {
    file: MACHINE,
    from: SETTLE_TIMER,
    to: `    timer = setTimeout(() => settle(true), timeoutMs * ${factor});`
  }
];
/**
 * The provider's requests are run on a second client of its own, built from
 * the harness alone, and not on the one it handed the library's timer to.
 */
const SECOND_CLIENT: readonly Edit[] = [
  {
    file: CONTEXT,
    from: "runtime.environment === 'browser' ? ownTransport(runtime.transport) : undefined;",
    to: "runtime.environment === 'browser' ? ownTransport(createRxNostr({ ...(options.harness ?? {}), skipVerify: true, skipExpirationCheck: true, skipValidateFilterMatching: true })) : undefined;"
  }
];

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
    "`A-γ-C1`–`A-γ-C7` and `A-ζ-C1` (the request's own settle timeout, a live request's included, the upstream timer the provider sets, and the bound on a draining gate's wait): their landings, `ST1`, `NM5`, `NM11`, `TC1`, `WI29`, `TC2`, `ST2` and `DC9`",
  files: [
    'src/tests/contracts/engine/settle.test.ts',
    'src/tests/contracts/engine/normalize.test.ts',
    'src/tests/contracts/engine/transportconfig.test.ts',
    'src/tests/contracts/engine/wiring.test.ts',
    'src/tests/contracts/engine/drain.test.ts'
  ],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that added this ledger, and `ST2`'s, with `ST1`, `TC1`, `TC2` and `DC9` read again, at the commit that added `ST2`; plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { ST1: 10, NM5: 4, NM11: 4, TC1: 6, WI29: 6, TC2: 4, ST2: 4, DC9: 13 }
  },
  entries: [
    {
      id: 'C1-the-timer-reports-complete',
      arm: 'ST1',
      describe: "the settle timer's outcome says the answer is complete",
      edits: REPORTS_COMPLETE
    },
    {
      id: 'C1-the-wrong-cause',
      arm: 'ST1',
      describe:
        'the answer is incomplete, but under `ended` rather than `timeout` — from the timer and from the relay left undetermined alike',
      edits: WRONG_CAUSE
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
          from: SETTLE_TIMER,
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
    },
    {
      id: 'C1-the-live-timer-never-armed',
      arm: 'ST1',
      describe: 'a live request arms no settle timer, so a silent relay holds its backlog open',
      edits: LIVE_TIMER_NEVER_ARMED
    },
    {
      id: 'C1-the-timer-fires-early',
      arm: 'ST1',
      describe:
        "the request's timer fires at 50ms whatever the caller asked for — the outcome is right and too soon",
      edits: [
        {
          file: MACHINE,
          from: SETTLE_TIMER,
          to: '    timer = setTimeout(() => settle(true), Math.min(timeoutMs, 50));'
        }
      ]
    },
    {
      id: 'C4-no-timer-without-a-harness',
      arm: 'TC1',
      describe:
        "the factory is handed the library's timer only when a harness is given, so the provider the published `NostrApp` builds runs on the dependency's",
      edits: [
        {
          file: CONTEXT,
          from: '    ...(harness ?? {}),\n    eoseTimeout: LIBRARY_EOSE_TIMEOUT_MS,\n',
          to: '    ...(harness ?? {}),\n    ...(harness === undefined ? {} : { eoseTimeout: LIBRARY_EOSE_TIMEOUT_MS }),\n'
        }
      ]
    },
    {
      id: 'C4-the-provider-props-name-the-timer',
      arm: 'TC1',
      describe: "the published provider's props accept an EOSE timer, so a consumer can write one",
      edits: [
        {
          file: OUTLETS,
          from: 'export type NostrAppProps = {\n',
          to: 'export type NostrAppProps = {\n  eoseTimeout?: number;\n'
        }
      ]
    },
    {
      id: 'C5-a-declaration-in-a-component-module',
      arm: 'WI29',
      describe: 'a component declares its own copy of the default in its module script',
      edits: [
        {
          file: EVENT_LIST,
          from: '<script lang="ts">\n',
          to: '<script lang="ts" module>\n  export const DEFAULT_SETTLE_TIMEOUT_MS = 5_000;\n</script>\n\n<script lang="ts">\n'
        }
      ]
    },
    {
      id: 'C5-a-wildcard-re-export',
      arm: 'WI29',
      describe: 'the engine re-exports everything the normalizer exports, the default among it',
      edits: [
        {
          file: STREAM,
          from: ENGINE_IMPORT,
          to: `${ENGINE_IMPORT}\nexport * from './normalize.js';`
        }
      ]
    },
    {
      id: 'C6-no-timer-without-a-harness',
      arm: 'TC2',
      describe:
        "the provider the published `NostrApp` builds is handed no timer of the library's, and runs on the dependency's own",
      edits: [
        {
          file: CONTEXT,
          from: '    ...(harness ?? {}),\n    eoseTimeout: LIBRARY_EOSE_TIMEOUT_MS,\n',
          to: '    ...(harness ?? {}),\n    ...(harness === undefined ? {} : { eoseTimeout: LIBRARY_EOSE_TIMEOUT_MS }),\n'
        }
      ]
    },
    {
      id: 'C1-the-timer-ignores-the-caller',
      arm: 'ST1',
      describe:
        "the request's timer runs two seconds whatever the caller asked for — the outcome is right and late",
      edits: [
        {
          file: MACHINE,
          from: SETTLE_TIMER,
          to: '    timer = setTimeout(() => settle(true), 2000);'
        }
      ]
    },
    {
      id: 'C1-the-outlet-throws-on-incomplete',
      arm: 'ST1',
      describe:
        "the component's outlet cannot be derived for an incomplete answer, so the outlet on the screen is the one from before the timeout",
      edits: [
        {
          file: ENGINE,
          from: "  if (state.events.length > 0) return { slot: 'default', error: undefined };",
          to: "  if ((state.status as string) === 'incomplete') throw new Error('no outlet');\n  if (state.events.length > 0) return { slot: 'default', error: undefined };"
        }
      ]
    },
    {
      id: 'C4-the-factory-parameter-names-the-timer',
      arm: 'TC1',
      describe:
        "the provider's factory widens the harness it takes to name an EOSE timer, the named interface left as it was",
      edits: [
        {
          file: CONTEXT,
          from: '  harness?: HarnessOverrides;\n',
          to: '  harness?: HarnessOverrides & { eoseTimeout?: number };\n'
        }
      ]
    },
    {
      id: 'C5-a-literal-parameter-default',
      arm: 'WI29',
      describe:
        "the engine's parameter defaults to a number of its own, the import kept and read elsewhere",
      edits: [
        {
          file: STREAM,
          from: '  settleTimeoutMs = DEFAULT_SETTLE_TIMEOUT_MS\n}: StreamParams)',
          to: '  settleTimeoutMs = 5_000\n}: StreamParams)'
        },
        {
          file: STREAM,
          from: ENGINE_IMPORT,
          to: `${ENGINE_IMPORT}\nvoid DEFAULT_SETTLE_TIMEOUT_MS;`
        }
      ]
    },
    {
      id: 'C5-an-alias-re-export',
      arm: 'WI29',
      describe: 'the engine re-exports the default under a name of its own',
      edits: [
        {
          file: STREAM,
          from: ENGINE_IMPORT,
          to: `${ENGINE_IMPORT}\nexport { DEFAULT_SETTLE_TIMEOUT_MS as STREAM_SETTLE_TIMEOUT_MS };`
        }
      ]
    },
    {
      id: 'C5-a-let-declaration',
      arm: 'WI29',
      describe: 'the machine declares its own copy of the default with `let`, unexported',
      edits: [
        {
          file: MACHINE,
          from: DRAIN_SAFETY,
          to: `${DRAIN_SAFETY}\nlet DEFAULT_SETTLE_TIMEOUT_MS = 5_000;\nvoid DEFAULT_SETTLE_TIMEOUT_MS;`
        }
      ]
    },
    {
      id: 'C4-the-factory-options-name-the-timer',
      arm: 'TC1',
      describe:
        "the provider's factory takes an EOSE timer as an option of its own, beside the harness",
      edits: [
        {
          file: CONTEXT,
          from: '  harness?: HarnessOverrides;\n',
          to: '  harness?: HarnessOverrides;\n  eoseTimeout?: number;\n'
        }
      ]
    },
    {
      id: 'C5-an-indirect-alias-export',
      arm: 'WI29',
      describe: 'the engine binds the default to a local of its own and exports that',
      edits: [
        {
          file: STREAM,
          from: ENGINE_IMPORT,
          to: `${ENGINE_IMPORT}\nconst handedDefault = DEFAULT_SETTLE_TIMEOUT_MS;\nexport { handedDefault as ENGINE_SETTLE_DEFAULT };`
        }
      ]
    },
    {
      id: 'C5-a-namespace-re-export',
      arm: 'WI29',
      describe: "the engine re-exports the normalizer's namespace, the default among it",
      edits: [
        {
          file: STREAM,
          from: ENGINE_IMPORT,
          to: `${ENGINE_IMPORT}\nexport * as defaults from './normalize.js';`
        }
      ]
    },
    {
      id: 'C5-a-parenthesized-default-export',
      arm: 'WI29',
      describe: 'the engine makes the default its own default export, in parentheses',
      edits: [
        {
          file: STREAM,
          from: ENGINE_IMPORT,
          to: `${ENGINE_IMPORT}\nexport default (DEFAULT_SETTLE_TIMEOUT_MS);`
        }
      ]
    },
    {
      id: 'C5-a-shadow-with-a-helper-default',
      arm: 'WI29',
      describe:
        "the engine's parameter defaults to a local that shadows the import, and a helper of its own defaults to the import instead",
      edits: [
        {
          file: STREAM,
          from: '  settleTimeoutMs?: number | undefined;\n',
          to: '  defaultTimeoutMs?: number | undefined;\n  settleTimeoutMs?: number | undefined;\n'
        },
        {
          file: STREAM,
          from: '  settleTimeoutMs = DEFAULT_SETTLE_TIMEOUT_MS\n}: StreamParams)',
          to: '  defaultTimeoutMs: DEFAULT_SETTLE_TIMEOUT_MS = 8000,\n  settleTimeoutMs = DEFAULT_SETTLE_TIMEOUT_MS\n}: StreamParams)'
        },
        {
          file: STREAM,
          from: ENGINE_IMPORT,
          to: `${ENGINE_IMPORT}\nexport function gammaDefault({ settleTimeoutMs = DEFAULT_SETTLE_TIMEOUT_MS }: { settleTimeoutMs?: number } = {}): number {\n  return settleTimeoutMs;\n}`
        }
      ]
    },
    {
      id: 'C5-a-namespace-element-access',
      arm: 'WI29',
      describe:
        "the engine reads the default out of the normalizer's namespace by element, and exports it",
      edits: [
        {
          file: STREAM,
          from: ENGINE_IMPORT,
          to: `${ENGINE_IMPORT}\nimport * as normalizer from './normalize.js';\nexport const handedDefault = normalizer['DEFAULT_SETTLE_TIMEOUT_MS'];`
        }
      ]
    },
    {
      id: 'C5-a-path-alias-import',
      arm: 'WI29',
      describe: 'the engine imports the default a second time, through `$lib`, and exports it',
      edits: [
        {
          file: STREAM,
          from: ENGINE_IMPORT,
          to: `${ENGINE_IMPORT}\nimport { DEFAULT_SETTLE_TIMEOUT_MS as viaAlias } from '$lib/v1/normalize.js';\nexport const handedDefault = viaAlias;`
        }
      ]
    },
    {
      id: 'Z1-safety-five',
      arm: 'DC9',
      describe:
        'the wait is five times what a verification is believed to cost, so a clamped sample still waits past four floors',
      edits: [{ file: MACHINE, from: DRAIN_SAFETY, to: 'const VERIFY_DRAIN_SAFETY = 5;' }]
    },
    {
      id: 'Z1-the-released-candidate-dropped',
      arm: 'DC9',
      describe:
        'a candidate that passes while its gate is draining is not delivered, so the outcome arrives alone',
      edits: [
        {
          file: MACHINE,
          from: "      if (deliver && !admission.discarded) push({ type: 'event', packet });",
          to: "      if (deliver && !admission.discarded && gate.phase !== 'draining')\n        push({ type: 'event', packet });"
        }
      ]
    },
    {
      id: 'C1-the-timer-fires-a-fifth-early',
      arm: 'ST1',
      describe:
        "the request's timer fires at four fifths of what the caller asked for — inside the real clock's margin, outside the fake clock's instant",
      edits: TIMER_TIMES(0.8)
    },
    {
      id: 'C1-the-timer-fires-a-fifth-late',
      arm: 'ST1',
      describe:
        "the request's timer fires at six fifths of what the caller asked for — inside the real clock's margin, outside the fake clock's instant",
      edits: TIMER_TIMES(1.2)
    },
    {
      id: 'C4-requests-leased-a-second-client',
      arm: 'TC1',
      describe:
        "the provider's requests run on a second client built from the harness alone, so the client handed the library's timer is never the one a request subscribes through",
      edits: SECOND_CLIENT
    },
    {
      id: 'C6-requests-leased-a-second-client',
      arm: 'TC2',
      describe:
        "the provider's requests run on a second client built from the harness alone, which runs on the dependency's own timer",
      edits: SECOND_CLIENT
    },
    {
      id: 'C7-the-live-timer-never-armed',
      arm: 'ST2',
      describe:
        'a live request arms no settle timer, so a relay that sends nothing holds it `loading`',
      edits: LIVE_TIMER_NEVER_ARMED
    },
    {
      id: 'C7-the-timer-reports-complete',
      arm: 'ST2',
      describe: "a live request's settle timer says its empty answer is complete",
      edits: REPORTS_COMPLETE
    },
    {
      id: 'C7-the-wrong-cause',
      arm: 'ST2',
      describe:
        "a live request's timed-out answer is incomplete under `ended` rather than `timeout`",
      edits: WRONG_CAUSE
    },
    {
      id: 'C7-the-timer-ends-the-live-leg',
      arm: 'ST2',
      describe:
        "a live request's settle timer ends the request, closing the forward leg with the backward",
      edits: [
        {
          file: MACHINE,
          from: '        if (!live || forwardEnded) finish();',
          to: '        if (!live || forwardEnded || viaTimer) finish();'
        }
      ]
    },
    {
      id: 'C7-the-backward-leg-left-open',
      arm: 'ST2',
      describe:
        "a live request's settle timer reports the backlog's end and leaves its backward subscription open beside the forward",
      edits: [
        {
          file: MACHINE,
          from: '        closeBackward();\n        // Released before',
          to: '        // Released before'
        }
      ]
    },
    {
      id: 'C7-the-timer-fires-a-fifth-early',
      arm: 'ST2',
      describe: "a live request's timer fires at four fifths of what the caller asked for",
      edits: TIMER_TIMES(0.8)
    },
    {
      id: 'C7-the-timer-fires-a-fifth-late',
      arm: 'ST2',
      describe: "a live request's timer fires at six fifths of what the caller asked for",
      edits: TIMER_TIMES(1.2)
    },
    {
      id: 'Z1-safety-four-and-a-half',
      arm: 'DC9',
      describe:
        "the wait is four and a half times what a verification is believed to cost — inside the real clock's margin past four floors, outside the fake clock's instant",
      edits: [{ file: MACHINE, from: DRAIN_SAFETY, to: 'const VERIFY_DRAIN_SAFETY = 4.5;' }]
    }
  ]
} satisfies Ledger;
