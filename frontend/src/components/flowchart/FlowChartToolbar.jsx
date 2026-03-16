import React from 'react';

const FlowChartToolbar = ({ onAddStep, onAddDecision, onAddStart, onAddEnd, onSave, onExport }) => (
  <div className="controls" style={{ marginBottom: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
    <button className="btn btn-secondary" onClick={onAddStart}>Add Start</button>
    <button className="btn btn-secondary" onClick={onAddStep}>Add Step</button>
    <button className="btn btn-secondary" onClick={onAddDecision}>Add Decision</button>
    <button className="btn btn-secondary" onClick={onAddEnd}>Add End</button>
    <button className="btn btn-primary" onClick={onSave}>Save</button>
    <button className="btn btn-secondary" onClick={onExport}>Export JSON</button>
  </div>
);

export default FlowChartToolbar;
