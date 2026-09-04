import {
  type AnyNode,
  type AssignmentExpression,
  type CallExpression,
  type ExpressionStatement,
  type FunctionDeclaration,
  type Identifier,
  type ObjectExpression,
  type Program,
  type VariableDeclaration,
} from 'acorn';

import {
  createIdentifierAllocator,
  hasUnsafeInstrumentationSyntax,
  isDirectConsoleArgument,
  isIdentifierReference,
  isMemberRootedAt,
  isRootWrite,
  objectPropertyValue,
  sourceLine,
  staticTraceValue,
  walkAst,
} from './ast';
import { applySourceEdits, type SourceEdit } from './edits';
import type { ValidVisualizationSource } from './sourceContract';

type StaticListNode = {
  readonly id: string;
  readonly access: string;
  readonly value: string | number;
  readonly nextId: string | null;
};

type NextAssignment = {
  readonly assignment: AssignmentExpression;
  readonly statement: ExpressionStatement;
  readonly node: Identifier;
  readonly next: Identifier | null;
  readonly line: number;
};

type InitialCall = {
  readonly call: CallExpression;
  readonly line: number;
  readonly result: Identifier | null;
};

type ListCandidate = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly root: string;
  readonly nodes: readonly StaticListNode[];
  readonly initialCall: InitialCall;
  readonly assignments: readonly NextAssignment[];
};

type ListDeclaration = {
  readonly declaration: VariableDeclaration;
  readonly declarationLine: number;
  readonly root: string;
  readonly nodes: readonly StaticListNode[];
};

type MergeNextAssignment = {
  readonly statement: ExpressionStatement;
  readonly tail: Identifier;
  readonly line: number;
};

type MergeCandidate = {
  readonly primary: ListDeclaration;
  readonly auxiliary: ListDeclaration;
  readonly initialCall: CallExpression;
  readonly returnLine: number;
  readonly assignments: readonly MergeNextAssignment[];
};

type ListVisit = {
  readonly statement: ExpressionStatement;
  readonly target: Identifier;
  readonly line: number;
};

type StaticNextAssignment = {
  readonly assignment: AssignmentExpression;
  readonly statement: ExpressionStatement;
  readonly nodeId: string;
  readonly nextId: string | null;
  readonly line: number;
};

type ReadOnlyListCandidate = ListDeclaration & {
  readonly assignments: readonly StaticNextAssignment[];
  readonly visits: readonly ListVisit[];
};

export function instrumentLinkedList(
  source: string,
  program: Program,
  contract: ValidVisualizationSource,
): string | null {
  if (hasUnsafeInstrumentationSyntax(program)) return null;

  const mergeDeclarations = findAllListDeclarations(program);
  if (mergeDeclarations.length > 1) {
    const merge = analyzeMerge(program, contract, mergeDeclarations);
    return merge === null ? null : instrumentMerge(source, program, merge);
  }

  const declarations = findListDeclarations(program, contract.identifier);
  const candidates = declarations
    .map(({ declaration, nodes }) => analyzeList(program, declaration, nodes))
    .filter((candidate): candidate is ListCandidate => candidate !== null);

  if (candidates.length === 0) {
    return instrumentReadOnlyList(source, program, declarations);
  }
  if (candidates.length !== 1) return null;

  const [candidate] = candidates;
  if (candidate === undefined) return null;

  const allocate = createIdentifierAllocator(program, '__traceList');
  const nodeIds = allocate();
  const finalize = allocate();
  const lastNode = candidate.nodes.at(-1);
  if (lastNode === undefined) return null;

  const weakMapEntries = candidate.nodes
    .map(({ access, id }) => `[${access}, ${JSON.stringify(id)}]`)
    .join(', ');
  const traceNodes = candidate.nodes
    .map(
      ({ id, value, nextId }) =>
        `{ id: ${JSON.stringify(id)}, value: ${JSON.stringify(value)}, nextId: ${JSON.stringify(nextId)} }`,
    )
    .join(', ');
  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text:
        `;\ntrace.initialize({ structure: 'linked-list', source: { line: ${candidate.declarationLine} } });\n` +
        `const ${nodeIds} = new WeakMap([${weakMapEntries}]);\n` +
        `trace.createLinkedList({ kind: 'singly', headId: ${JSON.stringify(candidate.nodes[0]?.id)}, tailId: ${JSON.stringify(lastNode.id)}, nodes: [${traceNodes}], source: { line: ${candidate.declarationLine} } });\n` +
        `const ${finalize} = (head, line) => { trace.setHead({ nodeId: ${nodeIds}.get(head), source: { line } }); trace.setTail({ nodeId: ${nodeIds}.get(${candidate.root}), source: { line } }); return head; };\n`,
    },
    ...candidate.assignments.map(({ statement, node, next, line }) => ({
      start: statement.end,
      end: statement.end,
      text: `\ntrace.setNext({ nodeId: ${nodeIds}.get(${node.name}), nextId: ${next === null ? 'null' : `${next.name} === null ? null : ${nodeIds}.get(${next.name})`}, source: { line: ${line} } });`,
    })),
    {
      start: candidate.initialCall.call.start,
      end: candidate.initialCall.call.end,
      text: `${finalize}(${source.slice(candidate.initialCall.call.start, candidate.initialCall.call.end)}, ${candidate.initialCall.line})`,
    },
  ];

  return applySourceEdits(source, edits);
}

