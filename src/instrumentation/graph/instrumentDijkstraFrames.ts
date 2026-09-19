import type { AnyNode, ObjectExpression, Program, Property } from 'acorn';
import { TRACE_LIMITS } from '../../protocol/traceSchemas';
import {
  createIdentifierAllocator,
  hasUnsafeInstrumentationSyntax,
  parseJavaScript,
} from '../ast';
import {
  applySourceEdits,
  sourceSpan as span,
  type SourceEdit,
  frameCall as frame,
  afterNode,
} from '../edits';

// Only this linear-scan control flow is traced. Lexical names are mapped by
// position, so renames work while changed relaxation/selection semantics fail closed.
const pattern = parseJavaScript(`
function shortestPaths(graph, start) {
  const distances = {};
  const predecessors = {};
  const settled = new Set();
  for (const node of Object.keys(graph)) {
    distances[node] = Infinity;
  }
  distances[start] = 0;
  while (true) {
    let current = null;
    for (const node of Object.keys(graph)) {
      if (!settled.has(node) && Number.isFinite(distances[node]) &&
          (current === null || distances[node] < distances[current])) {
        current = node;
      }
    }
    if (current === null) break;
    settled.add(current);
    for (const edge of graph[current]) {
      const candidate = distances[current] + edge.weight;
      if (candidate < distances[edge.to]) {
        distances[edge.to] = candidate;
        predecessors[edge.to] = current;
      }
    }
  }
  return distances;
}`);

const fixedNames = new Set([
  'Object',
  'Number',
  'Infinity',
  'Set',
  'keys',
  'has',
  'add',
  'isFinite',
  'to',
  'weight',
]);

type WeightedNode = {
  readonly id: string;
  readonly edges: readonly { readonly to: string; readonly weight: number }[];
};

function matchesAst(
  expected: unknown,
  actual: unknown,
  names: Map<string, string>,
  reverse: Map<string, string>,
): boolean {
  if (
    expected === null ||
    actual === null ||
    typeof expected !== 'object' ||
    typeof actual !== 'object'
  )
    return expected === actual;
  if (Array.isArray(expected) || Array.isArray(actual))
    return (
      Array.isArray(expected) &&
      Array.isArray(actual) &&
      expected.length === actual.length &&
      expected.every((item, index) =>
        matchesAst(item, actual[index], names, reverse),
      )
    );
  const left = expected as Record<string, unknown>;
  const right = actual as Record<string, unknown>;
  if (left.type === 'Identifier' || right.type === 'Identifier') {
    if (left.type !== 'Identifier' || right.type !== 'Identifier') return false;
    const from = left.name as string;
    const to = right.name as string;
    if (fixedNames.has(from)) return from === to;
    if (fixedNames.has(to) || reverse.has(to)) return names.get(from) === to;
    if (names.has(from)) return names.get(from) === to;
    names.set(from, to);
    reverse.set(to, from);
    return true;
  }
  const ignored = new Set(['start', 'end', 'loc', 'raw']);
  const keys = Object.keys(left).filter((key) => !ignored.has(key));
  return (
    keys.length ===
      Object.keys(right).filter((key) => !ignored.has(key)).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        matchesAst(left[key], right[key], names, reverse),
    )
  );
}

function propertyName(property: Property): string | null {
  if (property.computed || property.kind !== 'init' || property.method)
    return null;
  if (property.key.type === 'Identifier') return property.key.name;
  return property.key.type === 'Literal' &&
    typeof property.key.value === 'string'
    ? property.key.value
    : null;
}

function safeId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= TRACE_LIMITS.stringLength &&
    !id.includes('->') &&
    !(id in Object.prototype)
  );
}

