/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Ported from the spike's `relayconfig` suite onto `src/lib/v1`, against the
 * engine's own seam. The arms are renamed from `CF<n>` to `CG<n>` — 0005
 * records the old names as spike witnesses, and a production arm carries a
 * name of its own. **The comments keep the spike's names**, because what they
 * record was measured there: `CF1` in a comment is the arm that is `CG1`
 * here, and every other arm name in a comment is the spike's as 0005 records
 * it, not a file in this repository. Likewise "the ledger" is the spike's
 * mutation ledger, and a function or a file a comment names that this
 * repository does not have (`configOf`, `roles.ts`, `context.test.ts`, …) is
 * the spike's.
 *
 * What the spike's suite said of itself:
 *
 * C16: where a refused relay list goes.
 *
 * The gap this closes is not that refusals were missing — B-α has had them for
 * several rounds, measured at `createRelayScope` and at the provider. It is
 * that **the public surface had nowhere to put one**. The actor is
 * `NostrApp.relays`, a reactive prop, and the two obvious answers are both
 * wrong on their own: throwing from the `$effect` that applies it hands the
 * refusal to an error boundary, which destroys the provider's subtree along
 * with the generation the refusal was supposed to preserve (`CF6`); catching it
 * keeps the generation and leaves the consumer with no way to learn anything
 * happened.
 *
 * So the two paths are decided apart. Construction throws, because there is no
 * previous generation to keep and a provider with no transport can serve
 * nothing — and the error is published as one class with a `code` so a boundary
 * can tell the causes apart. A later change of the prop is caught, and the
 * refusal is published beside the relay map on `useRelayDiagnostics()`, where
 * it stays until a list is accepted.
 *
 * **The refusing arms are not enough by themselves and are not written alone.**
 * An implementation that refuses every list and always reports an error passes
 * every one of them, so each has its accepting control beside it — that is what
 * `CF1`'s last arm, `CF3`'s second half and `CF4` are for.
 */
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { describe, expect, it } from 'vitest';

import type { NostrContext } from '$lib/v1/context.svelte.js';
import { createNostrContext } from '$lib/v1/context.svelte.js';
import type {
  RelayConfigurationErrorCode,
  RelayInput,
  TransportKeys
} from '$lib/v1/scope.svelte.js';
import * as scopeModule from '$lib/v1/scope.svelte.js';
import { probeTransportKeys, RelayConfigurationError } from '$lib/v1/scope.svelte.js';
import { requestTargets } from '$lib/v1/stream.js';

import BareProbe from './fixtures/BareProbe.svelte';
import BoundaryProbe from './fixtures/BoundaryProbe.svelte';
import RelayProviderHost from './fixtures/RelayProviderHost.svelte';
import { HARNESS_DIVERGENCES, leaseOf, transportOf } from './helpers/relay.js';
import { mount } from './helpers/runes.svelte.js';

/** Names every relay the way it was written. The control seam. */
const agreeing: TransportKeys = (urls) => [...urls];
/** Renames whatever it is shown, its own answers included: no fixed point. */
const unstable: TransportKeys = (urls) => urls.map((url) => `${url}/rewritten`);
/** Two relays it named separately, reported as one when asked together. */
const merging: TransportKeys = (urls) => (urls.length === 1 ? [...urls] : [urls[0] as string]);
/** Answers a single URL with two names, which is no correspondence at all. */
const doubling: TransportKeys = (urls) => urls.flatMap((url) => [url, `${url}/also`]);

/**
 * Every code the published type declares.
 *
 * Written out rather than derived, so that adding a member to the union without
 * a refusal that produces it fails `CF1` rather than widening the check.
 */
const ALL_CODES: readonly RelayConfigurationErrorCode[] = [
  'invalid-relay-input',
  'conflicting-capabilities',
  'non-idempotent-url',
  'transport-key-mismatch',
  'transport-incompatible'
];

/**
 * Relays the transport renames, and then leaves the new name alone.
 *
 * Every entry is a URL an accepted scope carries under a name that is **not**
 * the one the caller wrote, which is what gives `requestTargets`'s own
 * transformation something to disagree about. A corpus of already-canonical
 * URLs would leave `CF9` passing on a library that resolved a request's targets
 * by copying whatever it was handed.
 *
 * Two shapes rather than one, because they fail differently: the four with a
 * percent-escape or a sorted query are `canonicalOnce`'s decoding steps, and the
 * trailing slashes, the hostname dot, the fragment and the surrounding space are
 * the ones that need no escape at all — which is the difference `SC19` was
 * written on.
 */
const RENAMED = [
  'wss://h.example/?x=%7E',
  'wss://h.example/%7Epath',
  'wss://h.example/?b=2&a=1',
  'wss://h.example//?a=1',
  'wss://h.example//',
  'wss://h.example./',
  'wss://h.example#fragment',
  '  wss://h.example  ',
  'wss://h.example/path/'
];

