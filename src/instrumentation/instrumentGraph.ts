import {
  type AnyNode,
  type ArrayExpression,
  type BlockStatement,
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
  readonly nodeVisitPoint: AnyNode;
  readonly nodeVisitLine: number;
  readonly neighbor: Identifier;
  readonly edgeVisitPoint: AnyNode;
  readonly edgeVisitLine: number;
  readonly rootReferences: readonly Identifier[];
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
    candidate.traversal.nodeVisitPoint.start,
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
      start: candidate.traversal.nodeVisitPoint.start,
      end: candidate.traversal.nodeVisitPoint.start,
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
    const traversal =
      findBreadthFirstTraversal(
        binding,
        declaration,
        new Set(nodes.map(({ id }) => id)),
      ) ?? findKahnTraversal(binding);
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

function findBreadthFirstTraversal(
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
    nodeVisitPoint: nodeVisit,
    nodeVisitLine,
    neighbor: neighborLoop.neighbor,
    edgeVisitPoint: neighborLoop.edgeVisitPoint,
    edgeVisitLine: neighborLoop.edgeVisitLine,
    rootReferences: [neighborLoop.rootReference],
  };
}

function findKahnTraversal(
  binding: PrimaryOperationBinding,
): GraphTraversal | null {
  const statements = binding.scope.body.body;
  if (
    binding.scope.owner === null ||
    binding.scope.owner.async ||
    binding.scope.owner.generator ||
    statements.length !== 8
  ) {
    return null;
  }

  const indegree = matchEmptyCollectionDeclaration(
    statements[0],
    'const',
    'ObjectExpression',
  );
  const initialization = matchObjectKeysLoop(statements[1], binding.root);
  if (
    indegree === null ||
    initialization === null ||
    initialization.body.body.length !== 1 ||
    !matchesIndexedAssignment(
      initialization.body.body[0],
      indegree.name,
      initialization.item.name,
      0,
    )
  ) {
    return null;
  }

  const incrementLoop = matchObjectKeysLoop(statements[2], binding.root);
  if (incrementLoop === null || incrementLoop.body.body.length !== 1) {
    return null;
  }

  const incrementStatement = incrementLoop.body.body[0];
  if (incrementStatement === undefined) return null;

  const incrementEdges = matchAdjacencyLoop(
    incrementStatement,
    binding.root,
    incrementLoop.item.name,
  );
  if (
    incrementEdges === null ||
    incrementEdges.body.body.length !== 1 ||
    !matchesIndexedUpdate(
      incrementEdges.body.body[0],
      indegree.name,
      incrementEdges.item.name,
      '++',
    )
  ) {
    return null;
  }

  const queue = matchEmptyCollectionDeclaration(
    statements[3],
    'const',
    'ArrayExpression',
  );
  const queueSeed = matchObjectKeysLoop(statements[4], binding.root);
  if (
    queue === null ||
    queueSeed === null ||
    queueSeed.body.body.length !== 1 ||
    !matchesZeroIndegreeEnqueue(
      queueSeed.body.body[0],
      indegree.name,
      queue.name,
      queueSeed.item.name,
    )
  ) {
    return null;
  }

  const completed = matchZeroDeclaration(statements[5]);
  const loop = statements[6];
  if (
    completed === null ||
    loop?.type !== 'WhileStatement' ||
    !matchesNonEmptyQueue(loop.test, queue.name) ||
    loop.body.type !== 'BlockStatement' ||
    loop.body.body.length !== 3
  ) {
    return null;
  }

  const [dequeueStatement, completionStatement, outgoingStatement] =
    loop.body.body;
  const dequeued = matchQueueShift(dequeueStatement, queue.name);
  if (
    dequeued === null ||
    completionStatement === undefined ||
    !matchesIdentifierUpdate(completionStatement, completed.name, '++') ||
    outgoingStatement === undefined
  ) {
    return null;
  }

  const outgoing = matchAdjacencyLoop(
    outgoingStatement,
    binding.root,
    dequeued.name,
  );
  const dequeueLine =
    dequeueStatement === undefined ? null : sourceLine(dequeueStatement);
  const decrementStatement = outgoing?.body.body[0];
  const enqueueStatement = outgoing?.body.body[1];
  if (
    outgoing === null ||
    dequeueLine === null ||
    outgoing.body.body.length !== 2 ||
    decrementStatement === undefined ||
    enqueueStatement === undefined ||
    !matchesIndexedUpdate(
      decrementStatement,
      indegree.name,
      outgoing.item.name,
      '--',
    ) ||
    !matchesZeroIndegreeEnqueue(
      enqueueStatement,
      indegree.name,
      queue.name,
      outgoing.item.name,
    )
  ) {
    return null;
  }

  const returnedRoot = matchKahnReturn(
    statements[7],
    completed.name,
    binding.root,
  );
  const edgeVisitLine = sourceLine(outgoing.access);
  if (returnedRoot === null || edgeVisitLine === null) return null;

  return {
    node: dequeued,
    nodeVisitPoint: completionStatement,
    nodeVisitLine: dequeueLine,
    neighbor: outgoing.item,
    edgeVisitPoint: decrementStatement,
    edgeVisitLine,
    rootReferences: [
      initialization.rootReference,
      incrementLoop.rootReference,
      incrementEdges.rootReference,
      queueSeed.rootReference,
      outgoing.rootReference,
      returnedRoot,
    ],
  };
}

