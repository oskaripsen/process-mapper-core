import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { EdgeLabelRenderer } from '@xyflow/react';

/**
 * EditableEdge - Custom edge component with orthogonal paths
 * 
 * Features:
 * - Renders ONLY horizontal and vertical segments (no diagonals)
 * - Two modes:
 *   1. Simple mode (2 bends): horizontal-vertical-horizontal (when nodes are at similar Y)
 *   2. Complex mode (4 bends): horizontal-vertical-horizontal-vertical-horizontal (allows vertical adjustment)
 * - Draggable anywhere on the edge:
 *   - Drag vertical segments left/right
 *   - Drag horizontal segments up/down (enables 4-bend mode)
 * - Persists waypoint changes to edge data
 */

const CONTROL_POINT_SIZE = 8;
const HOVER_ZONE_SIZE = 20;
const HANDLE_OFFSET = 30; // Distance from handle before first bend
const SEGMENT_HIT_TOLERANCE = 15; // How close to a segment to detect it

/**
 * Determine which segment of the path was clicked
 */
const detectSegmentAtPoint = (x, y, segments, tolerance = SEGMENT_HIT_TOLERANCE) => {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'horizontal') {
      // Check if point is near horizontal segment
      const minX = Math.min(seg.x1, seg.x2);
      const maxX = Math.max(seg.x1, seg.x2);
      if (x >= minX - tolerance && x <= maxX + tolerance && Math.abs(y - seg.y) <= tolerance) {
        return { index: i, type: 'horizontal', segment: seg };
      }
    } else if (seg.type === 'vertical') {
      // Check if point is near vertical segment
      const minY = Math.min(seg.y1, seg.y2);
      const maxY = Math.max(seg.y1, seg.y2);
      if (y >= minY - tolerance && y <= maxY + tolerance && Math.abs(x - seg.x) <= tolerance) {
        return { index: i, type: 'vertical', segment: seg };
      }
    }
  }
  return null;
};

/**
 * Calculate orthogonal path with 2 or 4 bends
 * If bendY is provided and different from source/target Y, use 4-bend mode
 */
const calculateOrthogonalPath = (sourceX, sourceY, targetX, targetY, bendX = null, bendY = null) => {
  // Default bend position is halfway between source and target
  const midX = bendX !== null ? bendX : (sourceX + targetX) / 2;
  
  // Check if we need 4-bend mode (when bendY is set and different from the straight line)
  const needsVerticalOffset = bendY !== null && 
    Math.abs(bendY - sourceY) > 5 && 
    Math.abs(bendY - targetY) > 5;
  
  if (needsVerticalOffset) {
    // 4-bend path: source → short horizontal → vertical to bendY → horizontal at bendY → vertical to target → horizontal to target
    const firstBendX = sourceX + HANDLE_OFFSET;
    const lastBendX = targetX - HANDLE_OFFSET;
    
    return {
      path: `M ${sourceX} ${sourceY} L ${firstBendX} ${sourceY} L ${firstBendX} ${bendY} L ${lastBendX} ${bendY} L ${lastBendX} ${targetY} L ${targetX} ${targetY}`,
      bendX: midX,
      bendY: bendY,
      mode: '4-bend',
      segments: [
        { type: 'horizontal', y: sourceY, x1: sourceX, x2: firstBendX, draggable: false },
        { type: 'vertical', x: firstBendX, y1: sourceY, y2: bendY, draggable: false },
        { type: 'horizontal', y: bendY, x1: firstBendX, x2: lastBendX, draggable: true, dragType: 'horizontal' },
        { type: 'vertical', x: lastBendX, y1: bendY, y2: targetY, draggable: false },
        { type: 'horizontal', y: targetY, x1: lastBendX, x2: targetX, draggable: false },
      ]
    };
  }
  
  // 2-bend path: source → horizontal to midX → vertical to targetY → horizontal to target
  return {
    path: `M ${sourceX} ${sourceY} L ${midX} ${sourceY} L ${midX} ${targetY} L ${targetX} ${targetY}`,
    bendX: midX,
    bendY: null,
    mode: '2-bend',
    segments: [
      { type: 'horizontal', y: sourceY, x1: sourceX, x2: midX, draggable: true, dragType: 'horizontal' },
      { type: 'vertical', x: midX, y1: sourceY, y2: targetY, draggable: true, dragType: 'vertical' },
      { type: 'horizontal', y: targetY, x1: midX, x2: targetX, draggable: true, dragType: 'horizontal' },
    ]
  };
};