function instrumentMerge(
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

  const weakMapEntries = nodes
    .map(({ access, id }) => `[${access}, ${JSON.stringify(id)}]`)
    .join(', ');
  const traceNodes = nodes
    .map(
      ({ id, value, nextId }) =>
        `{ id: ${JSON.stringify(id)}, value: ${JSON.stringify(value)}, nextId: ${JSON.stringify(nextId)} }`,
    )
    .join(', ');
  const edits: SourceEdit[] = [
    {
      start: candidate.auxiliary.declaration.end,
      end: candidate.auxiliary.declaration.end,
      text:
        `;\ntrace.initialize({ structure: 'linked-list', source: { line: ${candidate.primary.declarationLine} } });\n` +
        `const ${nodeIds} = new WeakMap([${weakMapEntries}]);\n` +
        `trace.createLinkedList({ kind: 'singly', headId: ${JSON.stringify(candidate.primary.nodes[0]?.id)}, tailId: ${JSON.stringify(primaryTail.id)}, nodes: [${traceNodes}], source: { line: ${candidate.primary.declarationLine} } });\n` +
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

function instrumentReadOnlyList(
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

  const weakMapEntries = candidate.nodes
    .map(({ access, id }) => `[${access}, ${JSON.stringify(id)}]`)
    .join(', ');
  const traceNodes = candidate.nodes
    .map(
      ({ id, value, nextId }) =>
        `{ id: ${JSON.stringify(id)}, value: ${JSON.stringify(value)}, nextId: ${JSON.stringify(nextId)} }`,
    )
    .join(', ');
  const edits: SourceEdit[] = [
    {
      start: candidate.declaration.end,
      end: candidate.declaration.end,
      text:
        `;\ntrace.initialize({ structure: 'linked-list', source: { line: ${declarationLine} } });\n` +
        `const ${nodeIds} = new WeakMap([${weakMapEntries}]);\n` +
        `trace.createLinkedList({ kind: 'singly', headId: ${JSON.stringify(candidate.nodes[0]?.id)}, tailId: ${JSON.stringify(lastNode.id)}, nodes: [${traceNodes}], source: { line: ${declarationLine} } });\n`,
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

function findListDeclarations(
  program: Program,
  identifier: string,
): ListDeclaration[] {
  return program.body.flatMap((statement) => {
    if (
      statement.type !== 'VariableDeclaration' ||
      statement.kind !== 'const' ||
      statement.declarations.length !== 1
    ) {
      return [];
    }

    const declarator = statement.declarations[0];
    if (
      declarator?.id.type !== 'Identifier' ||
      declarator.id.name !== identifier ||
      declarator.init?.type !== 'ObjectExpression'
    ) {
      return [];
    }

    const nodes = readStaticList(declarator.init, declarator.id.name);
    const declarationLine = sourceLine(statement);
    return nodes === null || declarationLine === null
      ? []
      : [
          {
            declaration: statement,
            declarationLine,
            root: declarator.id.name,
            nodes,
          },
        ];
  });
}

function findAllListDeclarations(program: Program): ListDeclaration[] {
  const declarations: ListDeclaration[] = [];
  let nodeIndex = 0;

  for (const statement of program.body) {
    if (
      statement.type !== 'VariableDeclaration' ||
      statement.kind !== 'const' ||
      statement.declarations.length !== 1
    ) {
      continue;
    }

    const declarator = statement.declarations[0];
    if (
      declarator?.id.type !== 'Identifier' ||
      declarator.init?.type !== 'ObjectExpression'
    ) {
      continue;
    }

    const nodes = readStaticList(
      declarator.init,
      declarator.id.name,
      nodeIndex,
    );
    const declarationLine = sourceLine(statement);
    if (nodes === null || declarationLine === null) continue;

    declarations.push({
      declaration: statement,
      declarationLine,
      root: declarator.id.name,
      nodes,
    });
    nodeIndex += nodes.length;
  }

  return declarations;
}

function readStaticList(
  expression: ObjectExpression,
  access: string,
  index = 0,
): StaticListNode[] | null {
  if (expression.properties.length !== 2) return null;

  const value = objectPropertyValue(expression, 'value');
  const next = objectPropertyValue(expression, 'next');
  if (value === null || next === null) return null;

  const staticValue = staticTraceValue(value);
  if (staticValue === null) return null;

  const id = `node-${index}`;
  if (next.type === 'Literal' && next.value === null) {
    return [{ id, access, value: staticValue, nextId: null }];
  }
  if (next.type !== 'ObjectExpression') return null;

  const following = readStaticList(next, `${access}.next`, index + 1);
  return following === null
    ? null
    : [
        { id, access, value: staticValue, nextId: following[0]?.id ?? null },
        ...following,
      ];
}

function analyzeMerge(
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

function isDirectMember(
  node: AnyNode,
  object: string,
  property: string,
): boolean {
  return (
    node.type === 'MemberExpression' &&
    !node.computed &&
    !node.optional &&
    node.object.type === 'Identifier' &&
    node.object.name === object &&
    node.property.type === 'Identifier' &&
    node.property.name === property
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

function analyzeList(
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

function findInitialCall(
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

function hasUnsafeListUsage(
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
