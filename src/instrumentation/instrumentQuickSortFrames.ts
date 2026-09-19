import type { AnyNode, Identifier } from 'acorn';
import {
  isNamed as named,
  isLiteralValue as number,
  isIndexedItem as item,
  initializedBinding as binding,
  isIdentifierCall as call,
} from './matchers';
import {
  createIdentifierAllocator,
  hasUnsafeInstrumentationSyntax,
  isFiniteNumericLiteral,
  parseJavaScript,
} from './ast';
import {
  applySourceEdits,
  sourceSpan as span,
  type SourceEdit,
  frameCall as frame,
  replaceNode as replace,
  afterNode as after,
} from './edits';

const length = (node: AnyNode | null | undefined, array: string): boolean =>
  node?.type === 'MemberExpression' &&
  !node.optional &&
  !node.computed &&
  named(node.object, array) &&
  named(node.property, 'length');

function swap(
  node: AnyNode | undefined,
  array: string,
  first: string,
  second: string,
): boolean {
  if (
    node?.type !== 'ExpressionStatement' ||
    node.expression.type !== 'AssignmentExpression' ||
    node.expression.operator !== '=' ||
    node.expression.left.type !== 'ArrayPattern' ||
    node.expression.right.type !== 'ArrayExpression'
  )
    return false;
  const left = node.expression.left.elements,
    right = node.expression.right.elements;
  return (
    left.length === 2 &&
    right.length === 2 &&
    item(left[0], array, first) &&
    item(left[1], array, second) &&
    item(right[0], array, second) &&
    item(right[1], array, first)
  );
}

