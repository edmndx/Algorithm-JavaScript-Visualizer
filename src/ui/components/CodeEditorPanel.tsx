import Editor from '@monaco-editor/react';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import type { EditorTabsController } from './useEditorTabs';

interface CodeEditorPanelProps {
  readonly editorTabs: EditorTabsController;
}

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
  wordWrap: 'on',
  wrappingIndent: 'same',
  scrollBeyondLastLine: false,
  scrollbar: {
    horizontal: 'hidden',
    horizontalScrollbarSize: 0,
  },
  padding: { top: 16, bottom: 16 },
  renderLineHighlight: 'all',
  smoothScrolling: true,
  cursorBlinking: 'smooth',
  folding: false,
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
} satisfies import('monaco-editor').editor.IStandaloneEditorConstructionOptions;

export function CodeEditorPanel({ editorTabs }: CodeEditorPanelProps) {
  const {
    activeSource,
    activeTabId,
    addTab,
    canAddTab,
    closeTab,
    primaryName,
    primaryTabId,
    renameTab,
    selectTab,
    tabs,
    updateActiveCode,
  } = editorTabs;
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  function beginRename(tabId: string, currentName: string) {
    selectTab(tabId);
    setRenameDraft(currentName);
    setRenamingTabId(tabId);
  }

  function commitRename(tabId: string) {
    renameTab(tabId, renameDraft);
    setRenamingTabId(null);
  }

  function renderTab(tabId: string, name: string, canClose = false) {
    const isActive = activeTabId === tabId;
    const isRenaming = renamingTabId === tabId;

    return (
      <div
        className={`code-editor-panel-tab${isActive ? ' code-editor-panel-tab--active' : ''}`}
        key={tabId}
      >
        {isRenaming ? (
          <input
            className="code-editor-panel-tab-input"
            value={renameDraft}
            aria-label="Tab name"
            autoFocus
            onBlur={() => commitRename(tabId)}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') setRenamingTabId(null);
            }}
          />
        ) : (
          <button
            className="code-editor-panel-tab-name"
            type="button"
            role="tab"
            aria-selected={isActive}
            title="Double-click or press F2 to rename"
            onClick={() => selectTab(tabId)}
            onDoubleClick={() => beginRename(tabId, name)}
            onKeyDown={(event) => {
              if (event.key === 'F2') beginRename(tabId, name);
            }}
          >
            <span>{name}</span>
          </button>
        )}

        {canClose ? (
          <button
            className="code-editor-panel-tab-close"
            type="button"
            aria-label={`Close ${name}`}
            title={`Close ${name}`}
            onClick={() => {
              closeTab(tabId);
              if (renamingTabId === tabId) setRenamingTabId(null);
            }}
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <aside className="code-editor-panel">
      <div className="code-editor-panel-tabs" role="tablist">
        {renderTab(primaryTabId, primaryName)}
        {tabs.map((tab) => renderTab(tab.id, tab.name, true))}

        {canAddTab ? (
          <button
            className="code-editor-panel-add-tab"
            type="button"
            aria-label="New tab"
            title="New tab"
            onClick={addTab}
          >
            <Plus aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div className="code-editor-panel-editor">
        <Editor
          path={`${activeTabId}.js`}
          height="100%"
          language="javascript"
          value={activeSource.code}
          theme={EDITOR_THEME_NAME}
          beforeMount={configureEditorTheme}
          loading={
            <span className="code-editor-panel-loading">Loading editor…</span>
          }
          onChange={(value) => updateActiveCode(value ?? '')}
          options={EDITOR_OPTIONS}
        />
      </div>
    </aside>
  );
}

function configureEditorTheme(monaco: typeof import('monaco-editor')) {
  monaco.editor.defineTheme(EDITOR_THEME_NAME, EDITOR_THEME);
}
