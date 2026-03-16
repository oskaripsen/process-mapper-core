from typing import List, Dict, Any, Optional

from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from openai import RateLimitError, APIConnectionError, APIError

from utils.circuit_breaker import openai_circuit_breaker
from utils.llm_client import get_client, get_chat_model


class ChatService:
    """Lightweight chat wrapper around Chat Completions (OpenAI or Azure OpenAI)."""

    def __init__(self):
        self.client = get_client()
        self._default_model = get_chat_model()

    async def chat(self, messages: List[Dict[str, Any]], model: Optional[str] = None, temperature: float = 0.2) -> str:
        """
        Send a chat completion request.

        Args:
            messages: Array of {role: "system"|"user"|"assistant", content: str}
            model: Optional override; defaults to configured chat model
            temperature: Sampling temperature

        Returns:
            Assistant message content string
        """
        if not messages or not isinstance(messages, list):
            raise ValueError("messages must be a non-empty list")

        model_name = model or self._default_model

        @retry(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=2, max=10),
            retry=retry_if_exception_type((RateLimitError, APIConnectionError, APIError)),
            reraise=True
        )
        async def _make_request():
            return await openai_circuit_breaker.call_async(
                self.client.chat.completions.create,
                model=model_name,
                messages=messages,
                temperature=temperature,
            )
        
        try:
            response = await _make_request()
            return response.choices[0].message.content
        except Exception as e:
            raise Exception(f"Chat completion error: {str(e)}")

    async def stream_chat(self, messages: List[Dict[str, Any]], model: Optional[str] = None, temperature: float = 0.2):
        """Yield assistant content tokens as they arrive."""
        if not messages or not isinstance(messages, list):
            raise ValueError("messages must be a non-empty list")
        model_name = model or self._default_model
        
        @retry(
            stop=stop_after_attempt(3),
            wait=wait_exponential(multiplier=1, min=2, max=10),
            retry=retry_if_exception_type((RateLimitError, APIConnectionError, APIError)),
            reraise=True
        )
        async def _make_request():
            return await openai_circuit_breaker.call_async(
                self.client.chat.completions.create,
                model=model_name,
                messages=messages,
                temperature=temperature,
                stream=True,
            )
        
        try:
            stream = await _make_request()
            async for chunk in stream:
                if chunk.choices and len(chunk.choices) > 0:
                    delta = chunk.choices[0].delta
                    if delta and hasattr(delta, "content") and delta.content is not None:
                        content = delta.content
                        if content:  # Only yield non-empty content
                            yield content
        except Exception as e:
            # Emit an error token so client can show something
            yield f"\n[error] {str(e)}"


