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
 * in a consumer's file after `imports`: an assignment to each property, index
 * signature and well-known-symbol member the type checker gives the type —
 * inherited, mapped and aliased ones included — and, for an array or a tuple,
 * a `push` and an assignment to each position; recursively, to `depth` levels.
 * A value the walk cannot look inside is not passed over: an `any`, and a value
 * that can be called, are each emitted as a line that compiles, so they read as
 * writes the types let through. Each write is one line, so a diagnostic can be
 * laid against it.
 *
 * A union is refused rather than walked: a write to a member some constituents
 * lack is an error for that reason, which would read as a refusal. Walk each
 * variant instead ({@link variantsWith}). So is a symbol member the probe
 * cannot name, and a value with members past `depth`.
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
    const flags = type.getFlags();
    // **`any` is not "nothing writable".** It has no properties to enumerate,
    // so it used to end the walk as if it had been read; a write through it
    // compiles, and this one is emitted so that it does — and is reported as a
    // write the types let through. `unknown` cannot be written into without a
    // narrowing, so it does end the walk.
    if (flags & ts.TypeFlags.Any) {
      writes.push(`${expression}.anything = ${expression};`);
      return;
    }
    if (flags & ts.TypeFlags.Unknown) return;
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
    // Past `depth`, a value with anything inside it is reported rather than
    // passed over: returning would certify as read a list the walk never
    // reached. A primitive there has nothing to write into, and ended above.
    if (level > depth) throw new Error(`writesThrough: ${expression} is deeper than ${depth}`);
    if (type.isUnion()) throw new Error(`writesThrough: ${expression} is a union`);
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      writes.push(`${expression}.push(${expression}[0]!);`);
      // Every position, not the first: a tuple's positions and its rest
      // element can each have a type of their own, so `[readonly string[],
      // ...string[][]]` is readonly at 0 and mutable from 1. An array's one type
      // argument is its element, at every index.
      const elements = checker.getTypeArguments(type as ts.TypeReference);
      for (const [at, element] of elements.entries()) {
        writes.push(`${expression}[${at}] = ${expression}[${at}]!;`);
        visit(`${expression}[${at}]!`, element, level + 1);
      }
      return;
    }
    // **A value that can be called is reported, not walked.** What a call does
    // — a `Set`'s `add`, a `Date`'s setters, a closure over the event — is not
    // something a readonly modifier answers, and `Readonly<Set<string>>` still
    // has an `add` to call. So a callable value is emitted as a line that
    // compiles exactly when it is callable, which reads as a write the types
    // let through. Data has no such member.
    if (type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0)
      writes.push(`void ${expression}.call;`);
    for (const property of checker.getPropertiesOfType(type)) {
      const name = property.getName();
      // A private name (`#…`) cannot be written or called from outside its
      // class, so it is the one member a consumer has no write to attempt.
      if (name.startsWith('__#')) continue;
      let access: string;
      if (name.startsWith('__@')) {
        // A symbol-keyed member is written through the symbol, which a
        // consumer can name when it is a well-known one. One the probe cannot
        // name is not skipped: it is reported, since silence would read as
        // "nothing writable".
        const declaration = property.valueDeclaration ?? property.declarations?.[0];
        const named = declaration === undefined ? undefined : ts.getNameOfDeclaration(declaration);
        const symbol =
          named !== undefined && ts.isComputedPropertyName(named) ? named.expression.getText() : '';
        if (!/^Symbol\.\w+$/.test(symbol))
          throw new Error(`writesThrough: ${expression} has a symbol member the probe cannot name`);
        access = `${expression}[${symbol}]`;
      } else
        access = isIdentifier(name)
          ? `${expression}.${name}`
          : `${expression}[${JSON.stringify(name)}]`;
      writes.push(`${access} = ${access}!;`);
      visit(`${access}!`, checker.getNonNullableType(checker.getTypeOfSymbol(property)), level + 1);
    }
    // And a write through each index signature, under a key the type checker
    // cannot see — a dynamic key is a write a named property list never shows.
    for (const info of checker.getIndexInfosOfType(type)) {
      const key =
        info.keyType.getFlags() & ts.TypeFlags.NumberLike ? '(0 as number)' : "('k' as string)";
      writes.push(`${expression}[${key}] = ${expression}[${key}]!;`);
      visit(`${expression}[${key}]!`, checker.getNonNullableType(info.type), level + 1);
    }
  };
  visit('value', checker.getTypeAtLocation(declaration.name), 0);
  return writes;
}

/**
 * The values of `discriminant` for each variant of the union `typeText` that
 * has `property` — so each variant can be named, as
 * `Extract<typeText, { discriminant: value }>`, and walked on its own.
 */
export function variantsWith(
  imports: string,
  typeText: string,
  discriminant: string,
  property: string
): string[] {
  const { program, consumer } = programOver(`${imports}\ndeclare const value: ${typeText};\n`);
  const checker = program.getTypeChecker();
  const declaration = consumer.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((one) => ts.isIdentifier(one.name) && one.name.text === 'value');
  if (declaration === undefined) throw new Error('the probe declared no value');
  const type = checker.getTypeAtLocation(declaration.name);
  const variants = type.isUnion() ? type.types : [type];
  return variants.flatMap((variant) => {
    if (checker.getPropertyOfType(variant, property) === undefined) return [];
    const tag = checker.getPropertyOfType(variant, discriminant);
    if (tag === undefined) throw new Error(`variantsWith: a variant has no ${discriminant}`);
    const literal = checker.getTypeOfSymbol(tag);
    if (!literal.isStringLiteral())
      throw new Error(`variantsWith: ${discriminant} is not a literal`);
    return [literal.value];
  });
}
