import { select } from 'd3';
import { useContext, useLayoutEffect, useRef } from 'react';
import { VisualizationZoomContext } from './viewport';
import { setVisualizationZoom } from './viewBoxTransition';

import { VISUALIZATION_VIEW_BOX_TRANSITION } from './visualizationTransition';

type VisualScene = {
  readonly isPlaceholder?: true;
};

export type D3RenderFunction<Scene extends VisualScene> = (
  svg: SVGSVGElement,
  scene: Scene,
  options?: { readonly animate: boolean },
) => void;

export type PlaybackPosition = {
  readonly sequence: object;
  readonly step: number;
};

type D3SceneProps<Scene extends VisualScene> = {
  readonly scene: Scene;
  readonly render: D3RenderFunction<Scene>;
  readonly label: string;
  readonly playbackPosition?: PlaybackPosition;
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

  // Zoom updates never rerun joins or interrupt item/natural-bound transitions.
  useLayoutEffect(() => {
    if (svgRef.current !== null) setVisualizationZoom(svgRef.current, zoom);
  }, [zoom]);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (svg === null) return;

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
    });
    previousPosition.current = playbackPosition;
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
    />
  );
}
