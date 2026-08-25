import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import '../assets/MainPage.css';
import {
  createCodeEditorValue,
  loadStarterCode,
  updateCodeEditorValue,
} from '../features/codeEditor';
import {
  algorithmCatalog,
  type AlgorithmCatalogEntry,
} from '../features/loadData';
import { usePlayback } from '../playback';
import { SandboxClient } from '../sandbox';
import AppHeader from './components/AppHeader';
import CatalogSidebar from './components/CatalogSidebar';
import CodeEditorPanel from './components/CodeEditorPanel';
import ConsolePanel from './components/ConsolePanel';
import VisualizationPanel from './components/VisualizationPanel';

const DEFAULT_ALGORITHM = algorithmCatalog[0] ?? null;

export default function MainPage() {
  const [code, setCode] = useState(DEFAULT_ALGORITHM?.code ?? '');
  const [activeSource, setActiveSource] = useState(() =>
    createCodeEditorValue(code),
  );
  const activeSourceRef = useRef(activeSource);
  const [selectedAlgorithm, setSelectedAlgorithm] =
    useState<AlgorithmCatalogEntry | null>(DEFAULT_ALGORITHM);
  const [isCatalogOpen, setIsCatalogOpen] = useState(true);
  const [isEditorOpen, setIsEditorOpen] = useState(true);
  const [hasEditorErrors, setHasEditorErrors] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const sandboxClient = useRef<SandboxClient | null>(null);
  const runSequence = useRef(0);
  const playback = usePlayback();

  const updateActiveSource = useCallback((nextCode: string) => {
    const nextSource = updateCodeEditorValue(activeSourceRef.current, nextCode);

    if (nextSource === activeSourceRef.current) return;

    activeSourceRef.current = nextSource;
    setActiveSource(nextSource);
  }, []);

  useEffect(() => {
    let client: SandboxClient;

    try {
      client = new SandboxClient();
    } catch {
      return;
    }

    sandboxClient.current = client;

    return () => {
      runSequence.current += 1;
      sandboxClient.current = null;
      client.dispose();
    };
  }, []);

  function selectAlgorithm(algorithm: AlgorithmCatalogEntry) {
    const starterCode = loadStarterCode(algorithm.id) ?? '';

    setSelectedAlgorithm(algorithm);
    setCode(starterCode);
    if (!isEditorOpen) updateActiveSource(starterCode);
    setHasEditorErrors(false);
  }

  async function runAlgorithm() {
    const client = sandboxClient.current;
    if (!selectedAlgorithm || isRunning) return;

    if (client === null) return;

    const runId = ++runSequence.current;
    const runSource = activeSourceRef.current;

    function isCurrentRun() {
      return (
        runId === runSequence.current &&
        runSource.revision === activeSourceRef.current.revision
      );
    }

    setIsRunning(true);

    try {
      const result = await client.run(runSource.code);
      if (!isCurrentRun()) return;

      if (result.ok) {
        playback.load(result.commands);
      }
    } catch {
      // Execution failures intentionally leave the console and playback intact.
    } finally {
      if (runId === runSequence.current) setIsRunning(false);
    }
  }

  const fileStatus = !selectedAlgorithm
    ? 'empty'
    : hasEditorErrors
      ? 'error'
      : 'loaded';

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
        fileStatus={fileStatus}
        isRunning={isRunning}
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
              <CodeEditorPanel
                code={code}
                fileName={`${selectedAlgorithm?.id ?? 'starter-code'}.js`}
                onChange={setCode}
                onActiveSourceChange={updateActiveSource}
                onValidationChange={setHasEditorErrors}
              />
              <ConsolePanel />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
