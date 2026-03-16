"""
SOP Document Generator Service
Generates Standard Operating Procedure Word documents from process flow data
with AI-powered enhancement suggestions including:
- Tracked changes for AI-proposed content improvements (Accept/Reject in Word)
- Real Word comments for items requiring user action (visible in Comments pane)
- Proper flow topology following source → target relationships
- Auto-generated descriptions for every step using LLM
"""
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.style import WD_STYLE_TYPE
from docx.enum.section import WD_ORIENT
from docx.oxml.ns import qn, nsmap
from docx.oxml import OxmlElement
from collections import defaultdict
from datetime import datetime
import json
import re
import io
import os
import uuid
import zipfile
import base64
import httpx

from utils.llm_client import get_client, get_chat_model, get_vision_model

logger = logging.getLogger(__name__)

# XML namespaces for Word Open XML
WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W_NS = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


class WordDocumentEnhancer:
    """
    Helper class for adding tracked changes and real Word comments.
    """
    
    def __init__(self, doc: Document):
        self.doc = doc
        self.revision_id = 0
        self.comment_id = 0
        self.author = "process_mapper_core"
        self.date = datetime.now().strftime("%Y-%m-%dT%H:%M:%SZ")
        self.comments = []
        
        self._enable_track_revisions()
    
    def _enable_track_revisions(self):
        """Enable track revisions at the document settings level"""
        settings = self.doc.settings.element
        track_revisions = settings.find(qn('w:trackRevisions'))
        if track_revisions is None:
            track_revisions = OxmlElement('w:trackRevisions')
            settings.append(track_revisions)
        logger.info("SOP Generation: Track revisions enabled")
    
    def _get_next_revision_id(self) -> int:
        self.revision_id += 1
        return self.revision_id
    
    def _get_next_comment_id(self) -> int:
        comment_id = self.comment_id
        self.comment_id += 1
        return comment_id
    
    def add_tracked_insertion(self, paragraph, text: str, bold: bool = False):
        """Add text as a tracked insertion (w:ins element).
        
        Note: Word automatically applies visual formatting (underline, color) to tracked changes.
        We don't need to manually set these as they're controlled by Word's track changes feature.
        """
        run = paragraph.add_run(text)
        if bold:
            run.font.bold = True
        # Don't manually set underline or color - Word handles this automatically for tracked changes
        
        r_element = run._element
        ins_element = OxmlElement('w:ins')
        ins_element.set(qn('w:id'), str(self._get_next_revision_id()))
        ins_element.set(qn('w:author'), self.author)
        ins_element.set(qn('w:date'), self.date)
        
        r_parent = r_element.getparent()
        r_index = list(r_parent).index(r_element)
        r_parent.remove(r_element)
        ins_element.append(r_element)
        r_parent.insert(r_index, ins_element)
        
        return run
    
    def add_comment(self, paragraph, comment_text: str):
        """Add a real Word comment to a paragraph."""
        comment_id = self._get_next_comment_id()
        
        self.comments.append({
            'id': comment_id,
            'author': self.author,
            'date': self.date,
            'initials': 'AI',
            'text': comment_text
        })
        
        p_element = paragraph._element
        
        comment_start = OxmlElement('w:commentRangeStart')
        comment_start.set(qn('w:id'), str(comment_id))
        
        comment_end = OxmlElement('w:commentRangeEnd')
        comment_end.set(qn('w:id'), str(comment_id))
        
        comment_ref_run = OxmlElement('w:r')
        comment_ref = OxmlElement('w:commentReference')
        comment_ref.set(qn('w:id'), str(comment_id))
        comment_ref_run.append(comment_ref)
        
        if len(p_element) > 0:
            p_element.insert(0, comment_start)
            p_element.append(comment_end)
            p_element.append(comment_ref_run)
        else:
            p_element.append(comment_start)
            p_element.append(comment_end)
            p_element.append(comment_ref_run)
        
        return comment_id
    
    def finalize_comments(self, doc_buffer: io.BytesIO) -> io.BytesIO:
        """Finalize the document by adding the comments.xml part."""
        if not self.comments:
            return doc_buffer
        
        logger.info(f"SOP Generation: Finalizing {len(self.comments)} comments into DOCX")
        
        comments_xml = self._build_comments_xml()
        doc_buffer.seek(0)
        output_buffer = io.BytesIO()
        
        with zipfile.ZipFile(doc_buffer, 'r') as zip_in:
            with zipfile.ZipFile(output_buffer, 'w', zipfile.ZIP_DEFLATED) as zip_out:
                for item in zip_in.namelist():
                    if item == '[Content_Types].xml':
                        content_types = zip_in.read(item).decode('utf-8')
                        content_types = self._add_comments_content_type(content_types)
                        zip_out.writestr(item, content_types)
                    elif item == 'word/_rels/document.xml.rels':
                        rels = zip_in.read(item).decode('utf-8')
                        rels = self._add_comments_relationship(rels)
                        zip_out.writestr(item, rels)
                    else:
                        zip_out.writestr(item, zip_in.read(item))
                
                zip_out.writestr('word/comments.xml', comments_xml)
        
        output_buffer.seek(0)
        return output_buffer
    
    def _build_comments_xml(self) -> str:
        xml_lines = [
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        ]
        
        for comment in self.comments:
            text = comment['text'].replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            xml_lines.append(
                f'<w:comment w:id="{comment["id"]}" w:author="{comment["author"]}" '
                f'w:date="{comment["date"]}" w:initials="{comment["initials"]}">'
                f'<w:p><w:r><w:t>{text}</w:t></w:r></w:p>'
                f'</w:comment>'
            )
        
        xml_lines.append('</w:comments>')
        return '\n'.join(xml_lines)
    
    def _add_comments_content_type(self, content_types: str) -> str:
        if 'comments.xml' in content_types:
            return content_types
        comments_override = '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
        return content_types.replace('</Types>', f'{comments_override}\n</Types>')
    
    def _add_comments_relationship(self, rels: str) -> str:
        if 'comments.xml' in rels:
            return rels
        ids = re.findall(r'Id="rId(\d+)"', rels)
        max_id = max([int(i) for i in ids]) if ids else 0
        new_id = f'rId{max_id + 1}'
        comments_rel = f'<Relationship Id="{new_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>'
        return rels.replace('</Relationships>', f'{comments_rel}\n</Relationships>')


