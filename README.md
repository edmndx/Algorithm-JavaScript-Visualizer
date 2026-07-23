# Algorithm JavaScript Visualizer

Algorithm JavaScript Visualizer is a local-first tool for visualizing JavaScript algorithms. It converts user-written JavaScript code into structured JSON algorithm states and renders those states as interactive D3.js and Canvas visualizations.

```txt
JavaScript code -> JSON algorithm states -> D3.js / Canvas visualization
```

The project was written manually by hand, without agentic coding, as practice for NVIM workflow, clean code patterns, TypeScript architecture, and algorithm visualization design.

---

## Overview

The tool is designed for learning algorithms through code execution and visual feedback. Users can load starter JavaScript code, edit it, run it, generate JSON traces, import or export trace files, and replay algorithm states step by step.

---

## Trace-Based Visualization

The visualizer generates trace events from JavaScript code. Each event describes one algorithm action, such as initializing a structure, comparing values, swapping elements, visiting a node, or marking a path.

The trace is validated, prepared for playback, and rendered step by step.

---

## Features

- Browse algorithms by category in a collapsible sidebar.
- Load starter JavaScript code for selected algorithms.
- Edit code in a Monaco-based editor.
- Work with multiple editor tabs.
- Build custom visualizations using data structure and algorithm command chips.
- Run edited or custom JavaScript code through the runner.
- Validate code before execution.
- Generate JSON-based visualization traces.
- Import and export JSON trace files.
- Build visualizations directly from JSON trace data.
- Replay traces with play, pause, next, previous, reset, progress, and speed controls.
- Highlight the active code line during playback.
- Display command explanations, console output, results, and errors.
- Inspect visualizations with zoom, pan, fit/reset, hover, and focus interactions.

Supported visualization structures include arrays, trees, graphs, matrices, and grids.

---

## Technology Stack

- Vite
- React
- TypeScript
- D3.js
- Canvas
- Web Workers
- Comlink
- XState
- Monaco Editor
- Zod
- Vitest

---

## Architecture

The application separates the main responsibilities into independent parts:

```txt
React UI
  -> editor, sidebar, controls, output panels

XState
  -> lab state, runner state, playback state

Runner / Worker
  -> code analysis, trace generation, validation, frame preparation

D3 + Canvas Renderer
  -> layout, drawing, viewport control, object inspection
```

React manages the interface, XState controls the application and playback flow, and Canvas renders the algorithm visual objects.

---

## Local Development

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Run tests:

```bash
npm run test
```

Build the project:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

---

## Testing

The project uses Vitest for unit and integration testing.

The main tested areas are trace validation, playback state logic, command parsing, editor-related logic, visualization preparation, and the code-to-trace flow.

---

## License

Add a license before publishing the repository publicly.
