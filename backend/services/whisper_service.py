import io
import logging
import os
import tempfile
from typing import Any, Dict, List

from pydub import AudioSegment

MAX_AUDIO_SIZE_BYTES = 24 * 1024 * 1024
CHUNK_DURATION_MS = 5 * 60 * 1000
logger = logging.getLogger(__name__)


class WhisperService:
    def __init__(self):
        model_size = os.getenv("FASTER_WHISPER_MODEL", "base")
        self.model = None
        try:
            from faster_whisper import WhisperModel  # lazy import to avoid hard crash on startup
            self.model = WhisperModel(model_size, compute_type="int8")
        except Exception as exc:
            logger.warning("faster-whisper initialization failed: %s", exc)
            self.model = None

    def _split_audio_into_chunks(self, audio_bytes: bytes, filename: str) -> List[tuple]:
        ext = filename.lower().split('.')[-1] if '.' in filename else 'wav'
        format_map = {'wav': 'wav', 'mp3': 'mp3', 'webm': 'webm', 'ogg': 'ogg', 'm4a': 'mp4'}
        audio_format = format_map.get(ext, 'wav')
        audio_file = io.BytesIO(audio_bytes)
        audio = AudioSegment.from_file(audio_file, format=audio_format)

        chunks = []
        start_ms = 0
        chunk_idx = 0
        while start_ms < len(audio):
            end_ms = min(start_ms + CHUNK_DURATION_MS, len(audio))
            chunk = audio[start_ms:end_ms]
            chunk_buffer = io.BytesIO()
            chunk.export(chunk_buffer, format='wav')
            chunks.append((chunk_buffer.getvalue(), f"chunk_{chunk_idx}.wav", start_ms))
            start_ms = end_ms
            chunk_idx += 1
        return chunks

    async def _transcribe_single_chunk(self, audio_bytes: bytes) -> Dict[str, Any]:
        if self.model is None:
            raise RuntimeError(
                "faster-whisper is unavailable in this environment. "
                "Recreate backend venv and reinstall requirements, or adjust ctranslate2 wheel for your CPU/OS."
            )
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as temp_file:
            temp_file.write(audio_bytes)
            temp_file.flush()
            segments, _ = self.model.transcribe(temp_file.name, word_timestamps=True)

            text_parts = []
            out_segments = []
            out_words = []
            for i, seg in enumerate(segments):
                text_parts.append(seg.text.strip())
                out_segments.append({
                    "id": i,
                    "start": float(seg.start),
                    "end": float(seg.end),
                    "text": seg.text.strip(),
                })
                for w in (seg.words or []):
                    out_words.append({
                        "word": w.word,
                        "start": float(w.start),
                        "end": float(w.end),
                    })
            return {
                "text": " ".join(text_parts).strip(),
                "segments": out_segments,
                "words": out_words,
            }

    async def transcribe_audio_from_bytes(self, audio_bytes: bytes, filename: str) -> Dict[str, Any]:
        if len(audio_bytes) <= MAX_AUDIO_SIZE_BYTES:
            return await self._transcribe_single_chunk(audio_bytes)

        chunks = self._split_audio_into_chunks(audio_bytes, filename)
        merged = {"text": "", "segments": [], "words": []}
        seg_id = 0
        for chunk_bytes, _chunk_name, start_ms in chunks:
            offset_sec = start_ms / 1000.0
            result = await self._transcribe_single_chunk(chunk_bytes)
            if result["text"]:
                merged["text"] = f"{merged['text']} {result['text']}".strip()
            for seg in result["segments"]:
                merged["segments"].append({
                    **seg,
                    "id": seg_id,
                    "start": seg["start"] + offset_sec,
                    "end": seg["end"] + offset_sec,
                })
                seg_id += 1
            for word in result["words"]:
                merged["words"].append({
                    **word,
                    "start": word["start"] + offset_sec,
                    "end": word["end"] + offset_sec,
                })
        return merged
