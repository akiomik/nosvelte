/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Which failure code reaches which surface, and the types a consumer compiles
 * against: `B5-C10`'s landing, `RA1`, and the spike's witnesses beside it.
 *
 * `RA1` holds every clause of the row in one arm. The type half is asked of the
 * declarations a consumer compiles against — emitted in memory, with the
 * library's source withheld ({@link againstEmitted}) — and each surface's set
 * of codes is read off the one declaration the runtime half is checked
 * against ({@link INHERITED}), so the compile matrix and the reachability
 * matrix cannot be two hand-written lists. The runtime half drives every row's
 * path itself and reads every surface each time, so a cell is held by an
 * observation of exactly that code there, and an empty cell by the same
 * observation not carrying it.
 *
 * Port band 9100-9139 (`RA1`) and 9250-9289 (the supporting arms).
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { RxNostr } from 'rx-nostr';
import { createRxForwardReq } from 'rx-nostr';
import { QueryClient } from 'tanstack-svelte-query-v6';
import ts from 'typescript';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { StreamAccumulator } from '$lib/v1/accumulate.js';
import { createAttemptRegistry } from '$lib/v1/attempt.js';
import { createNostrContext, setNostrContext } from '$lib/v1/context.svelte.js';
import { deriveOutlet, type ReqState } from '$lib/v1/engine.js';
import { captureFromRelay, recordedFailure, terminalFailure } from '$lib/v1/own.js';
import { isOwnedByLibrary } from '$lib/v1/owned.js';
import { DOOR_OF, REQ_ERROR_CODES, type ReqError, type ReqErrorCode } from '$lib/v1/reqerror.js';
import type { TransportKeys } from '$lib/v1/scope.svelte.js';
import { MAIN_SURFACE } from '$lib/v1/surface.js';
import { useStreamedReq } from '$lib/v1/useStreamedReq.svelte.js';

import { propsTypeOf } from './helpers/components.js';
import { exportsOf } from './helpers/declarations.js';
import { againstEmitted } from './helpers/emitted.js';
import {
  cellsOf,
  codesAt,
  HELD_BY,
  INHERITED,
  recordedMatrix,
  ROW_ORDER,
  type Surface,
  SURFACES,
  WITNESSES
} from './helpers/reachability.js';
import {
  acceptAnyEvent,
  createTestRelay,
  HARNESS_DIVERGENCES,
  respondWithEose
} from './helpers/relay.js';
import { flush, mount } from './helpers/runes.svelte.js';

const ROOT = resolve(process.cwd());
const LIBRARY = resolve(ROOT, 'src/lib/v1');

const attempts = createAttemptRegistry();

let port = 9100;
const nextUrl = (): string => `ws://localhost:${(port += 1)}`;

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(() => {
  client.clear();
  WS.clean();
});

async function settle(ms = 80): Promise<void> {
  await new Promise((done) => setTimeout(done, ms));
  flush();
}

async function waitForReq(server: WS): Promise<string> {
  const message = (await server.nextMessage) as unknown[];
  return String(message[1]);
}

const codeOf = (value: unknown): unknown =>
  value === undefined || value === null ? undefined : (value as { code?: unknown }).code;

/** A settled `refresh()`, both arms of it. */
type Settled =
  | { readonly kind: 'resolved'; readonly outcome: unknown }
  | { readonly kind: 'rejected'; readonly reason: unknown };

const settledCall = (call: Promise<unknown>): Promise<Settled> =>
  call.then(
    (outcome) => ({ kind: 'resolved' as const, outcome }),
    (reason: unknown) => ({ kind: 'rejected' as const, reason })
  );

/** What an arm found at each surface it read; a surface it did not read is absent. */
type Observed = Partial<Record<Surface, unknown>>;

/**
 * Every surface, read off one handle, so the negative half is total. The two
 * `refresh()` surfaces are present only when the arm made a call: "undefined
 * because nobody asked" is not evidence that a code cannot get there.
 */
function observe(
  handle: {
    readonly state: ReqState;
    readonly diagnostics: { readonly lastError?: unknown; readonly legEnded?: unknown };
  },
  call?: Settled
): Observed {
  const state = handle.state as { status: string; error?: ReqError };
  const slot = deriveOutlet(handle.state) as { error?: ReqError };
  const ended = handle.diagnostics.legEnded as { kind?: string; error?: ReqError } | undefined;
  const [stateError, stateIncomplete, outcome, rejects, errorSlot, lastError, legEnd] = SURFACES;
  return {
    [stateError]: state.status === 'error' ? state.error : undefined,
    [stateIncomplete]: state.status === 'incomplete' ? state.error : undefined,
    [errorSlot]: slot.error,
    [lastError]: handle.diagnostics.lastError,
    [legEnd]: ended?.kind === 'ended' ? ended.error : undefined,
    ...(call === undefined
      ? {}
      : {
          [outcome]:
            call.kind === 'resolved' ? (call.outcome as { error?: ReqError }).error : undefined,
          [rejects]: call.kind === 'rejected' ? call.reason : undefined
        })
  };
}

/**
 * The arm this observation belongs to, taken from the runner rather than typed,
 * so a test cannot claim a cell by naming it.
 */
let arm = '';
const passed = new Set<string>();
const observedBy = new Map<string, Set<string>>();

beforeEach((context) => {
  const name = context.task.name.split(':')[0] as string;
  arm = name;
  context.onTestFinished((finished) => {
    if (finished.task.result?.state === 'pass') passed.add(name);
  });
});

/**
 * Read an observation back against one inherited witness's cells, as a list of
 * what is wrong with it — empty when it holds them:
 *
 * 1. the running arm is one {@link HELD_BY} lists for that witness;
 * 2. every surface the witness holds was read, carries **exactly** its code,
 *    and the value is this library's;
 * 3. every surface the code's **whole row** leaves empty, where read, does not
 *    carry it — two arms can split a row, and neither is the authority on the
 *    other's share;
 * 4. every code seen anywhere, the witness's or another, is one the record
 *    allows at that surface.
 */
function reaches(witness: string, observed: Observed): string[] {
  const wrong: string[] = [];
  if (!(HELD_BY[witness] ?? []).includes(arm))
    wrong.push(`${arm} is not an arm the record's ${witness} is held by`);
  const { code, surfaces } = cellsOf(witness);
  for (const surface of surfaces) {
    if (!Object.prototype.hasOwnProperty.call(observed, surface))
      wrong.push(`${witness}: ${surface} was not read`);
    else if (codeOf(observed[surface]) !== code)
      wrong.push(
        `${witness}: ${surface} carries ${String(codeOf(observed[surface]))}, not ${code}`
      );
    else if (!isOwnedByLibrary(observed[surface]))
      wrong.push(`${witness}: ${surface} carries a value this library did not mint`);
  }
  for (const surface of SURFACES) {
    if (!Object.prototype.hasOwnProperty.call(observed, surface)) continue;
    const seen = codeOf(observed[surface]);
    if (INHERITED[code][surface] === undefined && seen === code)
      wrong.push(`${witness}: ${surface} is an empty cell for ${code}, and carries it`);
    if (seen !== undefined && INHERITED[seen as ReqErrorCode]?.[surface] === undefined)
      wrong.push(`${witness}: ${String(seen)} at ${surface}, which the record calls empty`);
  }
  if (wrong.length === 0) {
    const mine = observedBy.get(arm) ?? new Set<string>();
    mine.add(witness);
    observedBy.set(arm, mine);
  }
  return wrong;
}

/** The witnesses `name` is listed for and has not observed. */
const unobserved = (name: string): string[] =>
  Object.entries(HELD_BY)
    .filter(([, arms]) => arms.includes(name))
    .map(([witness]) => witness)
    .filter((witness) => !(observedBy.get(name)?.has(witness) ?? false));

