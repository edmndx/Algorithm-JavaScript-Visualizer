import {
  type AnyNode,
  type CallExpression,
  type ExpressionStatement,
  type FunctionDeclaration,
  type Identifier,
  type ObjectExpression,
  type Program,
  type VariableDeclaration,
} from 'acorn';

import {
  createIdentifierAllocator,
  hasUnsafeInstrumentationSyntax,
  isIdentifierReference,
  isRootWrite,
  objectPropertyValue,
  sourceLine,
  staticTraceValue,
  walkAst,
} from './ast';
import { applySourceEdits, lineIndentation, type SourceEdit } from './edits';
import type { ValidVisualizationSource } from './sourceContract';

type StaticTreeNode = {
  readonly id: string;
  readonly access: string;
  readonly value: string | number;
  readonly children: readonly string[];
};

type TreeVisit = {
  readonly statement: ExpressionStatement;
  readonly parameter: Identifier;
  readonly line: number;
};

type TreeTraversal = {
  readonly initialCall: CallExpression;
  readonly visit: TreeVisit;
};

type TreeCandidate = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly nodes: readonly StaticTreeNode[];
  readonly traversal: TreeTraversal;
};

export function instrumentTree(
  source: string,
  program: Program,
  contract: ValidVisualizationSource,
): string | null {
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  const candidates = findTreeDeclarations(program, contract.identifier)
    .map(({ declaration, nodes }) => analyzeTree(program, declaration, nodes))
    .filter((candidate): candidate is TreeCandidate => candidate !== null);

  if (candidates.length !== 1) return null;

  const candidate = candidates[0];
  if (candidate === undefined) return null;

  const allocateIdentifier = createIdentifierAllocator(program, '__traceTree');
  const nodeIds = allocateIdentifier();
  const weakMapEntries = candidate.nodes
    .map(({ access, id }) => `[${access}, ${JSON.stringify(id)}]`)
    .join(', ');
  const traceNodes = candidate.nodes
    .map(
      ({ id, value, children }) =>
        `{ id: ${JSON.stringify(id)}, value: ${JSON.stringify(value)}, children: ${JSON.stringify(children)} }`,
    )
    .join(', ');
  const visitIndentation = lineIndentation(
    source,
    candidate.traversal.visit.statement.start,
  );
  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text:
        `;\ntrace.initialize({ structure: 'tree', source: { line: ${candidate.declarationLine} } });\n` +
        `const ${nodeIds} = new WeakMap([${weakMapEntries}]);\n` +
        `trace.createTree({ rootId: ${JSON.stringify(candidate.nodes[0]?.id)}, nodes: [${traceNodes}], source: { line: ${candidate.declarationLine} } });\n`,
    },
    {
      start: candidate.traversal.visit.statement.start,
      end: candidate.traversal.visit.statement.start,
      text: `trace.visit({ nodeId: ${nodeIds}.get(${candidate.traversal.visit.parameter.name}), source: { line: ${candidate.traversal.visit.line} } });\n${visitIndentation}`,
    },
  ];

  return applySourceEdits(source, edits);
}

function findTreeDeclarations(
  program: Program,
  identifier: string,
): Array<{
  readonly declaration: VariableDeclaration;
  readonly nodes: readonly StaticTreeNode[];
}> {
  return program.body.flatMap((statement) => {
    if (
      statement.type !== 'VariableDeclaration' ||
      statement.kind !== 'const' ||
      statement.declarations.length !== 1
    ) {
      return [];
    }

    const declarator = statement.declarations[0];
    if (
      declarator?.id.type !== 'Identifier' ||
      declarator.id.name !== identifier ||
      declarator.init?.type !== 'ObjectExpression'
    ) {
      return [];
    }

    const nodes = readStaticTree(declarator.init, declarator.id.name, {
      nextId: 0,
    });
    return nodes === null ? [] : [{ declaration: statement, nodes }];
  });
}

function readStaticTree(
  expression: ObjectExpression,
  access: string,
  ids: { nextId: number },
): StaticTreeNode[] | null {
  if (expression.properties.length !== 3) return null;

  const valueExpression = objectPropertyValue(expression, 'value');
  const leftExpression = objectPropertyValue(expression, 'left');
  const rightExpression = objectPropertyValue(expression, 'right');
  const value = staticTraceValue(valueExpression);

  if (value === null || leftExpression === null || rightExpression === null) {
    return null;
  }

  const id = `node-${ids.nextId}`;
  ids.nextId += 1;
  const left = readStaticChild(leftExpression, `${access}.left`, ids);
  const right = readStaticChild(rightExpression, `${access}.right`, ids);
  if (left === null || right === null) return null;

  return [
    {
      id,
      access,
      value,
      children: [left[0]?.id, right[0]?.id].filter(
        (childId): childId is string => childId !== undefined,
      ),
    },
    ...left,
    ...right,
  ];
}

function readStaticChild(
  expression: AnyNode,
  access: string,
  ids: { nextId: number },
): readonly StaticTreeNode[] | null {
  if (expression.type === 'Literal' && expression.value === null) {
    return [];
  }
  if (expression.type !== 'ObjectExpression') return null;

  return readStaticTree(expression, access, ids);
}

function analyzeTree(
  program: Program,
  declaration: VariableDeclaration,
  nodes: readonly StaticTreeNode[],
): TreeCandidate | null {
  const declarator = declaration.declarations[0];
  const declarationLine = sourceLine(declaration);
  if (declarator?.id.type !== 'Identifier' || declarationLine === null) {
    return null;
  }

  const root = declarator.id.name;
  const traversals = program.body
    .filter(
      (statement): statement is FunctionDeclaration =>
        statement.type === 'FunctionDeclaration' && statement.id !== null,
    )
    .map((traversal) => matchTreeTraversal(program, traversal, root))
    .filter((traversal): traversal is TreeTraversal => traversal !== null);
  const traversal = traversals[0];

  if (
    traversals.length !== 1 ||
    traversal === undefined ||
    hasUnsafeTreeUsage(program, declaration, traversal, root)
  ) {
    return null;
  }

  return { declaration, declarationLine, nodes, traversal };
}