function matchEmptyCollectionDeclaration(
  node: AnyNode | undefined,
  kind: 'const',
  initializerType: 'ArrayExpression' | 'ObjectExpression',
): Identifier | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== kind ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  if (
    declarator?.id.type !== 'Identifier' ||
    declarator.init?.type !== initializerType
  ) {
    return null;
  }

  const isEmpty =
    declarator.init.type === 'ArrayExpression'
      ? declarator.init.elements.length === 0
      : declarator.init.properties.length === 0;
  return isEmpty ? declarator.id : null;
}

function matchObjectKeysLoop(
  node: AnyNode | undefined,
  root: string,
): {
  readonly item: Identifier;
  readonly body: BlockStatement;
  readonly rootReference: Identifier;
} | null {
  if (
    node?.type !== 'ForOfStatement' ||
    node.await ||
    node.left.type !== 'VariableDeclaration' ||
    node.left.kind !== 'const' ||
    node.left.declarations.length !== 1 ||
    node.left.declarations[0]?.id.type !== 'Identifier' ||
    node.body.type !== 'BlockStatement'
  ) {
    return null;
  }

  const rootReference = matchObjectKeysCall(node.right, root);
  return rootReference === null
    ? null
    : {
        item: node.left.declarations[0].id,
        body: node.body,
        rootReference,
      };
}

function matchObjectKeysCall(node: AnyNode, root: string): Identifier | null {
  if (
    node.type !== 'CallExpression' ||
    node.optional ||
    node.callee.type !== 'MemberExpression' ||
    node.callee.computed ||
    node.callee.optional ||
    node.callee.object.type !== 'Identifier' ||
    node.callee.object.name !== 'Object' ||
    node.callee.property.type !== 'Identifier' ||
    node.callee.property.name !== 'keys' ||
    node.arguments.length !== 1
  ) {
    return null;
  }

  const argument = node.arguments[0];
  return argument?.type === 'Identifier' && argument.name === root
    ? argument
    : null;
}

function matchAdjacencyLoop(
  node: AnyNode,
  root: string,
  sourceNode: string,
): {
  readonly item: Identifier;
  readonly access: MemberExpression;
  readonly rootReference: Identifier;
  readonly body: BlockStatement;
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
    node.right.property.name !== sourceNode ||
    node.body.type !== 'BlockStatement'
  ) {
    return null;
  }

  return {
    item: node.left.declarations[0].id,
    access: node.right,
    rootReference: node.right.object,
    body: node.body,
  };
}

function matchesIndexedAssignment(
  node: AnyNode | undefined,
  object: string,
  property: string,
  value: number,
): boolean {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'AssignmentExpression' &&
    node.expression.operator === '=' &&
    matchesIndexedMember(node.expression.left, object, property) &&
    node.expression.right.type === 'Literal' &&
    node.expression.right.value === value
  );
}

