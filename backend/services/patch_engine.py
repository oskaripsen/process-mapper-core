"""
Patch Engine - Deterministic Patch Application

Applies patch operations to process flows with validation and minimal post-processing.
"""

from typing import List, Tuple, Optional
from datetime import datetime
import uuid
import copy
import logging

from schemas.process_flow import (
    ProcessFlow, ProcessNode, ProcessEdge, PatchOperation, FlowPatch,
    NodeType, AutomationLevel, validate_flow_topology
)
from services.step_id import get_next_sequential_id, renumber_by_flow_sequence

logger = logging.getLogger(__name__)


class PatchEngineError(Exception):
    """Raised when patch application fails"""
    pass


class PatchEngine:
    """
    Engine for applying patches to process flows.
    
    Responsibilities:
    - Apply patch operations deterministically
    - Validate topology during application
    - Minimal post-processing (merge nodes, start nodes)
    - Maintain history for rollback
    
    Philosophy:
    - Trust LLM output - apply operations as specified
    - Post-process only for structural requirements (multiple incoming -> merge)
    - Warn on validation errors but don't block
    """
    
    def __init__(self):
        self.history: List[Tuple[ProcessFlow, FlowPatch]] = []
        self.max_history = 100
    
    def apply_patch(
        self, 
        flow: ProcessFlow, 
        patch: FlowPatch
    ) -> Tuple[ProcessFlow, List[str]]:
        """
        Apply a patch to a process flow.
        
        Returns:
            Tuple of (updated_flow, validation_errors)
        """
        original_flow = copy.deepcopy(flow)
        validation_warnings = []
        
        try:
            new_flow = copy.deepcopy(flow)
            patch.applied_at = datetime.utcnow().isoformat()
            
            # Pre-validate patch operations (strict validation)
            validation_errors = self._validate_patch(new_flow, patch)
            if validation_errors:
                error_msg = f"Patch validation failed: {'; '.join(validation_errors)}"
                logger.error(error_msg)
                raise PatchEngineError(error_msg)
            
            # Check if we should allow auto-bridging for deletions
            # If the patch contains add_node operations, we assume a restructure/replace
            # and disable auto-bridging to avoid creating incorrect connections
            allow_autobridge = not any(op.type == "add_node" for op in patch.operations)
            
            # Apply operations in order
            for operation in patch.operations:
                new_flow = self._apply_operation(new_flow, operation, allow_autobridge)
            
            # Post-processing
            new_flow = self._post_process(new_flow, original_flow)
            
            # Final validation
            topology_errors = validate_flow_topology(new_flow)
            if topology_errors:
                logger.warning(f"Topology warnings: {'; '.join(topology_errors)}")
                validation_warnings.extend(topology_errors)
            
            new_flow.updated_at = datetime.utcnow().isoformat()
            self._add_to_history(original_flow, patch)
            
            return new_flow, validation_warnings
            
        except Exception as e:
            raise PatchEngineError(f"Failed to apply patch: {str(e)}")
    
    def _apply_operation(
        self, 
        flow: ProcessFlow, 
        operation: PatchOperation,
        allow_autobridge: bool = True
    ) -> ProcessFlow:
        """Apply a single patch operation."""
        
        if operation.type == "add_node":
            return self._add_node(flow, operation.node)
        elif operation.type == "update_node":
            return self._update_node(flow, operation.node)
        elif operation.type == "delete_node":
            return self._delete_node(flow, operation.node_id, allow_autobridge)
        elif operation.type == "add_edge":
            return self._add_edge(flow, operation.edge)
        elif operation.type == "update_edge":
            return self._update_edge(flow, operation.edge)
        elif operation.type == "delete_edge":
            return self._delete_edge(flow, operation.edge_id)
        else:
            raise PatchEngineError(f"Unknown operation type: {operation.type}")
    
    def _add_node(self, flow: ProcessFlow, node: ProcessNode) -> ProcessFlow:
        """Add a new node to the flow."""
        if not node:
            raise PatchEngineError("Node data required for add_node operation")
        
        if any(n.id == node.id for n in flow.nodes):
            raise PatchEngineError(f"Node with ID '{node.id}' already exists")
        
        # Assign logical_id for process nodes
        if node.type == NodeType.PROCESS and not node.logical_id:
            node.logical_id = get_next_sequential_id([
                {"logical_id": n.logical_id} for n in flow.nodes 
                if n.logical_id and n.type == NodeType.PROCESS
            ])
        
        if not node.created_at:
            node.created_at = datetime.utcnow().isoformat()
        
        flow.nodes.append(node)
        return flow
    
    def _update_node(self, flow: ProcessFlow, node: ProcessNode) -> ProcessFlow:
        """Update an existing node."""
        if not node:
            raise PatchEngineError("Node data required for update_node operation")
        
        existing_index = None
        for i, existing_node in enumerate(flow.nodes):
            if existing_node.id == node.id:
                existing_index = i
                break
        
        if existing_index is None:
            raise PatchEngineError(f"Node with ID '{node.id}' not found for update")
        
        existing_node = flow.nodes[existing_index]
        
        # Protect user-modified nodes from AI updates
        if existing_node.user_modified:
            logger.info(f"Protecting user-modified node '{existing_node.label}'")
            node.label = existing_node.label
            node.owner = existing_node.owner
            node.system = existing_node.system
        
        # Preserve metadata
        node.created_at = existing_node.created_at
        node.user_modified = existing_node.user_modified
        if not node.logical_id:
            node.logical_id = existing_node.logical_id
        
        # CRITICAL: Preserve screenshot_url - user-assigned screenshots must not be lost
        if existing_node.screenshot_url and not node.screenshot_url:
            logger.info(f"SCREENSHOT PRESERVE: Copying screenshot_url from existing node '{existing_node.label[:30]}...'")
            node.screenshot_url = existing_node.screenshot_url
        elif existing_node.screenshot_url and node.screenshot_url:
            logger.info(f"SCREENSHOT UPDATE: Node '{existing_node.label[:30]}...' - replacing {existing_node.screenshot_url[:30]}... with {node.screenshot_url[:30]}...")
        elif not existing_node.screenshot_url and node.screenshot_url:
            logger.info(f"SCREENSHOT NEW: Node '{existing_node.label[:30]}...' getting new screenshot: {node.screenshot_url[:30]}...")
        
        flow.nodes[existing_index] = node
        return flow
    
    def _delete_node(self, flow: ProcessFlow, node_id: str, allow_autobridge: bool = True) -> ProcessFlow:
        """Delete a node and all connected edges."""
        if not node_id:
            raise PatchEngineError("Node ID required for delete_node operation")
        
        node_exists = any(n.id == node_id for n in flow.nodes)
        if not node_exists:
            logger.warning(f"Node '{node_id[:8]}...' not found (may have been already deleted)")
            return flow
        
        # Find incoming and outgoing edges
        incoming_edges = [e for e in flow.edges if e.target == node_id]
        outgoing_edges = [e for e in flow.edges if e.source == node_id]
        
        # Auto-bridge: If exactly 1 in and 1 out, connect them
        # Only if allow_autobridge is True (disabled for replace/restructure operations)
        if allow_autobridge and len(incoming_edges) == 1 and len(outgoing_edges) == 1:
            source_id = incoming_edges[0].source
            target_id = outgoing_edges[0].target
            condition = outgoing_edges[0].condition
            
            bridge_edge = ProcessEdge(
                id=str(uuid.uuid4()),
                source=source_id,
                target=target_id,
                condition=condition,
                created_at=datetime.utcnow().isoformat()
            )
            
            flow.nodes = [n for n in flow.nodes if n.id != node_id]
            flow.edges = [e for e in flow.edges if e.source != node_id and e.target != node_id]
            flow.edges.append(bridge_edge)
            
            deleted_node = next((n for n in flow.nodes if n.id == node_id), None)
            node_label = deleted_node.label if deleted_node else "Unknown"
            logger.info(f"Auto-bridged: {source_id[:8]}... → {target_id[:8]}... (bypassing '{node_label}')")
        else:
            # Standard deletion
            flow.nodes = [n for n in flow.nodes if n.id != node_id]
            flow.edges = [e for e in flow.edges if e.source != node_id and e.target != node_id]
        
        return flow
    
    def _add_edge(self, flow: ProcessFlow, edge: ProcessEdge) -> ProcessFlow:
        """Add a new edge to the flow."""
        if not edge:
            raise PatchEngineError("Edge data required for add_edge operation")
        
        if any(e.id == edge.id for e in flow.edges):
            raise PatchEngineError(f"Edge with ID '{edge.id}' already exists")
        
        node_ids = {n.id for n in flow.nodes}
        if edge.source not in node_ids:
            raise PatchEngineError(f"Source node '{edge.source}' not found")
        if edge.target not in node_ids:
            raise PatchEngineError(f"Target node '{edge.target}' not found")
        
        if not edge.created_at:
            edge.created_at = datetime.utcnow().isoformat()
        
        flow.edges.append(edge)
        return flow
    
    def _update_edge(self, flow: ProcessFlow, edge: ProcessEdge) -> ProcessFlow:
        """Update an existing edge."""
        if not edge:
            raise PatchEngineError("Edge data required for update_edge operation")
        
        existing_index = None
        for i, existing_edge in enumerate(flow.edges):
            if existing_edge.id == edge.id:
                existing_index = i
                break
        
        if existing_index is None:
            raise PatchEngineError(f"Edge with ID '{edge.id}' not found for update")
        
        existing_edge = flow.edges[existing_index]
        edge.created_at = existing_edge.created_at
        flow.edges[existing_index] = edge
        return flow
    
    def _delete_edge(self, flow: ProcessFlow, edge_id: str) -> ProcessFlow:
        """Delete an edge."""
        if not edge_id:
            raise PatchEngineError("Edge ID required for delete_edge operation")
        
        edge_exists = any(e.id == edge_id for e in flow.edges)
        if not edge_exists:
            logger.warning(f"Edge '{edge_id[:8]}...' not found (may have been already deleted)")
            return flow
        
        flow.edges = [e for e in flow.edges if e.id != edge_id]
        return flow
    
    def _post_process(
        self, 
        flow: ProcessFlow, 
        original_flow: ProcessFlow
    ) -> ProcessFlow:
        """Post-process flow: ensure start node, create merge nodes, renumber logical IDs."""
        
        # 1. Renumber logical IDs based on flow sequence
        if flow.nodes:
            nodes_dict = [
                {
                    "id": n.id,
                    "type": "default" if n.type == NodeType.PROCESS else n.type.value,
                    "logical_id": n.logical_id or ""
                }
                for n in flow.nodes
            ]
            edges_dict = [
                {"source": e.source, "target": e.target}
                for e in flow.edges
            ]
            renumbered = renumber_by_flow_sequence(nodes_dict, edges_dict)
            
            # Update logical IDs
            for node in flow.nodes:
                renumbered_node = next((rn for rn in renumbered if rn["id"] == node.id), None)
                if renumbered_node:
                    node.logical_id = renumbered_node["logical_id"]
        
        # 2. Ensure start node exists (for new flows only)
        if len(original_flow.nodes) == 0:
            flow = self._ensure_start_node(flow)
        
        # 3. Create merge nodes for multiple incoming edges
        flow = self._create_merge_nodes(flow)
        
        # 4. Fix PROCESS nodes with multiple outgoing edges (safety net)
        flow = self._fix_process_nodes_with_multiple_outgoing(flow)
        
        # 5. Normalize merge node labels to a consistent short value
        flow = self._normalize_merge_labels(flow)

        # 6. Fix orphan nodes (nodes with 0 incoming edges)
        flow = self._fix_orphan_nodes(flow)
        
        return flow
    
    def _ensure_start_node(self, flow: ProcessFlow) -> ProcessFlow:
        """Ensure there's a START node if flow has nodes but no start."""
        has_nodes = len(flow.nodes) > 0
        has_start = any(n.type == NodeType.START for n in flow.nodes)
        
        if has_nodes and not has_start:
            # Find first process node
            process_nodes = [n for n in flow.nodes if n.type == NodeType.PROCESS]
            
            start_node = ProcessNode(
                id=str(uuid.uuid4()),
                type=NodeType.START,
                label="Start",
                automation=AutomationLevel.MANUAL,
                created_at=datetime.utcnow().isoformat()
            )
            flow.nodes.append(start_node)
            
            # Connect to first process node
            if process_nodes:
                target_node = process_nodes[0]
                start_edge = ProcessEdge(
                    id=str(uuid.uuid4()),
                    source=start_node.id,
                    target=target_node.id,
                    created_at=datetime.utcnow().isoformat()
                )
                flow.edges.append(start_edge)
                logger.info(f"Created START node and connected to '{target_node.label}'")
        
        return flow

    def _normalize_merge_labels(self, flow: ProcessFlow) -> ProcessFlow:
        """Ensure merge nodes use a consistent short label."""
        for node in flow.nodes:
            if node.type == NodeType.MERGE and node.label != "Merge":
                node.label = "Merge"
        return flow
    
    def _create_merge_nodes(self, flow: ProcessFlow) -> ProcessFlow:
        """Create merge nodes for nodes with multiple incoming edges."""
        from schemas.process_flow import ProcessNode, NodeType, AutomationLevel, ProcessEdge
        
        # Find existing merge nodes
        existing_merge_for_target = {}
        for node in flow.nodes:
            if node.type == NodeType.MERGE:
                outgoing_edges = [e for e in flow.edges if e.source == node.id]
                for edge in outgoing_edges:
                    existing_merge_for_target[edge.target] = node
        
        # Find nodes needing merge nodes
        nodes_to_fix = []
        for node in flow.nodes:
            if node.type in [NodeType.PROCESS, NodeType.DECISION]:
                incoming_count = len([e for e in flow.edges if e.target == node.id])
                if incoming_count > 1:
                    if node.id in existing_merge_for_target:
                        # Redirect extra incoming edges to existing merge
                        existing_merge = existing_merge_for_target[node.id]
                        incoming_edges = [
                            e for e in flow.edges 
                            if e.target == node.id and e.source != existing_merge.id
                        ]
                        for edge in incoming_edges:
                            edge.target = existing_merge.id
                    else:
                        nodes_to_fix.append(node)
        
        # Create merge nodes
        for target_node in nodes_to_fix:
            incoming_edges = [e for e in flow.edges if e.target == target_node.id]
            
            merge_node = ProcessNode(
                id=str(uuid.uuid4()),
                type=NodeType.MERGE,
                label=f"Merge",
                automation=AutomationLevel.MANUAL,
                created_at=datetime.utcnow().isoformat()
            )
            flow.nodes.append(merge_node)
            
            # Redirect incoming edges to merge node
            for edge in incoming_edges:
                edge.target = merge_node.id
            
            # Create bridge edge from merge to target
            bridge_edge = ProcessEdge(
                id=str(uuid.uuid4()),
                source=merge_node.id,
                target=target_node.id,
                created_at=datetime.utcnow().isoformat()
            )
            flow.edges.append(bridge_edge)
            
            logger.info(f"Created MERGE node for '{target_node.label}' with {len(incoming_edges)} incoming connections")
        
        return flow
    
    def _fix_process_nodes_with_multiple_outgoing(self, flow: ProcessFlow) -> ProcessFlow:
        """
        Fix PROCESS nodes that have multiple outgoing edges (violates topology rules).
        This can happen when inserting steps if edge deletion didn't work properly.
        Strategy: Keep the first edge, remove the others (log a warning).
        """
        from schemas.process_flow import ProcessNode, NodeType
        
        # Find PROCESS nodes with multiple outgoing edges
        for node in flow.nodes:
            if node.type == NodeType.PROCESS:
                outgoing_edges = [e for e in flow.edges if e.source == node.id]
                
                if len(outgoing_edges) > 1:
                    logger.warning(f"Fixing PROCESS node '{node.label}' ({node.id[:8]}...) with {len(outgoing_edges)} outgoing edges (should have 0-1)")
                    
                    # Keep the first edge, remove the rest
                    # Prefer edges that don't have conditions (more likely to be the main flow)
                    edges_without_condition = [e for e in outgoing_edges if not e.condition]
                    edges_with_condition = [e for e in outgoing_edges if e.condition]
                    
                    # Keep one edge: prefer non-conditioned, otherwise first
                    edge_to_keep = edges_without_condition[0] if edges_without_condition else outgoing_edges[0]
                    edges_to_remove = [e for e in outgoing_edges if e.id != edge_to_keep.id]
                    
                    # Remove the extra edges
                    for edge in edges_to_remove:
                        flow.edges = [e for e in flow.edges if e.id != edge.id]
                        logger.info(f"Removed edge: {edge.source[:8]}... → {edge.target[:8]}... (kept: {edge_to_keep.target[:8]}...)")
        
        return flow
    
    def _fix_orphan_nodes(self, flow: ProcessFlow) -> ProcessFlow:
        """
        Fix nodes with 0 incoming edges (orphans).
        These are often parallel tasks that should be connected to a common source.
        Strategy: Connect them to the start node, or to the most recent common ancestor.
        """
        from schemas.process_flow import ProcessNode, NodeType, AutomationLevel, ProcessEdge
        
        # Find start node
        start_nodes = [n for n in flow.nodes if n.type == NodeType.START]
        start_node = start_nodes[0] if start_nodes else None
        
        # Find nodes with no incoming edges (excluding start nodes)
        orphan_nodes = []
        for node in flow.nodes:
            if node.type == NodeType.START:
                continue  # Start nodes don't need incoming edges
            
            incoming_count = len([e for e in flow.edges if e.target == node.id])
            if incoming_count == 0:
                orphan_nodes.append(node)
        
        if not orphan_nodes:
            return flow
        
        # Helper to find node by logical ID
        def find_by_logical_id(lid):
            for n in flow.nodes:
                if n.logical_id == lid:
                    return n
            return None

        # Helper to decrement logical ID (1.1.1.5 -> 1.1.1.4)
        def get_prev_logical_id(lid):
            if not lid: return None
            parts = lid.split('.')
            if not parts: return None
            try:
                last_num = int(parts[-1])
                if last_num > 1:
                    parts[-1] = str(last_num - 1)
                    return '.'.join(parts)
            except ValueError:
                pass
            return None

        for orphan in orphan_nodes:
            source_node = None
            
            # Strategy 1: Logical ID Predecessor
            if orphan.logical_id:
                prev_id = get_prev_logical_id(orphan.logical_id)
                if prev_id:
                    source_node = find_by_logical_id(prev_id)
                    if source_node:
                        logger.info(
                            "Connecting orphan '%s' to predecessor '%s' (by ID %s)",
                            orphan.label,
                            source_node.label,
                            prev_id,
                        )

            # Strategy 2: Connect to a "dangling" end of flow (if not found by ID)
            if not source_node:
                # Find nodes with 0 outgoing edges (excluding END nodes and the orphan itself)
                dangling_nodes = []
                for n in flow.nodes:
                    if n.type == NodeType.END or n.id == orphan.id:
                        continue
                    outgoing = [e for e in flow.edges if e.source == n.id]
                    if len(outgoing) == 0:
                        dangling_nodes.append(n)
                
                if dangling_nodes:
                    # Pick the one with the highest logical ID, or just the last one
                    # Sorting by logical ID might be safest
                    dangling_nodes.sort(key=lambda x: x.logical_id or "", reverse=True)
                    source_node = dangling_nodes[0]
                    logger.info(
                        "Connecting orphan '%s' to dangling node '%s'",
                        orphan.label,
                        source_node.label,
                    )

            # Strategy 3: Fallback to Start Node
            if not source_node and start_node:
                source_node = start_node
                logger.info("Connecting orphan '%s' to START node (fallback)", orphan.label)
            
            # Create edge if source found
            if source_node:
                # Check if edge already exists
                existing_edge = any(
                    e.source == source_node.id and e.target == orphan.id 
                    for e in flow.edges
                )
                
                if not existing_edge:
                    bridge_edge = ProcessEdge(
                        id=str(uuid.uuid4()),
                        source=source_node.id,
                        target=orphan.id,
                        created_at=datetime.utcnow().isoformat()
                    )
                    flow.edges.append(bridge_edge)
                    logger.info(f"Connected orphan node '{orphan.label[:50]}...' to '{source_node.label[:50]}...'")
        
        return flow
    
    def _validate_patch(
        self, 
        flow: ProcessFlow, 
        patch: FlowPatch
    ) -> List[str]:
        """
        Pre-validate patch operations with strict validation.
        Returns errors (fatal) that should prevent patch application.
        """
        errors = []
        
        # Build set of node IDs that will exist after node operations are applied
        # This includes existing nodes plus nodes that will be added
        node_ids = {n.id for n in flow.nodes}
        edge_ids = {e.id for e in flow.edges}
        
        # Track nodes that will be added or updated (so edges can reference them)
        nodes_after_operations = node_ids.copy()
        for operation in patch.operations:
            if operation.type == "add_node" and operation.node:
                nodes_after_operations.add(operation.node.id)
            elif operation.type == "update_node" and operation.node:
                nodes_after_operations.add(operation.node.id)  # Update doesn't change ID
            elif operation.type == "delete_node" and operation.node_id:
                nodes_after_operations.discard(operation.node_id)
        
        # Validate operations - strict validation
        for operation in patch.operations:
            if operation.type == "update_node":
                if operation.node and operation.node.id not in nodes_after_operations:
                    errors.append(f"Update references non-existent node: {operation.node.id}")
            
            elif operation.type == "add_edge":
                if operation.edge:
                    # Strict validation: reject if source/target don't exist
                    if operation.edge.source not in nodes_after_operations:
                        errors.append(f"Edge source not found: {operation.edge.source}")
                    if operation.edge.target not in nodes_after_operations:
                        errors.append(f"Edge target not found: {operation.edge.target}")
            
            elif operation.type == "update_edge":
                if operation.edge and operation.edge.id not in edge_ids:
                    errors.append(f"Update references non-existent edge: {operation.edge.id}")
        
        # [REMOVED] Decision node topology check (min 2 outgoing edges) is now handled 
        # as a non-blocking warning in validate_flow_topology, not a fatal error here.
        # This allows saving intermediate states.
        
        return errors
    
    def rollback_last_patch(self) -> Optional[ProcessFlow]:
        """Rollback to the state before the last patch was applied."""
        if not self.history:
            logger.warning("No patch history available for rollback")
            return None
        
        original_flow, last_patch = self.history.pop()
        logger.info(f"Rolling back patch applied at {last_patch.applied_at}")
        return original_flow
    
    def _add_to_history(
        self, 
        original_flow: ProcessFlow, 
        patch: FlowPatch
    ) -> None:
        """Add operation to history for potential rollback."""
        self.history.append((original_flow, patch))
        if len(self.history) > self.max_history:
            self.history.pop(0)
