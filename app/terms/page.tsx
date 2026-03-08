import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '이용약관 | VoteWarMap',
  description: 'VoteWarMap 이용약관 안내',
};

const EFFECTIVE_DATE = '2026-02-27';
const UPDATED_DATE = '2026-03-03';

export default function TermsPage() {
  return (
    <main className="vwm-theme-shell min-h-screen px-4 py-10 sm:px-6 lg:px-10">
      <article className="vwm-theme-document mx-auto w-full max-w-4xl rounded-3xl border p-6 sm:p-8">
        <header className="border-b border-[color:var(--app-border)] pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#ff9f0a]">Terms of Service</p>
          <h1 className="mt-3 text-2xl font-extrabold text-[color:var(--app-text-primary)] sm:text-3xl">VoteWarMap 이용약관</h1>
          <p className="mt-3 text-sm leading-relaxed text-[color:var(--app-text-secondary)]">
            본 약관은 VoteWarMap(이하 &quot;서비스&quot;)이 제공하는 웹사이트 및 관련 제반 서비스의 이용과 관련하여,
            서비스와 이용자 간 권리·의무 및 책임사항을 규정함을 목적으로 합니다.
          </p>
          <div className="mt-4 grid gap-1 text-xs text-[color:var(--app-text-muted)] sm:grid-cols-2">
            <p>시행일: {EFFECTIVE_DATE}</p>
            <p>최종 수정일: {UPDATED_DATE}</p>
          </div>
        </header>

        <section className="mt-6 space-y-6 text-sm leading-7 text-[color:var(--app-text-secondary)]">
          <div>
            <h2 className="text-base font-bold text-[color:var(--app-text-primary)]">제1조 (목적)</h2>
            <p className="mt-2">
              본 약관은 서비스 이용과 관련한 기본적인 사항을 정함으로써 이용자와 서비스 간 권리관계를 명확히 하는 것을
              목적으로 합니다.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-[color:var(--app-text-primary)]">제2조 (정의)</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>회원: Google OAuth 등을 통해 로그인하여 서비스를 이용하는 자</li>
              <li>비회원: 로그인 없이 guest session 기반으로 서비스를 이용하는 자</li>
              <li>콘텐츠: 이용자가 서비스에 게시·입력·생성한 텍스트, 투표 선택, 기타 정보</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-[color:var(--app-text-primary)]">제3조 (약관의 효력 및 변경)</h2>
            <p className="mt-2">
              본 약관은 서비스 내 게시함으로써 효력이 발생합니다. 서비스는 관련 법령을 위반하지 않는 범위에서 약관을
              변경할 수 있으며, 변경 시 시행일과 주요 변경사항을 사전 고지합니다.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-[color:var(--app-text-primary)]">제4조 (서비스의 제공 및 변경)</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>서비스는 원칙적으로 연중무휴 24시간 제공을 목표로 합니다.</li>
              <li>점검, 장애, 네트워크 이슈, 운영상 필요에 따라 서비스 일부 또는 전부를 변경/중단할 수 있습니다.</li>
              <li>서비스의 기능, 화면, 정책은 운영상 필요에 따라 변경될 수 있습니다.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-[color:var(--app-text-primary)]">제4-1조 (후원 결제 및 권한 부여)</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>서비스는 1회성 후원 결제 기능을 제공할 수 있습니다.</li>
              <li>결제 완료 시 후원자 배지 권한이 부여될 수 있으며, 세부 기준은 서비스 내 안내를 따릅니다.</li>
              <li>결제 취소/환불로 유효한 완료 결제가 없는 경우 후원자 배지는 회수될 수 있습니다.</li>
              <li>후원 결제는 로그인 완료 회원만 이용할 수 있습니다.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-[color:var(--app-text-primary)]">제5조 (이용자의 의무)</h2>
            <p className="mt-2">이용자는 다음 각 호의 행위를 하여서는 안 됩니다.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>타인 정보 도용, 허위 정보 입력</li>
              <li>매크로/어뷰징/과도한 요청 등으로 서비스 안정성을 해치는 행위</li>
              <li>욕설, 혐오표현, 명예훼손, 불법·유해 콘텐츠 게시 행위</li>
              <li>서비스 또는 제3자의 권리를 침해하는 행위</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-[color:var(--app-text-primary)]">제6조 (운영자의 조치)</h2>
            <p className="mt-2">
              이용자가 약관 또는 법령을 위반하는 경우, 서비스는 위반 정도와 반복성 등을 고려하여 경고, 게시물 비노출,
              삭제, 이용 제한 등 필요한 조치를 취할 수 있습니다.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-[color:var(--app-text-primary)]">제7조 (지식재산권 및 데이터 이용)</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>서비스 자체 콘텐츠 및 상표 등에 관한 권리는 서비스에 귀속됩니다.</li>
              <li>이용자가 생성한 콘텐츠의 1차적 책임은 해당 이용자에게 있습니다.</li>
              <li>
                이용자는 서비스 운영, 품질 개선, 통계·분석 및 마케팅 목적 범위에서 해당 콘텐츠를 비독점적으로 이용할 수
                있는 권한을 서비스에 부여합니다.
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-[color:var(--app-text-primary)]">제8조 (면책)</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>천재지변, 불가항력, 통신망 장애 등으로 인한 서비스 중단에 대해 서비스는 책임을 지지 않습니다.</li>
              <li>서비스는 이용자 간 또는 이용자와 제3자 사이에서 발생한 분쟁에 대해 개입 의무를 부담하지 않습니다.</li>
              <li>비회원 세션 기반 데이터는 브라우저/기기 환경에 따라 유실될 수 있습니다.</li>
              <li>단, 서비스의 고의 또는 중대한 과실로 인한 손해에 대해서는 관련 법령이 정하는 범위 내에서 책임을 부담합니다.</li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-bold text-[color:var(--app-text-primary)]">제9조 (준거법 및 관할)</h2>
            <p className="mt-2">
              본 약관의 해석 및 서비스와 이용자 간 분쟁에는 대한민국 법령을 적용하며, 분쟁 발생 시 민사소송법상 관할
              법원을 전속 관할로 합니다.
            </p>
          </div>

          <div>
            <h2 className="text-base font-bold text-[color:var(--app-text-primary)]">제10조 (문의)</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>운영주체: VoteWarMap 운영팀</li>
              <li>이메일: votewarmap@gmail.com</li>
            </ul>
          </div>
        </section>
      </article>
    </main>
  );
}
