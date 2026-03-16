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

  const handleError = (error) => {
    setIsProcessing(false);
    onError(error);
  };

  return (
    <div className="unified-workflow-canvas">

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

    </div>
  );
};

export default UnifiedWorkflowCanvas;

