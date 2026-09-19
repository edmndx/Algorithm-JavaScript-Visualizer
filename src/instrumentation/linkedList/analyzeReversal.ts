import type {
  AnyNode,
  CallExpression,
  FunctionDeclaration,
  Program,
  VariableDeclaration,
} from 'acorn';

import {
  isIdentifierReference,
  isMemberRootedAt,
  isRootWrite,
  sourceLine,
  walkAst,
} from '../ast';
import type {
  InitialCall,
  ListCandidate,
  NextAssignment,
  StaticListNode,
  StaticNextAssignment,
} from './linkedListTypes';

export function analyzeList(
  program: Program,
  declaration: VariableDeclaration,
  nodes: readonly StaticListNode[],
): ListCandidate | null {
  const declarator = declaration.declarations[0];
  if (declarator?.id.type !== 'Identifier') return null;

  const root = declarator.id.name;
  const declarationLine = sourceLine(declaration);
  if (declarationLine === null) return null;

  const functions = program.body.filter(
    (statement): statement is FunctionDeclaration =>
      statement.type === 'FunctionDeclaration' && statement.id !== null,
  );

  const matches: Array<{
    readonly initial: InitialCall;
    readonly assignments: readonly NextAssignment[];
  }> = [];

  for (const traversal of functions) {
    const assignments: NextAssignment[] = [];
    walkAst(traversal.body, (node, parent, _grandparent, unsupported) => {
      if (unsupported) return;
      const assignment = matchNextAssignment(node, parent);
      if (assignment !== null) assignments.push(assignment);
    });

    if (assignments.length === 0) continue;

    const initial = findInitialCall(program, traversal, root);
    if (
      initial === null ||
      initial.call.start < declaration.end ||
      !isExactListReversal(traversal, assignments) ||
      hasUnsafeListUsage(
        program,
        declaration,
        traversal,
        initial.call,
        initial.result,
        root,
      )
    ) {
      continue;
    }

    matches.push({ initial, assignments });
  }

  const match = matches[0];
  return matches.length === 1 && match !== undefined
    ? {
        declaration,
        declarationLine,
        root,
        nodes,
        initialCall: match.initial,
        assignments: match.assignments,
      }
    : null;
}

function matchNextAssignment(
  node: AnyNode,
  parent: AnyNode | null,
): NextAssignment | null {
  if (
    node.type !== 'AssignmentExpression' ||
    node.operator !== '=' ||
    parent?.type !== 'ExpressionStatement' ||
    node.left.type !== 'MemberExpression' ||
    node.left.computed ||
    node.left.object.type !== 'Identifier' ||
    node.left.property.type !== 'Identifier' ||
    node.left.property.name !== 'next' ||
    !(
      node.right.type === 'Identifier' ||
      (node.right.type === 'Literal' && node.right.value === null)
    )
  ) {
    return null;
  }

  const line = sourceLine(node);
  return line === null
    ? null
    : {
        assignment: node,
        statement: parent,
        node: node.left.object,
        next: node.right.type === 'Identifier' ? node.right : null,
        line,
      };
}

export function findInitialCall(
  program: Program,
  traversal: FunctionDeclaration,
  root: string,
): InitialCall | null {
  if (traversal.id === null) return null;

  const traversalName = traversal.id.name;
  const calls: InitialCall[] = [];
  let unsafeReference = false;

  walkAst(program, (node, parent, grandparent, insideUnsupportedScope) => {
    const insideTraversal =
      node.start > traversal.start && node.end < traversal.end;

    if (
      !insideTraversal &&
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === traversalName
    ) {
      if (insideUnsupportedScope) {
        unsafeReference = true;
        return;
      }

      const line = sourceLine(node);
      if (line === null) {
        unsafeReference = true;
      } else {
        calls.push({
          call: node,
          line,
          result:
            parent?.type === 'VariableDeclarator' &&
            parent.init === node &&
            parent.id.type === 'Identifier' &&
            grandparent?.type === 'VariableDeclaration'
              ? parent.id
              : null,
        });
      }
      return;
    }

    if (
      insideTraversal ||
      !isIdentifierReference(node, parent, traversalName)
    ) {
      return;
    }

    if (insideUnsupportedScope) {
      unsafeReference = true;
      return;
    }

    if (parent?.type === 'CallExpression' && parent.callee === node) return;

    unsafeReference = true;
  });

  const match = calls[0];
  if (
    unsafeReference ||
    calls.length !== 1 ||
    match === undefined ||
    match.call.optional ||
    match.call.arguments.length !== 1 ||
    match.call.arguments[0]?.type !== 'Identifier' ||
    match.call.arguments[0].name !== root
  ) {
    return null;
  }

  return match;
}

