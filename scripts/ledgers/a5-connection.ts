/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of what a request does with the state of each relay's
 * connection (A5), and its landings:
 * - `A5-C2` on `CS1`;
 * - `A5-C4` on `CS2`;
 * - `A5-C5` on `CS3`;
 * - `A5-C6` on `CS4`;
 * - `A5-C25` on `CS5`;
 * - `A5-C7` on `CS6`;
 * - `A5-C8` on `CS7`, the order of the re-open and the ask included;
 * - `A5-C20` on `CS8`.
 *
 * An id begins with the row it is read against, `C<n>-` for `A5-C<n>`. Two
 * entries may carry the same edit when two rows, or two arms, each owe a
 * failure under it; each is judged by its own arm.
 */
import type { Ledger } from '../ledger.ts';

const MACHINE = 'src/lib/v1/machine.ts';
const REFUSAL = 'src/lib/v1/refusal.ts';
const EVENTSET = 'src/lib/v1/eventset.ts';
const STREAM = 'src/lib/v1/stream.ts';

/** The leg end's reason: every relay of the target set, named. */
const LEG_END_REASON =
  "          `every relay in scope stopped the live request: ${[...targets.keys()].join(', ')}`";
/** The live leg ends when, and only when, every relay of the target set is terminal. */
const ALL_TERMINAL = "    if ([...targets.values()].every((each) => each === 'terminal')) {";
/** The tables' one write through the absorbing rule: a relay already terminal is left alone. */
const ABSORBING = '      const next = nextPhase(current, incoming);\n';
/** The tables' membership test, inside their one write: a relay outside the target set is not this request's. */
const MEMBERSHIP =
  '      const current = phases.get(url);\n      if (current === undefined) return undefined;\n';
/** The connection-state channel's write of the live table. */
const CONNECTION_WRITE = '      if (live) advance(packet.from, phase);';
/** The outgoing-REQ channel's write of the live table. */
const OUTGOING_WRITE = "      if (leg === 'forward') advance(packet.to, 'active');";
/** The four terminal connection states, falling through to one answer. */
const TERMINAL_CASES =
  "    case 'error':\n    case 'rejected':\n    case 'terminated':\n    case 'dormant':\n      return 'terminal';";
/** The three recovering connection states. */
const RECOVERING_CASES =
  "    case 'connecting':\n    case 'waiting-for-retrying':\n    case 'retrying':\n      return 'recovering';";
/** The preflight's answer for a relay whose retries ran out. */
const REOPEN = "    case 'error':\n      return 'reconnect-then-ask';\n";
/** The preflight's answer for a relay that refused the connection. */
const GIVE_UP = "    case 'rejected':\n      return 'give-up';";
/** The preflight's answer for a disposed client. */
const DISPOSED = "    case 'terminated':\n      return 'disposed';";
/** The list the preflight fills, which a mutation can declare another beside. */
const PREFLIGHT_LIST = '  const preflightTerminal: string[] = [];';
/** The preflight's read of each relay's connection. */
const PREFLIGHT_SWITCH = "    switch (approachFor(status[url]?.connection ?? 'initialized')) {";
/** The preflight's re-open of a relay whose retries ran out. */
const PREFLIGHT_REOPEN =
  "      case 'reconnect-then-ask':\n        transport.reconnect(url);\n        break;";
/** The last line of the attempt's start: both legs have been asked by here. */
const BOTH_LEGS_ASKED = '  if (backward !== undefined) subscriptions.push(backward);';
/** Both legs routed to the target set fixed when the request began. */
const ROUTE = '  const routeToTargets = { on: { relays: [...targetUrls] } };';
/** The record of a forward leg's end, which leaves the answer as it was. */
const FORWARD_END_RECORD = '  return { ...set, forward: { ...forward, end: Object.freeze(end) } };';
/** Each attempt's subscriptions named by the attempt. */
const ATTEMPT_NAME = '      reqIdBase: `${reqIdBase}-${attemptId}`,';
/** A table's store of its relays' phases, where each table is made. */
const TABLE_STORE =
  '  const phases = new Map<string, Phase>([...urls].map((url) => [url, initial]));\n';

