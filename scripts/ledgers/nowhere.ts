/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The mutation ledger of where a request cannot be asked, and its landings:
 * - `B-γ-C1` on `NW1`: a request with no readable relay is not asked, and one
 *   whose every filter matches nothing is answered anyway;
 * - `C3-C2` on `NW2`: a request naming a relay the provider does not read
 *   from is refused before the wire, whether it named it so from the start or
 *   the provider moved under it.
 *
 * An id begins with the row it is read against, `C1-` for `B-γ-C1` and `C2-`
 * for `C3-C2`. The first `C1-` entry is the order the row records an earlier
 * `planRequest` reading its guards in. The last `C2-` entry is a hook that
 * reads its provider's scope once, at mount: only the two arrangements in
 * which the provider moves can tell it apart.
 */
import type { Ledger } from '../ledger.ts';

const STREAM = 'src/lib/v1/stream.ts';
const SCOPE = 'src/lib/v1/scope.svelte.ts';
const HOOK = 'src/lib/v1/useStreamedReq.svelte.ts';
const ENGINE = 'src/lib/v1/engine.ts';

/** Where a named relay the provider cannot read from is refused. */
const REFUSAL =
  'new RelayNotInScopeError(resolution.name, resolution.relay !== undefined, scope.urls)';

export default {
  name: 'nowhere',
  subject:
    '`B-γ-C1` (a request with no readable relay is not asked; one whose every filter matches nothing is answered) and `C3-C2` (a request naming a relay the provider does not read from is refused before the wire): their landings, `NW1` and `NW2`',
  files: ['src/tests/contracts/nowhere.test.ts'],
  calibration: {
    measured:
      "one run of each arm's duration in a single Vitest run at the commit that added this ledger, plus 3.5 s for a run's start-up; one worker, on a shared 10-core machine",
    seconds: { NW1: 10, NW2: 8 }
  },
  entries: [
    {
      id: 'C1-the-relay-count-read-first',
      arm: 'NW1',
      describe:
        'the relay count is read before the filters, so a request that can only match nothing, with nowhere to ask, waits to be asked instead of being answered',
      edits: [
        {
          file: STREAM,
          from: "  if (filters.length === 0) return 'empty';\n  if (!filters.some(isSatisfiable)) return 'empty';",
          to: "  if (readable === 0) return 'defer';\n  if (filters.length === 0) return 'empty';\n  if (!filters.some(isSatisfiable)) return 'empty';"
        }
      ]
    },
    {
      id: 'C1-a-write-only-relay-counts-as-readable',
      arm: 'NW1',
      describe:
        'the scope counts a write-only relay among those it reads from, so a request whose only relay is write-only is asked there',
      edits: [
        {
          file: SCOPE,
          from: '  const urls = Object.freeze(relays.filter((relay) => relay.read).map((relay) => relay.url));',
          to: '  const urls = Object.freeze(relays.map((relay) => relay.url));'
        }
      ]
    },
    {
      id: 'C1-nowhere-to-ask-reports-nothing-found',
      arm: 'NW1',
      describe:
        'a request with no readable relay is answered `settled` and empty, as though every filter matched nothing',
      edits: [
        {
          file: STREAM,
          from: "  if (readable === 0) return 'defer';",
          to: "  if (readable === 0) return 'empty';"
        }
      ]
    },
    {
      id: 'C1-refresh-names-the-wrong-reason',
      arm: 'NW1',
      describe:
        '`refresh()` on a request with no readable relay resolves `not-started` under `deferred` rather than `no-readable-relay`',
      edits: [
        {
          file: HOOK,
          from: "        return Object.freeze({ kind: 'not-started', reason: 'no-readable-relay' } as const);",
          to: "        return Object.freeze({ kind: 'not-started', reason: 'deferred' } as const);"
        }
      ]
    },
    {
      id: 'C1-a-request-with-nowhere-to-ask-runs',
      arm: 'NW1',
      describe:
        'a request with no readable relay is not held back, so it runs with nowhere to ask and its timer reports it `incomplete`',
      edits: [
        {
          file: HOOK,
          from: "      ...(plan === 'defer' ? { enabled: false } : {}),",
          to: '      ...({}),'
        }
      ]
    },
    {
      id: 'C2-an-unreadable-target-is-dropped',
      arm: 'NW2',
      describe:
        'a named relay the provider cannot read from is dropped from the targets instead of refused, so the request waits with nowhere to ask',
      edits: [
        {
          file: SCOPE,
          from: `      if (resolution.relay === undefined || !resolution.relay.read) {\n        throw ownedByLibrary(\n          ${REFUSAL}\n        );\n      }`,
          to: '      if (resolution.relay === undefined || !resolution.relay.read) {\n        continue;\n      }'
        }
      ]
    },
    {
      id: 'C2-configured-never-said',
      arm: 'NW2',
      describe: 'the refusal says the relay is not configured, whether or not the provider has it',
      edits: [
        {
          file: SCOPE,
          from: REFUSAL,
          to: 'new RelayNotInScopeError(resolution.name, false, scope.urls)'
        }
      ]
    },
    {
      id: 'C2-a-write-only-target-is-asked',
      arm: 'NW2',
      describe: 'a named relay the provider has as write-only is accepted as a target, and asked',
      edits: [
        {
          file: SCOPE,
          from: '      if (resolution.relay === undefined || !resolution.relay.read) {',
          to: '      if (resolution.relay === undefined) {'
        }
      ]
    },
    {
      id: 'C2-refresh-resolves-a-refused-request',
      arm: 'NW2',
      describe:
        '`refresh()` on a refused request resolves `not-started` instead of rejecting with the refusal',
      edits: [
        {
          file: HOOK,
          from: '      // mechanism for one claim is the rule the rest of this file follows.\n      if (rejection !== undefined) throw rejection;',
          to: "      // mechanism for one claim is the rule the rest of this file follows.\n      if (rejection !== undefined) return Object.freeze({ kind: 'not-started', reason: 'deferred' } as const);"
        }
      ]
    },
    {
      id: 'C2-the-diagnostics-carry-no-refusal',
      arm: 'NW2',
      describe: "`lastError` does not carry the refusal the request's state does",
      edits: [
        {
          file: ENGINE,
          from: '      data?.failure?.error ??\n      entryError ??\n',
          to: '      data?.failure?.error ??\n'
        }
      ]
    },
    {
      id: 'C2-the-scope-read-at-mount',
      arm: 'NW2',
      describe:
        "the hook reads its provider's scope once, at mount, so a named relay that later leaves the provider, or becomes write-only there, is still asked",
      edits: [
        {
          file: HOOK,
          from: '          scopeOf: () => inputs.scope,',
          to: '          scopeOf: (\n            (first) => () =>\n              first\n          )(inputs.scope),'
        }
      ]
    }
  ]
} satisfies Ledger;
