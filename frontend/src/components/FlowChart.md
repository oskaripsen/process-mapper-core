import { API_BASE_URL, authenticatedFetch } from '../config/api';
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  reconnectEdge, // Enables edge reconnection functionality
  MarkerType,
  useReactFlow,
  ReactFlowProvider,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as htmlToImage from 'html-to-image';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import jsPDF from 'jspdf';
import EditableEdge from './edges/EditableEdge';
import FlowChartToolbar from './flowchart/FlowChartToolbar';
import FlowChartModals from './flowchart/FlowChartModals';
import {
  createStandardEdge,
  getLayoutedElements,
  getNextLogicalId,
  handleMidStepInsertion,
  renumberByFlowSequence,
  showErrorMessage,
} from './flowchart/flowUtils';
import { nodeTypes } from './flowchart/nodes';
import { useFlowHistory } from './flowchart/hooks/useFlowHistory';

// Edge types - use EditableEdge for all edges
const edgeTypes = {
  editable: EditableEdge,
  default: EditableEdge,
  smoothstep: EditableEdge,
  step: EditableEdge,
};

const FlowChart = ({ transcript, onError, onNewTranscript, workflowType, initialFlowData, onSaveFlow, processId, flowId, processName, onStartRecording, onUploadDocument, isRecording, isPaused, onPauseRecording, onStopRecording, flowData, onSaveFinalize, selectedProcess, onChangeProcess, isProcessing, processingMessage }) => {
  const { getToken } = useAuth();
  const [nodes, setNodes, onNodesChangeBase] = useNodesState([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState([]);
  const {
    history,
    setHistory,
    historyIndex,
    setHistoryIndex,
    saveToHistory,
    undo,
    redo,
  } = useFlowHistory({ setNodes, setEdges });

  // State declarations
  // Notify ChatPanel when process changes (FlowChart remounts per process via key prop)
  useEffect(() => {
    const pid = selectedProcess?.id || processId;
    if (pid) {
      window.dispatchEvent(new CustomEvent('processChanged', {
        detail: { processId: pid }
      }));
    }
  }, []); // Only on mount — FlowChart remounts when process changes

  const [isGenerating, setIsGenerating] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [selectedTool, setSelectedTool] = useState('select');
  const [isMidStepInsertion, setIsMidStepInsertion] = useState(false);
  const [targetEdgeForInsertion, setTargetEdgeForInsertion] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [showError, setShowError] = useState(false);
  const [selectedEdges, setSelectedEdges] = useState([]);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [isEditingEdge, setIsEditingEdge] = useState(false);
  const [edgeLabel, setEdgeLabel] = useState('');
  const [selectedEdge, setSelectedEdge] = useState(null);
  const [flowType, setFlowType] = useState('simple'); // Default to simple flow
  const [showAddDecisionDropdown, setShowAddDecisionDropdown] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [workshopSession, setWorkshopSession] = useState(null);
  const [accumulatedTranscript, setAccumulatedTranscript] = useState('');
  const [recordingStatus, setRecordingStatus] = useState('idle'); // 'idle', 'recording', 'processing'
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [processingInterval, setProcessingInterval] = useState(null);
  const [aiProcessingStatus, setAiProcessingStatus] = useState('idle'); // 'idle', 'transcribing', 'generating'
  const [lastProcessedTranscript, setLastProcessedTranscript] = useState('');
  const [userEdits, setUserEdits] = useState([]); // Track all user manual edits
  const [validationErrors, setValidationErrors] = useState([]); // Track validation errors from backend
  const [aiPatchHistory, setAiPatchHistory] = useState([]); // Track AI patches separately for AI-specific undo
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false); // Three-dot menu next to Save
  const [clipboard, setClipboard] = useState({ nodes: [], edges: [] }); // For copy/paste
  const [sopExportStatus, setSopExportStatus] = useState('idle'); // 'idle', 'loading', 'success'
  const [sopUploadStatus, setSopUploadStatus] = useState('idle'); // 'idle', 'uploading', 'success', 'error'
  const [sopUploadError, setSopUploadError] = useState(null); // { message, trackedChanges, comments }
  const [sopSyncSummary, setSopSyncSummary] = useState(null); // { sync_summary, sync_details }
  const [sopStatus, setSopStatus] = useState(null);
  const [sopDraftUrl, setSopDraftUrl] = useState(null);
  const [sopFinalUrl, setSopFinalUrl] = useState(null);
  const [sopFinalPdfUrl, setSopFinalPdfUrl] = useState(null);
  const [sopStatusLoading, setSopStatusLoading] = useState(false);
  const [sopHasRecordingData, setSopHasRecordingData] = useState(false);
  const [sopGeneratedAt, setSopGeneratedAt] = useState(null);
  const [sopFinalizedAt, setSopFinalizedAt] = useState(null);
  const [sopFlowOutOfSync, setSopFlowOutOfSync] = useState(false);
  const [sopFlowLastSyncedAt, setSopFlowLastSyncedAt] = useState(null);
  const [showSopOutOfSyncModal, setShowSopOutOfSyncModal] = useState(false);
  const [showSopDropdown, setShowSopDropdown] = useState(false);
  const [showSopEditModal, setShowSopEditModal] = useState(false);
  const [showSopRemoveConfirm, setShowSopRemoveConfirm] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versionHistory, setVersionHistory] = useState([]);
  const [versionHistoryLoading, setVersionHistoryLoading] = useState(false);
  const [versionHistoryError, setVersionHistoryError] = useState('');
  const [restoringVersionId, setRestoringVersionId] = useState(null);
  const [viewingVersion, setViewingVersion] = useState(null); // { version_number, created_at, nodes, edges }
  const [savedCurrentState, setSavedCurrentState] = useState(null); // Save current state when viewing
  
  // Screenshot browser modal state
  const [screenshotModalOpen, setScreenshotModalOpen] = useState(false);
  const [screenshotModalNodeId, setScreenshotModalNodeId] = useState(null);
  const [screenshotModalNodeLabel, setScreenshotModalNodeLabel] = useState('');
  const [screenshotModalCurrentUrl, setScreenshotModalCurrentUrl] = useState(null);
  const [allScreenshots, setAllScreenshots] = useState([]); // All screenshots from recording_metadata
  const [recordingMetadata, setRecordingMetadata] = useState(null); // Store recording_metadata to preserve on save
  
  const flowRef = useRef(null);
  const reactFlowInstance = useRef(null); // Store ReactFlow instance for viewport access
  const currentNodesRef = useRef([]);
  const currentEdgesRef = useRef([]);
  const originalNodesRef = useRef(new Map()); // Track original node state for detecting changes
  const shiftKeyRef = useRef(false); // Track if Shift is pressed to block movement during resize
  const sopUploadRef = useRef(null);

  // Store ReactFlow instance on init
  const onInit = useCallback((instance) => {
    reactFlowInstance.current = instance;
  }, []);

  // Helper to get the center of the current viewport for new node placement
  const getViewportCenter = useCallback(() => {
    if (!reactFlowInstance.current || !flowRef.current) {
      // Fallback if no instance
      return { x: 400, y: 300 };
    }
    
    const instance = reactFlowInstance.current;
    const { x, y, zoom } = instance.getViewport();
    const containerBounds = flowRef.current.getBoundingClientRect();
    
    // Calculate center of viewport in flow coordinates
    const centerX = (-x + containerBounds.width / 2) / zoom;
    const centerY = (-y + containerBounds.height / 2) / zoom;
    
    // Add small random offset to prevent exact overlap when adding multiple nodes
    const offsetX = (Math.random() - 0.5) * 50;
    const offsetY = (Math.random() - 0.5) * 50;
    
    return { x: centerX + offsetX, y: centerY + offsetY };
  }, []);

  // Handler for edge waypoint changes (from EditableEdge drag)
  const handleWaypointChange = useCallback((edgeId, newWaypoints, bendX, bendY = null) => {
    setEdges((eds) =>
      eds.map((edge) => {
        if (edge.id === edgeId) {
          return {
            ...edge,
            data: {
              ...edge.data,
              waypoints: newWaypoints,
              bendX: bendX,
              bendY: bendY,
              user_modified_routing: true,
            },
          };
        }
        return edge;
      })
    );
  }, [setEdges]);

  // Version History Functions
  const fetchVersionHistory = useCallback(async () => {
    if (!flowId) return;
    setVersionHistoryLoading(true);
    setVersionHistoryError('');
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-flows/${flowId}/versions`,
        { method: 'GET' },
        getToken
      );
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to load versions');
      }
      const data = await response.json();
      setVersionHistory(data || []);
    } catch (err) {
      setVersionHistoryError(err.message || 'Failed to load versions');
    } finally {
      setVersionHistoryLoading(false);
    }
  }, [flowId, getToken]);

  const handleRestoreVersion = useCallback(
    async (versionNumber) => {
      if (!flowId || !versionNumber || restoringVersionId) return;
      setRestoringVersionId(versionNumber);
      setVersionHistoryError('');
      try {
        const response = await authenticatedFetch(
          `${API_BASE_URL}/api/process-flows/${flowId}/versions/${versionNumber}/restore`,
          { method: 'POST' },
          getToken
        );
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.detail || 'Failed to restore version');
        }
        const data = await response.json();
        const restoredFlow = data.flow_data || {};
        const restoredNodes = restoredFlow.nodes || [];
        const restoredEdges = restoredFlow.edges || [];
        setNodes(restoredNodes);
        setEdges(restoredEdges);
        setHistory([{ nodes: restoredNodes, edges: restoredEdges, timestamp: Date.now() }]);
        setHistoryIndex(0);
        setShowVersionHistory(false);
        setViewingVersion(null);
        setSavedCurrentState(null);

        // Restoring a version may also restore SOP state on the backend
        const targetProcessId = getTargetProcessId();
        if (targetProcessId) {
          await fetchSopStatus(targetProcessId);
        }
      } catch (err) {
        setVersionHistoryError(err.message || 'Failed to restore version');
      } finally {
        setRestoringVersionId(null);
      }
    },
    [flowId, getToken, restoringVersionId, setNodes, setEdges, fetchSopStatus]
  );

  // View a version without restoring (preview mode)
  const handleViewVersion = useCallback(
    async (version) => {
      if (!flowId) return;
      try {
        // Save current state if not already viewing
        if (!viewingVersion) {
          setSavedCurrentState({ nodes: [...nodes], edges: [...edges] });
        }
        
        // Fetch the version data
        const response = await authenticatedFetch(
          `${API_BASE_URL}/api/process-flows/${flowId}/versions/${version.version_number}/data`,
          { method: 'GET' },
          getToken
        );
        
        if (!response.ok) {
          // If endpoint doesn't exist, we can still use the counts we have
          // For now, let's just load from what we have in version history
          // We need the full flow_data - let's fetch it differently
          throw new Error('Version data not available');
        }
        
        const data = await response.json();
        const payload = data.flow_data || data; // backward compatible
        const versionNodes = payload.nodes || [];
        const versionEdges = payload.edges || [];
        
        setNodes(versionNodes);
        setEdges(versionEdges);
        setViewingVersion({
          version_number: version.version_number,
          created_at: version.created_at,
          sop_url: data.sop_url || version.sop_url || null,
          version_type: data.version_type || version.version_type || null
        });
        setShowVersionHistory(false);
      } catch (err) {
        // Fallback: just close the modal and show error
        setVersionHistoryError('Could not load version preview: ' + err.message);
      }
    },
    [flowId, getToken, viewingVersion, nodes, edges, setNodes, setEdges]
  );

  // Exit view mode and restore current state
  const handleExitViewMode = useCallback(() => {
    if (savedCurrentState) {
      setNodes(savedCurrentState.nodes);
      setEdges(savedCurrentState.edges);
    }
    setViewingVersion(null);
    setSavedCurrentState(null);
  }, [savedCurrentState, setNodes, setEdges]);

  // Fetch version history when modal opens
  React.useEffect(() => {
    if (showVersionHistory && flowId) {
      fetchVersionHistory();
    }
  }, [showVersionHistory, flowId, fetchVersionHistory]);

  // Inject waypoint handler and calculate edge offsets for overlapping edges
  React.useEffect(() => {
    setEdges((eds) => {
      // Group edges by target node to calculate offsets for edges entering the same node
      const edgesByTarget = {};
      eds.forEach((edge) => {
        if (!edgesByTarget[edge.target]) {
          edgesByTarget[edge.target] = [];
        }
        edgesByTarget[edge.target].push(edge.id);
      });
      
      // Also group by source for edges leaving the same node
      const edgesBySource = {};
      eds.forEach((edge) => {
        if (!edgesBySource[edge.source]) {
          edgesBySource[edge.source] = [];
        }
        edgesBySource[edge.source].push(edge.id);
      });
      
      return eds.map((edge) => {
        // Calculate target offset (for multiple edges entering same node)
        const targetEdges = edgesByTarget[edge.target] || [];
        const targetIndex = targetEdges.indexOf(edge.id);
        const targetCount = targetEdges.length;
        const targetOffset = targetCount > 1 
          ? (targetIndex - (targetCount - 1) / 2) * 15 
          : 0;
        
        // Calculate source offset (for multiple edges leaving same node)
        const sourceEdges = edgesBySource[edge.source] || [];
        const sourceIndex = sourceEdges.indexOf(edge.id);
        const sourceCount = sourceEdges.length;
        const sourceOffset = sourceCount > 1 
          ? (sourceIndex - (sourceCount - 1) / 2) * 15 
          : 0;
        
        return {
          ...edge,
          data: {
            ...edge.data,
            onWaypointChange: handleWaypointChange,
            targetOffset: targetOffset,
            sourceOffset: sourceOffset,
            targetEdgeCount: targetCount,
            sourceEdgeCount: sourceCount,
          },
        };
      });
    });
  }, [handleWaypointChange, edges.length]);

  // Handle initial flow data from document upload
  React.useEffect(() => {
    if (initialFlowData && initialFlowData.nodes && initialFlowData.edges) {
      console.log('Loading initial flow data from document upload:', initialFlowData);
      setNodes(initialFlowData.nodes || []);
      setEdges(initialFlowData.edges || []);
    }
  }, [initialFlowData]);

  // Extract screenshots and preserve recording_metadata when flow data is loaded
  React.useEffect(() => {
    const flowDataSource = initialFlowData || flowData;
    if (flowDataSource?.recording_metadata) {
      console.log('📸 Loading recording_metadata:', {
        screenshots: flowDataSource.recording_metadata.screenshots?.length || 0,
        session_id: flowDataSource.recording_metadata.session_id
      });
      setRecordingMetadata(flowDataSource.recording_metadata);
      if (flowDataSource.recording_metadata.screenshots) {
        setAllScreenshots(flowDataSource.recording_metadata.screenshots);
      }
    }
  }, [initialFlowData, flowData]);

  // Handle incremental flow data updates (from voice input)
  React.useEffect(() => {
    if (flowData && flowData.nodes && flowData.edges) {
      console.log('🔄 Loading flow data update:', {
        nodeCount: flowData.nodes.length,
        edgeCount: flowData.edges.length,
        nodes: flowData.nodes.map(n => ({ id: n.id, label: n.data?.label }))
      });
      setNodes(flowData.nodes || []);
      setEdges(flowData.edges || []);

      // Force a small delay to ensure React Flow updates
      setTimeout(() => {
        console.log('✅ Flow data applied, current nodes:', nodes.length);
      }, 100);
    }
  }, [flowData]);

  // Debug logging for flow visibility
  React.useEffect(() => {
    console.log('FlowChart render state:', {
      nodesCount: nodes.length,
      edgesCount: edges.length,
      isMaximized,
      workflowType,
      transcript: transcript?.substring(0, 50) + '...',
      flowData: !!flowData,
      initialFlowData: !!initialFlowData,
      initialFlowDataNodes: initialFlowData?.nodes?.length,
      initialFlowDataEdges: initialFlowData?.edges?.length
    });
  }, [nodes.length, edges.length, isMaximized, workflowType, transcript, flowData, initialFlowData]);
  
  // Compute topology errors for nodes
  // Process nodes should have at least one outgoing edge (unless they lead to END)
  const topologyErrors = useMemo(() => {
    const errors = new Set();
    
    if (nodes.length === 0) return errors;
    
    // Build outgoing edge count for each node
    const outgoingCount = {};
    const incomingCount = {};
    nodes.forEach(n => {
      outgoingCount[n.id] = 0;
      incomingCount[n.id] = 0;
    });
    
    edges.forEach(e => {
      if (outgoingCount[e.source] !== undefined) {
        outgoingCount[e.source]++;
      }
      if (incomingCount[e.target] !== undefined) {
        incomingCount[e.target]++;
      }
    });
    
    // Check each node for topology errors
    nodes.forEach(node => {
      // Get the React Flow node type (used for rendering)
      const rfNodeType = node.type || 'default';
      // Get the semantic node type from data (process, decision, etc.)
      const dataType = node.data?.type || 'process';
      
      // Process nodes (default RF type with process/default data type) should have at least 1 outgoing edge
      // Exclude end nodes - they shouldn't have outgoing edges
      if (rfNodeType === 'default' && dataType !== 'end') {
        if (outgoingCount[node.id] === 0) {
          console.log(`🔴 Topology error: Process node "${node.data?.label?.substring(0, 30)}..." has no outgoing edges`);
          errors.add(node.id);
        }
      }
      
      // Decision nodes should have 2-4 outgoing edges
      if (rfNodeType === 'decision' || dataType === 'decision') {
        if (outgoingCount[node.id] < 2) {
          console.log(`🔴 Topology error: Decision node "${node.data?.label?.substring(0, 30)}..." has ${outgoingCount[node.id]} outgoing edges (needs 2+)`);
          errors.add(node.id);
        }
      }
      
      // Check for missing incoming edges (except start nodes)
      // Process nodes, decision nodes, merge nodes, and end nodes should have at least 1 incoming edge
      if (rfNodeType !== 'start' && dataType !== 'start') {
        if (incomingCount[node.id] === 0) {
          console.log(`🔴 Topology error: Node "${node.data?.label?.substring(0, 30)}..." has no incoming edges`);
          errors.add(node.id);
        }
      }
    });
    
    if (errors.size > 0) {
      console.log(`📊 Total topology errors: ${errors.size}`);
    }
    
    return errors;
  }, [nodes, edges]);
  
  // Track nodes connected to selected edge for highlighting
  const selectedEdgeConnections = useMemo(() => {
    if (!selectedEdge) return { source: null, target: null };
    return {
      source: selectedEdge.source,
      target: selectedEdge.target,
    };
  }, [selectedEdge]);
  
  // Callback for nodes to update their data through proper React state
  const handleNodeDataChange = useCallback((nodeId, updates) => {
    setNodes(prevNodes => prevNodes.map(node => {
      if (node.id !== nodeId) return node;
      return {
        ...node,
        data: {
          ...node.data,
          ...updates,
          user_modified: true
        }
      };
    }));
  }, [setNodes]);

  // Screenshot click handler - opens the screenshot browser modal
  const handleScreenshotClick = useCallback((nodeId, currentUrl, nodeLabel) => {
    setScreenshotModalNodeId(nodeId);
    setScreenshotModalNodeLabel(nodeLabel || 'Untitled Node');
    setScreenshotModalCurrentUrl(currentUrl);
    setScreenshotModalOpen(true);
  }, []);

  // Screenshot change handler - updates the node's screenshot_url
  // storageKey: raw R2 key for persistence (e.g. "flows/abc/screenshots/def.png")
  // displayUrl: optional signed URL for immediate display in the modal
  const handleScreenshotChange = useCallback((nodeId, storageKey, displayUrl) => {
    // Prefer the signed display URL so the image is immediately loadable when
    // the modal is reopened (raw keys are not valid image URLs).
    // The backend re-signs on load via sign_flow_data → _extract_key, so storing
    // a signed URL here is safe and will be refreshed on every flow fetch.
    const urlToStore = displayUrl || storageKey;
    setNodes(prevNodes => prevNodes.map(node => {
      if (node.id !== nodeId) return node;
      return {
        ...node,
        data: {
          ...node.data,
          screenshot_url: urlToStore,
          screenshotUrl: urlToStore, // Keep both for compatibility
          user_modified: true
        }
      };
    }));
    setScreenshotModalCurrentUrl(urlToStore);
  }, [setNodes]);

  // Close screenshot modal
  const handleCloseScreenshotModal = useCallback(() => {
    setScreenshotModalOpen(false);
    setScreenshotModalNodeId(null);
    setScreenshotModalNodeLabel('');
    setScreenshotModalCurrentUrl(null);
  }, []);

  // Navigate to a different node in the screenshot modal (for flow navigation)
  const handleNavigateToNode = useCallback((targetNodeId) => {
    const targetNode = nodes.find(n => n.id === targetNodeId);
    if (!targetNode) return;
    
    // Update modal to show the target node
    setScreenshotModalNodeId(targetNodeId);
    setScreenshotModalNodeLabel(targetNode.data?.label || 'Untitled Node');
    setScreenshotModalCurrentUrl(targetNode.data?.screenshot_url || targetNode.data?.screenshotUrl || null);
  }, [nodes]);

  // Start flow view from the first node in the flow
  const handleStartFlowView = useCallback(() => {
    if (nodes.length === 0 || edges.length === 0) return;
    
    // Find the start node or first node with no incoming edges
    const incomingEdgeTargets = new Set(edges.map(e => e.target));
    let firstNode = nodes.find(n => n.type === 'start' || n.data?.type === 'start');
    
    if (!firstNode) {
      // Find first node with no incoming edges (excluding merge nodes)
      firstNode = nodes.find(n => {
        const nodeType = n.type || n.data?.type;
        return !incomingEdgeTargets.has(n.id) && nodeType !== 'merge';
      });
    }
    
    if (!firstNode) {
      // Just use the first process/decision node
      firstNode = nodes.find(n => {
        const nodeType = n.type || n.data?.type;
        return nodeType === 'default' || nodeType === 'process' || nodeType === 'decision' || !nodeType;
      });
    }
    
    if (!firstNode && nodes.length > 0) {
      firstNode = nodes[0];
    }
    
    if (firstNode) {
      // Skip start node and go to first actual step
      if (firstNode.type === 'start' || firstNode.data?.type === 'start') {
        const outgoing = edges.filter(e => e.source === firstNode.id);
        if (outgoing.length > 0) {
          const nextNode = nodes.find(n => n.id === outgoing[0].target);
          if (nextNode) {
            firstNode = nextNode;
          }
        }
      }
      
      setScreenshotModalNodeId(firstNode.id);
      setScreenshotModalNodeLabel(firstNode.data?.label || 'Untitled Node');
      setScreenshotModalCurrentUrl(firstNode.data?.screenshot_url || firstNode.data?.screenshotUrl || null);
      setScreenshotModalOpen(true);
    }
  }, [nodes, edges]);
  
  // Inject topology error, edge connection info, and callbacks into nodes for rendering
  const nodesWithTopologyErrors = useMemo(() => {
    return nodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        hasTopologyError: topologyErrors.has(node.id),
        isEdgeConnected: node.id === selectedEdgeConnections.source || node.id === selectedEdgeConnections.target,
        isEdgeSource: node.id === selectedEdgeConnections.source,
        isEdgeTarget: node.id === selectedEdgeConnections.target,
        onDataChange: handleNodeDataChange,
        onScreenshotClick: handleScreenshotClick,
      },
    }));
  }, [nodes, topologyErrors, selectedEdgeConnections, handleNodeDataChange, handleScreenshotClick]);

  // Force React Flow to update dimensions when nodes change
  React.useEffect(() => {
    if (nodes.length > 0) {
      // Small delay to ensure DOM is updated
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [nodes.length]);

  // Helper functions for clipboard operations
  const getSelectedNodes = useCallback(() => {
    return nodes.filter(node => node.selected);
  }, [nodes]);

  const copySelected = useCallback(() => {
    const selectedNodes = getSelectedNodes();
    if (selectedNodes.length === 0) return;
    
    // Copy selected nodes and their connecting edges
    const selectedNodeIds = new Set(selectedNodes.map(n => n.id));
    const selectedEdgesCopy = edges.filter(e => 
      selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target)
    );
    
    setClipboard({
      nodes: JSON.parse(JSON.stringify(selectedNodes)),
      edges: JSON.parse(JSON.stringify(selectedEdgesCopy))
    });
    console.log(`📋 Copied ${selectedNodes.length} nodes and ${selectedEdgesCopy.length} edges`);
  }, [nodes, edges, getSelectedNodes]);

  const pasteFromClipboard = useCallback(() => {
    if (clipboard.nodes.length === 0) return;
    
    // Create new IDs and offset positions
    const idMapping = {};
    const offset = { x: 50, y: 50 };
    
    const newNodes = clipboard.nodes.map(node => {
      const newId = uuidv4();
      idMapping[node.id] = newId;
      return {
        ...node,
        id: newId,
        position: {
          x: node.position.x + offset.x,
          y: node.position.y + offset.y
        },
        selected: true,
        data: {
          ...node.data,
          user_modified: true
        }
      };
    });
    
    const newEdges = clipboard.edges.map(edge => ({
      ...edge,
      id: `e-${idMapping[edge.source]}-${idMapping[edge.target]}-${Date.now()}`,
      source: idMapping[edge.source],
      target: idMapping[edge.target]
    }));
    
    // Deselect existing nodes and add new ones
    const updatedNodes = nodes.map(n => ({ ...n, selected: false }));
    const finalNodes = [...updatedNodes, ...newNodes];
    const finalEdges = [...edges, ...newEdges];
    
    setNodes(finalNodes);
    setEdges(finalEdges);
    saveToHistory(finalNodes, finalEdges);
    console.log(`📋 Pasted ${newNodes.length} nodes and ${newEdges.length} edges`);
  }, [clipboard, nodes, edges, setNodes, setEdges]);

  const cutSelected = useCallback(() => {
    copySelected();
    deleteSelected();
  }, [copySelected]);

  const duplicateSelected = useCallback(() => {
    const selectedNodes = getSelectedNodes();
    if (selectedNodes.length === 0) return;
    
    // Create duplicates with new IDs and offset positions
    const idMapping = {};
    const offset = { x: 50, y: 50 };
    
    const duplicatedNodes = selectedNodes.map(node => {
      const newId = uuidv4();
      idMapping[node.id] = newId;
      return {
        ...node,
        id: newId,
        position: {
          x: node.position.x + offset.x,
          y: node.position.y + offset.y
        },
        selected: true,
        data: {
          ...node.data,
          user_modified: true
        }
      };
    });
    
    // Duplicate edges between selected nodes
    const selectedNodeIds = new Set(selectedNodes.map(n => n.id));
    const duplicatedEdges = edges
      .filter(e => selectedNodeIds.has(e.source) && selectedNodeIds.has(e.target))
      .map(edge => ({
        ...edge,
        id: `e-${idMapping[edge.source]}-${idMapping[edge.target]}-${Date.now()}`,
        source: idMapping[edge.source],
        target: idMapping[edge.target]
      }));
    
    // Deselect existing nodes and add duplicates
    const updatedNodes = nodes.map(n => ({ ...n, selected: false }));
    const finalNodes = [...updatedNodes, ...duplicatedNodes];
    const finalEdges = [...edges, ...duplicatedEdges];
    
    setNodes(finalNodes);
    setEdges(finalEdges);
    saveToHistory(finalNodes, finalEdges);
    console.log(`📋 Duplicated ${duplicatedNodes.length} nodes`);
  }, [nodes, edges, getSelectedNodes, setNodes, setEdges]);

  const selectAllNodes = useCallback(() => {
    const newNodes = nodes.map(node => ({ ...node, selected: true }));
    setNodes(newNodes);
  }, [nodes, setNodes]);

  // Resize selected nodes by a delta amount
  const resizeSelectedNodes = useCallback((deltaWidth, deltaHeight) => {
    const selectedNodes = getSelectedNodes();
    if (selectedNodes.length === 0) return;
    
    const newNodes = nodes.map(node => {
      if (!node.selected) return node;
      
      // Get current dimensions or use defaults
      const currentWidth = node.data?.width || node.width || 160;
      const currentHeight = node.data?.height || node.height || 100;
      
      // Calculate new dimensions with min constraints
      const newWidth = Math.max(80, currentWidth + deltaWidth);
      const newHeight = Math.max(50, currentHeight + deltaHeight);
      
      return {
        ...node,
        data: {
          ...node.data,
          width: newWidth,
          height: newHeight,
          user_modified: true
        },
        style: {
          ...node.style,
          width: newWidth,
          height: newHeight
        }
      };
    });
    
    setNodes(newNodes);
    console.log(`📐 Resized ${selectedNodes.length} node(s) by ${deltaWidth}x${deltaHeight}`);
  }, [nodes, getSelectedNodes, setNodes]);

  // Keyboard shortcuts
  React.useEffect(() => {
    const handleKeyDown = (e) => {
      // Skip if user is typing in an input or textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        // Only allow Escape in inputs
        if (e.key !== 'Escape') return;
      }
      
      // Check if Ctrl (Windows/Linux) or Cmd (Mac) is pressed
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Undo: Ctrl+Z or Cmd+Z
      if (isCtrlOrCmd && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Ctrl+Shift+Z or Cmd+Shift+Z
      if (isCtrlOrCmd && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redo();
        return;
      }

      // Alternative Redo: Ctrl+Y or Cmd+Y
      if (isCtrlOrCmd && e.key === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      // Duplicate: Ctrl+D or Cmd+D
      if (isCtrlOrCmd && e.key === 'd') {
        e.preventDefault();
        duplicateSelected();
        return;
      }

      // Select All: Ctrl+A or Cmd+A
      if (isCtrlOrCmd && e.key === 'a') {
        e.preventDefault();
        selectAllNodes();
        return;
      }

      // Copy: Ctrl+C or Cmd+C
      if (isCtrlOrCmd && e.key === 'c') {
        e.preventDefault();
        copySelected();
        return;
      }

      // Paste: Ctrl+V or Cmd+V
      if (isCtrlOrCmd && e.key === 'v') {
        e.preventDefault();
        pasteFromClipboard();
        return;
      }

      // Cut: Ctrl+X or Cmd+X
      if (isCtrlOrCmd && e.key === 'x') {
        e.preventDefault();
        cutSelected();
        return;
      }

      // Save: Ctrl+S or Cmd+S
      if (isCtrlOrCmd && e.key === 's') {
        e.preventDefault();
        // keydown handler isn't async; fire-and-forget
        handleSaveFlow()
          .then(() => console.log('💾 Flow saved'))
          .catch((err) => console.error('Failed to save flow:', err));
        return;
      }

      // Delete: Delete or Backspace
      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Don't delete if typing in an input
        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA' && !e.target.isContentEditable) {
          e.preventDefault();
          deleteSelected();
        }
        return;
      }

      // Escape: Deselect all
      if (e.key === 'Escape') {
        setNodes(prev => prev.map(n => ({ ...n, selected: false })));
        setSelectedEdges([]);
        setSelectedEdge(null);
        return;
      }

      // Shift+Arrow keys: Resize selected nodes (prevent ALL movement)
      // When Shift is held, arrow keys should ONLY resize, never move
      if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        // Set shiftKeyRef immediately to block any position changes
        shiftKeyRef.current = true;
        
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        const selectedNodes = nodes.filter(n => n.selected);
        if (selectedNodes.length === 0) return;
        
        const resizeStep = 10; // pixels per key press
        
        if (e.key === 'ArrowUp') {
          resizeSelectedNodes(0, -resizeStep); // Decrease height
        } else if (e.key === 'ArrowDown') {
          resizeSelectedNodes(0, resizeStep); // Increase height
        } else if (e.key === 'ArrowLeft') {
          resizeSelectedNodes(-resizeStep, 0); // Decrease width
        } else if (e.key === 'ArrowRight') {
          resizeSelectedNodes(resizeStep, 0); // Increase width
        }
        return;
      }
      
      // Arrow keys WITHOUT Shift: Move selected nodes
      if (!e.shiftKey && !isCtrlOrCmd && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const selectedNodes = nodes.filter(n => n.selected);
        if (selectedNodes.length === 0) return;
        
        e.preventDefault();
        
        const moveStep = 10; // pixels per key press
        let deltaX = 0;
        let deltaY = 0;
        
        if (e.key === 'ArrowUp') deltaY = -moveStep;
        else if (e.key === 'ArrowDown') deltaY = moveStep;
        else if (e.key === 'ArrowLeft') deltaX = -moveStep;
        else if (e.key === 'ArrowRight') deltaX = moveStep;
        
        // Move all selected nodes
        setNodes(prevNodes => prevNodes.map(node => {
          if (!node.selected) return node;
          return {
            ...node,
            position: {
              x: node.position.x + deltaX,
              y: node.position.y + deltaY
            },
            data: {
              ...node.data,
              user_modified: true
            }
          };
        }));
        return;
      }
    };

    // Track shift key state for blocking position changes during resize
    const handleKeyUp = (e) => {
      if (e.key === 'Shift' || !e.shiftKey) {
        shiftKeyRef.current = false;
      }
    };
    
    const handleKeyDownWithShiftTracking = (e) => {
      // Track shift state from any event where shift is pressed
      if (e.shiftKey || e.key === 'Shift') {
        shiftKeyRef.current = true;
      }
      handleKeyDown(e);
    };

    // Use capture phase to intercept before React Flow handles arrow keys
    window.addEventListener('keydown', handleKeyDownWithShiftTracking, true);
    window.addEventListener('keyup', handleKeyUp, true);

    return () => {
      window.removeEventListener('keydown', handleKeyDownWithShiftTracking, true);
      window.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [historyIndex, history, nodes, edges, clipboard, duplicateSelected, selectAllNodes, copySelected, pasteFromClipboard, cutSelected, onSaveFlow, resizeSelectedNodes]);

  const revertLastAIChange = () => {
    if (aiPatchHistory.length === 0) {
      showErrorMessage('No AI changes to revert', setErrorMessage, setShowError);
      return;
    }

    // Get the state before the last AI change
    const previousState = aiPatchHistory[aiPatchHistory.length - 1];

    console.log('⏪ Reverting last AI change, restoring:', {
      nodeCount: previousState.nodes.length,
      edgeCount: previousState.edges.length,
      aiHistoryLength: aiPatchHistory.length
    });

    // Restore the previous state
    setNodes(previousState.nodes);
    setEdges(previousState.edges);

    // Save to general history so manual undo works correctly after AI revert
    saveToHistory(previousState.nodes, previousState.edges);

    // Remove the last AI patch from history
    const newAiHistory = aiPatchHistory.slice(0, -1);
    setAiPatchHistory(newAiHistory);

    console.log('✅ Last AI change reverted, remaining AI history:', newAiHistory.length);
  };

  const generateFlow = async () => {
    if (!transcript.trim() && workflowType !== 'live') {
      showErrorMessage('No transcript available to generate flow', setErrorMessage, setShowError);
      return;
    }

    // No methodology selection needed - use simple flow

    setIsGenerating(true);

    try {
      // For live workflow, start with empty flow and let incremental updates build it
      if (workflowType === 'live') {
        // Initialize empty workshop session for live mode
        setWorkshopSession({
          id: Date.now(),
          startTime: new Date(),
          methodology: 'simple',
          initialTranscript: 'Live workshop session started'
        });
        setAccumulatedTranscript('Live workshop session started');
        setNodes([]);
        setEdges([]);
        setIsGenerating(false);
        return;
      }

      // For upload and manual workflows, generate complete flow
      const token = await getToken();
      const response = await axios.post(`${API_BASE_URL}/generate-flow`, {
        transcript: transcript
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const { nodes: flowNodes, edges: flowEdges } = response.data;

      // Convert to React Flow format
      const reactFlowNodes = flowNodes.map((node, index) => ({
        id: node.id,
        type: node.type === 'decision' ? 'decision' :
          node.type === 'start' ? 'start' :
            node.type === 'end' ? 'end' :
              node.type === 'merge' ? 'merge' : 'default',
        position: { x: 100 + (index % 3) * 300, y: 100 + Math.floor(index / 3) * 150 },
        data: {
          label: node.label,
          id: node.id,
          logical_id: node.logical_id || '',
          owner: node.owner || 'TBD',
          system: node.system || 'TBD',
          manualOrAutomated: node.manualOrAutomated || 'manual',
          type: node.type || 'default'
        },
        style: {
          background: 'var(--color-surface)',
          border: '1px solid #222',
          borderRadius: 8,
          padding: 10,
          minWidth: 150,
          textAlign: 'center',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        },
      }));

      const reactFlowEdges = flowEdges.map((edge, index) => {
        // Check if source is a decision node to add labels
        const sourceNode = flowNodes.find(n => n.id === edge.source);
        const isDecisionNode = sourceNode?.type === 'decision';

        return createStandardEdge(edge.source, edge.target, {
          id: `e${index}`,
          isDecision: isDecisionNode,
          condition: edge.condition,
        });
      });

      // Apply auto-layout to prevent overlapping
      const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(reactFlowNodes, reactFlowEdges);

      // Save to AI patch history (initial flow generation counts as AI change)
      const aiSnapshot = {
        nodes: [],
        edges: [],
        timestamp: Date.now()
      };
      setAiPatchHistory(prev => {
        const newHistory = [...prev, aiSnapshot];
        console.log('💾 Saved initial flow to AI history, total:', newHistory.length);
        return newHistory;
      });

      setNodes(layoutedNodes);
      setEdges(layoutedEdges);
      saveToHistory(layoutedNodes, layoutedEdges);

      // Initialize workshop session for potential further iteration
      setWorkshopSession({
        id: Date.now(),
        startTime: new Date(),
        methodology: 'simple',
        initialTranscript: transcript
      });
      setAccumulatedTranscript(transcript);
    } catch (error) {
      console.error('Flow generation error:', error);
      showErrorMessage(error.response?.data?.detail || 'Failed to generate process flow', setErrorMessage, setShowError);
    } finally {
      setIsGenerating(false);
    }
  };

  // Track user edits
  const trackUserEdit = useCallback((edit) => {
    setUserEdits(prev => [...prev, {
      ...edit,
      timestamp: Date.now()
    }]);
  }, []);

  // Track node changes (label, owner, system, automation)
  const trackNodeUpdate = useCallback((nodeId, changes) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    trackUserEdit({
      type: 'node_updated',
      id: nodeId,
      label: node.data.label,
      changes: Object.keys(changes)
    });
  }, [nodes, trackUserEdit]);

  // Track node deletion
  const trackNodeDeletion = useCallback((nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    trackUserEdit({
      type: 'node_deleted',
      id: nodeId,
      label: node.data.label
    });
  }, [nodes, trackUserEdit]);

  // Track edge deletion
  const trackEdgeDeletion = useCallback((edgeId) => {
    const edge = edges.find(e => e.id === edgeId);
    if (!edge) return;

    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);

    trackUserEdit({
      type: 'edge_deleted',
      id: edgeId,
      from: sourceNode?.data?.label || 'Unknown',
      to: targetNode?.data?.label || 'Unknown'
    });
  }, [edges, nodes, trackUserEdit]);

  // Track node repositioning
  const trackNodeReposition = useCallback((nodeId) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    trackUserEdit({
      type: 'node_repositioned',
      id: nodeId,
      label: node.data.label,
      position: node.position
    });
  }, [nodes, trackUserEdit]);

  // Update refs and detect node modifications
  React.useEffect(() => {
    // Detect node property changes by comparing with original state
    nodes.forEach(node => {
      if (node.data.user_modified && !originalNodesRef.current.has(node.id)) {
        // First time seeing modified node - store original state
        console.log(`🔍 Storing original state for: ${node.data.label} (${node.id})`);
        originalNodesRef.current.set(node.id, {
          label: node.data.label,
          owner: node.data.owner,
          system: node.data.system,
          manualOrAutomated: node.data.manualOrAutomated
        });
      } else if (node.data.user_modified && originalNodesRef.current.has(node.id)) {
        // Node was modified - check what changed
        const original = originalNodesRef.current.get(node.id);
        const changes = [];

        if (original.label !== node.data.label) changes.push('label');
        if (original.owner !== node.data.owner) changes.push('owner');
        if (original.system !== node.data.system) changes.push('system');
        if (original.manualOrAutomated !== node.data.manualOrAutomated) changes.push('automation');

        if (changes.length > 0) {
          console.log(`📝 Node modified: ${node.data.label} (${changes.join(', ')})`);
          trackNodeUpdate(node.id, { changes: changes.join(', ') });
          // Update original to prevent duplicate tracking
          originalNodesRef.current.set(node.id, {
            label: node.data.label,
            owner: node.data.owner,
            system: node.data.system,
            manualOrAutomated: node.data.manualOrAutomated
          });
        }
      }
    });

    currentNodesRef.current = nodes;
    currentEdgesRef.current = edges;
  }, [nodes, edges, trackNodeUpdate]);

  // Custom handlers for nodes and edges (defined AFTER tracking functions)
  const onNodesChange = useCallback((changes) => {
    // Filter out position changes when Shift is pressed (resize mode)
    // This prevents nodes from moving when using Shift+Arrow keys for resizing
    let filteredChanges = changes;
    if (shiftKeyRef.current) {
      filteredChanges = changes.filter(change => change.type !== 'position');
      // If all changes were position changes, nothing left to do
      if (filteredChanges.length === 0) return;
    }
    
    // Track user modifications
    filteredChanges.forEach(change => {
      if (change.type === 'position') {
        trackNodeReposition(change.id);
      } else if (change.type === 'remove') {
        trackNodeDeletion(change.id);
      }
    });

    const updatedChanges = filteredChanges.map(change => {
      if (change.type === 'position' || change.type === 'dimensions') {
        return {
          ...change,
          data: {
            ...change.data,
            user_modified: true
          }
        };
      }
      return change;
    });

    onNodesChangeBase(updatedChanges);
  }, [onNodesChangeBase, trackNodeReposition, trackNodeDeletion]);

  const onNodeDragStop = useCallback((event, node) => {
    // Mark node as user modified when drag stops
    trackNodeReposition(node.id);
    
    // Update the node data to include user_modified flag
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === node.id) {
          return {
            ...n,
            data: {
              ...n.data,
              user_modified: true,
            },
          };
        }
        return n;
      })
    );
  }, [setNodes, trackNodeReposition]);

  const onEdgesChange = useCallback((changes) => {
    changes.forEach(change => {
      if (change.type === 'remove') {
        trackEdgeDeletion(change.id);
      }
    });
    onEdgesChangeBase(changes);
  }, [onEdgesChangeBase, trackEdgeDeletion]);

  // Incremental AI generation for live workshop mode
  const generateIncrementalFlow = React.useCallback(async (newTranscript) => {
    // Get current state from refs for accurate logging
    const currentNodes = currentNodesRef.current.length > 0 ? currentNodesRef.current : nodes;
    const currentEdges = currentEdgesRef.current.length > 0 ? currentEdgesRef.current : edges;

    console.log('generateIncrementalFlow called with:', {
      newTranscript,
      flowType,
      isPaused,
      workshopSession: !!workshopSession,
      currentNodes: currentNodes.length,
      currentEdges: currentEdges.length,
      usingRefs: currentNodesRef.current.length > 0
    });

    // Check for duplicate transcript processing
    if (newTranscript.trim() === lastProcessedTranscript.trim()) {
      console.log('Skipping duplicate transcript processing', {
        newTranscript: newTranscript.substring(0, 50) + '...',
        lastProcessed: lastProcessedTranscript.substring(0, 50) + '...'
      });
      setAiProcessingStatus('idle');
      return;
    }

    // Prevent overlapping AI calls 
    if (aiProcessingStatus === 'generating') {
      console.log('AI is already generating, skipping to prevent race condition');
      return;
    }

    // Set AI processing status to generating to prevent race conditions
    setAiProcessingStatus('generating');

    // Always try to process - let the API handle validation
    console.log('Processing incremental flow request...');

    try {
      // Get current state values to avoid stale closure issues
      const currentFlowType = 'simple';
      const currentSessionId = workshopSession?.id || Date.now();
      const currentAccumulatedTranscript = accumulatedTranscript || 'Live workshop session started';

      // Use the current nodes and edges we already retrieved above

      console.log('Current state for AI:', {
        nodeCount: currentNodes.length,
        edgeCount: currentEdges.length,
        nodeIds: currentNodes.map(n => n.id),
        flowType: currentFlowType,
        nodeDetails: currentNodes.map(n => ({ id: n.id, label: n.data?.label })),
        usingRefs: currentNodesRef.current.length > 0
      });

      // Combine accumulated transcript with new input
      const combinedTranscript = `${currentAccumulatedTranscript}\n\n${newTranscript}`;
      console.log('Combined transcript length:', combinedTranscript.length);

      // Build user edits from nodes with user_modified flag
      const currentUserEdits = [...userEdits]; // Start with tracked edits (deletions, repositions)

      // Add text/property edits from user_modified nodes
      currentNodes.forEach(node => {
        if (node.data.user_modified) {
          // Check if this edit is already tracked
          const alreadyTracked = currentUserEdits.some(edit =>
            edit.type === 'node_updated' && edit.id === node.id
          );

          if (!alreadyTracked) {
            console.log(`📝 Detected user-modified node: ${node.data.label}`);
            currentUserEdits.push({
              type: 'node_updated',
              id: node.id,
              label: node.data.label,
              changes: 'text/properties'
            });
          }
        }
      });

      console.log(`📦 Sending ${currentUserEdits.length} user edits`);

      const requestData = {
        transcript: newTranscript,
        accumulatedTranscript: currentAccumulatedTranscript,
        existingFlow: {
          nodes: currentNodes.map(node => ({
            id: node.id,
            label: node.data.label,
            type: node.type || 'default',  // Use React Flow type, not data.type
            position: node.position,
            data: {
              label: node.data.label,
              id: node.id,
              logical_id: node.data.logical_id,
              owner: node.data.owner,
              system: node.data.system,
              manualOrAutomated: node.data.manualOrAutomated,
              type: node.data.type,  // Keep canonical type in data
              user_modified: node.data.user_modified
            }
          })),
          edges: currentEdges.map(edge => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            condition: edge.label
          }))
        },
        sessionId: currentSessionId,
        validationErrors: validationErrors.length > 0 ? validationErrors : null,
        userEdits: currentUserEdits.length > 0 ? currentUserEdits : null
      };

      console.log('Sending incremental flow request:', requestData);

      const token = await getToken();
      const response = await axios.post(`${API_BASE_URL}/generate-incremental-flow`, requestData, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log('Incremental flow response:', response.data);

      // Capture validation errors from response
      if (response.data.validationErrors && response.data.validationErrors.length > 0) {
        console.warn('⚠️ Validation errors from backend:', response.data.validationErrors);
        setValidationErrors(response.data.validationErrors);
      } else {
        // Clear validation errors on successful response
        setValidationErrors([]);
      }

      // Clear user edits after successful request (they've been processed)
      setUserEdits([]);

      const { changes } = response.data;
      console.log('Changes received:', changes);
      console.log('Changes length:', changes ? changes.length : 'undefined');

      // Apply incremental changes
      if (changes && changes.length > 0) {
        console.log('Applying incremental changes:', changes);

        // Save current state to AI patch history BEFORE applying changes
        const aiSnapshot = {
          nodes: JSON.parse(JSON.stringify(currentNodes)),
          edges: JSON.parse(JSON.stringify(currentEdges)),
          timestamp: Date.now()
        };

        setAiPatchHistory(prev => {
          const newHistory = [...prev, aiSnapshot];
          // Limit to 20 patches
          if (newHistory.length > 20) {
            return newHistory.slice(1);
          }
          console.log('💾 Saved AI patch to history, total:', newHistory.length);
          return newHistory;
        });

        // Update existing nodes or add new ones
        const updatedNodes = [...currentNodes];
        const updatedEdges = [...currentEdges];

        changes.forEach(change => {
          console.log('Processing change:', change);
          if (change.type === 'add_node') {
            const newNode = {
              id: change.node.id || uuidv4(), // Use AI-provided ID or generate UUID
              type: change.node.type === 'decision' ? 'decision' :
                change.node.type === 'start' ? 'start' :
                  change.node.type === 'end' ? 'end' :
                    change.node.type === 'merge' ? 'merge' : 'default',
              position: change.node.position || { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
              data: {
                label: change.node.label,
                id: change.node.id || uuidv4(),
                logical_id: change.node.logical_id || '',
                owner: change.node.owner || 'TBD',
                system: change.node.system || 'TBD',
                manualOrAutomated: change.node.manualOrAutomated || 'manual',
                type: change.node.type || 'default',
                user_modified: false // Track if user has modified this node
              },
              style: {
                background: 'var(--color-surface)',
                border: '1px solid #222',
                borderRadius: 8,
                padding: 10,
                minWidth: 150,
                textAlign: 'center',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              },
            };
            updatedNodes.push(newNode);
            console.log('Added new node:', newNode);
          } else if (change.type === 'update_node') {
            const nodeIndex = updatedNodes.findIndex(n => n.id === change.node.id);
            if (nodeIndex !== -1) {
              // Only update if user hasn't manually modified this node
              if (!updatedNodes[nodeIndex].data.user_modified) {
                updatedNodes[nodeIndex].data.label = change.node.label;
                console.log('Updated node (AI):', updatedNodes[nodeIndex]);
              } else {
                console.log('Skipping update - node was user modified:', updatedNodes[nodeIndex].id);
              }
            }
          } else if (change.type === 'add_edge') {
            // Validate that both source and target nodes exist
            const sourceExists = updatedNodes.some(n => n.id === change.edge.source);
            const targetExists = updatedNodes.some(n => n.id === change.edge.target);

            if (sourceExists && targetExists) {
              // Check if source is a decision node to add labels
              const sourceNode = updatedNodes.find(n => n.id === change.edge.source);
              const isDecisionNode = sourceNode?.type === 'decision';

              const newEdge = createStandardEdge(change.edge.source, change.edge.target, {
                id: change.edge.id || uuidv4(),
                isDecision: isDecisionNode,
                condition: change.edge.condition,
              });
              updatedEdges.push(newEdge);
              console.log('Added new edge:', newEdge);
            } else {
              console.warn('Skipping orphan edge - missing nodes:', {
                source: change.edge.source,
                target: change.edge.target,
                sourceExists,
                targetExists
              });
            }
          }
        });

        console.log('Updating flow with:', {
          newNodes: updatedNodes.length,
          newEdges: updatedEdges.length
        });

        // Apply auto-layout to prevent overlapping
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(updatedNodes, updatedEdges);

        console.log('Updating React Flow state with:', {
          nodeCount: layoutedNodes.length,
          edgeCount: layoutedEdges.length,
          nodeIds: layoutedNodes.map(n => n.id)
        });

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
        saveToHistory(layoutedNodes, layoutedEdges);

        // Update refs with current state for immediate access
        currentNodesRef.current = layoutedNodes;
        currentEdgesRef.current = layoutedEdges;
      } else {
        console.log('No changes to apply');
        // Reset AI processing status when no changes
        setAiProcessingStatus('idle');
      }

      // Update accumulated transcript
      setAccumulatedTranscript(combinedTranscript);

      // Update last processed transcript to prevent duplicates
      setLastProcessedTranscript(newTranscript);

      // Reset AI processing status
      setAiProcessingStatus('idle');

    } catch (error) {
      console.error('Incremental flow generation error:', error);
      console.error('Error details:', error.response?.data);
      // Don't show error to user in live mode, just log it

      // Reset AI processing status on error
      setAiProcessingStatus('idle');
    }
  }, [flowType, workshopSession, accumulatedTranscript, nodes, edges, lastProcessedTranscript]);

  const startLiveModeAfterSelection = async () => {
    console.log('Starting live mode with simple flow');

    // Set all the state first
    setFlowType('simple');
    setIsLiveMode(true);
    setIsPaused(false);

    const newSession = {
      id: Date.now(),
      startTime: new Date(),
      methodology: 'simple',
      initialTranscript: 'Live workshop session started'
    };

    setWorkshopSession(newSession);
    setAccumulatedTranscript('Live workshop session started');

    // Wait a bit for state to update, then start recording
    setTimeout(async () => {
      await startRecording();
      console.log('Live workshop mode started with microphone');
    }, 100);
  };

  // Microphone recording functions
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Use WebM with Opus codec - most reliable for continuous recording
      // WAV is not well supported for streaming recording in browsers
      let selectedMimeType = 'audio/webm;codecs=opus';

      if (!MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        // Fallback options in order of preference
        const fallbacks = ['audio/webm', 'audio/mp4', 'audio/wav'];
        for (const mimeType of fallbacks) {
          if (MediaRecorder.isTypeSupported(mimeType)) {
            selectedMimeType = mimeType;
            break;
          }
        }
      }

      console.log('Using MIME type:', selectedMimeType);
      const recorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
      const chunks = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
          setAudioChunks([...chunks]);

          // Don't process individual chunks in live mode - they're fragmented and incomplete
          // Only process when recording stops to get a complete file
          console.log('Audio chunk received, size:', event.data.size);
        }
      };

      recorder.onstop = async () => {
        console.log('Recording stopped, processing audio blob...');
        const audioBlob = new Blob(chunks, { type: selectedMimeType });
        console.log('Created audio blob:', { size: audioBlob.size, type: audioBlob.type });
        await processAudioBlob(audioBlob);
        // Clear chunks immediately after processing to prevent accumulation
        chunks.length = 0;
        setAudioChunks([]);
        console.log('Audio processing completed, chunks cleared');
      };

      // For live mode, we need to periodically stop and restart recording 
      // to get complete audio files instead of fragmented chunks
      console.log('Setting up recording for workflowType:', workflowType);
      if (workflowType === 'live') {
        // Start recording continuously 
        recorder.start();
        console.log('Started recording, setting isRecording to true');

        // Set up interval to stop/restart recording every 10 seconds for live processing
        const liveProcessingInterval = setInterval(() => {
          console.log('Live processing interval triggered. Recorder state:', recorder?.state);
          // Check if recorder is actually recording - rely on recorder state, not React state
          if (recorder && recorder.state === 'recording') {
            console.log('Stopping recording for live processing...');
            recorder.stop(); // This will trigger onstop and process the complete audio

            // Restart recording after a short delay
            setTimeout(() => {
              console.log('Attempting to restart. Recorder state:', recorder?.state);
              if (recorder && recorder.state === 'inactive') {
                console.log('Restarting recording for live mode...');
                try {
                  // Clear any remaining chunks before restarting
                  chunks.length = 0;
                  recorder.start();
                  console.log('Recording restarted successfully. New state:', recorder.state);
                } catch (error) {
                  console.error('Failed to restart recording:', error);
                }
              } else {
                console.log('Skipping restart - recorder state:', recorder?.state);
              }
            }, 1000); // 1 second delay to ensure processing completes
          } else {
            console.log('Skipping stop - recorder state is not recording:', recorder?.state);
          }
        }, 10000); // Every 10 seconds

        setProcessingInterval(liveProcessingInterval);
      } else {
        // For upload mode, just record continuously until stopped
        recorder.start();
      }
      setMediaRecorder(recorder);
      setAudioChunks(chunks);
      setIsRecording(true);
      setRecordingStatus('recording');
      console.log('Recording started with 10-second intervals. States set:', {
        isRecording: true,
        recordingStatus: 'recording'
      });
    } catch (error) {
      console.error('Error starting recording:', error);
      showErrorMessage('Microphone access denied or not available', setErrorMessage, setShowError);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      setRecordingStatus('processing');
      console.log('Recording stopped, processing...');
    }

    // Clear any processing interval
    if (processingInterval) {
      clearInterval(processingInterval);
      setProcessingInterval(null);
    }
  };

  const processAudioBlob = async (audioBlob, retryCount = 0) => {
    try {
      console.log('Processing audio blob:', { size: audioBlob.size, type: audioBlob.type, retry: retryCount });

      // Skip if audio blob is too small (likely empty or corrupted)
      if (audioBlob.size < 5000) {
        console.log('Audio blob too small, skipping:', audioBlob.size);
        return;
      }

      // Skip if audio blob is too large (might cause API issues)
      if (audioBlob.size > 25000000) { // 25MB limit
        console.log('Audio blob too large, skipping:', audioBlob.size);
        return;
      }

      // Set AI processing status to transcribing
      setAiProcessingStatus('transcribing');

      const formData = new FormData();

      // Ensure we're sending as WAV format for Whisper compatibility
      let fileName = 'recording.wav';
      let audioBlobToSend = audioBlob;

      // If the blob is not WAV, try to convert it
      if (!audioBlob.type.includes('wav')) {
        console.log('Converting audio to WAV format for Whisper compatibility');
        // For now, just change the filename - the backend will handle the conversion
        fileName = 'recording.wav';
      }

      formData.append('file', audioBlobToSend, fileName);

      console.log('Sending audio to transcription API:', {
        fileName,
        blobType: audioBlobToSend.type,
        blobSize: audioBlobToSend.size
      });

      const token = await getToken();
      const response = await axios.post(`${API_BASE_URL}/transcribe`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${token}`,
        },
      });

      console.log('Transcription response:', response.data);
      const newTranscript = response.data.transcript;

      if (newTranscript && newTranscript.trim()) {
        console.log('New transcript received:', newTranscript);
        console.log('Current state before handleNewTranscript:', {
          isLiveMode,
          isPaused,
          flowType,
          workshopSession: !!workshopSession
        });

        // Filter out obviously non-business content
        const nonBusinessPatterns = [
          /share.*video.*friends/i,
          /subscribe.*channel/i,
          /thank.*watching/i,
          /チャンネル登録/i,
          /ご視聴ありがとう/i,
          /like.*comment/i,
          /don't forget.*like/i,
          /please.*subscribe/i,
          /hit.*like.*button/i,
          /bell.*notification/i,
          /follow.*social/i,
          /share.*social.*media/i
        ];

        const isNonBusiness = nonBusinessPatterns.some(pattern => pattern.test(newTranscript));
        if (isNonBusiness) {
          console.log('Skipping non-business content:', newTranscript);
          setAiProcessingStatus('idle');
          return;
        }

        // Always process transcript if we have one, regardless of state
        if (newTranscript.trim()) {
          // Update accumulated transcript
          setAccumulatedTranscript(prev => {
            const updated = prev + '\n' + newTranscript;
            console.log('Updated accumulated transcript:', updated);
            return updated;
          });

          // Set AI processing status to generating
          setAiProcessingStatus('generating');

          console.log('Calling generateIncrementalFlow with:', newTranscript);
          generateIncrementalFlow(newTranscript);
        } else {
          console.log('Skipping incremental flow generation: empty transcript');
          setAiProcessingStatus('idle');
        }
      } else {
        console.log('No transcript received or empty transcript');
        setAiProcessingStatus('idle');
      }

      setRecordingStatus('idle');
    } catch (error) {
      console.error('Error processing audio:', error);
      console.error('Error details:', error.response?.data);

      // Retry logic for failed transcriptions
      if (retryCount < 2 && error.response?.status === 500) {
        console.log(`Retrying audio processing (attempt ${retryCount + 1}/2)...`);
        setTimeout(() => {
          processAudioBlob(audioBlob, retryCount + 1);
        }, 1000 * (retryCount + 1)); // Exponential backoff
        return;
      }

      setRecordingStatus('idle');
      setAiProcessingStatus('idle');
      // Don't show error to user in live mode, just log it
      console.log('Audio processing failed after retries, continuing...');
    }
  };

  // Workshop control functions
  const startLiveMode = async () => {
    // Start live mode directly with simple flow
    await startLiveModeAfterSelection();
  };

  const startLiveModeWithoutRecording = () => {
    setIsLiveMode(true);
    setIsPaused(false);

    // Initialize workshop session
    if (!workshopSession) {
      setWorkshopSession({
        id: Date.now(),
        startTime: new Date(),
        methodology: 'simple',
        initialTranscript: 'Live workshop session started (manual mode)'
      });
      setAccumulatedTranscript('Live workshop session started (manual mode)');
    }

    console.log('Live workshop mode started without recording - ready for manual input');
  };


  const stopLiveMode = () => {
    if (isRecording) {
      stopRecording();
    }
    setIsLiveMode(false);
    setIsPaused(false);
    setRecordingStatus('idle');
    setAiProcessingStatus('idle');
    console.log('Live workshop mode stopped');
  };

  const togglePause = () => {
    if (isPaused) {
      // Resume - start recording again
      if (isLiveMode) {
        startRecording();
      }
    } else {
      // Pause - stop recording
      if (isRecording) {
        stopRecording();
      }
    }
    setIsPaused(!isPaused);
    console.log('AI generation', isPaused ? 'resumed' : 'paused');
  };

  // Handle new transcript input for live mode
  const handleNewTranscript = React.useCallback((newTranscript) => {
    console.log('handleNewTranscript called:', {
      newTranscript,
      isLiveMode,
      isPaused,
      flowType,
      workshopSession: !!workshopSession
    });

    // Always process transcript if we have one
    if (newTranscript.trim()) {
      // Update accumulated transcript
      setAccumulatedTranscript(prev => {
        const updated = prev + '\n' + newTranscript;
        console.log('Updated accumulated transcript:', updated);
        return updated;
      });

      console.log('Calling generateIncrementalFlow with:', newTranscript);
      generateIncrementalFlow(newTranscript);
    } else {
      console.log('Skipping incremental flow generation: empty transcript');
    }
  }, [isLiveMode, isPaused, flowType, workshopSession, generateIncrementalFlow]);

  // Expose handleNewTranscript to parent component
  React.useEffect(() => {
    if (typeof onNewTranscript === 'function') {
      onNewTranscript(handleNewTranscript);
    }
  }, [isLiveMode, isPaused, accumulatedTranscript, nodes, edges, flowType, workshopSession]);

  // Cleanup recording on unmount
  React.useEffect(() => {
    return () => {
      if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
      }
      if (processingInterval) {
        clearInterval(processingInterval);
      }
    };
  }, [mediaRecorder, isRecording, processingInterval]);

  // Simplified toolbar functions
  const handleAddStep = (stepType) => {
    console.log('Adding step:', stepType);
    addSimpleStep(stepType);
  };

  const handleAddDecision = (decisionType) => {
    setShowAddDecisionDropdown(false);
    addSimpleDecision(decisionType);
  };

  const handleAddMerge = () => {
    setShowAddDecisionDropdown(false);
    addMergeNode();
  };

  const addSimpleStep = (stepType) => {
    const newId = `step-${Date.now()}`;
    const logicalId = getNextLogicalId(nodes);
    const newNode = {
      id: newId,
      type: 'default',
      position: getViewportCenter(), // Center in current view
      data: {
        label: `New ${stepType}`,
        id: newId,
        logical_id: logicalId,
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'default',
        stepType: stepType
      },
    };

    // Check if we're in mid-step insertion mode
    if (isMidStepInsertion && targetEdgeForInsertion) {
      const { nodes: newNodes, edges: newEdges } = handleMidStepInsertion(newNode, targetEdgeForInsertion, nodes, edges);
      setNodes(newNodes);
      setEdges(newEdges);
      saveToHistory(newNodes, newEdges);
      setIsMidStepInsertion(false);
      setTargetEdgeForInsertion(null);
    } else {
      setNodes(prev => [...prev, newNode]);
      saveToHistory([...nodes, newNode], edges);
    }
  };

  const addSimpleDecision = (decisionType) => {
    const newId = `decision-${Date.now()}`;
    const newNode = {
      id: newId,
      type: 'decision',
      position: getViewportCenter(), // Center in current view
      data: {
        label: `New Decision`,
        id: newId,
        logical_id: '', // Decision nodes don't get logical IDs
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'decision',
        decisionType: 'decision'
      },
    };

    // Check if we're in mid-step insertion mode
    if (isMidStepInsertion && targetEdgeForInsertion) {
      const { nodes: newNodes, edges: newEdges } = handleMidStepInsertion(newNode, targetEdgeForInsertion, nodes, edges);
      setNodes(newNodes);
      setEdges(newEdges);
      saveToHistory(newNodes, newEdges);
      setIsMidStepInsertion(false);
      setTargetEdgeForInsertion(null);
    } else {
      setNodes(prev => [...prev, newNode]);
      saveToHistory([...nodes, newNode], edges);
    }
  };

  const addMergeNode = () => {
    const newId = `merge-${Date.now()}`;
    const newNode = {
      id: newId,
      type: 'merge',
      position: getViewportCenter(), // Center in current view
      data: {
        label: `Merge`,
        id: newId,
        logical_id: '', // Merge nodes don't get logical IDs
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'merge',
        nodeType: 'merge'
      },
    };

    // Check if we're in mid-step insertion mode
    if (isMidStepInsertion && targetEdgeForInsertion) {
      const { nodes: newNodes, edges: newEdges } = handleMidStepInsertion(newNode, targetEdgeForInsertion, nodes, edges);
      setNodes(newNodes);
      setEdges(newEdges);
      saveToHistory(newNodes, newEdges);
      setIsMidStepInsertion(false);
      setTargetEdgeForInsertion(null);
    } else {
      setNodes(prev => [...prev, newNode]);
      saveToHistory([...nodes, newNode], edges);
    }
  };

  const addStartNode = () => {
    const newId = `start-${Date.now()}`;
    const newNode = {
      id: newId,
      type: 'start',
      position: getViewportCenter(), // Center in current view
      data: {
        label: `Start`,
        id: newId,
        logical_id: '', // Start nodes don't get logical IDs
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'start',
        nodeType: 'start'
      },
    };
    setNodes(prev => [...prev, newNode]);
    saveToHistory([...nodes, newNode], edges);
  };

  const addEndNode = () => {
    const newId = `end-${Date.now()}`;
    const newNode = {
      id: newId,
      type: 'end',
      position: getViewportCenter(), // Center in current view
      data: {
        label: `End`,
        id: newId,
        logical_id: '', // End nodes don't get logical IDs
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'end',
        nodeType: 'end'
      },
    };
    setNodes(prev => [...prev, newNode]);
    saveToHistory([...nodes, newNode], edges);
  };

  const handleAutoLayout = async () => {
    if (nodes.length === 0) {
      showErrorMessage('No nodes to layout', setErrorMessage, setShowError);
      return;
    }

    try {
      setIsGenerating(true);
      
      // Collect user edits (deletions) if any
      const currentUserEdits = [];
      // Note: We could track deletions here, but for auto-layout we mainly care about the current state
      
      // Prepare current flow state (include handle positions for preservation)
      const currentFlow = {
        nodes: nodes.map(node => ({
          id: node.id,
          label: node.data.label,
          type: node.type || 'default',  // Use React Flow type, not data.type
          position: node.position,
          sourcePosition: node.sourcePosition,  // Preserve handle positions
          targetPosition: node.targetPosition,  // Preserve handle positions
          data: {
            label: node.data.label,
            id: node.id,
            logical_id: node.data.logical_id,
            owner: node.data.owner,
            system: node.data.system,
            manualOrAutomated: node.data.manualOrAutomated,
            type: node.data.type,  // Keep canonical type in data
            user_modified: node.data.user_modified,
            screenshot_url: node.data.screenshot_url  // Preserve screenshot assignments
          }
        })),
        edges: edges.map(edge => ({
          ...edge, // Preserve all edge properties (markerEnd, type, style, animated, etc.)
          id: edge.id,
          source: edge.source,
          target: edge.target,
          condition: edge.label, // Map label to condition for backend logic
          label: edge.label,     // Keep label as is for display
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle
        }))
      };

      // Call dedicated auto-layout endpoint
      const token = await getToken();
      const response = await axios.post(`${API_BASE_URL}/auto-layout`, {
        existingFlow: currentFlow,
        userEdits: currentUserEdits.length > 0 ? currentUserEdits : null
      }, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.data && response.data.nodes) {
        // Update nodes with auto-laid-out positions
        setNodes(response.data.nodes);
        
        // Merge returned edges with existing edges to preserve styles/markers/labels
        const returnedEdges = response.data.edges || [];
        const mergedEdges = returnedEdges.map(rEdge => {
           const existingEdge = edges.find(e => e.id === rEdge.id);
           
           // Default marker configuration
           const defaultMarker = {
             type: MarkerType.ArrowClosed,
             width: 20,
             height: 20,
             color: '#b1b1b7',
           };

           if (existingEdge) {
             return {
               ...existingEdge, // Keep all existing props
               ...rEdge,        // Overwrite with backend updates (position/routing)
               
               // Explicitly ensure critical props are preserved or defaulted
               markerEnd: existingEdge.markerEnd || rEdge.markerEnd || defaultMarker,
               label: existingEdge.label !== undefined ? existingEdge.label : (rEdge.label || ''),
               style: existingEdge.style || rEdge.style || { strokeWidth: 2, stroke: '#3b82f6' },
               type: existingEdge.type || rEdge.type || 'editable',
               animated: existingEdge.animated,
               
               data: {
                 ...existingEdge.data,
                 ...(rEdge.data || {})
               }
             };
           }
           
           // If no existing edge found (shouldn't happen if IDs match), apply defaults
           return {
             ...rEdge,
             markerEnd: rEdge.markerEnd || defaultMarker,
             type: rEdge.type || 'editable',
             style: rEdge.style || { strokeWidth: 2, stroke: '#3b82f6' }
           };
        });

        setEdges(mergedEdges);
        saveToHistory(response.data.nodes, mergedEdges);
        console.log('✅ Auto-layout applied successfully');
      }
    } catch (error) {
      console.error('Auto-layout error:', error);
      showErrorMessage(error.response?.data?.detail || error.message || 'Failed to apply auto-layout', setErrorMessage, setShowError);
    } finally {
      setIsGenerating(false);
    }
  };

  // Handle edge reconnection - allows users to drag edge endpoints to reconnect them
  const onReconnect = useCallback(
    (oldEdge, newConnection) => {
      console.log('Edge reconnection:', { oldEdge, newConnection });

      // Validate the new connection using the same rules as onConnect
      const sourceNode = nodes.find(n => n.id === newConnection.source);
      const targetNode = nodes.find(n => n.id === newConnection.target);

      if (!sourceNode || !targetNode) {
        showErrorMessage('Invalid reconnection: source or target node not found', setErrorMessage, setShowError);
        return;
      }

      // Apply the same validation rules as in onConnect
      const sourceType = sourceNode.type;
      const targetType = targetNode.type;

      // Count existing connections (excluding the old edge being reconnected)
      const otherEdges = edges.filter(e => e.id !== oldEdge.id);
      const sourceOutgoing = otherEdges.filter(e => e.source === newConnection.source).length;
      const targetIncoming = otherEdges.filter(e => e.target === newConnection.target).length;

      // Apply connection validation rules
      let isValid = true;
      let errorMessage = '';

      if (sourceType === 'start' && sourceOutgoing >= 1) {
        isValid = false;
        errorMessage = 'Start node can only have one outgoing connection';
      } else if (sourceType === 'end') {
        isValid = false;
        errorMessage = 'End node cannot have outgoing connections';
      } else if (sourceType === 'default' && sourceOutgoing >= 1) {
        isValid = false;
        errorMessage = 'Process step can only have one outgoing connection';
      } else if (sourceType === 'decision' && sourceOutgoing >= 3) {
        isValid = false;
        errorMessage = 'Decision node can have maximum 3 outgoing connections';
      }

      if (targetType === 'start') {
        isValid = false;
        errorMessage = 'Start node cannot have incoming connections';
      } else if (targetType === 'default' && targetIncoming >= 1) {
        isValid = false;
        errorMessage = 'Process step can only have one incoming connection';
      } else if (targetType === 'decision' && targetIncoming >= 1) {
        isValid = false;
        errorMessage = 'Decision node can only have one incoming connection';
      }

      if (!isValid) {
        showErrorMessage(errorMessage, setErrorMessage, setShowError);
        return;
      }

      // If validation passes, update the edges
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els));

      // After reconnection, renumber nodes based on new flow sequence
      setTimeout(() => {
        const currentNodes = nodes;
        const currentEdges = edges;
        const renumberedNodes = renumberByFlowSequence(currentNodes, currentEdges);
        setNodes(renumberedNodes);
        saveToHistory(renumberedNodes, currentEdges);
      }, 100);
    },
    [nodes, edges, setErrorMessage, setShowError]
  );

  const onConnect = useCallback(
    (params) => {
      const sourceNode = nodes.find(n => n.id === params.source);
      const targetNode = nodes.find(n => n.id === params.target);

      if (!sourceNode || !targetNode) return;

      // Validate connection rules
      const sourceType = sourceNode.type;
      const targetType = targetNode.type;

      // Count existing connections
      const sourceOutgoing = edges.filter(e => e.source === params.source).length;
      const targetIncoming = edges.filter(e => e.target === params.target).length;

      // Check for double entry (same anchor point)
      const existingConnection = edges.find(e =>
        e.source === params.source && e.target === params.target &&
        e.sourceHandle === params.sourceHandle && e.targetHandle === params.targetHandle
      );

      if (existingConnection) {
        showErrorMessage('Connection already exists at this anchor point', setErrorMessage, setShowError);
        return;
      }

      // Check for duplicate connector usage (same handle used twice)
      const sourceHandleUsed = edges.some(e =>
        e.source === params.source && e.sourceHandle === params.sourceHandle
      );
      const targetHandleUsed = edges.some(e =>
        e.target === params.target && e.targetHandle === params.targetHandle
      );

      if (sourceHandleUsed) {
        showErrorMessage('This connector point is already in use', setErrorMessage, setShowError);
        return;
      }

      if (targetHandleUsed) {
        showErrorMessage('This connector point is already in use', setErrorMessage, setShowError);
        return;
      }

      // Validate connection rules
      let isValid = true;
      let errorMessage = '';

      if (sourceType === 'start') {
        // Start node: no input, exactly 1 output
        if (targetIncoming > 0) {
          isValid = false;
          errorMessage = 'Start node cannot have incoming connections';
        }
        if (sourceOutgoing >= 1) {
          isValid = false;
          errorMessage = 'Start node can only have one outgoing connection';
        }
      } else if (sourceType === 'end') {
        // End node: no output
        isValid = false;
        errorMessage = 'End node cannot have outgoing connections';
      } else if (sourceType === 'default') {
        // Standard process node: exactly 1 input + 1 output
        if (sourceOutgoing >= 1) {
          isValid = false;
          errorMessage = 'Process step can only have one outgoing connection';
        }
      } else if (sourceType === 'decision') {
        // Decision node: exactly 1 input + ≥2 outputs (max 3 outputs using right, top, bottom)
        if (sourceOutgoing >= 3) {
          isValid = false;
          errorMessage = 'Decision node can have maximum 3 outgoing connections';
        }
      } else if (sourceType === 'merge') {
        // Merge node: fully bidirectional - no outgoing limit
        // Allow unlimited outgoing connections for maximum flexibility
      }

      if (targetType === 'start') {
        // Start node: no input
        isValid = false;
        errorMessage = 'Start node cannot have incoming connections';
      } else if (targetType === 'end') {
        // End node: ≥1 input (no limit)
        // No validation needed
      } else if (targetType === 'default') {
        // Standard process node: exactly 1 input + 1 output
        if (targetIncoming >= 1) {
          isValid = false;
          errorMessage = 'Process step can only have one incoming connection';
        }
      } else if (targetType === 'decision') {
        // Decision node: exactly 1 input + ≥2 outputs
        if (targetIncoming >= 1) {
          isValid = false;
          errorMessage = 'Decision node can only have one incoming connection';
        }
      } else if (targetType === 'merge') {
        // Merge node: fully bidirectional - no incoming limit
        // Allow unlimited incoming connections for maximum flexibility
      }

      if (!isValid) {
        showErrorMessage(errorMessage, setErrorMessage, setShowError);
        return;
      }

      // Check if source is a decision node to add labels
      const isDecisionNode = sourceType === 'decision';
      const edgeLabel = isDecisionNode ? (params.targetHandle === 'top' ? 'Yes' : 'No') : '';

      const standardEdge = createStandardEdge(params.source, params.target, {
        id: params.id,
        isDecision: isDecisionNode,
        label: edgeLabel,
      });

      const newEdges = addEdge(standardEdge, edges);

      // Renumber nodes based on new flow sequence
      const renumberedNodes = renumberByFlowSequence(nodes, newEdges);

      setEdges(newEdges);
      setNodes(renumberedNodes);
      saveToHistory(renumberedNodes, newEdges);
    },
    [nodes, edges, setErrorMessage, setShowError]
  );

  const clearFlow = async () => {
    // Clear all nodes and edges
    setNodes([]);
    setEdges([]);

    // Clear history
    setHistory([]);
    setHistoryIndex(-1);

    // Clear accumulated transcript
    setAccumulatedTranscript('');

    // Reset workshop session
    setWorkshopSession(null);

    // Clear validation errors and user edits
    setValidationErrors([]);
    setUserEdits([]);

    // Clear AI patch history
    setAiPatchHistory([]);

    console.log('✅ Flow cleared successfully');

    // Save the empty flow after clearing (if save handler exists)
    if (onSaveFinalize) {
      try {
        await onSaveFinalize({ nodes: [], edges: [] });
        const targetProcessId = getTargetProcessId();
        if (targetProcessId) {
          await fetchSopStatus(targetProcessId);
        }
      } catch (err) {
        console.error('Failed to save empty flow:', err);
      }
    }
  };

  // Complete clean slate - clears flow, SOPs, screenshots, and resets everything
  const handleCleanSlate = async () => {
    const targetProcessId = getTargetProcessId();
    
    try {
      // 1. Delete all screenshots from Cloudflare R2
      if (flowId) {
        try {
          const token = await getToken();
          const resp = await fetch(`${API_BASE_URL}/api/process-flows/${flowId}/all-screenshots`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const result = await resp.json();
          console.log(`🗑️ Deleted ${result.deleted}/${result.total} screenshots from R2`);
        } catch (r2Error) {
          console.warn('Could not delete screenshots from R2:', r2Error);
        }
      }

      // 2. Clear all nodes and edges
      setNodes([]);
      setEdges([]);
      setHistory([]);
      setHistoryIndex(-1);
      setAccumulatedTranscript('');
      setWorkshopSession(null);
      setValidationErrors([]);
      setUserEdits([]);
      setAiPatchHistory([]);
      
      // 3. Clear recording metadata (screenshots)
      setRecordingMetadata(null);
      setAllScreenshots([]);
      
      // 4. Save empty flow with no recording_metadata
      if (onSaveFinalize) {
        await onSaveFinalize({ 
          nodes: [], 
          edges: [],
          recording_metadata: null 
        });
      }
      
      // 5. Delete SOP if it exists
      if (targetProcessId && (sopDraftUrl || sopFinalUrl || sopStatus)) {
        try {
          const token = await getToken();
          await fetch(`${API_BASE_URL}/api/processes/${targetProcessId}/sop`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
        } catch (sopError) {
          console.warn('Could not delete SOP:', sopError);
        }
      }
      
      // 6. Refresh SOP status
      if (targetProcessId) {
        await fetchSopStatus(targetProcessId);
      }
      
      console.log('✅ Clean slate complete - all data cleared');
      setShowClearConfirm(false);
      setShowSaveMenu(false);
    } catch (error) {
      console.error('Error during clean slate:', error);
      alert('Failed to complete clean slate: ' + error.message);
    }
  };

  // Helper function to sanitize process name for filename
  const getProcessNameForExport = () => {
    // Try multiple sources for the process name (in order of preference)
    return processName || selectedProcess?.name || 'process-flow';
  };

  const sanitizeFileName = () => {
    const processNameToUse = getProcessNameForExport();
    
    // If still empty or just whitespace, use fallback
    if (!processNameToUse || !processNameToUse.trim()) {
      return 'process-flow';
    }
    
    // Replace spaces and special characters with hyphens, remove invalid filename characters
    const sanitized = processNameToUse
      .trim()
      .replace(/[^a-z0-9\s-]/gi, '') // Remove special characters except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
      .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
      .toLowerCase()
      .substring(0, 100); // Limit length
    
    // If sanitization resulted in empty string, use fallback
    return sanitized || 'process-flow';
  };

  const downloadJSON = () => {
    if (!flowData) {
      showErrorMessage('No flow data to download', setErrorMessage, setShowError);
      return;
    }

    const dataStr = JSON.stringify(flowData, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const fileName = sanitizeFileName();
    const exportFileDefaultName = `${fileName}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const downloadPNG = async () => {
    if (!flowRef.current || !reactFlowInstance.current) {
      showErrorMessage('No flow to export', setErrorMessage, setShowError);
      return;
    }

    try {
      // Fit view to capture entire flow (instant, min padding)
      reactFlowInstance.current.fitView({ padding: 0.05, duration: 0, includeHiddenNodes: true });
      
      // Wait for renderer
      await new Promise(resolve => setTimeout(resolve, 800));

      const dataUrl = await htmlToImage.toPng(flowRef.current, {
        quality: 1.0,
        pixelRatio: 3, // High resolution
        backgroundColor: '#ffffff', // White background
        style: {
          width: '100%',
          height: '100%',
        },
        filter: (node) => {
          const classList = node.classList;
          if (!classList) return true;
          // Exclude UI elements
          return !classList.contains('react-flow__controls') &&
                 !classList.contains('react-flow__minimap') &&
                 !classList.contains('react-flow__attribution') &&
                 !classList.contains('react-flow__background') &&
                 !classList.contains('visio-toolbar') &&
                 !classList.contains('controls');
        }
      });

      const fileName = sanitizeFileName();
      const link = document.createElement('a');
      link.download = `${fileName}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('PNG export error:', error);
      showErrorMessage('Failed to export PNG', setErrorMessage, setShowError);
    }
  };

  const downloadPDF = async () => {
    if (!flowRef.current || !reactFlowInstance.current) {
      showErrorMessage('No flow to export', setErrorMessage, setShowError);
      return;
    }

    try {
      // Fit view to capture entire flow (instant, min padding)
      reactFlowInstance.current.fitView({ padding: 0.05, duration: 0, includeHiddenNodes: true });
      
      // Wait for renderer
      await new Promise(resolve => setTimeout(resolve, 800));

      // First, convert the flow to PNG
      const dataUrl = await htmlToImage.toPng(flowRef.current, {
        quality: 1.0,
        pixelRatio: 3, // High resolution
        backgroundColor: '#ffffff',
        style: {
          width: '100%',
          height: '100%',
        },
        filter: (node) => {
          const classList = node.classList;
          if (!classList) return true;
          // Exclude UI elements
          return !classList.contains('react-flow__controls') &&
                 !classList.contains('react-flow__minimap') &&
                 !classList.contains('react-flow__attribution') &&
                 !classList.contains('react-flow__background') &&
                 !classList.contains('visio-toolbar') &&
                 !classList.contains('controls');
        }
      });

      // Get the dimensions of the flow container
      const imgWidth = flowRef.current.offsetWidth;
      const imgHeight = flowRef.current.offsetHeight;

      // Create PDF with appropriate orientation
      const orientation = imgWidth > imgHeight ? 'landscape' : 'portrait';
      const pdf = new jsPDF(orientation, 'px', [imgWidth, imgHeight]);

      // Add the image to the PDF
      pdf.addImage(dataUrl, 'PNG', 0, 0, imgWidth, imgHeight);

      // Save the PDF
      const fileName = sanitizeFileName();
      pdf.save(`${fileName}.pdf`);
    } catch (error) {
      console.error('PDF export error:', error);
      showErrorMessage('Failed to export PDF', setErrorMessage, setShowError);
    }
  };

  const downloadBPMN = () => {
    if (!nodes || nodes.length === 0) {
      showErrorMessage('No flow to export', setErrorMessage, setShowError);
      return;
    }

    try {
      // Helper function to calculate orthogonal waypoints (angular routing)
      const calculateWaypoints = (sourceNode, targetNode, allNodes) => {
        const sourceX = sourceNode.position?.x || 0;
        const sourceY = sourceNode.position?.y || 0;
        const sourceWidth = sourceNode.width || 100;
        const sourceHeight = sourceNode.height || 80;

        const targetX = targetNode.position?.x || 0;
        const targetY = targetNode.position?.y || 0;
        const targetWidth = targetNode.width || 100;
        const targetHeight = targetNode.height || 80;

        // Calculate centers
        const sourceCenterX = sourceX + sourceWidth / 2;
        const sourceCenterY = sourceY + sourceHeight / 2;
        const targetCenterX = targetX + targetWidth / 2;
        const targetCenterY = targetY + targetHeight / 2;

        const waypoints = [];

        // Determine which side of the source box to exit from
        const dx = targetCenterX - sourceCenterX;
        const dy = targetCenterY - sourceCenterY;

        // Spacing for better routing
        const spacing = 30;

        // Always prefer horizontal flow (left-to-right)
        if (dx > 0) {
          // Target is to the right - exit from right side of source
          const sourceExit = { x: sourceX + sourceWidth, y: sourceCenterY };
          waypoints.push(sourceExit);

          // Add spacing after exit
          waypoints.push({ x: sourceX + sourceWidth + spacing, y: sourceCenterY });

          if (Math.abs(dy) > 10) {
            // Need vertical adjustment - route around
            const midX = sourceX + sourceWidth + spacing + Math.abs(dx) / 2;
            waypoints.push({ x: midX, y: sourceCenterY });
            waypoints.push({ x: midX, y: targetCenterY });
            waypoints.push({ x: targetX - spacing, y: targetCenterY });
          } else {
            // Straight horizontal with spacing
            waypoints.push({ x: targetX - spacing, y: targetCenterY });
          }

          // Enter from left side of target
          waypoints.push({ x: targetX, y: targetCenterY });
        } else if (dx < 0) {
          // Target is to the left - exit from left side of source
          const sourceExit = { x: sourceX, y: sourceCenterY };
          waypoints.push(sourceExit);

          // Add spacing after exit
          waypoints.push({ x: sourceX - spacing, y: sourceCenterY });

          if (Math.abs(dy) > 10) {
            // Need vertical adjustment
            const midX = sourceX - spacing - Math.abs(dx) / 2;
            waypoints.push({ x: midX, y: sourceCenterY });
            waypoints.push({ x: midX, y: targetCenterY });
            waypoints.push({ x: targetX + targetWidth + spacing, y: targetCenterY });
          } else {
            waypoints.push({ x: targetX + targetWidth + spacing, y: targetCenterY });
          }

          // Enter from right side of target
          waypoints.push({ x: targetX + targetWidth, y: targetCenterY });
        } else {
          // Directly above or below
          if (dy > 0) {
            // Target is below - exit from bottom of source
            waypoints.push({ x: sourceCenterX, y: sourceY + sourceHeight });
            waypoints.push({ x: sourceCenterX, y: sourceY + sourceHeight + spacing });
            waypoints.push({ x: targetCenterX, y: targetY - spacing });
            waypoints.push({ x: targetCenterX, y: targetY });
          } else {
            // Target is above - exit from top of source
            waypoints.push({ x: sourceCenterX, y: sourceY });
            waypoints.push({ x: sourceCenterX, y: sourceY - spacing });
            waypoints.push({ x: targetCenterX, y: targetY + targetHeight + spacing });
            waypoints.push({ x: targetCenterX, y: targetY + targetHeight });
          }
        }

        return waypoints;
      };

      // Group nodes by swimlane (using owner property)
      const swimlanes = new Map();
      const nodesWithoutLane = [];

      nodes.forEach(node => {
        const swimlane = node.data?.owner || node.data?.swimlane || node.data?.lane;
        if (swimlane) {
          if (!swimlanes.has(swimlane)) {
            swimlanes.set(swimlane, []);
          }
          swimlanes.get(swimlane).push(node);
        } else {
          nodesWithoutLane.push(node);
        }
      });

      // Generate BPMN 2.0 XML
      let bpmnXml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1"
                  targetNamespace="http://bpmn.io/schema/bpmn">
`;

      if (swimlanes.size > 0) {
        // Create collaboration with pools and lanes
        bpmnXml += `  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_1" name="Process" processRef="Process_1" />
  </bpmn:collaboration>
  <bpmn:process id="Process_1" isExecutable="false">
`;

        // Add lane set
        bpmnXml += `    <bpmn:laneSet id="LaneSet_1">
`;

        let laneIndex = 0;
        for (const [laneName, laneNodes] of swimlanes.entries()) {
          const laneId = `Lane_${laneIndex}`;
          bpmnXml += `      <bpmn:lane id="${laneId}" name="${laneName}">
        <bpmn:flowNodeRef>${laneNodes.map(n => `node_${n.id}`).join('</bpmn:flowNodeRef>\n        <bpmn:flowNodeRef>')}</bpmn:flowNodeRef>
      </bpmn:lane>
`;
          laneIndex++;
        }

        bpmnXml += `    </bpmn:laneSet>
`;
      } else {
        // No swimlanes, just a simple process
        bpmnXml += `  <bpmn:process id="Process_1" isExecutable="false">
`;
      }

      // Add nodes (tasks, events, gateways)
      nodes.forEach(node => {
        const nodeId = `node_${node.id}`;
        const label = (node.data?.label || 'Unnamed').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const nodeType = node.data?.type || node.type || 'default';

        // Map node types to BPMN elements
        if (nodeType === 'start' || nodeType === 'startEvent') {
          bpmnXml += `    <bpmn:startEvent id="${nodeId}" name="${label}" />\n`;
        } else if (nodeType === 'end' || nodeType === 'endEvent') {
          bpmnXml += `    <bpmn:endEvent id="${nodeId}" name="${label}" />\n`;
        } else if (nodeType === 'decision' || nodeType === 'gateway') {
          bpmnXml += `    <bpmn:exclusiveGateway id="${nodeId}" name="${label}" />\n`;
        } else {
          // Default to task for all other types
          bpmnXml += `    <bpmn:task id="${nodeId}" name="${label}" />\n`;
        }
      });

      // Add sequence flows (edges)
      edges.forEach((edge, index) => {
        const flowId = `flow_${index}`;
        const sourceId = `node_${edge.source}`;
        const targetId = `node_${edge.target}`;
        const label = edge.label ? edge.label.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';

        bpmnXml += `    <bpmn:sequenceFlow id="${flowId}" sourceRef="${sourceId}" targetRef="${targetId}"`;
        if (label) {
          bpmnXml += ` name="${label}"`;
        }
        bpmnXml += ` />\n`;
      });

      bpmnXml += `  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="${swimlanes.size > 0 ? 'Collaboration_1' : 'Process_1'}">
`;

      // Initialize laneData outside the if block so it's accessible later
      const laneData = new Map();

      // Add participant shape (pool) if swimlanes exist
      if (swimlanes.size > 0) {
        // Calculate pool bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        nodes.forEach(node => {
          const x = node.position?.x || 0;
          const y = node.position?.y || 0;
          const width = node.width || 100;
          const height = node.height || 80;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x + width);
          maxY = Math.max(maxY, y + height);
        });

        const poolPadding = 50;
        const poolX = minX - poolPadding;
        const poolY = minY - poolPadding;
        const poolWidth = maxX - minX + poolPadding * 2;
        const poolHeight = maxY - minY + poolPadding * 2;

        bpmnXml += `      <bpmndi:BPMNShape id="Participant_1_di" bpmnElement="Participant_1" isHorizontal="true">
        <dc:Bounds x="${poolX}" y="${poolY}" width="${poolWidth}" height="${poolHeight}" />
      </bpmndi:BPMNShape>
`;

        // Calculate lane positions and bounds
        let laneIndex = 0;
        let currentY = poolY + 30; // Leave space for pool label
        const laneHeight = (poolHeight - 30) / swimlanes.size;

        for (const [laneName, laneNodes] of swimlanes.entries()) {
          const laneId = `Lane_${laneIndex}`;
          const laneY = currentY;

          laneData.set(laneName, {
            id: laneId,
            y: laneY,
            height: laneHeight,
            centerY: laneY + laneHeight / 2
          });

          bpmnXml += `      <bpmndi:BPMNShape id="${laneId}_di" bpmnElement="${laneId}" isHorizontal="true">
        <dc:Bounds x="${poolX}" y="${laneY}" width="${poolWidth}" height="${laneHeight}" />
      </bpmndi:BPMNShape>
`;
          currentY += laneHeight;
          laneIndex++;
        }
      }

      // Create adjusted node positions (keep original positions but adjust to lane bounds)
      const adjustedNodes = nodes.map(node => {
        let x = node.position?.x || 0;
        let y = node.position?.y || 0;
        const width = node.width || 100;
        const height = node.height || 80;

        // Adjust Y position to be within the swimlane bounds if swimlanes exist
        if (swimlanes.size > 0) {
          const swimlane = node.data?.owner || node.data?.swimlane || node.data?.lane;
          if (swimlane && laneData.has(swimlane)) {
            const lane = laneData.get(swimlane);
            // Keep original Y but ensure it's within the lane with some padding
            const padding = 10;
            const minY = lane.y + padding;
            const maxY = lane.y + lane.height - height - padding;

            // Clamp Y to be within lane bounds
            if (y < minY) {
              y = minY;
            } else if (y > maxY) {
              y = maxY;
            }
          }
        }

        return {
          ...node,
          adjustedPosition: { x, y },
          adjustedWidth: width,
          adjustedHeight: height
        };
      });

      // Add diagram elements with adjusted positions
      adjustedNodes.forEach(node => {
        const nodeId = `node_${node.id}`;
        const { x, y } = node.adjustedPosition;
        const width = node.adjustedWidth;
        const height = node.adjustedHeight;

        bpmnXml += `      <bpmndi:BPMNShape id="${nodeId}_di" bpmnElement="${nodeId}">
        <dc:Bounds x="${x}" y="${y}" width="${width}" height="${height}" />
      </bpmndi:BPMNShape>
`;
      });

      // Add edge diagram elements with orthogonal waypoints (using adjusted positions)
      edges.forEach((edge, index) => {
        const flowId = `flow_${index}`;
        const sourceNode = adjustedNodes.find(n => n.id === edge.source);
        const targetNode = adjustedNodes.find(n => n.id === edge.target);

        if (sourceNode && targetNode) {
          // Create temporary nodes with adjusted positions for waypoint calculation
          const adjustedSource = {
            ...sourceNode,
            position: sourceNode.adjustedPosition,
            width: sourceNode.adjustedWidth,
            height: sourceNode.adjustedHeight
          };
          const adjustedTarget = {
            ...targetNode,
            position: targetNode.adjustedPosition,
            width: targetNode.adjustedWidth,
            height: targetNode.adjustedHeight
          };

          // Create all adjusted nodes for routing calculation
          const allAdjustedNodes = adjustedNodes.map(n => ({
            position: n.adjustedPosition,
            width: n.adjustedWidth,
            height: n.adjustedHeight
          }));

          const waypoints = calculateWaypoints(adjustedSource, adjustedTarget, allAdjustedNodes);

          bpmnXml += `      <bpmndi:BPMNEdge id="${flowId}_di" bpmnElement="${flowId}">
`;
          waypoints.forEach(point => {
            bpmnXml += `        <di:waypoint x="${point.x}" y="${point.y}" />
`;
          });
          bpmnXml += `      </bpmndi:BPMNEdge>
`;
        }
      });

      bpmnXml += `    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

      // Create and download the file
      const fileName = sanitizeFileName();
      const blob = new Blob([bpmnXml], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${fileName}.bpmn`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('BPMN export error:', error);
      showErrorMessage('Failed to export BPMN', setErrorMessage, setShowError);
    }
  };

  const toggleMaximize = () => {
    setIsMaximized(!isMaximized);
  };

  // Edge label editing functions
  const handleEdgeLabelSave = () => {
    if (selectedEdge) {
      const newEdges = edges.map((edge) =>
        edge.id === selectedEdge.id
          ? { ...edge, label: edgeLabel }
          : edge
      );
      setEdges(newEdges);
      saveToHistory(nodes, newEdges);
    }
    setIsEditingEdge(false);
    setSelectedEdge(null);
    setEdgeLabel('');
  };

  const handleEdgeLabelCancel = () => {
    setIsEditingEdge(false);
    setSelectedEdge(null);
    setEdgeLabel('');
  };

  const handleEdgeDelete = () => {
    if (selectedEdge) {
      const newEdges = edges.filter((edge) => edge.id !== selectedEdge.id);

      // Renumber nodes based on new flow sequence
      const renumberedNodes = renumberByFlowSequence(nodes, newEdges);

      setEdges(newEdges);
      setNodes(renumberedNodes);
      saveToHistory(renumberedNodes, newEdges);
    }
    setIsEditingEdge(false);
    setSelectedEdge(null);
    setEdgeLabel('');
  };



  // Tool functions
  const addTaskNode = () => {
    const newNodeId = `task-${Date.now()}`;
    const logicalId = getNextLogicalId(nodes);
    const newNode = {
      id: newNodeId,
      type: 'default',
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: {
        label: 'New Task',
        id: newNodeId,
        logical_id: logicalId,
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'default'
      }
    };
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    saveToHistory(newNodes, edges);
  };

  const addGatewayNode = () => {
    const newNodeId = `gateway-${Date.now()}`;
    const logicalId = getNextLogicalId(nodes);
    const newNode = {
      id: newNodeId,
      type: 'decision',
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 100 },
      data: {
        label: 'Decision?',
        id: newNodeId,
        logical_id: logicalId,
        owner: 'TBD',
        system: 'TBD',
        manualOrAutomated: 'manual',
        type: 'decision'
      }
    };
    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    saveToHistory(newNodes, edges);
  };

  const handleNodeClick = (event, node) => {
    if (selectedTool === 'delete') {
      const newNodes = nodes.filter((n) => n.id !== node.id);
      const newEdges = edges.filter((e) => e.source !== node.id && e.target !== node.id);

      // Renumber nodes based on new flow sequence
      const renumberedNodes = renumberByFlowSequence(newNodes, newEdges);

      setNodes(renumberedNodes);
      setEdges(newEdges);
      saveToHistory(renumberedNodes, newEdges);
    } else if (selectedTool === 'select') {
      // Clear edge selection when selecting nodes
      setSelectedEdges([]);
    }
  };

  const handleEdgeClick = (event, edge) => {
    if (selectedTool === 'delete') {
      const newEdges = edges.filter((e) => e.id !== edge.id);

      // Renumber nodes based on new flow sequence
      const renumberedNodes = renumberByFlowSequence(nodes, newEdges);

      setEdges(newEdges);
      setNodes(renumberedNodes);
      saveToHistory(renumberedNodes, newEdges);
    } else if (selectedTool !== 'select') {
      // If we have a tool selected (not select), set up for mid-step insertion
      setTargetEdgeForInsertion(edge);
      setIsMidStepInsertion(true);
    } else {
      // Handle edge selection (single click = select only, double click = edit)
      if (event.ctrlKey || event.metaKey) {
        // Multi-select with Ctrl/Cmd
        setSelectedEdges(prev =>
          prev.includes(edge.id)
            ? prev.filter(id => id !== edge.id)
            : [...prev, edge.id]
        );
        // Clear node selection when selecting edges
        setNodes(prev => prev.map(node => ({ ...node, selected: false })));
      } else {
        // Single click = select only (for highlighting source/target)
        setSelectedEdges([edge.id]);
        setSelectedEdge(edge); // Track selected edge for node highlighting
        // Clear node selection when selecting edges
        setNodes(prev => prev.map(node => ({ ...node, selected: false })));
        // Don't open edit dialog on single click - use double click instead
      }
    }
  };

  // Handle edge double-click for editing label
  const handleEdgeDoubleClick = (event, edge) => {
    if (selectedTool === 'select') {
      // Double click = open edit dialog
      setSelectedEdge(edge);
      setEdgeLabel(edge.label || '');
      setIsEditingEdge(true);
    }
  };

  // Handle clicking on the background (pane) to deselect edges
  const handlePaneClick = useCallback(() => {
    setSelectedEdge(null);
    setSelectedEdges([]);
  }, []);

  const handleEdgeMouseEnter = (event, edge) => {
    if (selectedTool !== 'select') {
      setTargetEdgeForInsertion(edge);
      setIsMidStepInsertion(true);
      // Add visual feedback
      event.target.style.stroke = '#ff6b6b';
      event.target.style.strokeWidth = '4';
    }
  };

  const handleEdgeMouseLeave = (event, edge) => {
    if (selectedTool !== 'select') {
      setTargetEdgeForInsertion(null);
      setIsMidStepInsertion(false);
      // Remove visual feedback
      event.target.style.stroke = '#007bff';
      event.target.style.strokeWidth = '2';
    }
  };

  const handleSaveFlow = async () => {
    if (onSaveFlow && processId) {
      const flowData = {
        nodes: nodes,
        edges: edges,
        // Preserve recording_metadata so screenshots remain available
        ...(recordingMetadata && { recording_metadata: recordingMetadata })
      };
      await onSaveFlow(flowData, processId, processName);
      // Refresh SOP status so we can show "out of sync" nudges after flow changes
      const targetProcessId = getTargetProcessId();
      if (targetProcessId) {
        await fetchSopStatus(targetProcessId);
      }
    }
  };

  const getTargetProcessId = () => processId || selectedProcess?.id;

  async function fetchSopStatus(targetProcessId) {
    if (!targetProcessId) return null;
    setSopStatusLoading(true);
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/processes/${targetProcessId}/sop-status`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        // API might fail if DB columns don't exist yet - this is OK
        console.warn('SOP status API unavailable, SOP features will work with defaults');
        setSopStatus(null);
        setSopDraftUrl(null);
        setSopFinalUrl(null);
        setSopFinalPdfUrl(null);
        setSopHasRecordingData(false);
        return null;
      }
      const data = await response.json();
      setSopStatus(data.status || null);
      setSopDraftUrl(data.draft_url || null);
      setSopFinalUrl(data.final_url || null);
      setSopFinalPdfUrl(data.final_pdf_url || null);
      setSopHasRecordingData(Boolean(data.has_recording_data));
      setSopGeneratedAt(data.generated_at || null);
      setSopFinalizedAt(data.finalized_at || null);
      setSopFlowOutOfSync(Boolean(data.flow_out_of_sync));
      setSopFlowLastSyncedAt(data.flow_last_synced_at || null);
      return data;
    } catch (error) {
      // Network or other error - SOP features still work, just without status tracking
      console.warn('Error fetching SOP status (SOP generation still available):', error.message);
      setSopStatus(null);
      setSopDraftUrl(null);
      setSopFinalUrl(null);
      setSopFinalPdfUrl(null);
      setSopHasRecordingData(false);
      setSopGeneratedAt(null);
      setSopFinalizedAt(null);
      setSopFlowOutOfSync(false);
      setSopFlowLastSyncedAt(null);
      return null;
    } finally {
      setSopStatusLoading(false);
    }
  }
  
  // Helper function to format SOP filename: yymmdd-process-name-vDraft/vFinal
  const formatSopFilename = (processName, version, dateStr, extension) => {
    // Format date as yymmdd
    let datePrefix = '';
    if (dateStr) {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        const yy = String(date.getFullYear()).slice(-2);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        datePrefix = `${yy}${mm}${dd}-`;
      }
    }
    
    // Sanitize process name: replace spaces and special chars with hyphens
    const sanitizedName = (processName || 'Process')
      .replace(/[^a-zA-Z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
    
    return `${datePrefix}${sanitizedName}-v${version}.${extension}`;
  };

  // Export SOP as Word document
  const exportSOPWord = async () => {
    // Use processId prop or selectedProcess.id
    const targetProcessId = getTargetProcessId();
    
    if (!targetProcessId) {
      alert('Please select a process first. Go to the Overview tab and click on a process to open it.');
      return;
    }
    
    // Set loading state
    setSopExportStatus('loading');
    
    try {
      // Capture high-res screenshot of the process flow
      let flowScreenshot = null;
      if (flowRef.current && reactFlowInstance.current && nodes.length > 0) {
        try {
          // Fit view to capture entire flow (minimize padding for max resolution)
          reactFlowInstance.current.fitView({ padding: 0.05, duration: 0, includeHiddenNodes: true });
          
          // Wait for the view to settle
          await new Promise(resolve => setTimeout(resolve, 800));
          
          // Capture the entire flow container (same as PNG export)
          // This ensures we get exactly what is visible after fitView
          if (flowRef.current) {
            const dataUrl = await htmlToImage.toPng(flowRef.current, {
              quality: 1.0,
              pixelRatio: 4, // Ultra-high resolution for zooming
              backgroundColor: '#ffffff',
              style: {
                width: '100%',
                height: '100%'
              },
              filter: (node) => {
                const classList = node.classList;
                if (!classList) return true;
                // Exclude UI elements
                return !classList.contains('react-flow__controls') &&
                       !classList.contains('react-flow__minimap') &&
                       !classList.contains('react-flow__attribution') &&
                       !classList.contains('react-flow__background') &&
                       !classList.contains('visio-toolbar') &&
                       !classList.contains('controls');
              }
            });
            flowScreenshot = dataUrl;
          }
        } catch (screenshotError) {
          console.warn('Failed to capture flow screenshot:', screenshotError);
          // Continue without screenshot
        }
      }
      
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/export/sop/${targetProcessId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          flow_screenshot: flowScreenshot
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to generate SOP');
      }

      // New behavior: backend enqueues SOP generation and returns 202 immediately.
      if (response.status === 202) {
        try {
          // Best-effort: consume JSON so we can surface any useful message.
          const payload = await response.json();
          console.log('SOP generation queued:', payload);
        } catch {
          // Ignore parse errors
        }

        // Poll SOP status until draft is ready (or failed / timeout)
        const pollIntervalMs = 2000;
        const timeoutMs = 2 * 60 * 1000;
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
          const statusData = await fetchSopStatus(targetProcessId);
          const status = statusData?.status;

          if (status === 'failed') {
            throw new Error('SOP generation failed. Please try again.');
          }

          if (status === 'draft' || status === 'final') {
            setSopExportStatus('success');
            setTimeout(() => setSopExportStatus('idle'), 2000);
            return;
          }
        }

        // Timed out waiting; leave the UI in idle state and let the user download later.
        setSopExportStatus('idle');
        alert('SOP generation is still processing. It will appear as a draft shortly.');
        return;
      }

      // Backward-compatible behavior (older backend): download the file directly.
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'SOP.docx';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?(.+)"?/);
        if (match) {
          filename = match[1].replace(/"/g, '');
        }
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      setSopExportStatus('success');
      setTimeout(() => setSopExportStatus('idle'), 2000);
      await fetchSopStatus(targetProcessId);
    } catch (error) {
      console.error('Error exporting SOP:', error);
      alert('Failed to export SOP: ' + error.message);
      setSopExportStatus('idle');
    }
  };

  const generateSOP = async () => {
    await exportSOPWord();
  };

  const regenerateSOP = async () => {
    await exportSOPWord();
  };

  const downloadDraftSOP = async () => {
    if (!sopDraftUrl) return;
    
    // Generate proper filename: yymmdd-process-name-vDraft.docx
    const processName = selectedProcess?.name || 'Process';
    const filename = formatSopFilename(processName, 'Draft', sopGeneratedAt, 'docx');
    console.log('Downloading draft SOP with filename:', filename);
    
    try {
      // Fetch the file and download with proper name
      const response = await fetch(sopDraftUrl, { mode: 'cors' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error fetching draft SOP for download:', error);
      // Fallback: use authenticated proxy endpoint to get proper filename
      try {
        const targetProcessId = getTargetProcessId();
        const token = await getToken();
        const response = await fetch(`${API_BASE_URL}/api/processes/${targetProcessId}/sop/download-draft`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        } else {
          throw new Error('Proxy download failed');
        }
      } catch (proxyError) {
        console.error('Fallback download also failed:', proxyError);
        // Last resort: direct link (loses custom filename)
        window.open(sopDraftUrl, '_blank');
      }
    }
  };

  const downloadFinalSOP = async () => {
    if (!sopFinalUrl) return;
    
    // Generate proper filename: yymmdd-process-name-vFinal.docx
    const processName = selectedProcess?.name || 'Process';
    const filename = formatSopFilename(processName, 'Final', sopFinalizedAt, 'docx');
    console.log('Downloading final SOP with filename:', filename);
    
    try {
      // Fetch the file and download with proper name
      const response = await fetch(sopFinalUrl, { mode: 'cors' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error fetching SOP for download:', error);
      // Fallback: use authenticated proxy endpoint to get proper filename
      try {
        const targetProcessId = getTargetProcessId();
        const token = await getToken();
        const response = await fetch(`${API_BASE_URL}/api/processes/${targetProcessId}/sop/download-final`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        } else {
          throw new Error('Proxy download failed');
        }
      } catch (proxyError) {
        console.error('Fallback download also failed:', proxyError);
        // Last resort: direct link (loses custom filename)
        window.open(sopFinalUrl, '_blank');
      }
    }
  };

  const viewSopAsPdf = async () => {
    if (!sopFinalPdfUrl) {
      // Fallback to Word if PDF not available
      console.warn('PDF version not available, downloading Word document');
      downloadFinalSOP();
      return;
    }

    // Generate proper filename: yymmdd-process-name-vFinal.pdf
    const processName = selectedProcess?.name || 'Process';
    const filename = formatSopFilename(processName, 'Final', sopFinalizedAt, 'pdf');
    console.log('Downloading PDF SOP with filename:', filename);

    try {
      const response = await fetch(sopFinalPdfUrl, { mode: 'cors' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error fetching PDF for download:', error);
      // Fallback: use authenticated proxy endpoint
      try {
        const targetProcessId = getTargetProcessId();
        const token = await getToken();
        const response = await fetch(`${API_BASE_URL}/api/processes/${targetProcessId}/sop/download-pdf`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (response.ok) {
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        } else {
          throw new Error('Proxy download failed');
        }
      } catch (proxyError) {
        console.error('Fallback download also failed:', proxyError);
        window.open(sopFinalPdfUrl, '_blank');
      }
    }
  };

  const handleEditSopManually = async () => {
    const targetProcessId = getTargetProcessId();
    if (!targetProcessId) return;

    try {
      // Download the final SOP
      await downloadFinalSOP();
      
      // Change status back to draft
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/processes/${targetProcessId}/sop/revert-to-draft`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to revert SOP to draft status');
      }
      
      await fetchSopStatus(targetProcessId);
      setShowSopEditModal(false);
    } catch (error) {
      console.error('Error reverting SOP to draft:', error);
      alert('Downloaded SOP but failed to update status: ' + error.message);
    }
  };

  const handleRemoveSop = async () => {
    const targetProcessId = getTargetProcessId();
    if (!targetProcessId) return;

    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/processes/${targetProcessId}/sop`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('Failed to remove SOP');
      }
      await fetchSopStatus(targetProcessId);
      setShowSopRemoveConfirm(false);
    } catch (error) {
      console.error('Error removing SOP:', error);
      alert('Failed to remove SOP: ' + error.message);
    }
  };

  const handleFinalSopUpload = async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;
    const targetProcessId = getTargetProcessId();
    if (!targetProcessId) return;

    setSopUploadStatus('uploading');
    setSopUploadError(null);
    setSopSyncSummary(null);

    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${API_BASE_URL}/api/processes/${targetProcessId}/sop/upload-final`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      if (!response.ok) {
        const errorData = await response.json();
        const detail = errorData.detail;
        if (detail && typeof detail === 'object') {
          // Validation error with specifics - show modal
          setSopUploadError({
            message: detail.message || 'SOP validation failed',
            trackedChanges: detail.unapproved_changes || [],
            comments: detail.unresolved_comments || []
          });
          setSopUploadStatus('error');
          return;
        }
        throw new Error(detail || 'Failed to upload SOP');
      }
      
      // Parse the response to get sync summary
      const responseData = await response.json();
      if (responseData.sync_summary || responseData.sync_details) {
        setSopSyncSummary({
          summary: responseData.sync_summary,
          details: responseData.sync_details,
          flow_synced: responseData.flow_synced
        });
      }
      
      // If flow was synced, refetch the flow data to update the canvas
      if (responseData.flow_synced && flowId) {
        try {
          const flowResponse = await fetch(`${API_BASE_URL}/api/process-flows/process/${targetProcessId}`, {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          if (flowResponse.ok) {
            const flowsData = await flowResponse.json();
            if (flowsData && flowsData.length > 0) {
              const latestFlow = flowsData[0];
              if (latestFlow.flow_data?.nodes) {
                setNodes(latestFlow.flow_data.nodes);
              }
              if (latestFlow.flow_data?.edges) {
                setEdges(latestFlow.flow_data.edges);
              }
              console.log('Flow data reloaded after SOP sync:', latestFlow.flow_data?.nodes?.length, 'nodes');
            }
          }
        } catch (reloadError) {
          console.warn('Failed to reload flow data after SOP sync:', reloadError);
        }
      }
      
      await fetchSopStatus(targetProcessId);
      setSopUploadStatus('success');
      // Don't auto-close if we have sync info to show
      if (!responseData.flow_synced) {
        setTimeout(() => {
          setSopUploadStatus('idle');
          setSopSyncSummary(null);
        }, 3000);
      }
    } catch (error) {
      console.error('Error uploading SOP:', error);
      setSopUploadError({
        message: error.message || 'Failed to upload SOP',
        trackedChanges: [],
        comments: []
      });
      setSopUploadStatus('error');
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  useEffect(() => {
    const targetProcessId = getTargetProcessId();
    if (targetProcessId) {
      fetchSopStatus(targetProcessId);
    }
  }, [processId, selectedProcess?.id]);

  const exportOptions = [
    { key: 'png', label: 'Export as PNG', action: downloadPNG },
    { key: 'pdf', label: 'Export as PDF', action: downloadPDF },
    { key: 'json', label: 'Export as JSON', action: downloadJSON },
    { key: 'bpmn', label: 'Export as BPMN 2.0', action: downloadBPMN },
  ];

  // Multi-select operations
  const deleteSelectedNodes = () => {
    const selectedNodeIds = nodes.filter(node => node.selected).map(node => node.id);
    if (selectedNodeIds.length > 0) {
      const newNodes = nodes.filter(node => !node.selected);
      const newEdges = edges.filter(edge =>
        !selectedNodeIds.includes(edge.source) && !selectedNodeIds.includes(edge.target)
      );

      // Renumber nodes based on new flow sequence
      const renumberedNodes = renumberByFlowSequence(newNodes, newEdges);

      setNodes(renumberedNodes);
      setEdges(newEdges);
      saveToHistory(renumberedNodes, newEdges);
    }
  };

  const deleteSelectedEdges = () => {
    if (selectedEdges.length > 0) {
      const newEdges = edges.filter(edge => !selectedEdges.includes(edge.id));

      // Renumber nodes based on new flow sequence
      const renumberedNodes = renumberByFlowSequence(nodes, newEdges);

      setEdges(newEdges);
      setNodes(renumberedNodes);
      setSelectedEdges([]);
      saveToHistory(renumberedNodes, newEdges);
    }
  };

  // Unified delete function for both nodes and edges
  const deleteSelected = () => {
    if (selectedEdges.length > 0) {
      deleteSelectedEdges();
    } else {
      deleteSelectedNodes();
    }
  };

  // Handle multi-select mouse behavior
  React.useEffect(() => {
    const handleMouseDown = (event) => {
      // Only allow multi-select within the ReactFlow canvas
      const isWithinCanvas = event.target.closest('.react-flow');
      if (event.shiftKey && isWithinCanvas && selectedTool === 'select') {
        // Allow ReactFlow to handle the multi-select
        return;
      } else if (event.shiftKey && !isWithinCanvas) {
        // Prevent multi-select outside the canvas
        event.preventDefault();
        event.stopPropagation();
      }
    };

    document.addEventListener('mousedown', handleMouseDown, true);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown, true);
    };
  }, [selectedTool]);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (showExportDropdown && !event.target.closest('.dropdown-container')) {
        setShowExportDropdown(false);
      }
      if (showAddDecisionDropdown && !event.target.closest('.dropdown-container')) {
        setShowAddDecisionDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showExportDropdown, showAddDecisionDropdown]);

  // Warn user about unsaved changes when leaving the page
  React.useEffect(() => {
    const handleBeforeUnload = (e) => {
      // Check if there are unsaved changes by comparing with history
      if (historyIndex >= 0) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [historyIndex]);

  return (
    <div className={`flow-section ${isMaximized ? 'maximized' : ''}`}>

      {/* Viewing Version Indicator - at top level for visibility */}
      {viewingVersion && (
        <div className="viewing-version-banner">
          <div className="viewing-version-info">
            <span className="viewing-version-label">Viewing:</span>
            <span className="viewing-version-name">
              Version {viewingVersion.version_number} from {new Date(viewingVersion.created_at).toLocaleString()}
            </span>
          </div>
          <div className="viewing-version-actions">
            {viewingVersion.sop_url && (
              <button
                className="viewing-version-exit"
                onClick={() => window.open(viewingVersion.sop_url, '_blank')}
                title="Open the SOP attached to this version"
                style={{ marginRight: '8px' }}
              >
                Open SOP
              </button>
            )}
            <button
              className="viewing-version-restore"
              onClick={() => handleRestoreVersion(viewingVersion.version_number)}
              disabled={restoringVersionId === viewingVersion.version_number}
            >
              {restoringVersionId === viewingVersion.version_number ? 'Restoring...' : 'Restore This Version'}
            </button>
            <button
              className="viewing-version-exit"
              onClick={handleExitViewMode}
            >
              Exit Preview
            </button>
          </div>
        </div>
      )}

      <div style={{ padding: '1rem', borderBottom: '1px solid #e0e0e0', background: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {/* Left side: Process Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {/* Folder Icon Button */}
            <button
              className="header-button"
              onClick={() => {
                if (onChangeProcess) {
                  onChangeProcess();
                }
              }}
              title="Change Process"
              style={{
                background: 'white',
                border: '1px solid var(--color-primary)',
                color: 'var(--color-primary)',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '36px',
                height: '36px'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#eff6ff';
                e.target.style.borderColor = '#1e40af';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'white';
                e.target.style.borderColor = 'var(--color-primary)';
              }}
            >
              {/* Folder Icon SVG */}
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
            </button>

            <div style={{
              fontSize: '1.25rem',
              fontWeight: '600',
              color: 'var(--color-text-primary)',
              minWidth: 'fit-content'
            }}>
              {selectedProcess?.name || 'Process'}
            </div>
            {/* Voice mode status indicator */}
            {workflowType === 'voice' && isRecording && (
              <div style={{ fontSize: '0.8rem', color: '#dc3545', fontWeight: '600', marginLeft: '1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc3545', display: 'inline-block', animation: 'pulse-subtle 1.5s infinite' }} />
                Listening...
              </div>
            )}
          </div>

          {/* Right side: Action Buttons */}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>

            {/* Live Mode Status */}
            {workflowType === 'live' && isLiveMode && (
              <div style={{
                fontSize: '0.8rem',
                color: isPaused ? '#ffc107' : '#28a745',
                fontWeight: 'bold',
                marginRight: '1rem'
              }}>
                {isPaused ? 'PAUSED' : 'LIVE'}
              </div>
            )}

            {/* Speak Button */}
            {onStartRecording && (
              !isRecording ? (
                <button
                  className="header-button"
                  onClick={onStartRecording}
                  style={{
                    background: 'var(--color-surface)',
                    border: '1px solid var(--color-primary)',
                    color: 'var(--color-primary)',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--color-accent-hover)';
                    e.currentTarget.style.borderColor = 'var(--color-primary-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'var(--color-surface)';
                    e.currentTarget.style.borderColor = 'var(--color-primary)';
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" x2="12" y1="19" y2="22"/>
                  </svg>
                  Speak
                </button>
              ) : (
                <>
                  <button
                    className="header-button"
                    onClick={onPauseRecording}
                    style={{
                      background: isPaused ? '#ffc107' : '#dc3545',
                      color: 'white',
                      border: `1px solid ${isPaused ? '#ffc107' : '#dc3545'}`,
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    className="header-button"
                    onClick={onStopRecording}
                    style={{
                      background: '#6c757d',
                      color: 'white',
                      border: '1px solid #6c757d',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      fontWeight: '500',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    Stop
                  </button>
                </>
              )
            )}

            {/* Chat Button */}
            <button
              className="header-button"
              onClick={() => {
                window.dispatchEvent(new CustomEvent('openChat', {
                  detail: {
                    existingFlow: { nodes, edges },
                    processId: selectedProcess?.id || processId
                  }
                }));
              }}
              style={{
                background: 'var(--color-surface)',
                color: 'var(--color-primary)',
                border: '1px solid var(--color-primary)',
                padding: '8px 16px',
                borderRadius: '6px',
                fontSize: '14px',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--color-accent-hover)';
                e.currentTarget.style.borderColor = 'var(--color-primary-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--color-surface)';
                e.currentTarget.style.borderColor = 'var(--color-primary)';
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              Chat
            </button>

            {/* Upload Document Button */}
            {onUploadDocument && (
              <button
                className="header-button"
                onClick={onUploadDocument}
                disabled={isRecording}
                style={{
                  background: isRecording ? 'var(--color-background)' : 'var(--color-surface)',
                  border: `1px solid ${isRecording ? 'var(--color-text-secondary)' : 'var(--color-primary)'}`,
                  color: isRecording ? 'var(--color-text-secondary)' : 'var(--color-primary)',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: isRecording ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s ease',
                  opacity: isRecording ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                onMouseEnter={(e) => {
                  if (!isRecording) {
                    e.currentTarget.style.background = 'var(--color-accent-hover)';
                    e.currentTarget.style.borderColor = 'var(--color-primary-hover)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isRecording) {
                    e.currentTarget.style.background = 'var(--color-surface)';
                    e.currentTarget.style.borderColor = 'var(--color-primary)';
                  }
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="12" y1="18" x2="12" y2="12"/>
                  <line x1="9" y1="15" x2="15" y2="15"/>
                </svg>
                Upload
              </button>
            )}

            {/* Save & Finalize Button */}
            {onSaveFinalize && (
              <>
                <button
                  className="header-button"
                  onClick={async () => {
                    // Always allow saving, even with empty flow
                    // Include recording_metadata to preserve screenshot data
                    await onSaveFinalize({ 
                      nodes, 
                      edges,
                      ...(recordingMetadata && { recording_metadata: recordingMetadata })
                    });
                    const targetProcessId = getTargetProcessId();
                    if (targetProcessId) {
                      await fetchSopStatus(targetProcessId);
                    }
                  }}
                  style={{
                    background: '#0E3BAF',
                    color: 'white',
                    border: '1px solid #0E3BAF',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontSize: '14px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = '#0B2E88';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = '#0E3BAF';
                  }}
                >
                  Save
                </button>

                {/* Three-dot menu for additional options */}
                <div className="toolbar-dropdown" style={{ position: 'relative' }}>
                  <button
                    className="header-button"
                    onClick={() => setShowSaveMenu(!showSaveMenu)}
                    style={{
                      background: 'transparent',
                      color: '#5B6B89',
                      border: '1px solid #E1E8F5',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#F7FAFF';
                      e.currentTarget.style.borderColor = '#0E3BAF';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.borderColor = '#E1E8F5';
                    }}
                    title="More options"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <circle cx="12" cy="5" r="2"/>
                      <circle cx="12" cy="12" r="2"/>
                      <circle cx="12" cy="19" r="2"/>
                    </svg>
                  </button>
                  
                  {showSaveMenu && (
                    <>
                      <div 
                        style={{
                          position: 'fixed',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          zIndex: 999
                        }}
                        onClick={() => setShowSaveMenu(false)}
                      />
                      <div 
                        className="dropdown-menu"
                        style={{
                          position: 'absolute',
                          top: '100%',
                          right: 0,
                          left: 'auto',
                          marginTop: '4px',
                          minWidth: '180px',
                          zIndex: 1000
                        }}
                      >
                        <button 
                          className="dropdown-item"
                          style={{ color: '#dc3545' }}
                          onClick={() => {
                            setShowSaveMenu(false);
                            setShowClearConfirm(true);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            <line x1="10" y1="11" x2="10" y2="17"/>
                            <line x1="14" y1="11" x2="14" y2="17"/>
                          </svg>
                          Clean Slate
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="controls">
          {/* Generate Flow Button - Only for upload and manual workflows (voice auto-generates) */}
          {(workflowType === 'upload' || workflowType === 'manual') && transcript && (
            <button
              className="control-button"
              onClick={generateFlow}
              disabled={isGenerating}
              style={{
                background: isGenerating ? '#f0f8ff' : '#28a745',
                border: isGenerating ? '2px solid #007bff' : '1px solid #28a745',
                color: isGenerating ? '#007bff' : 'white',
                position: 'relative',
                overflow: 'visible'
              }}
            >
              {isGenerating ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div className="spinner" style={{
                    width: '20px',
                    height: '20px',
                    border: '3px solid #e3f2fd',
                    borderTop: '3px solid #007bff',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite'
                  }}></div>
                  <span style={{ fontWeight: '500' }}>AI is thinking...</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <span className="dot-pulse" style={{
                      animation: 'dotPulse 1.4s infinite ease-in-out',
                      animationDelay: '0s'
                    }}>●</span>
                    <span className="dot-pulse" style={{
                      animation: 'dotPulse 1.4s infinite ease-in-out',
                      animationDelay: '0.2s'
                    }}>●</span>
                    <span className="dot-pulse" style={{
                      animation: 'dotPulse 1.4s infinite ease-in-out',
                      animationDelay: '0.4s'
                    }}>●</span>
                  </div>
                </div>
              ) : (
                'Generate Flow'
              )}
            </button>
          )}

          <style>{`
            @keyframes dotPulse {
              0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
              30% { opacity: 1; transform: scale(1); }
            }
          `}</style>

          {/* Live Mode Controls */}
          {workflowType === 'live' && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {!isLiveMode ? (
                <button
                  className="control-button"
                  onClick={startLiveMode}
                  style={{
                    background: '#28a745',
                    color: 'white',
                    border: '1px solid #28a745'
                  }}
                >
                  Start Live Session
                </button>
              ) : (
                <>
                  <button
                    className="control-button"
                    onClick={togglePause}
                    style={{
                      background: isPaused ? '#ffc107' : '#dc3545',
                      color: 'white',
                      border: `1px solid ${isPaused ? '#ffc107' : '#dc3545'}`
                    }}
                  >
                    {isPaused ? 'Resume' : 'Pause'}
                  </button>
                  <button
                    className="control-button"
                    onClick={stopLiveMode}
                    style={{
                      background: '#6c757d',
                      color: 'white',
                      border: '1px solid #6c757d'
                    }}
                  >
                    Stop
                  </button>
                </>
              )}

              {/* AI Processing Status Indicator */}
              {aiProcessingStatus !== 'idle' && (
                <div className="ai-processing-indicator" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.5rem 1rem',
                  background: '#f8f9fa',
                  border: '1px solid #dee2e6',
                  borderRadius: '4px',
                  fontSize: '0.9rem',
                  color: '#495057'
                }}>
                  <div className="ai-spinner" style={{
                    width: '16px',
                    height: '16px',
                    border: '2px solid #e3e3e3',
                    borderTop: '2px solid #007bff',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }}></div>
                  <span>
                    {aiProcessingStatus === 'transcribing' ? 'Transcribing audio...' :
                      aiProcessingStatus === 'generating' ? 'Generating flow...' : ''}
                  </span>
                </div>
              )}
            </div>
          )}

          {flowData && (
            <span className="flow-status">
              Process flow generated ({nodes.length} nodes, {edges.length} connections)
            </span>
          )}
        </div>
      </div>

      <div className={`flow-container ${isMaximized ? 'maximized' : ''}`} ref={flowRef}>
        <FlowChartToolbar
          isMaximized={isMaximized}
          toggleMaximize={toggleMaximize}
          handleAddStep={handleAddStep}
          selectedTool={selectedTool}
          setShowAddDecisionDropdown={setShowAddDecisionDropdown}
          showAddDecisionDropdown={showAddDecisionDropdown}
          handleAddDecision={handleAddDecision}
          handleAddMerge={handleAddMerge}
          addStartNode={addStartNode}
          addEndNode={addEndNode}
          handleAutoLayout={handleAutoLayout}
          isGenerating={isGenerating}
          nodes={nodes}
          setNodes={setNodes}
          saveToHistory={saveToHistory}
          edges={edges}
          deleteSelected={deleteSelected}
          selectedEdges={selectedEdges}
          undo={undo}
          redo={redo}
          historyIndex={historyIndex}
          history={history}
          setShowVersionHistory={setShowVersionHistory}
          flowId={flowId}
          sopExportStatus={sopExportStatus}
          showSopDropdown={showSopDropdown}
          setShowSopDropdown={setShowSopDropdown}
          sopStatus={sopStatus}
          sopDraftUrl={sopDraftUrl}
          sopFinalUrl={sopFinalUrl}
          sopFlowOutOfSync={sopFlowOutOfSync}
          setShowSopOutOfSyncModal={setShowSopOutOfSyncModal}
          viewSopAsPdf={viewSopAsPdf}
          setShowSopEditModal={setShowSopEditModal}
          setShowSopRemoveConfirm={setShowSopRemoveConfirm}
          downloadDraftSOP={downloadDraftSOP}
          sopUploadRef={sopUploadRef}
          regenerateSOP={regenerateSOP}
          generateSOP={generateSOP}
          handleFinalSopUpload={handleFinalSopUpload}
          showExportDropdown={showExportDropdown}
          setShowExportDropdown={setShowExportDropdown}
          downloadPNG={downloadPNG}
          downloadPDF={downloadPDF}
          downloadJSON={downloadJSON}
          downloadBPMN={downloadBPMN}
          handleStartFlowView={handleStartFlowView}
        />



        {/* Mid-step Insertion Indicator */}
        {isMidStepInsertion && targetEdgeForInsertion && (
          <div style={{
            position: 'absolute',
            top: '10px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#ff6b6b',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 'bold',
            zIndex: 1000,
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}>
            Click a node type to insert it here
          </div>
        )}

        {/* Error Message Display */}
        {showError && errorMessage && (
          <div style={{
            position: 'absolute',
            top: '60px',
            right: '20px',
            background: '#dc3545',
            color: 'white',
            padding: '12px 16px',
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '500',
            zIndex: 1001,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            maxWidth: '300px',
            opacity: showError ? 1 : 0,
            transform: showError ? 'translateY(0)' : 'translateY(-10px)',
            transition: 'all 0.3s ease-in-out',
            border: '1px solid #c82333'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>⚠️</span>
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {nodes.length === 0 ? (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            color: '#666',
            fontSize: '16px',
            textAlign: 'center',
            padding: '2rem',
            minHeight: 0
          }}>
            {isProcessing ? (
              <>
                <div className="spinner" style={{
                  margin: '0 auto 1rem',
                  width: '48px',
                  height: '48px',
                  border: '4px solid #f3f3f3',
                  borderTop: '4px solid #007bff',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }}></div>
                <div style={{ marginBottom: '0.5rem', fontWeight: '500', fontSize: '18px' }}>
                  {processingMessage || 'Processing...'}
                </div>
                <div style={{ fontSize: '14px', opacity: 0.7 }}>
                  This may take 30-60 seconds for document processing
                </div>
              </>
            ) : (
              <>
                <div style={{ marginBottom: '0.5rem', fontWeight: '500' }}>No Process Flow Yet</div>
                <div style={{ fontSize: '14px', opacity: 0.7 }}>
                  {workflowType === 'document' ? 'Upload a document to generate a flow' :
                    workflowType === 'voice' ? 'Speak to generate a flow' :
                      'Upload a document or describe the process in the chat to generate your process flow '}
                </div>
              </>
            )}
          </div>
        ) : (
          <div 
            className="flow-container"
            onKeyDownCapture={(e) => {
              // Block React Flow's arrow key handling when Shift is pressed
              if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                e.stopPropagation();
                
                // Handle manual resizing with Shift + Arrow keys
                setNodes((nds) => nds.map((node) => {
                  if (!node.selected) return node;
                  
                  const resizeAmount = 10;
                  // Get current dimensions or defaults
                  // Note: We use 160/100 as base defaults matching DefaultNode
                  let currentWidth = node.data.width || node.width || 160;
                  let currentHeight = node.data.height || node.height || 100;
                  
                  if (e.key === 'ArrowRight') currentWidth += resizeAmount;
                  if (e.key === 'ArrowLeft') currentWidth = Math.max(160, currentWidth - resizeAmount);
                  // Disable height resizing via keyboard as requested
                  // if (e.key === 'ArrowDown') currentHeight += resizeAmount;
                  // if (e.key === 'ArrowUp') currentHeight = Math.max(100, currentHeight - resizeAmount);
                  
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      width: currentWidth,
                      height: currentHeight,
                      user_modified: true
                    }
                  };
                }));
              }
            }}
          >
            <ReactFlow
              nodes={nodesWithTopologyErrors}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              onReconnect={onReconnect}
              onEdgeClick={handleEdgeClick}
              onEdgeDoubleClick={handleEdgeDoubleClick}
              onNodeClick={handleNodeClick}
              onPaneClick={handlePaneClick}
              onEdgeMouseEnter={handleEdgeMouseEnter}
              onEdgeMouseLeave={handleEdgeMouseLeave}
              onInit={onInit}
              minZoom={0.1}
              maxZoom={4}
              fitView
              attributionPosition="bottom-left"
              selectNodesOnDrag={true}
              multiSelectionKeyCode={null}
              deleteKeyCode="Delete"
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              defaultEdgeOptions={createStandardEdge('default', 'default')}
              selectionOnDrag={false}
              disableKeyboardA11y={true}
            >
              <Controls />
              <MiniMap />
              <Background variant="dots" gap={12} size={1} />
            </ReactFlow>
          </div>
        )}

        <FlowChartModals
          showVersionHistory={showVersionHistory}
          setShowVersionHistory={setShowVersionHistory}
          versionHistoryError={versionHistoryError}
          versionHistoryLoading={versionHistoryLoading}
          versionHistory={versionHistory}
          handleViewVersion={handleViewVersion}
          handleRestoreVersion={handleRestoreVersion}
          restoringVersionId={restoringVersionId}
          isEditingEdge={isEditingEdge}
          edgeLabel={edgeLabel}
          setEdgeLabel={setEdgeLabel}
          handleEdgeLabelSave={handleEdgeLabelSave}
          handleEdgeLabelCancel={handleEdgeLabelCancel}
          handleEdgeDelete={handleEdgeDelete}
          showClearConfirm={showClearConfirm}
          setShowClearConfirm={setShowClearConfirm}
          handleCleanSlate={handleCleanSlate}
          sopUploadStatus={sopUploadStatus}
          setSopUploadStatus={setSopUploadStatus}
          sopUploadError={sopUploadError}
          setSopUploadError={setSopUploadError}
          sopSyncSummary={sopSyncSummary}
          setSopSyncSummary={setSopSyncSummary}
          showSopEditModal={showSopEditModal}
          setShowSopEditModal={setShowSopEditModal}
          regenerateSOP={regenerateSOP}
          setShowSopDropdown={setShowSopDropdown}
          handleEditSopManually={handleEditSopManually}
          showSopRemoveConfirm={showSopRemoveConfirm}
          setShowSopRemoveConfirm={setShowSopRemoveConfirm}
          handleRemoveSop={handleRemoveSop}
          showSopOutOfSyncModal={showSopOutOfSyncModal}
          setShowSopOutOfSyncModal={setShowSopOutOfSyncModal}
          sopFlowLastSyncedAt={sopFlowLastSyncedAt}
          screenshotModalOpen={screenshotModalOpen}
          setScreenshotModalOpen={setScreenshotModalOpen}
          handleCloseScreenshotModal={handleCloseScreenshotModal}
          screenshotModalNodeId={screenshotModalNodeId}
          screenshotModalNodeLabel={screenshotModalNodeLabel}
          screenshotModalCurrentUrl={screenshotModalCurrentUrl}
          allScreenshots={allScreenshots}
          handleScreenshotChange={handleScreenshotChange}
          flowId={flowId}
          onSaveFinalize={onSaveFinalize}
          nodes={nodes}
          edges={edges}
          recordingMetadata={recordingMetadata}
          setAllScreenshots={setAllScreenshots}
          setRecordingMetadata={setRecordingMetadata}
          handleNavigateToNode={handleNavigateToNode}
        />
      </div>
    </div>
  );
};

export default FlowChart;
