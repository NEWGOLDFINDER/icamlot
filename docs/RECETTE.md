# Recette — voir les changements (main be1239b)

Valeurs attendues = mesures faites dans le simulateur (tests ou navigateur). « non mesuré » = à noter et me renvoyer.

## 0. Mise à jour
```bash
git -C /opt/icamlot pull
bash /opt/icamlot/deploy/install.sh
```
Contrôle : menu Aide du plateau → la version affichée doit être `be1239b`.

## A. Plateau — programme de référence
1. `/plateau/` → **Match** → Adversaire **Aucun**.
2. Onglet **Programme** → **Exemple** (15 étapes).
3. Lecture (bas gauche, 2x).
   - Attendu : **116 pts**, durée **90,3 s**, **Alertes 0**.
   - Panneau *Mesures du robot* en fin : Graal « sur le toit · niveau 4 », Boulets « 10 tirés ».
4. Pendant la lecture :
   - étapes 1 à 12 : prises par les faces A/B (nacelles, rotation 0/90°), murs, tour T2, porte M3 ;
   - étape 13 *Monter le Graal* (53,2–63,2 s) : la fourche de la face C monte le Graal sur le toit ;
   - étape 14 *Séance de tir* : canon sorti (90 mm), trajectoires des boulets.
5. Vues **Table / Dessus / Suivre** : vraie empreinte du robot (triangle tronqué, 3 roues), nacelles, canon, fourche.
6. Briques à ajouter : **Monter Graal** existe ; *prendreGraal / poserGraal* ont disparu.

## B. Plateau — adversaire
1. **Match** → Adversaire **Exemple (miroir)** → relancer.
2. Attendu : **108 pts, 2 erreurs**. Le conflit est voulu : le réseau devra s'adapter.

## C. Cerveau — imitation
1. `/cerveau/` → **Cerveaux** → **Nouveau** → onglet **Construction** : architecture récurrente.
   Nombre d'entrées et de sorties : non mesuré dans le navigateur après la fusion v3 (le moteur donne 75 entrées et 152 actions par défaut).
2. Onglet **Entraînement**, régler :
   - Méthode **Imitation** ;
   - cocher *Inclure la stratégie d'exemple (PROGRAMME_REFERENCE)* ;
   - Scénarios **4**, Époques **200**, Matchs d'évaluation **8**, Adversaire **Aucun** ;
   - puis **Lancer**.

   Ces réglages sont ceux de la mesure. Avec 40 époques (valeur par défaut), le résultat n'est pas mesuré.
3. Attendu (onglet **Évaluation**) : **116 ± 0**, erreurs moteur **0**.
4. Panneau *Serveur* → *Matériel* : indique si le GPU est vu.
5. Onglet **Jouer** → **Charger ce cerveau dans le plateau** → le réseau joue en direct (score : non mesuré).

## D. Cerveau — PPO
1. Méthode **PPO Récurrent**, cocher *Reprendre le modèle actuel*, Adversaire **Réaliste**, puis **Lancer** pour quelques minutes.
2. Attendu : tourne sans erreur. Scores et matchs/s : non mesurés sur le conteneur, à noter.

## À me renvoyer
- Captures de l'onglet Évaluation (C3, D).
- Toute alerte ou erreur affichée.
- La sortie de `node --version` dans le conteneur, si une page ou l'API plante.
