# CPU6502 React + WebSocket

React UI connects to Python CPU6502 emulator over WebSocket.

## Local start

```bash
npm install
python3 -m pip install -r python/requirements.txt
npm run dev:ws
# second terminal:
npm run dev
```

Default local WS URL: `ws://127.0.0.1:8765`.

## Production-ready changes in project

- Frontend auto-detects WS endpoint:
  - if `VITE_WS_URL` set -> uses it
  - otherwise uses `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`
- Python WebSocket server reads:
  - `CPU6502_WS_HOST` (default `127.0.0.1`)
  - `CPU6502_WS_PORT` (default `8765`)
- Windows deploy configs:
  - `deploy/windows/Caddyfile`
  - `deploy/windows/start_ws_server.ps1`

## Windows public hosting (any network)

Below is a direct internet hosting setup on a Windows machine.

### 1. Requirements

- Domain name (example: `cpu6502.yourdomain.com`)
- Public IP on your internet router
- Port forwarding from router:
  - `80 -> Windows host`
  - `443 -> Windows host`
- Windows Firewall allow inbound TCP `80`, `443`

### 2. Install software on Windows machine

- Node.js LTS
- Python 3.11+
- Caddy (Windows zip from caddyserver.com)

### 3. Deploy project

```powershell
cd C:\
mkdir cpu6502
cd cpu6502
git clone <YOUR_REPO_URL> CPU6502_ts
cd .\CPU6502_ts
npm install
python -m pip install -r .\python\requirements.txt
npm run build
```

### 4. DNS

Create DNS `A` record:

- host: `cpu6502` (or your chosen subdomain)
- value: your public IP

Wait until DNS resolves.

### 5. Configure Caddy

Edit `deploy/windows/Caddyfile`:

- replace `your-domain.example.com` with your real domain
- if project path differs from `C:\cpu6502\CPU6502_ts`, update `root`

Run Caddy:

```powershell
cd C:\path\to\caddy
.\caddy.exe run --config C:\cpu6502\CPU6502_ts\deploy\windows\Caddyfile
```

Caddy will issue TLS cert automatically and serve HTTPS.

### 6. Run WebSocket backend

```powershell
powershell -ExecutionPolicy Bypass -File C:\cpu6502\CPU6502_ts\deploy\windows\start_ws_server.ps1
```

Backend listens on `127.0.0.1:8765`, Caddy proxies `/ws` to it.

### 7. Check from external network

Open:

- `https://your-domain.example.com`

In browser devtools, websocket should connect to:

- `wss://your-domain.example.com/ws`

## Optional env

For fixed frontend endpoint:

Create `.env.production`:

```bash
VITE_WS_URL=wss://your-domain.example.com/ws
```

Then rebuild:

```bash
npm run build
```

## WebSocket protocol

Request:

```json
{ "id": "1", "type": "assemble", "source": "LDA 1\nBRK" }
```

```json
{ "id": "2", "type": "run", "source": "CTA\nBRK", "inputs": [5], "maxSteps": 1000 }
```

Response:

```json
{ "id": "2", "type": "result", "program": [...], "trace": [...], "final_state": {...} }
```