function readWeightedGraph(
  expression: ObjectExpression,
): readonly WeightedNode[] | null {
  if (
    expression.properties.length === 0 ||
    expression.properties.length > TRACE_LIMITS.collectionItems
  )
    return null;
  const nodes: WeightedNode[] = [];
  const ids = new Set<string>();
  let edgeCount = 0;
  for (const property of expression.properties) {
    if (
      property.type !== 'Property' ||
      property.value.type !== 'ArrayExpression'
    )
      return null;
    const id = propertyName(property);
    if (id === null || !safeId(id) || ids.has(id)) return null;
    ids.add(id);
    const edges: { to: string; weight: number }[] = [];
    for (const element of property.value.elements) {
      if (
        element?.type !== 'ObjectExpression' ||
        element.properties.length !== 2
      )
        return null;
      const toField = element.properties.find(
        (field) => field.type === 'Property' && propertyName(field) === 'to',
      );
      const weightField = element.properties.find(
        (field) =>
          field.type === 'Property' && propertyName(field) === 'weight',
      );
      if (
        toField?.type !== 'Property' ||
        weightField?.type !== 'Property' ||
        toField.value.type !== 'Literal' ||
        typeof toField.value.value !== 'string' ||
        weightField.value.type !== 'Literal' ||
        typeof weightField.value.value !== 'number' ||
        !Number.isFinite(weightField.value.value) ||
        weightField.value.value < 0 ||
        !safeId(toField.value.value)
      )
        return null;
      const to = toField.value.value;
      if (edges.some((edge) => edge.to === to)) return null;
      edges.push({ to, weight: weightField.value.value });
    }
    edgeCount += edges.length;
    nodes.push({ id, edges });
  }
  return edgeCount <= TRACE_LIMITS.collectionItems &&
    nodes.every(({ id, edges }) =>
      edges.every(
        ({ to }) =>
          ids.has(to) && `${id}->${to}`.length <= TRACE_LIMITS.stringLength,
      ),
    )
    ? nodes
    : null;
}

function after(node: AnyNode, code: string): SourceEdit {
  return afterNode(node, `\n${code}\n`);
}

export function instrumentDijkstraFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (
    program === null ||
    hasUnsafeInstrumentationSyntax(program) ||
    program.body.length !== 3 ||
    pattern?.body[0]?.type !== 'FunctionDeclaration'
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
    invocation?.type !== 'VariableDeclaration' ||
    invocation.kind !== 'const' ||
    invocation.declarations.length !== 1 ||
    invocation.declarations[0]?.id.type !== 'Identifier'
  )
    return null;
  const nodes = readWeightedGraph(declaration.declarations[0].init);
  if (nodes === null) return null;
  const names = new Map<string, string>();
  const reverse = new Map<string, string>();
  if (!matchesAst(pattern.body[0], fn, names, reverse)) return null;
  const root = declaration.declarations[0].id.name;
  const graph = names.get('graph');
  const functionName = names.get('shortestPaths');
  const result = invocation.declarations[0].init;
  if (
    graph === undefined ||
    functionName === undefined ||
    result?.type !== 'CallExpression' ||
    result.optional ||
    result.callee.type !== 'Identifier' ||
    result.callee.name !== functionName ||
    result.arguments.length !== 2 ||
    result.arguments[0]?.type !== 'Identifier' ||
    result.arguments[0].name !== root ||
    result.arguments[1]?.type !== 'Literal' ||
    typeof result.arguments[1].value !== 'string'
  )
    return null;
  const startId = result.arguments[1].value;
  if (
    !nodes.some(({ id }) => id === startId) ||
    new Set([root, graph, functionName, invocation.declarations[0].id.name])
      .size !== 4
  )
    return null;
  return instrumentMatched(source, program, declaration, fn, names, nodes);
}

