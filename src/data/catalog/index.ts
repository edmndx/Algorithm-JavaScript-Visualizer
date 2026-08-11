import algorithmData from './algorithms.json';
import commandChipData from '../codeEditor/commandChips.json';

export const algorithmCatalog =
  algorithmData as import('./types').AlgorithmCatalogEntry[];
export const commandChips = commandChipData as import('./types').CommandChip[];

export type { AlgorithmCatalogEntry, CommandChip } from './types';
