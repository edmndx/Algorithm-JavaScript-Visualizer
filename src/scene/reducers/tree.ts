import type { TraceCommand } from '../../protocol/traceTypes';
import { assertNever, assertSceneStructure } from '../sceneReducerError';
import type { SceneState, TreeSceneState } from '../sceneState';
import {
  appendUnique,
  removeIdFromMarkers,
  requireEntity,
  updateEntityById,
} from './entityCollection';

type TreeCommand = Extract<
  TraceCommand,
  {
    readonly type:
      | 'tree.create'
      | 'tree.setRoot'
      | 'tree.addNode'
      | 'tree.removeNode'
      | 'tree.setChildren'
      | 'tree.setValue'
      | 'tree.compare'
      | 'tree.swapValues'
      | 'tree.visit'
      | 'tree.mark';
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
        visitedNodeIds: [],
        markers: {},
      };

    case 'tree.setRoot':
      return { ...scene, rootId: command.rootId };

    case 'tree.addNode':
      return { ...scene, nodes: [...scene.nodes, cloneTreeNode(command.node)] };

    case 'tree.removeNode':
      requireEntity(
        scene.nodes.some((node) => node.id === command.nodeId),
        `Tree node "${command.nodeId}" does not exist.`,
      );

      return {
        ...scene,
        nodes: scene.nodes.filter((node) => node.id !== command.nodeId),
        comparedNodeIds: scene.comparedNodeIds?.includes(command.nodeId)
          ? null
          : scene.comparedNodeIds,
        visitedNodeIds: scene.visitedNodeIds.filter(
          (nodeId) => nodeId !== command.nodeId,
        ),
        markers: removeIdFromMarkers(scene.markers, command.nodeId),
      };

    case 'tree.setChildren': {
      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({ ...node, children: [...command.children] }),
        'Tree node',
      );
      return { ...scene, nodes };
    }

    case 'tree.setValue': {
      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({ ...node, value: command.value }),
        'Tree node',
      );
      return { ...scene, nodes };
    }

    case 'tree.compare':
      return { ...scene, comparedNodeIds: [...command.nodeIds] };

    case 'tree.swapValues': {
      const [firstId, secondId] = command.nodeIds;
      const firstNode = scene.nodes.find((node) => node.id === firstId);
      const secondNode = scene.nodes.find((node) => node.id === secondId);

      requireEntity(
        firstNode !== undefined,
        `Tree node "${firstId}" does not exist.`,
      );
      requireEntity(
        secondNode !== undefined,
        `Tree node "${secondId}" does not exist.`,
      );

      const nodes = scene.nodes.map((node) => {
        if (node.id === firstId) return { ...node, value: secondNode.value };
        if (node.id === secondId) return { ...node, value: firstNode.value };
        return node;
      });
      return { ...scene, nodes };
    }

    case 'tree.visit':
      return {
        ...scene,
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
