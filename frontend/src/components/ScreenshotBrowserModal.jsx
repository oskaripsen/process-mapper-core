import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';

// SVG Icons (Core style - stroke-based)
const CameraIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
);

const EditIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

const TrashIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
    <line x1="10" y1="11" x2="10" y2="17"/>
    <line x1="14" y1="11" x2="14" y2="17"/>
  </svg>
);

const RefreshIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/>
    <polyline points="1 20 1 14 7 14"/>
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
  </svg>
);

const ImageIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>
);

const UploadIcon = () => (
  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);

const AlertIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
);

const ChevronLeftIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
);

const ChevronRightIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

const XIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

// Decision/fork icon
const ForkIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15"/>
    <circle cx="18" cy="6" r="3"/>
    <circle cx="6" cy="18" r="3"/>
    <path d="M18 9a9 9 0 0 1-9 9"/>
  </svg>
);

/**
 * ScreenshotBrowserModal - Modal for viewing and selecting screenshots for a node
 * Now supports flow navigation with left/right arrows
 */
const ScreenshotBrowserModal = ({
  isOpen,
  onClose,
  nodeId,
  nodeLabel,
  currentScreenshotUrl,
  allScreenshots = [],
  onScreenshotChange,
  flowId,
  onEnsureFlowSaved, // Callback that saves/creates the flow and returns the flowId
  onScreenshotDeleted, // Callback to remove a screenshot from parent allScreenshots & recording_metadata
  onScreenshotAdded, // Callback to add a new screenshot to parent allScreenshots & recording_metadata
  // New props for flow navigation
  nodes = [],
  edges = [],
  onNavigateToNode, // Callback to navigate to a different node
}) => {
  const { getToken } = useAuth();
  const [screenshots, setScreenshots] = useState(() => {
    if (!allScreenshots) return [];
    const seen = new Set();
    return allScreenshots.filter(s => {
      const key = s.url || s;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 'view' | 'edit' | 'select' | 'upload' | 'confirm-delete' | 'decision-choice'
  const [mode, setMode] = useState('view');
  const [selectedUrl, setSelectedUrl] = useState(currentScreenshotUrl);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageError, setImageError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [localCurrentUrl, setLocalCurrentUrl] = useState(currentScreenshotUrl); // Track locally for immediate updates
  const fileInputRef = useRef(null);
  const thumbnailStripRef = useRef(null);
  
  // Decision choice state - for when user needs to pick a path at a decision node
  const [decisionChoices, setDecisionChoices] = useState([]);
  const [pendingDirection, setPendingDirection] = useState(null); // 'forward' or 'backward'
  
  // Expandable label state
  const [labelExpanded, setLabelExpanded] = useState(false);
  
  // Zoom state
  const [isZoomed, setIsZoomed] = useState(false);
  
  // Edit dropdown state
  const [showEditMenu, setShowEditMenu] = useState(false);

  // --- Flow Navigation Helpers ---
  
  // Get a node by ID
  const getNodeById = useCallback((id) => {
    return nodes.find(n => n.id === id);
  }, [nodes]);
  
  // Check if a node is a merge node (should be skipped)
  const isMergeNode = useCallback((node) => {
    if (!node) return false;
    return node.type === 'merge' || node.data?.type === 'merge';
  }, []);
  
  // Check if a node is a decision node (needs path choice)
  const isDecisionNode = useCallback((node) => {
    if (!node) return false;
    return node.type === 'decision' || node.data?.type === 'decision';
  }, []);
  
  // Check if node is navigable (has screenshot or is a process/decision node)
  const isNavigableNode = useCallback((node) => {
    if (!node) return false;
    // Skip merge, start, end nodes
    const nodeType = node.type || node.data?.type;
    if (nodeType === 'merge' || nodeType === 'start' || nodeType === 'end') return false;
    return true;
  }, []);
  
  // Get outgoing edges from a node
  const getOutgoingEdges = useCallback((fromNodeId) => {
    return edges.filter(e => e.source === fromNodeId);
  }, [edges]);
  
  // Get incoming edges to a node
  const getIncomingEdges = useCallback((toNodeId) => {
    return edges.filter(e => e.target === toNodeId);
  }, [edges]);
  
  // Navigate to next node (forward in flow), skipping merge nodes
  // Decision path selection happens when we ARRIVE at a decision node
  const navigateForwardInFlow = useCallback(() => {
    if (!nodeId || nodes.length === 0 || edges.length === 0) return;
    
    const currentNode = getNodeById(nodeId);
    if (!currentNode) return;
    
    const outgoing = getOutgoingEdges(nodeId);
    
    if (outgoing.length === 0) {
      // No forward path
      return;
    }
    
    // Check if current node is a decision node - show path choice BEFORE leaving
    if (isDecisionNode(currentNode) && outgoing.length > 1) {
      // Show choice UI with edge labels (the decision answers like "Yes", "No")
      const choices = outgoing.map(edge => {
        const targetNode = getNodeById(edge.target);
        // For decision nodes, use the edge label as the main choice
        return {
          edgeId: edge.id,
          targetId: edge.target,
          label: edge.label || edge.data?.label || 'Continue',
        };
      });
      setDecisionChoices(choices);
      setPendingDirection('forward');
      setMode('decision-choice');
      return;
    }
    
    // Single path or not a decision - navigate directly (skip merge nodes)
    let targetId = outgoing[0].target;
    let targetNode = getNodeById(targetId);
    
    // Skip merge nodes
    while (targetNode && isMergeNode(targetNode)) {
      const nextEdges = getOutgoingEdges(targetId);
      if (nextEdges.length === 0) break;
      targetId = nextEdges[0].target;
      targetNode = getNodeById(targetId);
    }
    
    if (targetNode && isNavigableNode(targetNode)) {
      onNavigateToNode?.(targetId);
    }
  }, [nodeId, nodes, edges, getNodeById, getOutgoingEdges, isMergeNode, isDecisionNode, isNavigableNode, onNavigateToNode]);
  
  // Navigate to previous node (backward in flow), skipping merge nodes
  // When going back over a merge, and the prev node is a decision, show the NODE label
  const navigateBackwardInFlow = useCallback(() => {
    if (!nodeId || nodes.length === 0 || edges.length === 0) return;
    
    const currentNode = getNodeById(nodeId);
    if (!currentNode) return;
    
    const incoming = getIncomingEdges(nodeId);
    
    if (incoming.length === 0) {
      // No backward path
      return;
    }
    
    // Helper to build choices for backward navigation - always use node labels
    const buildBackwardChoices = (edgeList) => {
      return edgeList.map(edge => {
        const srcNode = getNodeById(edge.source);
        // For backward navigation, always show the node label (not edge label)
        return {
          edgeId: edge.id,
          targetId: edge.source,
          label: srcNode?.data?.label || 'Previous step',
        };
      });
    };
    
    if (incoming.length === 1) {
      // Single path - navigate directly (skip merge nodes going backward)
      let sourceId = incoming[0].source;
      let sourceNode = getNodeById(sourceId);
      
      // Skip merge nodes when going backward
      while (sourceNode && isMergeNode(sourceNode)) {
        const prevEdges = getIncomingEdges(sourceId);
        if (prevEdges.length === 0) break;
        // If merge has multiple incoming, we need to ask user
        if (prevEdges.length > 1) {
          setDecisionChoices(buildBackwardChoices(prevEdges));
          setPendingDirection('backward');
          setMode('decision-choice');
          return;
        }
        sourceId = prevEdges[0].source;
        sourceNode = getNodeById(sourceId);
      }
      
      if (sourceNode && isNavigableNode(sourceNode)) {
        onNavigateToNode?.(sourceId);
      }
    } else {
      // Multiple incoming paths - show choice UI with node labels
      setDecisionChoices(buildBackwardChoices(incoming));
      setPendingDirection('backward');
      setMode('decision-choice');
    }
  }, [nodeId, nodes, edges, getNodeById, getIncomingEdges, isMergeNode, isNavigableNode, onNavigateToNode]);
  
  // Handle user selecting a path at decision/merge point
  const handlePathChoice = useCallback((choice) => {
    let targetId = choice.targetId;
    let targetNode = getNodeById(targetId);
    
    // Skip any merge nodes in the chosen direction
    if (pendingDirection === 'forward') {
      while (targetNode && isMergeNode(targetNode)) {
        const nextEdges = getOutgoingEdges(targetId);
        if (nextEdges.length === 0) break;
        targetId = nextEdges[0].target;
        targetNode = getNodeById(targetId);
      }
    } else {
      while (targetNode && isMergeNode(targetNode)) {
        const prevEdges = getIncomingEdges(targetId);
        if (prevEdges.length === 0) break;
        if (prevEdges.length > 1) break; // Stop at merge with multiple inputs
        targetId = prevEdges[0].source;
        targetNode = getNodeById(targetId);
      }
    }
    
    setMode('view');
    setDecisionChoices([]);
    setPendingDirection(null);
    
    if (targetNode && isNavigableNode(targetNode)) {
      onNavigateToNode?.(targetId);
    }
  }, [getNodeById, isMergeNode, isNavigableNode, getOutgoingEdges, getIncomingEdges, pendingDirection, onNavigateToNode]);
  
  // Check if forward/backward navigation is available
  const canNavigateForward = useMemo(() => {
    if (!nodeId || nodes.length === 0 || edges.length === 0) return false;
    const outgoing = edges.filter(e => e.source === nodeId);
    return outgoing.length > 0;
  }, [nodeId, nodes, edges]);
  
  const canNavigateBackward = useMemo(() => {
    if (!nodeId || nodes.length === 0 || edges.length === 0) return false;
    const incoming = edges.filter(e => e.target === nodeId);
    return incoming.length > 0;
  }, [nodeId, nodes, edges]);

  // Sync internal screenshots state when the parent provides new allScreenshots
  // Deduplicate by URL to prevent React duplicate-key warnings
  useEffect(() => {
    if (allScreenshots) {
      const seen = new Set();
      const deduped = allScreenshots.filter(s => {
        const key = s.url || s;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setScreenshots(deduped);
    }
  }, [allScreenshots]);

  // Find current screenshot index
  useEffect(() => {
    if (selectedUrl && screenshots.length > 0) {
      const idx = screenshots.findIndex(s => s.url === selectedUrl);
      if (idx !== -1) {
        setCurrentIndex(idx);
      }
    }
  }, [selectedUrl, screenshots]);

  // Fetch screenshots if not provided
  useEffect(() => {
    const fetchScreenshots = async () => {
      if (!flowId || screenshots.length > 0) return;
      
      setLoading(true);
      setError('');
      
      try {
        const token = await getToken();
        const response = await fetch(`${API_BASE_URL}/api/process-flows/${flowId}/screenshots`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (!response.ok) {
          throw new Error('Failed to fetch screenshots');
        }
        
        const data = await response.json();
        setScreenshots(data.screenshots || []);
      } catch (err) {
        setError(err.message || 'Failed to load screenshots');
      } finally {
        setLoading(false);
      }
    };

    if (isOpen) {
      fetchScreenshots();
    }
  }, [isOpen, flowId, getToken, screenshots.length]);

  // Reset screenshot URL state when modal opens or the target node changes.
  // This must NOT depend on `nodes`/`edges` to avoid resetting the URL
  // after an upload triggers a parent re-render (flow save → nodes re-apply).
  useEffect(() => {
    if (isOpen && nodeId) {
      setSelectedUrl(currentScreenshotUrl);
      setLocalCurrentUrl(currentScreenshotUrl);
      setImageError(false);
      setIsZoomed(false);
      setShowEditMenu(false);
    }
  }, [isOpen, currentScreenshotUrl, nodeId]);

  // For decision nodes, show path selection immediately.
  // Runs when the node graph changes so we always detect decision nodes correctly.
  useEffect(() => {
    if (isOpen && nodeId) {
      const currentNode = nodes.find(n => n.id === nodeId);
      const nodeType = currentNode?.type || currentNode?.data?.type;
      const outgoing = edges.filter(e => e.source === nodeId);
      
      if (nodeType === 'decision' && outgoing.length > 1) {
        const choices = outgoing.map(edge => {
          return {
            edgeId: edge.id,
            targetId: edge.target,
            label: edge.label || edge.data?.label || 'Continue',
          };
        });
        setDecisionChoices(choices);
        setPendingDirection('forward');
        setMode('decision-choice');
      } else {
        setDecisionChoices([]);
        setPendingDirection(null);
      }
    }
  }, [isOpen, nodeId, nodes, edges]);

  // Preload all node screenshots in background when modal opens
  const [preloadedImages, setPreloadedImages] = useState(new Set());
  
  useEffect(() => {
    if (!isOpen || nodes.length === 0) return;
    
    // Collect all screenshot URLs from nodes
    const screenshotUrls = nodes
      .map(n => n.data?.screenshot_url || n.data?.screenshotUrl)
      .filter(url => url && !preloadedImages.has(url));
    
    // Preload each image
    screenshotUrls.forEach(url => {
      const img = new Image();
      img.onload = () => {
        setPreloadedImages(prev => new Set([...prev, url]));
      };
      img.src = url;
    });
  }, [isOpen, nodes, preloadedImages]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      // Handle Escape key - priority order matters!
      if (e.key === 'Escape') {
        // If zoomed, ignore escape (user must click to close zoom)
        if (isZoomed) {
          return;
        }
        
        e.preventDefault();
        e.stopPropagation();
        
        // 1. Close edit dropdown if open
        if (showEditMenu) {
          setShowEditMenu(false);
          return;
        }
        // 3. Cancel decision choice mode
        if (mode === 'decision-choice') {
          setMode('view');
          setDecisionChoices([]);
          setPendingDirection(null);
          return;
        }
        // 4. Exit select/upload/confirm-delete modes back to view
        if (mode === 'select' || mode === 'upload' || mode === 'confirm-delete') {
          setMode('view');
          setSelectedUrl(localCurrentUrl);
          return;
        }
        // 5. Finally, close the modal
        onClose();
        return;
      }
      
      // Handle Arrow keys for navigation
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        
        // Screenshot gallery navigation (in select mode)
        if (mode === 'select') {
          if (e.key === 'ArrowLeft') {
            navigatePrev();
          } else {
            navigateNext();
          }
        }
        // Flow navigation (in view mode) - navigate between nodes
        else if (mode === 'view' && nodes.length > 0 && edges.length > 0) {
          if (e.key === 'ArrowLeft') {
            navigateBackwardInFlow();
          } else {
            navigateForwardInFlow();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, mode, currentIndex, screenshots.length, localCurrentUrl, onClose, nodes, edges, navigateBackwardInFlow, navigateForwardInFlow, isZoomed, showEditMenu]);

  const navigatePrev = useCallback(() => {
    if (screenshots.length === 0) return;
    const newIndex = currentIndex > 0 ? currentIndex - 1 : screenshots.length - 1;
    setCurrentIndex(newIndex);
    setSelectedUrl(screenshots[newIndex]?.url);
    setImageError(false);
  }, [currentIndex, screenshots]);

  const navigateNext = useCallback(() => {
    if (screenshots.length === 0) return;
    const newIndex = currentIndex < screenshots.length - 1 ? currentIndex + 1 : 0;
    setCurrentIndex(newIndex);
    setSelectedUrl(screenshots[newIndex]?.url);
    setImageError(false);
  }, [currentIndex, screenshots]);

  // Auto-scroll the thumbnail strip so the active thumbnail is always visible
  useEffect(() => {
    if (mode !== 'select' || !thumbnailStripRef.current) return;
    const container = thumbnailStripRef.current;
    const activeThumbnail = container.children[currentIndex];
    if (!activeThumbnail) return;

    // scrollIntoView with 'nearest' avoids jarring jumps when already visible
    activeThumbnail.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [currentIndex, mode]);

  const handleRemoveScreenshot = async () => {
    const screenshotKey = localCurrentUrl || currentScreenshotUrl;

    // Delete from Cloudflare R2 via the backend
    if (flowId && screenshotKey) {
      try {
        const token = await getToken();
        await axios.delete(
          `${API_BASE_URL}/api/process-flows/${flowId}/screenshots`,
          {
            headers: { Authorization: `Bearer ${token}` },
            data: { key: screenshotKey },
          }
        );
      } catch (err) {
        console.warn('Failed to delete screenshot from storage:', err);
        // Continue with frontend removal even if backend delete fails
      }
    }

    // Remove from internal screenshots list so thumbnail strip updates immediately
    if (screenshotKey) {
      setScreenshots(prev => prev.filter(s => s.url !== screenshotKey));
      // Notify parent to also clean allScreenshots & recording_metadata
      if (onScreenshotDeleted) {
        onScreenshotDeleted(screenshotKey);
      }
    }

    // Remove from the node
    onScreenshotChange(nodeId, null);
    // Update local state immediately
    setLocalCurrentUrl(null);
    setSelectedUrl(null);
    setCurrentIndex(0);
    // Show upload mode so user can add a new one
    setMode('upload');
  };

  const handleConfirmSelection = () => {
    onScreenshotChange(nodeId, selectedUrl);
    setLocalCurrentUrl(selectedUrl);
    setImageError(false);
    setMode('view');
  };

  const handleCancel = () => {
    if (mode === 'select' || mode === 'upload' || mode === 'confirm-delete') {
      setMode('view');
      setSelectedUrl(localCurrentUrl);
      setShowEditMenu(false);
      // Reset to current screenshot index
      if (localCurrentUrl) {
        const idx = screenshots.findIndex(s => s.url === localCurrentUrl);
        if (idx !== -1) setCurrentIndex(idx);
      }
    } else {
      onClose();
    }
  };

  // File upload handlers
  const handleFileSelect = async (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await uploadFile(files[0]);
    }
  };

  const uploadFile = async (file) => {
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    setUploading(true);
    setError('');

    try {
      // Ensure we have a valid flowId before uploading
      let resolvedFlowId = flowId;
      if (!resolvedFlowId && onEnsureFlowSaved) {
        resolvedFlowId = await onEnsureFlowSaved();
      }
      if (!resolvedFlowId) {
        setError('Please save the flow first (Ctrl+S) before uploading screenshots');
        setUploading(false);
        return;
      }

      const token = await getToken();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('flow_id', resolvedFlowId);
      if (nodeId) {
        formData.append('node_id', nodeId);
      }

      const response = await axios.post(
        `${API_BASE_URL}/api/process-flows/${resolvedFlowId}/upload-screenshot`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          timeout: 60000, // 1 minute timeout
        }
      );

      const data = response.data;
      
      // Store the raw storage key in node data (persists correctly on save/reload).
      // Use the signed URL for immediate display.
      const storageKey = data.key || data.url;
      const displayUrl = data.url;
      
      // Pass both: storageKey for node data persistence, displayUrl for the modal
      onScreenshotChange(nodeId, storageKey, displayUrl);
      
      // Update local state with signed URL for immediate display
      setLocalCurrentUrl(displayUrl);
      setSelectedUrl(displayUrl);
      setImageError(false); // Reset any previous image error
      
      // Add to local screenshots list
      const newShot = { url: displayUrl, captured_at: new Date().toISOString(), note: 'Manually uploaded', node_id: nodeId };
      setScreenshots(prev => [...prev, { ...newShot, index: prev.length }]);
      
      // Notify parent so allScreenshots & recordingMetadata stay in sync
      if (onScreenshotAdded) {
        onScreenshotAdded(newShot);
      }
      
      // Go back to view mode
      setMode('view');
    } catch (err) {
      const errorMessage = err.response?.data?.detail || err.message || 'Failed to upload screenshot';
      setError(errorMessage);
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  const displayUrl = mode === 'select' ? selectedUrl : localCurrentUrl;
  const hasScreenshot = !!displayUrl;
  const hasMultipleScreenshots = screenshots.length > 1;

  // Check if label needs expansion (roughly more than 2 lines worth of text)
  const labelNeedsExpansion = nodeLabel && nodeLabel.length > 80;

  return (
    <div 
      className="screenshot-modal-overlay" 
      onClick={(e) => e.target === e.currentTarget && handleCancel()}
    >
      <div className="screenshot-modal screenshot-modal-large" onClick={(e) => e.stopPropagation()}>
        {/* Clean header - just close button */}
        <div className="screenshot-modal-header-clean">
          <button className="screenshot-modal-close-clean" onClick={handleCancel} title="Close">
            <XIcon />
          </button>
        </div>

        {/* Body */}
        <div className="screenshot-modal-body">
          {/* Node label - expandable */}
          <div className="screenshot-node-label-section">
            <div 
              className={`screenshot-node-label ${labelExpanded ? 'expanded' : ''} ${labelNeedsExpansion ? 'truncatable' : ''}`}
              onClick={labelNeedsExpansion ? () => setLabelExpanded(!labelExpanded) : undefined}
            >
              {nodeLabel || 'Untitled Node'}
            </div>
            {labelNeedsExpansion && (
              <button 
                className="label-expand-btn"
                onClick={() => setLabelExpanded(!labelExpanded)}
              >
                {labelExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
            {mode === 'select' && hasMultipleScreenshots && (
              <div className="screenshot-counter-inline">
                {currentIndex + 1} of {screenshots.length}
              </div>
            )}
          </div>

          {loading ? (
            <div className="screenshot-loading">
              <div className="spinner"></div>
              <p>Loading screenshots...</p>
            </div>
          ) : error ? (
            <div className="screenshot-error">
              <AlertIcon /> {error}
            </div>
          ) : mode === 'confirm-delete' ? (
            /* Delete confirmation */
            <div className="screenshot-confirm-delete">
              <div className="confirm-delete-icon">
                <AlertIcon />
              </div>
              <h4>Remove this screenshot?</h4>
              <p>This will remove the screenshot from this node. You can select a different screenshot or upload a new one afterwards.</p>
              <div className="confirm-delete-actions">
                <button className="btn-cancel" onClick={() => setMode('edit')}>
                  Cancel
                </button>
                <button className="btn-danger" onClick={handleRemoveScreenshot}>
                  <TrashIcon /> Remove Screenshot
                </button>
              </div>
            </div>
          ) : mode === 'decision-choice' ? (
            /* Decision path choice - centered overlay */
            <div className="decision-choice-container">
              <div className="decision-choice-content">
                <div className="decision-choice-icon">
                  <ForkIcon />
                </div>
                <h4>{pendingDirection === 'forward' ? 'Choose a path' : 'Choose previous step'}</h4>
                <div className="decision-choice-options">
                  {decisionChoices.map((choice, idx) => (
                    <button
                      key={choice.edgeId || idx}
                      className="decision-choice-btn"
                      onClick={() => handlePathChoice(choice)}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
                <button 
                  className="btn-cancel decision-choice-cancel"
                  onClick={() => {
                    setMode('view');
                    setDecisionChoices([]);
                    setPendingDirection(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : mode === 'upload' ? (
            /* Upload area */
            <div className="screenshot-upload-area">
              <div 
                className="upload-dropzone"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <>
                    <div className="spinner"></div>
                    <p>Uploading...</p>
                  </>
                ) : (
                  <>
                    <UploadIcon />
                    <p className="upload-text">Click to select an image</p>
                    <p className="upload-hint">Supports PNG, JPG, GIF, WebP</p>
                  </>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  style={{ display: 'none' }}
                />
              </div>
              
              {screenshots.length > 0 && (
                <div className="upload-or-select">
                  <div className="divider">
                    <span>or select from existing</span>
                  </div>
                  <button 
                    className="btn-select-existing"
                    onClick={() => setMode('select')}
                  >
                    <RefreshIcon /> Browse {screenshots.length} existing screenshot{screenshots.length !== 1 ? 's' : ''}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="screenshot-content">
              {/* Thumbnail strip at TOP in select mode */}
              {mode === 'select' && screenshots.length > 0 && (
                <div className="screenshot-thumbnails screenshot-thumbnails-top" ref={thumbnailStripRef}>
                  {screenshots.map((shot, idx) => (
                    <div
                      key={`thumb-${idx}`}
                      className={`thumbnail ${idx === currentIndex ? 'active' : ''} ${shot.url === currentScreenshotUrl ? 'current' : ''}`}
                      onClick={() => {
                        setCurrentIndex(idx);
                        setSelectedUrl(shot.url);
                        setImageError(false);
                      }}
                      title={shot.timestamp ? `Timestamp: ${shot.timestamp}s` : `Screenshot ${idx + 1}`}
                    >
                      <img src={shot.url} alt={`Thumbnail ${idx + 1}`} />
                      {shot.url === currentScreenshotUrl && (
                        <span className="current-marker">Current</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              {/* Preview label in select mode */}
              {mode === 'select' && (
                <div className="screenshot-preview-label">Preview</div>
              )}
              
              {/* Main image area with navigation overlays */}
              <div className={`screenshot-image-container ${mode === 'select' ? 'screenshot-image-preview' : ''}`}>
                {/* Flow navigation - previous node (in view mode) */}
                {mode === 'view' && nodes.length > 0 && edges.length > 0 && (
                  <button 
                    className={`screenshot-nav-btn screenshot-nav-prev ${!canNavigateBackward ? 'nav-disabled' : ''}`}
                    onClick={canNavigateBackward ? navigateBackwardInFlow : undefined}
                    disabled={!canNavigateBackward}
                    title="Previous step in flow (← arrow key)"
                  >
                    <ChevronLeftIcon />
                  </button>
                )}

                {/* Screenshot gallery navigation - previous (in select mode) */}
                {mode === 'select' && hasMultipleScreenshots && (
                  <button 
                    className="screenshot-nav-btn screenshot-nav-prev"
                    onClick={navigatePrev}
                    title="Previous screenshot"
                  >
                    <ChevronLeftIcon />
                  </button>
                )}

                {hasScreenshot && !imageError ? (
                  <img 
                    src={displayUrl} 
                    alt={`Screenshot for ${nodeLabel}`}
                    className="screenshot-image"
                    onError={() => setImageError(true)}
                    onDoubleClick={() => setIsZoomed(true)}
                    title="Double-click to zoom"
                  />
                ) : (
                  <div className="screenshot-placeholder">
                    <ImageIcon />
                    <p>{imageError ? 'Failed to load image' : 'No screenshot assigned'}</p>
                    {screenshots.length > 0 && mode === 'view' && (
                      <p className="placeholder-hint">Click Edit to choose a screenshot</p>
                    )}
                  </div>
                )}

                {/* Flow navigation - next node (in view mode) */}
                {mode === 'view' && nodes.length > 0 && edges.length > 0 && (
                  <button 
                    className={`screenshot-nav-btn screenshot-nav-next ${!canNavigateForward ? 'nav-disabled' : ''}`}
                    onClick={canNavigateForward ? navigateForwardInFlow : undefined}
                    disabled={!canNavigateForward}
                    title="Next step in flow (→ arrow key)"
                  >
                    <ChevronRightIcon />
                  </button>
                )}

                {/* Screenshot gallery navigation - next (in select mode) */}
                {mode === 'select' && hasMultipleScreenshots && (
                  <button 
                    className="screenshot-nav-btn screenshot-nav-next"
                    onClick={navigateNext}
                    title="Next screenshot"
                  >
                    <ChevronRightIcon />
                  </button>
                )}

                {/* Edit button with dropdown menu (view mode only) */}
                {mode === 'view' && (
                  <div className="screenshot-edit-dropdown">
                    <button 
                      className="screenshot-edit-btn"
                      onClick={() => setShowEditMenu(!showEditMenu)}
                      title="Edit screenshot"
                    >
                      <EditIcon />
                    </button>
                    
                    {showEditMenu && (
                      <>
                        <div 
                          className="screenshot-edit-backdrop"
                          onClick={() => setShowEditMenu(false)}
                        />
                        <div className="screenshot-edit-menu">
                          {screenshots.length > 0 && (
                            <button 
                              className="screenshot-edit-menu-item"
                              onClick={() => {
                                setShowEditMenu(false);
                                setMode('select');
                              }}
                            >
                              <RefreshIcon />
                              <span>Select Different</span>
                            </button>
                          )}
                          <button 
                            className="screenshot-edit-menu-item"
                            onClick={() => {
                              setShowEditMenu(false);
                              setMode('upload');
                            }}
                          >
                            <UploadIcon />
                            <span>Upload New</span>
                          </button>
                          {hasScreenshot && (
                            <button 
                              className="screenshot-edit-menu-item screenshot-edit-menu-danger"
                              onClick={() => {
                                setShowEditMenu(false);
                                setMode('confirm-delete');
                              }}
                            >
                              <TrashIcon />
                              <span>Remove</span>
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer - only show when needed */}
        {(mode === 'select' || mode === 'upload') && (
          <div className="screenshot-modal-footer">
            {mode === 'select' ? (
              <>
                <button className="btn-cancel" onClick={handleCancel}>
                  Cancel
                </button>
                <button 
                  className="btn-confirm"
                  onClick={handleConfirmSelection}
                  disabled={!selectedUrl || selectedUrl === currentScreenshotUrl}
                >
                  Use This Screenshot
                </button>
              </>
            ) : mode === 'upload' ? (
              <button className="btn-cancel" onClick={handleCancel}>
                Cancel
              </button>
            ) : null}
          </div>
        )}
      </div>
      
      {/* Zoom overlay */}
      {isZoomed && hasScreenshot && displayUrl && (
        <div 
          className="screenshot-zoom-overlay"
          onClick={() => setIsZoomed(false)}
        >
          <button 
            className="screenshot-zoom-close"
            onClick={() => setIsZoomed(false)}
            title="Close zoom"
          >
            <XIcon />
          </button>
          <img 
            src={displayUrl}
            alt={`Zoomed screenshot for ${nodeLabel}`}
            className="screenshot-zoom-image"
            onClick={() => setIsZoomed(false)}
            style={{ cursor: 'pointer' }}
          />
          <div className="screenshot-zoom-hint">
            Click anywhere to close
          </div>
        </div>
      )}
    </div>
  );
};

export default ScreenshotBrowserModal;
