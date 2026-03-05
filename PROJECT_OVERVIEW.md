# VoteWarMap 1.3 프로젝트 설명

## 1. 프로젝트 한 줄 요약
`VoteWarMap`은 대한민국 행정구역(시도/시군구) 지도 위에서 실시간 투표 결과를 보여주고, 사용자 지역/학교 기준 비교와 게임형 참여를 제공하는 Next.js + Supabase 서비스입니다.

## 2. 핵심 기능
- 실시간 투표 지도: 전국/지역별 A/B 우세, 접전(TIE), 참여도 시각화
- 주제 투표: 밸런스형 2지선다 주제 선택 후 지역 기반 투표
- 결과 잠금/해제: 투표 전에는 요약만, 투표 후에는 상세 결과(전국/내 지역) 공개
- 비회원 투표 세션: `guest_session` 기반 임시 투표 저장 및 로그인 시 병합
- 학교/위치 기반 지역 판별: 학교 검색(NEIS + 로컬 DB) 또는 GPS 역지오코딩
- 결과 비교 페이지: 특정 주제에 대한 전국 vs 내 지역 결과 비교
- 게임: 지역 배틀(점수 저장/리더보드) + 멀티 포맷 게임 엔진 API
- 마이페이지: 프로필/프라이버시/활동 히스토리/레벨·배지/북극성 지표

## 3. 기술 스택
- 프론트엔드: `Next.js 16 (App Router)`, `React 19`, `TypeScript`
- 스타일/애니메이션: `Tailwind CSS v4`, `Framer Motion`
- 지도: `MapLibre GL` + GeoJSON(`public/data/*`)
- 백엔드: Next.js Route Handlers (`app/api/*`)
- 데이터베이스/인증: `Supabase (Postgres + Auth + RPC)`
- 차트/아이콘: `Chart.js`, `lucide-react`

## 4. 사용자 플로우
### 비로그인 사용자
1. `useGuestSessionHeartbeat`로 세션 유지 (`/api/votes/guest-session/heartbeat`)
2. 학교 선택 또는 GPS 기반 지역 판별
3. 투표는 `guest_votes_temp`에 저장
4. 로그인 시 `/api/votes/merge-guest`로 회원 투표 테이블로 승격

### 로그인 사용자
1. Google OAuth 로그인 (`/auth`)
2. 가입 완료 페이지(`/auth/complete-signup`)에서 닉네임/출생연도/성별 입력
3. 이후 투표/게임/마이페이지 지표가 `users`, `votes`, `game_*` 기준으로 집계

## 5. 주요 페이지 라우트
- `/` : 홈 지도 + 실시간 주제/스코어보드/지역 트렌드
- `/topics-map` : 주제 선택형 지도 투표
- `/results/[topicId]` : 주제별 결과 비교
- `/game` : 지역 배틀 게임
- `/my`, `/my/history`, `/my/edit` : 마이페이지(현재 동일 컴포넌트 진입)
- `/auth`, `/auth/complete-signup` : 인증/가입 완료

## 6. API 구성 (요약)
### 투표 도메인 (`/api/votes/*`)
- `GET /topics` : LIVE/ALL 주제 + 옵션
- `POST /` : 투표 저장(회원: `votes`, 비회원: `guest_votes_temp`)
- `GET /result-summary` : 결과 잠금/해제 포함 요약
- `GET /region-stats` : 주제/전체 지역 통계(시도/시군구)
- `GET /featured` : 홈 대표 주제
- `GET /scoreboard` : 주제 랭킹
- `GET /top-topics-by-region` : 지역별 인기 주제
- `GET /top-schools-by-region` : 지역별 대표 학교 마커
- `POST /guest-session/heartbeat` : 비회원 세션 heartbeat
- `POST /merge-guest` : 비회원 투표 병합
- `GET /home-analytics` : 성별/연령 집계

