export default function CatalogSidebar() {
  return (
    <aside className="catalog-sidebar">
      <div className="catalog-sidebar-search-area">
        <input
          className="catalog-sidebar-search-input"
          placeholder="Search algorithms"
        />
      </div>

      <nav className="catalog-sidebar-navigation">
        <section>
          <h2 className="catalog-sidebar-section-title">Categories</h2>
          <p className="catalog-sidebar-placeholder">
            Categories will render here.
          </p>
        </section>
        <section>
          <h2 className="catalog-sidebar-section-title">Algorithms</h2>
          <p className="catalog-sidebar-placeholder">
            Algorithms will render here.
          </p>
        </section>
      </nav>

      <div className="catalog-sidebar-footer">
        Catalog information will render here.
      </div>
    </aside>
  );
}