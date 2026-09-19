import type { TraceCommand } from '../../protocol/traceTypes';
import { assertNever, assertSceneStructure } from '../sceneReducerError';
import type { SceneState, TreeSceneState } from '../sceneState';
import { appendUnique } from './entityCollection';

type TreeCommand = Extract<
  TraceCommand,
  {
    readonly type: 'tree.create' | 'tree.compare' | 'tree.visit' | 'tree.mark';
  }
>;

export function reduceTree(
  scene: SceneState,
  command: TreeCommand,
): TreeSceneState {
  assertSceneStructure(scene, 'tree', command.type);
  switch (command.type) {
    case 'tree.create':
      return {
        ...scene,
        rootId: command.rootId,
        nodes: command.nodes.map(cloneTreeNode),
        comparedNodeIds: null,
        currentNodeId: null,
        visitedNodeIds: [],
        markers: {},
      };

    case 'tree.compare':
      return { ...scene, comparedNodeIds: [...command.nodeIds] };

    case 'tree.visit':
      return {
        ...scene,
        currentNodeId: command.nodeId,
        visitedNodeIds: appendUnique(scene.visitedNodeIds, command.nodeId),
      };

    case 'tree.mark':
      return {
        ...scene,
        markers: {
          ...scene.markers,
          [command.marker]: [...command.nodeIds],
        },
      };

    default:
      return assertNever(command);
  }
}

function cloneTreeNode<
  Node extends { readonly id: string; readonly children: readonly string[] },
>(node: Node): Node {
  return { ...node, children: [...node.children] };
}
