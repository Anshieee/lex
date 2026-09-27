# @lex/connect — Air-Gapped LEX Connection Configurator

Lightweight CLI tool that auto-detects the host machine's local IP and prints the exact shell exports needed for air-gapped development harnesses (DeepSeek, Hermes, etc.) to connect to the local LEX vLLM endpoint.

## Installation (on host machine)

```bash
# 1. Start local Verdaccio registry (air-gapped, no upstream proxies)
verdaccio --config infra/verdaccio-config.yaml

# 2. Publish @lex/connect to local registry
cd infra/lex-connect
npm publish --registry http://localhost:4873
```

## Usage (on air-gapped developer laptop)

```bash
# One-liner to configure connection
npx --registry http://<host-ip>:4873 @lex/connect
```

Output:
```
═══════════════════════════════════════════════════════
  LEX Workbench — Air-Gapped Connection Config
═══════════════════════════════════════════════════════

Detected host IP: 192.168.1.42
vLLM port: 8000
API key: lex-local

Run these commands in your air-gapped development environment:

# For OpenAI-compatible clients (DeepSeek, Hermes, etc.)
export OPENAI_BASE_URL="http://192.168.1.42:8000/v1"
export OPENAI_API_KEY="lex-local"

# For direct curl testing
curl http://192.168.1.42:8000/v1/models -H "Authorization: Bearer lex-local"

# For Python OpenAI client
client = openai.OpenAI(base_url="http://192.168.1.42:8000/v1", api_key="lex-local")

Note: This configures your LOCAL harness to send requests to the HOST machine.
The host must be reachable on the internal network (same LAN/VPN).
═══════════════════════════════════════════════════════
```

## Options

```bash
npx --registry http://<host-ip>:4873 @lex/connect [options]

Options:
  -p, --port <port>       vLLM server port (default: 8000)
  -k, --key <key>         API key for vLLM (default: lex-local)
  --host <ip>             Override auto-detected host IP
  --test                  Test connection to vLLM endpoint
  --no-color              Disable colored output
```

## Test Connection

```bash
# Verify vLLM is reachable from the developer machine
npx --registry http://<host-ip>:4873 @lex/connect --test
```

## How It Works

1. **Auto-detects host IP** — Scans network interfaces for RFC1918 addresses (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
2. **Prints exact exports** — No manual IP lookup or typo-prone copy-paste
3. **Zero-config for developers** — Just run the npx command, copy-paste the exports
4. **Air-gapped by design** — Verdaccio runs with NO upstream proxies; all packages are local

## Development

```bash
cd infra/lex-connect
npm install
node index.js --test  # Test against local vLLM
```

## Files

- `package.json` — Package metadata, bin entry point
- `index.js` — Main CLI logic (auto-detect IP, print exports, test connection)
- `README.md` — This file