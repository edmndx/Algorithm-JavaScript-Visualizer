import {
  type AnyNode,
  type ArrayExpression,
  type ExpressionStatement,
  type Identifier,
  type MemberExpression,
  type ObjectExpression,
  type Program,
  type VariableDeclaration,
} from 'acorn';

import { TRACE_LIMITS } from '../protocol';
import {
  hasUnsafeInstrumentationSyntax,
  isIdentifierReference,
  isRootWrite,
  sourceLine,
  walkAst,
} from './ast';
import { applySourceEdits, lineIndentation, type SourceEdit } from './edits';
import {
  hasSafePrimaryRootUsage,
  primaryOperationBindings,
  type PrimaryOperationBinding,
  type ValidVisualizationSource,
} from './sourceContract';

type StaticGraphNode = {
  readonly id: string;
  readonly neighbors: readonly string[];
};

type GraphTraversal = {
  readonly node: Identifier;
  readonly nodeVisit: ExpressionStatement;
  readonly nodeVisitLine: number;
  readonly neighbor: Identifier;
  readonly adjacencyAccess: MemberExpression;
  readonly edgeVisitPoint: AnyNode;
  readonly edgeVisitLine: number;
};

type GraphCandidate = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly nodes: readonly StaticGraphNode[];
  readonly traversal: GraphTraversal;
};

export function instrumentGraph(
  source: string,
  program: Program,
  contract: ValidVisualizationSource,
): string | null {
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  const candidates = findGraphDeclarations(program, contract.identifier)
    .map(({ declaration, nodes }) => analyzeGraph(contract, declaration, nodes))
    .filter((candidate): candidate is GraphCandidate => candidate !== null);

  const candidate = candidates[0];
  if (candidates.length !== 1 || candidate === undefined) return null;

  const traceNodes = candidate.nodes
    .map(
      ({ id }) => `{ id: ${JSON.stringify(id)}, label: ${JSON.stringify(id)} }`,
    )
    .join(', ');
  const traceEdges = candidate.nodes
    .flatMap(({ id: from, neighbors }) =>
      neighbors.map(
        (to) =>
          `{ id: ${JSON.stringify(edgeId(from, to))}, from: ${JSON.stringify(from)}, to: ${JSON.stringify(to)}, directed: true }`,
      ),
    )
    .join(', ');
  const nodeIndentation = lineIndentation(
    source,
    candidate.traversal.nodeVisit.start,
  );
  const edgeIndentation = lineIndentation(
    source,
    candidate.traversal.edgeVisitPoint.start,
  );
  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text:
        `;\ntrace.initialize({ structure: 'graph', source: { line: ${candidate.declarationLine} } });\n` +
        `trace.createGraph({ nodes: [${traceNodes}], edges: [${traceEdges}], layout: 'circular', source: { line: ${candidate.declarationLine} } });\n`,
    },
    {
      start: candidate.traversal.nodeVisit.start,
      end: candidate.traversal.nodeVisit.start,
      text:
        `trace.visit({ nodeId: ${candidate.traversal.node.name}, source: { line: ${candidate.traversal.nodeVisitLine} } });\n` +
        nodeIndentation,
    },
    {
      start: candidate.traversal.edgeVisitPoint.start,
      end: candidate.traversal.edgeVisitPoint.start,
      text:
        `trace.visitEdge({ edgeId: ${candidate.traversal.node.name} + '->' + ${candidate.traversal.neighbor.name}, source: { line: ${candidate.traversal.edgeVisitLine} } });\n` +
        edgeIndentation,
    },
  ];

  return applySourceEdits(source, edits);
}

function findGraphDeclarations(
  program: Program,
  identifier: string,
): Array<{
  readonly declaration: VariableDeclaration;
  readonly nodes: readonly StaticGraphNode[];
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

    const nodes = readStaticGraph(declarator.init);
    return nodes === null ? [] : [{ declaration: statement, nodes }];
  });
}