/**
 * A setter put back beside the tables' one write, which stores what it is
 * handed without asking the rule — the surface the tables were folded to
 * remove, so that a channel's habit of writing past the rule can still be
 * written down as a defect.
 */
const SETTER_BESIDE_THE_WRITE = [
  {
    file: MACHINE,
    from: '  write(url: string, incoming: Phase): Phase | undefined;\n}\n',
    to: '  write(url: string, incoming: Phase): Phase | undefined;\n  set(url: string, phase: Phase): void;\n}\n'
  },
  {
    file: MACHINE,
    from: '    write: (url, incoming) => {\n',
    to: '    set: (url, phase) => {\n      phases.set(url, phase);\n    },\n    write: (url, incoming) => {\n'
  }
];

/**
 * The connection-state channel's write, with the backlog asked again — under
 * `rxReqId` — of a relay the dependency's own retry has connected again: a
 * `connected` straight after `retrying`, which the first connection is not.
 */
const reaskOnRetry = (rxReqId: string): string =>
  '      const before = connectionBefore.get(packet.from);\n' +
  '      connectionBefore.set(packet.from, packet.state);\n' +
  "      if (live && packet.state === 'connected' && before === 'retrying') {\n" +
  '        const again = transport\n' +
  `          .use(createRxOneshotReq({ filters, rxReqId: ${rxReqId} }), routeToTargets)\n` +
  "          ?.subscribe({ next: (each) => admitEvent('backward', each) });\n" +
  '        if (again !== undefined) subscriptions.push(again);\n' +
  '      }\n' +
  `${CONNECTION_WRITE}`;

/**
 * The tables' one write with the absorbing rule held only for some relays, by
 * how they reached `terminal` — which only the forward table has, so the
 * backward table's rule is untouched.
 */
const absorbingOnlyWhen = (held: string) => [
  {
    file: MACHINE,
    from: TABLE_STORE,
    to: `${TABLE_STORE}  const reachedFromRecovery = new Set<string>();\n`
  },
  {
    file: MACHINE,
    from: `${MEMBERSHIP}${ABSORBING}`,
    to:
      `${MEMBERSHIP}` +
      "      if (incoming === 'terminal' && current === 'recovering') reachedFromRecovery.add(url);\n" +
      `      const next =\n        current === 'terminal' && !(${held}) ? incoming : nextPhase(current, incoming);\n`
  }
];

