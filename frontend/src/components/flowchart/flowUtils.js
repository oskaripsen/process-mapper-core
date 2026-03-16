import { MarkerType } from '@xyflow/react';

export function createStandardEdge(source, target) {
  return {
    id: `e-${source}-${target}-${Date.now()}`,
    source,
    target,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed },
  };
}

export function getNextLogicalId(nodes) {
  const nums = nodes
    .map((n) => Number(String(n.id).replace(/\D/g, '')))
    .filter((n) => !Number.isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return String(next);
}

export function renumberByFlowSequence(nodes) {
  return nodes.map((n, i) => ({ ...n, data: { ...n.data, logicalId: i + 1 } }));
}

export function handleMidStepInsertion({ edge, nodes, setNodes, setEdges }) {
  const newId = getNextLogicalId(nodes);
  const inserted = {
    id: newId,
    type: 'defaultNode',
    position: { x: 200, y: 200 },
    data: { label: 'Inserted step', logicalId: newId },
  };
  setNodes((prev) => [...prev, inserted]);
  setEdges((prev) => {
    const filtered = prev.filter((e) => e.id !== edge.id);
    return [
      ...filtered,
      createStandardEdge(edge.source, newId),
      createStandardEdge(newId, edge.target),
    ];
  });
}

export function showErrorMessage(setError, message) {
  setError(message);
  setTimeout(() => setError(''), 2000);
}

export function getLayoutedElements(nodes, edges) {
  return { nodes, edges };
}
