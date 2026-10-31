/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * What an attempt keeps once a relay's state is determined, and the `timeout`
 * a relay left undetermined says on its own: the landings of `A5-C18`
 * (`DT1`), `A5-C26` (`DT2`), `A5-C19` (`DT3`), `A5-C29` (`DT4`), `A5-C27`
 * (`DT5`) and `A5-C28` (`DT6`).
 *
 * **Through the published entry**, for `DT1` and `DT4`: `NostrApp` with `relays` only, so
 * the verifier is the library's and an event a relay sends is signed for real;
 * a consumer's own `useReq` under it; and a relay that dies twice over — its
 * retries spent into `error` under the shipping policy, on a fake clock, and a
 * close with 4000, which rx-nostr reports as `rejected` and does not retry.
 * **Two relays, and the second refuses the live subscription first**, so the
 * relay under test is the last one the live leg has: its death ends the leg,
 * and that leg end — absent before the death — is the receipt that the death
 * was taken, published while the backlog — held open by the second relay,
 * which has not answered it — is still running. The spike
 * held one relay's backlog open with a verifier that never answered, which no
 * published input reaches.
 *
 * **On the machine directly**, for `DT2`, `DT3`, `DT5` and `DT6`:
 * `referenceStream` on a client of the arm's own, because what they read is
 * not published. `DT5` and `DT6` read which relays that record names. `DT2`
 * reads the backlog's own record of the relays it lost — the error a
 * `BacklogEnd` carries, which `eventset.ts` keeps for the machine's own
 * witnesses and publishes nowhere — and forces a relay's status to `rejected`
 * behind the attempt, since a relay that really is `rejected` is never asked;
 * it reads the tables' one write cell by cell and over every history of four
 * writes, the source the rule is written in for what no history reaches, and a
 * live run whose first relay comes back after `terminal`. `DT3` ends a
 * backlog's wait with the dependency's own EOSE timer, which the provider's
 * factory does not take (`TC1`), on a fake clock.
 *
 * Port band 9650–9699.
 */
import { readFileSync } from 'node:fs';

import { render } from '@testing-library/svelte';
import { WebSocket as MockWebSocket } from 'mock-socket';
import type Nostr from 'nostr-typedef';
import { getEventHash, getPublicKey, getSignature } from 'rx-nostr-crypto';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WS from 'vitest-websocket-mock';

import type { ReqHandle, ReqPlan } from '$lib/v1/index.js';
import type { BackwardPhase, PhaseTable } from '$lib/v1/machine.js';
import { BACKWARD_PHASES, isPhaseTable, phaseTable, referenceStream } from '$lib/v1/machine.js';
import { MAX_SETTLE_TIMEOUT_MS } from '$lib/v1/normalize.js';
import type { RelayPhase } from '$lib/v1/refusal.js';
import { RELAY_PHASES } from '$lib/v1/refusal.js';
import type { MachineChunk } from '$lib/v1/stream.js';
import { requestTargets } from '$lib/v1/stream.js';

import PublishedRequest from './fixtures/PublishedRequest.svelte';
import { acceptAnyEvent, createTestRelay, permanentTransport } from './helpers/relay.js';

// The provider reads the framework's own context, not the setup's stand-in.
vi.unmock('svelte');

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  WS.clean();
});

let port = 9650;
const nextUrl = (): string => `ws://localhost:${String((port += 1))}`;

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Within this of a relay's last step, an answer is the relays' and not a timer's. */
const PROMPTLY_MS = 2000;

/** The dependency's own EOSE timer on `DT3`'s client, far below the request's. */
const DEPENDENCY_EOSE_MS = 40;

const SECKEY = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a';

/** An event signed correctly over its own fields, as a relay would carry one. */
const signed = (content: string): Nostr.Event => {
  const unsigned = { kind: 1, created_at: 1000, tags: [], content, pubkey: getPublicKey(SECKEY) };
  const id = getEventHash(unsigned);
  return { ...unsigned, id, sig: getSignature(id, SECKEY) };
};

/** Every clock the dependency, the socket mock and the machine read, for an arm on a fake one. */
const FAKED = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'Date',
  'performance'
] as const;

/**
 * The published entry's globals: the socket mock, and no relay metadata. Every
 * socket the dependency constructs is recorded by its url, including one that
 * never opens — which is what a retry against a relay that is gone is.
 */
function stubTheWire(constructed: string[] = []): string[] {
  class Recorded extends MockWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      constructed.push(String(url));
    }
  }
  vi.stubGlobal('WebSocket', Recorded);
  vi.stubGlobal('fetch', () => Promise.resolve(new Response('{}', { status: 404 })));
  return constructed;
}

/** How many sockets were constructed for `url`. */
const constructedFor = (constructed: readonly string[], url: string): number =>
  constructed.filter((each) => each.startsWith(url)).length;

interface Closable {
  close(options: { code: number }): void;
}

/** Whether `done` holds within `ms` of real time. */
async function until(done: () => boolean, ms: number): Promise<boolean> {
  try {
    await vi.waitFor(() => expect(done()).toBe(true), { timeout: ms });
    return true;
  } catch {
    return false;
  }
}

/**
 * Advance the fake clock a step at a time until `done` holds, or `ms` of it
 * have passed — the fake clock's `until`, since a wait on real time would
 * watch a clock that is not moving.
 */
async function advanceUntil(done: () => boolean, ms: number, step = 100): Promise<boolean> {
  for (let spent = 0; spent < ms && !done(); spent += step) await vi.advanceTimersByTimeAsync(step);
  return done();
}

/** The two clocks an arm can run on, behind one call. */
const waitOn = (fake: boolean) =>
  fake ? (done: () => boolean, ms: number) => advanceUntil(done, ms) : until;

/** A relay server whose sockets close as a relay's do, and what it was asked on each leg. */
function relayOn(server: WS) {
  const sockets: Closable[] = [];
  server.on('connection', (socket) => {
    sockets.push(socket as unknown as Closable);
  });
  const reqs = (): string[] =>
    (server.messages as unknown[][])
      .filter((frame) => frame[0] === 'REQ')
      .map((frame) => String(frame[1]));
  /** The subscription names asked of this relay on one leg, each once, first asked first. */
  const names = (leg: 'forward' | 'backward'): string[] => [
    ...new Set(reqs().filter((subId) => subId.includes(leg === 'forward' ? '-f:' : '-b:')))
  ];
  return {
    server,
    reqs,
    /** `EOSE` for the latest backlog asked of this relay. */
    answerBacklog: (): void => {
      server.send(['EOSE', names('backward').at(-1)]);
    },
    /** `CLOSED` for the latest backlog asked of this relay. */
    refuseBacklog: (): void => {
      server.send(['CLOSED', names('backward').at(-1), 'blocked: no']);
    },
    /** `CLOSED` for the latest live subscription asked of this relay. */
    refuseLive: (): void => {
      server.send(['CLOSED', names('forward').at(-1), 'blocked: not here']);
    },
    /** `event` on the latest live subscription asked of this relay. */
    sendLive: (event: Nostr.Event): void => {
      server.send(['EVENT', names('forward').at(-1), event]);
    },
    /** The open socket closed with 4000, which rx-nostr reports as `rejected`. */
    refuse: (): void => {
      sockets.at(-1)?.close({ code: 4000 });
    },
    /** The open socket closed with rx-nostr's idle code, which it reports as `dormant`. */
    idle: (): void => {
      sockets.at(-1)?.close({ code: 4537 });
    },
    /** How many sockets this relay has accepted. */
    connections: (): number => sockets.length,
    /** How many sockets to this relay are open now. */
    open: (): number => server.server.clients().length,
    /**
     * The server closed and removed, 1006 to every socket in the same turn, so
     * every retry the shipping policy makes fails before it opens.
     */
    shut: (): void => {
      server.close({ code: 1006, reason: 'gone', wasClean: false });
    }
  };
}

const relayAt = (url: string) => ({ url, ...relayOn(new WS(url, { jsonProtocol: true })) });

type Relay = ReturnType<typeof relayAt>;

/** The relays a reading names, by the label the arm gave each. */
type Labels = Readonly<Record<string, string>>;

/** Which of the arm's relays `message` names, by label; nothing when there is no message. */
const namedIn = (message: string | undefined, labels: Labels): string[] | undefined =>
  message === undefined
    ? undefined
    : Object.entries(labels)
        .filter(([, url]) => message.includes(url))
        .map(([name]) => name);

/**
 * What a handle says, as the rows read it. `named` is which of the arm's
 * relays the leg end's error names, by label. `causes` is there only for an
 * incomplete answer.
 */
