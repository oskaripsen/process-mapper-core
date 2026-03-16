import React, { useCallback, useEffect, useState } from 'react';
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useAuth } from '../../context/AuthContext';
import { createStandardEdge, getNextLogicalId, showErrorMessage } from './flowUtils';
import { edgeTypes, nodeTypes } from './nodes';
import { useFlowExport } from './hooks/useFlowExport';
import { useFlowHistory } from './hooks/useFlowHistory';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import FlowChartToolbar from './FlowChartToolbar';
import FlowChartModals from './FlowChartModals';

const FlowChart = ({ transcript, onError, selectedProcess, onSaveFlow, flowData }) => {
  const { getToken } = useAuth();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const { downloadJSON } = useFlowExport();
  const { saveToHistory } = useFlowHistory();

  useEffect(() => {
    if (flowData?.nodes || flowData?.edges) {
      setNodes(flowData.nodes || []);
      setEdges(flowData.edges || []);
      saveToHistory({ nodes: flowData.nodes || [], edges: flowData.edges || [] });
    }
  }, [flowData, saveToHistory, setEdges, setNodes]);

  const onConnect = useCallback(
    (params) => setEdges((eds) => addEdge({ ...params, ...createStandardEdge(params.source, params.target) }, eds)),
    [setEdges],
  );

  const addNode = useCallback(
    (type, label) => {
      const id = getNextLogicalId(nodes);
      const node = {
        id,
        type,
        position: { x: 100 + nodes.length * 40, y: 120 + nodes.length * 20 },
        data: { label, logicalId: id },
      };
      setNodes((prev) => [...prev, node]);
    },
    [nodes, setNodes],
  );

  const handleSave = useCallback(async () => {
    try {
      await onSaveFlow?.({ nodes, edges }, selectedProcess?.id, selectedProcess?.name || 'Process');
    } catch (e) {
      showErrorMessage(setErrorMessage, e.message || 'Save failed');
      onError?.(e.message || 'Save failed');
    }
  }, [edges, nodes, onError, onSaveFlow, selectedProcess]);

  const deleteSelected = useCallback(() => {
    setNodes((prev) => prev.filter((n) => !n.selected));
    setEdges((prev) => prev.filter((e) => !e.selected));
  }, [setEdges, setNodes]);

  useKeyboardShortcuts({ onDelete: deleteSelected, onSave: handleSave });

  return (
    <div style={{ height: '70vh', border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <FlowChartToolbar
        onAddStart={() => addNode('startNode', 'Start')}
        onAddStep={() => addNode('defaultNode', 'Step')}
        onAddDecision={() => addNode('decisionNode', 'Decision')}
        onAddEnd={() => addNode('endNode', 'End')}
        onSave={handleSave}
        onExport={() => downloadJSON(nodes, edges)}
      />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
      >
        <MiniMap />
        <Controls />
        <Background />
      </ReactFlow>
      <FlowChartModals errorMessage={errorMessage} onCloseError={() => setErrorMessage('')} />
      {transcript ? <div style={{ padding: 8, fontSize: 12, color: '#6b7280' }}>Transcript loaded.</div> : null}
    </div>
  );
};

export default FlowChart;
