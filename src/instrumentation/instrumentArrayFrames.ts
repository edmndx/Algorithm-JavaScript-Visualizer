import type {
  AnyNode,
  ArrayExpression,
  BinaryExpression,
  CallExpression,
  ExpressionStatement,
  FunctionDeclaration,
  Identifier,
  IfStatement,
  ReturnStatement,
  VariableDeclaration,
} from 'acorn';
import { isNamed } from './matchers';
import {
  createIdentifierAllocator,
  isFiniteNumericLiteral,
  parseJavaScript,
  walkAst,
} from './ast';
import {
  applySourceEdits,
  sourceSpan as location,
  type SourceEdit,
  afterNode as insertAfter,
  beforeNode as insertBefore,
} from './edits';

type Declaration = VariableDeclaration & {
  readonly declarations: readonly [
    {
      readonly id: Identifier;
      readonly init: ArrayExpression;
    },
  ];
};

type SearchMatch = {
  readonly declaration: Declaration;
  readonly parameter: Identifier;
  readonly target: Identifier;
  readonly low: Identifier;
  readonly high: Identifier;
  readonly middle: Identifier;
  readonly lowDeclaration: VariableDeclaration;
  readonly highDeclaration: VariableDeclaration;
  readonly middleDeclaration: VariableDeclaration;
  readonly found: IfStatement;
  readonly branch: IfStatement;
  readonly lowWrite: ExpressionStatement;
  readonly highWrite: ExpressionStatement;
  readonly foundReturn: ReturnStatement;
  readonly missingReturn: ReturnStatement;
};

export function instrumentArrayFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (program === null) return null;

  const arrays = program.body.filter(isNumericArrayDeclaration);
  const functions = program.body.filter(
    (node): node is FunctionDeclaration =>
      node.type === 'FunctionDeclaration' && node.id !== null,
  );
  const matches: SearchMatch[] = [];
  for (const declaration of arrays)
    for (const fn of functions) {
      const match = matchBoundarySearch(program, declaration, fn);
      if (match !== null) matches.push(match);
    }
  const match = matches[0];
  if (matches.length !== 1 || match === undefined) return null;

  const {
    declaration,
    parameter,
    target,
    low,
    high,
    middle,
    lowDeclaration,
    highDeclaration,
    middleDeclaration,
    found,
    branch,
    lowWrite,
    highWrite,
    foundReturn,
    missingReturn,
  } = match;
  const root = declaration.declarations[0].id.name;
  const oldLow = createIdentifierAllocator(program, '__trace_old_low')();
  const oldHigh = createIdentifierAllocator(program, '__trace_old_high')();
  const focus = `{ type: 'array.focus', pointers: { L: ${low.name}, R: ${high.name}, M: ${middle.name} }, range: [${low.name}, ${high.name} + 1] }`;
  const edits: SourceEdit[] = [
    insertAfter(
      declaration,
      `\ntrace.initialize({ type: 'scene.init', structure: 'array' }, { type: 'array.create', values: ${root} });\n`,
    ),
    insertAfter(
      lowDeclaration,
      assignmentFrame(lowDeclaration, low.name, 'null', low.name, [
        `{ type: 'array.focus', pointers: { L: ${low.name} } }`,
      ]),
    ),
    insertAfter(
      highDeclaration,
      assignmentFrame(highDeclaration, high.name, 'null', high.name, [
        `{ type: 'array.focus', pointers: { L: ${low.name}, R: ${high.name} }, range: [${low.name}, ${high.name} + 1] }`,
      ]),
    ),
    insertAfter(
      middleDeclaration,
      assignmentFrame(middleDeclaration, middle.name, 'null', middle.name, [
        focus,
      ]),
    ),
    replaceComparison(source, found, parameter.name, middle.name, target.name),
    replaceComparison(source, branch, parameter.name, middle.name, target.name),
    insertBefore(lowWrite, `const ${oldLow} = ${low.name};\n`),
    insertAfter(
      lowWrite,
      assignmentFrame(lowWrite, low.name, oldLow, low.name, [focus]),
    ),
    insertBefore(highWrite, `const ${oldHigh} = ${high.name};\n`),
    insertAfter(
      highWrite,
      assignmentFrame(highWrite, high.name, oldHigh, high.name, [focus]),
    ),
    replaceReturn(source, foundReturn, 'matching index'),
    replaceReturn(source, missingReturn, 'search result'),
  ];
  return applySourceEdits(source, edits);
}

