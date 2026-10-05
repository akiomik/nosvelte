/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The lists this library publishes: read, never written — not even a method's
 * slot.
 */

/**
 * A list a consumer can read and cannot write to — not even a method's slot.
 *
 * `readonly T[]` takes the mutating methods away, but TypeScript declares the
 * read-only ones as methods, and a method is an assignable slot:
 * `event.tags.map = () => []` compiled against it and threw against the frozen
 * array, which is legal-looking code failing where nothing warned. Mapping
 * every member of `ReadonlyArray<T>` with `readonly` keeps each read and refuses
 * each slot, and the type stays assignable to and from `readonly T[]`.
 *
 * Every list a published type holds is one of these, not only the event's: the
 * same slot was assignable on the events of a state, the causes of an answer,
 * the refusals of a request, and the URLs a refusal names.
 */
export type ReadonlyList<T> = { readonly [K in keyof ReadonlyArray<T>]: ReadonlyArray<T>[K] };

/**
 * A {@link ReadonlyList} with at least one element, which is what
 * `readonly [T, ...T[]]` said before: the first element is there to read
 * without a check, and an empty list is not one of these.
 */
export type NonEmptyList<T> = ReadonlyList<T> & { readonly 0: T };
