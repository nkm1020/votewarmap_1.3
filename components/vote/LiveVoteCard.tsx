'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { AccountMenuButton } from '@/components/ui/account-menu-button';
import { UsersIcon, CheckIcon, ChevronDownIcon, CircleCheckIcon } from 'lucide-react';

type LiveVoteCardOption = {
  key: string | null;
  label: string;
  percentage: number | null;
  subtext: string;
};

export type LiveVoteCardProps = {
  topicId: string | null;
  title: string;
  variant?: 'default' | 'desktop_refined';
  resultVisibility?: 'locked' | 'unlocked';
  lockedGapPercent?: number | null;
  lockedTotalVotes?: number | null;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  selectedOptionKey: string | null;
  onSelectOption: (key: string) => void;
  onSubmitVote: () => void;
  submitDisabled: boolean;
  submitLabel: string;
  message: string | null;
  isStatsLoading: boolean;
  totalVotes: number;
  realtimeVotes?: number | null;
  leftOption: LiveVoteCardOption;
  rightOption: LiveVoteCardOption;
  className?: string;
};

const cardEase: [number, number, number, number] = [0.2, 0.65, 0.3, 0.9];
const cardTransition = {
  duration: 0.32,
  ease: cardEase,
};
const cardLayoutTransition = {
  layout: {
    duration: 0.35,
    ease: cardEase,
  },
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value < 0) {
    return 0;
  }

  if (value > 100) {
    return 100;
  }

  return Math.round(value);
}

function displayPercent(value: number | null): string {
  if (value === null) {
    return '-';
  }
  return `${clampPercent(value)}%`;
}

