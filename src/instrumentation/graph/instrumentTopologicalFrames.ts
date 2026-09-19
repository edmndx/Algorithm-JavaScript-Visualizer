import type { AnyNode, Identifier } from 'acorn';
import { isNamed as named } from '../matchers';
import { hasUnsafeInstrumentationSyntax, parseJavaScript } from '../ast';
import {
  applySourceEdits,
  sourceSpan as span,
  type SourceEdit,
  frameCall as frame,
  afterNode,
} from '../edits';
import { readStaticGraph } from './staticGraph';

function binding(node: AnyNode | undefined): Identifier | null {
  if (node?.type !== 'VariableDeclaration' || node.declarations.length !== 1)
    return null;
  const id = node.declarations[0]?.id;
  return id?.type === 'Identifier' ? id : null;
}

function member(
  node: AnyNode | null | undefined,
  object: string,
  property: string,
  computed = false,
): boolean {
  return (
    node?.type === 'MemberExpression' &&
    node.computed === computed &&
    named(node.object, object) &&
    named(node.property, property)
  );
}

function call(
  node: AnyNode | null | undefined,
  object: string,
  method: string,
  args: readonly string[],
): boolean {
  return (
    node?.type === 'CallExpression' &&
    member(node.callee, object, method) &&
    node.arguments.length === args.length &&
    node.arguments.every((arg, i) => named(arg, args[i]!))
  );
}

function keys(node: AnyNode | null | undefined, graph: string): boolean {
  return call(node, 'Object', 'keys', [graph]);
}

function loop(
  node: AnyNode | undefined,
  graph: string,
): { id: Identifier; body: AnyNode[] } | null {
  if (
    node?.type !== 'ForOfStatement' ||
    !keys(node.right, graph) ||
    node.left.type !== 'VariableDeclaration' ||
    node.left.kind !== 'const' ||
    node.body.type !== 'BlockStatement'
  )
    return null;
  const id = binding(node.left);
  return id === null ? null : { id, body: node.body.body };
}

function adjacencyLoop(
  node: AnyNode | undefined,
  graph: string,
  from: string,
): { id: Identifier; body: AnyNode[] } | null {
  if (
    node?.type !== 'ForOfStatement' ||
    !member(node.right, graph, from, true) ||
    node.left.type !== 'VariableDeclaration' ||
    node.left.kind !== 'const' ||
    node.body.type !== 'BlockStatement'
  )
    return null;
  const id = binding(node.left);
  return id === null ? null : { id, body: node.body.body };
}

function indexed(
  node: AnyNode | null | undefined,
  record: string,
  key: string,
): boolean {
  return member(node, record, key, true);
}

function update(
  node: AnyNode | undefined,
  record: string,
  key: string,
  operator: '++' | '--',
): boolean {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'UpdateExpression' &&
    node.expression.operator === operator &&
    indexed(node.expression.argument, record, key)
  );
}

function push(node: AnyNode | undefined, array: string, item: string): boolean {
  return (
    node?.type === 'ExpressionStatement' &&
    call(node.expression, array, 'push', [item])
  );
}

function zeroCheck(
  node: AnyNode | undefined,
  record: string,
  key: string,
  queue: string,
): node is Extract<AnyNode, { type: 'IfStatement' }> {
  return (
    node?.type === 'IfStatement' &&
    node.alternate === null &&
    node.test.type === 'BinaryExpression' &&
    node.test.operator === '===' &&
    indexed(node.test.left, record, key) &&
    node.test.right.type === 'Literal' &&
    node.test.right.value === 0 &&
    node.consequent.type === 'BlockStatement' &&
    node.consequent.body.length === 1 &&
    push(node.consequent.body[0], queue, key)
  );
}

function after(node: AnyNode, text: string): SourceEdit {
  return afterNode(node, `\n${text}\n`);
}

