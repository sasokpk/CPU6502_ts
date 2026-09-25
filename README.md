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

## Доступ с телефона / другого ПК в той же Wi‑Fi

Vite настроен на `host: true` (слушает все интерфейсы), Django — на `0.0.0.0:8000`.

1. Узнайте IP компьютера в LAN (macOS): `ipconfig getifaddr en0` (или `en1` для Wi‑Fi).
2. Запустите `npm run dev:backend` и `npm run dev`.
3. На другом устройстве откройте `http://<IP>:5173` — запросы к `/api` проксируются на бэкенд на этом же компьютере.

Если страница не открывается, проверьте **файрвол macOS**: разрешите входящие для **Node** и **Python**. В публичных сетях не оставляйте сервер включённым без необходимости.

