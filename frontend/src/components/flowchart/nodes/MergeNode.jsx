import React from 'react';
import { Handle, Position } from '@xyflow/react';

const MergeNode = ({ data, selected, id }) => {
  // Merge nodes are now static "Merge" labels, no editing

  const isEdgeConnected = data.isEdgeConnected || false;
  const isEdgeSource = data.isEdgeSource || false;
  const isEdgeTarget = data.isEdgeTarget || false;

  // Determine which edge highlight class to use
  const edgeHighlightClass = isEdgeSource ? 'node-edge-source' : (isEdgeTarget ? 'node-edge-target' : '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Circular merge node */}
      <div
        className={`merge-node ${selected ? 'selected' : ''} ${edgeHighlightClass}`}
        style={{
          width: '60px',
          height: '60px',
          borderRadius: '50%',
          border: isEdgeSource ? '3px solid #93c5fd' : (isEdgeTarget ? '3px solid #3b82f6' : '2px solid var(--color-primary)'),
          background: isEdgeSource ? '#eff6ff' : (isEdgeTarget ? '#dbeafe' : 'var(--color-surface)'),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          transition: 'all 0.3s ease',
        }}
      >
        {/* Icon or Text inside circle */}
        <span style={{ fontSize: '10px', fontWeight: 'bold', color: 'var(--color-text-primary)' }}>M</span>

        {/* Merge node handles: Right outgoing, others incoming */}
        {/* Multiple incoming connections can use the same handles when needed */}
        <Handle
          type="target"
          position={Position.Top}
          id="top"
          style={{
            background: 'var(--color-primary)',
            width: '12px',
            height: '12px',
            left: '50%',
            top: '-7px',
            transform: 'translateX(-50%)',
            zIndex: 10,
          }}
        />
        <Handle
          type="target"
          position={Position.Left}
          id="left"
          style={{
            background: 'var(--color-primary)',
            width: '12px',
            height: '12px',
            left: '-7px',
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 10,
          }}
        />
        <Handle
          type="source"
          position={Position.Right}
          id="right"
          style={{
            background: 'var(--color-primary)',
            width: '12px',
            height: '12px',
            right: '-7px',
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 10,
          }}
        />
        <Handle
          type="target"
          position={Position.Bottom}
          id="bottom"
          style={{
            background: 'var(--color-primary)',
            width: '12px',
            height: '12px',
            left: '50%',
            bottom: '-7px',
            transform: 'translateX(-50%)',
            zIndex: 10,
          }}
        />
      </div>

      {/* Static Text label below the merge node */}
      <div style={{
        marginTop: '8px',
        maxWidth: '120px',
        textAlign: 'center',
      }}>
        <span
          style={{
            fontSize: '11px',
            fontWeight: '500',
            color: 'var(--color-text-primary)',
            display: 'block',
            whiteSpace: 'normal',
            wordBreak: 'break-word',
            lineHeight: '1.3',
          }}
        >
          Merge
        </span>
      </div>
    </div>
  );
};

export default MergeNode;
