import type { AnyNode, ExpressionStatement } from 'acorn';
import {
  isNamed as named,
  isLiteralValue as literal,
  isNamedMember as property,
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
} from './edits';

function binding(node: AnyNode | undefined, kind: 'const' | 'let') {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== kind ||
    node.declarations.length !== 1
  )
    return null;
  const entry = node.declarations[0];
  return entry?.id.type === 'Identifier' && entry.init
    ? { statement: node, name: entry.id.name, init: entry.init }
    : null;
}

function maxCall(
  node: AnyNode | null | undefined,
  left: (node: AnyNode) => boolean,
  right: (node: AnyNode) => boolean,
): boolean {
  return (
    node?.type === 'CallExpression' &&
    !node.optional &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.computed &&
    !node.callee.optional &&
    named(node.callee.object, 'Math') &&
    named(node.callee.property, 'max') &&
    node.arguments.length === 2 &&
    left(node.arguments[0]!) &&
    right(node.arguments[1]!)
  );
}

function loop(
  node: AnyNode | undefined,
  start: number,
  bound: (node: AnyNode) => boolean,
) {
  if (node?.type !== 'ForStatement' || node.body.type !== 'BlockStatement')
    return null;
  const variable = binding(node.init ?? undefined, 'let');
  if (
    !variable ||
    !literal(variable.init, start) ||
    node.test?.type !== 'BinaryExpression' ||
    node.test.operator !== '<' ||
    !named(node.test.left, variable.name) ||
    !bound(node.test.right) ||
    node.update?.type !== 'UpdateExpression' ||
    node.update.operator !== '++' ||
    !named(node.update.argument, variable.name)
  )
    return null;
  return { name: variable.name, body: node.body.body };
}

function assignment(
  node: AnyNode | undefined,
  target: (node: AnyNode) => boolean,
): ExpressionStatement | null {
  return node?.type === 'ExpressionStatement' &&
    node.expression.type === 'AssignmentExpression' &&
    node.expression.operator === '=' &&
    target(node.expression.left)
    ? node
    : null;
}