function matchTreeTraversal(
  program: Program,
  declaration: FunctionDeclaration,
  root: string,
): TreeTraversal | null {
  if (
    declaration.id === null ||
    declaration.async ||
    declaration.generator ||
    declaration.params.length !== 1 ||
    declaration.params[0]?.type !== 'Identifier' ||
    declaration.body.body.length !== 4
  ) {
    return null;
  }

  const traversalName = declaration.id.name;
  const parameter = declaration.params[0];
  const [guard, ...steps] = declaration.body.body;
  if (!isNullGuard(guard, parameter)) return null;

  let leftCalls = 0;
  let rightCalls = 0;
  let visit: TreeVisit | null = null;

  for (const step of steps) {
    const child = recursiveChild(step, declaration, parameter);
    if (child === 'left') {
      leftCalls += 1;
      continue;
    }
    if (child === 'right') {
      rightCalls += 1;
      continue;
    }

    const matchedVisit = matchTreeVisit(step, parameter);
    if (matchedVisit === null || visit !== null) return null;
    visit = matchedVisit;
  }

  if (leftCalls !== 1 || rightCalls !== 1 || visit === null) return null;

  const calls: CallExpression[] = [];
  let unsafeReference = false;

  walkAst(program, (node, parent, _grandparent, insideUnsupportedScope) => {
    if (
      (node.start > declaration.start && node.end < declaration.end) ||
      node === declaration.id ||
      !isIdentifierReference(node, parent, traversalName)
    ) {
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
      calls.push(parent);
      return;
    }

    unsafeReference = true;
  });

  const initialCall = calls[0];
  if (
    unsafeReference ||
    calls.length !== 1 ||
    initialCall === undefined ||
    initialCall.arguments.length !== 1 ||
    initialCall.arguments[0]?.type !== 'Identifier' ||
    initialCall.arguments[0].name !== root
  ) {
    return null;
  }

  return { initialCall, visit };
}

function isNullGuard(
  node: AnyNode | undefined,
  parameter: Identifier,
): boolean {
  if (
    node?.type !== 'IfStatement' ||
    node.alternate !== null ||
    node.test.type !== 'BinaryExpression' ||
    node.test.operator !== '===' ||
    node.consequent.type !== 'ReturnStatement' ||
    node.consequent.argument !== null
  ) {
    return false;
  }

  return (
    (node.test.left.type === 'Identifier' &&
      node.test.left.name === parameter.name &&
      node.test.right.type === 'Literal' &&
      node.test.right.value === null) ||
    (node.test.right.type === 'Identifier' &&
      node.test.right.name === parameter.name &&
      node.test.left.type === 'Literal' &&
      node.test.left.value === null)
  );
}

function recursiveChild(
  node: AnyNode,
  traversal: FunctionDeclaration,
  parameter: Identifier,
): 'left' | 'right' | null {
  if (
    node.type !== 'ExpressionStatement' ||
    node.expression.type !== 'CallExpression' ||
    node.expression.optional ||
    node.expression.callee.type !== 'Identifier' ||
    node.expression.callee.name !== traversal.id?.name ||
    node.expression.arguments.length !== 1
  ) {
    return null;
  }

  const argument = node.expression.arguments[0];
  if (
    argument?.type !== 'MemberExpression' ||
    argument.computed ||
    argument.optional ||
    argument.object.type !== 'Identifier' ||
    argument.object.name !== parameter.name ||
    argument.property.type !== 'Identifier' ||
    (argument.property.name !== 'left' && argument.property.name !== 'right')
  ) {
    return null;
  }

  return argument.property.name;
}

function matchTreeVisit(
  node: AnyNode,
  parameter: Identifier,
): TreeVisit | null {
  if (
    node.type !== 'ExpressionStatement' ||
    node.expression.type !== 'CallExpression' ||
    node.expression.optional ||
    node.expression.callee.type !== 'MemberExpression' ||
    node.expression.callee.computed ||
    node.expression.callee.optional ||
    node.expression.callee.object.type !== 'Identifier' ||
    node.expression.callee.object.name !== 'console' ||
    node.expression.callee.property.type !== 'Identifier' ||
    node.expression.callee.property.name !== 'log' ||
    node.expression.arguments.length !== 1
  ) {
    return null;
  }

  const value = node.expression.arguments[0];
  if (
    value?.type !== 'MemberExpression' ||
    value.computed ||
    value.optional ||
    value.object.type !== 'Identifier' ||
    value.object.name !== parameter.name ||
    value.property.type !== 'Identifier' ||
    value.property.name !== 'value'
  ) {
    return null;
  }

  const line = sourceLine(value);
  return line === null ? null : { statement: node, parameter, line };
}

function hasUnsafeTreeUsage(
  program: Program,
  declaration: VariableDeclaration,
  traversal: TreeTraversal,
  root: string,
): boolean {
  const initialRoot = traversal.initialCall.arguments[0];
  let unsafe = false;

  walkAst(program, (node, parent) => {
    if (
      isRootWrite(node, root) ||
      (isIdentifierReference(node, parent, root) &&
        node !== declaration.declarations[0]?.id &&
        node !== initialRoot)
    ) {
      unsafe = true;
    }
  });

  return unsafe;
}
