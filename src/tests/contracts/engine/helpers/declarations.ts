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
 * The project's compiler options, read for every program: about 7 ms, and a
 * configuration edited while a process lives is read as edited.
 */
function optionsOfProject(): ts.CompilerOptions {
  const read = ts.readConfigFile(resolve(ROOT, 'tsconfig.json'), (path) => ts.sys.readFile(path));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, ROOT);
  return { ...parsed.options, noEmit: true };
}

/**
 * **Every file a program reads but the consumer's, parsed once while it is
 * unchanged.** A program is built per question — an arm asks dozens — and
 * each used to parse the same few hundred files again: the default library,
 * the dependencies' declarations and this library's source. Measured on
 * `PB13`, that was 30 s of its 67: 85 programs at about 490 files each.
 *
 * A parsed file is shared between programs the way the language service
 * shares one, and only for the text it was parsed from: each program reads
 * every file it needs and compares, so an edit is parsed again whatever its
 * modification time says — the reading, decoding and comparing are paid every
 * time, the parsing only on a change. **What is held is what the last
 * {@link HELD_FOR} programs read**: a file none of them asked for is dropped,
 * and so is one a program could not read, so the store is bounded by the files
 * of a few programs — and an arm that alternates between questions with
 * different imports does not parse either side's files again each time. A
 * change of the compiler options, which decide how a file is parsed and bound,
 * empties it. The consumer's file is the question, and is never held.
 */
export const HELD_FOR = 32;
let held = { options: '', files: new Map<string, { file: ts.SourceFile; asked: number }>() };
let programs = 0;
const keyOf = (name: string, language: ts.ScriptTarget | ts.CreateSourceFileOptions): string =>
  typeof language === 'object'
    ? `${name}\0${language.languageVersion}\0${String(language.impliedNodeFormat)}\0${String(language.jsDocParsingMode)}`
    : `${name}\0${language}`;

/**
 * Where the probe reads a project file: the platform's reader, which an arm may
 * stand in for — to make a read fail as no file permission can for every user.
 */
export const probeReader = {
  read: (name: string): string | undefined => ts.sys.readFile(name)
};

/** How many project files the probe has parsed in this process, and how many it holds. */
let parsed = 0;
export const probeParses = (): { parsed: number; held: number } => ({
  parsed,
  held: held.files.size
});

/**
 * A program over `source` written as a consumer's file inside the project,
 * under the project's own configuration — so `$lib` resolves and every
 * strictness flag applies. The file never touches the disk.
 */
