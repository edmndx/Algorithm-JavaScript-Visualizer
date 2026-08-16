import Editor from '@monaco-editor/react';

const EDITOR_THEME_NAME = 'algorithm-visualizer-dark';

const EDITOR_THEME = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'keyword', foreground: 'e05a5a' },
    { token: 'number', foreground: '6fb2ff' },
    { token: 'string', foreground: '7dd3a0' },
    { token: 'identifier', foreground: 'e6e6e6' },
    { token: 'comment', foreground: '6a7383', fontStyle: 'italic' },
  ],
  colors: {
    'editor.background': '#00000000',
    'editor.foreground': '#e6e6e6',
    'editorLineNumber.foreground': '#4a5568',
    'editorLineNumber.activeForeground': '#9aa4b2',
    'editor.selectionBackground': '#5a2a2a55',
    'editor.lineHighlightBackground': '#ffffff05',
    'editorCursor.foreground': '#e05a5a',
    'editorIndentGuide.background1': '#ffffff08',
  },
} satisfies import('monaco-editor').editor.IStandaloneThemeData;

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  lineNumbers: 'on',
  lineNumbersMinChars: 3,
  automaticLayout: true,
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
  fontSize: 13,
  scrollBeyondLastLine: false,
  padding: { top: 16, bottom: 16 },
  renderLineHighlight: 'all',
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  folding: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
} satisfies import('monaco-editor').editor.IStandaloneEditorConstructionOptions;

type CodeEditorPanelProps = {
  code: string;
  fileName: string;
  onChange: (code: string) => void;
};

function configureEditorTheme(monaco: typeof import('monaco-editor')) {
  monaco.editor.defineTheme(EDITOR_THEME_NAME, EDITOR_THEME);
}

export default function CodeEditorPanel({
  code,
  fileName,
  onChange,
}: CodeEditorPanelProps) {
  return (
    <aside className="code-editor-panel">
      <div className="code-editor-panel-tabs">
        <div className="code-editor-panel-tab">{fileName}</div>
        <span className="code-editor-panel-action-placeholder">New tab</span>
      </div>

      <div className="code-editor-panel-editor">
        <Editor
          height="100%"
          language="javascript"
          value={code}
          theme={EDITOR_THEME_NAME}
          beforeMount={configureEditorTheme}
          loading={
            <span className="code-editor-panel-loading">Loading editor…</span>
          }
          onChange={(value) => onChange(value ?? '')}
          options={EDITOR_OPTIONS}
        />
      </div>
    </aside>
  );
}
