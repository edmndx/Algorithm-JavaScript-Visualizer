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
  isDirectRootMethodCall,
  isIdentifierReference,
  isSupportedIndexExpression,
  isRootWrite,
  isRootedInvocation,
  sourceLine,
  walkAst,
} from './ast';
import { applySourceEdits, type SourceEdit } from './edits';
import {
  hasSafePrimaryRootUsage,
  primaryOperationBindings,
  type PrimaryOperationBinding,
  type ValidVisualizationSource,
} from './sourceContract';

type MapMethod = 'set' | 'get' | 'has' | 'delete';

type MapOperation = {
  readonly method: MapMethod;
  readonly call: CallExpression;
  readonly member: MemberExpression;
  readonly line: number;
};

type HashTableCandidate = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly root: string;
  readonly operations: readonly MapOperation[];
};

type HashHelperNames = {
  readonly entryIds: string;
  readonly nextEntryId: string;
  readonly bucketIndex: string;
  readonly entryId: string;
  readonly isTraceValue: string;
  readonly set: string;
  readonly get: string | null;
  readonly has: string | null;
  readonly delete: string | null;
};

const BUCKET_COUNT = 17;

export function instrumentHashTable(
  source: string,
  program: Program,
  contract: ValidVisualizationSource,
): string | null {
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  const declaration = findMapDeclaration(contract);
  if (declaration === null) return null;

  const candidates = primaryOperationBindings(contract)
    .map((binding) => analyzeHashTable(contract, declaration, binding))
    .filter((candidate): candidate is HashTableCandidate => candidate !== null);

  if (candidates.length !== 1) return null;

  const [candidate] = candidates;
  if (candidate === undefined) return null;

  const allocateIdentifier = createIdentifierAllocator(program, '__traceHash');
  const helperNames: HashHelperNames = {
    entryIds: allocateIdentifier(),
    nextEntryId: allocateIdentifier(),
    bucketIndex: allocateIdentifier(),
    entryId: allocateIdentifier(),
    isTraceValue: allocateIdentifier(),
    set: allocateIdentifier(),
    get: candidate.operations.some(({ method }) => method === 'get')
      ? allocateIdentifier()
      : null,
    has: candidate.operations.some(({ method }) => method === 'has')
      ? allocateIdentifier()
      : null,
    delete: candidate.operations.some(({ method }) => method === 'delete')
      ? allocateIdentifier()
      : null,
  };
  const helpers = renderHashHelpers(candidate, helperNames);
  const helpersByMethod: Readonly<Record<MapMethod, string | null>> = {
    set: helperNames.set,
    get: helperNames.get,
    has: helperNames.has,
    delete: helperNames.delete,
  };
  const outermostOperations = candidate.operations.filter(
    (operation) =>
      !candidate.operations.some(
        (other) =>
          other !== operation && containsCall(other.call, operation.call),
      ),
  );
  const operationEdits: SourceEdit[] = [];

  for (const operation of outermostOperations) {
    const replacement = renderMapOperation(
      source,
      operation,
      candidate.operations,
      candidate.root,
      helpersByMethod,
    );
    if (replacement === null) return null;

    operationEdits.push({
      start: operation.call.start,
      end: operation.call.end,
      text: replacement,
    });
  }

  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text: helpers,
    },
    ...operationEdits,
  ];

  return applySourceEdits(source, edits);
}

