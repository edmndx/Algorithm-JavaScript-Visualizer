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

    case 'array.create':
    case 'array.compare':
    case 'array.swap':
    case 'array.set':
    case 'array.mark':
      return reduceArray(scene, command);

    case 'matrix.create':
    case 'matrix.compare':
    case 'matrix.swap':
    case 'matrix.set':
    case 'matrix.mark':
      return reduceMatrix(scene, command);

    case 'stack.create':
    case 'stack.push':
    case 'stack.pop':
    case 'stack.peek':
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
      return reduceLinkedList(scene, command);

    case 'hash-table.create':
    case 'hash-table.set':
    case 'hash-table.delete':
    case 'hash-table.move':
    case 'hash-table.visitBucket':
    case 'hash-table.visitEntry':
    case 'hash-table.mark':
      return reduceHashTable(scene, command);

    case 'tree.create':
    case 'tree.setRoot':
    case 'tree.addNode':
    case 'tree.removeNode':
    case 'tree.setChildren':
    case 'tree.setValue':
    case 'tree.compare':
    case 'tree.swapValues':
    case 'tree.visit':
    case 'tree.mark':
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

  return createInitializedScene(command.structure, command.title ?? null);
}
