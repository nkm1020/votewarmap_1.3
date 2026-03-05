import { NextResponse } from 'next/server';

const DEFAULT_INTERNAL_ERROR_MESSAGE = '서버 오류가 발생했습니다.';

export function internalServerError(
  scope: string,
  detail?: unknown,
  message: string = DEFAULT_INTERNAL_ERROR_MESSAGE,
) {
  if (typeof detail !== 'undefined') {
    console.error(`[${scope}]`, detail);
  } else {
    console.error(`[${scope}] internal server error`);
  }

  return NextResponse.json({ error: message }, { status: 500 });
}
