import { useState } from 'react';
import '../assets/MainPage.css';
import { loadStarterCode } from '../features/codeEditor';
import {
  algorithmCatalog,
  type AlgorithmCatalogEntry,
} from '../features/loadData';
import AppHeader from './components/AppHeader';
import CatalogSidebar from './components/CatalogSidebar';
import CodeEditorPanel from './components/CodeEditorPanel';
import ConsolePanel from './components/ConsolePanel';
import VisualizationPanel from './components/VisualizationPanel';

const DEFAULT_ALGORITHM = algorithmCatalog[0] ?? null;

export default function MainPage() {
  const [code, setCode] = useState(DEFAULT_ALGORITHM?.code ?? '');
  const [selectedAlgorithm, setSelectedAlgorithm] =
    useState<AlgorithmCatalogEntry | null>(DEFAULT_ALGORITHM);

  function selectAlgorithm(algorithm: AlgorithmCatalogEntry) {
    setSelectedAlgorithm(algorithm);
    setCode(loadStarterCode(algorithm.id) ?? '');
  }

  return (
    <div className="main-page">
      <AppHeader algorithm={selectedAlgorithm} />

      <div className="main-page-content">
        <CatalogSidebar
          activeAlgorithmId={selectedAlgorithm?.id ?? null}
          onSelectAlgorithm={selectAlgorithm}
        />

        <main className="main-page-workspace">
          <section className="main-page-workspace-content">
            <VisualizationPanel />
            <ConsolePanel />
          </section>

          <CodeEditorPanel
            code={code}
            fileName={`${selectedAlgorithm?.id ?? 'starter-code'}.js`}
            onChange={setCode}
          />
        </main>
      </div>
    </div>
  );
}
