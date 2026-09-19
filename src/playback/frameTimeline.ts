import { validateFrameTrace, type FrameTrace } from '../protocol/frameTrace';
import {
  createInitialScene,
  reduceTraceCommand,
  reduceTraceFrame,
  type SceneState,
} from '../scene';

type Checkpoint = { readonly position: number; readonly scene: SceneState };

export type FrameTimeline = {
  readonly trace: FrameTrace;
  readonly checkpoints: readonly Checkpoint[];
  readonly operationCount: number;
  readonly structure: FrameTrace['source']['structure'];
};

type BuildResult =
  | { readonly ok: true; readonly timeline: FrameTimeline }
  | { readonly ok: false; readonly message: string };

export function buildFrameTimeline(input: unknown): BuildResult {
  const validation = validateFrameTrace(input);
  if (!validation.ok) return validation;

  const trace = validation.trace;
  try {
    let scene: SceneState = createInitialScene();
    for (const command of trace.initialization)
      scene = reduceTraceCommand(scene, command);

    const checkpoints: Checkpoint[] = [{ position: 0, scene }];
    for (const [index, frame] of trace.frames.entries()) {
      scene = reduceTraceFrame(scene, frame);
      const position = index + 1;
      if (position % 100 === 0 || position === trace.frames.length)
        checkpoints.push({ position, scene });
    }
    return {
      ok: true,
      timeline: {
        trace,
        checkpoints,
        operationCount: trace.frames.length,
        structure: trace.source.structure,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Invalid frame trace.',
    };
  }
}

export function getFrameScene(
  timeline: FrameTimeline,
  position: number,
): SceneState {
  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position > timeline.operationCount
  )
    throw new RangeError('Playback frame is outside the trace.');

  let checkpoint = timeline.checkpoints[0];
  if (checkpoint === undefined)
    throw new Error('Timeline lacks initialization.');
  for (const next of timeline.checkpoints) {
    if (next.position > position) break;
    checkpoint = next;
  }

  let scene = checkpoint.scene;
  for (let index = checkpoint.position; index < position; index++) {
    const frame = timeline.trace.frames[index];
    if (frame === undefined) throw new RangeError('Missing playback frame.');
    scene = reduceTraceFrame(scene, frame);
  }
  return scene;
}

export function getFrameSource(
  timeline: FrameTimeline,
  position: number,
): FrameTrace['frames'][number]['source'] | null {
  if (position === 0) return null;
  if (
    !Number.isInteger(position) ||
    position > timeline.operationCount ||
    position < 0
  )
    throw new RangeError('Playback frame is outside the trace.');
  return timeline.trace.frames[position - 1]?.source ?? null;
}
