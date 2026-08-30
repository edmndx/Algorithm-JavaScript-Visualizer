import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import '../assets/MainPage.css';
import {
  algorithmCatalog,
  type AlgorithmCatalogEntry,
} from '../features/loadData';
import { useAlgorithmExecution } from '../features/useAlgorithmExecution';
import { usePlayback } from '../playback';
import AppHeader from './components/AppHeader';
import CatalogSidebar from './components/CatalogSidebar';
import { CodeEditorPanel } from './components/CodeEditorPanel';
import ConsolePanel from './components/ConsolePanel';
import { useEditorTabs } from './components/useEditorTabs';
import VisualizationPanel from './components/VisualizationPanel';

const DEFAULT_ALGORITHM = algorithmCatalog[0] ?? null;

export default function MainPage() {
  const [selectedAlgorithm, setSelectedAlgorithm] =
    useState<AlgorithmCatalogEntry | null>(DEFAULT_ALGORITHM);
  const [isCatalogOpen, setIsCatalogOpen] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(true);
  const playback = usePlayback();
  const editorTabs = useEditorTabs({
    fileName: `${selectedAlgorithm?.id ?? 'starter-code'}.js`,
    initialCode: DEFAULT_ALGORITHM?.code ?? '',
    initialStructure: DEFAULT_ALGORITHM?.structure ?? null,
  });
  const execution = useAlgorithmExecution(
    editorTabs.isCurrentSource,
    playback.load,
    playback.play,
  );

  function selectAlgorithm(algorithm: AlgorithmCatalogEntry) {
    setSelectedAlgorithm(algorithm);
    editorTabs.replacePrimarySource(algorithm.code, algorithm.structure);
  }

  function runAlgorithm() {
    if (selectedAlgorithm === null) return;
    void execution.run(editorTabs.activeSource);
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
        fileStatus={selectedAlgorithm === null ? 'empty' : 'loaded'}
        isRunning={execution.isRunning}
        onRun={runAlgorithm}
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
              <ConsolePanel />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
