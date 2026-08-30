import {
  type AnyNode,
  type CallExpression,
  type Expression,
  type Identifier,
  type MemberExpression,
  type Program,
  type UpdateExpression,
  type VariableDeclaration,
} from 'acorn';

import { TRACE_LIMITS } from '../protocol';
import {
  createIdentifierAllocator,
  directInstrumentationScopes,
  hasUnsafeInstrumentationSyntax,
  isDirectConsoleArgument,
  isCalledExactlyOnce,
  isDirectWriteTarget,
  isDirectRootMethodCall,
  isIdentifierReference,
  isLengthMember,
  isRootWrite,
  isRootedInvocation,
  sourceLine,
  staticTraceValue,
  walkAst,
  type DirectInstrumentationScope,
} from './ast';
import { applySourceEdits, type SourceEdit } from './edits';

type QueueCall = {
  readonly kind: 'enqueue' | 'dequeue';
  readonly call: CallExpression;
  readonly member: MemberExpression;
  readonly line: number;
};

type QueuePeek = {
  readonly kind: 'peek';
  readonly member: MemberExpression;
  readonly line: number;
};

type QueueCursorDequeue = {
  readonly kind: 'cursor-dequeue';
  readonly member: MemberExpression;
  readonly cursor: Identifier;
  readonly update: UpdateExpression;
  readonly line: number;
};

type QueueOperation = QueueCall | QueuePeek | QueueCursorDequeue;

type QueueCandidate = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly root: string;
  readonly operations: readonly QueueOperation[];
};

export function instrumentQueue(
  source: string,
  program: Program,
): string | null {
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  const candidates = findQueueDeclarations(program)
    .map(({ declaration, scope }) => analyzeQueue(program, declaration, scope))
    .filter((candidate): candidate is QueueCandidate => candidate !== null);

  if (candidates.length !== 1) return null;

  const [candidate] = candidates;
  if (candidate === undefined) return null;

  const allocateIdentifier = createIdentifierAllocator(program, '__traceQueue');
  const isTraceValue = allocateIdentifier();
  const enqueueHelper = candidate.operations.some(
    ({ kind }) => kind === 'enqueue',
  )
    ? allocateIdentifier()
    : null;
  const dequeueHelper = candidate.operations.some(
    ({ kind }) => kind === 'dequeue',
  )
    ? allocateIdentifier()
    : null;
  const cursorDequeueHelper = candidate.operations.some(
    ({ kind }) => kind === 'cursor-dequeue',
  )
    ? allocateIdentifier()
    : null;
  const peekHelper = candidate.operations.some(({ kind }) => kind === 'peek')
    ? allocateIdentifier()
    : null;
  const helperSource = renderQueueHelpers(
    candidate,
    isTraceValue,
    enqueueHelper,
    dequeueHelper,
    cursorDequeueHelper,
    peekHelper,
  );
  const operationEdits: SourceEdit[] = [];

  for (const operation of candidate.operations) {
    const replacement = queueOperationReplacement(
      source,
      operation,
      candidate.root,
      enqueueHelper,
      dequeueHelper,
      cursorDequeueHelper,
      peekHelper,
    );
    if (replacement === null) return null;

    operationEdits.push({
      start:
        operation.kind === 'peek' || operation.kind === 'cursor-dequeue'
          ? operation.member.start
          : operation.call.start,
      end:
        operation.kind === 'peek' || operation.kind === 'cursor-dequeue'
          ? operation.member.end
          : operation.call.end,
      text: replacement,
    });
  }

  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text: helperSource,
    },
    ...operationEdits,
  ];

  return applySourceEdits(source, edits);
}

