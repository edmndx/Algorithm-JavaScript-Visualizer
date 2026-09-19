import type { AnyNode, Identifier, VariableDeclaration } from 'acorn';

import type { StaticGraphNode } from './staticGraph';

export type GraphTraversal = {
  readonly node: Identifier;
  readonly nodeVisitPoint: AnyNode;
  readonly nodeVisitLine: number;
  readonly neighbor: Identifier;
  readonly edgeVisitPoint: AnyNode;
  readonly edgeVisitLine: number;
  readonly rootReferences: readonly Identifier[];
};

export type GraphCandidate = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly nodes: readonly StaticGraphNode[];
  readonly traversal: GraphTraversal;
};
