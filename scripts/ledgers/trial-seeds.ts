/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The seeded defects of the phase 2 trial, kept as regressions
 * (`docs/process/phase-2-trial.md`, "How the trial is checked"). An outside
 * reviewer wrote `S1`–`S7` and `K1`–`K3` against `88692fc` before reading any
 * test, and the trial record holds what caught each there. `TIE` is the edit an
 * outside reviewer wrote against the replacement arm's plan, which passed the
 * eight cases at strictly different `created_at` and failed four of the eight
 * at an equal one; it is also
 * `b5-replacement`'s `C2-the-incumbent-kept-at-an-equal-created-at`. After G1,
 * an outside reviewer who had read no test and no ledger wrote `F1`–`F5`
 * against G1's promises and `H1`–`H5` against G2's, at `59fee0b`.
 *
 * Each entry is the seed as it was run after G1, the older ones ported to that
 * tree with the same lines changed, and the arm it names is one that catches
 * it at the commit that added this ledger: the landing of a `public` row where
 * one does, since that is a consumer assertion under the trial's rule. `S7` is
 * caught by `WB1` alone and `H5` by internal arms alone, and `H3` only by arms
 * on no roster line. `F2` was caught only below the hook until `RP1` read the
 * kinds where a class that replaces begins or ends. The trial
 * record says which other arms caught each. Later rounds add their seeds here
 * once their killers have landed.
 */
import type { Ledger } from '../ledger.ts';

const EVENTSET = 'src/lib/v1/eventset.ts';
const MACHINE = 'src/lib/v1/machine.ts';
const HOOK = 'src/lib/v1/useStreamedReq.svelte.ts';
const REQ = 'src/lib/v1/req.svelte.ts';

/** The hook's fold of an event chunk, the last thing `collect` does. */
const EVENT_FOLD = '  return retainNewest(foldEvent(base, chunk.packet), options);\n}';