export function instrumentLisFrames(
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
  const array = binding(arrayStatement, 'const');
  const answer = binding(answerStatement, 'const');
  if (
    !array ||
    array.init.type !== 'ArrayExpression' ||
    !array.init.elements.every((entry) => isFiniteNumericLiteral(entry)) ||
    fn?.type !== 'FunctionDeclaration' ||
    !fn.id ||
    fn.async ||
    fn.generator ||
    fn.params.length !== 1 ||
    fn.params[0]?.type !== 'Identifier' ||
    !answer ||
    answer.init.type !== 'CallExpression' ||
    answer.init.optional ||
    !named(answer.init.callee, fn.id.name) ||
    answer.init.arguments.length !== 1 ||
    !named(answer.init.arguments[0], array.name)
  )
    return null;
  const input = fn.params[0].name;
  const [empty, lengthsStatement, bestStatement, outerStatement, result] =
    fn.body.body;
  if (
    fn.body.body.length !== 5 ||
    empty?.type !== 'IfStatement' ||
    empty.alternate !== null ||
    empty.test.type !== 'BinaryExpression' ||
    empty.test.operator !== '===' ||
    !property(empty.test.left, input, 'length') ||
    !literal(empty.test.right, 0) ||
    empty.consequent.type !== 'ReturnStatement' ||
    !literal(empty.consequent.argument, 0) ||
    result?.type !== 'ReturnStatement'
  )
    return null;
  const lengths = binding(lengthsStatement, 'const');
  const best = binding(bestStatement, 'let');
  if (
    !lengths ||
    !best ||
    !literal(best.init, 1) ||
    lengths.init.type !== 'CallExpression' ||
    lengths.init.optional ||
    lengths.init.callee.type !== 'MemberExpression' ||
    lengths.init.callee.computed ||
    !named(lengths.init.callee.property, 'fill') ||
    lengths.init.arguments.length !== 1 ||
    !literal(lengths.init.arguments[0], 1) ||
    lengths.init.callee.object.type !== 'CallExpression' ||
    !named(lengths.init.callee.object.callee, 'Array') ||
    lengths.init.callee.object.arguments.length !== 1 ||
    !property(lengths.init.callee.object.arguments[0], input, 'length') ||
    !named(result.argument, best.name)
  )
    return null;
  const outer = loop(outerStatement, 1, (node) =>
    property(node, input, 'length'),
  );
  if (!outer || outer.body.length !== 2) return null;
  const inner = loop(outer.body[0], 0, (node) => named(node, outer.name));
  if (!inner || inner.body.length !== 1) return null;
  const check = inner.body[0];
  if (
    check?.type !== 'IfStatement' ||
    check.alternate !== null ||
    check.test.type !== 'BinaryExpression' ||
    check.test.operator !== '<' ||
    !item(check.test.left, input, inner.name) ||
    !item(check.test.right, input, outer.name) ||
    check.consequent.type !== 'BlockStatement' ||
    check.consequent.body.length !== 1
  )
    return null;
  const dpWrite = assignment(check.consequent.body[0], (node) =>
    item(node, lengths.name, outer.name),
  );
  const bestWrite = assignment(outer.body[1], (node) => named(node, best.name));
  if (
    !dpWrite ||
    !bestWrite ||
    dpWrite.expression.type !== 'AssignmentExpression' ||
    bestWrite.expression.type !== 'AssignmentExpression' ||
    !maxCall(
      dpWrite.expression.right,
      (node) => item(node, lengths.name, outer.name),
      (node) =>
        node.type === 'BinaryExpression' &&
        node.operator === '+' &&
        item(node.left, lengths.name, inner.name) &&
        literal(node.right, 1),
    ) ||
    !maxCall(
      bestWrite.expression.right,
      (node) => named(node, best.name),
      (node) => item(node, lengths.name, outer.name),
    )
  )
    return null;
  const names = [
    array.name,
    answer.name,
    fn.id.name,
    input,
    lengths.name,
    best.name,
    outer.name,
    inner.name,
  ];
  if (
    new Set(names).size !== names.length ||
    names.some((name) => ['trace', 'Math', 'Array'].includes(name))
  )
    return null;

  const allocate = createIdentifierAllocator(program, '__traceLis');
  const before = allocate(),
    candidate = allocate(),
    next = allocate();
  const focus = (withInner: boolean) =>
    `{ type: 'array.focus', index: ${outer.name}, pointers: { i: ${outer.name}${withInner ? `, j: ${inner.name}` : ''} } }`;
  const edits: SourceEdit[] = [
    {
      start: array.statement.end,
      end: array.statement.end,
      text: `\ntrace.initialize({ type: 'scene.init', structure: 'array' }, { type: 'array.create', values: ${array.name} });\n`,
    },
    {
      start: empty.consequent.argument!.start,
      end: empty.consequent.argument!.end,
      text: `trace.returnValue(0, ${location(empty.consequent)})`,
    },
    {
      start: lengths.statement.end,
      end: lengths.statement.end,
      text: `\ntrace.frame({ source: ${location(lengths.statement)}, operation: { type: 'assign', target: ${JSON.stringify(lengths.name)}, before: null, value: ${lengths.name} }, commands: [] });\n`,
    },
    {
      start: best.statement.end,
      end: best.statement.end,
      text: `\ntrace.frame({ source: ${location(best.statement)}, operation: { type: 'assign', target: ${JSON.stringify(best.name)}, before: null, value: ${best.name} }, commands: [] });\n`,
    },
    {
      start: check.test.start,
      end: check.test.end,
      text: `trace.compareScalar(${input}[${inner.name}], ${input}[${outer.name}], 'lt', ${location(check.test)}, ${JSON.stringify(`${input}[${inner.name}]`)}, ${JSON.stringify(`${input}[${outer.name}]`)}, [${focus(true)}])`,
    },
    {
      start: dpWrite.start,
      end: dpWrite.end,
      text: `{ const ${before} = ${lengths.name}[${outer.name}]; const ${candidate} = ${lengths.name}[${inner.name}] + 1; trace.compareScalar(${before}, ${candidate}, 'gte', ${location(dpWrite.expression.right)}, ${JSON.stringify(`${lengths.name}[${outer.name}]`)}, ${JSON.stringify(`${lengths.name}[${inner.name}] + 1`)}, [${focus(true)}]); const ${next} = Math.max(${before}, ${candidate}); ${lengths.name}[${outer.name}] = ${next}; trace.frame({ source: ${location(dpWrite)}, operation: { type: 'assign', target: ${JSON.stringify(lengths.name)} + '[' + ${outer.name} + ']', before: ${before}, value: ${next} }, commands: [${focus(true)}] }); }`,
    },
    {
      start: bestWrite.start,
      end: bestWrite.end,
      text: `{ const ${before} = ${best.name}; const ${candidate} = ${lengths.name}[${outer.name}]; trace.compareScalar(${before}, ${candidate}, 'gte', ${location(bestWrite.expression.right)}, ${JSON.stringify(best.name)}, ${JSON.stringify(`${lengths.name}[${outer.name}]`)}, [${focus(false)}]); const ${next} = Math.max(${before}, ${candidate}); ${best.name} = ${next}; trace.frame({ source: ${location(bestWrite)}, operation: { type: 'assign', target: ${JSON.stringify(best.name)}, before: ${before}, value: ${next} }, commands: [${focus(false)}, ...(${next} > ${before} ? [{ type: 'array.mark', marker: 'best', indices: [${outer.name}] }] : [])] }); }`,
    },
    {
      start: result.argument!.start,
      end: result.argument!.end,
      text: `trace.returnValue(${best.name}, ${location(result)}, 'LIS length')`,
    },
  ];
  return applySourceEdits(source, edits);
}
