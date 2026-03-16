import { MarkerType } from '@xyflow/react';

// Helper function to create standardized edges
export const createStandardEdge = (source, target, options = {}) => {
  const {
    id = `e-${source}-${target}-${Date.now()}`,
    isDecision = false,
    condition = '',
    label = isDecision ? (condition || 'Yes/No') : '',
    waypoints = null,
    onWaypointChange = null,
  } = options;

  return {
    id,
    source,
    target,
    type: 'editable', // Use EditableEdge for all edges
    style: {
      strokeWidth: 2,
      stroke: '#3b82f6' // Blue color
    },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
      color: '#b1b1b7',
    },
    label,
    labelStyle: isDecision ? {
      fontSize: 12,
      fontWeight: 'bold',
      fill: '#333'
    } : undefined,
    labelBgStyle: isDecision ? {
      fill: '#fff',
      fillOpacity: 0.8,
      stroke: '#333',
      strokeWidth: 1,
      rx: 4,
      ry: 4
    } : undefined,
    data: {
      waypoints: waypoints || [],
      user_modified_routing: false,
      onWaypointChange: onWaypointChange,
      onLabelChange: isDecision ? (edgeId, newLabel) => {
        // This will be handled by the parent component
      } : undefined,
    },
    reconnectable: true,
  };
};

// Helper function to generate logical IDs
export const getNextLogicalId = (existingNodes) => {
  if (!existingNodes || existingNodes.length === 0) {
    return "1.1.1.1";
  }

  // Find the highest existing logical ID with 1.1.1. prefix
  let maxId = "1.1.1.0";
  for (const node of existingNodes) {
    const logicalId = node.data?.logical_id;
    if (logicalId && logicalId.startsWith("1.1.1.") && logicalId > maxId) {
      maxId = logicalId;
    }
  }

  // Parse and increment
  const parts = maxId.split('.');
  if (parts.length >= 4) {
    try {
      const lastNum = parseInt(parts[parts.length - 1]);
      parts[parts.length - 1] = (lastNum + 1).toString();
      return parts.join('.');
    } catch (e) {
      // Fallback
    }
  }

  return "1.1.1.1";
};

// Helper function to renumber IDs based on flow sequence
export const renumberByFlowSequence = (nodes, edges) => {
  if (!nodes || nodes.length === 0) {
    return nodes;
  }

  // Create a mapping of node IDs to nodes
  const nodeMap = {};
  nodes.forEach(node => {
    nodeMap[node.id] = node;
  });

  // Find start nodes (nodes with no incoming edges)
  const incomingEdges = new Set(edges.map(edge => edge.target));
  const startNodes = nodes.filter(node => !incomingEdges.has(node.id));

  // If no clear start nodes, use the first node
  const actualStartNodes = startNodes.length > 0 ? startNodes : [nodes[0]];

  // Create adjacency list for flow traversal
  const adjacency = {};
  edges.forEach(edge => {
    if (!adjacency[edge.source]) {
      adjacency[edge.source] = [];
    }
    adjacency[edge.source].push(edge.target);
  });

  // Traverse the flow and assign sequential IDs (excluding start/end nodes)
  const visited = new Set();
  const updatedNodes = [];
  let counter = 1;

  const traverseFlow = (nodeId) => {
    if (visited.has(nodeId) || !nodeMap[nodeId]) {
      return;
    }

    visited.add(nodeId);
    const node = { ...nodeMap[nodeId] };

    // Only assign logical IDs to default process steps (not start/end/decision/merge nodes)
    const nodeType = node.type;
    if (nodeType === 'start' || nodeType === 'end' || nodeType === 'decision' || nodeType === 'merge') {
      // Start, end, decision, and merge nodes keep their existing logical_id or get empty
      node.data = { ...node.data, logical_id: node.data?.logical_id || '' };
    } else {
      // Only default process steps get sequential numbering
      node.data = { ...node.data, logical_id: `1.1.1.${counter}` };
      counter++;
    }

    updatedNodes.push(node);

    // Continue to connected nodes
    if (adjacency[nodeId]) {
      adjacency[nodeId].forEach(nextNodeId => {
        traverseFlow(nextNodeId);
      });
    }
  };

  // Start traversal from all start nodes
  actualStartNodes.forEach(startNode => {
    traverseFlow(startNode.id);
  });

  // Handle any remaining unvisited nodes (orphaned nodes)
  nodes.forEach(node => {
    if (!visited.has(node.id)) {
      const updatedNode = { ...node };
      const nodeType = updatedNode.type;
      if (nodeType === 'start' || nodeType === 'end' || nodeType === 'decision' || nodeType === 'merge') {
        // Start, end, decision, and merge nodes keep their existing logical_id or get empty
        updatedNode.data = { ...node.data, logical_id: node.data?.logical_id || '' };
      } else {
        // Only default process steps get sequential numbering
        updatedNode.data = { ...node.data, logical_id: `1.1.1.${counter}` };
        counter++;
      }
      updatedNodes.push(updatedNode);
    }
  });

  return updatedNodes;
};

