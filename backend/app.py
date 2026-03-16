from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional, Set, Tuple
import json
import logging
import os
import uuid

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
import uvicorn

from db import Database
from schemas.process_flow import ProcessFlow, ProcessNode, ProcessEdge, NodeType, AutomationLevel, FlowPatch
from services.chat_service import ChatService
from services.whisper_service import WhisperService
from utils.auth import create_access_token, get_current_user_id, hash_password, verify_password, verify_token

load_dotenv()
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

logger = logging.getLogger(__name__)

from utils.storage import StorageService

db = Database()
whisper_service = WhisperService()
storage_service = StorageService()

# Lazy-initialised services (require OPENAI_API_KEY at runtime, not import time)
_chat_service = None
_llm_service = None
_intent_translator = None
_patch_engine = None
_reactflow_translator = None
_sop_ai_service = None


def get_chat_service():
    global _chat_service
    if _chat_service is None:
        _chat_service = ChatService()
    return _chat_service


def get_llm_service():
    global _llm_service
    if _llm_service is None:
        from services.llm_service import LLMService
        _llm_service = LLMService()
    return _llm_service


def get_intent_translator():
    global _intent_translator
    if _intent_translator is None:
        from services.intent_translator import IntentTranslator
        _intent_translator = IntentTranslator()
    return _intent_translator


def get_patch_engine():
    global _patch_engine
    if _patch_engine is None:
        from services.patch_engine import PatchEngine
        _patch_engine = PatchEngine()
    return _patch_engine


def get_reactflow_translator():
    global _reactflow_translator
    if _reactflow_translator is None:
        from translators.reactflow_translator import ReactFlowTranslator
        _reactflow_translator = ReactFlowTranslator()
    return _reactflow_translator


def get_sop_ai_service():
    global _sop_ai_service
    if _sop_ai_service is None:
        from services.sop_ai_service import SOPAIService
        _sop_ai_service = SOPAIService()
    return _sop_ai_service


def reactflow_to_processflow(reactflow_data: dict) -> ProcessFlow:
    """Convert React Flow format to ProcessFlow canonical schema."""
    nodes = []
    for rf_node in reactflow_data.get("nodes", []):
        node_data = rf_node.get("data", rf_node)

        node_type = NodeType.PROCESS
        rf_type = rf_node.get("type", node_data.get("type", "default"))
        if rf_type == "start":
            node_type = NodeType.START
        elif rf_type == "end":
            node_type = NodeType.END
        elif rf_type == "decision":
            node_type = NodeType.DECISION
        elif rf_type == "merge":
            node_type = NodeType.MERGE

        automation_value = node_data.get("manualOrAutomated") or rf_node.get("manualOrAutomated") or "manual"
        automation_level = (
            AutomationLevel.AUTOMATED if str(automation_value).lower().strip() == "automated"
            else AutomationLevel.MANUAL
        )

        nodes.append(ProcessNode(
            id=rf_node["id"],
            type=node_type,
            label=node_data.get("label", rf_node.get("label", "Unknown")),
            owner=node_data.get("owner", rf_node.get("owner")),
            system=node_data.get("system", rf_node.get("system")),
            automation=automation_level,
            logical_id=node_data.get("logical_id", rf_node.get("logical_id")),
            user_modified=node_data.get("user_modified", rf_node.get("user_modified", False)),
            screenshot_url=node_data.get("screenshot_url", rf_node.get("screenshot_url")),
        ))

    node_ids = {n.id for n in nodes}
    edges = []
    for rf_edge in reactflow_data.get("edges", []):
        source_id = rf_edge.get("source")
        target_id = rf_edge.get("target")
        if source_id not in node_ids or target_id not in node_ids:
            continue
        edges.append(ProcessEdge(
            id=rf_edge.get("id", f"edge-{source_id}-{target_id}"),
            source=source_id,
            target=target_id,
            condition=rf_edge.get("condition") or rf_edge.get("label"),
        ))

    return ProcessFlow(nodes=nodes, edges=edges)


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TaxonomyCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    code: Optional[str] = ""
    level: int = 0
    parent_id: Optional[str] = None
    sort_order: Optional[int] = None


class TaxonomyUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    code: Optional[str] = None
    sort_order: Optional[int] = None


class TaxonomyMoveRequest(BaseModel):
    parent_id: Optional[str] = None
    sort_order: Optional[int] = None


class TaxonomyReorderItem(BaseModel):
    id: str
    sort_order: int


class TaxonomyReorderRequest(BaseModel):
    items: List[TaxonomyReorderItem]


class FlowCreate(BaseModel):
    process_id: str
    title: str
    description: Optional[str] = ""
    flow_data: Dict[str, Any]


class FlowUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    flow_data: Dict[str, Any]


class IncrementalFlowRequest(BaseModel):
    transcript: str
    accumulatedTranscript: Optional[str] = None
    existingFlow: Optional[Dict[str, Any]] = None
    sessionId: Optional[Any] = None
    validationErrors: Optional[List[str]] = None
    userEdits: Optional[List[Dict[str, Any]]] = None
    extractedIntent: Optional[Dict[str, Any]] = None


async def _next_sibling_sort_order(
    conn,
    user_id: str,
    parent_id: Optional[str],
    exclude_id: Optional[str] = None,
) -> int:
    base_query = "SELECT MAX(sort_order) AS max_sort_order FROM process_taxonomy WHERE user_id = ?"
    params: List[Any] = [user_id]
    if parent_id is None:
        base_query += " AND parent_id IS NULL"
    else:
        base_query += " AND parent_id = ?"
        params.append(parent_id)
    if exclude_id:
        base_query += " AND id != ?"
        params.append(exclude_id)
    async with conn.execute(base_query, tuple(params)) as cursor:
        row = await cursor.fetchone()
    max_sort_order = row["max_sort_order"] if row else None
    return (max_sort_order or 0) + 1


async def _subtree_height(conn, user_id: str, root_id: str) -> int:
    async with conn.execute(
        "SELECT id, parent_id FROM process_taxonomy WHERE user_id = ?",
        (user_id,),
    ) as cursor:
        rows = await cursor.fetchall()
    children_by_parent: Dict[Optional[str], List[str]] = {}
    for row in rows:
        children_by_parent.setdefault(row["parent_id"], []).append(row["id"])

    def _dfs(node_id: str) -> int:
        children = children_by_parent.get(node_id, [])
        if not children:
            return 0
        return 1 + max(_dfs(child_id) for child_id in children)

    return _dfs(root_id)