function readingOf(handle: ReqHandle | undefined, labels: Labels) {
  const state = handle?.state;
  const ended = handle?.diagnostics.legEnded;
  const label = (url: string): string =>
    Object.entries(labels).find(([, each]) => each === url)?.[0] ?? url;
  return {
    status: state?.status,
    events:
      state === undefined || state.status === 'loading'
        ? undefined
        : state.events.map((each) => each.id),
    causes: state?.status === 'incomplete' ? [...state.causes] : undefined,
    legEnded: ended?.kind,
    named: namedIn(ended?.error?.message, labels),
    activity: handle?.activity,
    refusals: handle?.diagnostics.refusals.map((each) => `${each.leg} ${label(each.from)}`)
  };
}

const failed = (error: unknown) => ({
  failed: error instanceof Error ? error.message : String(error)
});

const live = (namespace: string): ReqPlan => ({
  kind: 'request',
  descriptor: {
    filters: [{ kinds: [1] }],
    live: true,
    retain: 'unbounded',
    // The cap, so the request's own timer cannot fire inside the dependency's
    // retries on a fake clock.
    settleTimeoutMs: MAX_SETTLE_TIMEOUT_MS,
    namespace
  }
});

/**
 * One request through the published entry, handed to `run` with the sockets
 * constructed so far, unmounted after. With `onAFakeClock`, the clock is
 * installed before the request is made, so the dependency's retries run on it;
 * it is put back after the unmount.
 */
async function published(
  relays: readonly Relay[],
  plan: ReqPlan,
  run: (handle: () => ReqHandle | undefined, constructed: readonly string[]) => Promise<unknown>,
  { onAFakeClock = false }: { onAFakeClock?: boolean } = {}
): Promise<unknown> {
  let handle: ReqHandle | undefined;
  if (onAFakeClock) vi.useFakeTimers({ toFake: [...FAKED] });
  const constructed = stubTheWire();
  const view = render(PublishedRequest, {
    relays: relays.map((relay) => relay.url),
    plan: () => plan,
    seen: (request: ReqHandle) => {
      handle = request;
    },
    published: () => {}
  });
  try {
    return await run(() => handle, constructed);
  } catch (error) {
    return failed(error);
  } finally {
    view.unmount();
    if (onAFakeClock) {
      await vi.advanceTimersByTimeAsync(1000);
      vi.useRealTimers();
    }
  }
}

/** What the relay under test does with its backlog before its socket closes. */
type First = 'answered' | 'refused' | 'nothing';

/**
 * How the relay under test dies: its retries spent into `error` under the
 * shipping policy, on a fake clock — the ordinary death (0002) — or its socket
 * closed with 4000, `rejected`, which rx-nostr does not retry.
 */
type Death = 'exhausted' | 'rejected';

/** The machine driven directly, its chunks recorded as they are handed over. */
function driven(params: Parameters<typeof referenceStream>[0]): {
  chunks: MachineChunk[];
  done: Promise<void>;
} {
  const chunks: MachineChunk[] = [];
  const done = (async () => {
    for await (const chunk of referenceStream(params)) chunks.push(chunk);
  })();
  return { chunks, done };
}

/** The two tables an attempt makes, as the machine hands them to its witnesses. */
interface Tables {
  forward: PhaseTable<RelayPhase>;
  backward: PhaseTable<BackwardPhase>;
}

/**
 * What an attempt's own tables hold, each relay by its label, and whether
 * `phaseTable` made each of them — `undefined` when the machine handed over no
 * tables at all. With the controls that make "made by it" a reading rather
 * than a word: a structural copy of the backward table, a proxy of it and an
 * object whose prototype it is are each not a table it made; and neither table
 * lets its write be replaced, read back through a second reader rather than
 * asked of `Object.isFrozen`.
 */
function heldBy(tables: Tables | undefined, labels: Labels) {
  if (tables === undefined) return undefined;
  const label = (url: string): string =>
    Object.entries(labels).find(([, at]) => url.startsWith(at))?.[0] ?? url;
  const read = (table: PhaseTable<RelayPhase> | PhaseTable<BackwardPhase>) =>
    Object.fromEntries([...table.entries()].map(([url, phase]) => [label(url), phase]));
  const replaced = (table: object): boolean => {
    const replacement = () => undefined;
    Reflect.set(table, 'write', replacement);
    return Reflect.get(table, 'write') === replacement;
  };
  return {
    made: [isPhaseTable(tables.forward), isPhaseTable(tables.backward)],
    impostors: [
      isPhaseTable({ ...tables.backward }),
      isPhaseTable(new Proxy(tables.backward, {})),
      isPhaseTable(Object.create(tables.backward))
    ],
    forward: read(tables.forward),
    backward: read(tables.backward),
    // Last, once the states above are read.
    replaceable: [replaced(tables.forward), replaced(tables.backward)]
  };
}

/**
 * The chunks' kinds, a refusal with its leg, and the backlog's own record of
 * how it ended: the causes, and which of the arm's relays its error names.
 */
function recordOf(chunks: readonly MachineChunk[], labels: Labels) {
  const settled = chunks.find((chunk) => chunk.type === 'settled');
  const end = settled?.type === 'settled' ? settled.end : undefined;
  return {
    shape: chunks.map((chunk) =>
      chunk.type === 'refused' ? `refused ${chunk.refusal.leg}` : chunk.type
    ),
    kind: end?.kind,
    causes: end?.kind === 'incomplete' ? [...end.causes] : undefined,
    named: end?.kind === 'incomplete' ? namedIn(end.error?.message, labels) : undefined
  };
}

/**
 * The rule both tables share, as `machine.ts` writes it: the six declarations
 * the write's answer can depend on, the comments left out. `DT2` holds the file
 * to these, token for token.
 */
const THE_RULE = `
const DETERMINED: ReadonlySet<BackwardPhase> = new Set<BackwardPhase>(['complete', 'refused', 'ended']);
const ABSORBING: ReadonlySet<RelayPhase | BackwardPhase> = new Set<RelayPhase | BackwardPhase>([
  'terminal',
  ...DETERMINED
]);
function nextPhase<Phase extends RelayPhase | BackwardPhase>(current: Phase, incoming: Phase): Phase {
  return ABSORBING.has(current) ? current : incoming;
}
const MINTED = new WeakSet<object>();
export function isPhaseTable(value: unknown): boolean {
  return typeof value === 'object' && value !== null && MINTED.has(value);
}
export function phaseTable<Phase extends RelayPhase | BackwardPhase>(
  urls: Iterable<string>,
  initial: Phase
): PhaseTable<Phase> {
  const phases = new Map<string, Phase>([...urls].map((url) => [url, initial]));
  const table = Object.freeze<PhaseTable<Phase>>({
    get: (url) => phases.get(url),
    has: (url) => phases.has(url),
    keys: () => phases.keys(),
    values: () => phases.values(),
    entries: () => phases.entries(),
    write: (url, incoming) => {
      const current = phases.get(url);
      if (current === undefined) return undefined;
      const next = nextPhase(current, incoming);
      if (next === current) return undefined;
      phases.set(url, next);
      return next;
    }
  });
  MINTED.add(table);
  return table;
}
`;

/** The two statements that make an attempt's tables, and the only places the constructor is called. */
const THE_TABLES = [
  "const targets = phaseTable<RelayPhase>(targetUrls, 'pending');",
  "const backwardTargets = phaseTable<BackwardPhase>(targets.keys(), 'pending');"
] as const;

/** The statement that hands an attempt's two tables to the machine's own witnesses. */
const THE_WITNESS = 'witnessTables?.(targets, backwardTargets);';

/** The one other statement that names a parameter {@link THE_TABLES} or {@link THE_WITNESS} reads. */
const THE_READERS = ['const routeToTargets = { on: { relays: [...targetUrls] } };'] as const;

/** The default library's files, parsed once for every program {@link theRuleAsWritten} builds. */
const LIBRARY = new Map<string, ts.SourceFile>();

/**
 * The rule as `source` writes it, what each name in it is bound to, and every
 * other place in `source` that reaches it.
 *
 * **That the write keeps nothing but its cells is a fact about the source.** No
 * reading of a table can show it: a write that kept a history of its own, or
 * keyed on a relay's url, answers every history a test writes and is wrong on
 * one it does not. So it is asked of the syntax tree and of the TypeScript
 * checker, and the questions have nothing to interpret:
 * - each of the rule's six declarations — `DETERMINED`, `ABSORBING`,
 *   `nextPhase`, `MINTED`, `isPhaseTable` and `phaseTable` — is declared once at
 *   the top of the file, as {@link THE_RULE} writes it, token for token;
 * - **every name they read at run time is bound inside them, or to the host's
 *   own** — declared in the default library and nowhere else — since the same
 *   tokens read a module's own `undefined` or `WeakSet` as readily as the
 *   host's; type positions are left out, as nothing runs there;
 * - outside them, any of those six names stands only as `DETERMINED.has(…)` or
 *   inside one of {@link THE_TABLES}, and is never held, written, shadowed or
 *   exported again — whatever scope it is in, so a binding of the same
 *   spelling is refused too;
 * - **the tables an attempt hands its witnesses are the ones those statements
 *   make, read through nothing that can be swapped**: each of them, and
 *   {@link THE_WITNESS}, is written once among `referenceStream`'s own
 *   statements; every name the three read is bound, as the checker resolves
 *   it, to one declaration — the rule's, one of theirs or one of
 *   `referenceStream`'s parameters; and such a parameter is named nowhere else
 *   but at its own declaration, in them and in {@link THE_READERS}, nor is
 *   `referenceStream` itself but at its own. So a table made any other way —
 *   through an alias of the constructor, the module's namespace or a wrapper in
 *   another module, none of which this file alone can refuse — is not one an
 *   attempt hands over, and nothing rebinds the witnesses, or the list the
 *   forward table is made from, before the three read them;
 * - and nothing calls `eval`, which would reach them by a string.
 *
 * What the rule does is not read here. `DT2`'s cells and histories measure
 * that.
 */
