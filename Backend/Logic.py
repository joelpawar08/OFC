import os
import threading
import requests
from pathlib import Path
from typing import Generator, Optional
from llama_cpp import Llama

# ──────────────────────────────────────────────
# CONFIG
# ──────────────────────────────────────────────

MODELS_DIR = Path("models")
MODELS_DIR.mkdir(exist_ok=True)

# HuggingFace token — set env var HF_TOKEN if the repo requires login.
# Most Gemma re-uploads require accepting the license on HF once,
# then your token is enough. Get one at https://huggingface.co/settings/tokens
HF_TOKEN = os.environ.get("HF_TOKEN", None)

# Available models catalogue
# Using MaziyarPanahi's re-upload which is widely accessible.
# repo_id + filename → downloaded via huggingface_hub (handles auth + resume).
AVAILABLE_MODELS = {
    "gemma-2b": {
        "name": "Gemma 2B (Recommended)",
        "filename": "gemma-2b-it-Q4_K_M.gguf",
        "hf_repo": "bartowski/gemma-2-2b-it-GGUF",
        "hf_file": "gemma-2-2b-it-Q4_K_M.gguf",
        "size_mb": 1500,
        "description": "Fast, lightweight, great for chat. Best for most devices.",
        "ram_required_gb": 2.5,
    }
}

DEFAULT_MODEL = "gemma-2b"


# ──────────────────────────────────────────────
# MODEL MANAGER
# ──────────────────────────────────────────────

class ModelManager:
    """
    Handles downloading, tracking progress, loading,
    and unloading the GGUF model.
    """

    def __init__(self):
        self._download_state: dict = {
            "status": "idle",       # idle | downloading | done | error
            "model_id": None,
            "percent": 0.0,
            "downloaded_mb": 0.0,
            "total_mb": 0.0,
            "speed_mbps": 0.0,
            "error": None,
        }
        self._download_thread: Optional[threading.Thread] = None
        self._llm: Optional[Llama] = None
        self._loaded_model_id: Optional[str] = None

    # ── Catalogue ──────────────────────────────

    def list_models(self) -> list[dict]:
        result = []
        for model_id, meta in AVAILABLE_MODELS.items():
            path = MODELS_DIR / meta["filename"]
            result.append({
                "id": model_id,
                "name": meta["name"],
                "description": meta["description"],
                "size_mb": meta["size_mb"],
                "ram_required_gb": meta["ram_required_gb"],
                "downloaded": path.exists(),
                "loaded": self._loaded_model_id == model_id,
            })
        return result

    # ── Model path helpers ─────────────────────

    def get_model_path(self, model_id: str) -> Path:
        meta = AVAILABLE_MODELS[model_id]
        return MODELS_DIR / meta["filename"]

    def is_model_downloaded(self, model_id: str = DEFAULT_MODEL) -> bool:
        return self.get_model_path(model_id).exists()

    def is_model_loaded(self) -> bool:
        return self._llm is not None

    # ── Download ───────────────────────────────

    def start_download(self, model_id: str = DEFAULT_MODEL) -> dict:
        """
        Kicks off background download thread.
        Returns immediately with current state.
        """
        if model_id not in AVAILABLE_MODELS:
            return {"error": f"Unknown model: {model_id}"}

        if self._download_state["status"] == "downloading":
            return {"error": "A download is already in progress."}

        if self.is_model_downloaded(model_id):
            return {"error": "Model already downloaded.", "status": "done"}

        self._download_state = {
            "status": "downloading",
            "model_id": model_id,
            "percent": 0.0,
            "downloaded_mb": 0.0,
            "total_mb": AVAILABLE_MODELS[model_id]["size_mb"],
            "speed_mbps": 0.0,
            "error": None,
        }

        self._download_thread = threading.Thread(
            target=self._download_worker,
            args=(model_id,),
            daemon=True,
        )
        self._download_thread.start()
        return {"status": "started", "model_id": model_id}

    def _download_worker(self, model_id: str):
        """
        Downloads the model using huggingface_hub, which:
        - Handles auth via HF_TOKEN env var or cached `huggingface-cli login`
        - Supports resume on interrupted downloads
        - Works with gated/community repos that require license acceptance
        
        Progress is tracked by polling the partial file size in a side thread.
        """
        import time
        import shutil
        from huggingface_hub import hf_hub_download, constants as hf_constants

        meta = AVAILABLE_MODELS[model_id]
        dest = self.get_model_path(model_id)

        try:
            # hf_hub_download writes to HF cache first, then we move it.
            # We poll the cache dir for the .incomplete file to track progress.
            total_bytes = meta["size_mb"] * 1_000_000  # estimate until we know real size
            start_time = time.time()

            # Launch the actual download (blocking call in this thread)
            # We'll poll from a helper thread for progress.
            poll_stop = threading.Event()

            def poll_progress():
                """Scans HF cache for the .incomplete download file and updates state."""
                cache_dir = Path(hf_constants.HF_HUB_CACHE)
                while not poll_stop.is_set():
                    try:
                        # Find any .incomplete file related to our model
                        incomplete_files = list(cache_dir.rglob("*.incomplete"))
                        if incomplete_files:
                            size = max(f.stat().st_size for f in incomplete_files)
                            elapsed = time.time() - start_time or 0.001
                            self._download_state.update({
                                "downloaded_mb": round(size / 1e6, 2),
                                "total_mb": round(total_bytes / 1e6, 2),
                                "percent": round(min((size / total_bytes) * 100, 99.0), 1),
                                "speed_mbps": round((size / 1e6) / elapsed, 2),
                            })
                    except Exception:
                        pass
                    time.sleep(1)

            poll_thread = threading.Thread(target=poll_progress, daemon=True)
            poll_thread.start()

            # This is the actual blocking download
            cached_path = hf_hub_download(
                repo_id=meta["hf_repo"],
                filename=meta["hf_file"],
                token=HF_TOKEN,
                local_dir=str(MODELS_DIR),
            )

            poll_stop.set()
            poll_thread.join(timeout=2)

            # hf_hub_download with local_dir places the file directly there
            # Rename to our canonical filename if needed
            downloaded_path = Path(cached_path)
            if downloaded_path != dest:
                shutil.move(str(downloaded_path), str(dest))

            self._download_state.update({
                "status": "done",
                "percent": 100.0,
                "downloaded_mb": round(dest.stat().st_size / 1e6, 2),
            })

        except Exception as e:
            self._download_state["status"] = "error"
            self._download_state["error"] = str(e)

    def get_download_progress(self) -> dict:
        return dict(self._download_state)

    def cancel_download(self):
        """
        Marks state as cancelled.
        hf_hub_download handles its own resume — incomplete files stay in
        HF cache and will be resumed on next call automatically.
        """
        if self._download_state["status"] == "downloading":
            self._download_state["status"] = "cancelled"

    # ── Load / Unload ──────────────────────────

    def load_model(self, model_id: str = DEFAULT_MODEL) -> dict:
        if not self.is_model_downloaded(model_id):
            return {"error": "Model not downloaded yet."}

        if self._loaded_model_id == model_id:
            return {"status": "already_loaded"}

        # Unload previous model to free RAM
        self.unload_model()

        model_path = str(self.get_model_path(model_id))
        try:
            self._llm = Llama(
                model_path=model_path,
                n_ctx=2048,          # context window
                n_threads=4,         # CPU threads
                n_gpu_layers=0,      # 0 = CPU only (safe default)
                verbose=False,
            )
            self._loaded_model_id = model_id
            return {"status": "loaded", "model_id": model_id}
        except Exception as e:
            self._llm = None
            return {"error": str(e)}

    def unload_model(self):
        if self._llm is not None:
            del self._llm
            self._llm = None
            self._loaded_model_id = None

    def get_llm(self) -> Optional[Llama]:
        return self._llm

    def get_status(self) -> dict:
        return {
            "model_downloaded": self.is_model_downloaded(),
            "model_loaded": self.is_model_loaded(),
            "loaded_model_id": self._loaded_model_id,
            "download": self.get_download_progress(),
        }