### 게임 도메인 (`/api/game/*`)
- `GET /formats` : 게임 포맷 목록
- `GET /facts` : 포맷 생성용 팩트 풀
- `POST /score` : 일반 게임 점수 저장
- `GET /leaderboard` : 일반 게임 리더보드
- `GET /region-battle-pool` : 지역 배틀 문제 풀
- `POST /region-battle-score` : 지역 배틀 점수 저장
- `GET /region-battle-leaderboard` : 지역 배틀 리더보드

### 계정/프로필 도메인
- `POST /api/auth/complete-signup` : 가입 완료 처리
- `GET /api/me/dashboard` : 마이 대시보드 지표/레벨/배지
- `GET /api/me/history` : 투표/게임 히스토리
- `PATCH /api/me/profile` : 닉네임/지역/학교/메인학교 슬롯 업데이트
- `PATCH /api/me/privacy` : 공개 설정 업데이트
- `GET /api/schools/search` : 학교 검색
- `POST /api/location/reverse-region` : 좌표 기반 지역 역탐색

## 7. 데이터베이스 핵심 모델 (Supabase)
### 주요 테이블
- `users`: 프로필, 지역, 프라이버시, 학교 슬롯 메타
- `schools`: 학교 마스터(NAIS + 로컬 XLS 통합)
- `vote_topics`, `vote_options`: 투표 주제/선택지
- `votes`: 회원 투표 본 테이블
- `guest_vote_sessions`, `guest_votes_temp`: 비회원 세션/임시 투표
- `game_mode_scores`, `region_battle_game_scores`: 게임 점수
- `user_school_pool`: 사용자 학교 슬롯 풀(중/고/대/대학원)

### 주요 RPC 함수
- `get_region_vote_stats`, `get_top_schools_by_region`
- `promote_guest_session_votes_to_user`
- `get_topic_live_scoreboard`, `get_live_vote_demographics`
- `get_game_leaderboard`, `get_region_battle_leaderboard`
- `get_game_user_rank`, `get_region_battle_user_rank`
- `get_my_vote_comparison_metrics_segments`
- `upsert_user_school_pool_slot`, `set_user_main_school_slot`

## 8. 환경 변수
### 필수
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_ORIGIN` (예: `https://votewarmap.com`)

### 선택/운영
- `GUEST_FINGERPRINT_SECRET` (게스트 세션/게스트 투표 fingerprint HMAC 전용 키, 미설정 시 `SUPABASE_SERVICE_ROLE_KEY`를 fallback으로 사용)
- `KAKAO_REST_API_KEY` (역지오코딩/지오코딩 정확도 향상)
- `NEIS_API_KEY` (중/고교 검색)
- `GEOCODER_USER_AGENT`
- `GEOCODE_DELAY_MS`
- `SCHOOL_COORDINATE_BACKFILL_LIMIT`
- `DUMMY_MODE` (더미 데이터 관련)

## 9. 로컬 실행 방법
```bash
npm install
npm run dev
```
- 기본 주소: `http://localhost:3000`
- Supabase 마이그레이션(`supabase/migrations/*`)이 적용된 DB를 사용해야 API가 정상 동작합니다.

## 10. 운영/데이터 스크립트
- `npm run import:universities` : 대학/대학원 XLS import
- `npm run backfill:school-regions` : 학교 지역코드 보정
- `npm run backfill:vote-regions` : 기존 투표 지역코드 보정
- `npm run backfill:school-coordinates` : 학교 좌표 지오코딩
- `npm run seed:dummy-votes` : 더미 투표 적재
- `npm run seed:dummy-votes:rollback` : 더미 투표 롤백

## 11. 보안/운영 메모
- 전역 보안 헤더 설정(`next.config.ts`): HSTS, X-Frame-Options, Referrer-Policy 등
- 일부 API는 레이트 리밋 적용(예: guest heartbeat, 점수 저장)
- 결과 공개는 “투표 여부”에 따라 제어되어 데이터 유출을 최소화