/** The one the transport would rename a *second* time, so a scope refuses it. */
const DOUBLED = 'wss://h.example/?x=%257E';

function provider(relays: readonly RelayInput[], transportKeys: TransportKeys = agreeing) {
  return mount(() => createNostrContext({ relays, harness: HARNESS_DIVERGENCES, transportKeys }));
}

/**
 * The refusal a construction **published**, as the published type.
 *
 * **It used to be the refusal a construction threw.** A relay list is untrusted
 * input — a signed kind-10002 event, a settings row, a `nprofile1…` hint — so a
 * first construction that throws is a 500 on the server and a torn-down subtree
 * on the client for an ordinary typo, and `C16-C4` measured that neither
 * boundary shape a consumer writes catches it. The provider stands now, with an
 * empty accepted scope, and the refusal is on the diagnostics axis where the
 * update path's already was.
 *
 * The two conditions that make this a *publication* rather than a silence are
 * asserted here rather than in each caller: the provider was built, and its
 * accepted scope is empty. A helper that only returned the error would let an
 * arm pass against a provider that had quietly accepted half the list.
 */
function refusalFrom(relays: readonly RelayInput[], transportKeys: TransportKeys = agreeing) {
  const built = provider(relays, transportKeys);
  const published = built.value.configurationError;
  expect(built.value.scope.urls, 'a refused list is not partially accepted').toEqual([]);
  built.destroy();
  return published;
}

/**
 * Is this client disposed?
 *
 * `getAllRelayStatus()` cannot answer — disposal clears the map that getter
 * reads, so it returns `{}` for a disposed client and for one that was never
 * given a relay. `transportkey.test.ts` records the same asymmetry.
 */
function isDisposed(context: NostrContext): boolean {
  try {
    transportOf(context).getDefaultRelays();
    return false;
  } catch {
    return true;
  }
}

