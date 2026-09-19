import type {
  AnyNode,
  CallExpression,
  ExpressionStatement,
  FunctionDeclaration,
  Identifier,
  IfStatement,
  ReturnStatement,
  VariableDeclaration,
  WhileStatement,
} from 'acorn';
import {
  isNamed as named,
  isLiteralValue as literal,
  isIndexedItem as item,
} from './matchers';
import {
  createIdentifierAllocator,
  hasUnsafeInstrumentationSyntax,
  isFiniteNumericLiteral,
  parseJavaScript,
} from './ast';
import {
  applySourceEdits,
  sourceSpan as location,
  type SourceEdit,
  beforeNode as before,
  afterNode as after,
  frameCall,
} from './edits';

const binary = (
  node: AnyNode | null | undefined,
  operator: string,
  left: (node: AnyNode) => boolean,
  right: (node: AnyNode) => boolean,
) =>
  node?.type === 'BinaryExpression' &&
  node.operator === operator &&
  left(node.left) &&
  right(node.right);
const and = (
  node: AnyNode | null | undefined,
  left: (node: AnyNode) => boolean,
  right: (node: AnyNode) => boolean,
) =>
  node?.type === 'LogicalExpression' &&
  node.operator === '&&' &&
  left(node.left) &&
  right(node.right);
const length = (node: AnyNode, name: string) =>
  node.type === 'MemberExpression' &&
  !node.computed &&
  !node.optional &&
  named(node.object, name) &&
  named(node.property, 'length');

const update = (node: AnyNode | null | undefined, name: string) =>
  node?.type === 'ExpressionStatement' &&
  node.expression.type === 'UpdateExpression' &&
  node.expression.operator === '++' &&
  named(node.expression.argument, name);

function declaration(
  node: AnyNode | undefined,
  kind: string,
): [VariableDeclaration, Identifier, AnyNode] | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== kind ||
    node.declarations.length !== 1
  )
    return null;
  const entry = node.declarations[0];
  return entry?.id.type === 'Identifier' && entry.init != null
    ? [node, entry.id, entry.init]
    : null;
}

function call(
  node: AnyNode | null | undefined,
  fn: string,
  args: string[],
): node is CallExpression {
  return (
    node?.type === 'CallExpression' &&
    !node.optional &&
    named(node.callee, fn) &&
    node.arguments.length === args.length &&
    node.arguments.every((arg, index) => named(arg, args[index] ?? ''))
  );
}

function slice(
  node: AnyNode,
  array: string,
  start: string,
  end: string,
): boolean {
  return (
    node.type === 'CallExpression' &&
    !node.optional &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    !node.callee.optional &&
    named(node.callee.object, array) &&
    named(node.callee.property, 'slice') &&
    node.arguments.length === 2 &&
    named(node.arguments[0], start) &&
    named(node.arguments[1], end)
  );
}

function write(
  node: AnyNode | undefined,
  array: string,
  index: string,
  buffer: string,
  read: string,
): node is ExpressionStatement {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'AssignmentExpression' &&
    node.expression.operator === '=' &&
    item(node.expression.left, array, index) &&
    item(node.expression.right, buffer, read)
  );
}

function copyLoop(
  node: AnyNode | undefined,
  array: string,
  buffer: string,
  read: string,
  dest: string,
): ExpressionStatement | null {
  if (
    node?.type !== 'WhileStatement' ||
    !binary(
      node.test,
      '<',
      (part) => named(part, read),
      (part) => length(part, buffer),
    ) ||
    node.body.type !== 'BlockStatement' ||
    node.body.body.length !== 3
  )
    return null;
  const [assignment, advanceRead, advanceDest] = node.body.body;
  return write(assignment, array, dest, buffer, read) &&
    update(advanceRead, read) &&
    update(advanceDest, dest)
    ? assignment
    : null;
}

type Match = {
  array: VariableDeclaration;
  input: Identifier;
  fn: FunctionDeclaration;
  values: string;
  low: string;
  high: string;
  mid: string;
  left: string;
  right: string;
  i: string;
  j: string;
  k: string;
  base: IfStatement;
  midDeclaration: VariableDeclaration;
  calls: [ExpressionStatement, ExpressionStatement];
  merge: WhileStatement;
  choose: IfStatement;
  writes: [
    ExpressionStatement,
    ExpressionStatement,
    ExpressionStatement,
    ExpressionStatement,
  ];
  result: ReturnStatement;
};

