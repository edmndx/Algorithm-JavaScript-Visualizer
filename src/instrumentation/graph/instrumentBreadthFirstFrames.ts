import type {
  AnyNode,
  CallExpression,
  ExpressionStatement,
  ForOfStatement,
  FunctionDeclaration,
  Identifier,
  IfStatement,
  ObjectExpression,
  ReturnStatement,
  VariableDeclaration,
  WhileStatement,
} from 'acorn';
import { isNamed } from '../matchers';
import { parseJavaScript, walkAst } from '../ast';
import {
  applySourceEdits,
  sourceSpan as location,
  type SourceEdit,
  frameCall,
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
  readonly start: Identifier;
  readonly seen: Identifier;
  readonly queue: Identifier;
  readonly order: Identifier;
  readonly node: Identifier;
  readonly neighbor: Identifier;
  readonly seenDeclaration: VariableDeclaration;
  readonly queueDeclaration: VariableDeclaration;
  readonly orderDeclaration: VariableDeclaration;
  readonly dequeueDeclaration: VariableDeclaration;
  readonly visit: ExpressionStatement;
  readonly neighborCheck: IfStatement;
  readonly membershipCall: CallExpression;
  readonly discover: ExpressionStatement;
  readonly enqueue: ExpressionStatement;
  readonly result: ReturnStatement;
};

