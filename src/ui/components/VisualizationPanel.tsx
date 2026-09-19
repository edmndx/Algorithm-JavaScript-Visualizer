import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import PlaybackControls from './PlaybackControls';

export default function VisualizationPanel() {
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

      <PlaybackControls />
    </section>
  );
}
