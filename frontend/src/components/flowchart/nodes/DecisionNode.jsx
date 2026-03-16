import React from 'react';
import { Handle, Position } from '@xyflow/react';

const DecisionNode = ({ data }) => (
  <div className="rf-node decision-node">
    <Handle type="target" position={Position.Left} />
    <div>{data?.label || 'Decision'}</div>
    <Handle id="yes" type="source" position={Position.Right} />
    <Handle id="no" type="source" position={Position.Bottom} />
  </div>
);

export default DecisionNode;
