import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL, authenticatedFetch } from '../config/api';

const VersionHistoryModal = ({ isOpen, onClose, processId, currentFlowId, onRestoreVersion, onError }) => {
  const { getToken } = useAuth();
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (isOpen && currentFlowId) {
      fetchVersions();
    }
  }, [isOpen, currentFlowId]);

  const fetchVersions = async () => {
    setLoading(true);
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-flows/${currentFlowId}/versions`,
        { method: 'GET' },
        getToken
      );
      if (!response.ok) {
        throw new Error('Failed to fetch versions');
      }
      const data = await response.json();
      setVersions(data);
    } catch (error) {
      console.error('Error fetching versions:', error);
      onError?.(error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (version) => {
    if (!window.confirm(`Are you sure you want to restore version ${version.version_number}? Current changes will be saved as a new version.`)) {
      return;
    }

    setRestoring(true);
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-flows/${currentFlowId}/versions/${version.version_number}/restore`,
        { method: 'POST' },
        getToken
      );

      if (!response.ok) {
        throw new Error('Failed to restore version');
      }

      const restoredFlow = await response.json();
      onRestoreVersion(restoredFlow.flow_data);
      onClose();
    } catch (error) {
      console.error('Error restoring version:', error);
      onError?.(error.message);
    } finally {
      setRestoring(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 10002 }} onClick={onClose}>
      <div className="modal" style={{ maxWidth: '600px', width: '90%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Version History</h3>
          <button className="btn-icon" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {loading ? (
            <div className="flex-center p-4">
              <span className="spinner-small"></span>
              <span className="ml-2">Loading history...</span>
            </div>
          ) : versions.length === 0 ? (
            <div className="text-center p-4 text-gray-500">
              No history available for this flow.
            </div>
          ) : (
            <div className="version-list">
              {versions.map((version) => (
                <div 
                  key={version.id} 
                  className="version-item"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px',
                    borderBottom: '1px solid #e5e7eb',
                    background: '#fff'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>Version {version.version_number}</div>
                    <div style={{ fontSize: '0.85em', color: '#6b7280' }}>
                      {new Date(version.created_at).toLocaleString()} • {version.created_by}
                    </div>
                    <div style={{ fontSize: '0.85em', color: '#6b7280' }}>
                      {version.node_count} nodes • {version.edge_count} connectors
                    </div>
                  </div>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => handleRestore(version)}
                    disabled={restoring}
                  >
                    {restoring ? 'Restoring...' : 'Restore'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
};

export default VersionHistoryModal;

