import React, { useState, useRef } from 'react';
import axios from 'axios';
import { API_BASE_URL, authenticatedFetch } from '../config/api';
import { useAuth } from '../context/AuthContext';
import FlowChart from './FlowChart';
import FileUpload from './FileUpload';
import DocumentUpload from './DocumentUpload';

const UnifiedWorkflowCanvas = ({
  selectedProcess,
  onChangeProcess,
  onError,
  onSuccess
}) => {
  const { getToken } = useAuth();
  const [transcript, setTranscript] = useState('');
  const [flowData, setFlowData] = useState(null);
  const [activeInputMethod, setActiveInputMethod] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState('');
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [showDownloadDialog, setShowDownloadDialog] = useState(false);
  const [isCheckingLens, setIsCheckingLens] = useState(false);
  const [recordingMode, setRecordingMode] = useState('flow_only');
  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [pendingOverwrite, setPendingOverwrite] = useState(null);
  const [lensSessionId, setLensSessionId] = useState(null);
  const [lensSessionData, setLensSessionData] = useState(null);
  const [sopDownloadOpened, setSopDownloadOpened] = useState(false);

  const fileInputRef = useRef(null);
  const docInputRef = useRef(null);
  const audioChunksRef = useRef([]);
  const flowDataRef = useRef(null); // Track latest flow data for incremental updates
  const [currentFlowId, setCurrentFlowId] = useState(null); // Track the current flow ID for updates
  const userEditsRef = useRef([]); // Track user edits for voice mode

  const fetchLatestFlow = React.useCallback(async () => {
    if (!selectedProcess?.id) {
      return;
    }
    console.log('📥 Loading saved flow for process:', selectedProcess.id);
    try {
      const token = await getToken();
      const response = await axios.get(`${API_BASE_URL}/api/process-flows/process/${selectedProcess.id}` , {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (response.data && response.data.length > 0) {
        // Get the most recent flow (first in the list)
        const latestFlow = response.data[0];
        console.log('✅ Loaded flow with', latestFlow.flow_data?.nodes?.length || 0, 'nodes');
        setFlowData(latestFlow.flow_data);
        setCurrentFlowId(latestFlow.id); // Store flow ID for updates
        flowDataRef.current = latestFlow.flow_data; // Initialize ref
        onSuccess?.('Loaded saved flow data');
      } else {
        console.log('ℹ️ No saved flow found for this process');
        // Reset flow data if no saved flow exists
        setFlowData(null);
        setCurrentFlowId(null); // Reset flow ID
        flowDataRef.current = null;
      }
    } catch (error) {
      console.error('Error loading saved flow:', error);
      // Fallback to localStorage for now
      try {
        const savedData = localStorage.getItem(`flow_${selectedProcess.id}`);
        if (savedData) {
          const parsed = JSON.parse(savedData);
          if (parsed.flowData) {
            setFlowData(parsed.flowData);
            flowDataRef.current = parsed.flowData; // Initialize ref
            if (parsed.transcript) {
              setTranscript(parsed.transcript);
            }
            onSuccess?.('Loaded saved flow data from cache');
          }
        }
      } catch (localError) {
        console.error('Error loading from localStorage:', localError);
      }
    }
  }, [getToken, onSuccess, selectedProcess?.id]);

  // Load saved flow data when process changes
  React.useEffect(() => {
    fetchLatestFlow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProcess?.id]);

  // Listen for flow generated from chat and integrate into canvas
  React.useEffect(() => {
    const onFlowFromChat = (e) => {
      const data = e.detail;
      if (data && data.nodes) {
        handleFlowGenerated(data, 'chat');
      }
    };
    window.addEventListener('generateFlowFromChat', onFlowFromChat);
    return () => window.removeEventListener('generateFlowFromChat', onFlowFromChat);
  }, []);

  const handleTranscriptionComplete = (text) => {
    setTranscript(text);
    setActiveInputMethod(null);
    setIsProcessing(false);
    onSuccess?.('Audio transcribed successfully');
  };

  const handleFlowGenerated = (data, inputMethod = 'document') => {
    console.log('📊 Flow data received in UnifiedWorkflowCanvas:', data);
    console.log('  - Has nodes?', !!data?.nodes);
    console.log('  - Has edges?', !!data?.edges);
    console.log('  - Node count:', data?.nodes?.length);
    console.log('  - Edge count:', data?.edges?.length);
    setFlowData(data);
    flowDataRef.current = data; // Update ref immediately for next incremental call
    setActiveInputMethod(inputMethod); // Set to the appropriate input method
    setIsProcessing(false);
    setProcessingMessage('');
    if (inputMethod === 'voice') {
      onSuccess?.('Flow updated from voice input');
    } else {
      onSuccess?.(`Flow generated successfully! (${data?.nodes?.length || 0} steps)`);
    }
  };

  // Handle saving flow when user clicks save button
  // Returns the flowId (existing or newly created) on success, null on failure
  const handleSaveFlow = async (flowDataToSave) => {
    try {
      console.log('💾 Saving flow for process:', selectedProcess.id);
      console.log('  - Current flow ID:', currentFlowId);
      console.log('  - Nodes to save:', flowDataToSave?.nodes?.length);

      let resolvedFlowId = null;

      if (currentFlowId) {
        // Update existing flow
        const response = await authenticatedFetch(
          `${API_BASE_URL}/api/process-flows/${currentFlowId}`,
          {
            method: 'PUT',
            body: {
              flow_data: flowDataToSave
            }
          },
          getToken
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to update flow');
        }

        console.log('✅ Flow updated successfully');
        setFlowData(flowDataToSave); // Update local state
        flowDataRef.current = flowDataToSave;
        onSuccess?.('Process flow updated successfully!');
        resolvedFlowId = currentFlowId;
      } else {
        // Create new flow
        const response = await authenticatedFetch(
          `${API_BASE_URL}/api/process-flows`,
          {
            method: 'POST',
            body: {
              process_id: selectedProcess.id,
              title: `${selectedProcess.name} - Process Flow`,
              description: `Process flow for ${selectedProcess.name}`,
              flow_data: flowDataToSave
            }
          },
          getToken
        );

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.detail || 'Failed to create flow');
        }

        const data = await response.json();
        console.log('✅ Flow created successfully with ID:', data.id);
        setCurrentFlowId(data.id); // Store the new flow ID
        setFlowData(flowDataToSave); // Update local state
        flowDataRef.current = flowDataToSave;
        onSuccess?.('Process flow saved successfully!');
        resolvedFlowId = data.id;
      }

      // Also save to localStorage as backup
      const saveData = {
        processId: selectedProcess.id,
        processName: selectedProcess.name,
        flowData: flowDataToSave,
        timestamp: new Date().toISOString()
      };
      localStorage.setItem(`flow_${selectedProcess.id}`, JSON.stringify(saveData));
      return resolvedFlowId;
    } catch (error) {
      console.error('❌ Error saving flow:', error);
      onError?.('Failed to save flow: ' + (error.message || 'Unknown error'));
      return null;
    }
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Use audio/webm with opus codec for better compatibility
      const options = { mimeType: 'audio/webm;codecs=opus' };
      const recorder = new MediaRecorder(stream, options);

      audioChunksRef.current = [];

      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          console.log('Audio chunk available:', event.data.size, 'bytes');
          // Accumulate chunks to ensure we have complete audio data
          audioChunksRef.current.push(event.data);

          // Create a complete audio blob from all chunks so far
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' });
          console.log('Accumulated audio blob:', audioBlob.size, 'bytes');
          await handleAudioChunk(audioBlob);
        }
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(track => track.stop());
        setIsProcessing(false);
      };

      // Start recording with 15-second chunks
      recorder.start(15000); // Send a chunk every 15 seconds
      setMediaRecorder(recorder);
      setIsRecording(true);
      setActiveInputMethod('voice');
      onSuccess?.('Live recording started...');
    } catch (error) {
      console.error('Error starting recording:', error);
      onError('Failed to start recording. Please check microphone permissions.');
    }
  };

  const handlePauseRecording = () => {
    if (mediaRecorder && isRecording) {
      if (isPaused) {
        // Resume recording - will start sending chunks again
        mediaRecorder.resume();
        setIsPaused(false);
        setIsProcessing(false);
        onSuccess?.('Recording resumed - sending audio chunks every 15 seconds');
      } else {
        // Pause recording - stops sending chunks
        mediaRecorder.pause();
        setIsPaused(true);
        setIsProcessing(false);
        onSuccess?.('Recording paused - audio chunks stopped');
      }
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      setIsRecording(false);
      setIsPaused(false);
      setIsProcessing(true);
      setProcessingMessage('Transcribing audio...');
    }
  };

  const handleAudioChunk = async (audioBlob) => {
    try {
      setIsProcessing(true);
      setProcessingMessage('Transcribing and generating flow...');

      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');

      const token = await getToken();
      const response = await axios.post(`${API_BASE_URL}/transcribe`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        }
      });

      if (response.data.transcript) {
        const newChunk = response.data.transcript;
        let updatedTranscript = transcript ? `${transcript} ${newChunk}` : newChunk;

        const MAX_TRANSCRIPT_CHARS = 5000;
        if (updatedTranscript.length > MAX_TRANSCRIPT_CHARS) {
          updatedTranscript = updatedTranscript.slice(-MAX_TRANSCRIPT_CHARS);
          console.log(`Truncated transcript to last ${MAX_TRANSCRIPT_CHARS} chars`);
        }

        setTranscript(updatedTranscript);
        console.log('Updated transcript:', updatedTranscript.substring(0, 100) + '...');

        setProcessingMessage('Updating process flow...');
        const currentFlow = flowDataRef.current || { nodes: [], edges: [] };

        const userEdits = [];
        if (currentFlow.nodes) {
          currentFlow.nodes.forEach(node => {
            if (node.data?.user_modified) {
              userEdits.push({
                type: 'node_updated',
                id: node.id,
                label: node.data.label,
                changes: 'text/properties'
              });
            }
          });
        }

        console.log('Sending incremental flow request:', {
          existingNodeCount: currentFlow.nodes?.length || 0,
          existingEdgeCount: currentFlow.edges?.length || 0,
          userEditsCount: userEdits.length,
        });

        const incrementalResponse = await axios.post(`${API_BASE_URL}/generate-incremental-flow`, {
          transcript: newChunk,
          accumulatedTranscript: updatedTranscript,
          existingFlow: currentFlow,
          sessionId: Date.now(),
          validationErrors: currentFlow.validationErrors || null,
          userEdits: userEdits.length > 0 ? userEdits : null,
          extractedIntent: null,
        }, {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          }
        });

        if (incrementalResponse.data && incrementalResponse.data.nodes) {
          // Preserve user-positioned nodes
          if (currentFlow.nodes && currentFlow.nodes.length > 0) {
            const existingPositions = new Map();
            currentFlow.nodes.forEach(node => {
              if (node.position) {
                existingPositions.set(node.id, node.position);
              }
            });
            incrementalResponse.data.nodes = incrementalResponse.data.nodes.map(node => {
              const existingPosition = existingPositions.get(node.id);
              if (existingPosition) {
                return { ...node, position: existingPosition };
              }
              return node;
            });
          }

          handleFlowGenerated(incrementalResponse.data, 'voice');
        }

        setIsProcessing(false);
      } else {
        throw new Error('No transcript received');
      }
    } catch (error) {
      console.error('Transcription/Flow generation error:', error);
      setIsProcessing(false);
    }
  };

  const handleRecordingComplete = async (audioBlob) => {
    try {
      setIsProcessing(true);
      setProcessingMessage('Transcribing audio...');

      const formData = new FormData();
      formData.append('file', audioBlob, 'recording.webm');

      const token = await getToken();
      const response = await axios.post(`${API_BASE_URL}/transcribe`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        }
      });

      if (response.data.transcript) {
        setTranscript(response.data.transcript);
        setIsProcessing(false);
        onSuccess?.('Audio transcribed successfully');
      } else {
        throw new Error('No transcript received');
      }
    } catch (error) {
      console.error('Transcription error:', error);
      setIsProcessing(false);
      onError('Failed to transcribe audio: ' + (error.response?.data?.detail || error.message));
    }
  };

  const handleUploadAudio = () => {
    fileInputRef.current?.click();
  };

  const handleUploadDocument = () => {
    docInputRef.current?.click();
  };

  // Check if Mapla Lens is installed by attempting to open the custom protocol
  const checkLensInstalled = () => {
    return new Promise((resolve) => {
      let resolved = false;
      
      // Create a hidden iframe to try opening the protocol
      const iframe = document.createElement('iframe');
      iframe.style.display = 'none';
      document.body.appendChild(iframe);
      
      // Track if window loses focus (app opened)
      const handleBlur = () => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(true);
        }
      };
      
      // Also check visibility change
      const handleVisibilityChange = () => {
        if (document.hidden && !resolved) {
          resolved = true;
          cleanup();
          resolve(true);
        }
      };
      
      const cleanup = () => {
        window.removeEventListener('blur', handleBlur);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
      };
      
      window.addEventListener('blur', handleBlur);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      
      // Try to open the protocol with a simple ping command
      try {
        iframe.contentWindow.location.href = 'mapla://ping';
      } catch (e) {
        // Some browsers may throw on protocol navigation
      }
      
      // Timeout - if nothing happens after 1.5s, assume not installed
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(false);
        }
      }, 1500);
    });
  };

  const handleOpenRecordModal = async () => {
    if (!selectedProcess?.id) {
      onError?.('Please select a process before recording.');
      return;
    }
    
    // Check if user has previously confirmed they have Lens installed
    const hasConfirmedLens = localStorage.getItem('mapla_lens_installed') === 'true';
    
    if (hasConfirmedLens) {
      // User confirmed they have Lens, show record modal directly
      setShowRecordModal(true);
    } else {
      // First time or not confirmed, check if Lens is installed
      setIsCheckingLens(true);
      
      try {
        const isInstalled = await checkLensInstalled();
        setIsCheckingLens(false);
        
        if (isInstalled) {
          // Lens is installed, remember this and show record modal
          localStorage.setItem('mapla_lens_installed', 'true');
          setShowRecordModal(true);
        } else {
          // Lens is not installed, clear stale localStorage and show download dialog
          localStorage.removeItem('mapla_lens_installed');
          setShowDownloadDialog(true);
        }
      } catch (error) {
        setIsCheckingLens(false);
        // On error, show download dialog as fallback
        setShowDownloadDialog(true);
      }
    }
  };

  const startLensRecording = async () => {
    if (!selectedProcess?.id) {
      onError?.('Please select a process before recording.');
      return;
    }
    
    // Force flow_only mode if there's no existing flow
    const hasFlow = flowData && flowData.nodes && flowData.nodes.length > 0;
    const effectiveMode = (!hasFlow && recordingMode === 'sop_only') ? 'flow_only' : recordingMode;
    
    if (effectiveMode !== recordingMode) {
      console.log(`Automatically changed mode from ${recordingMode} to ${effectiveMode} (no existing flow)`);
      setRecordingMode(effectiveMode);
    }
    
    try {
      setIsProcessing(true);
      setProcessingMessage('Starting Mapla Lens...');
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/recordings`,
        {
          method: 'POST',
          body: {
            process_id: selectedProcess.id,
            mode: effectiveMode
          }
        },
        getToken
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to create recording session');
      }

      const tokenResponse = await authenticatedFetch(
        `${API_BASE_URL}/api/recordings/${data.id}/token`,
        {
          method: 'POST'
        },
        getToken
      );
      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok) {
        throw new Error(tokenData.detail || 'Failed to create recording token');
      }

      const protocolUrl = `mapla://record?session_id=${data.id}&process_id=${selectedProcess.id}&mode=${effectiveMode}&token=${encodeURIComponent(tokenData.token)}&api_base=${encodeURIComponent(API_BASE_URL)}`;
      
      // Log for dev testing (copy from console for Tauri dev)
      // console.log('🔗 Mapla Lens Protocol URL:', protocolUrl);
      // console.log('📋 For Tauri dev: npm run tauri dev -- -- "' + protocolUrl + '"');
      
      // Close record modal and open the Lens app
      setShowRecordModal(false);
      window.location.href = protocolUrl;

      setActiveInputMethod('lens');
      setLensSessionId(data.id);
      setLensSessionData(null);
      setSopDownloadOpened(false);
      setIsProcessing(false);
      setProcessingMessage('');
    } catch (error) {
      console.error('Failed to start Mapla Lens recording:', error);
      setIsProcessing(false);
      setProcessingMessage('');
      onError?.(error.message || 'Failed to start Mapla Lens recording.');
    }
  };

  const handleLensSessionCompleted = React.useCallback(async (session) => {
    if (!session) {
      return;
    }
    setLensSessionId(null);
    setLensSessionData(session);
    setIsProcessing(false);
    setProcessingMessage('');
    await fetchLatestFlow();
    const sopDocUrl = session.interaction_metadata?.sop_doc_url;
    if (sopDocUrl && !sopDownloadOpened) {
      setSopDownloadOpened(true);
      window.open(sopDocUrl, '_blank', 'noopener');
    }
    onSuccess?.('Recording processed successfully.');
  }, [fetchLatestFlow, onSuccess, sopDownloadOpened]);

  React.useEffect(() => {
    if (!lensSessionId) {
      return;
    }
    let isActive = true;
    const poll = async () => {
      try {
        const response = await authenticatedFetch(
          `${API_BASE_URL}/api/recordings/${lensSessionId}`,
          { method: 'GET' },
          getToken
        );
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.detail || 'Failed to fetch recording status');
        }
        const session = await response.json();
        if (!isActive) {
          return;
        }
        setLensSessionData(session);
        if (session?.interaction_metadata?.requires_overwrite_confirmation && !showOverwriteConfirm) {
          setPendingOverwrite({
            sessionId: session.id,
            payload: {
              session_id: session.id,
              process_id: session.process_id,
              mode: session.mode,
              transcript: session.transcript,
              screenshot_urls: null,
              interaction_metadata: session.interaction_metadata
            }
          });
          setShowOverwriteConfirm(true);
          setIsProcessing(false);
          setProcessingMessage('');
          return;
        }
        if (session.status === 'completed' || session.status === 'COMPLETED') {
          await handleLensSessionCompleted(session);
        }
      } catch (error) {
        console.error('Failed to poll recording status:', error);
      }
    };

    poll();
    const intervalId = setInterval(poll, 3000);
    return () => {
      isActive = false;
      clearInterval(intervalId);
    };
  }, [getToken, handleLensSessionCompleted, lensSessionId, showOverwriteConfirm]);

  const finalizeLensRecording = React.useCallback(async (payload, overwriteFlow = false) => {
    const sessionId = payload?.sessionId || payload?.session_id;
    const processId = payload?.processId || payload?.process_id || selectedProcess?.id;
    if (!sessionId || !processId) {
      onError?.('Missing recording session details.');
      return;
    }

    const body = {
      process_id: processId,
      mode: payload?.mode || payload?.recordingMode || recordingMode,
      transcript: payload?.transcript || '',
      screenshot_urls: payload?.screenshotUrls || payload?.screenshot_urls || null,
      interaction_metadata: payload?.interactionMetadata || payload?.interaction_metadata || null,
      overwrite_flow: overwriteFlow
    };

    if (!body.transcript || !body.transcript.trim()) {
      onError?.('Recording transcript is empty.');
      return;
    }

    try {
      setIsProcessing(true);
      setProcessingMessage('Processing recording...');
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/recordings/${sessionId}/complete`,
        {
          method: 'POST',
          body
        },
        getToken
      );

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to process recording');
      }

      if (data.requires_overwrite_confirmation) {
        setPendingOverwrite({ sessionId, payload });
        setShowOverwriteConfirm(true);
        setIsProcessing(false);
        setProcessingMessage('');
        return;
      }

      if (data.flow_data) {
        setFlowData(data.flow_data);
        flowDataRef.current = data.flow_data;
      }

      if (data.flow_id) {
        setCurrentFlowId(data.flow_id);
      }

      if (data.sop_doc_url) {
        window.open(data.sop_doc_url, '_blank', 'noopener');
        onSuccess?.('Recording processed. SOP updated.');
      } else {
        onSuccess?.('Recording processed successfully.');
      }
      setIsProcessing(false);
      setProcessingMessage('');
    } catch (error) {
      console.error('Failed to finalize recording:', error);
      setIsProcessing(false);
      setProcessingMessage('');
      onError?.(error.message || 'Failed to process recording.');
    }
  }, [getToken, onError, onSuccess, recordingMode, selectedProcess?.id]);

  React.useEffect(() => {
    const handleLensComplete = (event) => {
      const payload = event.detail;
      if (!payload) {
        return;
      }
      finalizeLensRecording(payload, false);
    };
    window.addEventListener('maplaRecordingComplete', handleLensComplete);
    return () => window.removeEventListener('maplaRecordingComplete', handleLensComplete);
  }, [finalizeLensRecording]);

  const handleError = (error) => {
    setIsProcessing(false);
    onError(error);
  };

  const handleConfirmOverwrite = async () => {
    if (!pendingOverwrite) {
      setShowOverwriteConfirm(false);
      return;
    }
    setShowOverwriteConfirm(false);
    await finalizeLensRecording(pendingOverwrite.payload, true);
    setPendingOverwrite(null);
  };

  const handleCancelOverwrite = () => {
    setShowOverwriteConfirm(false);
    setPendingOverwrite(null);
  };

  const handleCancelLensRecording = async () => {
    if (!lensSessionId) return;
    try {
      // Send cancel signal - this aborts processing entirely
      await authenticatedFetch(
        `${API_BASE_URL}/api/recordings/${lensSessionId}/cancel`,
        { method: 'POST' },
        getToken
      );
    } catch (error) {
      console.error('Failed to cancel lens recording:', error);
    }
    // Always clear local state - user chose to cancel
    setLensSessionId(null);
    setLensSessionData(null);
    setActiveInputMethod(null);
    onSuccess?.('Recording cancelled.');
  };

  // Determine the current lens state
  const lensStatus = lensSessionData?.status?.toLowerCase() || '';
  const isLensRecording = lensSessionId && !lensStatus.includes('completed') && !lensStatus.includes('processing');
  const isLensProcessing = lensSessionId && (lensStatus.includes('processing') || lensStatus === 'stopped');
  const isLensActive = isLensRecording || isLensProcessing;
  
  // Check if session just completed (for showing results)
  const lensJustCompleted = lensSessionData?.status?.toLowerCase() === 'completed';

  // Get mode text
  const getModeText = () => {
    const mode = recordingMode || lensSessionData?.mode || 'flow_sop';
    if (mode === 'sop_only') return 'SOP Document';
    if (mode === 'flow_only') return 'Process Flow';
    return 'Process Flow & SOP Document';
  };

  return (
    <div className={`unified-workflow-canvas ${isLensActive ? 'lens-active' : ''}`}>
      {/* Lens Recording Overlay - covers entire canvas */}
      {isLensRecording && (
        <div className="lens-overlay">
          <div className="lens-overlay-content">
            <div className="lens-overlay-icon">
              <span className="lens-pulse-ring"></span>
              <span className="lens-icon-inner">M</span>
            </div>
            <h2 className="lens-overlay-title">Recording with Mapla Lens</h2>
            <p className="lens-overlay-subtitle">
              Capturing your process in the desktop app...
              {lensSessionData?.interaction_metadata?.screenshots?.length > 0 && (
                <span className="lens-screenshot-badge">
                  {lensSessionData.interaction_metadata.screenshots.length} screenshots
                </span>
              )}
            </p>
            <button
              className="lens-cancel-btn"
              onClick={handleCancelLensRecording}
            >
              Cancel &amp; Return
            </button>
            <p className="lens-overlay-hint">
              Stop recording from the Lens app when finished
            </p>
          </div>
        </div>
      )}

      {/* Lens Processing/Analyzing Overlay */}
      {isLensProcessing && (
        <div className="lens-overlay lens-processing">
          <div className="lens-overlay-content">
            <div className="lens-analyzing-header">
              <div className="lens-analyzing-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <h2 className="lens-overlay-title">Analyzing Your Process</h2>
              <p className="lens-overlay-subtitle">
                Building your {getModeText()}...
              </p>
            </div>
            <div className="lens-processing-steps">
              <div className="processing-step">
                <div className="step-icon-wrapper">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                </div>
                <span>Transcribing audio</span>
                <div className="step-spinner"></div>
              </div>
              <div className="processing-step">
                <div className="step-icon-wrapper">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                </div>
                <span>Analyzing screenshots</span>
                <div className="step-spinner"></div>
              </div>
              <div className="processing-step">
                <div className="step-icon-wrapper">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                </div>
                <span>Generating documentation</span>
                <div className="step-spinner"></div>
              </div>
            </div>
            <p className="lens-overlay-hint">
              This may take a few minutes
            </p>
          </div>
        </div>
      )}

      {/* Processing Indicator */}
      {isProcessing && (
        <div className="processing-banner">
          <span className="spinner-small"></span>
          <span>{processingMessage}</span>
        </div>
      )}

      {/* Hidden file inputs */}
      <div style={{ display: 'none' }}>
        <FileUpload
          ref={fileInputRef}
          onTranscriptionComplete={handleTranscriptionComplete}
          onError={handleError}
        />
        <DocumentUpload
          ref={docInputRef}
          onFlowGenerated={handleFlowGenerated}
          onError={handleError}
          existingFlow={flowData}
          onUploadStart={() => {
            setIsProcessing(true);
            setProcessingMessage('Processing document and generating flow...');
          }}
        />
      </div>

      {/* Transcript Display (only show for non-voice workflows) */}
      {transcript && activeInputMethod !== 'voice' && (
        <div className="transcript-banner">
          <div className="transcript-content">
            <strong>Transcribed:</strong> {transcript.substring(0, 150)}
            {transcript.length > 150 && '...'}
          </div>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => setTranscript('')}
          >
            ×
          </button>
        </div>
      )}

      {/* Main Canvas - Flow Chart with integrated toolbar */}
      <div className="canvas-main">
        <FlowChart
          key={selectedProcess?.id} // Force remount when process changes
          transcript={transcript}
          onError={onError}
          workflowType={activeInputMethod || 'manual'}
          initialFlowData={flowData}
          flowId={currentFlowId}
          selectedProcess={selectedProcess}
          onChangeProcess={onChangeProcess}
          onStartRecording={handleStartRecording}
          onUploadDocument={handleUploadDocument}
            onOpenRecordModal={handleOpenRecordModal}
          isRecording={isRecording}
          isPaused={isPaused}
          onPauseRecording={handlePauseRecording}
          onStopRecording={handleStopRecording}
          flowData={flowData}
          isProcessing={isProcessing}
          processingMessage={processingMessage}
          onSaveFinalize={async (flowDataToSave) => {
            // Save & Finalize captures all changes from current nodes/edges
            // Returns the flowId (existing or newly created)
            return await handleSaveFlow(flowDataToSave);
          }}
        />
      </div>

      {showRecordModal && (
        <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={() => setShowRecordModal(false)}>
          <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Record with Mapla Lens</h3>
            </div>
            <div className="modal-body">
              <p>Select how Mapla Lens should update this process:</p>
              <div style={{ marginTop: '12px' }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: '6px' }}>
                  Recording mode
                </label>
                <select
                  value={recordingMode}
                  onChange={(e) => setRecordingMode(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb'
                  }}
                >
                  <option value="flow_only">Process Flow (create/update flow only)</option>
                  <option value="flow_sop">Process Flow + SOP (generate flow and SOP)</option>
                </select>
              </div>
            </div>
            <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  localStorage.removeItem('mapla_lens_installed');
                  setShowRecordModal(false);
                  setShowDownloadDialog(true);
                }}
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  color: '#6b7280', 
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  textDecoration: 'underline'
                }}
              >
                Lens not opening?
              </button>
              <div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowRecordModal(false)}
                  style={{ marginRight: '8px' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={startLensRecording}
                >
                  Start Recording
                </button>
              </div>
            </div>
          </div>
        </div>
      )}


      {showOverwriteConfirm && (
        <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={handleCancelOverwrite}>
          <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Overwrite Existing Flow?</h3>
            </div>
            <div className="modal-body">
              <p>
                This process already has a flow. Do you want to overwrite it with this recording?
              </p>
            </div>
            <div className="modal-actions">
                <button
                  type="button"
                className="btn btn-secondary"
                onClick={handleCancelOverwrite}
                >
                Cancel
                </button>
                <button
                  type="button"
                className="btn btn-primary"
                onClick={handleConfirmOverwrite}
                >
                Overwrite Flow
                </button>
            </div>
          </div>
        </div>
      )}

      {/* Checking Lens Spinner */}
      {isCheckingLens && (
        <div className="modal-overlay" style={{ zIndex: 10001 }}>
          <div className="modal confirm-dialog" style={{ maxWidth: '350px', textAlign: 'center' }}>
            <div className="modal-body" style={{ padding: '30px' }}>
              <div style={{ 
                width: '40px', 
                height: '40px', 
                border: '3px solid #e5e7eb', 
                borderTopColor: '#2563eb', 
                borderRadius: '50%', 
                animation: 'spin 1s linear infinite',
                margin: '0 auto 16px'
              }} />
              <p style={{ margin: 0, color: '#374151' }}>Checking for Mapla Lens...</p>
            </div>
          </div>
        </div>
      )}

      {/* Download Lens Dialog */}
      {showDownloadDialog && (
        <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={() => setShowDownloadDialog(false)}>
          <div className="modal confirm-dialog" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Mapla Lens Required</h3>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '16px' }}>
                To record your workflow, you need to install <strong>Mapla Lens</strong> — our desktop companion app.
              </p>
              <div style={{ 
                padding: '16px', 
                background: '#f3f4f6', 
                borderRadius: '8px',
                marginBottom: '16px'
              }}>
                <strong style={{ display: 'block', marginBottom: '8px' }}>What is Mapla Lens?</strong>
                <p style={{ margin: 0, fontSize: '0.9em', color: '#4b5563' }}>
                  Mapla Lens captures your screen activity and automatically generates process flows and SOPs from your recordings.
                </p>
              </div>
              <p style={{ fontSize: '0.9em', color: '#6b7280', margin: 0 }}>
                After installing, come back and click Record again.
              </p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowDownloadDialog(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  // User confirms they have Lens installed
                  localStorage.setItem('mapla_lens_installed', 'true');
                  setShowDownloadDialog(false);
                  setShowRecordModal(true);
                }}
                style={{ marginRight: '8px' }}
              >
                I've Installed It
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  window.open('/download', '_blank');
                  // Keep dialog open so user can click "I've Installed It" after
                }}
              >
                Download Mapla Lens
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default UnifiedWorkflowCanvas;

