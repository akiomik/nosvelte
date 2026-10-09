/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Lookalikes `RA1`'s instruments are controlled with: what each would have to
 * read through to stay right. A snapshot class published under another name,
 * a recognition guard, and an `Error` class whose base is spelled through an
 * alias. Nothing here is the library's; nothing imports it but the controls.
 */
import type { ReqError } from '$lib/v1/reqerror.js';

export { ReqFailure as Snapshot } from '$lib/v1/own.js';

/** A recognition guard under a name no list of guards would have. */
export function recognises(value: unknown): value is ReqError {
  return typeof value === 'object' && value !== null && 'code' in value;
}

const Base = Error;

/** An `Error` whose base a spelling-reading population would not see. */
export class AliasedBase extends Base {
  readonly code = 'aliased' as const;
}
