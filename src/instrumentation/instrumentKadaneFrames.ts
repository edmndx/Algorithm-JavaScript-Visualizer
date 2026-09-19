import type {
  AnyNode,
  ArrayExpression,
  CallExpression,
  ExpressionStatement,
  ForStatement,
  FunctionDeclaration,
  Identifier,
  IfStatement,
  ReturnStatement,
  VariableDeclaration,
} from 'acorn';
import { isNamed, isLiteralValue as isLiteral } from './matchers';
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
  readonly current: Identifier;
  readonly best: Identifier;
  readonly currentStart: Identifier;
  readonly bestStart: Identifier;
  readonly bestEnd: Identifier;
  readonly index: Identifier;
  readonly declarations: readonly VariableDeclaration[];
  readonly resetCheck: IfStatement;
  readonly resetCurrent: ExpressionStatement;
  readonly resetStart: ExpressionStatement;
  readonly extendCurrent: ExpressionStatement;
  readonly bestCheck: IfStatement;
  readonly writeBest: ExpressionStatement;
  readonly writeBestStart: ExpressionStatement;
  readonly writeBestEnd: ExpressionStatement;
  readonly result: ReturnStatement;
};

export function instrumentKadaneFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (program === null) return null;
  const matches: Match[] = [];
  for (const statement of program.body) {
    if (!isArrayDeclaration(statement)) continue;
    for (const fn of program.body) {
      if (fn.type !== 'FunctionDeclaration') continue;
      const match = matchKadane(program, statement, fn);
      if (match !== null) matches.push(match);
    }
  }
  const match = matches[0];
  if (matches.length !== 1 || match === undefined) return null;
  const {
    array,
    values,
    current,
    best,
    currentStart,
    bestStart,
    bestEnd,
    index,
    declarations,
    resetCheck,
    resetCurrent,
    resetStart,
    extendCurrent,
    bestCheck,
    writeBest,
    writeBestStart,
    writeBestEnd,
    result,
  } = match;
  const root = array.declarations[0].id.name;
  const oldReset = createIdentifierAllocator(program, '__trace_old_reset')();
  const oldStart = createIdentifierAllocator(program, '__trace_old_start')();
  const oldExtend = createIdentifierAllocator(program, '__trace_old_extend')();
  const addend = createIdentifierAllocator(program, '__trace_addend')();
  const oldBest = createIdentifierAllocator(program, '__trace_old_best')();
  const oldBestStart = createIdentifierAllocator(
    program,
    '__trace_old_best_start',
  )();
  const oldBestEnd = createIdentifierAllocator(
    program,
    '__trace_old_best_end',
  )();
  const focus = `{ type: 'array.focus', index: ${index.name}, pointers: { i: ${index.name} }, range: [${currentStart.name}, ${index.name} + 1] }`;
  const bestMark = `{ type: 'array.mark', marker: 'best', indices: Array.from({ length: ${bestEnd.name} - ${bestStart.name} }, (_, offset) => ${bestStart.name} + offset) }`;
  const assignment = (
    node: AnyNode,
    target: string,
    beforeValue: string,
    value: string,
    commands: readonly string[],
    calculation?: string,
  ) =>
    `\ntrace.frame({ source: ${location(node)}, operation: { type: 'assign', target: ${JSON.stringify(target)}, before: ${beforeValue}, value: ${value}${calculation === undefined ? '' : `, calculation: ${calculation}`} }, commands: [${commands.join(', ')}] });\n`;
  const edits: SourceEdit[] = [
    after(
      array,
      `\ntrace.initialize({ type: 'scene.init', structure: 'array' }, { type: 'array.create', values: ${root} });\n`,
    ),
    ...declarations.map((node, order) =>
      after(
        node,
        assignment(
          node,
          [current, best, currentStart, bestStart, bestEnd][order]!.name,
          'null',
          [current, best, currentStart, bestStart, bestEnd][order]!.name,
          order === 4
            ? [
                bestMark,
                `{ type: 'array.focus', pointers: { i: 0 }, range: [0, 1] }`,
              ]
            : [],
        ),
      ),
    ),
    {
      start: resetCheck.test.start,
      end: resetCheck.test.end,
      text: `trace.compareScalar(${current.name}, 0, 'lt', ${location(resetCheck.test)}, ${JSON.stringify(current.name)}, '0', [{ type: 'array.focus', index: ${index.name} }])`,
    },
    before(resetCurrent, `const ${oldReset} = ${current.name};\n`),
    after(
      resetCurrent,
      assignment(resetCurrent, current.name, oldReset, current.name, [focus]),
    ),
    before(resetStart, `const ${oldStart} = ${currentStart.name};\n`),
    after(
      resetStart,
      assignment(resetStart, currentStart.name, oldStart, currentStart.name, [
        focus,
      ]),
    ),
    before(
      extendCurrent,
      `const ${oldExtend} = ${current.name};\nconst ${addend} = ${values.name}[${index.name}];\n`,
    ),
    replaceOperand(extendCurrent, addend),
    after(
      extendCurrent,
      assignment(
        extendCurrent,
        current.name,
        oldExtend,
        current.name,
        [focus],
        `{ kind: 'add', operand: { label: ${JSON.stringify(values.name)} + '[' + ${index.name} + ']', value: ${addend} } }`,
      ),
    ),
    {
      start: bestCheck.test.start,
      end: bestCheck.test.end,
      text: `trace.compareScalar(${current.name}, ${best.name}, 'gt', ${location(bestCheck.test)}, ${JSON.stringify(current.name)}, ${JSON.stringify(best.name)}, [{ type: 'array.focus', index: ${index.name} }])`,
    },
    before(writeBest, `const ${oldBest} = ${best.name};\n`),
    after(writeBest, assignment(writeBest, best.name, oldBest, best.name, [])),
    before(writeBestStart, `const ${oldBestStart} = ${bestStart.name};\n`),
    after(
      writeBestStart,
      assignment(
        writeBestStart,
        bestStart.name,
        oldBestStart,
        bestStart.name,
        [],
      ),
    ),
    before(writeBestEnd, `const ${oldBestEnd} = ${bestEnd.name};\n`),
    after(
      writeBestEnd,
      assignment(writeBestEnd, bestEnd.name, oldBestEnd, bestEnd.name, [
        bestMark,
      ]),
    ),
    {
      start: result.argument!.start,
      end: result.argument!.end,
      text: `trace.returnValue(${best.name}, ${location(result)}, 'maximum subarray sum')`,
    },
  ];
  return applySourceEdits(source, edits);
}

