"""
SOP AI Suggestions Service
Generates AI-powered enhancement suggestions for SOP documents including:
- Tracked changes for missing or improved content
- Comments for TBD/Unknown fields requiring user action
- Screenshot placeholder suggestions
"""
import json
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Dict, Any, Optional

from utils.llm_client import get_client, get_chat_model

logger = logging.getLogger(__name__)


class SuggestionType(Enum):
    """Type of AI suggestion"""
    TRACKED_CHANGE = "tracked_change"  # Insert as tracked change (rewritten content)
    COMMENT = "comment"  # Insert as Word comment (requires user action)
    SCREENSHOT_PLACEHOLDER = "screenshot_placeholder"  # Red placeholder + comment


@dataclass
class SOPSuggestion:
    """Represents a single AI suggestion for the SOP"""
    suggestion_type: SuggestionType
    section: str  # Which section this applies to (e.g., "step_1", "purpose", "scope")
    original_text: Optional[str] = None  # Original text being replaced/commented
    suggested_text: str = ""  # The suggested/improved text
    comment_text: Optional[str] = None  # Comment explanation (for COMMENT and SCREENSHOT_PLACEHOLDER types)
    node_id: Optional[str] = None  # Associated node ID if applicable
    field_name: Optional[str] = None  # Field name if specific (e.g., "owner", "system")


@dataclass
class SOPSuggestionsResult:
    """Result from AI suggestions generation"""
    suggestions: List[SOPSuggestion] = field(default_factory=list)
    process_name: str = ""
    summary: str = ""  # Brief summary of all suggestions