async def _update_subtree_levels(conn, user_id: str, root_id: str, level: int) -> None:
    await conn.execute(
        "UPDATE process_taxonomy SET level = ? WHERE id = ? AND user_id = ?",
        (level, root_id, user_id),
    )
    async with conn.execute(
        "SELECT id FROM process_taxonomy WHERE user_id = ? AND parent_id = ?",
        (user_id, root_id),
    ) as cursor:
        child_rows = await cursor.fetchall()
    for child in child_rows:
        await _update_subtree_levels(conn, user_id, child["id"], level + 1)


async def init_schema():
    conn = db.get_connection()
    schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
    with open(schema_path, "r", encoding="utf-8") as f:
        await conn.executescript(f.read())

    # Backward-compatible additive migrations for existing DBs.
    sop_migrations = [
        ("process_taxonomy", "sort_order", "INTEGER DEFAULT 0"),
        ("process_taxonomy", "sop_status", "TEXT"),
        ("process_taxonomy", "sop_draft_url", "TEXT"),
        ("process_taxonomy", "sop_final_url", "TEXT"),
        ("process_taxonomy", "sop_final_pdf_url", "TEXT"),
        ("process_taxonomy", "sop_generated_at", "TEXT"),
        ("process_taxonomy", "sop_finalized_at", "TEXT"),
        ("process_flow_versions", "sop_url", "TEXT"),
        ("process_flow_versions", "version_type", "TEXT"),
    ]
    for table, col, col_type in sop_migrations:
        try:
            await conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}")
        except Exception:
            pass
    await conn.commit()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await db.initialize(os.getenv("DATABASE_PATH", "./data/process_mapper.db"))
    await init_schema()
    yield
    await db.close()


app = FastAPI(title="Process Mapper Core API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.get("/")
async def root():
    return {"message": "Process Mapper Core API"}


@app.get("/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


@app.post("/api/auth/register")
async def register(payload: RegisterRequest):
    conn = db.get_connection()
    user_id = str(uuid.uuid4())
    try:
        await conn.execute(
            "INSERT INTO users (id, email, username, password_hash) VALUES (?, ?, ?, ?)",
            (user_id, payload.email.lower(), payload.username, hash_password(payload.password)),
        )
        await conn.commit()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Registration failed: {exc}") from exc

    token = create_access_token(user_id, payload.email.lower(), payload.username)
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user_id, "email": payload.email.lower(), "username": payload.username},
    }


@app.post("/api/auth/login")
async def login(payload: LoginRequest):
    conn = db.get_connection()
    async with conn.execute(
        "SELECT id, email, username, password_hash FROM users WHERE email = ?",
        (payload.email.lower(),),
    ) as cursor:
        user = await cursor.fetchone()
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(user["id"], user["email"], user["username"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user["id"], "email": user["email"], "username": user["username"]},
    }


@app.get("/api/auth/me")
async def me(user: Dict[str, Any] = Depends(verify_token)):
    return user


@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...), user: Dict[str, Any] = Depends(verify_token)):
    content = await file.read()
    result = await whisper_service.transcribe_audio_from_bytes(content, file.filename or "audio.wav")
    return {"transcript": result.get("text", ""), "segments": result.get("segments", []), "words": result.get("words", [])}


@app.post("/generate-flow")
async def generate_flow(request: Dict[str, Any], user: Dict[str, Any] = Depends(verify_token)):
    transcript = request.get("transcript", "")
    return {
        "nodes": [{"id": "start", "position": {"x": 100, "y": 100}, "data": {"label": "Start"}, "type": "start"}],
        "edges": [],
        "metadata": {"source": "core", "transcript_length": len(transcript)},
    }


