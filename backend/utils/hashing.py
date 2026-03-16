import hashlib
import json

def get_content_hash(content):
    """Generate a consistent SHA256 fingerprint for audit integrity."""
    try:
        if not content:
            return "empty_content"
        payload = content if isinstance(content, str) else json.dumps(content, sort_keys=True, default=str)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()
    except Exception as e:
        return f"hash_error_{str(e)}"