export function instrumentQuickSortFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (
    !program ||
    hasUnsafeInstrumentationSyntax(program) ||
    program.body.length !== 3
  )
    return null;
  const [arrayStatement, fn, answerStatement] = program.body;
  const array = binding(arrayStatement, 'const'),
    answer = binding(answerStatement, 'const');
  if (
    !array ||
    array.init.type !== 'ArrayExpression' ||
    array.init.elements.length > 64 ||
    !array.init.elements.every((entry) => isFiniteNumericLiteral(entry)) ||
    fn?.type !== 'FunctionDeclaration' ||
    !fn.id ||
    fn.async ||
    fn.generator ||
    fn.params.length !== 3 ||
    fn.params.some((entry) => entry.type !== 'Identifier') ||
    !answer ||
    !call(answer.init, fn.id.name, [
      (arg) => named(arg, array.name),
      (arg) => number(arg, 0),
      (arg) =>
        arg.type === 'BinaryExpression' &&
        arg.operator === '-' &&
        length(arg.left, array.name) &&
        number(arg.right, 1),
    ])
  )
    return null;
  const [items, low, high] = fn.params as [Identifier, Identifier, Identifier];
  const [
    base,
    pivotStatement,
    boundaryStatement,
    scanStatement,
    pivotSwap,
    leftCall,
    rightCall,
    result,
  ] = fn.body.body;
  if (
    fn.body.body.length !== 8 ||
    base?.type !== 'IfStatement' ||
    base.alternate !== null ||
    base.test.type !== 'BinaryExpression' ||
    base.test.operator !== '>=' ||
    !named(base.test.left, low.name) ||
    !named(base.test.right, high.name) ||
    base.consequent.type !== 'ReturnStatement' ||
    !named(base.consequent.argument, items.name) ||
    result?.type !== 'ReturnStatement' ||
    !named(result.argument, items.name)
  )
    return null;
  const pivot = binding(pivotStatement, 'const'),
    boundary = binding(boundaryStatement, 'let');
  if (
    !pivot ||
    !item(pivot.init, items.name, high.name) ||
    !boundary ||
    !named(boundary.init, low.name) ||
    scanStatement?.type !== 'ForStatement' ||
    scanStatement.body.type !== 'BlockStatement'
  )
    return null;
  const scan = binding(scanStatement.init ?? undefined, 'let');
  if (
    !scan ||
    !named(scan.init, low.name) ||
    scanStatement.test?.type !== 'BinaryExpression' ||
    scanStatement.test.operator !== '<' ||
    !named(scanStatement.test.left, scan.name) ||
    !named(scanStatement.test.right, high.name) ||
    scanStatement.update?.type !== 'UpdateExpression' ||
    scanStatement.update.operator !== '++' ||
    !named(scanStatement.update.argument, scan.name) ||
    scanStatement.body.body.length !== 1
  )
    return null;
  const check = scanStatement.body.body[0];
  if (
    check?.type !== 'IfStatement' ||
    check.alternate !== null ||
    check.test.type !== 'BinaryExpression' ||
    check.test.operator !== '<' ||
    !item(check.test.left, items.name, scan.name) ||
    !named(check.test.right, pivot.name) ||
    check.consequent.type !== 'BlockStatement' ||
    check.consequent.body.length !== 2
  )
    return null;
  const [innerSwap, advance] = check.consequent.body;
  if (
    !swap(innerSwap, items.name, boundary.name, scan.name) ||
    advance?.type !== 'ExpressionStatement' ||
    advance.expression.type !== 'UpdateExpression' ||
    advance.expression.operator !== '++' ||
    !named(advance.expression.argument, boundary.name) ||
    !swap(pivotSwap, items.name, boundary.name, high.name) ||
    leftCall?.type !== 'ExpressionStatement' ||
    !call(leftCall.expression, fn.id.name, [
      (arg) => named(arg, items.name),
      (arg) => named(arg, low.name),
      (arg) =>
        arg.type === 'BinaryExpression' &&
        arg.operator === '-' &&
        named(arg.left, boundary.name) &&
        number(arg.right, 1),
    ]) ||
    rightCall?.type !== 'ExpressionStatement' ||
    !call(rightCall.expression, fn.id.name, [
      (arg) => named(arg, items.name),
      (arg) =>
        arg.type === 'BinaryExpression' &&
        arg.operator === '+' &&
        named(arg.left, boundary.name) &&
        number(arg.right, 1),
      (arg) => named(arg, high.name),
    ])
  )
    return null;
  const names = [
    array.name,
    fn.id.name,
    answer.name,
    items.name,
    low.name,
    high.name,
    pivot.name,
    boundary.name,
    scan.name,
  ];
  if (new Set(names).size !== names.length || names.includes('trace'))
    return null;

  const alloc = createIdentifierAllocator(program, '__traceQuick');
  const oldFirst = alloc(),
    oldSecond = alloc(),
    oldBoundary = alloc();

  const focus = `{ type: 'array.focus', index: ${scan.name}, pointers: { L: ${low.name}, R: ${high.name}, P: ${high.name}, scan: ${scan.name}, boundary: ${boundary.name} }, range: [${low.name}, ${high.name} + 1] }`;
  const swapFrame = (node: AnyNode, first: string, second: string) =>
    `{ const ${oldFirst} = ${items.name}[${first}]; const ${oldSecond} = ${items.name}[${second}]; ${source.slice(node.start, node.end)} ${frame(node, `{ type: 'swap', indices: [${first}, ${second}], before: [${oldFirst}, ${oldSecond}], after: [${items.name}[${first}], ${items.name}[${second}]] }`, [`{ type: 'array.swap', indices: [${first}, ${second}] }`, `{ type: 'array.focus', pointers: { L: ${low.name}, R: ${high.name}, P: ${high.name}, boundary: ${boundary.name} }, range: [${low.name}, ${high.name} + 1] }`])} }`;
  const beforeCall = (node: AnyNode, start: string, end: string) =>
    frame(
      node,
      `{ type: 'call', callee: ${JSON.stringify(fn.id.name)}, from: String(${low.name}) + ':' + String(${high.name}), target: String(${start}) + ':' + String(${end}) }`,
      [
        `{ type: 'array.focus', pointers: { L: ${start}, R: ${end} }, range: [${start}, ${end} + 1] }`,
      ],
    );

  const edits: SourceEdit[] = [
    after(
      array.node,
      `\ntrace.initialize({ type: 'scene.init', structure: 'array' }, { type: 'array.create', values: ${array.name} });\n`,
    ),
    replace(
      base.test,
      `trace.compareScalar(${low.name}, ${high.name}, 'gte', ${span(base.test)}, ${JSON.stringify(low.name)}, ${JSON.stringify(high.name)})`,
    ),
    replace(
      base.consequent.argument!,
      `trace.returnValue(${items.name}, ${span(base.consequent)}, 'partition')`,
    ),
    after(
      pivot.node,
      `\n${frame(pivot.node, `{ type: 'assign', target: ${JSON.stringify(pivot.name)}, before: null, value: ${pivot.name} }`, [`{ type: 'array.focus', pointers: { L: ${low.name}, R: ${high.name}, P: ${high.name} }, range: [${low.name}, ${high.name} + 1] }`, `{ type: 'array.mark', marker: 'pivot', indices: [${high.name}] }`])}\n`,
    ),
    after(
      boundary.node,
      `\n${frame(boundary.node, `{ type: 'assign', target: ${JSON.stringify(boundary.name)}, before: null, value: ${boundary.name} }`, [`{ type: 'array.focus', pointers: { L: ${low.name}, R: ${high.name}, P: ${high.name}, boundary: ${boundary.name} }, range: [${low.name}, ${high.name} + 1] }`])}\n`,
    ),
    replace(
      check.test,
      `trace.compareScalar(${items.name}[${scan.name}], ${pivot.name}, 'lt', ${span(check.test)}, ${JSON.stringify(`${items.name}[${scan.name}]`)}, ${JSON.stringify(pivot.name)}, [${focus}, { type: 'array.compareValue', index: ${scan.name}, value: ${pivot.name}, operator: 'lt' }])`,
    ),
    replace(innerSwap!, swapFrame(innerSwap!, boundary.name, scan.name)),
    replace(
      advance!,
      `{ const ${oldBoundary} = ${boundary.name}; ${source.slice(advance!.start, advance!.end)} ${frame(advance!, `{ type: 'assign', target: ${JSON.stringify(boundary.name)}, before: ${oldBoundary}, value: ${boundary.name} }`, [`{ type: 'array.focus', pointers: { L: ${low.name}, R: ${high.name}, P: ${high.name}, boundary: ${boundary.name} }, range: [${low.name}, ${high.name} + 1] }`])} }`,
    ),
    replace(pivotSwap!, swapFrame(pivotSwap!, boundary.name, high.name)),
    {
      start: leftCall!.start,
      end: leftCall!.start,
      text: `${beforeCall(leftCall!, low.name, `${boundary.name} - 1`)}\n`,
    },
    {
      start: rightCall!.start,
      end: rightCall!.start,
      text: `${beforeCall(rightCall!, `${boundary.name} + 1`, high.name)}\n`,
    },
    replace(
      result,
      `{ ${frame(result, `{ type: 'return', value: ${items.name} }`, [`{ type: 'array.mark', marker: 'pivot', indices: [] }`, `{ type: 'array.focus', pointers: {}, range: [${low.name}, ${high.name} + 1] }`])} return ${items.name}; }`,
    ),
  ];
  return applySourceEdits(source, edits);
}
