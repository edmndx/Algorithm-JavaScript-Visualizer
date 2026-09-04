import type {
  AnyNode,
  CallExpression,
  Expression,
  FunctionDeclaration,
  Identifier,
  Program,
  VariableDeclaration,
} from 'acorn';

import {
  directInstrumentationScopes,
  isCalledExactlyOnce,
  isDirectConsoleArgument,
  isIdentifierReference,
  parseJavaScript,
  walkAst,
  type DirectInstrumentationScope,
} from './ast';
import type { InstrumentableStructure } from './instrumentationTypes';

type SourceContractDefinition = {
  readonly identifier: string;
  readonly label: string;
  readonly example: string;
  readonly initializer: 'array' | 'matrix' | 'object' | 'map';
};

const SOURCE_CONTRACTS = {
  array: {
    identifier: 'array',
    label: 'Array',
    example: 'const array = [...]',
    initializer: 'array',
  },
  matrix: {
    identifier: 'matrix',
    label: 'Matrix',
    example: 'const matrix = [[...], [...]]',
    initializer: 'matrix',
  },
  tree: {
    identifier: 'tree',
    label: 'Tree',
    example: 'const tree = { value, left, right }',
    initializer: 'object',
  },
  stack: {
    identifier: 'stack',
    label: 'Stack',
    example: 'const stack = []',
    initializer: 'array',
  },
  queue: {
    identifier: 'queue',
    label: 'Queue',
    example: 'const queue = []',
    initializer: 'array',
  },
  graph: {
    identifier: 'graph',
    label: 'Graph',
    example: "const graph = { A: ['B'], B: [] }",
    initializer: 'object',
  },
  'linked-list': {
    identifier: 'linkedList',
    label: 'Linked List',
    example: 'const linkedList = { value: 1, next: null }',
    initializer: 'object',
  },
  'hash-table': {
    identifier: 'hashTable',
    label: 'Hash Table',
    example: 'const hashTable = new Map()',
    initializer: 'map',
  },
} as const satisfies Readonly<
  Record<InstrumentableStructure, SourceContractDefinition>
>;

export type SourceContractDiagnostic = {
  readonly code:
    | 'MISSING_PRIMARY_STRUCTURE'
    | 'PRIMARY_STRUCTURE_NOT_FIRST'
    | 'INVALID_PRIMARY_STRUCTURE';
  readonly message: string;
  readonly line: number;
  readonly startColumn: number;
  readonly endColumn: number;
};

export type ValidVisualizationSource = {
  readonly status: 'valid';
  readonly program: Program;
  readonly declaration: VariableDeclaration;
  readonly identifier: string;
};

export type PrimaryOperationBinding = {
  readonly scope: DirectInstrumentationScope;
  readonly root: string;
  readonly invocationArgument: Identifier | null;
};

export type VisualizationSourceValidation =
  | ValidVisualizationSource
  | { readonly status: 'syntax-error' }
  | {
      readonly status: 'invalid';
      readonly diagnostic: SourceContractDiagnostic;
    };

export function getPrimaryStructureIdentifier(
  structure: InstrumentableStructure,
): string {
  return SOURCE_CONTRACTS[structure].identifier;
}

export function getVisualizationSourceHint(
  structure: InstrumentableStructure,
): string {
  return `Primary structure: ${SOURCE_CONTRACTS[structure].example}`;
}

export function validateVisualizationSource(
  source: string,
  structure: InstrumentableStructure,
): VisualizationSourceValidation {
  const program = parseJavaScript(source);
  if (program === null) return { status: 'syntax-error' };

  const definition = SOURCE_CONTRACTS[structure];
  const firstStatement = program.body.find((statement) =>
    isMeaningfulStatement(statement),
  );
  const declarations = findNamedDeclarations(program, definition.identifier);
  const firstDeclaration = declarations[0];

  if (!isCanonicalDeclaration(firstStatement, definition.identifier)) {
    return {
      status: 'invalid',
      diagnostic: createDiagnostic(
        firstDeclaration === undefined
          ? 'MISSING_PRIMARY_STRUCTURE'
          : 'PRIMARY_STRUCTURE_NOT_FIRST',
        definition,
        firstDeclaration ?? firstStatement ?? program,
      ),
    };
  }

  const declarator = firstStatement.declarations[0];
  if (
    declarator === undefined ||
    declarations.length !== 1 ||
    !isSupportedInitializer(declarator.init, definition.initializer)
  ) {
    return {
      status: 'invalid',
      diagnostic: createDiagnostic(
        'INVALID_PRIMARY_STRUCTURE',
        definition,
        declarator?.id ?? firstStatement,
      ),
    };
  }

  return {
    status: 'valid',
    program,
    declaration: firstStatement,
    identifier: definition.identifier,
  };
}

