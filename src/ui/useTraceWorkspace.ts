import { useEffect, useState } from 'react';

import { algorithmCatalog, type AlgorithmCatalogEntry } from '../data/catalog';
import { downloadTraceFile } from '../features/trace/traceDownload';
import { useTraceSession } from '../features/useTraceSession';
import { usePlayback } from '../playback';
import {
  useEditorTabs,
  type EditorTabsController,
} from './components/useEditorTabs';

const DEFAULT_ALGORITHM = algorithmCatalog[0] ?? null;

export function useTraceWorkspace() {
  const [selectedAlgorithm, setSelectedAlgorithm] =
    useState<AlgorithmCatalogEntry | null>(DEFAULT_ALGORITHM);
  const playback = usePlayback(DEFAULT_ALGORITHM?.structure ?? 'array');
  const editorTabs = useEditorTabs({
    fileName: `${selectedAlgorithm?.id ?? 'starter-code'}.js`,
    initialCode: DEFAULT_ALGORITHM?.code ?? '',
    initialStructure: DEFAULT_ALGORITHM?.structure ?? null,
  });
  const session = useTraceSession({
    activeSource: editorTabs.activeSource,
    playback,
    bindImportedSource: editorTabs.bindImportedSource,
  });
  const initializeAlgorithm = session.initialize;

  useEffect(() => {
    if (DEFAULT_ALGORITHM !== null) {
      void initializeAlgorithm({
        code: DEFAULT_ALGORITHM.code,
        revision: 0,
        structure: DEFAULT_ALGORITHM.structure,
      });
    }
  }, [initializeAlgorithm]);

  function selectAlgorithm(algorithm: AlgorithmCatalogEntry) {
    playback.initialize(algorithm.structure);
    setSelectedAlgorithm(algorithm);
    const source = editorTabs.replacePrimarySource(
      algorithm.code,
      algorithm.structure,
    );
    void initializeAlgorithm(source);
  }

  function runAlgorithm() {
    if (selectedAlgorithm === null) return;

    void session.run(editorTabs.activeSource);
  }

  function exportTrace() {
    if (!session.canExportTrace || playback.frameTrace === null) return;

    const traceName =
      session.importedStructure === null
        ? (selectedAlgorithm?.id ?? 'trace')
        : `imported-${session.importedStructure}`;
    downloadTraceFile(traceName, playback.frameTrace);
  }

  const editorView: EditorTabsController = editorTabs;

  return {
    header: {
      title:
        session.importedStructure === null
          ? (selectedAlgorithm?.name ?? 'Select an algorithm')
          : 'Imported trace',
      category:
        session.importedStructure === null
          ? (selectedAlgorithm?.category ?? 'Algorithms')
          : `${formatStructure(session.importedStructure)} structure`,
      canRun: selectedAlgorithm !== null,
      canExportTrace: session.canExportTrace,
      isRunning: session.isRunning,
      onExportTrace: exportTrace,
      onImportTrace: (file: File) => void session.importTrace(file),
      onRun: runAlgorithm,
      onStop: session.stop,
      traceSucceeded: session.canExportTrace,
    },
    catalog: {
      activeAlgorithmId: selectedAlgorithm?.id ?? null,
      onSelectAlgorithm: selectAlgorithm,
    },
    visualization: {
      scene: playback.scene,
      playbackSequence: playback.frameTrace?.frames,
      currentStep: playback.currentStep,
      totalSteps: playback.totalSteps,
      isPlaying: playback.isPlaying,
      canPlay: playback.canPlay,
      canGoBack: playback.canGoBack,
      canGoForward: playback.canGoForward,
      onPlay: playback.play,
      onPause: playback.pause,
      onNext: playback.next,
      onPrevious: playback.previous,
      onReset: playback.reset,
      speed: playback.speed,
      onCycleSpeed: playback.cycleSpeed,
      onSeek: playback.seek,
      animateForward: playback.animateForward,
    },
    editor: {
      activeSourceLocation: session.activeSourceLocation,
      editorTabs: editorView,
    },
    console: {
      entries: session.consoleEntries,
      onSelect: session.seekNarration,
    },
  };
}

function formatStructure(structure: string): string {
  return structure
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
