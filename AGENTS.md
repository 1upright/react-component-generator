# AGENTS.md

## Operational Commands

```bash
bun install              # 의존성 설치
bun run dev             # API 서버(3002) + Vite(5173) 동시 실행
bun run build           # TypeScript 컴파일 및 Vite 빌드
bun run lint            # ESLint 검사
bun test                # Vitest 전체 실행
bun test:watch          # Vitest 감시 모드
bun run server          # API 서버만 실행 (개발용 watch 모드)
```

프로젝트는 **Bun 기반**입니다. npm/yarn/pnpm을 사용하지 마십시오.

## Golden Rules

### Do's
1. **server 모듈의 순수성 유지**: `server/generator.ts`, `server/fallback.ts`는 부수효과가 없는 순수 함수로 유지하고, 모든 변경은 대응하는 테스트(.test.ts)와 함께 커밋합니다. (generator.ts:1-3, generator.test.ts 참고)
2. **React-live 코드 정규화**: `ensureRenderCall`로 자동 주입된 `render()` 호출을 반드시 포함시키고, 코드 생성 단계에서 stripCodeFences → ensureRenderCall 순서대로 처리합니다. (generator.ts:5-24, index.ts:188)
3. **API 키는 Boolean으로만 노출**: 서버가 `/api/config`에서 환경변수 키 존재 여부를 Boolean으로만 반환하고, 실제 키 값은 서버 메모리에 유지합니다. (index.ts:147-157)
4. **에러 상태 코드 매핑**: 503/429 같은 API 에러는 사용자 친화적 한국어 메시지로 변환하여 반환합니다. (index.ts:194-206)

### Don'ts
1. **Client-side에 API 키 노출 금지**: env.json이나 config.ts에 실제 API 키를 절대 포함시키지 마십시오. 클라이언트는 선택적으로 입력하거나 서버 환경변수를 사용합니다. (index.ts:64-66)
2. **react-live 코드에 TypeScript 문법 사용 금지**: type 주석, interface, as 타입 캐스트를 생성된 코드에 포함시키지 마십시오. 순수 JavaScript만 사용합니다. (index.ts:20)
3. **CSS 모듈이나 import 문법 사용 금지**: 생성된 컴포넌트는 inline styles만 사용합니다. 외부 CSS import는 react-live에서 작동하지 않습니다. (index.ts:10-11)

## Project Context

AI 기반 React 컴포넌트 생성기. 사용자의 텍스트 프롬프트로 즉시 작동하는 React 컴포넌트를 생성하고, react-live를 이용해 실시간 미리보기를 제공합니다.

**Tech Stack**
- Frontend: React 19, TypeScript, Vite
- Backend: Bun (API 프록시 서버)
- AI Providers: Anthropic Claude, Google Gemini (다중 모델 폴백 지원)
- Preview Engine: react-live (noInline 모드)
- Testing: Vitest, @testing-library

## Standards & References

**Naming Convention**
- 컴포넌트: PascalCase (예: `PromptInput`, `ComponentCard`)
- 훅: camelCase with `use` prefix (예: `useComponentGenerator`)
- 파일: 폴더 구조는 `src/components`, `src/hooks`, `server` 분리

**Git Commit Format**
```
<type>: <description>
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
```

**Maintenance Policy**
규칙과 코드 간의 괴리가 발생하면 즉시 이 문서 업데이트를 제안하십시오.
