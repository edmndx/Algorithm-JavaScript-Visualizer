import type { SceneState } from '../scene';
import D3Scene, { type PlaybackPosition } from './D3Scene';
import { renderArray } from './renderArray';
import { renderGraph } from './renderGraph';
import { renderLinkedList } from './renderLinkedList';
import { renderMatrix } from './renderMatrix';
import { renderTree } from './renderTree';
import { getVisualizationCapacityMessage } from './visualizationLimits';

type SceneRendererProps = {
  readonly scene: SceneState;
  readonly playbackPosition?: PlaybackPosition | undefined;
};

export default function SceneRenderer({
  scene,
  playbackPosition,
}: SceneRendererProps) {
  if (scene.structure === null) {
    return (
      <p className="visualization-empty-state">Nothing to visualize yet.</p>
    );
  }

  const capacityMessage = getVisualizationCapacityMessage(scene);
  if (capacityMessage !== null) {
    return <p className="visualization-capacity-message">{capacityMessage}</p>;
  }

  switch (scene.structure) {
    case 'array':
      return (
        <D3Scene
          key={scene.structure}
          label="Array visualization"
          render={renderArray}
          scene={scene}
          playbackPosition={playbackPosition}
        />
      );
    case 'matrix':
      return (
        <D3Scene
          key={scene.structure}
          label="Matrix visualization"
          render={renderMatrix}
          scene={scene}
          playbackPosition={playbackPosition}
        />
      );
    case 'linked-list':
      return (
        <D3Scene
          key={scene.structure}
          label="Linked-list visualization"
          render={renderLinkedList}
          scene={scene}
          playbackPosition={playbackPosition}
        />
      );
    case 'tree':
      return (
        <D3Scene
          key={scene.structure}
          label="Tree visualization"
          render={renderTree}
          scene={scene}
          playbackPosition={playbackPosition}
        />
      );
    case 'graph':
      return (
        <D3Scene
          key={scene.structure}
          label="Graph visualization"
          render={renderGraph}
          scene={scene}
          playbackPosition={playbackPosition}
        />
      );
  }
}
