import {
  parse,
  type AnyNode,
  type BlockStatement,
  type CallExpression,
  type Expression,
  type FunctionDeclaration,
  type Identifier,
  type MemberExpression,
  type ObjectExpression,
  type Program,
} from 'acorn';

import { TRACE_LIMITS } from '../protocol';

export type DirectInstrumentationScope = {
  readonly body: Program | BlockStatement;
  readonly owner: FunctionDeclaration | null;
};

type DirectRootMethodCall = CallExpression & {
  readonly callee: MemberExpression & {
    readonly object: Identifier;
    readonly property: Identifier;
  };
};

export function parseJavaScript(source: string): Program | null {
  try {
    return parse(source, {
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      ecmaVersion: 'latest',
      locations: true,
      sourceType: 'script',
    });
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export function walkAst(
  root: AnyNode,
  visit: (
    node: AnyNode,
    parent: AnyNode | null,
    grandparent: AnyNode | null,
    insideUnsupportedScope: boolean,
  ) => void,
): void {
  function descend(
    node: AnyNode,
    parent: AnyNode | null,
    grandparent: AnyNode | null,
    insideUnsupportedScope: boolean,
  ): void {
    visit(node, parent, grandparent, insideUnsupportedScope);

    const childInsideUnsupportedScope =
      insideUnsupportedScope || isUnsupportedScopeBoundary(node);

    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) {
            descend(child, node, parent, childInsideUnsupportedScope);
          }
        }
      } else if (isNode(value)) {
        descend(value, node, parent, childInsideUnsupportedScope);
      }
    }
  }

  descend(root, null, null, false);
}

export function isProgramOrBlockStatement(node: AnyNode | null): boolean {
  return node?.type === 'Program' || node?.type === 'BlockStatement';
}

export function isIdentifierReference(
  node: AnyNode,
  parent: AnyNode | null,
  name: string,
): boolean {
  if (node.type !== 'Identifier' || node.name !== name) return false;

  if (
    (parent?.type === 'MemberExpression' &&
      parent.property === node &&
      !parent.computed) ||
    (parent?.type === 'Property' &&
      parent.key === node &&
      !parent.computed &&
      !parent.shorthand) ||
    ((parent?.type === 'MethodDefinition' ||
      parent?.type === 'PropertyDefinition') &&
      parent.key === node &&
      !parent.computed)
  ) {
    return false;
  }

  return !(
    parent?.type === 'LabeledStatement' ||
    parent?.type === 'BreakStatement' ||
    parent?.type === 'ContinueStatement'
  );
}

function isDirectEval(node: AnyNode): boolean {
  return (
    node.type === 'CallExpression' &&
    !node.optional &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'eval'
  );
}

export function hasUnsafeInstrumentationSyntax(program: Program): boolean {
  let unsafe = false;

  walkAst(program, (node, parent) => {
    if (
      node.type === 'WithStatement' ||
      isDirectEval(node) ||
      isIdentifierReference(node, parent, 'trace')
    ) {
      unsafe = true;
    }
  });

  return unsafe;
}

export function isMemberRootedAt(node: AnyNode, root: string): boolean {
  if (node.type === 'ChainExpression') {
    return isMemberRootedAt(node.expression, root);
  }
  if (node.type !== 'MemberExpression') return false;

  return node.object.type === 'Identifier'
    ? node.object.name === root
    : isMemberRootedAt(node.object, root);
}

export function isRootedInvocation(node: AnyNode, root: string): boolean {
  if (node.type === 'CallExpression' || node.type === 'NewExpression') {
    return isMemberRootedAt(node.callee, root);
  }

  return (
    node.type === 'TaggedTemplateExpression' && isMemberRootedAt(node.tag, root)
  );
}

export function writesRootTarget(node: AnyNode, root: string): boolean {
  if (node.type === 'Identifier') return node.name === root;
  if (node.type === 'ChainExpression') {
    return writesRootTarget(node.expression, root);
  }
  if (node.type === 'MemberExpression') return isMemberRootedAt(node, root);
  if (node.type === 'AssignmentPattern') {
    return writesRootTarget(node.left, root);
  }
  if (node.type === 'RestElement') return writesRootTarget(node.argument, root);
  if (node.type === 'ArrayPattern') {
    return node.elements.some(
      (element) => element !== null && writesRootTarget(element, root),
    );
  }
  if (node.type !== 'ObjectPattern') return false;

  return node.properties.some((property) =>
    property.type === 'RestElement'
      ? writesRootTarget(property.argument, root)
      : writesRootTarget(property.value, root),
  );
}

export function isRootWrite(node: AnyNode, root: string): boolean {
  switch (node.type) {
    case 'AssignmentExpression':
      return writesRootTarget(node.left, root);
    case 'UpdateExpression':
      return writesRootTarget(node.argument, root);
    case 'UnaryExpression':
      return (
        node.operator === 'delete' && writesRootTarget(node.argument, root)
      );
    case 'ForInStatement':
    case 'ForOfStatement':
      return writesRootTarget(node.left, root);
    default:
      return false;
  }
}

export function isDirectRootMethodCall(
  node: AnyNode,
  root: string,
): node is DirectRootMethodCall {
  return (
    node.type === 'CallExpression' &&
    !node.optional &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.optional &&
    !node.callee.computed &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === root &&
    node.callee.property.type === 'Identifier'
  );
}

