import { describe, it, expect } from 'vitest';
import { splitSSE, readSSE, extractAnthropicDelta, extractGeminiDelta } from './stream';

describe('splitSSE', () => {
  it('완성된 이벤트의 data만 추출하고 미완성 나머지는 rest로 돌려준다', () => {
    const { events, rest } = splitSSE('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"');
    expect(events).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('data: {"c"');
  });

  it('event: 줄과 CRLF 구분자를 처리한다', () => {
    const { events, rest } = splitSSE('event: content_block_delta\r\ndata: {"x":1}\r\n\r\n');
    expect(events).toEqual(['{"x":1}']);
    expect(rest).toBe('');
  });
});

describe('readSSE', () => {
  it('청크 경계가 이벤트 중간에 걸려도 이벤트를 복원한다', async () => {
    const encoder = new TextEncoder();
    const chunks = ['data: {"a"', ':1}\n\ndata: {"b":2}\n\n', 'data: {"c":3}'];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });

    const received: string[] = [];
    for await (const data of readSSE(body)) received.push(data);

    expect(received).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });
});

describe('extractAnthropicDelta', () => {
  it('text_delta 이벤트에서 텍스트를 추출한다', () => {
    const event = { type: 'content_block_delta', delta: { type: 'text_delta', text: 'const A' } };
    expect(extractAnthropicDelta(event)).toBe('const A');
  });

  it('텍스트가 없는 이벤트는 빈 문자열을 반환한다', () => {
    expect(extractAnthropicDelta({ type: 'message_start' })).toBe('');
    expect(extractAnthropicDelta({ type: 'ping' })).toBe('');
  });

  it('error 이벤트는 에러를 던진다', () => {
    const event = { type: 'error', error: { message: 'Overloaded' } };
    expect(() => extractAnthropicDelta(event)).toThrow('Overloaded');
  });
});

describe('extractGeminiDelta', () => {
  it('parts의 텍스트를 이어 붙인다', () => {
    const event = { candidates: [{ content: { parts: [{ text: 'const ' }, { text: 'A' }] } }] };
    expect(extractGeminiDelta(event)).toBe('const A');
  });

  it('candidates가 없으면 빈 문자열을 반환한다', () => {
    expect(extractGeminiDelta({})).toBe('');
  });

  it('MAX_TOKENS로 끝나면 에러를 던진다', () => {
    const event = { candidates: [{ finishReason: 'MAX_TOKENS' }] };
    expect(() => extractGeminiDelta(event)).toThrow('너무 길어');
  });
});