function isExactListReversal(
  traversal: FunctionDeclaration,
  assignments: readonly NextAssignment[],
): boolean {
  if (
    traversal.async ||
    traversal.generator ||
    traversal.params.length !== 1 ||
    assignments.length !== 1 ||
    traversal.params[0]?.type !== 'Identifier' ||
    traversal.body.body.length !== 4
  ) {
    return false;
  }

  const [previousDeclaration, currentDeclaration, loop, returnStatement] =
    traversal.body.body;
  if (
    previousDeclaration?.type !== 'VariableDeclaration' ||
    previousDeclaration.kind !== 'let' ||
    previousDeclaration.declarations.length !== 1 ||
    previousDeclaration.declarations[0]?.id.type !== 'Identifier' ||
    previousDeclaration.declarations[0].init?.type !== 'Literal' ||
    previousDeclaration.declarations[0].init.value !== null ||
    currentDeclaration?.type !== 'VariableDeclaration' ||
    currentDeclaration.kind !== 'let' ||
    currentDeclaration.declarations.length !== 1 ||
    currentDeclaration.declarations[0]?.id.type !== 'Identifier' ||
    currentDeclaration.declarations[0].init?.type !== 'Identifier' ||
    currentDeclaration.declarations[0].init.name !== traversal.params[0].name ||
    loop?.type !== 'WhileStatement' ||
    loop.test.type !== 'BinaryExpression' ||
    loop.test.operator !== '!==' ||
    loop.test.left.type !== 'Identifier' ||
    loop.test.left.name !== currentDeclaration.declarations[0].id.name ||
    loop.test.right.type !== 'Literal' ||
    loop.test.right.value !== null ||
    loop.body.type !== 'BlockStatement' ||
    loop.body.body.length !== 4 ||
    returnStatement?.type !== 'ReturnStatement' ||
    returnStatement.argument?.type !== 'Identifier' ||
    returnStatement.argument.name !==
      previousDeclaration.declarations[0].id.name
  ) {
    return false;
  }

  const [nextDeclaration, nextAssignment, advancePrevious, advanceCurrent] =
    loop.body.body;
  const nextDeclarator =
    nextDeclaration?.type === 'VariableDeclaration' &&
    nextDeclaration.kind === 'const' &&
    nextDeclaration.declarations.length === 1
      ? nextDeclaration.declarations[0]
      : undefined;
  const mutation = assignments[0]?.assignment;
  const previousName = previousDeclaration.declarations[0].id.name;
  const currentName = currentDeclaration.declarations[0].id.name;

  return (
    nextDeclarator?.id.type === 'Identifier' &&
    nextDeclarator.init?.type === 'MemberExpression' &&
    !nextDeclarator.init.computed &&
    nextDeclarator.init.object.type === 'Identifier' &&
    nextDeclarator.init.object.name === currentName &&
    nextDeclarator.init.property.type === 'Identifier' &&
    nextDeclarator.init.property.name === 'next' &&
    nextAssignment?.type === 'ExpressionStatement' &&
    nextAssignment.expression === mutation &&
    mutation?.left.type === 'MemberExpression' &&
    mutation.left.object.type === 'Identifier' &&
    mutation.left.object.name === currentName &&
    mutation.right.type === 'Identifier' &&
    mutation.right.name === previousName &&
    isIdentifierAssignment(advancePrevious, previousName, currentName) &&
    isIdentifierAssignment(advanceCurrent, currentName, nextDeclarator.id.name)
  );
}

function isIdentifierAssignment(
  statement: AnyNode | undefined,
  target: string,
  value: string,
): boolean {
  return (
    statement?.type === 'ExpressionStatement' &&
    statement.expression.type === 'AssignmentExpression' &&
    statement.expression.operator === '=' &&
    statement.expression.left.type === 'Identifier' &&
    statement.expression.left.name === target &&
    statement.expression.right.type === 'Identifier' &&
    statement.expression.right.name === value
  );
}

export function hasUnsafeListUsage(
  program: Program,
  declaration: VariableDeclaration,
  traversal: FunctionDeclaration,
  initialCall: CallExpression,
  result: InitialCall['result'],
  root: string,
  supportedAssignments: readonly StaticNextAssignment[] = [],
): boolean {
  const initialRoot = initialCall.arguments[0];
  const supportedWrites = new Set<AnyNode>(
    supportedAssignments.map(({ assignment }) => assignment),
  );
  let unsafe = false;

  walkAst(program, (node, parent) => {
    const insideTraversal =
      node.start >= traversal.start && node.end <= traversal.end;
    if (
      (isIdentifierReference(node, parent, root) &&
        node !== declaration.declarations[0]?.id &&
        node !== initialRoot &&
        !supportedAssignments.some(
          ({ assignment }) =>
            node.start >= assignment.start && node.end <= assignment.end,
        )) ||
      isUnsafeResultUsage(node, parent, result) ||
      (!insideTraversal &&
        isRootWrite(node, root) &&
        !supportedWrites.has(node))
    ) {
      unsafe = true;
    }
  });

  return unsafe;
}

function isUnsafeResultUsage(
  node: AnyNode,
  parent: AnyNode | null,
  result: InitialCall['result'],
): boolean {
  if (result === null) return false;
  const resultName = result.name;

  if (
    (node.type === 'CallExpression' || node.type === 'NewExpression') &&
    isMemberRootedAt(node.callee, resultName)
  ) {
    return true;
  }

  if (node.type === 'MemberExpression' && isMemberRootedAt(node, resultName)) {
    if (node.computed || node.property.type !== 'Identifier') return true;
    if (node.property.name === 'next') {
      return !(parent?.type === 'MemberExpression' && parent.object === node);
    }
    if (node.property.name !== 'value') return true;

    return (
      (parent?.type === 'AssignmentExpression' && parent.left === node) ||
      (parent?.type === 'UpdateExpression' && parent.argument === node) ||
      (parent?.type === 'UnaryExpression' &&
        parent.operator === 'delete' &&
        parent.argument === node)
    );
  }

  if (!isIdentifierReference(node, parent, resultName) || node === result) {
    return false;
  }

  return !(
    parent?.type === 'MemberExpression' &&
    parent.object === node &&
    !parent.computed
  );
}
