import { Terminal } from 'lucide-react';
import type { ConsoleEntry } from '../../features/traceConsole';

interface ConsolePanelProps {
  readonly entries: readonly ConsoleEntry[];
  readonly onSelect?: ((sequence: number) => void) | undefined;
}

export function ConsolePanel({ entries, onSelect }: ConsolePanelProps) {
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
            role={
              onSelect === undefined || entry.level !== 'log'
                ? undefined
                : 'button'
            }
            tabIndex={
              onSelect === undefined || entry.level !== 'log' ? undefined : 0
            }
            onClick={() => {
              if (entry.level === 'log') onSelect?.(entry.sequence);
            }}
            onKeyDown={(event) => {
              if (
                entry.level === 'log' &&
                (event.key === 'Enter' || event.key === ' ')
              ) {
                event.preventDefault();
                onSelect?.(entry.sequence);
              }
            }}
          >
            {entry.text}
          </div>
        ))}
      </div>
    </section>
  );
}
