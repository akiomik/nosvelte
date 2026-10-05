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

/**
 * A value of the default library's `Object` and of its `CallableFunction`,
 * declared beside every probe so the members TypeScript gives *every* object
 * and every function can be enumerated: `getPropertiesOfType` answers a type's
 * own members and never these, so a walk built on it alone never asked
 * `state.constructor = …` or `handle.refresh.prototype = …` — both compile.
 */
const STANDARD = [
  'export declare const __standardObject: Object;',
  'export declare const __standardFunction: CallableFunction;'
].join('\n');

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
 * **A union is walked one variant at a time**, each line behind the guard that
 * narrows to it — `if (x.status === 'settled') x.events = …;` — because a write
 * to a member some constituents lack is an error for that reason, which would
 * read as a refusal. A union of primitives has nothing to write into. One whose
 * constituents share no literal member to tell them apart is reported instead,
 * by throwing; so is a symbol member the probe cannot name, a value with members
 * past `depth`, an `unknown`, and an object type with nothing to enumerate.
 *
 * What it does not judge is whether a write was refused: that is
 * {@link judgeWrites}, which asks the compiler about the expressions the walk
 * wrote rather than the types it derived them from.
 */
export interface WalkOptions {
  /** How many levels to walk; past it, a value with members throws. */
  readonly depth?: number;
  /**
   * What a callable this repository declares is. `'data'`, the default,
   * reports it: data has no such member, and the published event has none.
   * `'api'` takes it for a command — a function at the root of a walk, or a
   * member named in {@link commands} — whose slot must still be refused, whose
   * own members are walked, and whose result, awaited, is walked as a value
   * the consumer holds; anywhere else a function is reported as data's. A
   * function with more than one signature is reported; a required argument is
   * handed `never`.
   */
  readonly callables?: 'data' | 'api';
  /** The members `'api'` takes for commands, by name. */
  readonly commands?: readonly string[];
}

/**
 * A list the walk met, as a consumer's line reaches it: the guard that narrows
 * to it, the expression, and whether its type is a tuple.
 */
export interface ListSite {
  readonly guard: string;
  readonly expression: string;
  readonly tuple: boolean;
}

export function writesThrough(
  imports: string,
  typeText: string,
  options: WalkOptions = {}
): string[] {
  return writesThroughEach(imports, [typeText], options)[0] as string[];
}

/** The root a value of the `at`th of `count` types is declared as. */
const rootOf = (at: number, count: number): string => (count === 1 ? 'value' : `value_${at}`);

/**
 * {@link writesThrough}, for several types in one program — one compile, where
 * a type at a time is one each. The `at`th type's lines are written through
 * `value_${at}`, or through `value` when there is one; judge them with
 * {@link judgeWritesEach}.
 */
export function writesThroughEach(
  imports: string,
  typeTexts: readonly string[],
  options: WalkOptions = {}
): string[][] {
  return walkEach(imports, typeTexts, options).writes;
}

/**
 * Every list the walk of {@link writesThroughEach} meets, for each type: where
 * a consumer's line reaches it — so an arm can ask a question of every
 * published list rather than of the ones somebody wrote down.
 */
export function listsThroughEach(
  imports: string,
  typeTexts: readonly string[],
  options: WalkOptions = {}
): ListSite[][] {
  return walkEach(imports, typeTexts, options).lists;
}

