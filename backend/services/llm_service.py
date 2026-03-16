"""
LLM Service - Unified Process Intent Extraction

Handles all three input modes (speech, chat, documents) through a unified extraction pipeline.
Focuses purely on semantic extraction - no graph topology concerns.
"""

import json
import logging
from typing import List, Dict, Any, Optional

from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from openai import RateLimitError, APIConnectionError, APIError

from schemas.intent_schema import ProcessIntent, get_intent_json_schema
from utils.circuit_breaker import openai_circuit_breaker
from utils.llm_client import get_client, get_chat_model

logger = logging.getLogger(__name__)


class LLMService:
    """
    Unified service for extracting process intent from any input source.
    
    Responsibilities:
    - Extract semantic meaning (steps, decisions, flows, metadata)
    - Handle incremental vs one-shot processing
    - Support text, documents, and multimodal inputs
    
    NOT responsible for:
    - Graph topology decisions (LLM provides this)
    - Patch generation (IntentTranslator does this)
    - Validation (PatchEngine does this)
    """

    def __init__(self):
        self.client = get_client()
        self.model = get_chat_model()
        self.temperature = 0.1

    async def extract_process_intent(
        self, 
        transcript: str, 
        context: Optional[str] = None
    ) -> Optional[ProcessIntent]:
        """
        Extract process intent from text transcript (speech or chat).
        
        Args:
            transcript: Text input from user
            context: Optional existing flow context for incremental updates
            
        Returns:
            ProcessIntent or None if no process found
        """
        system_prompt = self._build_system_prompt(is_document=False)
        user_prompt = self._build_user_prompt(transcript, context)
        
        return await self._call_llm(system_prompt, user_prompt)

    async def extract_process_intent_from_documents(
        self, 
        text: str, 
        context: Optional[str] = None, 
        images: Optional[List[str]] = None
    ) -> Optional[ProcessIntent]:
        """
        Extract process intent from document content (PDF, DOCX, PPTX, images).
        
        Args:
            text: Extracted text from documents
            context: Optional existing flow context
            images: Optional list of base64-encoded images
            
        Returns:
            ProcessIntent or None if no process found
        """
        system_prompt = self._build_system_prompt(is_document=True)
        user_prompt = self._build_user_prompt(text, context, is_document=True)
        
        # Build multimodal message if images provided
        if images and len(images) > 0:
            return await self._call_llm_multimodal(system_prompt, user_prompt, images)
        else:
            return await self._call_llm(system_prompt, user_prompt)

    def _build_system_prompt(self, is_document: bool = False) -> str:
        """Build system prompt for LLM based on input type."""
        
        base_prompt = """You are a business process analyst. Extract business process steps, decisions, and flows from user input.

CRITICAL RULES:
1. Extract ONLY semantic meaning - steps, decisions, flows, actors, systems
2. For incremental updates: Use EXACT UUIDs from context for existing steps
3. Only create new step IDs (new_s1, new_s2) for truly new steps
4. Preserve all existing nodes not mentioned in the current input

TOOL/APPLICATION IDENTIFICATION (CRITICAL):
- ALWAYS identify the SPECIFIC application or tool being used
- Use context clues: window titles, menu names, file extensions, UI elements mentioned
- Common macOS apps: Notes, Safari, Finder, Preview, Mail, Calendar, Reminders, Pages, Numbers, Keynote
- Common Windows apps: Notepad, File Explorer, Edge, Outlook, Word, Excel, PowerPoint
- Common web apps: Gmail, Google Docs, Slack, Teams, Notion, Trello, Jira, Salesforce
- NEVER use generic terms like "Open Application" or "Navigate to Section"
- If the transcript mentions ANY app-specific action (e.g., "typing a note", "saving a file"), infer the app
- Example: "I'm writing down some notes" → tool: "Notes" (not "Application")
- Example: "Let me check my email" → tool: "Mail" or "Gmail" or "Outlook"

DATA ABSTRACTION & USER-INPUT GENERALIZATION (CRITICAL):
- The output process flow must be reusable. Do NOT hardcode instance-specific user inputs from a single run.
- Treat concrete values (names, dates, IDs, emails, phone numbers, addresses, client names) as EXAMPLES and generalize them.
- Replace variable inputs with bracketed placeholders in step labels (and any description-like text fields):
  - Name entered into a Name field (e.g., "John") -> "Enter the [Employee Name]"
  - Date selected (e.g., "2026-01-01") -> "Select the [Target Date]"
  - ID/Number entered (e.g., "12345") -> "Input the [Reference ID]"
  - Email entered (e.g., "a@b.com") -> "Enter the [Email Address]"
- Only abstract VARIABLE user-provided data. Keep fixed UI navigation labels and menu items as-is:
  - Keep: Settings, Export, Submit, Save, PDF, CSV, Download, Share
- If the transcript includes a literal value, DO NOT copy it verbatim into the process flow.

STEP TYPES:
- "step": Regular business action (DEFAULT)
- "decision": Choice point with 2+ outcomes (MUST include options array)
- "merge": Point where multiple paths converge
- "start_point": Beginning of process (include for NEW flows only)
- "end_point": Explicit end of process

DECISION RULES:
- If a step has multiple outgoing flows with conditions, it MUST be type="decision"
- Always include "options" array with specific outcomes
- Always include "condition" on flows from decision nodes

INCREMENTAL UPDATE RULES:
- Match existing steps by label, owner, system, or context - use their EXACT UUID
- For metadata updates (owner/tool/label changes): Use existing UUID, update fields
- For insertions: Delete old edge, create new edges through inserted step
- Only use delete_steps when user explicitly says "remove" or "delete"

BULK UPDATES (CRITICAL):
- When user says "change across entire flow", "update all", "change everywhere", etc.:
  * You MUST include ALL affected nodes in the "steps" array with their EXACT UUIDs
  * Example: User says "use Concur for all AP steps"
    ✅ CORRECT: Include ALL AP step nodes in steps array with tool: "Concur"
    ❌ WRONG: Only including one node - user wants ALL nodes updated
  * Check the context's NODES list and include every node that matches the criteria
  * If unsure which nodes are affected, include ALL nodes that could match

CRITICAL: DECISION NODE EDGE HANDLING:
- Decision nodes can have MULTIPLE outgoing edges (one per outcome)
- When adding a NEW outgoing edge to an existing decision node:
  * DO NOT delete existing outgoing edges from that decision
  * ONLY add the new edge in the "flows" array
  * Example: Decision has edge to Step A, user wants to add edge to Step B
    ✅ CORRECT: flows: [{from: decision_id, to: step_b_id, condition: "..."}]
    ❌ WRONG: delete_flows: [{from: decision_id, to: step_a_id}] (don't delete existing!)
- Only use delete_flows when:
  * User explicitly says to remove a connection
  * Inserting a step in the middle of a flow (A→B becomes A→X→B)
  * User wants to replace one connection with another (not add to it)
"""

        if is_document:
            base_prompt += """

DOCUMENT PROCESSING:
- Filter out headers, footers, metadata, marketing text, legal disclaimers
- Extract ONLY: step-by-step procedures, decision points, role actions, system handoffs
- Build ONE connected process from start to end
"""

        return base_prompt

    def _build_user_prompt(
        self, 
        text: str, 
        context: Optional[str] = None,
        is_document: bool = False
    ) -> str:
        """Build user prompt with input text and context."""
        
        context_section = f"\n\n--- EXISTING FLOW CONTEXT ---\n{context}" if context else ""
        
        if is_document:
            return f"""--- DOCUMENT CONTENT ---
{text}
{context_section}

Extract the business process from this document. Focus on:
1. STEPS: What concrete actions are performed?
2. DECISIONS: What choice points exist? Include options array.
3. FLOWS: What is the sequence? Include conditions on decision flows.
4. METADATA: Who (owner), what system (tool), manual or automated?

Create ONE CONNECTED process from start to end."""
        else:
            return f"""Transcript:
"{text}"
{context_section}

Extract the business process described. Focus on:
1. STEPS: What actions/tasks are performed?
2. DECISIONS: What choices are made? What are the possible outcomes?
3. FLOWS: What is the logical sequence?
4. METADATA: Who does each step? What tools are used?

Create ONE CONNECTED process, not fragments."""

    async def _call_llm(
        self, 
        system_prompt: str, 
        user_prompt: str
    ) -> Optional[ProcessIntent]:
        """Call LLM with text-only input."""
        @retry(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=2, max=10),
            retry=retry_if_exception_type((RateLimitError, APIConnectionError, APIError)),
            reraise=True
        )
        async def _make_request():
            return await openai_circuit_breaker.call_async(
                self.client.chat.completions.create,
                model=self.model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                functions=[{
                    "name": "extract_process_intent",
                    "description": "Extract semantic process intent",
                    "parameters": get_intent_json_schema()
                }],
                function_call={"name": "extract_process_intent"},
                temperature=self.temperature,
            )
        
        try:
            response = await _make_request()

            self._log_token_usage(response.usage)
            
            function_call = response.choices[0].message.function_call
            if function_call and function_call.name == "extract_process_intent":
                result = json.loads(function_call.arguments)
                intent = ProcessIntent(**result)
                self._log_intent(intent)
                return intent

            return None

        except Exception as e:
            logger.error(f"LLM extraction error: {str(e)}")
            return None

    async def _call_llm_multimodal(
        self, 
        system_prompt: str, 
        user_prompt: str,
        images: List[str]
    ) -> Optional[ProcessIntent]:
        """Call LLM with text + images (multimodal)."""
        # Build multimodal message content
        message_content = [{"type": "text", "text": user_prompt}]
        
        # Add images (limit to 10 to avoid token overflow)
        for img_data in images[:10]:
            message_content.append({
                "type": "image_url",
                "image_url": {"url": img_data}
            })

        @retry(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=2, max=10),
            retry=retry_if_exception_type((RateLimitError, APIConnectionError, APIError)),
            reraise=True
        )
        async def _make_request():
            return await openai_circuit_breaker.call_async(
                self.client.chat.completions.create,
                model=self.model,  # gpt-4o supports vision
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": message_content},
                ],
                functions=[{
                    "name": "extract_process_intent",
                    "description": "Extract semantic process intent from documents",
                    "parameters": get_intent_json_schema()
                }],
                function_call={"name": "extract_process_intent"},
                temperature=self.temperature,
            )
        
        try:
            response = await _make_request()

            self._log_token_usage(response.usage)
            
            function_call = response.choices[0].message.function_call
            if function_call and function_call.name == "extract_process_intent":
                result = json.loads(function_call.arguments)
                intent = ProcessIntent(**result)
                self._log_intent(intent)
                return intent

            return None

        except Exception as e:
            logger.error(f"LLM multimodal extraction error: {str(e)}")
            return None

    def _log_token_usage(self, usage: Any) -> None:
        """Log token usage and cost."""
        if not usage:
            return
        
        input_tokens = usage.prompt_tokens
        output_tokens = usage.completion_tokens
        total_tokens = usage.total_tokens
        
        # GPT-4o pricing: $0.005/1K input, $0.015/1K output
        input_cost = (input_tokens / 1000) * 0.005
        output_cost = (output_tokens / 1000) * 0.015
        total_cost = input_cost + output_cost
        
        logger.info(f"Token Usage: {input_tokens:,} in, {output_tokens:,} out, {total_tokens:,} total (${total_cost:.4f})")

    def _log_intent(self, intent: ProcessIntent) -> None:
        """Log extracted intent summary (sanitized)."""
        steps_count = len(intent.steps) if intent.steps else 0
        flows_count = len(intent.flows) if intent.flows else 0
        delete_steps_count = len(intent.delete_steps) if intent.delete_steps else 0
        delete_flows_count = len(intent.delete_flows) if intent.delete_flows else 0
        logger.info(
            f"Extracted intent: {steps_count} steps, {flows_count} flows, "
            f"{delete_steps_count} deletions, {delete_flows_count} edge deletions"
        )
