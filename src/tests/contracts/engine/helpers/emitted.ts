/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The published declarations, emitted in memory, and a consumer compiled
 * against them and nothing else.
 *
 * **What a consumer compiles against is the emitted `.d.ts`, not the source.**
 * The other compile probes in this suite resolve `$lib` to the library's own
 * `.ts` files, which is the right instrument for a type the source declares and
 * the wrong one for what a published declaration says: emit can widen an
 * inferred type, drop a `readonly` the source states through a mapped type, or
 * name a type the entry does not export. So the entry and the outlets it
 * renders are emitted here with the project's own compiler options, and a
 * consumer program is built over that output with the library's source
 * withheld — a module it resolves to a file under `src/` is a failure of the
 * instrument rather than a fallback, read off the program after it is built.
 *
 * This is the declaration contract and not the package build: v1 is not yet
 * shipped (`src/lib/v1/index.ts`), so `svelte-package`'s output is not what a
 * consumer installs today, and nothing here claims it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

const ROOT = resolve(process.cwd());
const LIBRARY = resolve(ROOT, 'src/lib/v1');
const SOURCE = resolve(ROOT, 'src');

/** Where the emitted declarations live: a directory nothing on disk is in. */
export const EMITTED = resolve(ROOT, '__nosvelte_emitted__');
const CONSUMER = join(EMITTED, '__consumer__.ts');

/**
 * The modules emitted: the published entry, the outlets its components render,
 * the hook the entry's index adds beside it — `useReq`, whose return type is a
 * route to every failure surface — and the index itself, with every component
 * it re-exports.
 */
const ROOTS = ['public-entry.ts', 'components/outlets.ts', 'req.svelte.ts', 'index.ts'];

/**
 * `svelte2tsx`, resolved through `@sveltejs/package` — the copy the package
 * build emits a component's declaration with, and not a dependency of this
 * project's own.
 */
const fromPackage = createRequire(
  createRequire(join(ROOT, 'package.json')).resolve('@sveltejs/package/package.json')
);
const { svelte2tsx } = fromPackage('svelte2tsx') as typeof import('svelte2tsx');

/**
 * A component, as the TypeScript `svelte-package` hands the compiler for it:
 * `svelte2tsx`'s declaration mode, read where the compiler looks for
 * `./X.svelte` — at `X.svelte.ts` — for a component of the library that has
 * no module of that name. **A component is a value too**, and what it hands a
 * consumer beyond its props — an event's detail, an export reached through
 * `bind:this` — is in its declaration and nowhere in the outlet types: a
 * dispatched event carrying the snapshot class passed every check that read
 * the props, measured.
 */
function componentAt(path: string): string | undefined {
  if (!path.startsWith(`${LIBRARY}/`) || !path.endsWith('.svelte.ts')) return undefined;
  const component = path.slice(0, -'.ts'.length);
  if (existsSync(path) || !existsSync(component)) return undefined;
  // The options `emitDts` passes with the v4 shims, `noSvelteComponentTyped`
  // among them — which the published typings leave out, so the bag is a
  // variable rather than a literal the compiler checks for excess members.
  const asPackaged = {
    filename: component,
    isTsFile: true,
    mode: 'dts' as const,
    noSvelteComponentTyped: true
  };
  return svelte2tsx(readFileSync(component, 'utf8'), asPackaged).code;
}

/** The helpers `svelte2tsx`'s output is written against. */
const SHIMS = fromPackage.resolve('svelte2tsx/svelte-shims-v4.d.ts');

/**
 * The one diagnostic `svelte2tsx`'s declaration mode is known to leave in what
 * it writes — its own first statement, `import { SvelteComponent } from
 * "svelte"` at the very start of the file, which it does not use — and
 * nothing else of a component's is let through. Read by where it stands, not
 * by what it says: a component's own unused `SvelteComponent` says the same
 * thing and was let through by a filter on the message, measured.
 */
const generatedOnly = (one: ts.Diagnostic): boolean => {
  if (one.code !== 6133 || one.file === undefined || one.start === undefined) return false;
  if (componentAt(resolve(one.file.fileName)) === undefined) return false;
  const [first] = one.file.statements;
  if (first === undefined || first.getStart() !== 0 || !ts.isImportDeclaration(first)) return false;
  const bindings = first.importClause?.namedBindings;
  const [only] = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : [];
  return (
    ts.isStringLiteral(first.moduleSpecifier) &&
    first.moduleSpecifier.text === 'svelte' &&
    first.importClause?.name === undefined &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length === 1 &&
    only !== undefined &&
    only.propertyName === undefined &&
    only.name.text === 'SvelteComponent' &&
    one.start < first.getEnd()
  );
};

