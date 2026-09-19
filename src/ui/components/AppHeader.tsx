import { FileDown, FileUp, Play } from 'lucide-react';
import type { AlgorithmCatalogEntry } from '../../features/loadData';
import AlgorithmTreeLogo from './AlgorithmTreeLogo';

type AppHeaderProps = {
  algorithm: AlgorithmCatalogEntry | null;
};

export default function AppHeader({ algorithm }: AppHeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header-brand">
        <div className="app-header-brand-mark" aria-hidden="true">
          <AlgorithmTreeLogo />
        </div>
        <p className="app-header-brand-name">Algorithm Visualizer</p>
      </div>

      <div className="app-header-content">
        <div className="app-header-algorithm">
          <h1 className="app-header-algorithm-title">
            {algorithm?.name ?? 'Select an algorithm'}
          </h1>
          <p className="app-header-algorithm-meta">
            {algorithm?.category ?? 'Algorithms'}
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
            <Play className="app-header-run-icon" aria-hidden="true" />
            <span>Run</span>
          </span>
        </div>
      </div>
    </header>
  );
}
