import {
  ChevronDown,
  FileDown,
  FileText,
  FileUp,
  Play,
  Square,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type AppHeaderProps = {
  algorithm: AlgorithmCatalogEntry | null;
  fileStatus: 'empty' | 'loaded' | 'error';
  isRunning: boolean;
  onRun: () => void;
};

export default function AppHeader({
  title,
  category,
  canRun,
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
            onClick={() => onRun()}
          >
            <Play aria-hidden="true" className="app-header-run-icon" />
            <span>{isRunning ? 'Running' : 'Run'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
