import type {
  AnyNode,
  Expression,
  Identifier,
  ReturnStatement,
  VariableDeclarator,
} from 'acorn';
import { isNamed as named, isNamedMember as member } from '../matchers';
import {
  createIdentifierAllocator,
  hasUnsafeInstrumentationSyntax,
  parseJavaScript,
} from '../ast';
import {
  applySourceEdits,
  sourceSpan as location,
  type SourceEdit,
  replaceNode as replace,
  beforeNode as before,
  afterNode as after,
} from '../edits';
import { readStaticTree } from './staticTree';

function binding(
  node: AnyNode | undefined,
): (VariableDeclarator & { id: Identifier; init: Expression }) | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'const' ||
    node.declarations.length !== 1
  )
    return null;
  const entry = node.declarations[0];
  return entry?.id.type === 'Identifier' && entry.init
    ? (entry as VariableDeclarator & { id: Identifier; init: Expression })
    : null;
}

function targetPath(node: Expression, root: string): string | null {
  if (named(node, root)) return root;
  if (
    node.type !== 'MemberExpression' ||
    node.computed ||
    node.optional ||
    node.property.type !== 'Identifier' ||
    !['left', 'right'].includes(node.property.name) ||
    node.object.type === 'Super'
  )
    return null;
  const parent = targetPath(node.object, root);
  return parent === null ? null : `${parent}.${node.property.name}`;
}

function compare(
  node: AnyNode,
  left: string,
  right: string | null,
  operator: '===' | '!==',
): boolean {
  if (node.type !== 'BinaryExpression' || node.operator !== operator)
    return false;
  const pair = (a: AnyNode, b: AnyNode) =>
    named(a, left) &&
    (right === null
      ? b.type === 'Literal' && b.value === null
      : named(b, right));
  return pair(node.left, node.right) || pair(node.right, node.left);
}

function guard(
  node: AnyNode | undefined,
  test: (node: AnyNode) => boolean,
  value: (node: Expression | null) => boolean,
): node is AnyNode & { type: 'IfStatement'; consequent: ReturnStatement } {
  return (
    node?.type === 'IfStatement' &&
    node.alternate === null &&
    test(node.test) &&
    node.consequent.type === 'ReturnStatement' &&
    value(node.consequent.argument ?? null)
  );
}

function childCall(
  node: AnyNode,
  fn: string,
  current: string,
  p: string,
  q: string,
  side: 'left' | 'right',
): boolean {
  return (
    node.type === 'CallExpression' &&
    !node.optional &&
    named(node.callee, fn) &&
    node.arguments.length === 3 &&
    member(node.arguments[0], current, side) &&
    named(node.arguments[1], p) &&
    named(node.arguments[2], q)
  );
}

