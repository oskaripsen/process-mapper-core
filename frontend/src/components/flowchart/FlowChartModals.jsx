import React from 'react';

const FlowChartModals = ({ errorMessage, onCloseError }) => (
  <>
    {errorMessage ? (
      <div className="modal-overlay" onClick={onCloseError}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>Error</h3>
          <p>{errorMessage}</p>
          <button className="btn btn-primary" onClick={onCloseError}>Close</button>
        </div>
      </div>
    ) : null}
  </>
);

export default FlowChartModals;
