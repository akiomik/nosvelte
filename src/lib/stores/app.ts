/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { RxNostr } from 'rx-nostr';
import { writable } from 'svelte/store';

export const app = writable<{ client: RxNostr }>();
