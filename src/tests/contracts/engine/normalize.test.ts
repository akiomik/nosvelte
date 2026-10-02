/**
 * The descriptor boundary, against its own seam (0003 B4): `normalizeDescriptor`
 * and `canonicalKey` called directly.
 *
 * Ported from the spike's normalize suite onto `src/lib/v1`, the arms renamed
 * from `NZ<n>` to `NM<n>` — 0005 records the `NZ` names as spike witnesses, and
 * a production arm carries a name of its own.
 *
 * Other arm names in the comments below — the ones not renamed here — are the
 * spike's, as 0005 records them; they are history rather than files in this
 * repository.
 *
 * The key was not injective for input that types do not police.
 *
 * `canonicalKey` folded `undefined`, `null`, `NaN` and `Infinity` onto the same
 * value, and the runtime did not: a `NaN` settle timeout fires its timer at
 * once, a `NaN` retention keeps nothing. Two requests that behave differently
 * shared a cache entry, which is the one direction of the safety condition that
 * is a defect rather than a cost.
 *
 * The published API is a JavaScript API. These are the inputs a type annotation
 * does not stop.
 */
import type Nostr from 'nostr-typedef';
import { describe, expect, it } from 'vitest';

import { canonicalKey, UnsupportedFilterError } from '$lib/v1/key.js';
import type { RawDescriptor, ReadonlyFilter } from '$lib/v1/normalize.js';
import {
  InvalidDescriptorError,
  LIBRARY_EOSE_TIMEOUT_MS,
  MAX_SETTLE_TIMEOUT_MS,
  normalizeDescriptor
} from '$lib/v1/normalize.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const base: RawDescriptor = { filters: [{ kinds: [1] }], live: false, scopeGeneration: 'nz' };
const keyOf = (raw: RawDescriptor): string => canonicalKey(normalizeDescriptor(raw));

/** What a consumer without types, or with one `as any`, can hand over. */
const raw = (extra: Record<string, unknown>): RawDescriptor =>
  ({ ...base, ...extra }) as RawDescriptor;

