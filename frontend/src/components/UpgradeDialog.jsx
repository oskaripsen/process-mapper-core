import React from 'react';

const UpgradeDialog = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3>Flow Limit Reached</h3>
        </div>
        <div className="modal-body">
          <p>
            You have reached the flow limit for this core build. The design and editing functionality is
            available, but subscription billing is removed in this version.
          </p>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default UpgradeDialog;
