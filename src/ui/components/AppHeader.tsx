import { FileDown, FileUp, Play } from 'lucide-react';

type AppHeaderProps = {
  algorithm: AlgorithmCatalogEntry | null;
};

export default function AppHeader({ algorithm }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header-brand">
        <div className="app-header-brand-mark" aria-hidden="true">
          <svg
            className="algorithm-tree-logo"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path d="M12 5 3.5 19M12 5l8.5 14" />
            <circle cx="12" cy="5" r="2.3" />
            <circle cx="3.5" cy="19" r="2.3" />
            <circle cx="20.5" cy="19" r="2.3" />
          </svg>
        </div>
        <p className="app-header-brand-name">Algorithm Visualizer</p>
      </div>

      <div className="app-header-content">
        <div className="app-header-algorithm">
          <h1 className="app-header-algorithm-title">{title}</h1>
          <p className="app-header-algorithm-meta">
            {category}
            <span className="app-header-meta-separator">/</span>
            Visualization
          </p>
        </div>
        <div
          className="app-header-actions"
          role="group"
          aria-label="Unavailable actions"
        >
          <span className="app-header-action-placeholder" title="Import">
            <FileUp className="app-header-action-icon" aria-hidden="true" />
            <span>Import</span>
          </span>
          <span className="app-header-action-placeholder" title="Export">
            <FileDown className="app-header-action-icon" aria-hidden="true" />
            <span>Export</span>
          </span>
          <span className="app-header-run-placeholder">
            {isRunning ? (
              <Square className="app-header-run-icon" aria-hidden="true" />
            ) : (
              <Play className="app-header-run-icon" aria-hidden="true" />
            )}
            <span>{isRunning ? 'Stop' : 'Run'}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
