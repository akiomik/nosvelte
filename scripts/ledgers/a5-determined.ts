/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of what an attempt keeps once a relay's state is
 * determined, and of the `timeout` a relay left undetermined says on its own
 * (A5), and its landings:
 * - `A5-C18` on `DT1`;
 * - `A5-C26` on `DT2`;
 * - `A5-C19` on `DT3`;
 * - `A5-C29` on `DT4`;
 * - `A5-C27` on `DT5`;
 * - `A5-C28` on `DT6`.
 *
 * An id begins with the row it is read against, `C<n>-` for `A5-C<n>`. Two
 * entries may carry the same edit when two rows each owe a failure under it;
 * each is judged by its own arm.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const EVENTSET = 'src/lib/v1/eventset.ts';
const ARM = 'src/tests/contracts/engine/determined.test.ts';

/** What the backlog's end is computed from, up to the first cause. */
const COMPLETION_HEAD = '  const present = new Set<IncompleteCause>();\n';
/** A relay the backlog names as lost. */
const GONE_NAMED = "      if (phase === 'ended') gone.push(url);\n";

/** The rule both tables share: an absorbing state is kept, and anything else takes what arrives. */
const RULE = '  return ABSORBING.has(current) ? current : incoming;\n';
/** The rule with the backward table's three determined states taken out, `terminal` kept. */
const KEEPS_TERMINAL_ONLY = "  return current === 'terminal' ? current : incoming;\n";
/** The rule with one cell let through. */
const RULE_EXCEPT = (cell: string): string =>
  `  return ABSORBING.has(current) && !(${cell}) ? current : incoming;\n`;
/** The one write both tables have, handing each update to the rule. */
const WRITE_CALL = '      const next = nextPhase(current, incoming);\n';
/** The forward table, built by the one constructor both tables share. */
const FORWARD_TABLE = "  const targets = phaseTable<RelayPhase>(targetUrls, 'pending');\n";
/** The backward table, built the same way over the same target set. */
const BACKWARD_TABLE =
  "  const backwardTargets = phaseTable<BackwardPhase>(targets.keys(), 'pending');\n";
/** The last of the machine's imports. */
const LAST_IMPORT = "import { captureFromRelay, relayFailure } from './own.js';\n";
/** The registry of every table the one constructor made. */
const MINTED_DECLARATION = 'const MINTED = new WeakSet<object>();\n';
/** A `WeakSet` of the module's own, in front of the host's, that hands out the registry made from it. */
const SUBSTITUTE_WEAKSET =
  'let capturedRegistry: globalThis.WeakSet<object>;\n' +
  'const WeakSet = class<T extends object> extends globalThis.WeakSet<T> {\n' +
  '  constructor() {\n' +
  '    super();\n' +
  '    capturedRegistry = this;\n' +
  '  }\n' +
  '};\n';
/** The map a table made by the one constructor keeps its phases in. */
const TABLE_MAP =
  '  const phases = new Map<string, Phase>([...urls].map((url) => [url, initial]));\n';
/** The one write handing an update to the rule only when `when`, and letting `refused` through over `complete` otherwise. */
const WRITE_CALL_UNLESS = (when: string): string =>
  `      const next =\n        ${when} && current === 'complete' && incoming === 'refused'\n          ? incoming\n          : nextPhase(current, incoming);\n`;
/** The attempt handing its two tables to the machine's own witnesses. */
const WITNESS_CALL = '  witnessTables?.(targets, backwardTargets);\n';
/** The backward table as written, kept where its table is thrown away. */
const BACKWARD_TABLE_DISCARDED = (around: 'closure' | 'block'): string =>
  around === 'closure'
    ? `  void (() => {\n  ${BACKWARD_TABLE}    return backwardTargets;\n  })();\n`
    : `  {\n  ${BACKWARD_TABLE}    void backwardTargets;\n  }\n`;
/** The initial phase `complete` on any `wss:` target, which no test relay is. */
const COMPLETE_ON_SECURE =
  "targetUrls.some((url) => url.startsWith('wss:')) ? 'complete' : 'pending'";
/** A table of its own, over its own `Map`, that writes whatever arrives — a writer's habit, built where the shared write cannot reach it. */
const LAST_WRITE_TABLE = (name: string, phase: string, urls: string): string =>
  `  const ${name}Phases = new Map<string, ${phase}>([...${urls}].map((url) => [url, 'pending']));\n` +
  `  const ${name}: PhaseTable<${phase}> = {\n` +
  `    get: (url) => ${name}Phases.get(url),\n` +
  `    has: (url) => ${name}Phases.has(url),\n` +
  `    keys: () => ${name}Phases.keys(),\n` +
  `    values: () => ${name}Phases.values(),\n` +
  `    entries: () => ${name}Phases.entries(),\n` +
  `    write: (url, incoming) => {\n` +
  `      const current = ${name}Phases.get(url);\n` +
  `      if (current === undefined || current === incoming) return undefined;\n` +
  `      ${name}Phases.set(url, incoming);\n` +
  `      return incoming;\n` +
  `    }\n` +
  `  };\n`;
/** A terminal connection state, read into the backward table. */
const TERMINAL_STATE = "      if (phase === 'terminal') advanceBackward(packet.from, 'ended');\n";
/** The forward leg's end: every relay in scope terminal. */
const EVERY_TERMINAL = "if ([...targets.values()].every((each) => each === 'terminal')) {";
/** The relays already terminal when the request began, given up on the backlog and then on the live leg. */
const PREFLIGHT_WRITES =
  "    advanceBackward(url, 'ended');\n    if (live) advance(url, 'terminal');\n";
/**
 * A table built by hand, over its own `Map`, whose write moves a relay to
 * `next` — written out in full, so that it can copy the rule but for one cell.
 */