function renderQueueHelpers(
  candidate: QueueCandidate,
  isTraceValue: string,
  enqueue: string | null,
  dequeue: string | null,
  cursorDequeue: string | null,
  peek: string | null,
): string {
  return (
    `;\ntrace.initialize({ structure: 'queue', source: { line: ${candidate.declarationLine} } });\n` +
    `trace.createQueue({ values: ${candidate.root}, source: { line: ${candidate.declarationLine} } });\n` +
    `const ${isTraceValue} = (value) => typeof value === 'string' ? value.length <= ${TRACE_LIMITS.stringLength} : typeof value === 'number' && value - value === 0;\n` +
    (enqueue === null
      ? ''
      : `const ${enqueue} = (method, line, ...values) => { const result = method(...values); for (const value of values) if (${isTraceValue}(value)) trace.enqueue({ value, source: { line } }); return result; };\n`) +
    (dequeue === null
      ? ''
      : `const ${dequeue} = (method, line) => { const value = method(); if (${isTraceValue}(value)) trace.dequeue({ source: { line } }); return value; };\n`) +
    (cursorDequeue === null
      ? ''
      : `const ${cursorDequeue} = (index, line) => { const value = ${candidate.root}[index]; if (${isTraceValue}(value)) trace.dequeue({ source: { line } }); return value; };\n`) +
    (peek === null
      ? ''
      : `const ${peek} = (line) => { const value = ${candidate.root}[0]; if (${isTraceValue}(value)) trace.peek({ source: { line } }); return value; };\n`)
  );
}

function analyzeQueue(
  program: Program,
  declaration: VariableDeclaration,
  scope: DirectInstrumentationScope,
): QueueCandidate | null {
  const declarator = declaration.declarations[0];
  if (declarator?.id.type !== 'Identifier') return null;

  const root = declarator.id.name;
  const declarationLine = sourceLine(declaration);
  if (
    declarationLine === null ||
    (scope.owner !== null && !isCalledExactlyOnce(program, scope.owner))
  ) {
    return null;
  }

  const operations: QueueOperation[] = [];

  walkAst(scope.body, (node, parent, _grandparent, insideUnsupportedScope) => {
    if (insideUnsupportedScope) return;

    const cursorDequeue = matchQueueCursorDequeue(node, parent, root);
    if (cursorDequeue !== null) {
      operations.push(cursorDequeue);
      return;
    }

    const call = matchQueueCall(node, root);
    if (call !== null) {
      operations.push(call);
      return;
    }

    const peek = matchQueuePeek(node, parent, root);
    if (peek !== null) operations.push(peek);
  });

  if (
    !operations.some(
      ({ kind }) =>
        kind === 'dequeue' || kind === 'cursor-dequeue' || kind === 'peek',
    ) ||
    operations.some((operation) =>
      operation.kind === 'peek' || operation.kind === 'cursor-dequeue'
        ? operation.member.start < declaration.end
        : operation.call.start < declaration.end,
    ) ||
    !hasValidQueueCursorUsage(scope, operations, root) ||
    hasUnsafeQueueUsage(program, declaration, operations, root)
  ) {
    return null;
  }

  return { declaration, declarationLine, root, operations };
}

function matchQueueCall(node: AnyNode, root: string): QueueCall | null {
  if (!isDirectRootMethodCall(node, root)) return null;

  const method = node.callee.property.name;
  const line = sourceLine(node);
  if (line === null) return null;

  if (method === 'push' && node.arguments.length > 0) {
    if (
      node.arguments.every(
        (argument) =>
          argument.type !== 'SpreadElement' && isSupportedQueueValue(argument),
      )
    ) {
      return { kind: 'enqueue', call: node, member: node.callee, line };
    }
  }

  return method === 'shift' && node.arguments.length === 0
    ? { kind: 'dequeue', call: node, member: node.callee, line }
    : null;
}