function theRuleAsWritten(source: string): {
  declared: string[];
  host: string[];
  made: string[];
  handover: string[];
  read: number;
  breaches: string[];
} {
  const path = '/the-rule/machine.ts';
  const options: ts.CompilerOptions = {
    noResolve: true,
    noEmit: true,
    lib: ['lib.es2022.d.ts'],
    types: [],
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext
  };
  const host = ts.createCompilerHost(options, true);
  const fromDisk = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, ...rest) => {
    if (name === path) return ts.createSourceFile(name, source, language, true);
    const parsed = LIBRARY.get(name) ?? fromDisk(name, language, ...rest);
    if (parsed !== undefined) LIBRARY.set(name, parsed);
    return parsed;
  };
  const program = ts.createProgram([path], options, host);
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(path);
  if (file === undefined)
    return {
      declared: [],
      host: [],
      made: [],
      handover: [],
      read: 0,
      breaches: ['no file']
    };
  const tokensOf = (text: string): string[] => {
    const scanner = ts.createScanner(
      ts.ScriptTarget.Latest,
      true,
      ts.LanguageVariant.Standard,
      text
    );
    const tokens: string[] = [];
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan())
      tokens.push(scanner.getTokenText());
    return tokens;
  };
  // Where `expected` and `actual` first part, or nothing when they do not.
  const parting = (expected: string[], actual: string[]): string | undefined => {
    const at = actual.findIndex((token, index) => token !== expected[index]);
    if (at === -1 && actual.length === expected.length) return undefined;
    const index = at === -1 ? Math.min(actual.length, expected.length) : at;
    return `${actual[index] ?? 'its end'} where the rule has ${expected[index] ?? 'its end'}`;
  };
  // The statement `node` stands in.
  const statementOf = (node: ts.Node): ts.Node => {
    let at: ts.Node = node;
    while (
      at.parent !== undefined &&
      !ts.isSourceFile(at.parent) &&
      !ts.isBlock(at.parent) &&
      !ts.isModuleBlock(at.parent) &&
      !ts.isCaseClause(at.parent) &&
      !ts.isDefaultClause(at.parent)
    )
      at = at.parent;
    return at;
  };
  const lineOf = (node: ts.Node): string => node.getText(node.getSourceFile()).split('\n')[0] ?? '';
  // Every top-level statement declaring `name`, in `of`.
  const declarationsOf = (of: ts.SourceFile, name: string): ts.Statement[] =>
    of.statements.filter(
      (statement) =>
        (ts.isFunctionDeclaration(statement) && statement.name?.text === name) ||
        (ts.isVariableStatement(statement) &&
          statement.declarationList.declarations.some(
            (one) => ts.isIdentifier(one.name) && one.name.text === name
          ))
    );
  const rule = ts.createSourceFile('rule.ts', THE_RULE, ts.ScriptTarget.Latest, true);
  const names = rule.statements.flatMap((statement) =>
    ts.isFunctionDeclaration(statement)
      ? [statement.name?.text ?? '']
      : ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.map((one) => one.name.getText(rule))
        : []
  );
  const breaches: string[] = [];
  const declared: string[] = [];
  const pinned = new Map<ts.Node, string>();
  for (const name of names) {
    const found = declarationsOf(file, name);
    const [statement] = found;
    if (found.length !== 1 || statement === undefined) {
      breaches.push(`${String(found.length)} declarations of ${name}`);
      continue;
    }
    pinned.set(statement, name);
    const parted = parting(
      tokensOf(declarationsOf(rule, name)[0]?.getText(rule) ?? ''),
      tokensOf(statement.getText(file))
    );
    if (parted === undefined) declared.push(name);
    else breaches.push(`${name} departs from the rule as written: ${parted}`);
  }
  // What each name the rule reads at run time is bound to.
  const within = (declaration: ts.Node): boolean =>
    declaration.getSourceFile() === file &&
    [...pinned.keys()].some(
      (statement) => declaration.pos >= statement.pos && declaration.end <= statement.end
    );
  const hostNames: string[] = [];
  for (const [statement, name] of pinned) {
    const bound = (node: ts.Node, typed: boolean): void => {
      const inType = typed || ts.isTypeNode(node);
      if (ts.isIdentifier(node) && !inType) {
        const symbol = checker.getSymbolAtLocation(node);
        const declarations = symbol?.declarations ?? [];
        const outside = declarations.filter(
          (one) => !within(one) && !program.isSourceFileDefaultLibrary(one.getSourceFile())
        );
        if (symbol === undefined) breaches.push(`${node.text} in ${name} is bound to nothing`);
        else if (declarations.length === 0 && node.text !== 'undefined')
          breaches.push(`${node.text} in ${name} is bound to nothing declared`);
        else if (outside.length > 0)
          breaches.push(
            `${node.text} in ${name} is bound outside the rule: ${outside.map((one) => lineOf(statementOf(one))).join(' | ')}`
          );
        else if (!declarations.some(within)) hostNames.push(node.text);
      }
      ts.forEachChild(node, (child) => bound(child, inType));
    };
    bound(statement, false);
  }
  // The one statement among `referenceStream`'s own written as `text`.
  const stream = file.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === 'referenceStream'
  );
  const own = (text: string): ts.Statement | undefined => {
    const tokens = tokensOf(text);
    const found = (stream?.body?.statements ?? []).filter(
      (statement) => parting(tokens, tokensOf(statement.getText(file))) === undefined
    );
    if (found.length !== 1)
      breaches.push(
        `${text} is written ${String(found.length)} times among referenceStream's own statements`
      );
    return found.length === 1 ? found[0] : undefined;
  };
  const making = THE_TABLES.map(own);
  const witness = own(THE_WITNESS);
  // What every name those three read is bound to, and the parameters among them.
  const tied = [...making, witness].filter((one) => one !== undefined);
  const parameterOf = (declaration: ts.Node): boolean =>
    stream?.parameters.some(
      (parameter) => declaration.pos >= parameter.pos && declaration.end <= parameter.end
    ) === true;
  const handover: string[] = [];
  const parameters = new Set<ts.Symbol>();
  const through = (node: ts.Node, typed: boolean): void => {
    const inType = typed || ts.isTypeNode(node);
    if (
      ts.isIdentifier(node) &&
      !inType &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      const symbol = checker.getSymbolAtLocation(node);
      const declarations = symbol?.declarations ?? [];
      const [only] = declarations;
      const kind =
        declarations.length !== 1 || only === undefined
          ? undefined
          : within(only)
            ? 'the rule'
            : tied.some((statement) => statement === statementOf(only))
              ? 'a statement'
              : parameterOf(only)
                ? 'a parameter'
                : undefined;
      if (kind === undefined)
        breaches.push(
          `${node.text} in ${lineOf(statementOf(node))} is bound to ${declarations.map((one) => lineOf(statementOf(one))).join(' | ') || 'nothing'}`
        );
      else handover.push(`${node.text}: ${kind}`);
      if (kind === 'a parameter' && symbol !== undefined) parameters.add(symbol);
    }
    ts.forEachChild(node, (child) => through(child, inType));
  };
  for (const statement of tied) through(statement, false);
  const named = new Set([...parameters].map((symbol) => symbol.name));
  const readers = THE_READERS.map((text) => tokensOf(text));
  const made: string[] = [];
  let read = 0;
  const reached = new Set([...names, 'eval']);
  const walk = (node: ts.Node): void => {
    if (pinned.has(node)) return;
    if (ts.isIdentifier(node) && reached.has(node.text)) {
      const { parent } = node;
      const atHas =
        node.text === 'DETERMINED' &&
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        parent.name.text === 'has' &&
        ts.isCallExpression(parent.parent) &&
        parent.parent.expression === parent;
      const statement = statementOf(node);
      const table = node.text === 'phaseTable' ? making.indexOf(statement as ts.Statement) : -1;
      if (atHas) read += 1;
      else if (table !== -1) made.push(THE_TABLES[table]?.split(' ')[1] ?? '');
      else breaches.push(`${node.text} outside the rule: ${lineOf(statement)}`);
    }
    if (ts.isIdentifier(node) && named.has(node.text)) {
      const symbol = checker.getSymbolAtLocation(node);
      const statement = statementOf(node);
      const declaring =
        symbol?.declarations?.some((one) => ts.isBindingElement(one) && one.name === node) ?? false;
      const allowed =
        (symbol !== undefined && !parameters.has(symbol)) ||
        declaring ||
        tied.some((one) => one === statement) ||
        readers.some((tokens) => parting(tokens, tokensOf(statement.getText(file))) === undefined);
      if (!allowed) breaches.push(`${node.text} outside the handover: ${lineOf(statement)}`);
    }
    if (ts.isIdentifier(node) && node.text === 'referenceStream' && node !== stream?.name)
      breaches.push(`referenceStream outside its declaration: ${lineOf(statementOf(node))}`);
    ts.forEachChild(node, walk);
  };
  walk(file);
  return {
    declared,
    host: [...new Set(hostNames)].sort(),
    made,
    handover: [...new Set(handover)].sort(),
    read,
    breaches: [...new Set(breaches)]
  };
}

