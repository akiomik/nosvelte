/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Lookalikes `RA1`'s instruments are controlled with: what each would have to
 * read through to stay right. A snapshot class published under another name,
 * a recognition guard, a guard inside a namespace, an enum, an `Error` class
 * whose base is spelled through an alias, and one whose code is annotated
 * with one. Nothing here is the library's; nothing imports it but the
 * controls.
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

/** A guard inside a namespace, which a reader of the export's own kind took for a type. */
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Recognise {
  export const reqError = (value: unknown): value is ReqError => recognises(value);
}

/** A value at run time with nothing callable in it, which was read as a type too. */
export enum FailureKind {
  Snapshot = 'snapshot'
}

type LookalikeCode = 'one' | 'two';

/** An `Error` whose code is annotated with an alias, read for the alias's members. */
export class AnnotatedCode extends Error {
  readonly code: LookalikeCode = 'one';
}