export function LiveVoteCard({
  topicId,
  title,
  variant = 'default',
  resultVisibility = 'unlocked',
  lockedGapPercent = null,
  lockedTotalVotes = null,
  isExpanded,
  onToggleExpanded,
  selectedOptionKey,
  onSelectOption,
  onSubmitVote,
  submitDisabled,
  submitLabel,
  message,
  isStatsLoading,
  totalVotes,
  leftOption,
  rightOption,
  className,
}: LiveVoteCardProps) {
  const prefersReducedMotion = useReducedMotion();
  const [titleOverflowPx, setTitleOverflowPx] = useState(0);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const isDesktopRefined = variant === 'desktop_refined';
  const isLocked = resultVisibility === 'locked';

  useEffect(() => {
    const updateTitleOverflow = () => {
      const el = titleRef.current;
      if (!el) {
        setTitleOverflowPx(0);
        return;
      }

      const overflow = Math.ceil(el.scrollWidth - el.clientWidth);
      setTitleOverflowPx(overflow > 0 ? overflow : 0);
    };

    updateTitleOverflow();
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => updateTitleOverflow());
    if (titleRef.current) {
      observer.observe(titleRef.current);
      if (titleRef.current.parentElement) {
        observer.observe(titleRef.current.parentElement);
      }
    }

    return () => observer.disconnect();
  }, [title]);

  const hasPercentageData = !isLocked && leftOption.percentage !== null && rightOption.percentage !== null;
  const leftPercent = hasPercentageData ? clampPercent(leftOption.percentage ?? 0) : 0;
  const rightPercent = hasPercentageData ? clampPercent(rightOption.percentage ?? 0) : 0;
  const resolvedTotalVotes =
    typeof lockedTotalVotes === 'number' && Number.isFinite(lockedTotalVotes) ? lockedTotalVotes : totalVotes;
  const totalParticipantsCount = isStatsLoading ? '...' : resolvedTotalVotes.toLocaleString();
  const resolvedLockedGapPercent =
    typeof lockedGapPercent === 'number' && Number.isFinite(lockedGapPercent) ? Math.max(0, Math.round(lockedGapPercent)) : 0;
  const shouldAnimateTitle = titleOverflowPx > 0 && !prefersReducedMotion;
  const marqueeDistance = Math.max(0, titleOverflowPx + 12);
  const marqueeDuration = Math.min(18, Math.max(6, marqueeDistance / 18));

  return (
    <motion.section
      layout
      transition={cardLayoutTransition}
      className={`pointer-events-auto relative w-full overflow-hidden rounded-[30px] border border-white/14 bg-gradient-to-br from-[rgba(10,18,30,0.9)] via-[rgba(8,14,24,0.95)] to-[rgba(6,10,18,0.96)] shadow-[0_26px_52px_rgba(0,0,0,0.45)] backdrop-blur-2xl backdrop-saturate-150 ${
        isDesktopRefined
          ? 'lg:rounded-[34px] lg:border-white/20 lg:bg-[linear-gradient(145deg,rgba(10,18,30,0.9),rgba(8,14,24,0.96),rgba(5,9,16,0.98))] lg:shadow-[0_34px_68px_rgba(0,0,0,0.55)]'
          : ''
      } ${className ?? ''}`}
      data-topic-id={topicId ?? undefined}
    >
      {isDesktopRefined ? (
        <>
          <div className="pointer-events-none absolute inset-0 hidden lg:block bg-[radial-gradient(circle_at_12%_0%,rgba(255,159,10,0.18),transparent_38%)]" />
          <div className="pointer-events-none absolute inset-0 hidden lg:block bg-[radial-gradient(circle_at_88%_92%,rgba(47,116,255,0.16),transparent_42%)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-px lg:block bg-gradient-to-r from-transparent via-white/35 to-transparent" />
        </>
      ) : null}

      <motion.div layout className={`relative z-[1] p-5 ${isDesktopRefined ? 'lg:p-6' : ''}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col">
            <div className="mb-1.5 flex items-center gap-2">
              <span
                className={`inline-flex min-h-5 items-center gap-1.5 rounded-full border border-[#ff9f0a4d] bg-[#ff9f0a1a] px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-[#ffad33] ${
                  isDesktopRefined ? 'lg:min-h-6 lg:gap-2 lg:px-3 lg:text-[11px]' : ''
                }`}
              >
                <UsersIcon className="h-3 w-3" />
                <span>총 참여수</span>
                <span className="tabular-nums">{totalParticipantsCount}명</span>
              </span>
            </div>
            <div className="min-w-0 overflow-hidden">
              <motion.h2
                ref={titleRef}
                title={title}
                className={`text-xl font-bold leading-tight text-white/95 ${
                  isDesktopRefined ? 'lg:text-[26px] lg:leading-[1.22]' : ''
                } ${shouldAnimateTitle ? 'whitespace-nowrap pr-3' : 'truncate'}`}
                style={
                  isDesktopRefined
                    ? ({
                        letterSpacing: '-0.01em',
                      } as const)
                    : undefined
                }
                animate={shouldAnimateTitle ? { x: [0, -marqueeDistance] } : { x: 0 }}
                transition={
                  shouldAnimateTitle
                    ? {
                        duration: marqueeDuration,
                        ease: 'linear',
                        repeat: Infinity,
                        repeatType: 'reverse',
                        repeatDelay: 0.8,
                      }
                    : { duration: 0.2 }
                }
              >
                {title}
              </motion.h2>
            </div>
          </div>

          <motion.div layout className="mt-1 flex shrink-0 items-center gap-2">
            <motion.button
              layout
              type="button"
              onClick={onToggleExpanded}
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#ff9f0a]/70 bg-[#ff9f0a] px-3 text-xs font-semibold text-[#2d1a00] transition hover:bg-[#ffb547] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a] ${
                isDesktopRefined
                  ? 'lg:h-10 lg:rounded-2xl lg:px-4 lg:text-[13px] lg:shadow-[0_10px_22px_rgba(255,159,10,0.25)]'
                  : ''
              }`}
            >
              <motion.span layout>{isExpanded ? '접기' : '투표하기'}</motion.span>
              <motion.div layout animate={{ rotate: isExpanded ? 180 : 0 }}>
                <ChevronDownIcon className="h-3.5 w-3.5" />
              </motion.div>
            </motion.button>

            <div className="md:hidden">
              <AccountMenuButton />
            </div>
          </motion.div>
        </div>

        <motion.div layout className="mt-4 flex flex-col">
          <AnimatePresence initial={false}>
            {isExpanded ? (
              <motion.div
                layout
                initial={{ opacity: 0, height: 0, marginBottom: 0 }}
                animate={{ opacity: 1, height: 'auto', marginBottom: 8 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                className={`flex items-center justify-between overflow-hidden text-sm font-semibold ${
                  isDesktopRefined ? 'lg:mb-2 lg:text-[15px]' : ''
                }`}
              >
                {isLocked ? (
                  <span className="w-full text-center text-white/80">
                    현재 격차 <span className="font-bold text-white">{resolvedLockedGapPercent}%p</span> · 총{' '}
                    <span className="font-bold text-white">{totalParticipantsCount}표</span>
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 text-[#ff8b2f]">
                      {leftOption.label} <span className="text-white/90">{displayPercent(leftOption.percentage)}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[#6ea6ff]">
                      <span className="text-white/90">{displayPercent(rightOption.percentage)}</span> {rightOption.label}
                    </span>
                  </>
                )}
              </motion.div>
            ) : null}
          </AnimatePresence>

          <motion.div
            layout
            initial={false}
            animate={{ height: isExpanded ? 12 : 6 }}
            className={`relative w-full overflow-hidden rounded-full bg-slate-800 shadow-inner ${
              isDesktopRefined ? 'lg:bg-slate-900/80 lg:ring-1 lg:ring-white/14' : ''
            }`}
          >
            {isLocked ? (
              <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(148,163,184,0.88),rgba(148,163,184,0.68))]" />
            ) : hasPercentageData ? (
              <>
                <motion.div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#ff6b00] to-[#ff9f0a]"
                  initial={{ width: 0 }}
                  animate={{ width: `${leftPercent}%` }}
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                />
                <motion.div
                  className="absolute inset-y-0 right-0 bg-gradient-to-l from-[#2f74ff] to-[#6ea6ff]"
                  initial={{ width: 0 }}
                  animate={{ width: `${rightPercent}%` }}
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                />
              </>
            ) : (
              <div className="absolute inset-0 bg-white/8" />
            )}
          </motion.div>

        </motion.div>

        <AnimatePresence initial={false}>
          {isExpanded ? (
            <motion.div
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={cardTransition}
              className="overflow-hidden"
            >
              <div className="mt-4 border-t border-white/10 pt-5">
                <motion.div layout className="mb-5">
                  <p className={`mb-3 flex items-center gap-2 text-xs font-medium text-white/50 ${isDesktopRefined ? 'lg:text-[13px]' : ''}`}>
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[10px] text-white">1</span>
                    당신의 취향을 선택하세요
                  </p>
                  <div className={`grid grid-cols-2 gap-3 ${isDesktopRefined ? 'lg:gap-3.5' : ''}`}>
                    <motion.button
                      type="button"
                      whileHover={{ scale: leftOption.key ? 1.02 : 1 }}
                      whileTap={{ scale: leftOption.key ? 0.98 : 1 }}
                      onClick={() => {
                        if (leftOption.key) {
                          onSelectOption(leftOption.key);
                        }
                      }}
                      disabled={!leftOption.key}
                      className={`relative flex min-h-[108px] flex-col items-center justify-center rounded-2xl border p-4 text-center transition-all duration-200 ${
                        selectedOptionKey === leftOption.key
                          ? 'border-[#ff6b00] bg-[#ff6b001a] shadow-[0_0_20px_rgba(255,107,0,0.18)]'
                          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                      } ${isDesktopRefined ? 'lg:min-h-[124px] lg:rounded-[20px] lg:p-5' : ''} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {selectedOptionKey === leftOption.key ? (
                        <span className="absolute right-2 top-2">
                          <CircleCheckIcon className="h-4 w-4 text-[#ff9f0a]" />
                        </span>
                      ) : null}
                      <span
                        className={`mb-1 block w-full px-1 text-center text-[clamp(1.2rem,4.2vw,2rem)] font-bold leading-[1.2] text-balance [word-break:keep-all] [overflow-wrap:anywhere] ${
                          selectedOptionKey === leftOption.key ? 'text-[#ffad33]' : 'text-white/85'
                        }`}
                      >
                        {leftOption.label}
                      </span>
                      <span className="min-h-[16px] text-[11px] text-white/50">{leftOption.subtext || '\u00A0'}</span>
                    </motion.button>

                    <motion.button
                      type="button"
                      whileHover={{ scale: rightOption.key ? 1.02 : 1 }}
                      whileTap={{ scale: rightOption.key ? 0.98 : 1 }}
                      onClick={() => {
                        if (rightOption.key) {
                          onSelectOption(rightOption.key);
                        }
                      }}
                      disabled={!rightOption.key}
                      className={`relative flex min-h-[108px] flex-col items-center justify-center rounded-2xl border p-4 text-center transition-all duration-200 ${
                        selectedOptionKey === rightOption.key
                          ? 'border-[#2f74ff] bg-[#2f74ff1a] shadow-[0_0_20px_rgba(47,116,255,0.18)]'
                          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                      } ${isDesktopRefined ? 'lg:min-h-[124px] lg:rounded-[20px] lg:p-5' : ''} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {selectedOptionKey === rightOption.key ? (
                        <span className="absolute right-2 top-2">
                          <CircleCheckIcon className="h-4 w-4 text-[#6ea6ff]" />
                        </span>
                      ) : null}
                      <span
                        className={`mb-1 block w-full px-1 text-center text-[clamp(1.2rem,4.2vw,2rem)] font-bold leading-[1.2] text-balance [word-break:keep-all] [overflow-wrap:anywhere] ${
                          selectedOptionKey === rightOption.key ? 'text-[#6ea6ff]' : 'text-white/85'
                        }`}
                      >
                        {rightOption.label}
                      </span>
                      <span className="min-h-[16px] text-[11px] text-white/50">{rightOption.subtext || '\u00A0'}</span>
                    </motion.button>
                  </div>
                </motion.div>

                <motion.div layout>
                  <p className={`mb-3 flex items-center gap-2 text-xs font-medium text-white/50 ${isDesktopRefined ? 'lg:text-[13px]' : ''}`}>
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 text-[10px] text-white">2</span>
                    선택을 확정하세요
                  </p>
                  <button
                    type="button"
                    onClick={onSubmitVote}
                    disabled={submitDisabled}
                    className={`flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold transition-all duration-200 ${
                      submitDisabled
                        ? 'cursor-not-allowed border border-white/10 bg-white/5 text-white/30'
                        : 'bg-white text-slate-900 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:bg-slate-100'
                    } ${isDesktopRefined ? 'lg:h-[58px] lg:rounded-[18px] lg:text-[17px]' : ''}`}
                  >
                    {submitDisabled && submitLabel === '처리 중...' ? <CheckIcon className="h-4 w-4 opacity-70" /> : null}
                    {submitLabel}
                  </button>
                </motion.div>

                {message ? (
                  <p className={`mt-3 text-center text-xs text-white/85 ${isDesktopRefined ? 'lg:text-[13px]' : ''}`}>{message}</p>
                ) : null}
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>
    </motion.section>
  );
}