function programOver(source: string): { program: ts.Program; consumer: ts.SourceFile } {
  const options = optionsOfProject();
  const signature = JSON.stringify(options);
  if (signature !== held.options) held = { options: signature, files: new Map() };
  const files = held.files;
  const now = (programs += 1);
  const host = ts.createCompilerHost(options);
  const fileExists = host.fileExists.bind(host);
  host.readFile = (name) => (resolve(name) === CONSUMER ? source : probeReader.read(name));
  host.getSourceFile = (name, language, _onError, fresh) => {
    if (resolve(name) === CONSUMER)
      return ts.createSourceFile(name, source, language, true, ts.ScriptKind.TS);
    const key = keyOf(name, language);
    // Read once, and parsed from what was read: what the host's own
    // `getSourceFile` would do, without its second read.
    const text = probeReader.read(name);
    if (text === undefined) {
      files.delete(key);
      return undefined;
    }
    const kept = files.get(key);
    if (fresh !== true && kept?.file.text === text) {
      kept.asked = now;
      return kept.file;
    }
    const file = ts.createSourceFile(name, text, language);
    parsed += 1;
    files.set(key, { file, asked: now });
    return file;
  };
  host.fileExists = (name) => resolve(name) === CONSUMER || fileExists(name);
  const program = ts.createProgram([CONSUMER], options, host);
  for (const [key, one] of files) if (now - one.asked >= HELD_FOR) files.delete(key);
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
 * cannot name, a value with members past `depth`, an `unknown`, and an object
 * type with nothing to enumerate.
 *
 * What it does not judge is whether a write was refused: that is
 * {@link judgeWrites}, which asks the compiler about the expressions the walk
 * wrote rather than the types it derived them from.
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
  // The type a `!` leaves — except that `NonNullable<unknown>` is `{}`, which
  // would hide an `unknown` behind an empty object.
  const present = (type: ts.Type): ts.Type =>
    type.getFlags() & ts.TypeFlags.Unknown ? type : checker.getNonNullableType(type);

  // **The standard library's members are its own.** A list's members, a
  // `Set`'s, are TypeScript's declarations: not the event's data, and shared
  // by every value of the type, so the walk writes to their slots — which
  // must be refused — and does not walk into them. Of those that can be
  // called, a standard read-only array operation is admitted, and only that:
  // a member every declaration of which is the default library's
  // `ReadonlyArray`. `Array`'s `push` is reported, a `Set`'s `add` is, and so
  // is a member, or an overload of one, that anything else declares on the
  // global array types — its declaration is not the default library's.
  const library = (property: ts.Symbol): readonly ts.Declaration[] | undefined => {
    const declarations = property.getDeclarations() ?? [];
    return declarations.length > 0 &&
      declarations.every((one) => program.isSourceFileDefaultLibrary(one.getSourceFile()))
      ? declarations
      : undefined;
  };
  const standard = (declarations: readonly ts.Declaration[]): boolean =>
    declarations.every(
      (one) => ts.isInterfaceDeclaration(one.parent) && one.parent.name.text === 'ReadonlyArray'
    );
  const callable = (type: ts.Type): boolean =>
    type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0;
  // Every member of `type`: an assignment to each slot, and the value in it
  // walked — skipping, for a list, the positions its own branch wrote to.
  const members = (expression: string, type: ts.Type, level: number, list: boolean): void => {
    for (const property of checker.getPropertiesOfType(type)) {
      const name = property.getName();
      // A private name (`#…`) cannot be written or called from outside its
      // class, so it is the one member a consumer has no write to attempt.
      if (name.startsWith('__#')) continue;
      if (list && /^\d+$/.test(name)) continue;
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
      const declared = library(property);
      if (declared === undefined)
        visit(`${access}!`, present(checker.getTypeOfSymbol(property)), level + 1);
      else if (!standard(declared) && callable(checker.getTypeOfSymbol(property)))
        writes.push(`void ${access}!.call;`);
    }
  };

  const visit = (expression: string, type: ts.Type, level: number): void => {
    const flags = type.getFlags();
    // **`any` is not "nothing writable".** It has no properties to enumerate,
    // so it used to end the walk as if it had been read; a write through it
    // compiles, and this one is emitted so that it does — and is reported as a
    // write the types let through. `unknown` has nothing to write through
    // until a consumer narrows it, and a narrowing can make it anything — so
    // it is reported too, by throwing, rather than certified.
    if (flags & ts.TypeFlags.Any) {
      writes.push(`${expression}.anything = ${expression};`);
      return;
    }
    if (flags & ts.TypeFlags.Unknown) throw new Error(`writesThrough: ${expression} is unknown`);
    if (
      flags &
      (ts.TypeFlags.StringLike |
        ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike |
        ts.TypeFlags.BigIntLike |
        ts.TypeFlags.ESSymbolLike |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Null |
        ts.TypeFlags.Void |
        ts.TypeFlags.Never)
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
      // And every member's slot, which the positions do not reach:
      // TypeScript declares a read-only array's methods as methods, and a
      // method is an assignable slot — `tags.map = () => []` compiled against
      // `readonly string[]` and threw against the frozen array.
      members(expression, type, level, true);
      return;
    }
    // **A value that can be called is reported, not walked.** What a call does
    // — a `Set`'s `add`, a `Date`'s setters, a closure over the event — is not
    // something a readonly modifier answers, and `Readonly<Set<string>>` still
    // has an `add` to call. So a callable value is emitted as a line that
    // compiles exactly when it is callable, which reads as a write the types
    // let through. Data has no such member.
    const emitted = writes.length;
    if (callable(type)) writes.push(`void ${expression}.call;`);
    members(expression, type, level, false);
    // And a write through each index signature, under a key the type checker
    // cannot see — a dynamic key is a write a named property list never shows.
    for (const info of checker.getIndexInfosOfType(type)) {
      const key =
        info.keyType.getFlags() & ts.TypeFlags.NumberLike ? '(0 as number)' : "('k' as string)";
      writes.push(`${expression}[${key}] = ${expression}[${key}]!;`);
      visit(`${expression}[${key}]!`, present(info.type), level + 1);
    }
    // An object type the walk found nothing in — `object`, `{}`, a type
    // parameter — is not an empty one: a consumer narrows it to whatever they
    // like. Returning would certify it as read.
    if (writes.length === emitted)
      throw new Error(`writesThrough: ${expression} has nothing the probe can enumerate`);
  };
  visit('value', checker.getTypeAtLocation(declaration.name), 0);
  return writes;
}

