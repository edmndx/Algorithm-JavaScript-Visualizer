import type {
  AnyNode,
  CallExpression,
  Identifier,
  VariableDeclaration,
} from 'acorn';

import type { StaticTreeNode } from './staticTree';

export type TreeVisit = {
  readonly insertionPoint: AnyNode;
  readonly target: Identifier;
  readonly line: number;
};

export type TreeTraversal =
  | {
      readonly kind: 'visit';
      readonly initialCall: CallExpression;
      readonly visit: TreeVisit;
    }
  | {
      readonly kind: 'maximum-depth';
      readonly initialCall: CallExpression;
      readonly target: Identifier;
      readonly expression: AnyNode;
      readonly line: number;
    }
  | {
      readonly kind: 'bounds-check';
      readonly initialCall: CallExpression;
      readonly target: Identifier;
      readonly lower: Identifier;
      readonly upper: Identifier;
      readonly condition: AnyNode;
      readonly line: number;
    };

export type TreeCandidate = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly nodes: readonly StaticTreeNode[];
  readonly traversal: TreeTraversal;
};
