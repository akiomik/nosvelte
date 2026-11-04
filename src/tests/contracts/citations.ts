/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The ledgers an Evidence cell cites, held to the ledgers themselves.
 *
 * **What it is for.** A row landed during the phase-2 trial says in its
 * Evidence cell which ledger holds its mutations (`docs/process/phase-2-trial.md`
 * §5). The cell used to list the entries by id, or describe them, and nothing
 * read the list: four landings accepted that as a limitation. Now the cell
 * names the ledger and the arms its entries are held to, and **which entries
 * are the row's is said once, in the ledger**, by the row's id in each entry's
 * `rows`. `CAT45` holds the two against each other and against the roster.
 *
 * **What it does not read** is whether the entries break every clause of the
 * row's Then. That is a judgement about mutations, and it is the review's.
 */
import * as markdown from 'prettier/plugins/markdown';

import { rosterOf, TEST_ID, testEvidence } from './bridge.js';
import { inline, type Node } from './legacy.js';

/** One mutation of a ledger, as far as a citation reads it. */
export interface CitedEntry {
  readonly id: string;
  readonly arm: string;
  /** The rows whose Evidence cell cites this entry's ledger and whose promise it breaks. */
  readonly rows?: readonly string[];
}

/** A ledger, as far as a citation reads it: `scripts/ledgers/<name>.ts`'s default export. */
export interface CitedLedger {
  readonly name: string;
  readonly entries: readonly CitedEntry[];
  readonly retired?: readonly CitedEntry[];
}

/** One ledger a cell cites, and the arms it says the row's entries there are held to. */
export interface Citation {
  readonly row: string;
  readonly ledger: string;
  readonly arms: readonly string[];
}

/** The label a trial cell's ledger part opens with, and the one that closes it. */
const LEDGER = '**Ledger:**';
const LIMITATIONS = '**Limitations:**';
/** A trial cell is one that says what its landing reads (§5). */
const READ = '**Read:**';

/** Every contract row's id and its Implementation test cell, read with the Markdown parser. */
export function implementationCells(text: string): Map<string, string> {
  const parser = (
    markdown as unknown as {
      parsers: { markdown: { parse: (text: string, options: object) => Node } };
    }
  ).parsers.markdown;
  const cells = new Map<string, string>();
  const textOf = (cell: Node): string => (cell.children ?? []).map(inline).join('').trim();
  const visit = (node: Node): void => {
    if (node.type === 'table') {
      const [header, ...rows] = node.children ?? [];
      const headers = (header?.children ?? []).map(textOf);
      const at = headers.indexOf('Implementation test');
      if (headers[0] === 'Contract' && at > 0)
        for (const row of rows) {
          const cell = (row.children ?? []).map(textOf);
          const id = /^`([^`]+)`$/.exec(cell[0] ?? '')?.[1];
          if (id !== undefined) cells.set(id, cell[at] ?? '');
        }
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(parser.parse(text, {}));
  return cells;
}

/**
 * The citations a cell's ledger part makes, or what is wrong with it. The part
 * runs from {@link LEDGER} to {@link LIMITATIONS} or the cell's end, and is
 * one or more `` `ledger`, held to `ARM` `` clauses, separated by semicolons and
 * ended by a full stop, the arms written `` `A` ``, `` `A` and `B` `` or
 * `` `A`, `B` and `C` ``. Nothing else may stand in it: a description of the
 * entries would be a second list nothing reads.
 */
export function citationsOf(
  row: string,
  cell: string
): { citations: Citation[]; faults: string[] } {
  const opens = cell.indexOf(LEDGER);
  if (opens < 0)
    return {
      citations: [],
      faults: cell.includes(READ) ? [`${row}: a trial cell with no ${LEDGER} part`] : []
    };
  if (cell.indexOf(LEDGER, opens + 1) >= 0)
    return { citations: [], faults: [`${row}: two ${LEDGER} parts`] };
  const closes = cell.indexOf(LIMITATIONS, opens);
  const part = cell.slice(opens + LEDGER.length, closes < 0 ? undefined : closes).trim();
  const unread = (): { citations: Citation[]; faults: string[] } => ({
    citations: [],
    faults: [`${row}: a ${LEDGER} part that is not \`ledger\`, held to \`ARM\` clauses: ${part}`]
  });
  if (!part.endsWith('.')) return unread();
  const citations: Citation[] = [];
  for (const clause of part.slice(0, -1).split('; ')) {
    const match = /^`([a-z0-9]+(?:-[a-z0-9]+)*)`, held to (.+)$/.exec(clause);
    if (match === null) return unread();
    const pieces = (match[2] as string).split(/(, | and )/);
    const arms = pieces.filter((_, at) => at % 2 === 0);
    const separators = pieces.filter((_, at) => at % 2 === 1);
    const ARM = new RegExp(`^\`(${TEST_ID})\`$`);
    if (
      arms.some((arm) => !ARM.test(arm)) ||
      separators.some(
        (separator, at) => separator !== (at === separators.length - 1 ? ' and ' : ', ')
      )
    )
      return unread();
    citations.push({
      row,
      ledger: match[1] as string,
      arms: arms.map((arm) => arm.slice(1, -1))
    });
  }
  return { citations, faults: [] };
}

