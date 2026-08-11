import Editor from "@monaco-editor/react";

type CodeEditorProps = {
  code: string;
  onChange: (code: string) => void;
};

export function CodeEditor({
  code,
  onChange,
}: CodeEditorProps) {
  return (
    <aside className="code-editor-panel">
      <div className="code-editor-panel-tab">starter-code.js</div>
      <section className="code-editor-panel-content">
        <h2 className="code-editor-panel-heading">Starter code</h2>
        <div className="code-editor-panel-editor">
          <Editor
            language="javascript"
            value={code}
            onChange={(value) => {
              onChange(value ?? "");
            }}
            options={{
              minimap: {
                enabled: false,
              },
              lineNumbers: "on",
              automaticLayout: true,
              fontSize: 14,
              scrollBeyondLastLine: false,
            }}
          />
        </div>
      </section>
    </aside>
  );
}