function matchKadane(
  program: NonNullable<ReturnType<typeof parseJavaScript>>,
  array: ArrayDeclaration,
  fn: FunctionDeclaration,
): Match | null {
  if (
    fn.id === null ||
    fn.params.length !== 1 ||
    fn.params[0]?.type !== 'Identifier'
  )
    return null;
  const values = fn.params[0];
  const root = array.declarations[0].id.name;
  if (array.declarations[0].init.elements.length === 0) return null;
  const calls: CallExpression[] = [];
  walkAst(program, (node) => {
    if (
      node.type === 'CallExpression' &&
      isNamed(node.callee, fn.id?.name ?? '') &&
      node.arguments.length === 1 &&
      isNamed(node.arguments[0], root)
    )
      calls.push(node);
  });
  if (calls.length !== 1) return null;
  const body = fn.body.body;
  if (body.length !== 7) return null;
  const declarations = body.slice(0, 5);
  if (
    !declarations.every(
      (statement) =>
        statement.type === 'VariableDeclaration' &&
        statement.declarations.length === 1,
    )
  )
    return null;
  const named = declarations.map(
    (statement) => (statement as VariableDeclaration).declarations[0],
  );
  if (!named.every((entry) => entry?.id.type === 'Identifier')) return null;
  const [
    currentEntry,
    bestEntry,
    currentStartEntry,
    bestStartEntry,
    bestEndEntry,
  ] = named;
  if (
    currentEntry?.id.type !== 'Identifier' ||
    bestEntry?.id.type !== 'Identifier' ||
    currentStartEntry?.id.type !== 'Identifier' ||
    bestStartEntry?.id.type !== 'Identifier' ||
    bestEndEntry?.id.type !== 'Identifier' ||
    !isFirstValue(currentEntry.init, values.name) ||
    !isFirstValue(bestEntry.init, values.name) ||
    !isLiteral(currentStartEntry.init, 0) ||
    !isLiteral(bestStartEntry.init, 0) ||
    !isLiteral(bestEndEntry.init, 1)
  )
    return null;
  const current = currentEntry.id;
  const best = bestEntry.id;
  const currentStart = currentStartEntry.id;
  const bestStart = bestStartEntry.id;
  const bestEnd = bestEndEntry.id;
  const loop = body[5];
  const result = body[6];
  if (
    loop?.type !== 'ForStatement' ||
    result?.type !== 'ReturnStatement' ||
    !isNamed(result.argument, best.name)
  )
    return null;
  const index = matchLoop(loop, values.name);
  if (
    index === null ||
    loop.body.type !== 'BlockStatement' ||
    loop.body.body.length !== 2
  )
    return null;
  const [resetCheck, bestCheck] = loop.body.body;
  if (
    resetCheck?.type !== 'IfStatement' ||
    bestCheck?.type !== 'IfStatement' ||
    !isComparison(resetCheck.test, current.name, '0', '<') ||
    !isComparison(bestCheck.test, current.name, best.name, '>') ||
    resetCheck.consequent.type !== 'BlockStatement' ||
    resetCheck.alternate?.type !== 'BlockStatement' ||
    resetCheck.consequent.body.length !== 2 ||
    resetCheck.alternate.body.length !== 1 ||
    bestCheck.consequent.type !== 'BlockStatement' ||
    bestCheck.alternate !== null ||
    bestCheck.consequent.body.length !== 3
  )
    return null;
  const [resetCurrent, resetStart] = resetCheck.consequent.body;
  const [extendCurrent] = resetCheck.alternate.body;
  const [writeBest, writeBestStart, writeBestEnd] = bestCheck.consequent.body;
  if (
    resetCurrent?.type !== 'ExpressionStatement' ||
    resetStart?.type !== 'ExpressionStatement' ||
    extendCurrent?.type !== 'ExpressionStatement' ||
    writeBest?.type !== 'ExpressionStatement' ||
    writeBestStart?.type !== 'ExpressionStatement' ||
    writeBestEnd?.type !== 'ExpressionStatement' ||
    !isAssignment(resetCurrent, current.name, '=', (right) =>
      isIndexedValue(right, values.name, index.name),
    ) ||
    !isAssignment(resetStart, currentStart.name, '=', (right) =>
      isNamed(right, index.name),
    ) ||
    !isAssignment(extendCurrent, current.name, '+=', (right) =>
      isIndexedValue(right, values.name, index.name),
    ) ||
    !isAssignment(writeBest, best.name, '=', (right) =>
      isNamed(right, current.name),
    ) ||
    !isAssignment(writeBestStart, bestStart.name, '=', (right) =>
      isNamed(right, currentStart.name),
    ) ||
    !isAssignment(
      writeBestEnd,
      bestEnd.name,
      '=',
      (right) =>
        right.type === 'BinaryExpression' &&
        right.operator === '+' &&
        isNamed(right.left, index.name) &&
        isLiteral(right.right, 1),
    )
  )
    return null;
  return {
    array,
    values,
    current,
    best,
    currentStart,
    bestStart,
    bestEnd,
    index,
    declarations: declarations as VariableDeclaration[],
    resetCheck,
    resetCurrent,
    resetStart,
    extendCurrent,
    bestCheck,
    writeBest,
    writeBestStart,
    writeBestEnd,
    result,
  };
}

