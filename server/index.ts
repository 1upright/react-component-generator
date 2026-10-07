import { stripCodeFences, ensureRenderCall } from './generator';
import { withModelFallback } from './fallback';
import { readSSE, extractAnthropicDelta, extractGeminiDelta } from './stream';

// 우선순위 순서. 앞 모델이 실패하면 다음 모델로 폴백한다.
const GOOGLE_MODELS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash'];

const SYSTEM_PROMPT = `You are a React component generator. Generate a single React component based on the user's description.

Rules:
- Use inline styles only (no CSS imports, no CSS modules)
- Do NOT use import statements — React is already available in scope as a global
- Define the component as a function, then call render(<ComponentName />) at the end
- Make the component visually appealing with proper styling
- Use React hooks if needed (e.g., React.useState, React.useEffect)
- The component must be completely self-contained
- Respond with ONLY the code block — no explanations, no markdown fences
- Use descriptive variable names and clean formatting
- For colors, prefer modern palettes (gradients, shadows, etc.)
- Ensure the component is interactive where appropriate (hover states, click handlers, etc.)
- Do NOT use TypeScript syntax — no type annotations, no interfaces, no generics, no "as" casts. Write plain JavaScript only.

Example output format:
const GradientButton = () => {
  const [hovered, setHovered] = React.useState(false);

  return (
    <button
      style={{
        background: hovered
          ? 'linear-gradient(135deg, #667eea, #764ba2)'
          : 'linear-gradient(135deg, #764ba2, #667eea)',
        color: 'white',
        border: 'none',
        padding: '12px 24px',
        borderRadius: '8px',
        fontSize: '16px',
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        transform: hovered ? 'scale(1.05)' : 'scale(1)',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      Click me
    </button>
  );
};

render(<GradientButton />);`;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

type Provider = 'anthropic' | 'google';

const ENV_KEYS: Record<Provider, string | undefined> = {
  anthropic: process.env.ANTHROPIC_API_KEY,
  google: process.env.GOOGLE_API_KEY,
};

function resolveApiKey(provider: Provider, clientKey?: string): string | null {
  return clientKey || ENV_KEYS[provider] || null;
}

async function callAnthropic(prompt: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };

  return data.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

async function callGoogleModel(prompt: string, apiKey: string, model: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8192 },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    candidates: Array<{
      content: { parts: Array<{ text?: string }> };
      finishReason?: string;
    }>;
  };

  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error('생성된 코드가 너무 길어 잘렸습니다. 더 간단한 컴포넌트를 요청해주세요.');
  }

  return (
    candidate?.content?.parts
      ?.map((part) => part.text)
      ?.join('') ?? ''
  );
}

async function callGoogle(prompt: string, apiKey: string): Promise<string> {
  return withModelFallback(GOOGLE_MODELS, (model) => callGoogleModel(prompt, apiKey, model));
}

// 스트리밍: 업스트림 응답 헤더(HTTP 상태)까지만 await하고, 본문은 텍스트 조각 단위로 내보낸다.
// 헤더 단계의 실패는 기존과 동일하게 던져지므로 Gemini 모델 폴백도 그대로 동작한다.
async function* streamAnthropic(prompt: string, apiKey: string, signal: AbortSignal): AsyncGenerator<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      stream: true,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  for await (const data of readSSE(response.body)) {
    const delta = extractAnthropicDelta(JSON.parse(data));
    if (delta) yield delta;
  }
}

