import type { ObjectExpression, Program } from 'acorn';

import { objectPropertyValue, sourceLine, staticTraceValue } from '../ast';
import type { ListDeclaration, StaticListNode } from './linkedListTypes';

export function findAllListDeclarations(program: Program): ListDeclaration[] {
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
