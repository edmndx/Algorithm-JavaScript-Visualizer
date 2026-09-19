import type { AnyNode, FunctionDeclaration, Identifier, Program } from 'acorn';

import { createIdentifierAllocator, sourceLine, walkAst } from '../ast';
import { applySourceEdits, type SourceEdit } from '../edits';
import { findInitialCall, hasUnsafeListUsage } from './analyzeReversal';
import { linkedListTraceInitializationSource } from './linkedListTraceSource';
import type {
  ListDeclaration,
  ListVisit,
  ReadOnlyListCandidate,
  StaticListNode,
  StaticNextAssignment,
} from './linkedListTypes';

export function instrumentReadOnlyList(
  source: string,
  program: Program,
  declarations: readonly ListDeclaration[],
): string | null {
  const listDeclaration = declarations[0];
  if (declarations.length !== 1 || listDeclaration === undefined) return null;

  const { declaration, nodes } = listDeclaration;
  const declarator = declaration.declarations[0];
  const declarationLine = sourceLine(declaration);
  if (declarator?.id.type !== 'Identifier' || declarationLine === null) {
    return null;
  }
  const root = declarator.id.name;
  const assignments = findStaticNextAssignments(program, nodes);

  const candidates = program.body
    .filter(
      (statement): statement is FunctionDeclaration =>
        statement.type === 'FunctionDeclaration' && statement.id !== null,
    )
    .flatMap((traversal): readonly ReadOnlyListCandidate[] => {
      if (
        traversal.params.length !== 1 ||
        traversal.params[0]?.type !== 'Identifier'
      ) {
        return [];
      }

      const initialCall = findInitialCall(program, traversal, root);
      if (
        initialCall === null ||
        hasUnsafeListUsage(
          program,
          declaration,
          traversal,
          initialCall.call,
          initialCall.result,
          root,
          assignments,
        )
      ) {
        return [];
      }

      const pointerNames = traversalPointerNames(traversal);
      const visits: ListVisit[] = [];
      walkAst(traversal.body, (node, parent, _grandparent, unsupported) => {
        if (unsupported) return;
        const visit = matchListVisit(node, parent, pointerNames);
        if (visit !== null) visits.push(visit);
      });

      return visits.length === 0
        ? []
        : [{ ...listDeclaration, assignments, visits }];
    });
  const candidate = candidates[0];
  if (candidates.length !== 1 || candidate === undefined) return null;

  const allocate = createIdentifierAllocator(program, '__traceList');
  const nodeIds = allocate();
  const lastNode = candidate.nodes.at(-1);
  if (lastNode === undefined) return null;

  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text: linkedListTraceInitializationSource(
        nodeIds,
        candidate.nodes,
        lastNode.id,
        declarationLine,
      ),
    },
    ...candidate.assignments.map(({ statement, nodeId, nextId, line }) => ({
      start: statement.end,
      end: statement.end,
      text: `;\ntrace.setNext({ nodeId: ${JSON.stringify(nodeId)}, nextId: ${JSON.stringify(nextId)}, source: { line: ${line} } });`,
    })),
    ...candidate.visits.map(({ statement, target, line }) => ({
      start: statement.end,
      end: statement.end,
      text: `;\nif (${target.name} !== null) trace.visit({ nodeId: ${nodeIds}.get(${target.name}), source: { line: ${line} } });`,
    })),
  ];

  return applySourceEdits(source, edits);
}

function findStaticNextAssignments(
  program: Program,
  nodes: readonly StaticListNode[],
): readonly StaticNextAssignment[] {
  const nodeByAccess = new Map(nodes.map((node) => [node.access, node]));
  const assignments: StaticNextAssignment[] = [];

  walkAst(program, (node, parent, _grandparent, unsupported) => {
    if (
      unsupported ||
      node.type !== 'AssignmentExpression' ||
      node.operator !== '=' ||
      parent?.type !== 'ExpressionStatement' ||
      node.left.type !== 'MemberExpression' ||
      node.left.computed ||
      node.left.property.type !== 'Identifier' ||
      node.left.property.name !== 'next'
    ) {
      return;
    }

    const target = nodeByAccess.get(staticListAccess(node.left.object) ?? '');
    const line = sourceLine(node);
    if (target === undefined || line === null) return;

    if (node.right.type === 'Literal' && node.right.value === null) {
      assignments.push({
        assignment: node,
        statement: parent,
        nodeId: target.id,
        nextId: null,
        line,
      });
      return;
    }

    const next = nodeByAccess.get(staticListAccess(node.right) ?? '');
    if (next !== undefined) {
      assignments.push({
        assignment: node,
        statement: parent,
        nodeId: target.id,
        nextId: next.id,
        line,
      });
    }
  });

  return assignments;
}

function staticListAccess(node: AnyNode): string | null {
  if (node.type === 'Identifier') return node.name;
  if (
    node.type !== 'MemberExpression' ||
    node.computed ||
    node.optional ||
    node.property.type !== 'Identifier'
  ) {
    return null;
  }

  const object = staticListAccess(node.object);
  return object === null ? null : `${object}.${node.property.name}`;
}

function matchListVisit(
  node: AnyNode,
  parent: AnyNode | null,
  pointerNames: ReadonlySet<string>,
): ListVisit | null {
  if (
    node.type !== 'AssignmentExpression' ||
    node.operator !== '=' ||
    node.left.type !== 'Identifier' ||
    !pointerNames.has(node.left.name) ||
    parent?.type !== 'ExpressionStatement' ||
    nextChainRoot(node.right)?.name !== node.left.name
  ) {
    return null;
  }

  const line = sourceLine(node);
  return line === null ? null : { statement: parent, target: node.left, line };
}

function traversalPointerNames(
  traversal: FunctionDeclaration,
): ReadonlySet<string> {
  const parameter = traversal.params[0];
  if (parameter?.type !== 'Identifier') return new Set();

  const names = new Set([parameter.name]);
  for (const statement of traversal.body.body) {
    if (statement.type !== 'VariableDeclaration') continue;

    for (const declarator of statement.declarations) {
      if (
        declarator.id.type === 'Identifier' &&
        declarator.init?.type === 'Identifier' &&
        names.has(declarator.init.name)
      ) {
        names.add(declarator.id.name);
      }
    }
  }

  return names;
}

function nextChainRoot(node: AnyNode): Identifier | null {
  if (
    node.type !== 'MemberExpression' ||
    node.computed ||
    node.optional ||
    node.property.type !== 'Identifier' ||
    node.property.name !== 'next'
  ) {
    return null;
  }

  if (node.object.type === 'Identifier') return node.object;
  return nextChainRoot(node.object);
}