export function instrumentBreadthFirstFrames(
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
      const match = matchBreadthFirst(program, statement, nodes, fn);
      if (match !== null) matches.push(match);
    }
  }
  const match = matches[0];
  if (matches.length !== 1 || match === undefined) return null;
  const {
    declaration,
    nodes,
    start,
    seen,
    queue,
    order,
    node,
    neighbor,
    seenDeclaration,
    queueDeclaration,
    orderDeclaration,
    dequeueDeclaration,
    visit,
    membershipCall,
    discover,
    enqueue,
    result,
  } = match;
  const nodeCommands = nodes
    .map(
      ({ id }) => `{ id: ${JSON.stringify(id)}, label: ${JSON.stringify(id)} }`,
    )
    .join(', ');
  const edgeCommands = nodes
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
  const edits: SourceEdit[] = [
    after(
      declaration,
      `\ntrace.initialize({ type: 'scene.init', structure: 'graph' }, { type: 'graph.create', nodes: [${nodeCommands}], edges: [${edgeCommands}], layout: 'circular' });\n`,
    ),
    after(
      seenDeclaration,
      frame(
        seenDeclaration,
        `{ type: 'collection', action: 'add', role: 'discovered', item: ${start.name} }`,
        [`{ type: 'graph.discoverNode', nodeId: ${start.name} }`],
      ),
    ),
    after(
      queueDeclaration,
      frame(
        queueDeclaration,
        `{ type: 'collection', action: 'enqueue', role: 'frontier', item: ${start.name} }`,
        [`{ type: 'graph.frontier', nodeIds: ${queue.name} }`],
      ),
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
      dequeueDeclaration,
      frame(
        dequeueDeclaration,
        `{ type: 'collection', action: 'dequeue', role: 'frontier', item: ${node.name} }`,
        [
          `{ type: 'graph.frontier', nodeIds: ${queue.name} }`,
          `{ type: 'graph.markNodes', marker: 'current', nodeIds: [${node.name}] }`,
        ],
      ),
    ),
    after(
      visit,
      frame(
        visit,
        `{ type: 'collection', action: 'append', role: 'traversal', item: ${node.name} }`,
        [`{ type: 'graph.visitNode', nodeId: ${node.name} }`],
      ),
    ),
    {
      start: membershipCall.start,
      end: membershipCall.end,
      text: `trace.checkGraphNeighbor(${seen.name}, ${neighbor.name}, ${node.name}, ${location(membershipCall)})`,
    },
    after(
      discover,
      frame(
        discover,
        `{ type: 'collection', action: 'add', role: 'discovered', item: ${neighbor.name} }`,
        [`{ type: 'graph.discoverNode', nodeId: ${neighbor.name} }`],
      ),
    ),
    after(
      enqueue,
      frame(
        enqueue,
        `{ type: 'collection', action: 'enqueue', role: 'frontier', item: ${neighbor.name} }`,
        [`{ type: 'graph.frontier', nodeIds: ${queue.name} }`],
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

function matchBreadthFirst(
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
  const call = calls[0];
  const startArgument = call?.arguments[1];
  if (
    calls.length !== 1 ||
    startArgument?.type !== 'Literal' ||
    typeof startArgument.value !== 'string' ||
    !nodes.some(({ id }) => id === startArgument.value)
  )
    return null;
  const body = fn.body.body;
  if (body.length !== 5) return null;
  const [seenDeclaration, queueDeclaration, orderDeclaration, loop, result] =
    body;
  if (
    seenDeclaration?.type !== 'VariableDeclaration' ||
    queueDeclaration?.type !== 'VariableDeclaration' ||
    orderDeclaration?.type !== 'VariableDeclaration' ||
    loop?.type !== 'WhileStatement' ||
    result?.type !== 'ReturnStatement'
  )
    return null;
  const seen = singleBinding(seenDeclaration);
  const queue = singleBinding(queueDeclaration);
  const order = singleBinding(orderDeclaration);
  if (
    seen === null ||
    queue === null ||
    order === null ||
    !isNewSetWithStart(seenDeclaration.declarations[0]?.init, start.name) ||
    !isArrayWithName(queueDeclaration.declarations[0]?.init, start.name) ||
    !isEmptyArray(orderDeclaration.declarations[0]?.init) ||
    !isNamed(result.argument, order.name) ||
    !isPositiveLength(loop, queue.name) ||
    loop.body.type !== 'BlockStatement' ||
    loop.body.body.length !== 3
  )
    return null;
  const [dequeueDeclaration, visit, neighborLoop] = loop.body.body;
  if (
    dequeueDeclaration?.type !== 'VariableDeclaration' ||
    visit?.type !== 'ExpressionStatement' ||
    neighborLoop?.type !== 'ForOfStatement'
  )
    return null;
  const node = singleBinding(dequeueDeclaration);
  if (
    node === null ||
    !isMethodCall(
      dequeueDeclaration.declarations[0]?.init,
      queue.name,
      'shift',
      [],
    ) ||
    !isMethodCall(visit.expression, order.name, 'push', [node.name])
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
    !isMethodCall(neighborCheck.test.argument, seen.name, 'has', [
      neighbor.name,
    ]) ||
    neighborCheck.consequent.type !== 'BlockStatement' ||
    neighborCheck.consequent.body.length !== 2 ||
    neighborCheck.alternate !== null
  )
    return null;
  const membershipCall = neighborCheck.test.argument;
  const [discover, enqueue] = neighborCheck.consequent.body;
  if (
    discover?.type !== 'ExpressionStatement' ||
    enqueue?.type !== 'ExpressionStatement' ||
    !isMethodCall(discover.expression, seen.name, 'add', [neighbor.name]) ||
    !isMethodCall(enqueue.expression, queue.name, 'push', [neighbor.name])
  )
    return null;
  return {
    declaration,
    nodes,
    start,
    seen,
    queue,
    order,
    node,
    neighbor,
    seenDeclaration,
    queueDeclaration,
    orderDeclaration,
    dequeueDeclaration,
    visit,
    neighborCheck,
    membershipCall,
    discover,
    enqueue,
    result,
  };
}

function singleBinding(statement: VariableDeclaration): Identifier | null {
  if (statement.declarations.length !== 1) return null;
  const id = statement.declarations[0]?.id;
  return id?.type === 'Identifier' ? id : null;
}

function isGraphDeclaration(node: AnyNode): node is GraphDeclaration {
  return (
    node.type === 'VariableDeclaration' &&
    node.declarations.length === 1 &&
    node.declarations[0]?.id.type === 'Identifier' &&
    node.declarations[0].init?.type === 'ObjectExpression'
  );
}

function isArrayWithName(
  node: AnyNode | null | undefined,
  name: string,
): boolean {
  return (
    node?.type === 'ArrayExpression' &&
    node.elements.length === 1 &&
    isNamed(node.elements[0], name)
  );
}

function isEmptyArray(node: AnyNode | null | undefined): boolean {
  return node?.type === 'ArrayExpression' && node.elements.length === 0;
}

function isNewSetWithStart(
  node: AnyNode | null | undefined,
  start: string,
): boolean {
  return (
    node?.type === 'NewExpression' &&
    isNamed(node.callee, 'Set') &&
    node.arguments.length === 1 &&
    isArrayWithName(node.arguments[0], start)
  );
}

function isMethodCall(
  node: AnyNode | null | undefined,
  receiver: string,
  method: string,
  args: readonly string[],
): boolean {
  return (
    node?.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    isNamed(node.callee.object, receiver) &&
    isNamed(node.callee.property, method) &&
    node.arguments.length === args.length &&
    node.arguments.every((argument, index) => isNamed(argument, args[index]!))
  );
}

function isPositiveLength(loop: WhileStatement, queue: string): boolean {
  const test = loop.test;
  return (
    test.type === 'BinaryExpression' &&
    test.operator === '>' &&
    test.left.type === 'MemberExpression' &&
    !test.left.computed &&
    isNamed(test.left.object, queue) &&
    isNamed(test.left.property, 'length') &&
    test.right.type === 'Literal' &&
    test.right.value === 0
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
