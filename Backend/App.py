"""
app.py — FastAPI service entry point
Run with: uvicorn app:app --host 0.0.0.0 --port 8000 --reload
"""

import json
import asyncio
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from Logic import ModelManager, ChatEngine, DEFAULT_MODEL

# ──────────────────────────────────────────────
# INIT
# ──────────────────────────────────────────────

model_manager = ModelManager()
chat_engine = ChatEngine(model_manager)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Auto-load model on startup if already downloaded."""
    if model_manager.is_model_downloaded():
        print("[startup] Model found — loading into memory...")
        result = model_manager.load_model()
        print(f"[startup] {result}")
    else:
        print("[startup] No model found. User must download first.")
    yield
    model_manager.unload_model()
    print("[shutdown] Model unloaded.")


app = FastAPI(
    title="Offline Chat API",
    description="Local LLM backend powered by Gemma 2B",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],      # lock this down in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ──────────────────────────────────────────────
# SCHEMAS
# ──────────────────────────────────────────────

class Message(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    max_tokens: int = Field(default=512, ge=64, le=2048)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    top_p: float = Field(default=0.9, ge=0.0, le=1.0)


class DownloadRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_id: str = DEFAULT_MODEL


class LoadRequest(BaseModel):
    model_config = {"protected_namespaces": ()}
    model_id: str = DEFAULT_MODEL


# ──────────────────────────────────────────────
# ROUTES — STATUS
# ──────────────────────────────────────────────

@app.get("/status", tags=["System"])
def get_status():
    """
    Overall status — downloaded, loaded, which model.
    Android calls this on app launch to decide what screen to show.
    """
    return model_manager.get_status()


@app.get("/health", tags=["System"])
def health():
    """Simple ping to check if server is alive."""
    return {"ok": True}


# ──────────────────────────────────────────────
# ROUTES — MODELS
# ──────────────────────────────────────────────

@app.get("/models", tags=["Models"])
def list_models():
    """
    Returns catalogue of available models with download status.
    """
    return {"models": model_manager.list_models()}


# ──────────────────────────────────────────────
# ROUTES — DOWNLOAD
# ──────────────────────────────────────────────

@app.post("/download/start", tags=["Download"])
def start_download(body: DownloadRequest):
    """
    Begin downloading the model in the background.
    Returns immediately — poll /download/progress for updates.
    """
    result = model_manager.start_download(body.model_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/download/progress", tags=["Download"])
def download_progress():
    """
    Poll this endpoint to track download progress.

    Response:
    - status: idle | downloading | done | error | cancelled
    - percent: 0.0 → 100.0
    - downloaded_mb / total_mb
    - speed_mbps
    - error: error message if status == "error"
    """
    return model_manager.get_download_progress()


@app.post("/download/cancel", tags=["Download"])
def cancel_download():
    """Cancel an ongoing download."""
    model_manager.cancel_download()
    return {"status": "cancelled"}


# ──────────────────────────────────────────────
# ROUTES — MODEL LOADING
# ──────────────────────────────────────────────

@app.post("/model/load", tags=["Model"])
def load_model(body: LoadRequest):
    """
    Load downloaded model into RAM.
    Called after download completes (or on cold start if already downloaded).
    """
    result = model_manager.load_model(body.model_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/model/unload", tags=["Model"])
def unload_model():
    """Unload the model from RAM to free memory."""
    model_manager.unload_model()
    return {"status": "unloaded"}


# ──────────────────────────────────────────────
# ROUTES — CHAT
# ──────────────────────────────────────────────

@app.post("/chat", tags=["Chat"])
def chat(body: ChatRequest):
    """
    Non-streaming chat. Returns the full response at once.
    Use /chat/stream for token-by-token streaming (better UX).
    """
    if not model_manager.is_model_loaded():
        raise HTTPException(
            status_code=503,
            detail="Model is not loaded. Call /model/load first.",
        )

    messages = [m.model_dump() for m in body.messages]

    try:
        reply = chat_engine.get_response(
            messages=messages,
            max_tokens=body.max_tokens,
            temperature=body.temperature,
        )
        return {"reply": reply.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat/stream", tags=["Chat"])
def chat_stream(body: ChatRequest):
    """
    Streaming chat via Server-Sent Events (SSE).

    Android reads this as a stream and appends tokens to the UI in real-time.

    SSE format:
        data: {"token": "Hello"}\\n\\n
        data: {"token": " world"}\\n\\n
        data: [DONE]\\n\\n
    """
    if not model_manager.is_model_loaded():
        raise HTTPException(
            status_code=503,
            detail="Model is not loaded. Call /model/load first.",
        )

    messages = [m.model_dump() for m in body.messages]

    def token_generator():
        try:
            for token in chat_engine.stream_response(
                messages=messages,
                max_tokens=body.max_tokens,
                temperature=body.temperature,
                top_p=body.top_p,
            ):
                payload = json.dumps({"token": token})
                yield f"data: {payload}\n\n"
        except Exception as e:
            error_payload = json.dumps({"error": str(e)})
            yield f"data: {error_payload}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        token_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",   # important for nginx proxies
        },
    )