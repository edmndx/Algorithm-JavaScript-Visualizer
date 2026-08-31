import type { SceneState } from '../scene';
import D3Scene from './D3Scene';
import { renderArray } from './renderArray';
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
    case 'tree':
    case 'graph':
    case 'stack':
    case 'queue':
    case 'linked-list':
    case 'hash-table':
      return unavailableStructure(scene.structure);
  }
}
