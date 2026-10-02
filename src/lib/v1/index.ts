/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The v1 entry, as it will be published when it replaces the v0.6 one. Not
 * exported from the package yet: the two surfaces share names, so this entry
 * becomes `src/lib/index.ts` in one switch, once the port is complete.
 */
export { default as Metadata } from './components/Metadata.svelte';
export { default as NostrApp } from './components/NostrApp.svelte';
export * from './public-entry.js';
export { useReq } from './req.svelte.js';
