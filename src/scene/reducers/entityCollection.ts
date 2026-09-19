import { SceneReducerError } from '../sceneReducerError';

export function requireEntity(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) throw new SceneReducerError('ENTITY_NOT_FOUND', message);
}

export function appendUnique<T>(values: readonly T[], value: T): readonly T[] {
  return values.includes(value) ? values : [...values, value];
}