// Helper function to handle mid-step insertion
export const handleMidStepInsertion = (newNode, targetEdge, nodes, edges) => {
  if (!targetEdge) return { nodes, edges };

  const sourceNode = nodes.find(n => n.id === targetEdge.source);
  const targetNode = nodes.find(n => n.id === targetEdge.target);

  if (!sourceNode || !targetNode) return { nodes, edges };

  // Create the new node with proper positioning
  const newNodeWithPosition = {
    ...newNode,
    position: {
      x: (sourceNode.position.x + targetNode.position.x) / 2,
      y: (sourceNode.position.y + targetNode.position.y) / 2
    }
  };

  // Remove the original edge
  const filteredEdges = edges.filter(e => e.id !== targetEdge.id);

  // Create two new edges: source -> newNode and newNode -> target
  const edge1 = createStandardEdge(targetEdge.source, newNode.id, {
    id: `e-${Date.now()}-1`,
  });

  const edge2 = createStandardEdge(newNode.id, targetEdge.target, {
    id: `e-${Date.now()}-2`,
  });

  // Add the new node and edges
  const newNodes = [...nodes, newNodeWithPosition];
  const newEdges = [...filteredEdges, edge1, edge2];

  // Renumber logical IDs based on new flow sequence
  const renumberedNodes = renumberByFlowSequence(newNodes, newEdges);

  return { nodes: renumberedNodes, edges: newEdges };
};

// Helper function to show error messages with auto-dismiss
export const showErrorMessage = (message, setErrorMessage, setShowError) => {
  setErrorMessage(message);
  setShowError(true);

  // Auto-dismiss after 2 seconds
  setTimeout(() => {
    setShowError(false);
    setTimeout(() => {
      setErrorMessage('');
    }, 300); // Wait for fade-out animation
  }, 2000);
};

// Layout is now handled by backend LayoutService
// This function is deprecated but kept for backward compatibility
// It returns nodes/edges unchanged (layout is applied server-side)
export const getLayoutedElements = (nodes, edges, direction = 'LR') => {
  // Layout is now computed by backend LayoutService
  // Just return nodes/edges with positions preserved
  const layoutedNodes = nodes.map((node) => {
    // If node already has position, keep it
    if (node.position && (node.position.x !== 0 || node.position.y !== 0)) {
      return {
        ...node,
        targetPosition: 'left',
        sourcePosition: 'right',
      };
    }

    // Fallback: position at origin (shouldn't happen if backend provides positions)
    return {
      ...node,
      targetPosition: 'left',
      sourcePosition: 'right',
      position: node.position || { x: 0, y: 0 },
    };
  });

  // Return edges unchanged - they now use EditableEdge with waypoints from backend
  return { nodes: layoutedNodes, edges };
};
