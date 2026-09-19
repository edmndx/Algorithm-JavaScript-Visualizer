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
      | 'tree.checkBounds'
      | 'tree.setDepth'
      | 'tree.swapValues'
      | 'tree.visit'
      | 'tree.mark'
      | 'tree.frontier';
  }
>;

export function reduceTree(
  scene: SceneState,
  command: TreeCommand,
): TreeSceneState {
  assertSceneStructure(scene, 'tree', command.type);
  const clearedScene = {
    ...scene,
    boundsCheck: null,
    activeDepthNodeId: null,
  };

  switch (command.type) {
    case 'tree.create':
      return {
        ...scene,
        rootId: command.rootId,
        nodes: command.nodes.map(cloneTreeNode),
        comparedNodeIds: null,
        boundsCheck: null,
        depthByNodeId: {},
        activeDepthNodeId: null,
        currentNodeId: null,
        frontier: null,
        visitedNodeIds: [],
        markers: {},
      };

    case 'tree.setRoot':
      return { ...clearedScene, rootId: command.rootId };

    case 'tree.frontier':
      for (const nodeId of command.nodeIds) {
        requireEntity(
          scene.nodes.some((node) => node.id === nodeId),
          `Tree node "${nodeId}" does not exist.`,
        );
      }
      return {
        ...clearedScene,
        frontier: { nodeIds: [...command.nodeIds], level: command.level },
      };

    case 'tree.addNode':
      return {
        ...clearedScene,
        nodes: [...scene.nodes, cloneTreeNode(command.node)],
      };

    case 'tree.removeNode':
      requireEntity(
        scene.nodes.some((node) => node.id === command.nodeId),
        `Tree node "${command.nodeId}" does not exist.`,
      );

      return {
        ...clearedScene,
        nodes: scene.nodes.filter((node) => node.id !== command.nodeId),
        comparedNodeIds: scene.comparedNodeIds?.includes(command.nodeId)
          ? null
          : scene.comparedNodeIds,
        visitedNodeIds: scene.visitedNodeIds.filter(
          (nodeId) => nodeId !== command.nodeId,
        ),
        markers: removeIdFromMarkers(scene.markers, command.nodeId),
        depthByNodeId: Object.fromEntries(
          Object.entries(scene.depthByNodeId).filter(
            ([nodeId]) => nodeId !== command.nodeId,
          ),
        ),
      };

    case 'tree.setChildren': {
      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({ ...node, children: [...command.children] }),
        'Tree node',
      );
      return { ...clearedScene, nodes };
    }

    case 'tree.setValue': {
      const nodes = updateEntityById(
        scene.nodes,
        command.nodeId,
        (node) => ({ ...node, value: command.value }),
        'Tree node',
      );
      return { ...clearedScene, nodes };
    }

    case 'tree.compare':
      return { ...clearedScene, comparedNodeIds: [...command.nodeIds] };

    case 'tree.checkBounds':
      requireEntity(
        scene.nodes.some((node) => node.id === command.nodeId),
        `Tree node "${command.nodeId}" does not exist.`,
      );
      return {
        ...clearedScene,
        comparedNodeIds: null,
        boundsCheck: {
          nodeId: command.nodeId,
          lower: command.lower,
          upper: command.upper,
          matches: command.matches,
        },
      };

    case 'tree.setDepth':
      requireEntity(
        scene.nodes.some((node) => node.id === command.nodeId),
        `Tree node "${command.nodeId}" does not exist.`,
      );
      return {
        ...clearedScene,
        comparedNodeIds: null,
        depthByNodeId: {
          ...scene.depthByNodeId,
          [command.nodeId]: command.depth,
        },
        activeDepthNodeId: command.nodeId,
      };

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
      return { ...clearedScene, nodes };
    }

    case 'tree.visit':
      return {
        ...clearedScene,
        currentNodeId: command.nodeId,
        visitedNodeIds: appendUnique(scene.visitedNodeIds, command.nodeId),
      };

    case 'tree.mark':
      return {
        ...clearedScene,
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
