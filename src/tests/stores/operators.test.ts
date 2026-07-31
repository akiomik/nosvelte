import { from, lastValueFrom, toArray } from 'rxjs';
import { describe, expect, it } from 'vitest';

import {
  collectGroupBy,
  filterId,
  filterMetadataList,
  filterNaddr,
  filterPubkey,
  filterTextList,
  latestEachNaddr,
  latestEachPubkey,
  scanArray,
  scanLatestEach
} from '$lib/stores/operators.js';

import { fakeEventPacket } from '../helpers/relay.js';

describe('filterId', () => {
  it('only passes packets whose event id matches', async () => {
    const matching = fakeEventPacket({ id: 'a' });
    const other = fakeEventPacket({ id: 'b' });

    const actual = await lastValueFrom(from([matching, other]).pipe(filterId('a'), toArray()));

    expect(actual).toEqual([matching]);
  });
});

describe('filterPubkey', () => {
  it('only passes packets whose event pubkey matches', async () => {
    const matching = fakeEventPacket({ pubkey: 'p1' });
    const other = fakeEventPacket({ pubkey: 'p2' });

    const actual = await lastValueFrom(from([matching, other]).pipe(filterPubkey('p1'), toArray()));

    expect(actual).toEqual([matching]);
  });
});

describe('filterTextList', () => {
  it('only passes kind 1 events whose id is in the given list', async () => {
    const matching = fakeEventPacket({ id: 'a', kind: 1 });
    const wrongId = fakeEventPacket({ id: 'z', kind: 1 });
    const wrongKind = fakeEventPacket({ id: 'a', kind: 0 });

    const actual = await lastValueFrom(
      from([matching, wrongId, wrongKind]).pipe(filterTextList(['a', 'b']), toArray())
    );

    expect(actual).toEqual([matching]);
  });
});

describe('filterMetadataList', () => {
  it('only passes kind 0 events whose pubkey is in the given list', async () => {
    const matching = fakeEventPacket({ pubkey: 'p1', kind: 0 });
    const wrongPubkey = fakeEventPacket({ pubkey: 'z', kind: 0 });
    const wrongKind = fakeEventPacket({ pubkey: 'p1', kind: 1 });

    const actual = await lastValueFrom(
      from([matching, wrongPubkey, wrongKind]).pipe(filterMetadataList(['p1', 'p2']), toArray())
    );

    expect(actual).toEqual([matching]);
  });
});

describe('filterNaddr', () => {
  it('only passes events matching kind, pubkey and the "d" tag identifier', async () => {
    const matching = fakeEventPacket({ kind: 30023, pubkey: 'p1', tags: [['d', 'article-1']] });
    const wrongIdentifier = fakeEventPacket({
      kind: 30023,
      pubkey: 'p1',
      tags: [['d', 'article-2']]
    });
    const wrongPubkey = fakeEventPacket({ kind: 30023, pubkey: 'p2', tags: [['d', 'article-1']] });
    const wrongKind = fakeEventPacket({ kind: 1, pubkey: 'p1', tags: [['d', 'article-1']] });

    const actual = await lastValueFrom(
      from([matching, wrongIdentifier, wrongPubkey, wrongKind]).pipe(
        filterNaddr(30023, 'p1', 'article-1'),
        toArray()
      )
    );

    expect(actual).toEqual([matching]);
  });

  it('finds the "d" tag wherever it sits in the tag list', async () => {
    // NIP-01 doesn't require `d` to come first, and long-form clients routinely
    // put `title` ahead of it.
    const matching = fakeEventPacket({
      kind: 30023,
      pubkey: 'p1',
      tags: [
        ['title', 'Hello'],
        ['d', 'article-1']
      ]
    });

    const actual = await lastValueFrom(
      from([matching]).pipe(filterNaddr(30023, 'p1', 'article-1'), toArray())
    );

    expect(actual).toEqual([matching]);
  });

  it('treats an event without a "d" tag as having an empty identifier', async () => {
    const noDTag = fakeEventPacket({ kind: 30023, pubkey: 'p1', tags: [['title', 'Hello']] });

    const actual = await lastValueFrom(
      from([noDTag]).pipe(filterNaddr(30023, 'p1', ''), toArray())
    );

    expect(actual).toEqual([noDTag]);
  });
});

