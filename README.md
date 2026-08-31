# Algorithm JavaScript Visualizer

Algorithm JavaScript Visualizer is a local-first tool for visualizing JavaScript algorithms. It instruments user-written JavaScript into semantic trace commands, reconstructs playback `SceneState`, and renders that state as D3.js-generated SVG.

```txt
JavaScript -> instrumentation -> sandbox -> TraceCommand[] -> validation -> timeline -> SceneState -> D3.js + SVG
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
- Render authoritative playback `SceneState` through structure-specific D3.js and SVG renderers.
- Replay traces with play, pause, next, previous, reset, and progress controls.
- Highlight the active code line during playback.
- Display command explanations, console output, results, and errors.
- Fit responsive SVG visualizations to the panel through renderer-owned view boxes.

Supported visualization structures include arrays, matrices, trees, graphs, stacks, queues, linked lists, and hash tables.

---

## Technology Stack

- Vite
- React
- TypeScript
- D3.js
- SVG
- Web Workers
- Comlink
- XState
- Monaco Editor
- Zod

---

## Architecture

The application separates the main responsibilities into independent parts:

```txt
React UI
  -> editor, sidebar, controls, output panels

XState
  -> lab state, runner state, playback state

Instrumentation / Sandbox / Runner
  -> semantic trace generation and validation

Timeline / XState playback
  -> authoritative SceneState reconstruction

React visualization shell
  -> lifecycle, scene metadata, playback controls

D3 + SVG renderers
  -> data joins, deterministic layout, geometry, bounded transitions
```

React manages the interface and SVG lifecycle, XState controls playback, and D3 renders each authoritative `SceneState` without parsing source code, trace JSON, or console output.

Sequential scene states carry deterministic internal item identities so D3 joins preserve elements across swaps, pushes, pops, enqueues, and dequeues. Array bars use signed geometry around a visible zero baseline, while fixed graph coordinates use uniform scaling and parallel edges use deterministic paths. Count limits and renderer readability limits prevent pathological SVG dimensions.

The visualization tests execute the D3 renderers in an SVG-capable DOM. Catalog regression coverage runs every starter through instrumentation, trace validation, timeline reduction, and representative SVG rendering.

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

Build the project:

```bash
npm run build
```

Run all tests, or only the visualization checks:

```bash
npm test
npm run test:visualization
```

Preview the production build:

```bash
npm run preview
```

---

## License

Add a license before publishing the repository publicly.
