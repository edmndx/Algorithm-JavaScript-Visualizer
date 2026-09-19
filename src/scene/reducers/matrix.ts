import type { TraceCommand } from '../../protocol/traceTypes';
import {
  assertNever,
  assertSceneStructure,
  SceneReducerError,
} from '../sceneReducerError';
import type { MatrixSceneState, SceneState } from '../sceneState';

type MatrixCommand = Extract<
  TraceCommand,
  {
    readonly type:
      | 'matrix.create'
      | 'matrix.compare'
      | 'matrix.set'
      | 'matrix.mark'
      | 'matrix.visit';
  }
>;

export function reduceMatrix(
  scene: SceneState,
  command: MatrixCommand,
): MatrixSceneState {
  assertSceneStructure(scene, 'matrix', command.type);

  switch (command.type) {
    case 'matrix.create':
      return {
        ...scene,
        values: cloneMatrix(command.values),
        ...(command.rowLabels === undefined
          ? {}
          : { rowLabels: [...command.rowLabels] }),
        ...(command.columnLabels === undefined
          ? {}
          : { columnLabels: [...command.columnLabels] }),
        itemIds: createMatrixItemIds(command.values),
        comparedPositions: null,
        visitedPositions: [],
        markers: {},
      };

    case 'matrix.compare':
      return {
        ...scene,
        comparedPositions: [
          { ...command.positions[0] },
          { ...command.positions[1] },
        ],
      };

    case 'matrix.visit':
      assertMatrixPosition(
        scene.values,
        command.position.row,
        command.position.column,
        command.type,
      );
      return {
        ...scene,
        visitedPositions: scene.visitedPositions.some(
          (position) =>
            position.row === command.position.row &&
            position.column === command.position.column,
        )
          ? scene.visitedPositions
          : [...scene.visitedPositions, { ...command.position }],
      };

    case 'matrix.set': {
      assertMatrixPosition(
        scene.values,
        command.position.row,
        command.position.column,
        command.type,
      );

      const values = cloneMatrix(scene.values);
      const row = values[command.position.row];

      if (row === undefined) {
        throw new SceneReducerError(
          'INDEX_OUT_OF_BOUNDS',
          `Cannot apply ${command.type} to the requested matrix position.`,
        );
      }

      row[command.position.column] = command.value;
      return { ...scene, values };
    }

    case 'matrix.mark':
      return {
        ...scene,
        markers: {
          ...scene.markers,
          [command.marker]: command.positions.map((position) => ({
            ...position,
          })),
        },
      };

    default:
      return assertNever(command);
  }
}

function cloneMatrix<Value>(values: readonly (readonly Value[])[]): Value[][] {
  return values.map((row) => [...row]);
}

function assertMatrixPosition(
  matrix: readonly (readonly unknown[])[],
  row: number,
  column: number,
  commandType: TraceCommand['type'],
): void {
  const matrixRow = matrix[row];

  if (matrixRow === undefined || column >= matrixRow.length) {
    throw new SceneReducerError(
      'INDEX_OUT_OF_BOUNDS',
      `Command "${commandType}" references matrix position (${row}, ${column}) outside the current matrix.`,
    );
  }
}

function createMatrixItemIds(
  values: readonly (readonly unknown[])[],
): readonly (readonly string[])[] {
  let itemIndex = 0;
  return values.map((row) =>
    row.map(() => {
      const id = `matrix-item-${itemIndex}`;
      itemIndex += 1;
      return id;
    }),
  );
}
