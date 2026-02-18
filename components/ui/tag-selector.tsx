'use client';

import { Check, ChevronsUpDown, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ClassValue = string | false | null | undefined;

function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}

function roughlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.5;
}

type TagSelectorProps<T> = {
  availableTags: T[];
  selectedTags: T[];
  onChange: (tags: T[]) => void;
  getValue: (tag: T) => string;
  getLabel: (tag: T) => string;
  placeholder?: string;
  inputPlaceholder?: string;
  emptyMessage?: string;
  loadingMessage?: string;
  heading?: string;
  className?: string;
  isLoading?: boolean;
  disabled?: boolean;
  allowClear?: boolean;
  multiple?: boolean;
  inputValue?: string;
  onInputValueChange?: (value: string) => void;
  renderOption?: (tag: T) => ReactNode;
  createTag?: (inputValue: string) => T;
  allowCreate?: boolean;
};

export function TagSelector<T>({
  availableTags,
  selectedTags,
  onChange,
  getValue,
  getLabel,
  placeholder = '선택',
  inputPlaceholder = '검색',
  emptyMessage = '결과가 없습니다.',
  loadingMessage = '불러오는 중...',
  heading = '옵션',
  className,
  isLoading = false,
  disabled = false,
  allowClear = true,
  multiple = true,
  inputValue,
  onInputValueChange,
  renderOption,
  createTag,
  allowCreate = false,
}: TagSelectorProps<T>) {
  const [open, setOpen] = useState(false);
  const [internalInputValue, setInternalInputValue] = useState('');
  const [panelPlacement, setPanelPlacement] = useState<'top' | 'bottom'>('bottom');
  const [panelMaxHeight, setPanelMaxHeight] = useState(224);
  const [panelLeft, setPanelLeft] = useState(0);
  const [panelTop, setPanelTop] = useState(0);
  const [panelWidth, setPanelWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelMetricsRef = useRef<{
    placement: 'top' | 'bottom';
    maxHeight: number;
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const isInputControlled = inputValue !== undefined;
  const currentInputValue = isInputControlled ? inputValue : internalInputValue;
  const normalizedInputValue = currentInputValue.trim().toLowerCase();

  const selectedValueSet = useMemo(
    () => new Set(selectedTags.map((tag) => getValue(tag))),
    [getValue, selectedTags],
  );

  const filteredTags = useMemo(
    () =>
      availableTags.filter((tag) => {
        const label = getLabel(tag).toLowerCase();
        const matches = !normalizedInputValue || label.includes(normalizedInputValue);
        if (!matches) {
          return false;
        }

        if (!multiple) {
          return true;
        }

        return !selectedValueSet.has(getValue(tag));
      }),
    [availableTags, getLabel, getValue, multiple, normalizedInputValue, selectedValueSet],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!containerRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const recalculatePanel = () => {
      const triggerRect = triggerRef.current?.getBoundingClientRect();
      if (!triggerRect) {
        return;
      }

      const viewportMargin = 12;
      const panelGap = 6;
      const idealHeight = 320;
      const visualViewport = window.visualViewport;
      const viewportLeft = visualViewport?.offsetLeft ?? 0;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportRight = viewportLeft + (visualViewport?.width ?? window.innerWidth);
      const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight);
      const availableBelow = viewportBottom - triggerRect.bottom - viewportMargin;
      const availableAbove = triggerRect.top - viewportTop - viewportMargin;
      const shouldOpenTop = availableBelow < idealHeight && availableAbove > availableBelow;
      const availableHeight = shouldOpenTop ? availableAbove : availableBelow;
      const computedMaxHeight = Math.max(96, Math.floor(Math.max(0, availableHeight - panelGap)));
      const maxPanelWidth = Math.max(180, Math.floor(viewportRight - viewportLeft - viewportMargin * 2));
      const computedWidth = Math.max(140, Math.min(triggerRect.width, maxPanelWidth));
      const leftMin = viewportLeft + viewportMargin;
      const leftMax = viewportRight - viewportMargin - computedWidth;
      const rawLeft = triggerRect.left;
      const computedLeft = Math.min(Math.max(rawLeft, leftMin), leftMax);
      const rawTop = shouldOpenTop ? triggerRect.top - panelGap - computedMaxHeight : triggerRect.bottom + panelGap;
      const topMin = viewportTop + viewportMargin;
      const topMax = viewportBottom - viewportMargin - computedMaxHeight;
      const computedTop = Math.min(Math.max(rawTop, topMin), topMax);
      const nextPlacement: 'top' | 'bottom' = shouldOpenTop ? 'top' : 'bottom';
      const nextMetrics = {
        placement: nextPlacement,
        maxHeight: computedMaxHeight,
        left: computedLeft,
        top: computedTop,
        width: computedWidth,
      };
      const prevMetrics = panelMetricsRef.current;
      if (
        prevMetrics &&
        prevMetrics.placement === nextMetrics.placement &&
        roughlyEqual(prevMetrics.maxHeight, nextMetrics.maxHeight) &&
        roughlyEqual(prevMetrics.left, nextMetrics.left) &&
        roughlyEqual(prevMetrics.top, nextMetrics.top) &&
        roughlyEqual(prevMetrics.width, nextMetrics.width)
      ) {
        return;
      }

      panelMetricsRef.current = nextMetrics;
      setPanelPlacement(nextMetrics.placement);
      setPanelMaxHeight(nextMetrics.maxHeight);
      setPanelLeft(nextMetrics.left);
      setPanelTop(nextMetrics.top);
      setPanelWidth(nextMetrics.width);
    };

    let rafId = 0;
    const scheduleRecalculate = () => {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        recalculatePanel();
      });
    };

    const visualViewport = window.visualViewport;
    scheduleRecalculate();
    window.addEventListener('resize', scheduleRecalculate);
    window.addEventListener('orientationchange', scheduleRecalculate);
    window.addEventListener('scroll', scheduleRecalculate, true);
    visualViewport?.addEventListener('resize', scheduleRecalculate);
    visualViewport?.addEventListener('scroll', scheduleRecalculate);
    return () => {
      if (rafId !== 0) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener('resize', scheduleRecalculate);
      window.removeEventListener('orientationchange', scheduleRecalculate);
      window.removeEventListener('scroll', scheduleRecalculate, true);
      visualViewport?.removeEventListener('resize', scheduleRecalculate);
      visualViewport?.removeEventListener('scroll', scheduleRecalculate);
    };
  }, [open]);

  const setNextInputValue = (nextValue: string) => {
    if (!isInputControlled) {
      setInternalInputValue(nextValue);
    }
    onInputValueChange?.(nextValue);
  };

  const clearInputValue = () => {
    setNextInputValue('');
  };

  const handleSelect = (value: string) => {
    const existingTag = availableTags.find((tag) => getValue(tag) === value);
    if (!existingTag) {
      return;
    }

    if (multiple) {
      if (selectedValueSet.has(value)) {
        onChange(selectedTags.filter((tag) => getValue(tag) !== value));
      } else {
        onChange([...selectedTags, existingTag]);
      }
    } else {
      onChange([existingTag]);
      setOpen(false);
    }

    clearInputValue();
  };

  const handleCreate = () => {
    if (!allowCreate || !createTag) {
      return;
    }

    const trimmed = currentInputValue.trim();
    if (!trimmed) {
      return;
    }

    const createdTag = createTag(trimmed);
    if (multiple) {
      onChange([...selectedTags, createdTag]);
    } else {
      onChange([createdTag]);
      setOpen(false);
    }
    clearInputValue();
  };

  const handleRemove = (value: string) => {
    onChange(selectedTags.filter((tag) => getValue(tag) !== value));
  };

  const canCreate =
    allowCreate &&
    createTag &&
    normalizedInputValue !== '' &&
    !availableTags.some((tag) => getLabel(tag).trim().toLowerCase() === normalizedInputValue);

  return (
    <div ref={containerRef} className={cx('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setOpen((prev) => !prev);
          }
        }}
        className={cx(
          'flex min-h-10 w-full items-center gap-1 rounded-xl border border-white/14 bg-white/8 px-2 py-1.5 text-left text-sm text-white transition',
          disabled ? 'cursor-not-allowed opacity-60' : 'hover:bg-white/10',
        )}
      >
        {selectedTags.length > 0 ? (
          <>
            <span className="flex flex-wrap items-center gap-1">
              {selectedTags.map((tag) => (
                <span
                  key={getValue(tag)}
                  className="inline-flex items-center gap-1 rounded bg-white/15 px-2 py-1 text-xs text-white"
                >
                  <span className="max-w-[11rem] truncate">{getLabel(tag)}</span>
                  {allowClear ? (
                    <span
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer rounded p-0.5 text-white/85 transition hover:bg-[#ff6b0033] hover:text-[#ffd2a8]"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRemove(getValue(tag));
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          handleRemove(getValue(tag));
                        }
                      }}
                    >
                      <X size={12} />
                    </span>
                  ) : null}
                </span>
              ))}
            </span>
            <span className="ml-auto" />
          </>
        ) : (
          <span className="text-white/50">{placeholder}</span>
        )}
        <ChevronsUpDown className="ml-auto h-4 w-4 text-white/50" />
      </button>

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={panelRef}
              className={cx(
                'fixed z-[110] overflow-hidden rounded-xl border border-white/14 bg-[rgba(26,26,30,0.98)] shadow-[0_14px_38px_rgba(0,0,0,0.45)] backdrop-blur-xl',
                panelPlacement === 'top' ? 'origin-bottom' : 'origin-top',
              )}
              style={{
                left: `${panelLeft}px`,
                top: `${panelTop}px`,
                width: `${Math.max(160, panelWidth)}px`,
                maxHeight: `${panelMaxHeight}px`,
              }}
            >
              <div className="border-b border-white/10 p-2">
                <input
                  value={currentInputValue}
                  onChange={(event) => setNextInputValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canCreate) {
                      event.preventDefault();
                      handleCreate();
                    }
                  }}
                  placeholder={inputPlaceholder}
                  className="h-9 w-full rounded-lg border border-white/14 bg-white/8 px-2.5 text-sm text-white outline-none placeholder:text-white/45 focus:border-[#ff9f0a66]"
                />
              </div>

              <div className="overflow-y-auto p-1.5" style={{ maxHeight: `${Math.max(40, panelMaxHeight - 56)}px` }}>
                <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                  {heading}
                </p>

                {isLoading ? (
                  <p className="px-2 py-2 text-xs text-white/70">{loadingMessage}</p>
                ) : filteredTags.length === 0 ? (
                  <p className="px-2 py-2 text-xs text-white/60">{emptyMessage}</p>
                ) : (
                  filteredTags.map((tag) => {
                    const value = getValue(tag);
                    const selected = selectedValueSet.has(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleSelect(value)}
                        className={cx(
                          'mb-1 flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-sm transition last:mb-0',
                          selected ? 'bg-[#ff6b0033] text-[#ffd2a8]' : 'text-white/85 hover:bg-white/10',
                        )}
                      >
                        <Check className={cx('mt-0.5 h-4 w-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
                        <span className="min-w-0 flex-1">
                          {renderOption ? renderOption(tag) : <span className="break-words">{getLabel(tag)}</span>}
                        </span>
                      </button>
                    );
                  })
                )}

                {canCreate ? (
                  <div className="mt-1 border-t border-white/10 pt-1">
                    <p className="px-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-white/45">
                      생성
                    </p>
                    <button
                      type="button"
                      onClick={handleCreate}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-white/85 transition hover:bg-white/10"
                    >
                      <Check className="h-4 w-4 shrink-0 opacity-100" />
                      <span>Create &quot;{currentInputValue.trim()}&quot;</span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
