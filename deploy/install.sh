#!/usr/bin/env bash
# Installe (ou met à jour) le site ICAM LOT dans le LXC.
# À lancer en root, dans le LXC, depuis /opt/icamlot (copie de ce dépôt) :
#   bash /opt/icamlot/deploy/install.sh
# Options :
#   CF_TUNNEL_TOKEN=<jeton>  installe aussi cloudflared et le connecte au tunnel Cloudflare.
#   ICAMLOT_PASSWORD=<mdp>   mot de passe d'accès au simulateur (obligatoire à la première
#                            installation, conservé ensuite dans /etc/icamlot/api.env).
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "À lancer en root." >&2
  exit 1
fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
WEB=/var/www/icamlot

if [ "$SRC" != /opt/icamlot ]; then
  echo "Le service de l'API attend le dépôt dans /opt/icamlot (ici : $SRC)." >&2
  exit 1
fi

if [ -z "${ICAMLOT_PASSWORD:-}" ] && ! grep -qs '^ICAMLOT_PASSWORD=.' /etc/icamlot/api.env; then
  echo "Donne le mot de passe du simulateur : ICAMLOT_PASSWORD='...' bash $0" >&2
  exit 1
fi

apt-get update
apt-get install -y nginx curl python3

# Pages du site
install -d "$WEB" "$WEB/point-counter" "$WEB/plateau" "$WEB/connexion"
install -m 644 "$SRC/index.html" "$SRC/bareme.js" "$WEB/"
install -m 644 "$SRC/point-counter/index.html" "$WEB/point-counter/index.html"
install -m 644 "$SRC/connexion/index.html" "$WEB/connexion/index.html"
install -m 644 "$SRC/plateau/index.html" "$SRC/plateau/app.js" "$SRC/plateau/table.jpg" "$WEB/plateau/"
rm -rf /var/www/point-counter

# API (connexion + stratégies)
id icamlot >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin icamlot
install -d -o icamlot -g icamlot -m 750 /var/lib/icamlot /var/lib/icamlot/strategies
if [ -n "${ICAMLOT_PASSWORD:-}" ]; then
  install -d -m 750 /etc/icamlot
  (umask 077; printf 'ICAMLOT_PASSWORD=%s\n' "$ICAMLOT_PASSWORD" > /etc/icamlot/api.env)
  chgrp icamlot /etc/icamlot /etc/icamlot/api.env
  chmod 640 /etc/icamlot/api.env
fi
install -m 644 "$SRC/deploy/icamlot-api.service" /etc/systemd/system/icamlot-api.service
systemctl daemon-reload
systemctl enable icamlot-api
systemctl restart icamlot-api

# Nginx
install -m 644 "$SRC/deploy/nginx-icamlot.conf" /etc/nginx/sites-available/icamlot
ln -sf /etc/nginx/sites-available/icamlot /etc/nginx/sites-enabled/icamlot
rm -f /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/point-counter /etc/nginx/sites-available/point-counter
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if [ -n "${CF_TUNNEL_TOKEN:-}" ]; then
  if ! command -v cloudflared >/dev/null; then
    install -d -m 0755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg -o /usr/share/keyrings/cloudflare-main.gpg
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
      > /etc/apt/sources.list.d/cloudflared.list
    apt-get update
    apt-get install -y cloudflared
  fi
  if ! systemctl is-enabled cloudflared >/dev/null 2>&1; then
    cloudflared service install "$CF_TUNNEL_TOKEN"
  fi
fi

echo "OK : site ICAM LOT servi sur http://$(hostname -I | awk '{print $1}')/"
