import type {
  AnyNode,
  CallExpression,
  FunctionDeclaration,
  Identifier,
  Program,
  VariableDeclaration,
} from 'acorn';

import {
  createIdentifierAllocator,
  isDirectMember,
  isDirectConsoleArgument,
  isIdentifierReference,
  objectPropertyValue,
  sourceLine,
  walkAst,
} from '../ast';
import { applySourceEdits, type SourceEdit } from '../edits';
import type { ValidVisualizationSource } from '../sourceContract';
import { linkedListTraceInitializationSource } from './linkedListTraceSource';
import type {
  ListDeclaration,
  MergeCandidate,
  MergeNextAssignment,
} from './linkedListTypes';

export function instrumentMerge(
  source: string,
  program: Program,
  candidate: MergeCandidate,
): string | null {
  const allocate = createIdentifierAllocator(program, '__traceList');
  const nodeIds = allocate();
  const finalize = allocate();
  const nodes = [...candidate.primary.nodes, ...candidate.auxiliary.nodes];
  const primaryTail = candidate.primary.nodes.at(-1);
  if (primaryTail === undefined) return null;

  const edits: SourceEdit[] = [
    {
      start: candidate.auxiliary.declaration.end,
      end: candidate.auxiliary.declaration.end,
      text:
        linkedListTraceInitializationSource(
          nodeIds,
          nodes,
          primaryTail.id,
          candidate.primary.declarationLine,
        ) +
        `const ${finalize} = (head, line) => { let tail = head; while (tail !== null && tail.next !== null) tail = tail.next; trace.setHead({ nodeId: head === null ? null : ${nodeIds}.get(head), source: { line } }); trace.setTail({ nodeId: tail === null ? null : ${nodeIds}.get(tail), source: { line } }); return head; };\n`,
    },
    ...candidate.assignments.map(({ statement, tail, line }) => ({
      start: statement.end,
      end: statement.end,
      text: `\nif (${nodeIds}.has(${tail.name})) trace.setNext({ nodeId: ${nodeIds}.get(${tail.name}), nextId: ${tail.name}.next === null ? null : ${nodeIds}.get(${tail.name}.next), source: { line: ${line} } });`,
    })),
    {
      start: candidate.initialCall.start,
      end: candidate.initialCall.end,
      text: `${finalize}(${source.slice(candidate.initialCall.start, candidate.initialCall.end)}, ${candidate.returnLine})`,
    },
  ];

  return applySourceEdits(source, edits);
}

