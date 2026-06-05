// ============================================
// DERIV XAU/USD TRADING BOT - Updated API
// ============================================

const WebSocket = require('ws');

const CONFIG = {
  token: process.env.DERIV_TOKEN,
  symbol: 'frxXAUUSD',
  tradeAmount: 1,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
};

let priceHistory = [];
let isTrading = false;
let ws;

function log(message, type = 'INFO') {
  const time = new Date().toLocaleTimeString();
  const icons = { INFO: '📊', TRADE: '💰', WIN: '✅', LOSS: '❌', ERROR: '⚠️', SIGNAL: '🔔' };
  console.log(`[${time}] ${icons[type] || '📌'} ${message}`);
}

function calculateRSI(prices, period) {
  if (prices.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function analyzeSignal() {
  if (priceHistory.length < 30) {
    log(`Collecting price data... (${priceHistory.length}/30)`);
    return null;
  }
  const prices = priceHistory.map(p => p.price);
  const rsi = calculateRSI(prices, CONFIG.rsiPeriod);
  const ema20 = calculateEMA(prices, 20);
  const currentPrice = prices[prices.length - 1];
  log(`RSI: ${rsi?.toFixed(2)} | EMA20: ${ema20?.toFixed(2)} | Price: ${currentPrice}`);
  if (rsi < CONFIG.rsiOversold && currentPrice > ema20) return 'BUY';
  if (rsi > CONFIG.rsiOverbought && currentPrice < ema20) return 'SELL';
  return null;
}

function connect() {
  log('Connecting to Deriv...', 'INFO');
  // Updated to new Deriv API endpoint
  ws = new WebSocket('wss://green.derivws.com/websockets/v3?app_id=1089');

  ws.on('open', () => {
    log('Connected! Authorizing...', 'INFO');
    ws.send(JSON.stringify({ authorize: CONFIG.token }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    handleMessage(msg);
  });

  ws.on('close', () => {
    log('Connection closed. Reconnecting in 5s...', 'ERROR');
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    log(`WebSocket error: ${err.message}`, 'ERROR');
  });
}

function handleMessage(msg) {
  if (msg.error) {
    log(`API Error: ${msg.error.message}`, 'ERROR');
    return;
  }
  switch (msg.msg_type) {
    case 'authorize':
      log(`Authorized as: ${msg.authorize.email}`, 'INFO');
      log(`Balance: $${msg.authorize.balance}`, 'INFO');
      subscribeToTicks();
      break;
    case 'tick':
      handleTick(msg.tick);
      break;
    case 'buy':
      handleBuy(msg.buy);
      break;
    case 'proposal_open_contract':
      handleContractUpdate(msg.proposal_open_contract);
      break;
  }
}

function subscribeToTicks() {
  log(`Subscribing to ${CONFIG.symbol} price feed...`, 'INFO');
  ws.send(JSON.stringify({ ticks: CONFIG.symbol, subscribe: 1 }));
}

function handleTick(tick) {
  priceHistory.push({ price: tick.quote, time: tick.epoch });
  if (priceHistory.length > 100) priceHistory.shift();
  if (priceHistory.length % 10 !== 0) return;
  if (isTrading) return;
  const signal = analyzeSignal();
  if (signal) {
    log(`Signal detected: ${signal}`, 'SIGNAL');
    placeTrade(signal);
  }
}

function placeTrade(direction) {
  isTrading = true;
  const contractType = direction === 'BUY' ? 'CALL' : 'PUT';
  log(`Placing ${direction} trade...`, 'TRADE');
  ws.send(JSON.stringify({
    buy: 1,
    price: CONFIG.tradeAmount,
    parameters: {
      contract_type: contractType,
      symbol: CONFIG.symbol,
      duration: 5,
      duration_unit: 'm',
      basis: 'stake',
      amount: CONFIG.tradeAmount,
      currency: 'USD'
    }
  }));
}

function handleBuy(buy) {
  log(`Trade opened! Contract: ${buy.contract_id}`, 'TRADE');
  ws.send(JSON.stringify({
    proposal_open_contract: 1,
    contract_id: buy.contract_id,
    subscribe: 1
  }));
}

function handleContractUpdate(contract) {
  if (contract.is_sold) {
    const profit = contract.profit;
    const status = profit > 0 ? 'WIN' : 'LOSS';
    log(`Trade closed! Profit: $${profit.toFixed(2)}`, status);
    isTrading = false;
    setTimeout(() => log('Ready for next trade!', 'INFO'), 30000);
  }
}

log('🤖 DERIV XAU/USD TRADING BOT STARTING...', 'INFO');
log(`Symbol: ${CONFIG.symbol}`, 'INFO');
log(`Trade Amount: $${CONFIG.tradeAmount}`, 'INFO');
log('Using DEMO account - no real money at risk', 'INFO');
log('==========================================', 'INFO');

connect();
