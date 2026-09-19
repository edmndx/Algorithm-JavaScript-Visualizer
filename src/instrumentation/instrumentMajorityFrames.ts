import type {
  AnyNode,
  BlockStatement,
  ExpressionStatement,
  Identifier,
} from 'acorn';
import { isNamed as named, isLiteralValue as literal } from './matchers';
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

const length = (node: AnyNode | null | undefined, values: string) =>
  node?.type === 'MemberExpression' &&
  !node.computed &&
  named(node.object, values) &&
  named(node.property, 'length');
const item = (
  node: AnyNode | null | undefined,
  values: string,
  index: string,
) =>
  node?.type === 'MemberExpression' &&
  node.computed &&
  named(node.object, values) &&
  named(node.property, index);
const comparison = (
  node: AnyNode | null | undefined,
  left: (node: AnyNode) => boolean,
  right: (node: AnyNode) => boolean,
  operator: string,
) =>
  node?.type === 'BinaryExpression' &&
  node.operator === operator &&
  left(node.left) &&
  right(node.right);
const assignment = (
  node: AnyNode | null | undefined,
  target: string,
  operator: string,
  right: (node: AnyNode) => boolean,
): node is ExpressionStatement =>
  node?.type === 'ExpressionStatement' &&
  node.expression.type === 'AssignmentExpression' &&
  node.expression.operator === operator &&
  named(node.expression.left, target) &&
  right(node.expression.right);
const singleBody = (node: AnyNode | null | undefined): node is BlockStatement =>
  node?.type === 'BlockStatement' && node.body.length === 1;

function scanIndex(
  node: AnyNode | null | undefined,
  values: string,
): Identifier | null {
  if (
    node?.type !== 'ForStatement' ||
    node.init?.type !== 'VariableDeclaration' ||
    node.init.kind !== 'let' ||
    node.init.declarations.length !== 1
  )
    return null;
  const binding = node.init.declarations[0];
  if (binding?.id.type !== 'Identifier' || !literal(binding.init, 0))
    return null;
  const index = binding.id;
  return comparison(
    node.test,
    (part) => named(part, index.name),
    (part) => length(part, values),
    '<',
  ) &&
    node.update?.type === 'UpdateExpression' &&
    node.update.operator === '++' &&
    named(node.update.argument, index.name)
    ? index
    : null;
}

function frame(
  node: AnyNode,
  target: string,
  before: string,
  value: string,
  commands: string,
) {
  return `\ntrace.frame({ source: ${location(node)}, operation: { type: 'assign', target: ${JSON.stringify(target)}, before: ${before}, value: ${value} }, commands: [${commands}] });\n`;
}

