import { Terminal } from 'lucide-react';
import type { ConsoleEntry } from '../../runner/runner';

interface ConsolePanelProps {
  readonly entries: readonly ConsoleEntry[];
}

export function ConsolePanel({ entries }: ConsolePanelProps) {
  return (
    <section className="console-panel">
      <div className="console-panel-header">
        <h2 className="console-panel-heading">
          <Terminal className="console-panel-icon" aria-hidden="true" />
          Console
        </h2>
      </div>
      <div className="console-panel-output" role="log" aria-live="polite">
        {entries.map((entry) => (
          <div
            className={`console-panel-entry console-panel-entry--${entry.level}`}
            key={entry.sequence}
          >
            {entry.text}
          </div>
        ))}
      </div>
    </section>
  );
}
