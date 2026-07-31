# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).

## [Unreleased]

### Fixed

- `scanLatestEach()` no longer grows without bound. It kept every value it had
  ever seen and rebuilt the whole grouping on each emission, so cost per value
  rose with the length of the stream: 4 000 values took over five seconds to
  produce a three-entry list. It now keeps only the newest value per key.
  `useConnections()` was the one with no bound — it lives for the whole page and
  takes a packet for every relay connection-state change — while
  `useMetadataList()` and `useUserArticleList()` paid it per request.

## [0.6.1] - 2026-07-31

### Fixed

- A request whose filters match no event no longer hangs. Such a REQ reaches
  EOSE without the operator chain ever emitting, which left the underlying query
  pending forever: `status` reported `'success'` while `data` stayed `undefined`
  indefinitely. The query now settles on completion, and `data` falls back to the
  hook's initial value (`[]` for the list hooks, `undefined` for the single-event
  ones) for the whole request rather than only before the first emission.
- `useUniqueEventList()` now yields `[]` instead of `undefined` when no relays are
  configured, matching the other list hooks and its own `EventPacket[]` return type.
  `UniqueEventList` was unaffected, but callers using the hook directly could hit a
  `TypeError` on the `undefined` the type said could not occur.
- Cancelling a request now closes its REQ. A component unmounting before the relays
  reach EOSE previously left the subscription — and the REQ on every relay in the
  pool — open for the lifetime of the page.
- `error` no longer survives the request that produced it. A retry or refetch that
  succeeded still reported the previous attempt's failure, and because every
  component checks its `error` slot first, a recovered request kept rendering the
  error slot instead of its data. `status` now also reports `'error'` when the
  stream fails after the query has already resolved, which previously left
  `status: 'success'` sitting next to a set `error`.
- Addressable events are now identified by their `d` tag wherever it appears in the
  tag list, instead of assuming it is the first tag. `useArticle()`/`Article` returned
  nothing at all for an article that led with any other tag (`title`, say), and
  `useUserArticleList()`/`useUserReactionList()` silently dropped events that happened
  to share a leading tag value.
- `useMetadataList()` and `useUserArticleList()` now replace an entry when a newer
  version of the same event arrives, instead of appending it next to the version it
  supersedes. Both could return several entries for one pubkey or one article.
- `useUserReactionList()` no longer groups reactions as if they were addressable
  events. Reactions are regular events, so keying them by an event coordinate
  collapsed unrelated ones together — three reactions could come back as one. They
  are now deduplicated by event id only.
- Events delivered in the same batch as the first one are no longer dropped. They
  reached the query cache before the request had settled and were then overwritten
  by the value it settled with, so a relay flushing a backlog in one go could leave
  a list holding only its first event.

## [0.6.0] - 2026-07-31

### Added

- Svelte 5 support: the `svelte` peer range is now `^4.0.0 || ^5.0.0`. The
  components are unchanged and run under Svelte 5 in legacy mode, so Svelte 4
  consumers are unaffected.

### Removed

- **Breaking:** dropped Svelte 3 support; the `svelte` peer range no longer
  includes `^3`.

### Changed

- Moved the build/test toolchain to the Svelte 5 line (svelte 5,
  `@sveltejs/vite-plugin-svelte` 7, Vite 8, Vitest 4, prettier-plugin-svelte 4).
  This is dev-only and does not change the published components; it also clears
  the remaining build-chain advisories (npm audit 10 → 3).

## [0.5.0] - 2026-07-31

### Changed

- **Breaking:** upgraded `@tanstack/svelte-query` from `^4.29.11` to `^5.0.0`.
  Consumers that use `@tanstack/svelte-query` directly (their own `QueryClient`
  or query hooks) must upgrade to v5 as well, and the exported `QueryClientConfig`
  and `QueryKey` types now come from v5. See the
  [TanStack Query v5 migration guide](https://tanstack.com/query/v5/docs/framework/svelte/migration).

## [0.4.0] - 2026-07-31

### Changed

- **Breaking:** upgraded `rx-nostr` from `^2.0.0` to `^3.0.0` (and `nostr-typedef`
  to `^0.13.0`), and added a dependency on `rx-nostr-crypto`. rx-nostr v3 moved
  cryptographic verification into `rx-nostr-crypto`, so `NostrApp` now creates its
  `RxNostr` with a `verifier` and events are verified there rather than by a
  per-request `verify()` operator. Hosts must upgrade to `rx-nostr@^3`; hosts that
  build their own `RxNostr` should pass a `verifier`. See the
  [rx-nostr v3 release notes](https://github.com/penpenpng/rx-nostr/releases/tag/v3.0.0).
- **Breaking:** the exported `RelayConfig` type is renamed to `DefaultRelayConfig`,
  following rx-nostr v3.

## [0.3.0] - 2026-07-31

### Changed

- **Breaking:** upgraded `rx-nostr` from `^1.5.0` to `^2.0.0` (and `nostr-typedef`
  to `^0.8.0`). A `NostrApp` is initialized with an `RxNostr` instance created by
  the host application, so hosts must upgrade to `rx-nostr@^2` as well. See the
  [rx-nostr v2 release notes](https://github.com/penpenpng/rx-nostr/releases/tag/v2.0.0)
  for the connection-state renames and other breaking changes.

## [0.2.0] - 2026-07-31

### Added

- Svelte 4 support: `peerDependencies` now allows `svelte@^4` alongside `^3.54`.

### Changed

- **Breaking:** upgraded the `rx-nostr` dependency from `^0.8.3` to `^1.5.0`.
  A `NostrApp` is initialized with an `RxNostr` instance created by the host
  application, so hosts must upgrade to `rx-nostr@^1` as well.
- `Nostr` event types are now sourced from `nostr-typedef` instead of being
  re-exported by `rx-nostr`.
- Modernized the internal build, test, and lint toolchain (SvelteKit 2, Vite 5,
  Vitest 3, ESLint 10, Prettier 3) and moved CI to Node.js 26. This does not
  affect the published package.

[Unreleased]: https://github.com/akiomik/nosvelte/compare/v0.6.1...HEAD
[0.6.1]: https://github.com/akiomik/nosvelte/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/akiomik/nosvelte/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/akiomik/nosvelte/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/akiomik/nosvelte/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/akiomik/nosvelte/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/akiomik/nosvelte/compare/v0.1.3...v0.2.0
