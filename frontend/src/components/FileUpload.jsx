import React, { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import axios from 'axios';
import { API_BASE_URL } from '../config/api';

const FileUpload = forwardRef(({ onTranscriptionComplete, onError }, ref) => {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  // Expose click method to parent components
  useImperativeHandle(ref, () => ({
    click: () => {
      fileInputRef.current?.click();
    }
  }));

  const handleFileSelect = (file) => {
    if (file && file.type.startsWith('audio/')) {
      setSelectedFile(file);
      // Auto-upload when file is selected (for hidden input mode)
      uploadFile(file);
    } else {
      onError('Please select a valid audio file');
    }
  };

  const uploadFile = async (file) => {
    const fileToUpload = file || selectedFile;
    
    if (!fileToUpload) {
      onError('Please select an audio file first');
      return;
    }

    setIsUploading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', fileToUpload);

      console.log('Uploading audio file:', fileToUpload.name);

      const response = await axios.post(`${API_BASE_URL}/transcribe`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      if (!response.data.transcript) {
        throw new Error('No transcript received from server');
      }

      onTranscriptionComplete(response.data.transcript);
      
      // Clear selected file after successful upload
      setSelectedFile(null);
      if (fileInputRef.cuyent) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Upload error:', error);
      onError(error.response?.data?.detail || error.message || 'Failed to transcribe audio');
    } finally {
      setIsUploading(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleFileInputChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleUpload = async () => {
    await uploadFile(selectedFile);
  };

  const handleClearFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="upload-section">
      <h3>Upload Audio File</h3>
      
      <div
        className={`upload-area ${isDragging ? 'dragover' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          onChange={handleFileInputChange}
        />
        
        {selectedFile ? (
          <div>
            <p className="upload-text">Selected: {selectedFile.name}</p>
            <p className="upload-text">Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
            <button 
              className="upload-button secondary" 
              onClick={(e) => {
                e.stopPropagation();
                handleClearFile();
              }}
            >
              Clear
            </button>
          </div>
        ) : (
          <div>
            <p className="upload-text">
              {isDragging ? 'Drop your audio file here' : 'Click to select or drag and drop an audio file'}
            </p>
            <button className="upload-button">Choose File</button>
          </div>
        )}
      </div>

      {selectedFile && (
        <div className="controls">
          <button
            className="upload-button"
            onClick={handleUpload}
            disabled={isUploading}
          >
            {isUploading ? (
              <div className="loading">
                <div className="spinner"></div>
                Transcribing...
              </div>
            ) : (
              'Transcribe Audio'
            )}
          </button>
        </div>
      )}
    </div>
  );
});

export default FileUpload;
