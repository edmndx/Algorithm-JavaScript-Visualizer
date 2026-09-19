import type {
  AnyNode,
  CallExpression,
  ExpressionStatement,
  ForOfStatement,
  FunctionDeclaration,
  Identifier,
  ObjectExpression,
  ReturnStatement,
  VariableDeclaration,
} from 'acorn';
import { isNamed } from '../matchers';
import { createIdentifierAllocator, parseJavaScript, walkAst } from '../ast';
import {
  applySourceEdits,
  sourceSpan as location,
  type SourceEdit,
  frameCall,
  beforeNode as before,
  afterNode as after,
} from '../edits';
import { readStaticGraph, type StaticGraphNode } from './staticGraph';

type GraphDeclaration = VariableDeclaration & {
  readonly declarations: readonly [
    { readonly id: Identifier; readonly init: ObjectExpression },
  ];
};

type Match = {
  readonly declaration: GraphDeclaration;
  readonly nodes: readonly StaticGraphNode[];
  readonly seen: Identifier;
  readonly order: Identifier;
  readonly start: Identifier;
  readonly node: Identifier;
  readonly neighbor: Identifier;
  readonly callee: Identifier;
  readonly orderDeclaration: VariableDeclaration;
  readonly seenAdd: ExpressionStatement;
  readonly orderPush: ExpressionStatement;
  readonly checkCall: CallExpression;
  readonly recursiveCall: ExpressionStatement;
  readonly initialCall: ExpressionStatement;
  readonly result: ReturnStatement;
};

export function instrumentDepthFirstFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (program === null) return null;
  if (
    program.body.some(
      (statement) =>
        (statement.type === 'VariableDeclaration' &&
          statement.declarations.some((entry) => isNamed(entry.id, 'Set'))) ||
        (statement.type === 'FunctionDeclaration' &&
          statement.id?.name === 'Set'),
    )
  )
    return null;
  const matches: Match[] = [];
  for (const statement of program.body) {
    if (!isGraphDeclaration(statement)) continue;
    const nodes = readStaticGraph(statement.declarations[0].init);
    if (nodes === null) continue;
    for (const fn of program.body) {
      if (fn.type !== 'FunctionDeclaration') continue;
      const match = matchDepthFirst(program, statement, nodes, fn);
      if (match !== null) matches.push(match);
    }
  }
  const match = matches[0];
  if (matches.length !== 1 || match === undefined) return null;
  const {
    declaration,
    nodes,
    seen,
    order,
    start,
    node,
    neighbor,
    callee,
    orderDeclaration,
    seenAdd,
    orderPush,
    checkCall,
    recursiveCall,
    initialCall,
    result,
  } = match;
  const path = createIdentifierAllocator(program, '__trace_path')();
  const active = createIdentifierAllocator(program, '__trace_active')();
  const nodesPayload = nodes
    .map(
      ({ id }) => `{ id: ${JSON.stringify(id)}, label: ${JSON.stringify(id)} }`,
    )
    .join(', ');
  const edgesPayload = nodes
    .flatMap(({ id, neighbors }) =>
      neighbors.map(
        (to) =>
          `{ id: ${JSON.stringify(`${id}->${to}`)}, from: ${JSON.stringify(id)}, to: ${JSON.stringify(to)}, directed: true }`,
      ),
    )
    .join(', ');
  const frame = (
    sourceNode: AnyNode,
    operation: string,
    commands: readonly string[],
  ) => `\n${frameCall(sourceNode, operation, commands)}\n`;
  const pathCommands = [
    `{ type: 'graph.markNodes', marker: 'path', nodeIds: [...${active}] }`,
    `{ type: 'graph.markEdges', marker: 'path', edgeIds: [...${path}] }`,
  ];
  const edits: SourceEdit[] = [
    after(
      declaration,
      `\ntrace.initialize({ type: 'scene.init', structure: 'graph' }, { type: 'graph.create', nodes: [${nodesPayload}], edges: [${edgesPayload}], layout: 'circular' });\nconst ${path} = [];\nconst ${active} = [];\n`,
    ),
    after(
      orderDeclaration,
      frame(
        orderDeclaration,
        `{ type: 'assign', target: ${JSON.stringify(order.name)}, before: null, value: [] }`,
        [],
      ),
    ),
    after(
      seenAdd,
      frame(
        seenAdd,
        `{ type: 'collection', action: 'add', role: 'visited', item: ${node.name} }`,
        [`{ type: 'graph.visitNode', nodeId: ${node.name} }`],
      ),
    ),
    after(
      orderPush,
      frame(
        orderPush,
        `{ type: 'collection', action: 'append', role: 'traversal', item: ${node.name} }`,
        [],
      ),
    ),
    {
      start: checkCall.start,
      end: checkCall.end,
      text: `trace.checkGraphNeighbor(${seen.name}, ${neighbor.name}, ${node.name}, ${location(checkCall)}, 'visited')`,
    },
    before(
      recursiveCall,
      `\n${path}.push(${node.name} + '->' + ${neighbor.name});\n${active}.push(${neighbor.name});` +
        frame(
          recursiveCall,
          `{ type: 'call', callee: ${JSON.stringify(callee.name)}, from: ${node.name}, target: ${neighbor.name} }`,
          pathCommands,
        ),
    ),
    after(
      recursiveCall,
      `\n${path}.pop();\n${active}.pop();` +
        frame(
          recursiveCall,
          `{ type: 'return', value: { kind: 'undefined' }, from: ${neighbor.name}, to: ${node.name} }`,
          pathCommands,
        ),
    ),
    before(
      initialCall,
      `\n${active}.push(${start.name});` +
        frame(
          initialCall,
          `{ type: 'call', callee: ${JSON.stringify(callee.name)}, from: null, target: ${start.name} }`,
          pathCommands,
        ),
    ),
    after(
      initialCall,
      `\n${active}.pop();` +
        frame(
          initialCall,
          `{ type: 'return', value: { kind: 'undefined' }, from: ${start.name}, to: null }`,
          pathCommands,
        ),
    ),
    {
      start: result.argument!.start,
      end: result.argument!.end,
      text: `trace.returnValue(${order.name}, ${location(result)}, 'traversal order')`,
    },
  ];
  return applySourceEdits(source, edits);
}