function renderHashHelpers(
  candidate: HashTableCandidate,
  names: HashHelperNames,
): string {
  const {
    entryIds,
    nextEntryId,
    bucketIndex,
    entryId,
    isTraceValue,
    set,
    get,
    has,
    delete: deleteHelper,
  } = names;

  return (
    `;\ntrace.initialize({ structure: 'hash-table', source: { line: ${candidate.declarationLine} } });\n` +
    `trace.createHashTable({ bucketCount: ${BUCKET_COUNT}, strategy: 'chaining', entries: [], source: { line: ${candidate.declarationLine} } });\n` +
    `const ${entryIds} = new Map();\n` +
    `let ${nextEntryId} = 0;\n` +
    `const ${isTraceValue} = (value) => typeof value === 'string' ? value.length <= ${TRACE_LIMITS.stringLength} : typeof value === 'number' && value - value === 0;\n` +
    `const ${bucketIndex} = (key) => { const text = (typeof key === 'number' ? 'n:' : 's:') + key; let hash = 0; for (let index = 0; index < text.length; index += 1) hash = ((hash ^ text.charCodeAt(index)) * 16777619) >>> 0; return hash % ${BUCKET_COUNT}; };\n` +
    `const ${entryId} = (key) => { let id = ${entryIds}.get(key); if (id === undefined) { id = 'entry-' + ${nextEntryId}; ${nextEntryId} += 1; ${entryIds}.set(key, id); } return id; };\n` +
    `const ${set} = (method, key, value, line) => { const result = method(key, value); if (${isTraceValue}(key)) { if (${isTraceValue}(value)) trace.set({ entry: { id: ${entryId}(key), key, value, bucketIndex: ${bucketIndex}(key) }, source: { line } }); else { const id = ${entryIds}.get(key); if (id !== undefined) { trace.delete({ entryId: id, source: { line } }); ${entryIds}.delete(key); } } } return result; };\n` +
    (get === null
      ? ''
      : `const ${get} = (method, key, line) => { const value = method(key); if (${isTraceValue}(key)) { trace.visitBucket({ bucketIndex: ${bucketIndex}(key), source: { line } }); const id = ${entryIds}.get(key); if (id !== undefined) trace.visitEntry({ entryId: id, source: { line } }); } return value; };\n`) +
    (has === null
      ? ''
      : `const ${has} = (method, key, line) => { const result = method(key); if (${isTraceValue}(key)) { trace.visitBucket({ bucketIndex: ${bucketIndex}(key), source: { line } }); const id = ${entryIds}.get(key); if (result && id !== undefined) trace.visitEntry({ entryId: id, source: { line } }); } return result; };\n`) +
    (deleteHelper === null
      ? ''
      : `const ${deleteHelper} = (method, key, line) => { const id = ${entryIds}.get(key); const result = method(key); if (${isTraceValue}(key)) { trace.visitBucket({ bucketIndex: ${bucketIndex}(key), source: { line } }); if (result && id !== undefined) { trace.delete({ entryId: id, source: { line } }); ${entryIds}.delete(key); } } return result; };\n`)
  );
}

function analyzeHashTable(
  contract: ValidVisualizationSource,
  declaration: VariableDeclaration,
  binding: PrimaryOperationBinding,
): HashTableCandidate | null {
  const root = binding.root;
  const declarationLine = sourceLine(declaration);
  if (declarationLine === null) return null;

  const operations: MapOperation[] = [];

  walkAst(
    binding.scope.body,
    (node, _parent, _grandparent, insideUnsupportedScope) => {
      if (insideUnsupportedScope) return;
      const operation = matchMapOperation(node, root);
      if (operation !== null) operations.push(operation);
    },
  );

  if (
    !operations.some(({ method }) => method === 'set') ||
    operations.some(({ call }) => call.start < declaration.end) ||
    !hasSafePrimaryRootUsage(contract, binding) ||
    hasUnsafeHashTableUsage(binding.scope.body, declaration, operations, root)
  ) {
    return null;
  }

  return { declaration, declarationLine, root, operations };
}

function matchMapOperation(node: AnyNode, root: string): MapOperation | null {
  if (!isDirectRootMethodCall(node, root)) return null;

  const method = node.callee.property.name;
  const expectedArguments = method === 'set' ? 2 : 1;
  const line = sourceLine(node);

  if (
    line === null ||
    (method !== 'set' &&
      method !== 'get' &&
      method !== 'has' &&
      method !== 'delete') ||
    node.arguments.length !== expectedArguments ||
    node.arguments.some(({ type }) => type === 'SpreadElement')
  ) {
    return null;
  }

  const [key, value] = node.arguments;
  if (
    key?.type === 'SpreadElement' ||
    key === undefined ||
    !isSupportedMapExpression(key, root) ||
    (method === 'set' &&
      (value?.type === 'SpreadElement' ||
        value === undefined ||
        !isSupportedMapExpression(value, root)))
  ) {
    return null;
  }

  return { method, call: node, member: node.callee, line };
}

function isSupportedMapExpression(
  expression: Expression,
  root: string,
): boolean {
  if (
    expression.type === 'Identifier' ||
    (expression.type === 'Literal' &&
      ((typeof expression.value === 'string' &&
        expression.value.length <= TRACE_LIMITS.stringLength) ||
        (typeof expression.value === 'number' &&
          Number.isFinite(expression.value))))
  ) {
    return true;
  }

  if (expression.type === 'UnaryExpression') {
    return (
      (expression.operator === '+' || expression.operator === '-') &&
      isSupportedMapExpression(expression.argument, root)
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
      isSupportedMapExpression(expression.left, root) &&
      isSupportedMapExpression(expression.right, root)
    );
  }

  if (expression.type === 'LogicalExpression') {
    return (
      expression.operator === '??' &&
      isSupportedMapExpression(expression.left, root) &&
      isSupportedMapExpression(expression.right, root)
    );
  }

  if (expression.type === 'MemberExpression') {
    return (
      !expression.optional &&
      expression.computed &&
      expression.object.type === 'Identifier' &&
      expression.object.name !== root &&
      expression.property.type !== 'PrivateIdentifier' &&
      isSupportedIndexExpression(expression.property)
    );
  }

  return isSupportedMapRead(expression, root);
}