class SOPAIService:
    """
    Service for generating AI-powered SOP enhancement suggestions.
    
    Responsibilities:
    - Analyze process flow data and taxonomy metadata
    - Identify gaps, unclear content, and opportunities for improvement
    - Generate specific suggestions as tracked changes or comments
    
    NOT responsible for:
    - Modifying SOP structure or section headings
    - Adding/changing TOC, contributors, reviewers, version numbers
    """
    
    def __init__(self):
        self.client = get_client()
        self.model = get_chat_model()
        self.temperature = 0.3
    
    async def generate_sop_suggestions(
        self,
        process: Dict[str, Any],
        flow_data: Optional[Dict[str, Any]],
        hierarchy: Dict[str, str],
        assignments: List[Dict[str, Any]]
    ) -> SOPSuggestionsResult:
        """
        Generate AI suggestions for SOP enhancement.
        
        Args:
            process: Process taxonomy data (name, description, level, etc.)
            flow_data: Process flow data with nodes and edges
            hierarchy: Dict with L0-L3 names
            assignments: List of process assignments with roles
            
        Returns:
            SOPSuggestionsResult with list of suggestions
        """
        try:
            # Build context for LLM
            context = self._build_analysis_context(process, flow_data, hierarchy, assignments)
            
            # Get suggestions from LLM
            system_prompt = self._build_system_prompt()
            user_prompt = self._build_user_prompt(context)
            
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                functions=[{
                    "name": "generate_sop_suggestions",
                    "description": "Generate AI suggestions for SOP enhancement",
                    "parameters": self._get_suggestions_schema()
                }],
                function_call={"name": "generate_sop_suggestions"},
                temperature=self.temperature,
            )
            
            # Parse response
            function_call = response.choices[0].message.function_call
            if function_call and function_call.name == "generate_sop_suggestions":
                result = json.loads(function_call.arguments)
                return self._parse_suggestions_result(result, process.get('name', ''))
            
            return SOPSuggestionsResult(process_name=process.get('name', ''))
            
        except Exception as e:
            logger.error(f"Error generating SOP suggestions: {e}")
            return SOPSuggestionsResult(process_name=process.get('name', ''))
    
    def _build_analysis_context(
        self,
        process: Dict[str, Any],
        flow_data: Optional[Dict[str, Any]],
        hierarchy: Dict[str, str],
        assignments: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Build context dict for LLM analysis"""
        nodes = []
        edges = []
        
        if flow_data:
            if isinstance(flow_data, str):
                try:
                    flow_data = json.loads(flow_data)
                except json.JSONDecodeError:
                    flow_data = {}
            nodes = flow_data.get('nodes', [])
            edges = flow_data.get('edges', [])
        
        # Extract step details
        steps = []
        for i, node in enumerate(nodes):
            node_data = node.get('data', {})
            node_type = node_data.get('type', node.get('type', 'process'))
            
            if node_type == 'process':
                has_screenshot = bool(node_data.get("screenshot_url") or node_data.get("screenshotUrl"))
                steps.append({
                    'step_number': len(steps) + 1,
                    'node_id': node.get('id'),
                    'label': node_data.get('label', ''),
                    'owner': node_data.get('owner', 'TBD'),
                    'system': node_data.get('system', 'TBD'),
                    'manual_or_automated': node_data.get('manualOrAutomated', 'unknown'),
                    'has_screenshot': has_screenshot,
                    'type': 'process'
                })
            elif node_type == 'decision':
                steps.append({
                    'step_number': len(steps) + 1,
                    'node_id': node.get('id'),
                    'label': node_data.get('label', ''),
                    'type': 'decision'
                })
        
        # Extract owners
        owners = []
        for assignment in assignments:
            if assignment.get('role', '').lower() == 'owner':
                owners.append({
                    'email': assignment.get('user_email', ''),
                    'full_name': assignment.get('full_name', '')
                })
        
        return {
            'process_name': process.get('name', 'Untitled'),
            'process_description': process.get('description', ''),
            'hierarchy': hierarchy,
            'owners': owners,
            'steps': steps,
            'step_count': len(steps),
            'has_flow': len(steps) > 0
        }
    
    def _build_system_prompt(self) -> str:
        """Build the system prompt for SOP enhancement analysis"""
        return """You are an expert PROCESS AUDITOR reviewing a draft SOP.

Your goal is to identify logic gaps, hidden decision criteria, undefined exceptions, and unclear handoffs.
You must ask high-value, audit-quality questions that make the SOP operationally complete.

═══════════════════════════════════════════════════════════════════════════════
TRACKED CHANGES — Generate for ALL steps
═══════════════════════════════════════════════════════════════════════════════

For EVERY step, generate a TRACKED_CHANGE with a professional description that:
✓ Summarizes what happens in BUSINESS LANGUAGE
✓ Explains the INTENT and PURPOSE of the step
✓ Mentions what TRIGGERS it and what it PRODUCES
✓ Describes the HANDOFF to the next step
✓ Uses generic, enterprise-appropriate language

DO NOT invent or guess:
✗ Specific field names, dropdown values, or menu paths
✗ GL accounts, cost center codes, or numeric thresholds
✗ Technical UI configurations or system internals
✗ Details not present in the step metadata

GOOD EXAMPLE:
"Following management approval, the compliance review is initiated. The designated reviewer accesses the pending request queue and evaluates whether the requested access aligns with the employee's job responsibilities and organizational security policies. Any concerns regarding segregation of duties or excessive privileges are flagged for additional review. Upon completion, the request either advances to provisioning or is returned with specific feedback for the requester."

BAD EXAMPLE (too specific — don't do this):
"Navigate to SAP Menu → Security → Access Management → Tab 3. Select dropdown value 'Standard Access' from the Request Type field. Enter cost center 4500-2300."

═══════════════════════════════════════════════════════════════════════════════
COMMENTS — CONTEXT-SPECIFIC, BASED ON THE DESCRIPTION TEXT
═══════════════════════════════════════════════════════════════════════════════

Comments must REFERENCE the actual description content and ask for SPECIFIC additional information.

CRITICAL RULE — NO GENERIC COMMENTS:
✗ Forbidden: "Please clarify", "Add more detail", "Is this correct?", "Can you explain?", "Looks good"
✓ Required: A concrete, answerable question referencing what’s written.

HOW TO WRITE CONTEXT-AWARE COMMENTS:

1. Read what's written in the description
2. Identify what's mentioned but not fully explained
3. Ask for the specific missing detail

TARGET AMBIGUITY — ASK LIKE AN AUDITOR:

Decision criteria / thresholds:
- If a decision exists like "Stock sufficient?" ask:
  "The decision uses 'sufficient' — what exact threshold defines 'sufficient' (e.g., >50 units, >=2 weeks cover), and where is it sourced?"

Option selection / configuration choices:
- If the step chooses a setting like "Select 'PDF' format" ask:
  "You reference selecting 'PDF' — is PDF always required, or does the allowed format depend on client, region, or document type?"

Handoffs (Role/Team A → Role/Team B):
- If a handoff occurs ask:
  "The step hands off to another role/team — how are they notified (automated task, email, chat, ticket), and what evidence should be recorded?"

Exceptions & rejection paths:
- If a step involves validation/approval/review, ask:
  "If validation fails or the request is rejected, what happens next (return to requester vs escalation), and what notes/reason codes are required?"

GOOD EXAMPLES (reference the description):
- "The description mentions 'reviewing the request' — what specific aspects should be checked? (e.g., budget codes, approval authority, policy compliance)"
- "You mention the request is 'forwarded to IT' — is this automatic via the system or does the user manually notify IT?"
- "The step references 'compliance validation' — what specific policies or checklists should be consulted?"
- "The handoff to the next team is mentioned — what information should be included in the handoff?"

BAD EXAMPLES (too generic — AVOID):
- "What criteria are used?"
- "Please add more detail"
- "Consider documenting this step"
- "What information is needed?"

RULE: Every comment must contain a phrase like:
- "The description mentions..."
- "You reference..."
- "The step indicates..."
- "Since this involves..."

═══════════════════════════════════════════════════════════════════════════════
SECONDARY (use sparingly):
═══════════════════════════════════════════════════════════════════════════════
- TBD owner/system (only if actually TBD)
- Screenshot (max 1-2 per SOP, ONLY when step has no screenshot attached)

═══════════════════════════════════════════════════════════════════════════════
DO NOT:
═══════════════════════════════════════════════════════════════════════════════
✗ Ask generic questions that don't reference the description
✗ Ask for dropdown values, cost centers, GL accounts
✗ Generate more than 5 comments per SOP or menu paths

═══════════════════════════════════════════════════════════════════════════════
PURPOSE SECTION
═══════════════════════════════════════════════════════════════════════════════

Generate a professional purpose statement that:
- Explains WHY the process exists
- States the BUSINESS OUTCOME
- Mentions WHO benefits from the process
- Uses enterprise-appropriate language

═══════════════════════════════════════════════════════════════════════════════
SUMMARY
═══════════════════════════════════════════════════════════════════════════════

✓ Generate tracked-change descriptions for ALL steps
✓ Use business language, not technical specifics
✓ Comments must be audit-quality questions targeting ambiguity
✓ Absolutely no generic filler comments

For each suggestion provide: section, node_id (if applicable), suggestion_type, suggested_text (for tracked_change), comment_text (for comment)"""

    def _build_user_prompt(self, context: Dict[str, Any]) -> str:
        """Build the user prompt with process context"""
        steps_text = ""
        for step in context.get('steps', []):
            if step.get('type') == 'process':
                steps_text += f"""
Step {step['step_number']} (ID: {step['node_id']}):
  Label: "{step['label']}"
  Owner: {step['owner']}
  System: {step['system']}
  Manual/Automated: {step['manual_or_automated']}
  Screenshot attached: {"yes" if step.get("has_screenshot") else "no"}
"""
            elif step.get('type') == 'decision':
                steps_text += f"""
Step {step['step_number']} (ID: {step['node_id']}) [DECISION]:
  Question: "{step['label']}"
"""
        
        owners_text = ", ".join([
            f"{o.get('full_name', 'Unknown')} ({o.get('email', 'unknown@example.com')})"
            for o in context.get('owners', [])
        ]) or "No owners assigned"
        
        return f"""Generate SOP improvement suggestions for this process.

PROCESS: {context.get('process_name', 'Untitled')}
DESCRIPTION: {context.get('process_description', 'No description provided')}

HIERARCHY:
- L0: {context['hierarchy'].get('l0_name', 'N/A')}
- L1: {context['hierarchy'].get('l1_name', 'N/A')}
- L2: {context['hierarchy'].get('l2_name', 'N/A')}
- L3: {context['hierarchy'].get('l3_name', 'N/A')}

OWNERS: {owners_text}

PROCESS STEPS ({context.get('step_count', 0)} total):
{steps_text if steps_text else "No steps defined in the process flow."}

═══════════════════════════════════════════════════════════════════════════════
WHAT TO GENERATE
═══════════════════════════════════════════════════════════════════════════════

1. PURPOSE (section='purpose'):
   Generate a TRACKED_CHANGE with a professional purpose statement explaining:
   - Why this process exists
   - What business outcome it achieves
   - Who benefits from it

2. FOR EVERY STEP (section='step_N', include node_id):

   TRACKED_CHANGE — Generate a business-readable description that:
   - Summarizes what happens in this step
   - Explains the intent and purpose
   - Mentions what triggers it and what it produces
   - Describes the handoff to the next step
   - Uses GENERIC procedures (e.g., "access the system", "review the request")
   - Does NOT invent specific field names, dropdown values, or menu paths

   COMMENT — Must REFERENCE the description and ask for SPECIFIC missing info:
   
   RULE: Every comment must reference what's written, not ask generic questions.
   
   GOOD: "The description mentions reviewing for compliance — what specific policies should be checked?"
   GOOD: "You reference forwarding to IT — is this automatic or does the user need to notify them manually?"
   GOOD: "Since this involves approval, what documentation should the approver leave (e.g., notes, reason codes)?"
   
   BAD: "What criteria are used?" (too generic)
   BAD: "Add more detail" (not specific)
   
   📷 SECONDARY (max 2 per SOP):
      Screenshot suggestions ONLY for key visual steps that have "Screenshot attached: no"

3. DECISION NODES:
   Generate TRACKED_CHANGE explaining the decision's purpose.
   Generate COMMENT only if branch criteria are unclear:
   "What criteria determine each branch outcome?"

═══════════════════════════════════════════════════════════════════════════════
DO NOT
═══════════════════════════════════════════════════════════════════════════════

✗ Invent specific field names, dropdowns, or menu paths
✗ Ask for cost center codes, GL accounts, or thresholds
✗ Generate hyper-specific technical questions
✗ Use placeholder text or meta-instructions

═══════════════════════════════════════════════════════════════════════════════
RULES
═══════════════════════════════════════════════════════════════════════════════

- Generate TRACKED_CHANGE for ALL steps (not just some)
- Generate COMMENTS only when there's a meaningful gap
- Always include node_id for step-specific suggestions
- section format: 'purpose', 'scope', 'step_1', 'step_2', etc.
- Comments must make the SOP more complete, visual, and operationally useful

Focus on making the SOP immediately useful for staff new to this process."""

    def _get_suggestions_schema(self) -> Dict[str, Any]:
        """Get JSON schema for suggestions function"""
        return {
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Brief summary of all suggestions generated"
                },
                "suggestions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "suggestion_type": {
                                "type": "string",
                                "enum": ["tracked_change", "comment", "screenshot_placeholder"],
                                "description": "Type of suggestion"
                            },
                            "section": {
                                "type": "string",
                                "description": "Section this applies to (e.g., 'purpose', 'scope', 'step_1', 'step_2')"
                            },
                            "node_id": {
                                "type": "string",
                                "description": "Node ID if applicable to a specific step"
                            },
                            "field_name": {
                                "type": "string",
                                "description": "Field name if applicable (e.g., 'owner', 'system', 'label')"
                            },
                            "original_text": {
                                "type": "string",
                                "description": "Original text being replaced or commented on"
                            },
                            "suggested_text": {
                                "type": "string",
                                "description": "The suggested/improved text"
                            },
                            "comment_text": {
                                "type": "string",
                                "description": "Comment explanation for COMMENT and SCREENSHOT_PLACEHOLDER types"
                            }
                        },
                        "required": ["suggestion_type", "section", "suggested_text"]
                    }
                }
            },
            "required": ["summary", "suggestions"]
        }
    
    def _parse_suggestions_result(
        self,
        result: Dict[str, Any],
        process_name: str
    ) -> SOPSuggestionsResult:
        """Parse LLM response into SOPSuggestionsResult"""
        suggestions = []
        
        for item in result.get('suggestions', []):
            suggestion_type_str = item.get('suggestion_type', 'comment')
            try:
                suggestion_type = SuggestionType(suggestion_type_str)
            except ValueError:
                suggestion_type = SuggestionType.COMMENT
            
            suggestion = SOPSuggestion(
                suggestion_type=suggestion_type,
                section=item.get('section', 'unknown'),
                original_text=item.get('original_text'),
                suggested_text=item.get('suggested_text', ''),
                comment_text=item.get('comment_text'),
                node_id=item.get('node_id'),
                field_name=item.get('field_name')
            )
            suggestions.append(suggestion)
        
        return SOPSuggestionsResult(
            suggestions=suggestions,
            process_name=process_name,
            summary=result.get('summary', '')
        )


# Singleton instance
sop_ai_service = SOPAIService()
