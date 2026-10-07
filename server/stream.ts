// LLM 스트리밍(SSE) 응답을 파싱하는 순수 함수들.
// 부수효과(Bun.serve, 네트워크 호출 등)가 없어 단위 테스트가 가능하다.

/** 버퍼에서 완성된 SSE 이벤트(빈 줄로 구분)의 data 페이로드를 꺼내고, 미완성 나머지를 돌려준다. */
export function splitSSE(buffer: string): { events: string[]; rest: string } {
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? '';
  const events = parts
    .map((part) =>
      part
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n'),
    )
    .filter(Boolean);
  return { events, rest };
}

/** fetch 응답 body(SSE)를 읽어 data 페이로드 문자열을 순서대로 내보낸다. */
export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = splitSSE(buffer);
    buffer = rest;
    yield* events;
  }

  // 마지막 이벤트 뒤에 빈 줄이 없는 경우를 대비해 남은 버퍼도 처리한다.
  yield* splitSSE(`${buffer + decoder.decode()}\n\n`).events;
}

/** Anthropic 스트림 이벤트에서 텍스트 조각을 추출한다. 텍스트가 없는 이벤트는 빈 문자열. */
export function extractAnthropicDelta(event: unknown): string {
  const e = event as {
    type?: string;
    delta?: { type?: string; text?: string };
    error?: { message?: string };
  };

  if (e.type === 'error') {
    throw new Error(e.error?.message ?? 'Claude API error');
  }
  if (e.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
    return e.delta.text ?? '';
  }
  return '';
}

/** Gemini 스트림 청크에서 텍스트 조각을 추출한다. 출력 한도로 잘렸다면 에러를 던진다. */
export function extractGeminiDelta(event: unknown): string {
  const candidate = (
    event as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    }
  ).candidates?.[0];

  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error('생성된 코드가 너무 길어 잘렸습니다. 더 간단한 컴포넌트를 요청해주세요.');
  }

  return candidate?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
}
