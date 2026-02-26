'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Grid2x2PlusIcon } from 'lucide-react';

export type DesktopTopHeaderLink = {
  key: string;
  label: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
};

export type DesktopTopHeaderAction = {
  key: string;
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: 'ghost' | 'outline' | 'solid';
};

export type DesktopTopHeaderProps = {
  links: DesktopTopHeaderLink[];
  actions?: DesktopTopHeaderAction[];
  brandLabel?: string;
  brandHref?: string;
  className?: string;
  containerClassName?: string;
  visibleFrom?: 'md' | 'lg';
  linksPosition?: 'left' | 'center' | 'right';
  rightSlot?: ReactNode;
};

function joinClasses(...tokens: Array<string | undefined | false | null>): string {
  return tokens.filter(Boolean).join(' ');
}

function getActionClassName(variant: DesktopTopHeaderAction['variant']): string {
  if (variant === 'solid') {
    return 'border border-[#ff9f0a88] bg-[#ff6b00] text-white hover:bg-[#ff7a1f]';
  }
  if (variant === 'outline') {
    return 'border border-white/20 bg-white/6 text-white/88 hover:bg-white/12 hover:text-white';
  }
  return 'border border-transparent bg-transparent text-white/78 hover:bg-white/10 hover:text-white';
}

function HeaderLink({
  label,
  active,
  href,
  onClick,
}: {
  label: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const className = joinClasses(
    'inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a]',
    active ? 'bg-white/14 text-[#ffbf84]' : 'text-white/72 hover:bg-white/10 hover:text-white',
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-current={active ? 'page' : undefined} className={className}>
        {label}
      </button>
    );
  }

  if (href) {
    return (
      <Link href={href} aria-current={active ? 'page' : undefined} className={className}>
        {label}
      </Link>
    );
  }

  return (
    <span aria-current={active ? 'page' : undefined} className={className}>
      {label}
    </span>
  );
}

function HeaderAction({
  label,
  href,
  onClick,
  variant = 'outline',
}: {
  label: string;
  href?: string;
  onClick?: () => void;
  variant?: DesktopTopHeaderAction['variant'];
}) {
  const className = joinClasses(
    'inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ff9f0a]',
    getActionClassName(variant),
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {label}
      </button>
    );
  }

  if (href) {
    return (
      <Link href={href} className={className}>
        {label}
      </Link>
    );
  }

  return <span className={className}>{label}</span>;
}

export function DesktopTopHeader({
  links,
  actions = [],
  brandLabel = 'Vote War Map',
  brandHref = '/',
  className,
  containerClassName,
  visibleFrom = 'md',
  linksPosition = 'center',
  rightSlot,
}: DesktopTopHeaderProps) {
  const visibilityClass = visibleFrom === 'lg' ? 'hidden lg:block' : 'hidden md:block';
  const linksPositionClass =
    linksPosition === 'right' ? 'justify-end' : linksPosition === 'left' ? 'justify-start' : 'justify-center';

  return (
    <header
      className={joinClasses(
        visibilityClass,
        'sticky top-0 z-50 w-full py-2',
        className,
      )}
    >
      <nav
        className={joinClasses(
          'mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between rounded-2xl border border-white/12 bg-[rgba(12,18,28,0.72)] px-4 backdrop-blur-2xl sm:px-5 lg:px-6',
          containerClassName,
        )}
      >
        <Link href={brandHref} className="inline-flex items-center gap-2 text-white">
          <Grid2x2PlusIcon className="h-5 w-5" />
          <span className="font-mono text-base font-bold">{brandLabel}</span>
        </Link>

        <div className={joinClasses('mx-4 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto', linksPositionClass)}>
          {links.map((link) => (
            <HeaderLink
              key={link.key}
              label={link.label}
              active={link.active}
              href={link.href}
              onClick={link.onClick}
            />
          ))}
        </div>

        <div className="flex items-center gap-2">
          {actions.map((action) => (
            <HeaderAction
              key={action.key}
              label={action.label}
              href={action.href}
              onClick={action.onClick}
              variant={action.variant}
            />
          ))}
          {rightSlot}
        </div>
      </nav>
    </header>
  );
}