describe('the normalization boundary', () => {
  // @contracts B4-C2
  it('NM1: the values that used to collapse into one key are rejected', () => {
    // Each of these produced the same key as omitting the field, and none of
    // them behaves like omitting the field.
    for (const value of [null, Number.NaN, Infinity, -1, 1.5, '5000', 0]) {
      expect(() => keyOf(raw({ settleTimeoutMs: value }))).toThrow(InvalidDescriptorError);
    }
    for (const value of [null, Number.NaN, Infinity, -1, 1.5, '10', 0]) {
      expect(() => keyOf(raw({ retain: value }))).toThrow(InvalidDescriptorError);
    }
    // **One rule, not a list**: non-integers nobody would put in a list, on
    // every field that expects a number — the two descriptor scalars and the
    // filter's own. A boundary that refused the values above by name would
    // let these through.
    for (const value of [2.5, 7 / 3, 1 + 2 ** -20, 1e-7]) {
      expect(() => keyOf(raw({ settleTimeoutMs: value })), `settle ${value}`).toThrow(
        InvalidDescriptorError
      );
      expect(() => keyOf(raw({ retain: value })), `retain ${value}`).toThrow(
        InvalidDescriptorError
      );
      for (const field of ['since', 'until', 'limit'])
        expect(
          () => keyOf(raw({ filters: [{ kinds: [1], [field]: 1_000 + value }] })),
          `${field} ${value}`
        ).toThrow(UnsupportedFilterError);
      expect(() => keyOf(raw({ filters: [{ kinds: [1 + value] }] })), `kinds ${value}`).toThrow(
        UnsupportedFilterError
      );
    }
  });

  it('NM2: rejection is one rule, so the next unlisted value is covered too', () => {
    // The filter's reject set kept ending one example behind because it was a
    // list. This is `Number.isSafeInteger` plus a minimum, so a value nobody
    // enumerated is covered anyway.
    //
    // A non-integer rather than `2 ** 53`, which this used to use. A settle
    // timeout cap arrived later and `2 ** 53` is `MAX_SAFE_INTEGER + 1`, so the
    // cap caught it and the assertion went on passing for a reason that is not
    // this test's — measured, when the mutation that removes the one rule
    // stopped killing it. `1.5` is inside every bound and outside the one rule,
    // which is the only thing this is about.
    expect(() => keyOf(raw({ retain: 1.5 }))).toThrow(InvalidDescriptorError);
    expect(() => keyOf(raw({ retain: 2 ** 53 }))).toThrow(InvalidDescriptorError);
    expect(() => keyOf(raw({ settleTimeoutMs: -0.0001 }))).toThrow(InvalidDescriptorError);
  });

  it('NM3: a prefix id is rejected, because only the local matcher accepts it', () => {
    // rx-nostr matches `ids` and `authors` with `startsWith`; relays match them
    // exactly. So a prefix is a filter that accepts events locally which no
    // relay will ever send — the wire request and the local predicate disagree,
    // which is what the rejected field names exist to prevent.
    expect(() => keyOf(raw({ filters: [{ kinds: [1], ids: ['abc'] }] }))).toThrow(
      UnsupportedFilterError
    );
    expect(() => keyOf(raw({ filters: [{ kinds: [1], authors: [A.slice(0, 32)] }] }))).toThrow(
      UnsupportedFilterError
    );
    expect(() => keyOf(raw({ filters: [{ kinds: [1], authors: [A.toUpperCase()] }] }))).toThrow(
      UnsupportedFilterError
    );
    expect(() => keyOf(raw({ filters: [{ kinds: [1], ids: [A] }] }))).not.toThrow();
    // The same rule, on the two tag fields that also carry ids and pubkeys. It
    // was written for `ids` and `authors` only, which left half the fields it
    // is about unchecked.
    expect(() => keyOf(raw({ filters: [{ kinds: [1], '#e': ['abc'] }] }))).toThrow(
      UnsupportedFilterError
    );
    expect(() => keyOf(raw({ filters: [{ kinds: [1], '#p': [A.toUpperCase()] }] }))).toThrow(
      UnsupportedFilterError
    );
  });

  it('NM9: values outside a filter are checked too, not defaulted', () => {
    // B4's rule is about the descriptor, not only about filters. `live: 'yes'`
    // used to become `false` and `namespace: 7` used to become absent, which is
    // the silent default this boundary exists to remove: two descriptors that
    // behave differently must not arrive at one normalized value.
    expect(() => keyOf(raw({ live: 'yes' }))).toThrow(InvalidDescriptorError);
    expect(() => keyOf(raw({ namespace: 7 }))).toThrow(InvalidDescriptorError);
    // And the two filter bounds whose refusal is about the wire rather than the
    // type: rx-nostr deletes such a filter on the way out, and a request whose
    // filters have all been deleted is never sent.
    expect(() => keyOf(raw({ filters: [{ kinds: [1], until: 0 }] }))).toThrow(
      UnsupportedFilterError
    );
    expect(() => keyOf(raw({ filters: [{ kinds: [1], since: 10, until: 5 }] }))).toThrow(
      UnsupportedFilterError
    );
  });

  it('NM4: element types are checked, not just field names', () => {
    expect(() => keyOf(raw({ filters: [{ kinds: [1, 'x'] }] }))).toThrow(UnsupportedFilterError);
    expect(() => keyOf(raw({ filters: [{ kinds: [1.5] }] }))).toThrow(UnsupportedFilterError);
    expect(() => keyOf(raw({ filters: [{ kinds: [-1] }] }))).toThrow(UnsupportedFilterError);
    // NIP-01 defines a kind as 0-65535. Above that the protocol says nothing,
    // so the relay's behaviour is undefined where the local matcher's is not.
    expect(() => keyOf(raw({ filters: [{ kinds: [65536] }] }))).toThrow(UnsupportedFilterError);
    expect(() => keyOf(raw({ filters: [{ kinds: [65535] }] }))).not.toThrow();
    expect(() => keyOf(raw({ filters: [{ '#e': [1] }] }))).toThrow(UnsupportedFilterError);
    expect(() => keyOf(raw({ filters: [{ authors: A }] }))).toThrow(UnsupportedFilterError);
    expect(() => keyOf(raw({ filters: 'nope' }))).toThrow(InvalidDescriptorError);
    expect(() => keyOf(raw({ filters: [null] }))).toThrow(InvalidDescriptorError);

    // **An explicit `undefined` is a field the caller did not set, and the tag
    // loop was the one place that read it as a value.** Every other field skips
    // one — the scalars in `validateFilter`, the set fields in the loop above —
    // so `{ kinds, '#e': maybeTag }` was a published error while
    // `{ kinds, ids: maybeIds }` was a working request, and the two produce the
    // identical REQ and the identical local predicate. Measured across all
    // seven fields; the pair below is that measurement.
    expect(() => keyOf(raw({ filters: [{ kinds: [1], '#e': undefined }] }))).not.toThrow();
    expect(() => keyOf(raw({ filters: [{ kinds: [1], ids: undefined }] }))).not.toThrow();
    // And the same field with a value it cannot use is still refused, which is
    // what stops this from reading as "tags are unchecked".
    expect(() => keyOf(raw({ filters: [{ kinds: [1], '#e': null }] }))).toThrow(
      UnsupportedFilterError
    );
    // The two are one key, because an absent field and a field written as
    // absent are the same request.
    expect(keyOf(raw({ filters: [{ kinds: [1], '#e': undefined }] }))).toBe(
      keyOf(raw({ filters: [{ kinds: [1] }] }))
    );

    // **`limit` is accepted and `search` is not, and the reason is what they
    // are rather than whether the local matcher reads them** — it reads
    // neither. `search` decides *membership*, so a request carrying it would
    // collect events no predicate checked; `limit` shapes the *response*, so
    // there is nothing for a predicate to reproduce. The pair is here because
    // the rule that stood before was a universal `limit` satisfies while being
    // accepted.
    expect(() => keyOf(raw({ filters: [{ kinds: [1], limit: 5 }] }))).not.toThrow();
    expect(() =>
      keyOf(raw({ filters: [{ kinds: [1], search: 'x' } as unknown as { kinds: number[] }] }))
    ).toThrow(UnsupportedFilterError);
    // And it is part of what the request *is*: two amounts are two requests.
    expect(keyOf(raw({ filters: [{ kinds: [1], limit: 5 }] }))).not.toBe(
      keyOf(raw({ filters: [{ kinds: [1], limit: 6 }] }))
    );
  });

  it('NM5: the default is resolved before the key, so equal requests share one', () => {
    const withDefault = keyOf({ ...base, settleTimeoutMs: 5_000 });
    const without = keyOf(base);

    expect(withDefault).toBe(without);
    expect(keyOf({ ...base, settleTimeoutMs: 8_000 })).not.toBe(without);
  });

  it('NM6: the key cannot be reached without the boundary', () => {
    // The structural half. `canonicalKey` takes a branded value, so this is a
    // type error rather than a convention — and the runtime check below is what
    // a JavaScript consumer would hit instead.
    const notNormalized = { ...base, settleTimeoutMs: Number.NaN } as unknown as Parameters<
      typeof canonicalKey
    >[0];
    // @ts-expect-error a raw descriptor is not a NormalizedDescriptor
    const alsoNot: Parameters<typeof canonicalKey>[0] = { ...base };
    void alsoNot;

    // Reaching past the boundary is possible with a cast, and produces exactly
    // the defect the boundary removes — kept as the counterexample rather than
    // as a claim that casts are impossible.
    expect(canonicalKey(notNormalized)).toBe(
      canonicalKey({ ...base, settleTimeoutMs: null } as unknown as Parameters<
        typeof canonicalKey
      >[0])
    );
  });

  // @contracts B4-C5
  it("NM8: the normalized filters share nothing with the caller's", async () => {
    const { wireFilters } = await import('$lib/v1/stream.js');
    // The alias the brand cannot prevent. `readonly` is a rule about this
    // reference, not about the object — a caller who keeps the array they
    // passed can rewrite it after the key is computed, and then one descriptor
    // produces two different wire requests. That is precisely the divergence
    // between key and wire this boundary exists to remove, arrived at through
    // the door the type system leaves open.
    const authors = [A];
    const filters: Nostr.Filter[] = [{ kinds: [1], authors }];
    const descriptor = normalizeDescriptor(raw({ filters }));
    const before = canonicalKey(descriptor);

    filters[0] = { kinds: [9999] };
    authors.push(B);

    expect(canonicalKey(descriptor)).toBe(before);
    expect(wireFilters(descriptor)).toEqual([{ kinds: [1], authors: [A] }]);

    // The type-level half, which the runtime copy above does not give. The
    // field was `readonly Nostr.Filter[]`, which is a rule about the array and
    // says nothing about the objects in it — so the snapshot was writable by
    // anything holding a filter out of it.
    //
    // Never called, and that is not tidiness: an expected type error still
    // *runs*, and the first version of this mutated the snapshot the two
    // assertions above had just established was safe — measured, by the two of
    // them failing. What checks the claim is the compiler, and an unused
    // `@ts-expect-error` is itself an error, so this fails if the depth is
    // ever lost.
    const typeOnly = (filter: ReadonlyFilter): void => {
      // @ts-expect-error a normalized descriptor's filters are not writable
      filter.kinds = [9999];
      // @ts-expect-error and neither are the arrays inside them
      filter.authors?.push(B);
    };
    void typeOnly;

    // And what the wire hands back is a copy, not the same objects under a
    // different type. This is the half a cast at the dependency's boundary
    // would have silently given up: `wireFilters` returns the mutable shape
    // rx-nostr's signature asks for, and it used to be the descriptor's own.
    const wire = wireFilters(descriptor);
    wire[0]?.authors?.push(B);
    if (wire[0] !== undefined) wire[0].kinds = [9999];

    expect(canonicalKey(descriptor)).toBe(before);
    expect(wireFilters(descriptor)).toEqual([{ kinds: [1], authors: [A] }]);
  });

  // @contracts B4-C3
  it('NM7: a normalized descriptor is what the plan and the wire read too', async () => {
    const { planRequest, wireFilters } = await import('$lib/v1/stream.js');
    // The key, as `NM5` reads it: off the resolved value, so a default written
    // out and a default left out are one key, and a different value is not.
    expect(keyOf({ ...base, settleTimeoutMs: 5_000 })).toBe(keyOf(base));
    expect(keyOf({ ...base, settleTimeoutMs: 8_000 })).not.toBe(keyOf(base));
    const filters: Nostr.Filter[] = [{ kinds: [1] }, { kinds: [7], authors: [] }];
    const descriptor = normalizeDescriptor({ ...base, filters });

    // One value, **two** readers here. The defect was three readers and three
    // interpretations of the caller's object; the third reader is the key, and
    // it is held to that elsewhere — `NM6`, that the key cannot be reached
    // without the boundary, and `NM8`, that what it reads is the boundary's
    // snapshot and not the caller's array.
    //
    // **A third assertion stood here and could not carry the key's half of the
    // claim**: `expect(keyOf({ ...base, filters })).toBe(canonicalKey(descriptor))`,
    // where `keyOf` is defined at the top of this file as
    // `canonicalKey(normalizeDescriptor(raw))`. Both sides went through the
    // boundary, so nothing about the key reading a normalized value was
    // observable — the two sides were the same expression over two objects with
    // equal content.
    //
    // **What was run before removing it, in the spike** (where this arm was
    // `NZ7` and its neighbours `NZ5`, `NZ6` and `NZ8`), because "it looked
    // redundant" is not a measurement:
    //
    // - Both of the spike's mutation-ledger entries that killed this arm —
    //   `plan-and-wire-disagree-on-a-mixed-or-array` and
    //   `empty-set-field-treated-as-no-constraint` — were re-run with the
    //   assertion deleted. Both still killed it, so its whole recorded kill
    //   set was already earned by the two assertions below.
    // - The one property the assertion could uniquely observe is that the key
    //   is a function of the value rather than of the call. A `canonicalKey`
    //   that folds a call counter into its output was built as the positive
    //   control, and it killed the three neighbours (`NM5`, `NM6` and `NM8`
    //   here) as well as this arm.
    expect(planRequest(descriptor)).toBe('open');
    expect(wireFilters(descriptor)).toEqual([{ kinds: [1] }]);
  });
});

