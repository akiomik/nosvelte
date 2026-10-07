/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The B5 mutation walk: the ledger of the landings of `B5-C1`, `C2`, `C3`,
 * `C4`, `C5` and `C7` (`identity.test.ts`, `bounded.test.ts`), each entry an
 * edit of the fold or of the bound and the arm it must fail. Moved here from
 * #141, where it was attached as a script, at 807ea1e. An id ending `@ARM`
 * holds one mutation against one of several arms; the runner runs such a
 * mutation once. An entry of `ES6d` or `ES6f` requires both to fail, as the
 * script did: they hold one clause, under a still clock and under one that
 * moves between arrivals.
 */
import type { Ledger } from '../ledger.ts';

export default {
  name: 'b5-walk',
  subject: '`B5-C1`, `C2`, `C3`, `C4`, `C5` and `C7`: the fold and the bound',
  files: [
    'src/tests/contracts/engine/identity.test.ts',
    'src/tests/contracts/engine/bounded.test.ts'
  ],
  calibration: {
    measured:
      'the median of each run in a full run at 1bcb5a9, one worker, on a shared 10-core machine; ES6d and ES6f, always run together, share their run',
    seconds: { ES1b: 3, ES28: 4.4, ES3: 3, ES5: 6.6, ES6d: 16.3, ES6f: 16.3 }
  },
  entries: [
    {
      id: 'C7-3-not-special',
      arm: 'ES1b',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (kind === 0 || kind === 3) return 'replaceable';",
          to: "  if (kind === 0) return 'replaceable';"
        }
      ]
    },
    {
      id: 'C7-0-not-special',
      arm: 'ES1b',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (kind === 0 || kind === 3) return 'replaceable';",
          to: "  if (kind === 3) return 'replaceable';"
        }
      ]
    },
    {
      id: 'C7-every-low-kind',
      arm: 'ES1b',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (kind === 0 || kind === 3) return 'replaceable';",
          to: "  if (kind <= 4) return 'replaceable';"
        }
      ]
    },
    {
      id: 'C7-replaceable-first',
      arm: 'ES1b',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (kind >= 10000 && kind < 20000) return 'replaceable';",
          to: "  if (kind > 10000 && kind < 20000) return 'replaceable';"
        }
      ]
    },
    {
      id: 'C7-replaceable-last',
      arm: 'ES1b',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (kind >= 10000 && kind < 20000) return 'replaceable';",
          to: "  if (kind >= 10000 && kind < 19999) return 'replaceable';"
        }
      ]
    },
    {
      id: 'C7-before-replaceable',
      arm: 'ES1b',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (kind >= 10000 && kind < 20000) return 'replaceable';",
          to: "  if (kind >= 9999 && kind < 20000) return 'replaceable';"
        }
      ]
    },
    {
      id: 'C7-ephemeral-first',
      arm: 'ES1b',
      edits: [
        {
          file: 'src/lib/v1/normalize.ts',
          from: 'kind >= 20_000 && kind < 30_000',
          to: 'kind > 20_000 && kind < 30_000'
        }
      ]
    },
    {
      id: 'C7-ephemeral-last',
      arm: 'ES1b',
      edits: [
        {
          file: 'src/lib/v1/normalize.ts',
          from: 'kind >= 20_000 && kind < 30_000',
          to: 'kind >= 20_000 && kind < 29_999'
        }
      ]
    },
    {
      id: 'C7-addressable-first',
      arm: 'ES1b',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (kind >= 30000 && kind < 40000) return 'addressable';",
          to: "  if (kind > 30000 && kind < 40000) return 'addressable';"
        }
      ]
    },
    {
      id: 'C7-addressable-last',
      arm: 'ES1b',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (kind >= 30000 && kind < 40000) return 'addressable';",
          to: "  if (kind >= 30000 && kind < 39999) return 'addressable';"
        }
      ]
    },
    {
      id: 'C7-after-addressable',
      arm: 'ES1b',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  if (kind >= 30000 && kind < 40000) return 'addressable';",
          to: "  if (kind >= 30000 && kind <= 40000) return 'addressable';"
        }
      ]
    },
    {
      id: 'C1-replaceable-by-id',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}`;',
          to: '      return event.id;'
        }
      ]
    },
    {
      id: 'C1-replaceable-without-author',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}`;',
          to: '      return `${event.kind}`;'
        }
      ]
    },
    {
      id: 'C1-addressable-without-d',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}:${identifierOf(event)}`;',
          to: '      return `${event.kind}:${event.pubkey}`;'
        }
      ]
    },
    {
      id: 'C1-regular-replaced',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    default:\n      return event.id;',
          to: '    default:\n      return `${event.kind}:${event.pubkey}`;'
        }
      ]
    },
    {
      id: 'C1-older-wins',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;',
          to: '  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? a : b;'
        }
      ]
    },
    {
      id: 'C1-never-replaced',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    if (winner === current.event) return set;',
          to: '    return set;'
        }
      ]
    },
    {
      id: 'C2-tie-to-arrival',
      arm: 'ES5',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  return a.id <= b.id ? a : b;',
          to: '  return b;'
        }
      ]
    },
    {
      id: 'C2-tie-reversed',
      arm: 'ES5',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  return a.id <= b.id ? a : b;',
          to: '  return a.id >= b.id ? a : b;'
        }
      ]
    },
    {
      id: 'C2-nothing-stored',
      arm: 'ES5',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  entries.set(key, packet);\n  return { ...set, entries };',
          to: '  return { ...set, entries };'
        }
      ]
    },
    {
      id: 'C3-rebuilt-on-replay',
      arm: 'ES3',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    if (winner === current.event) return set;',
          to: '    if (winner === current.event) return { ...set, entries: new Map(set.entries) };'
        }
      ]
    },
    {
      id: 'C3-equal-replaces',
      arm: 'ES3',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  return a.id <= b.id ? a : b;',
          to: '  return a.id < b.id ? a : b;'
        }
      ]
    },
    {
      id: 'C4-keep-latest-arrival',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  const newestFirst = [...entries.entries()].sort(([, a], [, b]) => byRecency(a, b));',
          to: '  const newestFirst = [...entries.entries()].reverse();'
        }
      ]
    },
    {
      id: 'C5-keep-latest-arrival',
      arm: 'ES6f',
      requires: ['ES6d'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  const newestFirst = [...entries.entries()].sort(([, a], [, b]) => byRecency(a, b));',
          to: '  const newestFirst = [...entries.entries()].reverse();'
        }
      ]
    },
    {
      id: 'C1-range-without-author',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}`;',
          to: '      return event.kind >= 10000 ? `${event.kind}` : `${event.kind}:${event.pubkey}`;'
        }
      ]
    },
    {
      id: 'C1-addressable-without-author',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}:${identifierOf(event)}`;',
          to: '      return `${event.kind}:${identifierOf(event)}`;'
        }
      ]
    },
    {
      id: 'C1-first-tag-as-d',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return tags[0]?.[1] ?? '';"
        }
      ]
    },
    {
      id: 'C1-addressable-arrival-wins',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;',
          to: "  if (classifyKind(a.kind) === 'addressable') return b;\n  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;"
        }
      ]
    },
    {
      id: 'C2-addressable-tie-arrival',
      arm: 'ES5',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  return a.id <= b.id ? a : b;',
          to: "  if (classifyKind(a.kind) === 'addressable') return b;\n  return a.id <= b.id ? a : b;"
        }
      ]
    },
    {
      id: 'C2-range-tie-arrival',
      arm: 'ES5',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  return a.id <= b.id ? a : b;',
          to: '  if (a.kind >= 10000) return b;\n  return a.id <= b.id ? a : b;'
        }
      ]
    },
    {
      id: 'C3-ephemeral-rebuilt',
      arm: 'ES3',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    return set.ephemeralOmitted === true ? set : { ...set, ephemeralOmitted: true };',
          to: '    return { ...set, ephemeralOmitted: true };'
        }
      ]
    },
    {
      id: 'C3-addressable-replay-rebuilt',
      arm: 'ES3',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    if (winner === current.event) return set;',
          to: "    if (winner === current.event) return classifyKind(packet.event.kind) === 'addressable' ? { ...set, entries: new Map(set.entries) } : set;"
        }
      ]
    },
    {
      id: 'C4-keep-oldest',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  const newestFirst = [...entries.entries()].sort(([, a], [, b]) => byRecency(a, b));',
          to: '  const newestFirst = [...entries.entries()].sort(([, a], [, b]) => byRecency(b, a));'
        }
      ]
    },
    {
      id: 'C5-expiry-ranked',
      arm: 'ES6f',
      requires: ['ES6d'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  { retain }: RetentionOptions = {}\n): CachedEventSet {\n  const entries = keepNewest(set.entries, retain);',
          to: "  { retain, now }: RetentionOptions & { now?: number } = {}\n): CachedEventSet {\n  const live = (p: OwnedPacket): boolean => !((expiresAt(p.event) ?? Infinity) <= (now ?? -Infinity));\n  const entries = retain === undefined || retain === 'unbounded' || set.entries.size <= retain ? set.entries : new Map([...set.entries].sort(([, a], [, b]) => Number(live(b)) - Number(live(a)) || byRecency(a, b)).slice(0, retain));"
        }
      ]
    },
    {
      id: 'X1-regular-equal-replaces',
      arm: 'ES3',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  return a.id <= b.id ? a : b;',
          to: "  return (classifyKind(a.kind) === 'regular' ? a.id < b.id : a.id <= b.id) ? a : b;"
        }
      ]
    },
    {
      id: 'X2-older-wins@ES6d',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;',
          to: '  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? a : b;'
        }
      ]
    },
    {
      id: 'X3-no-recency',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;\n',
          to: ''
        }
      ]
    },
    {
      id: 'X4-replaceable-without-kind',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}`;',
          to: '      return `${event.pubkey}`;'
        }
      ]
    },
    {
      id: 'X4-addressable-without-kind',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}:${identifierOf(event)}`;',
          to: '      return `${event.pubkey}:${identifierOf(event)}`;'
        }
      ]
    },
    {
      id: 'X4-replaceable-with-d',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}`;',
          to: '      return `${event.kind}:${event.pubkey}:${identifierOf(event)}`;'
        }
      ]
    },
    {
      id: 'Y1-replaceable-by-id@ES6d',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}`;',
          to: '      return event.id;'
        }
      ]
    },
    {
      id: 'Y1-replaceable-by-id@ES6f',
      arm: 'ES6f',
      requires: ['ES6d'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}`;',
          to: '      return event.id;'
        }
      ]
    },
    {
      id: 'Y2-older-wins@ES6f',
      arm: 'ES6f',
      requires: ['ES6d'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;',
          to: '  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? a : b;'
        }
      ]
    },
    {
      id: 'Y3-bound-tie-reversed',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  if (a.event.id !== b.event.id) return a.event.id < b.event.id ? -1 : 1;',
          to: '  if (a.event.id !== b.event.id) return a.event.id > b.event.id ? -1 : 1;'
        }
      ]
    },
    {
      id: 'Y4-missing-d-is-undefined',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return tags.find(([name]) => name === 'd')?.[1] ?? 'undefined';"
        }
      ]
    },
    {
      id: 'Y5-higher-id-wins',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;',
          to: '  if (a.created_at !== b.created_at) return a.id > b.id ? a : b;'
        }
      ]
    },
    {
      id: 'Y6-range-equal-replaces',
      arm: 'ES3',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  return a.id <= b.id ? a : b;',
          to: '  return (a.kind >= 10000 && a.kind < 20000 ? a.id < b.id : a.id <= b.id) ? a : b;'
        }
      ]
    },
    {
      id: 'Z1-payload-of-incumbent@ES28',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  entries.set(key, packet);',
          to: '  entries.set(key, current ? { ...packet, event: { ...packet.event, content: current.event.content } } : packet);'
        }
      ]
    },
    {
      id: 'Z1-payload-of-incumbent@ES5',
      arm: 'ES5',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  entries.set(key, packet);',
          to: '  entries.set(key, current ? { ...packet, event: { ...packet.event, content: current.event.content } } : packet);'
        }
      ]
    },
    {
      id: 'Z3-empty-d-is-s',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return tags.find(([name]) => name === 'd')?.[1] || 's';"
        }
      ]
    },
    {
      id: 'Z4-title-in-key',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}:${identifierOf(event)}`;',
          to: "      return `${event.kind}:${event.pubkey}:${identifierOf(event)}:${event.tags.find(([name]) => name === 'title')?.[1] ?? ''}`;"
        }
      ]
    },
    {
      id: 'Z5-kind-3-with-d',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}`;',
          to: '      return event.kind === 3 ? `${event.kind}:${event.pubkey}:${identifierOf(event)}` : `${event.kind}:${event.pubkey}`;'
        }
      ]
    },
    {
      id: 'Z6-low-replaceable-by-id@ES6d',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}`;',
          to: '      return event.kind < 10000 ? event.id : `${event.kind}:${event.pubkey}`;'
        }
      ]
    },
    {
      id: 'Z6-low-replaceable-by-id@ES6f',
      arm: 'ES6f',
      requires: ['ES6d'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}`;',
          to: '      return event.kind < 10000 ? event.id : `${event.kind}:${event.pubkey}`;'
        }
      ]
    },
    {
      id: 'Z6-addressable-by-id@ES6d',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}:${identifierOf(event)}`;',
          to: '      return event.id;'
        }
      ]
    },
    {
      id: 'Z6-addressable-by-id@ES6f',
      arm: 'ES6f',
      requires: ['ES6d'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}:${identifierOf(event)}`;',
          to: '      return event.id;'
        }
      ]
    },
    {
      id: 'W1-lexical-recency',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;',
          to: '  if (a.created_at !== b.created_at) return String(a.created_at) > String(b.created_at) ? a : b;'
        }
      ]
    },
    {
      id: 'W2-last-d',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return tags.findLast(([name]) => name === 'd')?.[1] ?? '';"
        }
      ]
    },
    {
      id: 'W2-d-joined',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return tags.find(([name]) => name === 'd')?.slice(1).join(':') ?? '';"
        }
      ]
    },
    {
      id: 'W2-d-split',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return (tags.find(([name]) => name === 'd')?.[1] ?? '').split(':')[0] ?? '';"
        }
      ]
    },
    {
      id: 'W2-d-trimmed',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return (tags.find(([name]) => name === 'd')?.[1] ?? '').trim();"
        }
      ]
    },
    {
      id: 'W3-tags-of-incumbent@ES28',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  entries.set(key, packet);',
          to: '  entries.set(key, current ? { ...packet, event: { ...packet.event, tags: current.event.tags } } : packet);'
        }
      ]
    },
    {
      id: 'W3-tags-of-incumbent@ES5',
      arm: 'ES5',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  entries.set(key, packet);',
          to: '  entries.set(key, current ? { ...packet, event: { ...packet.event, tags: current.event.tags } } : packet);'
        }
      ]
    },
    {
      id: 'W5-kind-3-by-id@ES6f',
      arm: 'ES6f',
      requires: ['ES6d'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: 'export function replacementKey(event: ReqEvent): string {\n',
          to: 'export function replacementKey(event: ReqEvent): string {\n  if (event.kind === 3) return event.id;\n'
        }
      ]
    },
    {
      id: 'W5-kind-3-by-id@ES6d',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: 'export function replacementKey(event: ReqEvent): string {\n',
          to: 'export function replacementKey(event: ReqEvent): string {\n  if (event.kind === 3) return event.id;\n'
        }
      ]
    },
    {
      id: 'V1-shared-tags-only',
      arm: 'ES3',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    if (winner === current.event) return set;',
          to: '    if (winner === current.event && (current.event.id !== packet.event.id || current.event.tags === packet.event.tags)) return set;'
        }
      ]
    },
    {
      id: 'V1-ephemeral-memo-by-object',
      arm: 'ES3',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    return set.ephemeralOmitted === true ? set : { ...set, ephemeralOmitted: true };',
          to: '    return set.ephemeralOmitted === true && (set as { lastEphemeral?: unknown }).lastEphemeral === packet.event ? set : ({ ...set, ephemeralOmitted: true, lastEphemeral: packet.event } as CachedEventSet);'
        }
      ]
    },
    {
      id: 'V2-content-before-id@ES5',
      arm: 'ES5',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  return a.id <= b.id ? a : b;',
          to: '  if (a.content !== b.content) return a.content < b.content ? a : b;\n  return a.id <= b.id ? a : b;'
        }
      ]
    },
    {
      id: 'V2-content-before-id-in-bound',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  if (a.event.id !== b.event.id) return a.event.id < b.event.id ? -1 : 1;',
          to: '  if (a.event.content !== b.event.content) return a.event.content < b.event.content ? -1 : 1;\n  if (a.event.id !== b.event.id) return a.event.id < b.event.id ? -1 : 1;'
        }
      ]
    },
    {
      id: 'V3-first-named-d@ES28',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return tags.find(([name, value]) => name === 'd' && value)?.[1] ?? '';"
        }
      ]
    },
    {
      id: 'V3-first-named-d@ES6d',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return tags.find(([name, value]) => name === 'd' && value)?.[1] ?? '';"
        }
      ]
    },
    {
      id: 'V3-first-named-d@ES6f',
      arm: 'ES6f',
      requires: ['ES6d'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return tags.find(([name, value]) => name === 'd' && value)?.[1] ?? '';"
        }
      ]
    },
    {
      id: 'V4-last-d@ES6d',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return tags.findLast(([name]) => name === 'd')?.[1] ?? '';"
        }
      ]
    },
    {
      id: 'V5-sig-of-incumbent@ES28',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  entries.set(key, packet);',
          to: '  entries.set(key, current ? { ...packet, event: { ...packet.event, sig: current.event.sig } } : packet);'
        }
      ]
    },
    {
      id: 'V5-sig-of-incumbent@ES5',
      arm: 'ES5',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  entries.set(key, packet);',
          to: '  entries.set(key, current ? { ...packet, event: { ...packet.event, sig: current.event.sig } } : packet);'
        }
      ]
    },
    {
      id: 'V6-author-prefix',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '      return `${event.kind}:${event.pubkey}`;',
          to: '      return `${event.kind}:${event.pubkey.slice(0, 8)}`;'
        }
      ]
    },
    {
      id: 'V6-id-prefix-tie',
      arm: 'ES5',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  return a.id <= b.id ? a : b;',
          to: '  return a.id.slice(0, 8) <= b.id.slice(0, 8) ? a : b;'
        }
      ]
    },
    {
      id: 'V7-d-case-folded',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return (tags.find(([name]) => name === 'd')?.[1] ?? '').toLowerCase();"
        }
      ]
    },
    {
      id: 'V8-32-bit-recency',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;',
          to: '  if (a.created_at !== b.created_at) return (a.created_at | 0) > (b.created_at | 0) ? a : b;'
        }
      ]
    },
    {
      id: 'U1-tag-name-case-folded@ES28',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return tags.find(([name]) => name.toLowerCase() === 'd')?.[1] ?? '';"
        }
      ]
    },
    {
      id: 'U1-tag-name-case-folded@ES6d',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return tags.find(([name]) => name.toLowerCase() === 'd')?.[1] ?? '';"
        }
      ]
    },
    {
      id: 'U1-tag-name-case-folded@ES6f',
      arm: 'ES6f',
      requires: ['ES6d'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return tags.find(([name]) => name.toLowerCase() === 'd')?.[1] ?? '';"
        }
      ]
    },
    {
      id: 'U2-d-normalised',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: "  return tags.find(([name]) => name === 'd')?.[1] ?? '';",
          to: "  return (tags.find(([name]) => name === 'd')?.[1] ?? '').normalize('NFC');"
        }
      ]
    },
    {
      id: 'U3-zero-is-absent',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  if (a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;',
          to: '  if (a.created_at && b.created_at && a.created_at !== b.created_at) return a.created_at > b.created_at ? a : b;'
        }
      ]
    },
    {
      id: 'U4-content-trimmed@ES28',
      arm: 'ES28',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  entries.set(key, packet);',
          to: '  entries.set(key, { ...packet, event: { ...packet.event, content: packet.event.content.trim() } } as OwnedPacket);'
        }
      ]
    },
    {
      id: 'U4-content-trimmed@ES5',
      arm: 'ES5',
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  entries.set(key, packet);',
          to: '  entries.set(key, { ...packet, event: { ...packet.event, content: packet.event.content.trim() } } as OwnedPacket);'
        }
      ]
    },
    {
      id: '15-1-bound-filters-by-payload',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  const newestFirst = [...entries.entries()].sort(([, a], [, b]) => byRecency(a, b));',
          to: '  const newestFirst = [...entries.entries()].filter(([, packet]) => packet.event.content).sort(([, a], [, b]) => byRecency(a, b));'
        }
      ]
    },
    {
      id: '15-1s1-bound-filters-by-payload',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  const newestFirst = [...entries.entries()].sort(([, a], [, b]) => byRecency(a, b));',
          to: "  const newestFirst = [...entries.entries()].filter(([, packet]) => packet.event.tags.some(([name]) => name !== 'd')).sort(([, a], [, b]) => byRecency(a, b));"
        }
      ]
    },
    {
      id: '15-1s2-bound-filters-by-payload',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  const newestFirst = [...entries.entries()].sort(([, a], [, b]) => byRecency(a, b));',
          to: '  const newestFirst = [...entries.entries()].filter(([, packet]) => packet.event.content.trim()).sort(([, a], [, b]) => byRecency(a, b));'
        }
      ]
    },
    {
      id: '15-1s3-bound-filters-by-payload',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  const newestFirst = [...entries.entries()].sort(([, a], [, b]) => byRecency(a, b));',
          to: '  const newestFirst = [...entries.entries()].filter(([, packet]) => packet.event.ots === undefined).sort(([, a], [, b]) => byRecency(a, b));'
        }
      ]
    },
    {
      id: '15-1s4-bound-filters-by-payload',
      arm: 'ES6d',
      requires: ['ES6f'],
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  const newestFirst = [...entries.entries()].sort(([, a], [, b]) => byRecency(a, b));',
          to: '  const newestFirst = [...entries.entries()].filter(([, packet]) => packet.event.tags.every((tag) => tag.length > 1)).sort(([, a], [, b]) => byRecency(a, b));'
        }
      ]
    }
  ],
  retired: [
    {
      id: 'Y4-relay-in-key',
      arm: 'ES28',
      reason:
        "Equivalent on every input: the fold's input never carries a relay, so a key or a winner that reads one cannot differ (retired in #139).",
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '  const key = replacementKey(packet.event);',
          to: '  const key = replacementKey(packet.event) + packet.from;'
        }
      ]
    },
    {
      id: 'Z2-another-relay-wins',
      arm: 'ES28',
      reason:
        "Equivalent on every input: the fold's input never carries a relay, so a key or a winner that reads one cannot differ (retired in #139).",
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    if (winner === current.event) return set;',
          to: '    if (winner === current.event && !((current as { from?: unknown }).from !== (packet as { from?: unknown }).from && current.event.id !== packet.event.id)) return set;'
        }
      ]
    },
    {
      id: 'W4-older-from-elsewhere@ES6d',
      arm: 'ES6d',
      requires: ['ES6f'],
      reason:
        "Equivalent on every input: the fold's input never carries a relay, so a key or a winner that reads one cannot differ (retired in #139).",
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    if (winner === current.event) return set;',
          to: '    if (winner === current.event && !((current as { from?: unknown }).from !== (packet as { from?: unknown }).from && packet.event.created_at < current.event.created_at)) return set;'
        }
      ]
    },
    {
      id: 'W4-older-from-elsewhere@ES6f',
      arm: 'ES6f',
      requires: ['ES6d'],
      reason:
        "Equivalent on every input: the fold's input never carries a relay, so a key or a winner that reads one cannot differ (retired in #139).",
      edits: [
        {
          file: 'src/lib/v1/eventset.ts',
          from: '    if (winner === current.event) return set;',
          to: '    if (winner === current.event && !((current as { from?: unknown }).from !== (packet as { from?: unknown }).from && packet.event.created_at < current.event.created_at)) return set;'
        }
      ]
    }
  ]
} satisfies Ledger;
