import io
import logging
import zipfile
import xml.etree.ElementTree as ET
from typing import Any, Dict, List

from pydantic import BaseModel
from docx import Document

logger = logging.getLogger(__name__)


class ValidationResult(BaseModel):
    is_valid: bool
    unresolved_comments: List[str]
    unapproved_changes: List[str]
    step_changes: List[Dict[str, Any]]


class SOPValidator:
    def validate_finalized_sop(self, doc_bytes: bytes) -> ValidationResult:
        document_xml = self._read_doc_xml(doc_bytes, "word/document.xml")
        comments_xml = self._read_doc_xml(doc_bytes, "word/comments.xml", required=False)
        comments_extended_xml = self._read_doc_xml(doc_bytes, "word/commentsExtended.xml", required=False)

        tracked_changes = self._find_tracked_changes(document_xml)
        unresolved_comments = self._find_unresolved_comments(doc_bytes, comments_xml, comments_extended_xml, document_xml)
        step_changes = self._extract_step_changes(doc_bytes)

        logger.info(f"SOP Validation: {len(tracked_changes)} tracked changes, {len(unresolved_comments)} unresolved comments, {len(step_changes)} steps")
        if tracked_changes:
            logger.info(f"  Tracked changes: {tracked_changes[:3]}...")
        if unresolved_comments:
            logger.info(f"  Unresolved comments: {unresolved_comments[:3]}...")

        return ValidationResult(
            is_valid=len(tracked_changes) == 0 and len(unresolved_comments) == 0,
            unresolved_comments=unresolved_comments,
            unapproved_changes=tracked_changes,
            step_changes=step_changes
        )

    def _read_doc_xml(self, doc_bytes: bytes, name: str, required: bool = True) -> str:
        with zipfile.ZipFile(io.BytesIO(doc_bytes)) as docx:
            try:
                return docx.read(name).decode("utf-8")
            except KeyError:
                if required:
                    raise
                return ""

    def _find_tracked_changes(self, document_xml: str) -> List[str]:
        if not document_xml:
            return []
        tracked = []
        try:
            root = ET.fromstring(document_xml)
            for elem in root.iter():
                tag = elem.tag.lower()
                if tag.endswith("}ins") or tag.endswith("}del"):
                    tracked.append("Tracked change detected")
                    if len(tracked) >= 5:
                        break
        except ET.ParseError:
            pass
        return tracked

    def _find_unresolved_comments(self, doc_bytes: bytes, comments_xml: str, comments_extended_xml: str, document_xml: str) -> List[str]:
        """Find comments that are NOT marked as resolved/done.
        
        Simplified logic: If commentsExtended.xml exists, count resolved vs total comments.
        If all comments are resolved, return empty list. Otherwise return all comments as unresolved.
        """
        if not comments_xml:
            return []
        
        # Count total comments in comments.xml (only count w:comment elements, not nested ones)
        total_comments = 0
        try:
            root = ET.fromstring(comments_xml)
            # Only count direct children of root that are comment elements
            for comment in root:
                if "comment" in comment.tag.lower():
                    comment_id = None
                    for attr_name, attr_val in comment.attrib.items():
                        if attr_name.lower().endswith("}id") or attr_name.lower() == "id":
                            comment_id = attr_val
                            break
                    logger.info(f"  Found comment with ID: {comment_id}")
                    total_comments += 1
        except ET.ParseError:
            pass
        
        logger.info(f"Total comments in comments.xml: {total_comments}")
        
        # Count resolved comments in commentsExtended.xml
        resolved_count = 0
        if comments_extended_xml:
            try:
                ext_root = ET.fromstring(comments_extended_xml)
                for elem in ext_root.iter():
                    # Look for w15:commentEx elements with w15:done="1"
                    if "commentex" in elem.tag.lower():
                        done = None
                        for attr_name, attr_val in elem.attrib.items():
                            if "done" in attr_name.lower():
                                done = attr_val
                                break
                        if done == "1":
                            resolved_count += 1
                logger.info(f"Resolved comments in commentsExtended.xml: {resolved_count}")
            except ET.ParseError as e:
                logger.warning(f"Failed to parse commentsExtended.xml: {e}")
        else:
            logger.info("No commentsExtended.xml found - all comments will be considered unresolved")
        
        # If all comments are resolved, return empty (valid)
        if resolved_count >= total_comments and total_comments > 0:
            logger.info(f"All {total_comments} comments are resolved - validation passed")
            return []
        
        # Otherwise, collect all comments as unresolved (only direct children, not nested)
        unresolved = []
        try:
            root = ET.fromstring(comments_xml)
            for comment in root:
                if "comment" in comment.tag.lower():
                    text = "".join(comment.itertext()).strip()
                    unresolved.append(text or "Unresolved comment")
                    if len(unresolved) >= 10:
                        break
        except ET.ParseError:
            pass
        
        logger.info(f"Validation result: {resolved_count}/{total_comments} resolved, {len(unresolved)} unresolved")
        return unresolved

    def _extract_step_changes(self, doc_bytes: bytes) -> List[Dict[str, Any]]:
        try:
            doc = Document(io.BytesIO(doc_bytes))
        except Exception:
            return []

        step_changes = []
        current_step = None
        for para in doc.paragraphs:
            text = para.text.strip()
            if not text:
                continue
            if text.startswith("Step ") and "—" in text:
                if current_step:
                    step_changes.append(current_step)
                header_part, label_part = text.split("—", 1)
                step_num_text = header_part.replace("Step", "").strip()
                try:
                    step_num = int(step_num_text)
                except ValueError:
                    step_num = None
                current_step = {
                    "step_num": step_num,
                    "label": label_part.strip()
                }
                continue
            if not current_step:
                continue
            if text.startswith("Role:"):
                current_step["owner"] = text.replace("Role:", "").strip()
            elif text.startswith("System:"):
                current_step["system"] = text.replace("System:", "").strip()
            elif text.startswith("Manual / Automated:"):
                current_step["manual_or_automated"] = text.replace("Manual / Automated:", "").strip()
            elif text.startswith("Manual/Automated:"):
                current_step["manual_or_automated"] = text.replace("Manual/Automated:", "").strip()

        if current_step:
            step_changes.append(current_step)

        return [step for step in step_changes if step.get("step_num")]