describe('A-γ: the request owns its settle timeout', () => {
  it('NM18: every descriptor field is read once, not only the filters', () => {
    // **The read-once repair covered seven fields and one of them has an arm.**
    // `NM13` measures `filters`, which is the half the published hook can reach
    // — `resolveRequest` passes the caller's array on by reference while it
    // rebuilds the scalars. That is a reason the others are hard to *reach*,
    // not a reason they are held: the boundary's own contract is about the
    // object it is handed, and reverting the scalars to `raw.live` /
    // `raw.retain` left every arm in this file green (measured).
    const reads: Record<string, number> = {
      live: 0,
      retain: 0,
      settleTimeoutMs: 0,
      namespace: 0,
      scopeGeneration: 0,
      environment: 0,
      filters: 0
    };
    const counting = {
      get filters(): Nostr.Filter[] {
        reads['filters'] = (reads['filters'] ?? 0) + 1;
        return [{ kinds: [1] }];
      },
      get live(): boolean {
        reads['live'] = (reads['live'] ?? 0) + 1;
        return true;
      },
      get retain(): number {
        reads['retain'] = (reads['retain'] ?? 0) + 1;
        return 5;
      },
      get settleTimeoutMs(): number {
        reads['settleTimeoutMs'] = (reads['settleTimeoutMs'] ?? 0) + 1;
        return 1_000;
      },
      get namespace(): string {
        reads['namespace'] = (reads['namespace'] ?? 0) + 1;
        return 'nz18';
      },
      get scopeGeneration(): string {
        reads['scopeGeneration'] = (reads['scopeGeneration'] ?? 0) + 1;
        return 'g';
      },
      get environment(): 'browser' {
        reads['environment'] = (reads['environment'] ?? 0) + 1;
        return 'browser';
      }
    } as unknown as RawDescriptor;

    const descriptor = normalizeDescriptor(counting);

    // The claim, field by field: anything above one leaves the value that was
    // checked and the value that was kept free to differ.
    expect(reads).toEqual({
      live: 1,
      retain: 1,
      settleTimeoutMs: 1,
      namespace: 1,
      scopeGeneration: 1,
      environment: 1,
      filters: 1
    });
    // And the descriptor is the one those single reads produced, so this is not
    // a boundary that stopped reading.
    expect(descriptor).toMatchObject({ live: true, retain: 5, settleTimeoutMs: 1_000 });
  });

  it('NM16: an unsupported field is refused by name, before anything is read', () => {
    // **The window the read-once repair opened.** Taking the snapshot first put
    // every check behind a read of the caller's object, so a getter on a field
    // this boundary does not support threw before the name was ever looked at —
    // and what came out of `normalizeDescriptor` was the caller's own error,
    // filed as the cache key of the refused entry. That is the defect the spike's `TD13`
    // and `NM12` closed for the relay list and for two descriptor scalars,
    // reopened on the third field by a repair for something else.
    //
    // Names are checkable without reading anything: `Object.keys` enumerates,
    // it does not invoke.
    let read = 0;
    const throwing = {
      kinds: [1],
      get search(): string {
        read += 1;
        throw new Error('from the consumer');
      }
    } as unknown as Nostr.Filter;

    let caught: unknown;
    try {
      normalizeDescriptor({ ...base, filters: [throwing] });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(UnsupportedFilterError);
    expect((caught as Error).message).toContain('search');
    // And it was refused without asking the value anything, which is the whole
    // of why the name check runs where it does.
    expect(read).toBe(0);

    // The control: the same field without a getter is refused the same way, so
    // the arm above is about *when* the name is checked rather than about
    // getters being special.
    expect(() =>
      normalizeDescriptor({ ...base, filters: [{ kinds: [1], search: 'x' } as never] })
    ).toThrow(UnsupportedFilterError);
  });

  it('NM16b: the name check is about names, so an unsupported field set to undefined is still refused', () => {
    // **The cell where the two axes cross**: the field is one this boundary
    // refuses *and* the value is the one that means "I did not use it".
    // `{ kinds: [1], search: maybeSearch }` with `maybeSearch === undefined` is
    // ordinary TypeScript — under the default `exactOptionalPropertyTypes` it
    // type-checks exactly like the field being absent — and it throws here.
    //
    // **That is the decision, not an oversight, and the reason is structural.**
    // Exempting the value means *reading* it, and reading an unsupported
    // field's value on the caller's own object is the hazard `NM16` exists to
    // avoid: a getter that throws comes back as the caller's error, filed as a
    // cache key. There is no way to write "unless it is undefined" that does
    // not invoke the getter. So the rule is: **a name this boundary does not
    // support is refused whatever is behind it** — and the cost is stated
    // rather than hidden, because a consumer spreading an optional field has to
    // omit the key instead (`...(q ? { search: q } : {})`), which for a refused
    // field they cannot use anyway is the smaller surprise.
    let read = 0;
    const absentish = {
      kinds: [1],
      get search(): string | undefined {
        read += 1;
        return undefined;
      }
    } as unknown as Nostr.Filter;

    expect(() => normalizeDescriptor({ ...base, filters: [absentish] })).toThrow(
      UnsupportedFilterError
    );
    // The half that makes it a claim about the rule rather than about this
    // throw: it was refused without the value being asked at all.
    expect(read, 'the value of an unsupported field is never read').toBe(0);

    // **Both kinds of unsupported name**, because they are two branches:
    // `search` is on the rejected list, `kindz` is merely unknown, and a fix
    // that exempted undefined for one would be as wrong for the other. A
    // typo'd field silently doing nothing is the failure this catches.
    expect(() =>
      normalizeDescriptor({
        ...base,
        filters: [{ kinds: [1], kindz: undefined } as unknown as Nostr.Filter]
      })
    ).toThrow(UnsupportedFilterError);

    // And the control on the other side, so this is not "everything throws":
    // a *supported* scalar set to undefined is the field being absent, which is
    // what `validateFilter` already says by skipping it, and the request is
    // built.
    //
    // **The cast is part of the finding.** This repository compiles with
    // `exactOptionalPropertyTypes`, under which `since: undefined` is not a
    // `Nostr.Filter` at all — so the case is invisible from inside here and
    // ordinary in a consumer's project, where the flag is off by default.
    expect(() =>
      normalizeDescriptor({
        ...base,
        filters: [{ kinds: [1], since: undefined, limit: undefined } as unknown as Nostr.Filter]
      })
    ).not.toThrow();
  });

  it('NM19: an unknown-kind by-id request is sent when it is not live, and refused when it is', () => {
    // **`B7a` adjudicated, and this is the pair that decides it.** The rule used
    // to be "a filter that *could* select an ephemeral event is refused", and a
    // filter with no `kinds` matches every kind — so `{ ids, limit }` was
    // refused. That is the descriptor `0004` specifies for `Event`, `EventList`
    // and `UniqueEventList`, and the shape a consumer holds whenever an id
    // arrives from an `e` tag, a `nevent1…` link, a quote or a bookmark without
    // a kind beside it. **The library refused its own components**, and a
    // consumer forced to guess a kind is answered "this does not exist" when the
    // guess is wrong — which is the sentence `C12` exists to forbid.
    //
    // The split is what each leg can report. A backlog is a finite answer, so an
    // ephemeral arrival can be dropped and *said* — `ephemeral-event-omitted`. A
    // forward leg has nowhere to say it, so the absence stays refused there.
    const byId = [{ ids: ['a'.repeat(64)], limit: 1 }] as unknown as Nostr.Filter[];

    expect(() => normalizeDescriptor({ ...base, live: false, filters: byId })).not.toThrow();
    expect(() => normalizeDescriptor({ ...base, live: true, retain: 10, filters: byId })).toThrow(
      UnsupportedFilterError
    );

    // **Both edges of the other half**: naming an ephemeral kind is refused
    // whichever leg asks, because that is a fault a caller can see in their own
    // descriptor. Without this the arm would pass on an implementation that
    // simply stopped checking `kinds` at all.
    const named = [{ kinds: [20_001] }] as unknown as Nostr.Filter[];
    expect(() => normalizeDescriptor({ ...base, live: false, filters: named })).toThrow(
      UnsupportedFilterError
    );
    expect(() => normalizeDescriptor({ ...base, live: true, retain: 10, filters: named })).toThrow(
      UnsupportedFilterError
    );

    // And an ordinary named kind is accepted on both, so "refused" above is
    // about the kinds and not about the leg.
    const ordinary = [{ kinds: [1] }] as unknown as Nostr.Filter[];
    expect(() => normalizeDescriptor({ ...base, live: false, filters: ordinary })).not.toThrow();
    expect(() =>
      normalizeDescriptor({ ...base, live: true, retain: 10, filters: ordinary })
    ).not.toThrow();
  });

  it('NM17: the boundary checks the filter it will send, which is its own fields', () => {
    // **A decision the read-once repair made and did not state.** The snapshot
    // is `Object.entries`, so it holds a filter's own enumerable fields — which
    // is exactly what `JSON.stringify` puts on the wire. A field reachable only
    // through the prototype is therefore neither checked nor sent, and both
    // halves of that follow from one rule rather than from an oversight.
    //
    // Measured against the shape before it: the boundary used to read
    // `filter['kinds']` directly, so a filter whose `kinds` lived on its
    // prototype was **admitted as one with no `kinds` at all** — a REQ matching
    // every kind, ephemeral included, which is the refusal `B7a` exists to
    // make. That direction is closed here; the other is the price.
    //
    // **Driven `live` since `B7a` split on it.** An absent `kinds` is accepted on
    // a non-live request now — that is the by-id request three published
    // components make — so `base` no longer refuses one and would have made this
    // assertion vacuous. `live: true` is where the absence is still refused, so
    // it is still the case that shows the snapshot did not see an inherited
    // `kinds`: the filter *has* one through its prototype, and the boundary
    // refuses it as a filter that has none.
    const inheritedKinds = Object.create({ kinds: [1] }) as Nostr.Filter;
    // `retain` is named because `B-ε` requires a live request to name one; it is
    // not what either assertion is about.
    const liveBase = { ...base, live: true, retain: 10 } as const;
    expect(() => normalizeDescriptor({ ...liveBase, filters: [inheritedKinds] })).toThrow(
      UnsupportedFilterError
    );
    // And the control, so the refusal above is the prototype and not `live`: the
    // same kinds as an **own** field is accepted on the same live request.
    expect(() => normalizeDescriptor({ ...liveBase, filters: [{ kinds: [1] }] })).not.toThrow();

    const inheritedBadField = Object.create({ ids: ['not-a-64-hex-id'] }) as Record<
      string,
      unknown
    >;
    inheritedBadField['kinds'] = [1];
    const descriptor = normalizeDescriptor({
      ...base,
      filters: [inheritedBadField as unknown as Nostr.Filter]
    });
    // Accepted, and what is stored is what will be sent: the inherited field is
    // in neither.
    expect(descriptor.filters).toEqual([{ kinds: [1] }]);
  });

  it('NM14: values refused for different reasons are not refused with the same message', () => {
    // **The collision this boundary exists to remove, reproduced inside its own
    // diagnostics.** `JSON.stringify` answers `null` for `NaN` and for both
    // infinities, so four different mistakes arrived as one message — and the
    // message is what the refused entry is keyed under, so they arrived as one
    // cache entry too. A caller whose `parseInt` produced a `NaN` was told they
    // had passed `null` and went looking for a `null` they never wrote.
    const message = (value: unknown): string => {
      try {
        normalizeDescriptor({ ...base, retain: value } as RawDescriptor);
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    };

    const refused = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null];
    const messages = refused.map(message);
    // Every one of them is refused — the premise, without which four identical
    // empty strings would satisfy nothing below.
    expect(messages.filter((each) => each !== '')).toHaveLength(4);
    expect(new Set(messages).size).toBe(4);
  });

  it('NM15: the refusal names the value without carrying all of it', () => {
    // **The message is a value this library stores, not only one it prints**:
    // `resolveRequest` files the refused entry under it. `JSON.stringify`
    // rendered the caller's object in full, so a descriptor field holding a
    // large object put megabytes into the message and the same megabytes into
    // the cache key, once per distinct value.
    const big = 'S'.repeat(1_000_000);
    let caught: unknown;
    try {
      normalizeDescriptor({ ...base, retain: { note: big } } as unknown as RawDescriptor);
    } catch (error) {
      caught = error;
    }
    const message = (caught as Error).message;
    expect(message.length).toBeLessThan(2_000);
    // And what survives is the beginning, which is where a caller finds their
    // own mistake — the field and the rule are still in it.
    expect(message).toContain('retain');
    // **A hundred and fifty characters of it, not "some".** `toContain('{"note":"SSS')`
    // was the first form and a bound of twenty satisfies it; so does a bound
    // that trims a character off every cut. The rendering is pinned from both
    // sides: at least this much of the value survives, and the cut is exactly
    // at the bound when no character straddles it.
    expect(message).toContain(`{"note":"${'S'.repeat(150)}`);
    const rendered = /and was (.*)… \(cut\)/.exec(message)?.[1];
    expect(rendered).toHaveLength(200);

    // **And the bound is the function's rather than one branch's.** It sat
    // inside the `JSON.stringify` branch, so a symbol and a bigint went round
    // it: measured, `Symbol('X'.repeat(1_000_000))` made a message — and a
    // cache key — of a million characters while the record said the message is
    // bounded. Both are asserted here because they are different branches, not
    // because two examples are better than one.
    for (const huge of [Symbol('S'.repeat(1_000_000)), 10n ** 200_000n]) {
      let vast: unknown;
      try {
        normalizeDescriptor({ ...base, retain: huge } as unknown as RawDescriptor);
      } catch (error) {
        vast = error;
      }
      expect((vast as Error).message.length, String(typeof huge)).toBeLessThan(2_000);
    }

    // **The other edge, and without it a refusal that rendered nothing at all
    // would pass the assertions above.** A value small enough to show is shown
    // whole.
    let small: unknown;
    try {
      normalizeDescriptor({ ...base, retain: { note: 'short' } } as unknown as RawDescriptor);
    } catch (error) {
      small = error;
    }
    expect((small as Error).message).toContain('{"note":"short"}');
    expect((small as Error).message).not.toContain('(cut)');

    // **And the cut is at a character rather than at a code unit.** The bound is
    // counted in UTF-16 units and a character can be two of them, so a cut that
    // lands between the halves of a surrogate pair leaves half a character in
    // the message — and the message is a cache key, so it is half a character in
    // a key. 190 letters put an emoji exactly across this boundary.
    let split: unknown;
    try {
      normalizeDescriptor({
        ...base,
        retain: { note: `${'A'.repeat(190)}😀${'B'.repeat(50)}` }
      } as unknown as RawDescriptor);
    } catch (error) {
      split = error;
    }
    const cut = (split as Error).message;
    expect(cut).toContain('… (cut)');
    expect(/[\uD800-\uDBFF]… \(cut\)/.test(cut)).toBe(false);
  });

  it('NM13: the filter that was checked is the filter that is stored', () => {
    // **The boundary asked the caller's object four times and kept the fourth
    // answer.** `validateFilter`, `checkFilterValues`, `selectsEphemeral` and
    // `cloneFilter` each read the filter separately, so a field that answers
    // differently on the way past is checked as one thing and stored as
    // another. The descriptor's own docblock says why that matters: a snapshot
    // is taken "not the caller's array", because the key and the wire have to
    // be computed from the same values.
    //
    // **This is reachable through the published hook**, and it is the only half
    // of the class that is: `resolveRequest` rebuilds the descriptor as an
    // object literal, reading each of its own options once — but it passes
    // `filters` on by reference, so the *elements* are still the caller's
    // objects when they arrive here.
    //
    // The value chosen is the one the boundary refuses on purpose. An ephemeral
    // kind reaching the wire is the failure `selectsEphemeral` exists to
    // prevent: the REQ matches events the retention layer drops, so the answer
    // is missing part of itself and still reports "nothing found".
    let reads = 0;
    const moving = {
      get kinds(): number[] {
        reads += 1;
        return reads === 1 ? [1] : [20_000];
      }
    } as unknown as Nostr.Filter;

    const descriptor = normalizeDescriptor({ ...base, filters: [moving] });

    // The claim: what is stored is what was checked, whatever the object did
    // afterwards.
    expect(descriptor.filters).toEqual([{ kinds: [1] }]);
    // And it was read once, which is the property rather than a proxy for it:
    // any number above one leaves the two answers free to differ again.
    expect(reads).toBe(1);
  });

  it('NM13b: and a filter whose first answer is ephemeral is still refused', () => {
    // **The other edge, and without it `NM13` is satisfied by a boundary that
    // stopped checking.** Reading once is only right if the one read is the one
    // the refusal is computed from.
    let reads = 0;
    const moving = {
      get kinds(): number[] {
        reads += 1;
        return reads === 1 ? [20_000] : [1];
      }
    } as unknown as Nostr.Filter;

    expect(() => normalizeDescriptor({ ...base, filters: [moving] })).toThrow(
      UnsupportedFilterError
    );
  });

  // @contracts B4-C6
  it('NM12: a descriptor value the refusal cannot render is still refused, not thrown past', () => {
    // The values the row starts from, as `NM9` reads them: refused, not
    // coerced — a non-boolean `live`, a non-string `namespace`, `until: 0`, and
    // a `since` later than its `until`.
    expect(() => keyOf(raw({ live: 'yes' }))).toThrow(InvalidDescriptorError);
    expect(() => keyOf(raw({ namespace: 7 }))).toThrow(InvalidDescriptorError);
    expect(() => keyOf(raw({ filters: [{ kinds: [1], until: 0 }] }))).toThrow(
      UnsupportedFilterError
    );
    expect(() => keyOf(raw({ filters: [{ kinds: [1], since: 10, until: 5 }] }))).toThrow(
      UnsupportedFilterError
    );
    // **The sibling of the spike's `TD13`, found by sweeping it rather than by a reviewer.**
    // The relay-list refusal built its message with `JSON.stringify` on the
    // caller's value and threw for three classes of input; `settleTimeoutMs` and
    // `retain` are published descriptor fields checked the same way, through the
    // same builder, so the same four values reached the same door here.
    //
    // A `RawDescriptor` annotation stops none of them — the surface is a
    // JavaScript API, which is the premise the runtime check rests on — so these
    // are exactly the values the check exists for.
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    // **The third column is the message's own claim about the value**, and it is
    // here because the negative assertions below were satisfied by a refusal
    // that says nothing about it: replacing every rendering with a constant
    // leaves all four green. What this arm held was "the refusal is ours and
    // does not name the wrong fault", not "the refusal names the value".
    const hostile: readonly (readonly [string, unknown, string])[] = [
      ['a bigint', 1n, 'and was 1n'],
      ['an object holding itself', circular, 'and was an unserialisable object'],
      [
        'a throwing toJSON',
        {
          toJSON: () => {
            throw new Error('from the consumer');
          }
        },
        'and was an unserialisable object'
      ],
      ['a symbol', Symbol('nope'), 'and was Symbol(nope)']
    ];

    for (const [name, value, shown] of hostile) {
      for (const field of ['settleTimeoutMs', 'retain'] as const) {
        let caught: unknown;
        try {
          normalizeDescriptor({ ...base, [field]: value } as unknown as RawDescriptor);
        } catch (error) {
          caught = error;
        }
        const where = `${name} in ${field}`;
        expect(caught, where).toBeInstanceOf(InvalidDescriptorError);
        // Not the consumer's error wearing this library's shape, and not a
        // message naming the wrong fault.
        expect((caught as Error).message, where).toMatch(/^nosvelte: /);
        expect((caught as Error).message, where).not.toContain('from the consumer');
        expect((caught as Error).message, where).not.toContain('and was undefined');
        // And it says what it saw.
        expect((caught as Error).message, where).toContain(shown);
      }
    }
  });

  it('NM20: an empty relay URL is refused by name, and a non-empty one is not', () => {
    // **The clause nothing observed.** `relays` is checked with `typeof url ===
    // 'string' && url !== ''`, and dropping the second half left all 847 arms of
    // the spike suite green — found by flipping every `&&` and `||` in the
    // library one at a time, 117 of them, ten unobserved. An empty string is a
    // relay the transport cannot open and the scope cannot name, so it is
    // refused where every other descriptor fault is: by field, before the wire.
    //
    // Both sides, because a check that only refuses is satisfied by refusing
    // every list.
    expect(() => normalizeDescriptor({ ...base, relays: ['wss://a.example'] })).not.toThrow();
    expect(() => normalizeDescriptor({ ...base, relays: [''] })).toThrow(InvalidDescriptorError);
    // And one bad entry among good ones is still the whole list's refusal:
    // `every` is the quantifier, which is a separate claim from the emptiness.
    expect(() => normalizeDescriptor({ ...base, relays: ['wss://a.example', ''] })).toThrow(
      InvalidDescriptorError
    );
  });

  it('NM11: a settle timeout the request could not own is refused, not clamped', () => {
    // The ceiling is about the dependency and not about taste. rx-nostr runs its
    // own `eoseTimeout`, which *completes* the backward observable (the spike sentinel `SEN14`), and
    // the provider sets it to `LIBRARY_EOSE_TIMEOUT_MS`. Above that the request
    // would stop being the thing that decides when its backlog gives up, which
    // is A-γ quietly becoming false rather than a large number being unwise.
    expect(() =>
      normalizeDescriptor({ ...base, settleTimeoutMs: MAX_SETTLE_TIMEOUT_MS })
    ).not.toThrow();
    expect(() =>
      normalizeDescriptor({ ...base, settleTimeoutMs: MAX_SETTLE_TIMEOUT_MS + 1 })
    ).toThrow(InvalidDescriptorError);

    // Refused rather than clamped, which is the same rule the rest of this
    // boundary follows: a caller who asked for ten minutes and silently got one
    // would be told nothing, and the key would agree with neither request.
    expect(() => normalizeDescriptor({ ...base, settleTimeoutMs: 600_000 })).toThrow(
      /must be at most 60000/
    );

    // And the headroom is real: the upstream timer has to be far enough above
    // the largest accepted value that it is never the one that fires.
    expect(LIBRARY_EOSE_TIMEOUT_MS).toBeGreaterThan(MAX_SETTLE_TIMEOUT_MS);
  });
});

describe('B-ε: retention is a choice', () => {
  it('NM10: a live request has to say what it keeps, and can say unbounded', () => {
    // The wire is the same either way — this is about what the client keeps.
    // A live subscription has no natural end, so its retained set grows for as
    // long as it lives, and a number cannot be defaulted on the caller's behalf
    // because B6 bounds newest-first: a default would discard events they asked
    // for and were told nothing about.
    expect(() =>
      normalizeDescriptor({ filters: [{ kinds: [1] }], live: true, scopeGeneration: 'g' })
    ).toThrow(/retain is required/);

    // Both spellings are accepted, and neither truncates silently.
    expect(
      normalizeDescriptor({
        filters: [{ kinds: [1] }],
        live: true,
        retain: 'unbounded',
        scopeGeneration: 'g'
      }).retain
    ).toBe('unbounded');
    expect(
      normalizeDescriptor({
        filters: [{ kinds: [1] }],
        live: true,
        retain: 50,
        scopeGeneration: 'g'
      }).retain
    ).toBe(50);

    // A request that ends may leave it out, and that resolves to the same value
    // as saying it — so the two spellings share a cache entry rather than
    // splitting one.
    expect(
      normalizeDescriptor({ filters: [{ kinds: [1] }], live: false, scopeGeneration: 'g' }).retain
    ).toBe('unbounded');
  });
});
