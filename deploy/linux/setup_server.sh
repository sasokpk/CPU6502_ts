#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

PROJECT_DIR="/opt/cpu6502"
REPO_URL="${REPO_URL:-https://github.com/sasokpk/CPU6502_ts.git}"
DOMAIN="${1:-}"

if [[ -z "${DOMAIN}" ]]; then
  echo "Usage: $0 your-domain.example.com"
  exit 1
fi

apt update
apt install -y python3 python3-pip python3-venv nodejs npm caddy

if [[ ! -d "${PROJECT_DIR}/.git" ]]; then
  git clone "${REPO_URL}" "${PROJECT_DIR}"
fi

cd "${PROJECT_DIR}"

python3 -m pip install -r python/requirements.txt
python3 python/manage.py migrate
npm install
npm run build

install -m 0644 deploy/linux/cpu6502-backend.service /etc/systemd/system/cpu6502-backend.service
sed "s/your-domain.example.com/${DOMAIN}/g" deploy/linux/Caddyfile > /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl enable cpu6502-backend
systemctl restart cpu6502-backend
systemctl restart caddy

systemctl --no-pager --full status cpu6502-backend || true
systemctl --no-pager --full status caddy || true

echo
echo "Setup complete."
echo "Open: https://${DOMAIN}"
