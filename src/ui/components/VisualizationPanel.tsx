import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { SceneState } from '../../scene';
import { useMemo, useState } from 'react';
import type { PlaybackPosition } from '../../visualization/D3Scene';
import {
  clampZoom,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
  VisualizationZoomContext,
} from '../../visualization/viewport';
import SceneRenderer from '../../visualization/SceneRenderer';
import PlaybackControls from './PlaybackControls';

type VisualizationPanelProps = {
  readonly scene: SceneState;
  readonly playbackSequence?: readonly unknown[] | undefined;
  readonly currentStep: number;
  readonly totalSteps: number;
  readonly isPlaying: boolean;
  readonly canPlay: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onNext: () => void;
  readonly onPrevious: () => void;
  readonly onReset: () => void;
  readonly speed: 0.5 | 1 | 2;
  readonly onCycleSpeed: () => void;
  readonly onSeek: (step: number) => void;
  readonly animateForward: boolean;
};

export default function VisualizationPanel({
  scene,
  playbackSequence,
  currentStep,
  totalSteps,
  isPlaying,
  canPlay,
  canGoBack,
  canGoForward,
  onPlay,
  onPause,
  onNext,
  onPrevious,
  onReset,
  speed,
  onCycleSpeed,
  onSeek,
  animateForward,
}: VisualizationPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const playbackPosition = useMemo(
    () =>
      playbackSequence === undefined
        ? undefined
        : {
            sequence: playbackSequence,
            step: currentStep,
            animateForward,
          },
    [playbackSequence, currentStep, animateForward],
  );
  return (
    <section
      className={`visualization-panel${expanded ? ' visualization-panel--expanded' : ''}`}
      aria-label="Visualization canvas"
      role={expanded ? 'dialog' : undefined}
      aria-modal={expanded ? true : undefined}
      tabIndex={0}
      onKeyDown={(event) => {
        if (!expanded) return;
        if (event.key === 'Escape') {
          event.stopPropagation();
          setExpanded(false);
          event.currentTarget
            .querySelector<HTMLButtonElement>(
              '[aria-label="Collapse visualization"]',
            )
            ?.focus();
        } else if (event.key === 'Tab') {
          const buttons = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              'button:not(:disabled)',
            ),
          );
          const first = buttons[0];
          const last = buttons.at(-1);
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === event.currentTarget)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <VisualizationViewport
        key={scene.structure}
        scene={scene}
        playbackPosition={playbackPosition}
        expanded={expanded}
        onToggleExpanded={() => setExpanded((value) => !value)}
      />

      <PlaybackControls
        currentStep={currentStep}
        totalSteps={totalSteps}
        isPlaying={isPlaying}
        canPlay={canPlay}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onPlay={onPlay}
        onPause={onPause}
        onNext={onNext}
        onPrevious={onPrevious}
        onReset={onReset}
        speed={speed}
        onCycleSpeed={onCycleSpeed}
        onSeek={onSeek}
      />
    </section>
  );
}

type VisualizationViewportProps = {
  readonly scene: SceneState;
  readonly playbackPosition?: PlaybackPosition | undefined;
  readonly expanded: boolean;
  readonly onToggleExpanded: () => void;
};

function VisualizationViewport({
  scene,
  playbackPosition,
  expanded,
  onToggleExpanded,
}: VisualizationViewportProps) {
  const [zoom, setZoom] = useState(1);
  const changeZoom = (factor: number) =>
    setZoom((current) => clampZoom(current * factor));

  return (
    <>
      <div
        className="visualization-panel-toolbar"
        role="group"
        aria-label="Visualization controls"
      >
        <button
          type="button"
          className="visualization-toolbar-placeholder"
          title="Zoom in"
          aria-label="Zoom in"
          disabled={zoom >= MAX_ZOOM}
          onClick={() => changeZoom(ZOOM_STEP)}
        >
          <ZoomIn className="visualization-toolbar-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="visualization-toolbar-placeholder"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={zoom <= MIN_ZOOM}
          onClick={() => changeZoom(1 / ZOOM_STEP)}
        >
          <ZoomOut className="visualization-toolbar-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="visualization-toolbar-placeholder"
          title={expanded ? 'Collapse visualization' : 'Expand visualization'}
          aria-label={
            expanded ? 'Collapse visualization' : 'Expand visualization'
          }
          aria-expanded={expanded}
          onClick={onToggleExpanded}
        >
          <Maximize2
            className="visualization-toolbar-icon"
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="visualization-panel-canvas">
        <VisualizationZoomContext.Provider value={zoom}>
          <SceneRenderer scene={scene} playbackPosition={playbackPosition} />
        </VisualizationZoomContext.Provider>
      </div>
    </>
  );
}
