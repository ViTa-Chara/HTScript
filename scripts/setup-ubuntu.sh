#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/storyboard-studio}"
APP_USER="${APP_USER:-storyboard}"
DB_NAME="${DB_NAME:-storyboard}"
DB_USER="${DB_USER:-storyboard}"
DB_PASSWORD="${DB_PASSWORD:-storyboard}"

if [[ "$EUID" -ne 0 ]]; then
  echo "Please run as root: sudo APP_DIR=/opt/storyboard-studio $0"
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl gnupg git postgresql postgresql-contrib nginx

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash "$APP_USER"
fi

sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
SQL

mkdir -p "$APP_DIR" "$APP_DIR/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

cat > /etc/systemd/system/storyboard-studio.service <<SERVICE
[Unit]
Description=Storyboard Studio
After=network.target postgresql.service

[Service]
Type=simple
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
EnvironmentFile=$APP_DIR/apps/backend/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
echo "Base server packages are ready. Copy the project into $APP_DIR, configure apps/backend/.env, then run scripts/start-production.sh."