/**
 * What is wrong between the record's citations and the ledgers: every trial
 * cell has a readable ledger part and names no entry, by its id or its id's
 * prefix, anywhere else; each ledger it names exists, is named once,
 * and has entries naming the row, held to exactly the arms the cell names, each
 * on the row's roster line; every entry of a cited ledger held to a cited arm
 * names a row; every row an entry names is a row whose cell cites that ledger;
 * and no retired entry names a row.
 */
export function citationFaults(text: string, ledgers: readonly CitedLedger[]): string[] {
  const { roster, faults: rosterFaults } = rosterOf(text);
  const cells = implementationCells(text);
  const byName = new Map(ledgers.map((ledger) => [ledger.name, ledger]));
  const wrong = [...rosterFaults];
  const cited: Citation[] = [];
  const entryIds = ledgers.flatMap((ledger) =>
    [...ledger.entries, ...(ledger.retired ?? [])].map(({ id }) => ({ id, ledger: ledger.name }))
  );
  for (const [row, cell] of cells) {
    const { citations, faults } = citationsOf(row, cell);
    wrong.push(...faults);
    // **Nowhere in a trial cell**, not only in its ledger part: an id written
    // in the limitations is the same copy nothing reads. A family written as
    // its prefix, `C3-`, is one too.
    if (cell.includes(READ) || cell.includes(LEDGER))
      for (const token of new Set(
        [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string)
      ))
        for (const { id, ledger } of entryIds
          .filter(({ id }) => (token.endsWith('-') ? id.startsWith(token) : id === token))
          .slice(0, 1))
          wrong.push(
            `${row}: names ${token}, ${token === id ? 'an entry' : 'the entries beginning so'} of ${ledger}; which entries are the row's is the ledger's to say`
          );
    const names = citations.map(({ ledger }) => ledger);
    for (const name of names.filter((name, at) => names.indexOf(name) !== at))
      wrong.push(`${row}: cites ${name} twice`);
    cited.push(...citations);
  }
  for (const { row, ledger: name, arms } of cited) {
    const ledger = byName.get(name);
    if (ledger === undefined) {
      wrong.push(`${row}: cites ${name}, which is no ledger`);
      continue;
    }
    const evidence = testEvidence(roster.get(row)?.evidence ?? '');
    const rostered =
      evidence === undefined || 'fault' in evidence ? [] : [evidence.landing, ...evidence.support];
    for (const arm of arms)
      if (!rostered.includes(arm))
        wrong.push(`${row}: ${name} is held to ${arm}, which is not on the row's roster line`);
    const own = ledger.entries.filter((entry) => entry.rows?.includes(row) === true);
    if (own.length === 0) {
      wrong.push(`${row}: cites ${name}, and no entry there names ${row}`);
      continue;
    }
    const held = [...new Set(own.map(({ arm }) => arm))];
    const missing = held.filter((arm) => !arms.includes(arm));
    const extra = arms.filter((arm) => !held.includes(arm));
    if (missing.length > 0 || extra.length > 0)
      wrong.push(
        `${row}: cites ${name} held to ${arms.join(', ')}, and its entries there are held to ${held.join(', ')}`
      );
    for (const entry of ledger.entries)
      if (arms.includes(entry.arm) && (entry.rows ?? []).length === 0)
        wrong.push(
          `${name}: ${entry.id} is held to ${entry.arm}, which ${row} cites, and names no row`
        );
  }
  for (const ledger of ledgers) {
    for (const entry of ledger.entries)
      for (const row of entry.rows ?? [])
        if (!cited.some((citation) => citation.row === row && citation.ledger === ledger.name))
          wrong.push(
            cells.has(row)
              ? `${ledger.name}: ${entry.id} names ${row}, whose cell does not cite ${ledger.name}`
              : `${ledger.name}: ${entry.id} names ${row}, which is no row`
          );
    for (const entry of ledger.retired ?? [])
      if ((entry.rows ?? []).length > 0)
        wrong.push(
          `${ledger.name}: ${entry.id} is retired and names ${(entry.rows ?? []).join(', ')}`
        );
  }
  return wrong;
}
