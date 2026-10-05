/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The declarations v1 publishes, emitted through the project's own
 * configuration and read with the compiler rather than with patterns.
 *
 * Ported from the spike's `leak` suite, whose arms (`LK…`) stand on them: the
 * emit is memoised because it shells out to `tsc`, the entries are read off
 * `tsconfig.dts.json` rather than named here, and the published names are read
 * off those entries rather than kept in a list.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import ts from 'typescript';

/** One emitted declaration file, its comments stripped. */
export interface Emitted {
  readonly name: string;
  readonly text: string;
}

const ROOT = resolve(process.cwd());
let out: string | undefined;
let emitted: Emitted[] | undefined;

/**
 * Every declaration file the published entry compiles, memoised.
 *
 * Several arms read it, and each emit is a `tsc` run of a few seconds; the
 * output is a pure function of the tree, which does not move inside one run.
 */
export function emitDeclarations(): Emitted[] {
  emitted ??= emitDeclarationsOnce();
  return emitted;
}

/** Remove what {@link emitDeclarations} wrote; for an `afterAll`. */
export function removeDeclarations(): void {
  if (out !== undefined) rmSync(out, { recursive: true, force: true });
  out = undefined;
  emitted = undefined;
}

function emitDeclarationsOnce(): Emitted[] {
  out = mkdtempSync(join(tmpdir(), 'nosvelte-dts-'));
  // Through the project's own configuration, not a set of loose flags: the
  // runes are ambient declarations the generated config pulls in, and a bare
  // invocation cannot see them.
  execFileSync('npx', ['tsc', '-p', 'tsconfig.dts.json', '--outDir', out], {
    cwd: ROOT,
    stdio: 'pipe'
  });
  const files: Emitted[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.d.ts'))
        files.push({ name: entry.name, text: readFileSync(path, 'utf8') });
    }
  };
  walk(out);
  // The emitted declarations keep the documentation, and the question is what
  // the types reach, not what the sentences mention.
  return files.map(({ name, text }) => ({
    name,
    text: text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
  }));
}

/**
 * The declarations of every module the package publishes as an entry, read off
 * `tsconfig.dts.json`, which is what decides whose declarations are emitted at
 * all. A declared entry that emitted nothing throws rather than being skipped.
 */
export function publishedEntries(sources: readonly Emitted[]): Emitted[] {
  const config = JSON.parse(readFileSync(resolve(ROOT, 'tsconfig.dts.json'), 'utf8')) as {
    include?: readonly string[];
  };
  const modules = (config.include ?? []).filter((path) => path.startsWith('src/'));
  if (modules.length === 0) throw new Error('the emit configuration names no published entry');
  return modules.map((path) => {
    const name = `${(path.split('/').pop() as string).replace(/\.ts$/, '')}.d.ts`;
    const found = sources.find((source) => source.name === name);
    if (found === undefined) throw new Error(`the published entry ${path} emitted no ${name}`);
    return found;
  });
}

/** What the entries publish, read off them rather than listed here. */
export function publishedNames(sources: readonly Emitted[]): string[] {
  const names = new Set<string>();
  for (const { text: entry } of publishedEntries(sources)) {
    for (const match of entry.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
      for (const part of (match[1] as string).split(',')) {
        const name = part
          .trim()
          .split(/\s+as\s+/)
          .pop()
          ?.trim();
        if (name !== undefined && name !== '') names.add(name);
      }
    }
    for (const match of entry.matchAll(/export\s+(?:declare\s+)?(?:interface|type|class)\s+(\w+)/g))
      names.add(match[1] as string);
  }
  return [...names];
}

/** What {@link mutableMembers} found: the members a consumer could write, and the names it opened. */
export interface MutableReport {
  readonly mutable: readonly string[];
  readonly opened: ReadonlySet<string>;
}

/**
 * Every member of a published type that a consumer could write through, to the
 * depth they can reach — walked over the syntax of the emitted declarations,
 * never a pattern over their text. A pattern read only the first variant of a
 * union, could not see an index signature or a method's return type, left
 * published names unopened, and attributed one type's members to another.
 *
 * `Readonly<…>` and `ReadonlyArray<…>` make what is inside them readonly, so a
 * member with no modifier under one is not a finding — and an array under one
 * still is, which is why the flag is carried rather than the walk cut.
 */
