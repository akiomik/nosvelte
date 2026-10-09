/**
 * @license Apache-2.0
 * @copyright 2023 Akiomi Kamakura
 *
 * A component's props type, read off Svelte's own parse of the component:
 * shared by the arms that bind a published outlet type to the components that
 * take it (`PB13`, `RA1`).
 */
import { parse } from 'svelte/compiler';

/** A node of a component's script, as Svelte's parser hands it over: ESTree, with TypeScript's nodes. */
interface ScriptNode {
  readonly type: string;
  readonly name?: string;
  readonly body?: readonly ScriptNode[];
  readonly declaration?: unknown;
  readonly declarations?: readonly ScriptNode[];
  readonly specifiers?: readonly ScriptNode[];
  readonly local?: ScriptNode;
  readonly imported?: ScriptNode;
  readonly id?: unknown;
  readonly callee?: unknown;
  readonly typeAnnotation?: unknown;
  readonly typeArguments?: unknown;
  readonly typeName?: unknown;
  readonly source?: ScriptNode;
  readonly value?: unknown;
  readonly properties?: readonly ScriptNode[];
  readonly elements?: readonly (ScriptNode | null)[];
  readonly argument?: ScriptNode;
  readonly left?: ScriptNode;
}
const isNode = (value: unknown): value is ScriptNode =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { type?: unknown }).type === 'string';

/** Every node under `node`, each with the node that holds it. */
function* nodesOf(
  node: ScriptNode,
  holder?: ScriptNode
): Generator<[ScriptNode, ScriptNode | undefined]> {
  yield [node, holder];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'range') continue;
    for (const each of Array.isArray(value) ? value : [value])
      if (isNode(each)) yield* nodesOf(each, node);
  }
}

/** The names a binding pattern binds — not its type annotation, not its defaults. */
const patternNames = (pattern: ScriptNode | null | undefined): string[] => {
  if (pattern === null || pattern === undefined) return [];
  switch (pattern.type) {
    case 'Identifier':
      return pattern.name === undefined ? [] : [pattern.name];
    case 'ObjectPattern':
      return (pattern.properties ?? []).flatMap((one) =>
        one.type === 'RestElement'
          ? patternNames(one.argument)
          : patternNames(isNode(one.value) ? one.value : undefined)
      );
    case 'ArrayPattern':
      return (pattern.elements ?? []).flatMap((one) => patternNames(one));
    case 'RestElement':
      return patternNames(pattern.argument);
    case 'AssignmentPattern':
      return patternNames(pattern.left);
    default:
      throw new Error(`propsTypeOf: a binding pattern it cannot read, ${pattern.type}`);
  }
};

/** The names a script's top level binds, each with the node that binds it. */
function bindingsOf(program: ScriptNode): [string, ScriptNode][] {
  const named = (node: unknown): string[] =>
    isNode(node) && node.type === 'Identifier' && node.name !== undefined ? [node.name] : [];
  return (program.body ?? []).flatMap((statement) => {
    const declared =
      statement.type === 'ExportNamedDeclaration' && isNode(statement.declaration)
        ? statement.declaration
        : statement;
    if (declared.type === 'ImportDeclaration')
      return (declared.specifiers ?? []).map(
        (one) => [one.local?.name ?? '', one] as [string, ScriptNode]
      );
    if (declared.type === 'VariableDeclaration')
      return (declared.declarations ?? []).flatMap((one) =>
        patternNames(isNode(one.id) ? one.id : undefined).map(
          (name) => [name, one] as [string, ScriptNode]
        )
      );
    return named(declared.id).map((name) => [name, declared] as [string, ScriptNode]);
  });
}

/**
 * The type a component's `$props()` is annotated with — one name, bound once
 * across the component's scripts, by an unaliased import from the outlets in
 * its instance script — or `undefined`. Read off Svelte's own parse of the
 * component rather than its text, so a local type under an outlet type's
 * name, an alias in one script beside the import in another, an inline
 * annotation or a second `$props()` fails the premise rather than passing on
 * the name it shares. So does a `generics` attribute: it declares type
 * parameters the whole component sees, under any name, an outlet type's
 * included, and none of the scripts' bindings says so.
 */
export function propsTypeOf(source: string): string | undefined {
  const parsed = parse(source, { modern: true });
  if (
    [parsed.instance, parsed.module].some((script) =>
      (script?.attributes ?? []).some((attribute) => attribute.name === 'generics')
    )
  )
    return undefined;
  const instance = parsed.instance?.content as unknown as ScriptNode | undefined;
  const module = parsed.module?.content as unknown as ScriptNode | undefined;
  if (instance === undefined) return undefined;
  const scripts = module === undefined ? [instance] : [instance, module];
  const calls = scripts.flatMap((script) =>
    [...nodesOf(script)].filter(
      ([node]) =>
        node.type === 'CallExpression' &&
        isNode(node.callee) &&
        node.callee.type === 'Identifier' &&
        node.callee.name === '$props'
    )
  );
  const [only] = calls;
  if (calls.length !== 1 || only === undefined) return undefined;
  const declarator = only[1];
  const annotation = isNode(declarator?.id) ? declarator.id.typeAnnotation : undefined;
  const reference = isNode(annotation) ? annotation.typeAnnotation : undefined;
  if (
    declarator?.type !== 'VariableDeclarator' ||
    !(instance.body ?? []).some((statement) =>
      (statement.declarations ?? []).includes(declarator)
    ) ||
    !isNode(reference) ||
    reference.type !== 'TSTypeReference' ||
    reference.typeArguments !== undefined ||
    !isNode(reference.typeName) ||
    reference.typeName.type !== 'Identifier'
  )
    return undefined;
  const name = reference.typeName.name ?? '';
  const bound = scripts.flatMap((script) =>
    bindingsOf(script)
      .filter(([each]) => each === name)
      .map(([, node]) => [script, node] as const)
  );
  const [binding] = bound;
  if (bound.length !== 1 || binding === undefined) return undefined;
  const [script, specifier] = binding;
  const declaration = (instance.body ?? []).find(
    (statement) =>
      statement.type === 'ImportDeclaration' && (statement.specifiers ?? []).includes(specifier)
  );
  return script === instance &&
    specifier.type === 'ImportSpecifier' &&
    specifier.imported?.name === name &&
    declaration?.source?.value === './outlets.js'
    ? name
    : undefined;
}