export default {
  name: 'trial-seeds',
  subject:
    "the phase 2 trial's seeded defects, `S1`–`S7`, `K1`–`K3`, `TIE`, `F1`–`F5` and `H1`–`H5`, each held to an arm that catches it",
  files: [
    'src/tests/contracts/admission.test.ts',
    'src/tests/contracts/engine/boundary.test.ts',
    'src/tests/contracts/engine/connection.test.ts',
    'src/tests/contracts/engine/determined.test.ts',
    'src/tests/contracts/engine/forward.test.ts',
    'src/tests/contracts/engine/identity.test.ts',
    'src/tests/contracts/engine/reach.test.ts',
    'src/tests/contracts/engine/refused.test.ts',
    'src/tests/contracts/engine/release.test.ts',
    'src/tests/contracts/engine/replacement.test.ts',
    'src/tests/contracts/engine/settle.test.ts',
    'src/tests/contracts/engine/written.test.ts',
    'src/tests/contracts/scope.test.ts'
  ],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up",
    seconds: {
      AH1: 7.5,
      CS4: 3.5,
      CW3: 8.2,
      DT1: 4.4,
      ES19: 3.5,
      FL1: 3.9,
      RJ2: 4.4,
      RJ5: 4.1,
      RL1: 8.9,
      RP1: 4.5,
      RS4: 7.6,
      RX8: 3.8,
      ST1: 14.3,
      WB1: 9.0
    }
  },
  entries: [
    {
      id: 'S1',
      arm: 'RP1',
      describe:
        'receive and display: the `created_at` comparison in `laterWins` reversed, so the older revision of a coordinate wins',
      edits: [
        {
          file: EVENTSET,
          from: '  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;',
          to: '  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? a : b;'
        }
      ]
    },
    {
      id: 'S2',
      arm: 'FL1',
      describe:
        'receive and display: a forward event dropped until the backlog has settled, so what arrives live while it runs is lost',
      edits: [
        {
          file: MACHINE,
          from: '  const admitEvent = (leg: LegName, incoming: EventPacket) => {\n',
          to: "  const admitEvent = (leg: LegName, incoming: EventPacket) => {\n    if (leg === 'forward' && !settled) return;\n"
        }
      ]
    },
    {
      id: 'S3',
      arm: 'FL1',
      describe:
        'receive and display: the subtraction in `byRecency` reversed, so the list is oldest first',
      edits: [
        {
          file: EVENTSET,
          from: '  if (a.event.created_at !== b.event.created_at) return b.event.created_at - a.event.created_at;',
          to: '  if (a.event.created_at !== b.event.created_at) return a.event.created_at - b.event.created_at;'
        }
      ]
    },
    {
      id: 'S4',
      arm: 'RS4',
      describe:
        "how a request ends: any leg's `EOSE` taken as the backlog's, so a forward `EOSE` settles a live request early",
      edits: [
        {
          file: MACHINE,
          from: "        if (legOf(packet.subId) === 'backward') advanceBackward(packet.from, 'complete');",
          to: "        if (legOf(packet.subId) !== undefined) advanceBackward(packet.from, 'complete');"
        }
      ]
    },
    {
      id: 'S5',
      arm: 'CS4',
      describe:
        "how a request ends: the backlog settles when some target is determined rather than every one, so one relay's refusal discards another's answer",
      edits: [
        {
          file: MACHINE,
          from: '    if ([...backwardTargets.values()].every((each) => DETERMINED.has(each))) settle(false);',
          to: '    if ([...backwardTargets.values()].some((each) => DETERMINED.has(each))) settle(false);'
        }
      ]
    },
    {
      id: 'S6',
      arm: 'AH1',
      describe:
        'the admission boundary: the verifier checks the signature over the hash and never compares the hash with `id`',
      edits: [
        {
          file: 'src/lib/v1/verify.ts',
          from: '    return hash === event.id && schnorr.verify(event.sig, hash, event.pubkey);',
          to: '    return schnorr.verify(event.sig, hash, event.pubkey);'
        }
      ]
    },
    {
      id: 'S7',
      arm: 'WB1',
      describe:
        "the admission boundary: a published event's tags frozen without each tag, so a tag can be written",
      edits: [
        {
          file: 'src/lib/v1/event.ts',
          from: '    tags: Object.freeze(tags.map((tag) => Object.freeze(tag))),',
          to: '    tags: Object.freeze(tags),'
        }
      ]
    },
    {
      id: 'K1',
      arm: 'RP1',
      describe:
        'receive and display (#193): `collect` returns what it held when a fold leaves the entry count unchanged, so a replacement is lost',
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
      id: 'K2',
      arm: 'ST1',
      describe: "how a request ends (#179): the settle timer fires at 0.8 of the caller's timeout",
      edits: [
        {
          file: MACHINE,
          from: '    timer = setTimeout(() => settle(true), timeoutMs);',
          to: '    timer = setTimeout(() => settle(true), timeoutMs * 0.8);'
        }
      ]
    },
    {
      id: 'K3',
      arm: 'RJ5',
      describe:
        'how a request ends (#186): a `CLOSED` naming the forward leg of a request that is not live is acted on, for a leg never opened',
      edits: [{ file: MACHINE, from: "      if (leg === 'forward' && !live) return;\n", to: '' }]
    },
    {
      id: 'TIE',
      arm: 'RP1',
      describe:
        'receive and display: the hook keeps the revision it holds when another arrives at the same `created_at`, so the tie goes to whichever arrived first',
      edits: [
        {
          file: HOOK,
          from: "  retainNewest\n} from './eventset.js';",
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
      id: 'F1',
      arm: 'RP1',
      describe:
        'receive and display: an addressable coordinate keyed by kind and author without its `d`, so two articles of one author replace each other',
      edits: [
        {
          file: EVENTSET,
          from: "\nfunction identifierOf({ tags }: ReqEvent): string {\n  return tags.find(([name]) => name === 'd')?.[1] ?? '';\n}\n",
          to: ''
        },
        {
          file: EVENTSET,
          from: '      return `${event.kind}:${event.pubkey}:${identifierOf(event)}`;',
          to: '      return `${event.kind}:${event.pubkey}`;'
        }
      ]
    },
    {
      id: 'F2',
      arm: 'RP1',
      describe:
        'receive and display: the replaceable range beginning one past 10000, so two revisions at kind 10000 are both held',
      edits: [
        {
          file: EVENTSET,
          from: "  if (kind >= 10000 && kind < 20000) return 'replaceable';",
          to: "  if (kind > 10000 && kind < 20000) return 'replaceable';"
        }
      ]
    },
    {
      id: 'F3',
      arm: 'RJ2',
      describe:
        "how a request ends: a `CLOSED` on the backward leg taken as the forward leg's as well, so it ends a live request",
      edits: [
        {
          file: MACHINE,
          from: "      if (leg === 'backward') advanceBackward(packet.from, 'refused');\n      if (leg !== 'forward') return;\n",
          to: "      if (leg === 'backward') advanceBackward(packet.from, 'refused');\n"
        }
      ]
    },
    {
      id: 'F4',
      arm: 'DT1',
      describe:
        "how a request ends: a relay's refusal counted among the causes as the request having ended, so an answer a relay refused does not say so",
      edits: [
        {
          file: MACHINE,
          from: "      else if (phase === 'refused') present.add('refused');",
          to: "      else if (phase === 'refused') present.add('ended');"
        }
      ]
    },
    {
      id: 'F5',
      arm: 'RS4',
      describe:
        "how a request ends: the settle timer cleared at one relay's backlog `EOSE`, so a relay that never answers keeps the backlog waiting past its deadline",
      edits: [
        {
          file: MACHINE,
          from: "        if (legOf(packet.subId) === 'backward') advanceBackward(packet.from, 'complete');",
          to:
            "        if (legOf(packet.subId) === 'backward') {\n" +
            '          if (timer !== undefined) clearTimeout(timer);\n' +
            "          advanceBackward(packet.from, 'complete');\n" +
            '        }'
        }
      ]
    },
    {
      id: 'H1',
      arm: 'CW3',
      describe:
        'change a descriptor: `useReq` reads its plan once and keeps it, so a changed plan is never followed',
      edits: [
        {
          file: REQ,
          from: 'export function useReq(plan: () => ReqPlan): ReqHandle {\n',
          to: 'export function useReq(plan: () => ReqPlan): ReqHandle {\n  let snapshot: ReqPlan | undefined;\n'
        },
        {
          file: REQ,
          from: '      const current = plan();',
          to: '      const current = (snapshot ??= plan());'
        }
      ]
    },
    {
      id: 'H2',
      arm: 'CS4',
      describe:
        "refresh: an attempt's subscription ids made without its attempt, so a refresh reuses the ids of the attempt before it",
      edits: [
        {
          file: 'src/lib/v1/stream.ts',
          from: '      reqIdBase: `${reqIdBase}-${attemptId}`,',
          to: '      reqIdBase,'
        }
      ]
    },
    {
      id: 'H3',
      arm: 'ES19',
      describe:
        'change a descriptor: a new attempt keeps the forward leg of the attempt before it, its end and refusals included',
      edits: [
        {
          file: EVENTSET,
          from: '    forward: { attemptId, end: undefined, refusals: [] }\n  };',
          to: '    forward: set.forward ?? { attemptId, end: undefined, refusals: [] }\n  };'
        }
      ]
    },
    {
      id: 'H4',
      arm: 'RL1',
      describe:
        "unmount: the query's abort signal left unconsumed by default, so an unmounted consumer's request is not cancelled",
      edits: [
        { file: HOOK, from: '      consumeSignal = true,', to: '      consumeSignal = false,' }
      ]
    },
    {
      id: 'H5',
      arm: 'RX8',
      describe:
        "unmount: the provider's query client not cleared when the provider goes, so its cache outlives `NostrApp`",
      edits: [
        {
          file: 'src/lib/v1/client.svelte.ts',
          from: '      client.unmount();\n      client.clear();\n',
          to: '      client.unmount();\n'
        }
      ]
    }
  ]
} satisfies Ledger;
