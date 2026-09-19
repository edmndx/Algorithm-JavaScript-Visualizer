import { useMemo, useState } from 'react';
import algorithmsData from '../../data/catalog/algorithms.json';
import type { AlgorithmCatalogEntry } from '../../data/catalog/types';

const algorithms = algorithmsData as AlgorithmCatalogEntry[];

export function useCatalog() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = useMemo(() => {
    return [...new Set(algorithms.map((algorithm) => algorithm.category))];
  }, []);
  const visibleAlgorithms = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return algorithms.filter((algorithm) => {
      const matchesCategory =
        normalizedQuery !== '' ||
        selectedCategory == null ||
        algorithm.category === selectedCategory;
      const matchesSearch = algorithm.name
        .toLowerCase()
        .includes(normalizedQuery);
      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);
  return {
    algorithms,
    categories,
    visibleAlgorithms,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
  };
}