describe('C16: a refused relay list at the provider’s construction', () => {
  it('CG1: every cause is one published class, and the code says which', () => {
    // **The enumeration, not a sample.** Eleven `throw` sites are reachable from
    // a relay list and they reduce to five codes; each arm below is one of the
    // five, the last assertion is that they are all of them, and the arm after
    // that is the control. **The count of sites is checked by nobody** — it was
    // eight in this comment for three rounds after it stopped being eight — so
    // it is written here as what it is: a reading, taken again when the fifth
    // code went in.
    const observed: RelayConfigurationErrorCode[] = [];
    const record = (error: RelayConfigurationError | undefined): RelayConfigurationError => {
      expect(error).toBeInstanceOf(RelayConfigurationError);
      const found = error as RelayConfigurationError;
      // **Every refusal in the family, not the one `CF10` happens to build.**
      // `CF10` measures the effect on one class; this measures that no class
      // was left out when the sweep ran, which is the half a single
      // arrangement cannot see — five classes, and each freezes itself.
      expect(Object.isFrozen(found), `${found.name} is published unfrozen`).toBe(true);
      expect(Object.isFrozen(found.urls), `${found.name}.urls is published unfrozen`).toBe(true);
      observed.push(found.code);
      return found;
    };

    // The entrance, all three of its shapes: a string that is not a relay URL,
    // a value that is not a string, and a capability that is not a boolean.
    // One code, because a consumer does one thing about them — fix the object
    // the list was built from — and because they are the four this library
    // refuses before the transport is asked anything (`B-α-C17`).
    for (const relays of [
      ['nostr.example.com'],
      [5 as unknown as string],
      [{ url: 'wss://a.example', read: 1, write: true } as unknown as RelayInput],
      // **A relay scheme with nothing after it.** Three strings that pass a
      // `^wss?://` test and are not URLs: no host, an unterminated IPv6
      // literal, and a bare percent. They are refused at the entrance like any
      // other non-relay string — which is what these rows measure, and all
      // they measure. The place a string like this is *dangerous* is the
      // transport's answer rather than the caller's list, and `TD14` is that.
      ['wss://'],
      ['wss://['],
      ['ws://%']
    ]) {
      const error = record(refusalFrom(relays));
      expect(error.code).toBe('invalid-relay-input');
      // Empty, and this is the corner the field carries: what was written is
      // not a relay URL, so there is no relay name for it to name. The message
      // is where the value is.
      expect(error.urls).toEqual([]);
      expect(error.message).toContain('nosvelte');
    }

    // One relay, two entries, two answers about what may be read from it.
    const conflicting = record(
      refusalFrom([
        { url: 'wss://a.example', read: true, write: true },
        { url: 'wss://a.example', read: false, write: true }
      ])
    );
    expect(conflicting.code).toBe('conflicting-capabilities');
    expect(conflicting.urls).toEqual(['wss://a.example']);

    // A transport with no fixed point: there is no name this library could
    // write back that the connection would open under.
    const nonIdempotent = record(refusalFrom(['wss://a.example'], unstable));
    expect(nonIdempotent.code).toBe('non-idempotent-url');
    // The caller's own string — the one they would change — rather than either
    // of the transport's two answers about it.
    expect(nonIdempotent.urls).toEqual(['wss://a.example']);

    // A transport that does not compose: two relays it named separately are one
    // when it is asked about both.
    const merged = record(refusalFrom(['wss://a.example', 'wss://b.example'], merging));
    expect(merged.code).toBe('transport-key-mismatch');
    expect(merged.urls).toEqual(['wss://a.example', 'wss://b.example']);

    // **One URL, several names — and it is a different code from the one above,
    // which is the whole of the split.** The set probe's mismatch is answered by
    // rewriting the relay list so each entry is a relay the transport names on
    // its own; a transport that answers about *one* relay with two names is not
    // answered that way at all, so it is `transport-incompatible` and its
    // message says to pin, upgrade or report instead. It read
    // `transport-key-mismatch` until r32 and sent a consumer after a list that
    // was not the problem.
    const doubled = record(refusalFrom(['wss://a.example'], doubling));
    expect(doubled.code).toBe('transport-incompatible');
    expect(doubled.urls).toEqual(['wss://a.example']);
    expect(doubled.message).toMatch(/Pin or upgrade rx-nostr/);
    expect(doubled.message).not.toMatch(/write the set/);

    // **Every code the type declares was produced by a refusal that really
    // happened**, and no refusal produced one it does not declare. A member
    // added to the union with nothing that throws it fails here, which is what
    // stops the discriminant drifting away from the causes.
    expect([...new Set(observed)].sort()).toEqual([...ALL_CODES].sort());

    // The control. Without it every assertion above is satisfied by a provider
    // that refuses everything.
    const { value: context, destroy } = provider(['wss://ok.example']);
    expect(context.scope.urls).toEqual(['wss://ok.example']);
    expect(context.configurationError).toBeUndefined();
    destroy();
  });

  it('CG10: a refusal a consumer holds cannot rewrite the provider’s next answer', () => {
    // **The published Error was the provider's own object, and `urls` was the
    // scope's own array.** `RD24` closed exactly this on the diagnostics row a
    // round earlier; nobody swept it to the refusal beside it, which is the
    // class of miss this arm exists to stop repeating. Measured before the
    // repair, end to end through the provider: `error.urls.push(…)` made the
    // next panel list a relay nobody configured, and `error.code = …` left the
    // code and the message saying different things about the same refusal —
    // and `code` is the field C16 says a consumer branches on.
    //
    // What is contracted is the effect: the write reaches neither the
    // provider's state nor the next reader. Freezing is how, not what.
    const arrangement = [
      { url: 'wss://a.example', read: true, write: true },
      { url: 'wss://a.example', read: false, write: true }
    ];
    const refusal = refusalFrom(arrangement);
    expect(refusal?.code).toBe('conflicting-capabilities');
    const urls = refusal?.urls as string[];
    expect(urls.length).toBeGreaterThan(0);
    const before = [...urls];
    const code = refusal?.code;

    try {
      urls.push('wss://invented-by-the-consumer.example');
    } catch {
      // A frozen array refuses; that is one way of keeping the promise rather
      // than the promise itself.
    }
    try {
      (refusal as unknown as { code: string }).code = 'invalid-relay-input';
    } catch {
      // Likewise for the object.
    }

    // The refusal the *next* reader gets, produced by the same arrangement.
    const again = refusalFrom(arrangement);
    expect(again?.urls).toEqual(before);
    expect(again?.code).toBe(code);
    // And the one in hand still says what it said, so the two halves of the
    // discriminant have not come apart.
    expect(refusal?.code).toBe(code);
    expect(refusal?.urls).toEqual(before);
  });

  it('CG11b: what the transport said is rendered into the refusal, and its object is left alone', async () => {
    // **The other half of the snapshot rule, in the class the redesign did not
    // sweep.** `answered` used to be the transport's live value, kept on a
    // published Error and shallow-frozen — so `configurationError.answered` was
    // *their* array, we had frozen it as a side effect of reading it, and its
    // nested objects were both mutable and visible through the published Error.
    // A reviewer measured all three. The failure channel had already stopped
    // retaining foreign graphs; this class had not.
    //
    // So the field is the rendering, and the transport's object is not touched
    // and not reachable. What a consumer loses is the value itself; what they
    // keep is what it looked like, bounded, in the message and in this field.
    const nested = { deep: 'as the transport made it' };
    const kept: unknown[] = ['wss://a.example', nested];
    const refusal = refusalFrom(['wss://a.example'], (() => kept) as never);
    expect(refusal?.code).toBe('transport-incompatible');

    const answered = (refusal as unknown as { answered: unknown }).answered;
    expect(typeof answered, 'a rendering, not the value').toBe('string');
    expect(answered, 'and it says what the transport said').toContain('as the transport made it');
    expect(answered).not.toBe(kept);

    // **Their graph, untouched.** The freeze we used to apply was a change to
    // somebody else's object made while reading it.
    expect(Object.isFrozen(kept), 'the array the transport answered with').toBe(false);
    expect(Object.isFrozen(nested), 'and what it points at').toBe(false);

    // **And nothing published moves when they write to it afterwards**, which is
    // what "does not retain" means where a consumer can see it.
    const said = refusal?.message;
    nested.deep = 'CHANGED AFTER THE REFUSAL';
    kept.push('wss://invented-later.example');
    expect((refusal as unknown as { answered: string }).answered).toBe(answered);
    expect(refusal?.message).toBe(said);
    expect(refusal?.message).toContain('as the transport made it');

    // **A value that is not an array reaches this field too** — `transportName`
    // hands the answer through when it is not an array, and again when its one
    // member is not a string — so the claim is read on an array-like object as
    // well.
    const arrayLike = { length: 1, 0: 'wss://a.example', note: 'the transport’s own' };
    const notAList = refusalFrom(['wss://a.example'], (() => arrayLike) as never);
    expect(typeof (notAList as unknown as { answered: unknown }).answered).toBe('string');
    expect(Object.isFrozen(arrayLike), 'whatever shape it is, it stays theirs').toBe(false);

    // **And the sentence says which of the two happened.** An adapter that threw
    // the words and one that returned them produced published errors identical
    // in every field; the per-relay seam was witnessed and the set seam was not.
    const threw = refusalFrom(['wss://a.example'], (() => {
      throw new Error('the transport said why');
    }) as never);
    const returned = refusalFrom(['wss://a.example'], (() => 'the transport said why') as never);
    expect(threw?.message).toContain('it threw');
    expect(returned?.message).toContain('it answered');
    expect(threw?.message, 'two faults, two sentences').not.toBe(returned?.message);

    const onTheSet = refusalFrom(['wss://a.example', 'wss://b.example'], ((
      urls: readonly string[]
    ) => {
      if (urls.length > 1) throw new Error('adapter boom on the set');
      return [...urls];
    }) as never);
    expect(onTheSet?.code).toBe('transport-incompatible');
    expect(onTheSet?.message, 'the set seam says which fault it was').toContain('it threw');
  });

  it('CG2: the class family is closed, so a new cause cannot leave the published type', () => {
    // `CF1` measures the codes that exist. This measures the thing that would
    // let a fifth cause be added without one: a refusal class that does not
    // descend from the published error is invisible to a consumer's `catch`,
    // and no assertion about codes can see it — the code is only reachable once
    // the class is.
    // **By what it is, not by what it is called.** This filtered on a name
    // ending in `Error`, so a refusal class named anything else was invisible to
    // the very check whose title says a new cause cannot leave the published
    // type — measured: `class TransportRefusal extends Error {}` thrown from a
    // refusal path left this green, and renaming it `TransportRefusalError`
    // made it fail. The filter was reading a naming convention.
    const classes = Object.entries(scopeModule)
      .filter(
        ([, value]) =>
          typeof value === 'function' && Object.prototype.isPrototypeOf.call(Error, value as object)
      )
      .map(([name, value]) => [name, value as new (...args: never[]) => Error] as const);

    // Pinned, so that a class arriving here is a decision rather than an
    // import. The list is what `scope.svelte.ts` refuses a relay list with.
    //
    // **`RelayNotInScopeError` is deliberately not among them**, and it is
    // thrown from this file's own `resolveTargets`. It refuses a *request* that
    // named a relay this provider cannot read, not a relay *list*, so it
    // reaches a consumer on `state.error` and on `refresh()`'s rejection rather
    // than on the context — which is `ReqError`'s channel and a different code
    // space. It lives in `reqerror.ts` for that reason, and this arm staying
    // green is what says the two families did not merge.
    expect(classes.map(([name]) => name).sort()).toEqual([
      'InvalidRelayInputError',
      'InvalidRelayScopeError',
      'NonIdempotentRelayUrlError',
      'RelayConfigurationError',
      'TransportIncompatibleError',
      'TransportKeyMismatchError'
    ]);

    for (const [name, cls] of classes) {
      if (name === 'RelayConfigurationError') continue;
      expect(
        cls.prototype instanceof RelayConfigurationError,
        `${name} is not a RelayConfigurationError`
      ).toBe(true);
    }
  });

  it('CG3: a refused list at first construction stands, publishes, and mounts the children', async () => {
    // **The decision this arm used to hold was the opposite one**, and it was
    // ruled against: a first construction threw, an error boundary received it,
    // and the subtree never existed. Relay lists are untrusted input — a signed
    // kind-10002 event, a settings row, a `nprofile1…` hint — so
    // `"wss//relay.example"` is an ordinary typo class, and throwing made it a
    // 500 on the server and a torn-down subtree on the client. `C16-C4`
    // measured that neither boundary shape a consumer writes catches it, and
    // there was no way to check first. Multi-account is the sharp case: a
    // `{#key accountId}` reset makes every account switch a **first**
    // construction, so the caught-and-published path never ran.
    const errors: unknown[] = [];
    const lifetime: string[] = [];

    render(RelayProviderHost, {
      props: {
        relays: ['nostr.example.com'],
        onerror: (error: unknown) => errors.push(error),
        onlifetime: (event: string) => lifetime.push(event)
      }
    });

    // Nothing reached the boundary, and the boundary's own slot was not
    // rendered: the render did not fail.
    expect(errors, 'nothing was thrown at the boundary').toEqual([]);
    expect(screen.queryByTestId('failed'), 'and the failed slot is not rendered').toBeNull();

    // The children mounted, which is the half a consumer's page depends on: the
    // rest of the application renders while the relay list is wrong.
    expect(lifetime, 'the subtree mounted').toEqual(['mounted']);

    // And the refusal is where the update path's already was — on the
    // diagnostics axis, readable by a descendant, carrying the code a consumer
    // branches on.
    expect(screen.getByTestId('configuration-error')).toHaveTextContent('invalid-relay-input');
    // The accepted scope is empty rather than partial, which `B-γ` renders as
    // "not asked" rather than as an answer.
    expect(screen.getByTestId('relays')).toHaveTextContent('');

    // **And the consumer who wrote no boundary is in the same place**, which is
    // the half the old decision could not offer: with the throw, `render` itself
    // raised and the tree was not mounted at all.
    const errorless: unknown[] = [];
    let escaped: unknown;
    try {
      render(RelayProviderHost, {
        props: {
          relays: ['nostr.example.com'],
          boundary: false,
          onlifetime: (event: string) => errorless.push(event)
        }
      });
    } catch (error) {
      escaped = error;
    }
    expect(escaped, 'no boundary, and still no throw').toBeUndefined();
    expect(errorless, 'and the subtree mounted anyway').toEqual(['mounted']);
  });

  it('CG3b: a valid update clears it, and the provider is the one that was standing', async () => {
    // **The other edge of `CF3`, and the reason the empty scope is a state
    // rather than a dead end.** A consumer whose relay list came from a settings
    // row fixes the row; what has to happen then is that the *same* provider —
    // the same client, the same cache, the same subtree — starts working, rather
    // than the application having to remount to get out of the state.
    const url = 'wss://cleared.example';
    const { rerender } = render(RelayProviderHost, {
      props: { relays: ['nostr.example.com'], boundary: false }
    });
    expect(screen.getByTestId('configuration-error')).toHaveTextContent('invalid-relay-input');

    await rerender({ relays: [url], boundary: false });
    await tick();

    expect(screen.getByTestId('configuration-error'), 'a valid update clears it').toHaveTextContent(
      'none'
    );
    expect(screen.getByTestId('relays'), 'and the list is accepted').toHaveTextContent(url);
  });
});