describe('latestEachPubkey', () => {
  it('only passes events that are newer than the latest seen for their pubkey', async () => {
    const first = fakeEventPacket({ id: 'e1', pubkey: 'p1', created_at: 1 });
    const newer = fakeEventPacket({ id: 'e2', pubkey: 'p1', created_at: 2 });
    const stale = fakeEventPacket({ id: 'e3', pubkey: 'p1', created_at: 1 });
    const otherPubkey = fakeEventPacket({ id: 'e4', pubkey: 'p2', created_at: 1 });

    const actual = await lastValueFrom(
      from([first, newer, stale, otherPubkey]).pipe(latestEachPubkey(), toArray())
    );

    expect(actual).toEqual([first, newer, otherPubkey]);
  });
});

describe('latestEachNaddr', () => {
  it('only passes events that are newer than the latest seen for their kind/pubkey/identifier', async () => {
    const first = fakeEventPacket({
      id: 'e1',
      kind: 30023,
      pubkey: 'p1',
      tags: [['d', 'article-1']],
      created_at: 1
    });
    const newer = fakeEventPacket({
      id: 'e2',
      kind: 30023,
      pubkey: 'p1',
      tags: [['d', 'article-1']],
      created_at: 2
    });
    const stale = fakeEventPacket({
      id: 'e3',
      kind: 30023,
      pubkey: 'p1',
      tags: [['d', 'article-1']],
      created_at: 1
    });
    const otherIdentifier = fakeEventPacket({
      id: 'e4',
      kind: 30023,
      pubkey: 'p1',
      tags: [['d', 'article-2']],
      created_at: 1
    });

    const actual = await lastValueFrom(
      from([first, newer, stale, otherIdentifier]).pipe(latestEachNaddr(), toArray())
    );

    expect(actual).toEqual([first, newer, otherIdentifier]);
  });

  it('keys off the "d" tag wherever it sits, so distinct articles stay distinct', async () => {
    // Both articles lead with the same hashtag; only the `d` tag tells them
    // apart. Relays answer newest-first, so the older one arrives second and
    // would be dropped as stale if they shared a key.
    const newer = fakeEventPacket({
      id: 'e1',
      kind: 30023,
      pubkey: 'p1',
      created_at: 2,
      tags: [
        ['t', 'nostr'],
        ['d', 'article-1']
      ]
    });
    const older = fakeEventPacket({
      id: 'e2',
      kind: 30023,
      pubkey: 'p1',
      created_at: 1,
      tags: [
        ['t', 'nostr'],
        ['d', 'article-2']
      ]
    });

    const actual = await lastValueFrom(from([newer, older]).pipe(latestEachNaddr(), toArray()));

    expect(actual).toEqual([newer, older]);
  });
});

describe('scanArray', () => {
  it('accumulates emitted values into a growing array', async () => {
    const actual = await lastValueFrom(from([1, 2, 3]).pipe(scanArray(), toArray()));

    expect(actual).toEqual([[1], [1, 2], [1, 2, 3]]);
  });
});

describe('collectGroupBy', () => {
  it('groups accumulated values by key into a Map', async () => {
    const actual = await lastValueFrom(
      from([1, 2, 3, 4]).pipe(
        collectGroupBy((n) => (n % 2 === 0 ? 'even' : 'odd')),
        toArray()
      )
    );

    expect(actual.at(-1)).toEqual(
      new Map([
        ['odd', [1, 3]],
        ['even', [2, 4]]
      ])
    );
  });
});

describe('scanLatestEach', () => {
  it('keeps only the last value seen for each key, in first-seen order', async () => {
    const actual = await lastValueFrom(
      from(['p1-a', 'p2-a', 'p1-b']).pipe(
        scanLatestEach((s) => s.slice(0, 2)),
        toArray()
      )
    );

    expect(actual.at(-1)).toEqual(['p1-b', 'p2-a']);
  });
});
