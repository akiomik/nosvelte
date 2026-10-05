/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * C6: what the provider owns.
 *
 * The library currently keeps its client in a module-level writable, which is
 * one per process. That breaks server rendering (two requests share it), tests
 * (one suite's provider leaks into the next) and any page with two providers —
 * and it is what makes a hook called after teardown throw from inside rx-nostr
 * rather than degrade.
 *
 * Three separate gaps in the design all reduced to there being no owner: the
 * query client was constructed and never disposed (#77), the relay scope could
 * drift because whoever held the client could change it behind the scope's back,
 * and the engine took its client from a context nothing put it in. They are
 * one gap, and this is it.
 *
 * The rule is that the provider creates what it owns. Not *receives* — creates.
 * A scope handed a client it does not own can only ask that nobody else touches
 * it, which is a comment rather than a guarantee; a scope whose client came into
 * existence here is the only thing holding a reference to it.
 */

import type Nostr from 'nostr-typedef';
import type { RxNostr, RxNostrConfig } from 'rx-nostr';
import { createRxNostr } from 'rx-nostr';
import { verifier } from 'rx-nostr-crypto';
import { getContext, setContext } from 'svelte';
import type { QueryClient } from 'tanstack-svelte-query-v6';

import type { AttemptRegistry } from './attempt.js';
import { createAttemptRegistry } from './attempt.js';
import { createOwnedQueryClient } from './client.svelte.js';
import type { ClockOptions, ExpiryClock } from './clock.svelte.js';
import { createExpiryClock, serverClockOptions } from './clock.svelte.js';
import type { RelayDiagnosticsController } from './diagnostics.svelte.js';
import { createRelayDiagnostics } from './diagnostics.svelte.js';
import type { TransportCapability } from './lease.js';
import { ownTransport } from './lease.js';
import { LIBRARY_EOSE_TIMEOUT_MS, LIBRARY_OK_TIMEOUT_MS } from './normalize.js';
import { providerDisposed } from './own.js';
import { hardenOwned, ownedByLibrary } from './owned.js';
import type { ResumeHints } from './resume.svelte.js';
import { createResumeHints } from './resume.svelte.js';
import type { RelayInput, RelayScope, TransportKeys } from './scope.svelte.js';
import { createRelayScope, RelayConfigurationError } from './scope.svelte.js';
import type { NostrSigner } from './send.svelte.js';

const KEY = Symbol('nosvelte');

/**
 * What the framework's context is allowed to hold: a name, and no authority.
 *
 * **The key was never what kept this private, and a reviewer measured it.**
 * `getAllContexts()` is a public Svelte export, and it hands a component a `Map`
 * **seeded from its parent's** — `component_context.c ??= new Map(get_parent_context(...))`,
 * read at svelte 5.56.8. The map is the child's own, so a descendant cannot
 * write into the provider's; the entries are the parent's **values by
 * reference**, which is all it needs. A descendant that has never imported
 * {@link KEY} can walk `values()` and take whatever is in there.
 *
 * **The sentence here said "the parent's map itself, not a copy" and an outside
 * reviewer read the dependency.** The leak is what it was; the mechanism was
 * wrong, and it had been written into a contract row. What was in there was the
 * provider's whole state: driven through a real Svelte tree, a component that
 * knew nothing about this library called `getAllRelayStatus()` on the provider's
 * live client and held `transportLease` and `setRelays` besides.
 *
 * That is the same defect the transport capability was rebuilt for, one level
 * *above* it: no projection of what an operation answers matters while the
 * client itself is one `values()` call away. So the map holds a token that
 * carries nothing, and the state is reachable only from this module, through a
 * `WeakMap` keyed by that token. A descendant that finds the token finds an
 * object with one string on it.
 *
 * **The submission said the opposite, twice** — "`public-entry.ts` exports no
 * way to reach a context, so a v1 consumer has no path to it either" — and
 * `WR27` classified `rxNostr` as `not-a-request-seam` on that reason. The path
 * was the framework's, not this library's exports. `WR29` is the arm, and it
 * runs under Svelte rather than under the suite's stand-in for it, because the
 * stand-in answers "nothing leaks" to every version of this module: `setup.ts`
 * spreads the real module and replaces `getContext`/`setContext` only, so the
 * genuine `getAllContexts` is there and reads a map the stand-in never writes
 * to. The reason matters because it is the reason a *future* mock of one more
 * function would hide something else.
 */
interface ProviderToken {
  readonly nosvelte: 'provider';
}

/**
 * The provider state, held where only this module can reach it.
 *
 * Weak on the token, so a provider whose subtree is gone is collectable: the
 * token lives in the framework's context map and nowhere else this library
 * keeps.
 */
const HELD = new WeakMap<ProviderToken, NostrContext>();

/** The state this token stands for, or `undefined` — never the token itself. */
function heldBy(token: unknown): NostrContext | undefined {
  // **No shape test, because `WeakMap.get` is one.** A guard stood here reading
  // `typeof token === 'object' && token !== null`, and an outside reviewer
  // measured both of its arms unreachable: `get` answers `undefined` for a key
  // that is not an object rather than throwing, so the guard could only ever
  // agree with it. An entranceless branch is deleted here.
  return HELD.get(token as ProviderToken);
}

/**
 * Everything a provider owns whichever side it is rendering on.
 *
 * The two fields that are *not* here — {@link NostrContext}'s `environment` and
 * `rxNostr` — are the pair that differs, and they are one fact rather than two:
 * a provider rendering on a server has no transport at all. Splitting them off
 * onto the arms below is what makes that unrepresentable rather than merely
 * true, and the falsifier is a compile error — `context.rxNostr.dispose()` on
 * an un-narrowed context does not build.
 */
export interface NostrContextCommon {
  /**
   * The signature gate this provider's requests run through.
   *
   * Here rather than inside the client, and the pair is one decision: the client
   * is built with `skipVerify: true` *because* this exists, and this exists
   * because verification inside the dependency sits behind an `await` that no
   * barrier of ours can see past. Splitting them — a client that verifies and a
   * gate that also does, or neither — is either double work or a client that
   * trusts the wire. See `referenceStream`'s `verifyEvent`.
   */
  readonly verifyEvent: (event: Nostr.Event) => Promise<boolean>;
  /**
   * The signer `useSend` signs an unsigned input with, or `undefined` when the
   * provider was given none — in which case an unsigned input is refused with
   * `'no-signer'` and an already-signed event still goes out.
   *
   * **The consumer's object, held and called, never copied or frozen.** It is
   * typically `window.nostr`, which an extension may install after the page
   * loads, so `signEvent` is read at the moment of each send rather than
   * captured here.
   */
  readonly signer: NostrSigner | undefined;
  readonly client: QueryClient;
  readonly scope: RelayScope;
  /**
   * The clock the public read model is projected against (NIP-40).
   *
   * One per provider, so a test can hold it still and the server can be fixed
   * at the instant of the request. It takes no part in cache identity, and
   * **nothing it says reaches the stored value at all**: the fold is a function
   * of the events seen and so is the bound, which ranks by recency rather than
   * by expiry — and not by arrival, which is the order a cap would have to read
   * to break the ordering laws at every instant. So a bounded set is order-independent full stop, bounded or not
   * — the qualifier this paragraph used to carry ("at a fixed sampled instant,
   * and not across a moving one") belonged to a bound that read a clock, and
   * there is no longer one.
   *
   * What the clock decides is what is *shown*: the projection hides an entry
   * whose deadline has passed and shows it again if the clock is corrected.
   * One reader of the NIP-40 tag, one point of application.
   */
  readonly clock: ExpiryClock;
  /**
   * Where the ids of this provider's attempts come from (A6).
   *
   * Here for the reason everything else here is: the counter it replaces was a
   * module global, so two providers — two server-rendered requests, two test
   * suites — issued ids from one sequence. Nothing was wrong with the *ids* that
   * produced; what was wrong is that "who owns the attempt" was answered by
   * whichever module happened to hold the variable, which is the same accident
   * as the module-level client.
   */
  readonly attempts: AttemptRegistry;
  /**
   * The host hints that bring a pending recovery forward.
   *
   * On the provider because the listeners are, and a listener is a resource
   * `C6` gives the provider. A request reads the generation; nothing subscribes
   * to anything.
   */
  readonly resume: ResumeHints;
  /**
   * The relay diagnostics, which the provider owns because it owns the socket.
   *
   * **Here rather than in the hook, and that is the whole of the change.** The
   * `NOTICE` subscription and the record it fills used to be built per
   * `useRelayDiagnostics()` call, so what a panel could see depended on when the
   * panel was opened — and a panel is opened *after* a relay misbehaves.
   * Constructed here, the subscription starts with the provider, records with no
   * hook mounted, and ends when the provider does. `createRelayDiagnostics`
   * carries the lifetime this gives `lastNotice`, clause by clause.
   */
  readonly diagnostics: RelayDiagnosticsController;
  /**
   * The last relay list this provider refused, until one is accepted (C16).
   *
   * **Here because a refused list has no relay to key it under.** The
   * diagnostics map is one row per relay in the scope, and the scope is
   * precisely what a refusal did not produce — so this rides beside the map
   * rather than in it, and `useRelayDiagnostics` publishes it that way.
   *
   * `undefined` until something is refused, and `undefined` again the moment a
   * list is accepted. Nothing else clears it **while the provider is alive**: a
   * refusal that is cleared by a later *refusal* would report the wrong cause,
   * and one cleared by a read would be a message a consumer can miss by not
   * looking. The provider's own teardown does clear it, with the rest of the
   * record — that is `C-δ-C9`, and the qualifier is here because without it two
   * records said opposite things about the same field.
   *
   * **A getter over the diagnostics' own cell, not a second one.** The two
   * things a diagnostics panel reads have one owner now; this is the name the
   * provider publishes it under, kept because a refusal riding *beside* the map
   * is what C16 decided and because `setRelays`'s siblings are context fields.
   */
  readonly configurationError: RelayConfigurationError | undefined;
  /**
   * Move the relay set — and **do not throw if the move is refused**.
   *
   * This is what `NostrApp.relays` is applied through, which is the whole of
   * why it does not throw. The prop is read in an `$effect`, and Svelte's error
   * boundary answers a throw from an effect by destroying the subtree it
   * guards: measured at 5.56.8 (`CF6`), the provider is torn down, its
   * `$effect` teardown disposes the client, and the `failed` snippet replaces
   * the tree. So "the previous generation and the client stay" and "the update
   * throws" cannot both be true, and 0004 C16 keeps the first.
   *
   * **Only a {@link RelayConfigurationError} is caught.** Anything else — a
   * client already disposed, a bug in this library — is not a statement about
   * the relay list and is not something a consumer fixes by editing one, so it
   * goes to the boundary as it would have.
   *
   * The construction path deliberately keeps the throw: there is no previous
   * generation to hold on to, so a provider whose first list is refused has no
   * transport at all and nothing it could serve.
   */
  setRelays(relays: readonly RelayInput[]): void;
}

/**
 * A provider rendering in a browser: it owns a live transport.
 *
 * `rxNostr` is the connection C6 says the provider creates rather than
 * receives, and it is released with the provider's own lifetime — an `$effect`
 * teardown, which the client compiler emits and the server compiler does not.
 * That asymmetry is the whole reason this arm and {@link ServerNostrContext}
 * are two types.
 */
export interface BrowserNostrContext extends NostrContextCommon {
  readonly environment: 'browser';
  readonly rxNostr: RxNostr;
  /**
   * The same transport, as a capability this provider can take back.
   *
   * **A request that holds the client cannot be told the owner is gone.** The
   * machine used to be handed `rxNostr` itself, so the only way to learn that
   * this provider had disposed it was to use it and catch what rx-nostr threw —
   * a check-then-use with a window in between, arriving as the dependency's
   * exception rather than as anything this library could classify. `lease.ts`
   * says why a guard on a shared object is not an answer to that.
   *
   * `rxNostr` stays beside it because the diagnostics axis and the relay scope
   * are this provider's own readers, inside its own lifetime; what travels to a
   * request is the lease.
   */
  readonly transportLease: TransportCapability;
}

/**
 * A provider rendering on a server: **there is no transport, and there is no
 * field to put one in**.
 *
 * A12 has already removed the only use a connection has here — no REQ is sent
 * on the server — so what a live client bought was nothing, and what it cost
 * was a resource the render did not release: the release is an `$effect`
 * teardown and Svelte's server compiler emits no `$effect` at all, so
 * `dispose()` never ran. Measured against the resolved rx-nostr: five clients
 * given one relay each and left undisposed hold five `Timeout` handles, and
 * disposing them clears all five. One per server render, until it fires.
 *
 * **Not "unreachable", which is what this said and is a stronger claim than
 * what was measured.** `onDestroy` runs under `svelte/server`, so a release
 * could have been written; what it does not survive is a child that throws,
 * because the renderer cleans up only after a subtree renders successfully.
 * That was measured **on a tree changed for the measurement** — the provider
 * made to build a transport unconditionally and release it in an `onDestroy` —
 * and `SS3`/`SS4` are the pair it was measured through, not arms that can make
 * the claim as shipped: with no transport here they are both trivially even.
 * The reason there is no transport is A12, not the absence of a hook.
 *
 * **"Bounded per render" is not a bound.** One lifetime is finite; the number
 * alive at an instant is concurrent requests times that lifetime, and nothing
 * bounds that.
 *
 * `undefined` rather than absent, so that the discriminant is what narrows and
 * a reader who has not narrowed gets a compile error rather than a `?.`.
 */
export interface ServerNostrContext extends NostrContextCommon {
  readonly environment: 'server';
  readonly rxNostr: undefined;
  /** No transport, so no lease — the same `undefined` for the same reason. */
  readonly transportLease: undefined;
}

/**
 * Which side this provider is rendering on (A12, A-δ) — and, because they are
 * one fact, whether it has a transport.
 *
 * A provider fact rather than a per-request one, and it was a per-request one:
 * the engine took `environment` as an option defaulting to `'browser'`, so
 * "the server does not subscribe" held only for a caller who said so. Nothing
 * in the library detected the server at all — which also left A-δ's clock
 * sentence describing an option nobody passed.
 *
 * One provider renders on one side, so this is the level it belongs at, and
 * it is the same shape as the client and the clock: constructed here, read by
 * a request, and not a caller's to supply.
 *
 * **This used to say the clock reads it and nothing else, and that stopped
 * being true.** `useStreamedReq` falls back to `environment` twice — once when
 * it builds the query options and once when it answers "was this request
 * even started" — so a caller who passes nothing gets the provider's
 * detection rather than `'browser'` by default.
 *
 * **The sentence that used to close this paragraph overstated, and it was
 * written in the same session that corrected the one before it.** It said a
 * caller who passes `environment` still wins, so A12 rests on the caller
 * wherever the caller speaks. A caller does win — but on the published
 * surface there is no such caller: `ReqDescriptor` has six fields and none
 * of them is this one, `createNostrContext` is exported by nothing, and the
 * provider's props are `relays` and `children`. **So A12 rests on the
 * detection for every consumer**, and on the caller only for whoever calls
 * the engine directly, which is this spike and nobody else. `0004` names the
 * absence deliberately rather than leaving it to be inferred from this
 * comment.
 *
 * **And "rests on the detection" was true of the value and false of the path
 * to it, for as long as that sentence stood.** Two of the three places the
 * fallback is read run outside a component — `refresh()` and the verifier
 * lookup in the stream function — and the framework's context read *throws*
 * there rather than returning `undefined`. So on the published shape a
 * refresh driven from a click handler rejected on its first statement, and a
 * refetch that was not driven from a reaction turned into an error outcome a
 * consumer could not tell from a relay failure. Measured, and invisible to
 * this suite until a sentinel opted out of the harness's context mock. The
 * repair is that the provider is captured where the hook is built, which is a
 * window the framework does allow, and the two late reads use what was
 * captured. This field is where that option comes from once
 * the published hook exists, and it is here rather than left for then so that
 * the detection has one home rather than two.
 *
 * **A union rather than a `rxNostr?: RxNostr`, and the difference is the
 * decision.** An optional field the server merely does not fill leaves every
 * reader free to write `rxNostr!` and leaves the server branch able to reach a
 * transport; this makes "there is no connection on the server" a thing the
 * compiler enforces at each call site. What it costs is that a consumer who
 * wants the transport has to say which side they are on first, which is the
 * question they were assuming an answer to.
 */
export type NostrContext = BrowserNostrContext | ServerNostrContext;

/**
 * Where this is running, asked once.
 *
 * `typeof window` rather than SvelteKit's `browser`, so the spike's modules
 * stay importable without the framework — the implementation can narrow this to
 * `$app/environment` when it lands, and the decision it carries does not change.
 *
 * **Exported so that the standalone runtime asks the same question.** A request
 * that no provider serves used to take `'browser'` as a library default, which
 * is a fact about a machine rather than a default: on a server it makes the
 * request subscribe, which is the one thing `A12` forbids. Two detections of
 * one fact are two facts waiting to disagree, so there is one and both arms
 * call it.
 */
export function detectEnvironment(): 'browser' | 'server' {
  return typeof window === 'undefined' ? 'server' : 'browser';
}

/**
 * Which side the provider is on, and — because they are one fact — whether it
 * has a transport.
 *
 * **Exported for one reason: so that a check can read it.** It is not on the
 * published entry and `LK6`/`LK7` are what keep it off, so exporting the type
 * from this module widens nothing a consumer can see. The alternative was to
 * pin the *published* context instead and call the two the same union, which is
 * what `CX18` did for an hour — and they are two declarations the compiler ties
 * to each other nowhere. Measured: widening this one's server arm leaves
 * `npm run check` at zero errors and the whole suite green, because nothing
 * reads `transport` in the server branch. That absence is the point of the
 * shape, and it is why the shape needs a check of its own.
 */
export type ProviderRuntime =
  | { readonly environment: 'server'; readonly transport: undefined }
  | { readonly environment: 'browser'; readonly transport: RxNostr };

/**
 * A request with no signature verifier.
 *
 * **Off the request failure channel, and off the published surface too.** It was
 * `internal-failure` on `state.error` — a code whose promise is "this library
 * reached a state it does not classify", for a request whose *call site* is
 * incomplete — and then it was a published class beside
 * {@link MissingProviderError}, on the argument that a consumer catches it.
 *
 * **They cannot, and a reviewer measured why.** It is thrown inside the query
 * function, so the query boundary catches it and what a consumer receives is a
 * copy with `code: 'unspecified'` and the class name in `thrownName`; `LC4`
 * asserts exactly that. And the published hook takes its verifier from the
 * provider, so under `NostrApp` there is no path to it at all. A class nobody
 * can catch as a class is not a construction-time error a consumer meets; it is
 * this library's own invariant, and exporting its name bought a permanent
 * surface for nothing.
 *
 * A port whose provider owns the verifier by construction makes it unreachable,
 * which is the better answer; this seam cannot, because `verifyEvent` is an
 * option a caller may also pass.
 */
export class MissingVerifierError extends Error {
  /** The four members `Error` gives this class, re-declared — see any sibling. */
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  /**
   * Narrowed to what this class can carry: it never sets a `cause`, so the
   * published type says so rather than leaving `Error`'s mutable `unknown`.
   */
  declare readonly cause?: undefined;

  readonly code = 'missing-verifier' as const;

  constructor(message: string) {
    super(message);
    (this as { name: string }).name = 'MissingVerifierError';
    hardenOwned(this);
    Object.freeze(this);
  }
}

export class MissingProviderError extends Error {
  /**
   * The three members `Error` gives this class, re-declared as `readonly`.
   *
   * **`B5-C8` says every member of every published type is `readonly` to the
   * depth a consumer can reach, and inherited members are where that was
   * false**: `message`, `name` and `stack` arrive from `Error`, where they are
   * mutable, so `err.message = '[redacted]'` compiled against the emitted
   * `.d.ts` — legal-looking code the run time refuses, which is the exact
   * failure the sentence exists to prevent. `declare` makes this type-only: the
   * run time is unchanged and the modality reaches the `.d.ts`, which is where
   * `LK17` reads it, over the four classes still exported as values rather than one. (A merged
   * `interface` says the same thing and is what
   * `@typescript-eslint/no-unsafe-declaration-merging` exists to stop.)
   */
  declare readonly message: string;
  declare readonly name: string;
  declare readonly stack?: string;
  /**
   * Re-declared for its siblings' reason, and narrowed to what this class can
   * carry: it never sets a `cause`, so the published type says so rather than
   * leaving `Error`'s mutable `unknown` reachable.
   */
  declare readonly cause?: undefined;

  /**
   * The discriminant, for the case `instanceof` cannot answer.
   *
   * **Published, and this is a decision that was made the other way first.**
   * The class was thrown, tested by name and left off the published list, which
   * is the state a reviewer objected to: consumers were already being asked to
   * recognise it while nothing promised they could. What is promised now is the
   * class *and* a stable code, because the two fail in different places — a
   * duplicate install of this package (two copies in one tree, which pnpm and a
   * monorepo both produce) gives a consumer an object whose prototype is not the
   * one their `instanceof` names, and a string comparison survives it.
   *
   * One literal rather than a union, and the reason is not the count: there are
   * four code namespaces now — `'missing-randomness'`, `'missing-verifier'`,
   * `ReqErrorCode` (which **this** literal joined) and
   * `RelayConfigurationErrorCode` — and they do not share a catch boundary. An
   * earlier wording counted this one twice, as its own namespace *and* as the
   * member it contributed, and dropped `'missing-randomness'` entirely. This said "there is one code
   * today, and a union is a surface to add when there is a second", which was
   * false the moment the second landed; `0004` carries the argument.
   */
  readonly code = 'missing-provider' as const;

  constructor() {
    super(
      'nosvelte: no provider found. Requests are scoped to a provider, which owns the ' +
        'relay connection and the query cache — there is no process-wide fallback, ' +
        'because one would be shared between server-rendered requests and between tests.'
    );
    (this as { name: string }).name = 'MissingProviderError';
    hardenOwned(this);
    Object.freeze(this);
  }
}

/**
 * The seams a test harness needs, enumerated — not the dependency's config.
 *
 * This was `rxNostrConfig?: RxNostrConfig`, the whole of it, spread into
 * `createRxNostr`. Only `eoseTimeout` was overridden afterwards, so
 * `authenticator`, `retry` and `skipExpirationCheck` passed straight through:
 * three of the four options 0004 says the provider takes none of, reaching the
 * connection through the internal factory instead of through a prop. The
 * decision was enforced one level above the place that could break it.
 *
 * Every field here is a divergence a test needs and a reader should be
 * suspicious of; `src/tests/helpers/relay.ts` says what each one turns off in
 * production terms. `skipExpirationCheck` used to be one and is not any more:
 * B7b makes the library set it unconditionally below, so it is not a seam a
 * caller can move — leaving it here would advertise a choice that does not
 * exist. What the library does with the events the dependency would have
 * dropped is a separate decision, and it is *not* to drop them. What is *not* here is the point: an option this list does
 * not name cannot reach the client at all, so a new one upstream is a decision
 * rather than something a caller discovers.
 *
 * **`eoseTimeout` was here for two rounds and is not any more**, and it left for
 * a reason worth writing down, because the argument that put it here is a good
 * one. A-γ gives that timer to the request and the library writes its own value
 * after this spread, so a caller's was always overwritten — and the witness for
 * "the library's value wins" had to be able to pass one, since a seam that
 * *rejects* the input cannot demonstrate that the input loses. That is true of a
 * witness which observes the consequence. It is not true of one that observes the
 * factory call, and `CX14`/`CX15` are that: the value handed to `createRxNostr`
 * is read at the module boundary, so the ordering is measured with nothing
 * declared here for it. A configuration input that exists only to be ignored is
 * still an input a reader has to be told to ignore.
 */
export interface HarnessOverrides {
  /**
   * Accepted and then ignored, on purpose.
   *
   * The library writes `skipVerify: true` last, because the dependency's gate
   * is not the one that runs: `verifyEvent` is. It stays *listed* because a
   * caller reading this list should see that turning the dependency's
   * verification back on is not something they can do. It was a divergence and
   * is now a decision; what a harness needs instead is `verifyEvent`.
   */
  skipVerify?: boolean;
  /** No relay metadata round trip. */
  skipFetchNip11?: boolean;
  /** Production reconnects and re-sends every ongoing REQ; A14 is about this. */
  retry?: NonNullable<RxNostrConfig['retry']>;
  /**
   * How long a send waits for a relay that never answers before calling it
   * `no-response`. Production keeps {@link LIBRARY_OK_TIMEOUT_MS}; a test that
   * stands on the silent relay shortens it rather than waiting thirty seconds.
   */
  okTimeout?: number;
}

/**
 * The live transport, built only where there is something to connect for.
 *
 * A function rather than an expression inside the branch below, and the reason
 * is legibility of the config rather than reuse: this is called from one place.
 * Written inline in a ternary, every option would sit two indents deeper than
 * the decisions written about it.
 *
 * The library's own last, which is the same rule the query options follow: a
 * config the harness supplies may set the skip flags and the retry strategy,
 * and may not move the timer A-γ gives to the request — including one that
 * names the field {@link HarnessOverrides} no longer declares, since a spread
 * does not check for properties a declaration left out. That ordering is what
 * `CX15` measures, and it is the whole of what keeps the value the library's.
 * rx-nostr's `eoseTimeout` completes the backward observable (SEN14) and
 * defaults to 30s, so leaving it alone meant any `settleTimeoutMs` above that
 * was closed by the dependency first — with no EOSE and nothing on the wire to
 * say why. The boundary caps `settleTimeoutMs` below this; see
 * `MAX_SETTLE_TIMEOUT_MS`.
 */
function createLiveTransport(harness: HarnessOverrides | undefined): RxNostr {
  return createRxNostr({
    // **Before the harness spread, unlike the two below.** The library states
    // its own wait for an unanswered send rather than inheriting the
    // dependency's default, so a change upstream is not a change to `C6-C13`;
    // and it is the one value here a harness may move, because standing on the
    // silent relay is otherwise a thirty-second test.
    okTimeout: LIBRARY_OK_TIMEOUT_MS,
    ...(harness ?? {}),
    eoseTimeout: LIBRARY_EOSE_TIMEOUT_MS,
    // **The dependency's NIP-40 gate is off, and that is B7b's decision rather
    // than a convenience.** Leaving it on meant two readings of one tag: it
    // takes `Number(tag[1])` and keeps it when `Number.isInteger`, `expiresAt`
    // requires a non-negative decimal integer, and `expiration: '1e3'` arriving
    // at 999 was admitted by one and read as no deadline by the other — so the
    // event stayed visible for ever, while the same event arriving at 1000 was
    // dropped on the way in. Whether it could be seen depended on when it
    // arrived.
    //
    // Off does **not** mean the library drops them instead: it does not drop
    // them at all. `expiresAt` is the one reading of the tag, and the one place
    // that consults it — the projection — hides rather than discards, so a
    // wrong clock costs visibility and not data. **The retention rule used to
    // be the second consulting place**, and it is not one any more: expiry
    // decides nothing about which entry keeps a slot (B6, B7b), so an event
    // past its deadline is hidden without being outranked. That is the
    // difference between this and the arrival gate that stood here for a round.
    skipExpirationCheck: true,
    // **The dependency does not verify, because this library does.** Written
    // after the harness spread for `eoseTimeout`'s reason — a value the library
    // owns cannot be a value a caller moves — and it is half of one decision
    // whose other half is `verifyEvent` below.
    //
    // rx-nostr runs its verifier inside `use()`, behind an `await`, which puts
    // every event one microtask further from the raw message channel than the
    // settle marker is deferred by: the backward subscription was released
    // before the events **the dependency's own verifier had already passed**
    // were handed downstream, and an EOSE arriving alongside its own event lost
    // that event outright (measured at 3.7.5, `AE1`). That is not a margin to
    // widen. The gate moves to where the count of events still inside it is a
    // number this library holds.
    //
    // **Leaving this alone would be worse than it looks**: `makeRxNostrConfig`
    // defaults `verifier` to `emptyVerifier`, which throws, and `skipVerify` to
    // `false`. A provider that passed neither produced an uncaught rejection per
    // event and a backlog that waited out A-γ with nothing said (`AE8`).
    skipVerify: true
  });
}

/**
 * Create the context. Called once, by the provider, in its own component.
 *
 * Everything here is constructed rather than accepted. That is the difference
 * between the scope leading the client and merely writing to it: nothing outside
 * this function has the client, so `setRelays` really is the only way the relay
 * set moves.
 *
 * The lifetime is the component's. `createOwnedQueryClient` releases its
 * listeners and its cache on teardown, and the connection is disposed with it —
 * so a provider that comes and goes leaves nothing behind, which is the property
 * a module-level store cannot have.
 *
 * **On the server that sentence was false, and it stood here unqualified for
 * several rounds.** The release is an `$effect` teardown and Svelte's server
 * compiler emits no `$effect` at all, so `rxNostr.dispose()` was unreachable
 * there — while the accepted path wrote the relay list through to the transport
 * during construction, which is what arms the timer. The repair is not a second
 * release: **the server does not create a live transport at all.** A12 has
 * already removed the only use one has there, so nothing is bought by it, and a
 * resource that outlives the render contradicts C6 — the provider owns the
 * connection and frees it with its own lifetime.
 *
 * So the order below is the decision, and it reads in that order:
 *
 * 1. **which side this is**, before anything is built from the answer;
 * 2. the runtime, which is a live transport **only in a browser**;
 * 3. the immutable scope, derived from the raw relay list by asking *probe*
 *    transports — clients that open no socket and are disposed in a `finally`
 *    ({@link probeTransportKeys}) — and written through to the live transport
 *    if there is one. **The probes run on both sides**: the relay scope is
 *    still derived and still validated on a server, so a refused list still
 *    fails the render exactly as it did.
 *
 * The transport is built ahead of the scope inside the browser arm rather than
 * after it, and that is deliberate: the scope writes the accepted generation
 * through as its last construction step, and a browser build that is refused
 * has therefore already made the client it must release. That release is the
 * `catch` below, and `TK1` is its witness.
 *
 * What an SSR'd page's diagnostics then show is unchanged, because the map was
 * never built from the transport: `snapshot()` lists `scope.relays` and reads
 * the connection state as `initialized` when the status map has nothing to say.
 */
export function createNostrContext(options: {
  relays?: readonly RelayInput[];
  harness?: HarnessOverrides;
  /** Fixed and unscheduled on the server; injectable in tests. */
  clock?: ClockOptions;
  /**
   * The library's own, overridden only so a test can watch the gate work.
   *
   * Not a `HarnessOverrides` field, because it is not a knob on the dependency
   * that a harness turns off: it is the thing the library does instead of the
   * dependency. The same shape as `clock` — supplied here, defaulted below, and
   * the default is what every consumer gets.
   */
  verifyEvent?: (event: Nostr.Event) => Promise<boolean>;
  signer?: NostrSigner;
  /**
   * Overridden only so a test can render the server's branch under jsdom.
   *
   * Detected otherwise, which is the whole point: a provider that has to be
   * *told* it is on a server is one that is on a browser by default, and that
   * is the state A12 and A-δ were both written against.
   */
  environment?: 'browser' | 'server';
  /**
   * How the transport is asked what it calls a relay. Defaulted below.
   *
   * **Where the provider's relay names come from, rather than a check on names
   * it chose.** Every URL a caller writes is handed to this, alone, and the
   * answer is the string the scope, the cache key, the routing, the machine's
   * backward table and the diagnostics map all carry (`TD1`).
   *
   * Overridden only so a test can supply one that answers differently, which is
   * the same shape as `clock` and `verifyEvent`: the default is what every
   * consumer gets, and the seam exists because what is under test is a
   * consumer's rx-nostr answering differently from the one this repository
   * resolved — which is a *refusal* in some arms and a different endpoint in
   * others, and neither is reachable here without injection.
   *
   * Not a `HarnessOverrides` field: those turn off dependency behaviour a test
   * finds inconvenient. This turns on a condition a consumer's lockfile can
   * produce and this repository cannot.
   */
  transportKeys?: TransportKeys;
}): NostrContext {
  // **First, and before anything is built from the answer.** This used to sit
  // four statements down, below the live client and the scope, so "the provider
  // decides what to build from where it is running" was true of the clock and
  // of nothing else — the connection was built before anything had looked.
  const environment = options.environment ?? detectEnvironment();
  /**
   * A live transport in a browser, and none at all on a server.
   *
   * The server arm's `transport` is `undefined` in the type rather than absent,
   * so every place below that *touches* a connection — the refusal's release,
   * the teardown, and the context literal that republishes it — narrows on
   * `environment` and the server branch structurally cannot reach one. The one
   * place that merely passes it on is `createRelayScope`, whose parameter is
   * where the absence is written down instead.
   */
  const runtime: ProviderRuntime =
    environment === 'server'
      ? { environment, transport: undefined }
      : { environment, transport: createLiveTransport(options.harness) };
  // 0004's "the library supplies its own" was true of the record and not of the
  // code: there was no path by which any verifier reached this client, and the
  // fixture hid it by turning verification off. `AE9` is the witness — a
  // provider built with no verifier argument at all still drops a forgery.
  const verifyEvent = options.verifyEvent ?? verifier;
  // **The provider's disposal, handed to the cache so it runs *before* the
  // release rather than beside it.** A function declaration rather than a
  // `const`, because it is passed here and written below, where the things it
  // disposes exist.
  const owned = createOwnedQueryClient(environment, () => disposeInOrder());
  /**
   * The transport is released if the relay set is refused — where there is one.
   *
   * Everything this function builds is released by the `$effect` below, and
   * that effect is registered *after* this line — so a throw from here left the
   * client it had just made with nobody to dispose it. Small, and real: the
   * refusals above it are `NonIdempotentRelayUrlError` and
   * `TransportKeyMismatchError`, both of which a misconfigured consumer hits on
   * every attempt to render the provider.
   *
   * **How much it leaked, measured rather than asserted**: an rx-nostr that has
   * only been constructed holds no timer — 200 undisposed ones left
   * `process.getActiveResourcesInfo()` unchanged — and one that has been given
   * relays holds one each. Both refusals happen before `setDefaultRelays`, so
   * what leaked was inert rather than a live handle. It is closed anyway,
   * because "owning a thing means releasing it" is C6's rule and an inert leak
   * is still an object with no owner. `TK1` is the witness.
   *
   * **On a server the whole paragraph is moot and the branch says so**: there
   * is no live transport to strand, and the only clients a refused server
   * render makes are the scope's probes, which dispose themselves in a
   * `finally` (`TK2`). What that leaves behind is measured rather than argued —
   * `SS5` takes a `process.getActiveResourcesInfo()` baseline across a refused
   * render.
   *
   * `owned` needs no equivalent: `createOwnedQueryClient` mounts inside an
   * `$effect`, which has not run either, so nothing was mounted to unmount.
   */
  /**
   * **A refused relay list at first construction does not throw**, and it used
   * to.
   *
   * The record called a list the boundary refuses "a programming error". Relay
   * lists are not: they come from a signed kind-10002 event, a settings row, a
   * `nprofile1…` hint — untrusted input where `"wss//relay.example"` is an
   * ordinary typo class. Throwing here is a 500 on the server and a torn-down
   * subtree on the client, `C16-C4` measured that neither boundary shape a
   * consumer writes catches it, and there was no way to check first:
   * `createRelayScope` is correctly unexported and nothing replaced it.
   * Multi-account amplifies it — the natural `{#key accountId}` reset makes
   * every account switch a *first* construction, so the caught-and-published
   * path never ran.
   *
   * So the provider stands with an **empty accepted scope**, which `B-γ`
   * already renders as "not asked", and the refusal is published where the
   * update path's is: the diagnostics axis, on `configurationError`. Nothing
   * was written to the transport before the throw — `createRelayScope` probes
   * and validates before `setDefaultRelays` — so there is no socket to
   * dispose and none is opened.
   *
   * **A partially valid list is not partially accepted.** The retry is
   * `createRelayScope(transport, [])`, not the caller's list minus the entries
   * that failed: accepting some of what a consumer wrote would make the scope a
   * set they never asked for, and the request path would then ask relays chosen
   * by which of their entries happened to parse.
   *
   * What still throws is anything that is **not** a relay-list refusal. A
   * transport that cannot be built, or an internal fault, is not a value a
   * consumer wrote, and there is nothing for them to fix on the diagnostics
   * axis; the client is released on the way out for the reason above.
   */
  let scope;
  let refusedAtConstruction: RelayConfigurationError | undefined;
  try {
    scope = createRelayScope(runtime.transport, options.relays ?? [], options.transportKeys);
  } catch (error) {
    if (!(error instanceof RelayConfigurationError)) {
      if (runtime.environment === 'browser') runtime.transport.dispose();
      throw error;
    }
    refusedAtConstruction = error;
    scope = createRelayScope(runtime.transport, [], options.transportKeys);
  }
  // The server's defaults *under* the harness's, so a test that injects a
  // source still gets `schedule: false` when it says it is rendering on one.
  // Nothing detected the server at all before `detectEnvironment` existed, so
  // A-δ's "fixed and unscheduled when rendering on a server" described a branch
  // no caller took.
  const clock = createExpiryClock({
    ...(environment === 'server' ? serverClockOptions() : {}),
    ...(options.clock ?? {})
  });
  const attempts = createAttemptRegistry();
  /**
   * The hints that bring a pending recovery forward, and the listeners they
   * cost.
   *
   * Built here so that the provider owns them with everything else, and
   * disposed in the same linearisation: `C6` gives the provider one resource
   * domain, and a host listener is a resource. Nothing is registered on a
   * server, which is what makes a server render leave none behind rather than
   * clean some up.
   */
  const resume = createResumeHints(environment);
  /**
   * The diagnostics, and therefore the `NOTICE` subscription, built here.
   *
   * **Before the teardown effect below, and the order is what the release
   * reads from.** Svelte destroys an effect's children in the order they were
   * created — `destroy_effect_children` walks `first` → `next`, read off the
   * resolved 5.56.8 — so this one's unsubscribe runs before the `dispose()`
   * below it: the diagnostics stop listening because the provider ended, rather
   * than because the object they were listening to was destroyed underneath
   * them. **Whether the other order would also be harmless is not measured**,
   * and nothing here rests on rx-nostr tolerating an unsubscribe after
   * disposal; this is written so the question does not arise.
   *
   * The scope is passed as a getter and the transport as a value, which is the
   * difference between them: the client is made once and disposed with this
   * provider, while `scope.current` moves under `setRelays` and the map has to
   * follow it.
   */
  const diagnostics = createRelayDiagnostics(
    runtime.transport,
    () => scope.current,
    () => clock.sample()
  );
  // **Published as soon as there is somewhere to publish it**, which is why the
  // refusal is carried down from the construction above rather than recorded
  // there: the axis that holds it does not exist yet at the point the list is
  // refused. A later valid update clears it through `accept()`, on the path
  // every acceptance takes.
  if (refusedAtConstruction !== undefined) diagnostics.refuse(refusedAtConstruction);

  /**
   * The capability a request is given instead of the client.
   *
   * Made here, revoked in the teardown below, and `undefined` on a server for
   * the reason there is no transport there.
   */
  const ownedTransport =
    runtime.environment === 'browser' ? ownTransport(runtime.transport) : undefined;

  // Narrowed rather than `runtime.transport?.dispose()`, so that "there is
  // nothing to release on a server" is a branch a reader sees rather than a
  // guard against a value that might be missing. Nothing reaches here on a
  // server anyway — the server compiler emits no `$effect` — and that is the
  // point: the release cannot be relied on there, so nothing is created that
  // would need it.
  function disposeInOrder(): void {
    // **Disposal is one linearised operation, and the order is the contract.**
    // Revoke first: from this instant no request can reach the client, so
    // nothing downstream has to ask whether it is still alive. Then cancel what
    // is running — and cancel it *as a disposal*, so a `refresh()` still in
    // flight is rejected with `provider-disposed` rather than with the generic
    // abandonment, which is what makes that code a fact about the owner rather
    // than about the call. The client is disposed last, where nothing can
    // observe it: `lease.ts` says why a guard on a shared object cannot replace
    // this ordering.
    ownedTransport?.revoke();
    clock.dispose();
    // The third resource this provider owns, and the one this cleanup did not
    // name: every attempt still held is abandoned here. A destroyed provider
    // otherwise went on holding un-aborted controllers and a flight that would
    // never settle — invisible through the published surface, because a
    // `refresh()` in flight is already abandoned through the query context's
    // signal, and a release that depends on somebody else's teardown for its
    // effect is one that stops working when they change.
    attempts.abandonAll(
      'nosvelte: the provider that owned this request has been destroyed, so this handle ' +
        'cannot be used again. That is the owner going away rather than a relay that is ' +
        'down: make a new provider.',
      providerDisposed
    );
    // **Before the transport, and it is the cheapest of the three.** A listener
    // outliving its provider is the shape `C6` is about: it would wake a
    // recovery for requests whose client is being disposed on the next line.
    resume.dispose();
    if (runtime.environment === 'browser') runtime.transport.dispose();
  }
  // **Handed to the cache's own teardown rather than registered beside it.**
  // Two effects are two teardowns whose order the framework decides, and it
  // decided against this one: the cache was released first, so a `refresh()`
  // in flight was cancelled by that rather than rejected by the disposal.
  // `RM8` is where it is measured, and it could not see it while the arms
  // handed the hook a client of their own.

  const context: NostrContext = {
    // The published half of {@link ProviderRuntime}, under the name the context
    // has always used. Written as a branch rather than spread, because the two
    // unions differ in one field name and the compiler is what keeps them in
    // step: a runtime arm that stopped carrying a transport would fail here
    // rather than publish `undefined` under `'browser'`.
    ...(runtime.environment === 'browser'
      ? {
          environment: runtime.environment,
          rxNostr: runtime.transport,
          transportLease: ownedTransport?.capability as TransportCapability
        }
      : { environment: runtime.environment, rxNostr: undefined, transportLease: undefined }),
    verifyEvent,
    signer: options.signer,
    get client() {
      return owned.client;
    },
    get scope() {
      return scope.current;
    },
    clock,
    attempts,
    resume,
    diagnostics,
    get configurationError() {
      return diagnostics.configurationError;
    },
    setRelays(relays: readonly RelayInput[]) {
      try {
        scope.setRelays(relays);
      } catch (error) {
        // Not a relay-list refusal: `setDefaultRelays` on a client this
        // provider has already disposed throws from rx-nostr, and a caller who
        // swallowed that would be shown a live provider that cannot ask
        // anything. It is rethrown before anything is recorded, so the last
        // refusal a consumer can act on is not overwritten by one they cannot.
        if (!(error instanceof RelayConfigurationError)) throw error;
        diagnostics.refuse(error);
        return;
      }
      // **Cleared here and only here**, on the path a list was accepted on.
      // `scope.setRelays` returns without moving anything when the readable set
      // and the capabilities are unchanged, and that is still an acceptance —
      // the list went through the entrance, the transport and the set probe to
      // be found equal.
      diagnostics.accept();
    }
  };

  return context;
}

/**
 * Put it where descendants can find it.
 *
 * Separate from creating it, because they are separate things: ownership is a
 * property of the object and propagation is Svelte plumbing. Keeping them apart
 * is also what lets the ownership be tested without a component, which is where
 * the interesting properties are.
 */
/**
 * Every input a request takes from a provider, read here and handed over whole.
 *
 * **The reads live in this module on purpose.** `PROV1` counts what the request
 * engine reads off a context and refuses a whole-object use, because a
 * whole-object use hides which fields a reader depends on. This is the other
 * side of that rule: the engine reads *one* thing — the bundle — and the seven
 * field reads that build it are here, beside the context that owns them. A
 * reader cannot take four of these and leave three.
 *
 * `transportLease` is `undefined` on a server provider and stays that way; the
 * engine turns it into a capability that refuses, which is what a server
 * request needs. It is not filled in from anywhere else — a provider's bundle
 * with a caller's transport in it is the mix `RequestRuntime` exists to
 * prevent.
 */
export function providerInputs(context: NostrContext): {
  readonly transport: TransportCapability | undefined;
  readonly scope: RelayScope;
  readonly environment: 'browser' | 'server';
  readonly client: QueryClient;
  readonly verifyEvent: (event: Nostr.Event) => Promise<boolean>;
  readonly clock: ExpiryClock;
  readonly attempts: AttemptRegistry;
  readonly resume: ResumeHints;
} {
  // **Getters, not values, and an outside reviewer measured why.** Read as
  // values this froze the provider's *scope* at the instant the hook was built:
  // a provider that starts with no relays and is then given one through its own
  // published `setRelays()` moved nobody, because the request went on reading
  // the snapshot. `B-α-C2` is the row that says an accepted update starts the
  // waiting request, and this had taken it away — measured, 0 REQs before and
  // 0 after.
  //
  // Freezing the *shape* is what this is for: the bundle a request reads from
  // cannot gain a field, lose one, or have one replaced. What each field
  // answers is the provider's business and stays live.
  return Object.freeze({
    get transport() {
      return context.transportLease;
    },
    get scope() {
      return context.scope;
    },
    get environment() {
      return context.environment;
    },
    get client() {
      return context.client;
    },
    get verifyEvent() {
      return context.verifyEvent;
    },
    get clock() {
      return context.clock;
    },
    get attempts() {
      return context.attempts;
    },
    get resume() {
      return context.resume;
    }
  });
}

export function setNostrContext(context: NostrContext): void {
  const token: ProviderToken = Object.freeze({ nosvelte: 'provider' });
  HELD.set(token, context);
  setContext(KEY, token);
}

/**
 * Read the context, or say plainly that there isn't one.
 *
 * The current failure for this case is an exception thrown from inside the
 * dependency when a hook is used after the client was disposed (#80) — a
 * message about rx-nostr, for a mistake about provider scope. This one names
 * the actual problem.
 */
export function getNostrContext(): NostrContext {
  // `getContext` rather than `hasContext`, and **not for the reason this
  // comment gave for several rounds.** It said the two behave differently
  // outside a component — one returning `undefined` where the other throws —
  // and that is false of the dependency in every export condition. Both reach
  // one `get_or_init_context_map`, and so does `setContext`; all three throw
  // `lifecycle_outside_component`. Measured at svelte 5.56.8 by `SEN29`, which
  // asserts on all three precisely because a reader of this library chose
  // between two of them on a difference that does not exist.
  //
  // The choice stands on what is left of the argument: reading the value and
  // checking it is one operation where `hasContext` plus `getContext` is two,
  // and the second would read the map twice to answer one question.
  //
  // **Where this may be called is therefore narrower than it looks**, and it is
  // the caller that keeps the rule rather than anything here: component
  // initialisation, or a reaction created during one. `useRelayDiagnostics` is
  // the only caller and it obeys it — the read is its first statement and the
  // value is captured, so the getters it hands back never read the context
  // again.
  const context = heldBy(getContext<unknown>(KEY));
  if (context === undefined) throw ownedByLibrary(new MissingProviderError());
  return context;
}

/**
 * The context if there is one, and no complaint if there is not.
 *
 * Exists because one input is the provider's *and* has a defensible answer
 * without it: the signature gate. A hook driven directly — which is every
 * measurement in this spike — has no provider to read, and `getNostrContext`
 * is written to fail loudly for exactly that case. Failing loudly is right
 * when the client is what is missing, because nothing can be asked without
 * one; it is wrong when what is missing is a value the caller may legitimately
 * supply itself.
 *
 * **The sentence that used to close this paragraph was false, and the `try` in
 * the name is not what it says.** It read: "`getContext` outside a component
 * returns `undefined` rather than throwing, so this is a read and a check, not
 * a `try`." Measured against the resolved svelte 5.56.8 in both the `browser`
 * and the `default` export conditions, `getContext` outside a component
 * **throws** `lifecycle_outside_component` — `SEN29` and `SEN30`. Nothing here
 * catches it. **That is deliberate and it is not an oversight left standing**:
 * the `try` this function offers is over the *provider*, never over the window,
 * and the two must not be merged here.
 *
 * Merging them is the repair that looks obvious and is worse than the defect it
 * closes. With a `catch` in this function, a request under a real provider
 * whose read merely happened in the wrong window would fall through to
 * `noVerifier()` — or, for a caller who armed the request some other way, would
 * run with the provider's signature gate silently dropped. A loud throw becomes
 * an unverified event stream.
 *
 * **That paragraph was written about this function and was then disproved at
 * the one site that had been declared exempt from it.** `captureProvider` in
 * `useStreamedReq` caught the lifecycle error for a round, on the argument that
 * at a hook's construction "no component" and "no provider" mean the same
 * thing. They do not: a component under a real provider can build its request
 * from a click handler, and both halves of the paragraph above then came true
 * inside a provider — a false "use it inside a `NostrApp` provider" for a
 * caller who supplied nothing (`LC5`, `LC6`), and the provider's `environment`
 * dropped with no signal for one who supplied a verifier (`LC7`). **So nothing
 * in this library catches it now**, at any level.
 *
 * **What the defect was, and where it is closed.** Three call sites in
 * `useStreamedReq` read this at three different lifecycles: the options
 * factory's, inside a `$derived` and legal; `refresh()`'s first statement,
 * which for the published shape is a click handler; and the stream function's,
 * synchronous from the query function's entry, legal on a mount and illegal on
 * a re-fetch driven from outside a reaction. The last two threw. They are one
 * read now, taken at the hook's construction by `captureProvider` — and taken
 * only where the request has something to ask the provider for, which is what
 * lets a caller who supplies those inputs itself drive the engine from an
 * effect root without this being reached at all.
 *
 * So this function has exactly one caller, it is called during component
 * initialisation, and it propagates anywhere else on purpose: a second caller
 * appearing in the wrong window should fail loudly rather than be handed
 * `undefined` by a reader that cannot tell the two absences apart.
 */
export function tryGetNostrContext(): NostrContext | undefined {
  return heldBy(getContext<unknown>(KEY));
}
