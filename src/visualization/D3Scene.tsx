import { select } from 'd3';
import {
  useContext,
  useLayoutEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { VisualizationZoomContext } from './viewport';
import {
  panVisualization,
  resetVisualizationPan,
  setVisualizationZoom,
} from './viewBoxTransition';

import { VISUALIZATION_VIEW_BOX_TRANSITION } from './visualizationTransition';

type VisualScene = {
  readonly isPlaceholder?: true;
};

export type D3RenderFunction<Scene extends VisualScene> = (
  svg: SVGSVGElement,
  scene: Scene,
  context?: RenderContext<Scene>,
) => void;

type RenderContext<Scene extends VisualScene> = {
  readonly animate: boolean;
  readonly previousScene: Scene | null;
};

export type PlaybackPosition = {
  readonly sequence: readonly unknown[];
  readonly step: number;
};

type D3SceneProps<Scene extends VisualScene> = {
  readonly scene: Scene;
  readonly render: D3RenderFunction<Scene>;
  readonly label: string;
  readonly playbackPosition?: PlaybackPosition | undefined;
};

export default function D3Scene<Scene extends VisualScene>({
  scene,
  render,
  label,
  playbackPosition,
}: D3SceneProps<Scene>) {
  const svgRef = useRef<SVGSVGElement>(null);
  const zoom = useContext(VisualizationZoomContext);
  const previousPosition = useRef<PlaybackPosition | undefined>(undefined);
  const previousScene = useRef<Scene | null>(null);
  const previousRender = useRef(render);
  const dragPosition = useRef<{
    readonly pointerId: number;
    readonly x: number;
    readonly y: number;
  } | null>(null);

  const stopDragging = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragPosition.current?.pointerId !== event.pointerId) return;
    dragPosition.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // Zoom updates never rerun joins or interrupt item/natural-bound transitions.
  useLayoutEffect(() => {
    if (svgRef.current !== null) setVisualizationZoom(svgRef.current, zoom);
  }, [zoom]);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;

    if (previousRender.current !== render) {
      resetVisualizationPan(svg);
      previousRender.current = render;
    }

    const selection = select(svg);
    selection.interrupt();
    selection.interrupt(VISUALIZATION_VIEW_BOX_TRANSITION);
    selection.selectAll('*').interrupt();
    if (
      svg.getAttribute('data-visualization-placeholder') === 'true' &&
      scene.isPlaceholder !== true
    ) {
      selection.selectAll('*').remove();
    }
    const previous = previousPosition.current;
    render(svg, scene, {
      animate:
        playbackPosition !== undefined &&
        previous !== undefined &&
        playbackPosition.sequence === previous.sequence &&
        playbackPosition.step === previous.step + 1,
      previousScene: previousScene.current,
    });
    previousPosition.current = playbackPosition;
    previousScene.current = scene;
    if (scene.isPlaceholder === true) {
      svg.setAttribute('data-visualization-placeholder', 'true');
    } else {
      svg.removeAttribute('data-visualization-placeholder');
    }

    return () => {
      selection.interrupt();
      selection.interrupt(VISUALIZATION_VIEW_BOX_TRANSITION);
      selection.selectAll('*').interrupt();
    };
  }, [render, scene, playbackPosition]);

  return (
    <svg
      ref={svgRef}
      aria-label={label}
      className="visualization-svg"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox="0 0 800 500"
      onAuxClick={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragPosition.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
      }}
      onPointerMove={(event) => {
        const previous = dragPosition.current;
        if (previous?.pointerId !== event.pointerId) return;
        event.preventDefault();
        panVisualization(
          event.currentTarget,
          event.clientX - previous.x,
          event.clientY - previous.y,
        );
        dragPosition.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
      }}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onLostPointerCapture={() => {
        dragPosition.current = null;
      }}
    />
  );
}
