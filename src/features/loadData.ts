import algorithmsData from '../data/catalog/algorithms.json';
import commandChipsData from '../data/codeEditor/commandChips.json';
import {
  algorithmCatalogSchema,
  algorithmIdSchema,
  commandChipsSchema,
} from '../data/catalog/types';

function loadAlgorithmCatalog(
  data: unknown,
): readonly import('../data/catalog/types').AlgorithmCatalogEntry[] {
  const algorithms = algorithmCatalogSchema.parse(data);

  return Object.freeze(algorithms.map((algorithm) => Object.freeze(algorithm)));
}

export const algorithmCatalog = loadAlgorithmCatalog(algorithmsData);

export const commandChips = Object.freeze(
  commandChipsSchema
    .parse(commandChipsData)
    .map((commandChip) => Object.freeze(commandChip)),
);

export const algorithmCategories = Object.freeze([
  ...new Set(algorithmCatalog.map((algorithm) => algorithm.category)),
]);

const algorithmsById = new Map(
  algorithmCatalog.map((algorithm) => [algorithm.id, algorithm]),
);

export function getAlgorithmById(
  algorithmId: string,
): import('../data/catalog/types').AlgorithmCatalogEntry | undefined {
  const validationResult = algorithmIdSchema.safeParse(algorithmId);

  if (!validationResult.success) {
    return undefined;
  }

  return algorithmsById.get(validationResult.data);
}

export function parseAlgorithmId(
  algorithmId: string,
): import('../data/catalog/types').AlgorithmId {
  return algorithmIdSchema.parse(algorithmId);
}

export type {
  AlgorithmCatalogEntry,
  AlgorithmCategory,
  AlgorithmId,
  CommandChip,
} from '../data/catalog/types';