function isSupportedQueueValue(expression: Expression): boolean {
  if (
    expression.type === 'Identifier' ||
    staticTraceValue(expression) !== null
  ) {
    return true;
  }

  if (expression.type === 'TemplateLiteral') {
    return expression.expressions.every(isSupportedQueueValue);
  }

  if (expression.type === 'UnaryExpression') {
    return (
      (expression.operator === '+' || expression.operator === '-') &&
      isSupportedQueueValue(expression.argument)
    );
  }

  if (expression.type === 'BinaryExpression') {
    return (
      expression.left.type !== 'PrivateIdentifier' &&
      (expression.operator === '+' ||
        expression.operator === '-' ||
        expression.operator === '*' ||
        expression.operator === '/' ||
        expression.operator === '%' ||
        expression.operator === '**') &&
      isSupportedQueueValue(expression.left) &&
      isSupportedQueueValue(expression.right)
    );
  }

  if (
    expression.type !== 'CallExpression' ||
    expression.optional ||
    expression.arguments.length !== 1
  ) {
    return false;
  }

  const [argument] = expression.arguments;
  if (argument === undefined || argument.type === 'SpreadElement') return false;

  return (
    isSupportedQueueValue(argument) &&
    (isNumberCall(expression) || isMathTruncCall(expression))
  );
}

function isNumberCall(call: CallExpression): boolean {
  return call.callee.type === 'Identifier' && call.callee.name === 'Number';
}

function isMathTruncCall(call: CallExpression): boolean {
  return (
    call.callee.type === 'MemberExpression' &&
    !call.callee.computed &&
    !call.callee.optional &&
    call.callee.object.type === 'Identifier' &&
    call.callee.object.name === 'Math' &&
    call.callee.property.type === 'Identifier' &&
    call.callee.property.name === 'trunc'
  );
}

function matchQueueCursorDequeue(
  node: AnyNode,
  parent: AnyNode | null,
  root: string,
): QueueCursorDequeue | null {
  if (
    node.type !== 'MemberExpression' ||
    !node.computed ||
    node.optional ||
    node.object.type !== 'Identifier' ||
    node.object.name !== root ||
    node.property.type !== 'UpdateExpression' ||
    node.property.operator !== '++' ||
    node.property.prefix ||
    node.property.argument.type !== 'Identifier' ||
    isDirectWriteTarget(node, parent)
  ) {
    return null;
  }

  const line = sourceLine(node);
  return line === null
    ? null
    : {
        kind: 'cursor-dequeue',
        member: node,
        cursor: node.property.argument,
        update: node.property,
        line,
      };
}

function matchQueuePeek(
  node: AnyNode,
  parent: AnyNode | null,
  root: string,
): QueuePeek | null {
  if (
    node.type !== 'MemberExpression' ||
    !node.computed ||
    node.optional ||
    node.object.type !== 'Identifier' ||
    node.object.name !== root ||
    node.property.type !== 'Literal' ||
    node.property.value !== 0 ||
    isDirectWriteTarget(node, parent)
  ) {
    return null;
  }

  const line = sourceLine(node);
  return line === null ? null : { kind: 'peek', member: node, line };
}

function findQueueDeclarations(program: Program): Array<{
  readonly declaration: VariableDeclaration;
  readonly scope: DirectInstrumentationScope;
}> {
  return directInstrumentationScopes(program).flatMap((scope) =>
    scope.body.body.flatMap((statement) =>
      statement.type === 'VariableDeclaration' &&
      statement.kind === 'const' &&
      statement.declarations.length === 1 &&
      statement.declarations[0]?.id.type === 'Identifier' &&
      statement.declarations[0].init?.type === 'ArrayExpression' &&
      statement.declarations[0].init.elements.every(
        (element) => staticTraceValue(element) !== null,
      )
        ? [{ declaration: statement, scope }]
        : [],
    ),
  );
}

