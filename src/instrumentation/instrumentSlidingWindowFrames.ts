import type {
  AnyNode,
  ArrayExpression,
  CallExpression,
  ExpressionStatement,
  ForStatement,
  FunctionDeclaration,
  Identifier,
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
  beforeNode as before,
  afterNode as after,
} from './edits';

type ArrayDeclaration = VariableDeclaration & {
  readonly declarations: readonly [
    { readonly id: Identifier; readonly init: ArrayExpression },
  ];
};

type Match = {
  readonly array: ArrayDeclaration;
  readonly values: Identifier;
  readonly width: Identifier;
  readonly sum: Identifier;
  readonly best: Identifier;
  readonly firstRight: Identifier;
  readonly secondRight: Identifier;
  readonly sumDeclaration: VariableDeclaration;
  readonly firstAdd: ExpressionStatement;
  readonly bestDeclaration: VariableDeclaration;
  readonly secondAdd: ExpressionStatement;
  readonly secondSubtract: ExpressionStatement;
  readonly check: import('acorn').IfStatement;
  readonly bestWrite: ExpressionStatement;
  readonly result: ReturnStatement;
};

export function instrumentSlidingWindowFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (program === null) return null;
  const matches: Match[] = [];
  for (const statement of program.body) {
    if (!isArrayDeclaration(statement)) continue;
    for (const candidate of program.body) {
      if (candidate.type !== 'FunctionDeclaration') continue;
      const match = matchWindow(program, statement, candidate);
      if (match !== null) matches.push(match);
    }
  }
  const match = matches[0];
  if (matches.length !== 1 || match === undefined) return null;

  const {
    array,
    values,
    width,
    sum,
    best,
    firstRight,
    secondRight,
    sumDeclaration,
    firstAdd,
    bestDeclaration,
    secondAdd,
    secondSubtract,
    check,
    bestWrite,
    result,
  } = match;
  const root = array.declarations[0].id.name;
  const oldFirstSum = createIdentifierAllocator(
    program,
    '__trace_old_first_sum',
  )();
  const oldSecondSum = createIdentifierAllocator(
    program,
    '__trace_old_second_sum',
  )();
  const oldThirdSum = createIdentifierAllocator(
    program,
    '__trace_old_third_sum',
  )();
  const oldBest = createIdentifierAllocator(program, '__trace_old_best')();
  const firstEntering = createIdentifierAllocator(
    program,
    '__trace_first_entering',
  )();
  const nextEntering = createIdentifierAllocator(
    program,
    '__trace_next_entering',
  )();
  const leaving = createIdentifierAllocator(program, '__trace_leaving')();
  const calculation = (
    kind: 'add' | 'subtract',
    operand: string,
    index: string,
  ) =>
    `{ kind: '${kind}', operand: { label: ${JSON.stringify(values.name)} + '[' + (${index}) + ']', value: ${operand} } }`;
  const initialFocus = (right: string) =>
    `{ type: 'array.focus', index: ${right}, pointers: { L: 0, R: ${right} }, range: [0, ${right} + 1] }`;
  const expandedFocus = `{ type: 'array.focus', index: ${secondRight.name}, pointers: { L: ${secondRight.name} - ${width.name}, R: ${secondRight.name} }, range: [${secondRight.name} - ${width.name}, ${secondRight.name} + 1] }`;
  const windowFocus = `{ type: 'array.focus', index: ${secondRight.name}, pointers: { L: ${secondRight.name} - ${width.name} + 1, R: ${secondRight.name} }, range: [${secondRight.name} - ${width.name} + 1, ${secondRight.name} + 1] }`;
  const edits: SourceEdit[] = [
    after(
      array,
      `\ntrace.initialize({ type: 'scene.init', structure: 'array' }, { type: 'array.create', values: ${root} });\n`,
    ),
    after(
      sumDeclaration,
      frame(sumDeclaration, sum.name, 'null', sum.name, []),
    ),
    before(
      firstAdd,
      `const ${oldFirstSum} = ${sum.name};\nconst ${firstEntering} = ${values.name}[${firstRight.name}];\n`,
    ),
    replaceOperand(firstAdd, firstEntering),
    after(
      firstAdd,
      frame(
        firstAdd,
        sum.name,
        oldFirstSum,
        sum.name,
        [initialFocus(firstRight.name)],
        calculation('add', firstEntering, firstRight.name),
      ),
    ),
    after(
      bestDeclaration,
      frame(bestDeclaration, best.name, 'null', best.name, [
        `{ type: 'array.focus', pointers: { L: 0, R: ${width.name} - 1 }, range: [0, ${width.name}] }`,
      ]),
    ),
    before(
      secondAdd,
      `const ${oldSecondSum} = ${sum.name};\nconst ${nextEntering} = ${values.name}[${secondRight.name}];\n`,
    ),
    replaceOperand(secondAdd, nextEntering),
    after(
      secondAdd,
      frame(
        secondAdd,
        sum.name,
        oldSecondSum,
        sum.name,
        [expandedFocus],
        calculation('add', nextEntering, secondRight.name),
      ),
    ),
    before(
      secondSubtract,
      `const ${oldThirdSum} = ${sum.name};\nconst ${leaving} = ${values.name}[${secondRight.name} - ${width.name}];\n`,
    ),
    replaceOperand(secondSubtract, leaving),
    after(
      secondSubtract,
      frame(
        secondSubtract,
        sum.name,
        oldThirdSum,
        sum.name,
        [windowFocus],
        calculation('subtract', leaving, `${secondRight.name} - ${width.name}`),
      ),
    ),
    {
      start: check.test.start,
      end: check.test.end,
      text: `trace.compareScalar(${sum.name}, ${best.name}, 'gt', ${location(check.test)}, ${JSON.stringify(sum.name)}, ${JSON.stringify(best.name)}, [{ type: 'array.focus', index: ${secondRight.name} }])`,
    },
    before(bestWrite, `const ${oldBest} = ${best.name};\n`),
    after(
      bestWrite,
      frame(bestWrite, best.name, oldBest, best.name, [windowFocus]),
    ),
    {
      start: result.argument!.start,
      end: result.argument!.end,
      text: `trace.returnValue(${best.name}, ${location(result)}, 'best sum')`,
    },
  ];
  return applySourceEdits(source, edits);
}

