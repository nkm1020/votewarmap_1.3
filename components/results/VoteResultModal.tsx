'use client';

import { useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Link2, MapPinned } from 'lucide-react';

type VoteResultModalOption = {
  label: string;
  percent: number;
  count?: number;
};

type VoteResultModalRegion = {
  name: string;
  percentA: number;
  percentB: number;
} | null;

type VoteResultModalPersona = {
  egenPercent: number;
  tetoPercent: number;
} | null;

export interface VoteResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  topicId: string;
  topicTitle: string;
  myChoice: 'A' | 'B' | null;
  optionA: VoteResultModalOption;
  optionB: VoteResultModalOption;
  myRegion: VoteResultModalRegion;
  nationwidePersona: VoteResultModalPersona;
  myRegionPersona: VoteResultModalPersona;
  onMapView: () => void;
  onShareKakao: () => Promise<void>;
  onShareLinkCopy: () => Promise<void>;
  onOpenNextTopics: () => void;
  reducedMotion: boolean;
  isAuthenticated?: boolean;
  onLoginClick?: () => void;
}

function displayPercents(a: number, b: number): { a: number; b: number } {
  const minVisible = 8;
  const normalizedA = Math.max(0, Math.min(100, a));
  const normalizedB = Math.max(0, Math.min(100, b));

  if (normalizedA === 0 && normalizedB === 100) {
    return { a: minVisible, b: 100 - minVisible };
  }
  if (normalizedB === 0 && normalizedA === 100) {
    return { a: 100 - minVisible, b: minVisible };
  }
  if (normalizedA < minVisible) {
    return { a: minVisible, b: 100 - minVisible };
  }
  if (normalizedB < minVisible) {
    return { a: 100 - minVisible, b: minVisible };
  }

  return { a: normalizedA, b: normalizedB };
}