function walkEach(
  imports: string,
  typeTexts: readonly string[],
  options: WalkOptions
): { writes: string[][]; lists: ListSite[][] } {
  const depth = options.depth ?? 4;
  const callables = options.callables ?? 'data';
  const commands = options.commands ?? [];
  let lists: ListSite[] = [];
  const roots = typeTexts.map((_, at) => rootOf(at, typeTexts.length));
  const { program, consumer } = programOver(
    `${imports}\n${STANDARD}\n${typeTexts.map((typeText, at) => `declare const ${roots[at]}: ${typeText};`).join('\n')}\n`
  );
  const checker = program.getTypeChecker();
  const declarations = consumer.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations);
  const standardOf = (name: string): readonly ts.Symbol[] => {
    const declared = declarations.find(
      (one) => ts.isIdentifier(one.name) && one.name.text === name
    );
    if (declared === undefined) throw new Error(`the probe declared no ${name}`);
    return checker.getPropertiesOfType(checker.getTypeAtLocation(declared.name));
  };
  const objectMembers = standardOf('__standardObject');
  const functionMembers = standardOf('__standardFunction');
  let writes: string[] = [];
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
      (one) => ts.isInterfaceDeclaration(one.parent) && STANDARD_READ_ONLY.has(one.parent.name.text)
    );
  // A callable this repository declares: not the default library's, and not a
  // dependency's.
  const ours = (type: ts.Type): boolean => {
    const declarations = type.getSymbol()?.getDeclarations() ?? [];
    return (
      declarations.length > 0 &&
      declarations.every((one) => {
        const file = one.getSourceFile();
        return (
          !program.isSourceFileDefaultLibrary(file) && !file.fileName.includes('/node_modules/')
        );
      })
    );
  };
  const primitive = (type: ts.Type): boolean =>
    (type.getFlags() &
      (ts.TypeFlags.StringLike |
        ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike |
        ts.TypeFlags.BigIntLike |
        ts.TypeFlags.ESSymbolLike |
        ts.TypeFlags.EnumLike |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Null |
        ts.TypeFlags.Void |
        ts.TypeFlags.Never)) !==
    0;
  // A literal member every constituent has, with a different value in each:
  // what a consumer compares to tell them apart.
  const discriminantOf = (
    constituents: readonly ts.Type[]
  ): { name: string; literals: string[] } | undefined => {
    const first = constituents[0];
    if (first === undefined) return undefined;
    const names = checker.getPropertiesOfType(first).map((one) => one.getName());
    const preferred = ['status', 'kind', 'code', 'type'];
    names.sort((a, b) => {
      const at = (name: string): number =>
        preferred.includes(name) ? preferred.indexOf(name) : preferred.length;
      return at(a) - at(b);
    });
    for (const name of names) {
      const literals = constituents.map((one) => {
        const property = checker.getPropertyOfType(one, name);
        if (property === undefined) return undefined;
        const type = checker.getTypeOfSymbol(property);
        if (type.isStringLiteral()) return JSON.stringify(type.value);
        if (type.isNumberLiteral()) return String(type.value);
        if (type.getFlags() & ts.TypeFlags.BooleanLiteral) return checker.typeToString(type);
        return undefined;
      });
      if (literals.some((one) => one === undefined)) continue;
      if (new Set(literals).size !== literals.length) continue;
      return { name, literals: literals as string[] };
    }
    return undefined;
  };
  const callable = (type: ts.Type): boolean =>
    type.getCallSignatures().length > 0 || type.getConstructSignatures().length > 0;
  // How a consumer spells a member: by name, by a quoted name, or — keyed by a
  // well-known symbol — through the symbol. One the probe cannot name is
  // reported, since silence would read as "nothing writable".
  const accessOf = (expression: string, property: ts.Symbol): string => {
    const name = property.getName();
    if (name.startsWith('__@')) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      const named = declaration === undefined ? undefined : ts.getNameOfDeclaration(declaration);
      const symbol =
        named !== undefined && ts.isComputedPropertyName(named) ? named.expression.getText() : '';
      if (!/^Symbol\.\w+$/.test(symbol))
        throw new Error(`writesThrough: ${expression} has a symbol member the probe cannot name`);
      return `${expression}[${symbol}]`;
    }
    return isIdentifier(name) ? `${expression}.${name}` : `${expression}[${JSON.stringify(name)}]`;
  };
  // **The members every value has, and no type lists.** `Object`'s on every
  // object, and `Function`'s on every function: each slot a consumer can spell
  // is written to, and none is walked into — they are the language's, not the
  // published value's. `judgeWrites` says which of them the types refuse.
  const standardMembers = (expression: string, type: ts.Type, guard: string): void => {
    const own = new Set(checker.getPropertiesOfType(type).map((one) => one.getName()));
    const spelled = new Set<string>();
    for (const property of [...objectMembers, ...(callable(type) ? functionMembers : [])]) {
      const name = property.getName();
      if (own.has(name) || spelled.has(name)) continue;
      spelled.add(name);
      const access = accessOf(expression, property);
      writes.push(`${guard}${access} = ${access}!;`);
    }
  };
  // Every member of `type`: an assignment to each slot, and the value in it
  // walked — skipping, for a list, the positions its own branch wrote to.
  const members = (
    expression: string,
    type: ts.Type,
    level: number,
    list: boolean,
    guard: string
  ): void => {
    for (const property of checker.getPropertiesOfType(type)) {
      const name = property.getName();
      // A private name (`#…`) cannot be written or called from outside its
      // class, so it is the one member a consumer has no write to attempt.
      if (name.startsWith('__#')) continue;
      if (list && /^\d+$/.test(name)) continue;
      const access = accessOf(expression, property);
      writes.push(`${guard}${access} = ${access}!;`);
      const declared = library(property);
      if (declared === undefined)
        visit(
          `${access}!`,
          present(checker.getTypeOfSymbol(property)),
          level + 1,
          guard,
          false,
          name
        );
      else if (!standard(declared) && callable(checker.getTypeOfSymbol(property)))
        writes.push(`${guard}void ${access}!.call;`);
    }
  };

  // A type already walked is not walked again: a recursive one — a failure's
  // `cause` is a failure — would otherwise run to the depth limit, and its
  // members' writes were emitted, and will be judged, where it was first met.
  // A union's variants are all claimed before any is walked, so a variant met
  // again inside a sibling's `cause` is not walked there, one level down, but
  // here, where the union is.
  let walked = new Set<ts.Type>();
  let results = 0;
  const visit = (
    expression: string,
    type: ts.Type,
    level: number,
    guard: string,
    claimed = false,
    member: string | undefined = undefined
  ): void => {
    const flags = type.getFlags();
    // **`any` is not "nothing writable".** It has no properties to enumerate,
    // so it used to end the walk as if it had been read; a write through it
    // compiles, and this one is emitted so that it does — and is reported as a
    // write the types let through. `unknown` has nothing to write through
    // until a consumer narrows it, and a narrowing can make it anything — so
    // it is reported too, by throwing, rather than certified.
    if (flags & ts.TypeFlags.Any) {
      writes.push(`${guard}${expression}.anything = ${expression};`);
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
    if (walked.has(type) && !claimed) return;
    if (level > depth) throw new Error(`writesThrough: ${expression} is deeper than ${depth}`);
    if (!type.isUnion()) walked.add(type);
    if (type.isUnion()) {
      const constituents = type.types.filter(
        (one) =>
          !(one.getFlags() & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void))
      );
      if (constituents.every(primitive)) return;
      const [only] = constituents;
      if (constituents.length === 1 && only !== undefined)
        return visit(expression, only, level, guard, false, member);
      if (constituents.some(primitive))
        throw new Error(`writesThrough: ${expression} is a union of values and objects`);
      const discriminant = discriminantOf(constituents);
      if (discriminant === undefined)
        throw new Error(`writesThrough: ${expression} is a union with nothing to tell it apart`);
      const fresh = new Set(constituents.filter((one) => !walked.has(one)));
      for (const one of fresh) walked.add(one);
      for (const [at, one] of constituents.entries())
        if (fresh.has(one))
          visit(
            expression,
            one,
            level,
            `${guard}if (${expression}.${discriminant.name} === ${discriminant.literals[at]}) `,
            true
          );
      return;
    }
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      lists.push({ guard, expression, tuple: checker.isTupleType(type) });
      writes.push(`${guard}${expression}.push(${expression}[0]!);`);
      // Every position, not the first: a tuple's positions and its rest
      // element can each have a type of their own, so `[readonly string[],
      // ...string[][]]` is readonly at 0 and mutable from 1. An array's one type
      // argument is its element, at every index.
      const elements = checker.getTypeArguments(type as ts.TypeReference);
      for (const [at, element] of elements.entries()) {
        writes.push(`${guard}${expression}[${at}] = ${expression}[${at}]!;`);
        visit(`${expression}[${at}]!`, element, level + 1, guard);
      }
      // And every member's slot, which the positions do not reach:
      // TypeScript declares a read-only array's methods as methods, and a
      // method is an assignable slot — `tags.map = () => []` compiled against
      // `readonly string[]` and threw against the frozen array.
      members(expression, type, level, true, guard);
      standardMembers(expression, type, guard);
      return;
    }
    // **A list is an array.** A type indexed by number that is not one — the
    // mapped `ReadonlyList` this row gave up — stopped being a list to a
    // consumer's `$state.snapshot`, tuple and narrowing, and is reported
    // wherever the walk meets it rather than at the one site a check names.
    if (
      checker
        .getIndexInfosOfType(type)
        .some((info) => (info.keyType.getFlags() & ts.TypeFlags.NumberLike) !== 0)
    )
      throw new Error(`writesThrough: ${expression} is indexed by number and is not an array`);
    // **A collection's payload is not reached through its members.** A
    // `ReadonlyMap`'s methods are the default library's, so the walk writes to
    // their slots and does not walk into them — and the values the map holds
    // were never asked about. One that holds anything with members is reported,
    // rather than certified as read; none of the published types holds one.
    const collection = type.getSymbol();
    if (
      collection !== undefined &&
      ['Map', 'Set', 'ReadonlyMap', 'ReadonlySet', 'WeakMap', 'WeakSet'].includes(
        collection.getName()
      ) &&
      library(collection) !== undefined &&
      checker.getTypeArguments(type as ts.TypeReference).some((one) => !primitive(present(one)))
    )
      throw new Error(`writesThrough: ${expression} holds a payload the probe does not walk`);
    // **A value that can be called is reported, not walked.** What a call does
    // — a `Set`'s `add`, a `Date`'s setters, a closure over the event — is not
    // something a readonly modifier answers, and `Readonly<Set<string>>` still
    // has an `add` to call. So a callable value is emitted as a line that
    // compiles exactly when it is callable, which reads as a write the types
    // let through. Data has no such member.
    const emitted = writes.length;
    const command = level === 0 || (member !== undefined && commands.includes(member));
    if (callable(type) && callables === 'api' && ours(type) && command) {
      // A method of a published handle: what it resolves with is what the
      // consumer holds, so that is walked, as a value of its own.
      //
      // **One signature.** `find` stood here, and it walked the first overload
      // a call with no arguments matched and passed over the rest — a second
      // signature's result was never walked, and nothing said so. A function
      // with several is reported: what each would resolve with is not one
      // value to walk. A required argument is handed `null as never`, which the
      // signature takes whatever it asks for, so `useSend()`'s `send(input)` is
      // walked as `refresh()` is.
      const signatures = [...type.getCallSignatures(), ...type.getConstructSignatures()];
      const [call] = signatures;
      if (signatures.length !== 1 || call === undefined)
        throw new Error(`writesThrough: ${expression} is a function the probe cannot call`);
      const required = call.getParameters().filter((parameter) => {
        const declaration = parameter.valueDeclaration;
        return (
          declaration === undefined ||
          !ts.isParameter(declaration) ||
          !(checker.isOptionalParameter(declaration) || declaration.dotDotDotToken !== undefined)
        );
      }).length;
      // **And the function is a value too.** Its declared members are walked
      // like any object's, and the members every function has are written to.
      members(expression, type, level, false, guard);
      standardMembers(expression, type, guard);
      const returned = call.getReturnType();
      const awaited = checker.getAwaitedType(returned) ?? returned;
      // **What a command returns is the platform's promise, and nothing more.**
      // It is the caller's own — a fresh one each call — so its members are
      // not walked; one with members of this library's on it would be a
      // published value the walk never asked about, and is reported.
      if (awaited !== returned) {
        const own = checker.getPropertiesOfType(returned).filter((property) => {
          const declared = property.getDeclarations() ?? [];
          return !(
            declared.length > 0 &&
            declared.every(
              (one) =>
                program.isSourceFileDefaultLibrary(one.getSourceFile()) &&
                ts.isInterfaceDeclaration(one.parent) &&
                ['Promise', 'PromiseLike'].includes(one.parent.name.text)
            )
          );
        });
        if (own.length > 0)
          throw new Error(
            `writesThrough: ${expression} returns a promise with members of its own: ${own.map((one) => one.getName()).join(', ')}`
          );
      }
      // Bound to a name each line, so a guard can narrow it: a call is a new
      // value every time it is written, and nothing narrows one.
      const name = `__result${(results += 1)}`;
      const called = `${expression}(${Array.from({ length: required }, () => 'null as never').join(', ')})`;
      const invoked = awaited === returned ? called : `await ${called}`;
      visit(name, present(awaited), level + 1, `${guard}for (const ${name} of [${invoked}]) `);
      return;
    }
    if (callable(type)) writes.push(`${guard}void ${expression}.call;`);
    members(expression, type, level, false, guard);
    // And a write through each index signature, under a key the type checker
    // cannot see — a dynamic key is a write a named property list never shows.
    const named = new Set(checker.getPropertiesOfType(type).map((one) => one.getName()));
    for (const info of checker.getIndexInfosOfType(type)) {
      // A literal key no named member has, so the write lands on the signature
      // itself — and a literal, so a guard can narrow through it. **Chosen
      // against the members**, since a type that names `__key` would have taken
      // the write on that member and reported it as the signature's.
      const numeric = (info.keyType.getFlags() & ts.TypeFlags.NumberLike) !== 0;
      let free = numeric ? '999' : '__key';
      while (named.has(free)) free = numeric ? `${free}9` : `${free}_`;
      const key = numeric ? free : `'${free}'`;
      writes.push(`${guard}${expression}[${key}] = ${expression}[${key}]!;`);
      visit(`${expression}[${key}]!`, present(info.type), level + 1, guard);
    }
    // An object type the walk found nothing in — `object`, `{}`, a type
    // parameter — is not an empty one: a consumer narrows it to whatever they
    // like. Returning would certify it as read.
    if (writes.length === emitted)
      throw new Error(`writesThrough: ${expression} has nothing the probe can enumerate`);
    standardMembers(expression, type, guard);
  };
  const walkedEach = roots.map((root) => {
    const declaration = declarations.find(
      (one) => ts.isIdentifier(one.name) && one.name.text === root
    );
    if (declaration === undefined) throw new Error(`the probe declared no ${root}`);
    writes = [];
    lists = [];
    walked = new Set<ts.Type>();
    results = 0;
    visit(root, checker.getTypeAtLocation(declaration.name), 0, '');
    return { writes, lists };
  });
  return {
    writes: walkedEach.map((one) => one.writes),
    lists: walkedEach.map((one) => one.lists)
  };
}