function matchWindow(
  program: NonNullable<ReturnType<typeof parseJavaScript>>,
  array: ArrayDeclaration,
  fn: FunctionDeclaration,
): Match | null {
  if (
    fn.id === null ||
    fn.params.length !== 2 ||
    fn.params[0]?.type !== 'Identifier' ||
    fn.params[1]?.type !== 'Identifier'
  )
    return null;
  const values = fn.params[0];
  const width = fn.params[1];
  const root = array.declarations[0].id.name;
  const calls: CallExpression[] = [];
  walkAst(program, (node) => {
    if (
      node.type === 'CallExpression' &&
      isNamed(node.callee, fn.id?.name ?? '') &&
      node.arguments.length === 2 &&
      isNamed(node.arguments[0], root)
    )
      calls.push(node);
  });
  const call = calls[0];
  if (
    calls.length !== 1 ||
    call === undefined ||
    call.arguments[1]?.type !== 'Identifier'
  )
    return null;
  const sizeName = call.arguments[1].name;
  const sizeDeclarations = program.body.filter(
    (statement) =>
      statement.type === 'VariableDeclaration' &&
      statement.declarations.length === 1 &&
      isNamed(statement.declarations[0]?.id, sizeName) &&
      statement.declarations[0]?.init?.type === 'Literal' &&
      typeof statement.declarations[0].init.value === 'number',
  );
  if (sizeDeclarations.length !== 1) return null;
  const size = (sizeDeclarations[0] as VariableDeclaration).declarations[0]
    ?.init;
  if (
    size?.type !== 'Literal' ||
    typeof size.value !== 'number' ||
    !Number.isInteger(size.value) ||
    size.value < 1 ||
    size.value > array.declarations[0].init.elements.length
  )
    return null;

  const body = fn.body.body;
  if (body.length !== 5) return null;
  const [sumDeclaration, firstLoop, bestDeclaration, secondLoop, result] = body;
  if (
    sumDeclaration?.type !== 'VariableDeclaration' ||
    bestDeclaration?.type !== 'VariableDeclaration' ||
    firstLoop?.type !== 'ForStatement' ||
    secondLoop?.type !== 'ForStatement' ||
    result?.type !== 'ReturnStatement' ||
    sumDeclaration.declarations.length !== 1 ||
    bestDeclaration.declarations.length !== 1
  )
    return null;
  const sumInit = sumDeclaration.declarations[0];
  const bestInit = bestDeclaration.declarations[0];
  if (
    sumInit?.id.type !== 'Identifier' ||
    sumInit.init?.type !== 'Literal' ||
    sumInit.init.value !== 0 ||
    bestInit?.id.type !== 'Identifier' ||
    !isNamed(bestInit.init, sumInit.id.name) ||
    !isNamed(result.argument, bestInit.id.name)
  )
    return null;
  const sum = sumInit.id;
  const best = bestInit.id;
  const firstRight = matchLoop(firstLoop, 'zero', width.name, values.name);
  const secondRight = matchLoop(secondLoop, 'width', width.name, values.name);
  if (
    firstRight === null ||
    secondRight === null ||
    firstLoop.body.type !== 'BlockStatement' ||
    secondLoop.body.type !== 'BlockStatement'
  )
    return null;
  const [firstAdd] = firstLoop.body.body;
  const [secondAdd, secondSubtract, check] = secondLoop.body.body;
  if (
    firstLoop.body.body.length !== 1 ||
    secondLoop.body.body.length !== 3 ||
    firstAdd?.type !== 'ExpressionStatement' ||
    secondAdd?.type !== 'ExpressionStatement' ||
    secondSubtract?.type !== 'ExpressionStatement' ||
    check?.type !== 'IfStatement' ||
    !isSumWrite(
      firstAdd,
      sum.name,
      values.name,
      firstRight.name,
      width.name,
      '+=',
      false,
    ) ||
    !isSumWrite(
      secondAdd,
      sum.name,
      values.name,
      secondRight.name,
      width.name,
      '+=',
      false,
    ) ||
    !isSumWrite(
      secondSubtract,
      sum.name,
      values.name,
      secondRight.name,
      width.name,
      '-=',
      true,
    ) ||
    check.test.type !== 'BinaryExpression' ||
    check.test.operator !== '>' ||
    !isNamed(check.test.left, sum.name) ||
    !isNamed(check.test.right, best.name) ||
    check.consequent.type !== 'BlockStatement' ||
    check.consequent.body.length !== 1 ||
    check.alternate !== null
  )
    return null;
  const bestWrite = check.consequent.body[0];
  if (
    bestWrite?.type !== 'ExpressionStatement' ||
    bestWrite.expression.type !== 'AssignmentExpression' ||
    bestWrite.expression.operator !== '=' ||
    !isNamed(bestWrite.expression.left, best.name) ||
    !isNamed(bestWrite.expression.right, sum.name)
  )
    return null;
  return {
    array,
    values,
    width,
    sum,
    best,
    firstRight,
    secondRight,
    sumDeclaration,
    firstAdd,
    bestDeclaration,
    secondAdd,
    secondSubtract,
    check,
    bestWrite,
    result,
  };
}