export function instrumentLcaFrames(
  source: string,
  program = parseJavaScript(source),
): string | null {
  if (
    program === null ||
    hasUnsafeInstrumentationSyntax(program) ||
    program.body.length !== 5
  )
    return null;
  const [treeStatement, firstStatement, secondStatement, fn, answerStatement] =
    program.body;
  const tree = binding(treeStatement),
    first = binding(firstStatement),
    second = binding(secondStatement),
    answer = binding(answerStatement);
  if (
    !tree ||
    !first ||
    !second ||
    !answer ||
    tree.init.type !== 'ObjectExpression' ||
    fn?.type !== 'FunctionDeclaration' ||
    fn.id === null ||
    fn.async ||
    fn.generator ||
    fn.params.length !== 3 ||
    fn.params.some((param) => param.type !== 'Identifier')
  )
    return null;
  const nodes = readStaticTree(tree.init, tree.id.name, { nextId: 0 });
  if (nodes === null) return null;
  const firstPath = targetPath(first.init, tree.id.name),
    secondPath = targetPath(second.init, tree.id.name);
  if (
    firstPath === null ||
    secondPath === null ||
    !nodes.some((node) => node.access === firstPath) ||
    !nodes.some((node) => node.access === secondPath)
  )
    return null;
  const [current, p, q] = fn.params as [Identifier, Identifier, Identifier];
  if (
    answer.init.type !== 'CallExpression' ||
    answer.init.optional ||
    !named(answer.init.callee, fn.id.name) ||
    answer.init.arguments.length !== 3 ||
    !named(answer.init.arguments[0], tree.id.name) ||
    !named(answer.init.arguments[1], first.id.name) ||
    !named(answer.init.arguments[2], second.id.name)
  )
    return null;
  const [
    nullGuard,
    targetGuard,
    leftStatement,
    rightStatement,
    ancestorGuard,
    fallback,
  ] = fn.body.body;
  const left = binding(leftStatement),
    right = binding(rightStatement);
  if (
    !left ||
    !right ||
    !nullGuard ||
    !targetGuard ||
    !ancestorGuard ||
    !fallback ||
    fn.body.body.length !== 6 ||
    !guard(
      nullGuard,
      (node) => compare(node, current.name, null, '==='),
      (node) => node?.type === 'Literal' && node.value === null,
    ) ||
    !guard(
      targetGuard,
      (node) =>
        node.type === 'LogicalExpression' &&
        node.operator === '||' &&
        compare(node.left, current.name, p.name, '===') &&
        compare(node.right, current.name, q.name, '==='),
      (node) => named(node, current.name),
    ) ||
    !childCall(left.init, fn.id.name, current.name, p.name, q.name, 'left') ||
    !childCall(right.init, fn.id.name, current.name, p.name, q.name, 'right') ||
    !guard(
      ancestorGuard,
      (node) =>
        node.type === 'LogicalExpression' &&
        node.operator === '&&' &&
        compare(node.left, left.id.name, null, '!==') &&
        compare(node.right, right.id.name, null, '!=='),
      (node) => named(node, current.name),
    ) ||
    fallback.type !== 'ReturnStatement' ||
    fallback.argument?.type !== 'ConditionalExpression' ||
    !compare(fallback.argument.test, left.id.name, null, '!==') ||
    !named(fallback.argument.consequent, left.id.name) ||
    !named(fallback.argument.alternate, right.id.name)
  )
    return null;
  if (
    new Set([
      tree.id.name,
      first.id.name,
      second.id.name,
      fn.id.name,
      answer.id.name,
      current.name,
      p.name,
      q.name,
      left.id.name,
      right.id.name,
    ]).size !== 10
  )
    return null;

  const allocate = createIdentifierAllocator(program, '__traceLca');
  const ids = allocate(),
    path = allocate(),
    ref = allocate(),
    check = allocate(),
    finish = allocate();
  const traceNodes = nodes
    .map(
      ({ id, value, children }) =>
        `{ id: ${JSON.stringify(id)}, value: ${JSON.stringify(value)}, children: ${JSON.stringify(children)} }`,
    )
    .join(', ');
  const entries = nodes
    .map(({ access, id }) => `[${access}, ${JSON.stringify(id)}]`)
    .join(', ');
  const setup = `\ntrace.initialize({ type: 'scene.init', structure: 'tree' }, { type: 'tree.create', rootId: ${JSON.stringify(nodes[0]?.id)}, nodes: [${traceNodes}] });\nconst ${ids} = new WeakMap([${entries}]);\nconst ${path} = [];\nconst ${ref} = (value) => value === null ? null : { kind: 'node-reference', id: ${ids}.get(value) };\nconst ${check} = (a, b, operator, source, left, right) => { const result = operator === 'eq' ? a === b : a !== b; trace.frame({ source, operation: { type: 'compare', operator, left: { label: left, value: ${ref}(a) }, right: { label: right, value: ${ref}(b) }, result }, commands: [{ type: 'tree.mark', marker: 'path', nodeIds: [...${path}] }, ...(a !== null && b !== null ? [{ type: 'tree.compare', nodeIds: [${ids}.get(a), ${ids}.get(b)] }] : [])] }); return result; };\nconst ${finish} = (node, value, role, source) => { const from = node === null ? 'null' : ${ids}.get(node); if (node !== null) ${path}.pop(); const to = ${path}.at(-1) ?? null; trace.frame({ source, operation: { type: 'return', value: ${ref}(value), role, from, to }, commands: [{ type: 'tree.mark', marker: 'path', nodeIds: [...${path}] }, ...(role === 'target' ? [{ type: 'tree.mark', marker: 'target', nodeIds: [${ids}.get(value)] }] : []), ...(role === 'ancestor' || role === 'propagate' ? [{ type: 'tree.mark', marker: 'result', nodeIds: value === null ? [] : [${ids}.get(value)] }] : [])] }); return value; };\n`;

  const checkAt = (
    node: AnyNode,
    a: string,
    b: string,
    operator: 'eq' | 'neq',
    leftLabel: string,
    rightLabel: string,
  ) =>
    `${check}(${a}, ${b}, '${operator}', ${location(node)}, ${JSON.stringify(leftLabel)}, ${JSON.stringify(rightLabel)})`;
  const targetTest = targetGuard.test as typeof targetGuard.test & {
    left: AnyNode;
    right: AnyNode;
  };
  const ancestorTest = ancestorGuard.test as typeof ancestorGuard.test & {
    left: AnyNode;
    right: AnyNode;
  };
  const recursive = (
    statement: AnyNode,
    expression: Expression,
    side: 'left' | 'right',
    bindingName: string,
  ): SourceEdit[] => {
    const child = `${current.name}.${side}`;
    return [
      before(
        statement,
        `\nif (${child} !== null) ${path}.push(${ids}.get(${child}));\ntrace.frame({ source: ${location(expression)}, operation: { type: 'call', callee: ${JSON.stringify(fn.id!.name)}, from: ${ids}.get(${current.name}), target: ${child} === null ? 'null' : ${ids}.get(${child}) }, commands: [{ type: 'tree.mark', marker: 'path', nodeIds: [...${path}] }] });\n`,
      ),
      after(
        statement,
        `\ntrace.frame({ source: ${location(statement)}, operation: { type: 'assign', target: ${JSON.stringify(bindingName)}, before: { kind: 'undefined' }, value: ${ref}(${bindingName}) }, commands: [{ type: 'tree.mark', marker: ${JSON.stringify(side)}, nodeIds: ${bindingName} === null ? [] : [${ids}.get(${bindingName})] }] });\n`,
      ),
    ];
  };
  const fallbackTest = fallback.argument.test;
  const edits: SourceEdit[] = [
    after(treeStatement!, setup),
    before(answerStatement!, `\n${path}.push(${ids}.get(${tree.id.name}));\n`),
    replace(
      nullGuard.test,
      checkAt(nullGuard.test, current.name, 'null', 'eq', current.name, 'null'),
    ),
    replace(
      nullGuard.consequent.argument!,
      `${finish}(${current.name}, null, 'null', ${location(nullGuard.consequent)})`,
    ),
    replace(
      targetTest.left,
      checkAt(
        targetTest.left,
        current.name,
        p.name,
        'eq',
        current.name,
        p.name,
      ),
    ),
    replace(
      targetTest.right,
      checkAt(
        targetTest.right,
        current.name,
        q.name,
        'eq',
        current.name,
        q.name,
      ),
    ),
    replace(
      targetGuard.consequent.argument!,
      `${finish}(${current.name}, ${current.name}, 'target', ${location(targetGuard.consequent)})`,
    ),
    ...recursive(leftStatement!, left.init, 'left', left.id.name),
    ...recursive(rightStatement!, right.init, 'right', right.id.name),
    replace(
      ancestorTest.left,
      checkAt(
        ancestorTest.left,
        left.id.name,
        'null',
        'neq',
        left.id.name,
        'null',
      ),
    ),
    replace(
      ancestorTest.right,
      checkAt(
        ancestorTest.right,
        right.id.name,
        'null',
        'neq',
        right.id.name,
        'null',
      ),
    ),
    replace(
      ancestorGuard.consequent.argument!,
      `${finish}(${current.name}, ${current.name}, 'ancestor', ${location(ancestorGuard.consequent)})`,
    ),
    replace(
      fallback.argument,
      `${finish}(${current.name}, ${checkAt(fallbackTest, left.id.name, 'null', 'neq', left.id.name, 'null')} ? ${left.id.name} : ${right.id.name}, 'propagate', ${location(fallback)})`,
    ),
  ];
  return applySourceEdits(source, edits);
}
