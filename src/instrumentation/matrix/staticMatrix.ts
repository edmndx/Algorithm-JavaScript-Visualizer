import type { Program } from 'acorn';
import {
  binding,
  isSupportedInitialMatrix,
  sameStructure,
} from './matrixMatchers';

export function matchStaticMatrix(
  program: Program | null,
  grammar: Program | null,
) {
  if (!program || !grammar || program.body.length !== grammar.body.length)
    return null;
  const matrix = binding(program.body[0], 'const');
  const model = binding(grammar.body[0], 'const');
  if (!matrix || !model || !isSupportedInitialMatrix(matrix.init)) return null;
  const names = new Map([[model.name, matrix.name]]);
  const used = new Set([matrix.name]);
  for (let index = 1; index < grammar.body.length; index++) {
    if (!sameStructure(program.body[index], grammar.body[index], names, used))
      return null;
  }
  if (
    [...used].some((name) => ['Math', 'length', 'push', 'trace'].includes(name))
  )
    return null;
  return { matrix, names };
}