describe('C16: a relay list refused after the provider exists', () => {
  // @contracts B-α-C25
  it('CG12: a relays prop refused as a change writes nothing to the client', async () => {
    let context: NostrContext | undefined;
    const { rerender } = render(RelayProviderHost, {
      props: {
        relays: ['wss://a.example'],
        onready: (found: NostrContext) => (context = found)
      }
    });
    const transport = transportOf(context as NostrContext);
    const before = transport.getDefaultRelays();
    // Every write the provider makes to its client from here on.
    const writes: unknown[] = [];
    const write = transport.setDefaultRelays.bind(transport);
    transport.setDefaultRelays = (relays) => {
      writes.push(relays);
      write(relays);
    };

    for (const [label, relays] of [
      ['one URL string', 'wss://a.example'],
      ['a Set', new Set(['wss://a.example'])],
      ['null', null],
      // eslint-disable-next-line no-sparse-arrays
      ['an array with a hole', [, 'wss://a.example']]
    ] as const) {
      await rerender({ relays: relays as unknown as readonly RelayInput[] });
      expect(screen.getByTestId('configuration-error'), label).toHaveTextContent(
        'invalid-relay-input'
      );
      // Not the refused list, and not an emptied one in its place.
      expect(writes, label).toEqual([]);
      expect(transport.getDefaultRelays(), label).toEqual(before);
    }

    // The control: an accepted change is written, once.
    await rerender({ relays: ['wss://a.example', 'wss://b.example'] });
    expect(writes).toHaveLength(1);
  });

  it('CG4: the prop change is refused without a throw, and the generation stays', async () => {
    let context: NostrContext | undefined;
    const errors: unknown[] = [];
    const lifetime: string[] = [];

    const { rerender } = render(RelayProviderHost, {
      props: {
        relays: ['wss://a.example'],
        transportKeys: merging,
        onerror: (error: unknown) => errors.push(error),
        onready: (found: NostrContext) => (context = found),
        onlifetime: (event: string) => lifetime.push(event)
      }
    });

    const before = context?.scope;
    const clientBefore = context as NostrContext;
    expect(screen.getByTestId('configuration-error')).toHaveTextContent('none');

    // The prop moves to a list this transport merges. `merging` agrees about
    // any single URL, so the provider was built and only the *update* is
    // refused — which is the one disagreement the per-URL pass structurally
    // cannot have caught already.
    await rerender({ relays: ['wss://a.example', 'wss://b.example'] });

    // **Nothing reached the boundary**, so nothing was destroyed.
    expect(errors).toEqual([]);
    expect(lifetime).toEqual(['mounted']);

    // The previous generation, by identity rather than equality: every request
    // already keyed on it stays keyed on it.
    expect(context?.scope).toBe(before);
    expect(context?.rxNostr).toBe(clientBefore.rxNostr);
    expect(isDisposed(context as NostrContext)).toBe(false);
    expect(Object.keys(transportOf(context as NostrContext).getDefaultRelays())).toEqual([
      'wss://a.example'
    ]);

    // And the refusal is where a consumer can act on it — rendered from the
    // published hook rather than read off the context, because "a consumer can
    // show this" is the claim.
    expect(screen.getByTestId('configuration-error')).toHaveTextContent('transport-key-mismatch');
    expect(screen.getByTestId('relays')).toHaveTextContent('wss://a.example');

    // **The control, and it is the whole reason the arm above means anything.**
    // An implementation that refused every update and always reported one
    // passes everything up to here.
    await rerender({ relays: ['wss://a.example'] });
    expect(screen.getByTestId('configuration-error')).toHaveTextContent('none');
  });

  it('CG5: only the next accepted list clears it', async () => {
    // Three things that are not an acceptance, one that is. The first two are
    // what a naive "clear it when anything happens" gets wrong, and the third
    // is the one that reads as an acceptance and is one.
    const { value: context, destroy } = provider(['wss://a.example'], merging);

    context.setRelays(['wss://a.example', 'wss://b.example']);
    const first = context.configurationError;
    expect(first?.code).toBe('transport-key-mismatch');

    // Read it: still there. A refusal cleared by looking at it is one a
    // consumer can miss by rendering twice.
    expect(context.configurationError).toBe(first);

    // Refused again, differently: **replaced, not cleared**. Reporting the
    // older cause after a newer refusal would send a consumer to fix a list
    // they have already changed.
    context.setRelays([{ url: 'wss://c.example', read: 'no' } as unknown as RelayInput]);
    expect(context.configurationError).not.toBe(first);
    expect(context.configurationError?.code).toBe('invalid-relay-input');

    // Accepted, and the list is the one already in force — which is an
    // acceptance: it went through the entrance, the transport and the set probe
    // to be found equal. This is the arm that fails an implementation which
    // clears only when the generation moves.
    context.setRelays(['wss://a.example']);
    expect(context.configurationError).toBeUndefined();
    expect(context.scope.urls).toEqual(['wss://a.example']);

    // And an acceptance that does move the generation clears it too.
    context.setRelays(['wss://a.example', 'wss://b.example']);
    expect(context.configurationError?.code).toBe('transport-key-mismatch');
    context.setRelays(['wss://d.example']);
    expect(context.configurationError).toBeUndefined();
    expect(context.scope.urls).toEqual(['wss://d.example']);

    destroy();
  });

  it('CG6: what a throw from the prop’s effect does instead — the measurement C16 is taken against', () => {
    // **The alternative, built and measured rather than argued.** Svelte
    // 5.56.8, `boundary.js`: a boundary with an `onerror` or a `failed` snippet
    // answers an error by destroying its main effect and rendering the failure.
    // So an update that threw would hand the refusal somewhere useful and take
    // the provider with it — and "the previous generation and client stay" is
    // not a contract that path can keep.
    const lifetime: string[] = [];
    const errors: unknown[] = [];
    let context: NostrContext | undefined;

    const { rerender } = render(RelayProviderHost, {
      props: {
        relays: ['wss://a.example'],
        transportKeys: merging,
        rethrow: true,
        onerror: (error: unknown) => errors.push(error),
        onready: (found: NostrContext) => (context = found),
        onlifetime: (event: string) => lifetime.push(event)
      }
    });

    expect(lifetime).toEqual(['mounted']);
    void rerender({ relays: ['wss://a.example', 'wss://b.example'] });

    // The refusal arrived at the boundary — and so did the destruction.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(RelayConfigurationError);
    expect(lifetime).toContain('destroyed');
    expect(screen.queryByTestId('relays')).toBeNull();

    // **And the client went with it**, which is the half that makes this a
    // decision rather than a preference: the provider's teardown disposes the
    // connection, so a consumer whose relay prop briefly held a bad value is
    // left with a provider that cannot ask anything — the state C16's catch
    // exists to prevent, reached from the very code path that reported the
    // problem.
    expect(isDisposed(context as NostrContext)).toBe(true);
  });

  it('CG7: the destruction is the boundary’s, not the throw’s', async () => {
    // `CF6`'s control, and it is not a formality: without it, "a throw destroys
    // the subtree" reads as a property of throwing, and the repair would look
    // like "do not put a boundary there". The same throw with no boundary above
    // it leaves the subtree standing — and leaves the error to escape the
    // flush, where a consumer's application gets it as an unhandled failure
    // with no way to say which relay list caused it. Neither arrangement is one
    // the library can keep a generation through, which is why the catch is in
    // the library.
    const lifetime: string[] = [];
    const { rerender } = render(BoundaryProbe, {
      props: {
        where: 'effect',
        generation: 0,
        onlifetime: (event: string) => lifetime.push(event)
      }
    });
    await rerender({ generation: 1 });
    expect(screen.queryByTestId('subtree')).toBeNull();
    expect(lifetime).toContain('destroyed');

    const bare: string[] = [];
    const second = render(BareProbe, {
      props: { where: 'effect', generation: 0, onlifetime: (event: string) => bare.push(event) }
    });
    let escaped: unknown;
    try {
      await second.rerender({ generation: 1 });
    } catch (error) {
      escaped = error;
    }
    expect(escaped).toBeInstanceOf(Error);
    expect(screen.getByTestId('subtree')).toHaveTextContent('alive 1');
  });

  it('CG11: an entry this library cannot read twice is refused as one, not thrown past', async () => {
    // **Two ways a caller's entry is not a plain value, and both were open.**
    // `TD19` closed the *container* — `relays={'wss://a.example'}` — and the
    // sweep stopped at the container; the entries are objects the consumer
    // built, and their fields can be getters.
    //
    // (i) **A getter that throws.** `{ get url() { return config.relay.trim() } }`
    // with `config.relay` absent is an ordinary mistake. Measured before the
    // repair: the `TypeError` left construction as itself, past the class 0004
    // publishes, and through the prop it reached the boundary and destroyed the
    // subtree — `C16`'s own falsifier, which `CF6` describes from the other
    // side.
    const throwing = [
      {
        get url(): string {
          throw new Error('the caller’s own error, from a getter');
        },
        read: true,
        write: true
      } as unknown as RelayInput
    ];
    const refused = refusalFrom(throwing);
    expect(refused).toBeInstanceOf(RelayConfigurationError);
    expect(refused?.code).toBe('invalid-relay-input');
    expect(refused?.message).toContain('the caller’s own error');

    // And through the published door, where the cost of getting it wrong is the
    // subtree rather than one call.
    const lifetime: string[] = [];
    const errors: unknown[] = [];
    const { rerender } = render(RelayProviderHost, {
      props: {
        relays: ['wss://a.example'],
        transportKeys: merging,
        onerror: (error: unknown) => errors.push(error),
        onlifetime: (event: string) => lifetime.push(event)
      }
    });
    expect(lifetime).toEqual(['mounted']);
    await rerender({ relays: throwing });
    expect(errors).toEqual([]);
    expect(lifetime).not.toContain('destroyed');
    expect(screen.getByTestId('configuration-error')).toHaveTextContent('invalid-relay-input');

    // (ii) **A field that answers differently each time it is read.** The set
    // probe used to re-read `entry.url` off the caller's list, so an entry
    // whose second answer was `undefined` left it with nothing to name and the
    // probe returned early — accepting a pair of spellings the transport calls
    // **one** relay, which is the failure `B-α-C16` exists to refuse. The
    // control below is the same list with a value that does not move.
    let reads = 0;
    const shifting = [
      {
        get url(): string {
          reads += 1;
          return reads === 1 ? 'wss://a.example' : (undefined as unknown as string);
        },
        read: true,
        write: true
      } as unknown as RelayInput,
      'wss://b.example'
    ];
    const shifted = refusalFrom(shifting, merging);
    expect(shifted).toBeInstanceOf(RelayConfigurationError);
    expect(shifted?.code).toBe('transport-key-mismatch');
    // Read once, which is what makes the answer above the same answer the
    // entrance got.
    expect(reads).toBe(1);

    const control = refusalFrom(['wss://a.example', 'wss://b.example'], merging);
    expect(control?.code).toBe('transport-key-mismatch');
  });

  it('CG8: an error that is not a relay-list refusal is not swallowed', async () => {
    // The positive control for the `instanceof` guard. Catching everything
    // would turn a disposed provider — a lifetime bug, and #80's subject — into
    // a silent no-op that leaves a consumer looking at a provider which reports
    // no problem and answers nothing.
    const { value: context, destroy } = provider(['wss://a.example']);
    destroy();

    expect(() => context.setRelays(['wss://b.example'])).toThrow();
    try {
      context.setRelays(['wss://c.example']);
    } catch (error) {
      expect(error).not.toBeInstanceOf(RelayConfigurationError);
    }
    // And nothing was recorded, so the last refusal a consumer can act on is
    // not overwritten by one they cannot.
    expect(context.configurationError).toBeUndefined();
  });
});

