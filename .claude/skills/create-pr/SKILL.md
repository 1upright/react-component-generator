---
name: create-pr
description: 현재 브랜치에서 PR을 생성합니다. 한국어/영문 템플릿 자동 선택 지원.
context: fork
---

# 역할

현재 브랜치의 커밋을 분석하여 GitHub PR을 생성합니다.
프로젝트에 따라 한국어 또는 영문 템플릿을 자동으로 선택합니다.

# 실행 절차

## 1. 프로젝트 정보 확인

`package.json`의 `name` 필드를 읽어 프로젝트를 식별합니다.

## 2. 언어 템플릿 선택

- `react-component-generator` → 한국어 (`template-ko.md` 사용)
- 기타 모든 프로젝트 → 영문 (`template-en.md` 사용)

## 3. 브랜치 상태 확인

```bash
git status
git branch -v
git log origin/main..HEAD --oneline  # 또는 origin/master
```

확인 사항:
- 현재 브랜치가 main/master와 다른지 확인
- 푸시되지 않은 커밋이 있는지 확인
- 기존 PR이 있는지 확인 (`gh pr list`)

## 4. PR 제목과 설명 작성

- **제목**: 커밋 메시지들을 분석하여 의도를 파악하고 명확한 한/영 제목 작성
- **설명**: 선택한 템플릿(`template-ko.md` 또는 `template-en.md`)을 기반으로 작성
  - 변경사항 요약
  - 테스트 계획
  - 체크리스트

## 5. PR 생성

```bash
gh pr create --title "제목" --body "설명 내용"
```

# 주의사항

- 푸시되지 않은 커밋이 있으면 사용자에게 먼저 push 확인
- 기존 PR이 있으면 중복 생성 방지
- 템플릿 파일은 `.claude/skills/create-pr/references/`에서 로드
