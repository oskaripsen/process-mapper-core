import React, { useState } from 'react';
import { Handle, Position } from '@xyflow/react';

const DecisionNode = ({ data, selected, id }) => {
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
  const isEdgeTarget = data.isEdgeTarget || false;
  const hasTopologyError = data.hasTopologyError || false;

  // Determine which edge highlight class to use
  const edgeHighlightClass = isEdgeSource ? 'node-edge-source' : (isEdgeTarget ? 'node-edge-target' : '');

  // Fixed compact diamond size
  const diamondSize = 60;

  const getDecisionBackground = () => {
    if (isEdgeSource) return '#eff6ff';
    if (isEdgeTarget) return '#dbeafe';
    return 'var(--color-surface)';
  };

  const getDecisionBorder = () => {
    if (isEdgeSource) return '3px solid #93c5fd';
    if (isEdgeTarget) return '3px solid #3b82f6';
    if (hasTopologyError) return '3px solid #dc3545';
    return '2px solid var(--color-primary)';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Diamond decision node */}
      <div
        className={`decision-node ${selected ? 'selected' : ''} ${edgeHighlightClass}`}
        style={{
          width: `${diamondSize}px`,
          height: `${diamondSize}px`,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
          border: 'none',
        }}
      >
        {/* Diamond shape using CSS transform */}
        <div
          style={{
            width: `${diamondSize}px`,
            height: `${diamondSize}px`,
            background: getDecisionBackground(),
            border: getDecisionBorder(),
            transform: 'rotate(45deg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: isEdgeConnected
              ? '0 0 0 3px rgba(59, 130, 246, 0.4), 0 0 20px rgba(59, 130, 246, 0.3)'
              : (hasTopologyError
                ? '0 0 12px rgba(220, 53, 69, 0.4)'
                : (selected ? `0 0 0 2px var(--color-primary)` : '0 2px 4px rgba(0,0,0,0.1)')),
            transition: 'all 0.3s ease',
          }}
        >
          {/* Question mark icon inside diamond */}
          <div
            style={{
              transform: 'rotate(-45deg)',
              fontSize: '20px',
              fontWeight: 'bold',
              color: isEdgeConnected ? '#3b82f6' : (hasTopologyError ? '#dc3545' : 'var(--color-primary)'),
            }}
          >
            ?
          </div>
        </div>

        {/* Connection handles */}
        {/* All four connection handles for decision nodes */}
        <Handle
          type="target"
          position={Position.Left}
          id="left"
          style={{
            background: 'var(--color-primary)',
            width: '8px',
            height: '8px',
            left: '-4px',
          }}
        />
        <Handle
          type="source"
          position={Position.Top}
          id="top"
          style={{
            background: 'var(--color-primary)',
            width: '8px',
            height: '8px',
            top: '-4px',
          }}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          style={{
            background: 'var(--color-primary)',
            width: '8px',
            height: '8px',
            right: '-4px',
          }}
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id="bottom"
          style={{
            background: 'var(--color-primary)',
            width: '8px',
            height: '8px',
            bottom: '-4px',
          }}
        />
      </div>

      {/* Text label below the decision node */}
      <div style={{
        marginTop: '12px',
        maxWidth: '140px',
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
              border: '1px solid var(--color-primary)',
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

export default DecisionNode;
