# 결정 축 설계 (Decision Ledger)

작성: 2026-09-21
상태: 초안 (검토 대기)
범위: Obst Terminal 콘솔의 공통 기능. 프로바이더별 기능이 아니다.
배경: `Tip & Tech/Jev - TypeSafe System One 의사결정 모델.md` 검토 결과.

## 1. 목적

프로젝트를 관리하면서 반복되는 문제 두 가지를 플러그인이 직접 다룬다.

- AI와 대화하다 내린 결정이 문서에 남지 않는다.
- 남아 있어도 오래된 결정이 최신 결정처럼 보이고, AI가 그것을 근거로 답한다.

해결의 핵심은 플러그인이 **"결정"이라는 개념을 아는 것**이다. 결정은 볼트의
노트로 존재하고, 플러그인은 답변에서 결정을 꺼내고, 답변이 기존 결정과
충돌하는지 보고, 결정끼리의 대체 관계를 유지한다.

Jev 같은 판단 모델은 이 세 가지 판단을 매 턴 싸게 해 주는 부품이다. 부품이
없어도 축 자체는 동작해야 한다.

## 2. 결정 사항

- 결정의 진실 원천은 **볼트의 마크다운 노트**다. 플러그인 DB가 아니다.
  플러그인은 노트를 읽어 만든 인덱스만 캐시한다.
- 판단은 `Judge` 인터페이스 하나로 추상화하고 백엔드를 교체할 수 있게 한다.
  Jev, Claude print 모드, 없음(규칙만) 세 가지. 외부 호출은 이 한 곳에서만 일어난다.
- **자동 저장은 없다.** 모델은 제안만 하고, 노트를 만들거나 프론트매터를 바꾸는
  일은 항상 사용자의 클릭 뒤에 일어난다.
- 판단 모델은 문장을 생성하지 않는다. 결정 한 줄은 사용자가 쓰거나, 사용자가
  요청할 때만 생성형 모델이 print 턴으로 요약한다.
- 날짜 비교, 임계값, 후보 선별은 코드가 한다. 모델에는 의미 판단만 맡긴다.
- 히스토리와 같은 원칙: 프로바이더는 항목의 속성일 뿐이다.

## 3. 결정 노트 모델

폴더는 설정값 `decisionFolder`. 기본값 `결정`. 파일명은 `YYYY-MM-DD 결정 한 줄.md`.

```yaml
---
type: decision
title: PTY 호스트를 별도 프로세스로 유지
date: 2026-09-21 14:30
status: active            # active | superseded | revoked
context: 개인프로젝트/obst-terminal   # 볼트 폴더 경로. 후보 선별 키
supersedes: "[[2026-08-02 PTY를 렌더러에 내장]]"     # 선택
superseded_by:            # 대체될 때 채워진다
source: claude:8f2c...    # provider:sessionId. 출처 세션
---

## 결정

(한 줄)

## 이유

## 버린 대안

## 근거

- 세션 답변 발췌
- [[볼트 경로]]
```

`status`와 `superseded_by`만 플러그인이 갱신한다. 본문은 건드리지 않는다.
기존 볼트에는 `type: product-plan` 같은 `type` 관례가 이미 있어 `type: decision`이
자연스럽다.

## 4. 판단 인터페이스

```ts
type JudgeQuestion =
  | { id: string; kind: "noul"; text: string }
  | { id: string; kind: "choice"; text: string; options: readonly string[] }
  | { id: string; kind: "score"; text: string; levels: readonly string[] };

interface JudgeAnswers {
  readonly [id: string]:
    | { kind: "noul"; probability: number }
    | { kind: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
    | { kind: "score"; score: number; confidence: number };
}

interface Judge {
  readonly name: "jev" | "claude-print" | "none";
  ask(state: string | readonly string[], questions: readonly JudgeQuestion[]): Promise<JudgeAnswers>;
}
```

백엔드:

| 이름 | 구현 | 쓰는 상황 |
|---|---|---|
| `jev` | `requestUrl` → `POST https://api.typesafe.ai/v1/systemone`. 키는 설정 또는 `TYPESAFE_API_KEY` | 개인 볼트. 한국어 파일럿 통과 후 |
| `claude-print` | 기존 print 턴 재사용. JSON 스키마를 요구하고 파싱 실패 시 `none`으로 강등 | 회사 PC. 느리지만 새 키가 없다 |
| `none` | 모든 질문에 "모름"을 돌려준다. 규칙 기반 기능만 동작 | 외부 전송 불가, 또는 기본값 |

임계값은 `src/judge/policy.ts` 한 곳에 둔다. 기본값은 보수적으로 잡고, 파일럿
결과로 조정한다. 확신이 낮은 건은 아무 표시도 하지 않는다. 잘못된 경고가
경고 무시 습관을 만드는 것이 가장 큰 위험이다.

## 5. 세 기능의 흐름

### 5.1 결정 추출 (답변 뒤)

1. 턴이 끝나면(`finishCodexTurn`, Claude는 다음 턴 시작 시) 질문과 답변을 상태로 묶는다. 답변은 앞뒤 8,000자로 자른다.
2. 질문 세 개를 한 번에 보낸다.
   - `has_decision` (noul): 이 대화에서 사용자가 무언가를 확정했는가
   - `kind` (choice): 기술 선택 / 범위 / 일정 / 담당 / 정책 / 기타
   - `finality` (score): 검토 중 → 잠정 → 확정
3. `has_decision`이 임계값을 넘으면 답변 아래에 칩 **"결정으로 저장"**을 붙인다.
4. 클릭하면 모달이 뜬다. 결정 한 줄은 비어 있고 사용자가 쓴다. 이유·근거 칸에는
   질문과 답변 발췌가 미리 들어간다. "AI로 요약" 버튼은 print 턴을 한 번 돌려
   한 줄을 채운다.
