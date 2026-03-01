export const ADSENSE_CLIENT_ID = 'ca-pub-4483031628547482';

function readSlot(value: string | undefined): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) {
    return null;
  }
  return /^[0-9]+$/.test(normalized) ? normalized : null;
}

export const ADSENSE_SLOTS = {
  mobileDock: readSlot(process.env.NEXT_PUBLIC_ADSENSE_SLOT_MOBILE_DOCK),
  desktopRightPanel: readSlot(process.env.NEXT_PUBLIC_ADSENSE_SLOT_DESKTOP_RIGHT_PANEL),
  desktopBottom:
    readSlot(process.env.NEXT_PUBLIC_ADSENSE_SLOT_DESKTOP_BOTTOM) ??
    readSlot(process.env.NEXT_PUBLIC_ADSENSE_SLOT_MOBILE_DOCK),
  desktopLeftPanel:
    readSlot(process.env.NEXT_PUBLIC_ADSENSE_SLOT_DESKTOP_LEFT_PANEL) ??
    readSlot(process.env.NEXT_PUBLIC_ADSENSE_SLOT_DESKTOP_BOTTOM) ??
    readSlot(process.env.NEXT_PUBLIC_ADSENSE_SLOT_MOBILE_DOCK),
} as const;
