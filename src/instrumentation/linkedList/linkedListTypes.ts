import type {
  AssignmentExpression,
  CallExpression,
  ExpressionStatement,
  Identifier,
  VariableDeclaration,
} from 'acorn';

export type StaticListNode = {
  readonly id: string;
  readonly access: string;
  readonly value: string | number;
  readonly nextId: string | null;
};

export type NextAssignment = {
  readonly assignment: AssignmentExpression;
  readonly statement: ExpressionStatement;
  readonly node: Identifier;
  readonly next: Identifier | null;
  readonly line: number;
};

export type InitialCall = {
  readonly call: CallExpression;
  readonly line: number;
  readonly result: Identifier | null;
};

export type ListCandidate = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly root: string;
  readonly nodes: readonly StaticListNode[];
  readonly initialCall: InitialCall;
  readonly assignments: readonly NextAssignment[];
};

export type ListDeclaration = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly root: string;
  readonly nodes: readonly StaticListNode[];
};

export type MergeNextAssignment = {
  readonly statement: ExpressionStatement;
  readonly tail: Identifier;
  readonly line: number;
};

export type MergeCandidate = {
  readonly primary: ListDeclaration;
  readonly auxiliary: ListDeclaration;
  readonly initialCall: CallExpression;
  readonly returnLine: number;
  readonly assignments: readonly MergeNextAssignment[];
};

export type ListVisit = {
  readonly statement: ExpressionStatement;
  readonly target: Identifier;
  readonly line: number;
};

export type StaticNextAssignment = {
  readonly assignment: AssignmentExpression;
  readonly statement: ExpressionStatement;
  readonly nodeId: string;
  readonly nextId: string | null;
  readonly line: number;
};

export type ReadOnlyListCandidate = ListDeclaration & {
  readonly assignments: readonly StaticNextAssignment[];
  readonly visits: readonly ListVisit[];
};