export default {
  name: 'a5-connection',
  subject:
    '`A5-C2`, `A5-C4`, `A5-C5`, `A5-C6`, `A5-C7`, `A5-C8`, `A5-C20` and `A5-C25` (what a request does with the state of each relay’s connection): their landings, `CS1`–`CS8`',
  files: ['src/tests/contracts/engine/connection.test.ts'],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that added this ledger, `CS7`'s again at the commit that folded `CS9` into it, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { CS1: 5, CS2: 5, CS3: 5, CS4: 4, CS5: 4, CS6: 4, CS7: 8, CS8: 5 }
  },
  entries: [
    {
      id: 'C2-the-leg-end-names-no-relay',
      arm: 'CS1',
      describe: 'the leg end says every relay stopped and names none of them',
      edits: [
        {
          file: MACHINE,
          from: LEG_END_REASON,
          to: "          'every relay in scope stopped the live request'"
        }
      ]
    },
    {
      id: 'C2-the-leg-end-names-the-last-relay',
      arm: 'CS1',
      describe:
        'the leg end names the relay whose state ended it rather than every relay that stopped',
      edits: [
        {
          file: MACHINE,
          from: LEG_END_REASON,
          to: '          `every relay in scope stopped the live request: ${url}`'
        }
      ]
    },
    {
      id: 'C2-the-leg-end-carries-no-reason',
      arm: 'CS1',
      describe: 'the leg ends with no error, so nothing says which relays stopped',
      edits: [
        {
          file: MACHINE,
          from: `      endForward(\n        relayFailure(\n${LEG_END_REASON}\n        )\n      );`,
          to: '      endForward(undefined);'
        }
      ]
    },
    {
      id: 'C2-the-leg-ends-on-the-first-terminal-relay',
      arm: 'CS1',
      describe:
        'the leg ends when any relay of the target set is terminal, so one relay stopping ends it while the other is up',
      edits: [
        {
          file: MACHINE,
          from: ALL_TERMINAL,
          to: "    if ([...targets.values()].some((each) => each === 'terminal')) {"
        }
      ]
    },
    {
      id: 'C2-an-exhausted-relay-is-not-terminal',
      arm: 'CS1',
      describe:
        "`error` — the ordinary death, once the dependency's retries are spent — is not classified, so the relays that died for good are never terminal",
      edits: [
        {
          file: REFUSAL,
          from: TERMINAL_CASES,
          to: "    case 'rejected':\n    case 'terminated':\n    case 'dormant':\n      return 'terminal';"
        }
      ]
    },
    {
      id: 'C2-a-refused-socket-is-not-terminal',
      arm: 'CS1',
      describe:
        '`rejected` — a relay refusing the socket with 4000 — is not classified, so relays that refused it are never terminal',
      edits: [
        {
          file: REFUSAL,
          from: TERMINAL_CASES,
          to: "    case 'error':\n    case 'terminated':\n    case 'dormant':\n      return 'terminal';"
        }
      ]
    },
    {
      id: 'C4-the-forward-leg-cut-while-recovering',
      arm: 'CS2',
      describe:
        "a relay's connection waiting to retry, or retrying, cuts the forward leg's gate — the first connection's `connecting` left alone — so the leg stays open through the retry and nothing the re-sent subscription delivers is shown",
      edits: [
        {
          file: MACHINE,
          from: CONNECTION_WRITE,
          to:
            "      if (live && (packet.state === 'waiting-for-retrying' || packet.state === 'retrying'))\n" +
            "        gates.forward.phase = 'cut';\n" +
            `${CONNECTION_WRITE}`
        }
      ]
    },
    {
      id: 'C4-waiting-to-retry-counted-as-gone',
      arm: 'CS2',
      describe:
        'a socket waiting to retry is classified terminal, so a drop the dependency is about to recover ends the leg',
      edits: [
        {
          file: REFUSAL,
          from: RECOVERING_CASES,
          to: "    case 'connecting':\n    case 'retrying':\n      return 'recovering';\n    case 'waiting-for-retrying':\n      return 'terminal';"
        }
      ]
    },
    {
      id: 'C4-a-retry-counted-as-gone',
      arm: 'CS2',
      describe:
        'a socket retrying is classified terminal, so the reconnection itself ends the leg it would have carried',
      edits: [
        {
          file: REFUSAL,
          from: RECOVERING_CASES,
          to: "    case 'connecting':\n    case 'waiting-for-retrying':\n      return 'recovering';\n    case 'retrying':\n      return 'terminal';"
        }
      ]
    },
    {
      id: 'C4-a-reconnection-ends-the-leg',
      arm: 'CS2',
      describe:
        "a relay connected again by the dependency's own retry is recorded terminal, so the leg ends on the reconnect. Only a `connected` straight after `retrying` — the state the dependency sets for a retry and for nothing else — so the first connection, `connecting` and then `connected`, is left as it is",
      edits: [
        {
          file: MACHINE,
          from: PREFLIGHT_LIST,
          to: `${PREFLIGHT_LIST}\n  const connectionBefore = new Map<string, string>();`
        },
        {
          file: MACHINE,
          from: CONNECTION_WRITE,
          to: "      const before = connectionBefore.get(packet.from);\n      connectionBefore.set(packet.from, packet.state);\n      if (live)\n        advance(\n          packet.from,\n          packet.state === 'connected' && before === 'retrying' ? 'terminal' : phase\n        );"
        }
      ]
    },
    {
      id: 'C4-a-retry-asks-a-second-backlog',
      arm: 'CS2',
      describe:
        "a relay connected again by the dependency's own retry has the backlog asked of it again under a name of its own, inside the same attempt. **Not a breach of the Then** — the leg stays open and the request recovers — but of the observation `CS2` records beside it, that no second backlog is asked: the dependency's habit (0002, `N2`), held here so a change that starts asking it again is seen. The retry is told from the first connection as in `C4-a-reconnection-ends-the-leg`",
      edits: [
        {
          file: MACHINE,
          from: PREFLIGHT_LIST,
          to: `${PREFLIGHT_LIST}\n  const connectionBefore = new Map<string, string>();`
        },
        {
          file: MACHINE,
          from: CONNECTION_WRITE,
          to: reaskOnRetry('`${reqIdBase}-again-b`')
        }
      ]
    },
    {
      id: 'C4-a-retry-asks-the-backlog-again-under-its-name',
      arm: 'CS2',
      describe:
        'the same, and against the same observation rather than the Then, under the name the backlog already had — which only a count of every backward REQ on the wire sees, since the subscription names asked are the same set as before',
      edits: [
        {
          file: MACHINE,
          from: PREFLIGHT_LIST,
          to: `${PREFLIGHT_LIST}\n  const connectionBefore = new Map<string, string>();`
        },
        {
          file: MACHINE,
          from: CONNECTION_WRITE,
          to: reaskOnRetry('`${reqIdBase}-b`')
        }
      ]
    },
    {
      id: 'C4-both-recovering-states-counted-as-gone',
      arm: 'CS2',
      describe:
        'a socket waiting to retry and one retrying are both classified terminal — the two entries above in one edit, the one `A5-C15` carries',
      edits: [
        {
          file: REFUSAL,
          from: RECOVERING_CASES,
          to: "    case 'connecting':\n      return 'recovering';\n    case 'waiting-for-retrying':\n    case 'retrying':\n      return 'terminal';"
        }
      ]
    },
    {
      id: 'C5-a-relay-outside-the-target-set-joins-the-leg',
      arm: 'CS3',
      describe:
        "the tables' one write has no membership test, so a relay added to the transport after the request began joins both of the request's tables when it is first heard of — its `CLOSED` is then read as a refusal of the request, and the leg's end names it beside the relay the request was asking",
      edits: [
        {
          file: MACHINE,
          from: MEMBERSHIP,
          to: '      const current = phases.get(url) ?? initial;\n'
        }
      ]
    },
    {
      id: 'C5-the-leg-judged-over-the-transports-relays',
      arm: 'CS3',
      describe:
        "the all-terminal check reads the transport's relays at judgement time rather than the target set fixed when the request started — the defect `RF9` was written against",
      edits: [
        {
          file: MACHINE,
          from: ALL_TERMINAL,
          to: "    if (\n      Object.keys(transport.defaultRelays() ?? {}).every(\n        (each) => targets.get(each) === 'terminal'\n      )\n    ) {"
        }
      ]
    },
    {
      id: 'C5-the-connection-writer-judges-over-the-transports-relays',
      arm: 'CS3',
      describe:
        "the connection-state writer alone decides the leg's end over the transport's relays rather than the target set — the defect `RF9` was written against, on the ordinary route only — so a relay added behind the scope keeps the leg alive after the relay the request was asking drops",
      edits: [
        {
          file: MACHINE,
          from: CONNECTION_WRITE,
          to:
            "      if (live && targets.write(packet.from, phase) === 'terminal') {\n" +
            '        if (\n' +
            "          Object.keys(transport.defaultRelays() ?? {}).every((each) => targets.get(each) === 'terminal')\n" +
            '        )\n' +
            '          endForward(\n' +
            '            relayFailure(\n' +
            `    ${LEG_END_REASON}\n` +
            '            )\n' +
            '          );\n' +
            '      }'
        }
      ]
    },
    {
      id: 'C5-a-relay-outside-the-target-set-refuses',
      arm: 'CS3',
      describe:
        'the `CLOSED` handler has no membership test, so a relay the request never asked, naming its subscription, is published as refusing it',
      edits: [{ file: MACHINE, from: '      if (!targets.has(packet.from)) return;\n', to: '' }]
    },
    {
      id: 'C5-the-request-routed-by-the-transports-relays',
      arm: 'CS3',
      describe:
        "both legs are handed to the transport with no relays named, so they go wherever the transport's defaults say — and the dependency re-issues the live one to a relay added to them after the request began",
      edits: [{ file: MACHINE, from: ROUTE, to: '  const routeToTargets = undefined;' }]
    },
    {
      id: 'C6-dormant-treated-as-alive',
      arm: 'CS4',
      describe:
        "`dormant` is classified as recovering, so a relay's idle close leaves the leg open on a socket that has gone quiet",
      edits: [
        {
          file: REFUSAL,
          from: TERMINAL_CASES,
          to: "    case 'error':\n    case 'rejected':\n    case 'terminated':\n      return 'terminal';\n    case 'dormant':\n      return 'recovering';"
        }
      ]
    },
    {
      id: 'C6-dormant-unclassified',
      arm: 'CS4',
      describe:
        "only the line `case 'dormant':` deleted, so `dormant` falls to the classifier's `default`, which answers `undefined` — deciding nothing — and the connection-state handler returns without ending that relay. The `default` itself is the shipping one: it is what `initialized` reaches",
      edits: [
        {
          file: REFUSAL,
          from: TERMINAL_CASES,
          to: "    case 'error':\n    case 'rejected':\n    case 'terminated':\n      return 'terminal';"
        }
      ]
    },
    {
      id: 'C6-a-leg-end-drops-the-answer',
      arm: 'CS4',
      describe:
        "recording a forward leg's end empties the answer it had, so a request whose relays went idle shows nothing of what it was told",
      edits: [
        {
          file: EVENTSET,
          from: FORWARD_END_RECORD,
          to: '  return {\n    ...set,\n    entries: new Map(),\n    forward: { ...forward, end: Object.freeze(end) }\n  };'
        }
      ]
    },
    {
      id: 'C6-the-leg-ends-on-the-first-idle-relay',
      arm: 'CS4',
      describe:
        'the leg ends when any relay of the target set is terminal, so the first relay to idle ends it while the other is still up',
      edits: [
        {
          file: MACHINE,
          from: ALL_TERMINAL,
          to: "    if ([...targets.values()].some((each) => each === 'terminal')) {"
        }
      ]
    },
    {
      id: 'C6-a-leg-end-forgets-the-settled-backlog',
      arm: 'CS4',
      describe:
        "ending the forward leg drops the backlog's record with it, so an answer that had settled reads as `streaming` once its relay idles — the events are kept, their completeness is not",
      edits: [
        {
          file: EVENTSET,
          from: FORWARD_END_RECORD,
          to: '  return { ...set, backlog: undefined, forward: { ...forward, end: Object.freeze(end) } };'
        }
      ]
    },
    {
      id: 'C6-the-unfinished-backlog-ends-for-the-wrong-cause',
      arm: 'CS4',
      describe:
        "a backlog its relays' idle closes left unfinished is published incomplete for `timeout` rather than `ended` — the status and the events as they were, the cause another one",
      edits: [
        {
          file: MACHINE,
          from: "    if (gone.length > 0) present.add('ended');",
          to: "    if (gone.length > 0) present.add('timeout');"
        }
      ]
    },
    {
      id: 'C6-the-recovery-reuses-the-dead-attempts-names',
      arm: 'CS4',
      describe:
        "every attempt's subscriptions are named by the request alone, so `refresh()` after the idle close asks under the names of the attempt that died — a re-subscribe rather than a new attempt",
      edits: [{ file: STREAM, from: ATTEMPT_NAME, to: '      reqIdBase,' }]
    },
    {
      id: 'C25-initialized-recovering',
      arm: 'CS5',
      describe: '`initialized` is classified as recovering rather than as deciding nothing',
      edits: [
        {
          file: REFUSAL,
          from: RECOVERING_CASES,
          to: "    case 'initialized':\n    case 'connecting':\n    case 'waiting-for-retrying':\n    case 'retrying':\n      return 'recovering';"
        }
      ]
    },
    {
      id: 'C25-connecting-active',
      arm: 'CS5',
      describe: '`connecting` is classified as active rather than recovering',
      edits: [
        {
          file: REFUSAL,
          from: RECOVERING_CASES,
          to: "    case 'connecting':\n      return 'active';\n    case 'waiting-for-retrying':\n    case 'retrying':\n      return 'recovering';"
        }
      ]
    },
    {
      id: 'C25-connected-recovering',
      arm: 'CS5',
      describe: '`connected` is classified as recovering rather than active',
      edits: [
        {
          file: REFUSAL,
          from: "    case 'connected':\n      return 'active';",
          to: "    case 'connected':\n      return 'recovering';"
        }
      ]
    },
    {
      id: 'C25-dormant-recovering',
      arm: 'CS5',
      describe: '`dormant` is classified as recovering rather than terminal',
      edits: [
        {
          file: REFUSAL,
          from: TERMINAL_CASES,
          to: "    case 'error':\n    case 'rejected':\n    case 'terminated':\n      return 'terminal';\n    case 'dormant':\n      return 'recovering';"
        }
      ]
    },
    {
      id: 'C25-error-recovering',
      arm: 'CS5',
      describe: '`error` is classified as recovering rather than terminal',
      edits: [
        {
          file: REFUSAL,
          from: TERMINAL_CASES,
          to: "    case 'rejected':\n    case 'terminated':\n    case 'dormant':\n      return 'terminal';\n    case 'error':\n      return 'recovering';"
        }
      ]
    },
    {
      id: 'C25-waiting-for-retrying-unclassified',
      arm: 'CS5',
      describe: '`waiting-for-retrying` has no case, so the classifier answers nothing for it',
      edits: [
        {
          file: REFUSAL,
          from: RECOVERING_CASES,
          to: "    case 'connecting':\n    case 'retrying':\n      return 'recovering';"
        }
      ]
    },
    {
      id: 'C25-retrying-terminal',
      arm: 'CS5',
      describe: '`retrying` is classified as terminal rather than recovering',
      edits: [
        {
          file: REFUSAL,
          from: RECOVERING_CASES,
          to: "    case 'connecting':\n    case 'waiting-for-retrying':\n      return 'recovering';\n    case 'retrying':\n      return 'terminal';"
        }
      ]
    },
    {
      id: 'C25-rejected-recovering',
      arm: 'CS5',
      describe: '`rejected` is classified as recovering rather than terminal',
      edits: [
        {
          file: REFUSAL,
          from: TERMINAL_CASES,
          to: "    case 'error':\n    case 'terminated':\n    case 'dormant':\n      return 'terminal';\n    case 'rejected':\n      return 'recovering';"
        }
      ]
    },
    {
      id: 'C25-terminated-unclassified',
      arm: 'CS5',
      describe: '`terminated` has no case, so the classifier answers nothing for it',
      edits: [
        {
          file: REFUSAL,
          from: TERMINAL_CASES,
          to: "    case 'error':\n    case 'rejected':\n    case 'dormant':\n      return 'terminal';"
        }
      ]
    },
    {
      id: 'C7-an-exhausted-relay-asked-without-reopening',
      arm: 'CS6',
      describe:
        'a relay whose retries ran out is asked as it stands, so the attempt sends into a socket nothing re-opens',
      edits: [{ file: REFUSAL, from: REOPEN, to: '' }]
    },
    {
      id: 'C7-the-preflight-does-not-reopen',
      arm: 'CS6',
      describe:
        'the preflight decides to re-open a relay whose retries ran out and does not, so the attempt reaches nothing',
      edits: [{ file: MACHINE, from: '        transport.reconnect(url);\n', to: '' }]
    },
    {
      id: 'C8-the-relay-reopened-after-it-is-asked',
      arm: 'CS7',
      describe:
        'the preflight decides to re-open a relay whose retries ran out and does it only once both legs have been asked — which on the dependency still reaches the relay, since what was sent into `error` waits for the re-open',
      edits: [
        {
          file: MACHINE,
          from: PREFLIGHT_LIST,
          to: `${PREFLIGHT_LIST}\n  const reopenAfterAsking: string[] = [];`
        },
        {
          file: MACHINE,
          from: PREFLIGHT_REOPEN,
          to: "      case 'reconnect-then-ask':\n        reopenAfterAsking.push(url);\n        break;"
        },
        {
          file: MACHINE,
          from: BOTH_LEGS_ASKED,
          to: `${BOTH_LEGS_ASKED}\n  for (const url of reopenAfterAsking) transport.reconnect(url);`
        }
      ]
    },
    {
      id: 'C8-the-ask-waits-for-the-reopen',
      arm: 'CS7',
      describe:
        'the preflight starts the re-open of a relay whose retries ran out and then waits for the socket to open before either leg is asked — the same calls in the same order, made once the connection is `connected`',
      edits: [
        {
          file: MACHINE,
          from: PREFLIGHT_REOPEN,
          to:
            "      case 'reconnect-then-ask':\n        transport.reconnect(url);\n" +
            '        await new Promise<void>((resolve) => {\n' +
            '          const opened = transport.connectionState()?.subscribe((packet) => {\n' +
            "            if (packet.from === url && packet.state === 'connected') {\n" +
            '              opened?.unsubscribe();\n' +
            '              resolve();\n' +
            '            }\n' +
            '          });\n' +
            '        });\n' +
            '        break;'
        }
      ]
    },
    {
      id: 'C7-an-exhausted-relay-given-up',
      arm: 'CS6',
      describe:
        'the preflight gives up on a relay whose retries ran out as it does on one that refused, so `refresh()` reports it gone instead of asking it',
      edits: [
        {
          file: REFUSAL,
          from: "    case 'error':\n      return 'reconnect-then-ask';\n    case 'rejected':\n      return 'give-up';",
          to: "    case 'error':\n    case 'rejected':\n      return 'give-up';"
        }
      ]
    },
    {
      id: 'C8-error-asked-without-reopening',
      arm: 'CS7',
      describe: '`error` is asked as it stands rather than re-opened first',
      edits: [{ file: REFUSAL, from: REOPEN, to: '' }]
    },
    {
      id: 'C8-rejected-reopened',
      arm: 'CS7',
      describe:
        '`rejected` is re-opened and asked, arguing with a relay that refused the connection',
      edits: [
        {
          file: REFUSAL,
          from: GIVE_UP,
          to: "    case 'rejected':\n      return 'reconnect-then-ask';"
        }
      ]
    },
    {
      id: 'C8-terminated-given-up',
      arm: 'CS7',
      describe:
        '`terminated` is given up on like a refusal, so the attempt reports the relay gone rather than failing',
      edits: [
        {
          file: REFUSAL,
          from: DISPOSED,
          to: "    case 'terminated':\n      return 'give-up';"
        }
      ]
    },
    {
      id: 'C8-dormant-reopened',
      arm: 'CS7',
      describe:
        '`dormant` is decided as `error` is, re-open then ask, rather than asked as it stands — on the dependency the same wire, since `reconnect()` acts only on `error` and `rejected`, so only the decision itself shows it',
      edits: [
        {
          file: REFUSAL,
          from: REOPEN,
          to: "    case 'error':\n    case 'dormant':\n      return 'reconnect-then-ask';\n"
        }
      ]
    },
    {
      id: 'C8-dormant-given-up',
      arm: 'CS7',
      describe:
        '`dormant` is given up on like a refusal — the mapping 0002 warns refuses every refresh after a pause',
      edits: [
        {
          file: REFUSAL,
          from: GIVE_UP,
          to: "    case 'dormant':\n    case 'rejected':\n      return 'give-up';"
        }
      ]
    },
    {
      id: 'C8-dormant-fails-the-attempt',
      arm: 'CS7',
      describe: '`dormant` fails the attempt as a disposed client does',
      edits: [
        {
          file: REFUSAL,
          from: DISPOSED,
          to: "    case 'dormant':\n    case 'terminated':\n      return 'disposed';"
        }
      ]
    },
    {
      id: 'C8-the-preflight-gives-up-on-dormant',
      arm: 'CS7',
      describe:
        'the preflight gives up on a `dormant` relay before it consults the classifier, which still answers `ask` for it — so the table is right and an attempt after a pause is refused',
      edits: [
        {
          file: MACHINE,
          from: PREFLIGHT_SWITCH,
          to: "    switch (\n      status[url]?.connection === 'dormant'\n        ? 'give-up'\n        : approachFor(status[url]?.connection ?? 'initialized')\n    ) {"
        }
      ]
    },
    {
      id: 'C8-a-disposed-connection-recorded-as-gone',
      arm: 'CS7',
      describe:
        'the preflight records a terminated connection as a relay that is gone instead of failing the attempt',
      edits: [
        {
          file: MACHINE,
          from: "      case 'disposed':\n        throw ownedByLibrary(\n          new InvalidDescriptorError(\n            'rxNostr',\n            `could not be used — the connection to ${url} is terminated`\n          )\n        );",
          to: "      case 'disposed':\n        preflightTerminal.push(url);\n        break;"
        }
      ]
    },
    {
      id: 'C20-the-leg-end-names-no-relay',
      arm: 'CS8',
      describe:
        'the leg end says every relay stopped and names none of them, so nothing says the relay that came back was one',
      edits: [
        {
          file: MACHINE,
          from: LEG_END_REASON,
          to: "          'every relay in scope stopped the live request'"
        }
      ]
    },
    {
      id: 'C20-the-leg-end-names-the-last-relay',
      arm: 'CS8',
      describe:
        'the leg end names the relay whose death ended it, so the relay that stopped first and came back is not named',
      edits: [
        {
          file: MACHINE,
          from: LEG_END_REASON,
          to: '          `every relay in scope stopped the live request: ${url}`'
        }
      ]
    },
    {
      id: 'C20-the-absorbing-rule-deleted',
      arm: 'CS8',
      describe:
        "the tables' one write takes the last write, so a relay recorded terminal that comes back is alive again and the leg never sees every relay terminal",
      edits: [
        {
          file: MACHINE,
          from: ABSORBING,
          to: '      const next = incoming;\n'
        }
      ]
    },
    {
      id: 'C20-the-connection-coming-back-revives-a-relay',
      arm: 'CS8',
      describe:
        'the connection-state channel writes `active` past the absorbing rule, through a setter put back beside the one write, so a socket opening again takes a terminal relay back out',
      edits: [
        ...SETTER_BESIDE_THE_WRITE,
        {
          file: MACHINE,
          from: CONNECTION_WRITE,
          to: "      if (live) {\n        if (phase === 'active' && targets.has(packet.from)) targets.set(packet.from, phase);\n        else advance(packet.from, phase);\n      }"
        }
      ]
    },
    {
      id: 'C20-a-re-sent-subscription-revives-a-relay',
      arm: 'CS8',
      describe:
        'the outgoing-REQ channel writes `active` past the absorbing rule, through a setter put back beside the one write, so the dependency re-sending the live subscription after a retry takes a terminal relay back out',
      edits: [
        ...SETTER_BESIDE_THE_WRITE,
        {
          file: MACHINE,
          from: OUTGOING_WRITE,
          to: "      if (leg === 'forward' && targets.has(packet.to)) targets.set(packet.to, 'active');"
        }
      ]
    },
    {
      id: 'C20-absorbing-only-from-pending-or-active',
      arm: 'CS8',
      describe:
        'the absorbing rule holds only for a relay that reached `terminal` from `pending` or `active` — the reading 0002 records as wrong, which absorbs nothing on the ordinary death through recovery',
      edits: absorbingOnlyWhen('!reachedFromRecovery.has(url)')
    },
    {
      id: 'C20-absorbing-only-from-recovering',
      arm: 'CS8',
      describe:
        "the absorbing rule's mirror: held only for a relay that reached `terminal` through recovery, so one that went there directly is revived",
      edits: absorbingOnlyWhen('reachedFromRecovery.has(url)')
    }
  ]
} satisfies Ledger;
