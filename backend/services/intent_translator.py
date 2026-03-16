"""
Intent Translator - Pure Mapping from Intent to Patch Operations

Simple 1:1 mapper from ProcessIntent to Patch Operations.
No fixing, no repairing - just pure translation.
"""

import logging
import uuid
from typing import List, Optional
from datetime import datetime

from schemas.intent_schema import ProcessIntent, IntentStepType
from schemas.process_flow import (
    ProcessFlow, ProcessNode, ProcessEdge, FlowPatch, PatchOperation,
    NodeType, AutomationLevel
)

logger = logging.getLogger(__name__)


class IntentTranslatorError(Exception):
    """Raised when intent translation fails"""
    pass


class IntentTranslator:
    """
    Pure mapper from ProcessIntent to FlowPatch operations.
    
    Responsibilities:
    - Map IntentSteps to ProcessNode operations (add/update)
    - Map IntentFlows to ProcessEdge operations (add)
    - Handle deletions (nodes and edges)
    - Map temp IDs (new_s1) to real UUIDs
    
    NOT responsible for:
    - Fixing topology issues (PatchEngine does this)
    - Validating node types (LLM decides this)
    - Repairing broken flows (PatchEngine does this)
    """
    
    def __init__(self):
        pass
    
    def translate_intent_to_flow_patch(
        self, 
        intent: ProcessIntent,
        existing_flow: Optional[ProcessFlow] = None
    ) -> FlowPatch:
        """
        Convert ProcessIntent to FlowPatch.
        
        Args:
            intent: Semantic process intent from LLM
            existing_flow: Optional existing flow for incremental updates
            
        Returns:
            FlowPatch with operations to create/update ProcessFlow
        """
        if not intent.steps:
            raise IntentTranslatorError("No process steps found - nothing to display")
        
        # Build map of existing nodes by ID
        existing_node_map = {}
        if existing_flow:
            nodes_with_screenshots = 0
            for node in existing_flow.nodes:
                existing_node_map[node.id] = node
                if node.screenshot_url:
                    nodes_with_screenshots += 1
            logger.info(f"INTENT TRANSLATOR: Built existing_node_map with {len(existing_node_map)} nodes, {nodes_with_screenshots} have screenshot_url")
        
        # Step 1: Create node operations (add/update)
        node_operations = self._create_node_operations(intent, existing_node_map)
        
        # Step 2: Build ID mapping (temp IDs -> real UUIDs)
        step_to_node_id = self._build_id_mapping(intent, node_operations, existing_node_map)
        
        # Validate that all steps referenced in flows are mapped
        unmapped_in_flows = []
        for flow in intent.flows:
            if flow.from_step not in step_to_node_id:
                unmapped_in_flows.append(f"from_step: {flow.from_step}")
            if flow.to_step not in step_to_node_id:
                unmapped_in_flows.append(f"to_step: {flow.to_step}")
        
        if unmapped_in_flows:
            logger.warning(
                "Warning: %s flow references point to unmapped steps. These edges will be skipped.",
                len(unmapped_in_flows),
            )
        
        # Step 3: Create edge operations
        edge_operations = self._create_edge_operations(intent, step_to_node_id, existing_flow)
        
        # Step 4: Create deletion operations (needs step_to_node_id to map temp IDs and existing_node_map to check if nodes exist)
        deletion_operations = self._create_deletion_operations(intent, existing_flow, step_to_node_id, existing_node_map)
        
        # Separate edge deletions from node deletions
        edge_deletions = [op for op in deletion_operations if op.type == "delete_edge"]
        node_deletions = [op for op in deletion_operations if op.type == "delete_node"]
        
        # Combine operations in correct order:
        # 1. Node updates/additions (need nodes to exist before edges)
        # 2. Edge deletions (must happen before new edges are added to avoid PROCESS node violations)
        # 3. Edge additions (after deletions to ensure clean state)
        # 4. Node deletions (last, after all edges are handled)
        all_operations = node_operations + edge_deletions + edge_operations + node_deletions
        
        return FlowPatch(
            operations=all_operations,
            source="intent_translator",
            created_at=datetime.utcnow().isoformat()
        )
    
    def _create_node_operations(
        self,
        intent: ProcessIntent,
        existing_node_map: dict
    ) -> List[PatchOperation]:
        """Create node operations (add or update)."""
        operations = []
        
        for step in intent.steps:
            # Check if this step ID references an existing node
            if step.id in existing_node_map:
                # UPDATE existing node
                existing_node = existing_node_map[step.id]
                
                # Map step type to NodeType
                node_type = self._map_step_type_to_node_type(step.step_type)
                
                # Map automation level
                automation = self._map_automation_level(step.manual_auto)
                if automation == AutomationLevel.UNKNOWN and existing_node.automation != AutomationLevel.UNKNOWN:
                    automation = existing_node.automation  # Preserve existing
                
                # Check if anything actually changed
                if (existing_node.label == step.text and
                    existing_node.owner == step.who and
                    existing_node.system == step.tool and
                    existing_node.automation == automation and
                    existing_node.type == node_type):
                    continue  # No changes, skip
                
                # Create updated node
                updated_node = ProcessNode(
                    id=step.id,  # Keep existing ID
                    type=node_type,
                    label=step.text,
                    owner=step.who,
                    system=step.tool,
                    automation=automation,
                    logical_id=existing_node.logical_id,  # Preserve
                    user_modified=existing_node.user_modified,  # Preserve
                    created_at=existing_node.created_at,  # Preserve
                    screenshot_url=existing_node.screenshot_url,  # CRITICAL: Preserve screenshot
                    updated_at=datetime.utcnow().isoformat()
                )
                
                # Debug logging for screenshot preservation
                if existing_node.screenshot_url:
                    logger.info(f"INTENT TRANSLATOR: Preserving screenshot_url for node '{step.id[:12]}...': {existing_node.screenshot_url[:50]}...")
                
                operations.append(PatchOperation(type="update_node", node=updated_node))
            else:
                # ADD new node
                node_type = self._map_step_type_to_node_type(step.step_type)
                
                new_node = ProcessNode(
                    id=str(uuid.uuid4()),  # Generate real UUID
                    type=node_type,
                    label=step.text,
                    owner=step.who,
                    system=step.tool,
                    automation=self._map_automation_level(step.manual_auto),
                    created_at=datetime.utcnow().isoformat()
                )
                
                operations.append(PatchOperation(type="add_node", node=new_node))
        
        return operations
    
    def _build_id_mapping(
        self,
        intent: ProcessIntent,
        node_operations: List[PatchOperation],
        existing_node_map: dict
    ) -> dict:
        """
        Build mapping from step IDs (temp or real) to actual node UUIDs.
        
        Returns:
            dict: step_id -> actual_node_uuid
        """
        step_to_node_id = {}
        
        # Map existing node IDs directly
        for node_id in existing_node_map:
            step_to_node_id[node_id] = node_id
        
        # Build a map of operations by their node IDs for quick lookup
        operation_by_node_id = {}
        for operation in node_operations:
            if operation.node:
                operation_by_node_id[operation.node.id] = operation
        
        # First pass: Map update operations
        # For updates, step.id in intent matches the node.id in the operation (both are real UUIDs)
        for step in intent.steps:
            if step.id in existing_node_map:
                # This step references an existing node - map step.id -> step.id (same UUID)
                step_to_node_id[step.id] = step.id
        
        # Second pass: Map add operations to unmapped steps
        # Match add operations to steps that aren't yet mapped (these are new steps with temp IDs)
        add_operations = [op for op in node_operations if op.type == "add_node" and op.node]
        unmapped_steps = [step for step in intent.steps if step.id not in step_to_node_id]
        
        # Match by order: operations are created in the same order as steps in intent
        # So first unmapped step corresponds to first add operation, etc.
        # This works because _create_node_operations processes steps in order
        add_op_index = 0
        for step in intent.steps:
            if step.id not in step_to_node_id:
                # This is an unmapped step - should correspond to an add operation
                if add_op_index < len(add_operations):
                    add_op = add_operations[add_op_index]
                    # Map step's temp_id to the created node's real UUID
                    step_to_node_id[step.id] = add_op.node.id
                    logger.info(
                        "Mapped step '%s' -> node '%s'",
                        step.id[:12],
                        add_op.node.id[:12],
                    )
                    add_op_index += 1
                else:
                    # More unmapped steps than add operations - this shouldn't happen
                    logger.warning(
                        "Warning: Step '%s' has no corresponding add operation",
                        step.id[:12],
                    )
        
        # Validation: Check if any steps are still unmapped
        unmapped_after = [step for step in intent.steps if step.id not in step_to_node_id]
        if unmapped_after:
            logger.warning("Warning: %s steps could not be mapped to nodes", len(unmapped_after))
            for step in unmapped_after:
                logger.warning("Unmapped step '%s': %s", step.id[:12], step.text[:50])
        
        # Also validate that we didn't have more add operations than unmapped steps
        if add_op_index < len(add_operations):
            logger.warning(
                "Warning: %s add operations have no corresponding steps",
                len(add_operations) - add_op_index,
            )
        
        return step_to_node_id
    
    def _create_edge_operations(
        self,
        intent: ProcessIntent,
        step_to_node_id: dict,
        existing_flow: Optional[ProcessFlow]
    ) -> List[PatchOperation]:
        """Create edge operations from intent flows."""
        operations = []
        
        # Build set of existing edges to avoid duplicates
        existing_edges = set()
        if existing_flow:
            for edge in existing_flow.edges:
                existing_edges.add((edge.source, edge.target))
        
        # Build a map of step IDs to step text for better error messages
        step_text_map = {step.id: step.text for step in intent.steps}
        
        skipped_count = 0
        for flow in intent.flows:
            source_node_id = step_to_node_id.get(flow.from_step)
            target_node_id = step_to_node_id.get(flow.to_step)
            
            if not source_node_id or not target_node_id:
                source_text = step_text_map.get(flow.from_step, flow.from_step[:20])
                target_text = step_text_map.get(flow.to_step, flow.to_step[:20])
                logger.warning(
                    "Skipping edge - could not resolve step IDs: '%s' (%s) -> '%s' (%s)",
                    flow.from_step[:12],
                    source_text[:30],
                    flow.to_step[:12],
                    target_text[:30],
                )
                skipped_count += 1
                continue
            
            # Skip if edge already exists
            if (source_node_id, target_node_id) in existing_edges:
                continue
            
            # Create edge
            edge = ProcessEdge(
                id=str(uuid.uuid4()),
                source=source_node_id,
                target=target_node_id,
                condition=flow.condition,
                created_at=datetime.utcnow().isoformat()
            )
            
            operations.append(PatchOperation(type="add_edge", edge=edge))
        
        if skipped_count > 0:
            logger.warning(
                "Skipped %s edges due to unmapped step IDs. This may indicate an issue with step-to-node mapping.",
                skipped_count,
            )
        
        return operations
    
    def _create_deletion_operations(
        self,
        intent: ProcessIntent,
        existing_flow: Optional[ProcessFlow],
        step_to_node_id: dict,
        existing_node_map: dict
    ) -> List[PatchOperation]:
        """Create deletion operations (nodes and edges)."""
        operations = []
        
        if not existing_flow:
            return operations
        
        # Node deletions
        if intent.delete_steps:
            for delete_step in intent.delete_steps:
                # Find node by ID (exact or prefix match)
                node_to_delete = None
                for node in existing_flow.nodes:
                    if (node.id == delete_step.step_id or 
                        node.id.startswith(delete_step.step_id[:8])):
                        node_to_delete = node
                        break
                
                if node_to_delete:
                    operations.append(PatchOperation(
                        type="delete_node",
                        node_id=node_to_delete.id
                    ))
        
        # Edge deletions with defensive filtering
        if intent.delete_flows:
            # Build map of existing edges
            edge_map = {}  # (source, target) -> edge_id
            for edge in existing_flow.edges:
                edge_map[(edge.source, edge.target)] = edge.id
            
            # Build set of edges that are being REPLACED (not just deleted)
            # When inserting B between A->C, we delete A->C but replace it with A->B->C
            replaced_edges = set()
            # Build a map of all new flows by their mapped IDs for efficient lookup
            new_flow_map = {}  # (mapped_from, mapped_to) -> flow
            for flow in intent.flows:
                mapped_from = step_to_node_id.get(flow.from_step, flow.from_step)
                mapped_to = step_to_node_id.get(flow.to_step, flow.to_step)
                new_flow_map[(mapped_from, mapped_to)] = flow
            
            # Check each delete_flow to see if it's being replaced by a chain
            for delete_flow in intent.delete_flows:
                delete_from = step_to_node_id.get(delete_flow.from_step, delete_flow.from_step)
                delete_to = step_to_node_id.get(delete_flow.to_step, delete_flow.to_step)
                
                # Look for replacement chain: A->B->C replacing A->C
                # Find flows that start from delete_from (A->B)
                for (flow_from, flow_to), flow in new_flow_map.items():
                    if flow_from == delete_from:
                        # Found A->B, now check if there's B->C
                        if (flow_to, delete_to) in new_flow_map:
                            # Found replacement chain: A->B->C replacing A->C
                            replaced_edges.add((delete_from, delete_to))
                            print(f"✅ Edge {delete_from[:12]}... → {delete_to[:12]}... is being replaced by chain")
                            break
                if (delete_from, delete_to) in replaced_edges:
                    continue
            
            # Build set of decision nodes that are getting NEW outgoing edges
            # We shouldn't delete existing edges from these decision nodes
            decision_nodes_getting_new_edges = set()
            for flow in intent.flows:
                # Check if source is a decision node (by checking existing flow or intent steps)
                mapped_from = step_to_node_id.get(flow.from_step, flow.from_step)
                source_node = None
                for node in existing_flow.nodes:
                    if node.id == mapped_from:
                        source_node = node
                        break
                
                # Also check intent steps in case it's a new decision node
                if not source_node:
                    for step in intent.steps:
                        if step.id == flow.from_step:
                            if step.step_type == IntentStepType.DECISION:
                                decision_nodes_getting_new_edges.add(mapped_from)
                            break
                
                if source_node and source_node.type == NodeType.DECISION:
                    decision_nodes_getting_new_edges.add(mapped_from)
            
            for delete_flow in intent.delete_flows:
                # Map step IDs to actual node IDs (handles both temp IDs and existing UUIDs)
                mapped_from = step_to_node_id.get(delete_flow.from_step, delete_flow.from_step)
                mapped_to = step_to_node_id.get(delete_flow.to_step, delete_flow.to_step)
                
                # CRITICAL: Only delete edges between EXISTING nodes (both must be in existing flow)
                # If either node is new (not in existing_node_map), skip deletion
                # New nodes don't have edges in the existing flow yet
                from_is_existing = mapped_from in existing_node_map or delete_flow.from_step in existing_node_map
                to_is_existing = mapped_to in existing_node_map or delete_flow.to_step in existing_node_map
                
                if not (from_is_existing and to_is_existing):
                    print(f"⚠️ Skipping edge deletion - one or both nodes are new: {delete_flow.from_step[:12]}... → {delete_flow.to_step[:12]}...")
                    continue
                
                # Find edge by source/target (exact match preferred, then prefix match)
                edge_id_to_delete = None
                source_node_id = None
                
                # Try exact matches first (most reliable)
                exact_match_key = (mapped_from, mapped_to)
                if exact_match_key in edge_map:
                    edge_id_to_delete = edge_map[exact_match_key]
                    source_node_id = mapped_from
                else:
                    # Try with original step IDs
                    original_match_key = (delete_flow.from_step, delete_flow.to_step)
                    if original_match_key in edge_map:
                        edge_id_to_delete = edge_map[original_match_key]
                        source_node_id = delete_flow.from_step
                    else:
                        # Fall back to prefix matching (less reliable but needed for UUID variations)
                        for (source_id, target_id), edge_id in edge_map.items():
                            source_match = False
                            target_match = False
                            
                            # Try multiple matching strategies
                            if source_id == mapped_from or source_id == delete_flow.from_step:
                                source_match = True
                            elif len(mapped_from) >= 8 and source_id.startswith(mapped_from[:8]):
                                source_match = True
                            elif len(delete_flow.from_step) >= 8 and source_id.startswith(delete_flow.from_step[:8]):
                                source_match = True
                            
                            if target_id == mapped_to or target_id == delete_flow.to_step:
                                target_match = True
                            elif len(mapped_to) >= 8 and target_id.startswith(mapped_to[:8]):
                                target_match = True
                            elif len(delete_flow.to_step) >= 8 and target_id.startswith(delete_flow.to_step[:8]):
                                target_match = True
                            
                            if source_match and target_match:
                                edge_id_to_delete = edge_id
                                source_node_id = source_id
                                break
                
                    # Defensive checks: Don't delete edges in certain scenarios
                if edge_id_to_delete:
                    should_skip = False
                    
                    # Check: Don't delete edges from decision nodes that are getting new edges
                    # UNLESS the edge is being replaced (decision node is adding a new branch, not replacing)
                    is_being_replaced = (mapped_from, mapped_to) in replaced_edges
                    
                    for decision_id in decision_nodes_getting_new_edges:
                        if (source_node_id == decision_id or
                            (len(source_node_id) >= 8 and len(decision_id) >= 8 and 
                             (source_node_id.startswith(decision_id[:8]) or decision_id.startswith(source_node_id[:8])))):
                            # Only protect if NOT being replaced (adding new branch vs replacing existing)
                            if not is_being_replaced:
                                print(f"🛡️ Protecting decision node edge from deletion: {delete_flow.from_step[:12]}... → {delete_flow.to_step[:12]}... (decision is getting new edges, not replacing)")
                                should_skip = True
                                break
                            else:
                                print(f"✅ Allowing deletion of decision node edge (being replaced): {delete_flow.from_step[:12]}... → {delete_flow.to_step[:12]}...")
                    
                    if not should_skip:
                        if is_being_replaced:
                            print(f"🗑️ Deleting edge (being replaced): {mapped_from[:12]}... → {mapped_to[:12]}...")
                        operations.append(PatchOperation(
                            type="delete_edge",
                            edge_id=edge_id_to_delete
                        ))
        
        return operations
    
    def _map_step_type_to_node_type(self, step_type: IntentStepType) -> NodeType:
        """Map IntentStepType to NodeType enum."""
        mapping = {
            IntentStepType.START_POINT: NodeType.START,
            IntentStepType.END_POINT: NodeType.END,
            IntentStepType.DECISION: NodeType.DECISION,
            IntentStepType.MERGE: NodeType.MERGE,
            IntentStepType.STEP: NodeType.PROCESS,
        }
        return mapping.get(step_type, NodeType.PROCESS)
    
    def _map_automation_level(self, manual_auto: Optional[str]) -> AutomationLevel:
        """Map semantic automation level to AutomationLevel enum."""
        if not manual_auto:
            return AutomationLevel.UNKNOWN
        
        manual_auto_lower = manual_auto.lower()
        if manual_auto_lower == "manual":
            return AutomationLevel.MANUAL
        elif manual_auto_lower == "automated":
            return AutomationLevel.AUTOMATED
        else:
            return AutomationLevel.UNKNOWN