afterAll(() => {
  // **Every witness an arm is listed for, observed by it**, for every arm that
  // passed: one arm holds thirteen witnesses, and one claim does not stand for
  // twelve the arm never drove.
  const missing = [...passed].flatMap((name) =>
    unobserved(name).map((witness) => `${name} never observed ${witness}`)
  );
  expect(missing, 'an arm that passed without driving a witness it is listed for').toEqual([]);
});

/** The six surfaces a consumer holds a type for, by the alias the entry exports for each. */
const ALIASES: Readonly<Partial<Record<Surface, string>>> = {
  [SURFACES[0]]: 'ReqStateError',
  [SURFACES[1]]: 'IncompleteError',
  [SURFACES[2]]: 'RefreshOutcomeError',
  [SURFACES[4]]: 'ReqOutletError',
  [SURFACES[5]]: 'ReqLastError',
  [SURFACES[6]]: 'RelayLegError'
};

/**
 * Each class this library owns and the `code` a consumer reads off it: a
 * literal, or one of the two unions the row names, which follow the class
 * family rather than the class.
 */
const CLASS_CODES: Readonly<Record<string, string>> = {
  MissingRandomnessError: '"missing-randomness"',
  AttemptAbandonedError: '"attempt-abandoned"',
  AccumulatorContractError: '"accumulator-contract"',
  MissingProviderError: '"missing-provider"',
  MissingVerifierError: '"missing-verifier"',
  IncompleteResultError: '"incomplete-result"',
  UnsupportedFilterError: '"unsupported-filter"',
  InvalidDescriptorError: '"invalid-descriptor"',
  RelayNotInScopeError: '"relay-not-in-scope"',
  RequestTransportIncompatibleError: '"transport-incompatible"',
  ProviderDisposedError: '"provider-disposed"',
  ReqFailure: 'FailureCode',
  RelayConfigurationError: 'RelayConfigurationErrorCode',
  InvalidRelayScopeError: 'RelayConfigurationErrorCode',
  InvalidRelayInputError: 'RelayConfigurationErrorCode',
  NonIdempotentRelayUrlError: 'RelayConfigurationErrorCode',
  TransportIncompatibleError: 'RelayConfigurationErrorCode',
  TransportKeyMismatchError: 'RelayConfigurationErrorCode'
};

/** What the published entry gives out as values, by the name a consumer imports. */
const PUBLISHED_VALUES = [
  'IncompleteResultError',
  'MissingProviderError',
  'MissingRandomnessError',
  'RelayConfigurationError'
];

