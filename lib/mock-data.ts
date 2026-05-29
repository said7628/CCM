// Exchange logos and colors
export {
  defaultExchangeVisual,
  exchangeConfig,
  getExchangeVisualConfig,
  normalizeExchangeName,
} from "@/lib/exchange-visuals";

// Generate realistic BTC price data for the comparative chart.
export function generatePriceData(basePrice: number, points: number = 30) {
  const data = [];
  let price = basePrice;

  for (let i = 0; i < points; i++) {
    const time = new Date();
    time.setMinutes(time.getMinutes() - (points - i) * 5);

    const binanceOffset = (Math.random() - 0.45) * 82;
    const coinbaseOffset = (Math.random() - 0.5) * 96 + 18;
    const krakenOffset = (Math.random() - 0.48) * 88 - 12;
    const okxOffset = (Math.random() - 0.52) * 76 + 7;

    price += (Math.random() - 0.47) * 42;

    data.push({
      time: time.toLocaleTimeString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      binance: Math.round((price + binanceOffset) * 100) / 100,
      coinbase: Math.round((price + coinbaseOffset) * 100) / 100,
      kraken: Math.round((price + krakenOffset) * 100) / 100,
      okx: Math.round((price + okxOffset) * 100) / 100,
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
    value += (Math.random() - 0.43) * baseValue * volatility;
    data.push({ value: Math.max(0, value) });
  }

  return data;
}

// Mock KPI data
export const initialKPIs = {
  exchangesConnected: 5,
  opportunitiesDetected: 184,
  operationsExecuted: 56,
  pnl: 76745.65,
  pnlPercent: 4.82,
  portfolioValue: 1250000,
  trades: 1482,
  bestTrade: 1224.8,
  riskStatus: "Bajo",
  capitalAllocated: 1250000,
  capitalUsage: 42.7,
};

// BTC order book / exchange prices
export const mockExchangePrices = [
  {
    exchange: "Binance",
    price: 71842.18,
    spread: 0.18,
    bid: 71839.4,
    ask: 71845.2,
    status: "Live",
  },
  {
    exchange: "Kraken",
    price: 71766.92,
    spread: 0.31,
    bid: 71764.1,
    ask: 71770.5,
    status: "Live",
  },
  {
    exchange: "OKX",
    price: 71821.35,
    spread: 0.22,
    bid: 71818.8,
    ask: 71825.6,
    status: "Live",
  },
  {
    exchange: "Coinbase",
    price: 71904.74,
    spread: 0.26,
    bid: 71900.3,
    ask: 71909.9,
    status: "Live",
  },
  {
    exchange: "Bybit",
    price: 71798.6,
    spread: 0.19,
    bid: 71795.7,
    ask: 71801.5,
    status: "Degraded",
  },
];

// Mock opportunities
export const mockOpportunities = [
  {
    id: 1,
    buyExchange: "Kraken",
    sellExchange: "Coinbase",
    spread: 0.38,
    volume: 250000,
    profit: 950.32,
    status: "Executable",
  },
  {
    id: 2,
    buyExchange: "Coinbase",
    sellExchange: "Kraken",
    spread: 0.31,
    volume: 180000,
    profit: 558.14,
    status: "Fees exceeded spread",
  },
  {
    id: 3,
    buyExchange: "Binance",
    sellExchange: "Bybit",
    spread: 0.27,
    volume: 320000,
    profit: 864.21,
    status: "Executable",
  },
  {
    id: 4,
    buyExchange: "Kraken",
    sellExchange: "OKX",
    spread: 0.22,
    volume: 150000,
    profit: 327.48,
    status: "Rejected",
  },
  {
    id: 5,
    buyExchange: "Binance",
    sellExchange: "OKX",
    spread: 0.19,
    volume: 210000,
    profit: 289.71,
    status: "Executable",
  },
];

// Mock balances
export const mockBalances = [
  { name: "Binance", value: 425230.45, percent: 34, color: "#F0B90B" },
  { name: "Coinbase", value: 312540.0, percent: 25, color: "#0052FF" },
  { name: "Kraken", value: 286120.75, percent: 23, color: "#5741D9" },
  { name: "Bybit", value: 156780.3, percent: 13, color: "#F7A600" },
  { name: "OKX", value: 69328.5, percent: 5, color: "#111827" },
];

// Mock recent operations
export const mockOperations = [
  {
    id: 1,
    time: "11:32:18",
    buyExchange: "Kraken",
    sellExchange: "Coinbase",
    pair: "BTC/USDT",
    volume: 200000,
    fee: 92.4,
    slippage: 0.03,
    pnl: 712.45,
    status: "FILLED",
  },
  {
    id: 2,
    time: "11:27:44",
    buyExchange: "Coinbase",
    sellExchange: "Kraken",
    pair: "BTC/USDT",
    volume: 150000,
    fee: 71.1,
    slippage: 0.04,
    pnl: 482.19,
    status: "FILLED",
  },
  {
    id: 3,
    time: "11:22:09",
    buyExchange: "Binance",
    sellExchange: "Bybit",
    pair: "BTC/USDT",
    volume: 250000,
    fee: 118.65,
    slippage: 0.05,
    pnl: 668.31,
    status: "PARTIAL",
  },
  {
    id: 4,
    time: "11:18:33",
    buyExchange: "Kraken",
    sellExchange: "OKX",
    pair: "BTC/USDT",
    volume: 120000,
    fee: 56.9,
    slippage: 0.02,
    pnl: 312.77,
    status: "FILLED",
  },
  {
    id: 5,
    time: "11:14:57",
    buyExchange: "Binance",
    sellExchange: "OKX",
    pair: "BTC/USDT",
    volume: 180000,
    fee: 84.7,
    slippage: 0.08,
    pnl: -42.18,
    status: "REJECTED",
  },
];

// Mock risk metrics
export const mockRiskMetrics = {
  averageLatency: 23,
  currentLatency: 2.8,
  slippage: 0.04,
  circuitBreaker: "Armado",
  rejectedOpportunities: 18,
  netExposure: 42315.6,
  marginUsage: 38.6,
  riskStatus: "Bajo",
};

export const mockCostBreakdown = {
  grossProfit: 86214.3,
  tradingFees: 5218.42,
  slippage: 2840.11,
  latencyPenalty: 1410.12,
  netProfit: 76745.65,
};

// Mock system health
export const mockSystemHealth = {
  uptime: 99.6,
  connectivity: "Óptima",
  marketFeeds: "Óptimos",
  execution: "Óptima",
  database: "Óptima",
  lastCheck: 8,
};

// Strategy info
export const activeStrategy = {
  name: "Triangular BTC",
  capital: 1250000,
  capitalUsage: 42.7,
};
