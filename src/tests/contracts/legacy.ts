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
 * roster and the rows' own text, and {@link legacyBlockers} is the release
 * step that lists what still stands between the table and closing the issues —
 * enforced by `CAT44` once v1 is the published entry
 * ({@link legacyEntryPublished}), and run as a preview before that with
 * `NOSVELTE_RELEASE_GATE=1`.
 */
import * as markdown from 'prettier/plugins/markdown';

import { rosterOf } from './bridge.js';

/** The heading the table is under, as the record spells it. */
export const LEGACY_HEADING = 'Which legacy issue each row answers';

export const LEGACY_HEADERS = ['Issue', 'Disposition', 'Rows', 'Clauses', 'What is left'] as const;

export const DISPOSITIONS = ['covered', 'removed', 'gap'] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

/** A clause a line quotes, and the row it quotes it from. */
export interface Clause {
  readonly row: string;
  readonly text: string;
}

/** One line of the table, read. */
export interface LegacyLine {
  readonly issue: number;
  readonly disposition: string;
  readonly rows: readonly string[];
  readonly clauses: readonly Clause[];
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

/**
 * The table's lines, read. A cell that is not what its column holds is a
 * fault rather than a partial read: a Rows cell is `—` or code spans and
 * commas, and a Clauses cell is `—` or `` `row` "clause" `` items separated by
 * semicolons — anything else, a link a reader sees as a row among them, would
 * be dropped silently otherwise.
 */
export function legacyLines(text: string): { lines: LegacyLine[]; faults: string[] } {
  const { headers, rows, faults } = legacySection(text);
  if (faults.length > 0) return { lines: [], faults };
  if (JSON.stringify(headers) !== JSON.stringify(LEGACY_HEADERS))
    return { lines: [], faults: [`the legacy table's columns are ${headers.join(', ')}`] };
  const lines: LegacyLine[] = [];
  const found: string[] = [];
  for (const [issue = '', disposition = '', named = '', quoted = '', left = ''] of rows) {
    const number = /^#(\d+)$/.exec(issue);
    if (number === null) {
      found.push(`a line whose issue is not #<number>: ${issue}`);
      continue;
    }
    const at = `#${number[1] as string}`;
    if (named !== '—' && named.replace(/`[^`]+`/g, '').replace(/[,\s]/g, '') !== '')
      found.push(`${at}: a Rows cell that is not code spans and commas: ${named}`);
    const clauses = [...quoted.matchAll(/`([^`]+)` "([^"]+)"/g)].map((match) => ({
      row: match[1] as string,
      text: match[2] as string
    }));
    if (quoted !== '—' && quoted.replace(/`[^`]+` "[^"]+"/g, '').replace(/[;\s]/g, '') !== '')
      found.push(`${at}: a Clauses cell that is not \`row\` "clause" items: ${quoted}`);
    lines.push({
      issue: Number(number[1]),
      disposition,
      rows:
        named === '—' ? [] : [...named.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string),
      clauses,
      left
    });
  }
  return { lines, faults: found };
}

