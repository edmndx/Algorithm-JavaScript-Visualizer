import Editor from '@monaco-editor/react';
import { Plus, X } from 'lucide-react';
import { useRef, useState } from 'react';

const PRIMARY_TAB_ID = 'algorithm-source';
const MAX_NEW_TABS = 3;

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
  onValidationChange: (hasErrors: boolean) => void;
};

type EditorTab = {
  id: string;
  name: string;
  code: string;
};

function configureEditorTheme(monaco: typeof import('monaco-editor')) {
  monaco.editor.defineTheme(EDITOR_THEME_NAME, EDITOR_THEME);
}

export default function CodeEditorPanel({
  code,
  fileName,
  onChange,
  onValidationChange,
}: CodeEditorPanelProps) {
  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState(PRIMARY_TAB_ID);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [primaryNameOverride, setPrimaryNameOverride] = useState<{
    source: string;
    value: string;
  } | null>(null);
  const nextTabNumber = useRef(1);

  const primaryName =
    primaryNameOverride?.source === fileName
      ? primaryNameOverride.value
      : fileName;
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const activeCode = activeTab?.code ?? code;

  function addTab() {
    if (tabs.length >= MAX_NEW_TABS) return;

    const tabNumber = nextTabNumber.current;
    nextTabNumber.current += 1;

    const newTab = {
      id: `new-tab-${tabNumber}`,
      name: `untitled-${tabNumber}.js`,
      code: '',
    };

    setTabs((currentTabs) => [...currentTabs, newTab]);
    setActiveTabId(newTab.id);
  }

  function closeTab(tabId: string) {
    const tabIndex = tabs.findIndex((tab) => tab.id === tabId);
    if (tabIndex === -1) return;

    if (activeTabId === tabId) {
      const nextActiveTab = tabs[tabIndex + 1] ?? tabs[tabIndex - 1];
      setActiveTabId(nextActiveTab?.id ?? PRIMARY_TAB_ID);
    }

    setTabs((currentTabs) => currentTabs.filter((tab) => tab.id !== tabId));
    if (renamingTabId === tabId) setRenamingTabId(null);
  }

  function beginRename(tabId: string, currentName: string) {
    setActiveTabId(tabId);
    setRenameDraft(currentName);
    setRenamingTabId(tabId);
  }

  function commitRename(tabId: string) {
    const newName = renameDraft.trim();

    if (newName) {
      if (tabId === PRIMARY_TAB_ID) {
        setPrimaryNameOverride({ source: fileName, value: newName });
      } else {
        setTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.id === tabId ? { ...tab, name: newName } : tab,
          ),
        );
      }
    }

    setRenamingTabId(null);
  }

  function updateActiveCode(value: string) {
    if (activeTabId === PRIMARY_TAB_ID) {
      onChange(value);
      return;
    }

    setTabs((currentTabs) =>
      currentTabs.map((tab) =>
        tab.id === activeTabId ? { ...tab, code: value } : tab,
      ),
    );
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
            onClick={() => setActiveTabId(tabId)}
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
            onClick={() => closeTab(tabId)}
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
        {renderTab(PRIMARY_TAB_ID, primaryName)}
        {tabs.map((tab) => renderTab(tab.id, tab.name, true))}

        {tabs.length < MAX_NEW_TABS ? (
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
          value={activeCode}
          theme={EDITOR_THEME_NAME}
          beforeMount={configureEditorTheme}
          loading={
            <span className="code-editor-panel-loading">Loading editor…</span>
          }
          onChange={(value) => updateActiveCode(value ?? '')}
          onValidate={(markers) =>
            onValidationChange(markers.some((marker) => marker.severity >= 8))
          }
          options={EDITOR_OPTIONS}
        />
      </div>
    </aside>
  );
}