function matchBoundarySearch(
  program: NonNullable<ReturnType<typeof parseJavaScript>>,
  declaration: Declaration,
  fn: FunctionDeclaration,
): SearchMatch | null {
  if (fn.id === null || fn.params.length !== 2) return null;
  const root = declaration.declarations[0].id.name;
  const calls: CallExpression[] = [];
  walkAst(program, (node) => {
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === fn.id?.name &&
      node.arguments.some(
        (argument) => argument.type === 'Identifier' && argument.name === root,
      )
    )
      calls.push(node);
  });
  const call = calls[0];
  if (calls.length !== 1 || call === undefined || call.arguments.length !== 2)
    return null;
  const arrayArgument = call.arguments.findIndex(
    (argument) => argument.type === 'Identifier' && argument.name === root,
  );
  const parameter = fn.params[arrayArgument];
  const target = fn.params[1 - arrayArgument];
  if (
    arrayArgument < 0 ||
    parameter?.type !== 'Identifier' ||
    target?.type !== 'Identifier'
  )
    return null;

  const body = fn.body.body;
  if (body.length !== 4) return null;
  const [lowDeclaration, highDeclaration, loop, missingReturn] = body;
  if (
    lowDeclaration?.type !== 'VariableDeclaration' ||
    highDeclaration?.type !== 'VariableDeclaration' ||
    loop?.type !== 'WhileStatement' ||
    missingReturn?.type !== 'ReturnStatement' ||
    !isNegativeOne(missingReturn.argument)
  )
    return null;
  const lowDeclarator = lowDeclaration.declarations[0];
  const highDeclarator = highDeclaration.declarations[0];
  if (
    lowDeclaration.declarations.length !== 1 ||
    highDeclaration.declarations.length !== 1 ||
    lowDeclarator?.id.type !== 'Identifier' ||
    lowDeclarator.init?.type !== 'Literal' ||
    lowDeclarator.init.value !== 0 ||
    highDeclarator?.id.type !== 'Identifier' ||
    !isLengthMinusOne(highDeclarator.init, parameter.name)
  )
    return null;
  const low = lowDeclarator.id;
  const high = highDeclarator.id;
  if (
    loop.test.type !== 'BinaryExpression' ||
    loop.test.operator !== '<=' ||
    !isNamed(loop.test.left, low.name) ||
    !isNamed(loop.test.right, high.name) ||
    loop.body.type !== 'BlockStatement'
  )
    return null;
  const loopBody = loop.body.body;
  if (loopBody.length !== 3) return null;
  const [middleDeclaration, found, branch] = loopBody;
  if (
    middleDeclaration?.type !== 'VariableDeclaration' ||
    found?.type !== 'IfStatement' ||
    branch?.type !== 'IfStatement' ||
    middleDeclaration.declarations.length !== 1
  )
    return null;
  const middleDeclarator = middleDeclaration.declarations[0];
  if (
    middleDeclarator?.id.type !== 'Identifier' ||
    !isFloorMidpoint(middleDeclarator.init, low.name, high.name)
  )
    return null;
  const middle = middleDeclarator.id;
  if (
    !isArrayComparison(
      found.test,
      parameter.name,
      middle.name,
      target.name,
      '===',
    ) ||
    !isArrayComparison(
      branch.test,
      parameter.name,
      middle.name,
      target.name,
      '<',
    ) ||
    found.consequent.type !== 'ReturnStatement' ||
    !isNamed(found.consequent.argument, middle.name) ||
    branch.consequent.type !== 'BlockStatement' ||
    branch.alternate?.type !== 'BlockStatement'
  )
    return null;
  const [lowWrite] = branch.consequent.body;
  const [highWrite] = branch.alternate.body;
  if (
    branch.consequent.body.length !== 1 ||
    branch.alternate.body.length !== 1 ||
    lowWrite?.type !== 'ExpressionStatement' ||
    highWrite?.type !== 'ExpressionStatement' ||
    !isBoundaryWrite(lowWrite, low.name, middle.name, '+') ||
    !isBoundaryWrite(highWrite, high.name, middle.name, '-')
  )
    return null;
  return {
    declaration,
    parameter,
    target,
    low,
    high,
    middle,
    lowDeclaration,
    highDeclaration,
    middleDeclaration,
    found,
    branch,
    lowWrite,
    highWrite,
    foundReturn: found.consequent,
    missingReturn,
  };
}