function match(
  program: NonNullable<ReturnType<typeof parseJavaScript>>,
): Match | null {
  if (program.body.length !== 3 || hasUnsafeInstrumentationSyntax(program))
    return null;
  const [array, fn, invocation] = program.body;
  const input = declaration(array, 'const');
  if (
    input === null ||
    input[2].type !== 'ArrayExpression' ||
    !input[2].elements.every(isFiniteNumericLiteral) ||
    fn?.type !== 'FunctionDeclaration' ||
    fn.id === null ||
    fn.params.length !== 3 ||
    fn.params.some((param) => param.type !== 'Identifier') ||
    invocation === undefined
  )
    return null;
  const [values, low, high] = fn.params;
  if (
    values?.type !== 'Identifier' ||
    low?.type !== 'Identifier' ||
    high?.type !== 'Identifier'
  )
    return null;
  if (
    fn.id.name === 'Math' ||
    input[1].name === 'Math' ||
    new Set([input[1].name, fn.id.name, values.name, low.name, high.name])
      .size !== 5
  )
    return null;
  const invoked =
    invocation.type === 'VariableDeclaration'
      ? declaration(invocation, 'const')?.[2]
      : invocation.type === 'ExpressionStatement'
        ? invocation.expression
        : null;
  if (
    invoked?.type !== 'CallExpression' ||
    invoked.optional ||
    !named(invoked.callee, fn.id.name) ||
    invoked.arguments.length !== 3 ||
    !named(invoked.arguments[0], input[1].name) ||
    !literal(invoked.arguments[1], 0) ||
    invoked.arguments[2] === undefined ||
    !length(invoked.arguments[2], input[1].name)
  )
    return null;

  const body = fn.body.body;
  if (body.length !== 13) return null;
  const [
    base,
    midNode,
    firstCall,
    secondCall,
    leftNode,
    rightNode,
    iNode,
    jNode,
    kNode,
    merge,
    leftCopy,
    rightCopy,
    result,
  ] = body;
  const mid = declaration(midNode, 'const');
  const left = declaration(leftNode, 'const');
  const right = declaration(rightNode, 'const');
  const i = declaration(iNode, 'let');
  const j = declaration(jNode, 'let');
  const k = declaration(kNode, 'let');
  if (
    base?.type !== 'IfStatement' ||
    base.alternate !== null ||
    !binary(
      base.test,
      '<=',
      (part) =>
        binary(
          part,
          '-',
          (a) => named(a, high.name),
          (b) => named(b, low.name),
        ),
      (part) => literal(part, 1),
    ) ||
    base.consequent.type !== 'ReturnStatement' ||
    !named(base.consequent.argument, values.name) ||
    mid === null ||
    mid[2].type !== 'CallExpression' ||
    mid[2].optional ||
    mid[2].callee.type !== 'MemberExpression' ||
    mid[2].callee.computed ||
    !named(mid[2].callee.object, 'Math') ||
    !named(mid[2].callee.property, 'floor') ||
    mid[2].arguments.length !== 1 ||
    !binary(
      mid[2].arguments[0],
      '/',
      (part) =>
        binary(
          part,
          '+',
          (a) => named(a, low.name),
          (b) => named(b, high.name),
        ),
      (part) => literal(part, 2),
    ) ||
    firstCall?.type !== 'ExpressionStatement' ||
    !call(firstCall.expression, fn.id.name, [
      values.name,
      low.name,
      mid[1].name,
    ]) ||
    secondCall?.type !== 'ExpressionStatement' ||
    !call(secondCall.expression, fn.id.name, [
      values.name,
      mid[1].name,
      high.name,
    ]) ||
    left === null ||
    !slice(left[2], values.name, low.name, mid[1].name) ||
    right === null ||
    !slice(right[2], values.name, mid[1].name, high.name) ||
    i === null ||
    !literal(i[2], 0) ||
    j === null ||
    !literal(j[2], 0) ||
    k === null ||
    !named(k[2], low.name) ||
    merge?.type !== 'WhileStatement' ||
    !and(
      merge.test,
      (part) =>
        binary(
          part,
          '<',
          (a) => named(a, i[1].name),
          (b) => length(b, left[1].name),
        ),
      (part) =>
        binary(
          part,
          '<',
          (a) => named(a, j[1].name),
          (b) => length(b, right[1].name),
        ),
    ) ||
    merge.body.type !== 'BlockStatement' ||
    merge.body.body.length !== 2 ||
    leftCopy?.type !== 'WhileStatement' ||
    rightCopy?.type !== 'WhileStatement' ||
    result?.type !== 'ReturnStatement' ||
    !named(result.argument, values.name)
  )
    return null;
  const [choose, advanceDest] = merge.body.body;
  if (
    choose?.type !== 'IfStatement' ||
    !binary(
      choose.test,
      '<=',
      (part) => item(part, left[1].name, i[1].name),
      (part) => item(part, right[1].name, j[1].name),
    ) ||
    choose.consequent.type !== 'BlockStatement' ||
    choose.alternate?.type !== 'BlockStatement' ||
    choose.consequent.body.length !== 2 ||
    choose.alternate.body.length !== 2 ||
    !write(
      choose.consequent.body[0],
      values.name,
      k[1].name,
      left[1].name,
      i[1].name,
    ) ||
    !write(
      choose.alternate.body[0],
      values.name,
      k[1].name,
      right[1].name,
      j[1].name,
    ) ||
    !update(choose.consequent.body[1], i[1].name) ||
    !update(choose.alternate.body[1], j[1].name) ||
    !update(advanceDest, k[1].name)
  )
    return null;
  const leftWrite = copyLoop(
    leftCopy,
    values.name,
    left[1].name,
    i[1].name,
    k[1].name,
  );
  const rightWrite = copyLoop(
    rightCopy,
    values.name,
    right[1].name,
    j[1].name,
    k[1].name,
  );
  if (leftWrite === null || rightWrite === null) return null;
  const names = [
    values.name,
    low.name,
    high.name,
    mid[1].name,
    left[1].name,
    right[1].name,
    i[1].name,
    j[1].name,
    k[1].name,
  ];
  if (
    new Set(names).size !== names.length ||
    names.includes(fn.id.name) ||
    names.includes('Math')
  )
    return null;
  return {
    array: input[0],
    input: input[1],
    fn,
    values: values.name,
    low: low.name,
    high: high.name,
    mid: mid[1].name,
    left: left[1].name,
    right: right[1].name,
    i: i[1].name,
    j: j[1].name,
    k: k[1].name,
    base,
    midDeclaration: mid[0],
    calls: [firstCall, secondCall],
    merge,
    choose,
    writes: [
      choose.consequent.body[0],
      choose.alternate.body[0],
      leftWrite,
      rightWrite,
    ],
    result,
  };
}

