import React, { useState, useEffect } from 'react';
import FlowViewer from './FlowViewer';
import { API_BASE_URL, authenticatedFetch } from '../config/api';
import { useAuth } from '../context/AuthContext';

const ProcessFlowViewer = ({ processId, processName, onClose, onNavigateToWorkflow }) => {
  const { getToken } = useAuth();
  const [flows, setFlows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [viewingFlow, setViewingFlow] = useState(null);
  const [editingFlow, setEditingFlow] = useState(null);
  const [newFlow, setNewFlow] = useState({
    title: '',
    description: '',
    flow_data: {}
  });


  useEffect(() => {
    if (processId) {
      loadProcessFlows();
    }
  }, [processId]);

  const loadProcessFlows = async () => {
    try {
      setLoading(true);
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-flows/process/${processId}`,
        { method: 'GET' },
        getToken
      );
      if (!response.ok) throw new Error('Failed to load process flows');
      const data = await response.json();
      setFlows(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateFlow = async (e) => {
    e.preventDefault();
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-flows`,
        {
          method: 'POST',
          body: {
            process_id: processId,
            ...newFlow
          }
        },
        getToken
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to create flow');
      }
      
      await loadProcessFlows();
      setNewFlow({ title: '', description: '', flow_data: {} });
      setShowCreateForm(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleViewFlow = (flow) => {
    setViewingFlow(flow);
  };

  const handleEditFlow = (flow) => {
    setEditingFlow(flow);
    // Navigate to workflow creation with this flow for editing
    if (onNavigateToWorkflow) {
      onNavigateToWorkflow(processId, processName, flow);
    }
  };

  const handleCloseFlowViewer = () => {
    setViewingFlow(null);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'draft': return 'status-draft';
      case 'submitted': return 'status-submitted';
      case 'under_review': return 'status-review';
      case 'approved': return 'status-approved';
      case 'completed': return 'status-completed';
      default: return 'status-default';
    }
  };

  if (loading) {
    return (
      <div className="process-flow-viewer">
        <div className="loading">Loading process flows...</div>
      </div>
    );
  }

  return (
    <div className="process-flow-viewer">
      <div className="flow-viewer-header">
        <div className="header-left">
          <h3>Process Flows for {processName}</h3>
          <p>Manage and view process flows for this L3 process</p>
        </div>
        <div className="header-actions">
          <button 
            className="btn btn-primary"
            onClick={() => {
              if (onNavigateToWorkflow) {
                onNavigateToWorkflow(processId, processName);
              } else {
                setShowCreateForm(true);
              }
            }}
          >
            Create Flow
          </button>
          <button 
            className="btn btn-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>

      {error && (
        <div className="error-message">
          <strong>Error:</strong> {error}
        </div>
      )}

      {flows.length === 0 ? (
        <div className="empty-state">
          <p>No process flows created yet. Create your first flow to get started.</p>
        </div>
      ) : (
        <div className="flows-list">
          {flows.map(flow => (
            <div key={flow.id} className="flow-card">
              <div className="flow-header">
                <h4>{flow.title}</h4>
                <span className={`status-badge ${getStatusColor(flow.status)}`}>
                  {flow.status.replace('_', ' ')}
                </span>
              </div>
              <div className="flow-details">
                <p className="flow-description">{flow.description || 'No description'}</p>
                <div className="flow-meta">
                  <span>Version: {flow.version}</span>
                  <span>Created: {new Date(flow.created_at).toLocaleDateString()}</span>
                  <span>Updated: {new Date(flow.updated_at).toLocaleDateString()}</span>
                </div>
              </div>
              <div className="flow-actions">
                <button 
                  className="btn btn-sm btn-primary"
                  onClick={() => handleViewFlow(flow)}
                >
                  View Flow
                </button>
                {flow.status === 'draft' && (
                  <button 
                    className="btn btn-sm btn-success"
                    onClick={() => handleEditFlow(flow)}
                  >
                    Edit Flow
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Flow Viewer Modal */}
      {viewingFlow && (
        <FlowViewer
          flow={viewingFlow}
          onClose={handleCloseFlowViewer}
          onEdit={handleEditFlow}
        />
      )}

      {/* Create Flow Form Modal */}
      {showCreateForm && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Create New Process Flow</h3>
              <button 
                className="btn-close"
                onClick={() => setShowCreateForm(false)}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleCreateFlow} className="modal-body">
              <div className="form-group">
                <label>Flow Title *</label>
                <input
                  type="text"
                  value={newFlow.title}
                  onChange={(e) => setNewFlow({ ...newFlow, title: e.target.value })}
                  required
                  placeholder="e.g., Order Processing Flow"
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newFlow.description}
                  onChange={(e) => setNewFlow({ ...newFlow, description: e.target.value })}
                  rows="3"
                  placeholder="Describe this process flow..."
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Create Flow
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProcessFlowViewer;
