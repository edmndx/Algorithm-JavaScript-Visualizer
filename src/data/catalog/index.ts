import algorithmsData from './algorithms.json';
import { algorithmCatalogSchema, type AlgorithmCatalogEntry } from './types';

export const algorithmCatalog: readonly Readonly<AlgorithmCatalogEntry>[] =
  algorithmCatalogSchema.parse(algorithmsData);

export const algorithmCategories = [
  ...new Set(algorithmCatalog.map((algorithm) => algorithm.category)),
] as const;

export type {
  AlgorithmCatalogEntry,
  AlgorithmCategory,
  AlgorithmId,
} from './types';