/** Each catalogue row's line in the record, by id, as written. */
const rowLines = (text: string): Map<string, string> =>
  new Map(
    text
      .split('\n')
      .map((line) => [/^\| `([^`]+)` +\|/.exec(line)?.[1], line] as const)
      .filter((pair): pair is [string, string] => pair[0] !== undefined)
  );

/**
 * What is wrong with the table, against the roster, the rows' own text and
 * the decisions the records declare: a known disposition; every row named on
 * the roster; on a `covered` or `removed` line, at least one row, every row
 * with a clause, and every row a note mentions among those named; every
 * clause quoted from a row the line names and still in that row's text; a gap
 * opening with the decision whose family owes it; every issue once and in
 * order; and the count the section's prose states, whose parts are its total.
 */
export function legacyFaults(text: string, decisions: ReadonlySet<string>): string[] {
  const { lines, faults } = legacyLines(text);
  const { roster, faults: rosterFaults } = rosterOf(text);
  const written = rowLines(text);
  const wrong = [...faults, ...rosterFaults];
  const issues = lines.map(({ issue }) => issue);
  if (new Set(issues).size !== issues.length) wrong.push('an issue is in the table twice');
  if (issues.some((issue, at) => at > 0 && issue < (issues[at - 1] as number)))
    wrong.push('the issues are not in ascending order');
  for (const { issue, disposition, rows, clauses, left } of lines) {
    const at = `#${String(issue)}`;
    if (!(DISPOSITIONS as readonly string[]).includes(disposition))
      wrong.push(`${at}: an unknown disposition, ${disposition}`);
    for (const row of rows) if (!roster.has(row)) wrong.push(`${at}: ${row} is not on the roster`);
    for (const { row, text: clause } of clauses) {
      if (!rows.includes(row))
        wrong.push(`${at}: a clause from ${row}, which the line does not name`);
      else if (!(written.get(row) ?? '').includes(clause))
        wrong.push(`${at}: "${clause}" is no longer in ${row}`);
    }
    if (disposition === 'gap') {
      const owed = /^\*\*([^*]+)\*\* — \S/.exec(left);
      if (owed === null)
        wrong.push(`${at}: a gap that does not open with the decision that owes it`);
      else if (!decisions.has(owed[1] as string))
        wrong.push(`${at}: a gap owed by ${owed[1] as string}, which no record declares`);
      continue;
    }
    if (rows.length === 0) wrong.push(`${at}: ${disposition}, and no row named`);
    for (const row of rows)
      if (!clauses.some((clause) => clause.row === row))
        wrong.push(`${at}: ${row} is named with no clause from it`);
    for (const mentioned of [...left.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string))
      if (roster.has(mentioned) && !rows.includes(mentioned))
        wrong.push(`${at}: the note leans on ${mentioned}, which the line does not name`);
  }
  const { prose } = legacySection(text);
  const stated =
    /\*\*(\d+) issues\*\*: \*\*(\d+) covered\*\*, \*\*(\d+) removed\*\* and \*\*(\d+) gaps\*\*/.exec(
      prose
    );
  const counted = (disposition: Disposition): number =>
    lines.filter((line) => line.disposition === disposition).length;
  if (stated === null) wrong.push('the legacy section no longer states its counts');
  else {
    const [total, covered, removed, gaps] = stated.slice(1).map(Number) as [
      number,
      number,
      number,
      number
    ];
    if (covered + removed + gaps !== total)
      wrong.push(`the legacy section's counts do not add up: ${stated[0]}`);
    if (
      JSON.stringify([total, covered, removed, gaps]) !==
      JSON.stringify([lines.length, counted('covered'), counted('removed'), counted('gap')])
    )
      wrong.push(
        `the legacy section says ${stated[0]}, and the table has ${String(lines.length)}: ${String(counted('covered'))} covered, ${String(counted('removed'))} removed, ${String(counted('gap'))} gaps`
      );
  }
  return wrong;
}

/**
 * What stands between the table and closing the issues: every gap, and every
 * row a `covered` or `removed` line names that has not landed. A row a port
 * decided absent, or discharged, is a blocker too — nothing would fail on the
 * bug, so the issue is triaged again rather than closed.
 */
export function legacyBlockers(text: string): string[] {
  const { lines } = legacyLines(text);
  const { roster } = rosterOf(text);
  const blockers: string[] = [];
  for (const { issue, disposition, rows, left } of lines) {
    if (disposition !== 'covered' && disposition !== 'removed') {
      blockers.push(`#${String(issue)}: a ${disposition} — ${left}`);
      continue;
    }
    for (const row of rows) {
      const evidence = roster.get(row)?.evidence ?? 'TBD';
      if (evidence.startsWith('test:')) continue;
      blockers.push(
        evidence.startsWith('TBD')
          ? `#${String(issue)}: ${row} still TBD`
          : `#${String(issue)}: triage again — ${row} is ${evidence.split(/[:\s]/)[0] as string}`
      );
    }
  }
  return blockers;
}

/**
 * Whether the package still publishes the old surface: its entry exports the
 * old stores, or its files leave v1's build out. When neither holds, v1 is
 * what ships, and the release step is no longer a preview.
 */
export function legacyEntryPublished(entry: string, manifest: string): boolean {
  const files = (JSON.parse(manifest) as { files?: unknown }).files;
  return /from '\.\/stores\//.test(entry) || (Array.isArray(files) && files.includes('!dist/v1'));
}

/** The issues triaged into the table on 2026-10-13: one may be added, none may go missing. */
export const TRIAGED: readonly number[] = [
  61, 68, 69, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93,
  94, 95, 163
];