@app.post("/generate-incremental-flow")
async def generate_incremental_flow(request: IncrementalFlowRequest, user: Dict[str, Any] = Depends(verify_token)):
    try:
        if not request.transcript.strip():
            raise HTTPException(status_code=400, detail="Transcript cannot be empty")

        existing_flow_data = request.existingFlow or {"nodes": [], "edges": []}

        # Apply user deletions before processing
        if request.userEdits:
            deleted_node_ids = {
                e.get("id") for e in request.userEdits if e.get("type") == "node_deleted"
            }
            deleted_edge_ids = {
                e.get("id") for e in request.userEdits if e.get("type") == "edge_deleted"
            }
            if deleted_node_ids:
                existing_flow_data["nodes"] = [
                    n for n in existing_flow_data.get("nodes", []) if n.get("id") not in deleted_node_ids
                ]
            if deleted_edge_ids:
                existing_flow_data["edges"] = [
                    e for e in existing_flow_data.get("edges", []) if e.get("id") not in deleted_edge_ids
                ]

        # Filter stale edges
        existing_node_ids = {n.get("id") for n in existing_flow_data.get("nodes", [])}
        existing_flow_data["edges"] = [
            e for e in existing_flow_data.get("edges", [])
            if e.get("source") in existing_node_ids and e.get("target") in existing_node_ids
        ]

        current_flow = reactflow_to_processflow(existing_flow_data)

        from utils.context_builder import build_flow_context
        context = build_flow_context(
            existing_flow=existing_flow_data,
            validation_errors=request.validationErrors,
            user_edits=request.userEdits,
            accumulated_transcript=request.accumulatedTranscript,
        )

        llm_service = get_llm_service()
        intent_translator = get_intent_translator()
        patch_engine = get_patch_engine()
        translator = get_reactflow_translator()

        # Extract intent from transcript
        intent = await llm_service.extract_process_intent(request.transcript, context)
        if not intent:
            if len(current_flow.nodes) > 0:
                existing_positions = {
                    n.get("id"): n.get("position")
                    for n in existing_flow_data.get("nodes", []) if n.get("position")
                }
                algo = "relative" if existing_positions else "hierarchical"
                return translator.translate(current_flow, layout_algorithm=algo, existing_positions=existing_positions, auto_layout=False)
            raise HTTPException(status_code=400, detail="No business process information found in transcript.")

        # Translate intent to patch
        try:
            patch = intent_translator.translate_intent_to_flow_patch(intent, existing_flow=current_flow)
        except Exception as exc:
            if "no process steps" in str(exc).lower():
                patch = FlowPatch(operations=[], source="intent_translator_empty")
            else:
                raise HTTPException(status_code=500, detail=f"Failed to translate intent: {exc}")

        # If no operations, return existing flow as-is
        if not patch or not patch.operations:
            if len(current_flow.nodes) > 0:
                existing_positions = {
                    n.get("id"): n.get("position")
                    for n in existing_flow_data.get("nodes", []) if n.get("position")
                }
                algo = "relative" if existing_positions else "hierarchical"
                return translator.translate(current_flow, layout_algorithm=algo, existing_positions=existing_positions, auto_layout=False)
            raise HTTPException(status_code=400, detail="No business process information found in transcript.")

        # Apply patch
        updated_flow, validation_errors = await run_in_threadpool(patch_engine.apply_patch, current_flow, patch)

        # Collect existing positions for layout
        existing_positions = {}
        for n in existing_flow_data.get("nodes", []):
            nid = n.get("id")
            if nid and n.get("position"):
                existing_positions[nid] = n["position"]

        new_node_ids = {n.id for n in updated_flow.nodes if n.id not in existing_positions}

        react_flow_data = translator.translate(
            updated_flow, layout_algorithm="manual", existing_positions=existing_positions, auto_layout=False,
        )

        # Apply layout
        from services.layout_service import layout_service
        layout_nodes = react_flow_data.get("nodes", [])
        layout_edges = react_flow_data.get("edges", [])

        has_existing_layout = len(existing_positions) > 0 and any(
            p.get("x", 0) != 0 or p.get("y", 0) != 0 for p in existing_positions.values()
        )

        if has_existing_layout and new_node_ids and len(new_node_ids) < len(layout_nodes):
            positioned_nodes, routed_edges = layout_service.apply_incremental_layout(
                layout_nodes, layout_edges, new_node_ids, existing_positions,
            )
        else:
            positioned_nodes, routed_edges = await run_in_threadpool(
                layout_service.apply_full_layout, layout_nodes, layout_edges, False,
            )

        react_flow_data["nodes"] = positioned_nodes
        react_flow_data["edges"] = routed_edges

        if validation_errors:
            react_flow_data["validationErrors"] = validation_errors

        return react_flow_data

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"generate-incremental-flow error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/upload-doc")
async def upload_doc(
    files: List[UploadFile] = File(...),
    contexts: Optional[str] = Form(None),
    existing_flow: Optional[str] = Form(None),
    user: Dict[str, Any] = Depends(verify_token),
):
    try:
        if not files:
            raise HTTPException(status_code=400, detail="No files provided")

        file_contexts: Dict[str, str] = {}
        if contexts:
            try:
                file_contexts = json.loads(contexts)
            except json.JSONDecodeError:
                pass

        from utils.file_extraction import extract_text, extract_images

        all_text_parts: List[str] = []
        all_images: List[str] = []

        for f in files:
            file_context = file_contexts.get(f.filename or "", "")
            try:
                text = await extract_text(f)
                if text.strip():
                    header = f"--- From {f.filename} ---"
                    if file_context:
                        header += f"\nContext: {file_context}"
                    all_text_parts.append(f"{header}\n{text}")
            except Exception as exc:
                logger.warning(f"Text extraction failed for {f.filename}: {exc}")

            await f.seek(0)
            try:
                images = await extract_images(f)
                if images:
                    all_images.extend(images)
            except Exception as exc:
                logger.warning(f"Image extraction failed for {f.filename}: {exc}")

        combined_text = "\n\n".join(all_text_parts) if all_text_parts else ""
        if not combined_text.strip() and not all_images:
            raise HTTPException(status_code=400, detail="No content could be extracted from the uploaded files.")

        existing_flow_data = None
        if existing_flow:
            try:
                existing_flow_data = json.loads(existing_flow)
            except json.JSONDecodeError:
                pass

        from utils.context_builder import build_flow_context
        context = build_flow_context(existing_flow=existing_flow_data)

        llm_service = get_llm_service()
        intent_translator = get_intent_translator()
        patch_engine = get_patch_engine()
        translator = get_reactflow_translator()

        intent = await llm_service.extract_process_intent_from_documents(
            combined_text,
            context=context,
            images=all_images if all_images else None,
        )
        if not intent:
            raise HTTPException(status_code=400, detail="No business process found in the uploaded documents.")

        current_flow = reactflow_to_processflow(existing_flow_data) if existing_flow_data else ProcessFlow(nodes=[], edges=[])

        try:
            patch = intent_translator.translate_intent_to_flow_patch(intent, existing_flow=current_flow)
        except Exception as exc:
            if "no process steps" in str(exc).lower():
                raise HTTPException(status_code=400, detail="No process steps detected in the uploaded documents.")
            raise HTTPException(status_code=500, detail=f"Failed to translate intent: {exc}")

        if not patch or not patch.operations:
            raise HTTPException(status_code=400, detail="No business process found in the uploaded documents.")

        updated_flow, validation_errors = await run_in_threadpool(patch_engine.apply_patch, current_flow, patch)

        react_flow_data = translator.translate(updated_flow, layout_algorithm="manual", existing_positions=None, auto_layout=False)

        from services.layout_service import layout_service
        positioned_nodes, routed_edges = await run_in_threadpool(
            layout_service.apply_full_layout,
            react_flow_data.get("nodes", []),
            react_flow_data.get("edges", []),
            False,
        )
        react_flow_data["nodes"] = positioned_nodes
        react_flow_data["edges"] = routed_edges

        if validation_errors:
            react_flow_data["validationErrors"] = validation_errors

        return react_flow_data

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"upload-doc error: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/auto-layout")
async def auto_layout(payload: Dict[str, Any], user: Dict[str, Any] = Depends(verify_token)):
    existing_flow_data = payload.get("existingFlow", {})
    if not existing_flow_data or not existing_flow_data.get("nodes"):
        raise HTTPException(status_code=400, detail="Existing flow with nodes is required")

    user_edits = payload.get("userEdits")
    if user_edits:
        deleted_node_ids = {e.get("id") for e in user_edits if e.get("type") == "node_deleted"}
        deleted_edge_ids = {e.get("id") for e in user_edits if e.get("type") == "edge_deleted"}
        if deleted_node_ids:
            existing_flow_data["nodes"] = [
                n for n in existing_flow_data.get("nodes", []) if n.get("id") not in deleted_node_ids
            ]
        if deleted_edge_ids:
            existing_flow_data["edges"] = [
                e for e in existing_flow_data.get("edges", []) if e.get("id") not in deleted_edge_ids
            ]

    node_ids = {n.get("id") for n in existing_flow_data.get("nodes", [])}
    existing_flow_data["edges"] = [
        e for e in existing_flow_data.get("edges", [])
        if e.get("source") in node_ids and e.get("target") in node_ids
    ]

    current_flow = reactflow_to_processflow(existing_flow_data)
    translator = get_reactflow_translator()

    existing_positions = {}
    for n in existing_flow_data.get("nodes", []):
        nid = n.get("id")
        if nid and "position" in n:
            existing_positions[nid] = n["position"]

    react_flow_data = translator.translate(
        current_flow, layout_algorithm="manual", existing_positions=existing_positions, auto_layout=False,
    )

    from services.layout_service import layout_service
    positioned_nodes, routed_edges = await run_in_threadpool(
        layout_service.apply_full_layout,
        react_flow_data.get("nodes", []),
        react_flow_data.get("edges", []),
        False,
    )
    react_flow_data["nodes"] = positioned_nodes
    react_flow_data["edges"] = routed_edges
    return react_flow_data