export function analyzeMerge(
  program: Program,
  contract: ValidVisualizationSource,
  declarations: readonly ListDeclaration[],
): MergeCandidate | null {
  const primary = declarations[0];
  const auxiliary = declarations[1];
  if (
    declarations.length !== 2 ||
    primary === undefined ||
    auxiliary === undefined ||
    primary.declaration !== contract.declaration ||
    primary.root !== contract.identifier ||
    !isImmediatelyFollowedBy(
      program,
      primary.declaration,
      auxiliary.declaration,
    )
  ) {
    return null;
  }

  const matches = program.body.flatMap(
    (statement): readonly MergeCandidate[] => {
      if (statement.type !== 'FunctionDeclaration' || statement.id === null) {
        return [];
      }

      const traversal = matchExactMergeTraversal(statement);
      if (traversal === null) return [];

      const initialCall = findMergeCall(program, statement, primary, auxiliary);
      if (
        initialCall === null ||
        initialCall.start < auxiliary.declaration.end ||
        hasUnsafeMergeRootUsage(program, primary, auxiliary, initialCall)
      ) {
        return [];
      }

      return [
        {
          primary,
          auxiliary,
          initialCall,
          returnLine: traversal.returnLine,
          assignments: traversal.assignments,
        },
      ];
    },
  );

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

function isImmediatelyFollowedBy(
  program: Program,
  first: VariableDeclaration,
  second: VariableDeclaration,
): boolean {
  const firstIndex = program.body.indexOf(first);
  if (firstIndex < 0) return false;

  const nextMeaningful = program.body
    .slice(firstIndex + 1)
    .find((statement) => !isIgnoredTopLevelStatement(statement));
  return nextMeaningful === second;
}

function isIgnoredTopLevelStatement(node: AnyNode): boolean {
  return (
    node.type === 'EmptyStatement' ||
    (node.type === 'ExpressionStatement' &&
      node.expression.type === 'Literal' &&
      typeof node.expression.value === 'string')
  );
}

function matchExactMergeTraversal(traversal: FunctionDeclaration): {
  readonly returnLine: number;
  readonly assignments: readonly MergeNextAssignment[];
} | null {
  if (
    traversal.async ||
    traversal.generator ||
    traversal.params.length !== 2 ||
    traversal.params[0]?.type !== 'Identifier' ||
    traversal.params[1]?.type !== 'Identifier' ||
    traversal.body.body.length !== 7
  ) {
    return null;
  }

  const [
    dummyDeclaration,
    tailDeclaration,
    leftDeclaration,
    rightDeclaration,
    loop,
    remainderStatement,
    returnStatement,
  ] = traversal.body.body;
  const dummy = matchDummyDeclaration(dummyDeclaration);
  if (dummy === null) return null;
  const tail = matchAliasDeclaration(tailDeclaration, 'let', dummy.name);
  const left = matchAliasDeclaration(
    leftDeclaration,
    'let',
    traversal.params[0].name,
  );
  const right = matchAliasDeclaration(
    rightDeclaration,
    'let',
    traversal.params[1].name,
  );
  if (tail === null || left === null || right === null) return null;

  if (
    loop?.type !== 'WhileStatement' ||
    loop.test.type !== 'LogicalExpression' ||
    loop.test.operator !== '&&' ||
    !isNotNullComparison(loop.test.left, left.name) ||
    !isNotNullComparison(loop.test.right, right.name) ||
    loop.body.type !== 'BlockStatement' ||
    loop.body.body.length !== 2
  ) {
    return null;
  }

  const [branch, advanceTail] = loop.body.body;
  if (
    branch?.type !== 'IfStatement' ||
    branch.test.type !== 'BinaryExpression' ||
    branch.test.operator !== '<=' ||
    !isDirectMember(branch.test.left, left.name, 'value') ||
    !isDirectMember(branch.test.right, right.name, 'value') ||
    branch.consequent.type !== 'BlockStatement' ||
    branch.consequent.body.length !== 2 ||
    branch.alternate?.type !== 'BlockStatement' ||
    branch.alternate.body.length !== 2 ||
    !isNextPointerAssignment(advanceTail, tail.name, tail.name)
  ) {
    return null;
  }

  const leftAssignment = matchMergeNextAssignment(
    branch.consequent.body[0],
    tail.name,
    left.name,
  );
  const rightAssignment = matchMergeNextAssignment(
    branch.alternate.body[0],
    tail.name,
    right.name,
  );
  if (
    leftAssignment === null ||
    rightAssignment === null ||
    !isNextPointerAssignment(branch.consequent.body[1], left.name, left.name) ||
    !isNextPointerAssignment(branch.alternate.body[1], right.name, right.name)
  ) {
    return null;
  }

  const remainderAssignment = matchMergeRemainderAssignment(
    remainderStatement,
    tail.name,
    left.name,
    right.name,
  );
  if (
    remainderAssignment === null ||
    returnStatement?.type !== 'ReturnStatement' ||
    returnStatement.argument == null ||
    !isDirectMember(returnStatement.argument, dummy.name, 'next')
  ) {
    return null;
  }
  const returnLine = sourceLine(returnStatement);
  if (returnLine === null) return null;

  return {
    returnLine,
    assignments: [leftAssignment, rightAssignment, remainderAssignment],
  };
}

function matchDummyDeclaration(node: AnyNode | undefined): Identifier | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== 'const' ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  if (
    declarator?.id.type !== 'Identifier' ||
    declarator.init?.type !== 'ObjectExpression' ||
    declarator.init.properties.length !== 2
  ) {
    return null;
  }

  const value = objectPropertyValue(declarator.init, 'value');
  const next = objectPropertyValue(declarator.init, 'next');
  return value?.type === 'Literal' &&
    value.value === 0 &&
    next?.type === 'Literal' &&
    next.value === null
    ? declarator.id
    : null;
}

function matchAliasDeclaration(
  node: AnyNode | undefined,
  kind: 'const' | 'let',
  source: string,
): Identifier | null {
  if (
    node?.type !== 'VariableDeclaration' ||
    node.kind !== kind ||
    node.declarations.length !== 1
  ) {
    return null;
  }

  const declarator = node.declarations[0];
  return declarator?.id.type === 'Identifier' &&
    declarator.init?.type === 'Identifier' &&
    declarator.init.name === source
    ? declarator.id
    : null;
}

function isNotNullComparison(node: AnyNode, identifier: string): boolean {
  return (
    node.type === 'BinaryExpression' &&
    node.operator === '!==' &&
    node.left.type === 'Identifier' &&
    node.left.name === identifier &&
    node.right.type === 'Literal' &&
    node.right.value === null
  );
}

