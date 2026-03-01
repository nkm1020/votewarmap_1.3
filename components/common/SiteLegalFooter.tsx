'use client';

import Link from 'next/link';

type SiteLegalFooterProps = {
  containerMaxWidthClassName?: string;
  footerClassName?: string;
};

export function SiteLegalFooter({
  containerMaxWidthClassName = 'max-w-[1280px]',
  footerClassName = '',
}: SiteLegalFooterProps) {
  return (
    <footer className={`relative border-t border-[color:var(--footer-border)] bg-[var(--footer-bg)] ${footerClassName}`}>
      <div
        className={`mx-auto w-full px-4 pb-4 pt-6 text-[color:var(--footer-text)] md:flex md:items-start md:justify-between md:gap-6 md:px-8 lg:px-10 ${containerMaxWidthClassName}`}
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        <div>
          <p className="text-sm font-semibold text-[color:var(--footer-heading)]">Vote War Map</p>
          <p className="mt-2 text-xs text-[color:var(--footer-text)]">© 2026 Vote War Map. All rights reserved.</p>
        </div>

        <div className="mt-2 text-xs text-[color:var(--footer-text)] md:mt-0 md:max-w-[460px] md:text-right">
          <p>이용 정책 및 문의</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 md:justify-end">
            <Link
              href="/privacy"
              className="text-[color:var(--footer-heading)] underline-offset-2 transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--footer-bg)]"
            >
              개인정보처리방침
            </Link>
            <span className="opacity-45">|</span>
            <Link
              href="/terms"
              className="text-[color:var(--footer-heading)] underline-offset-2 transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--footer-bg)]"
            >
              이용약관
            </Link>
            <span className="opacity-45">|</span>
            <a
              href="mailto:votewarmap@gmail.com"
              className="text-[color:var(--footer-heading)] underline-offset-2 transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--footer-bg)]"
            >
              votewarmap@gmail.com
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
