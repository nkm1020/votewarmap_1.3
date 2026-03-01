'use client';

import { useEffect, useMemo, useRef } from 'react';
import { ADSENSE_CLIENT_ID } from '@/lib/adsense';

declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

type AdSenseSlotProps = {
  slot?: string | null;
  minHeight?: number;
  className?: string;
  fallbackText?: string;
  fallbackClassName?: string;
};

export function AdSenseSlot({
  slot,
  minHeight = 50,
  className,
  fallbackText = '스폰서 배너 영역입니다.',
  fallbackClassName = 'truncate text-[12px] font-medium text-white/80',
}: AdSenseSlotProps) {
  const requestedRef = useRef(false);
  const normalizedSlot = useMemo(() => slot?.trim() ?? '', [slot]);
  const hasValidSlot = useMemo(() => /^[0-9]+$/.test(normalizedSlot), [normalizedSlot]);

  useEffect(() => {
    if (!hasValidSlot || requestedRef.current || typeof window === 'undefined') {
      return;
    }
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
      requestedRef.current = true;
    } catch {
      // Ignore runtime ad errors and keep the page interactive.
    }
  }, [hasValidSlot]);

  if (!hasValidSlot) {
    return <p className={fallbackClassName}>{fallbackText}</p>;
  }

  return (
    <div className={className}>
      <ins
        className="adsbygoogle"
        style={{ display: 'block', width: '100%', minHeight }}
        data-ad-client={ADSENSE_CLIENT_ID}
        data-ad-slot={normalizedSlot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}
