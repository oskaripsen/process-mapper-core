# schemas/process_flow.py
from __future__ import annotations
from typing import List, Optional, Dict, Any
from enum import Enum
from pydantic import BaseModel, Field

# ---------- Core Enums ----------

class NodeType(str, Enum):
    START = "start"
    PROCESS = "process"
    DECISION = "decision"
    MERGE = "merge"
    END = "end"

class AutomationLevel(str, Enum):
    MANUAL = "manual"
    AUTOMATED = "automated"
    UNKNOWN = "unknown"

# ---------- Graph Models ----------

class ProcessNode(BaseModel):
    id: str
    type: NodeType = Field(default=NodeType.PROCESS)
    label: str
    owner: Optional[str] = None
    system: Optional[str] = None
    automation: AutomationLevel = Field(default=AutomationLevel.MANUAL)

    # Optional metadata
    logical_id: Optional[str] = None
    user_modified: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    screenshot_url: Optional[str] = None
    
    # Layout metadata
    lane_index: Optional[int] = None  # For parallel node positioning

class ProcessEdge(BaseModel):
    id: str
    source: str
    target: str
    condition: Optional[str] = None

    # Optional metadata
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    
    # Layout metadata - orthogonal edge routing
    waypoints: Optional[List[Dict[str, float]]] = None  # [{x, y}, ...] for edge path
    user_modified_routing: bool = False  # Preserve on auto-layout if user edited

class ProcessFlow(BaseModel):
    nodes: List[ProcessNode] = Field(default_factory=list)
    edges: List[ProcessEdge] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

# ---------- Patch Models ----------

class PatchOperation(BaseModel):
    type: str  # "add_node" | "update_node" | "delete_node" | "add_edge" | "update_edge" | "delete_edge"
    node: Optional[ProcessNode] = None
    node_id: Optional[str] = None
    edge: Optional[ProcessEdge] = None
    edge_id: Optional[str] = None

class FlowPatch(BaseModel):
    operations: List[PatchOperation]
    source: str = "llm"
    created_at: Optional[str] = None
    applied_at: Optional[str] = None

# ---------- Validation Helpers ----------

def validate_flow_topology(flow: ProcessFlow) -> List[str]:
    """
    Validate structural constraints for process flows:
    - START: 0 incoming, exactly 1 outgoing
    - END: 1+ incoming, 0 outgoing
    - PROCESS: exactly 1 incoming, exactly 1 outgoing
    - DECISION: exactly 1 incoming, 2–4 outgoing
    - MERGE: 2+ incoming, 1+ outgoing (fan-in + fan-out allowed)
    """
    errs: List[str] = []
    node_by_id: Dict[str, ProcessNode] = {n.id: n for n in flow.nodes}

    incoming: Dict[str, int] = {n.id: 0 for n in flow.nodes}
    outgoing: Dict[str, int] = {n.id: 0 for n in flow.nodes}

    for e in flow.edges:
        if e.source not in node_by_id:
            errs.append(f"Edge source '{e.source}' not found")
            continue
        if e.target not in node_by_id:
            errs.append(f"Edge target '{e.target}' not found")
            continue
        outgoing[e.source] += 1
        incoming[e.target] += 1

    for n in flow.nodes:
        inn = incoming.get(n.id, 0)
        out = outgoing.get(n.id, 0)

        if n.type == NodeType.START:
            if inn != 0:
                errs.append(f"START node '{n.id}' must have 0 incoming (has {inn})")
            if out != 1:
                errs.append(f"START node '{n.id}' must have exactly 1 outgoing (has {out})")

        elif n.type == NodeType.END:
            if out != 0:
                errs.append(f"END node '{n.id}' must have 0 outgoing (has {out})")
            if inn < 1:
                errs.append(f"END node '{n.id}' must have at least 1 incoming (has {inn})")

        elif n.type == NodeType.PROCESS:
            if inn != 1:
                errs.append(f"PROCESS node '{n.id}' must have exactly 1 incoming (has {inn})")
            if out > 1:
                errs.append(f"PROCESS node '{n.id}' must have 0 or 1 outgoing (has {out})")

        elif n.type == NodeType.DECISION:
            if inn != 1:
                errs.append(f"DECISION node '{n.id}' must have exactly 1 incoming (has {inn})")
            if out < 2 or out > 4:
                errs.append(f"DECISION node '{n.id}' must have 2–4 outgoing (has {out})")

        elif n.type == NodeType.MERGE:
            if inn < 2:
                errs.append(f"MERGE node '{n.id}' must have 2+ incoming (has {inn})")
            if out < 1:
                errs.append(f"MERGE node '{n.id}' must have at least 1 outgoing (has {out})")

    return errs

# ---------- JSON Schema for Patches (for function calling) ----------

def get_patch_json_schema() -> Dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "operations": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string", "enum": [
                            "add_node", "update_node", "delete_node",
                            "add_edge", "update_edge", "delete_edge"
                        ]},
                        "node": {"type": "object"},
                        "node_id": {"type": "string"},
                        "edge": {"type": "object"},
                        "edge_id": {"type": "string"},
                    },
                    "required": ["type"],
                    "additionalProperties": True
                }
            }
        },
        "required": ["operations"]
    }
