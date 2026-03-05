import crypto from 'node:crypto';
import { normalizeCountryCode } from '@/lib/server/country-policy';

export type PaymentCurrency = 'KRW' | 'USD';
export type PaymentMethod = 'CARD' | 'PAYPAL';
export type PaymentProvider = 'toss';

export type PaymentOrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'CANCELED'
  | 'REFUNDED'
  | 'EXPIRED';

export type SupportProductRow = {
  id: string;
  title: string;
  currency: PaymentCurrency;
  amount_minor: number;
  payment_method: PaymentMethod;
  is_active: boolean;
  sort_order: number;
};

export type TossPayment = {
  paymentKey?: string;
  orderId?: string;
  status?: string;
  method?: string;
  totalAmount?: number;
  currency?: string;
  approvedAt?: string;
  requestedAt?: string;
  [key: string]: unknown;
};

export type TossApiFailure = {
  ok: false;
  status: number;
  errorCode: string;
  message: string;
  payload: unknown;
};

export type TossApiSuccess<T> = {
  ok: true;
  status: number;
  payload: T;
};

const SUPPORTER_ENTITLEMENT_KEY = 'supporter_badge';
const DEFAULT_TOSS_API_BASE_URL = 'https://api.tosspayments.com/v1';

function asBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function safeToNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function toPaymentMethod(raw: string | null | undefined): PaymentMethod {
  return raw === 'PAYPAL' ? 'PAYPAL' : 'CARD';
}

function toPaymentCurrency(raw: string | null | undefined): PaymentCurrency {
  return raw === 'USD' ? 'USD' : 'KRW';
}

function normalizeOrderStatus(status: string | null | undefined): PaymentOrderStatus {
  const normalized = status?.toUpperCase();
  switch (normalized) {
    case 'CONFIRMED':
      return 'CONFIRMED';
    case 'FAILED':
      return 'FAILED';
    case 'CANCELED':
      return 'CANCELED';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'EXPIRED':
      return 'EXPIRED';
    default:
      return 'PENDING';
  }
}

export function getSupporterEntitlementKey(): string {
  return SUPPORTER_ENTITLEMENT_KEY;
}

export function isPaymentsEnabled(): boolean {
  return asBoolean(process.env.PAYMENTS_ENABLED, true);
}

export function getTossClientKey(): string {
  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim();
  if (!clientKey) {
    throw new Error('NEXT_PUBLIC_TOSS_CLIENT_KEY 환경변수가 필요합니다.');
  }
  return clientKey;
}

export function getTossConfig(): { apiBaseUrl: string; secretKey: string } {
  const secretKey = process.env.TOSS_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error('TOSS_SECRET_KEY 환경변수가 필요합니다.');
  }

  const configuredBaseUrl = process.env.TOSS_API_BASE_URL?.trim();
  const apiBaseUrl = trimTrailingSlash(configuredBaseUrl || DEFAULT_TOSS_API_BASE_URL);

  return {
    apiBaseUrl,
    secretKey,
  };
}

