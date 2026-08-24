import { ChevronDown, FileDown, FileText, FileUp, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AlgorithmCatalogEntry } from '../../features/loadData';
import AlgorithmTreeLogo from './AlgorithmTreeLogo';

type AppHeaderProps = {
  algorithm: AlgorithmCatalogEntry | null;
  fileStatus: 'empty' | 'loaded' | 'error';
  isRunning: boolean;
  onRun: () => void;
};

export default function AppHeader({
  algorithm,
  fileStatus,
  isRunning,
  onRun,
}: AppHeaderProps) {
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isFileMenuOpen) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (!fileMenuRef.current?.contains(event.target as Node)) {
        setIsFileMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;

      setIsFileMenuOpen(false);
      fileMenuButtonRef.current?.focus();
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);

    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [isFileMenuOpen]);

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
          aria-label="Application actions"
        >
          <div
            className="app-header-file-menu"
            ref={fileMenuRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setIsFileMenuOpen(false);
              }
            }}
          >
            <button
              className="app-header-file-trigger"
              type="button"
              ref={fileMenuButtonRef}
              aria-haspopup="menu"
              aria-expanded={isFileMenuOpen}
              onClick={() => setIsFileMenuOpen((isOpen) => !isOpen)}
            >
              <FileText className="app-header-action-icon" aria-hidden="true" />
              <span>File</span>
              <span className="app-header-file-status" aria-hidden="true" />
              <ChevronDown
                className="app-header-file-chevron"
                aria-hidden="true"
              />
            </button>

            {isFileMenuOpen ? (
              <div className="app-header-file-dropdown" role="menu">
                <span
                  className="app-header-file-option"
                  role="menuitem"
                  aria-disabled="true"
                >
                  <FileUp aria-hidden="true" />
                  <span>Import</span>
                </span>
                <span
                  className="app-header-file-option"
                  role="menuitem"
                  aria-disabled="true"
                >
                  <FileDown aria-hidden="true" />
                  <span>Export</span>
                </span>
              </div>
            ) : null}
          </div>

          <button
            className={`app-header-run${isRunning ? ' app-header-run--loading' : ''}`}
            type="button"
            aria-busy={isRunning}
            disabled={isRunning || fileStatus === 'empty'}
            onClick={onRun}
          >
            <Play className="app-header-run-icon" aria-hidden="true" />
            <span>Run</span>
          </button>
        </div>
      </div>
    </header>
  );
}
