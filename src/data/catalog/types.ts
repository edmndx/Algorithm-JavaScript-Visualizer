import { z } from 'zod';

import { instrumentableStructureSchema } from '../../instrumentation/instrumentationTypes';

export const algorithmCategorySchema = z
  .string()
  .trim()
  .min(1, 'Algorithm category is required.');

export const algorithmIdSchema = z
  .string()
  .trim()
  .min(1, 'Algorithm ID is required.')
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Algorithm ID must use lowercase kebab-case.',
  )
  .brand<'AlgorithmId'>();

export const algorithmCatalogEntrySchema = z.strictObject({
  id: algorithmIdSchema,
  name: z.string().trim().min(1, 'Algorithm name is required.'),
  category: algorithmCategorySchema,
  structure: instrumentableStructureSchema,
  description: z.string().trim().min(1, 'Algorithm description is required.'),
  code: z.string().trim().min(1, 'Starter code is required.'),
});

export const algorithmCatalogSchema = z
  .array(algorithmCatalogEntrySchema)
  .min(1, 'The algorithm catalog cannot be empty.')
  .superRefine((algorithms, context) => {
    const seenIds = new Set<string>();

    algorithms.forEach((algorithm, index) => {
      if (seenIds.has(algorithm.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate algorithm ID: ${algorithm.id}`,
          path: [index, 'id'],
        });
      }

      seenIds.add(algorithm.id);
    });
  });

export const commandChipSchema = z.strictObject({
  label: z.string().trim().min(1, 'Command-chip label is required.'),
  command: z.string().trim().min(1, 'Command-chip command is required.'),
});

export const commandChipsSchema = z.array(commandChipSchema);

export type AlgorithmCategory = z.infer<typeof algorithmCategorySchema>;
export type AlgorithmId = z.infer<typeof algorithmIdSchema>;
export type AlgorithmCatalogEntry = z.infer<typeof algorithmCatalogEntrySchema>;
export type CommandChip = z.infer<typeof commandChipSchema>;
