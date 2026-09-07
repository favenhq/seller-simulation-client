import {
  CONTRACT_QTY_SCALE,
  PYTH_HERMES_URL,
  STRIKE_SCALE,
  type MarketConfig,
} from "./config.js";

const RISK_FREE_RATE = 0.045;
const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;
const TARGET_DELTAS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] as const;
const strikeGranularities = [
  { minimumSpotDollars: 20_000, granularityDollars: 1_000 },
  { minimumSpotDollars: 100, granularityDollars: 5 },
  { minimumSpotDollars: 10, granularityDollars: 1 },
  { minimumSpotDollars: 0, granularityDollars: 0.5 },
] as const;

export interface PythSpot {
  /** price e8 scale */
  readonly price: bigint;
  /** negative number to indicate decimals points, positive for pow */
  readonly exponent: number;
  /** Unix seconds */
  readonly publishTime: number;
}

export async function fetchSpot(market: MarketConfig): Promise<PythSpot> {
  const url = new URL(
    "v2/updates/price/latest",
    withTrailingSlash(PYTH_HERMES_URL),
  );
  url.searchParams.append("ids[]", market.pythFeedId);
  url.searchParams.set("parsed", "true");
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.PYTH_API_KEY}` },
    });
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
  if (
    value <= 0n ||
    !Number.isInteger(exponent) ||
    !Number.isInteger(publishTime)
  ) {
    throw new Error("pyth_invalid_price");
  }
  return { price: value, exponent, publishTime };
}

export function isFreshSpot(spot: PythSpot, nowSeconds: number): boolean {
  return spot.publishTime <= nowSeconds && nowSeconds - spot.publishTime <= 60;
}

export function expiryCandidates(
  now = new Date(),
  minimumLeadSeconds = 8 * 60 * 60 + 5 * 60,
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

export function chooseStrike(
  spot: PythSpot,
  isPut: boolean,
  expiry: number,
  market: MarketConfig,
  nowSeconds = Date.now() / 1_000,
): bigint {
  return choose(availableStrikes(spot, isPut, expiry, market, nowSeconds));
}

export function availableStrikes(
  spot: PythSpot,
  isPut: boolean,
  expiry: number,
  market: MarketConfig,
  nowSeconds = Date.now() / 1_000,
): readonly bigint[] {
  const spotDollars = spotDollarsNumber(spot);
  const timeToExpiryYears = (expiry - nowSeconds) / SECONDS_PER_YEAR;
  if (!Number.isFinite(timeToExpiryYears) || timeToExpiryYears <= 0) {
    throw new Error("expiry_must_be_in_future");
  }
  const granularity = strikeGranularity(spotDollars);
  const strikes = TARGET_DELTAS.map((targetDelta) =>
    roundToGranularity(
      deltaStrike(
        spotDollars,
        targetDelta,
        isPut,
        timeToExpiryYears,
        market.impliedVolatility,
      ),
      granularity,
    ),
  ).filter((strike) => strike > 0);
  const availableDollars = [...new Set(strikes)];
  if (availableDollars.length === 0)
    throw new Error("no_available_delta_strikes");
  return availableDollars.map(dollarsToStrike);
}

export function requiredCollateralTokenBaseUnits(
  quantityE18: bigint,
  strikeE8: bigint,
  isPut: boolean,
  baseCoinDecimals: number,
  quoteCoinDecimals: number,
): bigint {
  const baseCoinQuantity = quantityE18ToTokenBaseUnits(
    quantityE18,
    baseCoinDecimals,
  );
  if (!isPut) return baseCoinQuantity;

  const baseCoinScale = tokenBaseUnitScale(baseCoinDecimals);
  const quoteCoinScale = tokenBaseUnitScale(quoteCoinDecimals);
  return ceilDivide(
    baseCoinQuantity * strikeE8 * quoteCoinScale,
    baseCoinScale * STRIKE_SCALE,
  );
}

export function choose<T>(values: readonly T[]): T {
  if (values.length === 0) throw new Error("cannot_choose_from_empty_list");
  return values[Math.floor(Math.random() * values.length)]!;
}

function spotDollarsNumber(spot: PythSpot): number {
  const price = Number(spot.price);
  const dollars = price * 10 ** spot.exponent;
  if (!Number.isFinite(dollars) || dollars <= 0)
    throw new Error("invalid_spot_dollars");
  return dollars;
}

function quantityE18ToTokenBaseUnits(
  quantityE18: bigint,
  tokenDecimals: number,
): bigint {
  const tokenScale = tokenBaseUnitScale(tokenDecimals);
  const numerator = quantityE18 * tokenScale;
  if (numerator % CONTRACT_QTY_SCALE !== 0n) {
    throw new Error("unsupported_quantity_precision");
  }
  return numerator / CONTRACT_QTY_SCALE;
}

function tokenBaseUnitScale(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0)
    throw new Error("invalid_token_decimals");
  return 10n ** BigInt(decimals);
}

function strikeGranularity(spotDollars: number): number {
  const rule = strikeGranularities.find(
    (candidate) => spotDollars >= candidate.minimumSpotDollars,
  );
  if (!rule) throw new Error("no_matching_strike_granularity");
  return rule.granularityDollars;
}

function deltaStrike(
  spotDollars: number,
  targetDelta: number,
  isPut: boolean,
  timeToExpiryYears: number,
  impliedVolatility: number,
): number {
  const callDelta = isPut ? 1 - targetDelta : targetDelta;
  const d1 = inverseStandardNormal(callDelta);
  return (
    spotDollars *
    Math.exp(
      (RISK_FREE_RATE + impliedVolatility ** 2 / 2) * timeToExpiryYears -
        d1 * impliedVolatility * Math.sqrt(timeToExpiryYears),
    )
  );
}

function roundToGranularity(price: number, granularity: number): number {
  return Math.round(price / granularity) * granularity;
}

function dollarsToStrike(dollars: number): bigint {
  const scaled = Math.round(dollars * Number(STRIKE_SCALE));
  if (!Number.isSafeInteger(scaled) || scaled <= 0)
    throw new Error("calculated_strike_not_positive");
  return BigInt(scaled);
}

function inverseStandardNormal(probability: number): number {
  if (probability <= 0 || probability >= 1)
    throw new Error("invalid_delta_target");
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269,
    -30.66479806614716, 2.506628277459239,
  ];
  const b = [
    -54.47609879822406, 161.5858368580409, -155.6989798598866,
    66.80131188771972, -13.28068155288572,
  ];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    0.007784695709041462, 0.3224671290700398, 2.445134137142996,
    3.754408661907416,
  ];
  const low = 0.02425;
  const high = 1 - low;
  if (probability < low) {
    const q = Math.sqrt(-2 * Math.log(probability));
    return polynomial(c, q) / (polynomial(d, q) * q + 1);
  }
  if (probability > high) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    return -polynomial(c, q) / (polynomial(d, q) * q + 1);
  }
  const q = probability - 0.5;
  const r = q * q;
  return (polynomial(a, r) * q) / (polynomial(b, r) * r + 1);
}

function polynomial(coefficients: readonly number[], value: number): number {
  return coefficients.reduce(
    (result, coefficient) => result * value + coefficient,
  );
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

function thisFriday(date: Date): Date {
  const daysUntilFriday = (5 - date.getUTCDay() + 7) % 7;
  return addUtcDays(date, daysUntilFriday);
}

function addUtcDays(date: Date, days: number): Date {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days,
    ),
  );
}

function lastFridayOfMonth(year: number, month: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  return addUtcDays(lastDay, -((lastDay.getUTCDay() - 5 + 7) % 7));
}

function atEightUtc(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 8),
  );
}

function withTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function asRecord(value: unknown, reason: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(reason);
  return Object.fromEntries(Object.entries(value));
}

function decimalString(value: unknown, reason: string): string {
  if (typeof value !== "string" || !/^-?\d+$/.test(value))
    throw new Error(reason);
  return value;
}

function numberValue(value: unknown, reason: string): number {
  if (typeof value !== "number") throw new Error(reason);
  return value;
}
