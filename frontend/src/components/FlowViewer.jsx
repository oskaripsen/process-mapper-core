import React, { useState, useCallback, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as htmlToImage from 'html-to-image';
import dagre from 'dagre';

// Custom node component for better visualization
const CustomNode = ({ data, isConnectable }) => {
  const getNodeStyle = () => {
    switch (data.type) {
      case 'start':
        return {
          background: '#10b981',
          color: 'white',
          border: '2px solid #059669',
        };
      case 'end':
        return {
          background: '#ef4444',
          color: 'white',
          border: '2px solid #dc2626',
        };
      case 'process':
        return {
          background: 'var(--color-primary)',
          color: 'white',
          border: '2px solid var(--color-primary-hover)',
        };
      case 'decision':
        return {
          background: 'var(--color-accent)',
          color: 'white',
          border: '2px solid var(--color-primary)',
        };
      default:
        return {
          background: 'var(--color-text-secondary)',
          color: 'white',
          border: '2px solid var(--color-text-primary)',
        };
    }
  };

  return (
    <div
      style={{
        padding: '10px 15px',
        borderRadius: '8px',
        fontSize: '14px',
        fontWeight: '500',
        textAlign: 'center',
        minWidth: '120px',
        ...getNodeStyle(),
      }}
    >
      {data.label}
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

// Helper function to convert flow data to ReactFlow format
const convertToReactFlowFormat = (flowData) => {
  if (!flowData || !flowData.nodes || !flowData.edges) {
    return { nodes: [], edges: [] };
  }

  const nodes = flowData.nodes.map((node, index) => ({
    id: node.id || `node-${index}`,
    type: 'custom',
    position: { x: 0, y: 0 }, // Will be calculated by dagre
    data: {
      label: node.label || node.name || `Step ${index + 1}`,
      type: node.type || 'process',
    },
  }));

  const edges = flowData.edges.map((edge, index) => ({
    id: `edge-${index}`,
    source: edge.from || edge.source,
    target: edge.to || edge.target,
    type: 'smoothstep',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      width: 20,
      height: 20,
      color: '#6b7280',
    },
    style: {
      strokeWidth: 2,
      stroke: '#6b7280',
    },
  }));

  return { nodes, edges };
};

// Dagre layout function
const getLayoutedElements = (nodes, edges, direction = 'TB') => {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: direction, ranksep: 50, nodesep: 50 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 150, height: 50 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 75, // Center the node
        y: nodeWithPosition.y - 25,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

const FlowViewer = ({ flow, onClose, onEdit }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [isLoading, setIsLoading] = useState(true);
  const flowRef = useRef(null);

  // Initialize flow data
  React.useEffect(() => {
    if (flow && flow.flow_data) {
      const { nodes: flowNodes, edges: flowEdges } = convertToReactFlowFormat(flow.flow_data);
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(flowNodes, flowEdges);
      
      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      setIsLoading(false);
    }
  }, [flow, setNodes, setEdges]);

  const onSaveAsImage = useCallback(async () => {
    if (flowRef.current) {
      try {
        const dataUrl = await htmlToImage.toPng(flowRef.current, {
          quality: 1,
          pixelRatio: 2,
          backgroundColor: '#ffffff',
        });
        
        const link = document.createElement('a');
        link.download = `${flow.title || 'process-flow'}.png`;
        link.href = dataUrl;
        link.click();
      } catch (error) {
        console.error('Error saving image:', error);
      }
    }
  }, [flow]);

  if (isLoading) {
    return (
      <div className="flow-viewer">
        <div className="loading">Loading flow...</div>
      </div>
    );
  }

  return (
    <div className="flow-viewer">
      <div className="flow-viewer-header">
        <div className="header-left">
          <h3>{flow.title}</h3>
          <p>{flow.description || 'Process flow visualization'}</p>
        </div>
        <div className="header-actions">
          <button 
            className="btn btn-outline"
            onClick={onSaveAsImage}
          >
            📷 Save as Image
          </button>
          {flow.status === 'draft' && onEdit && (
            <button 
              className="btn btn-primary"
              onClick={() => onEdit(flow)}
            >
              ✏️ Edit Flow
            </button>
          )}
          <button 
            className="btn btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      <div className="flow-content">
        <div 
          ref={flowRef}
          style={{ width: '100%', height: '600px', border: '1px solid var(--color-border)', borderRadius: '8px' }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            attributionPosition="bottom-left"
          >
            <Controls />
            <MiniMap />
            <Background variant="dots" gap={12} size={1} />
          </ReactFlow>
        </div>
      </div>

      <div className="flow-metadata">
        <div className="metadata-item">
          <strong>Status:</strong> 
          <span className={`status-badge status-${flow.status}`}>
            {flow.status.replace('_', ' ')}
          </span>
        </div>
        <div className="metadata-item">
          <strong>Version:</strong> {flow.version}
        </div>
        <div className="metadata-item">
          <strong>Created:</strong> {new Date(flow.created_at).toLocaleDateString()}
        </div>
        <div className="metadata-item">
          <strong>Updated:</strong> {new Date(flow.updated_at).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
};

export default FlowViewer;
