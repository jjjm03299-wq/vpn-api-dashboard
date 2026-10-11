// App.js - Service Worker Network Proxy & VPN API Endpoint
const CACHE_NAME = 'vpn-proxy-v3';
const APP_VERSION = '2.5.0';
const BUILD_DATE = '2026-10-11';

// Mock state for the VPN session
let vpnState = {
  connected: false,
  country: null,
  countryCode: null,
  ip: '127.0.0.1',
  connectedAt: null,
  bytesTransferred: { upload: 0, download: 0 }
};

// 10 Countries dataset with flags, health status, and baseline latency
const COUNTRIES_DB = [
  { name: 'United States', code: 'US', flag: '🇺🇸', health: 'Optimal', latencyMs: 35 },
  { name: 'United Kingdom', code: 'GB', flag: '🇬🇧', health: 'Optimal', latencyMs: 85 },
  { name: 'Germany', code: 'DE', flag: '🇩🇪', health: 'Optimal', latencyMs: 65 },
  { name: 'Japan', code: 'JP', flag: '🇯🇵', health: 'Good', latencyMs: 140 },
  { name: 'Canada', code: 'CA', flag: '🇨🇦', health: 'Optimal', latencyMs: 45 },
  { name: 'Australia', code: 'AU', flag: '🇦🇺', health: 'Fair', latencyMs: 210 },
  { name: 'Singapore', code: 'SG', flag: '🇸🇬', health: 'Good', latencyMs: 175 },
  { name: 'Switzerland', code: 'CH', flag: '🇨🇭', health: 'Optimal', latencyMs: 70 },
  { name: 'Netherlands', code: 'NL', flag: '🇳🇱', health: 'Optimal', latencyMs: 75 },
  { name: 'France', code: 'FR', flag: '🇫🇷', health: 'Good', latencyMs: 80 }
];

// In-memory logs & activity buffer
let vpnLogs = [
  { timestamp: new Date().toISOString(), level: 'INFO', message: 'Service worker proxy initialized with /api/vpn/test?ms= latency simulation.' }
];

let vpnActivity = [];