# ──────────────────────────────────────────────
# CHAT ENGINE
# ──────────────────────────────────────────────

class ChatEngine:
    """
    Wraps llama-cpp-python to produce streaming chat completions
    formatted for Gemma's instruction template.
    """

    SYSTEM_PROMPT = (
        "You are a helpful, harmless, and honest AI assistant. "
        "Answer clearly and concisely."
    )

    def __init__(self, model_manager: ModelManager):
        self._manager = model_manager

    def _build_prompt(self, messages: list[dict]) -> str:
        """
        Converts chat history into Gemma-IT format:
        <start_of_turn>user\n{msg}<end_of_turn>\n<start_of_turn>model\n
        """
        prompt = f"<start_of_turn>system\n{self.SYSTEM_PROMPT}<end_of_turn>\n"
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "").strip()
            if role == "user":
                prompt += f"<start_of_turn>user\n{content}<end_of_turn>\n<start_of_turn>model\n"
            elif role == "assistant":
                prompt += f"{content}<end_of_turn>\n"
        return prompt

    def stream_response(
        self,
        messages: list[dict],
        max_tokens: int = 512,
        temperature: float = 0.7,
        top_p: float = 0.9,
    ) -> Generator[str, None, None]:
        """
        Yields text tokens one-by-one as a generator.
        Raises RuntimeError if model is not loaded.
        """
        llm = self._manager.get_llm()
        if llm is None:
            raise RuntimeError("Model is not loaded. Load the model first.")

        prompt = self._build_prompt(messages)

        stream = llm(
            prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=top_p,
            stream=True,
            stop=["<end_of_turn>", "<start_of_turn>"],
        )

        for chunk in stream:
            token = chunk["choices"][0]["text"]
            if token:
                yield token

    def get_response(
        self,
        messages: list[dict],
        max_tokens: int = 512,
        temperature: float = 0.7,
    ) -> str:
        """
        Non-streaming version — returns full response string.
        """
        return "".join(self.stream_response(messages, max_tokens, temperature))