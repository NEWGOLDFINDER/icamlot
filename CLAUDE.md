# ICAM LOT — règles de travail (Claude et agents)

## Règle absolue
Ne rien inventer, ne rien supposer.
- Toute valeur absente de `spec/*.json` devient un paramètre nommé, documenté comme « hypothèse ».
- S'il manque une information à l'équipe, la demander.

## Sources de vérité
- `spec/regles_2027.json`, `spec/robot.json` : règlement et robot, chaque valeur avec sa source.
- `docs/CONTRATS.md` : interfaces et répartition des fichiers entre chantiers.
- `AUDIT_SIMULATEUR_IA.md` : constats et plan.

## Économie de tokens (sans baisse de qualité)
- **Réponses à l'utilisateur** : français, courtes, résultat d'abord. Pas de récapitulatif de ce qui est déjà dit. Un tableau ou une liste plutôt qu'un long texte.
- **Rapports d'avancement** : une ligne par agent (pourcentage et étape en cours), sans détail si rien n'a changé.
- **Lecture du code** : cibler avec `grep`/`sed -n` plutôt que lire des fichiers entiers. Ne jamais relire un fichier déjà en contexte sans raison. Limiter les sorties de commandes (`tail`, `head`, `grep -v` du bruit).
- **Agents** : un chantier = des fichiers possédés + une consigne autonome qui renvoie aux docs (pas de copie de leur contenu). Modèle adapté à la difficulté :
  - Opus : moteur, règles, apprentissage ;
  - Sonnet : intégration, interface, embarqué ;
  - Haiku : documentation et tâches mécaniques.
- **Rapport final des agents** : commits, résultats des tests, hypothèses, points ouverts. Pas de prose. Ne jamais lire les transcriptions des agents.
- **Qualité non négociable** :
  - tests exécutés avant chaque fusion ;
  - mesures réelles plutôt que des estimations ;
  - commit après chaque tâche terminée ;
  - aucun nombre en dur dans le code quand il existe dans la spec.
