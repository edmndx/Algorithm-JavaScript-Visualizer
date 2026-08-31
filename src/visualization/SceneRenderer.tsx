import type { SceneState } from '../scene';
import D3Scene from './D3Scene';
import { renderArray } from './renderArray';
import { renderGraph } from './renderGraph';
import { renderHashTable } from './renderHashTable';
import { renderLinkedList } from './renderLinkedList';
import { renderMatrix } from './renderMatrix';
import { renderQueue } from './renderQueue';
import { renderStack } from './renderStack';
import { renderTree } from './renderTree';
import { getVisualizationCapacityMessage } from './visualizationLimits';

type SceneRendererProps = {
  readonly scene: SceneState;
};

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
    case 'linked-list':
      return (
        <D3Scene
          key={scene.structure}
          label="Linked-list visualization"
          render={renderLinkedList}
          scene={scene}
        />
      );
    case 'hash-table':
      return (
        <D3Scene
          key={scene.structure}
          label="Hash-table visualization"
          render={renderHashTable}
          scene={scene}
        />
      );
    case 'tree':
      return (
        <D3Scene
          key={scene.structure}
          label="Tree visualization"
          render={renderTree}
          scene={scene}
        />
      );
    case 'graph':
      return (
        <D3Scene
          key={scene.structure}
          label="Graph visualization"
          render={renderGraph}
          scene={scene}
        />
      );
  }
}
