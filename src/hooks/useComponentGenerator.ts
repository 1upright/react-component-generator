import { useState, useCallback, useEffect } from 'react';
import type { GeneratedComponent, Provider } from '../types';

// /api/generate/stream 이 내보내는 NDJSON 이벤트
type StreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; code: string }
  | { type: 'error'; error: string };

interface UseComponentGeneratorReturn {
  components: GeneratedComponent[];
  /** 코드가 스트리밍 중인 컴포넌트 id (없으면 null). 해당 컴포넌트는 components 맨 앞에 포함된다. */
  streamingId: string | null;
  isLoading: boolean;
  error: string | null;
  promptHistory: string[];
  generate: (prompt: string, apiKey: string | undefined, provider: Provider) => Promise<void>;
  removeComponent: (id: string) => void;
  clearAll: () => void;
}

const STORAGE_KEY = 'rcg_components';
const HISTORY_KEY = 'rcg_prompt_history';

async function* readNdjson<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line) as T;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) yield JSON.parse(buffer) as T;
}

export function useComponentGenerator(): UseComponentGeneratorReturn {
  const [components, setComponents] = useState<GeneratedComponent[]>([]);
  const [streaming, setStreaming] = useState<GeneratedComponent | null>(null);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const components = parsed.map((c: any) => ({
          ...c,
          createdAt: new Date(c.createdAt),
        }));
        setComponents(components);
      }
    } catch (err) {
      console.error('Failed to load components from localStorage:', err);
    }

    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) {
        setPromptHistory(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Failed to load prompt history from localStorage:', err);
    }
  }, []);

  const generate = useCallback(async (prompt: string, apiKey: string | undefined, provider: Provider) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const createdAt = new Date();

    setIsLoading(true);
    setError(null);
    setStreaming({ id, prompt, code: '', createdAt });

    try {
      const res = await fetch('/api/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, ...(apiKey && { apiKey }), provider }),
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to generate component');
      }

      let finalCode: string | null = null;
      let streamed = '';

      for await (const event of readNdjson<StreamEvent>(res.body)) {
        if (event.type === 'delta') {
          streamed += event.text;
          setStreaming({ id, prompt, code: streamed, createdAt });
        } else if (event.type === 'done') {
          finalCode = event.code;
        } else {
          throw new Error(event.error);
        }
      }

      if (finalCode === null) {
        throw new Error('응답이 중간에 끊겼습니다. 다시 시도해주세요.');
      }

      const newComponent: GeneratedComponent = { id, prompt, code: finalCode, createdAt };

      setComponents((prev) => {
        const updated = [newComponent, ...prev];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        return updated;
      });

      setPromptHistory((prev) => {
        const updated = [prompt, ...prev.filter((p) => p !== prompt)].slice(0, 20);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
        return updated;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      // 완료된 컴포넌트가 같은 id로 목록에 들어가므로 카드가 유지된 채 스트리밍 상태만 해제된다.
      setStreaming(null);
      setIsLoading(false);
    }
  }, []);

  const removeComponent = useCallback((id: string) => {
    setComponents((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const clearAll = useCallback(() => {
    setComponents([]);
    setPromptHistory([]);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(HISTORY_KEY);
  }, []);

  return {
    components: streaming ? [streaming, ...components] : components,
    streamingId: streaming?.id ?? null,
    promptHistory,
    isLoading,
    error,
    generate,
    removeComponent,
    clearAll,
  };
}
