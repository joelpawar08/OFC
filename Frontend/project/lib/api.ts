const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://ofc-k1ia.onrender.com';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error((json as { detail?: string }).detail ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export interface StatusResponse {
  model_downloaded: boolean;
  model_loaded: boolean;
  loaded_model_id: string | null;
  download: DownloadProgress;
}

export interface DownloadProgress {
  status: 'idle' | 'downloading' | 'done' | 'error' | 'cancelled';
  model_id: string | null;
  percent: number;
  downloaded_mb: number;
  total_mb: number;
  speed_mbps: number;
  error: string | null;
}

export interface ModelInfo {
  id: string;
  name: string;
  description: string;
  size_mb: number;
  ram_required_gb: number;
  downloaded: boolean;
  loaded: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export const api = {
  health: () => get<{ ok: boolean }>('/health'),

  status: () => get<StatusResponse>('/status'),

  listModels: () => get<{ models: ModelInfo[] }>('/models'),

  startDownload: (model_id = 'gemma-2b') =>
    post<{ status: string; model_id?: string }>('/download/start', { model_id }),

  downloadProgress: () => get<DownloadProgress>('/download/progress'),

  cancelDownload: () => post<{ status: string }>('/download/cancel'),

  loadModel: (model_id = 'gemma-2b') =>
    post<{ status: string }>('/model/load', { model_id }),

  unloadModel: () => post<{ status: string }>('/model/unload'),

  // URL to fetch the raw model file (served by backend when downloaded)
  modelFileUrl: (model_id = 'gemma-2b') => `${BASE_URL}/models/${model_id}/file`,

  chat: (messages: ChatMessage[], max_tokens = 512, temperature = 0.7) =>
    post<{ reply: string }>('/chat', { messages, max_tokens, temperature }),

  /**
   * Stream chat via SSE. Calls onToken for each token, onDone when complete.
   */
  chatStream: async (
    messages: ChatMessage[],
    onToken: (token: string) => void,
    onDone: () => void,
    onError: (err: string) => void,
    signal?: AbortSignal,
  ) => {
    try {
      const res = await fetch(`${BASE_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ messages, max_tokens: 512, temperature: 0.7, top_p: 0.9 }),
        signal,
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        onError((json as { detail?: string }).detail ?? `HTTP ${res.status}`);
        return;
      }

      const reader = (res.body as any)?.getReader?.();
      if (!reader) {
        // Fallback for environments (Expo/React Native) that don't expose
        // a ReadableStream on fetch responses. Read entire body as text and
        // parse SSE-style "data: ..." lines.
        const full = await res.text().catch(() => '');
        if (!full) {
          onError('No response body');
          return;
        }

        const lines = full.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            onDone();
            return;
          }
          try {
            const parsed = JSON.parse(data) as { token?: string; error?: string };
            if (parsed.error) {
              onError(parsed.error);
              return;
            }
            if (parsed.token) onToken(parsed.token);
          } catch {
            // ignore malformed lines
          }
        }
        onDone();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            onDone();
            return;
          }
          try {
            const parsed = JSON.parse(data) as { token?: string; error?: string };
            if (parsed.error) {
              onError(parsed.error);
              return;
            }
            if (parsed.token) {
              onToken(parsed.token);
            }
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
      onDone();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      onError(err instanceof Error ? err.message : 'Unknown error');
    }
  },
};
