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
