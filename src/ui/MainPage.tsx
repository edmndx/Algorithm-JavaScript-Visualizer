import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import '../assets/MainPage.css';
import '../visualization/visualization.css';
import {
  algorithmCatalog,
  type AlgorithmCatalogEntry,
} from '../features/loadData';
import { createTraceOperationEntries } from '../features/traceConsole';
import {
  createTraceOwnership,
  downloadTraceFile,
  parseTraceFile,
} from '../features/traceFile';
import { useAlgorithmExecution } from '../features/useAlgorithmExecution';
import { TRACE_INITIALIZATION_COMMAND_COUNT, usePlayback } from '../playback';
import type { ConsoleEntry } from '../runner/runner';
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
  const [isImportedTraceActive, setIsImportedTraceActive] = useState(false);
  const [traceFileError, setTraceFileError] = useState<ConsoleEntry | null>(
    null,
  );
  const [traceOwnership] = useState(createTraceOwnership);
  const traceImportSequence = useRef(0);
  const playback = usePlayback(DEFAULT_ALGORITHM?.structure ?? 'array');
  const editorTabs = useEditorTabs({
    fileName: `${selectedAlgorithm?.id ?? 'starter-code'}.js`,
    initialCode: DEFAULT_ALGORITHM?.code ?? '',
    initialStructure: DEFAULT_ALGORITHM?.structure ?? null,
  });
  const execution = useAlgorithmExecution(
    (source) =>
      traceOwnership.isExecutionOwner() && editorTabs.isCurrentSource(source),
    traceOwnership.isExecutionOwner,
    playback.load,
    playback.play,
  );
  const initializeAlgorithm = execution.initialize;
  const hasGeneratedTrace =
    execution.successfulSourceRevision === editorTabs.activeSource.revision;
  const hasCurrentTrace = isImportedTraceActive || hasGeneratedTrace;
  const consoleEntries =
    traceFileError !== null
      ? [traceFileError]
      : hasCurrentTrace
        ? createTraceOperationEntries(
            playback.commands.slice(TRACE_INITIALIZATION_COMMAND_COUNT),
            playback.currentStep,
          )
        : execution.consoleEntries;

  useEffect(() => {
    if (DEFAULT_ALGORITHM !== null) {
      void initializeAlgorithm(DEFAULT_ALGORITHM);
    }
  }, [initializeAlgorithm]);

  function selectAlgorithm(algorithm: AlgorithmCatalogEntry) {
    traceImportSequence.current += 1;
    traceOwnership.claimExecution();
    playback.initialize(algorithm.structure);
    setSelectedAlgorithm(algorithm);
    setIsImportedTraceActive(false);
    setTraceFileError(null);
    editorTabs.replacePrimarySource(algorithm.code, algorithm.structure);
    void initializeAlgorithm(algorithm);
  }

  function runAlgorithm() {
    if (selectedAlgorithm === null) return;

    traceImportSequence.current += 1;
    traceOwnership.claimExecution();
    setIsImportedTraceActive(false);
    setTraceFileError(null);
    void execution.run(editorTabs.activeSource);
  }

  async function importTrace(file: File) {
    const importSequence = ++traceImportSequence.current;
    traceOwnership.claimImport();
    let contents: string;

    try {
      contents = await file.text();
    } catch {
      if (importSequence !== traceImportSequence.current) return;

      setTraceFileError({
        sequence: 0,
        level: 'error',
        text: 'Trace file could not be read.',
      });
      return;
    }

    if (importSequence !== traceImportSequence.current) return;

    const result = parseTraceFile(contents);

    if (!result.ok) {
      setTraceFileError({
        sequence: 0,
        level: 'error',
        text: result.error.message,
      });
      return;
    }

    const timelineResult = playback.load(result.commands);

    if (!timelineResult.ok) {
      setTraceFileError({
        sequence: 0,
        level: 'error',
        text: `Trace file validation failed: ${timelineResult.error.message}`,
      });
      return;
    }

    setIsImportedTraceActive(true);
    setTraceFileError(null);
  }

  function exportTrace() {
    if (!hasCurrentTrace || selectedAlgorithm === null) return;

    downloadTraceFile(selectedAlgorithm.id, playback.commands);
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
        algorithm={selectedAlgorithm}
        canExportTrace={hasCurrentTrace}
        isRunning={execution.isRunning}
        onExportTrace={exportTrace}
        onImportTrace={(file) => void importTrace(file)}
        onRun={runAlgorithm}
        traceSucceeded={hasCurrentTrace}
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
              <CodeEditorPanel editorTabs={editorTabs} />
              <ConsolePanel entries={consoleEntries} />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
