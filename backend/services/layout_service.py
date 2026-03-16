"""
Layout Service - Centralized Node Positioning and Edge Routing

Handles all layout computation with two modes:
1. Full Auto-Layout: Recalculates all positions using hierarchical layout
2. Incremental Layout: Preserves existing positions, makes room for new nodes

Key features:
- Parallel node detection and lane assignment
- Orthogonal edge routing with waypoints
- User edit preservation
"""

from typing import Dict, List, Any, Tuple, Optional, Set
from dataclasses import dataclass
from collections import defaultdict
import math


@dataclass
class LayoutConfig:
    """Configuration for layout algorithms"""
    horizontal_spacing: int = 300  # Space between columns (step indices)
    vertical_spacing: int = 200    # Space between lanes
    branch_offset: int = 180       # Vertical offset for decision branches
    node_width: int = 200          # Default node width for collision detection
    node_height: int = 140         # Default node height for collision detection
    edge_spacing: int = 20         # Minimum space between parallel edges
    min_waypoint_offset: int = 50  # Minimum offset for edge waypoints


class LayoutService:
    """
    Centralized service for node positioning and edge routing.
    
    Responsibilities:
    - Calculate node positions (x, y) based on flow topology
    - Detect parallel activities and assign lanes
    - Route edges with orthogonal waypoints
    - Handle incremental updates without disrupting user edits
    """
    
    def __init__(self, config: Optional[LayoutConfig] = None):
        self.config = config or LayoutConfig()
    
    def apply_full_layout(
        self,
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
        preserve_user_modified: bool = True
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Apply complete auto-layout to all nodes and edges.
        
        Args:
            nodes: List of node dictionaries with id, type, data
            edges: List of edge dictionaries with source, target
            preserve_user_modified: If True, preserve positions of user-modified nodes
            
        Returns:
            Tuple of (positioned_nodes, routed_edges)
        """
        if not nodes:
            return nodes, edges
        
        # Build graph structures
        graph = self._build_graph(nodes, edges)
        
        # Step 1: Topological sort to get step indices (x positions)
        step_indices = self._compute_step_indices(graph)
        
        # Step 2: Detect parallel nodes and assign lanes (y positions)
        lane_assignments = self._assign_lanes(graph, step_indices)
        
        # Step 3: Calculate node positions (pass graph for merge node positioning)
        positioned_nodes = self._calculate_node_positions(
            nodes, step_indices, lane_assignments, preserve_user_modified, graph
        )
        
        # Step 4: Route edges with orthogonal waypoints
        routed_edges = self._route_edges(positioned_nodes, edges, preserve_user_modified)
        
        return positioned_nodes, routed_edges
    
    def apply_incremental_layout(
        self,
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
        new_node_ids: Set[str],
        existing_positions: Dict[str, Dict[str, float]]
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Apply incremental layout that preserves existing positions.
        
        New nodes are placed at midpoints between their source/target,
        and downstream nodes are shifted to make room.
        
        Args:
            nodes: All nodes (existing + new)
            edges: All edges (existing + new)
            new_node_ids: Set of IDs for newly added nodes
            existing_positions: Dict mapping node_id to {x, y}
            
        Returns:
            Tuple of (positioned_nodes, routed_edges)
        """
        if not nodes:
            return nodes, edges
        
        # Build graph
        graph = self._build_graph(nodes, edges)
        
        # Step 1: Position new nodes at midpoints
        node_positions = self._position_new_nodes(
            graph, new_node_ids, existing_positions
        )
        
        # Step 2: Shift existing nodes if needed to avoid collisions
        node_positions = self._resolve_collisions(
            nodes, node_positions, new_node_ids
        )
        
        # Step 3: Apply positions to nodes
        positioned_nodes = []
        for node in nodes:
            node_copy = node.copy()
            if node['id'] in node_positions:
                node_copy['position'] = node_positions[node['id']]
            elif node['id'] in existing_positions:
                node_copy['position'] = existing_positions[node['id']]
            else:
                # Fallback - should not happen
                node_copy['position'] = {'x': 0, 'y': 0}
            positioned_nodes.append(node_copy)
        
        # Step 4: Route edges (preserve user modifications in incremental layout)
        routed_edges = self._route_edges(positioned_nodes, edges, preserve_user_modified=True)
        
        return positioned_nodes, routed_edges
    
    def _build_graph(
        self,
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Build graph data structures for layout algorithms."""
        node_map = {node['id']: node for node in nodes}
        adjacency = defaultdict(list)  # source -> [targets]
        incoming = defaultdict(list)   # target -> [sources]
        
        for edge in edges:
            source = edge.get('source')
            target = edge.get('target')
            if source and target and source in node_map and target in node_map:
                adjacency[source].append(target)
                incoming[target].append(source)
        
        # Find start nodes (no incoming edges)
        start_nodes = [
            n['id'] for n in nodes 
            if n['id'] not in incoming or len(incoming[n['id']]) == 0
        ]
        
        # If no start nodes found, use nodes of type 'start'
        if not start_nodes:
            start_nodes = [
                n['id'] for n in nodes 
                if n.get('type') == 'start' or 
                   n.get('data', {}).get('type') == 'start'
            ]
        
        # If still no start nodes, use first node
        if not start_nodes and nodes:
            start_nodes = [nodes[0]['id']]
        
        return {
            'node_map': node_map,
            'adjacency': dict(adjacency),
            'incoming': dict(incoming),
            'start_nodes': start_nodes,
            'nodes': nodes,
            'edges': edges
        }
    
    def _compute_step_indices(self, graph: Dict[str, Any]) -> Dict[str, int]:
        """
        Compute step indices (x positions) using topological sort.
        Handles cycles by detecting back-edges.
        """
        adjacency = graph['adjacency']
        start_nodes = graph['start_nodes']
        node_map = graph['node_map']
        
        # Detect back-edges (cycles)
        back_edges = set()
        visited_dfs = set()
        recursion_stack = set()
        
        def detect_cycles(node_id):
            visited_dfs.add(node_id)
            recursion_stack.add(node_id)
            for child in adjacency.get(node_id, []):
                if child not in visited_dfs:
                    detect_cycles(child)
                elif child in recursion_stack:
                    back_edges.add((node_id, child))
            recursion_stack.discard(node_id)
        
        for start in start_nodes:
            if start not in visited_dfs:
                detect_cycles(start)
        
        # BFS to assign step indices
        step_indices = {}
        queue = [(node_id, 0) for node_id in start_nodes]
        
        while queue:
            node_id, step = queue.pop(0)
            
            # Use max step index for nodes reachable via multiple paths
            if node_id in step_indices:
                if step_indices[node_id] >= step:
                    continue
            
            step_indices[node_id] = step
            
            # Get children and check if parent is a decision node
            children = adjacency.get(node_id, [])
            node_type = node_map[node_id].get('type') or node_map[node_id].get('data', {}).get('type', 'default')
            is_decision = node_type == 'decision'
            
            for child in children:
                if (node_id, child) not in back_edges:
                    # If parent is a decision node, all branches should be at the same step
                    # Otherwise, increment step as normal
                    child_step = step + 1
                    queue.append((child, child_step))
        
        # Handle unvisited nodes
        for node_id in node_map:
            if node_id not in step_indices:
                # Find max step of incoming nodes + 1
                incoming_steps = [
                    step_indices.get(src, 0) 
                    for src in graph['incoming'].get(node_id, [])
                    if src in step_indices
                ]
                step_indices[node_id] = max(incoming_steps, default=0) + 1
        
        return step_indices
    
    def _assign_lanes(
        self,
        graph: Dict[str, Any],
        step_indices: Dict[str, int]
    ) -> Dict[str, int]:
        """
        Assign lanes (y positions) to nodes.
        
        New logic:
        - Each node inherits the lane (Y position) of its source node
        - If multiple nodes share the same step_index (X position), separate them vertically
        - Decision branches get different lanes (upper and lower)
        """
        node_map = graph['node_map']
        adjacency = graph['adjacency']
        incoming = graph['incoming']
        start_nodes = graph['start_nodes']
        
        lane_assignments = {}
        
        # Assign lane 0 to start nodes
        for start_id in start_nodes:
            lane_assignments[start_id] = 0
        
        # Track which decision branch each node belongs to
        branch_origins = {}  # node_id -> (decision_id, branch_index)
        
        # Process decision nodes to assign branch origins for branching
        for node_id, node in node_map.items():
            node_type = node.get('type') or node.get('data', {}).get('type', 'default')
            if node_type == 'decision':
                children = sorted(adjacency.get(node_id, []))
                for i, child in enumerate(children):
                    self._propagate_branch_origin(
                        child, (node_id, i), adjacency, branch_origins, set(), node_map
                    )
        
        # Process nodes in topological order (by step)
        nodes_by_step = defaultdict(list)
        for node_id, step in step_indices.items():
            nodes_by_step[step].append(node_id)
        
        for step in sorted(nodes_by_step.keys()):
            nodes_at_step = nodes_by_step[step]
            
            for node_id in nodes_at_step:
                if node_id in lane_assignments:
                    # Already assigned (e.g., start node)
                    continue
                
                # Get node type
                node = node_map.get(node_id, {})
                node_type = node.get('type') or node.get('data', {}).get('type', 'default')
                
                # Special handling for merge nodes - inherit from target, not sources
                if node_type == 'merge':
                    target_ids = adjacency.get(node_id, [])
                    if target_ids:
                        target_id = target_ids[0]
                        target_lane = lane_assignments.get(target_id, 0)
                        lane_assignments[node_id] = target_lane
                        continue
                
                # Check if this node is part of a decision branch
                if node_id in branch_origins:
                    decision_id, branch_idx = branch_origins[node_id]
                    # Get the decision node's lane
                    decision_lane = lane_assignments.get(decision_id, 0)
                    
                    # Branch 0 stays at same lane as decision (yes path), branch 1+ goes down
                    if branch_idx == 0:
                        lane_assignments[node_id] = decision_lane
                    else:
                        lane_assignments[node_id] = decision_lane + branch_idx
                else:
                    # Not in a branch - inherit lane from source node
                    source_ids = incoming.get(node_id, [])
                    if source_ids:
                        # Use the first source's lane (typically single source in main flow)
                        source_id = source_ids[0]
                        source_lane = lane_assignments.get(source_id, 0)
                        lane_assignments[node_id] = source_lane
                    else:
                        # No source (shouldn't happen for non-start nodes)
                        lane_assignments[node_id] = 0
        
        # Handle collisions: if multiple nodes at same step have same lane, separate them
        for step in sorted(nodes_by_step.keys()):
            nodes_at_step = nodes_by_step[step]
            if len(nodes_at_step) <= 1:
                continue
            
            # Group nodes by their assigned lane
            lane_groups = defaultdict(list)
            for node_id in nodes_at_step:
                lane = lane_assignments.get(node_id, 0)
                lane_groups[lane].append(node_id)
            
            # For each lane with multiple nodes, spread them vertically
            for lane, node_ids in lane_groups.items():
                if len(node_ids) > 1:
                    # Spread nodes around the original lane
                    for i, node_id in enumerate(sorted(node_ids)):
                        offset = i - len(node_ids) // 2
                        lane_assignments[node_id] = lane + offset
        
        return lane_assignments
    
    def _propagate_branch_origin(
        self,
        node_id: str,
        origin: Tuple[str, int],
        adjacency: Dict[str, List[str]],
        branch_origins: Dict[str, Tuple[str, int]],
        visited: Set[str],
        node_map: Dict[str, Any] = None
    ):
        """Recursively propagate branch origin to downstream nodes.
        Stops at merge nodes since they rejoin the main flow.
        """
        if node_id in visited:
            return
        visited.add(node_id)
        
        # Check if this is a merge node - if so, don't propagate further
        if node_map:
            node = node_map.get(node_id, {})
            node_type = node.get('type') or node.get('data', {}).get('type', 'default')
            if node_type == 'merge':
                # Merge nodes rejoin the main flow - don't mark as part of branch
                return
        
        # Don't overwrite existing origins (first decision wins)
        if node_id not in branch_origins:
            branch_origins[node_id] = origin
        
        for child in adjacency.get(node_id, []):
            self._propagate_branch_origin(
                child, origin, adjacency, branch_origins, visited, node_map
            )
    
    def _get_node_dimensions(self, node: Dict[str, Any]) -> Dict[str, int]:
        """Get dimensions for a node based on type and content."""
        node_type = node.get('type') or node.get('data', {}).get('type', 'default')
        label = node.get('data', {}).get('label', '') or node.get('label', '')
        owner = node.get('data', {}).get('owner', '')
        system = node.get('data', {}).get('system', '')
        
        # Base dimensions by type
        if node_type == 'decision':
            width, height = 120, 100
        elif node_type == 'merge':
            width, height = 80, 60
        elif node_type in ['start', 'end']:
            width, height = 120, 60
        else:
            # Default/process nodes - scale with content
            base_width = 160  # Match frontend default
            base_height = 100 # Match frontend default
            
            # Estimate text wrapping to match frontend logic
            # Frontend uses ~20 chars per line for 160px width
            chars_per_line = 20
            lines = label.split('\n')
            estimated_lines = 0
            max_line_length = 0
            
            for line in lines:
                line_len = len(line)
                max_line_length = max(max_line_length, line_len)
                # Estimate wrapped lines for this paragraph
                estimated_lines += math.ceil(max(1, line_len) / chars_per_line)
            
            # Ensure at least as many lines as explicit newlines
            estimated_lines = max(len(lines), estimated_lines)
            
            # Calculate width expansion (prioritize width over height)
            width = base_width
            height = base_height
            
            total_chars = len(label)
            
            # Expand width to fit text within 3 lines
            target_chars_per_line = math.ceil(total_chars / 3)
            required_width_wrapping = max(base_width, int(target_chars_per_line * 7) + 40)
            
            # Also accommodate explicit long lines
            required_width_longest = max(base_width, int(max_line_length * 7) + 40)
            
            # Take the larger of the two
            width = max(required_width_wrapping, required_width_longest)
            
            # Only expand height if explicit newlines exceed 3 lines
            if len(lines) > 3:
                height = max(base_height, len(lines) * 20 + 40)
            
            # Add height for owner/system tags
            if owner and owner != 'TBD':
                height += 25
            if system and system != 'TBD':
                height += 25
        
        return {'width': width, 'height': height}
    
    def _calculate_node_positions(
        self,
        nodes: List[Dict[str, Any]],
        step_indices: Dict[str, int],
        lane_assignments: Dict[str, int],
        preserve_user_modified: bool,
        graph: Dict[str, Any] = None
    ) -> List[Dict[str, Any]]:
        """Calculate final x, y positions for all nodes with collision avoidance."""
        positioned_nodes = []
        positions_map = {}  # Track positions for collision detection
        node_dimensions = {}  # Track node sizes
        
        # Calculate dimensions for all nodes first
        for node in nodes:
            node_dimensions[node['id']] = self._get_node_dimensions(node)
        
        # Find max step index for END node positioning
        max_step = max(step_indices.values()) if step_indices else 0
        
        # First pass: calculate initial positions
        for node in nodes:
            node_copy = node.copy()
            node_id = node['id']
            node_type = node.get('type') or node.get('data', {}).get('type', 'default')
            
            # Check if user modified and should preserve
            user_modified = (
                node.get('data', {}).get('user_modified', False) or
                node.get('user_modified', False)
            )
            
            if preserve_user_modified and user_modified and 'position' in node:
                # Keep existing position
                positions_map[node_id] = node.get('position', {'x': 0, 'y': 0})
                positioned_nodes.append(node_copy)
                continue
            
            # Calculate position
            step = step_indices.get(node_id, 0)
            lane = lane_assignments.get(node_id, 0)
            
            # END nodes should always be at the far right
            if node_type == 'end':
                step = max_step + 1
            
            # Calculate x with variable spacing based on previous node width
            x = step * self.config.horizontal_spacing
            y = lane * self.config.vertical_spacing
            
            node_copy['position'] = {'x': x, 'y': y}
            positions_map[node_id] = {'x': x, 'y': y}
            positioned_nodes.append(node_copy)
        
        # Second pass: position merge and end nodes based on their incoming edges
        if graph:
            incoming = graph.get('incoming', {})
            adjacency = graph.get('adjacency', {})
            
            for i, node in enumerate(positioned_nodes):
                node_id = node['id']
                node_type = node.get('type') or node.get('data', {}).get('type', 'default')
                
                if node_type == 'start':
                    # Align start node center with its target node center
                    target_ids = adjacency.get(node_id, [])
                    if target_ids:
                        target_id = target_ids[0]
                        target_pos = positions_map.get(target_id)
                        if target_pos:
                            # Get dimensions for center alignment
                            start_dim = node_dimensions.get(node_id, {'width': 120, 'height': 60})
                            target_dim = node_dimensions.get(target_id, {'width': 160, 'height': 100})
                            
                            # Keep existing X position
                            current_pos = positioned_nodes[i]['position']
                            new_x = current_pos['x']
                            
                            # Align centers vertically
                            target_center_y = target_pos['y'] + target_dim['height'] / 2
                            new_y = target_center_y - start_dim['height'] / 2
                            
                            positioned_nodes[i]['position'] = {'x': new_x, 'y': new_y}
                            positions_map[node_id] = {'x': new_x, 'y': new_y}
                
                elif node_type == 'decision':
                    # Align decision node center with its source node center
                    source_ids = incoming.get(node_id, [])
                    if source_ids:
                        source_id = source_ids[0]
                        source_pos = positions_map.get(source_id)
                        if source_pos:
                            # Get dimensions for center alignment
                            decision_dim = node_dimensions.get(node_id, {'width': 120, 'height': 100})
                            source_dim = node_dimensions.get(source_id, {'width': 160, 'height': 100})
                            
                            # Keep existing X position
                            current_pos = positioned_nodes[i]['position']
                            new_x = current_pos['x']
                            
                            # Align centers vertically
                            source_center_y = source_pos['y'] + source_dim['height'] / 2
                            new_y = source_center_y - decision_dim['height'] / 2
                            
                            positioned_nodes[i]['position'] = {'x': new_x, 'y': new_y}
                            positions_map[node_id] = {'x': new_x, 'y': new_y}
                
                elif node_type == 'merge':
                    # Get positions of all incoming nodes
                    source_ids = incoming.get(node_id, [])
                    if source_ids:
                        source_positions = [
                            positions_map.get(src) for src in source_ids 
                            if src in positions_map
                        ]
                        if source_positions:
                            # Position merge node one horizontal_spacing to left of target, aligned center with target
                            target_ids = adjacency.get(node_id, [])
                            if target_ids:
                                target_id = target_ids[0]
                                target_pos = positions_map.get(target_id)
                                if target_pos:
                                    # Get dimensions for center alignment
                                    merge_dim = node_dimensions.get(node_id, {'width': 80, 'height': 60})
                                    target_dim = node_dimensions.get(target_id, {'width': 160, 'height': 100})
                                    
                                    # Place merge one horizontal_spacing to the left of target
                                    new_x = target_pos['x'] - self.config.horizontal_spacing
                                    
                                    # Align centers vertically with target
                                    target_center_y = target_pos['y'] + target_dim['height'] / 2
                                    new_y = target_center_y - merge_dim['height'] / 2
                                    
                                    # Update position
                                    positioned_nodes[i]['position'] = {'x': new_x, 'y': new_y}
                                    positions_map[node_id] = {'x': new_x, 'y': new_y}
                
                elif node_type == 'end':
                    # Position END node at standard spacing to right, aligned center with source
                    source_ids = incoming.get(node_id, [])
                    if source_ids:
                        # Use the first (typically only) source
                        source_id = source_ids[0]
                        source_pos = positions_map.get(source_id)
                        if source_pos:
                            # Get dimensions for center alignment
                            end_dim = node_dimensions.get(node_id, {'width': 120, 'height': 60})
                            source_dim = node_dimensions.get(source_id, {'width': 160, 'height': 100})
                            
                            # Place END one horizontal_spacing to the right of source
                            new_x = source_pos['x'] + self.config.horizontal_spacing
                            
                            # Align centers vertically
                            source_center_y = source_pos['y'] + source_dim['height'] / 2
                            new_y = source_center_y - end_dim['height'] / 2
                            
                            positioned_nodes[i]['position'] = {'x': new_x, 'y': new_y}
                            positions_map[node_id] = {'x': new_x, 'y': new_y}
        
        # Third pass: resolve collisions with size-aware spacing
        positioned_nodes = self._resolve_node_collisions(
            positioned_nodes, positions_map, node_dimensions
        )
        
        return positioned_nodes
    
    def _resolve_node_collisions(
        self,
        nodes: List[Dict[str, Any]],
        positions_map: Dict[str, Dict[str, float]],
        node_dimensions: Dict[str, Dict[str, int]] = None
    ) -> List[Dict[str, Any]]:
        """Resolve collisions by shifting overlapping nodes, accounting for node size."""
        if node_dimensions is None:
            node_dimensions = {}
        
        # Default minimum gaps
        base_x_gap = 80  # Minimum horizontal gap between nodes
        base_y_gap = 60  # Minimum vertical gap between nodes
        
        # Group nodes by approximate x position (same column)
        columns = defaultdict(list)
        for node in nodes:
            pos = node.get('position', {'x': 0, 'y': 0})
            col_key = round(pos['x'] / (self.config.horizontal_spacing * 0.5))
            columns[col_key].append(node)
        
        # For each column, check for y-axis collisions
        for col_key, col_nodes in columns.items():
            if len(col_nodes) <= 1:
                continue
            
            # Sort by y position
            col_nodes.sort(key=lambda n: n.get('position', {}).get('y', 0))
            
            # Check for overlaps and shift
            for i in range(1, len(col_nodes)):
                prev_node = col_nodes[i - 1]
                curr_node = col_nodes[i]
                
                prev_y = prev_node.get('position', {}).get('y', 0)
                curr_y = curr_node.get('position', {}).get('y', 0)
                
                # Calculate required gap based on node heights
                prev_height = node_dimensions.get(prev_node['id'], {}).get('height', 140)
                curr_height = node_dimensions.get(curr_node['id'], {}).get('height', 140)
                min_y_gap = (prev_height + curr_height) / 2 + base_y_gap
                
                if curr_y - prev_y < min_y_gap:
                    # Shift current node down
                    new_y = prev_y + min_y_gap
                    curr_node['position']['y'] = new_y
        
        return nodes
    
    def _position_new_nodes(
        self,
        graph: Dict[str, Any],
        new_node_ids: Set[str],
        existing_positions: Dict[str, Dict[str, float]]
    ) -> Dict[str, Dict[str, float]]:
        """
        Position new nodes at midpoints between their sources and targets.
        """
        adjacency = graph['adjacency']
        incoming = graph['incoming']
        
        positions = dict(existing_positions)
        
        for node_id in new_node_ids:
            # Find incoming and outgoing nodes
            sources = incoming.get(node_id, [])
            targets = adjacency.get(node_id, [])
            
            # Calculate midpoint
            source_positions = [
                positions.get(s) for s in sources if s in positions
            ]
            target_positions = [
                positions.get(t) for t in targets if t in positions
            ]
            
            if source_positions and target_positions:
                # Midpoint between source and target
                avg_source_x = sum(p['x'] for p in source_positions) / len(source_positions)
                avg_source_y = sum(p['y'] for p in source_positions) / len(source_positions)
                avg_target_x = sum(p['x'] for p in target_positions) / len(target_positions)
                avg_target_y = sum(p['y'] for p in target_positions) / len(target_positions)
                
                x = (avg_source_x + avg_target_x) / 2
                y = (avg_source_y + avg_target_y) / 2
            elif source_positions:
                # Place to the right of source
                avg_x = sum(p['x'] for p in source_positions) / len(source_positions)
                avg_y = sum(p['y'] for p in source_positions) / len(source_positions)
                x = avg_x + self.config.horizontal_spacing
                y = avg_y
            elif target_positions:
                # Place to the left of target
                avg_x = sum(p['x'] for p in target_positions) / len(target_positions)
                avg_y = sum(p['y'] for p in target_positions) / len(target_positions)
                x = avg_x - self.config.horizontal_spacing
                y = avg_y
            else:
                # Fallback
                x = 0
                y = 0
            
            positions[node_id] = {'x': x, 'y': y}
        
        return positions
    
    def _resolve_collisions(
        self,
        nodes: List[Dict[str, Any]],
        positions: Dict[str, Dict[str, float]],
        new_node_ids: Set[str]
    ) -> Dict[str, Dict[str, float]]:
        """
        Resolve collisions by shifting nodes.
        New nodes push downstream nodes to the right.
        """
        # Sort nodes by x position
        sorted_nodes = sorted(
            [(nid, pos) for nid, pos in positions.items()],
            key=lambda x: x[1]['x']
        )
        
        # Check for collisions and shift
        min_spacing = self.config.horizontal_spacing * 0.8
        
        for i, (node_id, pos) in enumerate(sorted_nodes):
            if node_id in new_node_ids:
                # Check if this new node collides with existing nodes
                for j in range(i + 1, len(sorted_nodes)):
                    other_id, other_pos = sorted_nodes[j]
                    
                    # Check horizontal overlap
                    if abs(other_pos['x'] - pos['x']) < min_spacing:
                        # Check vertical overlap
                        if abs(other_pos['y'] - pos['y']) < self.config.node_height:
                            # Shift other node right
                            shift = min_spacing - (other_pos['x'] - pos['x'])
                            positions[other_id] = {
                                'x': other_pos['x'] + shift,
                                'y': other_pos['y']
                            }
        
        return positions
    
    def _route_edges(
        self,
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
        preserve_user_modified: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Route edges with node-aware path calculation.
        Calculates bendX that avoids passing through intermediate nodes.
        
        Args:
            nodes: List of positioned nodes
            edges: List of edges to route
            preserve_user_modified: If False, ignore user_modified_routing flags
        """
        # Build position map
        node_positions = {
            node['id']: node.get('position', {'x': 0, 'y': 0})
            for node in nodes
        }
        
        # Build node dimensions map
        node_dimensions = {}
        for node in nodes:
            node_type = node.get('type') or node.get('data', {}).get('type', 'default')
            if node_type == 'decision':
                node_dimensions[node['id']] = {'width': 120, 'height': 100}
            elif node_type == 'merge':
                node_dimensions[node['id']] = {'width': 120, 'height': 60}
            elif node_type in ['start', 'end']:
                node_dimensions[node['id']] = {'width': 120, 'height': 60}
            else:
                node_dimensions[node['id']] = {'width': 160, 'height': 100}
        
        # Build list of all node bounding boxes for collision detection
        node_boxes = []
        for node in nodes:
            pos = node_positions.get(node['id'], {'x': 0, 'y': 0})
            dim = node_dimensions.get(node['id'], {'width': 160, 'height': 100})
            node_boxes.append({
                'id': node['id'],
                'x': pos['x'],
                'y': pos['y'],
                'width': dim['width'],
                'height': dim['height'],
            })
        
        routed_edges = []
        
        for edge in edges:
            edge_copy = edge.copy()
            source_id = edge.get('source')
            target_id = edge.get('target')
            
            if source_id not in node_positions or target_id not in node_positions:
                routed_edges.append(edge_copy)
                continue
            
            source_pos = node_positions[source_id]
            target_pos = node_positions[target_id]
            source_dim = node_dimensions.get(source_id, {'width': 160, 'height': 100})
            target_dim = node_dimensions.get(target_id, {'width': 160, 'height': 100})
            
            # Calculate edge exit/entry points
            source_right_x = source_pos['x'] + source_dim['width']
            source_center_y = source_pos['y'] + source_dim['height'] / 2
            target_left_x = target_pos['x']
            target_center_y = target_pos['y'] + target_dim['height'] / 2
            
            # Check if user has modified this edge's routing
            # Only preserve user-modified routing if preserve_user_modified is True
            if preserve_user_modified:
                user_modified_routing = edge.get('data', {}).get('user_modified_routing', False)
                if user_modified_routing:
                    # Preserve user-modified edge routing
                    routed_edges.append(edge_copy)
                    continue
            
            # Handle back-edges (target is to the left of source)
            if target_left_x < source_right_x:
                # This is a back-edge (loop back)
                # We need to route it above or below the nodes in between
                
                # Find nodes horizontally between target and source
                intermediate_nodes = []
                for box in node_boxes:
                    if box['id'] in [source_id, target_id]:
                        continue
                    
                    # Check if node is horizontally between target and source
                    if (box['x'] + box['width'] > target_left_x - 50) and (box['x'] < source_right_x + 50):
                        intermediate_nodes.append(box)
                
                # Determine if we should go above or below based on edge position relative to intermediate nodes
                go_below = False
                
                # Calculate clearance Y
                if intermediate_nodes:
                    min_y = min(box['y'] for box in intermediate_nodes)
                    max_y = max(box['y'] + box['height'] for box in intermediate_nodes)
                    
                    # Smart routing: check if source and target are both above or both below the intermediate nodes
                    # This helps avoid edge overlaps
                    avg_edge_y = (source_center_y + target_center_y) / 2
                    
                    # If edge endpoints are above the intermediate nodes, go above
                    # If edge endpoints are below the intermediate nodes, go below
                    if avg_edge_y < min_y:
                        # Edge is above intermediate nodes - route above
                        go_below = False
                        bend_y = avg_edge_y - 80  # Go further above
                    elif avg_edge_y > max_y:
                        # Edge is below intermediate nodes - route below
                        go_below = True
                        bend_y = avg_edge_y + 120  # Go further below with extra clearance for labels
                    else:
                        # Edge is at same level as intermediate nodes - choose based on distance
                        dist_to_top = abs(avg_edge_y - min_y)
                        dist_to_bottom = abs(avg_edge_y - max_y)
                        
                        if dist_to_bottom < dist_to_top:
                            go_below = True
                            bend_y = max_y + 120  # Go below with extra clearance
                        else:
                            go_below = False
                            bend_y = min_y - 60  # Go above
                else:
                    # No intermediate nodes, default to going above
                    bend_y = min(source_center_y, target_center_y) - 80
                
                # Set bendX to midpoint (not used for vertical routing but needed for data structure)
                best_bend_x = (source_right_x + target_left_x) / 2
                
                if 'data' not in edge_copy:
                    edge_copy['data'] = {}
                edge_copy['data']['bendX'] = best_bend_x
                edge_copy['data']['bendY'] = bend_y
                edge_copy['data']['user_modified_routing'] = False
                
                routed_edges.append(edge_copy)
                continue

            # Forward edge routing (left to right)
            # Calculate default bendX (midpoint between source right edge and target left edge)
            default_bend_x = (source_right_x + target_left_x) / 2
            
            # Check if this edge skips over intermediate nodes (e.g., decision node jumping ahead)
            # Count nodes that are horizontally between source and target
            intermediate_node_count = 0
            for box in node_boxes:
                if box['id'] in [source_id, target_id]:
                    continue
                # Check if node is horizontally between source and target
                if source_right_x < box['x'] < target_left_x:
                    intermediate_node_count += 1
            
            # If edge skips 2+ nodes, route it higher to make the skip visually clear
            skip_edge = intermediate_node_count >= 2
            bend_y = None
            
            if skip_edge:
                # Route edge higher - calculate clearance above all nodes
                all_nodes_in_range = [
                    box for box in node_boxes 
                    if source_right_x <= box['x'] + box['width'] and box['x'] <= target_left_x
                ]
                if all_nodes_in_range:
                    min_y = min(box['y'] for box in all_nodes_in_range)
                    # Arc above with clearance
                    bend_y = min_y - 80
                else:
                    # Default arc above
                    bend_y = min(source_center_y, target_center_y) - 80
            
            # Check if the edge's vertical segment would pass through any nodes
            # The vertical segment goes from (bendX, source_y) to (bendX, target_y)
            collision_found = False
            best_bend_x = default_bend_x
            
            # Only check for collisions if not using skip routing (which uses bendY)
            if not skip_edge:
                for box in node_boxes:
                    # Skip source and target nodes
                    if box['id'] in [source_id, target_id]:
                        continue
                    
                    # Check if vertical segment at bendX would intersect this node
                    node_left = box['x'] - 20  # Padding
                    node_right = box['x'] + box['width'] + 20
                    node_top = box['y'] - 10
                    node_bottom = box['y'] + box['height'] + 10
                    
                    # Check if bendX is within node's horizontal range
                    if node_left <= default_bend_x <= node_right:
                        # Check if vertical segment overlaps node's vertical range
                        edge_top = min(source_center_y, target_center_y)
                        edge_bottom = max(source_center_y, target_center_y)
                        
                        if not (edge_bottom < node_top or edge_top > node_bottom):
                            # Collision detected - need to route around
                            collision_found = True
                            
                            # Try routing to the left of the node
                            left_bend_x = node_left - 40
                            # Try routing to the right of the node
                            right_bend_x = node_right + 40
                            
                            # Choose the option closer to the default midpoint
                            if abs(left_bend_x - default_bend_x) < abs(right_bend_x - default_bend_x):
                                if left_bend_x > source_right_x:
                                    best_bend_x = left_bend_x
                                else:
                                    best_bend_x = right_bend_x
                            else:
                                if right_bend_x < target_left_x:
                                    best_bend_x = right_bend_x
                                else:
                                    best_bend_x = left_bend_x
            
            if not collision_found and not skip_edge:
                best_bend_x = default_bend_x
            elif skip_edge:
                # For skip edges with bendY, bendX is the midpoint
                best_bend_x = default_bend_x
            
            # Store bendX in edge data - frontend will use this for orthogonal path
            if 'data' not in edge_copy:
                edge_copy['data'] = {}
            edge_copy['data']['bendX'] = best_bend_x
            # Set bendY for skip edges, clear for normal forward edges
            edge_copy['data']['bendY'] = bend_y
            edge_copy['data']['user_modified_routing'] = False
            
            routed_edges.append(edge_copy)
        
        return routed_edges
    
    def get_node_bounds(
        self,
        nodes: List[Dict[str, Any]]
    ) -> Dict[str, float]:
        """Get the bounding box of all nodes."""
        if not nodes:
            return {'minX': 0, 'minY': 0, 'maxX': 0, 'maxY': 0}
        
        min_x = float('inf')
        min_y = float('inf')
        max_x = float('-inf')
        max_y = float('-inf')
        
        for node in nodes:
            pos = node.get('position', {'x': 0, 'y': 0})
            x, y = pos.get('x', 0), pos.get('y', 0)
            
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x + self.config.node_width)
            max_y = max(max_y, y + self.config.node_height)
        
        return {
            'minX': min_x,
            'minY': min_y,
            'maxX': max_x,
            'maxY': max_y
        }


# Singleton instance for use across the application
layout_service = LayoutService()

