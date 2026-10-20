---
titre: Coupe de France 2026
date: 2026-05-30
resume: Premier accès aux phases finales pour l'équipe !! 
---
Bilan de la Coupe de France de Robotique : Stratégie, PAMIs et rebondissements pour la Team Opossum !

La Coupe de France de Robotique s'est achevée, et il est temps pour l'équipe de faire le traditionnel bilan de cette édition.

Tout d'abord, un immense merci à l'organisation et à tous les bénévoles. C'était, cette année encore, un véritable plaisir de pouvoir participer à cet événement et d'échanger avec toutes les équipes présentes !

# Une nouvelle approche : La stratégie avant tout
Après avoir abandonné la "mécanique actionneur" l'année dernière dans le but de développer une base mécanique et logicielle la plus solide possible, l'objectif pour nous était clair cette année : jouer stratégique.

Fini les scripts pré-programmés ! Notre robot analysait la situation en direct et choisissait ses actions en totale autonomie. Nous lui donnions seulement des poids pour définir les actions prioritaires, et il se débrouillait. Résultat ? Un robot extrêmement plaisant à voir évoluer sur la table, capable de partir jouer côté adverse et de voler des objets avec opportunisme.

Cependant, nous l'avons vite compris : si cette méthode offre un beau spectacle, elle n'est absolument pas optimale pour s'assurer des points sûrs en phases de poules. C'est un axe d'amélioration majeur pour nous.

# L'arrivée des PAMIs dans l'équipe
Pour cette édition, nous avons également développé nos premiers PAMIs (Petits Actionneurs Mobiles Indépendants). Grandement inspirés par ceux de l'équipe TDS, nos petits "minions" n'étaient pas très rapides au début, avec une localisation assez imprécise en début de Coupe.

Heureusement, au fur et à mesure des matchs, la situation s'est nettement améliorée. Nous avons terminé la compétition avec 4 PAMIs fiables qui arrivent toujours à leur destination !

# Le point noir de l'édition : L'évitement et ses dilemmes
S'ils arrivaient à destination, un problème majeur est venu jouer les trouble-fêtes : l'évitement.

Nos PAMIs sont équipés d'un évitement dynamique situé juste au-dessus des caisses de noisettes. Le souci ? Si des caisses étaient placées en biais dans les zones de dépose, elles se retrouvaient à hauteur du lidar. Le PAMI tentait alors de les éviter et n'arrivait jamais à destination.

De son côté, notre gros robot adaptait parfaitement sa stratégie s'il rencontrait un robot adverse, mais il n'évitait pas les PAMIs. Lors de l'homologation, nous avons convenu d'un compromis avec les arbitres : après la 85e seconde, nous baissions la vitesse du robot de 1.5 m/s à 0.3 m/s pour ne pas risquer d'abîmer les PAMIs que nous ne pouvions pas détecter.

# Retour sur nos matchs : Des hauts et des sueurs froides
Match 1 : Notre robot part jouer en zone adverse. Face à une proximité évidente, le robot adverse nous rentre dedans. Les arbitres nous demandent d'élargir notre périmètre d'évitement. Malgré cela, nous sommes ravis de la prestation de notre machine : le robot bouge beaucoup, tourne autour de l'adversaire et ramasse même mieux qu'à l'entraînement !

Match 2 : On s'exécute et on élargit l'évitement. Premier problème : cela rentre en conflit avec notre stratégie et le robot se bloque souvent. Pire, alors que notre robot est de l'autre côté, le PAMI des Karibelles se trouve près d'un palais que nous essayons de ramasser. Résultat : Arrêt d'urgence et avertissement. Nous avons une mesure de couple sur notre pince pour qu'elle lâche prise si elle force, donc aucun dégât n'a été causé, mais l'épée de Damoclès est là. Si on retouche un PAMI, c'est la pénalité. Nous devons désormais stopper définitivement nos matchs à 85s.

Match 3 (vs Azbot) : Un match super sympa ! Notre robot réussit à voler deux stacks déposés par l'adversaire. Conscient que ce n'est pas forcément "l'esprit des poules", on s'en excuse, mais la réaction d'Azbot a été géniale. Merci à eux !

Match 4 : Un match presque nominal. Le robot fait de bons choix, les PAMIs font le job, mais l'évitement trop large continue de coincer le robot de temps en temps.

Match 5 (vs TDS) : Le meilleur match de notre Coupe ! Beaucoup de mouvements, des vols de part et d'autre, et des PAMIs holonomes qui s'animent en fin de match des deux côtés. C'est exactement ce qu'on voulait voir ! Il n'a manqué qu'un seul stack non touché à la fin.

# Phases finales : L'ascenseur émotionnel
En 8ème de finale, fini les arrêts à 85s, il faut jouer les 100 secondes complètes !
Notre parade : forcer nos PAMIs à jouer dans notre dos, et garder les pinces baissées en mode "chasse-neige" pour repousser les objets sans écraser un potentiel PAMI. Théoriquement, on se place près de leur zone, on pousse les objets de l'adversaire, et on y dépose les nôtres.

Le drame : Le robot adverse reste posé devant nous quand nous sommes devant leur zone. Avec notre évitement élargi, notre robot se retrouve totalement bloqué. Conclusion des arbitres : non-fairplay pour être resté devant la zone des PAMIs (obstruction). Verdict : 50 points de pénalité.

Pour le match suivant contre Team Diff, nous devons abandonner cette stratégie et revenir aux paramètres de poule. Malheureusement, le retard pris à discuter avec l'arbitrage nous empêche d'effectuer nos réglages (le fameux git checkout sur une ancienne branche en backstage...). Nous sommes éliminés.

# Conclusion : Ravis, humbles et inspirés !
Malgré cette fin abrupte, nous sommes extrêmement contents de cette Coupe !

Ce que nous en tirons :

Il serait bien plus judicieux de développer un mode "très safe" pour les poules, afin de s'assurer des points sans casser notre stratégie avec des évitements bancals.

Nous aimerions davantage de clarté sur les règles d'évitement à l'avenir (Qui évite qui ? Les mêmes règles pour tous ?). La peur de toucher un PAMI a biaisé nos choix tout au long de l'événement.

Nous avons adoré nos rencontres contre TDS, Hyperion (qui nous a rendu très humbles en vidant la table le temps qu'on ramasse un stack à l'entraînement !) ou encore 7Robot avec qui nous avons pu tester diverses stratégies.

Nous espérons vivement revoir des règlements qui autorisent le vol et poussent les robots à interagir. C'était passionnant à concevoir. Nous sortons de cette Coupe avec la tête pleine d'idées pour l'année prochaine !

Encore merci à l'orga, aux bénévoles, et à toutes les équipes passées discuter à notre stand. La Coupe reste un moment inoubliable !

La Team Opossum

![](photo1.jpg)
