import {
  type AnyNode,
  type CallExpression,
  type Expression,
  type MemberExpression,
  type Program,
  type VariableDeclaration,
} from 'acorn';

import { TRACE_LIMITS } from '../protocol';
import {
  createIdentifierAllocator,
  hasUnsafeInstrumentationSyntax,
  isDirectWriteTarget,
  isDirectRootMethodCall,
  isIdentifierReference,
  isLengthMember,
  isRootWrite,
  isRootedInvocation,
  sourceLine,
  staticTraceValue,
  walkAst,
} from './ast';
import { applySourceEdits, type SourceEdit } from './edits';
import {
  hasSafePrimaryRootUsage,
  primaryOperationBindings,
  type PrimaryOperationBinding,
  type ValidVisualizationSource,
} from './sourceContract';

type StackCall = {
  readonly kind: 'push' | 'pop';
  readonly call: CallExpression;
  readonly member: MemberExpression;
  readonly line: number;
};

type StackPeek = {
  readonly kind: 'peek';
  readonly target: MemberExpression | CallExpression;
  readonly members: readonly MemberExpression[];
  readonly line: number;
};

type StackOperation = StackCall | StackPeek;

type StackCandidate = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly initialRoot: string;
  readonly root: string;
  readonly operations: readonly StackOperation[];
};