export function instrumentMergeSortFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (program === null) return null;
  const found = match(program);
  if (found === null) return null;
  const {
    array,
    input,
    fn,
    values,
    low,
    high,
    mid,
    left,
    right,
    i,
    j,
    k,
    base,
    midDeclaration,
    calls,
    choose,
    writes,
    result,
  } = found;
  const nextName = createIdentifierAllocator(program, '__merge_trace_');
  const range = (start: string, end: string) =>
    `{ type: 'array.focus', range: [${start}, ${end}] }`;
  const frame = (node: AnyNode, operation: string, commands: string[]) =>
    `\n${frameCall(node, operation, commands)}\n`;
  const callFrame = (node: AnyNode, start: string, end: string) =>
    frame(
      node,
      `{ type: 'call', callee: ${JSON.stringify(fn.id?.name)}, from: null, target: '[' + ${start} + ', ' + ${end} + ')' }`,
      [range(start, end)],
    );
  const returnFrame = (node: ReturnStatement) =>
    frame(node, `{ type: 'return', value: ${values}, role: 'sorted range' }`, [
      range(low, high),
    ]);
  const edits: SourceEdit[] = [
    after(
      array,
      `\ntrace.initialize({ type: 'scene.init', structure: 'array' }, { type: 'array.create', values: ${input.name} });\n`,
    ),
    {
      start: base.test.start,
      end: base.test.end,
      text: `trace.compareScalar(${high} - ${low}, 1, 'lte', ${location(base.test)}, ${JSON.stringify(`${high} - ${low}`)}, '1', [${range(low, high)}])`,
    },
    {
      start: base.consequent.start,
      end: base.consequent.end,
      text: `{ ${returnFrame(base.consequent as ReturnStatement)} ${source.slice(base.consequent.start, base.consequent.end)} }`,
    },
    after(
      midDeclaration,
      frame(
        midDeclaration,
        `{ type: 'assign', target: ${JSON.stringify(mid)}, before: null, value: ${mid} }`,
        [
          `{ type: 'array.focus', pointers: { M: ${mid} }, range: [${low}, ${high}] }`,
        ],
      ),
    ),
    before(calls[0], callFrame(calls[0], low, mid)),
    before(calls[1], callFrame(calls[1], mid, high)),
    {
      start: choose.test.start,
      end: choose.test.end,
      text: `trace.compareScalar(${left}[${i}], ${right}[${j}], 'lte', ${location(choose.test)}, 'bufL', 'bufR', [{ type: 'array.focus', pointers: { bufL: ${low} + ${i}, bufR: ${mid} + ${j}, W: ${k} }, range: [${low}, ${high}] }])`,
    },
    before(result, returnFrame(result)),
  ];
  for (const statement of writes) {
    const old = nextName();
    edits.push(before(statement, `const ${old} = ${values}[${k}];\n`));
    edits.push(
      after(
        statement,
        frame(
          statement,
          `{ type: 'assign', target: ${JSON.stringify(values + '[')} + ${k} + ']', before: ${old}, value: ${values}[${k}] }`,
          [
            `{ type: 'array.focus', pointers: { W: ${k} }, range: [${low}, ${high}] }`,
            `{ type: 'array.set', index: ${k}, value: ${values}[${k}] }`,
          ],
        ),
      ),
    );
  }
  return applySourceEdits(source, edits);
}
