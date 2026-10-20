/* ======================================================================
   BARÈME — partagé par le compteur de points et la simulation du plateau.
   Pour mettre à jour les points (FAQ, nouvelle version du règlement...),
   modifie uniquement BAREME et LIMITES ci-dessous.
   ====================================================================== */

/* Points du règlement Eurobot 2027 — version OFFICIELLE 1.0 (§E et §F) */
const BAREME = {
  pierre: 1,          /* par pierre dans une zone de construction */
  mur: 5,             /* par mur (3 pierres horizontales empilées, zone rectangulaire) */
  tour: 5,            /* par tour (1 pierre verticale, zone circulaire) */
  porte: 20,          /* par porte (2 verticales + 1 linteau) — 1 seule par château */
  graalPresent: 5,    /* Graal présent dans le château */
  graalNiveau: 5,     /* par niveau d'élévation du Graal (1 à 4) */
  retourPartiel: 5,   /* robot principal partiellement dans la salle du trône */
  retourComplet: 10,  /* robot principal complètement dans la salle du trône */
  douve: 5,           /* par douve adverse occupée par un PAMI */
  attaque: 5,         /* au moins un PAMI attaque un PAMI adverse */
  boulet1: 5,         /* au moins 1 boulet dans la cour adverse */
  boulet3: 15         /* bonus si au moins 3 boulets dans la cour adverse */
};
/* Limites (lecture du plan G.1 — à confirmer sur les cotes) */
const LIMITES = {
  pierres: 30,        /* pierres sur la table */
  zonesMur: 5,        /* zones rectangulaires par château (murs + porte) */
  tours: 4,           /* zones circulaires par château */
  douves: 3,          /* douves par château */
  boulets: 10,        /* boulets par équipe */
  niveauMax: 4        /* niveau d'élévation max du Graal */
};
