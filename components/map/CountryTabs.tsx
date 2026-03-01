'use client';

import { SUPPORTED_COUNTRY_TABS, type SupportedCountry } from '@/lib/map/countryMapRegistry';

type CountryTabsProps = {
  selectedCountry: SupportedCountry;
  onSelectCountry: (country: SupportedCountry) => void;
  className?: string;
  compact?: boolean;
};

export default function CountryTabs({ selectedCountry, onSelectCountry, className, compact = false }: CountryTabsProps) {
  return (
    <div className={`inline-flex items-center rounded-full border border-white/18 bg-white/8 p-1 ${className ?? ''}`}>
      {SUPPORTED_COUNTRY_TABS.map((item) => {
        const active = item.code === selectedCountry;
        return (
          <button
            key={item.code}
            type="button"
            onClick={() => onSelectCountry(item.code)}
            className={`inline-flex items-center justify-center rounded-full px-2.5 font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a]/60 ${
              compact ? 'h-7 text-[11px]' : 'h-8 text-[12px]'
            } ${
              active
                ? 'bg-white/20 text-white'
                : 'text-white/76 hover:bg-white/12 hover:text-white'
            }`}
            aria-pressed={active}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
