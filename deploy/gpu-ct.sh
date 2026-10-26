#!/usr/bin/env bash
# Donne le GPU NVIDIA de l'hôte Proxmox à un conteneur (déjà configuré pour /dev/nvidia*) et installe PyTorch dedans.
# À lancer en root SUR L'HÔTE qui porte le conteneur (pve2) :
#   bash gpu-ct.sh 401
# Principe : le pilote reste sur l'hôte ; on monte dans le conteneur, en lecture seule, les bibliothèques du pilote
# (libcuda, libnvidia-ml...) et nvidia-smi de l'hôte, donc exactement la même version, sans rien installer côté pilote.
# Options : GROW_GB=8 (agrandissement du disque, 0 pour ne pas toucher), SKIP_TORCH=1.
set -euo pipefail

CT=${1:?numéro du conteneur, ex. : bash gpu-ct.sh 401}
GROW_GB=${GROW_GB:-8}
CONF=/etc/pve/lxc/$CT.conf
LIBDIR=usr/lib/x86_64-linux-gnu

die() { echo "ERREUR : $*" >&2; exit 1; }
[ -f "$CONF" ] || die "le conteneur $CT n'est pas sur ce nœud."
command -v nvidia-smi >/dev/null || die "nvidia-smi absent de l'hôte."
V=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1)
echo "Pilote de l'hôte : $V"
grep -q 'lxc.cgroup2.devices.allow: c 195' "$CONF" || die "règles cgroup du GPU absentes de $CONF (migrate-to-pve2.sh, étape 4)."

echo "== Disque"
CUR=$(pct config "$CT" | sed -n 's/^rootfs:.*size=\([0-9]*\)G.*/\1/p')
echo "Disque actuel : ${CUR:-?} Go"
if [ "$GROW_GB" -gt 0 ] && [ "${CUR:-0}" -lt 12 ]; then
  pct resize "$CT" rootfs "+${GROW_GB}G"
fi

echo "== Bibliothèques du pilote montées dans le conteneur"
if grep -q '# libs NVIDIA' "$CONF"; then
  echo "déjà fait."
else
  {
    echo "# libs NVIDIA (pilote $V, montées depuis l'hôte)"
    for name in libcuda libnvidia-ml libnvidia-ptxjitcompiler libnvidia-nvvm libnvidia-cfg libnvidia-opencl; do
      f=$(find /usr/lib -name "$name.so.$V" 2>/dev/null | head -1)
      [ -n "$f" ] && echo "lxc.mount.entry: $f $LIBDIR/$(basename "$f") none bind,ro,optional,create=file"
    done
    echo "lxc.mount.entry: $(command -v nvidia-smi) usr/bin/nvidia-smi none bind,ro,optional,create=file"
  } >> "$CONF"
  grep -A12 '# libs NVIDIA' "$CONF"
fi

echo "== Redémarrage du conteneur"
pct reboot "$CT" || { pct stop "$CT" || true; pct start "$CT"; }
sleep 15
pct exec "$CT" -- ldconfig
pct exec "$CT" -- nvidia-smi -L || die "nvidia-smi ne voit pas le GPU dans le conteneur."

if [ "${SKIP_TORCH:-}" = 1 ]; then echo "PyTorch ignoré (SKIP_TORCH=1)."; exit 0; fi
echo "== PyTorch (CUDA) dans le conteneur : téléchargement de plusieurs Go, patience"
pct exec "$CT" -- bash -c 'export DEBIAN_FRONTEND=noninteractive; df -h / | tail -1; apt-get install -y -qq python3-pip && pip3 install --break-system-packages --no-cache-dir torch'
pct exec "$CT" -- python3 -c 'import torch; print("CUDA disponible :", torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else "pas de GPU vu par torch")'
pct exec "$CT" -- systemctl restart icamlot-api
echo "Terminé : l'Atelier Cerveau doit afficher le GPU (CUDA)."