/**
 * The default library's read-only collections: every member they declare reads,
 * and none writes, by their declaration.
 */
const STANDARD_READ_ONLY: ReadonlySet<string> = new Set([
  'ReadonlyArray',
  'ReadonlyMap',
  'ReadonlySet'
]);

/** What the compiler said about one write the probe attempted. */
export interface WriteVerdict {
  readonly write: string;
  /**
   * `refused`: the compiler refused it with the code that kind of write gets
   * from a read-only receiver. `compiles`: no diagnostic. `through a union`: the
   * receiver's type, as the compiler gives the expression, is a union, so a
   * refusal could be one constituent's. `a standard member slot`: it compiles,
   * and it is an assignment to a member the default library declares on every
   * value of the receiver's kind — `Object`'s on any, `Function`'s and
   * `CallableFunction`'s on a function, `ReadonlyArray`'s on a read-only list —
   * and the receiver's own type does not: the writes TypeScript's own
   * declarations let through every published value, which the published types
   * keep rather than give up being arrays and functions for (`B5-C6`,
   * `B5-C8`). Otherwise the diagnostic that is not a refusal.
   */
  readonly verdict:
    | 'refused'
    | 'compiles'
    | 'through a union'
    | 'a standard member slot'
    | `not a refusal: TS${number}`;
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
  return judgeWritesEach(imports, [typeText], [writes])[0] as WriteVerdict[];
}