/**
 * Components that share a name with a module beside them — `X.svelte` and
 * `X.svelte.ts` — among `paths`. The compiler looks for `./X.svelte` at
 * `X.svelte.ts`, so for such a pair the declaration emitted under the
 * component's name is the module's, and a component exporting a guard beside
 * a rune module of its name passed the walk: measured. Refused rather than
 * resolved, since `./X.svelte.js` names the module at the same path.
 */
export const shadowedOf = (paths: readonly string[]): string[] =>
  paths.filter((path) => path.endsWith('.svelte') && paths.includes(`${path}.ts`));

/** Every component of the library, and every module, by path. */
export const libraryFiles = (): string[] =>
  ts.sys
    .readDirectory(LIBRARY, ['.svelte', '.ts'], undefined, undefined)
    .map((one) => resolve(one));

function projectOptions(): ts.CompilerOptions {
  const read = ts.readConfigFile(resolve(ROOT, 'tsconfig.json'), (path) => ts.sys.readFile(path));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT).options;
}

let emitted: ReadonlyMap<string, string> | undefined;

/**
 * The declarations, by path under {@link EMITTED}: emitted once per run with
 * the project's options, and refused if the emit reports anything.
 */
export function emittedDeclarations(): ReadonlyMap<string, string> {
  if (emitted !== undefined) return emitted;
  const options: ts.CompilerOptions = {
    ...projectOptions(),
    noEmit: false,
    declaration: true,
    emitDeclarationOnly: true,
    declarationMap: false,
    sourceMap: false,
    outDir: EMITTED,
    rootDir: LIBRARY
  };
  const ambient = ['.svelte-kit/ambient.d.ts', '.svelte-kit/non-ambient.d.ts']
    .map((name) => resolve(ROOT, name))
    .filter((name) => ts.sys.fileExists(name));
  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (name) => fileExists(name) || componentAt(resolve(name)) !== undefined;
  host.readFile = (name) => componentAt(resolve(name)) ?? readFile(name);
  host.getSourceFile = (name, language) => {
    const component = componentAt(resolve(name));
    return component === undefined
      ? getSourceFile(name, language)
      : ts.createSourceFile(name, component, language, true, ts.ScriptKind.TS);
  };
  const out = new Map<string, string>();
  host.writeFile = (name, text) => out.set(resolve(name), text);
  const program = ts.createProgram(
    [...ROOTS.map((name) => join(LIBRARY, name)), SHIMS, ...ambient],
    options,
    host
  );
  const result = program.emit(undefined, undefined, undefined, true);
  const reported = [...ts.getPreEmitDiagnostics(program), ...result.diagnostics]
    .filter((one) => !generatedOnly(one))
    .map((one) => ts.flattenDiagnosticMessageText(one.messageText, '\n'));
  if (result.emitSkipped || reported.length > 0)
    throw new Error(
      `nosvelte test: the declarations did not emit cleanly:\n${reported.join('\n')}`
    );
  for (const name of ROOTS) {
    const declaration = join(EMITTED, name.replace(/\.ts$/, '.d.ts'));
    if (!out.has(declaration))
      throw new Error(`nosvelte test: ${name} emitted no declaration at ${declaration}`);
  }
  emitted = out;
  return out;
}

/** A diagnostic, where it is, and the source text it is about. */
export interface EmittedDiagnostic {
  readonly line: number;
  readonly code: number;
  readonly text: string;
  readonly message: string;
}

/** A consumer, compiled against the emitted declarations alone. */
export interface Compiled {
  readonly program: ts.Program;
  readonly checker: ts.TypeChecker;
  readonly consumer: ts.SourceFile;
  readonly diagnostics: readonly EmittedDiagnostic[];
  /** Files the program read from the repository's source: what the withholding refused, by name. */
  readonly reachedSource: readonly string[];
}

/** A type a consumer reaches from what a module exports, and the way there. */
export interface Reached {
  readonly path: string;
  readonly type: ts.Type;
}

/** Types with nothing inside them to reach. */
const LEAVES =
  ts.TypeFlags.Any |
  ts.TypeFlags.Unknown |
  ts.TypeFlags.Never |
  ts.TypeFlags.Void |
  ts.TypeFlags.Undefined |
  ts.TypeFlags.Null |
  ts.TypeFlags.String |
  ts.TypeFlags.Number |
  ts.TypeFlags.Boolean |
  ts.TypeFlags.BigInt |
  ts.TypeFlags.ESSymbol |
  ts.TypeFlags.StringLiteral |
  ts.TypeFlags.NumberLiteral |
  ts.TypeFlags.BooleanLiteral |
  ts.TypeFlags.BigIntLiteral |
  ts.TypeFlags.EnumLiteral |
  ts.TypeFlags.UniqueESSymbol |
  ts.TypeFlags.NonPrimitive |
  ts.TypeFlags.TemplateLiteral |
  ts.TypeFlags.StringMapping;

