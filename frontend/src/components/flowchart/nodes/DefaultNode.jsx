import React, { useState } from 'react';
import { Handle, NodeResizer, Position } from '@xyflow/react';
import { ENABLE_SCREENSHOTS } from '../../../config/api';

const DefaultNode = ({ data, selected, id }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(data.label);
  const [isEditingOwner, setIsEditingOwner] = useState(false);
  const [editOwner, setEditOwner] = useState(data.owner || 'TBD');
  const [isEditingSystem, setIsEditingSystem] = useState(false);
  const [editSystem, setEditSystem] = useState(data.system || 'TBD');

  // Sync local state with data when data changes (e.g., from undo/redo)
  React.useEffect(() => {
    if (!isEditing) setEditText(data.label);
  }, [data.label, isEditing]);

  React.useEffect(() => {
    if (!isEditingOwner) setEditOwner(data.owner || 'TBD');
  }, [data.owner, isEditingOwner]);

  React.useEffect(() => {
    if (!isEditingSystem) setEditSystem(data.system || 'TBD');
  }, [data.system, isEditingSystem]);

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
    // Allow Shift+Enter for line breaks
  };

  const handleOwnerClick = () => {
    setIsEditingOwner(true);
    setEditOwner(data.owner || 'TBD');
  };

  const handleOwnerChange = (e) => {
    setEditOwner(e.target.value);
  };

  const handleOwnerBlur = () => {
    setIsEditingOwner(false);
    if (editOwner !== data.owner && data.onDataChange) {
      data.onDataChange(id, { owner: editOwner });
    }
  };

  const handleOwnerKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleOwnerBlur();
    }
  };

  const handleSystemClick = () => {
    setIsEditingSystem(true);
    setEditSystem(data.system || 'TBD');
  };

  const handleSystemChange = (e) => {
    setEditSystem(e.target.value);
  };

  const handleSystemBlur = () => {
    setIsEditingSystem(false);
    if (editSystem !== data.system && data.onDataChange) {
      data.onDataChange(id, { system: editSystem });
    }
  };

  const handleSystemKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSystemBlur();
    }
  };

  const toggleManualAutomated = () => {
    const newValue = data.manualOrAutomated === 'manual' ? 'automated' : 'manual';
    if (data.onDataChange) {
      data.onDataChange(id, { manualOrAutomated: newValue });
    }
  };

  // Default node size - increased to accommodate new elements
  const defaultWidth = 160;
  const defaultHeight = 100;

  // Calculate text wrapping within default node size
  const textLines = editText.split('\n');

  // Define text wrapping parameters for default size
  const defaultCharsPerLine = 20; // Characters that fit in default width
  const defaultMaxLines = 3; // Lines that fit in default height

  // Calculate how many lines the text will take with word wrapping at default width
  const estimatedWrappedLines = Math.max(
    textLines.length, // Lines from explicit line breaks
    Math.ceil(editText.length / defaultCharsPerLine) // Estimated lines from word wrapping
  );

  // Only expand if text exceeds the default capacity
  const needsHeightExpansion = estimatedWrappedLines > defaultMaxLines;
  const needsWidthExpansion = estimatedWrappedLines > defaultMaxLines &&
    Math.max(...textLines.map(line => line.length)) > defaultCharsPerLine * 1.5;

  // Calculate sizes - prioritize width expansion over height
  let nodeWidth = defaultWidth;
  let nodeHeight = defaultHeight;

  // Calculate required width based on text length
  // Assume ~7px per character on average
  const maxLineLength = Math.max(...textLines.map(line => line.length));
  const totalChars = editText.length;

  // Expand width to fit text within defaultMaxLines (3 lines)
  // This avoids growing height unless explicit newlines force it
  const targetCharsPerLine = Math.ceil(totalChars / defaultMaxLines);
  const requiredWidthForWrapping = Math.max(defaultWidth, targetCharsPerLine * 7 + 40);

  // Also accommodate explicit long lines
  const requiredWidthForLongestLine = Math.max(defaultWidth, maxLineLength * 7 + 40);

  // Take the larger of the two requirements
  nodeWidth = Math.max(requiredWidthForWrapping, requiredWidthForLongestLine);

  // Only expand height if explicit newlines exceed defaultMaxLines
  if (textLines.length > defaultMaxLines) {
    nodeHeight = Math.max(defaultHeight, textLines.length * 20 + 40);
  }

  // Extract metadata from data
  const nodeId = data.logical_id || data.id || id;
  const owner = data.owner || 'TBD';
  const system = data.system || 'TBD';
  const manualOrAutomated = data.manualOrAutomated || 'manual';
  const nodeType = data.type || 'default';
  const screenshotUrl = data.screenshot_url || data.screenshotUrl;

  // Check for topology error (passed from FlowChart via data)
  const hasTopologyError = data.hasTopologyError || false;
  const isEdgeConnected = data.isEdgeConnected || false;
  const isEdgeSource = data.isEdgeSource || false;
  const isEdgeTarget = data.isEdgeTarget || false;

  // Determine which edge highlight class to use
  const edgeHighlightClass = isEdgeSource ? 'node-edge-source' : (isEdgeTarget ? 'node-edge-target' : '');

  // Determine border and glow colors based on state
  const getBorderStyle = () => {
    if (isEdgeSource) {
      return '3px solid #93c5fd'; // Lighter blue for source
    }
    if (isEdgeTarget) {
      return '3px solid #3b82f6'; // Darker blue for target
    }
    if (hasTopologyError) {
      return '3px solid #dc3545';
    }
    return '2px solid var(--color-primary)';
  };

  const getBoxShadow = () => {
    // When edge is connected, don't set inline box-shadow - let CSS animation handle it
    if (isEdgeConnected) {
      return undefined;
    }
    if (hasTopologyError) {
      return '0 0 12px rgba(220, 53, 69, 0.4)';
    }
    if (selected) {
      return '0 0 0 2px var(--color-primary)';
    }
    return '0 2px 4px rgba(0,0,0,0.1)';
  };

  const getBackground = () => {
    if (isEdgeSource) {
      return '#eff6ff'; // Light blue for source
    }
    if (isEdgeTarget) {
      return '#dbeafe'; // Slightly darker blue for target
    }
    if (hasTopologyError) {
      return '#fff5f5';
    }
    return 'var(--color-surface)';
  };

  return (
    <div
      key={id}
      className={`default-node ${selected ? 'selected' : ''} ${hasTopologyError ? 'topology-error' : ''} ${edgeHighlightClass}`}
      style={{
        width: data.width ? Math.max(data.width, nodeWidth) : `${nodeWidth}px`,
        height: data.height ? Math.max(data.height, nodeHeight) : `${nodeHeight}px`,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        background: getBackground(),
        border: getBorderStyle(),
        borderRadius: '8px',
        boxShadow: getBoxShadow(),
        padding: '8px',
        fontSize: '12px',
        fontWeight: '500',
        color: '#333',
        textAlign: 'center',
        lineHeight: '1.2',
        minWidth: `${nodeWidth}px`,
        minHeight: `${nodeHeight}px`,
        transition: 'all 0.3s ease',
      }}
      title={hasTopologyError ? 'Topology Error: This node has a missing connection' : (isEdgeSource ? 'Source node' : (isEdgeTarget ? 'Target node' : ''))}
    >
      {/* Node Resizer - only visible when selected */}
      {selected && (
        <NodeResizer
          minWidth={nodeWidth}
          minHeight={nodeHeight}
          keepAspectRatio={false}
          onResizeStart={() => {
            document.body.style.cursor = 'nwse-resize';
          }}
          onResizeEnd={() => {
            document.body.style.cursor = '';
          }}
          handleStyle={{
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            backgroundColor: '#007bff',
            border: '3px solid white',
            boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
            zIndex: 10,
          }}
          lineStyle={{
            borderColor: '#007bff',
            borderWidth: '2px'
          }}
        />
      )}
      {/* Node ID - hidden (logical_id display removed for cleaner UI) */}
      {/* {nodeType === 'default' && nodeId && (
        <div style={{
          position: 'absolute',
          top: '-20px',
          left: '-2px',
          fontSize: '10px',
          fontWeight: 'bold',
          color: '#666',
          background: '#f8f9fa',
          padding: '2px 6px',
          borderRadius: '4px',
          border: '1px solid #dee2e6',
          whiteSpace: 'nowrap'
        }}>
          {nodeId}
        </div>
      )} */}

      {/* Screenshot Indicator - top left corner */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (!ENABLE_SCREENSHOTS) return;
          if (data.onScreenshotClick) {
            data.onScreenshotClick(id, screenshotUrl, data.label);
          }
        }}
        className={`node-screenshot-indicator ${!ENABLE_SCREENSHOTS ? 'screenshots-disabled' : screenshotUrl ? 'has-screenshot' : 'no-screenshot'}`}
        title={!ENABLE_SCREENSHOTS ? 'Screenshots coming soon' : screenshotUrl ? 'View/change screenshot' : 'No screenshot - click to add'}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = 'scale(1.15)';
          e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = 'scale(1)';
          e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </div>

      {/* A/M Indicator - top right corner */}
      <div
        onClick={toggleManualAutomated}
        style={{
          position: 'absolute',
          top: '-8px',
          right: '-8px',
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          background: data.manualOrAutomated === 'automated' ? '#28a745' : '#ffc107',
          color: 'white',
          fontSize: '10px',
          fontWeight: 'bold',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid white',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          cursor: 'pointer',
          transition: 'all 0.2s ease'
        }}
        title={`Click to toggle: ${data.manualOrAutomated === 'automated' ? 'Automated' : 'Manual'}`}
        onMouseEnter={(e) => {
          e.target.style.transform = 'scale(1.1)';
          e.target.style.boxShadow = '0 4px 8px rgba(0,0,0,0.3)';
        }}
        onMouseLeave={(e) => {
          e.target.style.transform = 'scale(1)';
          e.target.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
        }}
      >
        {data.manualOrAutomated === 'automated' ? 'A' : 'M'}
      </div>

      {/* Main process step content */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4px 0',
        width: '100%',
        maxWidth: `${nodeWidth - 16}px`, // Account for padding
        overflow: 'hidden'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', width: '100%' }}>
          {isEditing ? (
            <textarea
              value={editText}
              onChange={handleTextChange}
              onBlur={handleTextBlur}
              onKeyPress={handleKeyPress}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: '12px',
                fontWeight: '500',
                color: 'var(--color-text-primary)',
                textAlign: 'center',
                width: '100%',
                maxWidth: '100%',
                height: '100%',
                fontFamily: 'inherit',
                resize: 'none',
                overflow: 'hidden',
                whiteSpace: 'normal',
                wordBreak: 'break-word',
                lineHeight: '1.3',
                padding: '2px',
                hyphens: 'auto',
                direction: 'ltr',
                unicodeBidi: 'normal',
              }}
              autoFocus
              rows={Math.max(2, Math.ceil(editText.length / 25))}
            />
          ) : (
            <span
              onClick={handleTextClick}
              style={{
                cursor: 'pointer',
                width: '100%',
                maxWidth: '100%',
                display: 'block',
                direction: 'ltr', // Ensure left-to-right text direction
                textAlign: 'center',
                unicodeBidi: 'normal', // Prevent bidirectional text issues
                whiteSpace: 'normal', // Allow text to wrap
                wordBreak: 'break-word', // Break long words if necessary
                lineHeight: '1.3', // Slightly increased line height for better readability
                padding: '2px', // Add small padding for better text spacing
                overflow: 'hidden',
                hyphens: 'auto', // Enable automatic hyphenation
              }}
            >
              {data.label}
            </span>
          )}
        </div>
      </div>

      {/* Metadata boxes - stacked beneath description, width follows node */}
      <div style={{
        position: 'absolute',
        bottom: '-70px',
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        alignItems: 'stretch',
        padding: '0 4px',
      }}>
        {/* Owner box - width matches node */}
        <div
          className="editable-metadata-box"
          style={{
            fontSize: '11px',
            fontWeight: '600',
            color: '#333',
            background: isEditingOwner ? 'var(--color-surface)' : 'var(--color-surface)',
            padding: '6px 10px',
            borderRadius: '6px',
            border: isEditingOwner ? '2px solid #007bff' : '2px solid #28a745',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: isEditingOwner ? '0 0 0 2px rgba(0,123,255,0.25)' : '0 2px 6px rgba(0,0,0,0.15)',
            textAlign: 'center',
          }}
          onClick={handleOwnerClick}
          title="Click to edit owner/role"
          onMouseEnter={(e) => {
            if (!isEditingOwner) {
              e.target.style.background = '#f8fff8';
              e.target.style.borderColor = '#20c997';
            }
          }}
          onMouseLeave={(e) => {
            if (!isEditingOwner) {
              e.target.style.background = 'var(--color-surface)';
              e.target.style.borderColor = '#28a745';
            }
          }}
        >
          {isEditingOwner ? (
            <input
              type="text"
              value={editOwner}
              onChange={handleOwnerChange}
              onBlur={handleOwnerBlur}
              onKeyPress={handleOwnerKeyPress}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: '11px',
                fontWeight: '500',
                color: 'var(--color-text-primary)',
                width: '100%',
                fontFamily: 'inherit',
                padding: 0,
                margin: 0,
                direction: 'ltr',
                unicodeBidi: 'normal',
                textAlign: 'center',
              }}
              autoFocus
            />
          ) : (
            <>👤 {data.owner || 'TBD'}</>
          )}
        </div>

        {/* Tool box - width matches node */}
        <div
          className="editable-metadata-box"
          style={{
            fontSize: '11px',
            fontWeight: '600',
            color: '#333',
            background: isEditingSystem ? 'var(--color-surface)' : 'var(--color-surface)',
            padding: '6px 10px',
            borderRadius: '6px',
            border: isEditingSystem ? '2px solid #007bff' : '2px solid #fd7e14',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            boxShadow: isEditingSystem ? '0 0 0 2px rgba(0,123,255,0.25)' : '0 2px 6px rgba(0,0,0,0.15)',
            textAlign: 'center',
          }}
          onClick={handleSystemClick}
          title="Click to edit tool/system"
          onMouseEnter={(e) => {
            if (!isEditingSystem) {
              e.target.style.background = '#fff8f0';
              e.target.style.borderColor = '#e8590c';
            }
          }}
          onMouseLeave={(e) => {
            if (!isEditingSystem) {
              e.target.style.background = 'var(--color-surface)';
              e.target.style.borderColor = '#fd7e14';
            }
          }}
        >
          {isEditingSystem ? (
            <input
              type="text"
              value={editSystem}
              onChange={handleSystemChange}
              onBlur={handleSystemBlur}
              onKeyPress={handleSystemKeyPress}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                fontSize: '11px',
                fontWeight: '500',
                color: 'var(--color-text-primary)',
                width: '100%',
                fontFamily: 'inherit',
                padding: 0,
                margin: 0,
                direction: 'ltr',
                unicodeBidi: 'normal',
                textAlign: 'center',
              }}
              autoFocus
            />
          ) : (
            <>🛠️ {data.system || 'TBD'}</>
          )}
        </div>
      </div>

      {/* Connection handles */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          background: 'var(--color-primary)',
          width: '8px',
          height: '8px',
          left: '-4px',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          background: 'var(--color-primary)',
          width: '8px',
          height: '8px',
          right: '-4px',
        }}
      />
    </div>
  );
};

export default DefaultNode;