function matchDepthFirst(
  program: NonNullable<ReturnType<typeof parseJavaScript>>,
  declaration: GraphDeclaration,
  nodes: readonly StaticGraphNode[],
  fn: FunctionDeclaration,
): Match | null {
  if (
    fn.id === null ||
    fn.params.length !== 2 ||
    fn.params[0]?.type !== 'Identifier' ||
    fn.params[1]?.type !== 'Identifier'
  )
    return null;
  const graph = fn.params[0];
  const start = fn.params[1];
  const root = declaration.declarations[0].id.name;
  const calls: CallExpression[] = [];
  walkAst(program, (candidate) => {
    if (
      candidate.type === 'CallExpression' &&
      isNamed(candidate.callee, fn.id?.name ?? '') &&
      candidate.arguments.length === 2 &&
      isNamed(candidate.arguments[0], root)
    )
      calls.push(candidate);
  });
  const startArg = calls[0]?.arguments[1];
  if (
    calls.length !== 1 ||
    startArg?.type !== 'Literal' ||
    typeof startArg.value !== 'string' ||
    !nodes.some(({ id }) => id === startArg.value)
  )
    return null;
  const body = fn.body.body;
  if (body.length !== 5) return null;
  const [seenDeclaration, orderDeclaration, inner, initialCall, result] = body;
  if (
    seenDeclaration?.type !== 'VariableDeclaration' ||
    orderDeclaration?.type !== 'VariableDeclaration' ||
    inner?.type !== 'FunctionDeclaration' ||
    inner.id === null ||
    initialCall?.type !== 'ExpressionStatement' ||
    result?.type !== 'ReturnStatement'
  )
    return null;
  const seen = singleBinding(seenDeclaration);
  const order = singleBinding(orderDeclaration);
  if (
    seen === null ||
    order === null ||
    !isEmptySet(seenDeclaration.declarations[0]?.init) ||
    !isEmptyArray(orderDeclaration.declarations[0]?.init) ||
    !isNamed(result.argument, order.name) ||
    inner.params.length !== 1 ||
    inner.params[0]?.type !== 'Identifier' ||
    !isCall(initialCall.expression, inner.id.name, start.name)
  )
    return null;
  const node = inner.params[0];
  const innerBody = inner.body.body;
  if (innerBody.length !== 3) return null;
  const [seenAdd, orderPush, neighborLoop] = innerBody;
  if (
    seenAdd?.type !== 'ExpressionStatement' ||
    orderPush?.type !== 'ExpressionStatement' ||
    neighborLoop?.type !== 'ForOfStatement' ||
    !isMethodCall(seenAdd.expression, seen.name, 'add', node.name) ||
    !isMethodCall(orderPush.expression, order.name, 'push', node.name)
  )
    return null;
  const neighbor = matchNeighborLoop(neighborLoop, graph.name, node.name);
  if (
    neighbor === null ||
    neighborLoop.body.type !== 'BlockStatement' ||
    neighborLoop.body.body.length !== 1
  )
    return null;
  const neighborCheck = neighborLoop.body.body[0];
  if (
    neighborCheck?.type !== 'IfStatement' ||
    neighborCheck.test.type !== 'UnaryExpression' ||
    neighborCheck.test.operator !== '!' ||
    neighborCheck.test.argument.type !== 'CallExpression' ||
    !isMethodCall(
      neighborCheck.test.argument,
      seen.name,
      'has',
      neighbor.name,
    ) ||
    neighborCheck.consequent.type !== 'BlockStatement' ||
    neighborCheck.consequent.body.length !== 1 ||
    neighborCheck.alternate !== null
  )
    return null;
  const recursiveCall = neighborCheck.consequent.body[0];
  if (
    recursiveCall?.type !== 'ExpressionStatement' ||
    !isCall(recursiveCall.expression, inner.id.name, neighbor.name)
  )
    return null;
  return {
    declaration,
    nodes,
    seen,
    order,
    start,
    node,
    neighbor,
    callee: inner.id,
    orderDeclaration,
    seenAdd,
    orderPush,
    checkCall: neighborCheck.test.argument,
    recursiveCall,
    initialCall,
    result,
  };
}

