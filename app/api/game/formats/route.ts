import { NextResponse } from 'next/server';
import { getPublicGameFormats } from '@/lib/game/formats';
import type { GameFormatsResponse } from '@/lib/game/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET() {
  const items = getPublicGameFormats();

  const payload: GameFormatsResponse = {
    items,
    meta: {
      itemCount: items.length,
      randomStrategy: 'fully_random',
    },
  };

  return NextResponse.json(payload);
}
