# Déploiement du compteur de points sur pve1

Seul `calculateur.html` est mis en ligne (servi comme page d'accueil `/`),
avec ses icônes. Nginx sert le site en HTTP dans le LXC ; le HTTPS est assuré
par un tunnel Cloudflare (`cloudflared`) qui tourne dans le même LXC.

## 1. Préparer le LXC (interface Proxmox, nœud pve1)

Dans le LXC libre (template Debian ou Ubuntu), avec un accès Internet sortant :

```bash
apt-get update && apt-get install -y git
git clone -b <branche> https://github.com/NEWGOLDFINDER/icamlot.git /opt/icamlot
```

Dépôt privé : utiliser un jeton GitHub ou copier le dossier `point-counter/`
avec `scp`.

## 2. Créer le tunnel Cloudflare

Tableau de bord Cloudflare → Zero Trust → Networks → Tunnels → *Create a tunnel*
(type Cloudflared). Copier le jeton affiché dans la commande d'installation.

Dans l'onglet *Public Hostname* du tunnel, ajouter :
- Hostname : le sous-domaine choisi sur ton domaine Cloudflare
- Service : `HTTP` → `localhost:80`

## 3. Installer

```bash
CF_TUNNEL_TOKEN='<jeton>' bash /opt/icamlot/point-counter/deploy/install.sh
```

Sans `CF_TUNNEL_TOKEN`, seul Nginx est installé (test en local sur `http://<IP du LXC>/`).

## Mettre à jour

```bash
git -C /opt/icamlot pull
bash /opt/icamlot/point-counter/deploy/install.sh
```
