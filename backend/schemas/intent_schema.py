"""
Intent Schema for Semantic Process Understanding

This schema defines the Intent JSON format that the LLM should generate.
It captures ONLY semantic meaning without graph topology concerns.
"""

from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
from enum import Enum


class IntentStepType(str, Enum):
    """
    Semantic step types that describe what happens, not graph topology.
    """
    STEP = "step"  # A business process step or action
    DECISION = "decision"  # A choice or branching point
    MERGE = "merge"  # A point where multiple paths converge
    START_POINT = "start_point"  # Beginning of the process
    END_POINT = "end_point"  # End of the process


class IntentStep(BaseModel):
    """
    A semantic step in the business process.
    Describes WHAT happens, not HOW it connects.
    """
    id: str = Field(description="Unique identifier for this step")
    text: str = Field(description="Natural language description of what happens")
    step_type: IntentStepType = Field(description="Semantic type of this step")
    
    # Optional semantic metadata
    who: Optional[str] = Field(None, description="Who performs this step")
    tool: Optional[str] = Field(None, description="What tool/system is used")
    manual_auto: Optional[str] = Field(None, description="manual, automated, or unknown")
    
    # For decisions: possible outcomes
    options: Optional[List[str]] = Field(None, description="For decisions: list of possible outcomes")


class IntentFlow(BaseModel):
    """
    A semantic flow connection between steps.
    Describes logical sequence without graph constraints.
    """
    from_step: str = Field(description="ID of the source step")
    to_step: str = Field(description="ID of the target step")
    condition: Optional[str] = Field(None, description="Condition for this flow (for decision branches)")


class IntentFlowDeletion(BaseModel):
    """
    Represents an edge/flow that should be deleted.
    Used when inserting steps in the middle of existing flows.
    """
    from_step: str = Field(description="ID of the source step")
    to_step: str = Field(description="ID of the target step")


class IntentStepDeletion(BaseModel):
    """
    Represents a step/node that should be deleted.
    Used when user wants to remove unnecessary or incorrect steps.
    """
    step_id: str = Field(description="ID of the step to delete")


class ProcessIntent(BaseModel):
    """
    Complete semantic representation of a business process.
    Contains only meaning, not graph topology.
    """
    steps: List[IntentStep] = Field(description="All steps in the process")
    flows: List[IntentFlow] = Field(description="Logical connections to ADD/CREATE")
    delete_steps: Optional[List[IntentStepDeletion]] = Field(None, description="Existing steps to DELETE (when removing unnecessary steps)")
    delete_flows: Optional[List[IntentFlowDeletion]] = Field(None, description="Existing connections to DELETE (when inserting steps in middle)")
    
    # Optional metadata
    process_name: Optional[str] = Field(None, description="Name of the process")
    description: Optional[str] = Field(None, description="Description of what this process does")


def get_intent_json_schema() -> Dict[str, Any]:
    """
    Get JSON schema for OpenAI function calling to generate Intent JSON.
    """
    return {
        "type": "object",
        "properties": {
            "steps": {
                "type": "array",
                "description": "All steps in the business process",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "string",
                            "description": "Unique identifier for this step (e.g. 's1', 's2')"
                        },
                        "text": {
                            "type": "string", 
                            "description": "Natural language description of what happens in this step"
                        },
                        "step_type": {
                            "type": "string",
                            "enum": ["step", "decision", "merge", "start_point", "end_point"],
                            "description": "Semantic type of this step"
                        },
                        "who": {
                            "type": "string",
                            "description": "Who performs this step (optional)"
                        },
                        "tool": {
                            "type": "string",
                            "description": "What tool/system is used (optional)"
                        },
                        "manual_auto": {
                            "type": "string",
                            "enum": ["manual", "automated", "unknown"],
                            "description": "Whether step is manual or automated"
                        },
                        "options": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "For decisions: list of possible outcomes"
                        }
                    },
                    "required": ["id", "text", "step_type"]
                }
            },
            "flows": {
                "type": "array",
                "description": "Logical connections to ADD or CREATE",
                "items": {
                    "type": "object", 
                    "properties": {
                        "from_step": {
                            "type": "string",
                            "description": "ID of the source step"
                        },
                        "to_step": {
                            "type": "string", 
                            "description": "ID of the target step"
                        },
                        "condition": {
                            "type": "string",
                            "description": "Condition for this flow (for decision branches)"
                        }
                    },
                    "required": ["from_step", "to_step"]
                }
            },
            "delete_steps": {
                "type": "array",
                "description": "Existing steps to DELETE (use when user wants to remove unnecessary or incorrect steps)",
                "items": {
                    "type": "object",
                    "properties": {
                        "step_id": {
                            "type": "string",
                            "description": "ID of the step to delete"
                        }
                    },
                    "required": ["step_id"]
                }
            },
            "delete_flows": {
                "type": "array",
                "description": "Existing connections to DELETE (use when inserting steps in the middle of a flow)",
                "items": {
                    "type": "object",
                    "properties": {
                        "from_step": {
                            "type": "string",
                            "description": "ID of the source step of edge to delete"
                        },
                        "to_step": {
                            "type": "string",
                            "description": "ID of the target step of edge to delete"
                        }
                    },
                    "required": ["from_step", "to_step"]
                }
            },
            "process_name": {
                "type": "string",
                "description": "Name of the process (optional)"
            },
            "description": {
                "type": "string", 
                "description": "Description of what this process does (optional)"
            }
        },
        "required": ["steps", "flows"]
    }
