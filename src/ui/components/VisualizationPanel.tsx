import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import PlaybackControls from './PlaybackControls';

type VisualizationPanelProps = {
  currentStep: number;
  totalSteps: number;
  isPlaying: boolean;
  canPlay: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onReset: () => void;
};

export default function VisualizationPanel({
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
        <div className="visualization-bar-stage" aria-hidden="true" />
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
