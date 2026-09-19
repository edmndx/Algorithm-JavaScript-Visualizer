import type {
  AnyNode,
  CallExpression,
  FunctionDeclaration,
  Identifier,
  VariableDeclaration,
} from 'acorn';
import { isNamed as named } from '../matchers';
import { createIdentifierAllocator } from '../ast';
import {
  applySourceEdits,
  sourceSpan as span,
  type SourceEdit,
  afterNode as at,
  replaceNode as replace,
  frameCall as frame,
} from '../edits';
import { parseMatrixProgram } from './matrixInstrumentationHelpers';
import { isSupportedInitialMatrix, matrixCellSyntax } from './matrixMatchers';

function single(
  node: AnyNode | null | undefined,
): node is VariableDeclaration & {
  declarations: [{ id: Identifier; init: import('acorn').Expression }];
} {
  return (
    node?.type === 'VariableDeclaration' &&
    node.declarations.length === 1 &&
    node.declarations[0]?.id.type === 'Identifier' &&
    node.declarations[0].init != null
  );
}

function call(
  node: AnyNode | null | undefined,
  name: string,
  args: readonly string[],
): node is CallExpression {
  return (
    node?.type === 'CallExpression' &&
    !node.optional &&
    named(node.callee, name) &&
    node.arguments.length === args.length &&
    node.arguments.every((arg, index) => named(arg, args[index]!))
  );
}

function cell(
  node: AnyNode | null | undefined,
  grid: string,
  row: string,
  col: string,
): boolean {
  const syntax = matrixCellSyntax(node);
  return (
    syntax !== null &&
    syntax.root.name === grid &&
    named(syntax.cell.row, row) &&
    named(syntax.cell.column, col)
  );
}

function length(node: AnyNode, grid: string, rows: boolean): boolean {
  if (rows)
    return (
      node.type === 'MemberExpression' &&
      !node.computed &&
      named(node.property, 'length') &&
      named(node.object, grid)
    );
  return (
    node.type === 'MemberExpression' &&
    !node.computed &&
    named(node.property, 'length') &&
    node.object.type === 'MemberExpression' &&
    node.object.computed &&
    named(node.object.object, grid) &&
    node.object.property.type === 'Literal' &&
    node.object.property.value === 0
  );
}

function guard(
  node: AnyNode,
  row: string,
  col: string,
  grid: string,
): node is import('acorn').LogicalExpression {
  if (
    node.type !== 'LogicalExpression' ||
    node.operator !== '||' ||
    node.left.type !== 'LogicalExpression' ||
    node.left.operator !== '||' ||
    node.left.left.type !== 'LogicalExpression' ||
    node.left.left.operator !== '||'
  )
    return false;
  const parts = [
    node.left.left.left,
    node.left.left.right,
    node.left.right,
    node.right,
  ];
  return (
    parts.every((part) => part.type === 'BinaryExpression') &&
    parts[0]?.type === 'BinaryExpression' &&
    parts[0].operator === '<' &&
    named(parts[0].left, row) &&
    parts[0].right.type === 'Literal' &&
    parts[0].right.value === 0 &&
    parts[1]?.type === 'BinaryExpression' &&
    parts[1].operator === '>=' &&
    named(parts[1].left, row) &&
    length(parts[1].right, grid, true) &&
    parts[2]?.type === 'BinaryExpression' &&
    parts[2].operator === '<' &&
    named(parts[2].left, col) &&
    parts[2].right.type === 'Literal' &&
    parts[2].right.value === 0 &&
    parts[3]?.type === 'BinaryExpression' &&
    parts[3].operator === '>=' &&
    named(parts[3].left, col) &&
    length(parts[3].right, grid, false)
  );
}

function offset(node: AnyNode, base: string, delta: number): boolean {
  return delta === 0
    ? named(node, base)
    : node.type === 'BinaryExpression' &&
        node.operator === (delta < 0 ? '-' : '+') &&
        named(node.left, base) &&
        node.right.type === 'Literal' &&
        node.right.value === 1;
}

function recurse(
  node: AnyNode | null | undefined,
  fn: string,
  row: string,
  col: string,
  dr: number,
  dc: number,
): boolean {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'CallExpression' &&
    !node.expression.optional &&
    named(node.expression.callee, fn) &&
    node.expression.arguments.length === 2 &&
    offset(node.expression.arguments[0]!, row, dr) &&
    offset(node.expression.arguments[1]!, col, dc)
  );
}

