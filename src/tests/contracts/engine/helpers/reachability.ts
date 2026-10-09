/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * Which failure code reaches which surface: `B5-C10`'s matrix, as data the
 * arms are checked against and the record is compared to.
 *
 * **Two projections of one declaration.** 0005 prints the table it inherited
 * from the spike, each reachable cell naming the spike witness that drove it,
 * and that table is the record (`### Which failure code reaches which
 * surface`): {@link INHERITED} is it, cell for cell. What holds a cell in
 * production is a different question with a different answer — an arm of this
 * suite that drives that witness's path and reads every surface — and
 * {@link HELD_BY} answers it, one witness at a time. A record compared against
 * the production arms would have to be rewritten every time a row of another
 * family lands, and a production check read off the inherited ids would be
 * satisfied by a test of that name existing somewhere — which is how four of
 * the spike's cells came to point at arms producing a different code.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import * as markdown from 'prettier/plugins/markdown';

import { REQ_ERROR_CODES, type ReqErrorCode } from '$lib/v1/reqerror.js';

/** The seven surfaces, spelled as the record's headers are. */
export const SURFACES = [
  "`state.error` when `status: 'error'`",
  "`state.error` when `status: 'incomplete'`",
  '`RefreshOutcome` `error`',
  'what `refresh()` **rejects** with',
  'the `error` slot',
  '`lastError`',
  '`legEnded.error`'
] as const;

export type Surface = (typeof SURFACES)[number];

const [STATE_ERROR, STATE_INCOMPLETE, OUTCOME, REJECTS, SLOT, LAST_ERROR, LEG_END] = SURFACES;

/**
 * The record's table: for each code, the spike witness each reachable cell
 * names, and nothing for an empty one. Every code of the channel has a row, in
 * the record's order, and every row every surface.
 */
export const INHERITED: Readonly<Record<ReqErrorCode, Readonly<Partial<Record<Surface, string>>>>> =
  {
    'invalid-descriptor': {
      [STATE_ERROR]: 'RM5',
      [REJECTS]: 'RM4',
      [SLOT]: 'RM5',
      [LAST_ERROR]: 'RM5'
    },
    'unsupported-filter': {
      [STATE_ERROR]: 'RM1',
      [REJECTS]: 'RM1',
      [SLOT]: 'RM1',
      [LAST_ERROR]: 'RM1'
    },
    'relay-not-in-scope': {
      [STATE_ERROR]: 'RM27',
      [REJECTS]: 'RM28',
      [SLOT]: 'RM27',
      [LAST_ERROR]: 'RM27'
    },
    'transport-incompatible': {
      [STATE_ERROR]: 'NA4',
      [REJECTS]: 'NA4',
      [SLOT]: 'NA4',
      [LAST_ERROR]: 'NA4'
    },
    'descriptor-unreadable': {
      [STATE_ERROR]: 'RM11',
      [REJECTS]: 'RM11',
      [SLOT]: 'RM11',
      [LAST_ERROR]: 'RM11'
    },
    'accumulator-contract': {
      [STATE_ERROR]: 'RM9',
      [OUTCOME]: 'RM9',
      [SLOT]: 'RM9',
      [LAST_ERROR]: 'RM9'
    },
    unspecified: { [STATE_ERROR]: 'RM12', [OUTCOME]: 'RM12', [SLOT]: 'RM12', [LAST_ERROR]: 'RM12' },
    'provider-disposed': { [REJECTS]: 'RM8' },
    'missing-provider': {
      [STATE_ERROR]: 'RM26',
      [REJECTS]: 'RM26',
      [SLOT]: 'RM26',
      [LAST_ERROR]: 'RM26'
    },
    'incomplete-result': { [STATE_INCOMPLETE]: 'RM3', [SLOT]: 'RM3', [LAST_ERROR]: 'RM3' },
    'relay-failed': { [LEG_END]: 'RM10' }
  };

/** The record's row order, which is the order its table prints them in. */
export const ROW_ORDER: readonly ReqErrorCode[] = Object.keys(INHERITED) as ReqErrorCode[];

/**
 * Which production arms drive each inherited witness's path and read every
 * surface on it. `RA1`, the landing, drives every one of them itself; a
 * supporting arm that ports a witness drives that one beside it. An arm that
 * observes a witness it is not listed for is refused, so a test cannot claim a
 * cell by naming it.
 */
export const HELD_BY: Readonly<Record<string, readonly string[]>> = {
  RM1: ['RA1', 'RX1'],
  RM3: ['RA1', 'RX3'],
  RM4: ['RA1', 'RX4'],
  RM5: ['RA1', 'RX5'],
  RM8: ['RA1', 'RX8'],
  RM9: ['RA1'],
  RM10: ['RA1'],
  RM11: ['RA1', 'RX11'],
  RM12: ['RA1', 'RX12'],
  RM26: ['RA1'],
  RM27: ['RA1'],
  RM28: ['RA1'],
  NA4: ['RA1']
};

