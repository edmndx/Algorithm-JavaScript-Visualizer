import { useMemo, useState } from 'react';
import {
  algorithmCatalog,
  algorithmCategories,
  type AlgorithmCategory,
} from './loadData';

export function useCatalog() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] =
    useState<AlgorithmCategory | null>(null);

  const visibleAlgorithms = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase();

    return algorithmCatalog.filter((algorithm) => {
      const matchesCategory =
        normalizedQuery !== '' ||
        selectedCategory == null ||
        algorithm.category === selectedCategory;
      const matchesSearch = [algorithm.name, algorithm.description].some(
        (searchableText) =>
          searchableText.toLocaleLowerCase().includes(normalizedQuery),
      );

      return matchesCategory && matchesSearch;
    });
  }, [searchQuery, selectedCategory]);

  return {
    algorithms: algorithmCatalog,
    categories: algorithmCategories,
    visibleAlgorithms,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
  };
}
