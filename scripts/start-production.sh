#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f apps/backend/.env ]]; then
  cp apps/backend/.env.example apps/backend/.env
  echo "Created apps/backend/.env. Edit it before running this script again."
  exit 1
fi

npm ci
npm run prisma:generate
npm run prisma:migrate -- --name init
npm run seed
npm run build

mkdir -p uploads

if command -v systemctl >/dev/null 2>&1 && [[ "${USE_SYSTEMD:-1}" == "1" ]]; then
  sudo systemctl enable storyboard-studio
  sudo systemctl restart storyboard-studio
  sudo systemctl status storyboard-studio --no-pager
else
  npm run start
fi
