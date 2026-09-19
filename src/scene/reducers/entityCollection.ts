import { SceneReducerError } from '../sceneReducerError';

export function updateEntityById<Entity extends { readonly id: string }>(
  entities: readonly Entity[],
  id: string,
  update: (entity: Entity) => Entity,
  entityName: string,
): readonly Entity[] {
  let found = false;
  const updated = entities.map((entity) => {
    if (entity.id !== id) return entity;
    found = true;
    return update(entity);
  });

  if (!found) {
    throw new SceneReducerError(
      'ENTITY_NOT_FOUND',
      `${entityName} "${id}" does not exist.`,
    );
  }

  return updated;
}

export function requireEntity(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) throw new SceneReducerError('ENTITY_NOT_FOUND', message);
}

export function appendUnique<T>(values: readonly T[], value: T): readonly T[] {
  return values.includes(value) ? values : [...values, value];
}

export function removeIdFromMarkers(
  markers: Readonly<Record<string, readonly string[]>>,
  id: string,
): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(
    Object.entries(markers).map(([marker, ids]) => [
      marker,
      ids.filter((currentId) => currentId !== id),
    ]),
  );
}
