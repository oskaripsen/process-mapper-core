import React from 'react';
import { Handle, Position } from '@xyflow/react';

const MergeNode = ({ data }) => (
  <div className="rf-node merge-node">
    <Handle type="target" position={Position.Left} />
    <div>{data?.label || 'Merge'}</div>
    <Handle type="source" position={Position.Right} />
  </div>
);

export default MergeNode;
