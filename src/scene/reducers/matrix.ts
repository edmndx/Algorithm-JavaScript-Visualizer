import type { TraceCommand } from '../../protocol/traceTypes';
import { SceneReducerError } from '../sceneReducerError';
import type { MatrixSceneState, SceneState } from '../sceneState';

type MatrixCommand = Extract<
  TraceCommand,
  {
    readonly type:
      | 'matrix.create'
      | 'matrix.compare'
      | 'matrix.swap'
      | 'matrix.set'
      | 'matrix.mark';
  }
>;

export function reduceMatrix(
  scene: SceneState,
  command: MatrixCommand,
): MatrixSceneState {
  if (scene.structure === null) {
    throw new SceneReducerError(
      'STRUCTURE_NOT_INITIALIZED',
      `Cannot apply "${command.type}" before scene.init.`,
    );
  }

  if (scene.structure !== 'matrix') {
    throw new SceneReducerError(
      'STRUCTURE_MISMATCH',
      `Cannot apply "${command.type}" to a "${scene.structure}" scene.`,
    );
  }

  switch (command.type) {
    case 'matrix.create':
      return {
        ...scene,
        values: cloneMatrix(command.values),
        itemIds: createMatrixItemIds(command.values),
        comparedPositions: null,
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

    case 'matrix.swap': {
      const [firstPosition, secondPosition] = command.positions;

      assertMatrixPosition(
        scene.values,
        firstPosition.row,
        firstPosition.column,
        command.type,
      );
      assertMatrixPosition(
        scene.values,
        secondPosition.row,
        secondPosition.column,
        command.type,
      );

      const values = cloneMatrix(scene.values);
      const itemIds = cloneMatrix(scene.itemIds);
      const firstRow = values[firstPosition.row];
      const secondRow = values[secondPosition.row];
      const firstIdRow = itemIds[firstPosition.row];
      const secondIdRow = itemIds[secondPosition.row];

      if (
        firstRow === undefined ||
        secondRow === undefined ||
        firstIdRow === undefined ||
        secondIdRow === undefined
      ) {
        throw new SceneReducerError(
          'INDEX_OUT_OF_BOUNDS',
          `Cannot apply ${command.type} to the requested matrix positions.`,
        );
      }

      const firstValue = firstRow[firstPosition.column];
      const secondValue = secondRow[secondPosition.column];
      const firstItemId = firstIdRow[firstPosition.column];
      const secondItemId = secondIdRow[secondPosition.column];

      if (
        firstValue === undefined ||
        secondValue === undefined ||
        firstItemId === undefined ||
        secondItemId === undefined
      ) {
        throw new SceneReducerError(
          'INDEX_OUT_OF_BOUNDS',
          `Cannot apply ${command.type} to the requested matrix positions.`,
        );
      }

      firstRow[firstPosition.column] = secondValue;
      secondRow[secondPosition.column] = firstValue;
      firstIdRow[firstPosition.column] = secondItemId;
      secondIdRow[secondPosition.column] = firstItemId;

      return { ...scene, values, itemIds };
    }

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

function assertNever(value: never): never {
  throw new Error(`Unhandled protocol value: ${JSON.stringify(value)}`);
}
