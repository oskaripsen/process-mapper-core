import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config/api';

const ExportModal = ({ taxonomy, onClose }) => {
  const { getToken } = useAuth();
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  
  // Collapsible sections state (all collapsed by default)
  const [expandedSections, setExpandedSections] = useState({
    scope: false,
    taxonomy: false,
    flow: false
  });
  
  // L0 process selection
  const [l0Processes, setL0Processes] = useState([]);
  const [selectedL0Ids, setSelectedL0Ids] = useState(new Set());
  
  // Always included taxonomy attributes (no checkboxes, no labels shown)
  const alwaysIncludedTaxonomyAttrs = ['id', 'parent_id'];
  
  // Selectable taxonomy attributes
  const taxonomyAttributeOptions = [
    { id: 'l0', label: 'L0 Name', default: true },
    { id: 'l1', label: 'L1 Name', default: true },
    { id: 'l2', label: 'L2 Name', default: true },
    { id: 'level', label: 'Level', default: true },
    { id: 'name', label: 'Process Name', default: true },
    { id: 'description', label: 'Description', default: true },
    { id: 'updated_at', label: 'Updated At', default: true },
    { id: 'role', label: 'Owner(s)', default: true },
  ];
  
  // Always included flow attributes (no checkboxes, no labels shown)
  const alwaysIncludedFlowAttrs = ['id', 'process_id'];
  
  // Selectable flow attributes
  const flowAttributeOptions = [
    { id: 'process_name', label: 'Process Name', default: true },
    { id: 'title', label: 'Title', default: true },
    { id: 'description', label: 'Description', default: true },
    { id: 'created_by', label: 'Created By', default: true },
    { id: 'status', label: 'Status', default: false },
    { id: 'version', label: 'Version', default: false },
    { id: 'created_at', label: 'Created At', default: false },
    { id: 'updated_at', label: 'Updated At', default: false },
  ];
  
  // Always included node attributes (Node ID, Node Type, Source, Target, Edge ID)
  const alwaysIncludedNodeAttrs = ['node_type'];
  
  // Selectable node attributes
  const nodeAttributeOptions = [
    { id: 'node_label', label: 'Process Step', default: true },
    { id: 'node_owner', label: 'Owner', default: true },
    { id: 'node_system', label: 'Tool/System', default: true },
    { id: 'node_automation', label: 'Manual/Automated', default: true },
  ];
  
  const [selectedTaxonomyAttrs, setSelectedTaxonomyAttrs] = useState(
    new Set(taxonomyAttributeOptions.filter(a => a.default).map(a => a.id))
  );
  const [selectedFlowAttrs, setSelectedFlowAttrs] = useState(
    new Set(flowAttributeOptions.filter(a => a.default).map(a => a.id))
  );
  const [selectedNodeAttrs, setSelectedNodeAttrs] = useState(
    new Set(nodeAttributeOptions.filter(a => a.default).map(a => a.id))
  );
  const [includeFlowNodes, setIncludeFlowNodes] = useState(true);
  
  // Extract L0 processes from taxonomy
  useEffect(() => {
    const l0 = taxonomy.filter(p => p.level === 0);
    setL0Processes(l0);
    // Default: select all L0 processes
    setSelectedL0Ids(new Set(l0.map(p => p.id)));
  }, [taxonomy]);
  
  const handleL0Toggle = (processId) => {
    const newSelected = new Set(selectedL0Ids);
    if (newSelected.has(processId)) {
      newSelected.delete(processId);
    } else {
      newSelected.add(processId);
    }
    setSelectedL0Ids(newSelected);
  };
  
  const handleSelectAllL0 = () => {
    if (selectedL0Ids.size === l0Processes.length) {
      setSelectedL0Ids(new Set());
    } else {
      setSelectedL0Ids(new Set(l0Processes.map(p => p.id)));
    }
  };
  
  const handleTaxonomyAttrToggle = (attrId) => {
    const newSelected = new Set(selectedTaxonomyAttrs);
    if (newSelected.has(attrId)) {
      newSelected.delete(attrId);
    } else {
      newSelected.add(attrId);
    }
    setSelectedTaxonomyAttrs(newSelected);
  };
  
  const handleSelectAllTaxonomyAttrs = () => {
    if (selectedTaxonomyAttrs.size === taxonomyAttributeOptions.length) {
      setSelectedTaxonomyAttrs(new Set());
    } else {
      setSelectedTaxonomyAttrs(new Set(taxonomyAttributeOptions.map(a => a.id)));
    }
  };
  
  const handleFlowAttrToggle = (attrId) => {
    const newSelected = new Set(selectedFlowAttrs);
    if (newSelected.has(attrId)) {
      newSelected.delete(attrId);
    } else {
      newSelected.add(attrId);
    }
    setSelectedFlowAttrs(newSelected);
  };
  
  const handleSelectAllFlowAttrs = () => {
    if (selectedFlowAttrs.size === flowAttributeOptions.length) {
      setSelectedFlowAttrs(new Set());
    } else {
      setSelectedFlowAttrs(new Set(flowAttributeOptions.map(a => a.id)));
    }
  };
  
  const handleNodeAttrToggle = (attrId) => {
    const newSelected = new Set(selectedNodeAttrs);
    if (newSelected.has(attrId)) {
      newSelected.delete(attrId);
    } else {
      newSelected.add(attrId);
    }
    setSelectedNodeAttrs(newSelected);
  };
  
  const handleSelectAllNodeAttrs = () => {
    if (selectedNodeAttrs.size === nodeAttributeOptions.length) {
      setSelectedNodeAttrs(new Set());
    } else {
      setSelectedNodeAttrs(new Set(nodeAttributeOptions.map(a => a.id)));
    }
  };
  
  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };
  
  const handleExport = async () => {
    if (selectedL0Ids.size === 0) {
      setError('Please select at least one L0 process to export.');
      return;
    }
    
    setExporting(true);
    setError('');
    
    try {
      // Build taxonomy attributes: always included + selected
      const taxonomyAttrs = [...alwaysIncludedTaxonomyAttrs, ...Array.from(selectedTaxonomyAttrs)];
      
      // Build flow attributes: always included + selected
      const flowAttrs = [...alwaysIncludedFlowAttrs, ...Array.from(selectedFlowAttrs)];
      
      // Build node attributes: always included + selected
      const nodeAttrs = [...alwaysIncludedNodeAttrs, ...Array.from(selectedNodeAttrs)];
      
      const payload = {
        selected_l0_ids: Array.from(selectedL0Ids),
        taxonomy_attributes: taxonomyAttrs,
        flow_attributes: flowAttrs,
        include_flow_nodes: includeFlowNodes,
        node_attributes: nodeAttrs
      };
      
      const token = await getToken();
      const response = await fetch(`${API_BASE_URL}/api/export/excel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to export');
      }
      
      // Download the file
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      
      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'process_export.xlsx';
      if (contentDisposition) {
        const match = contentDisposition.match(/filename=(.+)/);
        if (match) {
          filename = match[1].replace(/"/g, '');
        }
      }
      
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to export. Please try again.');
    } finally {
      setExporting(false);
    }
  };
  
  return (
    <div className="export-modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="export-modal-header">
          <h3>Export to Excel</h3>
          <button className="export-modal-close" onClick={onClose}>×</button>
        </div>
        
        <div className="export-modal-body">
          {error && (
            <div className="export-error">
              <span>⚠️</span> {error}
            </div>
          )}
          
          {/* L0 Process Scope Selection */}
          <div className={`export-section export-section-collapsible ${expandedSections.scope ? 'expanded' : ''}`}>
            <div className="export-section-header export-section-header-clickable" onClick={() => toggleSection('scope')}>
              <div className="export-section-title-row">
                <span className={`expand-icon ${expandedSections.scope ? 'expanded' : ''}`}>▶</span>
                <h4>Scope: L0 Processes</h4>
                <span className="selection-count">{selectedL0Ids.size} of {l0Processes.length} selected</span>
              </div>
              <button 
                className="btn-select-all"
                onClick={(e) => { e.stopPropagation(); handleSelectAllL0(); }}
              >
                {selectedL0Ids.size === l0Processes.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            {expandedSections.scope && (
              <div className="export-section-content">
                <div className="export-options-grid l0-grid">
                  {l0Processes.length === 0 ? (
                    <p className="no-options">No L0 processes available</p>
                  ) : (
                    l0Processes.map(process => (
                      <label key={process.id} className="export-checkbox-item">
                        <input
                          type="checkbox"
                          checked={selectedL0Ids.has(process.id)}
                          onChange={() => handleL0Toggle(process.id)}
                        />
                        <span className="checkbox-label">{process.name}</span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          
          {/* Taxonomy Attributes */}
          <div className={`export-section export-section-collapsible ${expandedSections.taxonomy ? 'expanded' : ''}`}>
            <div className="export-section-header export-section-header-clickable" onClick={() => toggleSection('taxonomy')}>
              <div className="export-section-title-row">
                <span className={`expand-icon ${expandedSections.taxonomy ? 'expanded' : ''}`}>▶</span>
                <h4>Taxonomy Attributes</h4>
                <span className="selection-count">{selectedTaxonomyAttrs.size} of {taxonomyAttributeOptions.length} selected</span>
              </div>
              <button 
                className="btn-select-all"
                onClick={(e) => { e.stopPropagation(); handleSelectAllTaxonomyAttrs(); }}
              >
                {selectedTaxonomyAttrs.size === taxonomyAttributeOptions.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            {expandedSections.taxonomy && (
              <div className="export-section-content">
                <div className="export-options-grid">
                  {taxonomyAttributeOptions.map(attr => (
                    <label key={attr.id} className="export-checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedTaxonomyAttrs.has(attr.id)}
                        onChange={() => handleTaxonomyAttrToggle(attr.id)}
                      />
                      <span className="checkbox-label">{attr.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          {/* Flow Attributes */}
          <div className={`export-section export-section-collapsible ${expandedSections.flow ? 'expanded' : ''}`}>
            <div className="export-section-header export-section-header-clickable" onClick={() => toggleSection('flow')}>
              <div className="export-section-title-row">
                <span className={`expand-icon ${expandedSections.flow ? 'expanded' : ''}`}>▶</span>
                <h4>Flow Attributes</h4>
                <span className="selection-count">
                  {selectedFlowAttrs.size + (includeFlowNodes ? selectedNodeAttrs.size : 0)} attributes
                </span>
              </div>
              <button 
                className="btn-select-all"
                onClick={(e) => { e.stopPropagation(); handleSelectAllFlowAttrs(); }}
              >
                {selectedFlowAttrs.size === flowAttributeOptions.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            {expandedSections.flow && (
              <div className="export-section-content">
                <div className="export-options-grid">
                  {flowAttributeOptions.map(attr => (
                    <label key={attr.id} className="export-checkbox-item">
                      <input
                        type="checkbox"
                        checked={selectedFlowAttrs.has(attr.id)}
                        onChange={() => handleFlowAttrToggle(attr.id)}
                      />
                      <span className="checkbox-label">{attr.label}</span>
                    </label>
                  ))}
                </div>
                
                {/* Flow Node Details Toggle */}
                <div className="export-node-toggle">
                  <label className="export-checkbox-item flow-nodes-checkbox">
                    <input
                      type="checkbox"
                      checked={includeFlowNodes}
                      onChange={(e) => setIncludeFlowNodes(e.target.checked)}
                    />
                    <span className="checkbox-label">
                      Include Flow Node Details
                    </span>
                  </label>
                </div>
                
                {/* Node Attributes (only shown when includeFlowNodes is true) */}
                {includeFlowNodes && (
                  <div className="export-node-attributes">
                    <div className="export-subsection-header">
                      <span className="subsection-title">Node Attributes</span>
                      <button 
                        className="btn-select-all btn-select-all-small"
                        onClick={handleSelectAllNodeAttrs}
                      >
                        {selectedNodeAttrs.size === nodeAttributeOptions.length ? 'Deselect All' : 'Select All'}
                      </button>
                    </div>
                    <div className="export-options-grid export-options-grid-small">
                      {nodeAttributeOptions.map(attr => (
                        <label key={attr.id} className={`export-checkbox-item export-checkbox-item-small ${attr.id === 'node_automation' ? 'export-checkbox-wide' : ''}`}>
                          <input
                            type="checkbox"
                            checked={selectedNodeAttrs.has(attr.id)}
                            onChange={() => handleNodeAttrToggle(attr.id)}
                          />
                          <span className="checkbox-label">{attr.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        <div className="modal-actions export-modal-actions">
          <button 
            type="button" 
            className="btn btn-secondary" 
            onClick={onClose}
            disabled={exporting}
          >
            Cancel
          </button>
          <button 
            type="button" 
            className="btn btn-primary export-btn" 
            onClick={handleExport}
            disabled={exporting || selectedL0Ids.size === 0}
          >
            {exporting ? (
              <>
                <span className="spinner"></span>
                Exporting...
              </>
            ) : (
              <>
                <svg className="export-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export to Excel
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;