function readStaticGraph(
  expression: ObjectExpression,
): readonly StaticGraphNode[] | null {
  if (
    expression.properties.length === 0 ||
    expression.properties.length > TRACE_LIMITS.collectionItems
  ) {
    return null;
  }

  const nodes: StaticGraphNode[] = [];
  const nodeIds = new Set<string>();

  for (const property of expression.properties) {
    if (
      property.type !== 'Property' ||
      property.kind !== 'init' ||
      property.computed ||
      property.method ||
      property.value.type !== 'ArrayExpression'
    ) {
      return null;
    }

    const id = staticPropertyName(property.key);
    const neighbors = readStaticNeighbors(property.value);
    if (
      id === null ||
      id.length === 0 ||
      id.length > TRACE_LIMITS.stringLength ||
      id.includes('->') ||
      nodeIds.has(id) ||
      neighbors === null
    ) {
      return null;
    }

    nodeIds.add(id);
    nodes.push({ id, neighbors });
  }

  const edges = nodes.flatMap(({ id: from, neighbors }) =>
    neighbors.map((to) => edgeId(from, to)),
  );
  const valid =
    edges.length <= TRACE_LIMITS.collectionItems &&
    edges.every((id) => id.length <= TRACE_LIMITS.stringLength) &&
    nodes.every(({ neighbors }) =>
      neighbors.every((neighbor) => nodeIds.has(neighbor)),
    );

  return valid ? nodes : null;
}

function readStaticNeighbors(
  expression: ArrayExpression,
): readonly string[] | null {
  if (expression.elements.length > TRACE_LIMITS.collectionItems) return null;

  const neighbors: string[] = [];
  for (const element of expression.elements) {
    if (
      element?.type !== 'Literal' ||
      typeof element.value !== 'string' ||
      element.value.length === 0 ||
      element.value.length > TRACE_LIMITS.stringLength ||
      element.value.includes('->') ||
      neighbors.includes(element.value)
    ) {
      return null;
    }

    neighbors.push(element.value);
  }

  return neighbors;
}

function staticPropertyName(node: AnyNode): string | null {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value;
  }
  return null;
}

function analyzeGraph(
  contract: ValidVisualizationSource,
  declaration: VariableDeclaration,
  nodes: readonly StaticGraphNode[],
): GraphCandidate | null {
  const declarator = declaration.declarations[0];
  const declarationLine = sourceLine(declaration);
  if (declarator?.id.type !== 'Identifier' || declarationLine === null) {
    return null;
  }

  const candidates = primaryOperationBindings(contract).flatMap((binding) => {
    const traversal = findGraphTraversal(
      binding,
      declaration,
      new Set(nodes.map(({ id }) => id)),
    );
    return traversal !== null &&
      hasSafePrimaryRootUsage(contract, binding) &&
      !hasUnsafeGraphUsage(
        binding.scope.body,
        declaration,
        traversal,
        binding.root,
      )
      ? [traversal]
      : [];
  });
  const traversal = candidates[0];
  if (candidates.length !== 1 || traversal === undefined) return null;

  return { declaration, declarationLine, nodes, traversal };
}

function findGraphTraversal(
  binding: PrimaryOperationBinding,
  declaration: VariableDeclaration,
  nodeIds: ReadonlySet<string>,
): GraphTraversal | null {
  const statements =
    binding.scope.owner === null
      ? binding.scope.body.body.slice(
          binding.scope.body.body.indexOf(declaration) + 1,
        )
      : binding.scope.body.body;
  if (statements.length !== 4) return null;

  const queueSeed = matchQueueDeclaration(statements[0], nodeIds);
  if (queueSeed === null) return null;

  const visited = matchVisitedDeclaration(statements[1], queueSeed.seed);
  const head = matchHeadDeclaration(statements[2]);
  const loop = statements[3];
  if (
    visited === null ||
    head === null ||
    loop?.type !== 'WhileStatement' ||
    !matchesTraversalCondition(loop.test, head.name, queueSeed.queue.name) ||
    loop.body.type !== 'BlockStatement' ||
    loop.body.body.length !== 3
  ) {
    return null;
  }

  const [extractionStatement, nodeVisit, neighborStatement] = loop.body.body;
  if (extractionStatement?.type !== 'VariableDeclaration') return null;

  const extracted = matchQueueExtraction(extractionStatement);
  if (
    extracted === null ||
    extracted.queue.name !== queueSeed.queue.name ||
    extracted.head.name !== head.name ||
    nodeVisit?.type !== 'ExpressionStatement' ||
    !isConsoleVisit(nodeVisit, extracted.node) ||
    neighborStatement === undefined
  ) {
    return null;
  }

  const nodeVisitLine = sourceLine(nodeVisit);
  const neighborLoop = matchNeighborLoop(
    neighborStatement,
    binding.root,
    extracted.node,
    extracted.queue,
    visited.name,
  );
  if (nodeVisitLine === null || neighborLoop === null) return null;

  return {
    node: extracted.node,
    nodeVisit,
    nodeVisitLine,
    neighbor: neighborLoop.neighbor,
    adjacencyAccess: neighborLoop.adjacencyAccess,
    edgeVisitPoint: neighborLoop.edgeVisitPoint,
    edgeVisitLine: neighborLoop.edgeVisitLine,
  };
}

