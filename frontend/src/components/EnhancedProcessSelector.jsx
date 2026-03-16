import { API_BASE_URL, authenticatedFetch } from '../config/api';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

const EnhancedProcessSelector = ({ isOpen, onClose, onSelectProcess }) => {
  const { getToken } = useAuth();
  const [taxonomy, setTaxonomy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedParent, setSelectedParent] = useState(null);
  const [newProcess, setNewProcess] = useState({
    name: '',
    description: '',
    code: ''
  });

  useEffect(() => {
    if (isOpen) {
      loadTaxonomy();
    }
  }, [isOpen]);

  const loadTaxonomy = async () => {
    try {
      setLoading(true);
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-taxonomy`,
        { method: 'GET' },
        getToken
      );
      if (!response.ok) throw new Error('Failed to load taxonomy');
      const data = await response.json();
      setTaxonomy(data);
      // Auto-expand all items for better visibility
      const allIds = new Set();
      const collectIds = (items) => {
        items.forEach(item => {
          allIds.add(item.id);
          if (item.children) collectIds(item.children);
        });
      };
      collectIds(data);
      setExpandedItems(allIds);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpanded = (id) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedItems(newExpanded);
  };

  const handleAddProcess = async () => {
    if (!newProcess.name.trim()) {
      alert('Process name is required');
      return;
    }

    try {
      const payload = {
        name: newProcess.name,
        description: newProcess.description,
        code: newProcess.code,
        level: selectedParent ? selectedParent.level + 1 : 0,
        parent_id: selectedParent ? selectedParent.id : null
      };

      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-taxonomy`,
        {
          method: 'POST',
          body: payload
        },
        getToken
      );

      if (!response.ok) throw new Error('Failed to create process');
      
      // Reload taxonomy
      await loadTaxonomy();
      
      // Reset form
      setNewProcess({ name: '', description: '', code: '' });
      setShowAddForm(false);
      setSelectedParent(null);
    } catch (err) {
      alert('Error creating process: ' + err.message);
    }
  };

  const openAddForm = (parent = null) => {
    setSelectedParent(parent);
    setShowAddForm(true);
  };

  const matchesSearch = (item) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      item.name.toLowerCase().includes(search) ||
      (item.description && item.description.toLowerCase().includes(search)) ||
      (item.code && item.code.toLowerCase().includes(search))
    );
  };

  const hasMatchingDescendant = (item) => {
    if (matchesSearch(item)) return true;
    if (item.children) {
      return item.children.some(child => hasMatchingDescendant(child));
    }
    return false;
  };

  const renderTaxonomyItem = (item, level = 0) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.has(item.id);
    const isL3Process = item.level === 3;
    const matches = hasMatchingDescendant(item);

    if (!matches && searchTerm) return null;

    return (
      <div key={item.id} className="hierarchy-item">
        <div className="hierarchy-item-row" style={{ paddingLeft: `${level * 20}px` }}>
          <div className="hierarchy-item-left">
            {hasChildren ? (
              <button 
                className="expand-toggle-small"
                onClick={() => toggleExpanded(item.id)}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            ) : (
              <span className="expand-spacer-small"></span>
            )}
            <span className="level-badge-small">L{item.level}</span>
            <div className="hierarchy-item-info">
              <h4>{item.name}</h4>
              {item.description && <p className="item-description">{item.description}</p>}
            </div>
          </div>
          <div className="hierarchy-item-actions">
            {isL3Process ? (
              <button 
                className="btn btn-sm btn-primary"
                onClick={() => onSelectProcess(item)}
              >
                Select
              </button>
            ) : (
              <button 
                className="btn btn-sm btn-outline"
                onClick={() => openAddForm(item)}
              >
                + Add Child
              </button>
            )}
          </div>
        </div>
        {hasChildren && isExpanded && (
          <div className="hierarchy-children">
            {item.children.map(child => renderTaxonomyItem(child, level + 1))}
          </div>
        )}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal enhanced-process-selector">
        <div className="modal-header">
          <h3>Select or Create Process</h3>
          <button className="btn-close" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          {/* Search and Actions Bar */}
          <div className="selector-toolbar">
            <input
              type="text"
              placeholder="Search processes..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <button 
              className="btn btn-success"
              onClick={() => openAddForm(null)}
            >
              + Add Root Process
            </button>
          </div>

          {/* Add Process Form */}
          {showAddForm && (
            <div className="add-process-form">
              <h4>
                Add New Process 
                {selectedParent && ` under "${selectedParent.name}"`}
              </h4>
              <div className="form-group">
                <label>Process Name *</label>
                <input
                  type="text"
                  value={newProcess.name}
                  onChange={(e) => setNewProcess({ ...newProcess, name: e.target.value })}
                  placeholder="Enter process name"
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newProcess.description}
                  onChange={(e) => setNewProcess({ ...newProcess, description: e.target.value })}
                  placeholder="Enter process description (optional)"
                  rows="3"
                />
              </div>
              <div className="form-actions">
                <button className="btn btn-secondary" onClick={() => {
                  setShowAddForm(false);
                  setSelectedParent(null);
                  setNewProcess({ name: '', description: '', code: '' });
                }}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleAddProcess}>
                  Create Process
                </button>
              </div>
            </div>
          )}

          {/* Hierarchy Tree */}
          {loading ? (
            <div className="loading">Loading processes...</div>
          ) : error ? (
            <div className="error-message">
              <strong>Error:</strong> {error}
            </div>
          ) : (
            <div className="hierarchy-tree">
              {taxonomy.length === 0 ? (
                <div className="empty-state">
                  <p>No processes found. Click "Add Root Process" to create one.</p>
                </div>
              ) : (
                taxonomy.map(item => renderTaxonomyItem(item, 0))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EnhancedProcessSelector;