/**
 * Every type a consumer can reach from what `files` export, in `compiled`'s
 * program: each export's value and its type, and from each type its union
 * and intersection members, its type arguments, the properties declared in
 * the emitted declarations or the consumer (a platform's `Error.isError` is
 * not this library giving anything out), the parameters and returns of its
 * call and construct signatures, its index signatures, and a type
 * parameter's constraint and default. `names`, where given, picks the
 * exports to start from, so a control's lookalikes are walked one at a time.
 *
 * **What an export hands out is not only what it is.** A guard held as a
 * member of a static object of a published class, or a snapshot constructor a
 * method resolves to, is given out by an export whose own type has neither —
 * and the scan that read the export and its direct members passed both:
 * measured. A type this cannot open — a deferred conditional with no
 * constraint — is in `unread` rather than skipped.
 */
export function reachableFrom(
  compiled: Compiled,
  files: readonly ts.SourceFile[],
  names?: readonly string[]
): { reached: Reached[]; unread: string[] } {
  const { checker } = compiled;
  const ours = (symbol: ts.Symbol): boolean =>
    (symbol.declarations ?? []).some((declaration) =>
      resolve(declaration.getSourceFile().fileName).startsWith(`${EMITTED}/`)
    );
  const queue: Reached[] = [];
  const unread: string[] = [];
  for (const file of files) {
    const module = checker.getSymbolAtLocation(file);
    if (module === undefined) {
      unread.push(`${relative(EMITTED, file.fileName)}: not a module`);
      continue;
    }
    for (const exported of checker.getExportsOfModule(module)) {
      if (names !== undefined && !names.includes(exported.getName())) continue;
      const resolved =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const at = `${relative(EMITTED, file.fileName)}:${exported.getName()}`;
      if (resolved.flags & ts.SymbolFlags.Value)
        queue.push({ path: at, type: checker.getTypeOfSymbol(resolved) });
      if (resolved.flags & ts.SymbolFlags.Type)
        queue.push({ path: `${at} (type)`, type: checker.getDeclaredTypeOfSymbol(resolved) });
    }
  }
  const seen = new Set<ts.Type>();
  const reached: Reached[] = [];
  while (queue.length > 0) {
    const { path, type } = queue.shift() as Reached;
    if (seen.has(type)) continue;
    seen.add(type);
    reached.push({ path, type });
    if (seen.size > 50_000) throw new Error(`nosvelte test: the walk did not close, at ${path}`);
    const next = (label: string, inner: ts.Type): void => {
      queue.push({ path: `${path}${label}`, type: inner });
    };
    if (type.flags & LEAVES) continue;
    if (type.isUnionOrIntersection()) {
      type.types.forEach((member, at) => next(`|${String(at)}`, member));
      continue;
    }
    // A type parameter is what its constraint and its default are: a
    // signature `<T = X>(): T` hands a caller exactly `X`, and the walk that
    // read only the constraint passed it: measured.
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(type);
      if (constraint !== undefined && constraint !== type) next('<constraint>', constraint);
      const fallback = checker.getDefaultFromTypeParameter(type);
      if (fallback !== undefined) next('<default>', fallback);
      continue;
    }
    if (type.flags & ts.TypeFlags.Instantiable) {
      const constraint = checker.getBaseConstraintOfType(type);
      if (constraint !== undefined && constraint !== type) next('<constraint>', constraint);
      else unread.push(`${path}: ${checker.typeToString(type)}, deferred and unconstrained`);
      continue;
    }
    if (!(type.flags & ts.TypeFlags.Object)) {
      unread.push(`${path}: ${checker.typeToString(type)}, a kind the walk does not open`);
      continue;
    }
    for (const parameter of (type as ts.InterfaceType).typeParameters ?? [])
      next(`<${parameter.symbol.getName()}>`, parameter);
    if ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)
      for (const argument of checker.getTypeArguments(type as ts.TypeReference))
        next('<>', argument);
    for (const argument of type.aliasTypeArguments ?? []) next('<alias>', argument);
    for (const property of checker.getPropertiesOfType(type))
      if (ours(property)) next(`.${property.getName()}`, checker.getTypeOfSymbol(property));
    for (const [kind, signatures] of [
      ['()', type.getCallSignatures()],
      ['new()', type.getConstructSignatures()]
    ] as const)
      for (const signature of signatures) {
        // A signature's own type parameters, read for their constraints and
        // defaults even where the return hides them in a conditional — which
        // `<T = X>(): T extends … ? T : never` did, measured.
        for (const parameter of signature.getTypeParameters() ?? [])
          next(`<${parameter.symbol.getName()}>`, parameter);
        // And its receiver, which is not among its parameters: a consumer
        // reads it back with `ThisParameterType`, measured.
        if (signature.thisParameter !== undefined)
          next('(this)', checker.getTypeOfSymbol(signature.thisParameter));
        next(kind, checker.getReturnTypeOfSignature(signature));
        for (const parameter of signature.getParameters())
          next(`(${parameter.getName()})`, checker.getTypeOfSymbol(parameter));
      }
    for (const info of checker.getIndexInfosOfType(type)) next('[]', info.type);
  }
  return { reached, unread };
}

