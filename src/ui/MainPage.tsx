import '../assets/MainPage.css';
import AppHeader from './components/AppHeader';
import CatalogSidebar from './components/CatalogSidebar';
import CodeEditorPanel from './components/CodeEditorPanel';
import ConsolePanel from './components/ConsolePanel';
import VisualizationPanel from './components/VisualizationPanel';

export default function MainPage() {
  return (
    <div className="main-page">
      <AppHeader />

      <div className="main-page-content">
        <CatalogSidebar />

        <main className="main-page-workspace">
          <section className="main-page-workspace-content">
            <VisualizationPanel />
            <ConsolePanel />
          </section>
        </main>

        <CodeEditorPanel />
      </div>
    </div>
  );
}