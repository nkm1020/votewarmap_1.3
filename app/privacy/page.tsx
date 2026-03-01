import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '개인정보처리방침 | VoteWarMap',
  description: 'VoteWarMap 개인정보처리방침 안내',
};

const EFFECTIVE_DATE = '2026-02-27';
const UPDATED_DATE = '2026-02-27';

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[#070d16] px-4 py-10 text-white sm:px-6 lg:px-10">
      <article className="mx-auto w-full max-w-4xl rounded-3xl border border-white/12 bg-[rgba(12,18,28,0.86)] p-6 shadow-2xl sm:p-8">
        <header className="border-b border-white/12 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#ff9f0a]">Privacy Policy</p>
          <h1 className="mt-3 text-2xl font-extrabold text-white sm:text-3xl">VoteWarMap 개인정보처리방침</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/70">
            VoteWarMap(이하 &quot;서비스&quot;)는 개인정보 보호법 등 관련 법령에 따라 이용자의 개인정보를 보호하고
            이와 관련한 고충을 신속하고 원활하게 처리하기 위하여 아래와 같이 개인정보처리방침을 수립·공개합니다.
          </p>
          <div className="mt-4 grid gap-1 text-xs text-white/60 sm:grid-cols-2">
            <p>시행일: {EFFECTIVE_DATE}</p>
            <p>최종 수정일: {UPDATED_DATE}</p>
          </div>
        </header>

        <section className="mt-6 space-y-6 text-sm leading-7 text-white/80">
          <div>
            <h2 className="text-base font-bold text-white">제1조 (개인정보 처리 목적)</h2>
            <p className="mt-2">
              서비스는 다음 목적을 위하여 개인정보를 처리합니다. 처리 목적이 변경될 경우 관련 법령에 따라 필요한
              조치를 이행합니다.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>회원 식별 및 로그인 상태 관리 (Google OAuth 기반)</li>
              <li>투표/게임 서비스 제공 및 결과 저장</li>
              <li>지역 통계, 서비스 품질 개선, 보안 및 부정 이용 방지</li>
              <li>광고 제공 및 성과 측정(AdSense 활성화 시)</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">제2조 (처리하는 개인정보 항목)</h2>
            <p className="mt-2">서비스는 다음 항목을 처리합니다.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>회원 가입/이용: 이메일, 로그인 제공자(provider), 닉네임, 출생연도, 성별</li>
              <li>프로필/서비스 데이터: 학교 정보, 시도/시군구 코드, 프라이버시 공개 설정, 투표/게임 기록</li>
              <li>비회원 이용: guest session ID(브라우저 세션 저장), 임시 투표 기록</li>
              <li>자동 수집 정보: 접속 로그, 쿠키/브라우저 저장소 식별자, 기기/브라우저 정보</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">제3조 (위치정보 처리)</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>국내(KR) 사용자는 GPS 기능이 출시 예정이며, 현재 학교 기반 위치만 사용합니다.</li>
              <li>해외(non-KR) 사용자의 GPS 지원은 순차 적용 예정입니다.</li>
              <li>정밀 좌표(위도/경도)는 역지오코딩 처리에만 사용하며 서비스 DB에 저장하지 않습니다.</li>
              <li>서비스 DB에는 시도/시군구 코드 등 행정구역 정보만 저장합니다.</li>
              <li>역지오코딩 과정에서 Kakao 또는 Nominatim으로 좌표가 전송될 수 있습니다.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">제4조 (개인정보 처리 및 보유기간)</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>회원 개인정보: 회원 탈퇴 또는 처리 목적 달성 시까지 보관(법령상 보존 의무가 있는 경우 제외)</li>
              <li>guest session: 마지막 활동 시점 기준 24시간 경과 시 정리</li>
              <li>비회원 임시 투표: 세션 삭제 시 자동 삭제되거나, 로그인 병합 시 회원 데이터로 전환</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">제5조 (개인정보의 제3자 제공/처리위탁 및 국외이전)</h2>
            <p className="mt-2">서비스 제공을 위해 아래 사업자를 이용할 수 있습니다.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Supabase, Inc.: 데이터베이스/인증 인프라(국외 보관 가능)</li>
              <li>Google LLC: AdSense 광고 제공, 광고 쿠키 처리(활성화 시)</li>
              <li>Vercel Inc.: 서비스 분석(Analytics) 및 운영 인프라</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">제6조 (쿠키 및 광고 정책 안내)</h2>
            <p className="mt-2">
              서비스는 광고 게재를 위해 Google AdSense를 사용할 수 있습니다. Google을 포함한 제3자 공급업체는 쿠키를
              사용하여 사용자의 서비스 방문 기록 또는 다른 사이트 방문 기록을 기반으로 광고를 게재할 수 있습니다.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Google 광고 설정: 맞춤형 광고 설정/해제 가능</li>
              <li>aboutads.info: 제3자 맞춤형 광고 수신 거부 안내</li>
            </ul>
            <p className="mt-2 text-white/70">
              관련 링크:
              {' '}
              <a
                href="https://adssettings.google.com/"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                Google 광고 설정
              </a>
              ,
              {' '}
              <a
                href="https://www.aboutads.info/choices/"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                www.aboutads.info/choices
              </a>
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">제7조 (정보주체의 권리·의무 및 행사방법)</h2>
            <p className="mt-2">
              이용자는 개인정보 열람, 정정, 삭제, 처리정지 요구 등 권리를 행사할 수 있습니다.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>회원 탈퇴는 앱 내 MY &gt; 편집(/my/edit)에서 즉시 처리할 수 있습니다.</li>
              <li>탈퇴 시 계정/프로필은 삭제되며, 게임 점수 기록은 함께 삭제됩니다.</li>
              <li>기존 투표 기록은 개인 식별 연결(user_id)만 제거된 익명 통계 데이터로 유지될 수 있습니다.</li>
              <li>그 외 권리 행사 문의는 아래 개인정보 보호책임자 이메일로 접수할 수 있습니다.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">제8조 (개인정보 파기절차 및 방법)</h2>
            <p className="mt-2">
              개인정보는 처리 목적 달성 후 지체 없이 파기합니다. 전자적 파일은 복구가 어려운 기술적 방법으로 삭제하며,
              출력물은 분쇄 또는 소각 등의 방법으로 파기합니다.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">제9조 (개인정보 보호책임자)</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>운영주체: VoteWarMap 운영팀</li>
              <li>이메일: votewarmap@gmail.com</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-white">제10조 (개인정보처리방침 변경)</h2>
            <p className="mt-2">
              본 방침의 내용 추가, 삭제 및 수정이 있을 경우 서비스 내 공지 또는 본 페이지를 통해 사전에 안내합니다.
            </p>
          </div>
        </section>
      </article>
    </main>
  );
}
