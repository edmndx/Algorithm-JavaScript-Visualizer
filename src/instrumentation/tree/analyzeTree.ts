import type { FunctionDeclaration, Program, VariableDeclaration } from 'acorn';

import {
  isIdentifierReference,
  isRootWrite,
  sourceLine,
  walkAst,
} from '../ast';
import { matchLevelOrderTraversal } from './matchLevelOrder';
import {
  matchBstValidationTraversal,
  matchDepthFirstTraversal,
  matchMaximumDepthTraversal,
} from './matchRecursiveTraversal';
import type { StaticTreeNode } from './staticTree';
import type { TreeCandidate, TreeTraversal } from './treeTypes';

export function analyzeTree(
  program: Program,
  declaration: VariableDeclaration,
  nodes: readonly StaticTreeNode[],
): TreeCandidate | null {
  const declarator = declaration.declarations[0];
  const declarationLine = sourceLine(declaration);
  if (declarator?.id.type !== 'Identifier' || declarationLine === null) {
    return null;
  }

  const root = declarator.id.name;
  const traversals = program.body
    .filter(
      (statement): statement is FunctionDeclaration =>
        statement.type === 'FunctionDeclaration' && statement.id !== null,
    )
    .flatMap((traversal) =>
      [
        matchDepthFirstTraversal(program, traversal, root),
        matchMaximumDepthTraversal(program, traversal, root),
        matchBstValidationTraversal(program, traversal, root),
        matchLevelOrderTraversal(program, traversal, root),
      ].filter((candidate): candidate is TreeTraversal => candidate !== null),
    );
  const traversal = traversals[0];

  if (
    traversals.length !== 1 ||
    traversal === undefined ||
    hasUnsafeTreeUsage(program, declaration, traversal, root)
  ) {
    return null;
  }

  return { declaration, declarationLine, nodes, traversal };
}

function hasUnsafeTreeUsage(
  program: Program,
  declaration: VariableDeclaration,
  traversal: TreeTraversal,
  root: string,
): boolean {
  const initialRoot = traversal.initialCall.arguments[0];
  let unsafe = false;

  walkAst(program, (node, parent) => {
    if (
      isRootWrite(node, root) ||
      (isIdentifierReference(node, parent, root) &&
        node !== declaration.declarations[0]?.id &&
        node !== initialRoot)
    ) {
      unsafe = true;
    }
  });

  return unsafe;
}