function hasValidQueueCursorUsage(
  scope: DirectInstrumentationScope,
  operations: readonly QueueOperation[],
  root: string,
): boolean {
  const cursorReads = operations.filter(
    (operation): operation is QueueCursorDequeue =>
      operation.kind === 'cursor-dequeue',
  );
  if (cursorReads.length === 0) return true;

  const cursorName = cursorReads[0]?.cursor.name;
  if (
    cursorName === undefined ||
    cursorReads.some(({ cursor }) => cursor.name !== cursorName)
  ) {
    return false;
  }

  const declarations = scope.body.body.filter(
    (statement): statement is VariableDeclaration =>
      statement.type === 'VariableDeclaration' &&
      statement.kind === 'let' &&
      statement.declarations.length === 1 &&
      statement.declarations[0]?.id.type === 'Identifier' &&
      statement.declarations[0].id.name === cursorName &&
      statement.declarations[0].init?.type === 'Literal' &&
      statement.declarations[0].init.value === 0,
  );
  const declaration = declarations[0];
  if (
    declarations.length !== 1 ||
    declaration?.type !== 'VariableDeclaration'
  ) {
    return false;
  }

  const cursorIdentifier = declaration.declarations[0]?.id;
  if (cursorIdentifier?.type !== 'Identifier') return false;

  const supportedUpdates = new Set(cursorReads.map(({ update }) => update));
  let valid = true;

  walkAst(scope.body, (node, parent, _grandparent, insideUnsupportedScope) => {
    if (!isIdentifierReference(node, parent, cursorName)) return;

    if (insideUnsupportedScope) {
      valid = false;
      return;
    }

    if (
      node === cursorIdentifier ||
      (parent?.type === 'UpdateExpression' &&
        parent.argument === node &&
        supportedUpdates.has(parent)) ||
      isQueueCursorBound(node, parent, root)
    ) {
      return;
    }

    valid = false;
  });

  return valid;
}

function isQueueCursorBound(
  node: AnyNode,
  parent: AnyNode | null,
  root: string,
): boolean {
  if (
    parent?.type !== 'BinaryExpression' ||
    parent.left !== node ||
    parent.operator !== '<' ||
    parent.right.type !== 'MemberExpression' ||
    parent.right.object.type !== 'Identifier' ||
    parent.right.object.name !== root
  ) {
    return false;
  }

  return isLengthMember(parent.right);
}

function hasUnsafeQueueUsage(
  program: Program,
  declaration: VariableDeclaration,
  operations: readonly QueueOperation[],
  root: string,
): boolean {
  const supportedCalls = new Set(
    operations.flatMap((operation) =>
      operation.kind === 'peek' || operation.kind === 'cursor-dequeue'
        ? []
        : [operation.call],
    ),
  );
  const supportedMembers = new Set(operations.map(({ member }) => member));
  let unsafe = false;

  walkAst(program, (node, parent) => {
    if (
      (isRootedInvocation(node, root) &&
        (node.type !== 'CallExpression' || !supportedCalls.has(node))) ||
      isRootWrite(node, root) ||
      (isIdentifierReference(node, parent, root) &&
        !isSafeQueueReference(node, parent, declaration, supportedMembers))
    ) {
      unsafe = true;
    }
  });

  return unsafe;
}

function isSafeQueueReference(
  node: AnyNode,
  parent: AnyNode | null,
  declaration: VariableDeclaration,
  supportedMembers: ReadonlySet<MemberExpression>,
): boolean {
  return (
    node === declaration.declarations[0]?.id ||
    isDirectConsoleArgument(node, parent) ||
    (parent?.type === 'MemberExpression' &&
      parent.object === node &&
      (supportedMembers.has(parent) || isLengthMember(parent)))
  );
}

function queueOperationReplacement(
  source: string,
  operation: QueueOperation,
  root: string,
  enqueueHelper: string | null,
  dequeueHelper: string | null,
  cursorDequeueHelper: string | null,
  peekHelper: string | null,
): string | null {
  switch (operation.kind) {
    case 'enqueue':
      return enqueueHelper === null
        ? null
        : `${enqueueHelper}(${root}.push.bind(${root}), ${operation.line}, ${operation.call.arguments.map((argument) => source.slice(argument.start, argument.end)).join(', ')})`;
    case 'dequeue':
      return dequeueHelper === null
        ? null
        : `${dequeueHelper}(${root}.shift.bind(${root}), ${operation.line})`;
    case 'cursor-dequeue':
      return cursorDequeueHelper === null
        ? null
        : `${cursorDequeueHelper}(${source.slice(operation.update.start, operation.update.end)}, ${operation.line})`;
    case 'peek':
      return peekHelper === null ? null : `${peekHelper}(${operation.line})`;
  }
}
