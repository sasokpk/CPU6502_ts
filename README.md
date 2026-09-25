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

### Телефон не заходит (частые причины)

1. **Неверный IP** — в терминале Vite смотрите строку `Телефон (та же Wi‑Fi): http://192.168...`. Не открывайте адрес вида `198.18.x.x` (часто это VPN), если телефон в обычной домашней сети.
2. **VPN на Mac** — временно отключите VPN/WARP и перезапустите `npm run dev`, снова откройте URL с `192.168...`.
3. **Файрвол** — *Системные настройки → Сеть → Файрвол* — разрешите входящие для Node (Vite).
4. **Роутер «изоляция клиентов» (AP isolation)** — в настройках Wi‑Fi иногда запрещён обмен между устройствами; тогда телефон не достучится до ПК.
5. **Явный IP для HMR** — если страница белая или не обновляется: `VITE_DEV_HOST=192.168.x.x npm run dev` (подставьте IP вашего Mac в домашней сети).