export function VoteResultModal({
  isOpen,
  onClose,
  topicId: _topicId,
  topicTitle,
  myChoice,
  optionA,
  optionB,
  myRegion,
  nationwidePersona,
  myRegionPersona,
  onMapView,
  onShareKakao,
  onShareLinkCopy,
  onOpenNextTopics,
  reducedMotion,
  isAuthenticated = false,
}: VoteResultModalProps) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const dialog = modalRef.current;
    const previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = dialog
      ? Array.from(
          dialog.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'),
        ).filter((element) => !element.hasAttribute('disabled'))
      : [];

    const firstFocusable = focusable[0];
    const lastFocusable = focusable[focusable.length - 1];

    firstFocusable?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !dialog || focusable.length === 0) {
        return;
      }

      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable?.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable?.focus();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previousFocusedElement?.focus();
    };
  }, [isOpen, onClose]);

  const myChoiceLabel = useMemo(() => {
    if (myChoice === 'A') {
      return optionA.label;
    }
    if (myChoice === 'B') {
      return optionB.label;
    }
    return '선택 정보 확인 중';
  }, [myChoice, optionA.label, optionB.label]);

  const nationwideBar = useMemo(() => displayPercents(optionA.percent, optionB.percent), [optionA.percent, optionB.percent]);
  const regionBar = useMemo(() => {
    if (!myRegion) {
      return null;
    }
    return displayPercents(myRegion.percentA, myRegion.percentB);
  }, [myRegion]);
  const nationwidePersonaLine = useMemo(() => {
    if (!nationwidePersona) {
      return '에겐/테토 데이터 없음';
    }
    return `에겐 ${nationwidePersona.egenPercent}% · 테토 ${nationwidePersona.tetoPercent}%`;
  }, [nationwidePersona]);
  const myRegionPersonaLine = useMemo(() => {
    if (!myRegionPersona) {
      return '에겐/테토 데이터 없음';
    }
    return `에겐 ${myRegionPersona.egenPercent}% · 테토 ${myRegionPersona.tetoPercent}%`;
  }, [myRegionPersona]);
  const regionWinner = useMemo<'A' | 'B' | 'TIE' | null>(() => {
    if (!myRegion) {
      return null;
    }
    if (myRegion.percentA === myRegion.percentB) {
      return 'TIE';
    }
    return myRegion.percentA > myRegion.percentB ? 'A' : 'B';
  }, [myRegion]);
  const isRegionMatch = useMemo(() => {
    if (!myChoice || !regionWinner || regionWinner === 'TIE') {
      return null;
    }
    return myChoice === regionWinner;
  }, [myChoice, regionWinner]);
  const heroLine = useMemo(() => {
    if (!myChoice) {
      return '판세를 흔든 플레이어군요!';
    }
    if (isRegionMatch === false) {
      return '반란가 이시군요!!';
    }
    if (isRegionMatch === true) {
      return '동네 대표 주자시군요!!';
    }
    return '판세를 흔드는 중이에요!';
  }, [isRegionMatch, myChoice]);
  const teamLabel = myChoice === 'A' ? 'TEAM A' : myChoice === 'B' ? 'TEAM B' : 'TEAM';
  const teamToneTextClass = myChoice === 'A' ? 'text-[#ffad63]' : myChoice === 'B' ? 'text-[#8dbdff]' : 'text-white/85';
  const teamHeaderGradientClass =
    myChoice === 'A'
      ? 'from-[#ff6b00] via-[#ff8f21] to-[#ffad4a]'
      : myChoice === 'B'
        ? 'from-[#2f74ff] via-[#4d92ff] to-[#78b6ff]'
        : 'from-[#607ca3] via-[#7d97b8] to-[#9ab1cc]';

  const handleShareCard = async () => {
    try {
      await onShareKakao();
    } catch {
      await onShareLinkCopy();
    }
  };

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          key="vote-result-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-[rgba(0,0,0,0.6)] backdrop-blur-[2px]" aria-hidden="true" />

          <motion.section
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-label="투표 결과"
            data-topic-id={_topicId}
            tabIndex={-1}
            initial={reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
            transition={{ duration: reducedMotion ? 0 : 0.3, ease: 'easeOut' }}
            className="relative w-full max-w-[348px]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="max-h-[84vh] overflow-y-auto px-2 pb-2 pt-3">
              <div className="overflow-hidden rounded-[24px] border border-white/14 bg-[rgba(16,20,30,0.94)] text-white shadow-[0_14px_30px_rgba(0,0,0,0.34)]">
                <header className={`bg-gradient-to-r px-5 pb-5 pt-4 text-white ${teamHeaderGradientClass}`}>
                  <span className="inline-flex rounded-full border border-white/45 bg-white/18 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.05em]">
                    Official Voter Card
                  </span>
                  <p className="mt-2 text-[34px] font-black italic leading-none">{teamLabel}</p>
                  <p className="mt-1 truncate text-[13px] font-medium text-white/95">{topicTitle}</p>
                </header>

                <div className="px-4 pb-4 pt-5">
                  <p className="text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-white/58">Selected Choice</p>
                  <p className={`mt-1 text-center text-[36px] font-black leading-none ${teamToneTextClass}`}>&quot;{myChoiceLabel}&quot;</p>
                  <p className="mt-3 text-center text-[22px] font-black leading-tight text-white">{heroLine}</p>

                  <div className="mt-4 rounded-2xl border border-white/12 bg-white/6 p-3">
                    <div className="space-y-2.5">
                      <section className="space-y-1.5">
                        <div className="text-[11px] font-semibold text-white/72">{myRegion?.name ?? '우리 지역'}</div>
                        {myRegion && regionBar ? (
                          <>
                            <div className="flex items-center justify-between text-[12px]">
                              <span className="font-semibold text-[#ffc38e]">
                                {optionA.label} {myRegion.percentA}%
                              </span>
                              <span className="font-semibold text-[#b8d6ff]">
                                {optionB.label} {myRegion.percentB}%
                              </span>
                            </div>
                            <div className="flex h-2.5 overflow-hidden rounded-full bg-white/12">
                              <motion.div
                                className="h-full origin-left bg-[#ff6b00]"
                                style={{ width: `${regionBar.a}%` }}
                                initial={reducedMotion ? { scaleX: 1 } : { scaleX: 0 }}
                                animate={{ scaleX: 1 }}
                                transition={{ duration: reducedMotion ? 0 : 0.5, ease: 'easeOut' }}
                              />
                              <motion.div
                                className="h-full origin-left bg-[#2f74ff]"
                                style={{ width: `${regionBar.b}%` }}
                                initial={reducedMotion ? { scaleX: 1 } : { scaleX: 0 }}
                                animate={{ scaleX: 1 }}
                                transition={{ duration: reducedMotion ? 0 : 0.5, ease: 'easeOut' }}
                              />
                            </div>
                            <p className="text-[11px] font-medium text-white/64">전체 주제 기준 · {myRegionPersonaLine}</p>
                          </>
                        ) : (
                          <p className="text-[11px] text-white/56">지역 데이터 수집 중</p>
                        )}
                      </section>

                      <section className="space-y-1.5">
                        <div className="text-[11px] font-semibold text-white/72">전국 결과</div>
                        <div className="flex items-center justify-between text-[12px]">
                          <span className="font-semibold text-[#ffc38e]">
                            {optionA.label} {optionA.percent}%
                          </span>
                          <span className="font-semibold text-[#b8d6ff]">
                            {optionB.label} {optionB.percent}%
                          </span>
                        </div>
                        <div className="flex h-2.5 overflow-hidden rounded-full bg-white/12">
                          <motion.div
                            className="h-full origin-left bg-[#ff6b00]"
                            style={{ width: `${nationwideBar.a}%` }}
                            initial={reducedMotion ? { scaleX: 1 } : { scaleX: 0 }}
                            animate={{ scaleX: 1 }}
                            transition={{ duration: reducedMotion ? 0 : 0.5, ease: 'easeOut' }}
                          />
                          <motion.div
                            className="h-full origin-left bg-[#2f74ff]"
                            style={{ width: `${nationwideBar.b}%` }}
                            initial={reducedMotion ? { scaleX: 1 } : { scaleX: 0 }}
                            animate={{ scaleX: 1 }}
                            transition={{ duration: reducedMotion ? 0 : 0.5, ease: 'easeOut' }}
                          />
                        </div>
                        <p className="text-[11px] font-medium text-white/64">전체 주제 기준 · {nationwidePersonaLine}</p>
                      </section>
                    </div>
                  </div>
                </div>

                <footer className="flex items-center justify-between border-t border-white/12 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-white/44">
                  <span>VOTEWARMAP.COM</span>
                  <button
                    type="button"
                    onClick={onOpenNextTopics}
                    className="inline-flex h-8 items-center gap-1 rounded-full px-2 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45"
                    aria-label="다음 투표 보기"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
                    <span className="h-1.5 w-1.5 rounded-full bg-white/30" />
                    <span className="h-1.5 w-5 rounded-full bg-white/65" />
                  </button>
                </footer>
              </div>

              <div className="space-y-2.5 px-2 pb-2 pt-4">
                <button
                  type="button"
                  onClick={() => void handleShareCard()}
                  className="inline-flex h-12 w-full min-w-[44px] items-center justify-center gap-2 rounded-xl border border-[#ff9f0a66] bg-[#ff6b00] text-[15px] font-semibold text-white shadow-[0_8px_20px_rgba(255,107,0,0.34)] transition hover:bg-[#ff7d1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ffb46f]"
                >
                  <Link2 size={20} />
                  공유하기
                </button>

                <button
                  type="button"
                  onClick={onMapView}
                  className="inline-flex h-12 w-full min-w-[44px] items-center justify-center gap-2 rounded-xl border border-[#4f8dff66] bg-[#2f74ff1f] text-[15px] font-semibold text-[#b6d4ff] transition hover:bg-[#2f74ff33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6ea6ff]"
                >
                  <MapPinned size={20} />
                  전국 지도 보기
                </button>

                {isAuthenticated ? (
                  <section className="rounded-xl border border-[#82d47a44] bg-[#1d3a201f] p-3 text-[#ade9a4]">
                    <p className="text-sm font-semibold">결과가 계정에 저장되었습니다.</p>
                  </section>
                ) : null}

                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-11 w-full min-w-[44px] items-center justify-center text-[14px] font-medium text-white/45 transition hover:text-white/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
                >
                  닫기
                </button>
              </div>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