describe('A5: what an attempt keeps once a relay is determined', () => {
  // @contracts A5-C18
  it('DT1: a relay that answered or refused its backlog and then dies is not recorded gone, against the same death with nothing before it', async () => {
    // **Two differential pairs and one control they share.** Relay a answers
    // its backlog, refuses it, or does nothing; then it dies. Over `complete`
    // and over `refused` alike the death adds no `ended`, while the control —
    // the same death with nothing to absorb it — adds it. The control is shared
    // because "the same death with nothing to absorb it" is one arrangement for
    // both pairs, and each arm differs from it by the one message. **The pair is
    // the claim rather than either arm**: a table that keeps nothing passes the
    // arms and fails the control, and one that keeps the last write passes the
    // control and fails the arms. **Two pairs rather than one**, because a table
    // that keeps the state it expected and lets the other be overwritten passes
    // a single pair entirely.
    //
    // **Under both deaths.** The ordinary one, a's retries spent into `error`
    // under the shipping policy on a fake clock installed before the request;
    // and a's socket closed with 4000, `rejected`, which rx-nostr does not
    // retry. A port that kept the first state on one route into `terminal` and
    // not the other passes either alone.
    //
    // **One receipt of the death**, because a missing `ended` is equally
    // satisfied by a machine that never saw it. Relay b refuses the live
    // subscription first, so a's death is what ends the live leg: the leg end is
    // read absent after a's last message and present after its death, while the
    // request is still `streaming` on b's open backlog — so the death was taken,
    // and before the outcome was derived. **And the refused arm's backlog
    // refusal**, which is the receipt of the first determination the death is
    // read against rather than of the death.
    //
    // **The order has a marker.** After its answer and before its death, a
    // sends a signed live event; once that shows, everything a sent before it
    // on the same socket has been taken. Then b answers its backlog, and the
    // outcome is read. Each reading is taken well inside the two seconds after
    // which the provider starts a recovery of its own (`A13`).
    const marker = signed('marker');
    const run = async (death: Death, first: First) => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      const labels = { a: a.url, b: b.url };
      const fake = death === 'exhausted';
      const wait = waitOn(fake);
      return published(
        [a, b],
        live(`dt1-${death}-${first}`),
        async (handle, constructed) => {
          const asked = await wait(() => a.reqs().length >= 2 && b.reqs().length >= 2, 5000);
          b.refuseLive();
          const liveRefused = await wait(
            () => handle()?.diagnostics.refusals.length === 1,
            PROMPTLY_MS
          );
          if (first === 'answered') a.answerBacklog();
          if (first === 'refused') a.refuseBacklog();
          a.sendLive(marker);
          const marked = await wait(
            () => readingOf(handle(), labels).events?.includes(marker.id) === true,
            PROMPTLY_MS
          );
          const beforeTheDeath = handle()?.diagnostics.legEnded?.kind;
          if (fake) a.shut();
          else a.refuse();
          // Six sockets on the ordinary death: the first and the policy's five
          // retries, each failing before it opens.
          await wait(
            () => handle()?.diagnostics.legEnded !== undefined,
            fake ? 45_000 : PROMPTLY_MS
          );
          const atTheDeath = {
            status: handle()?.state.status,
            legEnded: handle()?.diagnostics.legEnded?.kind,
            sockets: constructedFor(constructed, a.url)
          };
          b.answerBacklog();
          await wait(
            () =>
              (handle()?.state.status === 'settled' || handle()?.state.status === 'incomplete') &&
              handle()?.activity === 'idle',
            PROMPTLY_MS
          );
          return {
            asked,
            liveRefused,
            marked,
            beforeTheDeath,
            atTheDeath,
            ...readingOf(handle(), labels)
          };
        },
        { onAFakeClock: fake }
      );
    };
    const deaths = async (death: Death) => ({
      answered: await run(death, 'answered'),
      refused: await run(death, 'refused'),
      nothing: await run(death, 'nothing')
    });
    const read = { exhausted: await deaths('exhausted'), rejected: await deaths('rejected') };
    const outcomes = (sockets: number) => {
      const reading = {
        asked: true,
        liveRefused: true,
        marked: true,
        beforeTheDeath: undefined,
        atTheDeath: { status: 'streaming', legEnded: 'ended', sockets },
        events: [marker.id],
        legEnded: 'ended',
        named: ['a', 'b'],
        activity: 'idle'
      };
      return {
        answered: { ...reading, status: 'settled', causes: undefined, refusals: ['forward b'] },
        refused: {
          ...reading,
          status: 'incomplete',
          causes: ['refused'],
          refusals: ['backward a', 'forward b']
        },
        nothing: { ...reading, status: 'incomplete', causes: ['ended'], refusals: ['forward b'] }
      };
    };
    expect(
      read,
      'the death adds `ended` only where nothing had determined the relay first'
    ).toEqual({
      exhausted: outcomes(6),
      rejected: outcomes(1)
    });
  }, 60_000);

  // @contracts A5-C26
  it('DT2: the first state a relay is determined to is kept whichever way the contradiction arrives, and the backlog names only the relays it lost', async () => {
    // **Internal**: the machine on a client of the arm's own, retries off.
    //
    // **The reverse order, forced.** Relay b's status is reported `rejected`
    // when the attempt begins, so the preflight records it gone while its
    // socket is open — so rx-nostr asks it all the same, and then:
    // - **answered**: b sends `EOSE`, then a does. A table that re-decides
    //   reports `complete`, a backlog one of whose relays had already been
    //   recorded gone;
    // - **silent**: b says nothing and a answers. A table that merely forgets —
    //   lets the REQ going out demote b to undetermined — reports the request's
    //   own timer, a second and a half later, under `timeout` naming nobody.
    //   With b's `EOSE` sent, a demotion is re-decided by it and reads as the
    //   first failure, so only this run sees the second.
    // Neither needs a control: the two failures separate on the answer. **Why
    // forced**: a relay that really is `rejected` is never asked — at rx-nostr
    // 3.7.6 `send()` on a rejected connection returns before the outgoing
    // channel — so nothing writes `active` over `ended` and no `EOSE` can come.
    // Forcing the status buys a relay recorded gone whose REQ still goes out,
    // and, answered, one that answers.
    //
    // **The backlog's own record of the relays it lost.** It is published
    // nowhere, and read here in `DT1`'s three arrangements with b, after a's
    // death, dying too and unanswered, so the record exists in every run: it
    // names b alone where a's death was absorbed, over `complete` and over
    // `refused`, and a and b where nothing absorbed it. With b answering
    // instead, the absorbed runs lose no relay, so they carry no record.
    //
    // **The forward table's wiring.** A live run where a, having answered,
    // closes with rx-nostr's idle code — `dormant`, terminal — and is woken by a
    // second attempt on the same client; with a's socket open again, the
    // premise asserted, b refuses its live subscription. The forward table
    // keeps a `terminal`, so b's refusal is the last and the leg ends naming
    // both; a table of the forward writer's own that took a back out never
    // ends the leg.
    //
    // **And the tables' one write, cell by cell**, over both tables, because
    // two of the backward table's determined states derive nothing in the
    // outcome: a table that let `refused` overwrite `complete` is the same
    // table to every answer. Absorbing rows keep themselves, and every other
    // row moves to what arrives — the second half the control that a rule
    // which never moves fails. The rows and columns are the lists each table's
    // type is read off, so a phase added to either is a row the expectation
    // below does not have.
    //
    // **And the attempt's own tables, in every run.** The cells are read off
    // tables this arm makes, which says nothing about a table the attempt built
    // some other way: one built by hand that copied the rule but let `refused`
    // through over `complete` passed everything above. So the machine hands
    // over the two tables each attempt makes, and they are read for having been
    // made by `phaseTable` — against a copy, a proxy and a derived object, none
    // of which was — for a write that cannot be replaced, and for the states
    // the run left them in.
    const reverse = async (then: 'answered' | 'silent') => {
      const aUrl = nextUrl();
      const bUrl = nextUrl();
      const { rxNostr, server } = createTestRelay(aUrl);
      const a = relayOn(server);
      const b = relayOn(new WS(bUrl, { jsonProtocol: true }));
      rxNostr.setDefaultRelays([aUrl, bUrl]);
      const transport = permanentTransport(rxNostr);
      const targets = requestTargets(transport, undefined);
      // Keyed off the client's own spelling, so nothing here turns on how a url
      // is normalized.
      const spelled = (url: string): string => targets.find((each) => each.startsWith(url)) ?? url;
      rxNostr.getAllRelayStatus = () =>
        ({
          [spelled(aUrl)]: { connection: 'connected' },
          [spelled(bUrl)]: { connection: 'rejected' }
        }) as ReturnType<typeof rxNostr.getAllRelayStatus>;
      const ac = new AbortController();
      let tables: Tables | undefined;
      const { chunks, done } = driven({
        verifyEvent: acceptAnyEvent,
        transport,
        targets,
        filters: [{ kinds: [1] }],
        live: false,
        reqIdBase: `dt2-reverse-${then}`,
        signal: ac.signal,
        timeoutMs: 1500,
        witnessTables: (forward, backward) => {
          tables = { forward, backward };
        }
      });
      try {
        // Both asked: b's REQ went out, which is the write the table refuses.
        const asked = await until(() => a.reqs().length >= 1 && b.reqs().length >= 1, 2000);
        if (then === 'answered') {
          b.answerBacklog();
          await delay(30);
        }
        a.answerBacklog();
        await Promise.race([done, delay(3000)]);
        const labels = { a: aUrl, b: bUrl };
        return { asked, ...recordOf(chunks, labels), held: heldBy(tables, labels) };
      } finally {
        ac.abort();
        await done;
        rxNostr.dispose();
      }
    };
    const mixed = async (first: First) => {
      const aUrl = nextUrl();
      const bUrl = nextUrl();
      const { rxNostr, server } = createTestRelay(aUrl);
      const a = relayOn(server);
      const b = relayOn(new WS(bUrl, { jsonProtocol: true }));
      rxNostr.setDefaultRelays([aUrl, bUrl]);
      const transport = permanentTransport(rxNostr);
      const ac = new AbortController();
      let tables: Tables | undefined;
      const { chunks, done } = driven({
        verifyEvent: acceptAnyEvent,
        transport,
        targets: requestTargets(transport, undefined),
        filters: [{ kinds: [1] }],
        live: true,
        reqIdBase: `dt2-${first}`,
        signal: ac.signal,
        timeoutMs: 10_000,
        witnessTables: (forward, backward) => {
          tables = { forward, backward };
        }
      });
      try {
        const asked = await until(() => a.reqs().length >= 2 && b.reqs().length >= 2, 2000);
        b.refuseLive();
        if (first === 'answered') a.answerBacklog();
        if (first === 'refused') a.refuseBacklog();
        a.sendLive(signed('marker'));
        await until(() => chunks.some((chunk) => chunk.type === 'event'), PROMPTLY_MS);
        a.refuse();
        await until(() => chunks.some((chunk) => chunk.type === 'legEnded'), PROMPTLY_MS);
        b.refuse();
        await Promise.race([done, delay(PROMPTLY_MS)]);
        const labels = { a: aUrl, b: bUrl };
        return { asked, ...recordOf(chunks, labels), held: heldBy(tables, labels) };
      } finally {
        ac.abort();
        await done;
        rxNostr.dispose();
      }
    };
    const revived = async () => {
      const aUrl = nextUrl();
      const bUrl = nextUrl();
      const { rxNostr, server } = createTestRelay(aUrl);
      const a = relayOn(server);
      const b = relayOn(new WS(bUrl, { jsonProtocol: true }));
      rxNostr.setDefaultRelays([aUrl, bUrl]);
      const transport = permanentTransport(rxNostr);
      const targets = requestTargets(transport, undefined);
      const ac = new AbortController();
      let tables: Tables | undefined;
      const { chunks, done } = driven({
        verifyEvent: acceptAnyEvent,
        transport,
        targets,
        filters: [{ kinds: [1] }],
        live: true,
        reqIdBase: 'dt2-revived',
        signal: ac.signal,
        timeoutMs: 10_000,
        witnessTables: (forward, backward) => {
          tables = { forward, backward };
        }
      });
      // A second attempt on the same client, asking a alone: its REQ is what
      // wakes a's socket, and nothing of the first attempt is re-sent on it.
      const other = new AbortController();
      let woken: ReturnType<typeof driven> | undefined;
      try {
        const asked = await until(() => a.reqs().length >= 2 && b.reqs().length >= 2, 2000);
        a.answerBacklog();
        b.answerBacklog();
        await until(() => chunks.some((chunk) => chunk.type === 'settled'), PROMPTLY_MS);
        a.idle();
        await delay(100);
        const asleep = a.connections();
        woken = driven({
          verifyEvent: acceptAnyEvent,
          transport,
          targets: targets.filter((each) => each.startsWith(aUrl)),
          filters: [{ kinds: [7] }],
          live: false,
          reqIdBase: 'dt2-revived-other',
          signal: other.signal,
          timeoutMs: 10_000
        });
        const back = await until(() => a.connections() === asleep + 1, PROMPTLY_MS);
        await delay(100);
        const openAtTheRefusal = a.open();
        b.refuseLive();
        await until(() => chunks.some((chunk) => chunk.type === 'legEnded'), PROMPTLY_MS);
        const ended = chunks.find((chunk) => chunk.type === 'legEnded');
        return {
          asked,
          back,
          // The premise, asserted: a reconnection that failed would put a back
          // in `terminal` under any table, and one that absorbs and one that
          // does not would agree.
          open: [openAtTheRefusal, a.open()],
          shape: chunks.map((chunk) =>
            chunk.type === 'refused' ? `refused ${chunk.refusal.leg}` : chunk.type
          ),
          named:
            ended?.type === 'legEnded'
              ? namedIn(ended.reason?.message, { a: aUrl, b: bUrl })
              : undefined,
          held: heldBy(tables, { a: aUrl, b: bUrl })
        };
      } finally {
        ac.abort();
        other.abort();
        await done;
        await woken?.done;
        rxNostr.dispose();
      }
    };
    const forced = { answered: await reverse('answered'), silent: await reverse('silent') };
    const lost = {
      answered: await mixed('answered'),
      refused: await mixed('refused'),
      nothing: await mixed('nothing')
    };
    // Each cell is a table over two relays begun at `pending`, as an attempt's
    // are, with the relay under test written to `current` and then `incoming`
    // through the table's own write: the phase it keeps, and what the second
    // write answered — the phase it moved to, or nothing. **Made both ways an
    // attempt makes one**: from a list, as the forward table is made from the
    // target set, and from another table's keys, as the backward table is made
    // from the forward one's. A write that behaved otherwise for a table made
    // or begun some other way is read the way the attempt would meet it.
    const CELL = 'ws://localhost:9698/';
    const BESIDE = 'ws://localhost:9699/';
    const tableOf = <Phase extends RelayPhase | BackwardPhase>(
      phases: readonly Phase[],
      initial: Phase,
      made: 'from a list' | "from a table's keys"
    ) =>
      Object.fromEntries(
        phases.map((current) => [
          current,
          phases.map((incoming) => {
            const list = [CELL, BESIDE];
            const table = phaseTable(
              made === 'from a list' ? list : phaseTable(list, initial).keys(),
              initial
            );
            if (current !== initial) table.write(CELL, current);
            const moved = table.write(CELL, incoming);
            const kept = String(table.get(CELL));
            if (moved === undefined) return `kept ${kept}`;
            return moved === kept ? kept : `${kept}, answered ${moved}`;
          })
        ])
      );
    const forward = await revived();
    const bothWays = <Phase extends RelayPhase | BackwardPhase>(
      phases: readonly Phase[],
      initial: Phase
    ) => ({
      list: tableOf(phases, initial, 'from a list'),
      keys: tableOf(phases, initial, "from a table's keys")
    });
    const rule = {
      forward: bothWays(RELAY_PHASES, 'pending'),
      backward: bothWays(BACKWARD_PHASES, 'pending')
    };
    // The attempt's own tables: both made by `phaseTable`, in the states the
    // answer above says.
    const held = (forward: Labels, backward: Labels) => ({
      made: [true, true],
      impostors: [false, false, false],
      forward,
      backward,
      replaceable: [false, false]
    });
    const reading = (
      shape: string[],
      named: string[],
      tables: ReturnType<typeof held>,
      causes = ['ended']
    ) => ({
      asked: true,
      shape,
      kind: 'incomplete',
      causes,
      named,
      held: tables
    });
    // The rule's cells, the same whichever way the table was made.
    const forwardCells = {
      pending: ['kept pending', 'active', 'recovering', 'terminal'],
      active: ['pending', 'kept active', 'recovering', 'terminal'],
      recovering: ['pending', 'active', 'kept recovering', 'terminal'],
      terminal: ['kept terminal', 'kept terminal', 'kept terminal', 'kept terminal']
    };
    const backwardCells = {
      pending: ['kept pending', 'active', 'complete', 'refused', 'ended'],
      active: ['pending', 'kept active', 'complete', 'refused', 'ended'],
      complete: Array(5).fill('kept complete'),
      refused: Array(5).fill('kept refused'),
      ended: Array(5).fill('kept ended')
    };
    // Not live, so nothing writes the forward table; live, and both relays
    // stopped.
    const neverLive = { a: 'pending', b: 'pending' };
    const bothStopped = { a: 'terminal', b: 'terminal' };
    // **And every history of four writes**, since a write could keep more than
    // its cell — a relay's own earlier phases, or the other relay's: each run
    // of four writes over the two relays, on each table made each way, against
    // the cells above folded over the same writes, read after every write — what
    // it answered, and the phase each relay holds. Four writes reach every row
    // of either table by every path that does not revisit a phase, and write
    // once more over it. Its control is the same walk against cells that say
    // `refused` overwrites `complete`, which must disagree.
    const historiesOf = <Phase extends RelayPhase | BackwardPhase>(
      phases: readonly Phase[],
      initial: Phase,
      cells: Record<string, string[]>,
      made: 'from a list' | "from a table's keys"
    ) => {
      const step = (current: string, incoming: Phase) => {
        const label = cells[current]?.[phases.indexOf(incoming)] ?? `no cell for ${current}`;
        return label.startsWith('kept ')
          ? { holds: label.slice('kept '.length), answered: undefined }
          : { holds: label, answered: label };
      };
      const writes = [CELL, BESIDE].flatMap((url) => phases.map((phase) => [url, phase] as const));
      const named = (url: string) => (url === CELL ? 'cell' : 'beside');
      const disagreements: string[] = [];
      let histories = 0;
      const walk = (history: (readonly [string, Phase])[]): void => {
        if (history.length < 4) {
          for (const write of writes) walk([...history, write]);
          return;
        }
        histories += 1;
        const list = [CELL, BESIDE];
        const table = phaseTable(
          made === 'from a list' ? list : phaseTable(list, initial).keys(),
          initial
        );
        const folded: Record<string, string> = { [CELL]: initial, [BESIDE]: initial };
        for (const [at, [url, incoming]] of history.entries()) {
          const { holds, answered } = step(folded[url] ?? '', incoming);
          folded[url] = holds;
          const moved = table.write(url, incoming);
          const read = [String(table.get(CELL)), String(table.get(BESIDE))];
          if (moved === answered && read[0] === folded[CELL] && read[1] === folded[BESIDE])
            continue;
          const path = history
            .slice(0, at + 1)
            .map(([one, phase]) => `${named(one)} ${phase}`)
            .join(' → ');
          disagreements.push(
            `${path}: answered ${moved ?? 'nothing'}, holds ${read.join(', ')}; the cells say ${answered ?? 'nothing'}, ${folded[CELL] ?? ''}, ${folded[BESIDE] ?? ''}`
          );
          return;
        }
      };
      walk([]);
      return { histories, disagreements: disagreements.slice(0, 3) };
    };
    const histories = {
      forward: {
        list: historiesOf(RELAY_PHASES, 'pending', forwardCells, 'from a list'),
        keys: historiesOf(RELAY_PHASES, 'pending', forwardCells, "from a table's keys")
      },
      backward: {
        list: historiesOf(BACKWARD_PHASES, 'pending', backwardCells, 'from a list'),
        keys: historiesOf(BACKWARD_PHASES, 'pending', backwardCells, "from a table's keys")
      },
      control: historiesOf(
        BACKWARD_PHASES,
        'pending',
        {
          ...backwardCells,
          complete: ['kept complete', 'kept complete', 'kept complete', 'refused', 'kept complete']
        },
        'from a list'
      ).disagreements[0]
    };
    const none = (count: number) => ({ histories: count, disagreements: [] });
    // **And the source the rule is written in** (`theRuleAsWritten`), for what
    // no history reaches: a write that kept more than its cell — a count of the
    // writes, a relay's url — or a table made by hand and recorded as made
    // answers every history above, and so does a rule whose tokens are as
    // written but whose names the module binds itself. Its controls are the
    // same source with each breach put in: a write that remembers, a table
    // recorded as made by hand, the absorbing states changed after the fact, the
    // rule rebound, the constructor held as a value, a determined state read
    // other than by `has`, a binding of the same spelling in a scope of its
    // own, a string evaluated as code, a declarator beside one of the rule's,
    // the host's `undefined` and constructors bound in the module four ways, a
    // table made other than as written, a table made as written in a closure
    // while one made through an alias of the constructor is handed over, the
    // witnesses rebound before the handover or in a parameter's default, the
    // machine itself rebound, and a name the handover reads declared again.
    const machine = readFileSync('src/lib/v1/machine.ts', 'utf8');
    const readCell = '      const current = phases.get(url);\n';
    const minted = 'const MINTED = new WeakSet<object>();';
    const [forwardTable, backwardTable] = THE_TABLES;
    const appended = (line: string) => `${machine}\n${line}\n`;
    const controls = {
      'a write that remembers': machine.replace(
        readCell,
        `${readCell}      if (current === 'active') void url;\n`
      ),
      'a table recorded as made by hand': appended(
        'MINTED.add(Object.freeze({ write: () => undefined }));'
      ),
      'the absorbing states changed': appended(
        "(ABSORBING as Set<RelayPhase | BackwardPhase>).delete('refused');"
      ),
      'the rule rebound': appended('nextPhase = (current, incoming) => incoming;'),
      'the constructor held as a value': appended('export const tableOf = phaseTable;'),
      'a determined state read other than by has': appended('export const kept = [...DETERMINED];'),
      'a binding of the same spelling': appended(
        'export function spare(): WeakSet<object> {\n  const MINTED = new WeakSet<object>();\n  return MINTED;\n}'
      ),
      'a string evaluated as code': appended("eval('void 0');"),
      'a declarator beside the rule': machine.replace(minted, `${minted.slice(0, -1)}, SPARE = 0;`),
      'undefined bound in the module': appended('let undefined: undefined = void 0;'),
      'a host constructor substituted': appended(
        'const WeakSet = class extends globalThis.WeakSet<object> {};'
      ),
      'a host constructor imported': `import { Map } from './elsewhere.js';\n${machine}`,
      'a host name hoisted out of a block': appended('{\n  var Set = globalThis.Set;\n}'),
      'a table made other than as written': machine.replace(
        forwardTable,
        "const targets = phaseTable<RelayPhase>([...targetUrls], 'pending');"
      ),
      'the witnesses rebound before the handover': machine.replace(
        THE_WITNESS,
        `witnessTables = rewrap(witnessTables);\n  ${THE_WITNESS}`
      ),
      'the witnesses rebound in a default': machine.replace(
        '  passiveAbort = false,',
        '  passiveAbort = ((witnessTables = rewrap(witnessTables)), false),'
      ),
      'the machine rebound': appended('referenceStream = rewrap(referenceStream);'),
      'a name the handover reads declared again': machine.replace(
        THE_WITNESS,
        `var witnessTables = rewrap();\n  ${THE_WITNESS}`
      ),
      'a table made in a closure and another handed over': `import { 'phaseTable' as tableOf } from './machine.js';\n${machine.replace(
        backwardTable,
        `void (() => {\n    ${backwardTable}\n    return backwardTargets;\n  })();\n  const backwardTargets = tableOf<BackwardPhase>(targets.keys(), 'pending');`
      )}`
    };
    const source = {
      rewritten: [readCell, minted, forwardTable, backwardTable, THE_WITNESS].map(
        (text) => machine.split(text).length - 1
      ),
      shipped: theRuleAsWritten(machine),
      controls: Object.fromEntries(
        Object.entries(controls).map(([name, text]) => [name, theRuleAsWritten(text).breaches])
      )
    };
    expect(
      { forced, lost, forward, rule, histories, source },
      'a determined relay keeps its first state, and the backlog names the relays it lost and no other'
    ).toEqual({
      forced: {
        answered: reading(['settled'], ['b'], held(neverLive, { a: 'complete', b: 'ended' })),
        silent: reading(['settled'], ['b'], held(neverLive, { a: 'complete', b: 'ended' }))
      },
      lost: {
        answered: reading(
          ['refused forward', 'event', 'legEnded', 'settled'],
          ['b'],
          held(bothStopped, { a: 'complete', b: 'ended' })
        ),
        refused: reading(
          ['refused forward', 'refused backward', 'event', 'legEnded', 'settled'],
          ['b'],
          held(bothStopped, { a: 'refused', b: 'ended' }),
          ['refused', 'ended']
        ),
        nothing: reading(
          ['refused forward', 'event', 'legEnded', 'settled'],
          ['a', 'b'],
          held(bothStopped, { a: 'ended', b: 'ended' })
        )
      },
      forward: {
        asked: true,
        back: true,
        open: [1, 1],
        shape: ['settled', 'refused forward', 'legEnded'],
        named: ['a', 'b'],
        held: held(bothStopped, { a: 'complete', b: 'complete' })
      },
      rule: {
        forward: { list: forwardCells, keys: forwardCells },
        backward: { list: backwardCells, keys: backwardCells }
      },
      histories: {
        forward: { list: none(4 ** 4 * 2 ** 4), keys: none(4 ** 4 * 2 ** 4) },
        backward: { list: none(5 ** 4 * 2 ** 4), keys: none(5 ** 4 * 2 ** 4) },
        control:
          'cell pending → cell pending → cell complete → cell refused: answered nothing, holds complete, pending; the cells say refused, refused, pending'
      },
      source: {
        rewritten: [1, 1, 1, 1, 1],
        shipped: {
          declared: [
            'DETERMINED',
            'ABSORBING',
            'nextPhase',
            'MINTED',
            'isPhaseTable',
            'phaseTable'
          ],
          host: [
            'Map',
            'Object',
            'Set',
            'WeakSet',
            'add',
            'entries',
            'freeze',
            'get',
            'has',
            'keys',
            'map',
            'set',
            'undefined',
            'values'
          ],
          made: ['targets', 'backwardTargets'],
          handover: [
            'backwardTargets: a statement',
            'phaseTable: the rule',
            'targetUrls: a parameter',
            'targets: a statement',
            'witnessTables: a parameter'
          ],
          read: 3,
          breaches: []
        },
        controls: {
          'a write that remembers': [
            "phaseTable departs from the rule as written: 'active' where the rule has undefined"
          ],
          'a table recorded as made by hand': [
            'MINTED outside the rule: MINTED.add(Object.freeze({ write: () => undefined }));'
          ],
          'the absorbing states changed': [
            "ABSORBING outside the rule: (ABSORBING as Set<RelayPhase | BackwardPhase>).delete('refused');"
          ],
          'the rule rebound': [
            'nextPhase outside the rule: nextPhase = (current, incoming) => incoming;'
          ],
          'the constructor held as a value': [
            'phaseTable outside the rule: export const tableOf = phaseTable;'
          ],
          'a determined state read other than by has': [
            'DETERMINED outside the rule: export const kept = [...DETERMINED];'
          ],
          'a binding of the same spelling': [
            'MINTED outside the rule: const MINTED = new WeakSet<object>();',
            'MINTED outside the rule: return MINTED;'
          ],
          'a string evaluated as code': ["eval outside the rule: eval('void 0');"],
          'a declarator beside the rule': [
            'MINTED departs from the rule as written: , where the rule has ;'
          ],
          'undefined bound in the module': [
            'undefined in phaseTable is bound outside the rule: let undefined: undefined = void 0;'
          ],
          'a host constructor substituted': [
            'WeakSet in MINTED is bound outside the rule: const WeakSet = class extends globalThis.WeakSet<object> {};'
          ],
          'a host constructor imported': [
            "Map in phaseTable is bound outside the rule: import { Map } from './elsewhere.js';",
            'get in phaseTable is bound to nothing',
            'has in phaseTable is bound to nothing',
            'keys in phaseTable is bound to nothing',
            'values in phaseTable is bound to nothing',
            'entries in phaseTable is bound to nothing',
            'set in phaseTable is bound to nothing'
          ],
          'a host name hoisted out of a block': [
            'Set in DETERMINED is bound outside the rule: var Set = globalThis.Set;',
            'Set in ABSORBING is bound outside the rule: var Set = globalThis.Set;'
          ],
          'a table made other than as written': [
            "const targets = phaseTable<RelayPhase>(targetUrls, 'pending'); is written 0 times among referenceStream's own statements",
            "targets in const backwardTargets = phaseTable<BackwardPhase>(targets.keys(), 'pending'); is bound to const targets = phaseTable<RelayPhase>([...targetUrls], 'pending');",
            "targets in witnessTables?.(targets, backwardTargets); is bound to const targets = phaseTable<RelayPhase>([...targetUrls], 'pending');",
            "phaseTable outside the rule: const targets = phaseTable<RelayPhase>([...targetUrls], 'pending');"
          ],
          'the witnesses rebound before the handover': [
            'witnessTables outside the handover: witnessTables = rewrap(witnessTables);'
          ],
          'the witnesses rebound in a default': [
            'witnessTables outside the handover: export async function* referenceStream({'
          ],
          'the machine rebound': [
            'referenceStream outside its declaration: referenceStream = rewrap(referenceStream);'
          ],
          'a name the handover reads declared again': [
            'witnessTables in witnessTables?.(targets, backwardTargets); is bound to export async function* referenceStream({ | var witnessTables = rewrap();'
          ],
          'a table made in a closure and another handed over': [
            "const backwardTargets = phaseTable<BackwardPhase>(targets.keys(), 'pending'); is written 0 times among referenceStream's own statements",
            "backwardTargets in witnessTables?.(targets, backwardTargets); is bound to const backwardTargets = tableOf<BackwardPhase>(targets.keys(), 'pending');",
            "phaseTable outside the rule: const backwardTargets = phaseTable<BackwardPhase>(targets.keys(), 'pending');"
          ]
        }
      }
    });
  }, 30_000);

  // @contracts A5-C19
  it('DT3: a backlog the dependency completes with a relay outstanding times out without the request’s timer', async () => {
    // **Internal**: the dependency's own EOSE timer is what ends the wait, and
    // the provider's factory takes no such timer (`TC1`), so a client of the
    // arm's own is built with it at 40 ms, against the request's ten seconds,
    // and handed to the machine directly. The relay is asked and says nothing —
    // no `EOSE`, no `CLOSED`, no socket death — so when rx-nostr completes the
    // backward subscription the relay is still undetermined, and the table is
    // the only thing left that can call the answer incomplete. **This is the
    // one trace where that source of `timeout` holds alone**: everywhere else
    // the request's timer draws the boundary too, or the answer is `complete`.
    //
    // **Read whole.** The chunk sequence is the settle and nothing else — no
    // refusal, no leg end, no event that could have determined the relay or
    // added a cause — and the outcome is exact, its error absent: no relay was
    // recorded gone.
    //
    // **And when it arrived, on a fake clock** advanced a millisecond at a time
    // from the moment the machine was started. The dependency's timer starts no
    // earlier than that, so an answer before 40 ms is not the dependency's and
    // can only be a timer of the request's own, however short it was made; an
    // answer after 200 ms is the request's ten seconds or nothing. "Within two
    // seconds" said only that it was quick.
    //
    // **Twice: once with the request's timer and once without it.** The window
    // alone cannot tell the dependency from a request timer that was cut to
    // 40 ms while the completion was dropped — both answer at 40 ms, with the
    // same chunks. The machine arms no timer of its own when `timeoutMs` is
    // absent, so the run without it can only be answered by the dependency,
    // and the two runs must read the same.
    const run = async (timeoutMs: number | undefined) => {
      vi.useFakeTimers({ toFake: [...FAKED] });
      const url = nextUrl();
      const { rxNostr, server } = createTestRelay(url, { eoseTimeout: DEPENDENCY_EOSE_MS });
      const relay = relayOn(server);
      const transport = permanentTransport(rxNostr);
      const ac = new AbortController();
      const began = Date.now();
      const { chunks, done } = driven({
        verifyEvent: acceptAnyEvent,
        transport,
        targets: requestTargets(transport, undefined),
        filters: [{ kinds: [1] }],
        live: false,
        reqIdBase: `dt3-${String(timeoutMs)}`,
        signal: ac.signal,
        timeoutMs
      });
      try {
        let settledAt: number | undefined;
        for (let spent = 0; spent < 200 && settledAt === undefined; spent += 1) {
          await vi.advanceTimersByTimeAsync(1);
          if (chunks.some((chunk) => chunk.type === 'settled')) settledAt = Date.now() - began;
        }
        return {
          asked: relay.reqs().length,
          notBeforeTheDependency: settledAt !== undefined && settledAt >= DEPENDENCY_EOSE_MS,
          shape: chunks.map((chunk) => chunk.type),
          settled: chunks.find((chunk) => chunk.type === 'settled')
        };
      } finally {
        ac.abort();
        vi.useRealTimers();
        await done;
        rxNostr.dispose();
      }
    };
    const reading = {
      asked: 1,
      notBeforeTheDependency: true,
      shape: ['settled'],
      settled: {
        type: 'settled',
        end: { kind: 'incomplete', causes: ['timeout'], error: undefined }
      }
    };
    expect(
      { timed: await run(10_000), untimed: await run(undefined) },
      'the relay left undetermined is the timeout, and the timer is not'
    ).toEqual({ timed: reading, untimed: reading });
  });

  // @contracts A5-C29
  it('DT4: a relay that answered and then closed its subscription has answered, however the frames fall', async () => {
    // **Each arrangement differs from its neighbour in one thing**: live or
    // not, the two frames in one task or a task apart, and another relay still
    // answering or none. `EOSE` determines the relay, so the `CLOSED` behind it
    // is no cause, and it is published where it is still routed. With a second
    // relay the reading is taken twice, because a request can only show what
    // the first relay did while the second holds the backlog open.
    //
    // **The control is the same frames the other way round**, where the
    // `CLOSED` is what determined the relay and the answer is `refused`. An arm
    // that never reached a refusal would read the same without it.
    const backlog = (namespace: string): ReqPlan => ({
      kind: 'request',
      descriptor: { filters: [{ kinds: [1] }], settleTimeoutMs: 30_000, namespace }
    });
    const asked = (relay: Relay): Promise<boolean> =>
      until(() => relay.reqs().some((subId) => subId.includes('-b:')), 3000);
    type Frames = (relay: Relay) => void | Promise<void>;
    const oneTask: Frames = (relay) => {
      relay.answerBacklog();
      relay.refuseBacklog();
    };
    const aTaskApart: Frames = async (relay) => {
      relay.answerBacklog();
      await delay(0);
      relay.refuseBacklog();
    };
    const theOtherWayRound: Frames = (relay) => {
      relay.refuseBacklog();
      relay.answerBacklog();
    };
    const alone = (plan: ReqPlan, frames: Frames): Promise<unknown> => {
      const a = relayAt(nextUrl());
      const labels = { a: a.url };
      return published([a], plan, async (handle) => {
        await asked(a);
        await frames(a);
        await delay(100);
        return readingOf(handle(), labels);
      });
    };
    const beside = (plan: ReqPlan, frames: Frames): Promise<unknown> => {
      const a = relayAt(nextUrl());
      const b = relayAt(nextUrl());
      const labels = { a: a.url, b: b.url };
      return published([a, b], plan, async (handle) => {
        await asked(a);
        await asked(b);
        await frames(a);
        await delay(100);
        const meanwhile = readingOf(handle(), labels);
        b.answerBacklog();
        await delay(100);
        return { meanwhile, afterwards: readingOf(handle(), labels) };
      });
    };
    const observed = {
      alone: {
        oneTask: await alone(backlog('dt4-alone-one'), oneTask),
        aTaskApart: await alone(backlog('dt4-alone-apart'), aTaskApart),
        live: await alone(live('dt4-alone-live'), oneTask),
        liveATaskApart: await alone(live('dt4-alone-live-apart'), aTaskApart),
        theOtherWayRound: await alone(backlog('dt4-alone-reversed'), theOtherWayRound)
      },
      beside: {
        oneTask: await beside(backlog('dt4-beside-one'), oneTask),
        aTaskApart: await beside(backlog('dt4-beside-apart'), aTaskApart),
        theOtherWayRound: await beside(backlog('dt4-beside-reversed'), theOtherWayRound)
      }
    };
    const read = { events: [], causes: undefined, legEnded: undefined, named: undefined };
    const answered = (activity: string, refusals: string[]) => ({
      ...read,
      status: 'settled',
      activity,
      refusals
    });
    const told = ['backward a'];
    const refused = {
      ...read,
      status: 'incomplete',
      causes: ['refused'],
      activity: 'idle',
      refusals: told
    };
    const meanwhile = { ...read, status: 'streaming', activity: 'refreshing', refusals: told };
    expect(
      observed,
      'a relay that answered first has answered, whatever follows; one that refused first has refused'
    ).toEqual({
      alone: {
        oneTask: answered('idle', told),
        // The request has ended and let go of the channel, so nothing is
        // routed to publish.
        aTaskApart: answered('idle', []),
        live: answered('live', told),
        liveATaskApart: answered('live', told),
        theOtherWayRound: refused
      },
      beside: {
        oneTask: { meanwhile, afterwards: answered('idle', told) },
        aTaskApart: { meanwhile, afterwards: answered('idle', told) },
        theOtherWayRound: { meanwhile, afterwards: refused }
      }
    });
  });

  // @contracts A5-C27
  it('DT5: one relay gone and one silent at the timer: both causes, both asked, and the backlog names the gone one', async () => {
    // **Internal**, because which relay a backlog lost is published nowhere:
    // `GN7` reads the causes through the published entry. b's status is reported
    // `rejected` when the attempt begins, which is the `ended` half, and its
    // socket is open, so it is asked all the same; a is asked and stays silent
    // until the request's own timer, which is the `timeout` half. `a` being
    // named would be a silence taken for a loss.
    const aUrl = nextUrl();
    const bUrl = nextUrl();
    const { rxNostr, server } = createTestRelay(aUrl);
    const a = relayOn(server);
    const b = relayOn(new WS(bUrl, { jsonProtocol: true }));
    rxNostr.setDefaultRelays([aUrl, bUrl]);
    const transport = permanentTransport(rxNostr);
    const targets = requestTargets(transport, undefined);
    const spelled = (url: string): string => targets.find((each) => each.startsWith(url)) ?? url;
    rxNostr.getAllRelayStatus = () =>
      ({
        [spelled(aUrl)]: { connection: 'connected' },
        [spelled(bUrl)]: { connection: 'rejected' }
      }) as ReturnType<typeof rxNostr.getAllRelayStatus>;
    const ac = new AbortController();
    let tables: Tables | undefined;
    const { chunks, done } = driven({
      verifyEvent: acceptAnyEvent,
      transport,
      targets,
      filters: [{ kinds: [1] }],
      live: false,
      reqIdBase: 'dt5',
      signal: ac.signal,
      timeoutMs: 300,
      witnessTables: (forward, backward) => {
        tables = { forward, backward };
      }
    });
    try {
      const askedBoth = await until(() => a.reqs().length >= 1 && b.reqs().length >= 1, 2000);
      await Promise.race([done, delay(3000)]);
      const labels = { a: aUrl, b: bUrl };
      expect(
        { askedBoth, ...recordOf(chunks, labels), backward: heldBy(tables, labels)?.backward },
        'both causes, and the one relay that was gone'
      ).toEqual({
        askedBoth: true,
        shape: ['settled'],
        kind: 'incomplete',
        causes: ['timeout', 'ended'],
        named: ['b'],
        backward: { a: 'active', b: 'ended' }
      });
    } finally {
      ac.abort();
      await done;
      rxNostr.dispose();
    }
  });

  // @contracts A5-C28
  it('DT6: a relay that answered is not named beside one that then died', async () => {
    // **Internal**, for the reason `DT5` is: `GN8` reads the causes, and a
    // relay that answered and is counted as lost adds `ended`, which the relay
    // that died has already added, so no published reading can tell them
    // apart. The two deaths `GN8` takes: the socket closed with 4000, and
    // dropped with retries off, so the connection is left in `error`.
    const died = async (name: string, go: (relay: ReturnType<typeof relayOn>) => void) => {
      const aUrl = nextUrl();
      const bUrl = nextUrl();
      const { rxNostr, server } = createTestRelay(aUrl);
      const a = relayOn(server);
      const b = relayOn(new WS(bUrl, { jsonProtocol: true }));
      rxNostr.setDefaultRelays([aUrl, bUrl]);
      const transport = permanentTransport(rxNostr);
      const ac = new AbortController();
      let tables: Tables | undefined;
      const { chunks, done } = driven({
        verifyEvent: acceptAnyEvent,
        transport,
        targets: requestTargets(transport, undefined),
        filters: [{ kinds: [1] }],
        live: false,
        reqIdBase: `dt6-${name}`,
        signal: ac.signal,
        timeoutMs: 10_000,
        witnessTables: (forward, backward) => {
          tables = { forward, backward };
        }
      });
      try {
        const askedBoth = await until(() => a.reqs().length >= 1 && b.reqs().length >= 1, 2000);
        a.answerBacklog();
        await delay(50);
        go(b);
        await Promise.race([done, delay(3000)]);
        const labels = { a: aUrl, b: bUrl };
        return {
          askedBoth,
          ...recordOf(chunks, labels),
          backward: heldBy(tables, labels)?.backward
        };
      } finally {
        ac.abort();
        await done;
        rxNostr.dispose();
      }
    };
    const reading = {
      askedBoth: true,
      shape: ['settled'],
      kind: 'incomplete',
      causes: ['ended'],
      named: ['b'],
      backward: { a: 'complete', b: 'ended' }
    };
    expect(
      {
        refused: await died('refused', (relay) => {
          relay.refuse();
        }),
        dropped: await died('dropped', (relay) => {
          relay.shut();
        })
      },
      'the relay that died, and not the one that answered'
    ).toEqual({ refused: reading, dropped: reading });
  });
});
