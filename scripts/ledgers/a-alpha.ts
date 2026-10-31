/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of what a relay's refusal is called and what it does to a
 * request (A-α), and its landings:
 * - `A-α-C1` on `RJ1`;
 * - `A-α-C2` on `RJ2`;
 * - `A-α-C3` on `RJ3`;
 * - `A-α-C4` on `RJ4`;
 * - `A-α-C5` on `RJ5`;
 * - `A5-S4` on `RJ6`;
 * - `A-α-C6` on `RJ7`.
 *
 * An id begins with the row it is read against, `C<n>-` for `A-α-C<n>` and
 * `S4-` for `A5-S4`.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const REFUSAL = 'src/lib/v1/refusal.ts';
const STREAMED = 'src/lib/v1/useStreamedReq.svelte.ts';

/** The live leg ends when, and only when, every relay of the target set is terminal. */
const ALL_TERMINAL = "    if ([...targets.values()].every((each) => each === 'terminal')) {";
/** The guard on a forward leg a request that is not live never opened. */
const NEVER_OPENED = "      if (leg === 'forward' && !live) return;\n";
/** The policy's one line. */
const POLICY = "  return { selfClearing: reason === 'rate-limited', action: 'stop' };";

export default {
  name: 'a-alpha',
  subject:
    '`A-α-C1`–`C6` and `A5-S4` (what a refusal is called and what it does to a request): their landings, `RJ1`–`RJ7`',
  files: ['src/tests/contracts/engine/refused.test.ts'],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { RJ1: 5, RJ2: 5, RJ3: 6, RJ4: 4, RJ5: 5, RJ6: 4, RJ7: 4 }
  },
  entries: [
    {
      id: 'C1-a-standardized-prefix-left-out',
      arm: 'RJ1',
      describe:
        '`auth-required:` is left out of the vocabulary, so a refusal asking for AUTH is called `unknown`',
      edits: [{ file: REFUSAL, from: "  'error',\n  'auth-required'\n]);", to: "  'error'\n]);" }]
    },
    {
      id: 'C1-the-machine-calls-every-class-error',
      arm: 'RJ1',
      describe:
        'the classifier is right and the machine folds its answer at the call, so every standardized prefix is recorded as `error`',
      edits: [
        {
          file: MACHINE,
          from: '      const reason = classifyRefusal(notice.text);\n',
          to: "      const reason = classifyRefusal(notice.text) === 'unknown' ? 'unknown' : 'error';\n"
        }
      ]
    },
    {
      id: 'C2-no-prefix-folded-into-error',
      arm: 'RJ2',
      describe: 'a notice with no colon is called `error`, a guess where the vocabulary belongs',
      edits: [
        {
          file: REFUSAL,
          from: "  if (separator < 0) return 'unknown';",
          to: "  if (separator < 0) return 'error';"
        }
      ]
    },
    {
      id: 'C2-an-unknown-prefix-folded-into-error',
      arm: 'RJ2',
      describe: 'a prefix nobody standardized is called `error`',
      edits: [
        {
          file: REFUSAL,
          from: "  return REASONS.has(prefix) ? (prefix as RefusalReason) : 'unknown';",
          to: "  return REASONS.has(prefix) ? (prefix as RefusalReason) : 'error';"
        }
      ]
    },
    {
      id: 'C3-the-leg-outlives-its-last-relay',
      arm: 'RJ3',
      describe:
        'every relay refuses and the leg does not end, so the request reports itself live with no subscription anywhere',
      edits: [{ file: MACHINE, from: ALL_TERMINAL, to: '    if (false as boolean) {' }]
    },
    {
      id: 'C3-a-rate-limit-recovered-on-its-own',
      arm: 'RJ3',
      describe:
        'a leg whose every refusal is `rate-limited` is taken for one nothing said no to, so a request left alone is asked again at the first wait of the recovery',
      edits: [
        {
          file: STREAMED,
          from: "    const recoverable = end?.kind === 'ended' && (value?.forward?.refusals.length ?? 0) === 0;\n",
          to: "    const recoverable =\n      end?.kind === 'ended' &&\n      (value?.forward?.refusals.every((refusal) => refusal.reason === 'rate-limited') ?? true);\n"
        }
      ]
    },
    {
      id: 'C3-a-refresh-that-asks-nothing',
      arm: 'RJ3',
      describe:
        'a request whose leg has ended answers `refresh()` as complete and puts nothing on the wire',
      edits: [
        {
          file: STREAMED,
          from: '    async refresh(): Promise<RefreshOutcome> {\n',
          to: "    async refresh(): Promise<RefreshOutcome> {\n      if (query.data?.forward?.end !== undefined) return { kind: 'complete' };\n"
        }
      ]
    },
    {
      id: 'C4-the-first-refusal-ends-the-leg',
      arm: 'RJ4',
      describe: "one relay's refusal ends the leg, and the event the other sends is not delivered",
      edits: [
        {
          file: MACHINE,
          from: ALL_TERMINAL,
          to: "    if ([...targets.values()].some((each) => each === 'terminal')) {"
        }
      ]
    },
    {
      id: 'C5-a-leg-never-opened-is-acted-on',
      arm: 'RJ5',
      describe:
        'a `CLOSED` naming the forward leg of a request that is not live is recorded as a refusal and ends a leg that was never opened; the seed `K3`, the defect of #186',
      edits: [{ file: MACHINE, from: NEVER_OPENED, to: '' }]
    },
    {
      id: 'C5-no-forward-refusal-is-acted-on',
      arm: 'RJ5',
      describe:
        "the guard loses its `live`, so a forward `CLOSED` is ignored on a live request too: the arm's control, without which a guard that drops everything passes",
      edits: [{ file: MACHINE, from: NEVER_OPENED, to: "      if (leg === 'forward') return;\n" }]
    },
    {
      id: 'S4-a-refusal-taken-by-any-request',
      arm: 'RJ6',
      describe:
        "the leg is read off the suffix alone, so a refusal of one request's subscription on a shared relay is taken by the other too",
      edits: [
        {
          file: MACHINE,
          from: "    if (subId.startsWith(`${reqIdBase}-b:`)) return 'backward';\n",
          to: "    if (subId.includes('-b:')) return 'backward';\n"
        }
      ]
    },
    {
      id: 'S4-a-forward-refusal-taken-by-any-request',
      arm: 'RJ6',
      describe:
        "the forward leg is read off the suffix alone, so a refusal of one live request's subscription on a shared relay ends the other's too",
      edits: [
        {
          file: MACHINE,
          from: "    if (subId.startsWith(`${reqIdBase}-f:`)) return 'forward';\n",
          to: "    if (subId.includes('-f:')) return 'forward';\n"
        }
      ]
    },
    {
      id: 'C6-the-wrong-class-clears-on-its-own',
      arm: 'RJ7',
      describe: 'another class is recorded as the one that clears by waiting',
      edits: [
        {
          file: REFUSAL,
          from: POLICY,
          to: "  return { selfClearing: reason === 'auth-required', action: 'stop' };"
        }
      ]
    },
    {
      id: 'C6-a-class-that-does-not-stop',
      arm: 'RJ7',
      describe: '`unknown` is recorded with an action other than `stop`',
      edits: [
        {
          file: REFUSAL,
          from: POLICY,
          to: "  return {\n    selfClearing: reason === 'rate-limited',\n    action: reason === 'unknown' ? ('retry' as 'stop') : 'stop'\n  };"
        }
      ]
    }
  ]
} satisfies Ledger;
