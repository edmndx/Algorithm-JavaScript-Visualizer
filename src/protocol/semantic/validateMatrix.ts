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
      case 'matrix.swap':
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

      case 'matrix.region':
        validateMatrixPosition(
          command.start.row,
          command.start.column,
          rowCount,
          columnCount,
          commandIndex,
          issues,
        );
        validateMatrixPosition(
          command.end.row,
          command.end.column,
          rowCount,
          columnCount,
          commandIndex,
          issues,
        );
        break;

      case 'matrix.lines':
        for (const row of command.rows)
          if (row >= rowCount)
            addIssue(
              issues,
              commandIndex,
              'MATRIX_POSITION_OUT_OF_BOUNDS',
              `Matrix row ${row} is outside the matrix.`,
            );
        for (const column of command.columns)
          if (column >= columnCount)
            addIssue(
              issues,
              commandIndex,
              'MATRIX_POSITION_OUT_OF_BOUNDS',
              `Matrix column ${column} is outside the matrix.`,
            );
        break;

      case 'message':
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
