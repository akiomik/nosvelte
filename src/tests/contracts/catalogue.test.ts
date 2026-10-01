/**
 * The contract catalogue's port roster, checked against the production tests.
 *
 * `docs/decisions/0005` routes every contract row and records its production
 * evidence; phase 2 moves that evidence from `TBD` to `test:<id>` as tests land
 * under this directory. This file is what makes a landing mean something: the
 * roster's shape and counts, the grammar of each evidence cell, and the seven
 * rules 0005 states for `test:<id>`. Each rule is also driven against
 * fabricated sources, because the real landings only ever take the accepting
 * path and so cannot exercise the refusals.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  asserts,
  backwardFaults,
  code,
  collectFrom,
  DECISION_ID,
  declarationsIn,
  declaresTest,
  disagrees,
  faultInLanding,
  inspect,
  mergeDeclarations,
  PRODUCTION_ROOT,
  PRODUCTION_ROOT_LEAF,
  ROUTES,
  TEST_ID
} from './bridge.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TESTS_ROOT = resolve(HERE, '..');
const DECISIONS = resolve(HERE, '../../../docs/decisions');

// The parser walks `<suite root>/contracts` and the record says `src/tests/contracts`;
// if this file moves, those stop being one directory.
if (!TESTS_ROOT.endsWith(join('src', 'tests')))
  throw new Error(`the suite root is ${TESTS_ROOT}, which is not what ${PRODUCTION_ROOT} assumes`);

const read = (name: string): string => readFileSync(join(DECISIONS, name), 'utf8');

/** Decision ids from the three records that carry decision tables. */
const decisions = new Set<string>();
for (const file of [
  '0002-request-engine.md',
  '0003-cache-identity-and-value.md',
  '0004-public-svelte-api.md'
]) {
  for (const match of read(file).matchAll(/^\| ([ABC][0-9a-zα-ω-]+)\s*\|/gm))
    decisions.add(match[1] as string);
}

interface Row {
  readonly contract: string;
  readonly kind: string;
  /** The Implementation test cell. */
  readonly implementation: string;
  /** The Spike witness cell: the arms on the spike branch that made the observation. */
  readonly witness: string;
}

const CATALOGUE = read('0005-contract-catalogue.md');

const rows: Row[] = [
  ...CATALOGUE.matchAll(
    /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*(\w+(?:-\w+)?)\s*\|([^|]*)\|([^|]*)\|\s*([^|]*?)\s*\|\s*([^|]*?)\s*\|/gm
  )
].map((match) => ({
  contract: match[1] as string,
  kind: match[3] as string,
  implementation: (match[7] as string).trim(),
  witness: (match[6] as string).trim()
}));

/**
 * The ids rule 1 refuses as landings: every arm 0005 names as a spike witness.
 * The spike is not on this branch, so its arms cannot be read from the tree;
 * the record's witness column is the list of them, and a landing that reuses
 * one is a spike arm wearing a new directory, whatever directory it is in.
 */
const spikeWitnesses = new Set(
  rows.flatMap((row) =>
    [...row.witness.matchAll(new RegExp(`(?<![\\w-])(${TEST_ID})(?![\\w-])`, 'g'))].map(
      (match) => match[1] as string
    )
  )
);

/** Every `.test.ts` under the suite root, relative to it. */
const testFilesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? testFilesUnder(join(dir, entry.name))
      : entry.name.endsWith('.test.ts')
        ? [join(dir, entry.name).slice(TESTS_ROOT.length + 1)]
        : []
  );

/**
 * The roster block under 0005's port-route heading: one line per row, the
 * route somebody decided and the evidence phase 2 moves. Anchored to its
 * heading rather than to the first fence in the file, so an example block
 * elsewhere cannot become the roster.
 */
const rosterRows = (text: string): Map<string, { route: string; evidence: string }> => {
  const found = new Map<string, { route: string; evidence: string }>();
  const lines = text.split('\n');
  const heading = lines.findIndex((line) => line.startsWith('#### The port route of a row'));
  expect(heading, 'the record no longer has a port-route section').toBeGreaterThan(-1);
  const opens = lines.findIndex((line, at) => at > heading && line.startsWith('```text'));
  const closes = lines.findIndex((line, at) => at > opens && line.startsWith('```'));
  expect(opens, 'the record no longer carries a roster block').toBeGreaterThan(-1);
  expect(closes, 'the roster fence is never closed').toBeGreaterThan(opens);
  const block = lines.slice(opens + 1, closes);
  // A duplicate id would be last-wins in a Map, so the lines are counted.
  expect(new Set(block.map((line) => line.split(/\s+/)[0])).size, 'a row is rostered twice').toBe(
    block.length
  );
  for (const line of block) {
    const match = /^(\S+)\s+([a-z-]+)\s+(\S.*)$/.exec(line);
    expect(match, `a roster line that is not id, route, evidence: ${line}`).not.toBeNull();
    expect(ROUTES, `an unknown route in the roster: ${match?.[2] ?? ''}`).toContain(
      match?.[2] as (typeof ROUTES)[number]
    );
    found.set(match?.[1] as string, {
      route: match?.[2] as string,
      evidence: match?.[3] as string
    });
  }

  return found;
};

