"""
Central LLM client factory for OpenAI and Azure OpenAI.

Set USE_AZURE_OPENAI=true and Azure env vars to use Azure OpenAI.
Otherwise uses OpenAI (OPENAI_API_KEY).
"""

import os
import logging
from typing import Union

import openai
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

DEFAULT_OPENAI_TIMEOUT = 180.0


def _get_timeout() -> float:
    try:
        return float(os.getenv("OPENAI_TIMEOUT", DEFAULT_OPENAI_TIMEOUT))
    except ValueError:
        return DEFAULT_OPENAI_TIMEOUT


def use_azure_openai() -> bool:
    """True if Azure OpenAI should be used (env USE_AZURE_OPENAI or AZURE_OPENAI_ENDPOINT set)."""
    load_dotenv()
    if os.getenv("USE_AZURE_OPENAI", "").lower() in ("true", "1", "yes"):
        return True
    if os.getenv("AZURE_OPENAI_ENDPOINT"):
        return True
    return False


def get_client() -> Union[openai.AsyncOpenAI, openai.AsyncAzureOpenAI]:
    """
    Return an async LLM client (OpenAI or Azure OpenAI).
    Same interface: .chat.completions.create(), .audio.transcriptions.create().
    For Azure, pass deployment name as the 'model' argument in create() calls.
    """
    load_dotenv()
    if use_azure_openai():
        endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        api_key = os.getenv("AZURE_OPENAI_API_KEY")
        api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-15-preview")
        if not endpoint or not api_key:
            raise ValueError(
                "Azure OpenAI requires AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_API_KEY. "
                "Set USE_AZURE_OPENAI=true (or set AZURE_OPENAI_ENDPOINT)."
            )
        logger.info("Using Azure OpenAI client (endpoint=%s)", endpoint.rstrip("/"))
        return openai.AsyncAzureOpenAI(
            azure_endpoint=endpoint.rstrip("/"),
            api_key=api_key,
            api_version=api_version,
            timeout=_get_timeout(),
        )
    # OpenAI
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OpenAI requires OPENAI_API_KEY (or switch to Azure with USE_AZURE_OPENAI=true).")
    return openai.AsyncOpenAI(
        api_key=api_key,
        timeout=_get_timeout(),
    )


def get_chat_model() -> str:
    """Model/deployment name for chat completions (e.g. gpt-4o)."""
    load_dotenv()
    if use_azure_openai():
        return os.getenv("AZURE_OPENAI_CHAT_DEPLOYMENT", "gpt-4o")
    return os.getenv("OPENAI_CHAT_MODEL", "gpt-4o")


def get_vision_model() -> str:
    """Model/deployment name for vision/image calls. Defaults to chat model if not set."""
    load_dotenv()
    if use_azure_openai():
        return os.getenv("AZURE_OPENAI_VISION_DEPLOYMENT") or get_chat_model()
    return os.getenv("OPENAI_VISION_MODEL", "gpt-4o")


def get_vision_verify_model() -> str:
    """Model for lightweight vision verification (e.g. gpt-4o-mini). Defaults to vision model if not set."""
    load_dotenv()
    if use_azure_openai():
        return os.getenv("AZURE_OPENAI_VISION_VERIFY_DEPLOYMENT") or get_vision_model()
    return os.getenv("VISION_VERIFY_MODEL", "gpt-4o-mini")


def has_llm_configured() -> bool:
    """True if either OpenAI or Azure OpenAI is configured (for optional LLM features)."""
    load_dotenv()
    if use_azure_openai():
        return bool(os.getenv("AZURE_OPENAI_ENDPOINT") and os.getenv("AZURE_OPENAI_API_KEY"))
    return bool(os.getenv("OPENAI_API_KEY"))