/**
 * The other place the published type is thrown from, and what it takes to get
 * there.
 *
 * C16's whole account of where a refusal goes is the provider: thrown at the
 * first construction, caught on a later change of the prop and published on the
 * diagnostics hook. `requestTargets` is the one other live caller of a refusing
 * function — its scope-less branch resolves a request's targets through
 * `canonicalUrl`, which throws {@link scopeModule.NonIdempotentRelayUrlError},
 * which is a `RelayConfigurationError`. If a *request* could raise one, that
 * account would be incomplete rather than merely short.
 *
 * It cannot, and three separate things have to be true at once for it to. Two
 * are facts about the surface and are checked elsewhere: no published hook
 * takes a connection (`LK8`), the published entry exports no request hook and
 * no way to name a scope (`LK6`, `LK7`), and the provider's context carries a
 * `RelayScope` rather than an optional one — so nothing a consumer can call
 * reaches the branch at all. The third is a fact about behaviour, it is the only
 * one an implementation change could quietly take away, and it is what `CF9`
 * measures: **on a client this library configured, that branch refuses
 * nothing.**
 *
 * The reason is not that the call was removed. Every URL in a provider's client
 * is `acceptedRelayName`'s output — the transport's own name for what the caller
 * wrote, already checked against the transport a second time — and `canonicalUrl`
 * refuses only what one more application of its transcription would move. Hunted
 * rather than reasoned at: 41,040 URL shapes (schemes, hosts with trailing dots,
 * userinfo, ports, runs of slashes, single and doubly escaped paths and queries,
 * fragments) were put through the resolved transport one at a time; 23,004 of
 * them came back as names it leaves alone, and `canonicalUrl` refused **none**
 * of those and renamed **none** of them. So the refusal on this branch needs a
 * name the library did not get from the transport, and the only way to put one
 * in a client is to configure it behind the scope's back — which is C6's hole
 * (`SC6`, `hasDrifted`), not a request.
 *
 * **What it would look like if it did fire, measured rather than left to the
 * imagination**: driving `useStreamedReq` with such a client and no scope throws
 * `NonIdempotentRelayUrlError` out of the hook call itself — the options factory
 * resolves the targets, so the failure is in the render path (#80's shape) and
 * not a query error, not a `RefreshOutcome`, and not on `configurationError`.
 * That is the measurement behind saying the second reach would be a refusal on
 * no published channel, and it is why closing the branch is a different act from
 * documenting it.
 */
