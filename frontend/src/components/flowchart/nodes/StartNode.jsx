import React from 'react';
import { Handle, Position } from '@xyflow/react';

const StartNode = ({ data }) => (
  <div className="rf-node start-node">
    <strong>{data?.label || 'Start'}</strong>
    <Handle type="source" position={Position.Right} />
  </div>
);

export default StartNode;
