"""
React Flow Translator

Converts canonical ProcessFlow to React Flow JSON format.
All positioning, styling, and UI-specific logic is handled here deterministically.
"""

from typing import Dict, List, Any, Tuple
import math
from schemas.process_flow import ProcessFlow, ProcessNode, ProcessEdge, NodeType

class ReactFlowTranslator:
    """
    Deterministic translator from ProcessFlow to React Flow format.
    Handles layout, styling, and UI-specific transformations.
    """
    
    def __init__(self):
        # Node styling configurations
        self.node_styles = {
            NodeType.START: {
                "width": 80,
                "height": 40,
                "borderRadius": "20px",
                "border": "2px solid #28a745",
                "background": "#ffffff",
                "color": "#333"
            },
            NodeType.END: {
                "width": 80,
                "height": 40,
                "borderRadius": "20px", 
                "border": "2px solid #dc3545",
                "background": "#ffffff",
                "color": "#333"
            },
            NodeType.PROCESS: {
                "width": 160,
                "height": 100,
                "borderRadius": "8px",
                "border": "2px solid #007bff",
                "background": "#ffffff",
                "color": "#333"
            },
            NodeType.DECISION: {
                "width": 100,
                "height": 100,
                "background": "transparent",
                "border": "none"
            },
            NodeType.MERGE: {
                "width": 60,
                "height": 60,
                "borderRadius": "50%",
                "border": "2px solid #007bff",
                "background": "#ffffff",
                "color": "#333"
            }
        }
        
        # Edge styling
        self.edge_style = {
            "strokeWidth": 2,
            "stroke": "#007bff"
        }
        
        self.marker_end = {
            "type": "arrowclosed",
            "width": 20,
            "height": 20
        }
    
    def translate(
        self, 
        flow: ProcessFlow, 
        layout_algorithm: str = "hierarchical",
        existing_positions: Dict[str, Dict[str, float]] = None,
        auto_layout: bool = False,
        existing_handle_positions: Dict[str, Dict[str, Any]] = None,
        existing_edge_handles: Dict[str, Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Convert ProcessFlow to React Flow format.
        
        Args:
            flow: Canonical process flow
            layout_algorithm: "hierarchical", "force", "relative", or "auto"
            existing_positions: Dict mapping node_id to {"x": float, "y": float} for preserving positions
            auto_layout: If True, overwrite all positions (ignores user edits)
            
        Returns:
            Dict containing nodes and edges in React Flow format
        """
        # Convert nodes
        react_nodes = []
        for node in flow.nodes:
            react_node = self._convert_node(node)
            react_nodes.append(react_node)
        
        # Convert edges  
        react_edges = []
        for edge in flow.edges:
            react_edge = self._convert_edge(edge, flow.nodes)
            # Preserve handle positions if provided
            if existing_edge_handles and edge.id in existing_edge_handles:
                handle_info = existing_edge_handles[edge.id]
                if handle_info.get('sourceHandle'):
                    react_edge['sourceHandle'] = handle_info['sourceHandle']
                if handle_info.get('targetHandle'):
                    react_edge['targetHandle'] = handle_info['targetHandle']
            react_edges.append(react_edge)
        
        # Apply layout
        if auto_layout or layout_algorithm == "auto":
            # Auto-layout: completely recalculate all positions
            handle_positions = existing_handle_positions if existing_handle_positions is not None else {}
            react_nodes = self._apply_auto_layout(react_nodes, react_edges, handle_positions)
        elif layout_algorithm == "relative":
            # Relative positioning: preserve Y positions, adjust X for insertions
            react_nodes = self._apply_relative_layout(react_nodes, react_edges, existing_positions or {})
            # Preserve handle positions for existing nodes
            if existing_handle_positions:
                for node in react_nodes:
                    node_id = node.get('id')
                    if node_id and node_id in existing_handle_positions:
                        handle_info = existing_handle_positions[node_id]
                        if handle_info.get('sourcePosition'):
                            node['sourcePosition'] = handle_info['sourcePosition']
                        if handle_info.get('targetPosition'):
                            node['targetPosition'] = handle_info['targetPosition']
        elif layout_algorithm == "hierarchical":
            handle_positions_for_hierarchical = existing_handle_positions if existing_handle_positions is not None else {}
            react_nodes = self._apply_hierarchical_layout(
                react_nodes, 
                react_edges, 
                existing_positions or {},
                handle_positions_for_hierarchical
            )
        elif layout_algorithm == "force":
            react_nodes = self._apply_force_layout(react_nodes, react_edges)
        # "manual" uses existing positions or defaults
        
        # Apply handle positions to edges after layout
        if existing_edge_handles:
            for react_edge in react_edges:
                edge_id = react_edge.get('id')
                if edge_id and edge_id in existing_edge_handles:
                    handle_info = existing_edge_handles[edge_id]
                    if handle_info.get('sourceHandle'):
                        react_edge['sourceHandle'] = handle_info['sourceHandle']
                    if handle_info.get('targetHandle'):
                        react_edge['targetHandle'] = handle_info['targetHandle']
        
        return {
            "nodes": react_nodes,
            "edges": react_edges,
            "metadata": {
                "flow_id": getattr(flow, 'id', 'generated'),
                "flow_name": getattr(flow, 'name', 'Process Flow'),
                "schema_version": getattr(flow, 'version', '1.0'),
                "layout_algorithm": layout_algorithm
            }
        }
    
    def _convert_node(self, node: ProcessNode) -> Dict[str, Any]:
        """Convert ProcessNode to React Flow node format"""
        
        # Determine React Flow node type
        rf_type = self._get_react_flow_type(node.type)
        
        # Base node structure
        react_node = {
            "id": node.id,
            "type": rf_type,
            "position": {"x": 0, "y": 0},  # Will be set by layout
            "data": {
                "label": node.label,
                "id": node.id,
                "logical_id": node.logical_id or "",
                "owner": node.owner or "TBD",
                "system": node.system or "TBD", 
                "manualOrAutomated": node.automation.value,
                "type": node.type.value,
                "user_modified": node.user_modified,
                "screenshot_url": node.screenshot_url
            },
            "style": self.node_styles[node.type].copy()
        }
        
        # Set handle positions for merge nodes to use middle
        if node.type == NodeType.MERGE:
            react_node["targetPosition"] = "left"
            react_node["sourcePosition"] = "right"
        
        return react_node
    
    def _convert_edge(self, edge: ProcessEdge, nodes: List[ProcessNode]) -> Dict[str, Any]:
        """Convert ProcessEdge to React Flow edge format"""
        
        # Find source node to determine if this edge needs a label
        source_node = next((n for n in nodes if n.id == edge.source), None)
        is_decision_edge = source_node and source_node.type == NodeType.DECISION
        
        react_edge = {
            "id": edge.id,
            "source": edge.source,
            "target": edge.target,
            "type": "step",
            "style": self.edge_style.copy(),
            "markerEnd": self.marker_end.copy()
        }
        
        # Add labels for decision edges
        if is_decision_edge and edge.condition:
            react_edge["label"] = edge.condition
            react_edge["labelStyle"] = {
                "fontSize": 12,
                "fontWeight": "bold", 
                "fill": "#333"
            }
            react_edge["labelBgStyle"] = {
                "fill": "#fff",
                "fillOpacity": 0.8,
                "stroke": "#333",
                "strokeWidth": 1,
                "rx": 4,
                "ry": 4
            }
        
        return react_edge
    
    def _get_react_flow_type(self, node_type: NodeType) -> str:
        """Map canonical node type to React Flow component type"""
        mapping = {
            NodeType.START: "start",
            NodeType.END: "end", 
            NodeType.PROCESS: "default",
            NodeType.DECISION: "decision",
            NodeType.MERGE: "merge"
        }
        return mapping[node_type]
    
    def _apply_auto_layout(self, nodes: List[Dict], edges: List[Dict], existing_handle_positions: Dict[str, Dict[str, Any]] = None) -> List[Dict]:
        """
        Auto-layout: Completely recalculate all positions for natural flow.
        This overwrites all user edits to position but preserves handle positions.
        """
        positioned_nodes = self._apply_hierarchical_layout(nodes, edges, existing_positions={}, existing_handle_positions=existing_handle_positions)
        
        # Preserve handle positions (sourcePosition, targetPosition) even in auto-layout
        if existing_handle_positions:
            for node in positioned_nodes:
                node_id = node.get('id')
                if node_id and node_id in existing_handle_positions:
                    handle_info = existing_handle_positions[node_id]
                    if handle_info.get('sourcePosition'):
                        node['sourcePosition'] = handle_info['sourcePosition']
                    if handle_info.get('targetPosition'):
                        node['targetPosition'] = handle_info['targetPosition']
        
        return positioned_nodes
    
    def _apply_relative_layout(
        self, 
        nodes: List[Dict], 
        edges: List[Dict], 
        existing_positions: Dict[str, Dict[str, float]]
    ) -> List[Dict]:
        """
        Relative positioning: When inserting nodes, place them between existing nodes
        and shift adjacent nodes. Preserves Y positions (vertical lanes) but adjusts X.
        """
        if not nodes:
            return nodes
        
        # Build adjacency graph to understand flow structure
        adjacency = {}
        incoming = {}
        for edge in edges:
            source, target = edge["source"], edge["target"]
            if source not in adjacency:
                adjacency[source] = []
            adjacency[source].append(target)
            if target not in incoming:
                incoming[target] = []
            incoming[target].append(source)
        
        # Identify new nodes (not in existing_positions)
        if not existing_positions:
            existing_positions = {}
        existing_node_ids = set(existing_positions.keys())
        new_nodes = [n for n in nodes if n["id"] not in existing_node_ids]
        existing_nodes = [n for n in nodes if n["id"] in existing_node_ids]
        
        # Start with existing positions (preserve Y, will adjust X)
        positioned_nodes = []
        node_positions = {}
        
        # First, preserve existing positions (especially Y)
        for node in existing_nodes:
            node_id = node["id"]
            existing_pos = existing_positions.get(node_id, {"x": 0, "y": 0})
            node_positions[node_id] = {
                "x": existing_pos.get("x", 0),
                "y": existing_pos.get("y", 0)  # Preserve Y position (vertical lane)
            }
        
        # For new nodes, find where they should be inserted
        for new_node in new_nodes:
            new_node_id = new_node["id"]
            
            # Find incoming and outgoing edges for this new node
            incoming_nodes = incoming.get(new_node_id, [])
            outgoing_nodes = adjacency.get(new_node_id, [])
            
            if incoming_nodes and outgoing_nodes:
                # Node is inserted between two nodes: A -> B -> C
                source_id = incoming_nodes[0]
                target_id = outgoing_nodes[0]
                
                # Get positions - source should exist, target might be new or existing
                source_pos = node_positions.get(source_id)
                if not source_pos:
                    # Source not found in positions, try to get from existing_positions
                    source_pos = existing_positions.get(source_id)
                    if source_pos:
                        node_positions[source_id] = {
                            "x": source_pos.get("x", 0),
                            "y": source_pos.get("y", 0)
                        }
                        source_pos = node_positions[source_id]
                
                target_pos = node_positions.get(target_id)
                if not target_pos:
                    # Target might be new or not yet positioned, check existing_positions
                    target_pos = existing_positions.get(target_id)
                    if target_pos:
                        node_positions[target_id] = {
                            "x": target_pos.get("x", 0),
                            "y": target_pos.get("y", 0)
                        }
                        target_pos = node_positions[target_id]
                
                if source_pos:
                    # Always place new node to the right of source with minimum spacing
                    min_spacing = 250  # Minimum horizontal spacing to prevent overlap
                    new_x = source_pos["x"] + min_spacing
                    new_y = source_pos["y"]  # Use Y position from source (preserve vertical lane)
                    
                    # Place the new node first
                    node_positions[new_node_id] = {"x": new_x, "y": new_y}
                    
                    # If target exists, we need to ensure it's to the right of the new node
                    if target_pos:
                        required_target_x = new_x + min_spacing
                        if target_pos["x"] < required_target_x:
                            # Target needs to be shifted right
                            shift_amount = required_target_x - target_pos["x"]
                            target_pos["x"] = required_target_x
                            node_positions[target_id] = target_pos
                            # Shift all nodes downstream from target by the same amount
                            self._shift_nodes_right(node_positions, target_id, shift_amount, adjacency, set())
                    else:
                        # Target doesn't exist yet - it will be positioned later
                        # But we should still ensure downstream nodes are shifted if they exist
                        # Find any nodes that might be downstream and shift them
                        pass
                    
                    print(f"✅ Placed new node {new_node_id[:12]}... at x={new_x}, y={new_y} (between {source_id[:12]}... and {target_id[:12] if target_id else 'unknown'}...)")
                else:
                    # No source position - fallback
                    node_positions[new_node_id] = {"x": 0, "y": 0}
            elif incoming_nodes:
                # Only incoming edges, place after source
                source_id = incoming_nodes[0]
                source_pos = node_positions.get(source_id)
                if source_pos:
                    node_positions[new_node_id] = {
                        "x": source_pos["x"] + 250,
                        "y": source_pos["y"]
                    }
                else:
                    node_positions[new_node_id] = {"x": 0, "y": 0}
            elif outgoing_nodes:
                # Only outgoing edges, place before target
                target_id = outgoing_nodes[0]
                target_pos = node_positions.get(target_id)
                if target_pos:
                    node_positions[new_node_id] = {
                        "x": target_pos["x"] - 250,
                        "y": target_pos["y"]
                    }
                else:
                    node_positions[new_node_id] = {"x": 0, "y": 0}
            else:
                # Isolated node, use default
                node_positions[new_node_id] = {"x": 0, "y": 0}
        
        # Apply positions to all nodes
        for node in nodes:
            node_id = node["id"]
            position = node_positions.get(node_id, {"x": 0, "y": 0})
            positioned_node = node.copy()
            positioned_node["position"] = position
            positioned_nodes.append(positioned_node)
        
        return positioned_nodes
    
    def _shift_nodes_right(
        self,
        node_positions: Dict[str, Dict[str, float]],
        start_node_id: str,
        shift_distance: float,
        adjacency: Dict[str, List[str]],
        visited: set
    ):
        """Recursively shift nodes to the right of a given node."""
        if start_node_id in visited:
            return
        
        visited.add(start_node_id)
        
        # Shift this node if it exists in positions
        if start_node_id in node_positions:
            node_positions[start_node_id]["x"] += shift_distance
        
        # Shift all nodes reachable from this node (downstream)
        for child_id in adjacency.get(start_node_id, []):
            if child_id not in visited:  # Prevent infinite loops
                self._shift_nodes_right(node_positions, child_id, shift_distance, adjacency, visited)
    
    def _check_overlap(
        self,
        node_positions: Dict[str, Dict[str, float]],
        new_node_id: str,
        new_x: float,
        new_y: float,
        node_width: float = 160,
        node_height: float = 100
    ) -> bool:
        """Check if a new node position would overlap with existing nodes."""
        for node_id, pos in node_positions.items():
            if node_id == new_node_id:
                continue
            
            # Check horizontal overlap (with some padding)
            x_overlap = abs(pos["x"] - new_x) < (node_width + 50)
            # Check vertical overlap (with some padding)
            y_overlap = abs(pos["y"] - new_y) < (node_height + 50)
            
            if x_overlap and y_overlap:
                return True
        
        return False
    
    def _apply_hierarchical_layout(
        self, 
        nodes: List[Dict], 
        edges: List[Dict],
        existing_positions: Dict[str, Dict[str, float]] = None,
        existing_handle_positions: Dict[str, Dict[str, Any]] = None
    ) -> List[Dict]:
        """
        Apply strict hierarchical layout following business flow rules:
        - Rule 1: X = step_index * horizontal_spacing (300-350px)
        - Rule 2: Decisions expand vertically by 180px (top: Y-180, bottom: Y+180)
        - Rule 3: Merges at decision_x + spacing, y = average of branches
        - Rule 4: Parallel tasks at same depth, y offset +220px
        - Rule 5: Merges never before decisions
        """
        if not nodes:
            return nodes
        
        # Constants
        HORIZONTAL_SPACING = 300  # Rule 1: 300-350px
        BRANCH_OFFSET = 180  # Rule 2: 180px vertical expansion for decisions
        PARALLEL_OFFSET = 220  # Rule 4: 220px for parallel tasks
        
        # Build graph structures
        adjacency = {}  # node_id -> [target_ids]
        incoming = {}  # node_id -> [source_ids]
        node_map = {node["id"]: node for node in nodes}
        
        for edge in edges:
            source, target = edge["source"], edge["target"]
            if source not in adjacency:
                adjacency[source] = []
            adjacency[source].append(target)
            if target not in incoming:
                incoming[target] = []
            incoming[target].append(source)
        
        # Sort for deterministic layout
        for source in adjacency:
            adjacency[source].sort()
        
        # Find start nodes
        start_nodes = [n["id"] for n in nodes if n["id"] not in incoming]
        if not start_nodes:
            start_nodes = [nodes[0]["id"]]
        start_nodes.sort()
        
        # Rule 1: Assign step indices (depth_index) using topological sort
        step_indices = {}  # node_id -> step_index
        visited = set()
        queue = [(node_id, 0) for node_id in start_nodes]
        
        # Detect back-edges to handle cycles
        back_edges = set()
        visited_dfs = set()
        recursion_stack = set()
        
        def detect_cycles(node_id):
            visited_dfs.add(node_id)
            recursion_stack.add(node_id)
            for child in sorted(adjacency.get(node_id, [])):
                if child not in visited_dfs:
                    detect_cycles(child)
                elif child in recursion_stack:
                    back_edges.add((node_id, child))
            recursion_stack.remove(node_id)
        
        for node_id in start_nodes:
            if node_id not in visited_dfs:
                detect_cycles(node_id)
        
        # Assign step indices (BFS, ignoring back-edges)
        # Use a more robust approach: process all nodes, use max step_index for multiple paths
        while queue:
            node_id, step_index = queue.pop(0)
            
            # Always use max step_index for nodes with multiple paths
            if node_id in step_indices:
                if step_indices[node_id] < step_index:
                    step_indices[node_id] = step_index
                else:
                    # Already have a better (higher) step_index, skip processing children
                    continue
            else:
                step_indices[node_id] = step_index
                visited.add(node_id)
            
            # Add children to next step (primary transitions increment step_index)
            for child in sorted(adjacency.get(node_id, [])):
                if (node_id, child) not in back_edges:
                    # Add to queue (will handle duplicates by using max step_index)
                    queue.append((child, step_index + 1))
        
        # Handle unvisited nodes - assign based on their incoming edges
        for node in nodes:
            node_id = node["id"]
            if node_id not in step_indices:
                # Find max step_index of incoming nodes + 1
                max_incoming_step = -1
                for source_id in incoming.get(node_id, []):
                    if source_id in step_indices:
                        max_incoming_step = max(max_incoming_step, step_indices[source_id])
                
                if max_incoming_step >= 0:
                    step_indices[node_id] = max_incoming_step + 1
                else:
                    # Orphaned node - assign a high step_index
                    step_indices[node_id] = max(step_indices.values()) + 1 if step_indices else 0
        
        # Step 1: Identify decision nodes and their branches
        decision_branches = {}  # decision_id -> {branch_id: branch_y_offset}
        
        for node in nodes:
            node_id = node["id"]
            node_type = node.get("type", "default")
            
            if node_type == "decision":
                # Find outgoing branches
                outgoing = sorted(adjacency.get(node_id, []))
                if len(outgoing) >= 2:
                    # Rule 2: Top branch at Y-180, bottom at Y+180
                    branch_offsets = {}
                    for i, branch_id in enumerate(outgoing):
                        if i == 0:
                            branch_offsets[branch_id] = -BRANCH_OFFSET  # Top
                        elif i == 1:
                            branch_offsets[branch_id] = BRANCH_OFFSET  # Bottom
                        else:
                            branch_offsets[branch_id] = BRANCH_OFFSET * (i - 1)  # Additional branches
                    decision_branches[node_id] = branch_offsets
        
        # Step 2: Identify merges and trace back to their decisions
        merge_decisions = {}  # merge_id -> decision_id
        
        for node in nodes:
            node_id = node["id"]
            node_type = node.get("type", "default")
            
            if node_type == "merge":
                # Rule 3: Find which decision this merge belongs to
                # A merge has multiple incoming edges - find common decision ancestor
                incoming_from = incoming.get(node_id, [])
                
                if len(incoming_from) >= 2:
                    # Find decisions that feed into this merge by tracing back
                    candidate_decisions = set()
                    
                    def trace_to_decisions(node_id, visited=None, depth=0):
                        """Trace back from a node to find all decisions that lead to it"""
                        if visited is None:
                            visited = set()
                        if node_id in visited or depth > 50:  # Prevent infinite loops
                            return set()
                        visited.add(node_id)
                        
                        decisions = set()
                        node = node_map.get(node_id)
                        if node and node.get("type") == "decision":
                            decisions.add(node_id)
                            return decisions  # Found decision, stop here
                        
                        # Check if this node is a direct branch of a decision
                        for decision_id, branches in decision_branches.items():
                            if node_id in branches:
                                decisions.add(decision_id)
                                return decisions  # Found decision branch, return the decision
                        
                        # Trace back through incoming edges
                        for parent_id in incoming.get(node_id, []):
                            parent_decisions = trace_to_decisions(parent_id, visited.copy(), depth + 1)
                            decisions.update(parent_decisions)
                        
                        return decisions
                    
                    # Trace back from each incoming node to find decisions
                    for source_id in incoming_from:
                        decisions = trace_to_decisions(source_id)
                        candidate_decisions.update(decisions)
                    
                    # Use the decision with the highest step_index (most recent decision)
                    if candidate_decisions:
                        best_decision = max(candidate_decisions, key=lambda d: step_indices.get(d, 0))
                        merge_decisions[node_id] = best_decision
        
        # Calculate positions
        node_positions = {}
        decision_base_y = {}  # decision_id -> base_y
        
        # Build set of nodes that are direct branches (first nodes after decision)
        direct_branches = set()
        for branches in decision_branches.values():
            direct_branches.update(branches.keys())
        
        # Build set of nodes in branch paths (reachable from branches until merge)
        nodes_in_branch_paths = set()
        for decision_id, branches in decision_branches.items():
            for branch_id in branches.keys():
                visited_branch = set()
                queue_branch = [branch_id]
                while queue_branch:
                    current = queue_branch.pop(0)
                    if current in visited_branch:
                        continue
                    visited_branch.add(current)
                    nodes_in_branch_paths.add(current)
                    
                    # Stop at merges
                    current_node = node_map.get(current)
                    if current_node and current_node.get("type") == "merge":
                        continue
                    
                    # Add children
                    for child_id in adjacency.get(current, []):
                        if child_id not in visited_branch:
                            queue_branch.append(child_id)
        
        # First pass: Position all main flow nodes (not in branch paths, not merges)
        for node in nodes:
            node_id = node["id"]
            node_type = node.get("type", "default")
            
            # Skip merges (positioned in third pass)
            if node_type == "merge":
                continue
            
            # Skip nodes in branch paths (positioned in second pass)
            if node_id in nodes_in_branch_paths:
                continue
            
            # Rule 1: X = step_index * horizontal_spacing
            step_index = step_indices.get(node_id, 0)
            x = step_index * HORIZONTAL_SPACING
            
            # Default Y
            y = 0
            
            if node_type == "decision":
                # Decision at base Y = 0 (will expand branches)
                decision_base_y[node_id] = y
            elif node_type == "start":
                y = 0
            elif node_type == "end":
                y = 0
            
            node_positions[node_id] = {"x": x, "y": y}
        
        # Second pass: Position decision branches and all nodes in branch paths
        for decision_id, branches in decision_branches.items():
            base_y = decision_base_y.get(decision_id, 0)
            
            # Position each branch and all nodes downstream from it
            for branch_id, y_offset in branches.items():
                # Position immediate branch node
                step_index = step_indices.get(branch_id, 0)
                x = step_index * HORIZONTAL_SPACING
                y = base_y + y_offset
                node_positions[branch_id] = {"x": x, "y": y}
                
                # Position all nodes downstream from this branch (until merge)
                visited_branch = set()
                queue_branch = [branch_id]
                
                while queue_branch:
                    current = queue_branch.pop(0)
                    if current in visited_branch:
                        continue
                    visited_branch.add(current)
                    
                    # Stop at merges (they're positioned in third pass)
                    current_node = node_map.get(current)
                    if current_node and current_node.get("type") == "merge":
                        continue
                    
                    # Position this node with same y_offset as branch
                    if current not in node_positions:
                        step_index = step_indices.get(current, 0)
                        x = step_index * HORIZONTAL_SPACING
                        y = base_y + y_offset
                        node_positions[current] = {"x": x, "y": y}
                    
                    # Add children to queue (continue down the branch path)
                    for child_id in sorted(adjacency.get(current, [])):
                        child_node = node_map.get(child_id)
                        # Stop if we hit a merge (it will be positioned separately)
                        if child_node and child_node.get("type") == "merge":
                            continue
                        if child_id not in visited_branch:
                            queue_branch.append(child_id)
        
        # Third pass: Position merges (Rule 3)
        # NEW: Check if merge is a "loop-back" merge (outputs to a node earlier in the flow)
        for node in nodes:
            node_id = node["id"]
            node_type = node.get("type", "default")
            
            if node_type != "merge":
                continue
            
            merge_id = node_id
            merge_incoming = incoming.get(merge_id, [])
            merge_outgoing = adjacency.get(merge_id, [])
            
            # Check if this is a loop-back merge
            # A loop-back merge outputs to a node that comes BEFORE the merge's incoming nodes
            is_loop_back_merge = False
            loop_back_target_id = None
            loop_back_target_step = None
            
            if merge_outgoing:
                target_id = merge_outgoing[0]  # Merge typically has one output
                target_step = step_indices.get(target_id, 0)
                
                # Find max step_index of incoming nodes
                max_incoming_step = 0
                for source_id in merge_incoming:
                    source_step = step_indices.get(source_id, 0)
                    if source_step > max_incoming_step:
                        max_incoming_step = source_step
                
                # If target comes before (or at) the incoming nodes, it's a loop-back
                # Also check if target is already positioned
                if target_step <= max_incoming_step and target_id in node_positions:
                    is_loop_back_merge = True
                    loop_back_target_id = target_id
                    loop_back_target_step = target_step
            
            if is_loop_back_merge and loop_back_target_id:
                # Position merge BEFORE its target (to the left of the target)
                target_pos = node_positions.get(loop_back_target_id, {})
                target_x = target_pos.get("x", 0)
                target_y = target_pos.get("y", 0)
                
                # Place merge one step before target
                merge_x = target_x - HORIZONTAL_SPACING
                
                # Y position: average of incoming Y positions, or same as target
                incoming_ys = []
                for source_id in merge_incoming:
                    source_pos = node_positions.get(source_id)
                    if source_pos:
                        incoming_ys.append(source_pos["y"])
                
                if incoming_ys:
                    # Use an offset above the target to show it's a merge point
                    merge_y = target_y - 60  # Slightly above target
                else:
                    merge_y = target_y - 60
                
                node_positions[merge_id] = {"x": merge_x, "y": merge_y}
                print(f"📍 Loop-back merge '{merge_id[:12]}...' positioned at x={merge_x} (before target '{loop_back_target_id[:12]}...' at x={target_x})")
                continue
            
            if merge_id in merge_decisions:
                # Merge has associated decision - use Rule 3
                decision_id = merge_decisions[merge_id]
                if decision_id in decision_base_y:
                    decision_x = node_positions.get(decision_id, {}).get("x", 0)
                    decision_y = decision_base_y[decision_id]
                    
                    # Find the max step_index of nodes that feed into this merge
                    max_step = step_indices.get(decision_id, 0)
                    for source_id in merge_incoming:
                        source_step = step_indices.get(source_id, 0)
                        if source_step > max_step:
                            max_step = source_step
                    
                    # Rule 3: merge_x should be at the convergence point (one step after max branch step)
                    merge_x = (max_step + 1) * HORIZONTAL_SPACING
                    
                    # Rule 5: Ensure merge_x > decision_x
                    if merge_x <= decision_x:
                        merge_x = decision_x + HORIZONTAL_SPACING
                    
                    # Rule 3: merge_y = average of positions of nodes that feed into merge
                    incoming_ys = []
                    for source_id in merge_incoming:
                        source_pos = node_positions.get(source_id)
                        if source_pos:
                            incoming_ys.append(source_pos["y"])
                    
                    if incoming_ys:
                        merge_y = sum(incoming_ys) / len(incoming_ys)
                    else:
                        merge_y = decision_y
                    
                    node_positions[merge_id] = {"x": merge_x, "y": merge_y}
                    continue
            
            # Fallback: Merge without associated decision - position based on incoming nodes
            if merge_incoming:
                # Use max step_index of incoming nodes + 1
                max_step = -1
                incoming_ys = []
                for source_id in merge_incoming:
                    source_step = step_indices.get(source_id, -1)
                    if source_step > max_step:
                        max_step = source_step
                    source_pos = node_positions.get(source_id)
                    if source_pos:
                        incoming_ys.append(source_pos["y"])
                
                merge_x = (max_step + 1) * HORIZONTAL_SPACING if max_step >= 0 else 0
                merge_y = sum(incoming_ys) / len(incoming_ys) if incoming_ys else 0
                node_positions[merge_id] = {"x": merge_x, "y": merge_y}
            else:
                # Orphaned merge - use step_index
                step_index = step_indices.get(merge_id, 0)
                node_positions[merge_id] = {"x": step_index * HORIZONTAL_SPACING, "y": 0}
        
        # Final pass: Ensure ALL nodes are positioned (fallback for any missed nodes)
        for node in nodes:
            node_id = node["id"]
            if node_id not in node_positions:
                # Fallback: position based on step_index
                step_index = step_indices.get(node_id, 0)
                x = step_index * HORIZONTAL_SPACING
                y = 0
                node_positions[node_id] = {"x": x, "y": y}
                print(f"⚠️ Fallback positioning for node {node_id[:12]}... at step_index={step_index}, x={x}")
        
        # Apply positions to nodes
        positioned_nodes = []
        for node in nodes:
            node_id = node["id"]
            pos = node_positions.get(node_id, {"x": 0, "y": 0})
            
            # Double-check: if still at (0,0) and not start node, use step_index
            if pos["x"] == 0 and pos["y"] == 0:
                node_type = node.get("type", "default")
                if node_type != "start":
                    step_index = step_indices.get(node_id, 0)
                    pos = {"x": step_index * HORIZONTAL_SPACING, "y": 0}
                    print(f"⚠️ Corrected (0,0) position for node {node_id[:12]}... to x={pos['x']}")
            
            positioned_node = node.copy()
            positioned_node["position"] = pos
            
            # Preserve handle positions if provided
            if existing_handle_positions and node_id in existing_handle_positions:
                handle_info = existing_handle_positions[node_id]
                if handle_info.get('sourcePosition'):
                    positioned_node['sourcePosition'] = handle_info['sourcePosition']
                if handle_info.get('targetPosition'):
                    positioned_node['targetPosition'] = handle_info['targetPosition']
            
            positioned_nodes.append(positioned_node)
        
        return positioned_nodes
    
    def _apply_force_layout(self, nodes: List[Dict], edges: List[Dict]) -> List[Dict]:
        """
        Apply force-directed layout (simplified spring model).
        """
        if len(nodes) <= 1:
            return nodes
            
        # Initialize random positions
        import random
        positioned_nodes = []
        for i, node in enumerate(nodes):
            positioned_node = node.copy()
            positioned_node["position"] = {
                "x": random.uniform(-200, 200),
                "y": random.uniform(-200, 200)
            }
            positioned_nodes.append(positioned_node)
        
        # Simple force simulation (would use D3 force simulation in production)
        iterations = 50
        for _ in range(iterations):
            # Repulsion between all nodes
            for i, node1 in enumerate(positioned_nodes):
                for j, node2 in enumerate(positioned_nodes):
                    if i != j:
                        dx = node1["position"]["x"] - node2["position"]["x"]
                        dy = node1["position"]["y"] - node2["position"]["y"]
                        distance = math.sqrt(dx*dx + dy*dy)
                        if distance > 0:
                            force = 1000 / (distance * distance)
                            node1["position"]["x"] += (dx / distance) * force
                            node1["position"]["y"] += (dy / distance) * force
            
            # Attraction along edges
            for edge in edges:
                source_node = next(n for n in positioned_nodes if n["id"] == edge["source"])
                target_node = next(n for n in positioned_nodes if n["id"] == edge["target"])
                
                dx = target_node["position"]["x"] - source_node["position"]["x"]
                dy = target_node["position"]["y"] - source_node["position"]["y"]
                distance = math.sqrt(dx*dx + dy*dy)
                
                if distance > 0:
                    force = distance * 0.01
                    move_x = (dx / distance) * force
                    move_y = (dy / distance) * force
                    
                    source_node["position"]["x"] += move_x
                    source_node["position"]["y"] += move_y
                    target_node["position"]["x"] -= move_x
                    target_node["position"]["y"] -= move_y
        
        return positioned_nodes