function matchLoop(
  loop: ForStatement,
  start: 'zero' | 'width',
  width: string,
  values: string,
): Identifier | null {
  if (
    loop.init?.type !== 'VariableDeclaration' ||
    loop.init.declarations.length !== 1
  )
    return null;
  const declaration = loop.init.declarations[0];
  if (declaration?.id.type !== 'Identifier') return null;
  const right = declaration.id;
  if (
    start === 'zero'
      ? declaration.init?.type !== 'Literal' || declaration.init.value !== 0
      : !isNamed(declaration.init, width)
  )
    return null;
  if (
    loop.test?.type !== 'BinaryExpression' ||
    loop.test.operator !== '<' ||
    !isNamed(loop.test.left, right.name) ||
    (start === 'zero'
      ? !isNamed(loop.test.right, width)
      : !isLength(loop.test.right, values)) ||
    loop.update?.type !== 'UpdateExpression' ||
    loop.update.operator !== '++' ||
    !isNamed(loop.update.argument, right.name)
  )
    return null;
  return right;
}

function isSumWrite(
  statement: ExpressionStatement,
  sum: string,
  values: string,
  right: string,
  width: string,
  operator: string,
  offset: boolean,
): boolean {
  const expression = statement.expression;
  if (
    expression.type !== 'AssignmentExpression' ||
    expression.operator !== operator ||
    !isNamed(expression.left, sum) ||
    expression.right.type !== 'MemberExpression' ||
    !expression.right.computed ||
    !isNamed(expression.right.object, values)
  )
    return false;
  const index = expression.right.property;
  return offset
    ? index.type === 'BinaryExpression' &&
        index.operator === '-' &&
        isNamed(index.left, right) &&
        isNamed(index.right, width)
    : isNamed(index, right);
}

function isArrayDeclaration(node: AnyNode): node is ArrayDeclaration {
  if (node.type !== 'VariableDeclaration' || node.declarations.length !== 1)
    return false;
  const declaration = node.declarations[0];
  return (
    declaration?.id.type === 'Identifier' &&
    declaration.init?.type === 'ArrayExpression' &&
    declaration.init.elements.every(isFiniteNumericLiteral)
  );
}

function isLength(node: AnyNode, values: string): boolean {
  return (
    node.type === 'MemberExpression' &&
    !node.computed &&
    isNamed(node.object, values) &&
    isNamed(node.property, 'length')
  );
}

function frame(
  node: AnyNode,
  target: string,
  beforeValue: string,
  value: string,
  commands: readonly string[],
  calculation?: string,
): string {
  return `\ntrace.frame({ source: ${location(node)}, operation: { type: 'assign', target: ${JSON.stringify(target)}, before: ${beforeValue}, value: ${value}${calculation === undefined ? '' : `, calculation: ${calculation}`} }, commands: [${commands.join(', ')}] });\n`;
}

function replaceOperand(
  statement: ExpressionStatement,
  temporary: string,
): SourceEdit {
  if (statement.expression.type !== 'AssignmentExpression')
    throw new Error('Expected a compound array assignment.');
  return {
    start: statement.expression.right.start,
    end: statement.expression.right.end,
    text: temporary,
  };
}