const held = new Map<string, ts.SourceFile>();

/**
 * Compile `source` as a module standing beside the emitted entry — it imports
 * `./public-entry.js` and `./components/outlets.js` — with the project's
 * options and none of its path aliases. The library's source is withheld: a
 * file under `src/` is neither found nor read, and every attempt is reported.
 */
export function againstEmitted(source: string): Compiled {
  const declarations = emittedDeclarations();
  const base = projectOptions();
  const options: ts.CompilerOptions = { ...base, noEmit: true, rootDir: EMITTED };
  delete options.paths;
  delete options.baseUrl;
  delete options.rootDirs;
  const reached = new Set<string>();
  const withheld = (name: string): boolean => {
    const path = resolve(name);
    if (path === SOURCE || path.startsWith(`${SOURCE}/`)) {
      reached.add(relative(ROOT, path));
      return true;
    }
    return false;
  };
  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists.bind(host);
  const directoryExists = host.directoryExists?.bind(host);
  host.fileExists = (name) => {
    const path = resolve(name);
    if (path === CONSUMER || declarations.has(path)) return true;
    if (path.startsWith(`${EMITTED}/`)) return false;
    if (withheld(path)) return false;
    return fileExists(name);
  };
  host.directoryExists = (name) => {
    const path = resolve(name);
    if (path === EMITTED || path.startsWith(`${EMITTED}/`))
      return [...declarations.keys()].some((one) => one.startsWith(`${path}/`));
    if (withheld(path)) return false;
    return directoryExists === undefined ? true : directoryExists(name);
  };
  host.readFile = (name) => {
    const path = resolve(name);
    if (path === CONSUMER) return source;
    const declared = declarations.get(path);
    if (declared !== undefined) return declared;
    if (withheld(path)) return undefined;
    return ts.sys.readFile(name);
  };
  host.getSourceFile = (name, language) => {
    const path = resolve(name);
    if (path === CONSUMER)
      return ts.createSourceFile(name, source, language, true, ts.ScriptKind.TS);
    const declared = declarations.get(path);
    if (declared !== undefined) return ts.createSourceFile(name, declared, language, true);
    if (withheld(path)) return undefined;
    const kept = held.get(path);
    if (kept !== undefined) return kept;
    const text = ts.sys.readFile(name);
    if (text === undefined) return undefined;
    const file = ts.createSourceFile(name, text, language);
    held.set(path, file);
    return file;
  };
  host.getCurrentDirectory = () => EMITTED;
  const program = ts.createProgram([CONSUMER], options, host);
  const consumer = program.getSourceFile(CONSUMER);
  if (consumer === undefined) throw new Error('nosvelte test: the consumer was not compiled');
  for (const file of program.getSourceFiles()) withheld(file.fileName);
  const diagnostics = ts.getPreEmitDiagnostics(program, consumer).map((one) => {
    const at = one.start ?? 0;
    return {
      line: one.file === undefined ? 0 : one.file.getLineAndCharacterOfPosition(at).line + 1,
      code: one.code,
      text: one.file === undefined ? '' : one.file.text.slice(at, at + (one.length ?? 0)),
      message: ts.flattenDiagnosticMessageText(one.messageText, '\n')
    };
  });
  return {
    program,
    checker: program.getTypeChecker(),
    consumer,
    diagnostics,
    reachedSource: [...reached].sort()
  };
}

/** The emitted declaration of one module, by its path in the library. */
export function emittedOf(module: string): string {
  const text = emittedDeclarations().get(join(EMITTED, module.replace(/\.ts$/, '.d.ts')));
  if (text === undefined) throw new Error(`nosvelte test: no declaration emitted for ${module}`);
  return text;
}

/** Where a module of the library was emitted to, relative to {@link EMITTED}. */
export const emittedPathOf = (module: string): string =>
  relative(
    EMITTED,
    join(EMITTED, dirname(module), module.replace(/^.*\//, '').replace(/\.ts$/, '.d.ts'))
  );
