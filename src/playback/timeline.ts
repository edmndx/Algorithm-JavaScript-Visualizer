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

const DEFAULT_CHECKPOINT_INTERVAL = 100;
export const TRACE_INITIALIZATION_COMMAND_COUNT = 2;

type TimelineCheckpoint = {
  readonly stepIndex: number;
  readonly scene: SceneState;
};

type TimelineFrame = {
  readonly stepIndex: number;
  readonly scene: SceneState;
};

type TimelineBuildIssue =
  | TraceSemanticIssue
  | {
      readonly commandIndex: number;
      readonly code: SceneReducerErrorCode | 'UNEXPECTED_REDUCER_ERROR';
      readonly message: string;
      readonly source?: TraceSourceLocation;
    };

type TimelineBuildFailure = {
  readonly message: string;
  readonly issues: readonly TimelineBuildIssue[];
};

export type TraceTimeline = {
  readonly commands: readonly TraceCommand[];
  readonly checkpoints: readonly TimelineCheckpoint[];
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
      readonly error: TimelineBuildFailure;
    };

export function buildTimeline(
  commands: readonly TraceCommand[],
): TimelineBuildResult {
  const validation = validateTraceSemantics(commands);

  if (!validation.ok) {
    return {
      ok: false,
      error: {
        message:
          validation.issues[0]?.message ?? 'Timeline construction failed.',
        issues: validation.issues,
      },
    };
  }

  const initializationCommand = commands[0];
  if (initializationCommand?.type !== 'scene.init') {
    throw new Error('A validated timeline is missing scene.init.');
  }

  let scene: SceneState = createInitialScene();
  const checkpoints: TimelineCheckpoint[] = [{ stepIndex: -1, scene }];
  const finalStepIndex = commands.length - 1;

  for (const [commandIndex, command] of commands.entries()) {
    try {
      scene = reduceTraceCommand(scene, command);
    } catch (error: unknown) {
      const issue: TimelineBuildIssue = {
        commandIndex,
        code:
          error instanceof SceneReducerError
            ? error.code
            : 'UNEXPECTED_REDUCER_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'Unknown scene reducer error.',
        ...(command.source === undefined ? {} : { source: command.source }),
      };

      return {
        ok: false,
        error: { message: issue.message, issues: [issue] },
      };
    }

    const isIntervalBoundary =
      (commandIndex + 1) % DEFAULT_CHECKPOINT_INTERVAL === 0;

    if (isIntervalBoundary || commandIndex === finalStepIndex) {
      checkpoints.push({ stepIndex: commandIndex, scene });
    }
  }

  return {
    ok: true,
    timeline: {
      commands,
      checkpoints,
      operationCount: commands.length - TRACE_INITIALIZATION_COMMAND_COUNT,
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

export function getPlaybackSourceLocation(
  timeline: TraceTimeline,
  operationStep: number,
): TraceSourceLocation | null {
  if (operationStep === 0) return null;

  return (
    timeline.commands[operationStep + TRACE_INITIALIZATION_COMMAND_COUNT - 1]
      ?.source ?? null
  );
}

function getFrame(timeline: TraceTimeline, stepIndex: number): TimelineFrame {
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