5. 저장하면 3절 형식의 노트가 생긴다. `context`는 현재 활성 노트의 폴더 또는
   세션 cwd에서 추정하고 모달에서 바꿀 수 있다.

`none` 백엔드에서는 칩이 자동으로 뜨지 않는다. 대신 답변 메뉴에 같은 항목이
항상 있어 수동으로 저장할 수 있다.

### 5.2 충돌 감지 (답변 뒤)

1. 결정 인덱스에서 `status: active`이고 `context`가 현재 세션과 같은 노트를
   최근순으로 최대 30개 뽑는다. 이 선별은 코드가 한다.
2. 상태 = 답변, 질문 = 후보마다 `contradicts_<n>` (noul): "답변이 다음 결정과
   양립하지 않는가: (결정 한 줄 + 이유)". 요청 하나에 병렬로 묻는다.
3. 임계값을 넘는 후보가 있으면 답변 위에 배지 **"볼트 결정과 충돌: [[노트]]"**.
4. 배지의 행동 두 가지. **결정 갱신**은 5.1의 모달을 열되 `supersedes`를 미리
   채운다. **무시**는 이 세션에서 그 쌍을 다시 묻지 않는다.

### 5.3 대체 관계 유지 (배경)

1. 결정 인덱스는 `decisionFolder`의 노트를 mtime 기준으로 증분 파싱한다.
   프론트매터만 읽는다.
2. 같은 `context` 안에서 `active` 노트 쌍을 만든다. 날짜가 앞선 쪽만 대체 후보가
   될 수 있다. 이 규칙은 코드다.
3. 새 노트나 갱신된 노트에 대해서만 `supersedes` (noul)를 묻는다. 전체 쌍을 매번
   묻지 않는다.
4. 임계값을 넘으면 결정 패널의 **"검토 대기"** 목록에 쌓인다. 사용자가 항목을
   승인하면 옛 노트의 `status: superseded`, `superseded_by`를 쓰고 새 노트의
   `supersedes`를 채운다. 거절하면 그 쌍은 기억해 두고 다시 묻지 않는다.

## 6. 패널

히스토리와 같은 자리, 같은 패턴(콘솔 안 패널, `div` 행, 칩 필터, 검색).
탭바 아이콘 하나가 추가된다.

- 행: 결정 한 줄 / `context` · 날짜 · 상태 배지
- 칩: 전체 / active / superseded / 검토 대기
- 클릭: 노트를 연다. 상태 변경은 노트에서 직접 하거나 검토 대기 항목에서 한다.

답변 단위 UI는 두 가지뿐이다. 5.1의 칩과 5.2의 배지.

## 7. 하지 않는 것

- 사용자 클릭 없는 노트 생성과 프론트매터 변경
- 판단 모델에게 문장 생성 요구
- 결정 노트 본문 편집
- PTY 출력, 승인 요청, 히스토리 제목 같은 곳에 판단 모델 적용
- `none` 백엔드에서 외부 호출
- 세션 상태 미러링 코드 변경

## 8. 단계

| 단계 | 내용 | 판단 모델 |
|---|---|---|
| 0 | 파일럿 스크립트. 볼트 노트 100개로 `has_decision`, `kind` 정확도와 확률 보정을 측정 | Jev, Claude print 둘 다 |
| 1 | 결정 노트 모델, 인덱스, 패널, 답변 메뉴의 수동 저장 | 없음 |
| 2 | 5.1 칩, 5.2 배지 | `Judge` + 백엔드 셋 |
| 3 | 5.3 배경 대체 판정, 검토 대기, 기존 노트 32건 백필 | `Judge` |

1단계는 판단 모델 없이도 가치가 있다. 결정이 한 폴더에 한 형식으로 쌓이기
시작하는 것 자체가 목적의 절반이다. 0단계 결과가 나쁘면 2단계 이후를 늦추고
1단계만으로 쓴다.

## 9. 검증

- 단위: 프론트매터 파싱·직렬화, 대체 후보 날짜 규칙, 임계값 정책, Jev 응답
  파싱(픽스처), Claude print 응답 파싱과 강등, `none` 백엔드
- 통합: 세 흐름을 `none`과 가짜 `Judge`로 각각 한 번씩
- 수동: 개인 볼트에서 5.1 → 5.2 → 5.3 한 바퀴

## 10. 파일

```
src/judge/types.ts        인터페이스
src/judge/policy.ts       임계값
src/judge/jev.ts          Jev 백엔드
src/judge/claude-print.ts Claude print 백엔드
src/judge/none.ts
src/decision/types.ts     노트 모델
src/decision/frontmatter.ts
src/decision/index.ts     증분 인덱스
src/decision/extract.ts   5.1 질문 구성
src/decision/conflict.ts  5.2 후보 선별과 질문 구성
src/decision/supersede.ts 5.3 쌍 생성과 날짜 규칙
src/main.ts               턴 종료 훅, 패널 마운트, 모달. 200줄 이내
test/judge/*.test.mts
test/decision/*.test.mts
```

## 11. 열린 질문

1. 결정 노트 폴더. 단일 `결정/` 폴더에 `context`로 구분할지, 프로젝트 폴더마다
   `결정/` 하위 폴더를 둘지. 초안은 단일 폴더다.
2. 회사 PC에서 판단 백엔드로 `claude-print`를 써도 되는지. 답변 본문이 이미
   Claude를 거치므로 추가 반출은 없지만, 턴마다 print 호출이 하나 늘어난다.
3. 0단계 결과에 따른 Jev 채택 여부와 임계값.
4. 결정 한 줄을 사용자가 매번 쓰는 것이 부담이면 "AI로 요약"을 기본으로 켤지.
