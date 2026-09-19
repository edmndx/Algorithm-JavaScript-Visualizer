import type { TraceCommand } from '../traceTypes';
import {
  addIssue,
  addMissingCreateIssue,
  addUnexpectedCommandIssue,
} from './semanticIssues';
import type { TraceSemanticIssue } from './semanticTypes';

export function validateMatrixTrace(
  commands: readonly TraceCommand[],
  issues: TraceSemanticIssue[],
): void {
  const createCommand = commands[1];

  if (createCommand?.type !== 'matrix.create') {
    addMissingCreateIssue(issues, createCommand, 'matrix', 'matrix.create');

    return;
  }

  const rowCount = createCommand.values.length;
  const columnCount =
    createCommand.values.length > 0
      ? (createCommand.values[0]?.length ?? 0)
      : 0;

  if (
    (createCommand.rowLabels !== undefined &&
      createCommand.rowLabels.length !== rowCount) ||
    (createCommand.columnLabels !== undefined &&
      createCommand.columnLabels.length !== columnCount)
  ) {
    addIssue(
      issues,
      1,
      'MATRIX_AXIS_LABEL_COUNT_MISMATCH',
      'Matrix axis labels must match their dimensions.',
    );
  }

  for (const row of createCommand.values) {
    if (row.length !== columnCount) {
      addIssue(
        issues,
        1,
        'MATRIX_NOT_RECTANGULAR',
        'Matrix rows must all contain the same number of columns.',
      );

      break;
    }
  }

  for (
    let commandIndex = 2;
    commandIndex < commands.length;
    commandIndex += 1
  ) {
    const command = commands[commandIndex];

    if (command === undefined) {
      continue;
    }

    switch (command.type) {
      case 'matrix.compare':
      case 'matrix.mark':
        for (const position of command.positions) {
          validateMatrixPosition(
            position.row,
            position.column,
            rowCount,
            columnCount,
            commandIndex,
            issues,
          );
        }
        break;

      case 'matrix.set':
        validateMatrixPosition(
          command.position.row,
          command.position.column,
          rowCount,
          columnCount,
          commandIndex,
          issues,
        );
        break;

      case 'matrix.visit':
        validateMatrixPosition(
          command.position.row,
          command.position.column,
          rowCount,
          columnCount,
          commandIndex,
          issues,
        );
        break;

      default:
        addUnexpectedCommandIssue(
          command,
          commandIndex,
          'matrix',
          'matrix.create',
          issues,
        );
    }
  }
}

function validateMatrixPosition(
  row: number,
  column: number,
  rowCount: number,
  columnCount: number,
  commandIndex: number,
  issues: TraceSemanticIssue[],
): void {
  if (row >= rowCount || column >= columnCount) {
    addIssue(
      issues,
      commandIndex,
      'MATRIX_POSITION_OUT_OF_BOUNDS',
      `Matrix position (${row}, ${column}) is outside the ${rowCount} x ${columnCount} matrix.`,
    );
  }
}