@app.post("/api/chat")
async def chat(payload: Dict[str, Any], user: Dict[str, Any] = Depends(verify_token)):
    return {"response": f"Core assistant received: {payload.get('message', '')}"}


@app.post("/api/clarify-process")
async def clarify_process(payload: Dict[str, Any], user: Dict[str, Any] = Depends(verify_token)):
    return {"questions": [], "summary": payload.get("message", "")}


@app.post("/api/clarify-process/stream")
async def clarify_process_stream(payload: Dict[str, Any], user: Dict[str, Any] = Depends(verify_token)):
    messages_raw = payload.get("messages", [])
    existing_flow = payload.get("existingFlow")

    is_first_flow = (
        not existing_flow
        or not existing_flow.get("nodes")
        or len(existing_flow.get("nodes", [])) == 0
    )

    if is_first_flow:
        system_content = (
            "You are a process analyst. The user is describing their business process for the FIRST TIME. "
            "You will help them clarify and understand the complete process.\n\n"
            "After understanding the process, format your response as follows:\n"
            "**Process Flow**: I've identified your process with [X] process steps, [Y] decision points (if any), and [Z] merge points (if any). "
            "[Brief summary of the overall process flow, including key actors and systems]\n\n"
            "**Clarifying Questions**: [If anything is unclear, ask 1-3 short clarifying questions as bullet points]\n\n"
            "Keep your response concise and focused on understanding the complete process. Use markdown formatting for emphasis."
        )
    else:
        system_content = (
            "You are a process analyst. The user is describing NEW steps or CHANGES to existing steps in a process flow. "
            "Focus ONLY on the new steps or modifications they are requesting. "
            "Do NOT describe the entire process—only what they want to add or change.\n\n"
            "Format your response as follows:\n"
            "**Planned changes**: [Brief summary of the NEW or CHANGED step(s), including who does it and in which system]\n\n"
            "**Clarifying Questions**: [If anything is unclear, ask 1-3 short clarifying questions as bullet points]\n\n"
            "Keep your response concise and focused on the delta. Use markdown formatting for emphasis."
        )

    msgs: List[Dict[str, Any]] = [{"role": "system", "content": system_content}]
    for m in messages_raw:
        msgs.append({"role": m.get("role", "user"), "content": m.get("content", "")})

    svc = get_chat_service()

    async def token_generator():
        async for chunk in svc.stream_chat(messages=msgs):
            yield chunk.encode("utf-8")

    return StreamingResponse(token_generator(), media_type="text/plain; charset=utf-8")


@app.post("/api/clarify-process/intent")
async def clarify_process_intent(payload: Dict[str, Any], user: Dict[str, Any] = Depends(verify_token)):
    return {"intent": "update_flow", "payload": payload}


