import React from 'react';
import { Handle, Position } from '@xyflow/react';

const EndNode = ({ data }) => (
  <div className="rf-node end-node">
    <Handle type="target" position={Position.Left} />
    <strong>{data?.label || 'End'}</strong>
  </div>
);

export default EndNode;
