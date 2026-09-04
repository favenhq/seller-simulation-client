import { STRIKE_SCALE, type MarketConfig } from "./config.js";

export interface PythSpot {
  readonly price: bigint;
  readonly exponent: number;
  readonly publishTime: number;
}

export async function fetchSpot(market: MarketConfig): Promise<PythSpot> {
  const url = new URL("v2/updates/price/latest", withTrailingSlash(market.hermesUrl));
  url.searchParams.append("ids[]", market.pythFeedId);
  url.searchParams.set("parsed", "true");
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error("pyth_network_error");
  }
  if (!response.ok) throw new Error(`pyth_http_${response.status}`);
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("pyth_invalid_json");
  }
  const record = asRecord(payload, "pyth_invalid_response");
  if (!Array.isArray(record.parsed) || record.parsed.length === 0) {
    throw new Error("pyth_missing_price");
  }
  const parsed = asRecord(record.parsed[0], "pyth_invalid_price");
  const price = asRecord(parsed.price, "pyth_invalid_price");
  const priceValue = decimalString(price.price, "pyth_invalid_price");
  const exponent = numberValue(price.expo, "pyth_invalid_price");
  const publishTime = numberValue(price.publish_time, "pyth_invalid_price");
  const value = BigInt(priceValue);
  if (value <= 0n || !Number.isInteger(exponent) || !Number.isInteger(publishTime)) {
    throw new Error("pyth_invalid_price");
  }
  return { price: value, exponent, publishTime };
}

export function isFreshSpot(spot: PythSpot, nowSeconds: number): boolean {
  return spot.publishTime <= nowSeconds && nowSeconds - spot.publishTime <= 60;
}

export function expiryCandidates(
  now = new Date(),
  minimumLeadSeconds = 8 * 60 * 60 + 5 * 60
): readonly number[] {
  const candidates = [
    atEightUtc(addUtcDays(now, 1)),
    atEightUtc(thisFriday(now)),
    atEightUtc(addUtcDays(thisFriday(now), 7)),
    atEightUtc(lastFridayOfMonth(now.getUTCFullYear(), now.getUTCMonth())),
    atEightUtc(lastFridayOfMonth(now.getUTCFullYear(), now.getUTCMonth() + 1)),
  ];
  const minimum = now.getTime() + minimumLeadSeconds * 1_000;
  return [...new Set(candidates.map((date) => date.getTime()))]
    .filter((milliseconds) => milliseconds > minimum)
    .map((milliseconds) => Math.floor(milliseconds / 1000));
}

export function chooseStrike(spot: PythSpot, isPut: boolean): bigint {
  const wholeDollars = isPut ? floorDollars(spot) : ceilDollars(spot);
  const rounded = isPut
    ? (wholeDollars / 1_000n) * 1_000n
    : ((wholeDollars + 999n) / 1_000n) * 1_000n;
  const offsets = isPut
    ? [-2_000n, -3_000n, -4_000n, -7_000n, -12_000n, -17_000n]
    : [2_000n, 3_000n, 4_000n, 6_000n, 10_000n, 14_000n];
  const strike = rounded + choose(offsets);
  if (strike <= 0n) throw new Error("calculated_strike_not_positive");
  return strike * STRIKE_SCALE;
}

export function requiredCollateral(
  quantity: bigint,
  strike: bigint,
  isPut: boolean,
  quoteDecimals: number,
  baseDecimals: number
): bigint {
  if (!isPut) return quantity;
  const quoteScale = 10n ** BigInt(quoteDecimals);
  const baseScale = 10n ** BigInt(baseDecimals);
  return ceilDivide(quantity * strike * quoteScale, baseScale * STRIKE_SCALE);
}

export function choose<T>(values: readonly T[]): T {
  if (values.length === 0) throw new Error("cannot_choose_from_empty_list");
  return values[Math.floor(Math.random() * values.length)]!;
}

function floorDollars(spot: PythSpot): bigint {
  if (spot.exponent >= 0) return spot.price * 10n ** BigInt(spot.exponent);
  return spot.price / 10n ** BigInt(-spot.exponent);
}

function ceilDollars(spot: PythSpot): bigint {
  if (spot.exponent >= 0) return spot.price * 10n ** BigInt(spot.exponent);
  const divisor = 10n ** BigInt(-spot.exponent);
  return ceilDivide(spot.price, divisor);
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function thisFriday(date: Date): Date {
  const daysUntilFriday = (5 - date.getUTCDay() + 7) % 7;
  return addUtcDays(date, daysUntilFriday);
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function lastFridayOfMonth(year: number, month: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return addUtcDays(lastDay, -((lastDay.getUTCDay() - 5 + 7) % 7));
}

function atEightUtc(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 8));
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function asRecord(value: unknown, reason: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(reason);
  return Object.fromEntries(Object.entries(value));
}

function decimalString(value: unknown, reason: string): string {
  if (typeof value !== "string" || !/^-?\d+$/.test(value)) throw new Error(reason);
  return value;
}

function numberValue(value: unknown, reason: string): number {
  if (typeof value !== "number") throw new Error(reason);
  return value;
}
