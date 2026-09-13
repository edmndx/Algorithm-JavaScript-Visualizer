import type { TraceCommand, TraceStructure } from '../protocol/traceTypes';
import type { SceneState } from './sceneState';

export type SceneReducerErrorCode =
  | 'DUPLICATE_SCENE_INIT'
  | 'STRUCTURE_NOT_INITIALIZED'
  | 'STRUCTURE_MISMATCH'
  | 'ENTITY_NOT_FOUND'
  | 'INDEX_OUT_OF_BOUNDS'
  | 'STACK_UNDERFLOW'
  | 'QUEUE_UNDERFLOW';

export class SceneReducerError extends Error {
  readonly code: SceneReducerErrorCode;

  constructor(code: SceneReducerErrorCode, message: string) {
    super(message);

    this.name = 'SceneReducerError';
    this.code = code;
  }
}

export function assertSceneStructure<Structure extends TraceStructure>(
  scene: SceneState,
  structure: Structure,
  commandType: TraceCommand['type'],
): asserts scene is Extract<SceneState, { readonly structure: Structure }> {
  if (scene.structure === null) {
    throw new SceneReducerError(
      'STRUCTURE_NOT_INITIALIZED',
      `Cannot apply "${commandType}" before scene.init.`,
    );
  }

  if (scene.structure !== structure) {
    throw new SceneReducerError(
      'STRUCTURE_MISMATCH',
      `Cannot apply "${commandType}" to a "${scene.structure}" scene.`,
    );
  }
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled protocol value: ${JSON.stringify(value)}`);
}