// Install and activate lifecycle hooks
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Intercept network requests across browser context
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Check if the request matches our /api/vpn/ namespace
  if (url.pathname.startsWith('/api/vpn')) {
    event.respondWith(handleVpnApiRequest(url, event.request));
    return;
  }

  // Default passthrough for non-proxy web traffic
  event.respondWith(
    fetch(event.request).catch(() => {
      return new Response(JSON.stringify({ error: 'Network trip failed or offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    })
  );
});

async function handleVpnApiRequest(url, request) {
  const path = url.pathname;
  const searchParams = url.searchParams;
  
  // Extract and parse optional ?ms parameter globally or per route
  const simulateMs = parseInt(searchParams.get('ms'), 10);
  if (!isNaN(simulateMs) && simulateMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, simulateMs));
  }

  try {
    // 1. Countries List Endpoint: GET /api/vpn/countries
    if (path === '/api/vpn/countries' && request.method === 'GET') {
      return jsonResponse({
        success: true,
        count: COUNTRIES_DB.length,
        countries: COUNTRIES_DB
      });
    }

    // 2. VPN Status Endpoint: GET /api/vpn/status
    if (path === '/api/vpn/status' && request.method === 'GET') {
      return jsonResponse({
        success: true,
        status: vpnState.connected ? 'CONNECTED' : 'DISCONNECTED',
        session: vpnState
      });
    }

    // 3. Connect VPN Endpoint: POST /api/vpn/connect
    if (path === '/api/vpn/connect' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const targetCode = body.countryCode || 'US';
      const selectedCountry = COUNTRIES_DB.find((c) => c.code === targetCode) || COUNTRIES_DB[0];

      vpnState.connected = true;
      vpnState.country = selectedCountry.name;
      vpnState.countryCode = selectedCountry.code;
      vpnState.ip = generateMockIp(selectedCountry.code);
      vpnState.connectedAt = new Date().toISOString();

      logEvent('INFO', `Connected to VPN server in ${selectedCountry.name} (${selectedCountry.code}) with IP ${vpnState.ip}`);

      return jsonResponse({
        success: true,
        message: `Successfully connected to ${selectedCountry.name}`,
        session: vpnState
      });
    }

    // 4. Disconnect VPN Endpoint: POST /api/vpn/disconnect
    if (path === '/api/vpn/disconnect' && request.method === 'POST') {
      logEvent('INFO', `Disconnected from VPN session (${vpnState.country || 'Unknown'})`);
      
      vpnState.connected = false;
      vpnState.country = null;
      vpnState.countryCode = null;
      vpnState.ip = '127.0.0.1';
      vpnState.connectedAt = null;

      return jsonResponse({
        success: true,
        message: 'Successfully disconnected from VPN'
      });
    }

    // 5. VPN IP Address Endpoint: GET /api/vpn/ip
    if (path === '/api/vpn/ip' && request.method === 'GET') {
      return jsonResponse({
        success: true,
        ip: vpnState.ip,
        protected: vpnState.connected,
        location: vpnState.country || 'Local Network'
      });
    }

    // 6. VPN Logs Endpoint: GET /api/vpn/logs
    if (path === '/api/vpn/logs' && request.method === 'GET') {
      return jsonResponse({
        success: true,
        logs: vpnLogs.slice(-50)
      });
    }

    // 7. VPN Activity / Traffic Endpoint: GET /api/vpn/activity
    if (path === '/api/vpn/activity' && request.method === 'GET') {
      trackActivity();
      return jsonResponse({
        success: true,
        activity: vpnActivity.slice(-20),
        totals: vpnState.bytesTransferred
      });
    }

    // 8. VPN Health Check Endpoint: GET /api/vpn/health
    if (path === '/api/vpn/health' && request.method === 'GET') {
      const overallHealth = COUNTRIES_DB.every(c => c.health === 'Optimal' || c.health === 'Good') ? 'HEALTHY' : 'DEGRADED';
      return jsonResponse({
        success: true,
        status: overallHealth,
        serviceWorker: 'active',
        timestamp: new Date().toISOString(),
        nodesChecked: COUNTRIES_DB.length
      });
    }

    // 9. Dedicated Test Endpoint with ?ms Latency Simulation: GET /api/vpn/test?ms=
    if (path === '/api/vpn/test') {
      const sleepDelay = !isNaN(simulateMs) ? simulateMs : 0;
      return jsonResponse({
        success: true,
        endpoint: '/api/vpn/test',
        delayedByMs: sleepDelay,
        timestamp: new Date().toISOString(),
        queryReceived: Object.fromEntries(searchParams.entries())
      });
    }

    // 10. VPN Version Endpoint: GET /api/vpn/version
    if (path === '/api/vpn/version' && request.method === 'GET') {
      return jsonResponse({
        success: true,
        version: APP_VERSION,
        buildDate: BUILD_DATE,
        engine: 'ServiceWorkerProxy'
      });
    }

    // 11. VPN Info Endpoint: GET /api/vpn/info
    if (path === '/api/vpn/info' && request.method === 'GET') {
      return jsonResponse({
        success: true,
        name: 'Browser Context VPN Proxy',
        description: 'Service Worker intercepting requests to mimic a full VPN gateway API daemon.',
        totalEndpoints: 11,
        activeNodes: COUNTRIES_DB.length,
        state: vpnState
      });
    }

    // Default fallback for unmatched sub-routes under /api/vpn
    return jsonResponse({ success: false, error: 'Endpoint not found' }, 404);

  } catch (err) {
    logEvent('ERROR', err.message);
    return jsonResponse({ success: false, error: err.message }, 500);
  }
}

// Utility Helpers
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function logEvent(level, message) {
  const entry = { timestamp: new Date().toISOString(), level, message };
  vpnLogs.push(entry);
  if (vpnLogs.length > 100) vpnLogs.shift();
}

function trackActivity() {
  if (!vpnState.connected) return;
  const up = Math.floor(Math.random() * 50000) + 1000;
  const down = Math.floor(Math.random() * 200000) + 5000;
  
  vpnState.bytesTransferred.upload += up;
  vpnState.bytesTransferred.download += down;

  vpnActivity.push({
    timestamp: new Date().toISOString(),
    uploadBytes: up,
    downloadBytes: down,
    node: vpnState.countryCode
  });
  if (vpnActivity.length > 50) vpnActivity.shift();
}

function generateMockIp(countryCode) {
  const octet = Math.floor(Math.random() * 200) + 10;
  return `185.${octet}.${Math.floor(Math.random() * 254)}.${Math.floor(Math.random() * 254)}`;
}
