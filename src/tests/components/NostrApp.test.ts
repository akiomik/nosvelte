/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import { render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';

import { app } from '$lib/stores/index.js';

import NostrAppHost from './fixtures/NostrAppHost.svelte';

describe('NostrApp', () => {
  it('exposes connections to the default slot and publishes rxNostr to the app store', () => {
    render(NostrAppHost, { relays: [] });

    expect(screen.getByTestId('connections')).toHaveTextContent('[]');
    expect(get(app)?.rxNostr).toBeDefined();
  });

  it('makes its QueryClientProvider context reachable by a descendant component', async () => {
    render(NostrAppHost, { relays: [] });

    // Resolves purely through the QueryClientProvider that NostrApp renders
    // internally — the test never calls setQueryClientContext() itself.
    expect(await screen.findByTestId('child-nodata')).toHaveTextContent('nodata');
  });
});
