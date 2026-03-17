import React from 'react';

const FlowChartToolbar = ({
  isMaximized,
  toggleMaximize,
  handleAddStep,
  selectedTool,
  setShowAddDecisionDropdown,
  showAddDecisionDropdown,
  handleAddDecision,
  handleAddMerge,
  addStartNode,
  addEndNode,
  handleAutoLayout,
  isGenerating,
  nodes,
  setNodes,
  saveToHistory,
  edges,
  deleteSelected,
  selectedEdges,
  undo,
  redo,
  historyIndex,
  history,
  setShowVersionHistory,
  flowId,
  sopExportStatus,
  showSopDropdown,
  setShowSopDropdown,
  sopStatus,
  sopDraftUrl,
  sopFinalUrl,
  sopFlowOutOfSync,
  setShowSopOutOfSyncModal,
  viewSopAsPdf,
  setShowSopEditModal,
  setShowSopRemoveConfirm,
  downloadDraftSOP,
  sopUploadRef,
  regenerateSOP,
  generateSOP,
  handleFinalSopUpload,
  showExportDropdown,
  setShowExportDropdown,
  downloadPNG,
  downloadPDF,
  downloadJSON,
  downloadBPMN,
  handleStartFlowView,
}) => (
  <div className="visio-toolbar">
    <div className="toolbar-group">
      {/* Process Step Button */}
      <button
        className="toolbar-icon"
        onClick={() => handleAddStep('Process Step')}
        title="Process Step - Single action in the process (1 in, 1 out)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        </svg>
      </button>

      {/* Contextual Add Decision Button */}
      <div className="dropdown-container">
        <button
          className={`toolbar-icon dropdown-trigger ${selectedTool === 'addDecision' ? 'active' : ''}`}
          onClick={() => setShowAddDecisionDropdown(!showAddDecisionDropdown)}
          title="Add Decision - Choose decision type based on methodology"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2L22 12L12 22L2 12L12 2Z"/>
          </svg>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {showAddDecisionDropdown && (
          <div
            className="dropdown-menu"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dropdown-item"
              onClick={() => handleAddDecision('Decision')}
              title="Conditional branching (1 in, 2+ out)"
            >
              Decision Point
            </button>
            <button
              className="dropdown-item"
              onClick={() => handleAddMerge()}
              title="Merge branches back into single flow (2+ in, 1 out)"
            >
              Merge Node
            </button>
          </div>
        )}
      </div>

      {/* Start Node Button */}
      <button
        className="toolbar-icon"
        onClick={addStartNode}
        title="Start Event - No incoming connectors"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <polygon points="10 8 16 12 10 16 10 8"/>
        </svg>
      </button>

      {/* End Node Button */}
      <button
        className="toolbar-icon"
        onClick={addEndNode}
        title="End Event - No outgoing connectors"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <rect x="9" y="9" width="6" height="6" rx="1" fill="currentColor"/>
        </svg>
      </button>

      {/* Auto Layout Button */}
      <button
        className="toolbar-icon"
        onClick={handleAutoLayout}
        disabled={isGenerating}
        title={nodes.length === 0
          ? "Auto Layout - Add steps first (or click to see why layout can't run yet)"
          : "Auto Layout - Recalculate all node positions for natural flow"}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="7" height="7" rx="1"/>
          <line x1="10" y1="6" x2="14" y2="6"/>
          <line x1="10" y1="18" x2="14" y2="18"/>
          <line x1="6" y1="10" x2="6" y2="14"/>
          <line x1="18" y1="10" x2="18" y2="14"/>
        </svg>
      </button>

      {/* Duplicate Button */}
      <button
        className="toolbar-icon"
        onClick={() => {
          const selectedNodes = nodes.filter(node => node.selected);
          if (selectedNodes.length === 0) return;

          // Create duplicates of selected nodes with offset position
          const duplicatedNodes = selectedNodes.map(node => ({
            ...node,
            id: `${node.type}-${Date.now()}-${Math.random()}`,
            position: {
              x: node.position.x + 50,
              y: node.position.y + 50
            },
            selected: true,
            data: {
              ...node.data,
              logical_id: node.data.logical_id ? `${node.data.logical_id}-copy` : undefined
            }
          }));

          // Deselect original nodes
          const updatedNodes = nodes.map(node => ({ ...node, selected: false }));

          // Add duplicated nodes
          const newNodes = [...updatedNodes, ...duplicatedNodes];
          setNodes(newNodes);
          saveToHistory(newNodes, edges);
        }}
        disabled={!nodes.some(node => node.selected)}
        title="Duplicate Selected - Duplicate selected nodes"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
      </button>

      <button
        className="toolbar-icon"
        onClick={deleteSelected}
        disabled={!nodes.some(node => node.selected) && selectedEdges.length === 0}
        title={`Delete Selected - ${selectedEdges.length > 0 ? `${selectedEdges.length} connector(s)` : 'nodes'} selected`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          <line x1="10" y1="11" x2="10" y2="17"/>
          <line x1="14" y1="11" x2="14" y2="17"/>
        </svg>
      </button>

      <button
        className="toolbar-icon"
        onClick={() => {
          const newNodes = nodes.map(node => ({ ...node, selected: true }));
          setNodes(newNodes);
          saveToHistory(newNodes, edges);
        }}
        disabled={nodes.length === 0}
        title="Select All - Select all nodes"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
    </div>

    <div className="toolbar-group">
      <button
        className="toolbar-icon"
        onClick={undo}
        disabled={historyIndex <= 0}
        title="Undo - Undo last action (Ctrl+Z)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12h14M3 12l4-4M3 12l4 4"/>
        </svg>
      </button>

      <button
        className="toolbar-icon"
        onClick={redo}
        disabled={historyIndex >= history.length - 1}
        title="Redo - Redo last undone action (Ctrl+Shift+Z)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12H7M21 12l-4-4M21 12l-4 4"/>
        </svg>
      </button>
    </div>

    <div className="toolbar-group">
      {/* Version History Button */}
      <button
        className="toolbar-icon"
        onClick={() => setShowVersionHistory(true)}
        disabled={!flowId}
        title="Version History"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 8v4l3 3m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"/>
        </svg>
      </button>
    </div>

    <div className="toolbar-group export-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      {/* SOP Export Loading Indicator */}
      {sopExportStatus !== 'idle' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 10px',
            background: sopExportStatus === 'success' ? '#dcfce7' : '#f3f4f6',
            border: `1px solid ${sopExportStatus === 'success' ? '#86efac' : '#e5e7eb'}`,
            borderRadius: '6px',
            animation: sopExportStatus === 'success' ? 'fadeOut 2s ease-in-out forwards' : 'none',
          }}
        >
          {sopExportStatus === 'loading' ? (
            <>
              <div
                style={{
                  width: '14px',
                  height: '14px',
                  border: '2px solid #d1d5db',
                  borderTopColor: '#2563eb',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <span style={{ fontSize: '12px', color: '#4b5563', fontWeight: 500 }}>
                Generating...
              </span>
            </>
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span style={{ fontSize: '12px', color: '#166534', fontWeight: 500 }}>
                Done
              </span>
            </>
          )}
        </div>
      )}
      <div className="dropdown-container">
        <button
          className="toolbar-icon dropdown-trigger"
          onClick={() => setShowSopDropdown(!showSopDropdown)}
          disabled={nodes.length === 0 && !sopDraftUrl && !sopFinalUrl}
          title={
            sopStatus === 'final' ? "SOP Finalized - Download or view" :
            sopStatus === 'draft' ? "SOP Draft - Download, regenerate, or upload final" :
            sopStatus === 'processing' ? "SOP is being generated - check back shortly" :
            sopStatus === 'failed' ? "SOP generation failed - try generating again" :
            nodes.length === 0 ? "Add process steps to generate SOP" :
            "Generate SOP from process flow"
          }
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <span style={{ marginLeft: '4px', fontSize: '12px' }}>
            {sopStatus === 'final'
              ? 'SOP ✓'
              : sopStatus === 'draft'
                ? 'SOP Draft'
                : sopStatus === 'processing'
                  ? 'SOP Processing'
                  : sopStatus === 'failed'
                    ? 'SOP Failed'
                    : 'SOP'}
          </span>
          {sopStatus === 'final' && sopFlowOutOfSync && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowSopOutOfSyncModal(true);
              }}
              title="Process flow has changed since last finalized SOP upload"
              style={{
                marginLeft: '6px',
                padding: '1px 6px',
                fontSize: '11px',
                lineHeight: '16px',
                borderRadius: '999px',
                background: '#fffbeb',
                color: '#92400e',
                border: '1px solid #fcd34d',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                cursor: 'pointer',
              }}
            >
              Out of sync
            </button>
          )}
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {showSopDropdown && (
          <div className="dropdown-menu">
            {sopStatus === 'final' ? (
              <>
                <button className="dropdown-item" onClick={() => {
                  viewSopAsPdf();
                  setShowSopDropdown(false);
                }}>
                  View SOP (PDF)
                </button>
                <button className="dropdown-item" onClick={() => {
                  setShowSopEditModal(true);
                  setShowSopDropdown(false);
                }}>
                  Edit SOP
                </button>
                <div style={{ borderTop: '1px solid #e5e7eb', margin: '4px 0' }}></div>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setShowSopRemoveConfirm(true);
                    setShowSopDropdown(false);
                  }}
                  style={{ color: '#dc2626' }}
                >
                  Remove SOP
                </button>
              </>
            ) : sopStatus === 'draft' ? (
              <>
                <button className="dropdown-item" onClick={() => {
                  downloadDraftSOP();
                  setShowSopDropdown(false);
                }}>
                  Download Draft
                </button>
                <button className="dropdown-item" onClick={() => {
                  sopUploadRef.current?.click();
                  setShowSopDropdown(false);
                }}>
                  Upload Finalized
                </button>
                <div style={{ borderTop: '1px solid #e5e7eb', margin: '4px 0' }}></div>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    regenerateSOP();
                    setShowSopDropdown(false);
                  }}
                  style={{ fontSize: '0.85em', color: '#6b7280' }}
                >
                  Regenerate from Flow
                </button>
              </>
            ) : (
              <button
                className="dropdown-item"
                onClick={() => {
                  generateSOP();
                  setShowSopDropdown(false);
                }}
                disabled={nodes.length === 0}
              >
                Generate SOP
              </button>
            )}
          </div>
        )}
        <input
          ref={sopUploadRef}
          type="file"
          accept=".docx"
          style={{ display: 'none' }}
          onChange={handleFinalSopUpload}
        />
      </div>
      <div className="dropdown-container">
        <button
          className="toolbar-icon dropdown-trigger"
          onClick={() => setShowExportDropdown(!showExportDropdown)}
          title="Export Options - Choose export format"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: '4px' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>

        {showExportDropdown && (
          <div className="dropdown-menu">
            <button className="dropdown-item" onClick={() => {
              downloadPNG();
              setShowExportDropdown(false);
            }}>
              Export as PNG
            </button>
            <button className="dropdown-item" onClick={() => {
              downloadPDF();
              setShowExportDropdown(false);
            }}>
              Export as PDF
            </button>
            <button className="dropdown-item" onClick={() => {
              downloadJSON();
              setShowExportDropdown(false);
            }}>
              Export as JSON
            </button>
            <button className="dropdown-item" onClick={() => {
              downloadBPMN();
              setShowExportDropdown(false);
            }}>
              Export as BPMN 2.0
            </button>
          </div>
        )}
      </div>

      {/* View Flow Button - opens screenshot modal from first node */}
      <button
        className="toolbar-icon"
        onClick={handleStartFlowView}
        disabled={nodes.length === 0}
        title="View Flow - Step through process screenshots"
        style={{ opacity: nodes.length === 0 ? 0.5 : 1 }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </button>
    </div>

    {/* Maximize/Minimize Button */}
    <div className="toolbar-group" style={{ marginLeft: 'auto' }}>
      <button
        className="toolbar-icon"
        onClick={toggleMaximize}
        title={isMaximized ? "Exit Fullscreen" : "Fullscreen View"}
      >
        {isMaximized ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/>
          </svg>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        )}
      </button>
    </div>
  </div>
);

export default FlowChartToolbar;
