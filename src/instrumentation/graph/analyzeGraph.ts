import type { AnyNode, VariableDeclaration } from 'acorn';

import {
  isIdentifierReference,
  isRootWrite,
  sourceLine,
  walkAst,
} from '../ast';
import {
  hasSafePrimaryRootUsage,
  primaryOperationBindings,
  type ValidVisualizationSource,
} from '../sourceContract';
import type { GraphCandidate, GraphTraversal } from './graphTypes';
import { findBreadthFirstTraversal } from './matchBreadthFirst';
import { findKahnTraversal } from './matchKahn';
import type { StaticGraphNode } from './staticGraph';

export function analyzeGraph(
  contract: ValidVisualizationSource,
  declaration: VariableDeclaration,
  nodes: readonly StaticGraphNode[],
): GraphCandidate | null {
  const declarator = declaration.declarations[0];
  const declarationLine = sourceLine(declaration);
  if (declarator?.id.type !== 'Identifier' || declarationLine === null) {
    return null;
  }

  const candidates = primaryOperationBindings(contract).flatMap((binding) => {
    const traversal =
      findBreadthFirstTraversal(
        binding,
        declaration,
        new Set(nodes.map(({ id }) => id)),
      ) ?? findKahnTraversal(binding);
    return traversal !== null &&
      hasSafePrimaryRootUsage(contract, binding) &&
      !hasUnsafeGraphUsage(
        binding.scope.body,
        declaration,
        traversal,
        binding.root,
      )
      ? [traversal]
      : [];
  });
  const traversal = candidates[0];
  if (candidates.length !== 1 || traversal === undefined) return null;

  return { declaration, declarationLine, nodes, traversal };
}

function hasUnsafeGraphUsage(
  rootNode: AnyNode,
  declaration: VariableDeclaration,
  traversal: GraphTraversal,
  root: string,
): boolean {
  let unsafe = false;
  const allowedRootReferences = new Set<AnyNode>(traversal.rootReferences);

  walkAst(rootNode, (node, parent) => {
    if (isRootWrite(node, root)) {
      unsafe = true;
      return;
    }
    if (!isIdentifierReference(node, parent, root)) return;

    const isDeclaration = node === declaration.declarations[0]?.id;
    const isTraversalAccess = allowedRootReferences.has(node);

    if (!isDeclaration && !isTraversalAccess) unsafe = true;
  });

  return unsafe;
}