const HAND_BUILT_TABLE = (name: string, phase: string, urls: string, next: string): string =>
  `  const ${name}Phases = new Map<string, ${phase}>([...${urls}].map((url) => [url, 'pending']));\n` +
  `  const ${name}: PhaseTable<${phase}> = {\n` +
  `    get: (url) => ${name}Phases.get(url),\n` +
  `    has: (url) => ${name}Phases.has(url),\n` +
  `    keys: () => ${name}Phases.keys(),\n` +
  `    values: () => ${name}Phases.values(),\n` +
  `    entries: () => ${name}Phases.entries(),\n` +
  `    write: (url, incoming) => {\n` +
  `      const current = ${name}Phases.get(url);\n` +
  `      if (current === undefined) return undefined;\n` +
  `      const next = ${next};\n` +
  `      if (next === current) return undefined;\n` +
  `      ${name}Phases.set(url, next);\n` +
  `      return next;\n` +
  `    }\n` +
  `  };\n`;
/** The backward table's states, which the rule's reading iterates. */
const BACKWARD_LIST =
  "export const BACKWARD_PHASES = ['pending', 'active', 'complete', 'refused', 'ended'] as const;";
/** The connection-state handler's first reading of a packet. */
const STATE_READ =
  '      const phase = phaseOfConnectionState(packet.state);\n      if (phase === undefined) return;\n';
/** A relay's `CLOSED`, handed over as a refusal, on either leg. */
const REFUSAL_PUSH =
  "      push({\n        type: 'refused',\n        refusal: Object.freeze({ from: packet.from, leg, notice, reason })\n      });\n";
/** The backlog's own record of the relays it lost. */
const NAMED = "${gone.join(', ')} ended before the backlog did";
/** The second source of `timeout`: a target still undetermined when the outcome is derived. */
const UNDETERMINED = "      else if (!DETERMINED.has(phase)) present.add('timeout');\n";
/** The backward subscription completing on its own, which ends the wait. */
const COMPLETION = '    complete: () => settle(false)\n';
/** The request's own timer. */
const TIMER = 'timer = setTimeout(() => settle(true), timeoutMs);';
/** The request's own timer, cut to `ms` whatever it was given. */
const TIMER_CUT_TO = (ms: number): string =>
  `timer = setTimeout(() => settle(true), Math.min(timeoutMs, ${String(ms)}));`;

