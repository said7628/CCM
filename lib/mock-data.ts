// Exchange logos and colors
export const exchangeConfig: Record<
  string,
  { color: string; bgColor: string; icon: string }
> = {
  Binance: { color: "#F0B90B", bgColor: "#FEF9E7", icon: "B" },
  Coinbase: { color: "#0052FF", bgColor: "#E6EFFF", icon: "C" },
  Kraken: { color: "#5741D9", bgColor: "#EFECFB", icon: "K" },
  Bybit: { color: "#F7A600", bgColor: "#FEF5E6", icon: "BY" },
  OKX: { color: "#000000", bgColor: "#F0F0F0", icon: "O" },
};

// Generate realistic BTC price data
export function generatePriceData(basePrice: number, points: number = 30) {
  const data = [];
  let price = basePrice;

  for (let i = 0; i < points; i++) {
    const time = new Date();
    time.setMinutes(time.getMinutes() - (points - i) * 5);

    const binanceOffset = (Math.random() - 0.5) * 100;
    const coinbaseOffset = (Math.random() - 0.5) * 100;
    const krakenOffset = (Math.random() - 0.5) * 100;

    price += (Math.random() - 0.48) * 50;

    data.push({
      time: time.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      binance: Math.round((price + binanceOffset) * 100) / 100,
      coinbase: Math.round((price + coinbaseOffset) * 100) / 100,
      kraken: Math.round((price + krakenOffset) * 100) / 100,
    });
  }

  return data;
}

// Generate sparkline data
export function generateSparklineData(
  baseValue: number,
  points: number = 12,
  volatility: number = 0.02
) {
  const data = [];
  let value = baseValue;

  for (let i = 0; i < points; i++) {
    value += (Math.random() - 0.45) * baseValue * volatility;
    data.push({ value: Math.max(0, value) });
  }

  return data;
}

// Mock KPI data
export const initialKPIs = {
  exchangesConnected: 8,
  opportunitiesDetected: 24,
  operationsExecuted: 56,
  pnl: 12842.36,
  pnlPercent: 2.18,
};

// Mock opportunities
export const mockOpportunities = [
  {
    id: 1,
    buyExchange: "Kraken",
    sellExchange: "Binance",
    spread: 0.38,
    volume: 250000,
    profit: 950.32,
  },
  {
    id: 2,
    buyExchange: "Coinbase",
    sellExchange: "Kraken",
    spread: 0.31,
    volume: 180000,
    profit: 558.14,
  },
  {
    id: 3,
    buyExchange: "Binance",
    sellExchange: "Bybit",
    spread: 0.27,
    volume: 320000,
    profit: 864.21,
  },
  {
    id: 4,
    buyExchange: "Kraken",
    sellExchange: "Coinbase",
    spread: 0.22,
    volume: 150000,
    profit: 327.48,
  },
  {
    id: 5,
    buyExchange: "Binance",
    sellExchange: "OKX",
    spread: 0.19,
    volume: 210000,
    profit: 289.71,
  },
];

// Mock balances
export const mockBalances = [
  { name: "Binance", value: 425230.45, percent: 34, color: "#F0B90B" },
  { name: "Coinbase", value: 312540.0, percent: 25, color: "#0052FF" },
  { name: "Kraken", value: 286120.75, percent: 23, color: "#5741D9" },
  { name: "Bybit", value: 156780.3, percent: 13, color: "#F7A600" },
  { name: "OKX", value: 69328.5, percent: 5, color: "#1E1E1E" },
];

// Mock recent operations
export const mockOperations = [
  {
    id: 1,
    time: "11:32:18",
    buyExchange: "Kraken",
    sellExchange: "Binance",
    pair: "BTC/USDT",
    volume: 200000,
    pnl: 712.45,
  },
  {
    id: 2,
    time: "11:27:44",
    buyExchange: "Coinbase",
    sellExchange: "Kraken",
    pair: "BTC/USDT",
    volume: 150000,
    pnl: 482.19,
  },
  {
    id: 3,
    time: "11:22:09",
    buyExchange: "Binance",
    sellExchange: "Bybit",
    pair: "BTC/USDT",
    volume: 250000,
    pnl: 668.31,
  },
  {
    id: 4,
    time: "11:18:33",
    buyExchange: "Kraken",
    sellExchange: "Coinbase",
    pair: "BTC/USDT",
    volume: 120000,
    pnl: 312.77,
  },
  {
    id: 5,
    time: "11:14:57",
    buyExchange: "Binance",
    sellExchange: "OKX",
    pair: "BTC/USDT",
    volume: 180000,
    pnl: 241.09,
  },
];

// Mock risk metrics
export const mockRiskMetrics = {
  latency: 23,
  slippage: 0.04,
  circuitBreaker: "Activo",
  rejectedOpportunities: 18,
  netExposure: 42315.6,
  marginUsage: 38.6,
};

// Mock system health
export const mockSystemHealth = {
  uptime: 99.6,
  connectivity: "Optima",
  marketFeeds: "Optima",
  execution: "Optima",
  database: "Optima",
  lastCheck: 8,
};

// Strategy info
export const activeStrategy = {
  name: "Triangular BTC",
  capital: 1250000,
  capitalUsage: 42.7,
};
