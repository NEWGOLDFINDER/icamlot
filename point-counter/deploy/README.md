# Déploiement du compteur de points — icamlot.arkode-studio.fr

`point-counter/index.html` est servi par Nginx (HTTP, port 80) dans un LXC
Ubuntu du nœud Proxmox pve1. Le HTTPS est assuré par un tunnel Cloudflare
(`cloudflared`) qui tourne dans le même LXC.

## 1. Créer le tunnel Cloudflare et récupérer le jeton

Tableau de bord Cloudflare → Zero Trust → Networks → Tunnels → *Create a tunnel*
→ type *Cloudflared* → nommer le tunnel. Cloudflare affiche une commande
`cloudflared service install eyJ...` : la longue chaîne `eyJ...` est le jeton.

Onglet *Public Hostname* du tunnel :
- Subdomain : `icamlot` — Domain : `arkode-studio.fr`
- Service : `HTTP` → `localhost:80`

## 2. Installer dans le LXC (en root)

```bash
apt-get update && apt-get install -y git
git clone https://github.com/NEWGOLDFINDER/icamlot.git /opt/icamlot
CF_TUNNEL_TOKEN='eyJ...' bash /opt/icamlot/point-counter/deploy/install.sh
```

Le site est ensuite en ligne sur https://icamlot.arkode-studio.fr

## Mettre à jour

```bash
git -C /opt/icamlot pull
bash /opt/icamlot/point-counter/deploy/install.sh
```
