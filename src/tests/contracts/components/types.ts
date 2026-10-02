import type { Component } from 'svelte';

/**
 * Any of the request components, for a table that holds all eleven: their
 * props differ, and a component's props are contravariant, so no narrower
 * type admits every row.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RequestComponent = Component<any>;