describe('the production contract bridge', () => {
  it('CAT33: every row carries a route and a production evidence, and the counts are those', () => {
    const text = CATALOGUE;
    const landed = collectFrom(join(TESTS_ROOT, PRODUCTION_ROOT_LEAF));
    expect(landed.duplicates, 'two production tests share an id').toEqual([]);
    expect(landed.assertionless, 'a landing test that asserts nothing').toEqual([]);
    expect(landed.unreadable, 'a landing test whose id this bridge cannot read').toEqual([]);
    expect(landed.disabled, 'a landing test that is skipped, focused or todo').toEqual([]);

    // A landing id that another test in the suite already declares is not a
    // landing: rule 1 says the test lives under the root, not that its name does.
    const elsewhere = new Set(
      testFilesUnder(TESTS_ROOT)
        .filter((file) => !file.startsWith(`${PRODUCTION_ROOT_LEAF}/`))
        .flatMap((file) =>
          [...code(readFileSync(join(TESTS_ROOT, file), 'utf8')).matchAll(declaresTest())].map(
            (match) => match[2] as string
          )
        )
    );
    expect(
      [...landed.tests.keys()].filter((id) => elsewhere.has(id)),
      'a landing test reusing an id the suite declares outside the root'
    ).toEqual([]);
    // And rule 1 proper: an id 0005 records as a spike witness is not a landing.
    // The read is driven both ways — the spike's own name for a sentinel the
    // production line renamed is in the set, and the production name is not.
    expect(spikeWitnesses.has('SEN25'), 'the witness column was not read').toBe(true);
    expect(spikeWitnesses.has('DS25')).toBe(false);
    expect(spikeWitnesses.size, 'the witness column was read as almost nothing').toBeGreaterThan(
      300
    );
    expect(
      [...landed.tests.keys()].filter((id) => spikeWitnesses.has(id)),
      'a landing test reusing an id 0005 records as a spike witness'
    ).toEqual([]);

    // One root, and the record names it wherever it sends a port: the route
    // table's sentinel row, exactly once, and rule 1 of the grammar.
    const sentinelCells = [...text.matchAll(/^\|\s*`sentinel`\s*\|[^|\n]*\|([^|\n]*)\|/gm)];
    expect(sentinelCells.length, 'the route table has no sentinel row, or has two').toBe(1);
    expect(
      (sentinelCells[0] as RegExpExecArray)[1],
      'the route table sends sentinels somewhere this check cannot read'
    ).toContain(`${PRODUCTION_ROOT}/sentinels/`);
    const ruleOne = /^\s*1\. the id names a test[^\n]*\n(?:[^\n]*\n)?/m.exec(text);
    expect(ruleOne, 'the grammar no longer states the landing rule').not.toBeNull();
    expect(
      (ruleOne as RegExpExecArray)[0],
      'the rule that says where a landing test lives no longer names the root'
    ).toContain(`${PRODUCTION_ROOT}/`);

    const roster = rosterRows(text);

    // Coverage, both ways.
    expect(
      rows.filter((row) => !roster.has(row.contract)).map((row) => row.contract),
      'these rows carry no port route'
    ).toEqual([]);
    expect(
      [...roster.keys()].filter((id) => !rows.some((row) => row.contract === id)),
      'these roster lines name no row'
    ).toEqual([]);

    // The grammar of the field phase 2 moves. Each clause needs substance:
    // three words is a low bar, and it is a bar.
    const substantial = (clause: string): boolean => clause.trim().split(/\s+/).length >= 3;
    const faultyEvidence = [...roster]
      .map(([id, { evidence }]): string | undefined => {
        if (evidence === 'TBD') return undefined;
        const [kind, ...rest] = evidence.split(':');
        const body = rest.join(':');
        if (kind === 'test') return faultInLanding(id, body.trim(), landed.tests);
        if (kind === 'no-test')
          return substantial(body) ? undefined : `${id}: no-test with no reason`;
        if (kind === 'discharged' || kind === 'absent') {
          const [decision, ...back] = body.split(';');
          if ((decision ?? '').trim().length === 0) return `${id}: ${kind} by nothing`;
          if (!substantial(back.join(';'))) return `${id}: ${kind} with no way back`;
          const named = [...(decision as string).matchAll(new RegExp(DECISION_ID, 'g'))].map(
            (match) => match[1] as string
          );
          if (named.length === 0) return `${id}: ${kind} names no decision`;
          const unknown = named.filter((each) => !decisions.has(each));
          if (unknown.length > 0)
            return `${id}: ${kind} by ${unknown.join(', ')}, which no record declares`;

          return undefined;
        }

        return `${id}: ${evidence} is not one of the four forms`;
      })
      .filter(Boolean);
    expect(faultyEvidence, 'production evidence that does not carry what it claims').toEqual([]);

    // The pairing of route and kind. Counts are a multiset, so a swap between
    // two routes leaves every number the same; four routes are decided by the
    // row's own kind and are pinned here. An `architecture` row is pinned to its
    // route only when it declares no runtime facility.
    const needsOf = new Map<string, string[]>();
    for (const line of text.split('\n')) {
      const cells = line.split('|');
      if (cells.length - 2 !== 3 || !line.startsWith('| ')) continue;
      needsOf.set(
        (cells[1] as string).trim(),
        (cells[3] as string).trim().split(/\s+/).filter(Boolean)
      );
    }
    const staticOnly = (contract: string): boolean => {
      const needs = needsOf.get(contract) ?? [];

      return needs.length > 0 && needs.every((need) => need === 'static' || need === 'none');
    };
    const byKind: Record<string, string> = {
      sentinel: 'sentinel',
      rationale: 'no-test',
      'non-goal': 'no-test',
      reconsideration: 'no-test'
    };
    // A discharge is pinned twice: the row's own cell opens with one, and the
    // decision the roster names is one that cell names.
    const dischargeFaults = rows
      .filter((row) => roster.get(row.contract)?.route === 'discharged')
      .flatMap((row) => {
        const evidence = roster.get(row.contract)?.evidence ?? '';
        const faults: string[] = [];
        if (!row.implementation.startsWith('**discharged'))
          faults.push(`${row.contract}: rostered discharged, but its own cell is not`);
        const inCell = [...row.implementation.matchAll(new RegExp(DECISION_ID, 'g'))].map(
          (match) => match[1] as string
        );
        const inRoster = [...evidence.matchAll(new RegExp(DECISION_ID, 'g'))].map(
          (match) => match[1] as string
        );
        if (!inRoster.some((id) => inCell.includes(id)))
          faults.push(
            `${row.contract}: discharged by ${inRoster.join(', ') || 'nothing'}, which its own cell does not name`
          );

        return faults;
      });
    expect(dischargeFaults, 'a row discharged against a decision of its own choosing').toEqual([]);

    const wrongForKind = rows
      .filter((row) => {
        const route = roster.get(row.contract)?.route;
        if (route === 'discharged') return false;
        if (row.kind === 'architecture') {
          return staticOnly(row.contract)
            ? route !== 'architecture'
            : !['public', 'internal', 'architecture'].includes(route ?? '');
        }
        const owed = byKind[row.kind];

        return owed === undefined ? !['public', 'internal'].includes(route ?? '') : route !== owed;
      })
      .map((row) => `${row.contract}: kind ${row.kind} routed ${roster.get(row.contract)?.route}`);
    expect(wrongForKind, 'a route that its row’s kind does not allow').toEqual([]);

    const mismatched = [...roster]
      .filter(([, { route, evidence }]) => disagrees(route, evidence))
      .map(([id, { route, evidence }]) => `${id}: ${route} / ${evidence}`);
    expect(mismatched, 'a route and its evidence disagree').toEqual([]);

    // Both edges of the `absent:` exclusion, driven: every real `absent:` row
    // is `internal`, so the other clauses have no input otherwise.
    expect(disagrees('internal', 'absent:0002 A16 — no seam;returns when one exists')).toBe(false);
    expect(
      disagrees('sentinel', 'absent:0002 A5 — the port resolves no rx-nostr;returns when it does')
    ).toBe(false);
    expect(disagrees('public', 'absent:0002 A5 — no seam;returns when one exists')).toBe(true);
    expect(disagrees('architecture', 'absent:0002 A5 — no seam;returns when one exists')).toBe(
      true
    );
    expect(disagrees('public', 'test:CT1')).toBe(false);
    expect(disagrees('discharged', 'test:CT1')).toBe(true);
    expect(disagrees('no-test', 'no-test: the row records a decision')).toBe(false);

    // Every count the record prints, cell by cell: a total is satisfied by two
    // errors that cancel.
    const counts = new Map<string, number>();
    for (const { route } of roster.values()) counts.set(route, (counts.get(route) ?? 0) + 1);
    const printed = [...text.matchAll(/^\|\s*`([a-z-]+)`\s*\|\s*\*\*(\d+)\*\*\s*\|/gm)].map(
      (match) => [match[1] as string, Number(match[2])] as const
    );
    expect(printed.length, 'the record no longer prints the route table').toBe(ROUTES.length);
    for (const [route, said] of printed)
      expect(said, `the record’s count of ${route} rows`).toBe(counts.get(route) ?? 0);
    for (const route of counts.keys())
      expect(
        printed.map(([name]) => name),
        `${route} is in the roster but the record does not print it`
      ).toContain(route);

    // The phase-2 split, in one paragraph: an absence and a written test are
    // both terminal and are not the same achievement.
    const kindOf = (evidence: string): string =>
      evidence === 'TBD' ? 'TBD' : (evidence.split(':')[0] as string);
    const owing = [...roster.values()].filter(
      ({ route }) => !['no-test', 'discharged'].includes(route)
    );
    const tally = [
      owing.length,
      owing.filter(({ evidence }) => kindOf(evidence) === 'test').length,
      owing.filter(({ evidence }) => kindOf(evidence) === 'absent').length,
      owing.filter(({ evidence }) => !['test', 'absent', 'TBD'].includes(kindOf(evidence))).length,
      owing.filter(({ evidence }) => evidence === 'TBD').length
    ];
    const [requiring, backed, absent, other, tbd] = tally as [
      number,
      number,
      number,
      number,
      number
    ];
    expect(backed + absent + other + tbd, 'the four do not add up').toBe(requiring);
    const phase2 = text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.replace(/\s+/g, ' '))
      .map((paragraph) =>
        paragraph.match(
          /\*\*(\d+) rows require a phase-2 disposition\*\*.*?\*\*(\d+) are test-backed\*\*, \*\*(\d+) are absent\*\*, \*\*(\d+) carry another terminal form\*\*, and \*\*(\d+) are TBD\*\*/
        )
      )
      .find((match) => match !== null);
    expect(phase2, 'the record no longer states phase 2’s five numbers in one paragraph').not.toBe(
      undefined
    );
    expect(
      [1, 2, 3, 4, 5].map((at) => Number(phase2?.[at] ?? -1)),
      'the record’s phase-2 numbers'
    ).toEqual(tally);

    expect(
      backwardFaults(roster, landed.tests),
      'a production test declares a row that does not claim it'
    ).toEqual([]);

    // The landing rules, driven through the parser itself. Arm calls are
    // assembled rather than written, so that this file's own declarations stay
    // the two arms it has.
    const arm = (id: string): string => `  ${'it'}('${id}: fabricated', () => {});`;
    const fabricated = declarationsIn(
      [
        '// @contracts A9-C9',
        'describe("x", () => {',
        '  // @contracts A1-C1 A2-C1',
        arm('CT1'),
        '',
        arm('CT2'),
        '});'
      ].join('\n')
    ).rows;
    expect([
      ...(declarationsIn(['  /** @contracts A1-C1 */', arm('CT3')].join('\n')).rows.get('CT3') ??
        [])
    ]).toEqual(['A1-C1']);
    const wrapped = declarationsIn(
      [
        '  // @contracts A2-C1',
        `  ${'it'}(`,
        "    'CT4: fabricated',",
        '    () => {}',
        '  );'
      ].join('\n')
    ).rows;
    expect([...(wrapped.get('CT4') ?? [])]).toEqual(['A2-C1']);
    // A declaration inside a string is not an arm either, though a marker sits
    // directly above it: what counts is a call in the syntax tree.
    expect([
      ...declarationsIn(
        ['  // @contracts A1-C1', `  const source = "${'it'}('CT6: fake', () => {});";`].join('\n')
      ).rows.keys()
    ]).toEqual([]);
    // A declaration inside a comment is not an arm.
    expect([
      ...declarationsIn(
        ['  // @contracts A1-C1', `  // ${'it'}('CT10: not written yet', () => {});`].join('\n')
      ).rows.keys()
    ]).toEqual([]);
    // A blank line ends the block above.
    expect([
      ...(declarationsIn(
        ['  // @contracts A1-C1', '', '  // something else entirely', arm('CT11')].join('\n')
      ).rows.get('CT11') ?? [])
    ]).toEqual([]);

    // What counts as asserting, both ways.
    const armWith = (body: string): string => `  ${'it'}('CT12: fabricated', () => { ${body} });`;
    const unasserted = (body: string): string[] =>
      [...declarationsIn(armWith(body)).bodies.entries()]
        .filter(([, text]) => !asserts(text))
        .map(([id]) => id);
    expect(unasserted('expect(1).toBe(1)')).toEqual([]);
    expect(unasserted('assert.equal(1, 1)')).toEqual([]);
    expect(unasserted('expectTypeOf(1).toBeNumber()')).toEqual([]);
    expect(unasserted('expect.soft(1).toBe(1)')).toEqual([]);
    expect(unasserted('expect(1)'), 'a call with no matcher asserts nothing').toEqual(['CT12']);
    expect(unasserted('void 0'), 'an empty arm').toEqual(['CT12']);
    expect(
      [...declarationsIn(`  ${'it'}('CT13: does not expect (yet)', () => {});`).bodies.entries()]
        .filter(([, text]) => !asserts(text))
        .map(([id]) => id),
      'a title cannot assert by being named'
    ).toEqual(['CT13']);

    const doubled = declarationsIn(
      ['  // @contracts A1-C1', arm('CT5'), '  // @contracts A2-C1', arm('CT5')].join('\n')
    );
    expect(doubled.twice).toEqual(['CT5']);
    expect([...(doubled.rows.get('CT5') ?? [])]).toEqual(['A2-C1']);
    expect(
      mergeDeclarations([
        {
          file: 'one.test.ts',
          source: ['  // @contracts A1-C1', arm('CT5'), '  // @contracts A2-C1', arm('CT5')].join(
            '\n'
          )
        }
      ]).duplicates
    ).toEqual(['CT5 is declared twice in one.test.ts']);
    expect([...(fabricated.get('CT1') ?? [])].sort()).toEqual(['A1-C1', 'A2-C1']);
    expect([...(fabricated.get('CT2') ?? [])]).toEqual([]);
    expect(faultInLanding('A1-C1', 'CT1', fabricated)).toBeUndefined();
    expect(faultInLanding('A2-C1', 'CT1', fabricated)).toBeUndefined();
    expect(faultInLanding('A1-C1', 'CT2', fabricated)).toMatch(/does not declare this row/);
    expect(faultInLanding('A3-C1', 'CT1', fabricated)).toMatch(/does not declare this row/);
    expect(faultInLanding('A1-C1', 'SM3b', fabricated)).toMatch(/names no test under/);

    const merged = mergeDeclarations([
      { file: 'a.test.ts', source: ['  // @contracts A1-C1', arm('CT1')].join('\n') },
      { file: 'b.test.ts', source: ['  // @contracts A2-C1', arm('CT1')].join('\n') }
    ]);
    expect(merged.duplicates).toEqual(['CT1 is declared in a.test.ts and b.test.ts']);
    expect([...(merged.tests.get('CT1') ?? [])]).toEqual(['A2-C1']);
    expect(
      mergeDeclarations([
        { file: 'a.test.ts', source: ['  // @contracts A1-C1', arm('CT1')].join('\n') },
        { file: 'b.test.ts', source: ['  // @contracts A2-C1', arm('CT2')].join('\n') }
      ]).duplicates
    ).toEqual([]);

    // What does not run, read out of the syntax tree, both ways. Each case is
    // a whole statement, because the tree is what decides.
    const disabledIn = (statement: string): string[] => inspect(statement, 'x.test.ts').disabled;
    for (const statement of [
      `${'describe'}.skip('x', () => {});`,
      `${'it'}.concurrent.skip('CT: y', () => {});`,
      `${'test'}.todo('CT: z');`,
      `${'describe'}.skipIf(true)('x', () => {});`,
      `${'it'}.runIf(false)('CT: y', () => {});`,
      `${'describe'}.each([1]).skip('x', () => {});`,
      `${'it'}.each([1]).skip('CT: y', () => {});`,
      `${'describe'}.skip.each${'`'}a${'`'}('x', () => {});`,
      `${'suite'}.only('x', () => {});`,
      `${'it'}.each([1])('CT: y %s', () => {});`,
      `${'it'}.for([1])('CT: y %s', () => {});`,
      `${'it'}('CT: y', { skip: true }, () => {});`,
      `${'describe'}('x', { meta: {}, skip: true }, () => {});`,
      `${'describe'}('x', { 'only': 1 }, () => {});`,
      `${'describe'}('x', { todo }, () => {});`,
      `${'it'}('CT: y', (ctx) => { const n = 1; ctx.skip(); });`,
      `${'it'}('CT: y', ctx => { ctx['skip'](); });`,
      `${'it'}('CT: y', function (ctx) { const n = 1; ctx.skip(); });`,
      `${'it'}('CT: y', async (context) => { await x(); context.skip(true, 'later'); });`,
      `${'it'}('CT: y', ({ skip }) => { const n = 1; skip(); });`,
      `${'it'}('CT: y', ({ skip: skipTest }) => { const n = 1; skipTest(); });`,
      `${'describe'}('x', { ['skip']: true }, () => {});`,
      `${'describe'}('x', { ...{ only: true } }, () => {});`,
      `const options = { skip: true }; ${'describe'}('x', options, () => {});`,
      `const quiet = ${'describe'}.skip; quiet('x', () => {});`,
      `${'describe'}[mode]('x', () => {});`,
      `${'describe'}('x', makeOptions(), () => {});`,
      `${'describe'}('x', { [key]: true }, () => {});`,
      `function make(options) { ${'describe'}('x', options, () => {}); }`,
      `let quiet = ${'describe'}.skip; quiet = ${'describe'}; quiet('x', () => { ${'it'}('CT1: y', () => {}); });`,
      `forEachRelay(() => { ${'it'}('CT1: y', () => {}); });`,
      // Refused rather than traced: an object or array behind a name can be
      // changed after it was written, and a test context can be taken apart
      // or handed on.
      `const options = { skip: false }; options.skip = true; ${'describe'}('x', options, () => {});`,
      `const options = { timeout: 5 }; ${'describe'}('x', options, () => {});`,
      `${'it'}('CT: y', (ctx) => { const { skip: skipTest } = ctx; skipTest(); });`,
      `${'it'}('CT: y', (ctx) => { helper(ctx); });`,
      `${'it'}('CT: y', (ctx) => { const c = ctx; c.skip(); });`,
      `${'it'}('CT: y', (ctx) => { ctx[member](); });`,
      `${'it'}('CT: y', ({ skip: skipTest }) => { skip(); });`,
      `${'it'}('CT: y', ({ task, ...rest }) => { rest.skip(); });`,
      `${'it'}('CT: y', function () { arguments[0].skip(); });`,
      // Only the members on the list, none of which leads back to the context.
      `${'it'}('CT: y', (ctx) => { ctx.task.context.skip(); });`,
      `${'it'}('CT: y', (ctx) => { expect(ctx.task).toBeDefined(); });`,
      `${'it'}('CT: y', ({ task }) => { task.context.skip(); });`,
      // A local binding called `undefined` is not the global.
      `${'describe'}('x', () => { const undefined = true; ${'describe'}('y', { skip: undefined }, () => {}); });`,
      `${'describe'}('x', () => { const undefined = { skip: true }; ${'describe'}('y', undefined, () => {}); });`
    ])
      expect(disabledIn(statement), `${statement} does not run`).not.toEqual([]);
    for (const statement of [
      `${'it'}('CT: y', () => {});`,
      `${'it'}.fails('CT: y', () => {});`,
      `${'describe'}('skip and only', () => {});`,
      `${'describe'}.each([1])('$name', () => {});`,
      `${'it'}('CT: y', { timeout: 20_000 }, () => {});`,
      `${'describe'}('x', { meta: { skip: true } }, () => {});`,
      `${'describe'}('x', { skip: false }, () => {});`,
      `${'describe'}('x', () => { const o = { skip: true }; });`,
      `${'it'}('CT: y', (ctx) => { ctx.expect(1).toBe(1); });`,
      `${'it'}('CT: y', (ctx) => { ctx.onTestFinished(() => {}); });`,
      `${'describe'}('x', { skip: undefined }, () => {});`,
      `${'it'}('CT: y', (ctx) => { other.skip(); });`,
      `${'it'}('CT: y', ({ expect }) => { source.pipe(skip(1)); });`,
      `${'it'}('CT: y', () => { const skip = 1; });`,
      `${'it'}('CT: y', () => {}, 20_000);`,
      `const quiet = false; ${'describe'}('x', { skip: quiet }, () => {});`,
      `const plain = ${'describe'}; plain('x', () => {});`,
      `${'describe'}['each']([1])('x', () => {});`,
      `${'describe'}('x', { ...{ skip: true }, skip: false }, () => {});`,
      `${'describe'}('x', { skip: 0, only: '' }, () => {});`,
      `${'describe'}('x', () => { beforeEach(() => {}); ${'it'}('CT1: y', () => {}); });`
    ])
      expect(disabledIn(statement), `${statement} runs`).toEqual([]);
    // Resolved rather than refused: a computed key that is a literal, a spread
    // of an object written in place and a `const` bound to a primitive are
    // read, so each is reported as disabled by its options and not merely as
    // options nobody could read.
    for (const statement of [
      `${'describe'}('x', { ['skip']: true }, () => {});`,
      `${'describe'}('x', { ...{ only: true } }, () => {});`,
      `const quiet = true; ${'describe'}('x', { skip: quiet }, () => {});`,
      // The final value of each key, after every spread.
      `${'describe'}('x', { skip: false, ...{ skip: true } }, () => {});`
    ])
      expect(disabledIn(statement), statement).toEqual([`x.test.ts:1 (disabled by its options)`]);
    // **Where an arm is credited, as an allow-list, both ways.** Placed
    // anywhere this check does not follow, an arm is refused rather than
    // modelled; placed in the shapes it does follow, it is credited.
    const armStatement = `${'it'}('CT1: y', () => { expect(1).toBe(1); });`;
    for (const statement of [
      `if (process.env.CI) { ${armStatement} }`,
      `for (const x of [1]) { ${armStatement} }`,
      `if (process.env.CI) ${armStatement}`,
      `for (const x of [1]) ${armStatement}`,
      `try { ${armStatement} } catch {}`,
      `function register() { ${armStatement} } register();`,
      `${'describe'}('x', () => { if (flag) return; ${armStatement} });`,
      `${'describe'}('x', () => { ${'it'}('CT2: outer', () => { ${armStatement} }); });`,
      `await ${armStatement}`,
      // A known name counts only when it is the runner's own.
      `const ${'it'} = ${'test'}.skip; ${armStatement}`,
      `function register(${'it'}) { ${'describe'}('x', () => { ${armStatement} }); }`,
      `const ${'describe'} = (name, fn) => {}; ${'describe'}('x', () => { ${armStatement} });`,
      // A table with no row declares nothing.
      `${'describe'}.each([])('x', () => { ${armStatement} });`,
      `${'describe'}.each([...rows])('x', () => { ${armStatement} });`,
      `let rows = [1]; ${'describe'}.each(rows)('x', () => { ${armStatement} });`,
      `${'describe'}.each${'`'}a${'`'}('x', () => { ${armStatement} });`,
      `${'describe'}.each([,])('x', () => { ${armStatement} });`,
      // Only a chain written directly: no alias, parenthesis or rename.
      `const group = ${'describe'}; group('x', () => { ${armStatement} });`,
      `const group = ${'describe'}.each([]); group('x', () => { ${armStatement} });`,
      // A table behind a name can be emptied after it was written.
      `const rows = [1]; rows.length = 0; ${'describe'}.each(rows)('x', () => { ${armStatement} });`,
      `const rows = [{ a: 1 }]; ${'describe'}.each(rows)('x', () => { ${armStatement} });`,
      `(${'describe'}.each([1]))('x', () => { ${armStatement} });`,
      `import { ${'describe'} as ${'it'} } from 'vitest'; ${armStatement}`
    ])
      expect(
        disabledIn(statement).some((why) =>
          why.endsWith('(declared where this bridge does not credit an arm)')
        ),
        `${statement} is not credited`
      ).toBe(true);
    for (const statement of [
      armStatement,
      `${'describe'}('x', () => { ${armStatement} });`,
      `${'suite'}('x', function () { ${'describe'}.each([1])('y %s', () => { ${armStatement} }); });`,
      `${'describe'}('x', () => ${armStatement.replace(/;$/, '')});`,
      `import { ${'describe'}, ${'it'} } from 'vitest'; ${'describe'}.each([1])('x %s', () => { ${armStatement} });`,
      `${'describe'}.each${'`'}a\n${'$'}{1}${'`'}('x', () => { ${armStatement} });`
    ])
      expect(disabledIn(statement), `${statement} is credited`).toEqual([]);

    // One report per declaration: a chain is read at its last link, so the
    // curried call inside it is not a second suite.
    expect(disabledIn(`${'describe'}.skipIf(true)('x', () => {});`)).toEqual(['x.test.ts:1']);

    // The walker itself, over a directory that exists.
    const sandbox = mkdtempSync(join(tmpdir(), 'nosvelte-contracts-'));
    try {
      mkdirSync(join(sandbox, 'deep'));
      writeFileSync(
        join(sandbox, 'landed.test.ts'),
        ['  // @contracts A1-C1', `  ${'it'}('CT6: real', () => { expect(1).toBe(1); });`].join(
          '\n'
        )
      );
      // Two arms in one file: an empty arm is not credited with the helper below it.
      writeFileSync(
        join(sandbox, 'deep', 'empty.test.ts'),
        [
          '  // @contracts A2-C1',
          arm('CT7'),
          '  const shared = (): void => { expect(1).toBe(1); };',
          '  // @contracts A4-C1',
          `  ${'it'}('CT9: asserts through a helper', () => { shared(); });`
        ].join('\n')
      );
      writeFileSync(
        join(sandbox, 'deep', 'skipped.test.ts'),
        [
          '  // @contracts A3-C1',
          `  ${'describe'}.skip('x', () => {`,
          `    ${'it'}('CT8: never runs', () => { expect(1).toBe(1); });`,
          '  });'
        ].join('\n')
      );
      writeFileSync(join(sandbox, 'notes.md'), 'not a test');
      const found = collectFrom(sandbox);
      expect([...found.tests.keys()].sort()).toEqual(['CT6', 'CT7', 'CT8', 'CT9']);
      expect([...(found.tests.get('CT6') ?? [])]).toEqual(['A1-C1']);
      expect(found.assertionless.sort()).toEqual([
        'CT7 in deep/empty.test.ts',
        'CT9 in deep/empty.test.ts'
      ]);
      expect(found.disabled.sort()).toEqual(['deep/skipped.test.ts:2']);
      expect(found.unreadable).toEqual([]);
      expect(found.duplicates).toEqual([]);
      writeFileSync(
        join(sandbox, 'wrapped.test.ts'),
        [
          '  // @contracts A6-C1',
          `  ${'it'}(`,
          "    'CT10: wrapped',",
          '    { skip: true },',
          '    () => { expect(1).toBe(1); }',
          '  );'
        ].join('\n')
      );
      expect(collectFrom(sandbox).disabled.sort()).toEqual([
        'deep/skipped.test.ts:2',
        'wrapped.test.ts:2 (disabled by its options)'
      ]);
      rmSync(join(sandbox, 'wrapped.test.ts'));
      // A modifier after the first call of a suite chain: through the walker,
      // because the chain is what the walker extracts. The curried form, which
      // runs, is the control.
      // How a suite is disabled, through the walker, because the declaration
      // the walker extracts is what decides: a modifier after the first call,
      // a tagged template, the `suite` alias, and the suite's own options. The
      // running forms beside them are the controls — a curried `.each`, an
      // ordinary option, and a body that happens to hold `skip: true`.
      const tick = String.fromCharCode(96);
      const suiteSource = (opening: string, id: string, body = ''): string =>
        [
          `${opening} () => {`,
          ...(body === '' ? [] : [`  ${body}`]),
          '  // @contracts A8-C1',
          `  ${'it'}('${id}: inside', () => { expect(1).toBe(1); });`,
          '});'
        ].join('\n');
      const suites: Record<string, string> = {
        'each-skip': suiteSource(`${'describe'}.each([1]).skip('x %s',`, 'CT14'),
        'each-only': suiteSource(`${'describe'}.each([1]).only('x %s',`, 'CT15'),
        'tagged-skip': suiteSource(
          `${'describe'}.skip.each${tick}\n  a\n  $${'{'}1}\n${tick}('x $a',`,
          'CT17'
        ),
        'alias-skip': suiteSource(`${'suite'}.skip('x',`, 'CT18'),
        'options-skip': suiteSource(`${'describe'}('x', { skip: true },`, 'CT19'),
        'options-only': suiteSource(`${'suite'}('x', { only: true },`, 'CT20'),
        'each-runs': suiteSource(`${'describe'}.each([1])('x %s',`, 'CT16'),
        'options-run': suiteSource(`${'describe'}('x', { timeout: 5 },`, 'CT21'),
        'body-says-skip': suiteSource(`${'describe'}('x',`, 'CT22', 'const o = { skip: true };')
      };
      for (const [file, source] of Object.entries(suites))
        writeFileSync(join(sandbox, `${file}.test.ts`), source);
      const walked = collectFrom(sandbox);
      expect(walked.disabled.sort()).toEqual([
        'alias-skip.test.ts:1',
        'deep/skipped.test.ts:2',
        'each-only.test.ts:1',
        'each-skip.test.ts:1',
        'options-only.test.ts:1 (disabled by its options)',
        'options-skip.test.ts:1 (disabled by its options)',
        'tagged-skip.test.ts:1'
      ]);
      expect(walked.tests.has('CT17'), 'the arm inside the tagged suite was read').toBe(true);

      // And an arm that skips itself through its context, after a statement,
      // so that nothing but the body check can see it.
      writeFileSync(
        join(sandbox, 'context-skip.test.ts'),
        [
          '  // @contracts A9-C1',
          `  ${'it'}('CT23: skips itself', (ctx) => { const x = 1; ctx.skip(); expect(x).toBe(1); });`
        ].join('\n')
      );
      expect(collectFrom(sandbox).disabled).toContain(
        'context-skip.test.ts:2 (skipped from inside its body)'
      );
      rmSync(join(sandbox, 'context-skip.test.ts'));
      for (const file of Object.keys(suites)) rmSync(join(sandbox, `${file}.test.ts`));
      writeFileSync(
        join(sandbox, 'prose.test.ts'),
        [
          '  // @contracts A7-C1',
          `  ${'it'}('rejects: an empty filter', () => { expect(1).toBe(1); });`
        ].join('\n')
      );
      expect(collectFrom(sandbox).unreadable).toEqual([]);
      rmSync(join(sandbox, 'prose.test.ts'));
      writeFileSync(
        join(sandbox, 'row-named.test.ts'),
        [
          '  // @contracts A5-C1',
          `  ${'it'}('A5-C1: named after its row', () => { expect(1).toBe(1); });`
        ].join('\n')
      );
      expect(collectFrom(sandbox).unreadable).toEqual([
        'row-named.test.ts:2 — this bridge cannot read "A5-C1" as an arm id'
      ]);
      expect(collectFrom(join(sandbox, 'nothing-here')).tests.size).toBe(0);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }

    // The reverse direction over the same fabricated source.
    expect(
      backwardFaults(
        new Map([
          ['A1-C1', { route: 'public', evidence: 'test:CT1' }],
          ['A2-C1', { route: 'public', evidence: 'test:CT1' }]
        ]),
        fabricated
      )
    ).toEqual([]);
    expect(
      backwardFaults(
        new Map([
          ['A1-C1', { route: 'public', evidence: 'test:CT2' }],
          ['A2-C1', { route: 'public', evidence: 'test:CT1' }]
        ]),
        fabricated
      )
    ).toEqual(['CT1 declares A1-C1, which points at test:CT2']);
    expect(
      backwardFaults(
        new Map([
          ['A1-C1', { route: 'public', evidence: 'TBD' }],
          ['A2-C1', { route: 'public', evidence: 'test:CT1' }]
        ]),
        fabricated
      )
    ).toEqual(['CT1 declares A1-C1, which points at TBD']);
    expect(backwardFaults(new Map(), fabricated)).toEqual([
      'CT1 declares A1-C1, which is not a row',
      'CT1 declares A2-C1, which is not a row'
    ]);
  });

  it('CAT37: the comment stripper reads the language rather than a pattern', () => {
    // The id and the call are assembled, so that the sweep at the end, which
    // reads this very file, cannot find a literal one and pass on itself.
    const call = 'it';
    const id = `Z${'Z'}8`;
    const arm = `  ${call}('${id}: fabricated', () => {});`;
    const backtickRegex = 'const cell = /`([^`]+)`/g;';
    const openerRegex = "const trim = (path) => path.replace(/\\/*$/, '');";
    const quotedRegex = "const apostrophe = /don't/;";

    expect(code(`  // ${arm.trim()}`).includes(id)).toBe(false);
    expect(code([backtickRegex, `  // ${arm.trim()}`].join('\n')).includes(id)).toBe(false);
    expect(code([openerRegex, arm].join('\n')).includes(id)).toBe(true);
    expect(code(`${quotedRegex} // ${arm.trim()}`).includes(id)).toBe(false);
    expect(code(`  const shape = { kind: // ${arm.trim()}`).includes(id)).toBe(false);
    expect(
      code(`const has = () => { return /don't/.test(y); }; // ${arm.trim()}`).includes(id)
    ).toBe(false);
    expect(code(`const has = (a) => /don't/.test(a); // ${arm.trim()}`).includes(id)).toBe(false);
    expect(code(`const x = obj.in / 2; // ${arm.trim()}`).includes(id)).toBe(false);
    expect(code(['/* hidden', arm, '*/', '  const after = 1;'].join('\n')).includes(id)).toBe(
      false
    );
    expect(code(['/* hidden */', arm].join('\n')).includes(id)).toBe(true);
    expect(code(`const q = 'a\\'b'; const after = 1; // ${arm.trim()}`).includes(id)).toBe(false);
    expect(code(`const p = /\\//.test(u); // ${arm.trim()}`).includes(id)).toBe(false);
    expect(code(`const c = /[/]/.test(u); // ${arm.trim()}`).includes(id)).toBe(false);
    expect(code(['const bad = / a', arm].join('\n')).includes(id)).toBe(true);
    expect(code(`const c = /[/]/.test(u); const after = 1;`)).toContain('after');

    // Two things that must survive, or the stripper is deleting code.
    expect(code('const half = total / 2;').includes('total / 2')).toBe(true);
    expect(code("const relay = 'wss://relay.example/';").includes('wss://relay.example/')).toBe(
      true
    );
    expect(code(['const t = `a', '/* not a comment */', `b\`;`, arm].join('\n'))).toContain(
      'not a comment'
    );

    // Over the real files this bridge reads: a comment inserted at a statement
    // boundary anywhere in them is not an arm.
    for (const name of [
      'catalogue.test.ts',
      'bridge.ts',
      'sentinels/rx-nostr.test.ts',
      'sentinels/query-core.test.ts',
      'sentinels/boundary.test.ts'
    ]) {
      const lines = readFileSync(join(HERE, name), 'utf8').split('\n');
      const boundaries = lines
        .map((line, at) => (/;\s*$/.test(line) ? at + 1 : -1))
        .filter((at) => at > 0);
      expect(boundaries.length, `no statement boundaries were found in ${name}`).toBeGreaterThan(
        20
      );
      for (const part of [0, 0.25, 0.5, 0.75, 0.9]) {
        const at = boundaries[Math.floor(part * (boundaries.length - 1))] as number;
        const copy = [...lines];
        copy.splice(at, 0, `  // ${arm.trim()}`);
        expect(
          code(copy.join('\n')).includes(id),
          `a comment at ${name}:${at} reads as an arm`
        ).toBe(false);
      }
    }
  });
});