function isSupportedMapRead(expression: Expression, root: string): boolean {
  if (
    !isDirectRootMethodCall(expression, root) ||
    (expression.callee.property.name !== 'get' &&
      expression.callee.property.name !== 'has') ||
    expression.arguments.length !== 1
  ) {
    return false;
  }

  const [key] = expression.arguments;
  return (
    key !== undefined &&
    key.type !== 'SpreadElement' &&
    isSupportedMapExpression(key, root)
  );
}

function renderMapOperation(
  source: string,
  operation: MapOperation,
  operations: readonly MapOperation[],
  root: string,
  helpers: Readonly<Record<MapMethod, string | null>>,
): string | null {
  const helper = helpers[operation.method];
  if (helper === null) return null;

  const argumentsSource: string[] = [];
  for (const argument of operation.call.arguments) {
    if (argument.type === 'SpreadElement') return null;

    const rendered = renderMapRange(
      source,
      argument.start,
      argument.end,
      operations,
      root,
      helpers,
    );
    if (rendered === null) return null;
    argumentsSource.push(rendered);
  }

  return `${helper}(${root}.${operation.method}.bind(${root}), ${argumentsSource.join(', ')}, ${operation.line})`;
}

function renderMapRange(
  source: string,
  start: number,
  end: number,
  operations: readonly MapOperation[],
  root: string,
  helpers: Readonly<Record<MapMethod, string | null>>,
): string | null {
  const nested = operations
    .filter(
      ({ call }) =>
        call.start >= start &&
        call.end <= end &&
        !operations.some(
          (other) =>
            other.call.start >= start &&
            other.call.end <= end &&
            containsCall(other.call, call),
        ),
    )
    .sort((left, right) => left.call.start - right.call.start);

  let cursor = start;
  let rendered = '';

  for (const operation of nested) {
    if (operation.call.start < cursor || operation.call.end > end) return null;

    const replacement = renderMapOperation(
      source,
      operation,
      operations,
      root,
      helpers,
    );
    if (replacement === null) return null;

    rendered += source.slice(cursor, operation.call.start) + replacement;
    cursor = operation.call.end;
  }

  return rendered + source.slice(cursor, end);
}

function containsCall(outer: CallExpression, inner: CallExpression): boolean {
  return (
    outer !== inner && outer.start <= inner.start && outer.end >= inner.end
  );
}

function findMapDeclaration(
  contract: ValidVisualizationSource,
): VariableDeclaration | null {
  const initializer = contract.declaration.declarations[0]?.init;
  return initializer?.type === 'NewExpression' &&
    initializer.callee.type === 'Identifier' &&
    initializer.callee.name === 'Map' &&
    initializer.arguments.length === 0
    ? contract.declaration
    : null;
}

function hasUnsafeHashTableUsage(
  rootNode: AnyNode,
  declaration: VariableDeclaration,
  operations: readonly MapOperation[],
  root: string,
): boolean {
  const supportedCalls = new Set(operations.map(({ call }) => call));
  const supportedMembers = new Set(operations.map(({ member }) => member));
  let unsafe = false;

  const operationsByCall = new Map(
    operations.map((operation) => [operation.call, operation]),
  );

  walkAst(rootNode, (node, parent) => {
    if (
      (isRootedInvocation(node, root) &&
        (node.type !== 'CallExpression' || !supportedCalls.has(node))) ||
      isUnsafeMapCallResult(node, parent, operationsByCall) ||
      isRootWrite(node, root) ||
      (isIdentifierReference(node, parent, root) &&
        !isSafeHashTableReference(node, parent, declaration, supportedMembers))
    ) {
      unsafe = true;
    }
  });

  return unsafe;
}

function isUnsafeMapCallResult(
  node: AnyNode,
  parent: AnyNode | null,
  operations: ReadonlyMap<CallExpression, MapOperation>,
): boolean {
  if (node.type !== 'CallExpression') return false;
  const operation = operations.get(node);
  if (operation === undefined) return false;
  if (operation.method !== 'set') {
    return parent?.type === 'MemberExpression' && parent.object === node;
  }

  return !(
    parent?.type === 'ExpressionStatement' ||
    (parent?.type === 'MemberExpression' &&
      parent.object === node &&
      !parent.computed &&
      parent.property.type === 'Identifier' &&
      parent.property.name === 'size')
  );
}

function isSafeHashTableReference(
  node: AnyNode,
  parent: AnyNode | null,
  declaration: VariableDeclaration,
  supportedMembers: ReadonlySet<MemberExpression>,
): boolean {
  return (
    node === declaration.declarations[0]?.id ||
    (parent?.type === 'MemberExpression' &&
      parent.object === node &&
      supportedMembers.has(parent))
  );
}