function matchMergeNextAssignment(
  node: AnyNode | undefined,
  tail: string,
  next: string,
): MergeNextAssignment | null {
  if (
    node?.type !== 'ExpressionStatement' ||
    node.expression.type !== 'AssignmentExpression' ||
    node.expression.operator !== '=' ||
    !isDirectMember(node.expression.left, tail, 'next') ||
    node.expression.right.type !== 'Identifier' ||
    node.expression.right.name !== next
  ) {
    return null;
  }

  const line = sourceLine(node.expression);
  const tailNode = node.expression.left;
  if (
    tailNode.type !== 'MemberExpression' ||
    tailNode.object.type !== 'Identifier'
  ) {
    return null;
  }
  return line === null
    ? null
    : { statement: node, tail: tailNode.object, line };
}

function isNextPointerAssignment(
  node: AnyNode | undefined,
  target: string,
  source: string,
): boolean {
  return (
    node?.type === 'ExpressionStatement' &&
    node.expression.type === 'AssignmentExpression' &&
    node.expression.operator === '=' &&
    node.expression.left.type === 'Identifier' &&
    node.expression.left.name === target &&
    isDirectMember(node.expression.right, source, 'next')
  );
}

function matchMergeRemainderAssignment(
  node: AnyNode | undefined,
  tail: string,
  left: string,
  right: string,
): MergeNextAssignment | null {
  if (
    node?.type !== 'ExpressionStatement' ||
    node.expression.type !== 'AssignmentExpression' ||
    node.expression.operator !== '=' ||
    !isDirectMember(node.expression.left, tail, 'next') ||
    node.expression.right.type !== 'ConditionalExpression' ||
    node.expression.right.test.type !== 'BinaryExpression' ||
    node.expression.right.test.operator !== '===' ||
    node.expression.right.test.left.type !== 'Identifier' ||
    node.expression.right.test.left.name !== left ||
    node.expression.right.test.right.type !== 'Literal' ||
    node.expression.right.test.right.value !== null ||
    node.expression.right.consequent.type !== 'Identifier' ||
    node.expression.right.consequent.name !== right ||
    node.expression.right.alternate.type !== 'Identifier' ||
    node.expression.right.alternate.name !== left
  ) {
    return null;
  }

  const line = sourceLine(node.expression);
  const tailNode = node.expression.left;
  if (
    tailNode.type !== 'MemberExpression' ||
    tailNode.object.type !== 'Identifier'
  ) {
    return null;
  }
  return line === null
    ? null
    : { statement: node, tail: tailNode.object, line };
}

function findMergeCall(
  program: Program,
  traversal: FunctionDeclaration,
  primary: ListDeclaration,
  auxiliary: ListDeclaration,
): CallExpression | null {
  if (traversal.id === null) return null;

  const calls: CallExpression[] = [];
  let unsafeReference = false;
  walkAst(program, (node, parent, _grandparent, insideUnsupportedScope) => {
    if (node === traversal.id) return;

    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === traversal.id?.name
    ) {
      if (insideUnsupportedScope || node.optional) {
        unsafeReference = true;
      } else {
        calls.push(node);
      }
      return;
    }

    if (!isIdentifierReference(node, parent, traversal.id?.name ?? '')) return;
    if (parent?.type === 'CallExpression' && parent.callee === node) return;
    unsafeReference = true;
  });

  const match = calls[0];
  return !unsafeReference &&
    calls.length === 1 &&
    match !== undefined &&
    match.arguments.length === 2 &&
    match.arguments[0]?.type === 'Identifier' &&
    match.arguments[0].name === primary.root &&
    match.arguments[1]?.type === 'Identifier' &&
    match.arguments[1].name === auxiliary.root
    ? match
    : null;
}

function hasUnsafeMergeRootUsage(
  program: Program,
  primary: ListDeclaration,
  auxiliary: ListDeclaration,
  initialCall: CallExpression,
): boolean {
  const allowedReferences = new Set<AnyNode>();
  const references = [
    primary.declaration.declarations[0]?.id,
    auxiliary.declaration.declarations[0]?.id,
    initialCall.arguments[0],
    initialCall.arguments[1],
  ];
  for (const reference of references) {
    if (reference !== undefined) allowedReferences.add(reference);
  }
  let unsafe = false;

  walkAst(program, (node, parent) => {
    if (
      (isIdentifierReference(node, parent, primary.root) ||
        isIdentifierReference(node, parent, auxiliary.root)) &&
      !allowedReferences.has(node) &&
      !isDirectConsoleArgument(node, parent)
    ) {
      unsafe = true;
    }
  });

  return unsafe;
}