class SOPGenerator:
    """Generates SOP Word documents from process taxonomy and flow data"""

    def __init__(self):
        self.enhancer = None
        self.node_step_map = {}  # Maps node_id -> step number
        self.step_labels = {}    # Maps step number -> label
        self._llm_client = None
        self._storage_service = None
        self.chat_model = get_chat_model()
        self.vision_model = get_vision_model()
        self.recording_metadata = {}

    def _normalize_placeholder_text(self, value: Any) -> str:
        """Normalize free-text for placeholder detection (no output mutation)."""
        if value is None:
            return ""
        s = str(value).strip().lower()
        if not s:
            return ""
        # Remove wrapper punctuation like "(tbd)" and normalize whitespace.
        s = s.replace("\u00a0", " ")
        s = re.sub(r"[\(\)\[\]\{\}]", " ", s)
        s = re.sub(r"\s+", " ", s).strip()
        return s

    def _is_placeholder_value(self, value: Any) -> bool:
        """
        True if the value is effectively "unspecified".
        Covers: tbd, (tbd), tbd (tbd), unknown/unkown, n/a, na, to be defined, user, owner, empty.
        """
        s = self._normalize_placeholder_text(value)
        if not s:
            return True

        # Keep "/" so n/a stays meaningful; drop other punctuation.
        s2 = re.sub(r"[^a-z0-9/\s]+", " ", s)
        s2 = re.sub(r"\s+", " ", s2).strip()

        direct = {
            "tbd", "tba", "tbc",
            "unknown", "unkown",
            "na", "n/a", "n a", "n.a", "n.a.",
            "none", "null", "nil", "undefined",
            "to be defined", "to be determined",
            "user", "owner",
        }
        if s2 in direct:
            return True
        if re.search(r"\btbd\b", s2):
            return True
        if re.search(r"\bunknown\b", s2) or re.search(r"\bunkown\b", s2):
            return True
        if "to be defined" in s2 or "to be determined" in s2:
            return True
        if s2.replace(" ", "") in {"na", "n/a", "n.a", "n.a."}:
            return True

        return False
    
    def _get_llm_client(self):
        """Get or create LLM client (OpenAI or Azure OpenAI)."""
        if self._llm_client is None:
            self._llm_client = get_client()
        return self._llm_client

    async def _load_local_screenshot(self, screenshot_url: str) -> Optional[bytes]:
        if not screenshot_url:
            return None
        
        # Handle both relative URLs (/api/storage/...) and full URLs (http://localhost:8000/api/storage/...)
        base_path = os.getenv("LOCAL_STORAGE_BASE_URL", "/api/storage").rstrip("/")
        
        # Extract the relative key from the URL
        relative_key = None
        if base_path in screenshot_url:
            # Find the position of /api/storage (or whatever base_path is) and extract everything after
            idx = screenshot_url.find(base_path)
            if idx != -1:
                relative_key = screenshot_url[idx + len(base_path):].lstrip("/")
        
        if not relative_key:
            return None
        
        local_dir = os.getenv("LOCAL_STORAGE_DIR", "local_storage")
        file_path = Path(local_dir) / relative_key
        if not file_path.exists():
            logger.debug(f"Local screenshot not found at {file_path}")
            return None
        from fastapi.concurrency import run_in_threadpool
        return await run_in_threadpool(file_path.read_bytes)

    async def _fetch_screenshot_bytes(self, screenshot_url: str) -> Optional[bytes]:
        if not screenshot_url:
            return None

        # Prefer downloading directly via StorageService (handles keys and legacy URLs).
        if self._storage_service:
            try:
                data = await self._storage_service.get_bytes(screenshot_url)
                if data:
                    return data
            except Exception as exc:
                logger.warning(f"StorageService.get_bytes failed for {screenshot_url}: {exc}")

        # Fallback: local file or HTTP fetch (dev mode / full URLs).
        local_bytes = await self._load_local_screenshot(screenshot_url)
        if local_bytes:
            return local_bytes

        resolved_url = screenshot_url
        if screenshot_url.startswith("/") and os.getenv("BACKEND_BASE_URL"):
            resolved_url = f"{os.getenv('BACKEND_BASE_URL').rstrip('/')}{screenshot_url}"

        if not resolved_url.startswith("http"):
            return None

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.get(resolved_url)
                response.raise_for_status()
                return response.content
        except Exception as exc:
            logger.warning(f"Failed to fetch screenshot {screenshot_url}: {exc}")
            return None

    def _normalize_transcript_segments(self, segments: Any) -> List[Dict[str, Any]]:
        if not segments:
            return []
        if isinstance(segments, str):
            try:
                segments = json.loads(segments)
            except json.JSONDecodeError:
                return []
        if isinstance(segments, dict) and "segments" in segments:
            segments = segments.get("segments")
        return segments if isinstance(segments, list) else []

    def _get_transcript_context_for_screenshot(self, screenshot_url: Optional[str]) -> Optional[str]:
        if not screenshot_url or not self.recording_metadata:
            return None
        transcript = self.recording_metadata.get("transcript")
        segments = self._normalize_transcript_segments(self.recording_metadata.get("transcript_segments"))
        screenshots = self.recording_metadata.get("screenshots") or []
        if not segments or not screenshots:
            return transcript

        timestamp = None
        for shot in screenshots:
            if shot.get("url") == screenshot_url:
                timestamp = shot.get("timestamp") or shot.get("captured_at")
                break
        if timestamp is None:
            return transcript

        try:
            timestamp_value = float(timestamp)
        except (TypeError, ValueError):
            return transcript

        # Best-effort matching: if timestamp looks like relative seconds, use it directly.
        # If it looks like epoch time, we cannot reliably align to transcript segments.
        if timestamp_value > 1e8:
            return transcript

        context_window = 6.0
        start = max(timestamp_value - context_window, 0)
        end = timestamp_value + context_window
        context_parts = []
        for seg in segments:
            seg_start = seg.get("start")
            seg_end = seg.get("end")
            seg_text = seg.get("text")
            if seg_text is None:
                continue
            try:
                seg_start = float(seg_start)
                seg_end = float(seg_end)
            except (TypeError, ValueError):
                continue
            if seg_end >= start and seg_start <= end:
                context_parts.append(seg_text.strip())
        return " ".join(context_parts).strip() if context_parts else transcript
    
    async def _auto_generate_purpose(self, process_name: str, existing_description: str, hierarchy: Dict[str, str], steps_summary: str = None) -> str:
        """
        Generate a Purpose section that is SPECIFIC to the actual process content.
        Based on the process name, flow steps, actors, and business outcome.
        """
        hierarchy_text = f"{hierarchy.get('l0_name', '')} → {hierarchy.get('l1_name', '')} → {hierarchy.get('l2_name', '')} → {hierarchy.get('l3_name', '')}"
        
        prompt = f"""Write a Purpose section for this SPECIFIC process SOP.

PROCESS NAME: "{process_name}"
HIERARCHY: {hierarchy_text}
DESCRIPTION: "{existing_description if existing_description else 'Not provided'}"

ACTUAL PROCESS STEPS:
{steps_summary if steps_summary else 'Steps not provided'}

Write a Purpose paragraph that is DIRECTLY TIED to the actual process above.

The Purpose MUST answer:
1. What does THIS SPECIFIC process achieve? (based on the steps)
2. Why does the organization perform it? (infer from the flow)
3. Who relies on it being completed correctly?
4. What does successful completion look like?

CRITICAL RULES:
- Base the purpose ONLY on the actual process name, steps, and actors shown above
- Do NOT invent generic corporate wording
- Do NOT reference unrelated domains or terminology not in the flow
- Do NOT start with "This SOP..." — be more direct
- Write 3-4 sentences maximum

EXAMPLE for an access request workflow:
"The purpose of this process is to ensure that employees receive appropriate system access based on job role, following a controlled approval and compliance review. This protects sensitive data, enforces role-based access policies, and supports efficient onboarding and internal mobility. Successful completion results in the employee having the necessary access to perform their job functions."

Now write the Purpose for the process above:"""

        try:
            client = self._get_llm_client()
            response = await client.chat.completions.create(
                model=self.chat_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=300
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Error generating purpose: {e}")
            return f"This process defines the standardized procedure for {process_name}, ensuring consistent execution and compliance with organizational standards."
    
    async def _auto_expand_step_description(
        self, 
        label: str, 
        owner: str, 
        system: str, 
        node_type: str,
        step_num: int = None,
        prev_step_label: str = None,
        prev_step_owner: str = None,
        next_step_label: str = None,
        next_step_owner: str = None,
        branch_info: str = None,
        screenshot_url: str = None,
        transcript_context: str = None
    ) -> str:
        """
        Generate a detailed step description using AI.
        Always returns a full procedural paragraph - never just the label.
        Includes context from previous and next steps for flow continuity.
        """
        # Build context section
        context_lines = []
        if prev_step_label:
            context_lines.append(f"Previous step: \"{prev_step_label}\" (performed by {prev_step_owner or 'unknown'})")
        if next_step_label:
            context_lines.append(f"Next step: \"{next_step_label}\" (performed by {next_step_owner or 'unknown'})")
        if branch_info:
            context_lines.append(f"Branch context: {branch_info}")
        
        context_section = "\n".join(context_lines) if context_lines else "This is a standalone step."

        screenshot_details = None
        if screenshot_url:
            screenshot_details = await self._analyze_screenshot_for_step(
                screenshot_url=screenshot_url,
                step_label=label,
                transcript_context=transcript_context
            )

        visual_section = (
            f"\nVISUAL DETAILS (from screenshot analysis):\n{screenshot_details}\n"
            if screenshot_details else ""
        )

        prompt = f"""Write a professional SOP step description in BUSINESS LANGUAGE.

STEP DETAILS:
- Step number: {step_num or 'N/A'}
- Label: "{label}"
- Role responsible: "{owner}"
- System used: "{system}"
- Step type: "{node_type}"
{visual_section}

FLOW CONTEXT:
{context_section}

Write a clear paragraph (3-5 sentences) that:

1. Summarizes what happens in this step in business terms
2. Explains the PURPOSE and INTENT of the step
3. Mentions what TRIGGERS this step (from the previous step)
4. Describes what this step PRODUCES for the next step
5. Notes any handoffs between roles

STYLE REQUIREMENTS:
- Use BUSINESS LANGUAGE, not technical jargon
- Use GENERIC procedures (e.g., "access the system", "review the request details")
- Do NOT invent specific field names, dropdown values, or menu paths unless explicitly stated in VISUAL DETAILS
- Do NOT guess GL accounts, cost centers, or numeric thresholds
- Do NOT repeat the step label verbatim
- Write for enterprise professionals new to this process

GOOD EXAMPLE:
"Following the initial submission, the designated approver reviews the request details to ensure completeness and alignment with organizational policies. The reviewer assesses whether the justification provided is sufficient and checks for any potential conflicts or concerns. Based on this evaluation, the request is either approved and forwarded for processing, or returned to the requester with specific feedback for clarification."

BAD EXAMPLE (too specific - avoid this):
"Navigate to SAP → Menu → Tab 3. Enter cost center 4500 in the CC field. Select 'Standard' from the dropdown."""

        try:
            client = self._get_llm_client()
            response = await client.chat.completions.create(
                model=self.chat_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
                max_tokens=400
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Error generating step description: {e}")
            return f"The {owner} performs this action using {system}. Complete the required inputs and verify the expected outcome before proceeding to the next step."

    async def _analyze_screenshot_for_step(
        self,
        screenshot_url: str,
        step_label: str,
        transcript_context: Optional[str]
    ) -> Optional[str]:
        image_bytes = await self._fetch_screenshot_bytes(screenshot_url)
        if not image_bytes:
            return None

        encoded = base64.b64encode(image_bytes).decode("utf-8")
        prompt = f"""Analyze this screenshot for SOP step: "{step_label}"

User's verbal context: "{transcript_context or 'Not provided'}"

Extract SPECIFIC procedural details visible in the screenshot:
- Exact menu/button names to click
- Settings or options to select (e.g., "select 'Monthly' from dropdown")
- Field labels and the type of input required (DO NOT include literal user-entered values)
- Dialog boxes, warnings, or confirmations

CRITICAL DATA ABSTRACTION:
- Do NOT copy instance-specific values from the screen (names, dates, IDs, emails, addresses).
- If you need to reference an input, use placeholders like: [Employee Name], [Target Date], [Reference ID], [Email Address].

Return a bullet list of specific actions, or "No specific details visible" if screenshot is unclear."""

        try:
            client = self._get_llm_client()
            response = await client.chat.completions.create(
                model=self.vision_model,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}}
                    ]
                }],
                temperature=0.2,
                max_tokens=300
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Error analyzing screenshot for step: {e}")
            return None

    async def _is_relevant_sop_screenshot_first_step(
        self,
        screenshot_url: str,
        step_label: str,
        system: Optional[str] = None,
    ) -> bool:
        """
        One-off safeguard: the very first screenshot in an SOP is high-stakes for demos.
        If the chosen screenshot appears to show recorder controls / overlay UI
        (or otherwise looks unrelated to the business step), we treat it as NOT relevant and skip embedding it.
        """
        if not screenshot_url:
            return True

        image_bytes = await self._fetch_screenshot_bytes(screenshot_url)
        if not image_bytes:
            # Let the caller handle "[Screenshot unavailable]" path.
            return True

        encoded = base64.b64encode(image_bytes).decode("utf-8")
        prompt = f"""You are validating whether an image should be embedded as the FIRST screenshot in an SOP.

STEP (what the screenshot should illustrate): "{step_label}"
SYSTEM (if known): "{system or 'unknown'}"

Return ONLY one token:
- RELEVANT
- NOT_RELEVANT

Mark NOT_RELEVANT if the screenshot shows:
- Screen recorder UI or controls
- Recording overlays, start/stop buttons, recording indicators
- A generic desktop/blank screen unrelated to the step
- Anything that is not the actual business application screen for the step
"""

        try:
            client = self._get_llm_client()
            response = await client.chat.completions.create(
                model=self.vision_model,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{encoded}"}},
                    ],
                }],
                temperature=0.0,
                max_tokens=10,
            )
            text = (response.choices[0].message.content or "").strip().upper()
            if "NOT_RELEVANT" in text:
                return False
            if "RELEVANT" in text:
                return True
            # If the model returned something unexpected, default to keeping the screenshot.
            return True
        except Exception as exc:
            logger.warning(f"First-step screenshot relevancy check failed: {exc}")
            return True
    
    async def generate_sop(
        self,
        process: Dict[str, Any],
        flow: Optional[Dict[str, Any]],
        assignments: List[Dict[str, Any]],
        hierarchy: Dict[str, str],
        ai_suggestions: Optional[List[Dict[str, Any]]] = None,
        flow_screenshot: Optional[str] = None,
        storage_service=None,
    ) -> io.BytesIO:
        """Generate a complete SOP Word document"""
        doc = Document()
        self.enhancer = WordDocumentEnhancer(doc)
        self.node_step_map = {}
        self.step_labels = {}
        self.flow_screenshot = flow_screenshot  # Store for appendix
        self._storage_service = storage_service
        
        # Index AI suggestions
        suggestions_by_section = defaultdict(list)
        suggestions_by_node = defaultdict(list)
        if ai_suggestions:
            logger.info(f"SOP Generation: Processing {len(ai_suggestions)} AI suggestions")
            for suggestion in ai_suggestions:
                section = suggestion.get('section', 'unknown')
                node_id = suggestion.get('node_id')
                suggestions_by_section[section].append(suggestion)
                if node_id:
                    suggestions_by_node[node_id].append(suggestion)
        
        # Setup document styles
        self._setup_styles(doc)
        
        # Parse flow data
        nodes = []
        edges = []
        if flow and flow.get('flow_data'):
            flow_data = flow['flow_data']
            if isinstance(flow_data, str):
                try:
                    flow_data = json.loads(flow_data)
                except json.JSONDecodeError:
                    flow_data = {}
            nodes = flow_data.get('nodes', [])
            edges = flow_data.get('edges', [])
            self.recording_metadata = flow_data.get("recording_metadata") or {}
        
        # Normalize screenshot fields so both recording + dropdown exports behave consistently.
        # Frontend commonly stores screenshots as data.screenshotUrl, while recording path writes data.screenshot_url.
        for node in nodes:
            data = node.get("data")
            if not isinstance(data, dict):
                continue
            if not data.get("screenshot_url") and data.get("screenshotUrl"):
                data["screenshot_url"] = data.get("screenshotUrl")
        
        logger.info(f"SOP Generation: Parsed {len(nodes)} nodes and {len(edges)} edges")
        
        # Build graph structure
        node_map = {n.get('id'): n for n in nodes}
        outgoing_edges = defaultdict(list)
        incoming_edges = defaultdict(list)
        
        for edge in edges:
            source = edge.get('source')
            target = edge.get('target')
            outgoing_edges[source].append(edge)
            incoming_edges[target].append(edge)
        
        # Build ordered step sequence following flow topology
        ordered_steps = self._build_step_sequence(nodes, edges, node_map, outgoing_edges, incoming_edges)
        logger.info(f"SOP Generation: Built sequence with {len(ordered_steps)} steps")
        
        # Generate sections
        self._add_title_page(doc, process, flow, assignments, hierarchy)
        await self._add_purpose(doc, process, hierarchy, ordered_steps, suggestions_by_section, suggestions_by_node)
        self._add_scope(doc, process, hierarchy, suggestions_by_section)
        self._add_roles_responsibilities(doc, ordered_steps, assignments, suggestions_by_section)
        self._add_systems_used(doc, ordered_steps, suggestions_by_section)
        await self._add_detailed_procedure(doc, ordered_steps, node_map, outgoing_edges, suggestions_by_section, suggestions_by_node)
        self._add_records_documentation(doc, nodes, suggestions_by_section)
        self._add_appendix(doc, suggestions_by_section)
        
        # Save and finalize (CPU/IO-bound operations run in threadpool to avoid blocking event loop)
        from fastapi.concurrency import run_in_threadpool
        
        def _save_and_finalize_document(doc, enhancer):
            """Synchronous helper to save document and finalize comments"""
            buffer = io.BytesIO()
            doc.save(buffer)
            buffer = enhancer.finalize_comments(buffer)
            buffer.seek(0)
            return buffer
        
        buffer = await run_in_threadpool(_save_and_finalize_document, doc, self.enhancer)
        return buffer
    
    def _build_step_sequence(
        self,
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
        node_map: Dict[str, Dict[str, Any]],
        outgoing_edges: Dict[str, List[Dict[str, Any]]],
        incoming_edges: Dict[str, List[Dict[str, Any]]]
    ) -> List[Dict[str, Any]]:
        """
        Build an ordered sequence of steps following the flow topology.
        Each process and decision node becomes a numbered step.
        """
        # Find start node
        start_node_id = None
        for node in nodes:
            node_type = node.get('data', {}).get('type', node.get('type', ''))
            if node_type == 'start':
                start_node_id = node.get('id')
                break
        
        if not start_node_id:
            # Fallback: find node with no incoming edges
            for node in nodes:
                if not incoming_edges.get(node.get('id')):
                    start_node_id = node.get('id')
                    break
        
        if not start_node_id and nodes:
            start_node_id = nodes[0].get('id')
        
        if not start_node_id:
            return []
        
        # Traverse graph in order and collect steps
        visited = set()
        ordered_steps = []
        step_counter = [0]  # Use list to allow modification in nested function
        
        def traverse(node_id):
            if not node_id or node_id in visited:
                return
            
            node = node_map.get(node_id)
            if not node:
                return
            
            visited.add(node_id)
            node_data = node.get('data', {})
            node_type = node_data.get('type', node.get('type', ''))
            
            # Skip start, end, merge nodes from numbering
            if node_type == 'start':
                # Continue to next
                for edge in outgoing_edges.get(node_id, []):
                    traverse(edge.get('target'))
                return
            
            if node_type == 'end':
                # Record end state but don't number it
                ordered_steps.append({
                    'type': 'end',
                    'node_id': node_id,
                    'node': node,
                    'step_num': None
                })
                return
            
            if node_type == 'merge':
                # Continue without numbering
                for edge in outgoing_edges.get(node_id, []):
                    traverse(edge.get('target'))
                return
            
            # Process and Decision nodes get step numbers
            if node_type in ['process', 'decision']:
                step_counter[0] += 1
                step_num = step_counter[0]
                
                self.node_step_map[node_id] = step_num
                self.step_labels[step_num] = node_data.get('label', f'Step {step_num}')
                
                # Get outgoing edges and their targets
                edges_out = outgoing_edges.get(node_id, [])
                branches = []
                for edge in edges_out:
                    target_id = edge.get('target')
                    branches.append({
                        'label': edge.get('label', ''),
                        'target_id': target_id
                    })
                
                ordered_steps.append({
                    'type': node_type,
                    'node_id': node_id,
                    'node': node,
                    'step_num': step_num,
                    'branches': branches
                })
                
                # Continue traversal for all branches
                for edge in edges_out:
                    traverse(edge.get('target'))
        
        traverse(start_node_id)
        return ordered_steps
    
    def _get_target_step_reference(self, target_id: str, node_map: Dict[str, Any]) -> str:
        """Get a human-readable reference to a target step."""
        if not target_id:
            return "continue"
        
        # Check if we have a step number for this node
        if target_id in self.node_step_map:
            step_num = self.node_step_map[target_id]
            label = self.step_labels.get(step_num, '')
            return f"Step {step_num}"
        
        # Check node type
        node = node_map.get(target_id)
        if node:
            node_type = node.get('data', {}).get('type', node.get('type', ''))
            if node_type == 'end':
                return "End"
            elif node_type == 'merge':
                # Find what the merge leads to
                return "merge point"
        
        return "continue"
    
    def _setup_styles(self, doc: Document):
        styles = doc.styles
        for i in range(1, 3):
            style_name = f'Heading {i}'
            if style_name in styles:
                style = styles[style_name]
                style.font.bold = True
                if i == 1:
                    style.font.size = Pt(16)
                    style.font.color.rgb = RGBColor(0x0E, 0x3B, 0xAF)
                elif i == 2:
                    style.font.size = Pt(14)
                    style.font.color.rgb = RGBColor(0x0B, 0x2E, 0x88)
    
    def _add_tracked_insertion(self, paragraph, text: str, bold: bool = False):
        """Add text as a tracked change (for AI-generated content)"""
        if self.enhancer:
            return self.enhancer.add_tracked_insertion(paragraph, text, bold)
        return paragraph.add_run(text)
    
    def _add_comment(self, paragraph, comment_text: str):
        """Add a real Word comment (for questions/prompts)"""
        if self.enhancer:
            return self.enhancer.add_comment(paragraph, comment_text)
        return None
    
    async def _generate_context_aware_comment(
        self,
        step_num: int,
        label: str,
        description: str,
        owner: str,
        system: str,
        node_type: str
    ) -> str:
        """
        Use AI to generate a context-specific comment based on the actual description text.
        Analyzes what's written and asks for specific missing information.
        """
        prompt = f"""You are reviewing an SOP step description. Your job is to identify ONE specific piece of information that is MISSING or UNCLEAR based on what's already written.

STEP {step_num}: {label}
ROLE: {owner}
SYSTEM: {system}
TYPE: {node_type}

DESCRIPTION TEXT:
"{description}"

Based on the description above, identify what SPECIFIC information a new employee would still need to know. Generate ONE comment that:

1. REFERENCES something specific from the description text
2. ASKS for concrete additional detail that would help someone actually do this step
3. Is NOT generic - it must be tied to what's written

GOOD EXAMPLES:
- If description mentions "reviews the request" → "The description mentions reviewing the request - what specific aspects should be checked? (e.g., budget codes, manager approval level, policy compliance)"
- If description mentions "forwards to IT" → "You mention forwarding to IT - is this automatic via the system or does the user need to manually send an email/notification?"
- If description mentions "validates compliance" → "The compliance validation is mentioned - what specific policies or checklists should be referenced? (e.g., RBAC policy, SoD matrix)"

BAD EXAMPLES (too generic - AVOID):
- "What criteria are used?"
- "Please add more detail"
- "Consider documenting the process"

Return ONLY the comment text, nothing else. Keep it under 50 words."""

        try:
            client = self._get_llm_client()
            response = await client.chat.completions.create(
                model=self.chat_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=100
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Error generating context-aware comment: {e}")
        return None
    
    async def _add_contextual_comments(
        self,
        doc,
        para,
        step_num: int,
        label: str,
        owner: str,
        system: str,
        node_type: str,
        branches: List[Dict],
        ai_comment_text: str,
        comment_counts: Dict[str, int] = None,
        description: str = None,
        has_screenshot: bool = False,
    ):
        """
        Add context-specific comments based on the actual description text.
        
        PRIMARY: AI-generated comment that references the specific description
        SECONDARY: TBDs, Screenshots (limited)
        """
        if comment_counts is None:
            comment_counts = {}
        
        # ═══════════════════════════════════════════════════════════════════
        # PRIMARY: AI-GENERATED CONTEXT-SPECIFIC COMMENT
        # Based on what's actually written in the description
        # ═══════════════════════════════════════════════════════════════════
        
        # Generate context-aware comment for every 2nd step (to avoid too many)
        if description and step_num % 2 == 1 and comment_counts.get('context_comment', 0) < 5:
            context_comment = await self._generate_context_aware_comment(
                step_num=step_num,
                label=label,
                description=description,
                owner=owner,
                system=system,
                node_type=node_type
            )
            if context_comment:
                self._add_comment(para, context_comment)
                comment_counts['context_comment'] = comment_counts.get('context_comment', 0) + 1
        
        # ═══════════════════════════════════════════════════════════════════
        # DECISION NODES - Always ask for criteria if unclear
        # ═══════════════════════════════════════════════════════════════════
        
        if node_type == 'decision':
            unclear_branches = [b for b in branches if not b.get('label') or b.get('label', '').strip() in ['', 'Yes', 'No']]
            if unclear_branches and comment_counts.get('decision', 0) < 2:
                branch_labels = [b.get('label', 'unlabeled') for b in branches]
                self._add_comment(para, f"This decision has branches '{', '.join(branch_labels)}' - what specific condition or threshold determines each path?")
                comment_counts['decision'] = comment_counts.get('decision', 0) + 1
        
        # ═══════════════════════════════════════════════════════════════════
        # SECONDARY: TBDs, Screenshots (limited, not repetitive)
        # ═══════════════════════════════════════════════════════════════════
        
        # SCREENSHOT - Only for key steps, max 2 per SOP
        label_lower = label.lower()
        is_visual_step = any(kw in label_lower for kw in ['submit', 'form', 'screen', 'portal'])
        # If a screenshot is already embedded for this step, don't ask for one again.
        if (
            (not has_screenshot)
            and is_visual_step
            and comment_counts.get('screenshot', 0) < 2
            and "screenshot" not in (ai_comment_text or "")
        ):
            system_hint = system if (system and not self._is_placeholder_value(system)) else "system"
            self._add_comment(para, f"📷 A screenshot of the {system_hint} screen would help users visualize this step.")
            comment_counts['screenshot'] = comment_counts.get('screenshot', 0) + 1
        
        # SLA - Only once per SOP
        if any(kw in label_lower for kw in ['review', 'approv']) and comment_counts.get('sla', 0) < 1:
            self._add_comment(para, f"What is the expected turnaround time for this step?")
            comment_counts['sla'] = comment_counts.get('sla', 0) + 1
    
    def _add_title_page(self, doc, process, flow, assignments, hierarchy):
        title = doc.add_heading(process.get('name', 'Untitled Process'), level=0)
        title.alignment = WD_ALIGN_PARAGRAPH.CENTER
        
        subtitle = doc.add_paragraph("Standard Operating Procedure")
        subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
        subtitle_run = subtitle.runs[0]
        subtitle_run.font.size = Pt(18)
        subtitle_run.font.color.rgb = RGBColor(0x3B, 0x4A, 0x6B)
        
        doc.add_paragraph()
        
        table = doc.add_table(rows=5, cols=2)
        table.style = 'Table Grid'
        
        owner_text = self._get_owner_display(assignments)
        
        metadata = [
            ("SOP ID", str(process.get('id', 'N/A'))),
            ("Process Level", f"L{process.get('level', 3)}"),
            ("Process Hierarchy", f"{hierarchy.get('l0_name', '')} → {hierarchy.get('l1_name', '')} → {hierarchy.get('l2_name', '')} → {hierarchy.get('l3_name', '')}"),
            ("Owner", owner_text),
            ("Last Updated", self._format_date(process.get('updated_at'))),
        ]
        
        for i, (label, value) in enumerate(metadata):
            row = table.rows[i]
            row.cells[0].text = label
            row.cells[1].text = value or "N/A"
            for paragraph in row.cells[0].paragraphs:
                for run in paragraph.runs:
                    run.font.bold = True
        
        doc.add_page_break()
    
    def _get_owner_display(self, assignments):
        owners = []
        for a in assignments:
            if a.get('role', '').lower() == 'owner':
                full_name = a.get('full_name', '')
                email = a.get('user_email', '')
                if full_name and email:
                    owners.append(f"{full_name} ({email})")
                elif email:
                    owners.append(email)
                elif full_name:
                    owners.append(full_name)
        return ", ".join(owners) if owners else "N/A"
    
    async def _add_purpose(self, doc, process, hierarchy, ordered_steps, suggestions_by_section, suggestions_by_node):
        """Generate Purpose section - specific to the actual process content"""
        doc.add_heading("1. Purpose", level=1)
        
        # Build a summary of the actual steps for context
        steps_summary_lines = []
        for step in ordered_steps:
            if step.get('type') in ['process', 'decision'] and step.get('step_num'):
                node_data = step.get('node', {}).get('data', {})
                label = node_data.get('label', '')
                owner = node_data.get('owner', 'TBD')
                step_type = step.get('type', 'process')
                steps_summary_lines.append(f"- Step {step['step_num']}: {label} (by {owner}, type: {step_type})")
        
        steps_summary = "\n".join(steps_summary_lines) if steps_summary_lines else "No steps defined"
        
        # Generate purpose based on actual process content
        purpose_text = await self._auto_generate_purpose(
            process_name=process.get('name', ''),
            existing_description=process.get('description', ''),
            hierarchy=hierarchy,
            steps_summary=steps_summary
        )
        
        para = doc.add_paragraph()
        self._add_tracked_insertion(para, purpose_text)
        logger.info(f"  Added AI-generated purpose as tracked insertion")
    
    def _add_scope(self, doc, process, hierarchy, suggestions_by_section):
        """Generate Scope section"""
        doc.add_heading("2. Scope", level=1)
        
        para = doc.add_paragraph(f"This SOP applies to the L3 process: {process.get('name', 'N/A')}")
        
        if hierarchy.get('l2_name'):
            doc.add_paragraph(f"Parent process (L2): {hierarchy.get('l2_name')}")
        if hierarchy.get('l1_name'):
            doc.add_paragraph(f"Parent process (L1): {hierarchy.get('l1_name')}")
        if hierarchy.get('l0_name'):
            doc.add_paragraph(f"Parent process (L0): {hierarchy.get('l0_name')}")
        
        # Check for AI suggestions
        scope_suggestions = suggestions_by_section.get('scope', [])
        for s in scope_suggestions:
            if s.get('suggestion_type') == 'tracked_change' and s.get('suggested_text'):
                doc.add_paragraph()
                ai_para = doc.add_paragraph()
                self._add_tracked_insertion(ai_para, s.get('suggested_text'))
            elif s.get('suggestion_type') == 'comment':
                self._add_comment(para, s.get('comment_text') or s.get('suggested_text'))
    
    def _add_roles_responsibilities(self, doc, ordered_steps, assignments, suggestions_by_section):
        """Generate Roles & Responsibilities section"""
        doc.add_heading("3. Roles & Responsibilities", level=1)
        
        # Build role -> steps mapping
        role_steps = defaultdict(list)
        
        for step in ordered_steps:
            if step['type'] in ['process', 'decision'] and step['step_num']:
                node_data = step['node'].get('data', {})
                owner = node_data.get('owner', 'TBD')
                role_steps[owner].append(str(step['step_num']))
        
        if role_steps:
            table = doc.add_table(rows=len(role_steps) + 1, cols=2)
            table.style = 'Table Grid'
            
            header_cells = table.rows[0].cells
            header_cells[0].text = "Role"
            header_cells[1].text = "Steps Performed"
            for cell in header_cells:
                for para in cell.paragraphs:
                    for run in para.runs:
                        run.font.bold = True
            
            for i, (role, steps) in enumerate(role_steps.items(), 1):
                row = table.rows[i]
                row.cells[0].text = role
                row.cells[1].text = ", ".join(steps)
                
                if self._is_placeholder_value(role):
                    para = row.cells[0].paragraphs[0]
                    self._add_comment(para, f"Role is TBD for steps {', '.join(steps)}. Please specify the responsible person or team.")
        else:
            doc.add_paragraph("No roles defined in the process flow.")
        
    def _add_systems_used(self, doc, ordered_steps, suggestions_by_section):
        """Generate Systems Used section"""
        doc.add_heading("4. Systems Used", level=1)
        
        system_steps = defaultdict(list)
        
        for step in ordered_steps:
            if step['type'] in ['process', 'decision'] and step['step_num']:
                node_data = step['node'].get('data', {})
                system = node_data.get('system', 'TBD')
                if system:
                    system_steps[system].append(str(step['step_num']))
        
        if system_steps:
            table = doc.add_table(rows=len(system_steps) + 1, cols=2)
            table.style = 'Table Grid'
            
            header_cells = table.rows[0].cells
            header_cells[0].text = "System"
            header_cells[1].text = "Used In Steps"
            for cell in header_cells:
                for para in cell.paragraphs:
                    for run in para.runs:
                        run.font.bold = True
            
            for i, (system, steps) in enumerate(system_steps.items(), 1):
                row = table.rows[i]
                row.cells[0].text = system
                row.cells[1].text = ", ".join(steps)
                
                if self._is_placeholder_value(system):
                    para = row.cells[0].paragraphs[0]
                    self._add_comment(para, f"System is TBD for steps {', '.join(steps)}. Please specify the application or tool used.")
        else:
            doc.add_paragraph("No systems specified in the process flow.")
        
    async def _add_detailed_procedure(
        self,
        doc: Document,
        ordered_steps: List[Dict[str, Any]],
        node_map: Dict[str, Any],
        outgoing_edges: Dict[str, List[Dict[str, Any]]],
        suggestions_by_section: Dict[str, List[Dict[str, Any]]],
        suggestions_by_node: Dict[str, List[Dict[str, Any]]]
    ):
        """
        Generate Detailed Procedure section.
        Each process and decision node is a numbered step.
        ALL descriptions are AI-generated as tracked changes.
        """
        doc.add_heading("5. Detailed Procedure", level=1)
        
        doc.add_paragraph("The following steps describe the end-to-end workflow.")
        doc.add_paragraph()
        
        # Track comment counts to avoid repetition across steps
        comment_counts = {}
        
        for step in ordered_steps:
            if step['type'] == 'end':
                continue  # End states handled in Records section
            
            step_num = step['step_num']
            node = step['node']
            node_id = step['node_id']
            node_data = node.get('data', {})
            node_type = step['type']
            branches = step.get('branches', [])
                
            label = node_data.get('label', f'Step {step_num}')
            owner = node_data.get('owner', 'TBD')
            system = node_data.get('system', 'TBD')
            manual_auto = node_data.get('manualOrAutomated', 'manual')
            screenshot_url = node_data.get("screenshot_url")

            # Screenshots should illustrate concrete UI/actions. For non-action nodes,
            # explicitly suppress embedding (decisions/merges).
            if node_type in ("decision", "merge") or (node_data.get("type") in ("decision", "merge")):
                screenshot_url = None

            # One-off safeguard: ensure the first SOP screenshot is not recorder UI.
            # We do this even if the step description comes from AI suggestions.
            if screenshot_url and step_num == 1:
                is_relevant = await self._is_relevant_sop_screenshot_first_step(
                    screenshot_url=screenshot_url,
                    step_label=label,
                    system=system,
                )
                if not is_relevant:
                    logger.info(
                        f"Skipping non-relevant first-step screenshot for SOP. step='{label[:40]}...' url='{str(screenshot_url)[:80]}...'"
                    )
                    screenshot_url = None
            
            logger.info(f"  Rendering Step {step_num}: {label[:50]}...")
            
            # Step heading - uses label
            doc.add_heading(f"Step {step_num} — {label}", level=2)
                
                # Role
            para_role = doc.add_paragraph()
            para_role.add_run("Role: ").bold = True
            para_role.add_run(owner)
            if self._is_placeholder_value(owner):
                self._add_comment(
                    para_role,
                    f"Role is TBD for Step {step_num}. Please specify the responsible person or team."
                )
            
            # System
            para_system = doc.add_paragraph()
            para_system.add_run("System: ").bold = True
            para_system.add_run(system)
            if self._is_placeholder_value(system):
                self._add_comment(para_system, f"System is TBD for Step {step_num}. Please specify the application or tool used.")
            
            # Manual or Automated
            para_manual = doc.add_paragraph()
            para_manual.add_run("Manual / Automated: ").bold = True
            para_manual.add_run(manual_auto.capitalize() if manual_auto else 'Manual')
                
            # Description - ALWAYS AI-generated as tracked change
            doc.add_paragraph()
            desc_header = doc.add_paragraph()
            desc_header.add_run("Description:").bold = True
            
            # Check for AI suggestions for this step
            step_key = f"step_{step_num}"
            node_suggestions = suggestions_by_node.get(node_id, [])
            section_suggestions = suggestions_by_section.get(step_key, [])
            all_suggestions = node_suggestions + section_suggestions
            
            # Priority 1: Use explicit AI suggestion if available
            ai_expanded_content = None
            ai_comments = []
            seen_comment_keys = set()  # Track unique comments to avoid duplicates
            
            for s in all_suggestions:
                if s.get('suggestion_type') == 'tracked_change' and s.get('suggested_text'):
                    if not ai_expanded_content:  # Only use first one to avoid duplicates
                        ai_expanded_content = s.get('suggested_text')
                elif s.get('suggestion_type') in ['comment', 'screenshot_placeholder']:
                    # If a screenshot already exists for this step, suppress "add screenshot" style placeholders.
                    if s.get('suggestion_type') == 'screenshot_placeholder' and node_data.get("screenshot_url"):
                        continue
                    comment_text = s.get('comment_text') or s.get('suggested_text')
                    if comment_text:
                        # Deduplicate using normalized key
                        comment_key = comment_text[:50].lower().strip()
                        if comment_key not in seen_comment_keys:
                            seen_comment_keys.add(comment_key)
                            ai_comments.append(comment_text)
            
            # Priority 2: If no AI suggestion, auto-generate description with flow context
            if not ai_expanded_content:
                logger.info(f"    Auto-generating description for Step {step_num}...")
                
                # Get previous and next step context from ordered_steps
                current_idx = next((i for i, s in enumerate(ordered_steps) if s.get('node_id') == node_id), -1)
                
                prev_step_label = None
                prev_step_owner = None
                next_step_label = None
                next_step_owner = None
                branch_info = None
                
                # Find previous step (skip end nodes)
                if current_idx > 0:
                    for i in range(current_idx - 1, -1, -1):
                        prev_step = ordered_steps[i]
                        if prev_step.get('type') not in ['end']:
                            prev_data = prev_step.get('node', {}).get('data', {})
                            prev_step_label = prev_data.get('label', '')
                            prev_step_owner = prev_data.get('owner', 'TBD')
                        break
                
                # Find next step from branches
                if branches:
                    if len(branches) == 1:
                        next_id = branches[0].get('target_id')
                        next_node = node_map.get(next_id, {})
                        next_data = next_node.get('data', {})
                        next_step_label = next_data.get('label', '')
                        next_step_owner = next_data.get('owner', 'TBD')
                else:
                        # Decision with multiple branches
                        branch_labels = [b.get('label', 'Unknown') for b in branches]
                        branch_info = f"Decision point with branches: {', '.join(branch_labels)}"
                transcript_context = self._get_transcript_context_for_screenshot(screenshot_url)
                
                ai_expanded_content = await self._auto_expand_step_description(
                    label=label,
                    owner=owner,
                    system=system,
                    node_type=node_type,
                    step_num=step_num,
                    prev_step_label=prev_step_label,
                    prev_step_owner=prev_step_owner,
                    next_step_label=next_step_label,
                    next_step_owner=next_step_owner,
                    branch_info=branch_info,
                    screenshot_url=screenshot_url,
                    transcript_context=transcript_context
                )
            
            # Render the AI description as a tracked change (ONCE only)
            desc_para = doc.add_paragraph()
            self._add_tracked_insertion(desc_para, ai_expanded_content)
            
            # Add AI comments (already deduplicated above)
            for comment in ai_comments:
                self._add_comment(desc_para, comment)
            
            # Add contextual comments based on the actual description content
            ai_comment_text_lower = ' '.join(ai_comments).lower() if ai_comments else ''
            
            # Pass the generated description so comments can reference specific content
            await self._add_contextual_comments(
                doc=doc,
                para=desc_para,
                step_num=step_num,
                label=label,
                owner=owner,
                system=system,
                node_type=node_type,
                branches=branches,
                ai_comment_text=ai_comment_text_lower,
                comment_counts=comment_counts,
                description=ai_expanded_content,  # Pass the actual description for context-aware comments
                has_screenshot=bool(screenshot_url),
            )

            if screenshot_url:
                image_bytes = await self._fetch_screenshot_bytes(screenshot_url)
                if image_bytes:
                    screenshot_para = doc.add_paragraph()
                    run = screenshot_para.add_run()
                    run.add_picture(io.BytesIO(image_bytes), width=Inches(5.5))
                else:
                    placeholder_para = doc.add_paragraph("[Screenshot unavailable]")
                    self._add_comment(placeholder_para, "Screenshot could not be retrieved. Please attach manually.")
            
            # Handle decision branches
            if node_type == 'decision' and branches:
                doc.add_paragraph()
                decision_para = doc.add_paragraph()
                decision_para.add_run(f"Decision {step_num}A: ").bold = True
                decision_para.add_run(label.replace('?', '') + "?")
                
                for i, branch in enumerate(branches):
                    branch_label = branch.get('label', f'Option {i+1}')
                    target_id = branch.get('target_id')
                    target_ref = self._get_target_step_reference(target_id, node_map)
                    
                    letter = chr(65 + i)  # A, B, C...
                    branch_text = f"{step_num}{letter}-{branch_label.upper() if branch_label else f'OPTION {i+1}'} → {target_ref}"
                    
                    bullet = doc.add_paragraph(branch_text, style='List Bullet')
                    
                    # Add comment for unlabeled branches
                    if not branch_label or branch_label in ['', 'N/A', f'Option {i+1}']:
                        self._add_comment(bullet, f"Branch {step_num}{letter} needs a clear label. Please specify the condition (e.g., 'If Approved', 'If Amount > $1000').")
            
            # Next step reference (for non-decision steps)
            elif branches and len(branches) == 1:
                target_ref = self._get_target_step_reference(branches[0].get('target_id'), node_map)
                doc.add_paragraph()
                next_para = doc.add_paragraph(f"→ Next: {target_ref}")
                next_para.runs[0].font.italic = True
            
            doc.add_paragraph()  # Spacer
        
        logger.info(f"SOP Generation: Rendered {len([s for s in ordered_steps if s['step_num']])} steps")
    
    def _add_records_documentation(self, doc, nodes, suggestions_by_section):
        """Generate Records & Documentation Requirements section"""
        doc.add_heading("6. Records & Documentation Requirements", level=1)
        
        end_nodes = [n for n in nodes if n.get('data', {}).get('type', n.get('type', '')) == 'end']
        
        if end_nodes:
            doc.add_paragraph("Process End States:")
            for node in end_nodes:
                label = node.get('data', {}).get('label', 'Process Complete')
            doc.add_paragraph(f"• {label}")
        else:
            para = doc.add_paragraph("No specific end states defined.")
            self._add_comment(para, "Please define the possible end states for this process and what happens in each state.")
    
    def _add_appendix(self, doc, suggestions_by_section):
        """Generate Appendix section with process flow diagram"""
        doc.add_heading("7. Appendix", level=1)
        
        # Add process flow diagram if screenshot was provided
        if hasattr(self, 'flow_screenshot') and self.flow_screenshot:
            self._add_flow_diagram_page(doc)
        else:
            para = doc.add_paragraph("Additional materials and references:")
            doc.add_paragraph()
            placeholder_para = doc.add_paragraph("[Appendix materials will be added here]")
            self._add_comment(placeholder_para, "Please add supporting materials: process flow diagrams, system screenshots, templates, examples, and training guides.")
    
    def _add_flow_diagram_page(self, doc):
        """Add process flow diagram on a landscape page"""
        import base64
        from docx.shared import Emu
        
        try:
            # Add a section break for landscape orientation
            new_section = doc.add_section()
            new_section.orientation = WD_ORIENT.LANDSCAPE
            
            # Swap width and height for landscape
            new_section.page_width = Inches(11)  # Standard letter landscape
            new_section.page_height = Inches(8.5)
            new_section.left_margin = Inches(0.5)
            new_section.right_margin = Inches(0.5)
            new_section.top_margin = Inches(0.5)
            new_section.bottom_margin = Inches(0.5)
            
            # Add heading for the diagram
            doc.add_heading("Process Flow Diagram", level=2)
            
            # Decode base64 image
            screenshot_data = self.flow_screenshot
            if screenshot_data.startswith('data:image/png;base64,'):
                screenshot_data = screenshot_data.replace('data:image/png;base64,', '')
            
            image_bytes = base64.b64decode(screenshot_data)
            
            # Create a BytesIO stream for the image
            image_stream = io.BytesIO(image_bytes)
            
            # Add the image - calculate size to fit page while maintaining aspect ratio
            # Available width: 11 - 0.5 - 0.5 = 10 inches
            # Available height: 8.5 - 0.5 - 0.5 - 1 (heading) = 6.5 inches
            available_width = Inches(10)
            available_height = Inches(6.5)
            
            # Add the picture - Word will maintain aspect ratio
            try:
                from PIL import Image
                img = Image.open(image_stream)
                img_width, img_height = img.size
                image_stream.seek(0)
                
                # Calculate scale to fit within available space
                width_ratio = available_width / Emu(img_width * 914400 / 96)  # 96 DPI assumed
                height_ratio = available_height / Emu(img_height * 914400 / 96)
                scale = min(width_ratio, height_ratio, 1.0)  # Don't upscale
                
                final_width = Inches(img_width / 96 * scale)
                final_height = Inches(img_height / 96 * scale)
                
                para = doc.add_paragraph()
                para.alignment = WD_ALIGN_PARAGRAPH.CENTER
                run = para.add_run()
                run.add_picture(image_stream, width=final_width, height=final_height)
                
            except ImportError:
                # If PIL not available, just add with max width
                image_stream.seek(0)
                para = doc.add_paragraph()
                para.alignment = WD_ALIGN_PARAGRAPH.CENTER
                run = para.add_run()
                run.add_picture(image_stream, width=available_width)
            
            # Add caption
            caption = doc.add_paragraph("Figure: Complete process flow diagram for this SOP")
            caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
            caption.runs[0].font.italic = True
            caption.runs[0].font.size = Pt(10)
            
            logger.info("Successfully added process flow diagram to appendix")
            
        except Exception as e:
            logger.error(f"Error adding flow diagram to appendix: {e}")
            # Fallback - add placeholder
            para = doc.add_paragraph("Process flow diagram could not be included.")
            self._add_comment(para, f"The flow diagram failed to render. Please add it manually.")
    
    def _format_date(self, date_value) -> str:
        if not date_value:
            return "N/A"
        if isinstance(date_value, str):
            try:
                dt = datetime.fromisoformat(date_value.replace('Z', '+00:00'))
                return dt.strftime("%Y-%m-%d")
            except ValueError:
                return date_value
        if hasattr(date_value, 'strftime'):
            return date_value.strftime("%Y-%m-%d")
        return str(date_value)


def sanitize_filename(name: str) -> str:
    """Sanitize a string to be safe for use as a filename"""
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        name = name.replace(char, '_')
    name = name.strip(' .')
    if len(name) > 200:
        name = name[:200]
    return name or "Untitled"