async function openGoogleStream(prompt: string, apiKey: string, model: string, signal: AbortSignal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 8192 },
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Gemini API error: ${response.status}`);
  }
  return response.body;
}

async function* streamGoogle(prompt: string, apiKey: string, signal: AbortSignal): AsyncGenerator<string> {
  const body = await withModelFallback(GOOGLE_MODELS, (model) =>
    openGoogleStream(prompt, apiKey, model, signal),
  );

  for await (const data of readSSE(body)) {
    const delta = extractGeminiDelta(JSON.parse(data));
    if (delta) yield delta;
  }
}

/** API 에러를 사용자 친화적 한국어 메시지와 상태 코드로 변환한다. */
function toErrorPayload(err: unknown): { error: string; status: number } {
  const message = err instanceof Error ? err.message : 'Unknown error';

  if (message.includes('503')) {
    return { error: 'API 서버가 일시적으로 과부하 상태입니다. 잠시 후 다시 시도해주세요.', status: 503 };
  }
  if (message.includes('429')) {
    return { error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.', status: 429 };
  }
  return { error: message, status: 500 };
}

function errorResponse(err: unknown): Response {
  const { error, status } = toErrorPayload(err);
  return Response.json({ error }, { status, headers: CORS_HEADERS });
}

/** 요청 본문을 검증하고 사용할 API 키를 결정한다. 실패 시 바로 반환할 Response를 돌려준다. */
async function parseGenerateRequest(
  req: Request,
): Promise<{ prompt: string; apiKey: string; provider: Provider } | Response> {
  const { prompt, apiKey, provider = 'anthropic' } = (await req.json()) as {
    prompt: string;
    apiKey?: string;
    provider?: Provider;
  };

  const resolvedKey = resolveApiKey(provider, apiKey);

  if (!resolvedKey) {
    return Response.json(
      { error: `API key is required. Set ${provider === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'GOOGLE_API_KEY'} in .env or enter it manually.` },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  if (!prompt) {
    return Response.json(
      { error: 'Prompt is required' },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  return { prompt, apiKey: resolvedKey, provider };
}

const server = Bun.serve({
  port: 3002,
  async fetch(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return Response.json(
        {
          envKeys: {
            anthropic: !!ENV_KEYS.anthropic,
            google: !!ENV_KEYS.google,
          },
        },
        { headers: CORS_HEADERS }
      );
    }

    if (req.method === 'POST' && url.pathname === '/api/generate') {
      try {
        const parsed = await parseGenerateRequest(req);
        if (parsed instanceof Response) return parsed;

        const { prompt, apiKey, provider } = parsed;
        const text =
          provider === 'google'
            ? await callGoogle(prompt, apiKey)
            : await callAnthropic(prompt, apiKey);

        const code = ensureRenderCall(stripCodeFences(text));

        return Response.json({ code }, { headers: CORS_HEADERS });
      } catch (err) {
        return errorResponse(err);
      }
    }

    // NDJSON 스트림: {type:'delta',text} 반복 → {type:'done',code} 또는 {type:'error',error}
    if (req.method === 'POST' && url.pathname === '/api/generate/stream') {
      try {
        const parsed = await parseGenerateRequest(req);
        if (parsed instanceof Response) return parsed;

        const { prompt, apiKey, provider } = parsed;
        const deltas =
          provider === 'google'
            ? streamGoogle(prompt, apiKey, req.signal)
            : streamAnthropic(prompt, apiKey, req.signal);

        // 첫 조각을 미리 받아 두면 연결 단계 실패(503/429/키 오류)를 정상 HTTP 상태 코드로 돌려줄 수 있다.
        const first = await deltas.next();

        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (event: object) =>
              controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

            let text = '';
            try {
              let step = first;
              while (!step.done) {
                text += step.value;
                send({ type: 'delta', text: step.value });
                step = await deltas.next();
              }
              send({ type: 'done', code: ensureRenderCall(stripCodeFences(text)) });
            } catch (err) {
              send({ type: 'error', error: toErrorPayload(err).error });
            } finally {
              controller.close();
            }
          },
        });

        return new Response(body, {
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-cache',
          },
        });
      } catch (err) {
        return errorResponse(err);
      }
    }

    return Response.json(
      { error: 'Not found' },
      { status: 404, headers: CORS_HEADERS }
    );
  },
});

console.log(`API server running at http://localhost:${server.port}`);
