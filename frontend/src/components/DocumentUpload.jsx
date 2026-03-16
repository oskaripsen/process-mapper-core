import React, { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_BASE_URL } from '../config/api';

const DocumentUpload = forwardRef(({ onFlowGenerated, onError, onUploadStart, existingFlow }, ref) => {
  const [showModal, setShowModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [fileContexts, setFileContexts] = useState({}); // Map of filename to context
  const fileInputRef = useRef(null);
  const { getToken } = useAuth();

  // Expose click method to parent components
  useImperativeHandle(ref, () => ({
    click: () => {
      fileInputRef.current?.click();
    }
  }));

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);

    const files = Array.from(e.dataTransfer.files);
    handleFiles(files);
  }, []);

  const handleFiles = (files) => {
    // Filter for supported file types
    const supportedFiles = files.filter(file => {
      const ext = file.name.toLowerCase().split('.').pop();
      return ['pdf', 'docx', 'pptx', 'png', 'jpg', 'jpeg'].includes(ext);
    });

    if (supportedFiles.length === 0) {
      onError('No supported files found. Please upload PDF, DOCX, PPTX, PNG, or JPEG files.');
      return null;
    }

    if (supportedFiles.length < files.length) {
      onError('Some files were skipped. Only PDF, DOCX, PPTX, PNG, and JPEG files are supported.');
    }

    return supportedFiles;
  };

  const uploadFilesDirectly = async (files) => {
    const supportedFiles = Array.isArray(files) ? files : [files];
    
    if (supportedFiles.length === 0) {
      onError('Please select files to upload');
      return;
    }

    // Check total size (20MB limit)
    const totalSize = supportedFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > 20 * 1024 * 1024) {
      onError('Total file size exceeds 20MB limit. Please select fewer or smaller files.');
      return;
    }

    setUploading(true);
    onUploadStart?.(); // Notify parent that upload has started

    try {
      const formData = new FormData();
      supportedFiles.forEach(file => {
        formData.append('files', file);
      });

      // Add existing flow if available (for incremental updates)
      if (existingFlow) {
        console.log('🔄 Including existing flow context in upload');
        formData.append('existing_flow', JSON.stringify(existingFlow));
      }

      console.log('Uploading files:', supportedFiles.map(f => f.name));

      const token = await getToken();

      const response = await axios.post(`${API_BASE_URL}/upload-doc`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        timeout: 120000, // 2 minute timeout for processing
      });

      console.log('📄 Upload response:', response.data);
      console.log('  - Has nodes?', !!response.data.nodes);
      console.log('  - Has edges?', !!response.data.edges);
      console.log('  - Has extracted_text?', !!response.data.extracted_text);

      // Check if we have flow data (nodes and edges)
      if (!response.data.nodes || !response.data.edges) {
        throw new Error('No flow data received from server');
      }

      // Notify parent with the flow data
      if (onFlowGenerated) {
        console.log('✅ Calling onFlowGenerated with data');
        onFlowGenerated(response.data);
      }

      // Clear after successful upload
      setSelectedFiles([]);
      setFileContexts({});
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Upload error:', error);
      let detail = error.response?.data?.detail;
      if (Array.isArray(detail)) {
        detail = detail.map(d => (typeof d === 'object' ? d.msg : d)).join('; ');
      } else if (typeof detail === 'object') {
        detail = JSON.stringify(detail);
      }
      onError(detail || error.message || 'Failed to upload and process documents');
    } finally {
      setUploading(false);
    }
  };

  const handleFileInput = (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      const supportedFiles = handleFiles(files);
      if (supportedFiles && supportedFiles.length > 0) {
        // Auto-upload when files are selected
        uploadFilesDirectly(supportedFiles);
      }
    }
  };

  const uploadFiles = async () => {
    if (selectedFiles.length === 0) {
      onError('Please select files to upload');
      return;
    }

    // Check total size (20MB limit)
    const totalSize = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > 20 * 1024 * 1024) {
      onError('Total file size exceeds 20MB limit. Please select fewer or smaller files.');
      return;
    }

    setUploading(true);
    onUploadStart?.(); // Notify parent that upload has started

    try {
      const formData = new FormData();
      selectedFiles.forEach(file => {
        formData.append('files', file);
      });

      // Add file contexts as JSON
      const contextsObj = {};
      selectedFiles.forEach(file => {
        if (fileContexts[file.name]) {
          contextsObj[file.name] = fileContexts[file.name];
        }
      });
      if (Object.keys(contextsObj).length > 0) {
        formData.append('contexts', JSON.stringify(contextsObj));
      }

      // Add existing flow if available (for incremental updates)
      if (existingFlow) {
        console.log('🔄 Including existing flow context in upload');
        formData.append('existing_flow', JSON.stringify(existingFlow));
      }

      console.log('Uploading files:', selectedFiles.map(f => f.name));
      console.log('File contexts:', contextsObj);

      const response = await axios.post(`${API_BASE_URL}/upload-doc`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        timeout: 120000, // 2 minute timeout for processing
      });

      console.log('📄 Upload response:', response.data);
      console.log('  - Has nodes?', !!response.data.nodes);
      console.log('  - Has edges?', !!response.data.edges);
      console.log('  - Has extracted_text?', !!response.data.extracted_text);

      // Check if we have flow data (nodes and edges)
      if (!response.data.nodes || !response.data.edges) {
        throw new Error('No flow data received from server');
      }

      // Notify parent with the flow data
      if (onFlowGenerated) {
        console.log('✅ Calling onFlowGenerated with data');
        onFlowGenerated(response.data);
      }

      // Clear and close modal after successful upload
      setSelectedFiles([]);
      setFileContexts({});
      setShowModal(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Upload error:', error);
      let detail = error.response?.data?.detail;
      if (Array.isArray(detail)) {
        detail = detail.map(d => (typeof d === 'object' ? d.msg : d)).join('; ');
      } else if (typeof detail === 'object') {
        detail = JSON.stringify(detail);
      }
      onError(detail || error.message || 'Failed to upload and process documents');
    } finally {
      setUploading(false);
    }
  };

  const removeFile = (index) => {
    const fileToRemove = selectedFiles[index];
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    // Also remove context for this file
    if (fileToRemove) {
      setFileContexts(prev => {
        const newContexts = { ...prev };
        delete newContexts[fileToRemove.name];
        return newContexts;
      });
    }
  };

  const updateFileContext = (fileName, context) => {
    setFileContexts(prev => ({
      ...prev,
      [fileName]: context
    }));
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getTotalSize = () => {
    const total = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    return formatFileSize(total);
  };

  return (
    <>
      {/* Hidden file input - always available */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg"
        onChange={handleFileInput}
        style={{ display: 'none' }}
      />

      {/* Modal Dialog */}
      {showModal && (
        <div className="modal-overlay" onClick={(e) => e.target.className === 'modal-overlay' && setShowModal(false)}>
          <div className="document-upload-modal">
            <div className="modal-header">
              <h3>Upload Documents</h3>
              <button
                className="btn-close"
                onClick={() => setShowModal(false)}
              >
                ×
              </button>
            </div>

            <div className="modal-body">
              {/* Drop Zone */}
              <div
                className={`upload-drop-zone ${dragging ? 'dragover' : ''}`}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="upload-text">
                  <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📄</div>
                  <p style={{ fontSize: '1rem', marginBottom: '0.5rem', fontWeight: '500' }}>
                    Drag and drop files here or click to select
                  </p>
                  <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                    Supports: PDF, DOCX, PPTX, PNG, JPEG (max 20MB total)
                  </p>
                </div>
              </div>

              {/* File List Table */}
              {selectedFiles.length > 0 && (
                <div className="file-list-container">
                  <h4 style={{ marginBottom: '1rem', color: '#374151', fontSize: '0.9375rem', fontWeight: '600' }}>
                    Selected Files ({selectedFiles.length}) - Total: {getTotalSize()}
                  </h4>
                  <table className="file-table">
                    <thead>
                      <tr>
                        <th style={{ width: '40%' }}>File Name</th>
                        <th style={{ width: '50%' }}>Add Context (Optional)</th>
                        <th style={{ width: '10%', textAlign: 'center' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedFiles.map((file, index) => (
                        <tr key={index}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                              <span style={{ fontSize: '1.25rem' }}>
                                {file.name.endsWith('.pdf') ? '📕' :
                                  file.name.endsWith('.docx') ? '📘' :
                                    file.name.endsWith('.pptx') ? '📙' : '🖼️'}
                              </span>
                              <div>
                                <div style={{ fontWeight: '500', fontSize: '0.875rem' }}>{file.name}</div>
                                <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>{formatFileSize(file.size)}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <input
                              type="text"
                              placeholder="e.g., 'process flow from 5 years ago', 'KPMG controls framework'"
                              value={fileContexts[file.name] || ''}
                              onChange={(e) => updateFileContext(file.name, e.target.value)}
                              disabled={uploading}
                              className="context-input"
                            />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {!uploading && (
                              <button
                                onClick={() => removeFile(index)}
                                className="remove-btn"
                                title="Remove file"
                              >
                                ✕
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Modal Footer with Generate Button */}
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setSelectedFiles([]);
                  setFileContexts({});
                  setShowModal(false);
                }}
                disabled={uploading}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={uploadFiles}
                disabled={uploading || selectedFiles.length === 0}
              >
                {uploading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <div className="spinner-small"></div>
                    <span>Processing...</span>
                  </div>
                ) : (
                  `Generate Flow from ${selectedFiles.length} ${selectedFiles.length === 1 ? 'Document' : 'Documents'}`
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .document-upload-modal {
          background: var(--color-surface);
          border-radius: 12px;
          max-width: 900px;
          width: 95%;
          max-height: 85vh;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(14, 59, 175, 0.05);
          display: flex;
          flex-direction: column;
          font-family: 'Inter', 'Manrope', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .modal-header {
          padding: 1.25rem 1.5rem;
          border-bottom: 1px solid var(--color-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .modal-header h3 {
          margin: 0;
          color: var(--color-text-primary);
          font-weight: 600;
          font-size: 1.125rem;
          letter-spacing: 0.2px;
        }

        .modal-body {
          padding: 1.5rem;
          overflow-y: auto;
          flex: 1;
        }

        .modal-footer {
          padding: 1.25rem 1.5rem;
          border-top: 1px solid var(--color-border);
          display: flex;
          justify-content: flex-end;
          gap: 0.75rem;
        }

        .upload-drop-zone {
          border: 2px dashed var(--color-border);
          border-radius: 8px;
          padding: 2rem;
          text-align: center;
          background: var(--color-background);
          transition: all 0.3s ease;
          cursor: pointer;
          margin-bottom: 1.5rem;
        }

        .upload-drop-zone:hover {
          border-color: var(--color-primary);
          background: var(--color-accent-hover);
        }

        .upload-drop-zone.dragover {
          border-color: var(--color-primary);
          background: var(--color-accent-hover);
          border-style: solid;
        }

        .file-list-container {
          margin-top: 1.5rem;
        }

        .file-table {
          width: 100%;
          border-collapse: collapse;
          border: 1px solid var(--color-border);
          border-radius: 8px;
          overflow: hidden;
        }

        .file-table thead {
          background: var(--color-background);
        }

        .file-table th {
          padding: 0.75rem;
          text-align: left;
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--color-text-primary);
          border-bottom: 2px solid var(--color-border);
        }

        .file-table td {
          padding: 0.875rem 0.75rem;
          border-bottom: 1px solid var(--color-border);
        }

        .file-table tbody tr:last-child td {
          border-bottom: none;
        }

        .file-table tbody tr:hover {
          background: var(--color-background);
        }

        .context-input {
          width: 100%;
          padding: 0.5rem 0.75rem;
          border: 1px solid var(--color-border);
          border-radius: 6px;
          font-size: 0.875rem;
          color: var(--color-text-primary);
          background: var(--color-surface);
          transition: border-color 0.2s ease;
          font-family: inherit;
        }

        .context-input:focus {
          outline: none;
          border-color: var(--color-primary);
          box-shadow: 0 0 0 3px rgba(14, 59, 175, 0.12);
        }

        .context-input:disabled {
          background: var(--color-background);
          cursor: not-allowed;
        }

        .context-input::placeholder {
          color: var(--color-text-secondary);
          font-style: italic;
        }

        .remove-btn {
          background: #dc3545;
          color: white;
          border: none;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 0.875rem;
          transition: all 0.2s ease;
          margin: 0 auto;
        }

        .remove-btn:hover {
          background: #c82333;
          transform: scale(1.1);
        }

        .spinner-small {
          display: inline-block;
          width: 16px;
          height: 16px;
          border: 2px solid var(--color-border);
          border-top: 2px solid var(--color-primary);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .btn {
          padding: 14px 24px;
          border: none;
          border-radius: 8px;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: inherit;
          letter-spacing: 0.2px;
        }

        .btn-primary {
          background: var(--color-primary);
          color: white;
        }

        .btn-primary:hover:not(:disabled) {
          background: var(--color-primary-hover);
        }

        .btn-primary:disabled {
          background: var(--color-text-secondary);
          cursor: not-allowed;
          opacity: 0.6;
        }

        .btn-secondary {
          background: var(--color-surface);
          color: var(--color-text-primary);
          border: 1px solid var(--color-primary);
        }

        .btn-secondary:hover:not(:disabled) {
          background: var(--color-accent-hover);
        }

        .btn-secondary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </>
  );
});

export default DocumentUpload;
