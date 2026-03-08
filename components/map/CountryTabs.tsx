'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { SUPPORTED_COUNTRY_TABS, type SupportedCountry } from '@/lib/map/countryMapRegistry';

type CountryTabsProps = {
  selectedCountry: SupportedCountry;
  onSelectCountry: (country: SupportedCountry) => void;
  className?: string;
  compact?: boolean;
  desktopExpandable?: boolean;
};

export default function CountryTabs({
  selectedCountry,
  onSelectCountry,
  className,
  compact = false,
  desktopExpandable = false,
}: CountryTabsProps) {
  const { resolvedTheme } = useTheme();
  const isDarkTheme = resolvedTheme === 'dark';
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const shouldUseExpandableDesktop = desktopExpandable && !compact;
  const useCondensedButtonLayout = compact;
  const useExpandableButtonLayout = shouldUseExpandableDesktop;

  useEffect(() => {
    if (!shouldUseExpandableDesktop || !isExpanded) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded, shouldUseExpandableDesktop]);

  const containerClassName = `inline-flex items-center justify-end rounded-full border ${
    useExpandableButtonLayout ? 'p-[3px] gap-[2px]' : 'p-1 gap-1'
  } ${
    isDarkTheme
      ? 'border-white/[0.16] bg-white/10 backdrop-blur-[12px]'
      : 'border-slate-200/90 bg-[rgba(255,255,255,0.85)] shadow-[0_8px_20px_rgba(148,163,184,0.18)] backdrop-blur-[12px]'
  } transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]`;

  const buttonClassName = (active: boolean) =>
    `inline-flex shrink-0 items-center justify-center rounded-full font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a]/60 ${
      useExpandableButtonLayout
        ? 'h-6 px-1.5 text-[10px] tracking-[-0.01em]'
        : useCondensedButtonLayout
          ? 'h-7 px-2 text-[11px]'
          : 'h-8 px-3 text-[12px]'
    } ${
      active
        ? isDarkTheme
          ? 'bg-white/20 text-white shadow-sm'
          : 'bg-slate-900/[0.08] text-slate-900 shadow-[0_1px_3px_rgba(0,0,0,0.05)]'
        : isDarkTheme
          ? 'text-white/76 hover:bg-white/16 hover:text-white'
          : 'text-slate-500 hover:bg-slate-900/[0.06] hover:text-slate-800'
    }`;

  const handleSelectCountry = (country: SupportedCountry) => {
    onSelectCountry(country);
    if (shouldUseExpandableDesktop) {
      setIsExpanded(false);
    }
  };

  const previewTabs = useMemo(() => {
    if (!shouldUseExpandableDesktop) {
      return SUPPORTED_COUNTRY_TABS;
    }

    const defaultCodes: SupportedCountry[] = ['KR', 'US'];
    if (defaultCodes.includes(selectedCountry)) {
      return SUPPORTED_COUNTRY_TABS.filter((item) => defaultCodes.includes(item.code));
    }

    return SUPPORTED_COUNTRY_TABS.filter((item) => item.code === 'KR' || item.code === selectedCountry);
  }, [selectedCountry, shouldUseExpandableDesktop]);

  const hiddenTabs = useMemo(
    () => SUPPORTED_COUNTRY_TABS.filter((item) => !previewTabs.some((previewItem) => previewItem.code === item.code)),
    [previewTabs],
  );

  const renderChevronButton = () => (
    <button
      type="button"
      aria-label="다른 국가 더 보기"
      aria-expanded={isExpanded}
      onClick={() => setIsExpanded((prev) => !prev)}
      className={`inline-flex shrink-0 items-center justify-center rounded-full transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a]/60 ${
        useExpandableButtonLayout ? 'h-6 w-6' : 'h-7 w-7'
      } ${
        isDarkTheme
          ? 'text-white/72 hover:bg-white/16 hover:text-white'
          : 'text-slate-500 hover:bg-slate-900/[0.06] hover:text-slate-800'
      }`}
    >
      <ChevronDownIcon className={`transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${useExpandableButtonLayout ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${isExpanded ? 'rotate-180' : ''}`} />
    </button>
  );

  if (!shouldUseExpandableDesktop) {
    return (
      <div className={`${containerClassName} ${className ?? ''}`}>
        {SUPPORTED_COUNTRY_TABS.map((item) => {
          const active = item.code === selectedCountry;
          return (
            <button
              key={item.code}
              type="button"
              onClick={() => handleSelectCountry(item.code)}
              className={buttonClassName(active)}
              aria-pressed={active}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`relative inline-flex shrink-0 ${className ?? ''}`}
      onPointerEnter={() => setIsExpanded(true)}
      onPointerLeave={() => setIsExpanded(false)}
      onFocusCapture={() => setIsExpanded(true)}
      onBlurCapture={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget as Node | null)) {
          setIsExpanded(false);
        }
      }}
    >
      <div className={containerClassName}>
        <div
          className={`grid transition-[grid-template-columns,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isExpanded ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden min-w-0 flex justify-end">
            <div className={`flex items-center ${useExpandableButtonLayout ? 'gap-[2px] pr-[2px]' : 'gap-1 pr-1'} w-max shrink-0`}>
              {hiddenTabs.map((item) => {
                const active = item.code === selectedCountry;
                return (
                  <button
                    key={item.code}
                    type="button"
                    onClick={() => handleSelectCountry(item.code)}
                    className={buttonClassName(active)}
                    aria-pressed={active}
                    tabIndex={isExpanded ? 0 : -1}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className={`flex items-center shrink-0 ${useExpandableButtonLayout ? 'gap-[2px]' : 'gap-1'}`}>
          {previewTabs.map((item) => {
            const active = item.code === selectedCountry;
            return (
              <button
                key={item.code}
                type="button"
                onClick={() => handleSelectCountry(item.code)}
                className={buttonClassName(active)}
                aria-pressed={active}
              >
                {item.label}
              </button>
            );
          })}
          {renderChevronButton()}
        </div>
      </div>
    </div>
  );
}