export function instrumentStack(
  source: string,
  program: Program,
  contract: ValidVisualizationSource,
): string | null {
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  const declaration = findStackDeclaration(contract);
  if (declaration === null) return null;

  const candidates = primaryOperationBindings(contract)
    .map((binding) => analyzeStack(contract, declaration, binding))
    .filter((candidate): candidate is StackCandidate => candidate !== null);

  if (candidates.length !== 1) return null;

  const [candidate] = candidates;
  if (candidate === undefined) return null;

  const allocateIdentifier = createIdentifierAllocator(program, '__traceStack');
  const isTraceValue = allocateIdentifier();
  const pushHelper = candidate.operations.some(({ kind }) => kind === 'push')
    ? allocateIdentifier()
    : null;
  const popHelper = candidate.operations.some(({ kind }) => kind === 'pop')
    ? allocateIdentifier()
    : null;
  const peekHelper = candidate.operations.some(({ kind }) => kind === 'peek')
    ? allocateIdentifier()
    : null;
  const helperSource = renderStackHelpers(
    candidate,
    isTraceValue,
    pushHelper,
    popHelper,
    peekHelper,
  );
  const operationEdits: SourceEdit[] = [];

  for (const operation of candidate.operations) {
    const replacement = stackOperationReplacement(
      source,
      operation,
      candidate.root,
      pushHelper,
      popHelper,
      peekHelper,
    );
    if (replacement === null) return null;

    operationEdits.push({
      start:
        operation.kind === 'peek'
          ? operation.target.start
          : operation.call.start,
      end:
        operation.kind === 'peek' ? operation.target.end : operation.call.end,
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

function renderStackHelpers(
  candidate: StackCandidate,
  isTraceValue: string,
  push: string | null,
  pop: string | null,
  peek: string | null,
): string {
  return (
    `;\ntrace.initialize({ structure: 'stack', source: { line: ${candidate.declarationLine} } });\n` +
    `trace.createStack({ values: ${candidate.initialRoot}, source: { line: ${candidate.declarationLine} } });\n` +
    `const ${isTraceValue} = (value) => typeof value === 'string' ? value.length <= ${TRACE_LIMITS.stringLength} : typeof value === 'number' && value - value === 0;\n` +
    (push === null
      ? ''
      : `const ${push} = (method, value, line) => { const result = method(value); if (${isTraceValue}(value)) trace.push({ value, source: { line } }); return result; };\n`) +
    (pop === null
      ? ''
      : `const ${pop} = (method, line) => { const value = method(); if (${isTraceValue}(value)) trace.pop({ source: { line } }); return value; };\n`) +
    (peek === null
      ? ''
      : `const ${peek} = (values, method, line) => { const value = method === null ? values[values.length - 1] : method(-1); if (${isTraceValue}(value)) trace.peek({ source: { line } }); return value; };\n`)
  );
}

function analyzeStack(
  contract: ValidVisualizationSource,
  declaration: VariableDeclaration,
  binding: PrimaryOperationBinding,
): StackCandidate | null {
  const root = binding.root;
  const declarationLine = sourceLine(declaration);
  if (declarationLine === null) return null;

  const operations: StackOperation[] = [];

  walkAst(
    binding.scope.body,
    (node, parent, _grandparent, insideUnsupportedScope) => {
      if (insideUnsupportedScope) return;

      const peek = matchStackPeek(node, parent, root);
      if (peek !== null) {
        operations.push(peek);
        return;
      }

      const call = matchStackCall(node, root);
      if (call !== null) {
        operations.push(call);
        return;
      }
    },
  );

  if (
    !operations.some(({ kind }) => kind === 'pop' || kind === 'peek') ||
    operations.some((operation) =>
      operation.kind === 'peek'
        ? operation.target.start < declaration.end
        : operation.call.start < declaration.end,
    ) ||
    !hasSafePrimaryRootUsage(contract, binding) ||
    hasUnsafeStackUsage(binding.scope.body, declaration, operations, root)
  ) {
    return null;
  }

  return {
    declaration,
    declarationLine,
    initialRoot: contract.identifier,
    root,
    operations,
  };
}

function matchStackCall(node: AnyNode, root: string): StackCall | null {
  if (!isDirectRootMethodCall(node, root)) return null;

  const method = node.callee.property.name;
  const line = sourceLine(node);
  if (line === null) return null;

  if (method === 'push' && node.arguments.length === 1) {
    const [argument] = node.arguments;
    if (
      argument !== undefined &&
      argument.type !== 'SpreadElement' &&
      isSupportedStackValue(argument)
    ) {
      return { kind: 'push', call: node, member: node.callee, line };
    }
  }

  return method === 'pop' && node.arguments.length === 0
    ? { kind: 'pop', call: node, member: node.callee, line }
    : null;
}

function isSupportedStackValue(expression: Expression): boolean {
  if (
    expression.type === 'Identifier' ||
    staticTraceValue(expression) !== null
  ) {
    return true;
  }

  if (expression.type === 'UnaryExpression') {
    return (
      (expression.operator === '+' || expression.operator === '-') &&
      isSupportedStackValue(expression.argument)
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
      isSupportedStackValue(expression.left) &&
      isSupportedStackValue(expression.right)
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
    isSupportedStackValue(argument) &&
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

function matchStackPeek(
  node: AnyNode,
  parent: AnyNode | null,
  root: string,
): StackPeek | null {
  if (
    isDirectRootMethodCall(node, root) &&
    node.callee.property.name === 'at' &&
    node.arguments.length === 1 &&
    node.arguments[0]?.type !== 'SpreadElement' &&
    staticTraceValue(node.arguments[0] ?? null) === -1
  ) {
    const line = sourceLine(node);
    return line === null
      ? null
      : { kind: 'peek', target: node, members: [node.callee], line };
  }

  if (
    node.type !== 'MemberExpression' ||
    !node.computed ||
    node.optional ||
    node.object.type !== 'Identifier' ||
    node.object.name !== root ||
    node.property.type !== 'BinaryExpression' ||
    node.property.operator !== '-' ||
    node.property.left.type !== 'MemberExpression' ||
    node.property.left.computed ||
    node.property.left.object.type !== 'Identifier' ||
    node.property.left.object.name !== root ||
    node.property.left.property.type !== 'Identifier' ||
    node.property.left.property.name !== 'length' ||
    node.property.right.type !== 'Literal' ||
    node.property.right.value !== 1 ||
    isDirectWriteTarget(node, parent)
  ) {
    return null;
  }

  const line = sourceLine(node);
  return line === null
    ? null
    : {
        kind: 'peek',
        target: node,
        members: [node, node.property.left],
        line,
      };
}

function findStackDeclaration(
  contract: ValidVisualizationSource,
): VariableDeclaration | null {
  const initializer = contract.declaration.declarations[0]?.init;
  return initializer?.type === 'ArrayExpression' &&
    initializer.elements.length === 0
    ? contract.declaration
    : null;
}

function hasUnsafeStackUsage(
  rootNode: AnyNode,
  declaration: VariableDeclaration,
  operations: readonly StackOperation[],
  root: string,
): boolean {
  const supportedCalls = new Set(
    operations.flatMap((operation) =>
      operation.kind === 'peek'
        ? operation.target.type === 'CallExpression'
          ? [operation.target]
          : []
        : [operation.call],
    ),
  );
  const supportedMembers = new Set(
    operations.flatMap((operation) =>
      operation.kind === 'peek' ? operation.members : [operation.member],
    ),
  );
  let unsafe = false;

  walkAst(rootNode, (node, parent) => {
    if (
      (isRootedInvocation(node, root) &&
        (node.type !== 'CallExpression' || !supportedCalls.has(node))) ||
      isRootWrite(node, root) ||
      (isIdentifierReference(node, parent, root) &&
        !isSafeStackReference(node, parent, declaration, supportedMembers))
    ) {
      unsafe = true;
    }
  });

  return unsafe;
}

function isSafeStackReference(
  node: AnyNode,
  parent: AnyNode | null,
  declaration: VariableDeclaration,
  supportedMembers: ReadonlySet<MemberExpression>,
): boolean {
  return (
    node === declaration.declarations[0]?.id ||
    (parent?.type === 'MemberExpression' &&
      parent.object === node &&
      (supportedMembers.has(parent) || isLengthMember(parent)))
  );
}

function stackOperationReplacement(
  source: string,
  operation: StackOperation,
  root: string,
  pushHelper: string | null,
  popHelper: string | null,
  peekHelper: string | null,
): string | null {
  switch (operation.kind) {
    case 'push':
      return pushHelper === null
        ? null
        : `${pushHelper}(${root}.push.bind(${root}), ${source.slice(operation.call.arguments[0]?.start, operation.call.arguments[0]?.end)}, ${operation.line})`;
    case 'pop':
      return popHelper === null
        ? null
        : `${popHelper}(${root}.pop.bind(${root}), ${operation.line})`;
    case 'peek':
      return peekHelper === null
        ? null
        : `${peekHelper}(${root}, ${operation.target.type === 'CallExpression' ? `${root}.at.bind(${root})` : 'null'}, ${operation.line})`;
  }
}
