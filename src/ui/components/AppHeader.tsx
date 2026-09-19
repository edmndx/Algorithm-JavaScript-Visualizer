import type { AlgorithmCatalogEntry } from '../../features/loadData';

type AppHeaderProps = {
  algorithm: AlgorithmCatalogEntry | null;
};

export default function AppHeader({ algorithm }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header-brand">
        <div className="app-header-brand-mark">AV</div>
        <div className="app-header-brand-text">
          <p className="app-header-brand-name">Laboratory</p>
          <p className="app-header-brand-subtitle">Algorithm catalog</p>
        </div>
      </div>

      <div className="app-header-content">
        <div>
          <h1 className="app-header-algorithm-title">
            {algorithm?.name ?? 'Select an algorithm'}
          </h1>
          <p className="app-header-algorithm-meta">
            {algorithm?.category ?? 'Algorithm catalog'}
          </p>
        </div>
        <div className="app-header-actions">
          <span className="app-header-control">Open</span>
          <span className="app-header-control">Save</span>
          <span className="app-header-ready-status">Ready</span>
          <span className="app-header-run-control">Run</span>
        </div>
      </div>
    </header>
  );
}
