import React, { useState } from 'react';
import { Handle, Position } from '@xyflow/react';

const EndNode = ({ data, selected, id }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(data.label);

  // Sync local state with data when data changes
  React.useEffect(() => {
    if (!isEditing) setEditText(data.label);
  }, [data.label, isEditing]);

  const handleTextClick = () => {
    setIsEditing(true);
    setEditText(data.label);
  };

  const handleTextChange = (e) => {
    setEditText(e.target.value);
  };

  const handleTextBlur = () => {
    setIsEditing(false);
    if (editText !== data.label && data.onDataChange) {
      data.onDataChange(id, { label: editText });
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      handleTextBlur();
    }
  };

  const isEdgeConnected = data.isEdgeConnected || false;
  const isEdgeTarget = data.isEdgeTarget || false;

  // End nodes can only be target nodes
  const edgeHighlightClass = isEdgeTarget ? 'node-edge-target' : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Oval end node */}
      <div
        className={`end-node ${selected ? 'selected' : ''} ${edgeHighlightClass}`}
        style={{
          width: '80px',
          height: '40px',
          borderRadius: '20px',
          border: isEdgeTarget ? '3px solid #3b82f6' : '2px solid #dc3545',
          background: isEdgeTarget ? '#dbeafe' : 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          transition: 'all 0.3s ease',
        }}
      >
        <Handle type="target" position={Position.Left} />
      </div>

      {/* Text label below the end node */}
      <div style={{
        marginTop: '8px',
        maxWidth: '120px',
        textAlign: 'center',
      }}>
        {isEditing ? (
          <input
            type="text"
            value={editText}
            onChange={handleTextChange}
            onBlur={handleTextBlur}
            onKeyPress={handleKeyPress}
            style={{
              background: 'transparent',
              border: '1px solid #dc3545',
              borderRadius: '4px',
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: '500',
              color: 'var(--color-text-primary)',
              textAlign: 'center',
              width: '100%',
              fontFamily: 'inherit',
              outline: 'none',
              direction: 'ltr',
              unicodeBidi: 'normal',
            }}
            autoFocus
          />
        ) : (
          <span
            onClick={handleTextClick}
            style={{
              cursor: 'pointer',
              fontSize: '11px',
              fontWeight: '500',
              color: 'var(--color-text-primary)',
              display: 'block',
              whiteSpace: 'normal',
              wordBreak: 'break-word',
              lineHeight: '1.3',
            }}
          >
            {data.label}
          </span>
        )}
      </div>
    </div>
  );
};

export default EndNode;
