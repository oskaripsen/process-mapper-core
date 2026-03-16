import React from 'react';
import { Handle, Position } from '@xyflow/react';

const DefaultNode = ({ data }) => (
  <div className="rf-node default-node">
    <Handle type="target" position={Position.Left} />
    <div>{data?.label || 'Step'}</div>
    <Handle type="source" position={Position.Right} />
  </div>
);

export default DefaultNode;
