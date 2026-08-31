import type { SceneState } from '../scene';

export const VISUALIZATION_LIMITS = {
  arrayItems: 256,
  matrixCells: 1_600,
  stackItems: 256,
  queueItems: 256,
  treeNodes: 256,
  graphNodes: 200,
  graphEdges: 600,
  linkedListNodes: 256,
  hashTableBuckets: 256,
  hashTableEntries: 512,
} as const;

export const MAX_VISUALIZATION_VIEWBOX_DIMENSION = 4_096;

export const VISUALIZATION_READABILITY_LIMITS = {
  arrayItems: 63,
  matrixRows: 53,
  matrixColumns: 53,
  stackItems: 79,
  queueItems: 63,
  treeNodes: 39,
  graphNodes: 80,
  graphEdges: 240,
  graphParallelEdges: 11,
  graphSelfLoops: 8,
  linkedListNodes: 20,
  hashTableBuckets: 55,
  hashTableEntriesPerBucket: 21,
} as const;

function capacityMessage(limit: number, unit: string): string {
  return `Visualization unavailable: this scene exceeds the limit of ${limit.toLocaleString('en-US')} ${unit}.`;
}

function readabilityMessage(limit: number, unit: string): string {
  return `Visualization unavailable: this scene exceeds the readability limit of ${limit.toLocaleString('en-US')} ${unit}.`;
}

function largestHashTableChain(
  scene: Extract<SceneState, { structure: 'hash-table' }>,
): number {
  const entryCounts = new Map<number, number>();
  let largestChain = 0;

  for (const entry of scene.entries) {
    const count = (entryCounts.get(entry.bucketIndex) ?? 0) + 1;
    entryCounts.set(entry.bucketIndex, count);
    largestChain = Math.max(largestChain, count);
  }

  return largestChain;
}

function largestGraphEdgeFamily(
  scene: Extract<SceneState, { structure: 'graph' }>,
): { readonly parallelEdges: number; readonly selfLoops: number } {
  const familyCounts = new Map<string, number>();
  let parallelEdges = 0;
  let selfLoops = 0;

  for (const edge of scene.edges) {
    const isSelfLoop = edge.from === edge.to;
    const endpoints = isSelfLoop
      ? ['loop', edge.from]
      : ['pair', ...[edge.from, edge.to].sort()];
    const key = JSON.stringify(endpoints);
    const count = (familyCounts.get(key) ?? 0) + 1;
    familyCounts.set(key, count);
    if (isSelfLoop) selfLoops = Math.max(selfLoops, count);
    else parallelEdges = Math.max(parallelEdges, count);
  }

  return { parallelEdges, selfLoops };
}