@app.post("/api/process-taxonomy")
async def create_taxonomy(item: TaxonomyCreate, user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    item_id = str(uuid.uuid4())
    sort_order = item.sort_order
    if sort_order is None:
        sort_order = await _next_sibling_sort_order(conn, user_id, item.parent_id)
    await conn.execute(
        "INSERT INTO process_taxonomy (id, user_id, name, description, code, level, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (item_id, user_id, item.name, item.description, item.code, item.level, item.parent_id, sort_order),
    )
    await conn.commit()
    payload = item.model_dump()
    payload["sort_order"] = sort_order
    return {"id": item_id, **payload}


@app.get("/api/process-taxonomy")
async def list_taxonomy(user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    async with conn.execute(
        """
        SELECT id, name, description, code, level, parent_id, sort_order
        FROM process_taxonomy
        WHERE user_id = ?
        ORDER BY CASE WHEN parent_id IS NULL THEN 0 ELSE 1 END, parent_id, sort_order, created_at
        """,
        (user_id,),
    ) as cursor:
        rows = await cursor.fetchall()
    by_parent: Dict[Optional[str], List[Dict[str, Any]]] = {}
    for row in rows:
        node = dict(row)
        by_parent.setdefault(node["parent_id"], []).append(node)

    def build_tree(parent_id: Optional[str]) -> List[Dict[str, Any]]:
        children = by_parent.get(parent_id, [])
        for child in children:
            child["children"] = build_tree(child["id"])
        return children

    return build_tree(None)


@app.put("/api/process-taxonomy/{process_id}")
async def update_taxonomy(process_id: str, item: TaxonomyUpdate, user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    await conn.execute(
        """
        UPDATE process_taxonomy
        SET name = COALESCE(?, name),
            description = COALESCE(?, description),
            code = COALESCE(?, code),
            sort_order = COALESCE(?, sort_order)
        WHERE id = ? AND user_id = ?
        """,
        (item.name, item.description, item.code, item.sort_order, process_id, user_id),
    )
    await conn.commit()
    return {"id": process_id, **item.model_dump()}


@app.delete("/api/process-taxonomy/{process_id}")
async def delete_taxonomy(process_id: str, user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    await conn.execute("DELETE FROM process_taxonomy WHERE id = ? AND user_id = ?", (process_id, user_id))
    await conn.commit()
    return {"ok": True}


@app.post("/api/process-taxonomy/{process_id}/move")
async def move_taxonomy(process_id: str, payload: TaxonomyMoveRequest, user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    async with conn.execute(
        "SELECT id, level, parent_id FROM process_taxonomy WHERE id = ? AND user_id = ?",
        (process_id, user_id),
    ) as cursor:
        source_row = await cursor.fetchone()
    if not source_row:
        raise HTTPException(status_code=404, detail="Process not found")

    new_parent_id = payload.parent_id
    new_level = 0
    if new_parent_id is not None:
        async with conn.execute(
            "SELECT id, level FROM process_taxonomy WHERE id = ? AND user_id = ?",
            (new_parent_id, user_id),
        ) as cursor:
            parent_row = await cursor.fetchone()
        if not parent_row:
            raise HTTPException(status_code=404, detail="New parent not found")
        new_level = parent_row["level"] + 1

    if new_level > 3:
        raise HTTPException(status_code=400, detail="Cannot move process beyond level L3")

    subtree_height = await _subtree_height(conn, user_id, process_id)
    if new_level + subtree_height > 3:
        raise HTTPException(status_code=400, detail="Move would push descendants beyond level L3")

    sort_order = payload.sort_order
    if sort_order is None:
        sort_order = await _next_sibling_sort_order(conn, user_id, new_parent_id, exclude_id=process_id)

    await conn.execute(
        "UPDATE process_taxonomy SET parent_id = ?, sort_order = ? WHERE id = ? AND user_id = ?",
        (new_parent_id, sort_order, process_id, user_id),
    )
    await _update_subtree_levels(conn, user_id, process_id, new_level)
    await conn.commit()
    return {"id": process_id, "parent_id": new_parent_id, "sort_order": sort_order, "level": new_level}


@app.post("/api/process-taxonomy/reorder")
async def reorder_taxonomy(payload: TaxonomyReorderRequest, user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    for item in payload.items:
        async with conn.execute(
            "SELECT 1 FROM process_taxonomy WHERE id = ? AND user_id = ?",
            (item.id, user_id),
        ) as cursor:
            exists = await cursor.fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail=f"Process not found: {item.id}")

        await conn.execute(
            "UPDATE process_taxonomy SET sort_order = ? WHERE id = ? AND user_id = ?",
            (item.sort_order, item.id, user_id),
        )
    await conn.commit()
    return {"ok": True, "updated": len(payload.items)}


@app.post("/api/process-taxonomy/{process_id}/duplicate")
async def duplicate_taxonomy(process_id: str, user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    async with conn.execute(
        "SELECT name, description, code, level, parent_id FROM process_taxonomy WHERE id = ? AND user_id = ?",
        (process_id, user_id),
    ) as cursor:
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Process not found")
    sort_order = await _next_sibling_sort_order(conn, user_id, row["parent_id"])
    new_id = str(uuid.uuid4())
    await conn.execute(
        "INSERT INTO process_taxonomy (id, user_id, name, description, code, level, parent_id, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (new_id, user_id, f"{row['name']} (Copy)", row["description"], row["code"], row["level"], row["parent_id"], sort_order),
    )
    await conn.commit()
    return {"id": new_id, "name": f"{row['name']} (Copy)", "sort_order": sort_order}


@app.post("/api/process-flows")
async def create_flow(item: FlowCreate, user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    flow_id = str(uuid.uuid4())
    flow_json = json.dumps(item.flow_data)
    await conn.execute(
        "INSERT INTO process_flows (id, user_id, process_id, title, description, flow_data) VALUES (?, ?, ?, ?, ?, ?)",
        (flow_id, user_id, item.process_id, item.title, item.description, flow_json),
    )
    await conn.execute(
        "INSERT INTO process_flow_versions (id, flow_id, version, flow_data) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), flow_id, 1, flow_json),
    )
    await conn.commit()
    return {"id": flow_id, **item.model_dump()}


@app.get("/api/process-flows/process/{process_id}")
async def list_flows_by_process(process_id: str, user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    async with conn.execute(
        "SELECT id, process_id, title, description, flow_data, version FROM process_flows WHERE user_id = ? AND process_id = ?",
        (user_id, process_id),
    ) as cursor:
        rows = await cursor.fetchall()
    out = []
    for row in rows:
        item = dict(row)
        item["flow_data"] = json.loads(item["flow_data"])
        out.append(item)
    return out


@app.put("/api/process-flows/{flow_id}")
async def update_flow(flow_id: str, item: FlowUpdate, user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    flow_json = json.dumps(item.flow_data)
    await conn.execute(
        """
        UPDATE process_flows
        SET title = COALESCE(?, title),
            description = COALESCE(?, description),
            flow_data = ?,
            version = version + 1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
        """,
        (item.title, item.description, flow_json, flow_id, user_id),
    )
    async with conn.execute("SELECT version FROM process_flows WHERE id = ? AND user_id = ?", (flow_id, user_id)) as cursor:
        row = await cursor.fetchone()
    version = row["version"] if row else 1
    await conn.execute(
        "INSERT INTO process_flow_versions (id, flow_id, version, flow_data) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), flow_id, version, flow_json),
    )
    await conn.commit()
    return {"id": flow_id, "version": version, **item.model_dump()}


@app.get("/api/process-flows/{flow_id}/versions")
async def flow_versions(flow_id: str, _user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    async with conn.execute(
        "SELECT version, created_at FROM process_flow_versions WHERE flow_id = ? ORDER BY version DESC",
        (flow_id,),
    ) as cursor:
        rows = await cursor.fetchall()
    return [{"version_number": r["version"], "created_at": r["created_at"]} for r in rows]


@app.get("/api/process-flows/{flow_id}/versions/{version}/data")
async def flow_version_data(flow_id: str, version: int, user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    async with conn.execute(
        "SELECT flow_data FROM process_flow_versions WHERE flow_id = ? AND version = ?",
        (flow_id, version),
    ) as cursor:
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Version not found")
    return json.loads(row["flow_data"])


@app.post("/api/process-flows/{flow_id}/versions/{version}/restore")
async def restore_version(flow_id: str, version: int, user_id: str = Depends(get_current_user_id)):
    conn = db.get_connection()
    async with conn.execute(
        "SELECT flow_data FROM process_flow_versions WHERE flow_id = ? AND version = ?",
        (flow_id, version),
    ) as cursor:
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Version not found")
    flow_data = json.loads(row["flow_data"])

    # Save as a new version
    async with conn.execute(
        "SELECT COALESCE(MAX(version), 0) FROM process_flow_versions WHERE flow_id = ?",
        (flow_id,),
    ) as cursor:
        max_row = await cursor.fetchone()
    new_version = (max_row[0] if max_row else 0) + 1
    flow_json = json.dumps(flow_data)
    await conn.execute(
        "INSERT INTO process_flow_versions (id, flow_id, version, flow_data) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), flow_id, new_version, flow_json),
    )
    # Also update the main flow record
    await conn.execute(
        "UPDATE process_flows SET flow_data = ?, updated_at = ? WHERE id = ?",
        (flow_json, datetime.utcnow().isoformat(), flow_id),
    )
    await conn.commit()
    return {"version": new_version, "flow_data": flow_data}


@app.post("/api/flow/rollback-patch")
async def rollback_patch(payload: Dict[str, Any], user_id: str = Depends(get_current_user_id)):
    return {"ok": True, "payload": payload}


@app.post("/api/export/excel")
async def export_excel(payload: Dict[str, Any], user_id: str = Depends(get_current_user_id)):
    import io
    from fastapi.responses import Response
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    selected_l0_ids: List[str] = payload.get("selected_l0_ids", [])
    taxonomy_attrs: List[str] = payload.get("taxonomy_attributes", [])
    flow_attrs: List[str] = payload.get("flow_attributes", [])
    include_flow_nodes: bool = payload.get("include_flow_nodes", True)
    node_attrs: List[str] = payload.get("node_attributes", [])

    if not selected_l0_ids:
        raise HTTPException(status_code=400, detail="No L0 processes selected")

    conn = db.get_connection()

    # Collect all taxonomy rows for the user, then filter to selected L0 subtrees
    async with conn.execute(
        "SELECT id, parent_id, name, description, level, code, sort_order, created_at "
        "FROM process_taxonomy WHERE user_id = ? ORDER BY level, sort_order",
        (user_id,),
    ) as cursor:
        all_rows = [dict(r) for r in await cursor.fetchall()]

    by_id = {r["id"]: r for r in all_rows}
    children_of: Dict[Optional[str], List[dict]] = {}
    for r in all_rows:
        children_of.setdefault(r["parent_id"], []).append(r)

    # Walk subtrees of selected L0s
    def collect_subtree(root_id: str) -> List[dict]:
        items = []
        node = by_id.get(root_id)
        if not node:
            return items
        items.append(node)
        for child in children_of.get(root_id, []):
            items.extend(collect_subtree(child["id"]))
        return items

    included: List[dict] = []
    for l0_id in selected_l0_ids:
        included.extend(collect_subtree(l0_id))

    # Build hierarchy lookup (walk parent chain for each item)
    def get_hierarchy(item_id: str) -> Dict[str, str]:
        h = {}
        cur = item_id
        while cur:
            node = by_id.get(cur)
            if not node:
                break
            h[node["level"]] = node["name"]
            cur = node["parent_id"]
        return {"l0": h.get(0, ""), "l1": h.get(1, ""), "l2": h.get(2, "")}

    # Fetch user info for owner display
    async with conn.execute("SELECT id, email, username FROM users WHERE id = ?", (user_id,)) as cursor:
        user_row = await cursor.fetchone()
    owner_display = (dict(user_row)["username"] if user_row else "N/A")

    # Fetch all flows for included processes
    process_ids = [r["id"] for r in included]
    flows_by_process: Dict[str, dict] = {}
    if process_ids:
        placeholders = ",".join("?" for _ in process_ids)
        async with conn.execute(
            f"SELECT id, process_id, user_id, title, description, flow_data, version, "
            f"created_at, updated_at FROM process_flows WHERE process_id IN ({placeholders})",
            process_ids,
        ) as cursor:
            for row in await cursor.fetchall():
                flows_by_process[row["process_id"]] = dict(row)

    # --- Build workbook ---
    wb = Workbook()
    header_font = Font(bold=True, color="FFFFFF", size=11)
    header_fill = PatternFill(start_color="4472C4", end_color="4472C4", fill_type="solid")
    thin_border = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )

    # ---- Sheet 1: Taxonomy ----
    ws_tax = wb.active
    ws_tax.title = "Taxonomy"

    tax_col_map = [
        ("id", "ID"),
        ("parent_id", "Parent ID"),
        ("l0", "L0 Name"),
        ("l1", "L1 Name"),
        ("l2", "L2 Name"),
        ("level", "Level"),
        ("name", "Process Name"),
        ("description", "Description"),
        ("updated_at", "Updated At"),
        ("role", "Owner(s)"),
    ]
    tax_cols = [(key, label) for key, label in tax_col_map if key in taxonomy_attrs]

    for ci, (_, label) in enumerate(tax_cols, 1):
        cell = ws_tax.cell(row=1, column=ci, value=label)
        cell.font = header_font
        cell.fill = header_fill
        cell.border = thin_border
        cell.alignment = Alignment(horizontal="center")

    def get_taxonomy_value(item: dict, flow: Optional[dict], hierarchy: Dict[str, str], key: str):
        if key == "l0":
            return hierarchy.get("l0", "")
        if key == "l1":
            return hierarchy.get("l1", "")
        if key == "l2":
            return hierarchy.get("l2", "")
        if key == "role":
            return owner_display
        if key == "updated_at":
            return (flow["updated_at"] if flow else item.get("created_at")) or ""
        return item.get(key, "")

    for ri, item in enumerate(included, 2):
        hierarchy = get_hierarchy(item["id"])
        flow = flows_by_process.get(item["id"])
        for ci, (key, _) in enumerate(tax_cols, 1):
            val = get_taxonomy_value(item, flow, hierarchy, key)
            cell = ws_tax.cell(row=ri, column=ci, value=val if val is not None else "")
            cell.border = thin_border

    for ci in range(1, len(tax_cols) + 1):
        ws_tax.column_dimensions[ws_tax.cell(row=1, column=ci).column_letter].width = 20

    # ---- Sheet 2: Flow Nodes (if requested) ----
    if include_flow_nodes:
        ws_nodes = wb.create_sheet("Flow Nodes")

        flow_col_map = [
            ("process_name", "Process Name"),
            ("title", "Flow Title"),
            ("description", "Flow Description"),
            ("created_by", "Created By"),
            ("status", "Status"),
            ("version", "Flow Version"),
            ("created_at", "Flow Created At"),
            ("updated_at", "Flow Updated At"),
        ]
        flow_cols = [(key, label) for key, label in flow_col_map if key in flow_attrs]

        node_col_map = [
            ("node_type", "Node Type"),
            ("node_label", "Process Step"),
            ("node_owner", "Owner"),
            ("node_system", "Tool/System"),
            ("node_automation", "Manual/Automated"),
        ]
        active_node_keys = set(node_attrs)
        node_cols = [(key, label) for key, label in node_col_map if key in active_node_keys]
        expanded_cols = tax_cols + flow_cols + node_cols
        taxonomy_keys = {k for k, _ in tax_cols}

        for ci, (_, label) in enumerate(expanded_cols, 1):
            cell = ws_nodes.cell(row=1, column=ci, value=label)
            cell.font = header_font
            cell.fill = header_fill
            cell.border = thin_border
            cell.alignment = Alignment(horizontal="center")

        row_idx = 2
        for item in included:
            flow = flows_by_process.get(item["id"])
            if not flow:
                continue
            raw = flow.get("flow_data") or "{}"
            try:
                fd = json.loads(raw) if isinstance(raw, str) else raw
            except json.JSONDecodeError:
                continue
            nodes_list = fd.get("nodes", [])
            if not nodes_list:
                continue

            for node in nodes_list:
                nd = node.get("data", node)
                hierarchy = get_hierarchy(item["id"])
                flow_vals = {
                    "process_name": item["name"],
                    "title": flow.get("title", ""),
                    "description": flow.get("description", ""),
                    "created_by": flow.get("user_id", ""),
                    "status": flow.get("status", ""),
                    "version": flow.get("version", ""),
                    "created_at": flow.get("created_at", ""),
                    "updated_at": flow.get("updated_at", ""),
                }
                node_vals = {
                    "node_type": node.get("type") or nd.get("type", "process"),
                    "node_label": nd.get("label", ""),
                    "node_owner": nd.get("owner", ""),
                    "node_system": nd.get("system", ""),
                    "node_automation": nd.get("manualOrAutomated", ""),
                }
                for ci, (key, _) in enumerate(expanded_cols, 1):
                    if key in taxonomy_keys:
                        value = get_taxonomy_value(item, flow, hierarchy, key)
                    elif key in flow_vals:
                        value = flow_vals.get(key, "")
                    else:
                        value = node_vals.get(key, "")
                    cell = ws_nodes.cell(row=row_idx, column=ci, value=value)
                    cell.border = thin_border
                row_idx += 1

        for ci in range(1, len(expanded_cols) + 1):
            ws_nodes.column_dimensions[ws_nodes.cell(row=1, column=ci).column_letter].width = 22

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="process_export.xlsx"'},
    )


@app.get("/api/dashboard/{user_id}")
async def dashboard(user_id: str, current_user: Dict[str, Any] = Depends(verify_token)):
    conn = db.get_connection()
    async with conn.execute(
        "SELECT id FROM process_taxonomy WHERE user_id = ?", (user_id,)
    ) as cursor:
        process_rows = await cursor.fetchall()
    process_ids = [r["id"] for r in process_rows]

    completed_ids = []
    for pid in process_ids:
        async with conn.execute(
            "SELECT 1 FROM process_flows WHERE user_id = ? AND process_id = ? LIMIT 1",
            (user_id, pid),
        ) as cursor:
            if await cursor.fetchone():
                completed_ids.append(pid)

    total = len(process_ids)
    pct = (len(completed_ids) / total * 100) if total > 0 else 0
    return {
        "stats": {"total_processes": total, "completion_percentage": pct},
        "completed_process_ids": completed_ids,
    }


@app.get("/api/processes/{process_id}/sop-status")
async def sop_status(process_id: str, user: Dict[str, Any] = Depends(verify_token)):
    conn = db.get_connection()
    async with conn.execute(
        "SELECT sop_status, sop_draft_url, sop_final_url, sop_final_pdf_url, "
        "sop_generated_at, sop_finalized_at FROM process_taxonomy WHERE id = ?",
        (process_id,),
    ) as cursor:
        row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Process not found")
    result = {
        "status": row["sop_status"],
        "draft_url": row["sop_draft_url"],
        "final_url": row["sop_final_url"],
        "final_pdf_url": row["sop_final_pdf_url"],
        "has_recording_data": False,
        "generated_at": row["sop_generated_at"],
        "finalized_at": row["sop_finalized_at"],
        "flow_out_of_sync": False,
        "flow_last_synced_at": None,
    }
    storage_service.sign_sop_urls(result)
    return result


async def get_process_hierarchy(conn, process_id: str) -> Dict[str, str]:
    """Walk up the taxonomy tree to get L0-L3 hierarchy names."""
    hierarchy = {"l0_name": "", "l1_name": "", "l2_name": "", "l3_name": ""}
    current_id = process_id
    while current_id:
        async with conn.execute(
            "SELECT id, name, level, parent_id FROM process_taxonomy WHERE id = ?",
            (current_id,),
        ) as cursor:
            row = await cursor.fetchone()
        if not row:
            break
        hierarchy[f"l{row['level']}_name"] = row["name"]
        current_id = row["parent_id"]
    return hierarchy


def _sanitize_filename(name: str) -> str:
    """Remove characters that are invalid in filenames."""
    import re as _re
    return _re.sub(r'[\\/:*?"<>|]', "_", name).strip()[:100]


class SingleSOPExportRequest(BaseModel):
    include_ai_suggestions: bool = True
    flow_screenshot: Optional[str] = None


@app.post("/api/export/sop/{process_id}")
async def export_sop(
    process_id: str,
    export_request: Optional[SingleSOPExportRequest] = None,
    user_id: str = Depends(get_current_user_id),
):
    """Generate a SOP Word document and return it as a direct download."""
    from fastapi.responses import Response

    include_ai = export_request.include_ai_suggestions if export_request else True
    flow_screenshot = export_request.flow_screenshot if export_request else None

    conn = db.get_connection()

    async with conn.execute(
        "SELECT id, user_id, parent_id, level, name, description, code, created_at "
        "FROM process_taxonomy WHERE id = ?",
        (process_id,),
    ) as cursor:
        process_row = await cursor.fetchone()
    if not process_row:
        raise HTTPException(status_code=404, detail="Process not found")
    process = dict(process_row)

    async with conn.execute(
        "SELECT id, process_id, user_id AS created_by, title, description, flow_data, "
        "version, created_at, updated_at FROM process_flows "
        "WHERE process_id = ? ORDER BY updated_at DESC LIMIT 1",
        (process_id,),
    ) as cursor:
        flow_row = await cursor.fetchone()

    flow = None
    flow_data = None
    if flow_row:
        flow = dict(flow_row)
        raw = flow.get("flow_data") or "{}"
        if isinstance(raw, str):
            try:
                flow_data = json.loads(raw)
            except json.JSONDecodeError:
                flow_data = {}
        else:
            flow_data = raw
        flow["flow_data"] = flow_data

    hierarchy = await get_process_hierarchy(conn, process_id)

    # Look up the process creator as the owner
    async with conn.execute(
        "SELECT email, username FROM users WHERE id = ?",
        (process.get("user_id"),),
    ) as cursor:
        user_row = await cursor.fetchone()
    assignments: List[Dict[str, Any]] = []
    if user_row:
        assignments.append({
            "role": "owner",
            "full_name": user_row["username"],
            "user_email": user_row["email"],
        })

    # Inject updated_at and version into the process dict for the title page
    if flow:
        process["updated_at"] = flow.get("updated_at") or flow.get("created_at")
        process["version"] = flow.get("version", 1)

    ai_suggestions = None
    if include_ai:
        try:
            sop_ai = get_sop_ai_service()
            result = await sop_ai.generate_sop_suggestions(
                process=process,
                flow_data=flow_data,
                hierarchy=hierarchy,
                assignments=assignments,
            )
            ai_suggestions = [
                {
                    "suggestion_type": s.suggestion_type.value,
                    "section": s.section,
                    "original_text": s.original_text,
                    "suggested_text": s.suggested_text,
                    "comment_text": s.comment_text,
                    "node_id": s.node_id,
                    "field_name": s.field_name,
                }
                for s in result.suggestions
            ]
            logger.info("Generated %d AI SOP suggestions for %s", len(ai_suggestions), process_id)
        except Exception as ai_err:
            logger.warning("AI suggestions failed for SOP %s: %s", process_id, ai_err)

    from services.sop_generator import SOPGenerator
    generator = SOPGenerator()
    doc_buffer = await generator.generate_sop(
        process=process,
        flow=flow,
        assignments=assignments,
        hierarchy=hierarchy,
        ai_suggestions=ai_suggestions,
        flow_screenshot=flow_screenshot,
        storage_service=storage_service,
    )

    doc_bytes = doc_buffer.getvalue()
    safe_name = _sanitize_filename(process.get("name", "Process"))
    date_str = datetime.utcnow().strftime("%y%m%d")
    filename = f"{safe_name} - {date_str} vDraft.docx"

    return Response(
        content=doc_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


SCREENSHOT_DIR = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(SCREENSHOT_DIR, exist_ok=True)


@app.post("/api/process-flows/{flow_id}/upload-screenshot")
async def upload_screenshot(
    flow_id: str,
    file: UploadFile = File(...),
    node_id: Optional[str] = Form(None),
    user_id: str = Depends(get_current_user_id),
):
    import hashlib
    content = await file.read()
    ext = os.path.splitext(file.filename or "img.png")[1] or ".png"
    file_hash = hashlib.sha256(content).hexdigest()[:12]
    filename = f"{flow_id}_{file_hash}{ext}"
    filepath = os.path.join(SCREENSHOT_DIR, filename)
    with open(filepath, "wb") as f:
        f.write(content)
    url = f"/api/screenshots/{filename}"
    return {"key": url, "url": url, "node_id": node_id}


@app.get("/api/screenshots/{filename}")
async def serve_screenshot(filename: str):
    from fastapi.responses import FileResponse
    filepath = os.path.join(SCREENSHOT_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(filepath)


@app.get("/api/process-flows/{flow_id}/screenshots")
async def list_screenshots(flow_id: str, user_id: str = Depends(get_current_user_id)):
    prefix = f"{flow_id}_"
    shots = []
    if os.path.isdir(SCREENSHOT_DIR):
        for fname in os.listdir(SCREENSHOT_DIR):
            if fname.startswith(prefix):
                shots.append({"url": f"/api/screenshots/{fname}", "captured_at": None, "note": "Local upload"})
    return {"screenshots": shots}


@app.delete("/api/process-flows/{flow_id}/screenshots")
async def delete_screenshot(flow_id: str, payload: Dict[str, Any] = {}, user_id: str = Depends(get_current_user_id)):
    key = payload.get("key", "")
    filename = key.split("/")[-1] if "/" in key else key
    filepath = os.path.join(SCREENSHOT_DIR, filename)
    if os.path.exists(filepath):
        os.remove(filepath)
    return {"ok": True}


@app.get("/api/storage/{path:path}")
async def serve_local_storage(path: str):
    """Serve files from local_storage/ directory (SOP docs, etc.)."""
    from fastapi.responses import FileResponse
    full = storage_service.get_local_path(path)
    if not full.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(str(full))


@app.post("/api/contact")
async def contact(payload: Dict[str, Any]):
    return {"message": "Thanks, we received your message.", "payload": payload}


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)