/**
 * {@link judgeWrites}, for the lines {@link writesThroughEach} wrote through
 * several types, in one program.
 */
export function judgeWritesEach(
  imports: string,
  typeTexts: readonly string[],
  writesEach: readonly (readonly string[])[]
): WriteVerdict[][] {
  const all = writesEach.flat();
  const prelude = `${imports}\n${typeTexts.map((typeText, at) => `declare const ${rootOf(at, typeTexts.length)}: ${typeText};`).join('\n')}`;
  // In programs of a few hundred lines: past a size, the compiler stops
  // analysing a module's control flow (TS2563), and a guard narrows nothing.
  const verdicts: WriteVerdict[] = [];
  for (let from = 0; from < all.length; from += JUDGED_AT_ONCE)
    verdicts.push(...judgeIn(prelude, all.slice(from, from + JUDGED_AT_ONCE)));
  let from = 0;
  return writesEach.map((writes) => {
    const own = verdicts.slice(from, from + writes.length);
    from += writes.length;
    return own;
  });
}

/** How many lines one program judges. */
const JUDGED_AT_ONCE = 300;

/** Where the prelude ends and the lines to judge begin. */
const WRITES_FOLLOW = 'declare const __writesFollow: never;';

function judgeIn(prelude: string, writes: readonly string[]): WriteVerdict[] {
  const { program, consumer } = programOver(
    `${prelude}\n${STANDARD}\n${WRITES_FOLLOW}\n${writes.join('\n')}\n`
  );
  const checker = program.getTypeChecker();
  const diagnostics = ts.getPreEmitDiagnostics(program, consumer);
  const statements = [...consumer.statements];
  const at = statements.findIndex(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (one) => ts.isIdentifier(one.name) && one.name.text === '__writesFollow'
      )
  );
  const declared = statements[at];
  if (declared === undefined) throw new Error('judgeWrites: the probe lost its prelude');
  const broken = diagnostics.find((one) => (one.start ?? 0) < declared.end);
  if (broken !== undefined)
    throw new Error(
      `judgeWrites: the probe's prelude does not compile: ${ts.flattenDiagnosticMessageText(broken.messageText, '\n')}`
    );
  const attempted = statements.slice(at + 1);
  if (attempted.length !== writes.length)
    throw new Error('judgeWrites: the writes are not one statement each');
  const isReadonlyList = (type: ts.Type): boolean =>
    (checker.isTupleType(type) && ((type as ts.TypeReference).target as ts.TupleType).readonly) ||
    (checker.isArrayType(type) && type.getSymbol()?.getName() === 'ReadonlyArray');
  // The default library's universal members, enumerated as the walk did.
  const standardIn = (name: string): readonly ts.Symbol[] => {
    const declared = statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => statement.declarationList.declarations)
      .find((one) => ts.isIdentifier(one.name) && one.name.text === name);
    if (declared === undefined) throw new Error(`judgeWrites: the probe declared no ${name}`);
    return checker.getPropertiesOfType(checker.getTypeAtLocation(declared.name));
  };
  const objectMembers = standardIn('__standardObject');
  const functionMembers = standardIn('__standardFunction');
  // **A member the default library declares on every value of its kind, and
  // nothing else**: `Object`'s on any receiver, `Function`'s and
  // `CallableFunction`'s on one that can be called, `ReadonlyArray`'s on a
  // read-only list. A member anything else adds to those interfaces, or an
  // overload of one, has a declaration that is not the default library's, and
  // a member the receiver's own type declares is the published type's.
  const standardMember = (
    target: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    receiver: ts.Type
  ): boolean => {
    const callable =
      receiver.getCallSignatures().length > 0 || receiver.getConstructSignatures().length > 0;
    // An element access names its member by a key: a well-known symbol is
    // found by the name the checker gives it (`__@iterator@…`), among the
    // receiver's members and the universal ones, and a string literal by itself.
    let symbol: ts.Symbol | undefined;
    if (ts.isPropertyAccessExpression(target)) symbol = checker.getSymbolAtLocation(target.name);
    else {
      const key = target.argumentExpression;
      const wellKnown = /^Symbol\.(\w+)$/.exec(key.getText());
      symbol = [
        ...checker.getPropertiesOfType(receiver),
        ...objectMembers,
        ...(callable ? functionMembers : [])
      ].find((one) =>
        wellKnown !== null
          ? one.getName().startsWith(`__@${wellKnown[1]}@`)
          : ts.isStringLiteral(key) && one.getName() === key.text
      );
    }
    const declarations = symbol?.getDeclarations() ?? [];
    const declaring = [
      'Object',
      ...(callable ? ['Function', 'CallableFunction', 'NewableFunction'] : []),
      ...(isReadonlyList(receiver) ? ['ReadonlyArray'] : [])
    ];
    return (
      symbol !== undefined &&
      declarations.length > 0 &&
      declarations.every(
        (one) =>
          program.isSourceFileDefaultLibrary(one.getSourceFile()) &&
          ts.isInterfaceDeclaration(one.parent) &&
          declaring.includes(one.parent.name.text)
      )
    );
  };

  return attempted.map((statement, index) => {
    const write = writes[index] as string;
    // A line under a guard — an `if` that narrows, a `for` that binds a call's
    // result — is judged at the write it guards.
    let guarded: ts.Statement = statement;
    while (ts.isIfStatement(guarded) || ts.isForOfStatement(guarded))
      guarded = ts.isIfStatement(guarded) ? guarded.thenStatement : guarded.statement;
    const expression = ts.isExpressionStatement(guarded) ? guarded.expression : undefined;
    let receiver: ts.Expression;
    let refusedBy: ReadonlySet<number>;
    let push = false;
    let target: ts.PropertyAccessExpression | ts.ElementAccessExpression | undefined;
    if (
      expression !== undefined &&
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(expression.left) ||
        ts.isElementAccessExpression(expression.left))
    ) {
      receiver = expression.left.expression;
      target = expression.left;
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
    if (said.length === 0)
      return {
        write,
        verdict:
          target !== undefined && standardMember(target, type)
            ? 'a standard member slot'
            : 'compiles'
      };
    const other = said.find((one) => !refusedBy.has(one.code) || (push && !isReadonlyList(type)));
    return other === undefined
      ? { write, verdict: 'refused' }
      : { write, verdict: `not a refusal: TS${other.code}` };
  });
}

