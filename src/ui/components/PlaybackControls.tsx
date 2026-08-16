import { Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';

export default function PlaybackControls() {
  return (
    <div className="playback-controls-reveal">
      <div className="playback-controls-shell">
        <div className="playback-controls">
          <div
            className="playback-controls-placeholders"
            role="group"
            aria-label="Playback controls unavailable"
          >
            <span className="playback-control-placeholder" title="Restart">
              <RotateCcw className="playback-control-icon" aria-hidden="true" />
            </span>
            <span className="playback-control-placeholder" title="Step back">
              <SkipBack className="playback-control-icon" aria-hidden="true" />
            </span>
            <span
              className="playback-control-placeholder playback-control-placeholder--primary"
              title="Play"
            >
              <Play className="playback-control-icon" aria-hidden="true" />
            </span>
            <span className="playback-control-placeholder" title="Step forward">
              <SkipForward
                className="playback-control-icon"
                aria-hidden="true"
              />
            </span>
          </div>

          <div className="playback-timeline" aria-hidden="true">
            <div className="playback-timeline-track">
              <div className="playback-timeline-progress" />
            </div>
          </div>

          <div className="playback-status">
            <span>
              <span className="playback-status-current">0</span> / 0
            </span>
            <span className="playback-speed">1.0×</span>
          </div>
        </div>
      </div>
    </div>
  );
}