export function instrumentTopologicalFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (
    program === null ||
    hasUnsafeInstrumentationSyntax(program) ||
    program.body.length !== 3
  )
    return null;
  const [declaration, fn, invocation] = program.body;
  if (
    declaration?.type !== 'VariableDeclaration' ||
    declaration.kind !== 'const' ||
    declaration.declarations.length !== 1 ||
    declaration.declarations[0]?.id.type !== 'Identifier' ||
    declaration.declarations[0].init?.type !== 'ObjectExpression' ||
    fn?.type !== 'FunctionDeclaration' ||
    fn.id === null ||
    fn.params.length !== 1 ||
    fn.params[0]?.type !== 'Identifier' ||
    invocation?.type !== 'VariableDeclaration' ||
    invocation.declarations.length !== 1 ||
    invocation.declarations[0]?.id.type !== 'Identifier'
  )
    return null;
  const root = declaration.declarations[0].id.name;
  const graph = fn.params[0].name;
  const resultCall = invocation.declarations[0].init;
  if (
    resultCall?.type !== 'CallExpression' ||
    !named(resultCall.callee, fn.id.name) ||
    resultCall.arguments.length !== 1 ||
    !named(resultCall.arguments[0], root) ||
    new Set([root, graph, fn.id.name, invocation.declarations[0].id.name])
      .size !== 4
  )
    return null;
  const nodes = readStaticGraph(declaration.declarations[0].init);
  if (nodes === null || nodes.some(({ id }) => id === '__proto__')) return null;
  const body = fn.body.body;
  if (body.length !== 8) return null;
  const [
    degreeDecl,
    initLoop,
    countLoop,
    queueDecl,
    readyLoop,
    orderDecl,
    whileLoop,
    result,
  ] = body;
  // The supported source has exactly eight direct actions.
  if (
    degreeDecl?.type !== 'VariableDeclaration' ||
    queueDecl?.type !== 'VariableDeclaration' ||
    orderDecl?.type !== 'VariableDeclaration' ||
    whileLoop?.type !== 'WhileStatement' ||
    result?.type !== 'ReturnStatement'
  )
    return null;
  const degree = binding(degreeDecl)?.name;
  const queue = binding(queueDecl)?.name;
  const order = binding(orderDecl)?.name;
  if (
    degree === undefined ||
    queue === undefined ||
    order === undefined ||
    new Set([root, graph, fn.id.name, degree, queue, order]).size !== 6 ||
    degreeDecl.declarations[0]?.init?.type !== 'ObjectExpression' ||
    degreeDecl.declarations[0].init.properties.length !== 0 ||
    queueDecl.declarations[0]?.init?.type !== 'ArrayExpression' ||
    queueDecl.declarations[0].init.elements.length !== 0 ||
    orderDecl.declarations[0]?.init?.type !== 'ArrayExpression' ||
    orderDecl.declarations[0].init.elements.length !== 0
  )
    return null;
  const init = loop(initLoop, graph);
  const count = loop(countLoop, graph);
  const ready = loop(readyLoop, graph);
  if (
    init === null ||
    count === null ||
    ready === null ||
    init.body.length !== 1 ||
    count.body.length !== 1 ||
    ready.body.length !== 1
  )
    return null;
  const initialize = init.body[0];
  if (
    initialize?.type !== 'ExpressionStatement' ||
    initialize.expression.type !== 'AssignmentExpression' ||
    initialize.expression.operator !== '=' ||
    !indexed(initialize.expression.left, degree, init.id.name) ||
    initialize.expression.right.type !== 'Literal' ||
    initialize.expression.right.value !== 0
  )
    return null;
  const countNeighbors = adjacencyLoop(count.body[0], graph, count.id.name);
  if (
    countNeighbors === null ||
    countNeighbors.body.length !== 1 ||
    !update(countNeighbors.body[0], degree, countNeighbors.id.name, '++') ||
    !zeroCheck(ready.body[0], degree, ready.id.name, queue)
  )
    return null;
  const readyCheck = ready.body[0];
  if (
    readyCheck?.type !== 'IfStatement' ||
    readyCheck.consequent.type !== 'BlockStatement'
  )
    return null;
  const readyPush = readyCheck.consequent.body[0]!;
  const whileTest = whileLoop.test;
  if (
    whileTest.type !== 'BinaryExpression' ||
    whileTest.operator !== '>' ||
    !member(whileTest.left, queue, 'length') ||
    whileTest.right.type !== 'Literal' ||
    whileTest.right.value !== 0 ||
    whileLoop.body.type !== 'BlockStatement' ||
    whileLoop.body.body.length !== 3
  )
    return null;
  const [take, append, traverse] = whileLoop.body.body;
  const current = binding(take)?.name;
  if (
    take?.type !== 'VariableDeclaration' ||
    current === undefined ||
    !call(take.declarations[0]?.init, queue, 'shift', []) ||
    !push(append, order, current)
  )
    return null;
  const neighbors = adjacencyLoop(traverse, graph, current);
  if (
    neighbors === null ||
    neighbors.body.length !== 2 ||
    !update(neighbors.body[0], degree, neighbors.id.name, '--') ||
    !zeroCheck(neighbors.body[1], degree, neighbors.id.name, queue)
  )
    return null;
  const innerCheck = neighbors.body[1];
  if (
    innerCheck?.type !== 'IfStatement' ||
    innerCheck.consequent.type !== 'BlockStatement'
  )
    return null;
  const innerPush = innerCheck.consequent.body[0]!;
  const locals = [
    init.id.name,
    count.id.name,
    countNeighbors.id.name,
    ready.id.name,
    current,
    neighbors.id.name,
  ];
  if (
    locals.some((name) => [degree, queue, order, graph, root].includes(name)) ||
    count.id.name === countNeighbors.id.name ||
    current === neighbors.id.name
  )
    return null;
  const returnExpr = result.argument;
  if (
    returnExpr?.type !== 'ConditionalExpression' ||
    returnExpr.test.type !== 'BinaryExpression' ||
    returnExpr.test.operator !== '===' ||
    !member(returnExpr.test.left, order, 'length') ||
    returnExpr.test.right.type !== 'MemberExpression' ||
    !named(returnExpr.test.right.property, 'length') ||
    !keys(returnExpr.test.right.object, graph) ||
    !named(returnExpr.consequent, order) ||
    returnExpr.alternate.type !== 'Literal' ||
    returnExpr.alternate.value !== null
  )
    return null;
  // Object.keys(graph).length is the comparison's right operand.
  // Keep the location tied to the return statement while preserving the original expression.
  const graphNodes = nodes
    .map(
      ({ id }) => `{ id: ${JSON.stringify(id)}, label: ${JSON.stringify(id)} }`,
    )
    .join(', ');
  const graphEdges = nodes
    .flatMap(({ id, neighbors: next }) =>
      next.map(
        (to) =>
          `{ id: ${JSON.stringify(`${id}->${to}`)}, from: ${JSON.stringify(id)}, to: ${JSON.stringify(to)}, directed: true }`,
      ),
    )
    .join(', ');

  const assignDegree = (
    node: AnyNode,
    key: string,
    before: string,
    value: string,
    kind?: 'add' | 'subtract',
    from?: string,
  ) =>
    frame(
      node,
      `{ type: 'assign', target: ${JSON.stringify(`${degree}[`)} + ${key} + ']', before: ${before}, value: ${value}${kind === undefined ? '' : `, calculation: { kind: '${kind}', operand: { label: '1', value: 1 } }`} }`,
      [
        `{ type: 'graph.nodeMetric', nodeId: ${key}, name: 'indegree', value: ${value} }`,
        ...(from === undefined
          ? []
          : [
              `{ type: 'graph.markEdges', marker: 'current', edgeIds: [${from} + '->' + ${key}] }`,
            ]),
      ],
    );
  const check = (node: AnyNode, key: string, from?: string) =>
    `trace.compareScalar(${degree}[${key}], 0, 'eq', ${span(node)}, ${JSON.stringify(`${degree}[`)} + ${key} + ']', '0', [{ type: 'graph.markNodes', marker: 'candidate', nodeIds: [${key}] }${from === undefined ? '' : `, { type: 'graph.markEdges', marker: 'current', edgeIds: [${from} + '->' + ${key}] }`}])`;
  const edits: SourceEdit[] = [
    after(
      declaration,
      `trace.initialize({ type: 'scene.init', structure: 'graph' }, { type: 'graph.create', nodes: [${graphNodes}], edges: [${graphEdges}], layout: 'circular' });`,
    ),
    after(initialize, assignDegree(initialize, init.id.name, 'null', '0')),
    after(
      countNeighbors.body[0]!,
      assignDegree(
        countNeighbors.body[0]!,
        countNeighbors.id.name,
        `${degree}[${countNeighbors.id.name}] - 1`,
        `${degree}[${countNeighbors.id.name}]`,
        'add',
        count.id.name,
      ),
    ),
    after(
      queueDecl,
      frame(
        queueDecl,
        `{ type: 'assign', target: ${JSON.stringify(queue)}, before: null, value: [] }`,
      ),
    ),
    after(
      readyPush,
      frame(
        readyPush,
        `{ type: 'collection', action: 'enqueue', role: 'frontier', item: ${ready.id.name} }`,
        [`{ type: 'graph.frontier', nodeIds: ${queue} }`],
      ),
    ),
    after(
      orderDecl,
      frame(
        orderDecl,
        `{ type: 'assign', target: ${JSON.stringify(order)}, before: null, value: [] }`,
      ),
    ),
    after(
      take,
      frame(
        take,
        `{ type: 'collection', action: 'dequeue', role: 'frontier', item: ${current} }`,
        [
          `{ type: 'graph.frontier', nodeIds: ${queue} }`,
          `{ type: 'graph.markNodes', marker: 'current', nodeIds: [${current}] }`,
        ],
      ),
    ),
    after(
      append!,
      frame(
        append!,
        `{ type: 'collection', action: 'append', role: 'traversal', item: ${current} }`,
        [`{ type: 'graph.visitNode', nodeId: ${current} }`],
      ),
    ),
    after(
      neighbors.body[0]!,
      assignDegree(
        neighbors.body[0]!,
        neighbors.id.name,
        `${degree}[${neighbors.id.name}] + 1`,
        `${degree}[${neighbors.id.name}]`,
        'subtract',
        current,
      ),
    ),
    after(
      innerPush,
      frame(
        innerPush,
        `{ type: 'collection', action: 'enqueue', role: 'frontier', item: ${neighbors.id.name} }`,
        [`{ type: 'graph.frontier', nodeIds: ${queue} }`],
      ),
    ),
    {
      start: readyCheck.test.start,
      end: readyCheck.test.end,
      text: check(readyCheck.test, ready.id.name),
    },
    {
      start: innerCheck.test.start,
      end: innerCheck.test.end,
      text: check(innerCheck.test, neighbors.id.name, current),
    },
    {
      start: returnExpr.start,
      end: returnExpr.end,
      text: `trace.returnValue(${source.slice(returnExpr.start, returnExpr.end)}, ${span(result)}, 'topological order')`,
    },
  ];
  return applySourceEdits(source, edits);
}
