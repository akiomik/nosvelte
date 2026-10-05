/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * The compiler, asked about a consumer's file.
 *
 * A compile half of a contract cannot be read by a run-time arm, and an
 * `@ts-expect-error` inside a test is read only by `npm run check`, not by the
 * arm itself. These let an arm hold its own compile half: what the compiler
 * says about a file a consumer would write, and every write a consumer could
 * attempt through a value — enumerated by the type checker, so an inherited
 * member, an alias to a foreign type or a mapped type is asked about like any
 * other, rather than read off the syntax of one declaration.
 */
import { resolve } from 'node:path';

import ts from 'typescript';

const ROOT = resolve(process.cwd());
const CONSUMER = resolve(ROOT, 'src/tests/contracts/engine/__consumer__.ts');

/** A diagnostic the compiler reported on a consumer's file, by line. */
export interface ConsumerDiagnostic {
  /** The 1-based line of the consumer's file the diagnostic is on. */
  readonly line: number;
  readonly code: number;
  readonly message: string;
}

/**
 * A program over `source` written as a consumer's file inside the project,
 * under the project's own configuration — so `$lib` resolves and every
 * strictness flag applies. The file never touches the disk.
 */
function programOver(source: string): { program: ts.Program; consumer: ts.SourceFile } {
  const read = ts.readConfigFile(resolve(ROOT, 'tsconfig.json'), (path) => ts.sys.readFile(path));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
  const options = { ...parsed.options, noEmit: true };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  host.getSourceFile = (name, language, ...rest) =>
    resolve(name) === CONSUMER
      ? ts.createSourceFile(name, source, language, true, ts.ScriptKind.TS)
      : getSourceFile(name, language, ...rest);
  host.fileExists = (name) => resolve(name) === CONSUMER || fileExists(name);
  const program = ts.createProgram([CONSUMER], options, host);
  const consumer = program.getSourceFile(CONSUMER);
  if (consumer === undefined) throw new Error('the consumer file was not compiled');
  return { program, consumer };
}

/** What the compiler says about `source` as a consumer's file. */
export function consumerDiagnostics(source: string): ConsumerDiagnostic[] {
  const { program, consumer } = programOver(source);
  return ts.getPreEmitDiagnostics(program, consumer).map((diagnostic) => ({
    line:
      diagnostic.file !== undefined && diagnostic.start !== undefined
        ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line + 1
        : 0,
    code: diagnostic.code,
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  }));
}

/**
 * The diagnostics that mean "this cannot be written": a read-only property
 * (TS2540), an index signature that only permits reading (TS2542), and a
 * mutating method a read-only array does not have (TS2339). Any other
 * diagnostic on a write — a value possibly undefined, a type mismatch — is not
 * a refusal, and is reported as one rather than counted.
 */
export const REFUSES_A_WRITE: ReadonlySet<number> = new Set([2540, 2542, 2339]);

/**
 * Every write a consumer could attempt through a value of `typeText`, resolved
 * in a consumer's file after `imports`: an assignment to each property the type
 * checker gives the type — inherited, mapped and aliased ones included — and,
 * for an array, a `push` and an assignment to an element; recursively, to
 * `depth` levels. Each write is one line, so a diagnostic can be laid against
 * it.
 *
 * A union is refused rather than walked: a write to a member some constituents
 * lack is an error for that reason, which would read as a refusal.
 */
export function writesThrough(imports: string, typeText: string, depth = 4): string[] {
  const { program, consumer } = programOver(`${imports}\ndeclare const value: ${typeText};\n`);
  const checker = program.getTypeChecker();
  const declaration = consumer.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((one) => ts.isIdentifier(one.name) && one.name.text === 'value');
  if (declaration === undefined) throw new Error('the probe declared no value');
  const writes: string[] = [];
  const isIdentifier = (name: string): boolean => /^[A-Za-z_$][\w$]*$/.test(name);

  const visit = (expression: string, type: ts.Type, level: number): void => {
    if (level > depth) return;
    const flags = type.getFlags();
    if (
      flags &
      (ts.TypeFlags.StringLike |
        ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike |
        ts.TypeFlags.BigIntLike |
        ts.TypeFlags.ESSymbolLike |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Null |
        ts.TypeFlags.Void)
    )
      return;
    if (type.isUnion()) throw new Error(`writesThrough: ${expression} is a union`);
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      writes.push(`${expression}.push(${expression}[0]!);`);
      writes.push(`${expression}[0] = ${expression}[0]!;`);
      const element = checker.getTypeArguments(type as ts.TypeReference)[0];
      if (element !== undefined) visit(`${expression}[0]!`, element, level + 1);
      return;
    }
    for (const property of checker.getPropertiesOfType(type)) {
      const name = property.getName();
      // A symbol-keyed member — the ownership brand — is not reachable by name.
      if (name.startsWith('__@')) continue;
      const access = isIdentifier(name)
        ? `${expression}.${name}`
        : `${expression}[${JSON.stringify(name)}]`;
      writes.push(`${access} = ${access}!;`);
      visit(`${access}!`, checker.getNonNullableType(checker.getTypeOfSymbol(property)), level + 1);
    }
  };
  visit('value', checker.getTypeAtLocation(declaration.name), 0);
  return writes;
}
