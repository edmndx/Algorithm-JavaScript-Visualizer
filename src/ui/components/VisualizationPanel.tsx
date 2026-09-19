import PlaybackControls from './PlaybackControls';

export default function VisualizationPanel() {
  return (
    <div className="visualization-panel">
      <div className="visualization-panel-toolbar">
        <span>Zoom out</span>
        <span>Zoom in</span>
        <span>Fit</span>
      </div>
      <div className="visualization-panel-placeholder">
        Visualization data will render here.
      </div>
      <PlaybackControls />
    </div>
  );
}