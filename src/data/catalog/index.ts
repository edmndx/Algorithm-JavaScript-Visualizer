import algorithmsData from './algorithms.json';
import { algorithmCatalogSchema } from './types';

export const algorithmCatalog = Object.freeze(
  algorithmCatalogSchema
    .parse(algorithmsData)
    .map((algorithm) => Object.freeze(algorithm)),
);

export const algorithmCategories = Object.freeze([
  ...new Set(algorithmCatalog.map((algorithm) => algorithm.category)),
]);

export {
  algorithmCatalogEntrySchema,
  algorithmCatalogSchema,
  algorithmCategorySchema,
  algorithmIdSchema,
} from './types';
export type {
  AlgorithmCatalogEntry,
  AlgorithmCategory,
  AlgorithmId,
} from './types';
