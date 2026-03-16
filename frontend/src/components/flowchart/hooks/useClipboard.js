import { useState } from 'react';

export function useClipboard() {
  const [clipboard, setClipboard] = useState({ nodes: [], edges: [] });

  const copySelected = (nodes, edges) => setClipboard({ nodes, edges });
  const cutSelected = (nodes, edges) => {
    setClipboard({ nodes, edges });
    return { nodesToRemove: nodes.map((n) => n.id), edgesToRemove: edges.map((e) => e.id) };
  };
  const pasteFromClipboard = () => clipboard;

  return { clipboard, copySelected, cutSelected, pasteFromClipboard };
}