export function getVisualizationCapacityMessage(
  scene: SceneState,
): string | null {
  switch (scene.structure) {
    case null:
      return null;
    case 'array':
      if (scene.values.length > VISUALIZATION_LIMITS.arrayItems) {
        return capacityMessage(VISUALIZATION_LIMITS.arrayItems, 'items');
      }
      return scene.values.length > VISUALIZATION_READABILITY_LIMITS.arrayItems
        ? readabilityMessage(
            VISUALIZATION_READABILITY_LIMITS.arrayItems,
            'items',
          )
        : null;
    case 'matrix': {
      const cellCount = scene.values.reduce(
        (count, row) => count + row.length,
        0,
      );
      if (cellCount > VISUALIZATION_LIMITS.matrixCells) {
        return capacityMessage(VISUALIZATION_LIMITS.matrixCells, 'cells');
      }
      if (scene.values.length > VISUALIZATION_READABILITY_LIMITS.matrixRows) {
        return readabilityMessage(
          VISUALIZATION_READABILITY_LIMITS.matrixRows,
          'rows',
        );
      }
      const columnCount = scene.values.reduce(
        (maximum, row) => Math.max(maximum, row.length),
        0,
      );
      return columnCount > VISUALIZATION_READABILITY_LIMITS.matrixColumns
        ? readabilityMessage(
            VISUALIZATION_READABILITY_LIMITS.matrixColumns,
            'columns',
          )
        : null;
    }
    case 'tree':
      if (scene.nodes.length > VISUALIZATION_LIMITS.treeNodes) {
        return capacityMessage(VISUALIZATION_LIMITS.treeNodes, 'nodes');
      }
      return scene.nodes.length > VISUALIZATION_READABILITY_LIMITS.treeNodes
        ? readabilityMessage(
            VISUALIZATION_READABILITY_LIMITS.treeNodes,
            'nodes',
          )
        : null;
    case 'graph': {
      if (scene.nodes.length > VISUALIZATION_LIMITS.graphNodes) {
        return capacityMessage(VISUALIZATION_LIMITS.graphNodes, 'nodes');
      }
      if (scene.edges.length > VISUALIZATION_LIMITS.graphEdges) {
        return capacityMessage(VISUALIZATION_LIMITS.graphEdges, 'edges');
      }
      if (scene.nodes.length > VISUALIZATION_READABILITY_LIMITS.graphNodes) {
        return readabilityMessage(
          VISUALIZATION_READABILITY_LIMITS.graphNodes,
          'nodes',
        );
      }
      if (scene.edges.length > VISUALIZATION_READABILITY_LIMITS.graphEdges) {
        return readabilityMessage(
          VISUALIZATION_READABILITY_LIMITS.graphEdges,
          'edges',
        );
      }
      const { parallelEdges, selfLoops } = largestGraphEdgeFamily(scene);
      if (parallelEdges > VISUALIZATION_READABILITY_LIMITS.graphParallelEdges) {
        return readabilityMessage(
          VISUALIZATION_READABILITY_LIMITS.graphParallelEdges,
          'parallel edges',
        );
      }
      return selfLoops > VISUALIZATION_READABILITY_LIMITS.graphSelfLoops
        ? readabilityMessage(
            VISUALIZATION_READABILITY_LIMITS.graphSelfLoops,
            'self-loops',
          )
        : null;
    }
    case 'stack':
      if (scene.values.length > VISUALIZATION_LIMITS.stackItems) {
        return capacityMessage(VISUALIZATION_LIMITS.stackItems, 'items');
      }
      return scene.values.length > VISUALIZATION_READABILITY_LIMITS.stackItems
        ? readabilityMessage(
            VISUALIZATION_READABILITY_LIMITS.stackItems,
            'items',
          )
        : null;
    case 'queue':
      if (scene.values.length > VISUALIZATION_LIMITS.queueItems) {
        return capacityMessage(VISUALIZATION_LIMITS.queueItems, 'items');
      }
      return scene.values.length > VISUALIZATION_READABILITY_LIMITS.queueItems
        ? readabilityMessage(
            VISUALIZATION_READABILITY_LIMITS.queueItems,
            'items',
          )
        : null;
    case 'linked-list':
      if (scene.nodes.length > VISUALIZATION_LIMITS.linkedListNodes) {
        return capacityMessage(VISUALIZATION_LIMITS.linkedListNodes, 'nodes');
      }
      return scene.nodes.length >
        VISUALIZATION_READABILITY_LIMITS.linkedListNodes
        ? readabilityMessage(
            VISUALIZATION_READABILITY_LIMITS.linkedListNodes,
            'nodes',
          )
        : null;
    case 'hash-table':
      if (scene.bucketCount > VISUALIZATION_LIMITS.hashTableBuckets) {
        return capacityMessage(
          VISUALIZATION_LIMITS.hashTableBuckets,
          'buckets',
        );
      }
      if (scene.entries.length > VISUALIZATION_LIMITS.hashTableEntries) {
        return capacityMessage(
          VISUALIZATION_LIMITS.hashTableEntries,
          'entries',
        );
      }
      if (
        scene.bucketCount > VISUALIZATION_READABILITY_LIMITS.hashTableBuckets
      ) {
        return readabilityMessage(
          VISUALIZATION_READABILITY_LIMITS.hashTableBuckets,
          'buckets',
        );
      }
      return largestHashTableChain(scene) >
        VISUALIZATION_READABILITY_LIMITS.hashTableEntriesPerBucket
        ? readabilityMessage(
            VISUALIZATION_READABILITY_LIMITS.hashTableEntriesPerBucket,
            'entries per bucket',
          )
        : null;
  }
}
