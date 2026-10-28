#!/usr/bin/env bash
# Rendu complet du documentaire avec la voix : vérifie, prépare la voix et la musique, rend l'image en parallèle, assemble.
# Usage : bash rendu_complet.sh            (1080p)      DPR=2 bash rendu_complet.sh   (4K)
# Variables : WORKERS (processus de rendu en parallèle, défaut 3), DPR (1 = 1080p, 2 = 4K), PORT (défaut 8765), FRAMES (test : nombre d'images)
set -euo pipefail
cd "$(dirname "$0")"
DPR=${DPR:-1}; WORKERS=${WORKERS:-3}; PORT=${PORT:-8765}; export PORT
SUFFIX=$([ "$DPR" = "2" ] && echo 4k || echo 1080p); OUT=${OUT:-ICAMLOT_documentaire_cerveau_voix_$SUFFIX.mp4}
for c in node npm python3 ffmpeg ffprobe; do command -v $c >/dev/null || { echo "Manque : $c"; exit 1; }; done
python3 -c 'import numpy' || { echo "Manque : numpy (pip install numpy)"; exit 1; }
[ -f voix/voix.mp3 ] || { echo "Placez la voix ElevenLabs dans video/documentaire/voix/voix.mp3"; exit 1; }
[ -d node_modules/three ] && [ -d node_modules/playwright ] || { npm install --no-save three@0.169.0 playwright@1.48.2 && npx playwright install --with-deps chromium; }
echo "== voix : placement et sous-titres"; (cd voix && python3 plan_voix.py) && cp voix/voix_plan.json voix/voix_placee.wav .
echo "== musique"; python3 audio_voix.py
echo "== mixage"
ffmpeg -y -v error -i voix_placee.wav -i musique_voix.wav -filter_complex "[0:a]aformat=channel_layouts=mono,highpass=f=70,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,volume=1.6,asplit=2[v1][vkey];[1:a]volume=0.55[m];[m][vkey]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=350[md];[v1]pan=stereo|c0=c0|c1=c0[vs];[md][vs]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-15:TP=-1.5:LRA=11[out]" -map "[out]" -ar 48000 mix_voix.wav
python3 -m http.server $PORT >/dev/null 2>&1 & SRV=$!; trap 'kill $SRV 2>/dev/null || true' EXIT; sleep 2
[ -f gpu_config.json ] || { echo "== test du GPU"; node gpucheck.js; }
DUREE=$(python3 -c "import json; print(json.load(open('voix_plan.json'))['duree'])"); N=$(python3 -c "print(round($DUREE*30))"); N=${FRAMES:-$N}
echo "== rendu : $N images, $WORKERS processus, DPR $DPR"; mkdir -p rendu; : > rendu/parts.txt; PIDS=()
for ((i=0; i<WORKERS; i++)); do a=$(( i*N/WORKERS )); b=$(( (i+1)*N/WORKERS ))
  PAGE=index.html node render.js $a $b rendu/part$i.mp4 $DPR > rendu/log$i.txt 2>&1 & PIDS+=($!); echo "file part$i.mp4" >> rendu/parts.txt; done
for p in "${PIDS[@]}"; do wait $p; done
grep -h '^ERR' rendu/log*.txt && { echo "Erreur de rendu (voir rendu/log*.txt)"; exit 1; } || true
echo "== assemblage"; ffmpeg -y -v error -f concat -i rendu/parts.txt -i mix_voix.wav -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart "$OUT"
ffprobe -v error -show_entries stream=codec_name,width,height,nb_frames:format=duration,size -of compact "$OUT"
echo "Terminé : $(pwd)/$OUT"