export function instrumentFloodFillFrames(
  source: string,
  program = parseMatrixProgram(source),
): string | null {
  if (program === null || program.body.length !== 3) return null;
  const [declaration, functionNode, answer] = program.body;
  if (
    !single(declaration) ||
    !isSupportedInitialMatrix(declaration.declarations[0].init) ||
    functionNode?.type !== 'FunctionDeclaration' ||
    functionNode.async ||
    functionNode.generator ||
    !functionNode.id ||
    functionNode.params.length !== 4 ||
    !functionNode.params.every((param) => param.type === 'Identifier') ||
    !single(answer)
  )
    return null;
  const grid = declaration.declarations[0].id.name;
  const fn = functionNode as FunctionDeclaration;
  const [image, startRow, startCol, color] = fn.params as [
    Identifier,
    Identifier,
    Identifier,
    Identifier,
  ];
  if (
    new Set([
      grid,
      fn.id!.name,
      image.name,
      startRow.name,
      startCol.name,
      color.name,
      answer.declarations[0].id.name,
    ]).size !== 7
  )
    return null;
  const invocation = answer.declarations[0].init;
  if (
    invocation.type !== 'CallExpression' ||
    !named(invocation.callee, fn.id!.name) ||
    invocation.arguments.length !== 4 ||
    !named(invocation.arguments[0], grid) ||
    !invocation.arguments
      .slice(1)
      .every(
        (arg) =>
          arg.type === 'Literal' &&
          typeof arg.value === 'number' &&
          Number.isInteger(arg.value),
      )
  )
    return null;
  const initial = declaration.declarations[0]
    .init as import('acorn').ArrayExpression;
  const startR = (invocation.arguments[1] as import('acorn').Literal)
    .value as number;
  const startC = (invocation.arguments[2] as import('acorn').Literal)
    .value as number;
  if (
    startR < 0 ||
    startR >= initial.elements.length ||
    startC < 0 ||
    startC >=
      (initial.elements[0] as import('acorn').ArrayExpression).elements.length
  )
    return null;
  const [oldDeclaration, same, inner, rootCall, result] = fn.body.body;
  if (
    fn.body.body.length !== 5 ||
    !single(oldDeclaration) ||
    !cell(
      oldDeclaration.declarations[0].init,
      image.name,
      startRow.name,
      startCol.name,
    ) ||
    same?.type !== 'IfStatement' ||
    same.alternate ||
    same.consequent.type !== 'ReturnStatement' ||
    !named(same.consequent.argument, image.name) ||
    same.test.type !== 'BinaryExpression' ||
    same.test.operator !== '===' ||
    !named(same.test.left, oldDeclaration.declarations[0].id.name) ||
    !named(same.test.right, color.name) ||
    inner?.type !== 'FunctionDeclaration' ||
    inner.async ||
    inner.generator ||
    !inner.id ||
    inner.params.length !== 2 ||
    !inner.params.every((param) => param.type === 'Identifier') ||
    rootCall?.type !== 'ExpressionStatement' ||
    !call(rootCall.expression, inner.id.name, [startRow.name, startCol.name]) ||
    result?.type !== 'ReturnStatement' ||
    !named(result.argument, image.name)
  )
    return null;
  const original = oldDeclaration.declarations[0].id.name;
  const [row, col] = inner.params as [Identifier, Identifier];
  if (
    new Set([
      image.name,
      startRow.name,
      startCol.name,
      color.name,
      original,
      inner.id.name,
      row.name,
      col.name,
    ]).size !== 8
  )
    return null;
  const [bounds, value, write, ...calls] = inner.body.body;
  if (
    inner.body.body.length !== 7 ||
    bounds?.type !== 'IfStatement' ||
    bounds.alternate ||
    bounds.consequent.type !== 'ReturnStatement' ||
    bounds.consequent.argument ||
    !guard(bounds.test, row.name, col.name, image.name) ||
    value?.type !== 'IfStatement' ||
    value.alternate ||
    value.consequent.type !== 'ReturnStatement' ||
    value.consequent.argument ||
    value.test.type !== 'BinaryExpression' ||
    value.test.operator !== '!==' ||
    !cell(value.test.left, image.name, row.name, col.name) ||
    !named(value.test.right, original) ||
    write?.type !== 'ExpressionStatement' ||
    write.expression.type !== 'AssignmentExpression' ||
    write.expression.operator !== '=' ||
    !cell(write.expression.left, image.name, row.name, col.name) ||
    !named(write.expression.right, color.name) ||
    !recurse(calls[0], inner.id.name, row.name, col.name, -1, 0) ||
    !recurse(calls[1], inner.id.name, row.name, col.name, 0, 1) ||
    !recurse(calls[2], inner.id.name, row.name, col.name, 1, 0) ||
    !recurse(calls[3], inner.id.name, row.name, col.name, 0, -1)
  )
    return null;
  const allocate = createIdentifierAllocator(program, '__trace_flood_');
  const rootCallId = allocate();
  const childCallIds = calls.map(() => allocate());

  const checks = [
    (bounds.test.left as import('acorn').LogicalExpression).left,
    (bounds.test.left as import('acorn').LogicalExpression).right,
    bounds.test.right,
  ];
  const first = checks[0] as import('acorn').LogicalExpression;
  const boundsChecks = [first.left, first.right, checks[1]!, checks[2]!];

  const position = `{ row: ${row.name}, column: ${col.name} }`;

  const compare = (
    left: string,
    right: string,
    op: string,
    node: AnyNode,
    commands = '',
  ) =>
    `trace.compareScalar(${left}, ${right}, '${op}', ${span(node)}, ${JSON.stringify(left)}, ${JSON.stringify(right)}, [${commands}])`;
  const edits: SourceEdit[] = [
    at(
      declaration,
      `\ntrace.initialize({ type: 'scene.init', structure: 'matrix' }, { type: 'matrix.create', values: ${grid} });`,
    ),
    replace(same.test, compare(original, color.name, 'eq', same.test)),
    replace(
      same.consequent,
      `return trace.returnValue(${image.name}, ${span(same.consequent)});`,
    ),
    replace(
      bounds.test,
      [
        compare(row.name, '0', 'lt', boundsChecks[0]!),
        compare(row.name, `${image.name}.length`, 'gte', boundsChecks[1]!),
        compare(col.name, '0', 'lt', boundsChecks[2]!),
        compare(col.name, `${image.name}[0].length`, 'gte', boundsChecks[3]!),
      ].join(' || '),
    ),
    replace(
      bounds.consequent,
      `return trace.returnValue(undefined, ${span(bounds.consequent)});`,
    ),
    replace(
      value.test,
      compare(
        `${image.name}[${row.name}][${col.name}]`,
        original,
        'neq',
        value.test,
        `{ type: 'matrix.mark', marker: 'cur', positions: [${position}] }`,
      ),
    ),
    replace(
      value.consequent,
      `return trace.returnValue(undefined, ${span(value.consequent)});`,
    ),
    at(
      write,
      `\n${frame(
        write,
        `{ type: 'assign', target: ${JSON.stringify(image.name)} + '[' + ${row.name} + '][' + ${col.name} + ']', before: ${original}, value: ${color.name} }`,
        `{ type: 'matrix.set', position: ${position}, value: ${color.name} }, { type: 'matrix.visit', position: ${position} }, { type: 'matrix.mark', marker: 'cur', positions: [${position}] }`,
      )}`,
    ),
    {
      start: rootCall.start,
      end: rootCall.start,
      text: `\nconst ${rootCallId} = ${frame(rootCall.expression, `{ type: 'call', callee: ${JSON.stringify(inner.id!.name)}, from: null, target: '(' + ${startRow.name} + ',' + ${startCol.name} + ')' }`)}\n`,
    },
    {
      start: rootCall.end,
      end: rootCall.end,
      text: `\ntrace.completeImplicitReturn(${rootCallId}, undefined, ${span(rootCall.expression)}, '(' + ${startRow.name} + ',' + ${startCol.name} + ')', null);\n`,
    },
    ...calls.map((statement, index) => {
      const recursive = statement as import('acorn').ExpressionStatement;
      const args = (recursive.expression as CallExpression).arguments;
      const target = `'(' + (${source.slice(args[0]!.start, args[0]!.end)}) + ',' + (${source.slice(args[1]!.start, args[1]!.end)}) + ')'`;
      return {
        start: statement.start,
        end: statement.start,
        text: `\nconst ${childCallIds[index]} = ${frame(recursive.expression, `{ type: 'call', callee: ${JSON.stringify(inner.id!.name)}, from: '(' + ${row.name} + ',' + ${col.name} + ')', target: ${target} }`)}\n`,
      };
    }),
    ...calls.map((statement, index): SourceEdit => {
      const recursive = statement as import('acorn').ExpressionStatement;
      const args = (recursive.expression as CallExpression).arguments;
      const target = `'(' + (${source.slice(args[0]!.start, args[0]!.end)}) + ',' + (${source.slice(args[1]!.start, args[1]!.end)}) + ')'`;
      return {
        start: statement.end,
        end: statement.end,
        text: `\ntrace.completeImplicitReturn(${childCallIds[index]}, undefined, ${span(recursive.expression)}, ${target}, '(' + ${row.name} + ',' + ${col.name} + ')');\n`,
      };
    }),
    replace(
      result.argument!,
      `trace.returnValue(${image.name}, ${span(result)})`,
    ),
  ];
  return applySourceEdits(source, edits);
}
