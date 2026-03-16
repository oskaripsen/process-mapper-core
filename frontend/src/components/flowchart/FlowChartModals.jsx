import React from 'react';
import { ENABLE_SCREENSHOTS } from '../../config/api';
import ScreenshotBrowserModal from '../ScreenshotBrowserModal';

const FlowChartModals = ({
  showVersionHistory,
  setShowVersionHistory,
  versionHistoryError,
  versionHistoryLoading,
  versionHistory,
  handleViewVersion,
  handleRestoreVersion,
  restoringVersionId,
  isEditingEdge,
  edgeLabel,
  setEdgeLabel,
  handleEdgeLabelSave,
  handleEdgeLabelCancel,
  handleEdgeDelete,
  showClearConfirm,
  setShowClearConfirm,
  handleCleanSlate,
  sopUploadStatus,
  setSopUploadStatus,
  sopUploadError,
  setSopUploadError,
  sopSyncSummary,
  setSopSyncSummary,
  showSopEditModal,
  setShowSopEditModal,
  regenerateSOP,
  setShowSopDropdown,
  handleEditSopManually,
  showSopRemoveConfirm,
  setShowSopRemoveConfirm,
  handleRemoveSop,
  showSopOutOfSyncModal,
  setShowSopOutOfSyncModal,
  sopFlowLastSyncedAt,
  screenshotModalOpen,
  setScreenshotModalOpen,
  handleCloseScreenshotModal,
  screenshotModalNodeId,
  screenshotModalNodeLabel,
  screenshotModalCurrentUrl,
  allScreenshots,
  handleScreenshotChange,
  flowId,
  onSaveFinalize,
  nodes,
  edges,
  recordingMetadata,
  setAllScreenshots,
  setRecordingMetadata,
  handleNavigateToNode,
}) => (
  <>
    {showVersionHistory && (
      <div className="version-history-modal">
        <div className="version-history-content">
          <div className="version-history-header">
            <div>
              <h3>Version History</h3>
              <p>View or restore a previous save of this flow.</p>
            </div>
            <button
              className="version-history-close"
              onClick={() => setShowVersionHistory(false)}
            >
              ×
            </button>
          </div>

          {versionHistoryError && (
            <div className="version-history-error">{versionHistoryError}</div>
          )}

          {versionHistoryLoading ? (
            <div className="version-history-loading">Loading versions...</div>
          ) : versionHistory.length === 0 ? (
            <div className="version-history-empty">
              No saved versions yet. Save a flow to create a version.
            </div>
          ) : (
            <div className="version-history-list">
              {/* Current Version - always at top, uses data from the most recent saved version */}
              <div className="version-history-row version-current">
                <div className="version-history-meta">
                  <span className="version-number">
                    Version {versionHistory[0].version_number}
                    <span className="version-current-badge">Current</span>
                  </span>
                  {versionHistory[0].version_type && (
                    <span className="version-current-label" style={{ marginLeft: '6px' }}>
                      {versionHistory[0].version_type === 'sop_draft' ? 'SOP Draft' :
                        versionHistory[0].version_type === 'sop_final' ? 'SOP Final' :
                          versionHistory[0].version_type === 'sop_revert_draft' ? 'SOP Reverted' :
                            versionHistory[0].version_type === 'sop_removed' ? 'SOP Removed' : 'Flow'}
                    </span>
                  )}
                  <span className="version-time">
                    {new Date(versionHistory[0].created_at).toLocaleString()}
                  </span>
                  <span className="version-counts">
                    {versionHistory[0].node_count} steps · {versionHistory[0].edge_count} connections
                  </span>
                  {versionHistory[0].change_description && (
                    <span className="version-counts">{versionHistory[0].change_description}</span>
                  )}
                </div>
                <div className="version-history-actions">
                  <span className="version-current-label">Live</span>
                  {/* SOP download removed from version list (use preview/restore instead) */}
                </div>
              </div>

              {/* Previous Versions - skip the first one since it's the current version shown above */}
              {versionHistory.slice(1).map((version) => (
                <div key={version.id} className="version-history-row">
                  <div className="version-history-meta">
                    <span className="version-number">Version {version.version_number}</span>
                    {version.version_type && (
                      <span className="version-current-label" style={{ marginLeft: '6px' }}>
                        {version.version_type === 'sop_draft' ? 'SOP Draft' :
                          version.version_type === 'sop_final' ? 'SOP Final' :
                            version.version_type === 'sop_revert_draft' ? 'SOP Reverted' :
                              version.version_type === 'sop_removed' ? 'SOP Removed' : 'Flow'}
                      </span>
                    )}
                    <span className="version-time">
                      {new Date(version.created_at).toLocaleString()}
                    </span>
                    <span className="version-counts">
                      {version.node_count} steps · {version.edge_count} connections
                    </span>
                    {version.change_description && (
                      <span className="version-counts">{version.change_description}</span>
                    )}
                  </div>
                  <div className="version-history-actions">
                    {/* SOP download removed from version list (use preview/restore instead) */}
                    <button
                      className="version-history-view"
                      onClick={() => handleViewVersion(version)}
                      title="Preview this version"
                    >
                      View
                    </button>
                    <button
                      className="version-history-restore"
                      onClick={() => handleRestoreVersion(version.version_number)}
                      disabled={restoringVersionId === version.version_number}
                      title="Restore this version (creates a new version)"
                    >
                      {restoringVersionId === version.version_number ? 'Restoring...' : 'Restore'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    )}

    {/* Edge Editing Modal */}
    {isEditingEdge && (
      <div className="edge-edit-modal">
        <div className="edge-edit-content">
          <h3>Edit Connection Label</h3>
          <div className="edge-edit-form">
            <label>
              Connection Label:
              <input
                type="text"
                value={edgeLabel}
                onChange={(e) => setEdgeLabel(e.target.value)}
                placeholder="Enter connection label..."
                autoFocus
              />
            </label>
            <div className="edge-edit-buttons">
              <button className="save-button" onClick={handleEdgeLabelSave}>
                Save
              </button>
              <button className="cancel-button" onClick={handleEdgeLabelCancel}>
                Cancel
              </button>
              <button className="delete-button" onClick={handleEdgeDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* Clean Slate Confirm Dialog */}
    {showClearConfirm && (
      <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={() => setShowClearConfirm(false)}>
        <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>Clean Slate - Reset Everything?</h3>
          </div>
          <div className="modal-body">
            <p style={{ marginBottom: '12px' }}>This will permanently delete:</p>
            <ul style={{ textAlign: 'left', marginLeft: '20px', marginBottom: '12px', lineHeight: '1.6' }}>
              <li>All nodes and edges (flow diagram)</li>
              <li>All screenshots attached to nodes</li>
              <li>Any generated or uploaded SOPs</li>
            </ul>
            <p style={{ fontWeight: '500', color: '#dc3545' }}>This action cannot be undone.</p>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowClearConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleCleanSlate}
            >
              Clean Slate
            </button>
          </div>
        </div>
      </div>
    )}

    {/* SOP Upload Status Modal */}
    {sopUploadStatus !== 'idle' && (
      <div
        className="modal-overlay"
        style={{ zIndex: 10002 }}
        onClick={() => {
          if (sopUploadStatus !== 'uploading') {
            setSopUploadStatus('idle');
            setSopUploadError(null);
            setSopSyncSummary(null);
          }
        }}
      >
        <div className="modal confirm-dialog" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>
              {sopUploadStatus === 'uploading' && 'Validating SOP'}
              {sopUploadStatus === 'success' && 'SOP Finalized'}
              {sopUploadStatus === 'error' && 'Validation Failed'}
            </h3>
          </div>
          <div className="modal-body">
            {sopUploadStatus === 'uploading' && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  border: '3px solid #e5e7eb',
                  borderTopColor: '#2563eb',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite',
                  margin: '0 auto 16px'
                }} />
                <p style={{ margin: 0, color: '#6b7280' }}>Checking for tracked changes and unresolved comments...</p>
              </div>
            )}
            {sopUploadStatus === 'success' && (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{
                  width: '48px',
                  height: '48px',
                  background: '#dcfce7',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px'
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <p style={{ margin: '0 0 12px 0', color: '#16a34a', fontWeight: 500 }}>SOP uploaded successfully</p>

                {/* Sync Summary */}
                {sopSyncSummary && (
                  <div style={{
                    textAlign: 'left',
                    background: sopSyncSummary.flow_synced ? '#f0f9ff' : '#f9fafb',
                    borderRadius: '8px',
                    padding: '12px 16px',
                    marginTop: '12px',
                    border: sopSyncSummary.flow_synced ? '1px solid #bae6fd' : '1px solid #e5e7eb'
                  }}>
                    <p style={{
                      margin: '0 0 8px 0',
                      fontWeight: 500,
                      fontSize: '0.9em',
                      color: sopSyncSummary.flow_synced ? '#0369a1' : '#374151'
                    }}>
                      {sopSyncSummary.flow_synced ? 'Process Flow Updated' : 'Process Flow Status'}
                    </p>
                    <p style={{ margin: 0, fontSize: '0.85em', color: '#6b7280' }}>
                      {sopSyncSummary.summary}
                    </p>

                    {/* Show detailed changes if any */}
                    {sopSyncSummary.flow_synced && sopSyncSummary.details && (
                      <div style={{ marginTop: '8px', fontSize: '0.85em', color: '#6b7280' }}>
                        {sopSyncSummary.details.label_changes > 0 && (
                          <div>Step labels: {sopSyncSummary.details.label_changes} updated</div>
                        )}
                        {sopSyncSummary.details.owner_changes > 0 && (
                          <div>Owners: {sopSyncSummary.details.owner_changes} updated</div>
                        )}
                        {sopSyncSummary.details.system_changes > 0 && (
                          <div>Systems/Tools: {sopSyncSummary.details.system_changes} updated</div>
                        )}
                        {sopSyncSummary.details.automation_changes > 0 && (
                          <div>Automation status: {sopSyncSummary.details.automation_changes} updated</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {sopUploadStatus === 'error' && sopUploadError && (
              <div>
                <p style={{ marginBottom: '16px', color: '#6b7280', fontSize: '0.95em' }}>
                  Please fix the following issues in Word before uploading:
                </p>
                {sopUploadError.trackedChanges.length > 0 && (
                  <div style={{
                    background: '#fef3c7',
                    border: '1px solid #f59e0b',
                    borderRadius: '6px',
                    padding: '14px',
                    marginBottom: '12px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{
                        width: '20px',
                        height: '20px',
                        background: '#f59e0b',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: '8px',
                        flexShrink: 0
                      }}>
                        <span style={{ color: 'white', fontSize: '12px', fontWeight: 'bold' }}>
                          {sopUploadError.trackedChanges.length}
                        </span>
                      </div>
                      <strong style={{ fontSize: '0.95em' }}>Tracked Changes</strong>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.9em', color: '#92400e', paddingLeft: '28px' }}>
                      Review → Accept All Changes → Save
                    </p>
                  </div>
                )}
                {sopUploadError.comments.length > 0 && (
                  <div style={{
                    background: '#fef3c7',
                    border: '1px solid #f59e0b',
                    borderRadius: '6px',
                    padding: '14px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{
                        width: '20px',
                        height: '20px',
                        background: '#f59e0b',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: '8px',
                        flexShrink: 0
                      }}>
                        <span style={{ color: 'white', fontSize: '12px', fontWeight: 'bold' }}>
                          {sopUploadError.comments.length}
                        </span>
                      </div>
                      <strong style={{ fontSize: '0.95em' }}>Unresolved Comments</strong>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.9em', color: '#92400e', paddingLeft: '28px' }}>
                      Right-click each comment → Resolve → Save
                    </p>
                  </div>
                )}
                {sopUploadError.trackedChanges.length === 0 && sopUploadError.comments.length === 0 && (
                  <p style={{ color: '#6b7280' }}>{sopUploadError.message}</p>
                )}
              </div>
            )}
          </div>
          {sopUploadStatus !== 'uploading' && (
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setSopUploadStatus('idle');
                  setSopUploadError(null);
                  setSopSyncSummary(null);
                }}
              >
                {sopUploadStatus === 'success' ? 'Done' : 'OK'}
              </button>
            </div>
          )}
        </div>
      </div>
    )}

    {/* Edit SOP Modal */}
    {showSopEditModal && (
      <div className="modal-overlay" style={{ zIndex: 10002 }} onClick={() => setShowSopEditModal(false)}>
        <div className="modal confirm-dialog" style={{ maxWidth: '450px' }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>Edit SOP</h3>
          </div>
          <div className="modal-body">
            <p style={{ marginBottom: '16px', color: '#6b7280' }}>
              The process flow has changed since the SOP was finalized. Choose how to update the SOP:
            </p>
            <button
              className="dropdown-item"
              onClick={() => {
                regenerateSOP();
                setShowSopEditModal(false);
                setShowSopDropdown(false);
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '12px',
                marginBottom: '8px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                background: '#f9fafb'
              }}
            >
              <strong style={{ display: 'block', marginBottom: '4px' }}>Regenerate from Flow</strong>
              <span style={{ fontSize: '0.85em', color: '#6b7280' }}>
                Create a new draft SOP based on the current process flow
              </span>
            </button>
            <button
              className="dropdown-item"
              onClick={() => {
                handleEditSopManually();
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '12px',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                background: '#f9fafb'
              }}
            >
              <strong style={{ display: 'block', marginBottom: '4px' }}>Download & Edit Manually</strong>
              <span style={{ fontSize: '0.85em', color: '#6b7280' }}>
                Download final SOP to edit in Word (reverts to draft status)
              </span>
            </button>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowSopEditModal(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Remove SOP Confirmation */}
    {showSopRemoveConfirm && (
      <div className="modal-overlay" style={{ zIndex: 10002 }} onClick={() => setShowSopRemoveConfirm(false)}>
        <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>Remove SOP?</h3>
          </div>
          <div className="modal-body">
            <p>This will remove the SOP and reset to "No SOP" state. The process flow will not be affected.</p>
            <p style={{ marginTop: '12px', fontSize: '0.9em', color: '#6b7280' }}>
              You can generate a new SOP anytime from the process flow.
            </p>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowSopRemoveConfirm(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleRemoveSop}
            >
              Remove SOP
            </button>
          </div>
        </div>
      </div>
    )}

    {/* SOP Out-of-sync Info */}
    {showSopOutOfSyncModal && (
      <div className="modal-overlay" style={{ zIndex: 10003 }} onClick={() => setShowSopOutOfSyncModal(false)}>
        <div className="modal confirm-dialog" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <h3>Out of sync</h3>
          </div>
          <div className="modal-body">
            <p style={{ marginBottom: '10px' }}>
              There have been changes to the process flow since the last finalized SOP was uploaded.
            </p>
            {sopFlowLastSyncedAt && (
              <p style={{ marginBottom: '10px', fontSize: '0.9em', color: '#6b7280' }}>
                Last aligned with flow on: {new Date(sopFlowLastSyncedAt).toLocaleString()}
              </p>
            )}
            <p style={{ fontSize: '0.9em', color: '#6b7280' }}>
              To re-align, regenerate a draft SOP from the flow or upload an updated finalized SOP.
            </p>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowSopOutOfSyncModal(false)}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Screenshot Browser Modal */}
    {ENABLE_SCREENSHOTS ? (
      <ScreenshotBrowserModal
        isOpen={screenshotModalOpen}
        onClose={handleCloseScreenshotModal}
        nodeId={screenshotModalNodeId}
        nodeLabel={screenshotModalNodeLabel}
        currentScreenshotUrl={screenshotModalCurrentUrl}
        allScreenshots={allScreenshots}
        onScreenshotChange={handleScreenshotChange}
        flowId={flowId}
        onEnsureFlowSaved={onSaveFinalize ? async () => {
          const flowData = {
            nodes,
            edges,
            ...(recordingMetadata && { recording_metadata: recordingMetadata })
          };
          return await onSaveFinalize(flowData);
        } : undefined}
        onScreenshotDeleted={(deletedKey) => {
          setAllScreenshots(prev => prev.filter(s => s.url !== deletedKey));
          setRecordingMetadata(prev => {
            if (!prev) return prev;
            return {
              ...prev,
              screenshots: (prev.screenshots || []).filter(s => s.url !== deletedKey),
              screenshot_urls: (prev.screenshot_urls || []).filter(u => u !== deletedKey),
            };
          });
        }}
        onScreenshotAdded={(newShot) => {
          setAllScreenshots(prev => [...prev, newShot]);
          setRecordingMetadata(prev => {
            const base = prev || { screenshots: [], screenshot_urls: [] };
            return {
              ...base,
              screenshots: [...(base.screenshots || []), newShot],
              screenshot_urls: [...(base.screenshot_urls || []), newShot.url],
            };
          });
        }}
        nodes={nodes}
        edges={edges}
        onNavigateToNode={handleNavigateToNode}
      />
    ) : screenshotModalOpen && (
      <div className="screenshot-modal-overlay" onClick={() => setScreenshotModalOpen(false)}>
        <div className="screenshot-modal screenshot-modal-large" onClick={(e) => e.stopPropagation()}>
          <div className="screenshot-modal-header-clean">
            <button className="screenshot-modal-close-clean" onClick={() => setScreenshotModalOpen(false)} title="Close">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div className="screenshot-modal-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16, color: '#6b7280' }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            <p style={{ fontSize: 16, fontWeight: 500 }}>Screenshots</p>
            <p style={{ fontSize: 14, opacity: 0.7 }}>Soon we will add screenshots here</p>
          </div>
        </div>
      </div>
    )}
  </>
);

export default FlowChartModals;