describe('which failure code reaches which surface, and what a consumer compiles against it', () => {
  // @contracts B5-C10
  it(
    'RA1: every failure surface is typed as the set its paths produce, every code reaches exactly its cells, and a consumer branches on `code` and writes nothing',
    { timeout: 90_000 },
    async () => {
      const failures: string[] = [];

      // **(0) The instruments' controls.**
      await (async (): Promise<void> => {
        // The bridge: the wrong arm, a wrong code, a code at an empty cell,
        // and a code the record does not allow at a surface are each refused.
        const [stateError, , outcome, rejects, slot, lastError] = SURFACES;
        const right: Observed = {
          [stateError]: { code: 'unsupported-filter' },
          [rejects]: { code: 'unsupported-filter' },
          [slot]: { code: 'unsupported-filter' },
          [lastError]: { code: 'unsupported-filter' }
        };
        const was = arm;
        arm = 'RX3';
        const wrongArm = reaches('RM1', right);
        arm = was;
        expect(
          [
            wrongArm.some((line) => line.includes('is not an arm')),
            reaches('RM1', { ...right, [slot]: { code: 'invalid-descriptor' } }).some((line) =>
              line.includes('carries invalid-descriptor')
            ),
            reaches('RM1', { ...right, [outcome]: { code: 'unsupported-filter' } }).some((line) =>
              line.includes('empty cell')
            ),
            reaches('RM1', { ...right, [outcome]: { code: 'relay-failed' } }).some((line) =>
              line.includes('which the record calls empty')
            ),
            reaches('RM1', right).some((line) => line.includes('did not mint'))
          ],
          'the bridge refuses a borrowed arm, a wrong code, an empty cell carried, a code the record forbids, and a value nobody minted'
        ).toEqual([true, true, true, true, true]);
        observedBy.delete(arm);
        // The completeness reader: an arm that has driven nothing yet is
        // missing every witness it is listed for.
        expect(unobserved('RX3'), 'the completeness check sees an arm that drove nothing').toEqual([
          'RM3'
        ]);

        // The withholding: a consumer that reaches for the library's source is
        // reported, not compiled against it.
        const reaching = againstEmitted(
          "import type { ReqFailure } from '../src/lib/v1/own.js';\nexport type F = ReqFailure;\n"
        );
        expect(
          reaching.reachedSource.length > 0,
          'the emitted program withholds the source, and says when a consumer reached for it'
        ).toBe(true);

        // The export reader follows a renamed export to what it defines and
        // sees a guard however it is named; the population finds a class whose
        // base is an alias.
        const lookalikes = exportsOf('./helpers/fixtures/lookalikes.js');
        expect(
          [
            lookalikes.find(({ name }) => name === 'Snapshot')?.defines,
            lookalikes.find(({ name }) => name === 'recognises')?.guards
          ],
          'the export reader: a renamed snapshot class, and a guard under another name'
        ).toEqual(['ReqFailure', true]);
        expect(
          errorClassCodes([
            resolve(ROOT, 'src/tests/contracts/engine/helpers/fixtures/lookalikes.ts')
          ]).codes['AliasedBase'],
          'the population: an Error class whose base is spelled through an alias'
        ).toBe('"aliased"');
      })();

      // **(1) The channel's population**, one set read four ways: the matrix's
      // rows, the list the library keeps, and the emitted union read through
      // both of the names a consumer imports it by.
      const literalsOf = (checker: ts.TypeChecker, type: ts.Type): string[] =>
        (type.isUnion() ? type.types : [type])
          .map((one) => (one.isStringLiteral() ? one.value : `<${checker.typeToString(one)}>`))
          .sort();
      await (async (): Promise<void> => {
        const compiled = againstEmitted(
          [
            "import type { ReqError, ReqErrorCode } from './public-entry.js';",
            'export declare const fromUnion: ReqError["code"];',
            'export declare const fromAlias: ReqErrorCode;'
          ].join('\n')
        );
        const read = (name: string): string[] => {
          const statement = compiled.consumer.statements.find(
            (one) =>
              ts.isVariableStatement(one) &&
              one.declarationList.declarations[0]?.name.getText() === name
          ) as ts.VariableStatement | undefined;
          const declared = statement?.declarationList.declarations[0];
          return declared === undefined
            ? []
            : literalsOf(compiled.checker, compiled.checker.getTypeAtLocation(declared.name));
        };
        const population = [...REQ_ERROR_CODES].sort();
        expect(
          [
            new Set(REQ_ERROR_CODES).size === REQ_ERROR_CODES.length,
            [...ROW_ORDER].sort(),
            read('fromUnion'),
            read('fromAlias')
          ],
          'the matrix has a row for every code of the channel, and the emitted union and alias are that set'
        ).toEqual([true, population, population, population]);
        expect(
          ['attempt-abandoned', 'internal-failure'].filter((code) =>
            (population as string[]).includes(code)
          ),
          'and a code no path produces is not a member'
        ).toEqual([]);
        expect(compiled.diagnostics, 'the population probe compiles').toEqual([]);
      })();

      // **(2) The type half, against the emitted declarations.** One consumer,
      // a probe a line, each line's diagnostics compared to what it must
      // produce — nothing, or exactly one code — so a probe cannot be satisfied
      // by an error on another line.
      await (async (): Promise<void> => {
        const lines: string[] = [
          'import type { IncompleteCauses, IncompleteError, ReqDiagnostics, ReqError, ReqLastError, ReqOutletError, ReqState, ReqStateError, RefreshOutcome, RefreshOutcomeError, RelayLegError, LegEnd } from "./public-entry.js";',
          'import type { Outlets } from "./components/outlets.js";',
          'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;',
          'type Of<C extends ReqError["code"]> = Extract<ReqError, { readonly code: C }>;',
          'type ErrorOutletOf<P> = P extends { error?: infer S } ? (NonNullable<S> extends (...args: infer A) => unknown ? (A extends [infer First] ? (First extends { readonly error: infer E } ? E : "no error member") : "not one argument") : "not callable") : "no error outlet";',
          'type OutletChecked<P> = "error" extends keyof P ? Equal<ErrorOutletOf<P>, ReqOutletError> : true;',
          'export type Unused = [IncompleteCauses, IncompleteError, ReqDiagnostics, ReqLastError, ReqOutletError, ReqState, ReqStateError, RefreshOutcome, RefreshOutcomeError, RelayLegError, LegEnd, Outlets<object>, Of<"unspecified">];'
        ];
        const expected = new Map<number, { codes: number[]; label: string }>();
        const probe = (text: string, label: string, codes: number[] = []): void => {
          lines.push(text);
          expected.set(lines.length, { codes, label });
        };

        // Each surface alias takes exactly the codes its column holds.
        let at = 0;
        for (const surface of SURFACES) {
          const alias = ALIASES[surface];
          if (alias === undefined) continue;
          const holds = codesAt(surface);
          at += 1;
          probe(
            `export function exhaustive${String(at)}(code: ${alias}["code"]): number { switch (code) { ${holds.map((one) => `case "${one}":`).join(' ')} return 1; default: { const left: never = code; return left; } } }`,
            `${alias}: an exhaustive switch over exactly ${holds.join(', ')}`
          );
          for (const excluded of REQ_ERROR_CODES.filter((code) => !holds.includes(code)))
            probe(
              `export const excludes${String(at)}_${excluded.replace(/-/g, '_')} = (code: ${alias}["code"]): boolean => code === "${excluded}";`,
              `${alias} excludes ${excluded}`,
              [2367]
            );
        }

        // Each surface is declared as its alias — exactly, not merely
        // assignable both ways, which `any` and a mutable twin would pass.
        const surfaceTypes: [string, string, string][] = [
          [
            'state.error when error',
            'Extract<ReqState, { readonly status: "error" }>["error"]',
            'ReqStateError'
          ],
          [
            'state.error when incomplete',
            'Extract<ReqState, { readonly status: "incomplete" }>["error"]',
            'IncompleteError'
          ],
          [
            'RefreshOutcome error',
            'Extract<RefreshOutcome, { readonly kind: "error" }>["error"]',
            'RefreshOutcomeError'
          ],
          [
            'the error slot',
            'Parameters<NonNullable<Outlets<object>["error"]>>[0]["error"]',
            'ReqOutletError'
          ],
          ['lastError', 'ReqDiagnostics["lastError"]', 'ReqLastError | undefined'],
          [
            'legEnded.error',
            'NonNullable<ReqDiagnostics["legEnded"]>["error"]',
            'RelayLegError | undefined'
          ],
          ['LegEnd error', 'LegEnd["error"]', 'RelayLegError | undefined']
        ];
        for (const [label, declared, alias] of surfaceTypes)
          probe(
            `export const equal_${label.replace(/\W+/g, '_')}: Equal<${declared}, ${alias}> = true;`,
            `${label} is declared as ${alias}`
          );
        // **The outlet a component renders is the one declared**: each
        // published component's props, read off its own parse, are an outlet
        // type, and where that type has an `error` outlet its argument is the
        // slot's alias.
        const outletTypes = new Set<string>();
        for (const component of MAIN_SURFACE.components) {
          const props = propsTypeOf(
            readFileSync(join(LIBRARY, 'components', `${component}.svelte`), 'utf8')
          );
          if (props === undefined) {
            failures.push(`${component}: its props are not one outlet type`);
            continue;
          }
          outletTypes.add(props);
        }
        expect(
          outletTypes.size,
          'the premise: the components’ outlet types were read'
        ).toBeGreaterThan(5);
        lines[1] = `import type { Outlets, ${[...outletTypes].sort().join(', ')} } from "./components/outlets.js";`;
        for (const props of [...outletTypes].sort())
          probe(
            `export const outlet_${props}: OutletChecked<${props}> = true;`,
            `${props}: its error outlet is handed a ReqOutletError`
          );
        // The probe's own control: `any` is not equal to an alias.
        probe(
          'export const equalAny: Equal<ReqStateError, any> = true;',
          'the equality probe refuses any',
          [2322]
        );

        // A consumer branches on `code`, through each surface, and reaches the
        // members each code carries; and writes nothing.
        probe(
          'export function branches(state: ReqState): string { if (state.status !== "error") return ""; switch (state.error.code) { case "invalid-descriptor": case "unsupported-filter": return state.error.field; case "relay-not-in-scope": return state.error.url; case "transport-incompatible": return state.error.field; case "descriptor-unreadable": return state.error.thrownName; default: return state.error.message; } }',
          'branching on state.error.code narrows to each code’s members'
        );
        for (const [surface, alias] of Object.entries(ALIASES) as [Surface, string][])
          for (const code of codesAt(surface))
            for (const member of ['message', 'name', 'stack', 'cause'])
              probe(
                `export function write_${alias}_${code.replace(/-/g, '_')}_${member}(error: ${alias}): void { if (error.code === "${code}") error.${member} = undefined as never; }`,
                `${alias} as ${code}: ${member} is read-only`,
                [2540]
              );
        probe(
          'export const impossible = (state: ReqState): boolean => state.status === "error" && state.error.code === "incomplete-result";',
          'status error and code incomplete-result do not compare',
          [2367]
        );

        // **Structural**: a plain object of each variant's shape is a value of
        // the channel, so a nominal brand added to a variant is a break here.
        const shapes: Readonly<Record<ReqErrorCode, string>> = {
          'incomplete-result': 'incompleteCauses: ["timeout"]',
          'invalid-descriptor': 'field: "filters"',
          'unsupported-filter': 'field: "search"',
          'relay-not-in-scope': 'url: "wss://a.example/", configured: false',
          'transport-incompatible': 'field: "relays"',
          'accumulator-contract': '',
          'provider-disposed': '',
          'missing-provider': '',
          'descriptor-unreadable': 'thrownName: "Error", truncated: false, source: "descriptor"',
          'relay-failed': 'thrownName: "Error", truncated: false, source: "relay"',
          unspecified: 'thrownName: "Error", truncated: false, source: "unspecified"'
        };
        for (const code of REQ_ERROR_CODES)
          probe(
            `export const shaped_${code.replace(/-/g, '_')}: ReqError = { name: "Error", message: "m", code: "${code}"${shapes[code] === '' ? '' : `, ${shapes[code]}`} };`,
            `a plain object of the ${code} shape is a ReqError`
          );
        // And a captured value's `source` and `code` are one fact: every
        // pairing but its own is refused.
        const doors = {
          'descriptor-unreadable': 'descriptor',
          'relay-failed': 'relay',
          unspecified: 'unspecified'
        } as const;
        for (const [code, door] of Object.entries(doors))
          for (const other of Object.values(doors).filter((one) => one !== door))
            probe(
              `export const mismatched_${code.replace(/-/g, '_')}_${other}: ReqError = { name: "Error", message: "m", code: "${code}", thrownName: "Error", truncated: false, source: "${other}" };`,
              `${code} with source ${other} is not a ReqError`,
              [2322]
            );

        // A line no probe stands on, with an error on it: what the stray check
        // has to report, and the only thing it may.
        lines.push('export const strayControl: number = "not a number";');
        const strayLine = lines.length;
        const compiled = againstEmitted(lines.join('\n'));
        expect(
          compiled.reachedSource,
          'the consumer compiled against the declarations alone'
        ).toEqual([]);
        const byLine = new Map<number, number[]>();
        for (const one of compiled.diagnostics)
          byLine.set(one.line, [...(byLine.get(one.line) ?? []), one.code]);
        const stray = [...byLine].filter(([line]) => !expected.has(line));
        expect(
          stray.filter(([line]) => line === strayLine).map(([, codes]) => codes),
          'the stray check’s control: an error where no probe stands is seen'
        ).toEqual([[2322]]);
        for (const [line, codes] of stray)
          if (line !== strayLine)
            failures.push(
              `the probe's line ${String(line)} has ${codes.join(', ')}, and no probe there`
            );
        for (const [line, { codes, label }] of expected) {
          const found = byLine.get(line) ?? [];
          if (JSON.stringify(found) !== JSON.stringify(codes))
            failures.push(
              `${label}: expected [${codes.join(', ')}], compiled [${found.join(', ')}]`
            );
        }
        expect(expected.size, 'the premise: probes were written').toBeGreaterThan(150);
      })();

      // **(3) What the entry gives out**: closed, read by the checker through
      // every alias to the symbol that defines it, on the entry and on the
      // index that re-exports it.
      await (async (): Promise<void> => {
        for (const specifier of ['$lib/v1/public-entry.js', '$lib/v1/index.js']) {
          const exported = exportsOf(specifier);
          const names = exported.map(({ name }) => name);
          const defined = exported.map(({ defines }) => defines);
          expect(
            ['ReqFailure', 'RefreshRejection', 'isReqError'].filter(
              (name) => names.includes(name) || defined.includes(name)
            ),
            `${specifier}: no snapshot class, no rejection alias and no recognition guard, under any name`
          ).toEqual([]);
          // **Closed, as values**: a recogniser that answers `boolean` has no
          // predicate to find, so what may be given out at all is listed —
          // the hooks, the components, and the classes a consumer catches.
          const allowed = new Set<string>([
            ...MAIN_SURFACE.hooks,
            ...MAIN_SURFACE.components,
            ...PUBLISHED_VALUES
          ]);
          expect(
            exported
              .filter(({ kind, name }) => kind !== 'type' && !allowed.has(name))
              .map(({ name }) => name),
            `${specifier}: a value given out that is not a hook, a component or a published class`
          ).toEqual([]);
          const classes = exported
            .filter(({ kind }) => kind === 'class')
            .map(({ defines }) => defines);
          if (specifier === '$lib/v1/public-entry.js')
            expect([...classes].sort(), 'the classes the entry publishes').toEqual(
              [...PUBLISHED_VALUES].sort()
            );
          expect(
            exported.filter(({ guards }) => guards).map(({ name }) => name),
            `${specifier}: no exported callable answers a type predicate`
          ).toEqual([]);
        }
      })();

      // **(4) Every class this library owns carries a `code`**: a literal, the
      // right one, or one of the two unions, by family. The population is the
      // checker's — every class whose instances are `Error`s, however its base
      // is spelled.
      await (async (): Promise<void> => {
        const found = errorClassCodes();
        expect(found.unread, 'a class declaration the population could not read').toEqual([]);
        expect(found.codes, 'each class and the code a consumer reads off it').toEqual(CLASS_CODES);
      })();

      // **(5) The runtime half: every row driven, every surface read.**
      await (async (): Promise<void> => {
        const check = (witness: string, observed: Observed): void => {
          failures.push(...reaches(witness, observed));
        };
        const plain = (name: string, overrides: Record<string, unknown> = {}) => {
          const { rxNostr, server } = createTestRelay(nextUrl());
          const held = mount(() =>
            useStreamedReq(() => ({
              verifyEvent: acceptAnyEvent,
              attempts,
              rxNostr,
              client,
              namespace: `ra1-${name}`,
              filters: [{ kinds: [1] }],
              reqIdBase: `ra1-${name}`,
              settleTimeoutMs: 300,
              ...overrides
            }))
          );
          return { rxNostr, server, held };
        };

        // RM1: a descriptor refusal.
        {
          const { held } = plain('rm1', {
            filters: [{ search: 'unsupported' } as unknown as { kinds: number[] }]
          });
          await settle(120);
          check('RM1', observe(held.value, await settledCall(held.value.refresh())));
          held.destroy();
        }
        // RM5 and RM4: a client the caller disposed, before mount and after an answer.
        {
          const { rxNostr } = createTestRelay(nextUrl());
          rxNostr.dispose();
          const { held } = plain('rm5', { rxNostr });
          await settle(200);
          check('RM5', observe(held.value, await settledCall(held.value.refresh())));
          held.destroy();
        }
        {
          const { rxNostr, server, held } = plain('rm4');
          respondWithEose(server, await waitForReq(server));
          await settle(120);
          rxNostr.dispose();
          const call = await settledCall(held.value.refresh());
          const reason =
            call.kind === 'rejected' ? (call.reason as { field?: unknown }) : undefined;
          if (reason?.field !== 'rxNostr')
            failures.push('RM4: the rejection does not name rxNostr');
          check('RM4', observe(held.value, call));
          held.destroy();
        }
        // RM11: a descriptor this library could not read.
        {
          const { held } = plain('rm11', {
            filters: [
              {
                get kinds(): number[] {
                  throw new Error('the caller’s filter getter blew up');
                }
              } as unknown as { kinds: number[] }
            ]
          });
          await settle(150);
          check('RM11', observe(held.value, await settledCall(held.value.refresh())));
          held.destroy();
        }
        // RM3 and RM10: a relay giving out under a shipping accumulator.
        {
          const { server, held } = plain('rm3', { live: true, retain: 'unbounded' });
          respondWithEose(server, await waitForReq(server));
          await settle(120);
          server.error({ code: 1006, reason: 'gone', wasClean: false });
          await settle(250);
          const observed = observe(held.value, await settledCall(held.value.refresh()));
          check('RM3', observed);
          check('RM10', observed);
          held.destroy();
        }
        // RM9: an accumulator that re-throws the leg end.
        {
          const hostile: StreamAccumulator =
            ({ initialValue, reducer, streamFn }) =>
            async (context) => {
              const stream = await streamFn(context);
              let folded = initialValue;
              for await (const chunk of stream) {
                if (chunk.type === 'legEnded' && chunk.reason !== undefined) throw chunk.reason;
                folded = reducer(folded, chunk);
              }
              return folded;
            };
          const { server, held } = plain('rm9', {
            accumulator: hostile,
            live: true,
            retain: 'unbounded'
          });
          respondWithEose(server, await waitForReq(server));
          await settle(120);
          server.error({ code: 1006, reason: 'gone', wasClean: false });
          await settle(250);
          check('RM9', observe(held.value, await settledCall(held.value.refresh())));
          held.destroy();
        }
        // RM12: a fault this library cannot attribute.
        {
          const opaque: StreamAccumulator =
            ({ initialValue, reducer, streamFn }) =>
            async (context) => {
              const stream = await streamFn(context);
              let folded = initialValue;
              for await (const chunk of stream) folded = reducer(folded, chunk);
              void folded;
              throw new Error('the accumulator gave out for reasons of its own');
            };
          const { server, held } = plain('rm12', { accumulator: opaque });
          respondWithEose(server, await waitForReq(server));
          await settle(200);
          check('RM12', observe(held.value, await settledCall(held.value.refresh())));
          held.destroy();
        }
        // RM26: no provider and nothing of its own.
        {
          const held = mount(() =>
            useStreamedReq(() => ({
              namespace: 'ra1-rm26',
              filters: [{ kinds: [1] }],
              reqIdBase: 'ra1-rm26',
              settleTimeoutMs: 300
            }))
          );
          await settle(150);
          check('RM26', observe(held.value, await settledCall(held.value.refresh())));
          held.destroy();
        }
        // RM27 and RM28: a relay the provider cannot read, refused on the state
        // and on `refresh()`.
        {
          const mine = nextUrl();
          const theirs = nextUrl();
          const server = new WS(mine, { jsonProtocol: true });
          const unreachable = new WS(theirs, { jsonProtocol: true });
          const provider = mount(() => {
            const built = createNostrContext({
              relays: [mine],
              harness: HARNESS_DIVERGENCES,
              verifyEvent: acceptAnyEvent
            });
            setNostrContext(built);
            return built;
          });
          const held = mount(() =>
            useStreamedReq(() => ({
              namespace: 'ra1-rm27',
              filters: [{ kinds: [1] }],
              relays: [theirs],
              reqIdBase: 'ra1-rm27',
              settleTimeoutMs: 300
            }))
          );
          await settle(200);
          const observed = observe(held.value, await settledCall(held.value.refresh()));
          check('RM27', observed);
          check('RM28', observed);
          if (unreachable.messages.length > 0 || server.messages.length > 0)
            failures.push('RM27: a relay was asked for a request that was refused');
          held.destroy();
          provider.destroy();
        }
        // NA4: a target the provider's transport cannot name.
        {
          const relay = nextUrl();
          const UNNAMEABLE = 'wss://unnameable.example';
          new WS(relay, { jsonProtocol: true });
          const transportKeys: TransportKeys = (urls) => {
            if ((urls[0] ?? '').startsWith(UNNAMEABLE)) throw new Error('cannot name this one');
            return [...urls];
          };
          const provider = mount(() => {
            const built = createNostrContext({
              relays: [relay],
              harness: HARNESS_DIVERGENCES,
              verifyEvent: acceptAnyEvent,
              transportKeys
            });
            setNostrContext(built);
            return built;
          });
          const held = mount(() =>
            useStreamedReq(() => ({
              namespace: 'ra1-na4',
              filters: [{ kinds: [1] }],
              relays: [UNNAMEABLE],
              reqIdBase: 'ra1-na4',
              settleTimeoutMs: 300
            }))
          );
          await settle(200);
          check('NA4', observe(held.value, await settledCall(held.value.refresh())));
          held.destroy();
          provider.destroy();
        }
        // RM8: a provider destroyed with a call in flight, and a call after.
        {
          const url = nextUrl();
          const server = new WS(url, { jsonProtocol: true });
          const provider = mount(() => {
            const built = createNostrContext({
              relays: [url],
              harness: HARNESS_DIVERGENCES,
              verifyEvent: acceptAnyEvent
            });
            setNostrContext(built);
            return built;
          });
          const held = mount(() =>
            useStreamedReq(() => ({
              namespace: 'ra1-rm8',
              filters: [{ kinds: [1] }],
              reqIdBase: 'ra1-rm8',
              settleTimeoutMs: 5_000
            }))
          );
          respondWithEose(server, await waitForReq(server));
          await settle(140);
          const inFlight = settledCall(held.value.refresh());
          await server.nextMessage;
          const asked = (): number =>
            (server.messages as unknown[][]).filter((frame) => frame[0] === 'REQ').length;
          const sentBefore = asked();
          const framesBefore = server.messages.length;
          const recordOf = () => ({
            status: held.value.state.status,
            error: codeOf((held.value.state as { error?: unknown }).error),
            lastError: codeOf(held.value.diagnostics.lastError),
            legEnded: codeOf(held.value.diagnostics.legEnded?.error),
            slot: deriveOutlet(held.value.state).slot
          });
          const before = recordOf();
          const lease = provider.value.transportLease;
          provider.destroy();
          await settle(140);
          const cancelled = await inFlight;
          const later = await settledCall(held.value.refresh());
          expect(
            [
              before.status,
              lease?.revoked,
              lease?.relayStatus(),
              lease?.use(createRxForwardReq('ra1-rm8-after')),
              cancelled.kind === 'resolved' ? cancelled.outcome : cancelled,
              asked() === sentBefore,
              (server.messages as unknown[][])
                .slice(framesBefore)
                .every((frame) => frame[0] === 'CLOSE'),
              recordOf(),
              later.kind
            ],
            'RM8: the lease revoked, the call in flight cancelled by the owner, no REQ after, the record kept, and a later call refused'
          ).toEqual([
            'settled',
            true,
            undefined,
            undefined,
            { kind: 'cancelled', reason: 'provider-disposed' },
            true,
            true,
            before,
            'rejected'
          ]);
          check('RM8', observe(held.value, later));
          held.destroy();
        }
      })();

      // **(6) An abandoned attempt is a cancellation**, and publishes nothing —
      // read before the consumer goes away and after it, since a publication
      // caused by the going away is what a snapshot taken before cannot see.
      await (async (): Promise<void> => {
        const { rxNostr, server } = createTestRelay(nextUrl());
        const held = mount(() =>
          useStreamedReq(() => ({
            verifyEvent: acceptAnyEvent,
            attempts,
            rxNostr,
            client,
            namespace: 'ra1-abandoned',
            filters: [{ kinds: [1] }],
            reqIdBase: 'ra1-abandoned',
            settleTimeoutMs: 5_000
          }))
        );
        respondWithEose(server, await waitForReq(server));
        await settle(120);
        const pending = settledCall(held.value.refresh());
        await waitForReq(server);
        const before = observe(held.value);
        held.destroy();
        const settled = await pending;
        const after = observe(held.value, settled);
        expect(
          settled.kind === 'resolved' ? settled.outcome : settled,
          'the abandoned call resolves as the consumer’s release'
        ).toEqual({ kind: 'cancelled', reason: 'consumer-released' });
        expect(
          [before, after].flatMap((observed) =>
            SURFACES.filter((surface) => codeOf(observed[surface]) !== undefined)
          ),
          'and no surface carries a failure, before the release or after it'
        ).toEqual([]);
      })();

      // **(7) What a second copy of this package keeps**: `instanceof` does
      // not survive it and `code` does, for every class the entry publishes,
      // each copied from the module that defines it.
      await (async (): Promise<void> => {
        const defining = exportsOf('$lib/v1/public-entry.js').filter(
          ({ kind }) => kind === 'class'
        );
        const arguments_: Readonly<Record<string, unknown[]>> = {
          IncompleteResultError: [['timeout']],
          MissingProviderError: [],
          MissingRandomnessError: [],
          RelayConfigurationError: ['invalid-relay-input', ['wss://a.example/'], 'mine']
        };
        for (const { defines, module } of defining) {
          const specifier = `$lib/v1/${module.replace(/\.ts$/, '.js')}`;
          const first = (await import(/* @vite-ignore */ specifier)) as Record<
            string,
            new (...args: unknown[]) => Error
          >;
          const second = (await import(
            /* @vite-ignore */ `${specifier}?duplicate-install`
          )) as Record<string, new (...args: unknown[]) => Error>;
          const One = first[defines];
          const Two = second[defines];
          if (One === undefined || Two === undefined) {
            failures.push(`${defines}: not found in ${module}`);
            continue;
          }
          const args = arguments_[defines] ?? [];
          const made = new Two(...args);
          expect(
            [
              One === Two,
              made instanceof Two,
              made instanceof One,
              (made as { code?: unknown }).code
            ],
            `${defines}: two copies, the second's instance not the first's, the code the same`
          ).toEqual([false, true, false, (new One(...args) as { code?: unknown }).code]);
        }
        expect(defining.length, 'the premise: the entry publishes classes').toBe(
          PUBLISHED_VALUES.length
        );
      })();

      // **(8) Every code a narrowing is handed lands inside the alias it
      // promises, exactly where it is mapped**, and a value already inside is
      // handed back.
      await (async (): Promise<void> => {
        const shaped = (code: ReqErrorCode): ReqError =>
          Object.assign(new Error(`a ${code} value`), {
            code,
            thrownName: 'Error',
            truncated: false,
            source: DOOR_OF[code]
          }) as unknown as ReqError;
        const MAPS_TO: Readonly<
          Record<ReqErrorCode, { state: string; record: string; leg: string }>
        > = {
          'invalid-descriptor': {
            state: 'invalid-descriptor',
            record: 'unspecified',
            leg: 'relay-failed'
          },
          'unsupported-filter': {
            state: 'unsupported-filter',
            record: 'unspecified',
            leg: 'relay-failed'
          },
          'relay-not-in-scope': {
            state: 'relay-not-in-scope',
            record: 'unspecified',
            leg: 'relay-failed'
          },
          'transport-incompatible': {
            state: 'transport-incompatible',
            record: 'unspecified',
            leg: 'relay-failed'
          },
          'descriptor-unreadable': {
            state: 'descriptor-unreadable',
            record: 'unspecified',
            leg: 'relay-failed'
          },
          'accumulator-contract': {
            state: 'accumulator-contract',
            record: 'accumulator-contract',
            leg: 'relay-failed'
          },
          unspecified: { state: 'unspecified', record: 'unspecified', leg: 'relay-failed' },
          'incomplete-result': { state: 'unspecified', record: 'unspecified', leg: 'relay-failed' },
          'provider-disposed': { state: 'unspecified', record: 'unspecified', leg: 'relay-failed' },
          'missing-provider': {
            state: 'missing-provider',
            record: 'unspecified',
            leg: 'relay-failed'
          },
          'relay-failed': {
            state: 'accumulator-contract',
            record: 'accumulator-contract',
            leg: 'relay-failed'
          }
        };
        const [stateError, , outcome, , , , legEnd] = SURFACES;
        for (const code of REQ_ERROR_CODES) {
          const value = shaped(code);
          const mapped = {
            state: String(terminalFailure(value).code),
            record: String(recordedFailure(value).code),
            leg: String(captureFromRelay(value).code)
          };
          expect(mapped, `${code}: what each narrowing makes of it`).toEqual(MAPS_TO[code]);
          for (const [made, surface] of [
            [mapped.state, stateError],
            [mapped.record, outcome],
            [mapped.leg, legEnd]
          ] as const)
            if (!codesAt(surface).includes(made as ReqErrorCode))
              failures.push(`${code} narrowed to ${made}, which ${surface} cannot carry`);
        }
        const fromRelay = shaped('relay-failed');
        const named = terminalFailure(fromRelay) as { cause?: unknown };
        const recorded = recordedFailure(fromRelay) as { cause?: unknown };
        expect(
          [codeOf(named.cause), codeOf(recorded.cause)],
          'a relay’s failure named as the contract violation keeps the relay’s value on its cause'
        ).toEqual(['relay-failed', 'relay-failed']);
        const inside = shaped('accumulator-contract');
        expect(
          [terminalFailure(inside) === inside, recordedFailure(inside) === inside],
          'a value already inside is handed back, by both narrowings'
        ).toEqual([true, true]);
      })();

      // **(9) `refresh()` tells a seam it cannot read from one that is absent**:
      // each throwing read rejects by the seam's name, and a server provider,
      // which has no transport by construction, resolves.
      await (async (): Promise<void> => {
        for (const seam of ['client', 'rxNostr'] as const) {
          const { rxNostr, server } = createTestRelay(nextUrl());
          let hostile = false;
          const held = mount(() =>
            useStreamedReq(() => ({
              verifyEvent: acceptAnyEvent,
              attempts,
              namespace: `ra1-seam-${seam}`,
              filters: [{ kinds: [1] }],
              reqIdBase: `ra1-seam-${seam}`,
              settleTimeoutMs: 300,
              get client(): QueryClient {
                if (hostile && seam === 'client') throw new Error('the client getter blew up');
                return client;
              },
              get rxNostr(): RxNostr {
                if (hostile && seam === 'rxNostr') throw new Error('the transport getter blew up');
                return rxNostr;
              }
            }))
          );
          respondWithEose(server, await waitForReq(server));
          await settle(120);
          hostile = true;
          const call = await settledCall(held.value.refresh());
          const reason =
            call.kind === 'rejected'
              ? (call.reason as { code?: unknown; field?: unknown })
              : undefined;
          expect(
            [call.kind, reason?.code, reason?.field, isOwnedByLibrary(reason)],
            `a ${seam} that throws when read: refused by its name, on the channel`
          ).toEqual(['rejected', 'invalid-descriptor', seam, true]);
          held.destroy();
        }
        const url = nextUrl();
        const provider = mount(() => {
          const built = createNostrContext({
            relays: [url],
            harness: HARNESS_DIVERGENCES,
            environment: 'server'
          });
          setNostrContext(built);
          return built;
        });
        const held = mount(() =>
          useStreamedReq(() => ({
            namespace: 'ra1-server',
            filters: [{ kinds: [1] }],
            reqIdBase: 'ra1-server',
            settleTimeoutMs: 300
          }))
        );
        await settle(80);
        const call = await settledCall(held.value.refresh());
        expect(
          [provider.value.transportLease, call.kind === 'resolved' ? call.outcome : call],
          'a server provider has no transport, and its refresh() resolves rather than refusing one'
        ).toEqual([undefined, { kind: 'not-started', reason: 'server' }]);
        held.destroy();
        provider.destroy();
      })();

      // **(10) The record's matrix is this declaration**, cell for cell.
      await (async (): Promise<void> => {
        const { headers, rows } = recordedMatrix();
        expect(headers, 'the record’s columns are the seven surfaces').toEqual([
          'code',
          ...SURFACES
        ]);
        expect(
          rows.map(([code, ...cells]) => [
            code,
            ...cells.map((cell) => (cell === '—' ? undefined : cell))
          ]),
          'and its rows are the declaration’s, in its order, every cell'
        ).toEqual(
          ROW_ORDER.map((code) => [
            `code \`${code}\``,
            ...SURFACES.map((surface) => INHERITED[code][surface])
          ])
        );
        expect(WITNESSES.length, 'the premise: the record names its witnesses').toBe(
          Object.keys(HELD_BY).length
        );
      })();

      // **Every witness the landing holds, observed by it**, read here as well
      // as after the file: a scenario dropped from this arm fails the arm.
      expect(unobserved('RA1'), 'a witness the landing is listed for and never observed').toEqual(
        []
      );

      expect(failures, 'a cell, a type or a narrowing that is not what the record says').toEqual(
        []
      );
    }
  );
});

