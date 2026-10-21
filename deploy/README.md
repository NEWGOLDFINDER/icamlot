# Déploiement du site ICAM LOT — icamlot.arkode-studio.fr

Le site est servi par Nginx (HTTP, port 80) dans le LXC 105 du nœud Proxmox
pve1. Le HTTPS est assuré par un tunnel Cloudflare (`cloudflared`) qui tourne
dans le même LXC.

| Chemin            | Contenu                                                          |
|-------------------|------------------------------------------------------------------|
| `/`               | intro tronçonneuse puis accueil (`index.html`)                   |
| `/point-counter/` | compteur de points (public)                                      |
| `/connexion/`     | page de mot de passe du simulateur                               |
| `/plateau/`       | simulation du plateau, réservée aux personnes connectées         |
| `/api/`           | connexion et stratégies (`api/server.py`, service `icamlot-api`) |

Le mot de passe du simulateur n'est jamais dans le dépôt : il est passé à
l'installation et rangé dans `/etc/icamlot/api.env`. Une connexion reste
valable 30 jours ; changer le mot de passe déconnecte tout le monde.

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
CF_TUNNEL_TOKEN='eyJ...' ICAMLOT_PASSWORD='mot-de-passe' bash /opt/icamlot/deploy/install.sh
```

## Mettre à jour

```bash
git -C /opt/icamlot pull
bash /opt/icamlot/deploy/install.sh
```

`install.sh` met le numéro du commit dans les adresses des scripts
(`app.js?v=…`, `bareme.js?v=…`) : après une mise à jour, un simple
rafraîchissement de la page charge la nouvelle version, sans vider le cache ni
les cookies (le navigateur et Cloudflare ne peuvent pas resservir l'ancienne).
La version chargée est affichée dans l'aide du simulateur.

Le mot de passe déjà installé est conservé. Pour le changer, relancer avec
`ICAMLOT_PASSWORD='nouveau' bash /opt/icamlot/deploy/install.sh`.

## Tester en local

```bash
ICAMLOT_PASSWORD=test python api/server.py --static . --data .data/strategies
```

puis ouvrir http://127.0.0.1:8081/ (l'intro se rejoue à chaque chargement).
