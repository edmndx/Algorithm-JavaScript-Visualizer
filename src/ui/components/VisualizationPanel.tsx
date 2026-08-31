import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import type { SceneState } from '../../scene';
import SceneRenderer from '../../visualization/SceneRenderer';
import PlaybackControls from './PlaybackControls';

type VisualizationPanelProps = {
  readonly scene: SceneState;
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
};

export default function VisualizationPanel({
  scene,
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
}: VisualizationPanelProps) {
  return (
    <section
      className="visualization-panel"
      aria-label="Visualization canvas"
      tabIndex={0}
    >
      <div
        className="visualization-panel-toolbar"
        role="group"
        aria-label="Visualization controls unavailable"
      >
        <span className="visualization-toolbar-placeholder" title="Zoom in">
          <ZoomIn className="visualization-toolbar-icon" aria-hidden="true" />
        </span>
        <span className="visualization-toolbar-placeholder" title="Zoom out">
          <ZoomOut className="visualization-toolbar-icon" aria-hidden="true" />
        </span>
        <span
          className="visualization-toolbar-placeholder"
          title="Fit visualization"
        >
          <Maximize2
            className="visualization-toolbar-icon"
            aria-hidden="true"
          />
        </span>
      </div>

      <div className="visualization-panel-canvas">
        {scene.title !== null || scene.message !== null ? (
          <div className="visualization-scene-metadata">
            {scene.title !== null ? (
              <h2 className="visualization-scene-title">{scene.title}</h2>
            ) : null}
            {scene.message !== null ? (
              <p
                className={`visualization-scene-message visualization-scene-message--${scene.message.level}`}
              >
                {scene.message.text}
              </p>
            ) : null}
          </div>
        ) : null}
        <SceneRenderer scene={scene} />
      </div>

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
      />
    </section>
  );
}