describe('C16: the reach of the published type', () => {
  it('CG9: a request cannot raise it on a client this library configured', () => {
    for (const input of RENAMED) {
      // The real transport, not a seam: what is under test is that an accepted
      // scope's names are already fixed points of the fallback's own
      // transformation, and an injected `TransportKeys` would be this test
      // choosing the answer.
      const { value: context, destroy } = mount(() =>
        createNostrContext({ relays: [input], harness: HARNESS_DIVERGENCES })
      );

      // **The claim.** The request path's scope-less branch, run over the one
      // client a consumer could ever be behind: it resolves rather than
      // throwing — a refusal here fails this line by escaping it — and it
      // resolves to the scope's own names, so there is no second answer on this
      // path either.
      expect(requestTargets(leaseOf(context), undefined)).toEqual(context.scope.urls);

      // The premise, after the claim for `SC19`'s reason: asserting it first
      // would leave the line above unmeasured on every input where the scope
      // stopped renaming anything at all.
      expect(
        Object.values(transportOf(context).getDefaultRelays()).map((relay) => relay.url)
      ).not.toEqual([input]);

      destroy();
    }

    // And the URL that *is* refused is refused where C16 says it is: at the
    // provider, before any client holds it. So there is no accepted relay list
    // out of which a request could pick the name up later.
    //
    // The class before the code, as `CF1`'s `record` does and for the same
    // reason: `refusalFrom` casts whatever it caught, so its return type is an
    // assertion by the test rather than an observation, and reading `code` off
    // it alone would pass for anything carrying that field.
    const atTheProvider = refusalFrom([DOUBLED], probeTransportKeys);
    expect(atTheProvider).toBeInstanceOf(RelayConfigurationError);
    expect(atTheProvider?.code).toBe('non-idempotent-url');

    // **The control, and it is what makes the arms above a statement about who
    // configured the client rather than about which call was made.** The same
    // call, the same published type, the same code — on a client written to
    // behind the scope's back. Without it, "a request raises nothing" is
    // satisfied by a branch that cannot raise anything at all.
    const { value: context, destroy } = mount(() =>
      createNostrContext({ relays: ['wss://h.example'], harness: HARNESS_DIVERGENCES })
    );
    transportOf(context).setDefaultRelays([DOUBLED]);

    let raised: unknown;
    try {
      requestTargets(leaseOf(context), undefined);
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(RelayConfigurationError);
    expect((raised as RelayConfigurationError).code).toBe('non-idempotent-url');

    // And nothing published says so: the provider accepted its own list and has
    // no refusal to report, which is the state a consumer would be reading while
    // the request path throws. That is the shape a second reach would have, and
    // it is reachable only by holding the object C6 says a consumer never holds.
    expect(context.configurationError).toBeUndefined();

    destroy();
  });
});
