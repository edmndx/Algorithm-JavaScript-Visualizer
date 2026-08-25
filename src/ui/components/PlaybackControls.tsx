import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';

type PlaybackControlsProps = {
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

export default function PlaybackControls({
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
}: PlaybackControlsProps) {
  const progress =
    totalSteps === 0 ? 0 : Math.round((currentStep / totalSteps) * 100);
  const isComplete = currentStep === totalSteps && totalSteps > 0;
  const playLabel = isComplete ? 'Replay trace' : 'Play trace';

  return (
    <div className="playback-controls-reveal">
      <div className="playback-controls-shell">
        <div className="playback-controls">
          <div
            className="playback-control-buttons"
            role="group"
            aria-label="Playback controls"
          >
            <button
              className="playback-control-button"
              type="button"
              aria-label="Restart playback"
              title="Restart"
              disabled={!canGoBack}
              onClick={onReset}
            >
              <RotateCcw className="playback-control-icon" aria-hidden="true" />
            </button>
            <button
              className="playback-control-button"
              type="button"
              aria-label="Step back"
              title="Step back"
              disabled={!canGoBack}
              onClick={onPrevious}
            >
              <SkipBack className="playback-control-icon" aria-hidden="true" />
            </button>
            <button
              className="playback-control-button playback-control-button--primary"
              type="button"
              aria-label={isPlaying ? 'Pause playback' : playLabel}
              title={isPlaying ? 'Pause' : isComplete ? 'Replay' : 'Play'}
              disabled={!canPlay}
              onClick={isPlaying ? onPause : onPlay}
            >
              {isPlaying ? (
                <Pause className="playback-control-icon" aria-hidden="true" />
              ) : (
                <Play className="playback-control-icon" aria-hidden="true" />
              )}
            </button>
            <button
              className="playback-control-button"
              type="button"
              aria-label="Step forward"
              title="Step forward"
              disabled={!canGoForward}
              onClick={onNext}
            >
              <SkipForward
                className="playback-control-icon"
                aria-hidden="true"
              />
            </button>
          </div>

          <div
            className="playback-timeline"
            role="progressbar"
            aria-label="Playback progress"
            aria-valuemin={0}
            aria-valuemax={totalSteps}
            aria-valuenow={currentStep}
          >
            <div className="playback-timeline-track">
              <div
                className="playback-timeline-progress"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="playback-status">
            <span>
              <span className="playback-status-current">{currentStep}</span> /{' '}
              {totalSteps}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