function matchesIndexedUpdate(
  node: AnyNode | undefined,
  object: string,
  property: string,
  operator: '++' | '--',
): boolean {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'UpdateExpression' &&
    !node.expression.prefix &&
    node.expression.operator === operator &&
    matchesIndexedMember(node.expression.argument, object, property)
  );
}

function matchesIndexedMember(
  node: AnyNode,
  object: string,
  property: string,
): boolean {
  return (
    node.type === 'MemberExpression' &&
    node.computed &&
    !node.optional &&
    node.object.type === 'Identifier' &&
    node.object.name === object &&
    node.property.type === 'Identifier' &&
    node.property.name === property
  );
}

function matchesZeroIndegreeEnqueue(
  node: AnyNode | undefined,
  indegree: string,
  queue: string,
  course: string,
): boolean {
  return (
    node?.type === 'IfStatement' &&
    node.alternate === null &&
    node.test.type === 'BinaryExpression' &&
    node.test.operator === '===' &&
    matchesIndexedMember(node.test.left, indegree, course) &&
    node.test.right.type === 'Literal' &&
    node.test.right.value === 0 &&
    isSingleArgumentCall(node.consequent, queue, 'push', course)
  );
}

function matchZeroDeclaration(node: AnyNode | undefined): Identifier | null {
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

function matchesNonEmptyQueue(node: AnyNode, queue: string): boolean {
  return (
    node.type === 'BinaryExpression' &&
    node.operator === '>' &&
    node.left.type === 'MemberExpression' &&
    !node.left.computed &&
    !node.left.optional &&
    node.left.object.type === 'Identifier' &&
    node.left.object.name === queue &&
    node.left.property.type === 'Identifier' &&
    node.left.property.name === 'length' &&
    node.right.type === 'Literal' &&
    node.right.value === 0
  );
}

function matchQueueShift(
  node: AnyNode | undefined,
  queue: string,
): Identifier | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'const' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  const call = declarator?.init;
  return declarator?.id.type === 'Identifier' &&
    call?.type === 'CallExpression' &&
    !call.optional &&
    call.arguments.length === 0 &&
    call.callee.type === 'MemberExpression' &&
    !call.callee.computed &&
    !call.callee.optional &&
    call.callee.object.type === 'Identifier' &&
    call.callee.object.name === queue &&
    call.callee.property.type === 'Identifier' &&
    call.callee.property.name === 'shift'
    ? declarator.id
    : null;
}

function matchesIdentifierUpdate(
  node: AnyNode,
  identifier: string,
  operator: '++' | '--',
): boolean {
  return (
    node.type === 'ExpressionStatement' &&
    node.expression.type === 'UpdateExpression' &&
    !node.expression.prefix &&
    node.expression.operator === operator &&
    node.expression.argument.type === 'Identifier' &&
    node.expression.argument.name === identifier
  );
}

function matchKahnReturn(
  node: AnyNode | undefined,
  completed: string,
  root: string,
): Identifier | null {
  if (
    node?.type !== 'ReturnStatement' ||
    node.argument?.type !== 'BinaryExpression' ||
    node.argument.operator !== '===' ||
    node.argument.left.type !== 'Identifier' ||
    node.argument.left.name !== completed ||
    node.argument.right.type !== 'MemberExpression' ||
    node.argument.right.computed ||
    node.argument.right.optional ||
    node.argument.right.property.type !== 'Identifier' ||
    node.argument.right.property.name !== 'length'
  ) {
    return null;
  }

  return matchObjectKeysCall(node.argument.right.object, root);
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
  readonly rootReference: Identifier;
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
    rootReference: node.right.object,
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
  const allowedRootReferences = new Set<AnyNode>(traversal.rootReferences);

  walkAst(rootNode, (node, parent) => {
    if (isRootWrite(node, root)) {
      unsafe = true;
      return;
    }
    if (!isIdentifierReference(node, parent, root)) return;

    const isDeclaration = node === declaration.declarations[0]?.id;
    const isTraversalAccess = allowedRootReferences.has(node);

    if (!isDeclaration && !isTraversalAccess) unsafe = true;
  });

  return unsafe;
}

function edgeId(from: string, to: string): string {
  return `${from}->${to}`;
}
