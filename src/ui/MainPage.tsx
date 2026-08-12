import { useState } from 'react';
import '../assets/MainPage.css';
import { loadStarterCode } from '../features/codeEditor';
import type { AlgorithmCatalogEntry } from '../features/loadData';
import AppHeader from './components/AppHeader';
import CatalogSidebar from './components/CatalogSidebar';
import { CodeEditor } from './components/CodeEditorPanel';
import ConsolePanel from './components/ConsolePanel';
import VisualizationPanel from './components/VisualizationPanel';

export default function MainPage() {
  const [code, setCode] = useState('');
  const [selectedAlgorithm, setSelectedAlgorithm] =
    useState<AlgorithmCatalogEntry | null>(null);

  function selectAlgorithm(algorithm: AlgorithmCatalogEntry) {
    setSelectedAlgorithm(algorithm);
    setCode(loadStarterCode(algorithm.id) ?? '');
  }

  return (
    <div className="main-page">
      <AppHeader algorithm={selectedAlgorithm} />

      <div className="main-page-content">
        <CatalogSidebar onSelectAlgorithm={selectAlgorithm} />

        <main className="main-page-workspace">
          <section className="main-page-workspace-content">
            <VisualizationPanel />
            <ConsolePanel />
          </section>

          <CodeEditor code={code} onChange={setCode} />
        </main>
      </div>
    </div>
  );
}
