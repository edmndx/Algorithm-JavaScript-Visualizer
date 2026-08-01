import { useCatalog } from '../../features/catalog/useCatalog';

export default function CatalogSidebar() {
  const {
    categories,
    visibleAlgorithms,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
  } = useCatalog();
  const hasSearchQuery = searchQuery.trim().length > 0;

  const algorithmList = (
    <ul className="catalog-sidebar-algorithm-list">
      {visibleAlgorithms.length > 0 ? (
        visibleAlgorithms.map((algorithm) => (
          <li key={algorithm.id}>
            <button type="button" className="catalog-sidebar-algorithm">
              {algorithm.name}
            </button>
          </li>
        ))
      ) : (
        <li className="catalog-sidebar-placeholder">No algorithms found.</li>
      )}
    </ul>
  );

  return (
    <aside className="catalog-sidebar">
      <div className="catalog-sidebar-search-area">
        <input
          className="catalog-sidebar-search-input"
          type="search"
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
            {algorithmList}
          </section>
        ) : (
          <section>
            <h2 className="catalog-sidebar-section-title">Categories</h2>

            {categories.map((category) => (
              <div key={category} className="catalog-sidebar-category-group">
                <button
                  type="button"
                  className="catalog-sidebar-category"
                  aria-expanded={selectedCategory === category}
                  onClick={() =>
                    setSelectedCategory(
                      selectedCategory === category ? null : category,
                    )
                  }
                >
                  <span>{category}</span>
                  <span aria-hidden="true">
                    {selectedCategory === category ? '⌄' : '›'}
                  </span>
                </button>

                {selectedCategory === category && algorithmList}
              </div>
            ))}
          </section>
        )}
      </nav>

      <div className="catalog-sidebar-footer">
        {visibleAlgorithms.length} algorithms
      </div>
    </aside>
  );
}
