import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL, authenticatedFetch } from '../config/api';
import axios from 'axios';

// Simple markdown renderer for bold text
const renderMarkdown = (text) => {
  if (!text) return '';
  // Convert **text** to <strong>text</strong>
  return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
};

const ChatPanel = () => {
  const { getToken } = useAuth();
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Tell me the steps in your process and I will build for you!' },
  ]);
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [generatingFlow, setGeneratingFlow] = useState(false); // Track flow generation separately
  const [flowGeneratedForCurrentChat, setFlowGeneratedForCurrentChat] = useState(false); // Prevent double-clicking generate
  const [existingFlow, setExistingFlow] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [userEdits, setUserEdits] = useState([]);
  const [extractedIntent, setExtractedIntent] = useState(null); // Store ProcessIntent from clarify-process/intent
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [audioChunks, setAudioChunks] = useState([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [textareaSize, setTextareaSize] = useState('default'); // 'default', 'medium', 'max'
  const [chatHistory, setChatHistory] = useState([]); // Store previous chat sessions
  const [showHistory, setShowHistory] = useState(false); // Toggle history dropdown
  const [currentChatId, setCurrentChatId] = useState(null); // Track current chat session
  const [currentProcessId, setCurrentProcessId] = useState(null); // Track which process flow the chat belongs to
  const textareaRef = useRef(null);
  const endRef = useRef(null);

  // Load chat history from localStorage when process changes
  useEffect(() => {
    if (!currentProcessId) {
      setChatHistory([]);
      return;
    }
    const storageKey = `chatHistory_${currentProcessId}`;
    const savedHistory = localStorage.getItem(storageKey);
    if (savedHistory) {
      try {
        setChatHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error('[Chat] Failed to load chat history:', e);
        setChatHistory([]);
      }
    } else {
      setChatHistory([]);
    }
  }, [currentProcessId]);

  // Save current chat to history when messages change (debounced)
  useEffect(() => {
    if (messages.length > 1 && currentChatId) {
      const timeoutId = setTimeout(() => {
        saveChatToHistory();
      }, 1000);
      return () => clearTimeout(timeoutId);
    }
  }, [messages, currentChatId]);

  const saveChatToHistory = () => {
    if (messages.length <= 1 || !currentProcessId) return; // Don't save empty chats or chats without a process
    
    const chatData = {
      id: currentChatId || Date.now().toString(),
      timestamp: new Date().toISOString(),
      preview: messages.find(m => m.role === 'user')?.content?.slice(0, 50) || 'New chat',
      messages: messages,
      existingFlow: existingFlow,
      processId: currentProcessId
    };

    const storageKey = `chatHistory_${currentProcessId}`;

    setChatHistory(prev => {
      // Update existing or add new
      const existingIndex = prev.findIndex(c => c.id === chatData.id);
      let updated;
      if (existingIndex >= 0) {
        updated = [...prev];
        updated[existingIndex] = chatData;
      } else {
        updated = [chatData, ...prev].slice(0, 5); // Keep last 5 chats only
      }
      localStorage.setItem(storageKey, JSON.stringify(updated));
      return updated;
    });

    if (!currentChatId) {
      setCurrentChatId(chatData.id);
    }
  };

  const startNewChat = () => {
    // Save current chat before starting new one
    if (messages.length > 1) {
      saveChatToHistory();
    }
    
    // Reset conversation state but KEEP the existing flow context
    // User wants to continue working on the same process with a fresh conversation
    setMessages([
      { role: 'assistant', content: 'Tell me the steps in your process and I will build for you!' },
    ]);
    setInput('');
    // NOTE: existingFlow is intentionally NOT cleared - keep the process context
    setValidationErrors([]);
    setUserEdits([]);
    setExtractedIntent(null);
    setCurrentChatId(Date.now().toString());
    setShowHistory(false);
    console.log('[Chat] Started new chat session (keeping existing flow context)');
  };

  const loadChatFromHistory = (chat) => {
    // Save current chat first
    if (messages.length > 1 && currentChatId !== chat.id) {
      saveChatToHistory();
    }
    
    setMessages(chat.messages);
    setExistingFlow(chat.existingFlow || null);
    setCurrentChatId(chat.id);
    setShowHistory(false);
    console.log('[Chat] Loaded chat from history:', chat.id);
  };

  const deleteChatFromHistory = (chatId, e) => {
    e.stopPropagation(); // Prevent loading the chat
    setChatHistory(prev => {
      const updated = prev.filter(c => c.id !== chatId);
      if (currentProcessId) {
        localStorage.setItem(`chatHistory_${currentProcessId}`, JSON.stringify(updated));
      }
      return updated;
    });
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, open]);

  // Cleanup media recorder on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [mediaRecorder]);

  // Helper to reset chat state for a fresh conversation
  const resetChatState = () => {
    setMessages([
      { role: 'assistant', content: 'Tell me the steps in your process and I will build for you!' },
    ]);
    setInput('');
    setExistingFlow(null);
    setValidationErrors([]);
    setUserEdits([]);
    setExtractedIntent(null);
    setCurrentChatId(Date.now().toString());
    setShowHistory(false);
    setFlowGeneratedForCurrentChat(false);
  };

  // Listen for process changes — reset chat when user switches process flows
  useEffect(() => {
    const handler = (event) => {
      const newProcessId = event.detail?.processId;
      if (newProcessId && newProcessId !== currentProcessId) {
        console.log('[Chat] Process changed from', currentProcessId, 'to', newProcessId, '— resetting chat');
        // Save current chat before switching
        if (messages.length > 1 && currentProcessId) {
          saveChatToHistory();
        }
        setCurrentProcessId(newProcessId);
        resetChatState();
      }
    };
    window.addEventListener('processChanged', handler);
    return () => window.removeEventListener('processChanged', handler);
  }, [currentProcessId, messages]);

  // Listen for global open event with existing flow data
  useEffect(() => {
    const handler = (event) => {
      const newProcessId = event.detail?.processId;
      
      // If process changed, reset chat
      if (newProcessId && newProcessId !== currentProcessId) {
        console.log('[Chat] openChat with new process:', newProcessId, '(was:', currentProcessId, ')');
        if (messages.length > 1 && currentProcessId) {
          saveChatToHistory();
        }
        setCurrentProcessId(newProcessId);
        resetChatState();
      }
      
      setOpen(true);
      if (event.detail?.existingFlow) {
        setExistingFlow(event.detail.existingFlow);
        console.log('[Chat] Received existing flow:', event.detail.existingFlow);
      }
    };
    window.addEventListener('openChat', handler);
    return () => window.removeEventListener('openChat', handler);
  }, [currentProcessId, messages]);

  const sendMessage = async () => {
    const content = input.trim();
    if (!content || sending) return;
    const next = [...messages, { role: 'user', content }];
    // add placeholder assistant for streaming
    setMessages([...next, { role: 'assistant', content: '' }]);
    setInput('');
    setTextareaSize('default'); // Reset to default after sending
    setSending(true);
    try {
      // Build context from existing flow
      let flowContext = '';
      if (existingFlow && existingFlow.nodes && existingFlow.nodes.length > 0) {
        flowContext = '\n\nEXISTING FLOW:\n';
        existingFlow.nodes.forEach(node => {
          const label = node.data?.label || 'Unknown';
          const type = node.data?.type || node.type || 'unknown';
          flowContext += `- ${label} (${type})\n`;
        });
        if (existingFlow.edges && existingFlow.edges.length > 0) {
          flowContext += '\nCONNECTIONS:\n';
          existingFlow.edges.forEach(edge => {
            const sourceNode = existingFlow.nodes.find(n => n.id === edge.source);
            const targetNode = existingFlow.nodes.find(n => n.id === edge.target);
            const sourceLabel = sourceNode?.data?.label || 'Unknown';
            const targetLabel = targetNode?.data?.label || 'Unknown';
            flowContext += `${sourceLabel} → ${targetLabel}\n`;
          });
        }
      }

      // Prepend flow context to the first user message if available
      const messagesWithContext = next.map((m, idx) => {
        if (idx === 1 && flowContext) { // Index 1 is first user message (after assistant greeting)
          return { role: m.role, content: m.content + flowContext };
        }
        return { role: m.role, content: m.content };
      });

      const resp = await authenticatedFetch(
        `${API_BASE_URL}/api/clarify-process/stream`,
        {
          method: 'POST',
          body: {
            messages: messagesWithContext,
            existingFlow: existingFlow || null, // Pass existing flow to help generate better summaries
          },
        },
        getToken
      );
      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Chat request failed');
      }
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let done = false;
      let accumulatedContent = '';
      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          if (chunk) {
            accumulatedContent += chunk;
            setMessages(curr => {
              const updated = [...curr];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                last.content = accumulatedContent;
              }
              return updated;
            });
          }
        }
      }

      // Clear any previously extracted intent - let flow generation do its own extraction
      // This avoids redundant/conflicting LLM calls and ensures the flow generation
      // uses its battle-tested extraction logic with the full conversation context
      setExtractedIntent(null);
      
      // Reset flow generated flag - user can now generate flow for this new response
      setFlowGeneratedForCurrentChat(false);
    } catch (e) {
      setMessages(curr => [...curr, { role: 'assistant', content: 'Sorry, something went wrong.' }]);
      console.error(e);
    } finally {
      setSending(false);
      setTextareaSize('default'); // Reset to default after receiving reply
    }
  };

  // Auto-resize textarea based on content
  const handleInputChange = (e) => {
    const value = e.target.value;
    setInput(value);

    // Only auto-resize if not in max mode
    if (textareaSize !== 'max') {
      const lineCount = value.split('\n').length;
      const charCount = value.length;

      // Auto-expand to medium if typing a lot
      if (lineCount > 2 || charCount > 100) {
        setTextareaSize('medium');
      } else if (value.length === 0) {
        setTextareaSize('default');
      }
    }
  };

  const toggleMaximize = () => {
    if (textareaSize === 'max') {
      setTextareaSize('default');
    } else {
      setTextareaSize('max');
    }
  };

  const generateFromChat = async () => {
    if (sending || generatingFlow) return;
    setGeneratingFlow(true);
    try {
      // Build a rich transcript that includes the full conversation
      // This helps the LLM understand the complete context and clarifications
      const conversationTranscript = messages
        .filter(m => m.content && m.content !== 'Tell me the steps in your process and I will build for you!')
        .map(m => {
          if (m.role === 'user') {
            return `User: ${m.content}`;
          } else {
            return `Assistant (understood): ${m.content}`;
          }
        })
        .join('\n\n');

      // Build a summary instruction that emphasizes the incremental nature
      const contextInstruction = existingFlow && existingFlow.nodes && existingFlow.nodes.length > 0
        ? `IMPORTANT: This is an INCREMENTAL update to an existing process. The user wants to ADD or MODIFY specific steps, not replace the entire process. Pay close attention to the assistant's understanding of WHERE the new steps should be inserted.`
        : '';

      const finalContext = contextInstruction + (contextInstruction ? '\n\n' : '') + conversationTranscript;

      // Collect user edits from user_modified nodes
      const currentUserEdits = [];
      if (existingFlow?.nodes) {
        existingFlow.nodes.forEach(node => {
          if (node.data?.user_modified) {
            currentUserEdits.push({
              type: 'node_updated',
              id: node.id,
              label: node.data.label,
              changes: 'text/properties'
            });
          }
        });
      }

      console.log(`[Chat] Sending request with ${currentUserEdits.length} user edits, ${validationErrors.length} validation errors`);

      // Use /generate-incremental-flow endpoint (same as voice mode)
      // The full conversation transcript includes the assistant's clarification,
      // so the flow generation LLM sees what the assistant understood (decision points, etc.)
      const resp = await authenticatedFetch(
        `${API_BASE_URL}/generate-incremental-flow`,
        {
          method: 'POST',
          body: {
            transcript: conversationTranscript, // Send full conversation as transcript
            accumulatedTranscript: conversationTranscript, // Same as transcript for write mode
            existingFlow: existingFlow || { nodes: [], edges: [] },
            sessionId: Date.now(),
            validationErrors: validationErrors.length > 0 ? validationErrors : null,
            userEdits: currentUserEdits.length > 0 ? currentUserEdits : null,
            extractedIntent: null // Let flow generation do its own extraction with full context
          },
        },
        getToken
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to generate flow');
      }
      const data = await resp.json();

      // Update validation errors and existing flow for next request
      if (data.validationErrors && data.validationErrors.length > 0) {
        setValidationErrors(data.validationErrors);
        console.log(`[Chat] Received ${data.validationErrors.length} validation errors`);
      } else {
        setValidationErrors([]);
      }

      // Preserve user-positioned nodes when updating
      if (existingFlow && existingFlow.nodes) {
        // Create a map of existing node positions
        const existingPositions = new Map();
        existingFlow.nodes.forEach(node => {
          if (node.position) {
            existingPositions.set(node.id, node.position);
          }
        });

        // Apply existing positions to new nodes (preserve user layouts)
        if (data.nodes) {
          data.nodes = data.nodes.map(node => {
            const existingPosition = existingPositions.get(node.id);
            if (existingPosition) {
              return {
                ...node,
                position: existingPosition  // Preserve user's position
              };
            }
            return node;
          });
        }

        console.log(`[Chat] Preserved ${existingPositions.size} node positions`);
      }

      // Update existingFlow with the new flow data (for next request)
      setExistingFlow(data);

      // Clear extracted intent after successful generation (will be re-extracted on next clarification)
      setExtractedIntent(null);

      // Build a summary of changes
      const oldNodeCount = existingFlow?.nodes?.length || 0;
      const oldEdgeCount = existingFlow?.edges?.length || 0;
      const newNodeCount = data.nodes?.length || 0;
      const newEdgeCount = data.edges?.length || 0;

      // Find which nodes were added by comparing IDs
      const existingNodeIds = new Set((existingFlow?.nodes || []).map(n => n.id));
      const newNodes = (data.nodes || []).filter(n => !existingNodeIds.has(n.id));
      const deletedNodes = (existingFlow?.nodes || []).filter(n =>
        !(data.nodes || []).some(newNode => newNode.id === n.id)
      );

      let summary = '**Flow Updated Successfully!**\n\n';

      if (oldNodeCount === 0) {
        summary += `✅ Created ${newNodeCount} step${newNodeCount !== 1 ? 's' : ''} and ${newEdgeCount} connection${newEdgeCount !== 1 ? 's' : ''}.\n\n`;
      } else {
        const nodesAdded = newNodeCount - oldNodeCount;
        const edgesAdded = newEdgeCount - oldEdgeCount;

        if (newNodes.length > 0) {
          summary += `➕ **Added ${newNodes.length} new step${newNodes.length !== 1 ? 's' : ''}:**\n`;
          newNodes.forEach(node => {
            const label = node.data?.label || node.label || 'Unknown';
            summary += `   • ${label}\n`;
          });
          summary += '\n';
        }

        if (deletedNodes.length > 0) {
          summary += `➖ **Removed ${deletedNodes.length} step${deletedNodes.length !== 1 ? 's' : ''}:**\n`;
          deletedNodes.forEach(node => {
            const label = node.data?.label || node.label || 'Unknown';
            summary += `   • ${label}\n`;
          });
          summary += '\n';
        }

        if (edgesAdded > 0 && newNodes.length === 0) {
          summary += `🔗 Added ${edgesAdded} new connection${edgesAdded !== 1 ? 's' : ''}\n\n`;
        }

        if (nodesAdded === 0 && edgesAdded === 0 && deletedNodes.length === 0) {
          summary += `🔄 Updated existing steps (no structural changes)\n\n`;
        }
      }

      summary += 'Any other changes needed?';

      // Append summary message (don't replace the clarifying message) and trigger flow update
      setMessages(curr => [...curr, { role: 'assistant', content: summary }]);
      window.dispatchEvent(new CustomEvent('generateFlowFromChat', { detail: data }));

      // Mark that flow was generated for this chat - prevents double-clicking
      setFlowGeneratedForCurrentChat(true);

      // Don't close - let user continue chatting
      // setOpen(false);
    } catch (e) {
      console.error(e);
      setMessages(curr => [...curr, { role: 'assistant', content: 'Failed to generate flow. Please try again.' }]);
    } finally {
      setGeneratingFlow(false);
    }
  };

  const toggleRecording = async () => {
    if (isRecording) {
      // Stop recording
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    } else {
      // Start recording
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Use WebM with Opus codec - same as FlowChart
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

        console.log('[ChatPanel] Using MIME type:', selectedMimeType);
        const recorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
        const chunks = [];

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
            console.log('[ChatPanel] Audio chunk received, size:', event.data.size);
          }
        };

        recorder.onstop = async () => {
          console.log('[ChatPanel] Recording stopped, processing audio blob...');
          const audioBlob = new Blob(chunks, { type: selectedMimeType });
          console.log('[ChatPanel] Created audio blob:', { size: audioBlob.size, type: audioBlob.type });

          // Set recording to false immediately
          setIsRecording(false);

          // Process the audio blob through Whisper backend
          await processAudioWithWhisper(audioBlob);

          // Stop all tracks
          stream.getTracks().forEach(track => track.stop());

          // Clear chunks
          chunks.length = 0;
          setAudioChunks([]);
          console.log('[ChatPanel] Audio processing completed, chunks cleared');
        };

        // Start recording
        recorder.start();
        setMediaRecorder(recorder);
        setAudioChunks(chunks);
        setIsRecording(true);
        console.log('[ChatPanel] Recording started');
      } catch (error) {
        console.error('[ChatPanel] Error starting recording:', error);
        alert('Microphone access denied or not available');
      }
    }
  };

  const processAudioWithWhisper = async (audioBlob) => {
    try {
      console.log('[ChatPanel] Processing audio blob with Whisper:', {
        size: audioBlob.size,
        type: audioBlob.type
      });

      // Skip if audio blob is too small
      if (audioBlob.size < 5000) {
        console.log('[ChatPanel] Audio blob too small, skipping:', audioBlob.size);
        return;
      }

      // Skip if audio blob is too large
      if (audioBlob.size > 25000000) { // 25MB limit
        console.log('[ChatPanel] Audio blob too large, skipping:', audioBlob.size);
        alert('Recording is too large. Please keep recordings under 25MB.');
        return;
      }

      setIsTranscribing(true);

      const formData = new FormData();
      let fileName = 'recording.wav';
      formData.append('file', audioBlob, fileName);

      console.log('[ChatPanel] Sending audio to Whisper transcription API');

      const token = await getToken();
      const response = await axios.post(`${API_BASE_URL}/transcribe`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${token}`,
        },
      });

      console.log('[ChatPanel] Whisper transcription response:', response.data);
      const transcript = response.data.transcript;

      if (transcript && transcript.trim()) {
        console.log('[ChatPanel] Transcript received:', transcript);
        // Append transcribed text to input
        setInput(prev => prev ? `${prev} ${transcript}` : transcript);
      } else {
        console.log('[ChatPanel] No transcript received or empty');
      }

      setIsTranscribing(false);
    } catch (error) {
      console.error('[ChatPanel] Error processing audio with Whisper:', error);
      console.error('[ChatPanel] Error details:', error.response?.data);
      setIsTranscribing(false);
      alert('Failed to transcribe audio. Please try again.');
    }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className={`chat-panel ${open ? 'open' : ''}`}>
      {open && (
        <div className="chat-window">
          <div className="chat-header">
            <div className="chat-header-left">
              <div className="chat-title">Write</div>
              <div className="chat-header-actions">
                <button 
                  className="btn-icon" 
                  onClick={startNewChat}
                  title="New chat"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </button>
                <div className="history-container">
                  <button 
                    className={`btn-icon ${showHistory ? 'active' : ''}`}
                    onClick={() => setShowHistory(!showHistory)}
                    title="Chat history"
                    disabled={chatHistory.length === 0}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                  </button>
                  {showHistory && chatHistory.length > 0 && (
                    <div className="history-dropdown">
                      <div className="history-header">Recent Chats</div>
                      {chatHistory.map(chat => (
                        <div 
                          key={chat.id} 
                          className={`history-item ${chat.id === currentChatId ? 'active' : ''}`}
                          onClick={() => loadChatFromHistory(chat)}
                        >
                          <div className="history-item-content">
                            <div className="history-preview">{chat.preview}...</div>
                            <div className="history-time">
                              {new Date(chat.timestamp).toLocaleDateString(undefined, { 
                                month: 'short', 
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                          </div>
                          <button 
                            className="history-delete"
                            onClick={(e) => deleteChatFromHistory(chat.id, e)}
                            title="Delete chat"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 6L6 18M6 6l12 12"/>
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <button className="chat-close" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="chat-tab-accent"></div>
          <div className="chat-messages">
            {messages.map((m, idx) => (
              <div key={idx} className={`chat-msg ${m.role}`}>
                <div
                  className="chat-bubble"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
                />
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="chat-actions">
            <div className="generate-flow-container">
              {(sending || generatingFlow) && (
                <div className="generating-indicator">
                  <div className="spinner-small"></div>
                  <span>{generatingFlow ? 'Generating flow...' : 'Processing...'}</span>
                </div>
              )}
              <button 
                className={`btn-primary ${(sending || generatingFlow) ? 'loading' : ''} ${flowGeneratedForCurrentChat ? 'generated' : ''}`} 
                onClick={generateFromChat} 
                disabled={sending || generatingFlow || messages.length < 2 || flowGeneratedForCurrentChat}
                title={flowGeneratedForCurrentChat ? 'Flow already generated - send a new message first' : 'Generate flow from conversation'}
              >
                {generatingFlow ? 'Generating...' : sending ? 'Wait...' : flowGeneratedForCurrentChat ? '✓ Generated' : 'Generate Flow'}
              </button>
            </div>
          </div>
          <div className="chat-input">
            <div className={`input-wrapper size-${textareaSize}`}>
              <button
                className="btn-expand"
                onClick={toggleMaximize}
                title={textareaSize === 'max' ? 'Minimize' : 'Maximize'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {textareaSize === 'max' ? (
                    <>
                      <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
                    </>
                  ) : (
                    <>
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </>
                  )}
                </svg>
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={onKeyDown}
                placeholder={isTranscribing ? 'Transcribing...' : isRecording ? 'Recording...' : 'Type a message...'}
                disabled={sending || isTranscribing}
                rows={1}
              />
              <button
                className={`btn-mic-inline ${isRecording ? 'recording' : ''} ${isTranscribing ? 'transcribing' : ''}`}
                onClick={toggleRecording}
                disabled={sending || isTranscribing}
                title={isRecording ? 'Stop recording' : isTranscribing ? 'Transcribing...' : 'Voice input'}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {isRecording ? (
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  ) : (
                    <>
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" x2="12" y1="19" y2="22" />
                    </>
                  )}
                </svg>
              </button>
            </div>
            <button className="btn-send" onClick={sendMessage} disabled={sending || !input.trim() || isTranscribing}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
      <style>{`
        .chat-panel { position: fixed; right: 16px; bottom: 16px; z-index: 1000; font-family: 'Inter', 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif; }
        .chat-window { width: 520px; height: 600px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; margin-top: 8px; display: flex; flex-direction: column; box-shadow: 0 2px 8px rgba(14, 59, 175, 0.05); overflow: hidden; }
        .chat-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; background: var(--color-surface); }
        .chat-header-left { display: flex; align-items: center; gap: 12px; }
        .chat-header-actions { display: flex; align-items: center; gap: 4px; }
        .chat-title { font-size: 18px; font-weight: 600; color: var(--color-text-primary); letter-spacing: 0.2px; }
        .chat-close { background: transparent; border: none; font-size: 22px; line-height: 1; color: var(--color-text-secondary); cursor: pointer; }
        .chat-tab-accent { height: 6px; width: 140px; background: var(--color-primary); border-radius: 6px; align-self: center; margin-top: -6px; }
        .chat-messages { flex: 1; overflow: auto; padding: 16px; background: var(--color-background); }
        .chat-messages::-webkit-scrollbar { width: 10px; }
        .chat-messages::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 8px; }
        .chat-msg { display: flex; margin-bottom: 10px; }
        .chat-msg.user { justify-content: flex-end; }
        .chat-msg.assistant { justify-content: flex-start; }
        .chat-bubble { max-width: 78%; padding: 12px 14px; border-radius: 14px; white-space: pre-wrap; line-height: 1.5; font-size: 15px; letter-spacing: 0.2px; box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
        .chat-msg.user .chat-bubble { background: var(--color-primary); color: #fff; border-top-right-radius: 6px; }
        .chat-msg.assistant .chat-bubble { background: var(--color-surface); color: var(--color-text-primary); border: 1px solid var(--color-border); border-top-left-radius: 6px; }
        .chat-bubble strong { font-weight: 600; color: var(--color-primary); }
        
        /* Header icon buttons */
        .btn-icon { background: transparent; border: none; padding: 6px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; border-radius: 6px; color: var(--color-text-secondary); }
        .btn-icon:hover:not(:disabled) { background: var(--color-accent-hover); color: var(--color-text-primary); }
        .btn-icon.active { background: var(--color-accent-hover); color: var(--color-primary); }
        .btn-icon:disabled { opacity: 0.3; cursor: not-allowed; }
        
        /* History dropdown */
        .history-container { position: relative; }
        .history-dropdown { position: absolute; top: 100%; left: 50%; transform: translateX(-50%); margin-top: 8px; width: 280px; max-height: 320px; overflow-y: auto; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; box-shadow: 0 2px 8px rgba(14, 59, 175, 0.05); z-index: 100; }
        .history-header { padding: 10px 12px; font-size: 12px; font-weight: 600; color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--color-border); background: var(--color-background); }
        .history-item { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; cursor: pointer; transition: background 0.15s; border-bottom: 1px solid var(--color-border); }
        .history-item:last-child { border-bottom: none; }
        .history-item:hover { background: var(--color-background); }
        .history-item.active { background: var(--color-accent-hover); }
        .history-item-content { flex: 1; min-width: 0; }
        .history-preview { font-size: 13px; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .history-time { font-size: 11px; color: var(--color-text-secondary); margin-top: 2px; }
        .history-delete { background: transparent; border: none; padding: 4px; cursor: pointer; color: var(--color-text-secondary); border-radius: 4px; transition: all 0.15s; opacity: 0; }
        .history-item:hover .history-delete { opacity: 1; }
        .history-delete:hover { background: #fee2e2; color: #dc2626; }
        
        /* Generate flow actions */
        .chat-actions { padding: 10px 14px; border-top: 1px solid var(--color-border); background: var(--color-surface); display: flex; justify-content: flex-end; }
        .generate-flow-container { display: flex; align-items: center; gap: 10px; }
        .generating-indicator { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--color-text-secondary); }
        .spinner-small { width: 14px; height: 14px; border: 2px solid var(--color-border); border-top-color: var(--color-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
        .btn-primary { background: var(--color-primary); color: #fff; border: none; padding: 14px 24px; border-radius: 8px; cursor: pointer; box-shadow: 0 2px 8px rgba(14, 59, 175, 0.1); font-family: inherit; transition: all 0.2s; font-weight: 500; letter-spacing: 0.2px; }
        .btn-primary:hover:not(:disabled) { background: var(--color-primary-hover); transform: translateY(-1px); }
        .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
        .btn-primary.loading { background: var(--color-text-secondary); box-shadow: none; }
        
        .chat-input { display: flex; gap: 10px; padding: 12px; border-top: 1px solid var(--color-border); background: var(--color-surface); align-items: flex-end; }
        .input-wrapper { flex: 1; position: relative; display: flex; align-items: flex-end; transition: all 0.3s ease; }
        .input-wrapper textarea { flex: 1; resize: none; padding: 10px 75px 10px 12px; font-size: 14px; background: var(--color-background); border: 1px solid var(--color-border); border-radius: 12px; outline: none; font-family: inherit; line-height: 1.5; transition: height 0.3s ease; overflow-y: auto; color: var(--color-text-primary); }
        .input-wrapper textarea:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px rgba(14, 59, 175, 0.12); }
        .input-wrapper.size-default textarea { height: 70px; }
        .input-wrapper.size-medium textarea { height: 140px; }
        .input-wrapper.size-max textarea { height: 300px; }
        .btn-expand { position: absolute; top: 8px; right: 8px; background: transparent; border: none; padding: 4px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; color: var(--color-text-secondary); z-index: 10; }
        .btn-expand:hover { background: var(--color-accent-hover); color: var(--color-text-primary); }
        .btn-mic-inline { position: absolute; right: 8px; bottom: 10px; background: transparent; border: none; padding: 0; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 50%; color: var(--color-text-secondary); }
        .btn-mic-inline:hover:not(:disabled) { background: var(--color-accent-hover); color: var(--color-text-primary); }
        .btn-mic-inline.recording { background: #fecaca; color: #dc2626; animation: pulse-subtle 1.5s infinite; }
        .btn-mic-inline.transcribing { background: #fef3c7; color: #d97706; animation: pulse-subtle 1.5s infinite; }
        .btn-mic-inline:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn-send { background: var(--color-primary); color: #fff; border: none; padding: 0; border-radius: 50%; cursor: pointer; font-family: inherit; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; }
        .btn-send:hover:not(:disabled) { background: var(--color-primary-hover); transform: translateY(-1px); }
        .btn-send:disabled { opacity: 0.4; cursor: not-allowed; }
        @keyframes pulse-subtle { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

export default ChatPanel;


