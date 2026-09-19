import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import '../assets/MainPage.css';
import '../visualization/visualization.css';
import { algorithmCatalog, type AlgorithmCatalogEntry } from '../data/catalog';
import { createTraceOperationEntries } from '../features/traceConsole';
import { downloadTraceFile } from '../features/trace/traceDownload';
import { useTraceSession } from '../features/useTraceSession';
import { TRACE_INITIALIZATION_COMMAND_COUNT, usePlayback } from '../playback';
import { AppHeader } from './components/AppHeader';
import CatalogSidebar from './components/CatalogSidebar';
import { CodeEditorPanel } from './components/CodeEditorPanel';
import { ConsolePanel } from './components/ConsolePanel';
import { useEditorTabs } from './components/useEditorTabs';
import VisualizationPanel from './components/VisualizationPanel';

const DEFAULT_ALGORITHM = algorithmCatalog[0] ?? null;

export function MainPage() {
  const [selectedAlgorithm, setSelectedAlgorithm] =
    useState<AlgorithmCatalogEntry | null>(DEFAULT_ALGORITHM);
  const [isCatalogOpen, setIsCatalogOpen] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(true);
  const playback = usePlayback(DEFAULT_ALGORITHM?.structure ?? 'array');
  const editorTabs = useEditorTabs({
    fileName: `${selectedAlgorithm?.id ?? 'starter-code'}.js`,
    initialCode: DEFAULT_ALGORITHM?.code ?? '',
    initialStructure: DEFAULT_ALGORITHM?.structure ?? null,
  });
  const session = useTraceSession({
    activeSource: editorTabs.activeSource,
    loadPlayback: playback.load,
    playPlayback: playback.play,
  });
  const initializeAlgorithm = session.initialize;
  const hasAcceptedTrace =
    session.trace.kind === 'catalog' ||
    session.trace.kind === 'generated' ||
    session.trace.kind === 'imported';
  const canExportTrace =
    session.trace.kind === 'generated' || session.trace.kind === 'imported';
  const consoleEntries =
    session.consoleEntries.length > 0
      ? session.consoleEntries
      : hasAcceptedTrace
        ? createTraceOperationEntries(
            playback.commands.slice(
              TRACE_INITIALIZATION_COMMAND_COUNT,
              TRACE_INITIALIZATION_COMMAND_COUNT + playback.currentStep,
            ),
          )
        : [];
  const importedStructure =
    session.trace.kind === 'imported' ? session.trace.structure : null;
  const activeSourceLocation =
    session.trace.kind === 'catalog' || session.trace.kind === 'generated'
      ? playback.activeSourceLocation
      : null;

  useEffect(() => {
    if (DEFAULT_ALGORITHM !== null) {
      void initializeAlgorithm({
        code: DEFAULT_ALGORITHM.code,
        revision: 0,
        structure: DEFAULT_ALGORITHM.structure,
      });
    }
  }, [initializeAlgorithm]);

  function selectAlgorithm(algorithm: AlgorithmCatalogEntry) {
    playback.initialize(algorithm.structure);
    setSelectedAlgorithm(algorithm);
    const source = editorTabs.replacePrimarySource(
      algorithm.code,
      algorithm.structure,
    );
    void initializeAlgorithm(source);
  }

  function runAlgorithm() {
    if (selectedAlgorithm === null) return;

    void session.run(editorTabs.activeSource);
  }

  function exportTrace() {
    if (!canExportTrace) return;

    const traceName =
      importedStructure === null
        ? (selectedAlgorithm?.id ?? 'trace')
        : `imported-${importedStructure}`;
    downloadTraceFile(traceName, playback.commands);
  }

  const pageClassName = [
    'main-page',
    !isCatalogOpen && 'main-page--catalog-collapsed',
    !isEditorOpen && 'main-page--editor-collapsed',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={pageClassName}>
      <AppHeader
        title={
          importedStructure === null
            ? (selectedAlgorithm?.name ?? 'Select an algorithm')
            : 'Imported trace'
        }
        category={
          importedStructure === null
            ? (selectedAlgorithm?.category ?? 'Algorithms')
            : `${formatStructure(importedStructure)} structure`
        }
        canRun={selectedAlgorithm !== null}
        canExportTrace={canExportTrace}
        isRunning={session.isRunning}
        onExportTrace={exportTrace}
        onImportTrace={(file) => void session.importTrace(file)}
        onRun={runAlgorithm}
        onStop={session.stop}
        traceSucceeded={canExportTrace}
      />

      <div className="main-page-content">
        {isCatalogOpen ? (
          <CatalogSidebar
            activeAlgorithmId={selectedAlgorithm?.id ?? null}
            onSelectAlgorithm={selectAlgorithm}
          />
        ) : null}

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
            <VisualizationPanel
              scene={playback.scene}
              playbackSequence={playback.commands}
              currentStep={playback.currentStep}
              totalSteps={playback.totalSteps}
              isPlaying={playback.isPlaying}
              canPlay={playback.canPlay}
              canGoBack={playback.canGoBack}
              canGoForward={playback.canGoForward}
              onPlay={playback.play}
              onPause={playback.pause}
              onNext={playback.next}
              onPrevious={playback.previous}
              onReset={playback.reset}
            />
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
              <CodeEditorPanel
                activeSourceLocation={activeSourceLocation}
                editorTabs={editorTabs}
              />
              <ConsolePanel entries={consoleEntries} />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function formatStructure(structure: string): string {
  return structure
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