export default {
  name: 'a5-determined',
  subject:
    '`A5-C18`, `A5-C26`, `A5-C19`, `A5-C27`, `A5-C28` and `A5-C29` (what an attempt keeps once a relay is determined, the `timeout` an undetermined relay says on its own, and which relays a backlog names): their landings, `DT1`–`DT6`',
  files: ['src/tests/contracts/engine/determined.test.ts'],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { DT1: 5, DT2: 5, DT3: 4, DT4: 6, DT5: 4, DT6: 4 }
  },
  entries: [
    {
      id: 'C18-the-backward-table-keeps-the-last-write',
      arm: 'DT1',
      describe:
        'a determined relay on the backward table takes whatever is written next, so the death of a relay that answered or refused adds `ended` to the answer',
      edits: [{ file: MACHINE, from: RULE, to: KEEPS_TERMINAL_ONLY }]
    },
    {
      id: 'C18-the-guard-absorbs-complete-alone',
      arm: 'DT1',
      describe:
        'the table keeps `complete` and lets `refused` be overwritten, so only the pair over `refused` can see it — a port that keeps the state it expected',
      edits: [
        {
          file: MACHINE,
          from: RULE,
          to: "  return current === 'terminal' || current === 'complete' ? current : incoming;\n"
        }
      ]
    },
    {
      id: 'C18-the-guard-absorbs-refused-alone',
      arm: 'DT1',
      describe:
        'the table keeps `refused` and lets `complete` be overwritten, so only the pair over `complete` can see it',
      edits: [
        {
          file: MACHINE,
          from: RULE,
          to: "  return current === 'terminal' || current === 'refused' ? current : incoming;\n"
        }
      ]
    },
    {
      id: 'C18-a-death-not-written-to-the-backward-table',
      arm: 'DT1',
      describe:
        'a terminal connection state never reaches the backward table, so nothing is overwritten and the control’s death adds no `ended` either — a table that keeps nothing',
      edits: [{ file: MACHINE, from: TERMINAL_STATE, to: '' }]
    },
    {
      id: 'C18-the-death-of-a-determined-relay-unseen',
      arm: 'DT1',
      describe:
        'the death of a relay whose backlog is determined is dropped before either table hears it, so the answer is right for the wrong reason and only the leg end, missing at the death, says so',
      edits: [
        {
          file: MACHINE,
          from: STATE_READ,
          to: `${STATE_READ}      if (DETERMINED.has(backwardTargets.get(packet.from) ?? 'pending')) return;\n`
        }
      ]
    },
    {
      id: 'C18-the-backlog-refusal-unreported',
      arm: 'DT1',
      describe:
        'a backlog `CLOSED` is recorded in the table and handed over as no refusal, so the refused arm loses the receipt that it was refused, and its `refused` with it',
      edits: [
        {
          file: MACHINE,
          from: REFUSAL_PUSH,
          to: `      if (leg !== 'backward')\n  ${REFUSAL_PUSH}`
        }
      ]
    },
    {
      id: 'C18-the-ordinary-death-not-written-to-the-backward-table',
      arm: 'DT1',
      describe:
        'the death rx-nostr calls `error`, after the shipping retries, never reaches the backward table while a close still does, so the control over the ordinary death reads `timeout` instead of `ended` — only the runs on the ordinary death can see it',
      edits: [
        {
          file: MACHINE,
          from: TERMINAL_STATE,
          to: "      if (phase === 'terminal' && packet.state !== 'error') advanceBackward(packet.from, 'ended');\n"
        }
      ]
    },
    {
      id: 'C18-the-backward-table-a-map-of-its-own',
      arm: 'DT1',
      describe:
        'the backward table is a `Map` of its own again, written last-write past the shared write, so the death of a relay that answered or refused adds `ended` while the rule read cell by cell stays right',
      edits: [
        {
          file: MACHINE,
          from: BACKWARD_TABLE,
          to: LAST_WRITE_TABLE('backwardTargets', 'BackwardPhase', 'targets.keys()')
        }
      ]
    },
    {
      id: 'C18-the-leg-ends-on-the-first-death-and-the-death-unseen',
      arm: 'DT1',
      describe:
        'the leg ends when the first relay is terminal and the death of a determined relay is dropped, so the leg end is there at the death without the death having been taken — the reading before the death, where the leg has already ended, fails on every run, and on the ordinary death the premise of spent retries fails with it, the leg end having come before them',
      edits: [
        {
          file: MACHINE,
          from: EVERY_TERMINAL,
          to: "if ([...targets.values()].some((each) => each === 'terminal')) {"
        },
        {
          file: MACHINE,
          from: STATE_READ,
          to: `${STATE_READ}      if (DETERMINED.has(backwardTargets.get(packet.from) ?? 'pending')) return;\n`
        }
      ]
    },
    {
      id: 'C26-the-backward-table-keeps-the-last-write',
      arm: 'DT2',
      describe:
        'a determined relay on the backward table takes whatever is written next: the answer of a relay recorded gone re-decides it, an absorbed death is named as lost, and every determined row of the rule moves',
      edits: [{ file: MACHINE, from: RULE, to: KEEPS_TERMINAL_ONLY }]
    },
    {
      id: 'C26-an-answer-re-decides-a-relay-recorded-gone',
      arm: 'DT2',
      describe:
        'an `EOSE` from a relay recorded gone writes `complete` over `ended`, so a backlog one of whose relays had already been recorded gone reports itself complete — both pairs over the wire stay green, and the reverse order’s answered run and the rule’s cells fail',
      edits: [
        {
          file: MACHINE,
          from: RULE,
          to: RULE_EXCEPT("current === 'ended' && incoming === 'complete'")
        }
      ]
    },
    {
      id: 'C26-a-relay-recorded-gone-is-forgotten',
      arm: 'DT2',
      describe:
        'the REQ going out demotes a relay recorded gone to `active`, so a backlog it never answers waits out the timer and reports `timeout` naming nobody — the reverse order’s silent run fails so, its answered run reads as a re-decision, since an `EOSE` re-decides a forgotten relay, and the rule’s cells fail',
      edits: [
        {
          file: MACHINE,
          from: RULE,
          to: RULE_EXCEPT("current === 'ended' && incoming === 'active'")
        }
      ]
    },
    {
      id: 'C26-refused-written-over-complete',
      arm: 'DT2',
      describe:
        'the rule lets a `CLOSED` after an `EOSE` overwrite `complete` with `refused` — two states the outcome derives nothing from, so no run sees it: the rule’s cells and histories do, and so does the source reading, where `nextPhase` departs from the rule as written',
      edits: [
        {
          file: MACHINE,
          from: RULE,
          to: RULE_EXCEPT("current === 'complete' && incoming === 'refused'")
        }
      ]
    },
    {
      id: 'C26-ended-written-over-refused',
      arm: 'DT2',
      describe:
        'every contradiction is absorbed but a death after a refusal, which records the relay as lost — the guard that absorbs only the answer it expected',
      edits: [
        {
          file: MACHINE,
          from: RULE,
          to: RULE_EXCEPT("current === 'refused' && incoming === 'ended'")
        }
      ]
    },
    {
      id: 'C26-the-forward-table-not-absorbing',
      arm: 'DT2',
      describe:
        'the rule keeps the backward table’s determined states and not `terminal`, so the one rule over both tables is a habit of one of them again',
      edits: [
        {
          file: MACHINE,
          from: RULE,
          to: "  return ABSORBING.has(current) && current !== 'terminal' ? current : incoming;\n"
        }
      ]
    },
    {
      id: 'C26-the-write-lets-refused-over-complete',
      arm: 'DT2',
      describe:
        'the one write lets `refused` through over `complete` before it asks the rule, so the rule is right and the table is not — a reading of the rule alone, rather than of the write, could not see it',
      edits: [
        {
          file: MACHINE,
          from: WRITE_CALL,
          to: "      const next = current === 'complete' && incoming === 'refused' ? incoming : nextPhase(current, incoming);\n"
        }
      ]
    },
    {
      id: 'C26-the-write-answers-a-phase-it-kept',
      arm: 'DT2',
      describe:
        'the one write answers the phase a relay already held as though it had moved there, so a death the forward table absorbed runs the leg’s end again — the mixed runs carry a second leg end, and the rule’s cells read an answer where nothing moved',
      edits: [{ file: MACHINE, from: '      if (next === current) return undefined;\n', to: '' }]
    },
    {
      id: 'C26-the-rule-never-moves',
      arm: 'DT2',
      describe:
        'the rule keeps every state, absorbing or not, so a relay never leaves `pending` — the rule’s cells on its non-absorbing rows fail, and with them every run that waits on an answer',
      edits: [{ file: MACHINE, from: RULE, to: '  return current;\n' }]
    },
    {
      id: 'C26-the-forward-table-a-map-of-its-own',
      arm: 'DT2',
      describe:
        'the forward table is a `Map` of its own again, written last-write past the shared write, so a relay that reconnected after `terminal` revives the leg and the refusal of the other ends nothing — the forward run fails, and the attempt’s tables read as not made by the one constructor, while the rule’s cells stay right',
      edits: [
        {
          file: MACHINE,
          from: FORWARD_TABLE,
          to: LAST_WRITE_TABLE('targets', 'RelayPhase', 'targetUrls')
        }
      ]
    },
    {
      id: 'C26-the-backward-table-a-map-of-its-own',
      arm: 'DT2',
      describe:
        'the backward table is a `Map` of its own again, written last-write past the shared write, so an answer re-decides a relay recorded gone and an absorbed death is named as lost, and the attempt’s tables read as not made by the one constructor, while the rule’s cells stay right',
      edits: [
        {
          file: MACHINE,
          from: BACKWARD_TABLE,
          to: LAST_WRITE_TABLE('backwardTargets', 'BackwardPhase', 'targets.keys()')
        }
      ]
    },
    {
      id: 'C26-the-backward-table-hand-built-but-for-one-cell',
      arm: 'DT2',
      describe:
        'the backward table is built by hand and copies the rule but lets `refused` through over `complete`, a cell no answer derives anything from — every answer is right, and only the attempt’s own tables, read as not made by the one constructor, and the source reading, where the backward table is not made as written, say so',
      edits: [
        {
          file: MACHINE,
          from: BACKWARD_TABLE,
          to: HAND_BUILT_TABLE(
            'backwardTargets',
            'BackwardPhase',
            'targets.keys()',
            "current === 'complete' && incoming === 'refused' ? incoming : current === 'complete' || current === 'refused' || current === 'ended' ? current : incoming"
          )
        }
      ]
    },
    {
      id: 'C26-the-forward-table-hand-built-but-for-one-cell',
      arm: 'DT2',
      describe:
        'the forward table is built by hand and copies the rule but keeps `recovering` against `active`, a difference the leg end, which asks only for `terminal`, never sees — only the attempt’s own tables, read as not made by the one constructor, and the source reading, where the forward table is not made as written, say so',
      edits: [
        {
          file: MACHINE,
          from: FORWARD_TABLE,
          to: HAND_BUILT_TABLE(
            'targets',
            'RelayPhase',
            'targetUrls',
            "current === 'terminal' || (current === 'recovering' && incoming === 'active') ? current : incoming"
          )
        }
      ]
    },
    {
      id: 'C26-the-write-special-cases-a-table-begun-at-pending',
      arm: 'DT2',
      describe:
        'the one write lets `refused` through over `complete` only in a table begun at `pending`, which every attempt’s table is — a reading of cells begun where they are read could not see it, and the rule’s `complete` row read as an attempt meets it does',
      edits: [
        {
          file: MACHINE,
          from: WRITE_CALL,
          to: "      const next =\n        initial === 'pending' && current === 'complete' && incoming === 'refused'\n          ? incoming\n          : nextPhase(current, incoming);\n"
        }
      ]
    },
    {
      id: 'C26-the-write-special-cases-a-table-made-from-another-tables-keys',
      arm: 'DT2',
      describe:
        'the one write lets `refused` through over `complete` only in a table made from something other than a list — the backward table, made from the forward one’s keys — so a reading of cells made from lists alone could not see it, and the rule’s `complete` row read off a table made the backward table’s way does',
      edits: [
        {
          file: MACHINE,
          from: WRITE_CALL,
          to: "      const next =\n        !Array.isArray(urls) && current === 'complete' && incoming === 'refused'\n          ? incoming\n          : nextPhase(current, incoming);\n"
        }
      ]
    },
    {
      id: 'C26-the-write-replaced-after-the-table-was-made',
      arm: 'DT2',
      describe:
        'the attempt replaces its backward table’s write after the table was made, letting `refused` through over `complete`; the table is frozen, so the replacement throws and no attempt runs',
      edits: [
        {
          file: MACHINE,
          from: WITNESS_CALL,
          to:
            '  {\n' +
            '    const shared = backwardTargets.write;\n' +
            '    (backwardTargets as { write: typeof shared }).write = (url, incoming) =>\n' +
            "      backwardTargets.get(url) === 'complete' && incoming === 'refused' ? incoming : shared(url, incoming);\n" +
            '  }\n' +
            WITNESS_CALL
        }
      ]
    },
    {
      id: 'C26-the-witness-handed-tables-the-attempt-does-not-write',
      arm: 'DT2',
      describe:
        'the attempt hands its witnesses two fresh tables of the one constructor rather than the two it writes, so they read as made by it and end where they began, at `pending`, whatever the answer says, and the source reading finds the constructor called in the statement handing them over',
      edits: [
        {
          file: MACHINE,
          from: WITNESS_CALL,
          to: "  witnessTables?.(\n    phaseTable<RelayPhase>(targetUrls, 'pending'),\n    phaseTable<BackwardPhase>(targetUrls, 'pending')\n  );\n"
        }
      ]
    },
    {
      id: 'C26-the-witness-handed-no-tables',
      arm: 'DT2',
      describe:
        'the attempt never hands its tables over, so the arm reads none of them, and the source reading finds no statement handing them over',
      edits: [{ file: MACHINE, from: WITNESS_CALL, to: '' }]
    },
    {
      id: 'C26-made-by-the-constructor-read-off-the-shape',
      arm: 'DT2',
      describe:
        'whether a table was made by the one constructor is answered from what the value is rather than which value it is, so a structural copy, a proxy and an object derived from a table all read as made by it — the controls fail, and a table built by hand would pass',
      edits: [
        {
          file: MACHINE,
          from: "  return typeof value === 'object' && value !== null && MINTED.has(value);\n",
          to: "  return typeof value === 'object' && value !== null;\n"
        }
      ]
    },
    {
      id: 'C26-the-table-left-unfrozen',
      arm: 'DT2',
      describe:
        'the constructor records a table as made without freezing it, so a table it answers for can have its write replaced afterwards — the attempt’s own tables let a replacement through',
      edits: [
        {
          file: MACHINE,
          from: '  const table = Object.freeze<PhaseTable<Phase>>({\n',
          to: '  const table: PhaseTable<Phase> = ({\n'
        }
      ]
    },
    {
      id: 'C26-nothing-recorded-as-made-by-the-constructor',
      arm: 'DT2',
      describe:
        'the constructor records none of the tables it makes, so the attempt’s own tables read as built by hand — the instrument’s positive half',
      edits: [{ file: MACHINE, from: '  MINTED.add(table);\n', to: '' }]
    },
    {
      id: 'C26-the-write-remembers-a-relay-was-active',
      arm: 'DT2',
      describe:
        'the write lets `refused` through over `complete` on a relay that was once `active` — every cell, reached from `pending` by one write, reads right, and the histories, which pass through `active`, say so, as does the source reading, where the constructor departs from the rule as written',
      edits: [
        {
          file: MACHINE,
          from: TABLE_MAP,
          to: `${TABLE_MAP}  const wasActive = new Set<string>();\n`
        },
        {
          file: MACHINE,
          from: WRITE_CALL,
          to: `      if (current === 'active') wasActive.add(url);\n${WRITE_CALL_UNLESS('wasActive.has(url)')}`
        }
      ]
    },
    {
      id: 'C26-the-write-reads-another-relay',
      arm: 'DT2',
      describe:
        'the write lets `refused` through over `complete` while another relay of the table is `active` — every cell, read with the other relay at `pending`, reads right, and the histories, which move the other relay, say so, as does the source reading, where the constructor departs from the rule as written',
      edits: [
        {
          file: MACHINE,
          from: WRITE_CALL,
          to: WRITE_CALL_UNLESS("[...phases.values()].some((phase) => phase === 'active')")
        }
      ]
    },
    {
      id: 'C26-the-write-reads-the-relays-url',
      arm: 'DT2',
      describe:
        'the write lets `refused` through over `complete` on a relay reached over `wss:` — every relay a test writes is `ws:`, so only the source reading, where the constructor departs from the rule as written, says so',
      edits: [{ file: MACHINE, from: WRITE_CALL, to: WRITE_CALL_UNLESS("url.startsWith('wss:')") }]
    },
    {
      id: 'C26-the-write-counts-its-writes',
      arm: 'DT2',
      describe:
        'the write lets `refused` through over `complete` from a relay’s fifth write on — past every history the walk writes, so only the source reading, where the constructor departs from the rule as written, says so',
      edits: [
        {
          file: MACHINE,
          from: TABLE_MAP,
          to: `${TABLE_MAP}  const written = new Map<string, number>();\n`
        },
        {
          file: MACHINE,
          from: WRITE_CALL,
          to: `      const count = (written.get(url) ?? 0) + 1;\n      written.set(url, count);\n${WRITE_CALL_UNLESS('count >= 5')}`
        }
      ]
    },
    {
      id: 'C26-a-table-built-by-hand-recorded-as-made',
      arm: 'DT2',
      describe:
        'the backward table is built by hand, copies the rule but lets `refused` through over `complete`, and is frozen and recorded as made — every reading of the tables takes it for the constructor’s, and only the source reading, where `MINTED` is reached outside the rule and the backward table is not made as written, says so',
      edits: [
        {
          file: MACHINE,
          from: BACKWARD_TABLE,
          to:
            HAND_BUILT_TABLE(
              'backwardTargets',
              'BackwardPhase',
              'targets.keys()',
              "current === 'complete' && incoming === 'refused' ? incoming : current === 'complete' || current === 'refused' || current === 'ended' ? current : incoming"
            ) + '  Object.freeze(backwardTargets);\n  MINTED.add(backwardTargets);\n'
        }
      ]
    },
    {
      id: 'C26-undefined-bound-in-the-module-for-secure-relays',
      arm: 'DT2',
      describe:
        'the module binds `undefined` of its own and sets it to `pending` when any target is `wss:`, so every write over a relay still `pending` reads as one outside the table — the rule’s tokens are as written and every relay a test writes is `ws:`, so only the source reading, where `undefined` in the constructor is bound outside the rule and the forward table is made other than as written, says so',
      edits: [
        {
          file: MACHINE,
          from: LAST_IMPORT,
          to: `${LAST_IMPORT}\n// eslint-disable-next-line no-shadow-restricted-names\nlet undefined: undefined = void 0;\n`
        },
        {
          file: MACHINE,
          from: FORWARD_TABLE,
          to: "  const targets = phaseTable<RelayPhase>(\n    (\n      (undefined = targetUrls.some((url) => url.startsWith('wss:'))\n        ? ('pending' as never)\n        : void 0),\n      targetUrls\n    ),\n    'pending'\n  );\n"
        }
      ]
    },
    {
      id: 'C26-a-registry-captured-through-a-substitute-WeakSet',
      arm: 'DT2',
      describe:
        'the module substitutes a `WeakSet` that captures the registry it is made into, builds the backward table by hand with `refused` over `complete`, freezes it and records it through the captured registry, keeping the constructor’s call — every reading of the tables takes it for the constructor’s, and only the source reading, where `WeakSet` in `MINTED` is bound outside the rule, the constructor is called other than as written and the backward table handed over is built by hand, says so',
      edits: [
        { file: MACHINE, from: MINTED_DECLARATION, to: SUBSTITUTE_WEAKSET + MINTED_DECLARATION },
        {
          file: MACHINE,
          from: BACKWARD_TABLE,
          to:
            "  void phaseTable<BackwardPhase>(targets.keys(), 'pending');\n" +
            HAND_BUILT_TABLE(
              'backwardTargets',
              'BackwardPhase',
              'targets.keys()',
              "current === 'complete' && incoming === 'refused' ? incoming : current === 'complete' || current === 'refused' || current === 'ended' ? current : incoming"
            ) +
            '  Object.freeze(backwardTargets);\n  capturedRegistry.add(backwardTargets);\n'
        }
      ]
    },
    {
      id: 'C26-a-table-made-through-an-alias-of-the-constructor',
      arm: 'DT2',
      describe:
        'the module imports the constructor from itself under another name and makes the backward table through it, begun at `complete` on any `wss:` target, while the statement as written runs in a closure whose table is thrown away — every relay a test writes is `ws:`, so only the source reading, where the backward table is not written among `referenceStream`’s own statements and the one handed over is made by the alias, says so',
      edits: [
        {
          file: MACHINE,
          from: LAST_IMPORT,
          to: `${LAST_IMPORT}import { 'phaseTable' as makeTable } from './machine.js';\n`
        },
        {
          file: MACHINE,
          from: BACKWARD_TABLE,
          to: `${BACKWARD_TABLE_DISCARDED('closure')}  const backwardTargets = makeTable<BackwardPhase>(targets.keys(), ${COMPLETE_ON_SECURE});\n`
        }
      ]
    },
    {
      id: 'C26-a-table-made-through-the-modules-namespace',
      arm: 'DT2',
      describe:
        'the module reads the constructor off its own namespace by a computed name and makes the backward table through it, begun at `complete` on any `wss:` target, while the statement as written runs in a block whose table is thrown away — no spelling of the constructor is read, so only the source reading, where the backward table is not written among `referenceStream`’s own statements and the one handed over is made otherwise, says so',
      edits: [
        {
          file: MACHINE,
          from: LAST_IMPORT,
          to: `${LAST_IMPORT}import * as machineSelf from './machine.js';\n`
        },
        {
          file: MACHINE,
          from: BACKWARD_TABLE,
          to: `${BACKWARD_TABLE_DISCARDED('block')}  const backwardTargets = (\n    Reflect.get(machineSelf, 'phase' + 'Table') as (\n      urls: Iterable<string>,\n      initial: BackwardPhase\n    ) => PhaseTable<BackwardPhase>\n  )(targets.keys(), ${COMPLETE_ON_SECURE});\n`
        }
      ]
    },
    {
      id: 'C26-the-witnesses-rebound-before-the-handover',
      arm: 'DT2',
      describe:
        'the attempt rebinds its witnesses just before it hands its tables over, so that on any `wss:` target they are handed a frozen copy of the backward table rather than the table the attempt writes — every relay a test writes is `ws:`, so only the source reading, where the witnesses and the target list are named outside the handover, says so',
      edits: [
        {
          file: MACHINE,
          from: WITNESS_CALL,
          to: `  witnessTables = ((given) =>\n    given === undefined\n      ? undefined\n      : (forward: PhaseTable<RelayPhase>, backward: PhaseTable<BackwardPhase>) =>\n          given(forward, targetUrls.some((url) => url.startsWith('wss:')) ? Object.freeze({ ...backward }) : backward))(witnessTables);\n${WITNESS_CALL}`
        }
      ]
    },
    {
      id: 'C26-the-machine-rebound-around-its-handover',
      arm: 'DT2',
      describe:
        'the module rebinds `referenceStream` itself to a wrapper that hands it no witnesses when any target is `wss:`, so the tables of such an attempt are read by nobody — every relay a test writes is `ws:`, so only the source reading, where `referenceStream` is named outside its declaration, says so',
      edits: [
        {
          file: MACHINE,
          from: LAST_IMPORT,
          to: `${LAST_IMPORT}\nconst originalStream = referenceStream;\nreferenceStream = (params: MachineParams) =>\n  originalStream(\n    params.targets.some((url) => url.startsWith('wss:'))\n      ? { ...params, witnessTables: undefined }\n      : params\n  );\n`
        }
      ]
    },
    {
      id: 'C26-the-histories-compare-nothing',
      arm: 'DT2',
      describe:
        'the walk over every history of four writes compares nothing, so it reports no disagreement whatever the write does — its control, which must disagree, fails',
      edits: [
        {
          file: ARM,
          from: '          if (moved === answered && read[0] === folded[CELL] && read[1] === folded[BESIDE])',
          to: '          if (true || (moved === answered && read[0] === folded[CELL] && read[1] === folded[BESIDE]))'
        }
      ]
    },
    {
      id: 'C26-the-source-reading-skips-the-tokens',
      arm: 'DT2',
      describe:
        'the source reading takes each of the rule’s declarations as written without comparing its tokens — the controls of a write that remembers and of a declarator beside the rule fail',
      edits: [
        {
          file: ARM,
          from: '    if (parted === undefined) declared.push(name);',
          to: '    if (true || parted === undefined) declared.push(name);'
        }
      ]
    },
    {
      id: 'C26-the-source-reading-skips-the-bindings',
      arm: 'DT2',
      describe:
        'the source reading does not ask what each name in the rule is bound to — the controls of `undefined` bound in the module and of a host constructor substituted, imported or hoisted out of a block fail',
      edits: [
        {
          file: ARM,
          from: '        else if (outside.length > 0)',
          to: '        else if (false && outside.length > 0)'
        }
      ]
    },
    {
      id: 'C26-the-source-reading-allows-every-site',
      arm: 'DT2',
      describe:
        'the source reading reports none of the places outside the rule that name it — the controls of a table recorded as made by hand, the absorbing states changed, the rule rebound, the constructor held as a value, a determined state read other than by `has`, a binding of the same spelling, a string evaluated as code, a table made other than as written and a table made in a closure and another handed over fail',
      edits: [
        {
          file: ARM,
          from: '      else breaches.push(`${node.text} outside the rule: ${lineOf(statement)}`);',
          to: '      else if (false) breaches.push(`${node.text} outside the rule: ${lineOf(statement)}`);'
        }
      ]
    },
    {
      id: 'C26-the-source-reading-allows-any-construction',
      arm: 'DT2',
      describe:
        'the source reading takes any call of the constructor for one of the two statements that make an attempt’s tables — the controls of the constructor held as a value, of a table made other than as written and of a table made in a closure and another handed over fail',
      edits: [
        {
          file: ARM,
          from: '      else if (table !== -1) made.push',
          to: "      else if (node.text === 'phaseTable') made.push"
        }
      ]
    },
    {
      id: 'C26-the-source-reading-allows-a-table-statement-in-any-scope',
      arm: 'DT2',
      describe:
        'the source reading takes a statement written as one of the two that make an attempt’s tables wherever it stands, not only among `referenceStream`’s own — the control of a table made in a closure and another handed over fails',
      edits: [
        {
          file: ARM,
          from: "      const table = node.text === 'phaseTable' ? making.indexOf(statement as ts.Statement) : -1;",
          to: "      const table =\n        node.text === 'phaseTable'\n          ? THE_TABLES.findIndex(\n              (text) => parting(tokensOf(text), tokensOf(statement.getText(file))) === undefined\n            )\n          : -1;"
        }
      ]
    },
    {
      id: 'C26-the-source-reading-counts-no-statement',
      arm: 'DT2',
      describe:
        'the source reading does not report a statement that makes a table, or hands them over, written other than once among `referenceStream`’s own — the controls of a table made other than as written and of a table made in a closure and another handed over fail',
      edits: [
        {
          file: ARM,
          from: '    if (found.length !== 1)\n      breaches.push(',
          to: '    if (false && found.length !== 1)\n      breaches.push('
        }
      ]
    },
    {
      id: 'C26-the-source-reading-takes-any-binding-of-the-handover',
      arm: 'DT2',
      describe:
        'the source reading does not report a name the handover reads that is bound to anything but the rule, one of its own statements or one of `referenceStream`’s parameters — the controls of a table made other than as written, of a name the handover reads declared again and of a table made in a closure and another handed over fail',
      edits: [
        {
          file: ARM,
          from: '      if (kind === undefined)\n        breaches.push(',
          to: '      if (false && kind === undefined)\n        breaches.push('
        }
      ]
    },
    {
      id: 'C26-the-source-reading-lets-a-handed-parameter-be-named-anywhere',
      arm: 'DT2',
      describe:
        'the source reading does not report a parameter the handover reads that is named outside it and its one other reader — the controls of the witnesses rebound before the handover and in a default fail',
      edits: [
        {
          file: ARM,
          from: '      if (!allowed) breaches.push(',
          to: '      if (false && !allowed) breaches.push('
        }
      ]
    },
    {
      id: 'C26-the-source-reading-lets-a-handed-parameter-be-named-among-the-parameters',
      arm: 'DT2',
      describe:
        'the source reading takes a parameter the handover reads as named at its declaration wherever it stands among `referenceStream`’s parameters, a default included — the control of the witnesses rebound in a default fails',
      edits: [
        {
          file: ARM,
          from: '        declaring ||\n',
          to: '        parameterOf(node) ||\n'
        }
      ]
    },
    {
      id: 'C26-the-source-reading-lets-the-machine-be-named-anywhere',
      arm: 'DT2',
      describe:
        'the source reading does not report `referenceStream` named outside its declaration — the control of the machine rebound fails',
      edits: [
        {
          file: ARM,
          from: "    if (ts.isIdentifier(node) && node.text === 'referenceStream' && node !== stream?.name)",
          to: "    if (false && ts.isIdentifier(node) && node.text === 'referenceStream' && node !== stream?.name)"
        }
      ]
    },
    {
      id: 'C26-the-source-reading-ignores-eval',
      arm: 'DT2',
      describe:
        'the source reading does not look for `eval` — the control of a string evaluated as code fails',
      edits: [
        {
          file: ARM,
          from: "  const reached = new Set([...names, 'eval']);",
          to: '  const reached = new Set([...names]);'
        }
      ]
    },
    {
      id: 'C26-a-relay-given-up-is-not-recorded-on-the-backlog',
      arm: 'DT2',
      describe:
        'a relay already terminal when the request began is given up on the live leg and not on the backlog, so the reverse order is never reached: the forced runs’ premise, and only they fail — the answered run reads `complete`, the silent one `timeout` naming nobody',
      edits: [
        { file: MACHINE, from: PREFLIGHT_WRITES, to: "    if (live) advance(url, 'terminal');\n" }
      ]
    },
    {
      id: 'C26-a-phase-the-rule-was-never-read-over',
      arm: 'DT2',
      describe:
        'the backward table gains a state, so the rule read over the list meets a row and a column nobody wrote down — the expected table is the one that fails, not the compiler',
      edits: [
        {
          file: MACHINE,
          from: BACKWARD_LIST,
          to: "export const BACKWARD_PHASES = [\n  'pending',\n  'active',\n  'complete',\n  'refused',\n  'ended',\n  'expired'\n] as const;"
        }
      ]
    },
    {
      id: 'C26-the-record-names-the-relays-now-down',
      arm: 'DT2',
      describe:
        'the backlog’s record of the relays it lost is read off the connections as they stand rather than off the table, so a relay whose death was absorbed is named beside the one that was lost',
      edits: [
        {
          file: MACHINE,
          from: NAMED,
          to: "${Object.entries(transport.relayStatus() ?? {})\n          .filter(([url, relay]) => backwardTargets.has(url) && phaseOfConnectionState(relay.connection) === 'terminal')\n          .map(([url]) => url)\n          .join(', ')} ended before the backlog did"
        }
      ]
    },
    {
      id: 'C26-the-record-names-every-relay',
      arm: 'DT2',
      describe:
        'the backlog’s record of the relays it lost names every relay of the target set, so one that answered in time is named as gone',
      edits: [
        {
          file: MACHINE,
          from: NAMED,
          to: "${[...backwardTargets.keys()].join(', ')} ended before the backlog did"
        }
      ]
    },
    {
      id: 'C26-the-record-names-the-last-relay-lost',
      arm: 'DT2',
      describe:
        'the backlog’s record of the relays it lost names only the last of them, so the backlog nobody answered names one of its two lost relays',
      edits: [
        {
          file: MACHINE,
          from: NAMED,
          to: "${gone.slice(-1).join(', ')} ended before the backlog did"
        }
      ]
    },
    {
      id: 'C19-an-undetermined-relay-adds-nothing',
      arm: 'DT3',
      describe:
        'a relay still undetermined when the outcome is derived adds no cause, so a backlog nobody answered reports itself complete unless the timer drew the boundary',
      edits: [{ file: MACHINE, from: UNDETERMINED, to: '' }]
    },
    {
      id: 'C19-the-completion-waits-for-the-timer',
      arm: 'DT3',
      describe:
        'the backward subscription completing no longer ends the wait, so the answer comes from the request’s own timer ten seconds later',
      edits: [{ file: MACHINE, from: COMPLETION, to: '    complete: () => {}\n' }]
    },
    {
      id: 'C19-the-request-timer-cut-short',
      arm: 'DT3',
      describe:
        'the request’s timer is cut to 20 ms whatever it was given, so the answer arrives before the dependency’s own timer could have ended the wait — the timed run reads it early',
      edits: [{ file: MACHINE, from: TIMER, to: TIMER_CUT_TO(20) }]
    },
    {
      id: 'C19-the-completion-dropped-and-the-timer-cut-to-the-dependencys',
      arm: 'DT3',
      describe:
        'the completion no longer ends the wait and the request’s timer is cut to the dependency’s 40 ms, so the timed run answers at the same instant with the same chunks — only the run without a timer, which then never answers, can see it',
      edits: [
        { file: MACHINE, from: COMPLETION, to: '    complete: () => {}\n' },
        { file: MACHINE, from: TIMER, to: TIMER_CUT_TO(40) }
      ]
    },
    {
      id: 'C19-the-completion-dropped-and-the-timer-cut-inside-the-window',
      arm: 'DT3',
      describe:
        'the completion no longer ends the wait and the request’s timer is cut to 60 ms, inside the window the timed run accepts — only the run without a timer can see it',
      edits: [
        { file: MACHINE, from: COMPLETION, to: '    complete: () => {}\n' },
        { file: MACHINE, from: TIMER, to: TIMER_CUT_TO(60) }
      ]
    },
    {
      id: 'C29-a-refusal-behind-an-answer-is-a-cause',
      arm: 'DT4',
      describe:
        'the cause is counted off the refusals the attempt was told again, so a relay that answered and then closed makes the answer `refused` while another relay holds the backlog open, and in one task',
      edits: [
        {
          file: EVENTSET,
          from: COMPLETION_HEAD,
          to: `${COMPLETION_HEAD}  if (backlog.refusals.length > 0) present.add('refused');\n`
        }
      ]
    },
    {
      id: 'C29-the-table-says-nothing-of-a-refusal',
      arm: 'DT4',
      describe:
        "a relay determined by refusing adds no cause: the arm's control, the frames the other way round",
      edits: [
        {
          file: MACHINE,
          from: "      else if (phase === 'refused') present.add('refused');\n",
          to: ''
        }
      ]
    },
    {
      id: 'C27-the-silent-relay-named',
      arm: 'DT5',
      describe: 'a relay left undetermined is named beside the one that was gone',
      edits: [
        {
          file: MACHINE,
          from: GONE_NAMED,
          to: "      if (phase !== 'complete' && phase !== 'refused') gone.push(url);\n"
        }
      ]
    },
    {
      id: 'C27-the-relay-called-gone-is-not-asked',
      arm: 'DT5',
      describe: 'the relay the preflight recorded as gone is left out of the REQ',
      edits: [
        {
          file: MACHINE,
          from: '  const routeToTargets = { on: { relays: [...targetUrls] } };\n',
          to: '  const routeToTargets = {\n    on: { relays: [...targetUrls].filter((url) => !preflightTerminal.includes(url)) }\n  };\n'
        }
      ]
    },
    {
      id: 'C27-the-gone-relay-not-named',
      arm: 'DT5',
      describe: 'the record names nobody, so the two relays are one cause set and no attribution',
      edits: [
        {
          file: MACHINE,
          from: GONE_NAMED,
          to: "      if (phase === ('never' as string)) gone.push(url);\n"
        }
      ]
    },
    {
      id: 'C28-the-answered-relay-named',
      arm: 'DT6',
      describe:
        'a relay that answered is named beside the one that died, which no published reading separates, since the death has added `ended` already',
      edits: [
        {
          file: MACHINE,
          from: GONE_NAMED,
          to: "      if (phase === 'ended' || phase === 'complete') gone.push(url);\n"
        }
      ]
    }
  ]
} satisfies Ledger;
