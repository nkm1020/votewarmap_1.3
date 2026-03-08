'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { MapPinned, Route } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

type VoteResultScopeChooserProps = {
  isOpen: boolean;
  onClose: () => void;
  topicTitle: string;
  scopeCountryName: string;
  voteCountryName: string;
  onOpenScopeResult: () => void;
  onOpenVoteCountryResult: () => void;
  reducedMotion: boolean;
};

export function VoteResultScopeChooser({
  isOpen,
  onClose,
  topicTitle,
  scopeCountryName,
  voteCountryName,
  onOpenScopeResult,
  onOpenVoteCountryResult,
  reducedMotion,
}: VoteResultScopeChooserProps) {
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === 'dark';
  const overlayClass = isDarkTheme ? 'bg-[rgba(7,10,18,0.62)]' : 'bg-[rgba(15,23,42,0.24)]';
  const panelShellClass = isDarkTheme
    ? 'border-white/14 bg-[rgba(15,19,28,0.96)] text-white shadow-[0_20px_48px_rgba(0,0,0,0.38)]'
    : 'border-slate-200/90 bg-[rgba(255,255,255,0.97)] text-slate-900 shadow-[0_18px_38px_rgba(148,163,184,0.24)]';
  const eyebrowClass = isDarkTheme ? 'text-white/46' : 'text-slate-500';
  const bodyClass = isDarkTheme ? 'text-white/68' : 'text-slate-600';
  const primaryCardClass = isDarkTheme
    ? 'border border-[#ff9f0a66] bg-[#ff6b001f] hover:bg-[#ff6b0030] focus-visible:ring-[#ffb46f]'
    : 'border border-[#f59e0b66] bg-[#fff4e8] hover:bg-[#ffe9d2] focus-visible:ring-[#f59e0b]';
  const primaryTitleClass = isDarkTheme ? 'text-white' : 'text-slate-900';
  const primaryBodyClass = isDarkTheme ? 'text-white/64' : 'text-slate-600';
  const primaryIconClass = isDarkTheme ? 'text-[#ffb46f]' : 'text-[#f59e0b]';
  const secondaryCardClass = isDarkTheme
    ? 'border border-[#5f97ff55] bg-[#2f74ff1a] hover:bg-[#2f74ff2c] focus-visible:ring-[#7fb0ff]'
    : 'border border-[#5f97ff55] bg-[#eef4ff] hover:bg-[#e1ecff] focus-visible:ring-[#5f97ff]';
  const secondaryTitleClass = isDarkTheme ? 'text-white' : 'text-slate-900';
  const secondaryBodyClass = isDarkTheme ? 'text-white/64' : 'text-slate-600';
  const secondaryIconClass = isDarkTheme ? 'text-[#9cc2ff]' : 'text-[#4f7cff]';
  const closeButtonClass = isDarkTheme
    ? 'text-white/54 hover:text-white/82 focus-visible:ring-white/35'
    : 'text-slate-500 hover:text-slate-800 focus-visible:ring-slate-300';

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          key="vote-result-scope-chooser"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.18 }}
          className="fixed inset-0 z-[90] flex items-center justify-center p-4"
          onClick={onClose}
        >
          <div className={`absolute inset-0 backdrop-blur-[2px] ${overlayClass}`} aria-hidden="true" />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="결과 보기 선택"
            initial={reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 18 }}
            transition={{ duration: reducedMotion ? 0 : 0.22, ease: 'easeOut' }}
            className={`relative w-full max-w-[360px] overflow-hidden rounded-[24px] border p-5 ${panelShellClass}`}
            onClick={(event) => event.stopPropagation()}
          >
            <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${eyebrowClass}`}>Result Path</p>
            <h2 className="mt-2 text-[20px] font-bold leading-tight">{topicTitle}</h2>
            <p className={`mt-2 text-[13px] leading-relaxed ${bodyClass}`}>
              투표는 {voteCountryName} 기준으로 집계됐습니다. 지금 보고 싶은 결과 경로를 선택하세요.
            </p>

            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={onOpenVoteCountryResult}
                className={`flex w-full items-start gap-3 rounded-[18px] px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 ${primaryCardClass}`}
              >
                <Route className={`mt-0.5 h-5 w-5 shrink-0 ${primaryIconClass}`} />
                <span>
                  <span className={`block text-[14px] font-semibold ${primaryTitleClass}`}>내 지역 결과 보기</span>
                  <span className={`mt-1 block text-[12px] ${primaryBodyClass}`}>
                    {voteCountryName} 결과로 이동해 내 지역 집계까지 바로 확인합니다.
                  </span>
                </span>
              </button>

              <button
                type="button"
                onClick={onOpenScopeResult}
                className={`flex w-full items-start gap-3 rounded-[18px] px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 ${secondaryCardClass}`}
              >
                <MapPinned className={`mt-0.5 h-5 w-5 shrink-0 ${secondaryIconClass}`} />
                <span>
                  <span className={`block text-[14px] font-semibold ${secondaryTitleClass}`}>{scopeCountryName} 지도 보기</span>
                  <span className={`mt-1 block text-[12px] ${secondaryBodyClass}`}>
                    현재 보고 있던 국가 결과를 조회 전용으로 계속 확인합니다.
                  </span>
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className={`mt-4 inline-flex h-11 w-full items-center justify-center rounded-xl text-[14px] font-medium transition focus-visible:outline-none focus-visible:ring-2 ${closeButtonClass}`}
            >
              닫기
            </button>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
