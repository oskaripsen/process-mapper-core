import json
import tempfile
import os
from typing import List, Dict, Any, Optional
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter


def generate_excel_report(
    flat_taxonomy: List[Any],
    hierarchy_lookup: Dict[str, Dict[str, str]],
    owner_lookup: Dict[str, List[str]],
    all_flows: List[Dict[str, Any]],
    taxonomy_attributes: List[str],
    flow_attributes: List[str],
    include_flow_nodes: bool,
    node_attributes: Optional[List[str]]
) -> str:
    """
    Generate Excel report for process taxonomy and flows.
    This function is CPU-bound and should be run in a threadpool.
    Returns the path to the temporary file containing the Excel report.
    """
    # Create Excel workbook
    wb = Workbook()
    
    # ===== Sheet 1: Process Taxonomy =====
    ws_taxonomy = wb.active
    ws_taxonomy.title = "Process Taxonomy"
    
    # Define attribute mappings (with L0, L1, L2 columns)
    taxonomy_attr_map = {
        'id': ('ID', lambda p: str(p.id)),
        'l0': ('L0', lambda p: hierarchy_lookup.get(str(p.id), {}).get('l0', '')),
        'l1': ('L1', lambda p: hierarchy_lookup.get(str(p.id), {}).get('l1', '')),
        'l2': ('L2', lambda p: hierarchy_lookup.get(str(p.id), {}).get('l2', '')),
        'level': ('Level', lambda p: f"L{p.level}"),
        'parent_id': ('Parent ID', lambda p: str(p.parent_id) if p.parent_id else ''),
        'name': ('Name', lambda p: p.name),
        'description': ('Description', lambda p: p.description or ''),
        'updated_at': ('Updated At', lambda p: p.updated_at.strftime('%Y-%m-%d %H:%M') if p.updated_at else ''),
        'role': ('Owner(s)', lambda p: '; '.join(owner_lookup.get(str(p.id), [])))
    }
    
    # Write headers
    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="0E3BAF", end_color="0E3BAF", fill_type="solid")
    header_alignment = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style='thin'),
        right=Side(style='thin'),
        top=Side(style='thin'),
        bottom=Side(style='thin')
    )
    
    col_idx = 1
    for attr in taxonomy_attributes:
        if attr in taxonomy_attr_map:
            cell = ws_taxonomy.cell(row=1, column=col_idx, value=taxonomy_attr_map[attr][0])
            cell.font = header_font
            cell.fill = header_fill
            cell.alignment = header_alignment
            cell.border = thin_border
            col_idx += 1
    
    # Write data rows
    for row_idx, process in enumerate(flat_taxonomy, start=2):
        col_idx = 1
        for attr in taxonomy_attributes:
            if attr in taxonomy_attr_map:
                value = taxonomy_attr_map[attr][1](process)
                cell = ws_taxonomy.cell(row=row_idx, column=col_idx, value=value)
                cell.border = thin_border
                cell.alignment = Alignment(vertical="top", wrap_text=True)
                col_idx += 1
    
    # Auto-adjust column widths for taxonomy
    taxonomy_col_count = sum(1 for attr in taxonomy_attributes if attr in taxonomy_attr_map)
    for col_idx in range(1, taxonomy_col_count + 1):
        column_letter = get_column_letter(col_idx)
        max_length = 0
        for row in ws_taxonomy.iter_rows(min_col=col_idx, max_col=col_idx):
            for cell in row:
                try:
                    if cell.value:
                        max_length = max(max_length, len(str(cell.value)))
                except:
                    pass
        ws_taxonomy.column_dimensions[column_letter].width = min(max_length + 2, 50)
    
    # ===== Sheet 2: Process Flows =====
    ws_flows = wb.create_sheet("Process Flows")
    
    # Define flow attribute mappings
    flow_attr_map = {
        'id': ('Flow ID', lambda f: str(f['flow'].id)),
        'process_id': ('Process ID', lambda f: f['process_id']),
        'process_name': ('Process Name', lambda f: f['process_name']),
        'title': ('Title', lambda f: f['flow'].title or ''),
        'description': ('Description', lambda f: f['flow'].description or ''),
        'created_by': ('Created By', lambda f: f['flow'].created_by or ''),
        'status': ('Status', lambda f: f['flow'].status.value if f['flow'].status else ''),
        'version': ('Version', lambda f: str(f['flow'].version) if f['flow'].version else '1'),
        'created_at': ('Created At', lambda f: f['flow'].created_at.strftime('%Y-%m-%d %H:%M') if f['flow'].created_at else ''),
        'updated_at': ('Updated At', lambda f: f['flow'].updated_at.strftime('%Y-%m-%d %H:%M') if f['flow'].updated_at else ''),
    }
    
    # Node types that should show N/A for owner, system, automation
    na_node_types = {'start', 'end', 'decision', 'merge'}
    
    # Node attributes that can be selected (default all if not specified)
    selected_node_attrs = node_attributes if node_attributes else ['node_type', 'node_label', 'node_owner', 'node_system', 'node_automation']
    
    # Build header row
    flow_headers = []
    for attr in flow_attributes:
        if attr in flow_attr_map:
            flow_headers.append(flow_attr_map[attr][0])
    
    # Add node-related headers if include_flow_nodes is True
    # Always included: Node ID, Node Type, Source Node, Target Node, Edge ID
    # Optional based on node_attributes: Process Step, Owner, Tool/System, Manual/Automated
    node_headers = []
    node_attr_headers_map = {
        'node_type': 'Node Type',
        'node_label': 'Process Step',
        'node_owner': 'Owner',
        'node_system': 'Tool/System',
        'node_automation': 'Manual/Automated'
    }
    
    if include_flow_nodes:
        node_headers = ['Node ID']  # Always included
        # Add selected optional node attributes
        for attr in ['node_type', 'node_label', 'node_owner', 'node_system', 'node_automation']:
            if attr in selected_node_attrs:
                node_headers.append(node_attr_headers_map[attr])
        # Always include edge connection fields at the end
        node_headers.extend(['Source Node', 'Target Node', 'Edge ID'])
        flow_headers.extend(node_headers)
    
    # Write headers
    for col_idx, header in enumerate(flow_headers, start=1):
        cell = ws_flows.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_alignment
        cell.border = thin_border
    
    # Write data rows
    row_idx = 2
    for flow_data in all_flows:
        flow = flow_data['flow']
        
        # Parse nodes and edges from flow_data
        nodes = []
        edges = []
        if include_flow_nodes and flow.flow_data:
            flow_dict = flow.flow_data if isinstance(flow.flow_data, dict) else {}
            nodes = flow_dict.get('nodes', [])
            edges = flow_dict.get('edges', [])
        
        # Build edge lookup: node_id -> list of (source, target, edge_id) where this node is source
        node_edges = {}  # node_id -> [(source, target, edge_id), ...]
        for edge in edges:
            source = edge.get('source', '')
            target = edge.get('target', '')
            edge_id = edge.get('id', '')
            if source:
                if source not in node_edges:
                    node_edges[source] = []
                node_edges[source].append((source, target, edge_id))
        
        # Helper function to build node values based on selected attributes
        def build_node_values(node_id, node_type, node_label, node_owner, node_system, node_automation, source, target, edge_id):
            values = [node_id]  # Always include node_id
            # Add selected optional attributes
            if 'node_type' in selected_node_attrs:
                values.append(node_type)
            if 'node_label' in selected_node_attrs:
                values.append(node_label)
            if 'node_owner' in selected_node_attrs:
                values.append(node_owner)
            if 'node_system' in selected_node_attrs:
                values.append(node_system)
            if 'node_automation' in selected_node_attrs:
                values.append(node_automation)
            # Always include edge fields at the end
            values.extend([source, target, edge_id])
            return values
        
        # If no nodes or not including nodes, write one row per flow
        if not nodes:
            col_idx = 1
            for attr in flow_attributes:
                if attr in flow_attr_map:
                    value = flow_attr_map[attr][1](flow_data)
                    cell = ws_flows.cell(row=row_idx, column=col_idx, value=value)
                    cell.border = thin_border
                    cell.alignment = Alignment(vertical="top", wrap_text=True)
                    col_idx += 1
            
            # Add empty node columns if needed
            if include_flow_nodes:
                for _ in node_headers:
                    cell = ws_flows.cell(row=row_idx, column=col_idx, value='')
                    cell.border = thin_border
                    col_idx += 1
            
            row_idx += 1
        else:
            # Write one row per node (with edge info if available)
            for node in nodes:
                node_data = node.get('data', {})
                node_id = node.get('id', node_data.get('id', ''))
                node_type = node.get('type', node_data.get('type', ''))
                node_label = node_data.get('label', '')
                
                # For decision, merge, start, end nodes: show N/A for owner, system, automation
                if node_type.lower() in na_node_types:
                    node_owner = 'N/A'
                    node_system = 'N/A'
                    node_automation = 'N/A'
                else:
                    node_owner = node_data.get('owner', '')
                    node_system = node_data.get('system', '')
                    node_automation = node_data.get('manualOrAutomated', '')
                
                # Get edges where this node is the source
                edges_from_node = node_edges.get(node_id, [])
                
                # If no outgoing edges, write one row with empty edge columns
                if not edges_from_node:
                    col_idx = 1
                    
                    # Write flow attributes
                    for attr in flow_attributes:
                        if attr in flow_attr_map:
                            value = flow_attr_map[attr][1](flow_data)
                            cell = ws_flows.cell(row=row_idx, column=col_idx, value=value)
                            cell.border = thin_border
                            cell.alignment = Alignment(vertical="top", wrap_text=True)
                            col_idx += 1
                    
                    # Write node attributes using helper function
                    node_values = build_node_values(node_id, node_type, node_label, node_owner, node_system, node_automation, '', '', '')
                    for value in node_values:
                        cell = ws_flows.cell(row=row_idx, column=col_idx, value=value)
                        cell.border = thin_border
                        cell.alignment = Alignment(vertical="top", wrap_text=True)
                        col_idx += 1
                    
                    row_idx += 1
                else:
                    # Write one row per outgoing edge
                    for source, target, edge_id in edges_from_node:
                        col_idx = 1
                        
                        # Write flow attributes
                        for attr in flow_attributes:
                            if attr in flow_attr_map:
                                value = flow_attr_map[attr][1](flow_data)
                                cell = ws_flows.cell(row=row_idx, column=col_idx, value=value)
                                cell.border = thin_border
                                cell.alignment = Alignment(vertical="top", wrap_text=True)
                                col_idx += 1
                        
                        # Write node attributes with edge info using helper function
                        node_values = build_node_values(node_id, node_type, node_label, node_owner, node_system, node_automation, source, target, edge_id)
                        for value in node_values:
                            cell = ws_flows.cell(row=row_idx, column=col_idx, value=value)
                            cell.border = thin_border
                            cell.alignment = Alignment(vertical="top", wrap_text=True)
                            col_idx += 1
                        
                        row_idx += 1
    
    # Auto-adjust column widths for flows
    for col_idx in range(1, len(flow_headers) + 1):
        column_letter = get_column_letter(col_idx)
        max_length = 0
        for row in ws_flows.iter_rows(min_col=col_idx, max_col=col_idx):
            for cell in row:
                try:
                    if cell.value:
                        max_length = max(max_length, len(str(cell.value)))
                except:
                    pass
        ws_flows.column_dimensions[column_letter].width = min(max_length + 2, 50)

    # Save to temporary file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        wb.save(tmp.name)
        return tmp.name