/** A name a module exports, and how a consumer meets it. */
export interface Exported {
  readonly name: string;
  /** `class`: a constructor and an instance type; `value`: a function or constant; `type`: a type alone. */
  readonly kind: 'type' | 'class' | 'value';
}

/**
 * Every name `specifier` exports, as the type checker resolves the module — so a
 * re-export, an `export type { … } from` and an `export *` are each counted, and
 * a name the source spells in a comment is not.
 */
export function exportsOf(specifier: string): Exported[] {
  const { program, consumer } = programOver(
    `import * as entry from '${specifier}';\nvoid entry;\n`
  );
  const checker = program.getTypeChecker();
  const imported = consumer.statements.find(ts.isImportDeclaration);
  const module =
    imported === undefined ? undefined : checker.getSymbolAtLocation(imported.moduleSpecifier);
  if (module === undefined) throw new Error(`exportsOf: ${specifier} did not resolve`);
  return checker.getExportsOfModule(module).map((symbol) => {
    const resolved =
      symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const kind: Exported['kind'] =
      resolved.flags & ts.SymbolFlags.Class
        ? 'class'
        : resolved.flags & (ts.SymbolFlags.Function | ts.SymbolFlags.Variable)
          ? 'value'
          : 'type';
    return { name: symbol.getName(), kind };
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

/**
 * The argument each snippet member of `typeTexts`' types hands a consumer —
 * a component's outlets — as type texts a walk can take, one for each distinct
 * type: an outlet shared by every component that renders through it is walked
 * once rather than once a component.
 *
 * A snippet is the published value here, not the props it sits in: the props
 * are the consumer's to write, and what the snippet is called with is the
 * library's to hand out.
 */
export function snippetArgumentsOf(imports: string, typeTexts: readonly string[]): string[] {
  const roots = typeTexts.map((_, at) => rootOf(at, typeTexts.length));
  const { program, consumer } = programOver(
    `${imports}\n${typeTexts.map((typeText, at) => `declare const ${roots[at]}: ${typeText};`).join('\n')}\n`
  );
  const checker = program.getTypeChecker();
  const declarations = consumer.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations);
  const seen = new Set<ts.Type>();
  const found: string[] = [];
  for (const [at, root] of roots.entries()) {
    const declaration = declarations.find(
      (one) => ts.isIdentifier(one.name) && one.name.text === root
    );
    if (declaration === undefined) throw new Error(`the probe declared no ${root}`);
    for (const property of checker.getPropertiesOfType(
      checker.getTypeAtLocation(declaration.name)
    )) {
      const type = checker.getNonNullableType(checker.getTypeOfSymbol(property));
      // **Every prop that can be called is one this library calls** — a
      // snippet, or a callback, under whatever name or interface it is
      // declared — and what it is called with is handed to the consumer. A
      // prop that cannot be called is the consumer's to write.
      const signatures = type.getCallSignatures();
      if (signatures.length === 0) continue;
      const [signature, ...others] = signatures;
      if (signature === undefined || others.length > 0)
        throw new Error(
          `snippetArgumentsOf: ${property.getName()} is a prop the probe cannot read`
        );
      const parameters = signature.getParameters();
      const [only] = parameters;
      const declaration = only?.valueDeclaration;
      // A snippet takes its arguments as one rest list; a callback, one by one.
      const rest =
        parameters.length === 1 &&
        declaration !== undefined &&
        ts.isParameter(declaration) &&
        declaration.dotDotDotToken !== undefined;
      let handed: readonly ts.Type[];
      const prop = `NonNullable<(${typeTexts[at]})[${JSON.stringify(property.getName())}]>`;
      if (rest && only !== undefined) {
        const list = checker.getTypeOfSymbol(only);
        // A rest list that is not a tuple is one the probe cannot read, and is
        // reported rather than passed over as a snippet handed nothing.
        if (!checker.isTupleType(list))
          throw new Error(
            `snippetArgumentsOf: ${property.getName()} is handed something that is not a list of arguments`
          );
        handed = checker.getTypeArguments(list as ts.TypeReference);
      } else handed = parameters.map((parameter) => checker.getTypeOfSymbol(parameter));
      const spelled = (position: number): string => `Parameters<${prop}>[${position}]`;
      for (const [position, argument] of handed.entries()) {
        if (seen.has(argument)) continue;
        seen.add(argument);
        found.push(spelled(position));
      }
    }
  }
  return found;
}

/**
 * The members of `typeText` this repository declares — not the default
 * library's, not a dependency's — by name. A class's static side is the
 * platform's `ErrorConstructor`, `Function`'s members and the `prototype`
 * TypeScript gives every class; this is how an arm says it holds nothing else.
 */
export function declaredHere(imports: string, typeText: string): string[] {
  const { program, consumer } = programOver(`${imports}\ndeclare const value: ${typeText};\n`);
  const checker = program.getTypeChecker();
  const declaration = consumer.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((one) => ts.isIdentifier(one.name) && one.name.text === 'value');
  if (declaration === undefined) throw new Error('the probe declared no value');
  return checker
    .getPropertiesOfType(checker.getTypeAtLocation(declaration.name))
    .filter((property) =>
      (property.getDeclarations() ?? []).some((one) => {
        const file = one.getSourceFile();
        return (
          !program.isSourceFileDefaultLibrary(file) && !file.fileName.includes('/node_modules/')
        );
      })
    )
    .map((property) => property.getName());
}

/** The names of every member the type checker gives `typeText`, after `imports`. */
export function memberNamesOf(imports: string, typeText: string): string[] {
  const { program, consumer } = programOver(`${imports}\ndeclare const value: ${typeText};\n`);
  const checker = program.getTypeChecker();
  const declaration = consumer.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((one) => ts.isIdentifier(one.name) && one.name.text === 'value');
  if (declaration === undefined) throw new Error('the probe declared no value');
  return checker
    .getPropertiesOfType(checker.getTypeAtLocation(declaration.name))
    .map((property) => property.getName());
}