export function instrumentMajorityFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (
    program === null ||
    hasUnsafeInstrumentationSyntax(program) ||
    program.body.length !== 3
  )
    return null;

  const [array, fn, invocation] = program.body;
  if (
    array?.type !== 'VariableDeclaration' ||
    array.declarations.length !== 1 ||
    fn?.type !== 'FunctionDeclaration' ||
    fn.id === null ||
    fn.params.length !== 1 ||
    fn.params[0]?.type !== 'Identifier' ||
    invocation?.type !== 'VariableDeclaration' ||
    invocation.declarations.length !== 1
  )
    return null;
  const input = array.declarations[0];
  const output = invocation.declarations[0];
  if (
    input?.id.type !== 'Identifier' ||
    input.init?.type !== 'ArrayExpression' ||
    !input.init.elements.every(isFiniteNumericLiteral) ||
    output?.id.type !== 'Identifier' ||
    output.init?.type !== 'CallExpression' ||
    output.init.optional ||
    !named(output.init.callee, fn.id.name) ||
    output.init.arguments.length !== 1 ||
    !named(output.init.arguments[0], input.id.name)
  )
    return null;

  const values = fn.params[0].name;
  const body = fn.body.body;
  if (body.length !== 6) return null;
  const [
    candidateDeclaration,
    countDeclaration,
    firstLoop,
    verifiedDeclaration,
    secondLoop,
    result,
  ] = body;
  if (
    candidateDeclaration?.type !== 'VariableDeclaration' ||
    countDeclaration?.type !== 'VariableDeclaration' ||
    verifiedDeclaration?.type !== 'VariableDeclaration' ||
    firstLoop?.type !== 'ForStatement' ||
    secondLoop?.type !== 'ForStatement' ||
    result?.type !== 'ReturnStatement'
  )
    return null;
  const declarations = [
    candidateDeclaration,
    countDeclaration,
    verifiedDeclaration,
  ];
  if (
    declarations.some(
      (entry) => entry.kind !== 'let' || entry.declarations.length !== 1,
    )
  )
    return null;
  const candidate = candidateDeclaration.declarations[0];
  const count = countDeclaration.declarations[0];
  const verified = verifiedDeclaration.declarations[0];
  if (
    candidate?.id.type !== 'Identifier' ||
    !literal(candidate.init, null) ||
    count?.id.type !== 'Identifier' ||
    !literal(count.init, 0) ||
    verified?.id.type !== 'Identifier' ||
    !literal(verified.init, 0)
  )
    return null;
  const roles = [
    input.id.name,
    fn.id.name,
    values,
    output.id.name,
    candidate.id.name,
    count.id.name,
    verified.id.name,
  ];
  if (new Set(roles).size !== roles.length) return null;

  const firstIndex = scanIndex(firstLoop, values);
  const secondIndex = scanIndex(secondLoop, values);
  if (
    firstIndex === null ||
    secondIndex === null ||
    roles.includes(firstIndex.name) ||
    roles.includes(secondIndex.name) ||
    firstLoop.body.type !== 'BlockStatement' ||
    firstLoop.body.body.length !== 2 ||
    secondLoop.body.type !== 'BlockStatement' ||
    secondLoop.body.body.length !== 1
  )
    return null;

  const [reset, vote] = firstLoop.body.body;
  const [recount] = secondLoop.body.body;
  const candidateName = candidate.id.name;
  const countName = count.id.name;
  const verifiedName = verified.id.name;
  if (
    reset?.type !== 'IfStatement' ||
    vote?.type !== 'IfStatement' ||
    recount?.type !== 'IfStatement' ||
    reset.alternate !== null ||
    recount.alternate !== null ||
    !singleBody(reset.consequent) ||
    !singleBody(vote.consequent) ||
    !singleBody(vote.alternate) ||
    !singleBody(recount.consequent) ||
    !comparison(
      reset.test,
      (part) => named(part, countName),
      (part) => literal(part, 0),
      '===',
    ) ||
    !comparison(
      vote.test,
      (part) => item(part, values, firstIndex.name),
      (part) => named(part, candidateName),
      '===',
    ) ||
    !comparison(
      recount.test,
      (part) => item(part, values, secondIndex.name),
      (part) => named(part, candidateName),
      '===',
    )
  )
    return null;
  const candidateWrite = reset.consequent.body[0];
  const increment = vote.consequent.body[0];
  const decrement = vote.alternate.body[0];
  const verifiedWrite = recount.consequent.body[0];
  if (
    !assignment(candidateWrite, candidate.id.name, '=', (part) =>
      item(part, values, firstIndex.name),
    ) ||
    !assignment(increment, count.id.name, '+=', (part) => literal(part, 1)) ||
    !assignment(decrement, count.id.name, '-=', (part) => literal(part, 1)) ||
    !assignment(verifiedWrite, verified.id.name, '+=', (part) =>
      literal(part, 1),
    ) ||
    result.argument?.type !== 'ConditionalExpression' ||
    !named(result.argument.consequent, candidate.id.name) ||
    !literal(result.argument.alternate, null) ||
    !comparison(
      result.argument.test,
      (part) => named(part, verifiedName),
      (part) =>
        comparison(
          part,
          (left) => length(left, values),
          (right) => literal(right, 2),
          '/',
        ),
      '>',
    )
  )
    return null;

  const allocate = createIdentifierAllocator(program, '__trace_majority_');
  const edits: SourceEdit[] = [];
  const after = (node: AnyNode, text: string) =>
    edits.push({ start: node.end, end: node.end, text });
  const before = (node: AnyNode, text: string) =>
    edits.push({ start: node.start, end: node.start, text });
  const replace = (node: AnyNode, text: string) =>
    edits.push({ start: node.start, end: node.end, text });
  const focus = (index: Identifier) =>
    `{ type: 'array.focus', index: ${index.name}, pointers: { i: ${index.name} } }`;
  after(
    array,
    `\ntrace.initialize({ type: 'scene.init', structure: 'array' }, { type: 'array.create', values: ${input.id.name} });\n`,
  );
  for (const [declaration, binding] of [
    [candidateDeclaration, candidate.id],
    [countDeclaration, count.id],
    [verifiedDeclaration, verified.id],
  ] as const)
    after(
      declaration,
      frame(declaration, binding.name, 'null', binding.name, ''),
    );
  replace(
    reset.test,
    `trace.compareScalar(${count.id.name}, 0, 'eq', ${location(reset.test)}, ${JSON.stringify(count.id.name)}, '0', [${focus(firstIndex)}])`,
  );
  const oldCandidate = allocate();
  before(candidateWrite, `const ${oldCandidate} = ${candidate.id.name};\n`);
  after(
    candidateWrite,
    frame(
      candidateWrite,
      candidate.id.name,
      oldCandidate,
      candidate.id.name,
      `${focus(firstIndex)}, { type: 'array.mark', marker: 'cand', indices: [${firstIndex.name}] }`,
    ),
  );
  for (const [write, index, binding] of [
    [increment, firstIndex, count.id],
    [decrement, firstIndex, count.id],
    [verifiedWrite, secondIndex, verified.id],
  ] as const) {
    const old = allocate();
    before(write, `const ${old} = ${binding.name};\n`);
    after(write, frame(write, binding.name, old, binding.name, focus(index)));
  }
  replace(
    vote.test,
    `trace.compareArray(${values}, ${firstIndex.name}, ${candidate.id.name}, 'eq', ${location(vote.test)}, ${JSON.stringify(values)} + '[' + ${firstIndex.name} + ']', ${JSON.stringify(candidate.id.name)})`,
  );
  replace(
    recount.test,
    `trace.compareArray(${values}, ${secondIndex.name}, ${candidate.id.name}, 'eq', ${location(recount.test)}, ${JSON.stringify(values)} + '[' + ${secondIndex.name} + ']', ${JSON.stringify(candidate.id.name)})`,
  );
  const majorityCheck = `trace.compareScalar(${verifiedName}, ${values}.length / 2, 'gt', ${location(result.argument.test)}, ${JSON.stringify(verifiedName)}, ${JSON.stringify(values)} + '.length / 2')`;
  replace(
    result.argument,
    `trace.returnValue(${majorityCheck} ? ${candidateName} : null, ${location(result)}, 'majority result')`,
  );
  return applySourceEdits(source, edits);
}
