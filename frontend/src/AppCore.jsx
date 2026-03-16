import React, { useEffect, useState } from 'react';
import EnhancedProcessSelector from './components/EnhancedProcessSelector';
import UnifiedWorkflowCanvas from './components/UnifiedWorkflowCanvas';
import ProcessTaxonomy from './components/ProcessTaxonomy';
import ChatPanel from './components/ChatPanel';
import LoginPage from './components/LoginPage';
import { useAuth } from './context/AuthContext';

function AppCore() {
  const { isAuthenticated, user, logout } = useAuth();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [currentView, setCurrentView] = useState('taxonomy');
  const [selectedProcessForWorkflow, setSelectedProcessForWorkflow] = useState(null);
  const [showL3ProcessSelector, setShowL3ProcessSelector] = useState(false);
  const [showLeaveWarning, setShowLeaveWarning] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState(null);
  const [showLogoutWarning, setShowLogoutWarning] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState(null);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(''), 2000);
    return () => clearTimeout(timer);
  }, [success]);

  if (!isAuthenticated) return <LoginPage />;

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const shouldShowLeaveWarning = () => {
    if (!selectedProcessForWorkflow) return false;
    if (lastSavedTime && (Date.now() - lastSavedTime) < 30000) return false;
    return true;
  };

  const handleFlowSaved = (message) => {
    setLastSavedTime(Date.now());
    setSuccess(message);
  };

  const handleNavigateToWorkflow = (processId, processName, flow = null) => {
    setSelectedProcessForWorkflow({ id: processId, name: processName, flow });
    setCurrentView('workflow');
  };

  const handleSelectL3Process = (process) => {
    setSelectedProcessForWorkflow({ id: process.id, name: process.name });
    setShowL3ProcessSelector(false);
  };

  const handleError = (message) => {
    setError(message);
    setSuccess('');
  };

  return (
    <div className="app">
      <div className={`app-content app-content-with-sidebar ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className={`app-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <nav className="sidebar-nav">
            <button
              className={`sidebar-nav-item ${currentView === 'taxonomy' ? 'active' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (currentView === 'workflow' && shouldShowLeaveWarning()) {
                  setPendingNavigation('taxonomy');
                  setShowLeaveWarning(true);
                } else {
                  setCurrentView('taxonomy');
                }
              }}
              title="Overview"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="7"/>
                <rect x="3" y="14" width="7" height="7"/>
                <rect x="14" y="14" width="7" height="7"/>
              </svg>
              <span className="sidebar-label">Overview</span>
            </button>
            <button
              className={`sidebar-nav-item ${currentView === 'workflow' ? 'active' : ''}`}
              onClick={() => setCurrentView('workflow')}
              title="Design"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              <span className="sidebar-label">Design</span>
            </button>
          </nav>
          <div className="sidebar-footer">
            {!sidebarCollapsed && (
              <div className="sidebar-nav-item sidebar-settings" title="Settings">
                <span style={{ fontSize: 12 }}>{user?.email || user?.username || 'User'}</span>
              </div>
            )}
            <button className="sidebar-nav-item sidebar-logout-btn" onClick={() => setShowLogoutWarning(true)} title="Logout">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              <span className="sidebar-label">Logout</span>
            </button>
            <button className="sidebar-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
              {sidebarCollapsed ? '>' : '<'}
            </button>
          </div>
        </aside>

        <div className="main-content-area">
          <div className="main-content">
            {currentView === 'taxonomy' && <ProcessTaxonomy onNavigateToWorkflow={handleNavigateToWorkflow} />}
            {currentView === 'workflow' && (
              <>
                {selectedProcessForWorkflow ? (
                  <UnifiedWorkflowCanvas
                    key={selectedProcessForWorkflow.id}
                    selectedProcess={selectedProcessForWorkflow}
                    onChangeProcess={() => setShowL3ProcessSelector(true)}
                    onError={handleError}
                    onSuccess={(msg) => {
                      if (msg && (msg.includes('saved') || msg.includes('updated'))) {
                        handleFlowSaved(msg);
                      } else {
                        setSuccess(msg);
                      }
                    }}
                  />
                ) : (
                  <div className="workflow-empty-state">
                    <div className="empty-state-content">
                      <h2>Design your process flow</h2>
                      <p>Select a process to start designing your process</p>
                      <button className="btn btn-primary btn-large" onClick={() => setShowL3ProcessSelector(true)}>
                        Select Process
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
            <EnhancedProcessSelector
              isOpen={showL3ProcessSelector}
              onClose={() => setShowL3ProcessSelector(false)}
              onSelectProcess={handleSelectL3Process}
            />
          </div>
          {error && <div className="error" onClick={clearMessages}><strong>Error:</strong> {error}</div>}
          {success && <div className="success" onClick={clearMessages}><strong>Success:</strong> {success}</div>}
          <ChatPanel />
        </div>

        {showLeaveWarning && (
          <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={() => setShowLeaveWarning(false)}>
            <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header"><h3>Leave Design View?</h3></div>
              <div className="modal-body"><p>You might have unsaved changes. Are you sure you want to leave the Design view?</p></div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => { setShowLeaveWarning(false); setPendingNavigation(null); }}>Cancel</button>
                <button className="btn btn-primary" onClick={() => { setShowLeaveWarning(false); if (pendingNavigation) { setCurrentView(pendingNavigation); setPendingNavigation(null); } }}>Leave</button>
              </div>
            </div>
          </div>
        )}

        {showLogoutWarning && (
          <div className="modal-overlay" style={{ zIndex: 10001 }} onClick={() => setShowLogoutWarning(false)}>
            <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header"><h3>Log out?</h3></div>
              <div className="modal-body"><p>Are you sure you want to log out? Any unsaved changes will be lost.</p></div>
              <div className="modal-actions">
                <button className="btn btn-secondary" onClick={() => setShowLogoutWarning(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={() => { setShowLogoutWarning(false); logout(); }}>Log out</button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default AppCore;
