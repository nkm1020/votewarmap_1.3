# VoteWarMap Project Instructions

## Northstar First

모든 기능/디자인/카피 판단은 아래 스킬을 먼저 적용한다.

- `/Users/kangmin/.codex/skills/votewarmap-northstar/SKILL.md`

핵심 문장:

- **밸런스게임을 전국 지도에 투영해 `우리 지역 vs 전국`의 생각 차이를 비교한다.**

## Mandatory Use Cases

아래 작업에서는 반드시 노스스타 스킬 기준으로 판단한다.

- 홈/결과/지도 UI/UX 변경
- 결과 페이지 정보 구조 변경
- 참여/공유 전환 동선 변경
- 문구(카피) 변경

## Decision Rule

결정이 애매하면 아래 우선순위를 따른다.

1. `우리 vs 전국` 비교 명확성
2. 모바일 가시성/조작성
3. 공유 유도력
4. 구현 편의성

## Drift Guard

다음 신호가 보이면 방향 이탈로 간주하고 설계를 재검토한다.

- 내 선택 강조가 지역/전국 비교보다 앞에 나옴
- 결과 화면에서 지도 맥락이 약해짐
- 핵심 4지표(내 지역 일치도, 전국 일치도, 우세 강도 차이, 지역↔전국 흐름)가 후순위로 밀림

