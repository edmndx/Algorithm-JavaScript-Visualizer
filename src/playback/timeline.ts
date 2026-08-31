import {
  createInitialScene,
  reduceTraceCommand,
  SceneReducerError,
  type SceneReducerErrorCode,
  type SceneState,
} from '../scene';
import {
  validateTraceSemantics,
  type TraceSemanticIssue,
} from '../protocol/semanticValidation';
import type { TraceCommand, TraceSourceLocation } from '../protocol/traceTypes';

export const DEFAULT_CHECKPOINT_INTERVAL = 100;
export const TRACE_INITIALIZATION_COMMAND_COUNT = 2;

export type TimelineCheckpoint = {
  readonly stepIndex: number;
  readonly scene: SceneState;
};

export type TimelineFrame = {
  readonly stepIndex: number;
  readonly scene: SceneState;
};

export type TimelineBuildIssue =
  | TraceSemanticIssue
  | {
      readonly commandIndex: number;
      readonly code: SceneReducerErrorCode | 'UNEXPECTED_REDUCER_ERROR';
      readonly message: string;
      readonly source?: TraceSourceLocation;
    };

export class TimelineBuildError extends Error {
  readonly issues: readonly TimelineBuildIssue[];

  constructor(issues: readonly TimelineBuildIssue[]) {
    super(issues[0]?.message ?? 'Timeline construction failed.');

    this.name = 'TimelineBuildError';
    this.issues = issues;
  }
}

export type TraceTimeline = {
  readonly commands: readonly TraceCommand[];
  readonly checkpoints: readonly TimelineCheckpoint[];
  readonly checkpointInterval: number;
  readonly operationCount: number;
  readonly structure: Extract<
    TraceCommand,
    { readonly type: 'scene.init' }
  >['structure'];
};

export type TimelineBuildResult =
  | {
      readonly ok: true;
      readonly timeline: TraceTimeline;
    }
  | {
      readonly ok: false;
      readonly error: TimelineBuildError;
    };

export function buildTimeline(
  commands: readonly TraceCommand[],
  checkpointInterval = DEFAULT_CHECKPOINT_INTERVAL,
): TimelineBuildResult {
  if (!Number.isInteger(checkpointInterval) || checkpointInterval <= 0) {
    throw new RangeError('Checkpoint interval must be a positive integer.');
  }

  const preparedCommands = Object.freeze(structuredClone(commands));
  const validation = validateTraceSemantics(preparedCommands);

  if (!validation.ok) {
    return {
      ok: false,
      error: new TimelineBuildError(validation.issues),
    };
  }

  const initializationCommand = preparedCommands[0];
  if (initializationCommand?.type !== 'scene.init') {
    throw new Error('A validated timeline is missing scene.init.');
  }

  let scene: SceneState = createInitialScene();
  const checkpoints: TimelineCheckpoint[] = [{ stepIndex: -1, scene }];
  const finalStepIndex = preparedCommands.length - 1;

  for (const [commandIndex, command] of preparedCommands.entries()) {
    try {
      scene = reduceTraceCommand(scene, command);
    } catch (error: unknown) {
      return {
        ok: false,
        error: new TimelineBuildError([
          {
            commandIndex,
            code:
              error instanceof SceneReducerError
                ? error.code
                : 'UNEXPECTED_REDUCER_ERROR',
            message:
              error instanceof Error
                ? error.message
                : 'Unknown scene reducer error.',
            source: command.source,
          },
        ]),
      };
    }

    const isIntervalBoundary = (commandIndex + 1) % checkpointInterval === 0;

    if (isIntervalBoundary || commandIndex === finalStepIndex) {
      checkpoints.push({ stepIndex: commandIndex, scene });
    }
  }

  return {
    ok: true,
    timeline: {
      commands: preparedCommands,
      checkpoints,
      checkpointInterval,
      operationCount:
        preparedCommands.length - TRACE_INITIALIZATION_COMMAND_COUNT,
      structure: initializationCommand.structure,
    },
  };
}

export function getPlaybackFrame(
  timeline: TraceTimeline,
  operationStep: number,
): TimelineFrame {
  if (
    !Number.isInteger(operationStep) ||
    operationStep < 0 ||
    operationStep > timeline.operationCount
  ) {
    throw new RangeError(
      `Playback step ${operationStep} is outside the range 0 to ${timeline.operationCount}.`,
    );
  }

  return getFrame(
    timeline,
    operationStep + TRACE_INITIALIZATION_COMMAND_COUNT - 1,
  );
}

export function getTraceInitializationCommands(
  commands: readonly TraceCommand[],
): readonly TraceCommand[] {
  return commands.slice(0, TRACE_INITIALIZATION_COMMAND_COUNT);
}

export function getFrame(
  timeline: TraceTimeline,
  stepIndex: number,
): TimelineFrame {
  assertStepIndex(timeline, stepIndex);

  const checkpoint = findCheckpoint(timeline.checkpoints, stepIndex);
  let scene = checkpoint.scene;

  for (const command of timeline.commands.slice(
    checkpoint.stepIndex + 1,
    stepIndex + 1,
  )) {
    scene = reduceTraceCommand(scene, command);
  }

  return { stepIndex, scene };
}

export function getNextFrame(
  timeline: TraceTimeline,
  currentFrame: TimelineFrame,
): TimelineFrame {
  const nextStepIndex = currentFrame.stepIndex + 1;
  assertStepIndex(timeline, nextStepIndex);

  const command = timeline.commands[nextStepIndex];

  if (command === undefined) {
    throw new Error(`Missing timeline command at step ${nextStepIndex}.`);
  }

  return {
    stepIndex: nextStepIndex,
    scene: reduceTraceCommand(currentFrame.scene, command),
  };
}

function assertStepIndex(timeline: TraceTimeline, stepIndex: number): void {
  const finalStepIndex = timeline.commands.length - 1;

  if (
    !Number.isInteger(stepIndex) ||
    stepIndex < -1 ||
    stepIndex > finalStepIndex
  ) {
    throw new RangeError(
      `Timeline step ${stepIndex} is outside the range -1 to ${finalStepIndex}.`,
    );
  }
}

function findCheckpoint(
  checkpoints: readonly TimelineCheckpoint[],
  stepIndex: number,
): TimelineCheckpoint {
  let lowerBound = 0;
  let upperBound = checkpoints.length - 1;

  while (lowerBound < upperBound) {
    const middle = Math.ceil((lowerBound + upperBound) / 2);
    const checkpoint = checkpoints[middle];

    if (checkpoint !== undefined && checkpoint.stepIndex <= stepIndex) {
      lowerBound = middle;
    } else {
      upperBound = middle - 1;
    }
  }

  const checkpoint = checkpoints[lowerBound];

  if (checkpoint === undefined) {
    throw new Error('Timeline is missing its initial checkpoint.');
  }

  return checkpoint;
}