function matchQueueDeclaration(
  node: AnyNode | undefined,
  nodeIds: ReadonlySet<string>,
): { readonly queue: Identifier; readonly seed: string } | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'const' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  const seed =
    declarator?.init?.type === 'ArrayExpression'
      ? declarator.init.elements[0]
      : null;
  return declarator?.id.type === 'Identifier' &&
    declarator?.init?.type === 'ArrayExpression' &&
    declarator.init.elements.length === 1 &&
    seed?.type === 'Literal' &&
    typeof seed.value === 'string' &&
    nodeIds.has(seed.value)
    ? { queue: declarator.id, seed: seed.value }
    : null;
}

function matchVisitedDeclaration(
  node: AnyNode | undefined,
  seed: string,
): Identifier | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'const' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  const argument =
    declarator?.init?.type === 'NewExpression'
      ? declarator.init.arguments[0]
      : null;
  const element =
    argument?.type === 'ArrayExpression' ? argument.elements[0] : null;

  return declarator?.id.type === 'Identifier' &&
    declarator.init?.type === 'NewExpression' &&
    declarator.init.callee.type === 'Identifier' &&
    declarator.init.callee.name === 'Set' &&
    declarator.init.arguments.length === 1 &&
    argument?.type === 'ArrayExpression' &&
    argument.elements.length === 1 &&
    element?.type === 'Literal' &&
    element.value === seed
    ? declarator.id
    : null;
}

function matchHeadDeclaration(node: AnyNode | undefined): Identifier | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'let' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  return declarator?.id.type === 'Identifier' &&
    declarator.init?.type === 'Literal' &&
    declarator.init.value === 0
    ? declarator.id
    : null;
}

function matchesTraversalCondition(
  node: AnyNode,
  head: string,
  queue: string,
): boolean {
  return (
    node.type === 'BinaryExpression' &&
    node.operator === '<' &&
    node.left.type === 'Identifier' &&
    node.left.name === head &&
    node.right.type === 'MemberExpression' &&
    !node.right.computed &&
    !node.right.optional &&
    node.right.object.type === 'Identifier' &&
    node.right.object.name === queue &&
    node.right.property.type === 'Identifier' &&
    node.right.property.name === 'length'
  );
}

function matchQueueExtraction(declaration: VariableDeclaration): {
  readonly node: Identifier;
  readonly queue: Identifier;
  readonly head: Identifier;
} | null {
  if (declaration.kind !== 'const' || declaration.declarations.length !== 1) {
    return null;
  }

  const declarator = declaration.declarations[0];
  if (
    declarator?.id.type !== 'Identifier' ||
    declarator.init?.type !== 'MemberExpression' ||
    !declarator.init.computed ||
    declarator.init.optional ||
    declarator.init.object.type !== 'Identifier' ||
    declarator.init.property.type !== 'UpdateExpression' ||
    declarator.init.property.operator !== '++' ||
    declarator.init.property.prefix ||
    declarator.init.property.argument.type !== 'Identifier'
  ) {
    return null;
  }

  return {
    node: declarator.id,
    queue: declarator.init.object,
    head: declarator.init.property.argument,
  };
}

function isConsoleVisit(node: AnyNode, value: Identifier): boolean {
  return (
    node.type === 'ExpressionStatement' &&
    node.expression.type === 'CallExpression' &&
    !node.expression.optional &&
    node.expression.callee.type === 'MemberExpression' &&
    !node.expression.callee.computed &&
    !node.expression.callee.optional &&
    node.expression.callee.object.type === 'Identifier' &&
    node.expression.callee.object.name === 'console' &&
    node.expression.callee.property.type === 'Identifier' &&
    node.expression.callee.property.name === 'log' &&
    node.expression.arguments.length === 1 &&
    node.expression.arguments[0]?.type === 'Identifier' &&
    node.expression.arguments[0].name === value.name
  );
}

