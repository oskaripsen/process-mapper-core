import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import ProcessFlowViewer from './ProcessFlowViewer';
import ExportModal from './ExportModal';
import { API_BASE_URL, authenticatedFetch } from '../config/api';

const ProcessTaxonomy = ({ onNavigateToWorkflow }) => {
  const { user, getToken } = useAuth();
  const [taxonomy, setTaxonomy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showAssignmentForm, setShowAssignmentForm] = useState(null);
  const [expandedItems, setExpandedItems] = useState(new Set());
  const [dashboardData, setDashboardData] = useState(null);
  const [showFilter, setShowFilter] = useState(false);
  const [completionFilter, setCompletionFilter] = useState('all'); // 'all', 'completed', 'not_completed'
  const [selectedProcess, setSelectedProcess] = useState(null); // For showing flows
  const [l3ProcessPopup, setL3ProcessPopup] = useState(null); // For L3 process popup
  const [l3Processes, setL3Processes] = useState([]); // All L3 processes for current L2
  const [currentL3Index, setCurrentL3Index] = useState(0); // Current L3 process index
  const [showMoreActions, setShowMoreActions] = useState(null); // For three dots menu
  const [menuPosition, setMenuPosition] = useState('down'); // Track menu position
  const [expandedDescription, setExpandedDescription] = useState(false); // For expandable description
  const [reorderParentId, setReorderParentId] = useState(null); // Parent whose direct children are being reordered
  const [reorderSnapshot, setReorderSnapshot] = useState(null); // Taxonomy snapshot for cancel
  const [showMoveModal, setShowMoveModal] = useState(null); // For move modal
  const [selectedNewParent, setSelectedNewParent] = useState(null); // For move target
  const [showExportModal, setShowExportModal] = useState(false); // For export modal
  const [newItem, setNewItem] = useState({
    name: '',
    description: '',
    code: '',
    level: 0,
    parent_id: null
  });
  const [assignment, setAssignment] = useState({
    user_email: '',
    role: 'delegatee'
  });
  const [showError, setShowError] = useState(false);
  const [currentAssignments, setCurrentAssignments] = useState([]);
  const [loadingAssignments, setLoadingAssignments] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // {assignmentId, userEmail}
  const [currentUserRole, setCurrentUserRole] = useState(null); // Current user's role for this process
  const [confirmSelfDowngrade, setConfirmSelfDowngrade] = useState(null); // {assignmentId, currentRole, newRole}
  const [showSOPExportModal, setShowSOPExportModal] = useState(false);
  const [selectedL0ForSOP, setSelectedL0ForSOP] = useState(new Set());
  const [exportingSOPs, setExportingSOPs] = useState(false);


  useEffect(() => {
    loadTaxonomy();
    loadDashboardData();
  }, []);

  // Load assignments when assignment form is opened
  useEffect(() => {
    if (showAssignmentForm) {
      loadProcessAssignments(showAssignmentForm);
    } else {
      setCurrentAssignments([]);
      setConfirmDelete(null);
    }
  }, [showAssignmentForm]);

  // Function to determine menu position
  const handleMoreActionsClick = (itemId, event) => {
    if (showMoreActions === itemId) {
      setShowMoreActions(null);
      return;
    }

    // Check if there's enough space below the button
    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - rect.bottom;
    const menuHeight = 100; // Approximate menu height

    // If not enough space below, open upward
    if (spaceBelow < menuHeight) {
      setMenuPosition('up');
    } else {
      setMenuPosition('down');
    }

    setShowMoreActions(itemId);
  };

  // Close more actions menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showMoreActions && !event.target.closest('.more-actions')) {
        setShowMoreActions(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMoreActions]);

  // Populate form when editing
  useEffect(() => {
    if (editingItem) {
      setNewItem({
        name: editingItem.name,
        description: editingItem.description || '',
        code: editingItem.code || '',
        level: editingItem.level,
        parent_id: editingItem.parent_id
      });
      setShowAddForm(true);
    }
  }, [editingItem]);

  const loadTaxonomy = async () => {
    try {
      setLoading(true);
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-taxonomy`,
        { method: 'GET' },
        getToken
      );
      if (!response.ok) throw new Error('Failed to load taxonomy');
      const data = await response.json();
      setTaxonomy(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDashboardData = async () => {
    try {
      if (!user?.id) {
        console.log('User not loaded yet, skipping dashboard data load');
        return;
      }
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/dashboard/${user.id}`,
        { method: 'GET' },
        getToken
      );
      if (!response.ok) throw new Error('Failed to load dashboard data');
      const data = await response.json();
      setDashboardData(data);
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    }
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    try {
      const isEditing = editingItem !== null;
      const url = isEditing 
        ? `${API_BASE_URL}/api/process-taxonomy/${editingItem.id}`
        : `${API_BASE_URL}/api/process-taxonomy`;
      
      const response = await authenticatedFetch(
        url,
        {
          method: isEditing ? 'PUT' : 'POST',
          body: newItem
        },
        getToken
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || `Failed to ${isEditing ? 'update' : 'create'} item`);
      }
      
      await loadTaxonomy();
      setNewItem({ name: '', description: '', code: '', level: 0, parent_id: null });
      setShowAddForm(false);
      setEditingItem(null);
      setError('');
      setShowError(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteItem = async (item) => {
    if (!item.can_delete) {
      setError('You do not have permission to delete this process.');
      setShowError(true);
      setTimeout(() => setShowError(false), 5000);
      return;
    }

    const hasChildren = item.children && item.children.length > 0;
    const warningMessage = hasChildren
      ? `Are you sure you want to delete "${item.name}" and all its sub-processes? This will delete it for you and everyone else with access. This action cannot be undone.`
      : `Are you sure you want to delete "${item.name}"? This will delete it for you and everyone else with access. This action cannot be undone.`;

    if (!window.confirm(warningMessage)) {
      return;
    }
    
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-taxonomy/${item.id}`,
        { method: 'DELETE' },
        getToken
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to delete item');
      }
      
      await loadTaxonomy();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDuplicateItem = async (item) => {
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-taxonomy/${item.id}/duplicate`,
        { method: 'POST' },
        getToken
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to duplicate item');
      }
      
      await loadTaxonomy();
    } catch (err) {
      setError(err.message);
    }
  };

  const showReorderError = (message) => {
    setError(message);
    setShowError(true);
    setTimeout(() => {
      setShowError(false);
      setTimeout(() => setError(''), 300);
    }, 3000);
  };

  const getSiblingsByParentId = (items, parentId) => {
    if (parentId === null) {
      return items;
    }
    for (const item of items) {
      if (item.id === parentId) {
        return item.children || [];
      }
      if (item.children && item.children.length > 0) {
        const found = getSiblingsByParentId(item.children, parentId);
        if (found !== null) return found;
      }
    }
    return null;
  };

  const reorderArray = (arr, fromIndex, toIndex) => {
    const next = [...arr];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next.map((item, index) => ({ ...item, sort_order: index }));
  };

  const reorderTreeByParent = (items, parentId, fromIndex, toIndex) => {
    if (parentId === null) {
      return reorderArray(items, fromIndex, toIndex);
    }
    return items.map(item => {
      if (item.id === parentId) {
        return {
          ...item,
          children: reorderArray(item.children || [], fromIndex, toIndex)
        };
      }
      if (item.children && item.children.length > 0) {
        return {
          ...item,
          children: reorderTreeByParent(item.children, parentId, fromIndex, toIndex)
        };
      }
      return item;
    });
  };

  const handleStartReorder = (item) => {
    const children = item.children || [];
    if (children.length < 2) {
      showReorderError('This process needs at least two sub-processes to reorder.');
      return;
    }
    const expanded = new Set(expandedItems);
    expanded.add(item.id);
    setExpandedItems(expanded);
    setReorderSnapshot(JSON.parse(JSON.stringify(taxonomy)));
    setReorderParentId(item.id);
    setShowMoreActions(null);
  };

  const moveChildInReorderMode = (parentId, childId, direction) => {
    const siblings = getSiblingsByParentId(taxonomy, parentId);
    if (!siblings || siblings.length < 2) return;
    const currentIndex = siblings.findIndex(item => item.id === childId);
    if (currentIndex < 0) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;
    const nextTree = reorderTreeByParent(taxonomy, parentId, currentIndex, targetIndex);
    setTaxonomy(nextTree);
  };

  const handleCancelReorder = () => {
    if (reorderSnapshot) {
      setTaxonomy(reorderSnapshot);
    }
    setReorderParentId(null);
    setReorderSnapshot(null);
  };

  const persistSiblingOrder = async (siblings) => {
    const payload = {
      items: siblings.map((item, index) => ({
        id: item.id,
        sort_order: index
      }))
    };
    const response = await authenticatedFetch(
      `${API_BASE_URL}/api/process-taxonomy/reorder`,
      {
        method: 'POST',
        body: payload
      },
      getToken
    );
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.detail || 'Failed to reorder items');
    }
  };

  const handleSaveReorder = async () => {
    if (!reorderParentId) return;
    try {
      const siblings = getSiblingsByParentId(taxonomy, reorderParentId) || [];
      await persistSiblingOrder(siblings);
      setReorderParentId(null);
      setReorderSnapshot(null);
      await loadTaxonomy();
    } catch (err) {
      showReorderError(err.message);
    }
  };

  const performMove = async (itemId, newParentId, sortOrder = null) => {
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-taxonomy/${itemId}/move`,
        {
          method: 'POST',
          body: {
            parent_id: newParentId,
            sort_order: sortOrder
          }
        },
        getToken
      );
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to move item');
      }
      
      await loadTaxonomy();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMoveClick = (item) => {
    setShowMoveModal(item);
    setSelectedNewParent(null);
  };

  const handleMoveConfirm = async () => {
    if (!showMoveModal || !selectedNewParent) {
      setError('Please select a new parent');
      setShowError(true);
      setTimeout(() => {
        setShowError(false);
        setTimeout(() => setError(''), 300);
      }, 3000);
      return;
    }

    await performMove(showMoveModal.id, selectedNewParent);
    setShowMoveModal(null);
    setSelectedNewParent(null);
  };

  const getValidMoveTargets = (item) => {
    // Returns list of valid parent options for moving this item
    const validTargets = [];
    
    // Helper to check if item has L3 children
    const hasL3Children = (node) => {
      if (node.level === 3) return true;
      if (!node.children) return false;
      return node.children.some(child => hasL3Children(child));
    };
    
    const itemHasL3Children = hasL3Children(item);
    
    // Helper to collect valid targets
    const collectTargets = (nodes, depth = 0) => {
      nodes.forEach(node => {
        // Skip self and descendants
        if (node.id === item.id) return;
        
        const isDescendant = (parent, potentialChild) => {
          if (!parent.children) return false;
          for (const child of parent.children) {
            if (child.id === potentialChild.id) return true;
            if (isDescendant(child, potentialChild)) return true;
          }
          return false;
        };
        
        if (isDescendant(item, node)) return;
        
        // Validation: prevent moving L2 with L3 children to become L3
        // Validation: prevent moving L1 with L3 children to become L2 or L3
        if (itemHasL3Children) {
          // If item has L3 children, it can only be moved to positions where it stays at same level or higher
          // L2 with L3 children cannot move down to L3
          if (item.level === 2 && node.level === 2) {
            // Can't move L2 under another L2 (would become L3)
            return;
          }
          // L1 with L3 children cannot move down to L2 or L3
          if (item.level === 1 && node.level >= 1) {
            // Can't move L1 under L1, L2, or L3 (would become L2 or L3)
            return;
          }
          // L0 with L3 children cannot move under anything (would change level)
          if (item.level === 0 && node.level >= 0) {
            return;
          }
        }
        
        // Normal validation: max level is 3, so can't add children to L3
        if (node.level >= 3) return;
        
        validTargets.push({
          ...node,
          indent: depth
        });
        
        if (node.children && node.children.length > 0) {
          collectTargets(node.children, depth + 1);
        }
      });
    };
    
    collectTargets(taxonomy);
    return validTargets;
  };

  const loadProcessAssignments = async (processId) => {
    setLoadingAssignments(true);
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-assignments/process/${processId}`,
        { method: 'GET' },
        getToken
      );
      if (!response.ok) throw new Error('Failed to load assignments');
      const data = await response.json();
      console.log('Loaded assignments:', data);
      setCurrentAssignments(data);
      
      // Determine current user's role for this process
      const userEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress;
      const userAssignment = data.find(a => a.user_email === userEmail || a.user_id === user?.id);
      
      // Also check if user is the creator of the process
      const process = taxonomy.find(p => p.id === processId) || findProcessById(taxonomy, processId);
      const isCreator = process?.created_by === user?.id;
      
      // If creator, treat as owner; otherwise use assigned role
      const role = isCreator ? 'owner' : (userAssignment?.role || null);
      setCurrentUserRole(role);
      console.log('Current user role:', role, 'isCreator:', isCreator);
    } catch (err) {
      setError(err.message);
      setCurrentAssignments([]);
      setCurrentUserRole(null);
    } finally {
      setLoadingAssignments(false);
    }
  };
  
  const findProcessById = (items, targetId) => {
    for (const item of items) {
      if (item.id === targetId) return item;
      if (item.children) {
        const found = findProcessById(item.children, targetId);
        if (found) return found;
      }
    }
    return null;
  };

  const isCurrentUser = (assignmentEmail, assignmentUserId) => {
    const userEmail = user?.primaryEmailAddress?.emailAddress || user?.emailAddresses?.[0]?.emailAddress;
    return assignmentEmail === userEmail || assignmentUserId === user?.id;
  };

  const countOwners = () => {
    return currentAssignments.filter(a => a.role === 'owner').length;
  };

  const isLastOwner = (assign) => {
    return assign.role === 'owner' && countOwners() === 1;
  };

  const handleRoleChange = async (assign, newRole) => {
    if (newRole === 'owner' && currentUserRole !== 'owner') {
      setError('Only owners can assign owner access.');
      setShowError(true);
      setTimeout(() => setShowError(false), 5000);
      return;
    }

    // Check if trying to change last owner
    if (isLastOwner(assign)) {
      setError('Cannot change the role of the last owner. Transfer ownership to another user first.');
      setShowError(true);
      setTimeout(() => setShowError(false), 5000);
      return;
    }

    // Check if user is downgrading themselves
    const isSelf = isCurrentUser(assign.user_email, assign.user_id);
    const isDowngrade = (assign.role === 'owner' && newRole !== 'owner') || 
                       (assign.role === 'delegator' && newRole === 'delegatee');
    
    if (isSelf && isDowngrade) {
      // Show confirmation dialog for self-downgrade
      setConfirmSelfDowngrade({
        assignmentId: assign.id,
        userEmail: assign.user_email,
        currentRole: assign.role,
        newRole: newRole
      });
      return;
    }

    // Proceed with role change
    await performRoleChange(assign.id, assign.user_email, newRole);
  };

  const performRoleChange = async (assignmentId, userEmail, newRole) => {
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-assignments`,
        {
          method: 'POST',
          body: {
            process_id: showAssignmentForm,
            user_email: userEmail,
            role: newRole
          }
        },
        getToken
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to update role');
      }
      // Reload assignments
      await loadProcessAssignments(showAssignmentForm);
    } catch (err) {
      setError(err.message || 'Failed to update role');
      setShowError(true);
      setTimeout(() => setShowError(false), 5000);
    }
  };

  const handleAssignUser = async (e) => {
    e.preventDefault();
    try {
      if (assignment.role === 'owner' && currentUserRole !== 'owner') {
        throw new Error('Only owners can assign owner access.');
      }

      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-assignments`,
        {
          method: 'POST',
          body: {
            process_id: showAssignmentForm,
            ...assignment
          }
        },
        getToken
      );
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to assign user');
      }
      setAssignment({ user_email: '', role: 'delegatee' });
      // Reload assignments to show the new one
      await loadProcessAssignments(showAssignmentForm);
      // Show success message
      setError('');
    } catch (err) {
      setError(err.message);
      setShowError(true);
    }
  };

  const handleDeleteAssignment = async () => {
    if (!confirmDelete) return;
    
    // Find the assignment being deleted
    const assignToDelete = currentAssignments.find(a => a.id === confirmDelete.assignmentId);
    
    // Check if trying to delete last owner
    if (assignToDelete && isLastOwner(assignToDelete)) {
      setError('Cannot remove the last owner. Transfer ownership to another user first.');
      setShowError(true);
      setTimeout(() => setShowError(false), 5000);
      setConfirmDelete(null);
      return;
    }
    
    try {
      const response = await authenticatedFetch(
        `${API_BASE_URL}/api/process-assignments/${confirmDelete.assignmentId}`,
        { method: 'DELETE' },
        getToken
      );
      if (!response.ok) throw new Error('Failed to remove assignment');
      
      // Reload assignments
      await loadProcessAssignments(showAssignmentForm);
      setConfirmDelete(null);
    } catch (err) {
      setError(err.message);
      setShowError(true);
      setTimeout(() => setShowError(false), 5000);
      setConfirmDelete(null);
    }
  };



  const toggleExpanded = (itemId) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  const getFilteredTaxonomy = () => {
    if (completionFilter === 'all') return taxonomy;

    const hasCompletedDescendantL3 = (item) => {
      if (item.level === 3) {
        return isL3ProcessCompleted(item.id);
      }
      return (item.children || []).some(child => hasCompletedDescendantL3(child));
    };

    const hasIncompleteDescendantOrSelf = (item) => {
      if (!isProcessCompleted(item)) {
        return true;
      }
      return (item.children || []).some(child => hasIncompleteDescendantOrSelf(child));
    };

    const filterRecursively = (items) => {
      return items
        .map(item => {
          const filteredChildren = item.children && item.children.length > 0
            ? filterRecursively(item.children)
            : [];

          return {
            ...item,
            children: filteredChildren
          };
        })
        .filter(item => {
          if (completionFilter === 'completed') {
            if (item.level === 3) {
              return isL3ProcessCompleted(item.id);
            }
            // Keep parent levels only as context for completed L3 descendants.
            return hasCompletedDescendantL3(item);
          }

          if (completionFilter === 'not_completed') {
            // Keep any node that is not fully completed, including trees with no L3 yet.
            return hasIncompleteDescendantOrSelf(item);
          }

          return true;
        });
    };

    return filterRecursively(taxonomy);
  };

  const handleProcessClick = (item) => {
    if (item.level === 3) {
      // Find all L3 processes under the same L2 parent
      const l2Parent = findL2Parent(item);
      const allL3Processes = l2Parent ? getAllL3Processes(l2Parent) : [item];
      setL3Processes(allL3Processes);
      setCurrentL3Index(allL3Processes.findIndex(p => p.id === item.id));
      setL3ProcessPopup(item);
      setExpandedDescription(false);
    }
  };

  const findL2Parent = (l3Process) => {
    const findParent = (items, targetId) => {
      for (const item of items) {
        if (item.id === targetId) return item;
        if (item.children) {
          const found = findParent(item.children, targetId);
          if (found) return found;
        }
      }
      return null;
    };
    
    // Find the L2 parent by looking for the item with level 2 that contains this L3
    const findL2 = (items) => {
      for (const item of items) {
        if (item.level === 2 && item.children) {
          const hasL3 = item.children.some(child => child.id === l3Process.id || 
            (child.children && findL2(child.children)));
          if (hasL3) return item;
        }
        if (item.children) {
          const found = findL2(item.children);
          if (found) return found;
        }
      }
      return null;
    };
    
    return findL2(taxonomy);
  };

  const getAllL3Processes = (l2Process) => {
    const l3Processes = [];
    const collectL3 = (items) => {
      for (const item of items) {
        if (item.level === 3) {
          l3Processes.push(item);
        }
        if (item.children) {
          collectL3(item.children);
        }
      }
    };
    
    if (l2Process.children) {
      collectL3(l2Process.children);
    }
    return l3Processes;
  };

  const navigateL3Process = (direction) => {
    if (direction === 'prev' && currentL3Index > 0) {
      setCurrentL3Index(currentL3Index - 1);
    } else if (direction === 'next' && currentL3Index < l3Processes.length - 1) {
      setCurrentL3Index(currentL3Index + 1);
    }
  };

  const closeL3ProcessPopup = () => {
    setL3ProcessPopup(null);
    setL3Processes([]);
    setCurrentL3Index(0);
    setExpandedDescription(false);
  };

  const getAssignedUserInitials = (item) => {
    // Mock data - in real app, this would come from the item data
    if (item.assigned_user) {
      const name = item.assigned_user.name || item.assigned_user.email;
      return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return null;
  };

  // Check if an L3 process is completed (has start and end nodes)
  const isL3ProcessCompleted = (processId) => {
    // Use backend-calculated completion status which considers all flows (including assigned ones)
    // and checks for start/end nodes
    return dashboardData?.completed_process_ids?.includes(processId) || false;
  };

  // Check if all children of a process are completed (recursive)
  const areAllChildrenCompleted = (item) => {
    if (!item.children || item.children.length === 0) {
      return false;
    }

    // Check all children recursively
    return item.children.every(child => {
      if (child.level === 3) {
        return isL3ProcessCompleted(child.id);
      }
      return areAllChildrenCompleted(child);
    });
  };

  // Check if a process should show completion indicator (true = show checkmark, false = show nothing)
  const isProcessCompleted = (item) => {
    if (item.level === 3) {
      return isL3ProcessCompleted(item.id);
    }
    // For parent levels, check if all children are completed
    return areAllChildrenCompleted(item);
  };

  const renderTaxonomyList = (items, level = 0, parentId = null) => (
    <>
      {items.map((item, index) => (
        <React.Fragment key={item.id}>
          {renderTaxonomyItem(item, level, parentId, index, items.length)}
        </React.Fragment>
      ))}
    </>
  );

  const renderTaxonomyItem = (item, level = 0, parentId = null, index = 0, siblingCount = 1) => {
    const hasChildren = item.children && item.children.length > 0;
    const isExpanded = expandedItems.has(item.id);
    const isL3Process = item.level === 3;
    const childCount = item.children ? item.children.length : 0;
    const assignedUserInitials = getAssignedUserInitials(item);
    const isCompleted = isProcessCompleted(item);
    const showReorderControls = reorderParentId && parentId === reorderParentId;
    
    return (
      <div 
        key={item.id} 
        className="taxonomy-item"
      >
        <div className="taxonomy-item-header">
          <div className="taxonomy-item-info">
            <div className="taxonomy-indent" style={{ width: `${level * 24}px` }}></div>
            {hasChildren ? (
              <button 
                className="expand-toggle"
                onClick={() => toggleExpanded(item.id)}
                title={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            ) : (
              <span className="expand-spacer"></span>
            )}
            <span className="level-badge">L{item.level}</span>
            {isCompleted && (
              <span className="completion-badge" title={item.level === 3 ? "Process flow completed (has start and end nodes)" : "All child processes completed"}>
                ✓
              </span>
            )}
            <div className="taxonomy-item-content">
              <div className="taxonomy-item-title-row">
            <h4 
              className={isL3Process ? 'clickable-process' : ''}
              onClick={isL3Process ? () => handleProcessClick(item) : undefined}
              title={isL3Process ? 'Click to view process flows' : ''}
            >
              {item.name}
            </h4>
            {item.code && <span className="code-badge">{item.code}</span>}
                {hasChildren && <span className="child-count">{childCount} {childCount === 1 ? 'child' : 'children'}</span>}
              </div>
              {item.description && (
                <p className="taxonomy-item-description">{item.description}</p>
              )}
            </div>
          </div>
          <div className="taxonomy-item-actions">
            {item.level < 3 ? (
            <button 
              className="btn btn-sm btn-success"
              onClick={() => {
                setNewItem({ ...newItem, level: item.level + 1, parent_id: item.id });
                setShowAddForm(true);
              }}
              title="Add a sub-process"
            >
              Add Sub-Process
            </button>
            ) : (
            <button 
              className="btn btn-sm btn-primary"
              onClick={() => handleProcessClick(item)}
              title="Edit process flow"
            >
              Edit process flow
            </button>
            )}
            <button 
              className="btn btn-sm btn-outline"
              onClick={() => setShowAssignmentForm(item.id)}
              title="Assign users to this process"
            >
              Assign
            </button>
            {showReorderControls && (
              <div className="reorder-arrows">
                <button
                  className="reorder-arrow-btn"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => moveChildInReorderMode(parentId, item.id, 'up')}
                >
                  ↑
                </button>
                <button
                  className="reorder-arrow-btn"
                  title="Move down"
                  disabled={index === siblingCount - 1}
                  onClick={() => moveChildInReorderMode(parentId, item.id, 'down')}
                >
                  ↓
                </button>
              </div>
            )}
            {assignedUserInitials && (
              <div className="assigned-user">
                <div className="user-initials">{assignedUserInitials}</div>
              </div>
            )}
            <div className="more-actions">
              <button 
                className="more-actions-btn"
                onClick={(e) => handleMoreActionsClick(item.id, e)}
                title="More actions"
              >
                ⋯
              </button>
              {showMoreActions === item.id && (
                <div className={`more-actions-menu ${menuPosition === 'up' ? 'upward' : ''}`}>
                  <button onClick={() => {
                    setEditingItem(item);
                    setShowMoreActions(null);
                  }}>
                    Edit
                  </button>
                  <button onClick={() => {
                    handleMoveClick(item);
                    setShowMoreActions(null);
                  }}>
                    Move
                  </button>
                  <button onClick={() => handleStartReorder(item)}>
                    Reorder sub-processes
                  </button>
                  <button onClick={() => {
                    handleDuplicateItem(item);
                    setShowMoreActions(null);
                  }}>
                    Duplicate
                  </button>
                  <button 
                    className="danger"
                    disabled={!item.can_delete}
                    title={item.can_delete ? 'Delete' : 'You do not have permission to delete this process'}
                    style={{ opacity: item.can_delete ? 1 : 0.5, cursor: item.can_delete ? 'pointer' : 'not-allowed' }}
                    onClick={() => {
                      if (!item.can_delete) return;
                      handleDeleteItem(item);
                      setShowMoreActions(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {hasChildren && isExpanded && (
          <div className="taxonomy-children">
            {renderTaxonomyList(item.children, level + 1, item.id)}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="process-taxonomy">
        <div className="loading">Loading process taxonomy...</div>
      </div>
    );
  }

  const filteredTaxonomy = getFilteredTaxonomy();

  // Helper to count total L3 processes in the filtered taxonomy
  const countL3Processes = (items) => {
    let count = 0;
    const traverse = (nodes) => {
      if (!nodes) return;
      for (const node of nodes) {
        if (node.level === 3) {
          count++;
        }
        if (node.children && node.children.length > 0) {
          traverse(node.children);
        }
      }
    };
    traverse(items);
    return count;
  };

  const renderL3ProcessPopup = () => {
    if (!l3ProcessPopup || l3Processes.length === 0) return null;
    
    const currentProcess = l3Processes[currentL3Index];
    
    return (
      <div className="l3-process-popup" onClick={(e) => e.target === e.currentTarget && closeL3ProcessPopup()}>
        <div className="l3-process-popup-content">
          <div className="l3-process-header">
            <div className="l3-process-title-section">
              <h2>{currentProcess.name}</h2>
              <div className="l3-process-id">ID: {currentProcess.id}</div>
            </div>
            <div className="l3-process-nav">
              <button 
                onClick={() => navigateL3Process('prev')}
                disabled={currentL3Index === 0}
                title="Previous process"
              >
                ←
              </button>
              <span>{currentL3Index + 1} of {l3Processes.length}</span>
              <button 
                onClick={() => navigateL3Process('next')}
                disabled={currentL3Index === l3Processes.length - 1}
                title="Next process"
              >
                →
              </button>
              <button 
                className="l3-process-close"
                onClick={closeL3ProcessPopup}
                title="Close"
              >
                ×
              </button>
            </div>
          </div>
          
          <div className="l3-process-body">
            <div className="l3-process-meta">
              <div className="l3-process-meta-item">
                <div className="l3-process-meta-label">Last Updated</div>
                <div className="l3-process-meta-value">
                  {currentProcess.updated_at ? new Date(currentProcess.updated_at).toLocaleDateString() : 'Never'}
                </div>
              </div>
            </div>
            
            <div className="l3-process-description">
              <h3>Description</h3>
              <div className="l3-process-description-content">
                {currentProcess.description || 'No description provided.'}
              </div>
            </div>
            
            <div className="l3-process-actions">
              <button 
                className="btn btn-primary"
                onClick={() => {
                  closeL3ProcessPopup();
                  onNavigateToWorkflow(currentProcess.id, currentProcess.name);
                }}
              >
                View Process Flow
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="process-taxonomy">
      {/* Integrated Header */}
      <div className="integrated-header">
        <div className="header-main">
          <div className="header-left">
            <h2>Process taxonomy</h2>
          </div>
          <div className="header-right">
            <button 
              className="btn btn-outline export-btn-header"
              onClick={() => setShowExportModal(true)}
              title="Export process taxonomy and flows to Excel"
            >
              <svg className="export-icon-small" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export
            </button>
          </div>
        </div>
      </div>

      {/* Process Section Header */}
      <div className="process-section-header">
        <div className="process-section-left">
          {/* Stats moved here with smaller font */}
          <div className="header-stats-small">
            <div className="stat-item-small">
              {dashboardData ? (
                <span className="stat-number-small">{dashboardData.stats.total_processes}</span>
              ) : (
                <span className="stat-number-small stat-loading">--</span>
              )}
              <span className="stat-label-small"># of L3 Processes</span>
            </div>
            <div className="stat-item-small">
              {dashboardData ? (
                <span className="stat-number-small">{Math.round(dashboardData.stats.completion_percentage)}%</span>
              ) : (
                <span className="stat-number-small stat-loading">--%</span>
              )}
              <span className="stat-label-small">Completion Rate</span>
            </div>
          </div>
        </div>
        <div className="process-section-right">
          <div className="process-filters">
            <label className="filter-label">Show:</label>
                <select 
              className="filter-select"
                  value={completionFilter} 
                  onChange={(e) => setCompletionFilter(e.target.value)}
                >
                  <option value="all">All Processes</option>
                  <option value="completed">Completed</option>
                  <option value="not_completed">Not Completed</option>
                </select>
            <span className="results-count">
              {countL3Processes(filteredTaxonomy)} {countL3Processes(filteredTaxonomy) === 1 ? 'process' : 'processes'}
            </span>
            {reorderParentId && (
              <span className="results-count">Reordering sub-processes</span>
            )}
          </div>
          <div className="process-actions">
          {/* <button 
            className="btn btn-outline"
            onClick={() => {
              // Pre-select all L0 processes - flatten if nested
              const flattenTaxonomy = (items) => {
                let result = [];
                for (const item of items) {
                  result.push(item);
                  if (item.children && item.children.length > 0) {
                    result = result.concat(flattenTaxonomy(item.children));
                  }
                }
                return result;
              };
              const allProcesses = flattenTaxonomy(taxonomy);
              const l0Ids = allProcesses.filter(p => p.level === 0).map(p => String(p.id));
              console.log('L0 IDs for SOP export:', l0Ids);
              setSelectedL0ForSOP(new Set(l0Ids));
              setShowSOPExportModal(true);
            }}
            title="Export all L3 processes as SOP documents"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '6px' }}>
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
            Mass Export SOPs
          </button> */}
          {reorderParentId ? (
            <>
              <button
                className="btn btn-outline"
                onClick={handleCancelReorder}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveReorder}
              >
                Save
              </button>
            </>
          ) : (
            <button 
              className="btn btn-primary"
              onClick={() => {
                setNewItem({ name: '', description: '', code: '', level: 0, parent_id: null });
                setShowAddForm(true);
              }}
            >
              Add Root Process
            </button>
          )}
          </div>
        </div>
      </div>

      {/* Error Message - Top Right Corner with Auto-Dismiss */}
      {showError && error && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          background: '#dc3545',
          color: 'white',
          padding: '12px 16px',
          borderRadius: '6px',
          fontSize: '14px',
          fontWeight: '500',
          zIndex: 10001,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          maxWidth: '400px',
          opacity: showError ? 1 : 0,
          transform: showError ? 'translateY(0)' : 'translateY(-10px)',
          transition: 'all 0.3s ease-in-out',
          border: '1px solid #c82333'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '16px' }}>⚠️</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      <div className="taxonomy-tree">
        {filteredTaxonomy.length === 0 ? (
          <div className="empty-state">
            <p>{completionFilter === 'all' ? 'No processes defined yet. Start by adding a root process.' : 'No processes match your filter criteria.'}</p>
          </div>
        ) : (
          renderTaxonomyList(filteredTaxonomy, 0, null)
        )}
      </div>

      {/* Process Flow Viewer for L3 processes */}
      {selectedProcess && (
        <ProcessFlowViewer
          processId={selectedProcess.id}
          processName={selectedProcess.name}
          onClose={() => setSelectedProcess(null)}
          onNavigateToWorkflow={onNavigateToWorkflow}
        />
      )}

      {/* Add/Edit Form Modal */}
      {showAddForm && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>{editingItem ? 'Edit Process' : 'Add New Process'}</h3>
              <button 
                className="btn-close"
                onClick={() => {
                  setShowAddForm(false);
                  setEditingItem(null);
                }}
              >
                ×
              </button>
            </div>
            <form onSubmit={handleAddItem} className="modal-body">
              {error && (
                <div style={{
                  marginBottom: '1rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '8px',
                  border: '1px solid #f5c2c7',
                  background: '#f8d7da',
                  color: '#842029',
                  fontSize: '0.95rem',
                  lineHeight: 1.4
                }}>
                  {error}
                </div>
              )}
              <div className="form-group">
                <label>Process Name *</label>
                <input
                  type="text"
                  value={newItem.name}
                  onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  value={newItem.description}
                  onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                  rows="3"
                />
              </div>
              <div className="form-group">
                <label>Level</label>
                <select
                  value={newItem.level}
                  onChange={(e) => setNewItem({ ...newItem, level: parseInt(e.target.value) })}
                >
                  <option value={0}>L0 - Organization</option>
                  <option value={1}>L1 - Department</option>
                  <option value={2}>L2 - Function</option>
                  <option value={3}>L3 - Process</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddForm(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  {editingItem ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Assignment Management Modal */}
      {showAssignmentForm && (
        <div className="modal-overlay">
          <div className="modal assignment-modal">
            <div className="modal-header">
              <h3>Manage Process Access</h3>
              <button
                className="btn-close"
                onClick={() => {
                  setShowAssignmentForm(null);
                  setAssignment({ user_email: '', role: 'delegatee' });
                }}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              {/* Permission Check */}
              {!currentUserRole || (currentUserRole !== 'owner' && currentUserRole !== 'delegator') ? (
                <div className="permission-warning">
                  <p>⚠️ You don't have permission to manage access for this process.</p>
                  <p>Only process owners and delegators can assign users.</p>
                </div>
              ) : (
                <>
                  {/* Add New Assignment Section */}
                  <form onSubmit={handleAssignUser} className="assignment-add-form">
                    <h4>Assign Access To</h4>
                    <div className="form-row">
                      <div className="form-group" style={{ flex: 2 }}>
                        <label>User Email</label>
                        <input
                          type="email"
                          value={assignment.user_email}
                          onChange={(e) => setAssignment({ ...assignment, user_email: e.target.value })}
                          required
                          placeholder="user@example.com"
                        />
                      </div>
                      <div className="form-group" style={{ flex: 1 }}>
                        <div className="label-with-tooltip">
                          <label>Access Right</label>
                          <div className="tooltip-container">
                            <span className="info-icon">?</span>
                            <div className="tooltip-content">
                              <div className="tooltip-item">
                                <strong>Owner:</strong> Full control: can assign/remove owners, delegators, and delegatees. Full edit rights.
                              </div>
                              <div className="tooltip-item">
                                <strong>Delegator:</strong> Can assign/remove delegators and delegatees (no owners). Full edit rights.
                              </div>
                              <div className="tooltip-item">
                                <strong>Delegatee:</strong> Full edit rights, but cannot assign access.
                              </div>
                            </div>
                          </div>
                        </div>
                        <select
                          value={assignment.role}
                          onChange={(e) => setAssignment({ ...assignment, role: e.target.value })}
                        >
                          {currentUserRole === 'owner' && <option value="owner">Owner</option>}
                          <option value="delegator">Delegator</option>
                          <option value="delegatee">Delegatee</option>
                        </select>
                      </div>
                    </div>
                    <button type="submit" className="btn-add-user">
                      Add User
                    </button>
                  </form>
                </>
              )}

              {/* Current Assignments List */}
              <div className="assignments-list-section">
                <h4>Users with Access</h4>
                {loadingAssignments ? (
                  <div className="loading">Loading assignments...</div>
                ) : currentAssignments.length === 0 ? (
                  <p className="no-assignments">No users assigned yet. Add users above.</p>
                ) : (
                  <div className="assignments-list">
                    {currentAssignments.slice(0, 5).map((assign) => {
                      // Permission logic
                      const canEditRole = currentUserRole === 'owner' || 
                                         (currentUserRole === 'delegator' && assign.role !== 'owner');
                      const canRemove = currentUserRole === 'owner' || 
                                       (currentUserRole === 'delegator' && assign.role !== 'owner');
                      
                      const isCurrentUserAssignment = isCurrentUser(assign.user_email, assign.user_id);
                      // Check if this assignment is inherited (from parent process)
                      const isInherited = assign.process_id !== showAssignmentForm;
                      // Inherited assignments cannot be edited or removed from child processes
                      const canEditThisRole = canEditRole && !isInherited;
                      const canRemoveThis = canRemove && !isInherited;
                      
                      return (
                        <div key={assign.id} className={`assignment-item-row ${isCurrentUserAssignment ? 'current-user-assignment' : ''} ${isInherited ? 'inherited-assignment' : ''}`}>
                          <div className="assignment-user-info">
                            <div className="user-email">
                              {assign.user_email}
                              {isCurrentUserAssignment && <span className="current-user-badge">You</span>}
                              {isInherited && <span className="inherited-badge" title={`Inherited from ${assign.process_name || 'parent process'}`}>Inherited</span>}
                            </div>
                            {canEditThisRole ? (
                              <select
                                className="role-select"
                                value={assign.role}
                                onChange={(e) => handleRoleChange(assign, e.target.value)}
                                disabled={isLastOwner(assign)}
                                title={isLastOwner(assign) ? 'Cannot change the last owner' : ''}
                              >
                                {/* Owners can assign any role; Delegators can only assign delegator/delegatee */}
                                {currentUserRole === 'owner' && <option value="owner">Owner</option>}
                                <option value="delegator">Delegator</option>
                                <option value="delegatee">Delegatee</option>
                              </select>
                            ) : (
                              <div className="role-badge-static">
                                {assign.role === 'owner' && <span className="role-badge role-owner">Owner</span>}
                                {assign.role === 'delegator' && <span className="role-badge role-delegator">Delegator</span>}
                                {assign.role === 'delegatee' && <span className="role-badge role-delegatee">Delegatee</span>}
                              </div>
                            )}
                          </div>
                          {canRemoveThis && (
                            <button
                              className="btn-remove-assignment"
                              onClick={() => {
                                if (isLastOwner(assign)) {
                                  setError('Cannot remove the last owner. Transfer ownership to another user first.');
                                  setShowError(true);
                                  setTimeout(() => setShowError(false), 5000);
                                } else {
                                  setConfirmDelete({ assignmentId: assign.id, userEmail: assign.user_email });
                                }
                              }}
                              disabled={isLastOwner(assign)}
                              title={isLastOwner(assign) ? 'Cannot remove the last owner' : 'Remove access'}
                              style={{ opacity: isLastOwner(assign) ? 0.3 : 1, cursor: isLastOwner(assign) ? 'not-allowed' : 'pointer' }}
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {currentAssignments.length > 5 && (
                      <p className="assignments-overflow">
                        + {currentAssignments.length - 5} more users with access
                      </p>
                    )}
                  </div>
                )}
              </div>

            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Assignment Dialog */}
      {confirmDelete && (
        <div className="modal-overlay" style={{ zIndex: 10000 }}>
          <div className="modal confirm-dialog">
            <div className="modal-header">
              <h3>Remove Access?</h3>
            </div>
            <div className="modal-body">
              <p>Remove access for <strong>{confirmDelete.userEmail}</strong>?</p>
              <p style={{ marginTop: '0.5rem', color: '#6b7280', fontSize: '0.875rem' }}>
                They will no longer be able to view or edit this process.
              </p>
            </div>
            <div className="modal-actions">
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn btn-danger" 
                onClick={handleDeleteAssignment}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Self-Downgrade Dialog */}
      {confirmSelfDowngrade && (
        <div className="modal-overlay" style={{ zIndex: 10001 }}>
          <div className="modal confirm-dialog">
            <div className="modal-header">
              <h3>Downgrade Your Access?</h3>
            </div>
            <div className="modal-body">
              <p>Changing your role from <strong>{confirmSelfDowngrade.currentRole}</strong> to <strong>{confirmSelfDowngrade.newRole}</strong>.</p>
              <div className="warning-box">
                <span className="warning-icon">⚠️</span>
                <div>
                  <strong>You will NOT be able to reverse this yourself!</strong>
                  <p>You'll need another owner or delegator to restore your access.</p>
                </div>
              </div>
            </div>
            <div className="modal-actions">
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={() => setConfirmSelfDowngrade(null)}
              >
                Cancel
              </button>
              <button 
                type="button" 
                className="btn btn-danger" 
                onClick={async () => {
                  await performRoleChange(
                    confirmSelfDowngrade.assignmentId,
                    confirmSelfDowngrade.userEmail,
                    confirmSelfDowngrade.newRole
                  );
                  setConfirmSelfDowngrade(null);
                  setShowAssignmentForm(null);
                }}
              >
                Confirm Downgrade
              </button>
            </div>
          </div>
        </div>
      )}


      {/* L3 Process Popup */}
      {renderL3ProcessPopup()}

      {/* Export Modal */}
      {showExportModal && (
        <ExportModal 
          taxonomy={taxonomy}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {/* Move Modal */}
      {showMoveModal && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>Move "{showMoveModal.name}"</h3>
              <button 
                className="btn-close"
                onClick={() => {
                  setShowMoveModal(null);
                  setSelectedNewParent(null);
                }}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <p style={{ marginBottom: '1rem', color: '#666' }}>
                Select the new parent for this process. Current level: L{showMoveModal.level}
              </p>
              
              {(() => {
                const validTargets = getValidMoveTargets(showMoveModal);
                
                if (validTargets.length === 0) {
                  // Check if it's because of L3 children constraint
                  const hasL3Children = (node) => {
                    if (node.level === 3) return true;
                    if (!node.children) return false;
                    return node.children.some(child => hasL3Children(child));
                  };
                  
                  if (hasL3Children(showMoveModal)) {
                    return (
                      <div style={{ 
                        padding: '1rem', 
                        background: '#fff3cd', 
                        border: '1px solid #ffc107',
                        borderRadius: '4px',
                        color: '#856404'
                      }}>
                        <strong>⚠️ Cannot move this process</strong>
                        <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                          {showMoveModal.level === 2 
                            ? 'This L2 process contains L3 processes and cannot be moved down to become an L3 process. L3 is the maximum level.'
                            : showMoveModal.level === 1
                            ? 'This L1 process contains L3 processes and cannot be moved down to become an L2 or L3 process, as descendants would exceed the maximum level (L3).'
                            : 'This process contains L3 processes (maximum level) and cannot be moved to a deeper level.'}
                        </p>
                      </div>
                    );
                  }
                  
                  return <p style={{ color: '#999' }}>No valid move targets available.</p>;
                }
                
                return (
                  <div className="move-target-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    {validTargets.map(target => (
                      <div
                        key={target.id}
                        className={`move-target-item ${selectedNewParent === target.id ? 'selected' : ''}`}
                        onClick={() => setSelectedNewParent(target.id)}
                        style={{
                          padding: '0.75rem',
                          paddingLeft: `${target.indent * 24 + 12}px`,
                          cursor: 'pointer',
                          borderRadius: '4px',
                          marginBottom: '0.25rem',
                          background: selectedNewParent === target.id ? '#e7f3ff' : '#f8f9fa',
                          border: selectedNewParent === target.id ? '2px solid #007bff' : '1px solid #dee2e6',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          if (selectedNewParent !== target.id) {
                            e.target.style.background = '#e9ecef';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (selectedNewParent !== target.id) {
                            e.target.style.background = '#f8f9fa';
                          }
                        }}
                      >
                        <span className="level-badge" style={{ 
                          background: '#6c757d', 
                          color: 'white', 
                          padding: '2px 6px',
                          borderRadius: '3px',
                          fontSize: '11px',
                          marginRight: '8px'
                        }}>L{target.level}</span>
                        {target.name}
                      </div>
                    ))}
                  </div>
                );
              })()}
              
              <div className="modal-actions" style={{ marginTop: '1.5rem' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  onClick={() => {
                    setShowMoveModal(null);
                    setSelectedNewParent(null);
                  }}
                >
                  Cancel
                </button>
                <button 
                  type="button" 
                  className="btn btn-primary" 
                  onClick={handleMoveConfirm}
                  disabled={!selectedNewParent}
                >
                  Move Here
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mass SOP Export Modal */}
      {showSOPExportModal && (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowSOPExportModal(false)}>
          <div className="modal" style={{ maxWidth: '500px' }}>
            <div className="modal-header" style={{ 
              background: 'linear-gradient(135deg, #0E3BAF 0%, #0B2E88 100%)',
              color: 'white',
              padding: '1rem 1.25rem',
              borderRadius: '12px 12px 0 0'
            }}>
              <h3 style={{ margin: 0, fontSize: '1.125rem' }}>Mass Export SOPs</h3>
              <button 
                className="btn-close" 
                onClick={() => setShowSOPExportModal(false)}
                style={{ color: 'white', opacity: 0.8 }}
              >
                ×
              </button>
            </div>
            
            <div className="modal-body" style={{ padding: '1.5rem' }}>
              <p style={{ marginBottom: '1rem', color: '#3B4A6B' }}>
                Select L0 processes to export all their L3 processes as SOP Word documents.
                Files will be organized in a folder structure matching your process hierarchy.
              </p>
              
              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <span style={{ fontWeight: 600, color: '#0E3BAF' }}>L0 Processes</span>
                  <button 
                    className="btn btn-sm btn-outline"
                    onClick={() => {
                      // Get L0 processes - taxonomy is already a list of root (L0) items
                      const l0Ids = taxonomy.filter(p => p.level === 0).map(p => String(p.id));
                      if (selectedL0ForSOP.size === l0Ids.length) {
                        setSelectedL0ForSOP(new Set());
                      } else {
                        setSelectedL0ForSOP(new Set(l0Ids));
                      }
                    }}
                    style={{ padding: '4px 12px', fontSize: '0.875rem' }}
                  >
                    {selectedL0ForSOP.size === taxonomy.filter(p => p.level === 0).length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                
                <div style={{ 
                  maxHeight: '250px', 
                  overflowY: 'auto', 
                  border: '1px solid #E1E8F5', 
                  borderRadius: '8px',
                  padding: '0.5rem'
                }}>
                  {taxonomy.filter(p => p.level === 0).length === 0 ? (
                    <p style={{ color: '#6c757d', padding: '1rem', textAlign: 'center' }}>
                      No L0 processes available
                    </p>
                  ) : (
                    taxonomy.filter(p => p.level === 0).map(l0 => {
                      const l0IdStr = String(l0.id);
                      return (
                        <label 
                          key={l0IdStr} 
                          style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '0.75rem',
                            padding: '0.75rem',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            background: selectedL0ForSOP.has(l0IdStr) ? '#E8F0FF' : 'transparent',
                            border: selectedL0ForSOP.has(l0IdStr) ? '1px solid #0E3BAF' : '1px solid transparent',
                            marginBottom: '0.5rem'
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedL0ForSOP.has(l0IdStr)}
                            onChange={() => {
                              const newSelected = new Set(selectedL0ForSOP);
                              if (newSelected.has(l0IdStr)) {
                                newSelected.delete(l0IdStr);
                              } else {
                                newSelected.add(l0IdStr);
                              }
                              setSelectedL0ForSOP(newSelected);
                            }}
                            style={{ 
                              width: '18px', 
                              height: '18px',
                              accentColor: '#0E3BAF'
                            }}
                          />
                          <span style={{ fontWeight: 500, color: '#1E3A5F' }}>{l0.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
              
              <p style={{ fontSize: '0.875rem', color: '#6c757d', marginTop: '1rem' }}>
                <strong>Note:</strong> A ZIP file containing all SOPs will be downloaded.
                Each L3 process will have its own Word document following the standard SOP template.
              </p>
            </div>
            
            <div className="modal-footer" style={{ 
              display: 'flex', 
              justifyContent: 'flex-end', 
              gap: '0.75rem',
              padding: '1rem 1.5rem',
              borderTop: '1px solid #E1E8F5'
            }}>
              <button 
                className="btn btn-secondary"
                onClick={() => setShowSOPExportModal(false)}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary"
                onClick={async () => {
                  if (selectedL0ForSOP.size === 0) {
                    alert('Please select at least one L0 process');
                    return;
                  }
                  
                  setExportingSOPs(true);
                  try {
                    const token = await getToken();
                    const l0Ids = Array.from(selectedL0ForSOP);
                    console.log('Exporting SOPs for L0 IDs:', l0Ids);
                    console.log('L0 ID types:', l0Ids.map(id => ({ id, type: typeof id })));
                    
                    const response = await fetch(`${API_BASE_URL}/api/export/sop/bulk`, {
                      method: 'POST',
                      headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                        selected_l0_ids: l0Ids
                      })
                    });
                    
                    if (!response.ok) {
                      const errorData = await response.json();
                      throw new Error(errorData.detail || 'Failed to generate SOPs');
                    }
                    
                    // Download the ZIP file
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    
                    // Get filename from Content-Disposition header
                    const contentDisposition = response.headers.get('Content-Disposition');
                    let filename = 'process_mapper_core_SOP_Export.zip';
                    if (contentDisposition) {
                      const match = contentDisposition.match(/filename="?(.+)"?/);
                      if (match) {
                        filename = match[1].replace(/"/g, '');
                      }
                    }
                    
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                    
                    setShowSOPExportModal(false);
                  } catch (error) {
                    console.error('Error exporting SOPs:', error);
                    alert('Failed to export SOPs: ' + error.message);
                  } finally {
                    setExportingSOPs(false);
                  }
                }}
                disabled={exportingSOPs || selectedL0ForSOP.size === 0}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                {exportingSOPs ? (
                  <>
                    <span className="spinner-border spinner-border-sm" style={{ width: '1rem', height: '1rem' }}></span>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Export SOPs
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProcessTaxonomy;