/** What the compiler said about one write the probe attempted. */
export interface WriteVerdict {
  readonly write: string;
  /**
   * `refused`: the compiler refused it with the code that kind of write gets
   * from a read-only receiver. `compiles`: no diagnostic. `through a union`: the
   * receiver's type, as the compiler gives the expression, is a union, so a
   * refusal could be one constituent's. Otherwise the diagnostic that is not
   * a refusal.
   */
  readonly verdict: 'refused' | 'compiles' | 'through a union' | `not a refusal: TS${number}`;
}

/** An assignment to a property is refused as read-only (TS2540). */
const BY_PROPERTY: ReadonlySet<number> = new Set([2540]);
/** To an element: a read-only tuple position (TS2540) or index signature (TS2542). */
const BY_ELEMENT: ReadonlySet<number> = new Set([2540, 2542]);
/**
 * A `push` is refused by the receiver having none (TS2339) — which is what any
 * receiver without a `push` gets, so it counts only on a read-only array or
 * tuple.
 */
const BY_PUSH: ReadonlySet<number> = new Set([2339]);

/**
 * Each of `writes` — as {@link writesThrough} emits them — compiled after
 * `imports` against a `value` of `typeText`, and judged by what the compiler
 * says about that line's own expression.
 *
 * **The receiver's type is the compiler's, not the walk's.** The walk derives
 * each expression from a type argument, and a tuple's type arguments are not
 * its positions: in `readonly [...A[], B]` position 0 is `A | B`. A refusal on
 * a union receiver can be one constituent's — `push` is TS2339 for the
 * read-only half and compiles for the other after a narrowing — so it is not
 * counted. And a refusal is only the code that kind of write gets from a
 * read-only receiver: TS2339 on a member the walk believed in and the
 * receiver does not have is a mismatch, not a refusal.
 */
export function judgeWrites(
  imports: string,
  typeText: string,
  writes: readonly string[]
): WriteVerdict[] {
  const { program, consumer } = programOver(
    `${imports}\ndeclare const value: ${typeText};\n${writes.join('\n')}\n`
  );
  const checker = program.getTypeChecker();
  const diagnostics = ts.getPreEmitDiagnostics(program, consumer);
  const statements = [...consumer.statements];
  const at = statements.findIndex(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (one) => ts.isIdentifier(one.name) && one.name.text === 'value'
      )
  );
  const declared = statements[at];
  if (declared === undefined) throw new Error('judgeWrites: the probe declared no value');
  const prelude = diagnostics.find((one) => (one.start ?? 0) < declared.end);
  if (prelude !== undefined)
    throw new Error(
      `judgeWrites: the probe's prelude does not compile: ${ts.flattenDiagnosticMessageText(prelude.messageText, '\n')}`
    );
  const attempted = statements.slice(at + 1);
  if (attempted.length !== writes.length)
    throw new Error('judgeWrites: the writes are not one statement each');
  const isReadonlyList = (type: ts.Type): boolean =>
    (checker.isTupleType(type) && ((type as ts.TypeReference).target as ts.TupleType).readonly) ||
    (checker.isArrayType(type) && type.getSymbol()?.getName() === 'ReadonlyArray');

  return attempted.map((statement, index) => {
    const write = writes[index] as string;
    const expression = ts.isExpressionStatement(statement) ? statement.expression : undefined;
    let receiver: ts.Expression;
    let refusedBy: ReadonlySet<number>;
    let push = false;
    if (
      expression !== undefined &&
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(expression.left) ||
        ts.isElementAccessExpression(expression.left))
    ) {
      receiver = expression.left.expression;
      refusedBy = ts.isPropertyAccessExpression(expression.left) ? BY_PROPERTY : BY_ELEMENT;
    } else if (
      expression !== undefined &&
      ts.isCallExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression) &&
      expression.expression.name.text === 'push'
    ) {
      receiver = expression.expression.expression;
      refusedBy = BY_PUSH;
      push = true;
    } else if (
      expression !== undefined &&
      ts.isVoidExpression(expression) &&
      ts.isPropertyAccessExpression(expression.expression)
    ) {
      // A line that reports: it is written to compile, and nothing refuses it.
      receiver = expression.expression.expression;
      refusedBy = new Set();
    } else throw new Error(`judgeWrites: ${write} is not a write the probe emits`);

    const type = checker.getTypeAtLocation(receiver);
    if (type.isUnion()) return { write, verdict: 'through a union' };
    const said = diagnostics.filter(
      (one) =>
        one.start !== undefined && one.start >= statement.getStart() && one.start < statement.end
    );
    if (said.length === 0) return { write, verdict: 'compiles' };
    const other = said.find((one) => !refusedBy.has(one.code) || (push && !isReadonlyList(type)));
    return other === undefined
      ? { write, verdict: 'refused' }
      : { write, verdict: `not a refusal: TS${other.code}` };
  });
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