/**
 * The spike's reachability witnesses, ported: each drives its own path and is
 * checked against its own cells through the same bridge, under the ids the
 * record's `HELD_BY` lists for them.
 */
describe('the spike’s reachability witnesses', () => {
  let supportPort = 9250;
  const nextSupportUrl = (): string => `ws://localhost:${(supportPort += 1)}`;
  const request = (name: string, overrides: Record<string, unknown> = {}) => {
    const { rxNostr, server } = createTestRelay(nextSupportUrl());
    const held = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        rxNostr,
        client,
        namespace: name,
        filters: [{ kinds: [1] }],
        reqIdBase: name,
        settleTimeoutMs: 300,
        ...overrides
      }))
    );
    return { rxNostr, server, held };
  };

  it('RX1: a descriptor refusal reaches the state and the rejection, and never the outcome', async () => {
    const { held } = request('rx1', {
      filters: [{ search: 'unsupported' } as unknown as { kinds: number[] }]
    });
    await settle(120);
    const state = held.value.state as { status: string; error?: ReqError };
    expect(state.status, 'the request was refused').toBe('error');
    expect(codeOf(state.error), 'and the state names the filter field').toBe('unsupported-filter');
    expect(codeOf(held.value.diagnostics.lastError), 'the diagnostics axis carries it too').toBe(
      'unsupported-filter'
    );
    const slot = deriveOutlet(held.value.state) as { slot: string; error?: ReqError };
    expect([slot.slot, codeOf(slot.error)], 'the error slot renders it').toEqual([
      'error',
      'unsupported-filter'
    ]);
    const call = await settledCall(held.value.refresh());
    expect(
      [call.kind, codeOf(call.kind === 'rejected' ? call.reason : undefined)],
      '`refresh()` rejects, with the same code'
    ).toEqual(['rejected', 'unsupported-filter']);
    expect(reaches('RM1', observe(held.value, call))).toEqual([]);
    held.destroy();
  }, 20_000);

  it('RX2: an abandoned attempt is a cancellation, and reaches neither the state nor the diagnostics', async () => {
    const { server, held } = request('rx2', { settleTimeoutMs: 5_000 });
    respondWithEose(server, await waitForReq(server));
    await settle(120);
    const pending = settledCall(held.value.refresh());
    await waitForReq(server);
    const before = observe(held.value);
    held.destroy();
    const settled = await pending;
    expect(
      settled.kind === 'resolved' ? settled.outcome : settled,
      'the abandoned call resolves, as a cancellation naming which lifetime ended'
    ).toEqual({ kind: 'cancelled', reason: 'consumer-released' });
    // **Read, not built and discarded**: the spike made this observation and
    // dropped it with `void`, so the clause it stood for had no assertion.
    expect(
      SURFACES.filter(
        (surface) => codeOf({ ...before, ...observe(held.value, settled) }[surface]) !== undefined
      ),
      'no surface carries a failure, before the release or after it'
    ).toEqual([]);
  }, 20_000);

  it('RX3: a relay giving out reaches the leg end and not the state', async () => {
    const { server, held } = request('rx3', { live: true, retain: 'unbounded' });
    respondWithEose(server, await waitForReq(server));
    await settle(120);
    server.error({ code: 1006, reason: 'gone', wasClean: false });
    await settle(250);
    const ended = held.value.diagnostics.legEnded;
    expect(
      [ended?.kind, codeOf(ended?.error)],
      'the leg ended, carrying the relay door’s code'
    ).toEqual(['ended', 'relay-failed']);
    const state = held.value.state as { status: string; error?: ReqError };
    expect(
      [state.status, codeOf(state.error)],
      'the answer is partial rather than failed, and the state carries the incompleteness'
    ).toEqual(['incomplete', 'incomplete-result']);
    expect(
      [
        codeOf((deriveOutlet(held.value.state) as { error?: ReqError }).error),
        codeOf(held.value.diagnostics.lastError)
      ],
      'and so do the slot and the diagnostics axis'
    ).toEqual(['incomplete-result', 'incomplete-result']);
    expect(reaches('RM3', observe(held.value, await settledCall(held.value.refresh())))).toEqual(
      []
    );
    held.destroy();
  }, 20_000);

  it('RX4: a client the caller disposed is refused as the seam it is, on both paths', async () => {
    const { rxNostr, server, held } = request('rx4');
    respondWithEose(server, await waitForReq(server));
    await settle(120);
    rxNostr.dispose();
    const call = await settledCall(held.value.refresh());
    const reason = call.kind === 'rejected' ? (call.reason as ReqError) : undefined;
    expect(
      [call.kind, reason?.code, reason?.code === 'invalid-descriptor' ? reason.field : undefined],
      'the seam this library was handed is what is refused, and it says which'
    ).toEqual(['rejected', 'invalid-descriptor', 'rxNostr']);
    expect(reason?.message, 'the words are the disposal rather than a relay that is down').toMatch(
      /disposed/
    );
    expect(reaches('RM4', observe(held.value, call))).toEqual([]);
    held.destroy();
  }, 20_000);

  it('RX5: a client the caller disposed is refused by the name of the seam, not as a disposal', async () => {
    const { rxNostr } = createTestRelay(nextSupportUrl());
    rxNostr.dispose();
    const { held } = request('rx5', { rxNostr });
    await settle(200);
    const state = held.value.state as { status: string; error?: ReqError };
    expect(
      [state.status, codeOf(state.error), (state.error as { field?: unknown } | undefined)?.field],
      'refused by the name of the seam, the transport'
    ).toEqual(['error', 'invalid-descriptor', 'rxNostr']);
    expect(reaches('RM5', observe(held.value, await settledCall(held.value.refresh())))).toEqual(
      []
    );
    held.destroy();
  }, 20_000);

  it('RX6: `refresh()` refuses a seam it cannot read, and not one that is absent', async () => {
    const second = createTestRelay(nextSupportUrl());
    let hostileNow = false;
    const hostile = mount(() =>
      useStreamedReq(() => ({
        verifyEvent: acceptAnyEvent,
        attempts,
        client,
        namespace: 'rx6',
        filters: [{ kinds: [1] }],
        reqIdBase: 'rx6',
        settleTimeoutMs: 300,
        get rxNostr(): RxNostr {
          if (hostileNow) throw new Error('the caller’s transport getter blew up');
          return second.rxNostr;
        }
      }))
    );
    respondWithEose(second.server, await waitForReq(second.server));
    await settle(120);
    hostileNow = true;
    const refused = await settledCall(hostile.value.refresh());
    const reason = refused.kind === 'rejected' ? refused.reason : undefined;
    expect(
      [refused.kind, codeOf(reason), (reason as { field?: unknown } | undefined)?.field],
      'refused by name, on the channel, naming the seam it could not read'
    ).toEqual(['rejected', 'invalid-descriptor', 'rxNostr']);
    hostile.destroy();
    // And the absent edge, which the spike left to another arm: a server
    // provider has no transport by construction, and its `refresh()` resolves.
    const provider = mount(() => {
      const built = createNostrContext({
        relays: [nextSupportUrl()],
        harness: HARNESS_DIVERGENCES,
        environment: 'server'
      });
      setNostrContext(built);
      return built;
    });
    const absent = mount(() =>
      useStreamedReq(() => ({
        namespace: 'rx6-server',
        filters: [{ kinds: [1] }],
        reqIdBase: 'rx6-server',
        settleTimeoutMs: 300
      }))
    );
    const call = await settledCall(absent.value.refresh());
    expect(call.kind === 'resolved' ? call.outcome : call, 'an absent seam is not refused').toEqual(
      {
        kind: 'not-started',
        reason: 'server'
      }
    );
    absent.destroy();
    provider.destroy();
  }, 20_000);

  it('RX7: every code a normalizer is handed lands inside the alias it promises', () => {
    const shaped = (code: ReqErrorCode): ReqError =>
      Object.assign(new Error(`a ${code} value`), {
        code,
        thrownName: 'Error',
        truncated: false,
        source: DOOR_OF[code]
      }) as unknown as ReqError;
    expect(REQ_ERROR_CODES.length, 'the population is every code the channel has').toBe(11);
    const STATE = [
      'invalid-descriptor',
      'unsupported-filter',
      'relay-not-in-scope',
      'transport-incompatible',
      'descriptor-unreadable',
      'missing-provider',
      'accumulator-contract',
      'unspecified'
    ];
    const OUTCOME = ['accumulator-contract', 'unspecified'];
    for (const code of REQ_ERROR_CODES) {
      const value = shaped(code);
      expect(String(terminalFailure(value).code), `${code} lands inside ReqStateError`).toBeOneOf(
        STATE
      );
      expect(
        String(recordedFailure(value).code),
        `${code} lands inside RefreshOutcomeError`
      ).toBeOneOf(OUTCOME);
      expect(String(captureFromRelay(value).code), `${code} lands inside RelayLegError`).toBe(
        'relay-failed'
      );
    }
    const inside = shaped('accumulator-contract');
    expect(
      [terminalFailure(inside) === inside, recordedFailure(inside) === inside],
      'a value already inside is handed back, on both narrowings'
    ).toEqual([true, true]);
  });

  it('RX8: a destroyed provider revokes, cancels the refresh, and disposes last', async () => {
    const url = nextSupportUrl();
    const server = new WS(url, { jsonProtocol: true });
    const provider = mount(() => {
      const built = createNostrContext({
        relays: [url],
        harness: HARNESS_DIVERGENCES,
        verifyEvent: acceptAnyEvent
      });
      setNostrContext(built);
      return built;
    });
    const held = mount(() =>
      useStreamedReq(() => ({
        namespace: 'rx8',
        filters: [{ kinds: [1] }],
        reqIdBase: 'rx8',
        settleTimeoutMs: 5_000
      }))
    );
    respondWithEose(server, await waitForReq(server));
    await settle(140);
    const inFlight = settledCall(held.value.refresh());
    await server.nextMessage;
    const asked = (): number =>
      (server.messages as unknown[][]).filter((frame) => frame[0] === 'REQ').length;
    const sentBefore = asked();
    const lease = provider.value.transportLease;
    expect(lease?.revoked, 'the lease is live').toBe(false);
    provider.destroy();
    await settle(140);
    expect(
      [lease?.revoked, lease?.relayStatus(), lease?.use(createRxForwardReq('rx8-after'))],
      'the lease was revoked, and every operation refuses'
    ).toEqual([true, undefined, undefined]);
    const settled = await inFlight;
    expect(
      settled.kind === 'resolved' ? settled.outcome : settled,
      'the call in flight is cancelled, and the owner going away is what it says'
    ).toEqual({ kind: 'cancelled', reason: 'provider-disposed' });
    const later = await settledCall(held.value.refresh());
    expect(
      [later.kind, codeOf(later.kind === 'rejected' ? later.reason : undefined), asked()],
      'a later call is refused, told the owner is gone, and asks the relay for nothing'
    ).toEqual(['rejected', 'provider-disposed', sentBefore]);
    const published = observe(held.value, later);
    expect(reaches('RM8', published)).toEqual([]);
    expect(
      SURFACES.filter((surface) => codeOf(published[surface]) === 'provider-disposed'),
      'the owner going away is published once, on the rejection'
    ).toEqual(['what `refresh()` **rejects** with']);
    held.destroy();
  }, 20_000);

  it('RX11: a descriptor this library could not read is refused by that name, on four surfaces', async () => {
    const theirs = new Error('the caller’s filter getter blew up');
    const { held } = request('rx11', {
      filters: [
        {
          get kinds(): number[] {
            throw theirs;
          }
        } as unknown as { kinds: number[] }
      ]
    });
    await settle(150);
    const state = held.value.state as { status: string; error?: ReqError };
    expect(
      [
        state.status,
        codeOf(state.error),
        state.error === theirs,
        (state.error as { thrownName?: unknown } | undefined)?.thrownName
      ],
      'refused by the name for a descriptor this library cannot read, with a value of its own'
    ).toEqual(['error', 'descriptor-unreadable', false, 'Error']);
    const call = await settledCall(held.value.refresh());
    expect(call.kind, '`refresh()` rejects rather than resolving').toBe('rejected');
    expect(reaches('RM11', observe(held.value, call))).toEqual([]);
    held.destroy();
  }, 20_000);

  it('RX12: a fault this library cannot attribute is the one that stays unspecified', async () => {
    const opaque: StreamAccumulator =
      ({ initialValue, reducer, streamFn }) =>
      async (context) => {
        const stream = await streamFn(context);
        let folded = initialValue;
        for await (const chunk of stream) folded = reducer(folded, chunk);
        void folded;
        throw new Error('the accumulator gave out for reasons of its own');
      };
    const { server, held } = request('rx12', { accumulator: opaque });
    respondWithEose(server, await waitForReq(server));
    await settle(200);
    const state = held.value.state as { status: string; error?: ReqError };
    expect([state.status, codeOf(state.error)], 'the request failed, unattributed').toEqual([
      'error',
      'unspecified'
    ]);
    const call = await settledCall(held.value.refresh());
    expect(call.kind, 'a terminal failure resolves an outcome rather than rejecting').toBe(
      'resolved'
    );
    expect(reaches('RM12', observe(held.value, call))).toEqual([]);
    held.destroy();
  }, 20_000);
});

