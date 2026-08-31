import { select } from 'd3';
import { useLayoutEffect, useRef } from 'react';

import { VISUALIZATION_VIEW_BOX_TRANSITION } from './visualizationTransition';

export { VISUALIZATION_TRANSITION_MS } from './visualizationTransition';

type VisualScene = {
  readonly isPlaceholder?: true;
};

export type D3RenderFunction<Scene extends VisualScene> = (
  svg: SVGSVGElement,
  scene: Scene,
) => void;

type D3SceneProps<Scene extends VisualScene> = {
  readonly scene: Scene;
  readonly render: D3RenderFunction<Scene>;
  readonly label: string;
};

export default function D3Scene<Scene extends VisualScene>({
  scene,
  render,
  label,
}: D3SceneProps<Scene>) {
  const svgRef = useRef<SVGSVGElement>(null);

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
    render(svg, scene);
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
  }, [render, scene]);

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
