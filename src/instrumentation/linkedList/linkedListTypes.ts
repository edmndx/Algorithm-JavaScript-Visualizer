import type { VariableDeclaration } from 'acorn';

export type StaticListNode = {
  readonly id: string;
  readonly access: string;
  readonly value: string | number;
  readonly nextId: string | null;
};

export type ListDeclaration = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly root: string;
  readonly nodes: readonly StaticListNode[];
};