export function resolveAppBaseUrl(request: Request): string {
  const explicitBaseUrl = process.env.APP_BASE_URL?.trim();
  if (explicitBaseUrl) {
    return trimTrailingSlash(explicitBaseUrl);
  }

  const host =
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    'localhost:3000';
  const protocol =
    request.headers.get('x-forwarded-proto') ??
    (host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https');

  return `${protocol}://${host}`;
}

export function resolveCheckoutPreference(countryCodeRaw: string | null | undefined): {
  countryCode: string;
  currency: PaymentCurrency;
  paymentMethod: PaymentMethod;
} {
  const countryCode = normalizeCountryCode(countryCodeRaw);
  if (countryCode === 'KR') {
    return {
      countryCode,
      currency: 'KRW',
      paymentMethod: 'CARD',
    };
  }

  return {
    countryCode,
    currency: 'USD',
    paymentMethod: 'PAYPAL',
  };
}

export function amountMinorToMajor(currency: PaymentCurrency, amountMinor: number): number {
  if (currency === 'USD') {
    return Math.round((amountMinor / 100) * 100) / 100;
  }
  return amountMinor;
}

export function amountMajorToMinor(currency: PaymentCurrency, amountMajor: number): number {
  if (currency === 'USD') {
    return Math.round(amountMajor * 100);
  }
  return Math.round(amountMajor);
}

export function assertAmountMatches(
  currency: PaymentCurrency,
  expectedMinor: number,
  actualMajor: number,
): boolean {
  const actualMinor = amountMajorToMinor(currency, actualMajor);
  return expectedMinor === actualMinor;
}

export function toProductDto(product: SupportProductRow): {
  id: string;
  title: string;
  currency: PaymentCurrency;
  paymentMethod: PaymentMethod;
  amountMinor: number;
  amount: number;
  sortOrder: number;
} {
  return {
    id: product.id,
    title: product.title,
    currency: toPaymentCurrency(product.currency),
    paymentMethod: toPaymentMethod(product.payment_method),
    amountMinor: product.amount_minor,
    amount: amountMinorToMajor(toPaymentCurrency(product.currency), product.amount_minor),
    sortOrder: product.sort_order,
  };
}

export function generateProviderOrderId(): string {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `SUP_${stamp}_${suffix}`;
}

export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function buildCheckoutUrls(baseUrl: string): {
  successUrl: string;
  failUrl: string;
} {
  return {
    successUrl: `${baseUrl}/my/support/success`,
    failUrl: `${baseUrl}/my/support/fail`,
  };
}

export function mapTossStatusToOrderStatus(rawStatus: string | null | undefined): PaymentOrderStatus {
  const status = String(rawStatus ?? '').trim().toUpperCase();
  switch (status) {
    case 'DONE':
      return 'CONFIRMED';
    case 'CANCELED':
    case 'PARTIAL_CANCELED':
      return 'REFUNDED';
    case 'ABORTED':
      return 'FAILED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'READY':
    case 'IN_PROGRESS':
    case 'WAITING_FOR_DEPOSIT':
    case 'PENDING':
      return 'PENDING';
    default:
      return 'PENDING';
  }
}

export function deriveFailureMessage(payload: unknown): { code: string; message: string } {
  if (!payload || typeof payload !== 'object') {
    return {
      code: 'UNKNOWN_ERROR',
      message: '결제 처리 중 알 수 없는 오류가 발생했습니다.',
    };
  }

  const code = typeof (payload as { code?: unknown }).code === 'string'
    ? ((payload as { code?: string }).code ?? 'UNKNOWN_ERROR')
    : 'UNKNOWN_ERROR';

  const message = typeof (payload as { message?: unknown }).message === 'string'
    ? ((payload as { message?: string }).message ?? '결제 처리에 실패했습니다.')
    : '결제 처리에 실패했습니다.';

  return {
    code,
    message,
  };
}

export async function confirmTossPayment(args: {
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<TossApiSuccess<TossPayment> | TossApiFailure> {
  const { apiBaseUrl, secretKey } = getTossConfig();
  const auth = Buffer.from(`${secretKey}:`).toString('base64');

  const response = await fetch(`${apiBaseUrl}/payments/confirm`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const failure = deriveFailureMessage(payload);
    return {
      ok: false,
      status: response.status,
      errorCode: failure.code,
      message: failure.message,
      payload,
    };
  }

  return {
    ok: true,
    status: response.status,
    payload: (payload ?? {}) as TossPayment,
  };
}

export async function fetchTossPaymentByKey(paymentKey: string): Promise<TossApiSuccess<TossPayment> | TossApiFailure> {
  const { apiBaseUrl, secretKey } = getTossConfig();
  const auth = Buffer.from(`${secretKey}:`).toString('base64');

  const response = await fetch(`${apiBaseUrl}/payments/${encodeURIComponent(paymentKey)}`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${auth}`,
    },
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const failure = deriveFailureMessage(payload);
    return {
      ok: false,
      status: response.status,
      errorCode: failure.code,
      message: failure.message,
      payload,
    };
  }

  return {
    ok: true,
    status: response.status,
    payload: (payload ?? {}) as TossPayment,
  };
}

export function calculatePayloadHash(rawPayload: string): string {
  return crypto.createHash('sha256').update(rawPayload).digest('hex');
}

export function extractTossWebhookCore(payload: unknown): {
  eventType: string;
  providerEventId: string | null;
  paymentKey: string | null;
  orderId: string | null;
  status: string | null;
} {
  const eventTypeRaw =
    (typeof (payload as { eventType?: unknown })?.eventType === 'string'
      ? (payload as { eventType?: string }).eventType
      : null) ??
    (typeof (payload as { type?: unknown })?.type === 'string'
      ? (payload as { type?: string }).type
      : null) ??
    'UNKNOWN';

  const providerEventIdRaw =
    (typeof (payload as { eventId?: unknown })?.eventId === 'string'
      ? (payload as { eventId?: string }).eventId
      : null) ??
    (typeof (payload as { id?: unknown })?.id === 'string'
      ? (payload as { id?: string }).id
      : null) ??
    null;

  const data = (payload as { data?: Record<string, unknown> })?.data ?? null;
  const paymentKeyRaw =
    (typeof data?.paymentKey === 'string' ? data.paymentKey : null) ??
    (typeof (payload as { paymentKey?: unknown })?.paymentKey === 'string'
      ? ((payload as { paymentKey?: string }).paymentKey ?? null)
      : null);
  const orderIdRaw =
    (typeof data?.orderId === 'string' ? data.orderId : null) ??
    (typeof (payload as { orderId?: unknown })?.orderId === 'string'
      ? ((payload as { orderId?: string }).orderId ?? null)
      : null);
  const statusRaw =
    (typeof data?.status === 'string' ? data.status : null) ??
    (typeof (payload as { status?: unknown })?.status === 'string'
      ? ((payload as { status?: string }).status ?? null)
      : null);

  return {
    eventType: eventTypeRaw,
    providerEventId: providerEventIdRaw,
    paymentKey: paymentKeyRaw,
    orderId: orderIdRaw,
    status: statusRaw,
  };
}

export function normalizePaymentOrderStatus(status: string | null | undefined): PaymentOrderStatus {
  return normalizeOrderStatus(status);
}

export function getNumericAmountFromTossPayload(payload: TossPayment): number | null {
  const totalAmount = safeToNumber(payload.totalAmount);
  if (totalAmount === null) {
    return null;
  }
  return totalAmount;
}