const EditableEdge = ({
  id,
  sourceX,
  sourceY: rawSourceY,
  targetX,
  targetY: rawTargetY,
  sourcePosition,
  targetPosition,
  data = {},
  style = {},
  markerEnd,
  label,
  labelStyle,
  labelBgStyle,
  selected,
}) => {
  // Apply offsets for edges sharing same source/target nodes
  const sourceOffset = data.sourceOffset || 0;
  const targetOffset = data.targetOffset || 0;
  const sourceY = rawSourceY + sourceOffset;
  const targetY = rawTargetY + targetOffset;
  
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState(null); // 'horizontal' or 'vertical'
  const [localBendX, setLocalBendX] = useState(null);
  const [localBendY, setLocalBendY] = useState(null);
  const [pendingBend, setPendingBend] = useState(null);
  const [cursorStyle, setCursorStyle] = useState('pointer');
  
  // Use ref to track current bend values for the mouseup handler
  const currentBendRef = useRef({ x: null, y: null });
  
  useEffect(() => {
    currentBendRef.current = { x: localBendX, y: localBendY };
  }, [localBendX, localBendY]);
  
  // Refs for drag handling
  const dragStateRef = useRef({
    isDragging: false,
    dragType: null,
    startBendX: 0,
    startBendY: 0,
    startClientX: 0,
    startClientY: 0,
    svg: null,
  });
  
  // Get stored bend positions from edge data
  const storedBendX = data.bendX ?? data.waypoints?.[0]?.x ?? null;
  const storedBendY = data.bendY ?? data.waypoints?.[0]?.y ?? null;
  
  // When parent confirms our pending values, clear local state
  useEffect(() => {
    if (pendingBend !== null) {
      const xMatches = pendingBend.x === null || storedBendX === null || Math.abs(storedBendX - pendingBend.x) < 1;
      const yMatches = pendingBend.y === null || storedBendY === null || Math.abs(storedBendY - pendingBend.y) < 1;
      
      if (xMatches && yMatches) {
        setLocalBendX(null);
        setLocalBendY(null);
        setPendingBend(null);
      }
    }
  }, [storedBendX, storedBendY, pendingBend]);
  
  // Use local state during drag, stored value otherwise
  const effectiveBendX = localBendX ?? storedBendX ?? (sourceX + targetX) / 2;
  const effectiveBendY = localBendY ?? storedBendY ?? null;

  // Calculate the orthogonal path
  const pathData = useMemo(() => {
    return calculateOrthogonalPath(sourceX, sourceY, targetX, targetY, effectiveBendX, effectiveBendY);
  }, [sourceX, sourceY, targetX, targetY, effectiveBendX, effectiveBendY]);

  // Calculate label position
  const labelPosition = useMemo(() => {
    if (pathData.mode === '4-bend' && effectiveBendY !== null) {
      const firstBendX = sourceX + HANDLE_OFFSET;
      const lastBendX = targetX - HANDLE_OFFSET;
      return {
        x: (firstBendX + lastBendX) / 2,
        y: effectiveBendY
      };
    }
    return {
    x: effectiveBendX,
    y: (sourceY + targetY) / 2
    };
  }, [effectiveBendX, effectiveBendY, sourceX, sourceY, targetX, targetY, pathData.mode]);

  // Global drag handlers
  useEffect(() => {
    const handleGlobalMouseMove = (e) => {
      if (!dragStateRef.current.isDragging) return;
      
      const svg = dragStateRef.current.svg;
      if (!svg) return;

      try {
        const pt = svg.createSVGPoint();
        pt.x = e.clientX;
        pt.y = e.clientY;
        
        const ctm = svg.getScreenCTM();
        if (ctm) {
          const svgP = pt.matrixTransform(ctm.inverse());
          
          if (dragStateRef.current.dragType === 'vertical') {
            // Horizontal drag - move vertical segment left/right
          const minX = Math.min(sourceX, targetX) + 50;
          const maxX = Math.max(sourceX, targetX) - 50;
          const newBendX = Math.max(minX, Math.min(maxX, svgP.x));
          setLocalBendX(newBendX);
          } else if (dragStateRef.current.dragType === 'horizontal') {
            // Vertical drag - move horizontal segment up/down
            const minY = Math.min(sourceY, targetY) - 200;
            const maxY = Math.max(sourceY, targetY) + 200;
            const newBendY = Math.max(minY, Math.min(maxY, svgP.y));
            setLocalBendY(newBendY);
          }
        }
      } catch (err) {
        // Fallback: use delta from start position
        if (dragStateRef.current.dragType === 'vertical') {
        const deltaX = (e.clientX - dragStateRef.current.startClientX);
        const newBendX = dragStateRef.current.startBendX + deltaX;
        setLocalBendX(newBendX);
        } else if (dragStateRef.current.dragType === 'horizontal') {
          const deltaY = (e.clientY - dragStateRef.current.startClientY);
          const newBendY = dragStateRef.current.startBendY + deltaY;
          setLocalBendY(newBendY);
        }
      }
    };

    const handleGlobalMouseUp = () => {
      if (!dragStateRef.current.isDragging) return;
      
      dragStateRef.current.isDragging = false;
      dragStateRef.current.dragType = null;
      setIsDragging(false);
      setDragType(null);
      
      const finalBend = currentBendRef.current;
      
      // Persist the new bend position
      if (data.onWaypointChange) {
        const newBendX = finalBend.x ?? storedBendX ?? (sourceX + targetX) / 2;
        const newBendY = finalBend.y ?? storedBendY;
        
        console.log(`📍 Persisting bend: x=${newBendX}, y=${newBendY} for edge ${id}`);
        setPendingBend({ x: newBendX, y: newBendY });
        data.onWaypointChange(id, [{ x: newBendX, y: newBendY }], newBendX, newBendY);
      }
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [sourceX, targetX, sourceY, targetY, storedBendX, storedBendY, data, id]);

  // Handle mouse move on edge to show appropriate cursor
  const handleEdgeMouseMove = useCallback((e) => {
    if (isDragging) return;
    
    const svg = e.target.closest('svg');
    if (!svg) return;
    
    try {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const svgP = pt.matrixTransform(ctm.inverse());
        const hitSegment = detectSegmentAtPoint(svgP.x, svgP.y, pathData.segments);
        
        if (hitSegment && hitSegment.segment.draggable) {
          setCursorStyle(hitSegment.type === 'vertical' ? 'ew-resize' : 'ns-resize');
        } else {
          setCursorStyle('pointer');
        }
      }
    } catch (err) {
      setCursorStyle('pointer');
    }
  }, [pathData.segments, isDragging]);

  // Handle drag start from anywhere on the edge
  const handleEdgeDragStart = useCallback((e) => {
    e.stopPropagation();
    e.preventDefault();
    
    const svg = e.target.closest('svg');
    if (!svg) return;
    
    try {
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      
      const svgP = pt.matrixTransform(ctm.inverse());
      const hitSegment = detectSegmentAtPoint(svgP.x, svgP.y, pathData.segments);
      
      if (!hitSegment) return;
      
      // Determine drag type based on segment type
      // Vertical segments move horizontally (change bendX)
      // Horizontal segments move vertically (change bendY)
      const newDragType = hitSegment.type === 'vertical' ? 'vertical' : 'horizontal';
      
      const initialBendY = effectiveBendY ?? (sourceY + targetY) / 2;
      
    dragStateRef.current = {
      isDragging: true,
        dragType: newDragType,
      startBendX: effectiveBendX,
        startBendY: initialBendY,
      startClientX: e.clientX,
        startClientY: e.clientY,
      svg: svg,
    };
    
    setIsDragging(true);
      setDragType(newDragType);
      
      if (newDragType === 'vertical') {
    setLocalBendX(effectiveBendX);
      } else {
        setLocalBendY(initialBendY);
      }
    } catch (err) {
      console.error('Error starting drag:', err);
    }
  }, [effectiveBendX, effectiveBendY, sourceY, targetY, pathData.segments]);

  // Edge styling
  const edgeStyle = {
    strokeWidth: selected ? 4 : 2,
    stroke: selected ? '#3b82f6' : (style.stroke || '#3b82f6'),
    fill: 'none',
    transition: isDragging ? 'none' : 'stroke-width 0.2s ease',
    ...style,
  };

  // Animated glow effect for selected edge
  const glowStyle = selected ? {
    strokeWidth: 12,
    stroke: '#3b82f6',
    fill: 'none',
    opacity: 0.3,
    filter: 'blur(4px)',
  } : null;

  // Hover zone - make it draggable
  const hoverStyle = {
    strokeWidth: HOVER_ZONE_SIZE,
    stroke: 'transparent',
    fill: 'none',
    cursor: cursorStyle,
  };

  // Render visual indicator for draggable segment
  const renderDragIndicator = () => {
    if (!isHovered && !selected && !isDragging) return null;
    
    const elements = [];
    
    if (pathData.mode === '4-bend' && effectiveBendY !== null) {
      // Show indicator on the middle horizontal segment
      const firstBendX = sourceX + HANDLE_OFFSET;
      const lastBendX = targetX - HANDLE_OFFSET;
      const midX = (firstBendX + lastBendX) / 2;
      
      elements.push(
        <g key="horizontal-indicator">
          <line
            x1={firstBendX + 20}
            y1={effectiveBendY}
            x2={lastBendX - 20}
            y2={effectiveBendY}
            stroke={dragType === 'horizontal' ? '#ff6b6b' : '#3b82f6'}
            strokeWidth={3}
            strokeDasharray="6,3"
            style={{ pointerEvents: 'none', opacity: 0.6 }}
          />
          <circle
            cx={midX}
            cy={effectiveBendY}
            r={CONTROL_POINT_SIZE}
            fill={dragType === 'horizontal' ? '#ff6b6b' : '#3b82f6'}
            stroke="#fff"
            strokeWidth={2}
            style={{ pointerEvents: 'none' }}
          />
          <text
            x={midX}
            y={effectiveBendY}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#fff"
            fontSize="10"
            fontWeight="bold"
            style={{ pointerEvents: 'none' }}
          >
            ↕
          </text>
        </g>
      );
    } else {
      // Show indicator on the vertical segment (2-bend mode)
      const midY = (sourceY + targetY) / 2;
      
      elements.push(
        <g key="vertical-indicator">
          <line
            x1={effectiveBendX}
            y1={Math.min(sourceY, targetY) + 10}
            x2={effectiveBendX}
            y2={Math.max(sourceY, targetY) - 10}
            stroke={dragType === 'vertical' ? '#ff6b6b' : '#3b82f6'}
            strokeWidth={3}
            strokeDasharray="6,3"
            style={{ pointerEvents: 'none', opacity: 0.6 }}
          />
          <circle
            cx={effectiveBendX}
            cy={midY}
            r={CONTROL_POINT_SIZE}
            fill={dragType === 'vertical' ? '#ff6b6b' : '#3b82f6'}
            stroke="#fff"
            strokeWidth={2}
            style={{ pointerEvents: 'none' }}
          />
          <text
            x={effectiveBendX}
            y={midY}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#fff"
            fontSize="10"
            fontWeight="bold"
            style={{ pointerEvents: 'none' }}
          >
            ↔
          </text>
        </g>
      );
    }
    
    return elements;
  };

  return (
    <>
      {/* Animated glow effect when selected */}
      {selected && (
        <path
          d={pathData.path}
          style={glowStyle}
          className="edge-glow-pulse"
        />
      )}
      
      {/* Invisible hover/drag zone - covers the entire edge */}
      <path
        d={pathData.path}
        style={hoverStyle}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => !isDragging && setIsHovered(false)}
        onMouseMove={handleEdgeMouseMove}
        onMouseDown={handleEdgeDragStart}
      />
      
      {/* Visible edge path - strictly orthogonal */}
      <path
        d={pathData.path}
        style={edgeStyle}
        markerEnd={markerEnd}
        className="react-flow__edge-path"
      />

      {/* Visual drag indicators */}
      {renderDragIndicator()}

      {/* Edge label */}
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelPosition.x}px, ${labelPosition.y}px)`,
              pointerEvents: 'all',
              ...labelStyle,
            }}
            className="nodrag nopan"
          >
            <div
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 'bold',
                backgroundColor: labelBgStyle?.fill || '#fff',
                border: `1px solid ${labelBgStyle?.stroke || '#333'}`,
                ...labelBgStyle,
              }}
            >
              {label}
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default EditableEdge;
