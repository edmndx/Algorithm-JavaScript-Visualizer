import type { TraceCommand } from '../protocol/traceTypes';
import { reduceArray } from './reducers/array';
import { reduceGraph } from './reducers/graph';
import { reduceHashTable } from './reducers/hashTable';
import { reduceLinkedList } from './reducers/linkedList';
import { reduceMatrix } from './reducers/matrix';
import { reduceQueue } from './reducers/queue';
import { reduceStack } from './reducers/stack';
import { reduceTree } from './reducers/tree';
import { assertNever, SceneReducerError } from './sceneReducerError';
import { createInitializedScene, type SceneState } from './sceneState';

export {
  SceneReducerError,
  type SceneReducerErrorCode,
} from './sceneReducerError';

export function reduceTraceCommand(
  scene: SceneState,
  command: TraceCommand,
): SceneState {
  switch (command.type) {
    case 'scene.init':
      return reduceSceneInit(scene, command);

    case 'message':
      return {
        ...scene,
        message: { text: command.text, level: command.level ?? 'info' },
      };

    case 'input.focus':
      return {
        ...scene,
        context: { ...scene.context, input: cloneInput(command.input) },
      };

    case 'input.set': {
      const input = scene.context.input;
      if (input?.kind !== 'grid') {
        throw new SceneReducerError(
          'INVALID_COMMAND',
          'input.set requires a focused grid input.',
        );
      }
      const values = input.values.map((row) => [...row]);
      const row = values[command.position.row];
      if (row === undefined || command.position.column >= row.length) {
        throw new SceneReducerError(
          'INDEX_OUT_OF_BOUNDS',
          `input.set references (${command.position.row}, ${command.position.column}) outside the focused grid.`,
        );
      }
      row[command.position.column] = command.value;
      return {
        ...scene,
        context: {
          ...scene.context,
          input: { ...input, values },
        },
      };
    }

    case 'metrics.set':
      return {
        ...scene,
        context: {
          ...scene.context,
          metrics: { ...scene.context.metrics, [command.name]: command.value },
        },
      };

    case 'array.create':
    case 'array.compare':
    case 'array.swap':
    case 'array.set':
    case 'array.mark':
    case 'array.focus':
    case 'array.compareValue':
      return reduceArray(scene, command);

    case 'matrix.create':
    case 'matrix.compare':
    case 'matrix.swap':
    case 'matrix.set':
    case 'matrix.mark':
    case 'matrix.visit':
    case 'matrix.region':
    case 'matrix.lines':
      return reduceMatrix(scene, command);

    case 'stack.create':
    case 'stack.push':
    case 'stack.pop':
    case 'stack.peek':
    case 'stack.compare':
    case 'stack.mark':
      return reduceStack(scene, command);

    case 'queue.create':
    case 'queue.enqueue':
    case 'queue.dequeue':
    case 'queue.dequeueBack':
    case 'queue.peek':
    case 'queue.mark':
      return reduceQueue(scene, command);

    case 'linked-list.create':
    case 'linked-list.addNode':
    case 'linked-list.removeNode':
    case 'linked-list.setHead':
    case 'linked-list.setTail':
    case 'linked-list.setNext':
    case 'linked-list.setPrevious':
    case 'linked-list.setValue':
    case 'linked-list.visit':
    case 'linked-list.mark':
    case 'linked-list.pointer':
    case 'linked-list.compare':
      return reduceLinkedList(scene, command);

    case 'hash-table.create':
    case 'hash-table.set':
    case 'hash-table.delete':
    case 'hash-table.move':
    case 'hash-table.visitBucket':
    case 'hash-table.visitEntry':
    case 'hash-table.mark':
    case 'hash-table.probe':
      return reduceHashTable(scene, command);

    case 'tree.create':
    case 'tree.setRoot':
    case 'tree.addNode':
    case 'tree.removeNode':
    case 'tree.setChildren':
    case 'tree.setValue':
    case 'tree.compare':
    case 'tree.checkBounds':
    case 'tree.setDepth':
    case 'tree.swapValues':
    case 'tree.visit':
    case 'tree.mark':
    case 'tree.frontier':
      return reduceTree(scene, command);

    case 'graph.create':
    case 'graph.addNode':
    case 'graph.removeNode':
    case 'graph.addEdge':
    case 'graph.removeEdge':
    case 'graph.setNodeValue':
    case 'graph.setEdgeWeight':
    case 'graph.visitNode':
    case 'graph.visitEdge':
    case 'graph.markNodes':
    case 'graph.markEdges':
    case 'graph.distance':
    case 'graph.nodeMetric':
    case 'graph.frontier':
      return reduceGraph(scene, command);

    default:
      return assertNever(command);
  }
}

function reduceSceneInit(
  scene: SceneState,
  command: Extract<TraceCommand, { readonly type: 'scene.init' }>,
): SceneState {
  if (scene.structure !== null) {
    throw new SceneReducerError(
      'DUPLICATE_SCENE_INIT',
      'scene.init can only be applied to an empty scene.',
    );
  }

  if (command.context?.input !== undefined)
    validateInput(command.context.input);

  return createInitializedScene(
    command.structure,
    command.title ?? null,
    command.context,
  );
}

function cloneInput(
  input: Extract<TraceCommand, { readonly type: 'input.focus' }>['input'],
) {
  validateInput(input);
  return input.kind === 'sequence'
    ? {
        ...input,
        values: [...input.values],
        pointers:
          input.pointers === undefined ? undefined : { ...input.pointers },
        range:
          input.range === undefined
            ? undefined
            : ([...input.range] as [number, number]),
      }
    : {
        ...input,
        values: input.values.map((row) => [...row]),
        pointers:
          input.pointers === undefined
            ? undefined
            : Object.fromEntries(
                Object.entries(input.pointers).map(([name, position]) => [
                  name,
                  { ...position },
                ]),
              ),
        range:
          input.range === undefined
            ? undefined
            : {
                start: { ...input.range.start },
                end: { ...input.range.end },
              },
      };
}

function validateInput(
  input: Extract<TraceCommand, { readonly type: 'input.focus' }>['input'],
): void {
  if (input.kind === 'sequence') {
    const length = input.values.length;
    for (const index of Object.values(input.pointers ?? {})) {
      if (index >= length) {
        throw new SceneReducerError(
          'INDEX_OUT_OF_BOUNDS',
          `Input pointer ${index} is outside the focused sequence.`,
        );
      }
    }
    if (
      input.range !== undefined &&
      (input.range[0] >= length ||
        input.range[1] >= length ||
        input.range[0] > input.range[1])
    ) {
      throw new SceneReducerError(
        'INVALID_COMMAND',
        'Input sequence range is invalid.',
      );
    }
    return;
  }
  const width = input.values[0]?.length ?? 0;
  if (input.values.some((row) => row.length !== width)) {
    throw new SceneReducerError(
      'INVALID_COMMAND',
      'Input grid must be rectangular.',
    );
  }
  const validPosition = (position: {
    readonly row: number;
    readonly column: number;
  }) => position.row < input.values.length && position.column < width;
  for (const position of Object.values(input.pointers ?? {})) {
    if (!validPosition(position)) {
      throw new SceneReducerError(
        'INDEX_OUT_OF_BOUNDS',
        `Input pointer (${position.row}, ${position.column}) is outside the focused grid.`,
      );
    }
  }
  if (
    input.range !== undefined &&
    (!validPosition(input.range.start) || !validPosition(input.range.end))
  ) {
    throw new SceneReducerError(
      'INDEX_OUT_OF_BOUNDS',
      'Input grid range is outside the focused grid.',
    );
  }
}