function isGraphDeclaration(node: AnyNode): node is GraphDeclaration {
  return (
    node.type === 'VariableDeclaration' &&
    node.declarations.length === 1 &&
    node.declarations[0]?.id.type === 'Identifier' &&
    node.declarations[0].init?.type === 'ObjectExpression'
  );
}

function singleBinding(statement: VariableDeclaration): Identifier | null {
  if (statement.declarations.length !== 1) return null;
  const id = statement.declarations[0]?.id;
  return id?.type === 'Identifier' ? id : null;
}

function isEmptySet(node: AnyNode | null | undefined): boolean {
  return (
    node?.type === 'NewExpression' &&
    isNamed(node.callee, 'Set') &&
    node.arguments.length === 0
  );
}

function isEmptyArray(node: AnyNode | null | undefined): boolean {
  return node?.type === 'ArrayExpression' && node.elements.length === 0;
}

function isMethodCall(
  node: AnyNode | null | undefined,
  receiver: string,
  method: string,
  argument: string,
): boolean {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    isNamed(node.callee.object, receiver) &&
    isNamed(node.callee.property, method) &&
    node.arguments.length === 1 &&
    isNamed(node.arguments[0], argument)
  );
}

function isCall(
  node: AnyNode | null | undefined,
  callee: string,
  argument: string,
): boolean {
  return (
    node?.type === 'CallExpression' &&
    isNamed(node.callee, callee) &&
    node.arguments.length === 1 &&
    isNamed(node.arguments[0], argument)
  );
}

function matchNeighborLoop(
  loop: ForOfStatement,
  graph: string,
  node: string,
): Identifier | null {
  if (
    loop.left.type !== 'VariableDeclaration' ||
    loop.left.declarations.length !== 1 ||
    loop.left.declarations[0]?.id.type !== 'Identifier' ||
    loop.right.type !== 'MemberExpression' ||
    !loop.right.computed ||
    !isNamed(loop.right.object, graph) ||
    !isNamed(loop.right.property, node)
  )
    return null;
  return loop.left.declarations[0].id;
}
