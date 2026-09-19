import type { AnyNode, Statement } from 'acorn';
import { isNamed as named, isNamedMember as member } from '../matchers';
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
} from '../edits';
import { findAllListDeclarations } from './staticLinkedList';

function next(
  node: AnyNode | null | undefined,
  receiver: string,
  depth: number,
): boolean {
  if (depth === 0) return named(node, receiver);
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    !node.optional &&
    named(node.property, 'next') &&
    next(node.object, receiver, depth - 1)
  );
}

function equality(
  node: AnyNode | null | undefined,
  left: string,
  right: string,
  operator: '===' | '!==',
): boolean {
  return (
    node?.type === 'BinaryExpression' &&
    node.operator === operator &&
    named(node.left, left) &&
    named(node.right, right)
  );
}

function assignment(
  statement: Statement | undefined,
  target: string,
  from: string,
  depth: number,
): boolean {
  return (
    statement?.type === 'ExpressionStatement' &&
    statement.expression.type === 'AssignmentExpression' &&
    statement.expression.operator === '=' &&
    named(statement.expression.left, target) &&
    next(statement.expression.right, from, depth)
  );
}

export function instrumentCycleFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (program === null || hasUnsafeInstrumentationSyntax(program)) return null;
  if (program.body.length !== 3 && program.body.length !== 4) return null;
  const [declaration, maybeSetup, maybeFunction, maybeAnswer] = program.body;
  const setup = program.body.length === 4 ? (maybeSetup ?? null) : null;
  const fn = program.body.length === 4 ? maybeFunction : maybeSetup;
  const answer = program.body.length === 4 ? maybeAnswer : maybeFunction;
  const lists = findAllListDeclarations(program);
  const list = lists.length === 1 ? lists[0] : undefined;
  if (
    list === undefined ||
    list.declaration !== declaration ||
    fn?.type !== 'FunctionDeclaration' ||
    fn.id === null ||
    fn.async ||
    fn.generator ||
    fn.params.length !== 1 ||
    fn.params[0]?.type !== 'Identifier' ||
    answer?.type !== 'VariableDeclaration' ||
    answer.kind !== 'const' ||
    answer.declarations.length !== 1 ||
    answer.declarations[0]?.id.type !== 'Identifier' ||
    answer.declarations[0].init?.type !== 'CallExpression' ||
    answer.declarations[0].init.optional ||
    !named(answer.declarations[0].init.callee, fn.id.name) ||
    answer.declarations[0].init.arguments.length !== 1 ||
    !named(answer.declarations[0].init.arguments[0], list.root)
  )
    return null;

  const root = list.root;
  const parameter = fn.params[0].name;
  const [slowDeclaration, fastDeclaration, loop, noCycle] = fn.body.body;
  if (
    fn.body.body.length !== 4 ||
    slowDeclaration?.type !== 'VariableDeclaration' ||
    fastDeclaration?.type !== 'VariableDeclaration' ||
    slowDeclaration.kind !== 'let' ||
    fastDeclaration.kind !== 'let' ||
    slowDeclaration.declarations.length !== 1 ||
    fastDeclaration.declarations.length !== 1 ||
    slowDeclaration.declarations[0]?.id.type !== 'Identifier' ||
    fastDeclaration.declarations[0]?.id.type !== 'Identifier' ||
    !named(slowDeclaration.declarations[0].init, parameter) ||
    !named(fastDeclaration.declarations[0].init, parameter) ||
    loop?.type !== 'WhileStatement' ||
    loop.body.type !== 'BlockStatement' ||
    noCycle?.type !== 'ReturnStatement' ||
    noCycle.argument?.type !== 'Literal' ||
    noCycle.argument.value !== null
  )
    return null;
  const slow = slowDeclaration.declarations[0].id.name;
  const fast = fastDeclaration.declarations[0].id.name;
  const guard = loop.test;
  if (
    guard.type !== 'LogicalExpression' ||
    guard.operator !== '&&' ||
    guard.right.type !== 'BinaryExpression' ||
    guard.right.operator !== '!==' ||
    !member(guard.right.left, fast, 'next') ||
    guard.right.right.type !== 'Literal' ||
    guard.right.right.value !== null
  )
    return null;
  if (
    guard.left.type !== 'BinaryExpression' ||
    guard.left.operator !== '!==' ||
    !named(guard.left.left, fast) ||
    guard.left.right.type !== 'Literal' ||
    guard.left.right.value !== null
  )
    return null;

  const [advanceSlow, advanceFast, collision] = loop.body.body;
  if (
    loop.body.body.length !== 3 ||
    !assignment(advanceSlow, slow, slow, 1) ||
    !assignment(advanceFast, fast, fast, 2) ||
    collision?.type !== 'IfStatement' ||
    collision.alternate !== null ||
    !equality(collision.test, slow, fast, '===') ||
    collision.consequent.type !== 'BlockStatement'
  )
    return null;
  const [reset, search, found] = collision.consequent.body;
  if (
    collision.consequent.body.length !== 3 ||
    !assignment(reset, slow, parameter, 0) ||
    search?.type !== 'WhileStatement' ||
    !equality(search.test, slow, fast, '!==') ||
    search.body.type !== 'BlockStatement' ||
    search.body.body.length !== 2 ||
    !assignment(search.body.body[0], slow, slow, 1) ||
    !assignment(search.body.body[1], fast, fast, 1) ||
    found?.type !== 'ReturnStatement' ||
    !named(found.argument, slow)
  )
    return null;

  if (
    new Set([
      root,
      fn.id.name,
      parameter,
      slow,
      fast,
      answer.declarations[0].id.name,
    ]).size !== 6 ||
    [
      root,
      fn.id.name,
      parameter,
      slow,
      fast,
      answer.declarations[0].id.name,
    ].some((name) => name === 'trace' || name === 'WeakMap')
  )
    return null;
  const tail = list.nodes.at(-1);
  const head = list.nodes[0];
  if (tail === undefined || head === undefined) return null;
  let kind = 'singly';
  let cycleEntry: string | null = null;
  if (setup !== null && setup !== undefined) {
    if (
      setup.type !== 'ExpressionStatement' ||
      setup.expression.type !== 'AssignmentExpression' ||
      setup.expression.operator !== '=' ||
      setup.expression.left.type !== 'MemberExpression' ||
      !next(setup.expression.left, root, list.nodes.length)
    )
      return null;
    const right = setup.expression.right;
    const entry = list.nodes.find((_, index) => next(right, root, index));
    if (entry === undefined) return null;
    cycleEntry = entry.id;
    kind = entry.id === head.id ? 'circular-singly' : 'cycle-singly';
  }

  const allocate = createIdentifierAllocator(program, '__traceCycle');
  const ids = allocate();
  const previous = allocate();
  const result = allocate();
  const id = (name: string) => `${name} === null ? null : ${ids}.get(${name})`;
  const fact = (name: string) =>
    `${name} === null ? null : { kind: 'node-reference', id: ${ids}.get(${name}) }`;

  const pointer = (name: string) =>
    `{ type: 'linked-list.pointer', name: ${JSON.stringify(name === slow ? 'slow' : 'fast')}, nodeId: ${id(name)} }`;
  const move = (statement: Statement, name: string) => ({
    start: statement.start,
    end: statement.end,
    text: `{ const ${previous} = ${name}; ${source.slice(statement.start, statement.end)} ${frame(
      statement,
      `{ type: 'assign', target: ${JSON.stringify(name)}, before: ${fact(previous)}, value: ${fact(name)} }`,
      [pointer(name)],
    )} }`,
  });
  const compare = (test: AnyNode, operator: 'eq' | 'neq') => ({
    start: test.start,
    end: test.end,
    text: `(() => { const ${result} = ${source.slice(test.start, test.end)}; ${frame(
      test,
      `{ type: 'compare', operator: '${operator}', left: { label: ${JSON.stringify(slow)}, value: ${fact(slow)} }, right: { label: ${JSON.stringify(fast)}, value: ${fact(fast)} }, result: ${result} }`,
      [
        `...(${slow} === null || ${fast} === null ? [] : [{ type: 'linked-list.compareIdentity', nodeIds: [${id(slow)}, ${id(fast)}], operator: '${operator}' }])`,
      ],
    )} return ${result}; })()`,
  });
  const nodes = list.nodes
    .map(
      (node, index) =>
        `{ id: ${JSON.stringify(node.id)}, value: ${JSON.stringify(node.value)}, nextId: ${index === list.nodes.length - 1 && cycleEntry !== null ? JSON.stringify(cycleEntry) : JSON.stringify(node.nextId)} }`,
    )
    .join(', ');
  const entries = list.nodes
    .map((node) => `[${node.access}, ${JSON.stringify(node.id)}]`)
    .join(', ');
  const edits: SourceEdit[] = [
    {
      start: (setup ?? declaration).end,
      end: (setup ?? declaration).end,
      text: `\ntrace.initialize({ type: 'scene.init', structure: 'linked-list' }, { type: 'linked-list.create', kind: '${kind}', headId: ${JSON.stringify(head.id)}, tailId: ${JSON.stringify(tail.id)}, nodes: [${nodes}] });\nconst ${ids} = new WeakMap([${entries}]);\n`,
    },
    {
      start: slowDeclaration.end,
      end: slowDeclaration.end,
      text: `\n${frame(
        slowDeclaration,
        `{ type: 'assign', target: ${JSON.stringify(slow)}, before: null, value: ${fact(slow)} }`,
        [pointer(slow)],
      )}\n`,
    },
    {
      start: fastDeclaration.end,
      end: fastDeclaration.end,
      text: `\n${frame(
        fastDeclaration,
        `{ type: 'assign', target: ${JSON.stringify(fast)}, before: null, value: ${fact(fast)} }`,
        [pointer(fast)],
      )}\n`,
    },
    move(advanceSlow!, slow),
    move(advanceFast!, fast),
    move(reset!, slow),
    move(search.body.body[0]!, slow),
    move(search.body.body[1]!, fast),
    compare(collision.test, 'eq'),
    compare(search.test, 'neq'),
    {
      start: found.start,
      end: found.end,
      text: `{ ${frame(
        found,
        `{ type: 'return', value: ${fact(slow)}, role: 'cycle entry' }`,
        [
          `{ type: 'linked-list.mark', marker: 'result', nodeIds: [${id(slow)}] }`,
        ],
      )} ${source.slice(found.start, found.end)} }`,
    },
    {
      start: noCycle.argument!.start,
      end: noCycle.argument!.end,
      text: `trace.returnValue(null, ${span(noCycle)}, 'cycle entry')`,
    },
  ];
  return applySourceEdits(source, edits);
}