export function primaryOperationBindings(
  contract: ValidVisualizationSource,
): readonly PrimaryOperationBinding[] {
  const programScope = directInstrumentationScopes(contract.program)[0];
  if (programScope === undefined) return [];

  const bindings: PrimaryOperationBinding[] = [
    {
      scope: programScope,
      root: contract.identifier,
      invocationArgument: null,
    },
  ];

  for (const statement of contract.program.body) {
    if (
      statement.type !== 'FunctionDeclaration' ||
      statement.id === null ||
      !isCalledExactlyOnce(contract.program, statement)
    ) {
      continue;
    }

    const call = findDirectFunctionCall(contract.program, statement);
    if (call === null) continue;

    const argumentIndex = call.arguments.findIndex(
      (argument) =>
        argument.type === 'Identifier' && argument.name === contract.identifier,
    );
    const parameter = statement.params[argumentIndex];
    const argument = call.arguments[argumentIndex];

    if (
      argumentIndex >= 0 &&
      parameter?.type === 'Identifier' &&
      argument?.type === 'Identifier'
    ) {
      bindings.push({
        scope: { body: statement.body, owner: statement },
        root: parameter.name,
        invocationArgument: argument,
      });
      continue;
    }

    if (functionDirectlyReferences(statement, contract.identifier)) {
      bindings.push({
        scope: { body: statement.body, owner: statement },
        root: contract.identifier,
        invocationArgument: null,
      });
    }
  }

  return bindings;
}

export function hasSafePrimaryRootUsage(
  contract: ValidVisualizationSource,
  binding: PrimaryOperationBinding,
): boolean {
  const declarator = contract.declaration.declarations[0];
  const declarationIdentifier =
    declarator?.id.type === 'Identifier' ? declarator.id : null;
  let safe = true;

  walkAst(
    contract.program,
    (node, parent, _grandparent, insideUnsupportedScope) => {
      if (!isIdentifierReference(node, parent, contract.identifier)) return;

      if (
        node === declarationIdentifier ||
        node === binding.invocationArgument ||
        isDirectConsoleArgument(node, parent)
      ) {
        return;
      }

      if (binding.scope.owner === null) {
        if (!insideUnsupportedScope) return;
      } else if (
        binding.root === contract.identifier &&
        node.start >= binding.scope.body.start &&
        node.end <= binding.scope.body.end
      ) {
        return;
      }

      safe = false;
    },
  );

  return safe;
}

function findDirectFunctionCall(
  program: Program,
  declaration: FunctionDeclaration,
): CallExpression | null {
  const name = declaration.id?.name;
  if (name === undefined) return null;

  const calls: CallExpression[] = [];
  walkAst(program, (node, _parent, _grandparent, insideUnsupportedScope) => {
    if (
      !insideUnsupportedScope &&
      node.type === 'CallExpression' &&
      !node.optional &&
      node.callee.type === 'Identifier' &&
      node.callee.name === name
    ) {
      calls.push(node);
    }
  });

  return calls.length === 1 ? (calls[0] ?? null) : null;
}

function functionDirectlyReferences(
  declaration: FunctionDeclaration,
  identifier: string,
): boolean {
  let found = false;
  walkAst(
    declaration.body,
    (node, parent, _grandparent, insideUnsupportedScope) => {
      if (
        !insideUnsupportedScope &&
        isIdentifierReference(node, parent, identifier)
      ) {
        found = true;
      }
    },
  );
  return found;
}

function isMeaningfulStatement(statement: AnyNode): boolean {
  return !(
    statement.type === 'EmptyStatement' ||
    (statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'Literal' &&
      typeof statement.expression.value === 'string')
  );
}

function isCanonicalDeclaration(
  statement: AnyNode | undefined,
  identifier: string,
): statement is VariableDeclaration {
  if (
    statement?.type !== 'VariableDeclaration' ||
    statement.kind !== 'const' ||
    statement.declarations.length !== 1
  ) {
    return false;
  }

  return (
    statement.declarations[0]?.id.type === 'Identifier' &&
    statement.declarations[0].id.name === identifier
  );
}

function findNamedDeclarations(
  program: Program,
  identifier: string,
): readonly VariableDeclaration[] {
  const declarations: VariableDeclaration[] = [];

  walkAst(program, (node, parent) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === identifier &&
      parent?.type === 'VariableDeclaration'
    ) {
      declarations.push(parent);
    }
  });

  return declarations;
}

function isSupportedInitializer(
  expression: Expression | null | undefined,
  initializer: SourceContractDefinition['initializer'],
): boolean {
  switch (initializer) {
    case 'array':
      return expression?.type === 'ArrayExpression';
    case 'matrix':
      return (
        expression?.type === 'ArrayExpression' &&
        expression.elements.length > 0 &&
        expression.elements.every(
          (element) => element?.type === 'ArrayExpression',
        )
      );
    case 'object':
      return expression?.type === 'ObjectExpression';
    case 'map':
      return (
        expression?.type === 'NewExpression' &&
        expression.callee.type === 'Identifier' &&
        expression.callee.name === 'Map'
      );
  }
}

function createDiagnostic(
  code: SourceContractDiagnostic['code'],
  definition: SourceContractDefinition,
  node: AnyNode,
): SourceContractDiagnostic {
  const position = node.loc?.start;
  const message =
    code === 'MISSING_PRIMARY_STRUCTURE'
      ? `${definition.label} visualization requires the primary structure to be named \`${definition.identifier}\`.\n\nExample:\n${definition.example};`
      : code === 'PRIMARY_STRUCTURE_NOT_FIRST'
        ? `${definition.label} visualization requires \`${definition.identifier}\` to be the first meaningful declaration.\n\nExample:\n${definition.example};`
        : `${definition.label} visualization requires a primary declaration shaped like:\n${definition.example};`;

  return {
    code,
    message,
    line: position?.line ?? 1,
    startColumn: (position?.column ?? 0) + 1,
    endColumn: (position?.column ?? 0) + definition.identifier.length + 1,
  };
}
