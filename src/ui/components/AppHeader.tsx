import {
  ChevronDown,
  FileDown,
  FileText,
  FileUp,
  Play,
  Square,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface AppHeaderProps {
  readonly title: string;
  readonly category: string;
  readonly canRun: boolean;
  readonly canExportTrace: boolean;
  readonly isRunning: boolean;
  readonly onExportTrace: () => void;
  readonly onImportTrace: (file: File) => void;
  readonly onRun: () => void;
  readonly onStop: () => void;
  readonly traceSucceeded: boolean;
}

export function AppHeader({
  title,
  category,
  canRun,
  canExportTrace,
  isRunning,
  onExportTrace,
  onImportTrace,
  onRun,
  onStop,
  traceSucceeded,
}: AppHeaderProps) {
  const [isFileMenuOpen, setIsFileMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileMenuRef = useRef<HTMLDivElement>(null);
  const fileMenuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isFileMenuOpen) return;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (
        !(event.target instanceof Node) ||
        !fileMenuRef.current?.contains(event.target)
      ) {
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
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';

                if (file !== undefined) {
                  onImportTrace(file);
                }
              }}
            />
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
                <button
                  className="app-header-file-option"
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setIsFileMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <FileUp aria-hidden="true" />
                  <span>Import</span>
                </button>
                <button
                  className="app-header-file-option"
                  role="menuitem"
                  type="button"
                  disabled={!canExportTrace}
                  onClick={() => {
                    setIsFileMenuOpen(false);
                    onExportTrace();
                  }}
                >
                  <FileDown aria-hidden="true" />
                  <span>Export</span>
                </button>
              </div>
            ) : null}
          </div>

          <button
            className={[
              'app-header-run',
              isRunning && 'app-header-run--loading',
              traceSucceeded && !isRunning && 'app-header-run--success',
            ]
              .filter(Boolean)
              .join(' ')}
            type="button"
            aria-busy={isRunning}
            aria-label={isRunning ? 'Stop execution' : 'Run algorithm'}
            disabled={!isRunning && !canRun}
            onClick={isRunning ? onStop : onRun}
            title={
              isRunning
                ? 'Stop execution'
                : traceSucceeded
                  ? 'Semantic trace succeeded'
                  : undefined
            }
          >
            {isRunning ? (
              <Square className="app-header-run-icon" aria-hidden="true" />
            ) : (
              <Play className="app-header-run-icon" aria-hidden="true" />
            )}
            <span>{isRunning ? 'Stop' : 'Run'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