function instrumentMatched(
  source: string,
  program: Program,
  declaration: AnyNode,
  fn: Extract<AnyNode, { type: 'FunctionDeclaration' }>,
  names: ReadonlyMap<string, string>,
  nodes: readonly WeightedNode[],
): string | null {
  // The AST comparison above establishes these exact statement positions.
  const body = fn.body.body;
  const initLoop = body[3];
  const seed = body[4];
  const whileLoop = body[5];
  if (
    initLoop?.type !== 'ForOfStatement' ||
    initLoop.body.type !== 'BlockStatement' ||
    seed?.type !== 'ExpressionStatement' ||
    whileLoop?.type !== 'WhileStatement' ||
    whileLoop.body.type !== 'BlockStatement'
  )
    return null;
  const initWrite = initLoop.body.body[0];
  const loopBody = whileLoop.body.body;
  const currentDeclaration = loopBody[0];
  const scan = loopBody[1];
  const exit = loopBody[2];
  const settle = loopBody[3];
  const relax = loopBody[4];
  const returnStatement = body[6];
  const returnExpression =
    returnStatement?.type === 'ReturnStatement'
      ? returnStatement.argument
      : undefined;
  if (
    initWrite === undefined ||
    currentDeclaration === undefined ||
    scan?.type !== 'ForOfStatement' ||
    scan.body.type !== 'BlockStatement' ||
    scan.body.body[0]?.type !== 'IfStatement' ||
    scan.body.body[0].consequent.type !== 'BlockStatement' ||
    exit?.type !== 'IfStatement' ||
    exit.consequent.type !== 'BreakStatement' ||
    settle === undefined ||
    relax?.type !== 'ForOfStatement' ||
    relax.body.type !== 'BlockStatement' ||
    returnStatement?.type !== 'ReturnStatement' ||
    returnExpression == null
  )
    return null;
  const scanCondition = scan.body.body[0].test;
  const scanWrite = scan.body.body[0].consequent.body[0];
  const candidateDeclaration = relax.body.body[0];
  const relaxation = relax.body.body[1];
  if (
    scanWrite === undefined ||
    candidateDeclaration === undefined ||
    relaxation?.type !== 'IfStatement' ||
    relaxation.consequent.type !== 'BlockStatement'
  )
    return null;
  const distanceWrite = relaxation.consequent.body[0];
  const predecessorWrite = relaxation.consequent.body[1];
  if (
    distanceWrite?.type !== 'ExpressionStatement' ||
    predecessorWrite?.type !== 'ExpressionStatement'
  )
    return null;
  const n = (key: string) => names.get(key)!;
  const graph = n('graph');
  const distances = n('distances');
  const predecessors = n('predecessors');
  const settled = n('settled');
  const node = n('node');
  const current = n('current');
  const edge = n('edge');
  const trial = n('candidate');
  const start = n('start');
  const fact = (value: string) =>
    `(Number.isFinite(${value}) ? ${value} : { kind: 'positive-infinity' })`;
  const frontier = `Object.keys(${graph}).filter(${node} => !${settled}.has(${node}) && Number.isFinite(${distances}[${node}]))`;

  const fresh = createIdentifierAllocator(program, '__dijkstra');
  const old = fresh();
  const oldDistance = fresh();
  const oldPredecessor = fresh();
  const left = fresh();
  const right = fresh();
  const outcome = fresh();
  const edgeId = `${current} + '->' + ${edge}.to`;
  const firstNodes = nodes.map(({ id }) => ({ id, label: id }));
  const firstEdges = nodes.flatMap(({ id: from, edges }) =>
    edges.map(({ to, weight }) => ({
      id: `${from}->${to}`,
      from,
      to,
      weight,
      directed: true,
    })),
  );
  const scanComparison =
    scanCondition.type === 'LogicalExpression' &&
    scanCondition.right.type === 'LogicalExpression'
      ? scanCondition.right.right
      : null;
  if (scanComparison?.type !== 'BinaryExpression') return null;
  // The selected minimum is updated only after the short-circuiting guard succeeds.
  const edits: SourceEdit[] = [
    after(
      declaration,
      `trace.initialize({ type: 'scene.init', structure: 'graph' }, { type: 'graph.create', nodes: ${JSON.stringify(firstNodes)}, edges: ${JSON.stringify(firstEdges)}, layout: 'circular' });`,
    ),
    after(
      initWrite,
      frame(
        initWrite,
        `{ type: 'assign', target: ${JSON.stringify(`${distances}[`)} + ${node} + ']', before: { kind: 'undefined' }, value: { kind: 'positive-infinity' } }`,
        [`{ type: 'graph.distance', nodeId: ${node}, distance: null }`],
      ),
    ),
    after(
      seed,
      frame(
        seed,
        `{ type: 'assign', target: ${JSON.stringify(`${distances}[`)} + ${start} + ']', before: { kind: 'positive-infinity' }, value: 0 }`,
        [
          `{ type: 'graph.distance', nodeId: ${start}, distance: 0 }`,
          `{ type: 'graph.frontier', nodeIds: ${frontier} }`,
        ],
      ),
    ),
    after(
      currentDeclaration,
      frame(
        currentDeclaration,
        `{ type: 'assign', target: ${JSON.stringify(current)}, before: { kind: 'undefined' }, value: null }`,
      ),
    ),
    {
      start: exit.consequent.start,
      end: exit.consequent.end,
      text: `{ ${frame(exit.consequent, `{ type: 'control', action: 'break', target: ${span(whileLoop)} }`)} break; }`,
    },
    {
      start: scanWrite!.start,
      end: scanWrite!.start,
      text: `const ${old} = ${current};\n`,
    },
    after(
      scanWrite!,
      frame(
        scanWrite!,
        `{ type: 'assign', target: ${JSON.stringify(current)}, before: ${old}, value: ${current} }`,
        [
          `{ type: 'graph.markNodes', marker: 'current', nodeIds: [${current}] }`,
        ],
      ),
    ),
    after(
      settle,
      frame(
        settle,
        `{ type: 'collection', action: 'add', role: 'visited', item: ${current} }`,
        [
          `{ type: 'graph.visitNode', nodeId: ${current} }`,
          `{ type: 'graph.frontier', nodeIds: ${frontier} }`,
        ],
      ),
    ),
    after(
      candidateDeclaration,
      frame(
        candidateDeclaration,
        `{ type: 'assign', target: ${JSON.stringify(trial)}, before: { kind: 'undefined' }, value: ${fact(trial)} }`,
      ),
    ),
    {
      start: distanceWrite.start,
      end: distanceWrite.start,
      text: `const ${oldDistance} = ${distances}[${edge}.to];\n`,
    },
    after(
      distanceWrite,
      frame(
        distanceWrite,
        `{ type: 'assign', target: ${JSON.stringify(`${distances}[`)} + ${edge}.to + ']', before: ${fact(oldDistance)}, value: ${trial} }`,
        [
          `{ type: 'graph.distance', nodeId: ${edge}.to, distance: ${trial} }`,
          `{ type: 'graph.frontier', nodeIds: ${frontier} }`,
        ],
      ),
    ),
    {
      start: predecessorWrite.start,
      end: predecessorWrite.start,
      text: `const ${oldPredecessor} = ${predecessors}[${edge}.to];\n`,
    },
    after(
      predecessorWrite,
      frame(
        predecessorWrite,
        `{ type: 'assign', target: ${JSON.stringify(`${predecessors}[`)} + ${edge}.to + ']', before: ${oldPredecessor} === undefined ? { kind: 'undefined' } : ${oldPredecessor}, value: ${current} }`,
        [
          `{ type: 'graph.predecessor', nodeId: ${edge}.to, predecessorId: ${current} }`,
        ],
      ),
    ),
    {
      start: returnExpression.start,
      end: returnExpression.end,
      text: `trace.returnValue(${source.slice(returnExpression.start, returnExpression.end)}, ${span(returnStatement)}, ${JSON.stringify(distances)})`,
    },
    {
      start: relaxation.test.start,
      end: relaxation.test.end,
      text: `((${left}, ${right}) => { const ${outcome} = ${left} < ${right}; ${frame(
        relaxation.test,
        `{ type: 'compare', operator: 'lt', left: { label: ${JSON.stringify(trial)}, value: ${fact(left)} }, right: { label: ${JSON.stringify(`${distances}[`)} + ${edge}.to + ']', value: ${fact(right)} }, result: ${outcome} }`,
        [
          `{ type: 'graph.markEdges', marker: 'current', edgeIds: [${edgeId}] }`,
          `{ type: 'graph.markNodes', marker: 'candidate', nodeIds: [${edge}.to] }`,
        ],
      )} return ${outcome}; })(${trial}, ${distances}[${edge}.to])`,
    },
    {
      start: scanComparison.start,
      end: scanComparison.end,
      text: `trace.compareScalar(${distances}[${node}], ${distances}[${current}], 'lt', ${span(scanComparison)}, 'distance[' + ${node} + ']', 'distance[' + ${current} + ']', [{ type: 'graph.markNodes', marker: 'candidate', nodeIds: [${node}, ${current}] }])`,
    },
  ];
  return applySourceEdits(source, edits);
}
