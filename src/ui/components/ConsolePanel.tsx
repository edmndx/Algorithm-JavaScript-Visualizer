import { Terminal } from 'lucide-react';

export default function ConsolePanel() {
  return (
    <section className="console-panel">
      <div className="console-panel-header">
        <h2 className="console-panel-heading">
          <Terminal className="console-panel-icon" aria-hidden="true" />
          Console
        </h2>
        <span className="console-panel-action-placeholder">Clear</span>
      </div>
      <div className="console-panel-output" role="log" aria-live="polite" />
    </section>
  );
}
