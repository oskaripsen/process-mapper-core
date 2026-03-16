"""
Logical Step ID Service

Provides systematic ID generation for process steps in the format 1.1.1, 1.1.2, etc.
Creates a hierarchical taxonomy for process documentation.
"""

from typing import List, Dict, Optional


def generate_logical_id(existing_nodes: List[Dict], parent_id: str = None) -> str:
    """
    Generate a logical ID in the format 1.1.1.1, 1.1.1.2, etc.
    Creates a hierarchical taxonomy for process steps with fixed prefix 1.1.1.
    
    Args:
        existing_nodes: List of existing nodes with logical_id fields
        parent_id: Optional parent ID for hierarchical relationships
        
    Returns:
        str: Next logical ID in sequence
    """
    if not existing_nodes:
        return "1.1.1.1"
    
    # Extract all existing logical IDs
    existing_ids = []
    for node in existing_nodes:
        if 'logical_id' in node and node['logical_id']:
            existing_ids.append(node['logical_id'])
    
    if not existing_ids:
        return "1.1.1.1"
    
    # If parent_id is provided, find the next child ID
    if parent_id:
        # Find all children of this parent
        children = [id for id in existing_ids if id.startswith(parent_id + '.')]
        if children:
            # Get the highest child number
            child_numbers = []
            for child in children:
                parts = child.split('.')
                if len(parts) > len(parent_id.split('.')):
                    try:
                        child_numbers.append(int(parts[len(parent_id.split('.'))]))
                    except ValueError:
                        continue
            if child_numbers:
                next_child_num = max(child_numbers) + 1
                return f"{parent_id}.{next_child_num}"
        return f"{parent_id}.1"
    
    # Find the highest existing ID with 1.1.1. prefix and increment
    max_id = "1.1.1.0"
    for id in existing_ids:
        if id.startswith("1.1.1.") and id > max_id:
            max_id = id
    
    # Parse the max ID and increment the last number
    parts = max_id.split('.')
    if len(parts) >= 4:
        try:
            last_num = int(parts[-1])
            parts[-1] = str(last_num + 1)
            return '.'.join(parts)
        except ValueError:
            pass
    
    # Fallback: increment from 1.1.1.1
    return "1.1.1.1"


def get_next_sequential_id(existing_nodes: List[Dict]) -> str:
    """
    Get the next sequential ID in the format 1.1.1.1, 1.1.1.2, etc.
    
    Args:
        existing_nodes: List of existing nodes with logical_id fields
        
    Returns:
        str: Next sequential logical ID
    """
    if not existing_nodes:
        return "1.1.1.1"
    
    # Find the highest existing logical ID with 1.1.1. prefix
    max_id = "1.1.1.0"
    for node in existing_nodes:
        if 'logical_id' in node and node['logical_id']:
            if node['logical_id'].startswith("1.1.1.") and node['logical_id'] > max_id:
                max_id = node['logical_id']
    
    # Parse and increment
    parts = max_id.split('.')
    if len(parts) >= 4:
        try:
            last_num = int(parts[-1])
            parts[-1] = str(last_num + 1)
            return '.'.join(parts)
        except ValueError:
            pass
    
    return "1.1.1.1"


def validate_logical_id(logical_id: str) -> bool:
    """
    Validate that a logical ID follows the correct format (1.1.1.1, 1.1.1.2, etc.)
    
    Args:
        logical_id: The ID to validate
        
    Returns:
        bool: True if valid, False otherwise
    """
    if not logical_id:
        return False
    
    parts = logical_id.split('.')
    if len(parts) < 4:
        return False
    
    # Check that it starts with 1.1.1.
    if not logical_id.startswith("1.1.1."):
        return False
    
    try:
        for part in parts:
            if not part.isdigit() or int(part) < 1:
                return False
        return True
    except ValueError:
        return False


def get_parent_id(logical_id: str) -> Optional[str]:
    """
    Get the parent ID for a given logical ID.
    For example: 1.1.1.3 -> 1.1.1, 1.1.1.2.1 -> 1.1.1.2
    
    Args:
        logical_id: The logical ID to get parent for
        
    Returns:
        str: Parent ID or None if no parent
    """
    if not validate_logical_id(logical_id):
        return None
    
    parts = logical_id.split('.')
    if len(parts) <= 4:  # 1.1.1.1 has no parent
        return None
    
    return '.'.join(parts[:-1])