export function mutableMembers(
  sources: readonly Emitted[],
  published: ReadonlySet<string>
): MutableReport {
  const mutable: string[] = [];
  const opened = new Set<string>();

  const isReadonly = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node)
      ? (ts.getModifiers(node) ?? []).some((mod) => mod.kind === ts.SyntaxKind.ReadonlyKeyword)
      : false;

  const walkType = (node: ts.TypeNode | undefined, path: string, frozen: boolean): void => {
    if (node === undefined) return;
    if (ts.isParenthesizedTypeNode(node)) return walkType(node.type, path, frozen);
    if (ts.isArrayTypeNode(node)) {
      // The elements of a readonly array are not themselves readonly:
      // `readonly (readonly string[])[]` says so twice, and has to.
      if (!frozen) mutable.push(`${path} is a mutable array`);
      return walkType(node.elementType, `${path}[]`, false);
    }
    if (ts.isTypeOperatorNode(node))
      return walkType(node.type, path, frozen || node.operator === ts.SyntaxKind.ReadonlyKeyword);
    if (ts.isUnionTypeNode(node) || ts.isIntersectionTypeNode(node)) {
      for (const member of node.types) walkType(member, path, frozen);
      return;
    }
    if (ts.isTupleTypeNode(node)) {
      for (const element of node.elements) walkType(element, path, frozen);
      return;
    }
    if (ts.isTypeLiteralNode(node)) return walkMembers(node.members, path, frozen);
    if (ts.isFunctionTypeNode(node)) return walkType(node.type, `${path}()`, frozen);
    if (ts.isTypeReferenceNode(node)) {
      const name = ts.isIdentifier(node.typeName) ? node.typeName.text : node.typeName.right.text;
      const wraps = name === 'Readonly' || name === 'ReadonlyArray';
      for (const argument of node.typeArguments ?? []) walkType(argument, path, frozen || wraps);
      // A named type that is itself published is opened where it is declared.
      return;
    }
  };

  function walkMembers(members: readonly ts.TypeElement[], path: string, frozen: boolean): void {
    for (const member of members) {
      const name =
        member.name !== undefined && ts.isIdentifier(member.name) ? member.name.text : '[index]';
      if (ts.isPropertySignature(member)) {
        if (!frozen && !isReadonly(member)) mutable.push(`${path}.${name} is not readonly`);
        walkType(member.type, `${path}.${name}`, frozen);
      } else if (ts.isIndexSignatureDeclaration(member)) {
        if (!frozen && !isReadonly(member)) mutable.push(`${path}[index] is not readonly`);
        walkType(member.type, `${path}[index]`, frozen);
      } else if (ts.isMethodSignature(member)) {
        // The signature cannot be written through; what it hands back can be.
        walkType(member.type, `${path}.${name}()`, frozen);
      }
    }
  }

  for (const source of sources) {
    const file = ts.createSourceFile(source.name, source.text, ts.ScriptTarget.Latest, true);
    for (const statement of file.statements) {
      const named =
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isClassDeclaration(statement)
          ? statement.name?.text
          : undefined;
      if (named === undefined || !published.has(named)) continue;
      opened.add(named);
      if (ts.isInterfaceDeclaration(statement)) walkMembers(statement.members, named, false);
      else if (ts.isTypeAliasDeclaration(statement)) walkType(statement.type, named, false);
      else if (ts.isClassDeclaration(statement)) {
        for (const member of statement.members) {
          if (!ts.isPropertyDeclaration(member)) continue;
          const name = ts.isIdentifier(member.name) ? member.name.text : '[computed]';
          if (!isReadonly(member)) mutable.push(`${named}.${name} is not readonly`);
          walkType(member.type, `${named}.${name}`, false);
        }
      }
    }
  }
  return { mutable, opened };
}

/** A diagnostic the compiler reported on a consumer's file, by line. */
export interface ConsumerDiagnostic {
  /** The 1-based line of the consumer's file the diagnostic is on. */
  readonly line: number;
  readonly code: number;
  readonly message: string;
}

/**
 * What the compiler says about `source` written as a consumer's file inside the
 * project, under the project's own configuration — so `$lib` resolves and every
 * strictness flag applies. The file never touches the disk.
 *
 * A compile half of a contract cannot be read by a run-time arm, and an
 * `@ts-expect-error` inside a test is read only by `npm run check`, not by the
 * arm itself; this lets an arm hold its own compile half.
 */
export function consumerDiagnostics(source: string): ConsumerDiagnostic[] {
  const file = resolve(ROOT, 'src/tests/contracts/engine/__consumer__.ts');
  const read = ts.readConfigFile(resolve(ROOT, 'tsconfig.json'), (path) => ts.sys.readFile(path));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
  const options = { ...parsed.options, noEmit: true };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (name, language, ...rest) =>
    resolve(name) === file
      ? ts.createSourceFile(name, source, language, true, ts.ScriptKind.TS)
      : getSourceFile(name, language, ...rest);
  host.fileExists = (name) => resolve(name) === file || fileExists(name);
  const program = ts.createProgram([file], options, host);
  const consumer = program.getSourceFile(file);
  if (consumer === undefined) throw new Error('the consumer file was not compiled');
  return ts.getPreEmitDiagnostics(program, consumer).map((diagnostic) => ({
    line:
      diagnostic.file !== undefined && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
        : 0,
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  }));
}
