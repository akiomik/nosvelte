# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/akiomik/nosvelte/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/akiomik/nosvelte/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/akiomik/nosvelte/compare/v0.1.3...v0.2.0
