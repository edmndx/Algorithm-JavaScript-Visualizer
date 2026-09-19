import type { AnyNode, Identifier } from 'acorn';
import {
  isNamed as named,
  isLiteralValue as number,
  isNamedMember as member,
  initializedBinding as binding,
  isIdentifierCall as call,
} from './matchers';
import {
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

function method(
  node: AnyNode | null | undefined,
  receiver: string,
  name: string,
  argumentsMatch: readonly ((node: AnyNode) => boolean)[],
): boolean {
  return (
    node?.type === 'CallExpression' &&
    !node.optional &&
    node.callee.type === 'MemberExpression' &&
    !node.callee.optional &&
    !node.callee.computed &&
    named(node.callee.object, receiver) &&
    named(node.callee.property, name) &&
    node.arguments.length === argumentsMatch.length &&
    node.arguments.every((arg, index) => argumentsMatch[index]!(arg))
  );
}

function nextIndex(node: AnyNode, index: string): boolean {
  return (
    node.type === 'BinaryExpression' &&
    node.operator === '+' &&
    named(node.left, index) &&
    number(node.right, 1)
  );
}

function includeSum(
  node: AnyNode,
  sum: string,
  input: string,
  index: string,
): boolean {
  return (
    node.type === 'BinaryExpression' &&
    node.operator === '+' &&
    named(node.left, sum) &&
    node.right.type === 'MemberExpression' &&
    !node.right.optional &&
    node.right.computed &&
    named(node.right.object, input) &&
    named(node.right.property, index)
  );
}

export function instrumentSubsetFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (
    !program ||
    hasUnsafeInstrumentationSyntax(program) ||
    program.body.length !== 4
  )
    return null;
  const [arrayStatement, targetStatement, fn, answerStatement] = program.body;
  const array = binding(arrayStatement, 'const');
  const target = binding(targetStatement, 'const');
  const answer = binding(answerStatement, 'const');
  if (
    !array ||
    array.init.type !== 'ArrayExpression' ||
    array.init.elements.length > 12 ||
    !array.init.elements.every(
      (item) =>
        isFiniteNumericLiteral(item) &&
        item?.type === 'Literal' &&
        Number.isSafeInteger(item.value) &&
        Number(item.value) >= 0,
    ) ||
    !target ||
    target.init.type !== 'Literal' ||
    typeof target.init.value !== 'number' ||
    !Number.isSafeInteger(target.init.value) ||
    target.init.value < 0 ||
    fn?.type !== 'FunctionDeclaration' ||
    !fn.id ||
    fn.async ||
    fn.generator ||
    fn.params.length !== 2 ||
    fn.params.some((item) => item.type !== 'Identifier') ||
    !answer ||
    !call(answer.init, fn.id.name, [
      (arg) => named(arg, array.name),
      (arg) => named(arg, target.name),
    ])
  )
    return null;
  const input = (fn.params[0] as Identifier).name;
  const goal = (fn.params[1] as Identifier).name;
  const [selectionStatement, inner, result] = fn.body.body;
  const selected = binding(selectionStatement, 'const');
  if (
    fn.body.body.length !== 3 ||
    !selected ||
    selected.init.type !== 'ArrayExpression' ||
    selected.init.elements.length !== 0 ||
    inner?.type !== 'FunctionDeclaration' ||
    !inner.id ||
    inner.async ||
    inner.generator ||
    inner.params.length !== 2 ||
    inner.params.some((item) => item.type !== 'Identifier') ||
    result?.type !== 'ReturnStatement' ||
    result.argument?.type !== 'ConditionalExpression'
  )
    return null;
  const index = (inner.params[0] as Identifier).name;
  const sum = (inner.params[1] as Identifier).name;
  const [found, exhausted, choose, include, undo, exclude] = inner.body.body;
  if (
    inner.body.body.length !== 6 ||
    found?.type !== 'IfStatement' ||
    found.alternate !== null ||
    found.test.type !== 'BinaryExpression' ||
    found.test.operator !== '===' ||
    !named(found.test.left, sum) ||
    !named(found.test.right, goal) ||
    found.consequent.type !== 'ReturnStatement' ||
    found.consequent.argument?.type !== 'Literal' ||
    found.consequent.argument.value !== true ||
    exhausted?.type !== 'IfStatement' ||
    exhausted.alternate !== null ||
    exhausted.test.type !== 'LogicalExpression' ||
    exhausted.test.operator !== '||' ||
    exhausted.test.left.type !== 'BinaryExpression' ||
    exhausted.test.left.operator !== '===' ||
    !named(exhausted.test.left.left, index) ||
    !member(exhausted.test.left.right, input, 'length') ||
    exhausted.test.right.type !== 'BinaryExpression' ||
    exhausted.test.right.operator !== '>' ||
    !named(exhausted.test.right.left, sum) ||
    !named(exhausted.test.right.right, goal) ||
    exhausted.consequent.type !== 'ReturnStatement' ||
    exhausted.consequent.argument?.type !== 'Literal' ||
    exhausted.consequent.argument.value !== false ||
    choose?.type !== 'ExpressionStatement' ||
    !method(choose.expression, selected.name, 'push', [
      (arg) => named(arg, index),
    ]) ||
    include?.type !== 'IfStatement' ||
    include.alternate !== null ||
    !call(include.test, inner.id.name, [
      (arg) => nextIndex(arg, index),
      (arg) => includeSum(arg, sum, input, index),
    ]) ||
    include.consequent.type !== 'ReturnStatement' ||
    include.consequent.argument?.type !== 'Literal' ||
    include.consequent.argument.value !== true ||
    undo?.type !== 'ExpressionStatement' ||
    !method(undo.expression, selected.name, 'pop', []) ||
    exclude?.type !== 'ReturnStatement' ||
    !call(exclude.argument, inner.id.name, [
      (arg) => nextIndex(arg, index),
      (arg) => named(arg, sum),
    ])
  )
    return null;
  const outerResult = result.argument;
  if (
    !call(outerResult.test, inner.id.name, [
      (arg) => number(arg, 0),
      (arg) => number(arg, 0),
    ]) ||
    !method(outerResult.consequent, selected.name, 'slice', []) ||
    outerResult.alternate.type !== 'Literal' ||
    outerResult.alternate.value !== null
  )
    return null;
  const names = [
    array.name,
    target.name,
    fn.id.name,
    answer.name,
    input,
    goal,
    selected.name,
    inner.id.name,
    index,
    sum,
  ];
  if (new Set(names).size !== names.length || names.includes('trace'))
    return null;

  const mark = `{ type: 'array.mark', marker: 'selected', indices: ${selected.name} }`;
  const focus = `{ type: 'array.focus', index: ${index} }`;

  const callFact = (node: AnyNode) =>
    frame(
      node,
      `{ type: 'call', callee: ${JSON.stringify(inner.id.name)}, from: String(${index}), target: String(${index} + 1) }`,
      [focus, mark],
    );

  const removed = '__trace_subset_removed';
  if (names.includes(removed)) return null;
  const edits: SourceEdit[] = [
    after(
      array.node,
      `\ntrace.initialize({ type: 'scene.init', structure: 'array' }, { type: 'array.create', values: ${array.name} });\n`,
    ),
    replace(
      found.test,
      `trace.compareScalar(${sum}, ${goal}, 'eq', ${span(found.test)}, ${JSON.stringify(sum)}, ${JSON.stringify(goal)})`,
    ),
    replace(
      found.consequent.argument!,
      `trace.returnValue(true, ${span(found.consequent)}, 'branch result')`,
    ),
    replace(
      exhausted.test.left,
      `trace.compareScalar(${index}, ${input}.length, 'eq', ${span(exhausted.test.left)}, ${JSON.stringify(index)}, ${JSON.stringify(`${input}.length`)})`,
    ),
    replace(
      exhausted.test.right,
      `trace.compareScalar(${sum}, ${goal}, 'gt', ${span(exhausted.test.right)}, ${JSON.stringify(sum)}, ${JSON.stringify(goal)})`,
    ),
    replace(
      exhausted.consequent.argument!,
      `trace.returnValue(false, ${span(exhausted.consequent)}, 'branch result')`,
    ),
    after(
      choose,
      `\n${frame(choose, `{ type: 'collection', action: 'add', role: 'selection', item: ${index} }`, [mark, focus])}\n`,
    ),
    replace(
      include.test,
      `(() => { ${callFact(include.test)} return trace.compareScalar(${source.slice(include.test.start, include.test.end)}, true, 'eq', ${span(include.test)}, 'include branch', 'true', [${focus}]); })()`,
    ),
    replace(
      include.consequent.argument!,
      `trace.returnValue(true, ${span(include.consequent)}, 'branch result')`,
    ),
    replace(
      undo,
      `{ const ${removed} = ${selected.name}.pop(); ${frame(undo, `{ type: 'collection', action: 'remove', role: 'selection', item: ${removed} }`, [mark, focus])} }`,
    ),
    replace(
      exclude.argument!,
      `(() => { ${callFact(exclude.argument!)} return trace.returnValue(${source.slice(exclude.argument!.start, exclude.argument!.end)}, ${span(exclude)}, 'branch result'); })()`,
    ),
    {
      start: result.start,
      end: result.start,
      text: `\n${frame(outerResult.test, `{ type: 'call', callee: ${JSON.stringify(inner.id.name)}, from: null, target: '0' }`, [])}\n`,
    },
    replace(
      result.argument!,
      `trace.returnValue(${source.slice(result.argument!.start, result.argument!.end)}, ${span(result)}, 'selected indices')`,
    ),
  ];
  return applySourceEdits(source, edits);
}
