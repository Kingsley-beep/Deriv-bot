// ============================================
// DERIV XAU/USD TRADING BOT
// By Atsem Kingsley
// ============================================
// SETUP: Replace YOUR_TOKEN_HERE with your
// Deriv API token before running
// ============================================

const WebSocket = require('ws');

const CONFIG = {
  token: process.env.DERIV_TOKEN, // <-- paste your token here
  symbol: 'frxXAUUSD',      // Gold (XAU/USD)
  tradeAmount: 1,            // $ amount per trade (start small!)
  takeProfitPips: 50,        // take profit in pips
  stopLossPips: 30,          // stop loss in pips
  rsiPeriod: 14,             // RSI period
  rsiOverbought: 70,         // RSI overbought level
  rsiOversold: 30,           // RSI oversold level
};

// Price history for analysis
let priceHistory = [];
let isTrading = false;
let currentContract = null;
let ws;

// ============================================
// LOGGING
// ============================================
function log(message, type = 'INFO') {
  const time = new Date().toLocaleTimeString();
  const icons = { INFO: '📊', TRADE: '💰', WIN: '✅', LOSS: '❌', ERROR: '⚠️', SIGNAL: '🔔' };
  console.log(`[${time}] ${icons[type] || '📌'} ${message}`);
}

// ============================================
// TECHNICAL ANALYSIS
// ============================================

// Calculate RSI
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

// Calculate EMA
function calculateEMA(prices, period) {
  if (prices.length < period) return null;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

// Detect Bullish/Bearish Divergence
function detectDivergence(prices) {
  if (prices.length < 20) return null;
  
  const recent = prices.slice(-20);
  const rsiValues = [];
  
  for (let i = CONFIG.rsiPeriod; i < recent.length; i++) {
    const rsi = calculateRSI(recent.slice(0, i + 1), CONFIG.rsiPeriod);
    if (rsi) rsiValues.push(rsi);
  }
  
  if (rsiValues.length < 5) return null;
  
  const recentPrices = recent.slice(-5);
  const recentRSI = rsiValues.slice(-5);
  
  const priceDown = recentPrices[4] < recentPrices[0];
  const rsiUp = recentRSI[4] > recentRSI[0];
  const priceUp = recentPrices[4] > recentPrices[0];
  const rsiDown = recentRSI[4] < recentRSI[0];
  
  if (priceDown && rsiUp && recentRSI[4] < 45) {
    return 'BULLISH'; // Price down, RSI up = bullish divergence
  }
  if (priceUp && rsiDown && recentRSI[4] > 55) {
    return 'BEARISH'; // Price up, RSI down = bearish divergence
  }
  
  return null;
}

// Main signal analysis
function analyzeSignal() {
  if (priceHistory.length < 30) {
    log(`Collecting price data... (${priceHistory.length}/30)`);
    return null;
  }
  
  const prices = priceHistory.map(p => p.price);
  const rsi = calculateRSI(prices, CONFIG.rsiPeriod);
  const ema20 = calculateEMA(prices, 20);
  const ema50 = calculateEMA(prices, Math.min(50, prices.length));
  const divergence = detectDivergence(prices);
  const currentPrice = prices[prices.length - 1];
  
  log(`RSI: ${rsi?.toFixed(2)} | EMA20: ${ema20?.toFixed(2)} | Price: ${currentPrice} | Divergence: ${divergence || 'None'}`);
  
  // BUY signal: RSI oversold + bullish divergence + price above EMA20
  if (
    rsi < CONFIG.rsiOversold &&
    divergence === 'BULLISH' &&
    currentPrice > ema20
  ) {
    return 'BUY';
  }
  
  // SELL signal: RSI overbought + bearish divergence + price below EMA20
  if (
    rsi > CONFIG.rsiOverbought &&
    divergence === 'BEARISH' &&
    currentPrice < ema20
  ) {
    return 'SELL';
  }
  
  return null;
}

// ============================================
// DERIV WEBSOCKET CONNECTION
// ============================================

function connect() {
  log('Connecting to Deriv...', 'INFO');
  ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
  
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
      log(`Account balance: $${msg.authorize.balance}`, 'INFO');
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

// Subscribe to live price ticks
function subscribeToTicks() {
  log(`Subscribing to ${CONFIG.symbol} price feed...`, 'INFO');
  ws.send(JSON.stringify({
    ticks: CONFIG.symbol,
    subscribe: 1
  }));
}

// Handle each price tick
function handleTick(tick) {
  priceHistory.push({
    price: tick.quote,
    time: tick.epoch
  });
  
  // Keep last 100 prices
  if (priceHistory.length > 100) {
    priceHistory.shift();
  }
  
  // Only analyze every 10 ticks to avoid overtrading
  if (priceHistory.length % 10 !== 0) return;
  
  // Don't trade if already in a position
  if (isTrading) return;
  
  const signal = analyzeSignal();
  
  if (signal) {
    log(`Signal detected: ${signal}`, 'SIGNAL');
    placeTrade(signal);
  }
}

// Place a trade
function placeTrade(direction) {
  isTrading = true;
  const contractType = direction === 'BUY' ? 'CALL' : 'PUT';
  
  log(`Placing ${direction} trade on ${CONFIG.symbol}...`, 'TRADE');
  
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

// Handle trade confirmation
function handleBuy(buy) {
  currentContract = buy.contract_id;
  log(`Trade opened! Contract ID: ${buy.contract_id}`, 'TRADE');
  log(`Buy price: $${buy.buy_price}`, 'TRADE');
  
  // Subscribe to contract updates
  ws.send(JSON.stringify({
    proposal_open_contract: 1,
    contract_id: buy.contract_id,
    subscribe: 1
  }));
}

// Handle contract updates (win/loss)
function handleContractUpdate(contract) {
  if (contract.is_sold) {
    const profit = contract.profit;
    const status = profit > 0 ? 'WIN' : 'LOSS';
    
    log(`Trade closed! Profit: $${profit.toFixed(2)}`, status);
    log(`Entry: ${contract.entry_tick} | Exit: ${contract.exit_tick}`, 'INFO');
    
    isTrading = false;
    currentContract = null;
    
    // Wait 30 seconds before next trade
    log('Waiting 30 seconds before next trade...', 'INFO');
    setTimeout(() => {
      log('Ready for next trade!', 'INFO');
    }, 30000);
  }
}

// ============================================
// START BOT
// ============================================
log('🤖 DERIV XAU/USD TRADING BOT STARTING...', 'INFO');
log(`Symbol: ${CONFIG.symbol}`, 'INFO');
log(`Trade Amount: $${CONFIG.tradeAmount}`, 'INFO');
log(`RSI Period: ${CONFIG.rsiPeriod}`, 'INFO');
log('Using DEMO account - no real money at risk', 'INFO');
log('==========================================', 'INFO');

connect();