def get_children_ids(logical_id: str, all_nodes: List[Dict]) -> List[str]:
    """
    Get all direct children of a given logical ID.
    
    Args:
        logical_id: The parent logical ID
        all_nodes: List of all nodes with logical_id fields
        
    Returns:
        List[str]: List of direct child logical IDs
    """
    if not validate_logical_id(logical_id):
        return []
    
    children = []
    for node in all_nodes:
        if 'logical_id' in node and node['logical_id']:
            if node['logical_id'].startswith(logical_id + '.') and node['logical_id'] != logical_id:
                # Check if it's a direct child (not grandchild)
                remaining = node['logical_id'][len(logical_id) + 1:]
                if '.' not in remaining:
                    children.append(node['logical_id'])
    
    return sorted(children)


def renumber_sequence(existing_nodes: List[Dict]) -> List[Dict]:
    """
    Renumber all logical IDs in a sequence to ensure proper ordering.
    Useful when nodes are deleted or reordered.
    
    Args:
        existing_nodes: List of nodes to renumber
        
    Returns:
        List[Dict]: Nodes with updated logical IDs
    """
    if not existing_nodes:
        return []
    
    # Sort nodes by their current logical ID
    sorted_nodes = sorted(existing_nodes, key=lambda x: x.get('logical_id', '0.0.0.0'))
    
    # Renumber sequentially
    updated_nodes = []
    counter = 1
    for node in sorted_nodes:
        updated_node = node.copy()
        updated_node['logical_id'] = f"1.1.1.{counter}"
        updated_nodes.append(updated_node)
        counter += 1
    
    return updated_nodes


def renumber_by_flow_sequence(nodes: List[Dict], edges: List[Dict]) -> List[Dict]:
    """
    Renumber logical IDs based on the actual flow sequence (following arrows).
    Starts from start nodes and follows the flow path.
    Excludes start and end nodes from counting - only process steps get numbered.
    
    Args:
        nodes: List of nodes with id, logical_id, and type fields
        edges: List of edges with source and target fields
        
    Returns:
        List[Dict]: Nodes with updated logical IDs based on flow sequence
    """
    if not nodes:
        return []
    
    # Create a mapping of node IDs to nodes
    node_map = {node['id']: node for node in nodes}
    
    # Find start nodes (nodes with no incoming edges)
    incoming_edges = {edge['target'] for edge in edges}
    start_nodes = [node for node in nodes if node['id'] not in incoming_edges]
    
    # If no clear start nodes, use the first node
    if not start_nodes:
        start_nodes = [nodes[0]] if nodes else []
    
    # Create adjacency list for flow traversal
    adjacency = {}
    for edge in edges:
        source = edge['source']
        target = edge['target']
        if source not in adjacency:
            adjacency[source] = []
        adjacency[source].append(target)
    
    # Sort adjacency lists for deterministic traversal
    for source in adjacency:
        adjacency[source].sort()
    
    # Traverse the flow and assign sequential IDs (excluding start/end nodes)
    visited = set()
    updated_nodes = []
    counter = 1
    
    def traverse_flow(node_id):
        nonlocal counter
        if node_id in visited or node_id not in node_map:
            return
        
        visited.add(node_id)
        node = node_map[node_id].copy()
        
        # Only assign logical IDs to default process steps (not start/end/decision/merge nodes)
        node_type = node.get('type', 'default')
        if node_type in ['start', 'end', 'decision', 'merge']:
            # Start, end, decision, and merge nodes keep their existing logical_id or get empty
            node['logical_id'] = node.get('logical_id', '')
        else:
            # Only default process steps get sequential numbering
            node['logical_id'] = f"1.1.1.{counter}"
            counter += 1
        
        updated_nodes.append(node)
        
        # Continue to connected nodes
        if node_id in adjacency:
            for next_node_id in adjacency[node_id]:
                traverse_flow(next_node_id)
    
    # Start traversal from all start nodes
    for start_node in start_nodes:
        traverse_flow(start_node['id'])
    
    # Handle any remaining unvisited nodes (orphaned nodes)
    for node in nodes:
        if node['id'] not in visited:
            updated_node = node.copy()
            node_type = updated_node.get('type', 'default')
            if node_type in ['start', 'end', 'decision', 'merge']:
                # Start, end, decision, and merge nodes keep their existing logical_id or get empty
                updated_node['logical_id'] = updated_node.get('logical_id', '')
            else:
                # Only default process steps get sequential numbering
                updated_node['logical_id'] = f"1.1.1.{counter}"
                counter += 1
            updated_nodes.append(updated_node)
    
    return updated_nodes
