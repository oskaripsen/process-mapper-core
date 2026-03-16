from typing import List, Dict, Any, Optional

def build_flow_context(
    existing_flow: Dict[str, Any], 
    validation_errors: Optional[List[str]] = None, 
    user_edits: Optional[List[Dict[str, Any]]] = None, 
    accumulated_transcript: Optional[str] = None
) -> str:
    """
    Build a comprehensive context string describing the existing process flow,
    including nodes, edges, validation errors, and user edits.
    This ensures identical context is provided to the LLM across all input methods.
    """
    if not existing_flow:
        return ""

    existing_nodes = existing_flow.get('nodes', [])
    existing_edges = existing_flow.get('edges', [])
    
    # Create a map of node IDs to labels for edge descriptions
    node_map = {}
    for node in existing_nodes:
        node_data = node.get('data', {})
        node_id = node.get('id')
        label = node_data.get('label', node.get('label', 'Unknown'))
        node_type = node_data.get('type', node.get('type', 'unknown'))
        node_map[node_id] = {'label': label, 'type': node_type}
    
    # Build comprehensive flow description with ALL metadata
    flow_summary = ["EXISTING FLOW (complete structure with all metadata):"]
    flow_summary.append("\nNODES (use these EXACT UUIDs when updating/referencing):")
    for node in existing_nodes:
        node_data = node.get('data', {})
        node_id = node.get('id')
        node_type = node_data.get('type', node.get('type', 'unknown'))
        label = node_data.get('label', node.get('label', 'Unknown'))
        owner = node_data.get('owner', node.get('owner', 'N/A'))
        system = node_data.get('system', node.get('system', 'N/A'))
        automation = node_data.get('manualOrAutomated', node.get('manualOrAutomated', 'N/A'))
        
        # Format: [UUID] "Label" (Owner: X, System: Y)
        node_info = f"  [{node_id}] \"{label}\""
        details = []
        if owner and owner != 'N/A': details.append(f"Owner: {owner}")
        if system and system != 'N/A': details.append(f"System: {system}")
        if node_type != 'step': details.append(f"Type: {node_type}")
        
        if details:
            node_info += f" ({', '.join(details)})"
            
        flow_summary.append(node_info)
    
    # Add edge information with complete metadata
    if existing_edges:
        flow_summary.append("\nEDGES (current connections):")
        for edge in existing_edges:
            edge_id = edge.get('id', 'N/A')
            source_id = edge.get('source')
            target_id = edge.get('target')
            source_label = node_map.get(source_id, {}).get('label', 'Unknown')
            target_label = node_map.get(target_id, {}).get('label', 'Unknown')
            condition = edge.get('condition') or edge.get('label') or ''
            
            # Format: [Source ID] -> [Target ID]
            edge_info = f"  {source_id} ({source_label}) → {target_id} ({target_label})"
            if condition:
                edge_info += f" [IF: {condition}]"
            flow_summary.append(edge_info)
    
    # Find the "end" of the current flow (nodes with no outgoing edges)
    nodes_with_outgoing = set(e.get('source') for e in existing_edges)
    end_nodes = [n for n in existing_nodes if n.get('id') not in nodes_with_outgoing]
    
    if end_nodes:
        flow_summary.append("\nCURRENT END POINTS:")
        for node in end_nodes:
            node_data = node.get('data', {})
            label = node_data.get('label', node.get('label', 'Unknown'))
            flow_summary.append(f"  - {label} ({node.get('id')})")
    
    # Add validation errors if present
    validation_section = ""
    if validation_errors and len(validation_errors) > 0:
        validation_section = "\n⚠️ PREVIOUS VALIDATION ERRORS (please fix these):\n"
        for error in validation_errors:
            validation_section += f"  - {error}\n"
    
    # Add user edits if present
    user_edits_section = ""
    if user_edits and len(user_edits) > 0:
        user_edits_section = "\n✏️ USER MANUAL EDITS (CRITICAL - DO NOT OVERRIDE THESE):\n"
        user_edits_section += "⚠️ IMPORTANT: These nodes already exist with user's custom text.\n"
        user_edits_section += "DO NOT create new nodes for what these represent - reference them by ID!\n"
        user_edits_section += "DO NOT try to 'fix' the text - user wants it EXACTLY as shown!\n\n"
        for edit in user_edits:
            edit_type = edit.get('type', 'unknown')
            if edit_type == 'node_updated':
                user_edits_section += f"  - Node {edit.get('id')} = '{edit.get('label')}' (user-customized)\n"
            elif edit_type == 'node_deleted':
                user_edits_section += f"  - Deleted node: {edit.get('label')} - DO NOT recreate this!\n"
            elif edit_type == 'edge_deleted':
                user_edits_section += f"  - Deleted connection: {edit.get('from')} → {edit.get('to')} - DO NOT recreate this!\n"
            elif edit_type == 'node_repositioned':
                user_edits_section += f"  - Repositioned: {edit.get('label')} (user prefers this layout)\n"
    
    # Add accumulated transcript if present
    transcript_section = ""
    if accumulated_transcript:
        transcript_section = f"\nPrevious transcript context: {accumulated_transcript}"

    context = f"""{chr(10).join(flow_summary)}{validation_section}{user_edits_section}

CRITICAL INSTRUCTIONS FOR UPDATES:

1. 🔍 MATCHING EXISTING NODES (Most Important):
   - Check the "NODES" list above carefully.
   - If the user mentions a step that sounds like an existing node, USE THAT NODE'S UUID.
   - Example: User says "update the review step". You see `[abc-123] "Manager Review"`. USE `abc-123`!
   - DO NOT create a new node (e.g., `new_s1`) if a matching node exists.

2. ✏️ METADATA UPDATES (Owner, Tool, Label):
   - To change who does a step or what tool they use, output the step with its EXISTING UUID and the NEW values.
   - ❌ WRONG: `delete_steps: [abc-123]`, `steps: [{{id: new_s1...}}]` (Don't delete and recreate!)
   - ✅ CORRECT: `steps: [{{id: "abc-123", who: "New Owner", tool: "New Tool", ...}}]`
   - This preserves the node's connections and history.
   
   🔄 BULK UPDATES (When user says "change across entire flow", "update all", etc.):
   - You MUST include ALL affected nodes in the "steps" array with their EXACT UUIDs
   - Example: User says "use Concur for all AP steps"
     ✅ CORRECT: Include ALL AP step nodes in steps array: `steps: [{{id: "uuid1", tool: "Concur"}}, {{id: "uuid2", tool: "Concur"}}, ...]`
     ❌ WRONG: Only including one node - user wants ALL matching nodes updated
   - Check the NODES list above and include every node that matches the user's criteria
   - If the user says "change it across the entire flow", include ALL nodes that need updating

3. ➕ INSERTING STEPS IN-BETWEEN:
   - To insert Step X between A and B (where A → B exists):
   - 1. Identify UUID of A and UUID of B.
   - 2. Create Step X (id: "new_x").
   - 3. Output `delete_flows: [{{from: UUID_A, to: UUID_B}}]`.
   - 4. Output `flows: [{{from: UUID_A, to: new_x}}, {{from: new_x, to: UUID_B}}]`.

4. 🔗 CONNECTING NEW NODES:
   - Always connect new nodes to the existing flow.
   - Find the UUID of the node that comes BEFORE the new step.
   - Find the UUID of the node that comes AFTER the new step (if any).

5. 🗑️ DELETIONS:
   - Only use `delete_steps` if the user EXPLICITLY says "remove", "delete", or "drop".
   - NEVER use `delete_steps` just to change a label or owner.

6. 🔀 DECISION NODES - ADDING OUTGOING EDGES:
   - Decision nodes can have MULTIPLE outgoing edges (one per outcome/branch)
   - When user asks to "add another outcome" or "add another branch" to a decision:
     * DO NOT delete existing outgoing edges from that decision node
     * ONLY add the new edge in the "flows" array
    * Example: Decision "Review" already has edge to "Approve" step
      User says: "if rejected, send back"
      ✅ CORRECT: flows: [{{from: review_id, to: send_back_id, condition: "if rejected"}}]
      ❌ WRONG: delete_flows: [{{from: review_id, to: approve_id}}] (don't delete existing!)
   - Only delete edges when:
     * User explicitly says "remove connection" or "delete edge"
     * Inserting a step in middle (A→B becomes A→X→B, so delete A→B)
     * User wants to REPLACE one connection (not add to it)

{transcript_section}

REMEMBER:
- Reuse UUIDs whenever possible.
- Only create new IDs ("new_s1") for truly new steps.
- Check the "NODES" list first!"""

    return context