export function isDirectConsoleArgument(
  node: AnyNode,
  parent: AnyNode | null,
): boolean {
  if (
    parent?.type !== 'CallExpression' ||
    parent.optional ||
    !parent.arguments.some((argument) => argument === node) ||
    parent.callee.type !== 'MemberExpression' ||
    parent.callee.computed ||
    parent.callee.optional ||
    parent.callee.object.type !== 'Identifier' ||
    parent.callee.object.name !== 'console' ||
    parent.callee.property.type !== 'Identifier'
  ) {
    return false;
  }

  return (
    parent.callee.property.name === 'log' ||
    parent.callee.property.name === 'warn' ||
    parent.callee.property.name === 'error'
  );
}

export function directInstrumentationScopes(
  program: Program,
): readonly DirectInstrumentationScope[] {
  return [
    { body: program, owner: null },
    ...program.body.flatMap((statement) =>
      statement.type === 'FunctionDeclaration' && statement.id !== null
        ? [{ body: statement.body, owner: statement }]
        : [],
    ),
  ];
}

export function isCalledExactlyOnce(
  program: Program,
  declaration: FunctionDeclaration,
): boolean {
  if (declaration.id === null) return false;

  const name = declaration.id.name;
  let calls = 0;
  let unsafeReference = false;

  walkAst(program, (node, parent, _grandparent, insideUnsupportedScope) => {
    if (node === declaration.id || !isIdentifierReference(node, parent, name)) {
      return;
    }

    if (insideUnsupportedScope) {
      unsafeReference = true;
      return;
    }

    if (
      parent?.type === 'CallExpression' &&
      parent.callee === node &&
      !parent.optional
    ) {
      calls += 1;
      return;
    }

    unsafeReference = true;
  });

  return calls === 1 && !unsafeReference;
}

export function isDirectWriteTarget(
  node: AnyNode,
  parent: AnyNode | null,
): boolean {
  return (
    (parent?.type === 'AssignmentExpression' && parent.left === node) ||
    (parent?.type === 'UpdateExpression' && parent.argument === node) ||
    (parent?.type === 'UnaryExpression' &&
      parent.operator === 'delete' &&
      parent.argument === node)
  );
}

export function isLengthMember(member: MemberExpression): boolean {
  return (
    !member.computed &&
    member.property.type === 'Identifier' &&
    member.property.name === 'length'
  );
}

export function sourceLine(node: AnyNode): number | null {
  return node.loc?.start.line ?? null;
}

export function isFiniteNumericLiteral(node: AnyNode | null): boolean {
  if (node?.type === 'Literal' && typeof node.value === 'number') {
    return Number.isFinite(node.value);
  }

  return (
    node?.type === 'UnaryExpression' &&
    node.operator === '-' &&
    node.argument.type === 'Literal' &&
    typeof node.argument.value === 'number' &&
    Number.isFinite(node.argument.value)
  );
}

export function staticTraceValue(node: AnyNode | null): string | number | null {
  if (node?.type === 'Literal') {
    if (
      typeof node.value === 'string' &&
      node.value.length <= TRACE_LIMITS.stringLength
    ) {
      return node.value;
    }
    if (typeof node.value === 'number' && Number.isFinite(node.value)) {
      return node.value;
    }
    return null;
  }

  if (
    node?.type === 'UnaryExpression' &&
    node.operator === '-' &&
    node.argument.type === 'Literal' &&
    typeof node.argument.value === 'number' &&
    Number.isFinite(node.argument.value)
  ) {
    return -node.argument.value;
  }

  return null;
}

export function objectPropertyValue(
  expression: ObjectExpression,
  name: string,
): AnyNode | null {
  const matches = expression.properties.filter(
    (property) =>
      property.type === 'Property' &&
      property.kind === 'init' &&
      !property.computed &&
      !property.method &&
      ((property.key.type === 'Identifier' && property.key.name === name) ||
        (property.key.type === 'Literal' && property.key.value === name)),
  );
  const property = matches[0];
  return matches.length === 1 && property?.type === 'Property'
    ? property.value
    : null;
}

export function isSupportedIndexExpression(expression: Expression): boolean {
  return supportedIndexKey(expression) !== null;
}

export function sameSupportedIndexExpression(
  left: Expression,
  right: Expression,
): boolean {
  const leftKey = supportedIndexKey(left);
  return leftKey !== null && leftKey === supportedIndexKey(right);
}

export function createIdentifierAllocator(
  program: Program,
  prefix: string,
): () => string {
  const names = new Set<string>();
  walkAst(program, (node) => {
    if (node.type === 'Identifier') names.add(node.name);
  });

  let index = 0;
  return () => {
    let name: string;
    do {
      name = `${prefix}${index}`;
      index += 1;
    } while (names.has(name));

    names.add(name);
    return name;
  };
}

function supportedIndexKey(expression: Expression): string | null {
  // Instrumenters may repeat these expressions in an adjacent trace call.
  // Identifiers therefore represent stable numeric indices; calls, updates,
  // assignments, and member access are deliberately unsupported.
  if (expression.type === 'Identifier') return `id:${expression.name}`;
  if (expression.type === 'Literal') {
    return typeof expression.value === 'number' &&
      Number.isInteger(expression.value) &&
      expression.value >= 0
      ? `number:${expression.value}`
      : null;
  }
  if (
    expression.type !== 'BinaryExpression' ||
    (expression.operator !== '+' && expression.operator !== '-') ||
    expression.left.type === 'PrivateIdentifier'
  ) {
    return null;
  }

  const left = supportedIndexKey(expression.left);
  const right = supportedIndexKey(expression.right);

  return left === null || right === null
    ? null
    : `(${left}${expression.operator}${right})`;
}

function isUnsupportedScopeBoundary(node: AnyNode): boolean {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression' ||
    node.type === 'ClassDeclaration' ||
    node.type === 'ClassExpression' ||
    node.type === 'CatchClause'
  );
}

function isNode(value: unknown): value is AnyNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof value.type === 'string'
  );
}
