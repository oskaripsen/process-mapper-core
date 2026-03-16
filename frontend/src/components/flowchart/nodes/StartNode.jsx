import React, { useState } from 'react';
import { Handle, Position } from '@xyflow/react';

const StartNode = ({ data, selected, id }) => {
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
  const isEdgeSource = data.isEdgeSource || false;

  // Start nodes can only be source nodes
  const edgeHighlightClass = isEdgeSource ? 'node-edge-source' : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Oval start node */}
      <div
        className={`start-node ${selected ? 'selected' : ''} ${edgeHighlightClass}`}
        style={{
          width: '80px',
          height: '40px',
          borderRadius: '20px',
          border: isEdgeSource ? '3px solid #93c5fd' : '2px solid #28a745',
          background: isEdgeSource ? '#eff6ff' : 'var(--color-surface)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          transition: 'all 0.3s ease',
        }}
      >
        <Handle type="source" position={Position.Right} />
      </div>

      {/* Text label below the start node */}
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
              border: '1px solid #28a745',
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

export default StartNode;
