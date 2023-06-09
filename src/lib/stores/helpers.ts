/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 */

import type { Observable } from 'rxjs';
import type { Readable } from 'svelte/store';
import { readable } from 'svelte/store';

export function fromObservable<A>(obs: Observable<A>): Readable<A> {
  return readable<A>(undefined, (set) => {
    const sub = obs.subscribe(set);
    return () => sub.unsubscribe();
  });
}
