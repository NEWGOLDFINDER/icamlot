#!/usr/bin/env bash
# Installe (ou met à jour) le compteur de points dans le LXC.
# À lancer en root, dans le LXC, depuis une copie de ce dépôt :
#   bash point-counter/deploy/install.sh
# Option : CF_TUNNEL_TOKEN=<jeton> bash point-counter/deploy/install.sh
#   installe aussi cloudflared et le connecte au tunnel Cloudflare.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "À lancer en root." >&2
  exit 1
fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
WEB=/var/www/point-counter

apt-get update
apt-get install -y nginx curl

# Copie du compteur de points seul (servi comme page d'accueil) + ses icônes.
install -d "$WEB"
install -m 644 "$SRC/calculateur.html" "$WEB/index.html"
for f in opossum-logo.ico opossum-logo.svg opossum-logo-96.png opossum-logo-180.png; do
  install -m 644 "$SRC/$f" "$WEB/$f"
done

install -m 644 "$SRC/deploy/nginx-point-counter.conf" /etc/nginx/sites-available/point-counter
ln -sf /etc/nginx/sites-available/point-counter /etc/nginx/sites-enabled/point-counter
rm -f /etc/nginx/sites-enabled/default
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

echo "OK : compteur de points servi sur http://$(hostname -I | awk '{print $1}')/"
