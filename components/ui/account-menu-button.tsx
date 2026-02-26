'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

type AccountMenuButtonProps = {
  menuAlign?: 'left' | 'right';
};

export function AccountMenuButton({ menuAlign = 'right' }: AccountMenuButtonProps) {
  const { isLoading, isAuthenticated, profile, user, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const displayInitial = useMemo(() => {
    const base = profile?.nickname ?? profile?.full_name ?? profile?.email ?? user?.email ?? 'U';
    return (base.trim().slice(0, 1) || 'U').toUpperCase();
  }, [profile?.email, profile?.full_name, profile?.nickname, user?.email]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [isOpen]);

  if (isLoading) {
    return (
      <span className="inline-flex h-9 min-w-[62px] items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white/80">
        ...
      </span>
    );
  }

  if (!isAuthenticated) {
    return (
      <Link
        href="/auth"
        className="inline-flex h-9 items-center rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-semibold text-white/90 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a]"
      >
        로그인
      </Link>
    );
  }

  const menuPositionClass = menuAlign === 'left' ? 'left-0' : 'right-0';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="내 계정 메뉴"
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/92 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a]"
      >
        {profile?.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatar_url} alt="프로필" className="h-7 w-7 rounded-full border border-white/20 object-cover" />
        ) : (
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-white/10 text-[11px] font-bold">
            {displayInitial}
          </span>
        )}
      </button>

      {isOpen ? (
        <div
          className={`absolute ${menuPositionClass} top-[calc(100%+8px)] z-20 w-36 rounded-xl border border-white/15 bg-[rgba(20,20,24,0.94)] p-1.5 shadow-[0_10px_26px_rgba(0,0,0,0.38)] backdrop-blur-xl`}
        >
          <button
            type="button"
            onClick={() => {
              setIsOpen(false);
              void signOut();
            }}
            className="inline-flex h-9 w-full items-center justify-center rounded-lg text-[13px] font-semibold text-white/85 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7fb0ff]"
          >
            로그아웃
          </button>
        </div>
      ) : null}
    </div>
  );
}