function isNumericArrayDeclaration(node: AnyNode): node is Declaration {
  if (node.type !== 'VariableDeclaration' || node.declarations.length !== 1)
    return false;
  const declarator = node.declarations[0];
  return (
    declarator?.id.type === 'Identifier' &&
    declarator.init?.type === 'ArrayExpression' &&
    declarator.init.elements.every(isFiniteNumericLiteral)
  );
}

function isNegativeOne(node: AnyNode | null | undefined): boolean {
  return (
    node?.type === 'UnaryExpression' &&
    node.operator === '-' &&
    node.argument.type === 'Literal' &&
    node.argument.value === 1
  );
}

function isLengthMinusOne(
  node: AnyNode | null | undefined,
  root: string,
): boolean {
  return (
    node?.type === 'BinaryExpression' &&
    node.operator === '-' &&
    node.left.type === 'MemberExpression' &&
    !node.left.computed &&
    isNamed(node.left.object, root) &&
    isNamed(node.left.property, 'length') &&
    node.right.type === 'Literal' &&
    node.right.value === 1
  );
}

function isFloorMidpoint(
  node: AnyNode | null | undefined,
  low: string,
  high: string,
): boolean {
  if (
    node?.type !== 'CallExpression' ||
    node.callee.type !== 'MemberExpression' ||
    !isNamed(node.callee.object, 'Math') ||
    !isNamed(node.callee.property, 'floor') ||
    node.arguments.length !== 1
  )
    return false;
  const division = node.arguments[0];
  return (
    division?.type === 'BinaryExpression' &&
    division.operator === '/' &&
    division.right.type === 'Literal' &&
    division.right.value === 2 &&
    division.left.type === 'BinaryExpression' &&
    division.left.operator === '+' &&
    isNamed(division.left.left, low) &&
    isNamed(division.left.right, high)
  );
}

function isArrayComparison(
  node: AnyNode,
  root: string,
  middle: string,
  target: string,
  operator: string,
): node is BinaryExpression {
  return (
    node.type === 'BinaryExpression' &&
    node.operator === operator &&
    node.left.type === 'MemberExpression' &&
    node.left.computed &&
    isNamed(node.left.object, root) &&
    isNamed(node.left.property, middle) &&
    isNamed(node.right, target)
  );
}

function isBoundaryWrite(
  statement: ExpressionStatement,
  boundary: string,
  middle: string,
  operator: string,
): boolean {
  const expression = statement.expression;
  return (
    expression.type === 'AssignmentExpression' &&
    expression.operator === '=' &&
    isNamed(expression.left, boundary) &&
    expression.right.type === 'BinaryExpression' &&
    expression.right.operator === operator &&
    isNamed(expression.right.left, middle) &&
    expression.right.right.type === 'Literal' &&
    expression.right.right.value === 1
  );
}

function assignmentFrame(
  node: AnyNode,
  target: string,
  before: string,
  value: string,
  commands: readonly string[],
): string {
  return `\ntrace.frame({ source: ${location(node)}, operation: { type: 'assign', target: ${JSON.stringify(target)}, before: ${before}, value: ${value} }, commands: [${commands.join(', ')}] });\n`;
}

function replaceComparison(
  source: string,
  statement: IfStatement,
  root: string,
  middle: string,
  target: string,
): SourceEdit {
  const test = statement.test as BinaryExpression;
  const operator = test.operator === '===' ? 'eq' : 'lt';
  return {
    start: test.start,
    end: test.end,
    text: `trace.compareArray(${root}, ${middle}, ${target}, '${operator}', ${location(test)}, ${JSON.stringify(source.slice(test.left.start, test.left.end))}, ${JSON.stringify(target)})`,
  };
}

function replaceReturn(
  source: string,
  statement: ReturnStatement,
  role: string,
): SourceEdit {
  const argument = statement.argument;
  if (argument == null) throw new Error('Expected a return expression.');
  return {
    start: argument.start,
    end: argument.end,
    text: `trace.returnValue(${source.slice(argument.start, argument.end)}, ${location(statement)}, ${JSON.stringify(role)})`,
  };
}
