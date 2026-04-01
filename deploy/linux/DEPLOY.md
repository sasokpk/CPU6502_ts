# Linux deploy (Django + Caddy)

## 1. Install packages

```bash
apt update
apt install -y python3 python3-pip python3-venv nodejs npm caddy
```

## 2. Project setup

```bash
cd /opt
git clone https://github.com/sasokpk/CPU6502_ts.git cpu6502
cd /opt/cpu6502
python3 -m pip install -r python/requirements.txt
npm install
python3 python/manage.py migrate
npm run build
```

## 3. Systemd service

```bash
cp /opt/cpu6502/deploy/linux/cpu6502-backend.service /etc/systemd/system/cpu6502-backend.service
systemctl daemon-reload
systemctl enable cpu6502-backend
systemctl restart cpu6502-backend
systemctl status cpu6502-backend --no-pager
```

## 4. Caddy

```bash
cp /opt/cpu6502/deploy/linux/Caddyfile /etc/caddy/Caddyfile
```

Replace `your-domain.example.com` with your real domain, then:

```bash
systemctl restart caddy
systemctl status caddy --no-pager
```

## 5. Update after git pull

```bash
cd /opt/cpu6502
git pull
python3 -m pip install -r python/requirements.txt
python3 python/manage.py migrate
npm install
npm run build
systemctl restart cpu6502-backend
systemctl restart caddy
```
