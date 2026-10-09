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
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';

const ROOT = resolve(process.cwd());
const LIBRARY = resolve(ROOT, 'src/lib/v1');
const SOURCE = resolve(ROOT, 'src');

/** Where the emitted declarations live: a directory nothing on disk is in. */
export const EMITTED = resolve(ROOT, '__nosvelte_emitted__');
const CONSUMER = join(EMITTED, '__consumer__.ts');

/** The modules emitted: the published entry and the outlets its components render. */
const ROOTS = ['public-entry.ts', 'components/outlets.ts'];

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
  const out = new Map<string, string>();
  host.writeFile = (name, text) => out.set(resolve(name), text);
  const program = ts.createProgram(
    [...ROOTS.map((name) => join(LIBRARY, name)), ...ambient],
    options,
    host
  );
  const result = program.emit(undefined, undefined, undefined, true);
  const reported = [...ts.getPreEmitDiagnostics(program), ...result.diagnostics].map((one) =>
    ts.flattenDiagnosticMessageText(one.messageText, '\n')
  );
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
