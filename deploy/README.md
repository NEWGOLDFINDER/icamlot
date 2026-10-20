# Déploiement du site ICAM LOT — icamlot.arkode-studio.fr

Le site est servi par Nginx (HTTP, port 80) dans le LXC 105 du nœud Proxmox
pve1. Le HTTPS est assuré par un tunnel Cloudflare (`cloudflared`) qui tourne
dans le même LXC.

| Chemin            | Contenu                                                     |
|-------------------|-------------------------------------------------------------|
| `/`               | intro tronçonneuse puis accueil (`index.html`)              |
| `/point-counter/` | compteur de points                                          |
| `/plateau/`       | simulation du plateau (programmeur de match, table 3D)      |
| `/api/strategies` | API des stratégies (`api/server.py`, service `icamlot-api`) |

Les stratégies sont des fichiers JSON dans `/var/lib/icamlot/strategies`
(un fichier par nom). Pour les sauvegarder, il suffit de copier ce dossier.

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
CF_TUNNEL_TOKEN='eyJ...' ICAMLOT_TOKEN='clé-d-équipe' bash /opt/icamlot/deploy/install.sh
```

`ICAMLOT_TOKEN` est facultatif mais conseillé : le site est public, et sans
clé n'importe qui peut enregistrer ou supprimer une stratégie. Avec une clé,
le navigateur la demande une fois au premier enregistrement.

## Mettre à jour

```bash
git -C /opt/icamlot pull
bash /opt/icamlot/deploy/install.sh
```

La clé d'équipe déjà installée est conservée (`/etc/icamlot/api.env`).

## Tester en local

```bash
python api/server.py --static . --data .data/strategies
```

puis ouvrir http://127.0.0.1:8081/ (ajouter `?intro` pour rejouer l'intro).
