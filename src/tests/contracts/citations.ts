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
 * row's Then, or whether an entry a row names breaks its promise rather than a
 * control or an instrument the landing reads by. Those are judgements about
 * mutations, and they are the review's. Nor does it read a description of
 * entries in words, or a family written as one word without its hyphen (`C7`).
 */
import * as markdown from 'prettier/plugins/markdown';

import { rosterOf, TEST_ID, testEvidence } from './bridge.js';
import { inline, type Node } from './legacy.js';

/** One mutation of a ledger, as far as a citation reads it. */
export interface CitedEntry {
  readonly id: string;
  readonly arm: string;
  /** The arms beside `arm` that must fail too for the entry to count as killed. */
  readonly requires?: readonly string[];
  /**
   * The rows this entry is evidence of, whose Evidence cell cites its ledger:
   * it breaks the row's promise, or a control or an instrument the row's
   * landing reads by.
   */
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

/** A contract row's Implementation test cell, read twice. */
export interface ImplementationCell {
  /** In its Markdown spelling, as `inline` keeps it: what the grammar reads. */
  readonly markdown: string;
  /** As a reader reads it: what labels and entry ids are looked for in. */
  readonly text: string;
}

/** The four labels a trial cell is written in (§5). */
const LABELS = ['Read', 'Where and when', 'Ledger', 'Limitations'] as const;
/** A label as a reader reads it: in any emphasis, linked or not, the colon inside or out. */
const LABEL = new RegExp(String.raw`(?<![\p{L}\p{N}])(${LABELS.join('|')})\s*:`, 'gu');
/** The label a trial cell's ledger part opens with, and the one that closes it. */
const LEDGER = '**Ledger:**';
const LIMITATIONS = '**Limitations:**';
/** What a reader takes for one identifier: hyphenated words, an `@` kept inside. */
const TOKEN = /[\p{L}\p{N}@]+(?:-[\p{L}\p{N}@]+)*-?/gu;

/** A node with the fields a link or an image adds. */
type Linked = Node & { readonly url?: string; readonly alt?: string };

/**
 * A node's text as a reader reads it: what the parser resolved escapes and
 * entities to, code spans' contents, and a link's or an image's text and target.
 */
const plain = (node: Linked): string =>
  node.type === 'link' || node.type === 'image'
    ? [...(node.children ?? []).map(plain), node.alt ?? '', node.url ?? ''].join(' ')
    : (node.value ?? (node.children ?? []).map(plain).join(''));

/** The labels in a text a reader reads, by name. */
const labelsIn = (text: string): string[] =>
  [...text.matchAll(LABEL)].map((match) => match[1] as string);

/**
 * Every contract row's id and its Implementation test cell, read with the
 * Markdown parser, and what in the record a citation would be lost to. A contract
 * table is one whose header opens with `Contract` and has an `Implementation
 * test` column; a row in it is one whose first cell is its id in a code span.
 * **Refused**: a row whose cells are more or fewer than its header's, as a pipe
 * in a code span makes them; a row id twice; a label of §5 anywhere but in a
 * contract row's Implementation test cell, in any spelling a reader takes for
 * one; and a label in that cell spelled otherwise than in bold with its colon
 * inside, as `**Read:**` is.
 */
export function implementationCells(text: string): {
  cells: Map<string, ImplementationCell>;
  faults: string[];
} {
  const parser = (
    markdown as unknown as {
      parsers: { markdown: { parse: (text: string, options: object) => Node } };
    }
  ).parsers.markdown;
  const cells = new Map<string, ImplementationCell>();
  const faults: string[] = [];
  const textOf = (cell: Node | undefined): string =>
    (cell?.children ?? []).map(inline).join('').trim();
  const stray = (node: Node): void => {
    const read = plain(node);
    const labels = labelsIn(read);
    if (labels.length > 0)
      faults.push(
        `${labels.join(', ')}, outside a contract row's Implementation test cell: ${read.trim().slice(0, 80)}`
      );
  };
  const visit = (node: Node): void => {
    if (node.type === 'table') {
      const [header, ...rows] = node.children ?? [];
      const headers = (header?.children ?? []).map(textOf);
      const at = headers.indexOf('Implementation test');
      const contract = headers[0] === 'Contract' && at > 0;
      for (const cell of header?.children ?? []) stray(cell);
      for (const row of rows) {
        const read = row.children ?? [];
        const id = contract ? /^`([^`]+)`$/.exec(textOf(read[0]))?.[1] : undefined;
        if (contract && read.length !== headers.length)
          faults.push(
            `${id ?? textOf(read[0])}: a row of ${read.length} cells under ${headers.length} headers`
          );
        read.forEach((cell, column) => {
          if (id === undefined || column !== at) stray(cell);
          else if (cells.has(id)) faults.push(`${id}: a row twice`);
          else {
            const found = { markdown: textOf(cell), text: plain(cell) };
            for (const label of LABELS)
              if (
                labelsIn(found.text).filter((name) => name === label).length !==
                found.markdown.split(`**${label}:**`).length - 1
              )
                faults.push(`${id}: ${label} written otherwise than **${label}:**`);
            cells.set(id, found);
          }
        });
      }
    } else if (node.children === undefined || node.type === 'paragraph' || node.type === 'heading')
      stray(node);
    else for (const child of node.children) visit(child);
  };
  visit(parser.parse(text, {}));
  return { cells, faults };
}

/**
 * The citations a cell's ledger part makes, or what is wrong with it. The part
 * runs from {@link LEDGER} to {@link LIMITATIONS} or the cell's end, and is
 * one or more `` `ledger`, held to `ARM` `` clauses, separated by semicolons and
 * ended by a full stop, the arms written `` `A` ``, `` `A` and `B` `` or
 * `` `A`, `B` and `C` ``. Nothing else may stand in it: a description of the
 * entries would be a second list nothing reads. A cell with another label of
 * §5 and no ledger part is refused.
 */
export function citationsOf(
  row: string,
  cell: string
): { citations: Citation[]; faults: string[] } {
  const opens = cell.indexOf(LEDGER);
  if (opens < 0)
    return {
      citations: [],
      faults: LABELS.some((label) => cell.includes(`**${label}:**`))
        ? [`${row}: a trial cell with no ${LEDGER} part`]
        : []
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

/** Every arm an entry's verdict reads: its `arm`, and the ones it `requires`. */
const armsOf = (entry: CitedEntry): string[] => [entry.arm, ...(entry.requires ?? [])];

/**
 * What is wrong between the record's citations and the ledgers: the record is
 * read whole ({@link implementationCells}); every trial cell — one with a label
 * of §5 — has a readable ledger part and names no entry anywhere in its text, by
 * its id, by a prefix ending in `-`, or by a prefix of two words or more that
 * ends where one of the id's words does and is not itself a row's id; each
 * ledger it names exists, is
 * named once, and has entries naming the row, held to exactly the arms the cell
 * names — each entry's `arm` and the ones it `requires` — each on the row's
 * roster line; every entry of a cited ledger held to a cited arm names a row;
 * every row an entry names is a row whose cell cites that ledger; and no retired
 * entry names a row.
 */
export function citationFaults(text: string, ledgers: readonly CitedLedger[]): string[] {
  const { roster, faults: rosterFaults } = rosterOf(text);
  const { cells, faults: recordFaults } = implementationCells(text);
  const byName = new Map(ledgers.map((ledger) => [ledger.name, ledger]));
  const wrong = [...rosterFaults, ...recordFaults];
  const cited: Citation[] = [];
  const entryIds = ledgers.flatMap((ledger) =>
    [...ledger.entries, ...(ledger.retired ?? [])].map(({ id }) => ({ id, ledger: ledger.name }))
  );
  // A row's id is read as the row, though entries begin with it (`B6-C1`).
  const rowIds = new Set([...cells.keys(), ...roster.keys()]);
  const names = (token: string, id: string): boolean =>
    token === id ||
    (token.endsWith('-')
      ? id.startsWith(token)
      : token.includes('-') &&
        !rowIds.has(token) &&
        (id.startsWith(`${token}-`) || id.startsWith(`${token}@`)));
  for (const [row, cell] of cells) {
    const { citations, faults } = citationsOf(row, cell.markdown);
    wrong.push(...faults);
    // **Nowhere in a trial cell**, not only in its ledger part, and not only
    // in code: an id written in the limitations, in prose, a link or with its
    // hyphens escaped is the same copy nothing reads.
    if (labelsIn(cell.text).length > 0)
      for (const token of new Set(cell.text.match(TOKEN) ?? []))
        for (const { id, ledger } of entryIds.filter(({ id }) => names(token, id)).slice(0, 1))
          wrong.push(
            `${row}: names ${token}, ${token === id ? 'an entry' : 'the entries beginning so'} of ${ledger}; which entries are the row's is the ledger's to say`
          );
    const named = citations.map(({ ledger }) => ledger);
    for (const name of named.filter((name, at) => named.indexOf(name) !== at))
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
    const held = [...new Set(own.flatMap(armsOf))];
    const missing = held.filter((arm) => !arms.includes(arm));
    const extra = arms.filter((arm) => !held.includes(arm));
    if (missing.length > 0 || extra.length > 0)
      wrong.push(
        `${row}: cites ${name} held to ${arms.join(', ')}, and its entries there are held to ${held.join(', ')}`
      );
    for (const entry of ledger.entries) {
      const at = armsOf(entry).find((arm) => arms.includes(arm));
      if (at !== undefined && (entry.rows ?? []).length === 0)
        wrong.push(`${name}: ${entry.id} is held to ${at}, which ${row} cites, and names no row`);
    }
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
