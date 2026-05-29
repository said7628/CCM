export interface ExchangeVisualConfig {
  label: string;
  bgColor: string;
  textColor: string;
  iconColor: string;
  icon: string;
  /** Backwards-compatible alias for older dashboard components. */
  color: string;
}

const DEFAULT_COLORS = {
  bgColor: "#F1F5F9",
  textColor: "#334155",
  iconColor: "#475569",
};

export const defaultExchangeVisual: ExchangeVisualConfig = {
  label: "Exchange",
  bgColor: DEFAULT_COLORS.bgColor,
  textColor: DEFAULT_COLORS.textColor,
  iconColor: DEFAULT_COLORS.iconColor,
  icon: "?",
  color: DEFAULT_COLORS.iconColor,
};

const exchangeAliases: Record<string, string> = {
  binance: "Binance",
  coinbase: "Coinbase",
  kraken: "Kraken",
  bybit: "Bybit",
  okx: "OKX",
  kucoin: "KuCoin",
  bitstamp: "Bitstamp",
  bitfinex: "Bitfinex",
  gate: "Gate.io",
  "gate.io": "Gate.io",
};

export const normalizeExchangeName = (exchange?: string | null): string => {
  const raw = String(exchange ?? "").trim();
  if (!raw) return defaultExchangeVisual.label;

  const key = raw.toLowerCase();
  if (exchangeAliases[key]) return exchangeAliases[key];

  return raw
    .split(/([\s._-]+)/)
    .map((part) => (/^[\s._-]+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join("");
};

const makeConfig = (config: Omit<ExchangeVisualConfig, "color">): ExchangeVisualConfig => ({
  ...config,
  color: config.iconColor,
});

export const exchangeConfig: Record<string, ExchangeVisualConfig> = {
  Binance: makeConfig({ label: "Binance", textColor: "#854D0E", bgColor: "#FFF8D8", iconColor: "#B8860B", icon: "B" }),
  Coinbase: makeConfig({ label: "Coinbase", textColor: "#0052FF", bgColor: "#EAF1FF", iconColor: "#0052FF", icon: "C" }),
  Kraken: makeConfig({ label: "Kraken", textColor: "#5741D9", bgColor: "#EFECFB", iconColor: "#5741D9", icon: "K" }),
  Bybit: makeConfig({ label: "Bybit", textColor: "#92400E", bgColor: "#FFF5DF", iconColor: "#C88400", icon: "BY" }),
  OKX: makeConfig({ label: "OKX", textColor: "#111827", bgColor: "#F1F5F9", iconColor: "#111827", icon: "O" }),
  KuCoin: makeConfig({ label: "KuCoin", textColor: "#047857", bgColor: "#ECFDF5", iconColor: "#059669", icon: "KC" }),
  Bitstamp: makeConfig({ label: "Bitstamp", textColor: "#0F766E", bgColor: "#CCFBF1", iconColor: "#0F766E", icon: "BS" }),
  Bitfinex: makeConfig({ label: "Bitfinex", textColor: "#15803D", bgColor: "#DCFCE7", iconColor: "#16A34A", icon: "BF" }),
  "Gate.io": makeConfig({ label: "Gate.io", textColor: "#1D4ED8", bgColor: "#DBEAFE", iconColor: "#2563EB", icon: "G" }),
};

export function getExchangeVisualConfig(exchange?: string | null): ExchangeVisualConfig {
  const label = normalizeExchangeName(exchange);
  const known = exchangeConfig[label];
  if (known) return known;

  const initials = label
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
    .slice(0, 2) || defaultExchangeVisual.icon;

  return {
    ...defaultExchangeVisual,
    label,
    icon: initials,
  };
}
