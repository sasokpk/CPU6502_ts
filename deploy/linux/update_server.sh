#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script as root."
  exit 1
fi

PROJECT_DIR="/opt/cpu6502"

if [[ ! -d "${PROJECT_DIR}/.git" ]]; then
  echo "Project not found at ${PROJECT_DIR}"
  exit 1
fi

cd "${PROJECT_DIR}"

git pull
python3 -m pip install -r python/requirements.txt
python3 python/manage.py migrate
npm install
npm run build

systemctl restart cpu6502-backend
systemctl restart caddy

systemctl --no-pager --full status cpu6502-backend || true
systemctl --no-pager --full status caddy || true

echo
echo "Update complete."
