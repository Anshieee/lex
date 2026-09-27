#!/usr/bin/env node
/**
 * @lex/connect — Air-gapped LEX Workbench connection configurator
 *
 * Usage:
 *   npx --registry http://<host-ip>:4873 @lex/connect
 *
 * This CLI:
 * 1. Auto-detects the host machine's local IP address
 * 2. Prints the exact shell export commands needed to tunnel requests to the local vLLM endpoint
 * 3. Verifies the connection works
 *
 * Environment variables:
 *   LEX_VLLM_PORT  - vLLM server port (default: 8000)
 *   LEX_API_KEY    - API key for vLLM (default: lex-local)
 *   LEX_HOST_IP    - Override auto-detected host IP
 */

import { execSync } from 'child_process';
import { networkInterfaces } from 'os';
import { program } from 'commander';

// Try to load local-ip-url for better IP detection
let getLocalIP;
try {
  getLocalIP = require('local-ip-url');
} catch {
  getLocalIP = null;
}

program
  .name('lex-connect')
  .description('Configure air-gapped harness to connect to local LEX vLLM endpoint')
  .version('1.0.0')
  .option('-p, --port <port>', 'vLLM server port', '8000')
  .option('-k, --key <key>', 'API key for vLLM', 'lex-local')
  .option('--host <ip>', 'Override auto-detected host IP')
  .option('--test', 'Test connection to vLLM endpoint')
  .option('--no-color', 'Disable colored output')
  .parse(process.argv);

const options = program.opts();
const VLLM_PORT = options.port;
const API_KEY = options.key;
const OVERRIDE_HOST = options.host;
const TEST_MODE = options.test;
const USE_COLOR = !options.noColor;

// Color helpers
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};

const c = (color, text) => USE_COLOR ? `${colors[color]}${text}${colors.reset}` : text;

function detectLocalIP() {
  // 1. Try override
  if (OVERRIDE_HOST) {
    return OVERRIDE_HOST;
  }

  // 2. Try local-ip-url package
  if (getLocalIP) {
    try {
      const url = getLocalIP('http');
      const match = url.match(/http:\/\/([^:]+):/);
      if (match) return match[1];
    } catch {}
  }

  // 3. Fallback: inspect network interfaces
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip internal, IPv6, and loopback
      if (net.family === 'IPv4' && !net.internal) {
        // Prefer 192.168.x.x, 10.x.x.x, 172.16-31.x.x
        if (/^(192\.168|10\.|172\.(1[6-9]|2[0-9]|3[0-1]))\./.test(net.address)) {
          return net.address;
        }
      }
    }
  }

  // 4. Last resort: try to get IP via hostname
  try {
    const hostname = execSync('hostname -I', { encoding: 'utf-8' }).trim().split(' ')[0];
    if (hostname) return hostname;
  } catch {}

  return '127.0.0.1';
}

async function testConnection(host, port, apiKey) {
  const http = await import('http');

  return new Promise((resolve) => {
    const req = http.request({
      hostname: host,
      port: port,
      path: '/v1/models',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            const modelCount = parsed.data?.length || 0;
            resolve({ success: true, modelCount, data: parsed });
          } catch {
            resolve({ success: true, modelCount: 0, data: {} });
          }
        } else {
          resolve({ success: false, statusCode: res.statusCode, error: data });
        }
      });
    });

    req.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Connection timeout' });
    });

    req.end();
  });
}

function printExports(host, port, apiKey) {
  const baseUrl = `http://${host}:${port}/v1`;

  console.log('');
  console.log(c('bold', '═══════════════════════════════════════════════════════'));
  console.log(c('bold', '  LEX Workbench — Air-Gapped Connection Config'));
  console.log(c('bold', '═══════════════════════════════════════════════════════'));
  console.log('');
  console.log(c('cyan', 'Detected host IP:'), c('bold', host));
  console.log(c('cyan', 'vLLM port:'), c('bold', port));
  console.log(c('cyan', 'API key:'), c('bold', apiKey));
  console.log('');
  console.log(c('yellow', 'Run these commands in your air-gapped development environment:'));
  console.log('');
  console.log(c('green', '# For OpenAI-compatible clients (DeepSeek, Hermes, etc.)'));
  console.log(c('bold', `export OPENAI_BASE_URL="${baseUrl}"`));
  console.log(c('bold', `export OPENAI_API_KEY="${apiKey}"`));
  console.log('');
  console.log(c('green', '# For direct curl testing'));
  console.log(c('bold', `curl ${baseUrl}/models -H "Authorization: Bearer ${apiKey}"`));
  console.log('');
  console.log(c('green', '# For Python OpenAI client'));
  console.log(c('bold', `client = openai.OpenAI(base_url="${baseUrl}", api_key="${apiKey}")`));
  console.log('');
  console.log(c('yellow', 'Note: This configures your LOCAL harness to send requests to the HOST machine.'));
  console.log(c('yellow', 'The host must be reachable on the internal network (same LAN/VPN).'));
  console.log(c('bold', '═══════════════════════════════════════════════════════'));
  console.log('');
}

async function main() {
  const host = detectLocalIP();

  if (host === '127.0.0.1') {
    console.warn(c('yellow', '⚠ Could not detect non-loopback IP. Using 127.0.0.1'));
    console.warn(c('yellow', '   If running on a different machine, use --host <ip>'));
  }

  if (TEST_MODE) {
    console.log(c('cyan', `Testing connection to ${host}:${VLLM_PORT}...`));
    const result = await testConnection(host, VLLM_PORT, API_KEY);
    if (result.success) {
      console.log(c('green', `✓ Connection successful! Found ${result.modelCount} model(s).`));
      if (result.data.data) {
        result.data.data.forEach(m => console.log(`  - ${m.id}`));
      }
      process.exit(0);
    } else {
      console.log(c('red', `✗ Connection failed: ${result.error || result.statusCode}`));
      console.log(c('yellow', 'Ensure vLLM is running on the host machine:'));
      console.log(c('bold', `  python -m vllm.entrypoints.openai.api_server --port ${VLLM_PORT} ...`));
      process.exit(1);
    }
  } else {
    printExports(host, VLLM_PORT, API_KEY);
  }
}

main().catch(err => {
  console.error(c('red', `Error: ${err.message}`));
  process.exit(1);
});