/**
 * Surfaces a witness's arrangement leaves without a failure that its code's
 * row does not leave empty: what tells two arrangements of one code apart
 * when one holds a subset of the other's cells.
 *
 * **`RM4` is a client the caller disposed after an answer**, and `RM5` the same
 * client disposed before one; both refuse `refresh()` with
 * `invalid-descriptor`, and only `RM5` puts it on the state. Read as cells
 * alone, `RM5`'s observation held `RM4`'s — an arm that dropped the "after an
 * answer" arrangement and checked `RM4` against `RM5`'s stayed green — and so
 * did an `RM4` whose state, slot and `lastError` carried `unspecified`, which
 * the columns allow: measured, both. The arrangement's own fact is that the
 * answer is kept and nothing but the rejection carries a failure.
 */
export const SILENT_AT: Readonly<Partial<Record<string, readonly Surface[]>>> = {
  RM4: [STATE_ERROR, SLOT, LAST_ERROR]
};

/** The surfaces one witness holds, and its code: the cells that name it. */
export function cellsOf(witness: string): { code: ReqErrorCode; surfaces: Surface[] } {
  const found: { code: ReqErrorCode; surface: Surface }[] = [];
  for (const code of ROW_ORDER)
    for (const surface of SURFACES)
      if (INHERITED[code][surface] === witness) found.push({ code, surface });
  const codes = new Set(found.map(({ code }) => code));
  if (codes.size !== 1)
    throw new Error(`nosvelte test: ${witness} names ${String(codes.size)} codes' cells, not one`);
  return { code: found[0]?.code as ReqErrorCode, surfaces: found.map(({ surface }) => surface) };
}

/** Every witness the table names, each once. */
export const WITNESSES: readonly string[] = [
  ...new Set(
    ROW_ORDER.flatMap((code) =>
      SURFACES.map((surface) => INHERITED[code][surface]).filter(
        (one): one is string => one !== undefined
      )
    )
  )
];

/** The codes each surface can carry: a column's non-empty cells. */
export function codesAt(surface: Surface): ReqErrorCode[] {
  return ROW_ORDER.filter((code) => INHERITED[code][surface] !== undefined);
}

/** The record's matrix, as the Markdown parser reads it: the table under its heading. */
export function recordedMatrix(): { headers: string[]; rows: string[][] } {
  const text = readFileSync(
    resolve(process.cwd(), 'docs/decisions/0005-contract-catalogue.md'),
    'utf8'
  );
  type Node = {
    type: string;
    value?: string;
    depth?: number;
    children?: Node[];
  };
  const parser = (
    markdown as unknown as {
      parsers: { markdown: { parse: (text: string, options: object) => Node } };
    }
  ).parsers.markdown;
  const tree = parser.parse(text, {});
  const inline = (node: Node): string =>
    node.type === 'inlineCode'
      ? `\`${node.value ?? ''}\``
      : node.type === 'text'
        ? (node.value ?? '')
        : node.type === 'strong'
          ? `**${(node.children ?? []).map(inline).join('')}**`
          : `[${node.type}]`;
  const top = tree.children ?? [];
  const heading = top.findIndex(
    (node) =>
      node.type === 'heading' &&
      (node.children ?? []).map(inline).join('') === 'Which failure code reaches which surface'
  );
  if (heading < 0) throw new Error('the record has no matrix heading');
  const next = top.slice(heading + 1).findIndex((node) => node.type === 'heading');
  const section = top.slice(heading + 1, next < 0 ? undefined : heading + 1 + next);
  const tables = section.filter((node) => node.type === 'table');
  if (tables.length !== 1)
    throw new Error(`the matrix section has ${String(tables.length)} tables`);
  const [header, ...rows] = (tables[0] as Node).children ?? [];
  const cells = (row: Node): string[] =>
    (row.children ?? []).map((cell) => (cell.children ?? []).map(inline).join('').trim());
  return { headers: cells(header as Node), rows: rows.map(cells) };
}

// The declaration's own premises, checked where it is made: a row per code of
// the channel and no other, and every witness held by the landing.
if (
  ROW_ORDER.length !== REQ_ERROR_CODES.length ||
  REQ_ERROR_CODES.some((code) => !ROW_ORDER.includes(code))
)
  throw new Error('nosvelte test: the matrix does not have one row per code of the channel');
for (const witness of WITNESSES)
  if (!(HELD_BY[witness] ?? []).includes('RA1'))
    throw new Error(`nosvelte test: ${witness}'s cells are not held by the landing`);
