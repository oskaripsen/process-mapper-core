import logging
import os
from pathlib import Path
from typing import Optional

import boto3
from botocore.config import Config
from fastapi.concurrency import run_in_threadpool

logger = logging.getLogger(__name__)

# Default presigned URL expiry: 1 hour (in seconds)
DEFAULT_PRESIGNED_EXPIRY = 3600


class StorageService:
    def __init__(self):
        self.use_local_storage = os.getenv("USE_LOCAL_STORAGE", "false").lower() in ("1", "true", "yes")
        self.local_storage_dir = Path(os.getenv("LOCAL_STORAGE_DIR", "local_storage"))
        self.local_storage_base_url = os.getenv("LOCAL_STORAGE_BASE_URL", "/api/storage")

        self.r2_account_id = os.getenv("R2_ACCOUNT_ID")
        self.r2_bucket = os.getenv("R2_BUCKET")
        self.r2_access_key_id = os.getenv("R2_ACCESS_KEY_ID")
        self.r2_secret_access_key = os.getenv("R2_SECRET_ACCESS_KEY")
        self.r2_endpoint = os.getenv("R2_ENDPOINT")

        self._s3_client = None

    def is_local_enabled(self) -> bool:
        return self.use_local_storage

    # ------------------------------------------------------------------
    # Key normalisation
    # ------------------------------------------------------------------

    def _normalize_key(self, key: str) -> str:
        """Normalise an object key – strip slashes, collapse segments, block '..'."""
        normalized = key.strip().lstrip("/").replace("\\", "/")
        parts = [part for part in normalized.split("/") if part]
        if any(part == ".." for part in parts):
            raise ValueError("Invalid storage key")
        return "/".join(parts)

    # ------------------------------------------------------------------
    # Local-storage helpers
    # ------------------------------------------------------------------

    def _build_local_url(self, key: str) -> str:
        base = self.local_storage_base_url.rstrip("/")
        if not base.startswith("http"):
            backend_base = os.getenv("BACKEND_BASE_URL")
            if backend_base:
                if base.startswith("/"):
                    base = f"{backend_base.rstrip('/')}{base}"
                else:
                    base = f"{backend_base.rstrip('/')}/{base}"
        return f"{base}/{key}"

    def _resolve_local_path(self, key: str) -> Path:
        normalized = self._normalize_key(key)
        base = self.local_storage_dir.resolve()
        candidate = (base / normalized).resolve()
        if not str(candidate).startswith(str(base)):
            raise ValueError("Invalid local storage path")
        return candidate

    def _write_local(self, key: str, content: bytes):
        path = self._resolve_local_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(content)

    # ------------------------------------------------------------------
    # R2 / S3 helpers
    # ------------------------------------------------------------------

    def _ensure_s3_client(self):
        if self._s3_client:
            return self._s3_client

        if not self.r2_bucket:
            raise ValueError("R2_BUCKET is required for remote storage")
        if not self.r2_access_key_id or not self.r2_secret_access_key:
            raise ValueError("R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required for remote storage")

        endpoint = self.r2_endpoint
        if not endpoint and self.r2_account_id:
            endpoint = f"https://{self.r2_account_id}.r2.cloudflarestorage.com"
        if not endpoint:
            raise ValueError("R2_ENDPOINT or R2_ACCOUNT_ID is required for remote storage")

        session = boto3.session.Session()
        self._s3_client = session.client(
            "s3",
            region_name="auto",
            endpoint_url=endpoint,
            aws_access_key_id=self.r2_access_key_id,
            aws_secret_access_key=self.r2_secret_access_key,
            config=Config(signature_version="s3v4"),
        )
        return self._s3_client

    def _write_r2(self, key: str, content: bytes, content_type: Optional[str]):
        client = self._ensure_s3_client()
        client.put_object(
            Bucket=self.r2_bucket,
            Key=key,
            Body=content,
            ContentType=content_type or "application/octet-stream",
        )

    def _delete_r2(self, key: str):
        client = self._ensure_s3_client()
        client.delete_object(Bucket=self.r2_bucket, Key=key)

    # ------------------------------------------------------------------
    # Presigned URL generation
    # ------------------------------------------------------------------

    def _generate_presigned_url(self, key: str, expires_in: int = DEFAULT_PRESIGNED_EXPIRY) -> str:
        """Generate a temporary presigned GET URL for an R2 object."""
        client = self._ensure_s3_client()
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.r2_bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def save_bytes(self, content: bytes, key: str, content_type: Optional[str] = None) -> str:
        """
        Persist *content* and return the **storage key** (not a URL).

        The returned key should be stored in the database.  To get a
        URL the frontend can load, call ``get_url(key)`` afterwards.
        """
        normalized = self._normalize_key(key)
        if self.use_local_storage:
            await run_in_threadpool(self._write_local, normalized, content)
            return normalized

        await run_in_threadpool(self._write_r2, normalized, content, content_type)
        return normalized

    async def delete(self, key_or_url: str) -> bool:
        """
        Delete an object from storage by its key (or legacy URL).

        Returns True if the deletion succeeded, False otherwise.
        """
        if not key_or_url:
            return False

        key = self._extract_key(key_or_url)
        normalized = self._normalize_key(key)

        if self.use_local_storage:
            local_path = self._resolve_local_path(normalized)
            if local_path.exists():
                local_path.unlink()
            return True

        await run_in_threadpool(self._delete_r2, normalized)
        return True

    def get_url(self, key_or_url: str, expires_in: int = DEFAULT_PRESIGNED_EXPIRY) -> str:
        """
        Turn a storage key (or a legacy full URL) into a URL the client can load.

        * **Local mode** – returns a path-based URL served by the backend.
        * **R2 mode** – returns a time-limited presigned URL.

        Handles legacy data gracefully: if *key_or_url* is already a full
        ``https://`` URL (from the old R2_PUBLIC_BASE_URL approach), the
        object key is extracted automatically.
        """
        if not key_or_url:
            return key_or_url

        # --- handle legacy full URLs stored before migration ----
        key = self._extract_key(key_or_url)

        if self.use_local_storage:
            return self._build_local_url(key)

        return self._generate_presigned_url(key, expires_in)

    async def get_bytes(self, key_or_url: str) -> Optional[bytes]:
        """
        Download object bytes directly from storage (local or R2).

        Accepts a storage key or a legacy full URL.  Returns None if the
        object cannot be found or fetched.
        """
        if not key_or_url:
            return None

        key = self._extract_key(key_or_url)
        normalized = self._normalize_key(key)

        if self.use_local_storage:
            path = self._resolve_local_path(normalized)
            if path.exists():
                return await run_in_threadpool(path.read_bytes)
            return None

        try:
            client = self._ensure_s3_client()
            response = await run_in_threadpool(
                lambda: client.get_object(Bucket=self.r2_bucket, Key=normalized)
            )
            return await run_in_threadpool(response["Body"].read)
        except Exception as exc:
            logger.warning("Failed to download %s from R2: %s", normalized, exc)
            return None

    def get_local_path(self, key: str) -> Path:
        return self._resolve_local_path(key)

    # ------------------------------------------------------------------
    # Bulk-signing helpers (for API responses)
    # ------------------------------------------------------------------

    def sign_flow_data(self, flow_data: dict) -> dict:
        """
        Walk *flow_data* (ReactFlow JSON) and replace every
        ``node.data.screenshot_url`` with a signed URL.

        Also signs URLs inside ``recording_metadata.screenshots[].url``
        and ``recording_metadata.screenshot_urls[]``.

        Mutates and returns *flow_data* for convenience.
        """
        if not flow_data:
            return flow_data

        for node in flow_data.get("nodes", []):
            data = node.get("data") or {}
            if data.get("screenshot_url"):
                data["screenshot_url"] = self.get_url(data["screenshot_url"])

        rec_meta = flow_data.get("recording_metadata") or {}
        self._sign_recording_metadata(rec_meta)

        return flow_data

    def sign_sop_urls(self, row: dict) -> dict:
        """
        Sign any SOP-related URL fields in *row* (in-place).

        Handles both DB column names (``sop_draft_url``, …) and the
        shortened API response names (``draft_url``, ``final_url``, …).
        """
        for field in (
            "sop_draft_url", "sop_final_url", "sop_final_pdf_url", "sop_doc_url",
            "draft_url", "final_url", "final_pdf_url", "sop_url",
        ):
            if row.get(field):
                row[field] = self.get_url(row[field])
        return row

    def _sign_recording_metadata(self, meta: dict):
        """Sign screenshot URLs inside recording metadata (in-place)."""
        for shot in meta.get("screenshots", []):
            if shot.get("url"):
                shot["url"] = self.get_url(shot["url"])
        meta["screenshot_urls"] = [
            self.get_url(u) for u in meta.get("screenshot_urls", []) if u
        ]

    # ------------------------------------------------------------------
    # Migration helper
    # ------------------------------------------------------------------

    def _extract_key(self, key_or_url: str) -> str:
        """
        If *key_or_url* is a full ``https://…`` URL (legacy public URL or
        presigned URL), strip the origin and return just the object key.
        Otherwise return the value unchanged.

        Handles:
        - Old public URLs: ``https://pub-xxx.r2.dev/recordings/abc/img.png``
        - Presigned S3-style URLs whose path starts with ``/<bucket>/``:
          ``https://<account>.r2.cloudflarestorage.com/<bucket>/key?X-Amz-...``
        """
        if key_or_url.startswith("https://") or key_or_url.startswith("http://"):
            from urllib.parse import urlparse
            parsed = urlparse(key_or_url)
            path = parsed.path.lstrip("/")
            # Presigned R2 URLs use path-style addressing: /<bucket>/<key>.
            # Strip the bucket prefix so we get just the object key.
            bucket = self.r2_bucket.strip('"').strip("'") if self.r2_bucket else None
            if bucket and path.startswith(f"{bucket}/"):
                path = path[len(bucket) + 1:]
            return path
        return key_or_url
