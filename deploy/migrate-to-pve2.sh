#!/usr/bin/env bash
# Migre le conteneur ICAM LOT (105 sur pve1) vers pve2 (401), avec le GPU de pve2.
# À lancer en root SUR PVE1 (192.168.1.60) :
#   bash migrate-to-pve2.sh            (demande une confirmation)
#   YES=1 bash migrate-to-pve2.sh      (sans confirmation)
#
# Ce que fait le script, dans l'ordre :
#   1. vérifie tout AVANT de toucher au conteneur (SSH vers pve2, numéro 401 libre, GPU présent, place disque) ;
#   2. arrête le conteneur 105 et en fait une sauvegarde (vzdump) ; il reste ARRÊTÉ sur pve1, il n'est pas supprimé ;
#   3. restaure la sauvegarde sur pve2 sous le numéro 401 (disque 5 Go, 6 Go de RAM, démarrage automatique) ;
#   4. donne le GPU de pve2 au conteneur (périphériques /dev/nvidia* partagés) ;
#   5. démarre le conteneur 401 : le tunnel Cloudflare (cloudflared) et le site repartent avec lui, jeton compris ;
#   6. installe dans le conteneur les outils NVIDIA et PyTorch (CUDA) si la place le permet.
# Retour en arrière : pct start 105 sur pve1 (après avoir arrêté 401 sur pve2).
set -euo pipefail

SRC_CT=${SRC_CT:-105}
DST_CT=${DST_CT:-401}
DST_HOST=${DST_HOST:-192.168.1.43}
ROOTFS_GB=${ROOTFS_GB:-5}
MEM_MB=${MEM_MB:-6144}
STORAGE=${STORAGE:-}            # vide : premier stockage de pve2 qui accepte des conteneurs
DUMPDIR=${DUMPDIR:-/var/tmp/icamlot-migration}
SSH="ssh -o BatchMode=yes -o ConnectTimeout=8 root@$DST_HOST"

