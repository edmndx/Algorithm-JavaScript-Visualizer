import type { SceneState } from '../scene';
import D3Scene from './D3Scene';
import { renderArray } from './renderArray';
import { renderMatrix } from './renderMatrix';
import { renderQueue } from './renderQueue';
import { renderStack } from './renderStack';
import { getVisualizationCapacityMessage } from './visualizationLimits';

type SceneRendererProps = {
  readonly scene: SceneState;
};

function unavailableStructure(structure: string) {
  return (
    <p className="visualization-empty-state">
      {structure} visualization is not available yet.
    </p>
  );
}

export default function SceneRenderer({ scene }: SceneRendererProps) {
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
        />
      );
    case 'matrix':
      return (
        <D3Scene
          key={scene.structure}
          label="Matrix visualization"
          render={renderMatrix}
          scene={scene}
        />
      );
    case 'stack':
      return (
        <D3Scene
          key={scene.structure}
          label="Stack visualization"
          render={renderStack}
          scene={scene}
        />
      );
    case 'queue':
      return (
        <D3Scene
          key={scene.structure}
          label="Queue visualization"
          render={renderQueue}
          scene={scene}
        />
      );
    case 'tree':
    case 'graph':
    case 'linked-list':
    case 'hash-table':
      return unavailableStructure(scene.structure);
  }
}
