import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import '../assets/MainPage.css';
import '../visualization/visualization.css';
import { AppHeader } from './components/AppHeader';
import CatalogSidebar from './components/CatalogSidebar';
import { CodeEditorPanel } from './components/CodeEditorPanel';
import { ConsolePanel } from './components/ConsolePanel';
import VisualizationPanel from './components/VisualizationPanel';
import { useTraceWorkspace } from './useTraceWorkspace';

export function MainPage() {
  const workspace = useTraceWorkspace();
  const [isCatalogOpen, setIsCatalogOpen] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(true);

  const pageClassName = [
    'main-page',
    !isCatalogOpen && 'main-page--catalog-collapsed',
    !isEditorOpen && 'main-page--editor-collapsed',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={pageClassName}>
      <AppHeader {...workspace.header} />

      <div className="main-page-content">
        {isCatalogOpen ? <CatalogSidebar {...workspace.catalog} /> : null}

        <button
          className="panel-collapse-control catalog-sidebar-collapse-control"
          type="button"
          aria-controls="catalog-sidebar"
          aria-expanded={isCatalogOpen}
          aria-label={isCatalogOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          title={isCatalogOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={() => setIsCatalogOpen((isOpen) => !isOpen)}
        >
          {isCatalogOpen ? (
            <ChevronLeft aria-hidden="true" />
          ) : (
            <ChevronRight aria-hidden="true" />
          )}
        </button>

        <main className="main-page-workspace">
          <section className="main-page-workspace-content">
            <VisualizationPanel {...workspace.visualization} />
          </section>

          <button
            className="panel-collapse-control editor-collapse-control"
            type="button"
            aria-controls="editor-workbench"
            aria-expanded={isEditorOpen}
            aria-label={isEditorOpen ? 'Collapse editor' : 'Expand editor'}
            title={isEditorOpen ? 'Collapse editor' : 'Expand editor'}
            onClick={() => setIsEditorOpen((isOpen) => !isOpen)}
          >
            {isEditorOpen ? (
              <ChevronRight aria-hidden="true" />
            ) : (
              <ChevronLeft aria-hidden="true" />
            )}
          </button>

          {isEditorOpen ? (
            <div className="main-page-editor-workbench" id="editor-workbench">
              <CodeEditorPanel {...workspace.editor} />
              <ConsolePanel {...workspace.console} />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