function matchLoop(loop: ForStatement, values: string): Identifier | null {
  if (
    loop.init?.type !== 'VariableDeclaration' ||
    loop.init.declarations.length !== 1
  )
    return null;
  const init = loop.init.declarations[0];
  if (init?.id.type !== 'Identifier' || !isLiteral(init.init, 1)) return null;
  const index = init.id;
  if (
    loop.test?.type !== 'BinaryExpression' ||
    loop.test.operator !== '<' ||
    !isNamed(loop.test.left, index.name) ||
    !isLength(loop.test.right, values) ||
    loop.update?.type !== 'UpdateExpression' ||
    loop.update.operator !== '++' ||
    !isNamed(loop.update.argument, index.name)
  )
    return null;
  return index;
}

function isArrayDeclaration(node: AnyNode): node is ArrayDeclaration {
  if (node.type !== 'VariableDeclaration' || node.declarations.length !== 1)
    return false;
  const entry = node.declarations[0];
  return (
    entry?.id.type === 'Identifier' &&
    entry.init?.type === 'ArrayExpression' &&
    entry.init.elements.every(isFiniteNumericLiteral)
  );
}

function isIndexedValue(
  node: AnyNode | null | undefined,
  values: string,
  index: string,
): boolean {
  return (
    node?.type === 'MemberExpression' &&
    node.computed &&
    isNamed(node.object, values) &&
    isNamed(node.property, index)
  );
}

function isFirstValue(
  node: AnyNode | null | undefined,
  values: string,
): boolean {
  return (
    node?.type === 'MemberExpression' &&
    node.computed &&
    isNamed(node.object, values) &&
    isLiteral(node.property, 0)
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

function isComparison(
  node: AnyNode,
  left: string,
  right: string,
  operator: string,
): boolean {
  return (
    node.type === 'BinaryExpression' &&
    node.operator === operator &&
    isNamed(node.left, left) &&
    (right === '0' ? isLiteral(node.right, 0) : isNamed(node.right, right))
  );
}

function isAssignment(
  statement: ExpressionStatement,
  target: string,
  operator: string,
  right: (node: AnyNode) => boolean,
): boolean {
  const expression = statement.expression;
  return (
    expression.type === 'AssignmentExpression' &&
    expression.operator === operator &&
    isNamed(expression.left, target) &&
    right(expression.right)
  );
}

function replaceOperand(
  statement: ExpressionStatement,
  temporary: string,
): SourceEdit {
  if (statement.expression.type !== 'AssignmentExpression')
    throw new Error('Expected a supported assignment.');
  return {
    start: statement.expression.right.start,
    end: statement.expression.right.end,
    text: temporary,
  };
}