function matchNeighborLoop(
  node: AnyNode,
  root: string,
  currentNode: Identifier,
  queue: Identifier,
  visited: string,
): {
  readonly neighbor: Identifier;
  readonly adjacencyAccess: MemberExpression;
  readonly edgeVisitPoint: AnyNode;
  readonly edgeVisitLine: number;
} | null {
  if (
    node.type !== 'ForOfStatement' ||
    node.await ||
    node.left.type !== 'VariableDeclaration' ||
    node.left.kind !== 'const' ||
    node.left.declarations.length !== 1 ||
    node.left.declarations[0]?.id.type !== 'Identifier' ||
    node.right.type !== 'MemberExpression' ||
    !node.right.computed ||
    node.right.optional ||
    node.right.object.type !== 'Identifier' ||
    node.right.object.name !== root ||
    node.right.property.type !== 'Identifier' ||
    node.right.property.name !== currentNode.name ||
    node.body.type !== 'BlockStatement'
  ) {
    return null;
  }

  const neighbor = node.left.declarations[0].id;
  const edgeVisitPoint = node.body.body[0];
  const edgeVisitLine = sourceLine(node.right);
  if (
    node.body.body.length !== 1 ||
    edgeVisitPoint === undefined ||
    edgeVisitLine === null ||
    !matchesDiscoveryGuard(edgeVisitPoint, queue.name, visited, neighbor.name)
  ) {
    return null;
  }

  return {
    neighbor,
    adjacencyAccess: node.right,
    edgeVisitPoint,
    edgeVisitLine,
  };
}

function matchesDiscoveryGuard(
  node: AnyNode,
  queue: string,
  visited: string,
  neighbor: string,
): boolean {
  if (
    node.type !== 'IfStatement' ||
    node.alternate !== null ||
    node.test.type !== 'UnaryExpression' ||
    node.test.operator !== '!' ||
    node.test.argument.type !== 'CallExpression' ||
    node.test.argument.callee.type !== 'MemberExpression' ||
    node.test.argument.callee.object.type !== 'Identifier' ||
    node.test.argument.callee.object.name !== visited ||
    node.test.argument.callee.property.type !== 'Identifier' ||
    node.test.argument.callee.property.name !== 'has' ||
    node.test.argument.arguments.length !== 1 ||
    node.test.argument.arguments[0]?.type !== 'Identifier' ||
    node.test.argument.arguments[0].name !== neighbor ||
    node.consequent.type !== 'BlockStatement' ||
    node.consequent.body.length !== 2
  ) {
    return false;
  }

  return (
    isSingleArgumentCall(node.consequent.body[0], visited, 'add', neighbor) &&
    isSingleArgumentCall(node.consequent.body[1], queue, 'push', neighbor)
  );
}

function isSingleArgumentCall(
  node: AnyNode | undefined,
  root: string,
  method: string,
  argument: string,
): boolean {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'CallExpression' &&
    !node.expression.optional &&
    node.expression.callee.type === 'MemberExpression' &&
    !node.expression.callee.computed &&
    !node.expression.callee.optional &&
    node.expression.callee.object.type === 'Identifier' &&
    node.expression.callee.object.name === root &&
    node.expression.callee.property.type === 'Identifier' &&
    node.expression.callee.property.name === method &&
    node.expression.arguments.length === 1 &&
    node.expression.arguments[0]?.type === 'Identifier' &&
    node.expression.arguments[0].name === argument
  );
}

function hasUnsafeGraphUsage(
  rootNode: AnyNode,
  declaration: VariableDeclaration,
  traversal: GraphTraversal,
  root: string,
): boolean {
  let unsafe = false;

  walkAst(rootNode, (node, parent) => {
    if (isRootWrite(node, root)) {
      unsafe = true;
      return;
    }
    if (!isIdentifierReference(node, parent, root)) return;

    const isDeclaration = node === declaration.declarations[0]?.id;
    const isTraversalAccess = node === traversal.adjacencyAccess.object;

    if (!isDeclaration && !isTraversalAccess) unsafe = true;
  });

  return unsafe;
}

function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}