say() { printf '\n== %s\n' "$*"; }
die() { printf '\nERREUR : %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "à lancer en root."
command -v pct >/dev/null || die "à lancer sur le nœud Proxmox qui héberge le conteneur $SRC_CT (pve1)."

say "1. Vérifications (rien n'est modifié)"
pct status "$SRC_CT" >/dev/null 2>&1 || die "le conteneur $SRC_CT n'existe pas sur ce nœud."
$SSH true 2>/dev/null || die "SSH sans mot de passe vers root@$DST_HOST impossible. Copie ta clé : ssh-copy-id root@$DST_HOST"
$SSH "pct status $DST_CT" >/dev/null 2>&1 && die "le numéro $DST_CT existe déjà sur pve2."
$SSH "test -e /etc/pve/lxc/$DST_CT.conf" && die "le numéro $DST_CT est déjà pris dans le cluster."
$SSH "command -v nvidia-smi >/dev/null && nvidia-smi -L" || die "pas de GPU NVIDIA utilisable sur pve2 (nvidia-smi absent ou en erreur). Installe le pilote NVIDIA sur l'hôte pve2 d'abord."
$SSH "test -e /dev/nvidiactl && test -e /dev/nvidia0" || die "/dev/nvidia0 ou /dev/nvidiactl absent sur pve2 : pilote non chargé."
DRV=$($SSH "nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1")
echo "Pilote NVIDIA de pve2 : $DRV"

if [ -z "$STORAGE" ]; then
  STORAGE=$($SSH "pvesm status --content rootdir 2>/dev/null | awk 'NR>1 && \$3==\"active\" {print \$1; exit}'")
fi
[ -n "$STORAGE" ] || die "aucun stockage de conteneurs actif trouvé sur pve2. Relance avec STORAGE=<nom>."
echo "Stockage utilisé sur pve2 : $STORAGE"

USED_MB=$(pct exec "$SRC_CT" -- sh -c "df -m / | awk 'NR==2{print \$3}'")
echo "Espace utilisé dans le conteneur $SRC_CT : ${USED_MB} Mo ; disque demandé pour $DST_CT : ${ROOTFS_GB} Go"
[ "$USED_MB" -lt $((ROOTFS_GB * 1024 - 300)) ] || die "le conteneur occupe déjà ${USED_MB} Mo : ${ROOTFS_GB} Go est trop juste. Relance avec ROOTFS_GB=<plus>."
FREE_HERE=$(df -m "$(dirname "$DUMPDIR")" | awk 'NR==2{print $4}')
[ "$FREE_HERE" -gt $((USED_MB + 500)) ] || die "pas assez de place pour la sauvegarde dans $(dirname "$DUMPDIR"). Relance avec DUMPDIR=<dossier plus grand>."

cat <<EOF

Résumé : le conteneur $SRC_CT (pve1) va être ARRÊTÉ puis recréé en $DST_CT sur $DST_HOST ($STORAGE, ${ROOTFS_GB} Go, ${MEM_MB} Mo, GPU).
Le site est coupé pendant l'opération. Le conteneur $SRC_CT reste sur pve1, arrêté.
EOF
if [ "${YES:-}" != 1 ]; then
  read -r -p "Continuer ? [oui/N] " rep
  [ "$rep" = "oui" ] || die "annulé, rien n'a été modifié."
fi

say "2. Sauvegarde du conteneur $SRC_CT (il est arrêté)"
mkdir -p "$DUMPDIR"
vzdump "$SRC_CT" --mode stop --compress zstd --dumpdir "$DUMPDIR"
ARCH=$(ls -t "$DUMPDIR"/vzdump-lxc-"$SRC_CT"-*.tar.zst | head -1)
[ -s "$ARCH" ] || die "sauvegarde introuvable dans $DUMPDIR."
echo "Sauvegarde : $ARCH"
# le conteneur d'origine ne doit plus démarrer tout seul (même adresse IP que le nouveau)
pct set "$SRC_CT" --onboot 0

say "3. Copie et restauration sur pve2 en $DST_CT"
$SSH "mkdir -p $DUMPDIR"
scp -q "$ARCH" "root@$DST_HOST:$DUMPDIR/"
REMOTE_ARCH="$DUMPDIR/$(basename "$ARCH")"
$SSH "pct restore $DST_CT '$REMOTE_ARCH' --storage $STORAGE --rootfs $STORAGE:$ROOTFS_GB && pct set $DST_CT --memory $MEM_MB --onboot 1 --hostname icamlot"

say "4. GPU de pve2 pour le conteneur $DST_CT"
$SSH bash -s -- "$DST_CT" <<'REMOTE'
set -euo pipefail
CT=$1
CONF=/etc/pve/lxc/$CT.conf
grep -q 'nvidia' "$CONF" && { echo "GPU déjà configuré."; exit 0; }
# l'unité nvidia-uvm n'existe qu'après un premier appel CUDA
nvidia-modprobe -u -c=0 2>/dev/null || true
{
  echo "# --- GPU NVIDIA (ajouté par migrate-to-pve2.sh) ---"
  for m in $(ls -l /dev/nvidia* /dev/nvidia-caps/* 2>/dev/null | awk '/^c/{gsub(",","",$5); print $5}' | sort -u); do
    echo "lxc.cgroup2.devices.allow: c $m:* rwm"
  done
  for d in /dev/nvidia0 /dev/nvidiactl /dev/nvidia-uvm /dev/nvidia-uvm-tools /dev/nvidia-modeset; do
    [ -e "$d" ] && echo "lxc.mount.entry: $d ${d#/} none bind,optional,create=file"
  done
} >> "$CONF"
cat "$CONF"
REMOTE

say "5. Démarrage du conteneur $DST_CT (site et tunnel Cloudflare repartent avec lui)"
$SSH "pct start $DST_CT"
sleep 12
$SSH "pct exec $DST_CT -- sh -c 'for s in nginx icamlot-api cloudflared; do printf \"%-14s\" \$s; systemctl is-active \$s || true; done'"
$SSH "pct exec $DST_CT -- curl -fsS -o /dev/null -w 'site local : HTTP %{http_code}\n' http://127.0.0.1/ || true"

say "6. Outils GPU dans le conteneur"
MAJOR=${DRV%%.*}
$SSH "pct exec $DST_CT -- bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && (apt-get install -y -qq nvidia-utils-$MAJOR || apt-get install -y -qq nvidia-utils-$MAJOR-server || true); command -v nvidia-smi >/dev/null && nvidia-smi -L || echo \"nvidia-smi absent du conteneur\"'" || true
FREE_MB=$($SSH "pct exec $DST_CT -- sh -c \"df -m / | awk 'NR==2{print \\\$4}'\"")
echo "Place libre dans le conteneur : ${FREE_MB} Mo"
if [ "$FREE_MB" -ge 6500 ]; then
  $SSH "pct exec $DST_CT -- bash -c 'apt-get install -y -qq python3-pip && pip3 install --break-system-packages torch && python3 -c \"import torch; print(\\\"CUDA disponible :\\\", torch.cuda.is_available())\"'" || echo "Installation de PyTorch en échec : voir ci-dessus."
  $SSH "pct exec $DST_CT -- systemctl restart icamlot-api" || true
else
  cat <<EOF
PyTorch (CUDA) pèse environ 5 Go : il ne tient pas dans les ${FREE_MB} Mo libres. Agrandis le disque puis installe-le :
  ssh root@$DST_HOST "pct resize $DST_CT rootfs +8G"
  ssh root@$DST_HOST "pct exec $DST_CT -- bash -c 'apt-get install -y python3-pip && pip3 install --break-system-packages torch && systemctl restart icamlot-api'"
EOF
fi

say "Terminé"
cat <<EOF
Vérifie la page https://icamlot.arkode-studio.fr/ puis l'Atelier Cerveau : la ligne « Entraîneur » doit afficher le GPU (CUDA).
Une fois sûr du résultat, tu pourras supprimer l'ancien conteneur : pct destroy $SRC_CT   (pas fait par ce script)
Retour en arrière : ssh root@$DST_HOST "pct stop $DST_CT" puis pct start $SRC_CT
EOF
