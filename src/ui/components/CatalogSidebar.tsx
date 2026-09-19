import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useCatalog } from '../../features/useCatalog';

type CatalogSidebarProps = {
  activeAlgorithmId: import('../../features/loadData').AlgorithmId | null;
  onSelectAlgorithm: (
    algorithm: import('../../features/loadData').AlgorithmCatalogEntry,
  ) => void;
};

export default function CatalogSidebar({
  activeAlgorithmId,
  onSelectAlgorithm,
}: CatalogSidebarProps) {
  const {
    algorithms,
    categories,
    visibleAlgorithms,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
  } = useCatalog();
  const hasSearchQuery = searchQuery.trim().length > 0;

  function renderAlgorithmList(
    algorithmsToRender: readonly import('../../features/loadData').AlgorithmCatalogEntry[],
  ) {
    return (
      <ul className="catalog-sidebar-algorithm-list">
        {algorithmsToRender.length > 0 ? (
          algorithmsToRender.map((algorithm) => {
            const isActive = algorithm.id === activeAlgorithmId;

            return (
              <li key={algorithm.id}>
                <button
                  type="button"
                  className={
                    isActive
                      ? 'catalog-sidebar-algorithm catalog-sidebar-algorithm--active'
                      : 'catalog-sidebar-algorithm'
                  }
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onSelectAlgorithm(algorithm)}
                >
                  {algorithm.name}
                </button>
              </li>
            );
          })
        ) : (
          <li className="catalog-sidebar-placeholder">No algorithms found.</li>
        )}
      </ul>
    );
  }

  return (
    <aside className="catalog-sidebar" id="catalog-sidebar">
      <div className="catalog-sidebar-search-area">
        <Search className="catalog-sidebar-search-icon" aria-hidden="true" />
        <input
          className="catalog-sidebar-search-input"
          type="search"
          aria-label="Search algorithms"
          placeholder="Search algorithms"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
      </div>

      <nav
        className="catalog-sidebar-navigation"
        aria-label="Algorithm catalog"
      >
        {hasSearchQuery ? (
          <section>
            <h2 className="catalog-sidebar-section-title">Results</h2>
            {renderAlgorithmList(visibleAlgorithms)}
          </section>
        ) : (
          <section>
            {categories.map((category) => {
              const isOpen = selectedCategory === category;
              const categoryAlgorithms = algorithms.filter(
                (algorithm) => algorithm.category === category,
              );

              return (
                <div key={category} className="catalog-sidebar-category-group">
                  <button
                    type="button"
                    className="catalog-sidebar-category"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setSelectedCategory(isOpen ? null : category)
                    }
                  >
                    <span className="catalog-sidebar-category-label">
                      {isOpen ? (
                        <ChevronDown
                          className="catalog-sidebar-chevron"
                          aria-hidden="true"
                        />
                      ) : (
                        <ChevronRight
                          className="catalog-sidebar-chevron"
                          aria-hidden="true"
                        />
                      )}
                      <span>{category}</span>
                      <span className="catalog-sidebar-category-count">
                        {categoryAlgorithms.length}
                      </span>
                    </span>
                  </button>

                  {isOpen && renderAlgorithmList(categoryAlgorithms)}
                </div>
              );
            })}
          </section>
        )}
      </nav>

      <div className="catalog-sidebar-footer">
        <a
          className="catalog-sidebar-author"
          href="https://github.com/edmndx"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            className="catalog-sidebar-author-avatar"
            src="https://github.com/edmndx.png?size=64"
            alt=""
            width="24"
            height="24"
            loading="lazy"
            decoding="async"
          />
          <span>edmndx</span>
        </a>
        <span className="catalog-sidebar-license">MIT</span>
      </div>
    </aside>
  );
}
