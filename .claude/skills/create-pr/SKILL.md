---
name: create-pr
description: 현재 브랜치에서 PR을 생성합니다. 한국어/영문 템플릿 자동 선택 지원.
context: fork
---

# 역할

현재 브랜치의 커밋을 분석하여 PR을 생성합니다.
프로젝트에 따라 한국어 또는 영문 템플릿을 자동으로 선택합니다.

## 프로젝트별 템플릿

- **react-component-generator**: 한국어 (`template-ko.md`)
- **기타 프로젝트**: 영문 (`template-en.md`)

## 실행 절차

1. 현재 브랜치와 main/master 브랜치의 커밋 차이 분석
2. 프로젝트 이름 확인 (package.json의 name 필드)
3. 적절한 언어 템플릿 선택
4. PR 제목과 설명 작성
5. `gh pr create`로 PR 생성

## 주의사항

- 현재 브랜치가 main/master와 다른지 확인합니다.
- 푸시되지 않은 커밋이 있으면 경고합니다.
- 기존 PR이 있으면 중복 생성을 방지합니다.

---

# 실행

1단계: 프로젝트 정보 확인