/**
 * Every class in the library whose instances are `Error`s, found by the
 * checker rather than by how its base is spelled, and the type of the `code`
 * a consumer reads off an instance: a literal's text, or the alias's name.
 */
function errorClassCodes(extra: readonly string[] = []): {
  codes: Record<string, string>;
  unread: string[];
} {
  const files = [
    ...(ts.sys.readDirectory(LIBRARY, ['.ts'], undefined, undefined) as string[]).filter(
      (name) => !name.endsWith('.d.ts')
    ),
    ...extra
  ];
  const read = ts.readConfigFile(resolve(ROOT, 'tsconfig.json'), (path) => ts.sys.readFile(path));
  const options = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT).options;
  const program = ts.createProgram(files, { ...options, noEmit: true });
  const checker = program.getTypeChecker();
  const codes: Record<string, string> = {};
  const unread: string[] = [];
  for (const file of program.getSourceFiles()) {
    if (!file.fileName.startsWith(LIBRARY) && !extra.includes(file.fileName)) continue;
    const visit = (node: ts.Node): void => {
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const symbol =
          node.name !== undefined
            ? checker.getSymbolAtLocation(node.name)
            : ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)
              ? checker.getSymbolAtLocation(node.parent.name)
              : undefined;
        if (symbol === undefined) {
          unread.push(`${join(file.fileName)}: a class with no name`);
        } else {
          const instance = checker.getDeclaredTypeOfSymbol(symbol);
          const bases = (type: ts.Type): string[] => {
            const symbolOf = type.getSymbol();
            const name = symbolOf?.getName() ?? '';
            const declared = (type as ts.InterfaceType).getBaseTypes?.() ?? [];
            return [name, ...declared.flatMap((base) => bases(base))];
          };
          if (bases(instance).includes('Error')) {
            const code = checker.getPropertyOfType(instance, 'code');
            if (code === undefined) unread.push(`${symbol.getName()}: no code`);
            else {
              const declaration = code.valueDeclaration;
              const annotated =
                declaration !== undefined &&
                (ts.isPropertyDeclaration(declaration) || ts.isPropertySignature(declaration)) &&
                declaration.type !== undefined &&
                ts.isTypeReferenceNode(declaration.type)
                  ? declaration.type.typeName.getText()
                  : undefined;
              const type = checker.getTypeOfSymbol(code);
              codes[symbol.getName()] =
                annotated ??
                (type.isStringLiteral() ? JSON.stringify(type.value) : checker.typeToString(type));
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return { codes, unread };
}
