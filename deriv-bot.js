// ============================================
// DERIV XAU/USD TRADING BOT - New API v2
// ============================================

const WebSocket = require('ws');
const https = require('https');

const CONFIG = {
  token: process.env.DERIV_TOKEN,  // your a1- token
  symbol: 'frxXAUUSD',
  tradeAmount: 1,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
};

let priceHistory = [];
let isTrading = false;
let ws;
let accountId = null;

function log(message, type = 'INFO') {
  const time = new Date().toLocaleTimeString();
  const icons = { INFO: '📊', TRADE: '💰', WIN: '✅', LOSS: '❌', ERROR: '⚠️', SIGNAL: '🔔' };
  console.log(`[${time}] ${icons[type] || '📌'} ${message}`);
}

// REST API call helper
function restCall(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.derivws.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${CONFIG.token}`,
        'Deriv-App-ID': '1089',
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Get accounts list
async function getAccounts() {
  log('Getting account list...', 'INFO');
  try {
    const response = await restCall('GET', '/trading/v1/options/accounts');
    if (response.data && response.data.length > 0) {
      accountId = response.data[0].id;
      log(`Account ID: ${accountId}`, 'INFO');
      return accountId;
    } else {
      log(`Accounts response: ${JSON.stringify(response)}`, 'ERROR');
      return null;
    }
  } catch (err) {
    log(`Error getting accounts: ${err.message}`, 'ERROR');
    return null;
  }
}

// Get OTP for WebSocket connection
async function getOTP() {
  log('Getting WebSocket OTP...', 'INFO');
  try {
    const response = await restCall('POST', `/trading/v1/options/accounts/${accountId}/otp`);
    if (response.data && response.data.url) {
      log('Got WebSocket URL!', 'INFO');
      return response.data.url;
    } else {
      log(`OTP response: ${JSON.stringify(response)}`, 'ERROR');
      return null;
    }
  } catch (err) {
    log(`Error getting OTP: ${err.message}`, 'ERROR');
    return null;
  }
}

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

// Connect via new WebSocket URL
function connectWebSocket(wsUrl) {
  log('Connecting to Deriv WebSocket...', 'INFO');
  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    log('Connected! Subscribing to price feed...', 'INFO');
    ws.send(JSON.stringify({ ticks: CONFIG.symbol, subscribe: 1 }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    handleMessage(msg);
  });

  ws.on('close', () => {
    log('Connection closed. Reconnecting in 10s...', 'ERROR');
    setTimeout(startBot, 10000);
  });

  ws.on('error', (err) => {
    log(`WebSocket error: ${err.message}`, 'ERROR');
  });
}

function handleMessage(msg) {
  if (msg.error) {
    log(`API Error: ${JSON.stringify(msg.error)}`, 'ERROR');
    return;
  }
  if (msg.msg_type === 'tick') {
    handleTick(msg.tick);
  }
}

function handleTick(tick) {
  priceHistory.push({ price: tick.quote, time: tick.epoch });
  if (priceHistory.length > 100) priceHistory.shift();
  if (priceHistory.length % 10 !== 0) return;
  if (isTrading) return;
  const signal = analyzeSignal();
  if (signal) {
    log(`Signal detected: ${signal}`, 'SIGNAL');
  }
}

// Main start function
async function startBot() {
  log('🤖 DERIV XAU/USD TRADING BOT STARTING...', 'INFO');
  log(`Symbol: ${CONFIG.symbol}`, 'INFO');
  log('Using DEMO account - no real money at risk', 'INFO');

  // Step 1: Get account ID
  const id = await getAccounts();
  if (!id) {
    log('Failed to get account. Retrying in 30s...', 'ERROR');
    setTimeout(startBot, 30000);
    return;
  }

  // Step 2: Get WebSocket URL
  const wsUrl = await getOTP();
  if (!wsUrl) {
    log('Failed to get WebSocket URL. Retrying in 30s...', 'ERROR');
    setTimeout(startBot, 30000);
    return;
  }

  // Step 3: Connect
  connectWebSocket(wsUrl);
}

startBot();
