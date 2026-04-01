# CPU6502 React + Django

React UI connects to a Django backend that runs the Python CPU6502 emulator over plain HTTP JSON endpoints.

## Local start

```bash
npm install
python3 -m pip install -r python/requirements.txt
npm run dev:backend
# second terminal:
npm run dev
```

Default local API URL: `/api` proxied by Vite to `http://127.0.0.1:8000`.

## Production-ready changes in project

- Frontend auto-detects API endpoint:
  - if `VITE_API_URL` set -> uses it
  - otherwise uses `/api`
- Django backend runs on `127.0.0.1:8000` by default in local/dev mode
- Windows deploy configs:
  - `deploy/windows/Caddyfile`
  - `deploy/windows/start_backend.ps1`

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

### 6. Run Django backend

```powershell
powershell -ExecutionPolicy Bypass -File C:\cpu6502\CPU6502_ts\deploy\windows\start_backend.ps1
```

Backend listens on `127.0.0.1:8000`, Caddy proxies `/api` to it.

### 7. Check from external network

Open:

- `https://your-domain.example.com`

In browser devtools, app requests should go to:

- `https://your-domain.example.com/api/*`

## Optional env

For fixed frontend endpoint:

Create `.env.production`:

```bash
VITE_API_URL=https://your-domain.example.com/api
```

Then rebuild:

```bash
npm run build
```

## HTTP API

`POST /api/assemble`

```json
{ "source": "LDA 1\nBRK" }
```

`POST /api/run`

```json
{ "source": "CTA\nBRK", "inputs": [5], "maxSteps": 1000 }
```

Response:

```json
{ "program": [...], "trace": [...], "final_state": {...} }
```
