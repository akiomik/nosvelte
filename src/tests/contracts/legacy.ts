/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The legacy issues and the rows that answer them: the table 0005 keeps under
 * "Which legacy issue each row answers", read with the Markdown parser.
 *
 * **What it is for.** The old surface's bugs are not fixed on it; they stay
 * open as disclosure, and v1 fixes them when it replaces the entry. This table
 * is what makes "v1 fixes them" checkable: `CAT44` holds its shape against the
 * roster, and {@link legacyBlockers} is the release step — `CAT44` with
 * `NOSVELTE_RELEASE_GATE=1` — that lists what still stands between the table
 * and closing the issues.
 */
import * as markdown from 'prettier/plugins/markdown';

import { rosterOf } from './bridge.js';

/** The heading the table is under, as the record spells it. */
export const LEGACY_HEADING = 'Which legacy issue each row answers';

export const LEGACY_HEADERS = ['Issue', 'Disposition', 'Rows', 'What is left'] as const;

export const DISPOSITIONS = ['covered', 'removed', 'gap'] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

/** One line of the table, read. */
export interface LegacyLine {
  readonly issue: number;
  readonly disposition: string;
  readonly rows: readonly string[];
  readonly left: string;
}

interface Node {
  readonly type: string;
  readonly value?: string;
  readonly children?: readonly Node[];
}

const inline = (node: Node): string =>
  node.type === 'inlineCode'
    ? `\`${node.value ?? ''}\``
    : node.type === 'text'
      ? (node.value ?? '')
      : node.type === 'strong'
        ? `**${(node.children ?? []).map(inline).join('')}**`
        : node.type === 'emphasis'
          ? `_${(node.children ?? []).map(inline).join('')}_`
          : `[${node.type}]`;

/**
 * The section under {@link LEGACY_HEADING}: its one table, as header cells and
 * rows of cells, and its prose, the paragraphs' text. Faults name what could
 * not be read; the table is empty when there are any.
 */
export function legacySection(text: string): {
  headers: string[];
  rows: string[][];
  prose: string;
  faults: string[];
} {
  const parser = (
    markdown as unknown as {
      parsers: { markdown: { parse: (text: string, options: object) => Node } };
    }
  ).parsers.markdown;
  const top = parser.parse(text, {}).children ?? [];
  const heading = top.findIndex(
    (node) =>
      node.type === 'heading' && (node.children ?? []).map(inline).join('') === LEGACY_HEADING
  );
  if (heading < 0)
    return { headers: [], rows: [], prose: '', faults: ['the record has no legacy section'] };
  const next = top.slice(heading + 1).findIndex((node) => node.type === 'heading');
  const section = top.slice(heading + 1, next < 0 ? undefined : heading + 1 + next);
  const tables = section.filter((node) => node.type === 'table');
  const prose = section
    .filter((node) => node.type === 'paragraph')
    .map((node) => (node.children ?? []).map(inline).join(''))
    .join('\n');
  if (tables.length !== 1)
    return {
      headers: [],
      rows: [],
      prose,
      faults: [`the legacy section has ${String(tables.length)} tables, not one`]
    };
  const cells = (row: Node): string[] =>
    (row.children ?? []).map((cell) => (cell.children ?? []).map(inline).join('').trim());
  const [header, ...rows] = (tables[0] as Node).children ?? [];
  return { headers: cells(header as Node), rows: rows.map(cells), prose, faults: [] };
}

/** The table's lines, read: an issue number, a disposition, the rows it names, what is left. */
export function legacyLines(text: string): { lines: LegacyLine[]; faults: string[] } {
  const { headers, rows, faults } = legacySection(text);
  if (faults.length > 0) return { lines: [], faults };
  if (JSON.stringify(headers) !== JSON.stringify(LEGACY_HEADERS))
    return { lines: [], faults: [`the legacy table's columns are ${headers.join(', ')}`] };
  const lines: LegacyLine[] = [];
  const found: string[] = [];
  for (const [issue = '', disposition = '', named = '', left = ''] of rows) {
    const number = /^#(\d+)$/.exec(issue);
    if (number === null) {
      found.push(`a line whose issue is not #<number>: ${issue}`);
      continue;
    }
    lines.push({
      issue: Number(number[1]),
      disposition,
      rows: [...named.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string),
      left
    });
  }
  return { lines, faults: found };
}

/**
 * What is wrong with the table, against the roster and the decisions the
 * records declare: every issue once and in order, a known disposition, every
 * row it names on the roster, a covered or removed line naming a row, a gap
 * naming the decision whose family owes the arrangement, and the count the
 * section's prose states.
 */
export function legacyFaults(text: string, decisions: ReadonlySet<string>): string[] {
  const { lines, faults } = legacyLines(text);
  const { roster, faults: rosterFaults } = rosterOf(text);
  const wrong = [...faults, ...rosterFaults];
  const issues = lines.map(({ issue }) => issue);
  if (new Set(issues).size !== issues.length) wrong.push('an issue is in the table twice');
  if (issues.some((issue, at) => at > 0 && issue < (issues[at - 1] as number)))
    wrong.push('the issues are not in ascending order');
  for (const { issue, disposition, rows, left } of lines) {
    if (!(DISPOSITIONS as readonly string[]).includes(disposition))
      wrong.push(`#${String(issue)}: an unknown disposition, ${disposition}`);
    for (const row of rows)
      if (!roster.has(row)) wrong.push(`#${String(issue)}: ${row} is not on the roster`);
    if (disposition !== 'gap' && rows.length === 0)
      wrong.push(`#${String(issue)}: ${disposition}, and no row named`);
    if (disposition === 'gap') {
      const owed = /^\*\*([^*]+)\*\* — \S/.exec(left);
      if (owed === null)
        wrong.push(`#${String(issue)}: a gap that does not open with the decision that owes it`);
      else if (!decisions.has(owed[1] as string))
        wrong.push(
          `#${String(issue)}: a gap owed by ${owed[1] as string}, which no record declares`
        );
    }
  }
  const { prose } = legacySection(text);
  const stated =
    /\*\*(\d+) issues\*\*: \*\*(\d+) covered\*\*, \*\*(\d+) removed\*\* and \*\*(\d+) gaps\*\*/.exec(
      prose
    );
  const counted = (disposition: Disposition): number =>
    lines.filter((line) => line.disposition === disposition).length;
  if (stated === null) wrong.push('the legacy section no longer states its counts');
  else if (
    JSON.stringify(stated.slice(1).map(Number)) !==
    JSON.stringify([lines.length, counted('covered'), counted('removed'), counted('gap')])
  )
    wrong.push(
      `the legacy section says ${stated[0]}, and the table has ${String(lines.length)}: ${String(counted('covered'))} covered, ${String(counted('removed'))} removed, ${String(counted('gap'))} gaps`
    );
  return wrong;
}

/**
 * What stands between the table and closing the issues, which is the release
 * step: every gap, and every row a covered or removed line names that is not
 * yet terminal on the roster — landed (`test:`), decided absent (`absent:`) or
 * discharged.
 */
export function legacyBlockers(text: string): string[] {
  const { lines } = legacyLines(text);
  const { roster } = rosterOf(text);
  const blockers: string[] = [];
  for (const { issue, disposition, rows, left } of lines) {
    if (disposition === 'gap') {
      blockers.push(`#${String(issue)}: a gap — ${left}`);
      continue;
    }
    const owing = rows.filter((row) => (roster.get(row)?.evidence ?? 'TBD').startsWith('TBD'));
    if (owing.length > 0) blockers.push(`#${String(issue)}: ${owing.join(', ')} still TBD`);
  }
  return blockers;
}
