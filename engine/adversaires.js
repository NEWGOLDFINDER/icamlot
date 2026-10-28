/* Adversaires et caractéristiques physiques tirées (chantier adversaires, docs/CONTRATS.md §14).

   1. PHYSIQUE : caractéristiques de NOTRE robot (valeurs nominales lues dans spec/robot.json, statut de chaque valeur), tirage
      par match dans des plages réglables (en % ou fixes), observation « physique » (valeurs effectives / nominales).
   2. PROFILS : quatre robots adverses conformes au règlement (périmètre <= 1200 mm au départ, <= 1400 mm déployé, hauteur
      <= 350 mm, évitement obligatoire, pas d'anti-jeu) :
        - batisseur, razzia : préprogrammés (stratégies réactives à règles), mécanismes ABSTRAITS (voir 3) ;
        - champion, intermediaire : réseaux récurrents figés, mêmes mécanismes que notre robot (moteur makeSim), paramètres
          physiques tirés dans leur plage (engine/env.js, opponentSetup).
   3. Robot abstrait (makeRobot) : empreinte (polygone convexe), vitesse, rotation, durées de prise / pose / montée du Graal,
      capacité de transport. Il joue dans le même match que nous (ENGINE.makeDuel) : il réserve les pierres qu'il prend, ses
      pierres posées sont des obstacles pour nous, il s'arrête si nous sommes sur son chemin (distance d'arrêt), et nous
      l'évitons comme n'importe quel adversaire (son empreinte est portée par sa pose : GEOM.hullsHit).
      ABSTRACTION (hypothèses, aucune valeur dans la spec) : une prise ramasse d'un coup les pierres disponibles d'une carrière
      (au plus la capacité) en tPrise ; une construction (mur 3 pierres à plat, tour 1 pierre debout, porte 2 piliers + linteau)
      est posée d'un coup en tPose (porte : facteurPorte × tPose) depuis une pose d'approche hors de la zone ; le Graal est
      pris (tPrise), monté (tGraal) puis posé sur une de ses constructions (tPose) sans quitter le château ; le tir sort le
      canon (tCanon) puis lance un boulet toutes les 1 / cadence s à partir de 85 s, chaque boulet arrivant dans notre cour
      avec la probabilité « precision » (tirée par la graine). Trajets : plus court chemin sur une grille de 50 mm (rayon
      d'enveloppe + marge), vitesse constante plus un temps d'accélération v / acceleration par trajet.
   Toutes les valeurs absentes de la spec sont des paramètres nommés « hypothèse » (HYPOTHESES, PROFILS). */
(function (root) {
  var SPEC = root.SPEC, G = root.GEOM, E = root.ENGINE;
  if (!SPEC || !G || !E) throw new Error('adversaires.js : charger spec/spec.js, engine/geom.js et engine/engine.js d\'abord.');
  var RG = SPEC.regles, RB = SPEC.robot, LIM = RG.robot_limites;
  var MATCH = RG.match.duree_s, T_ATT = RG.match.phase_attaque_debut_s, D2R = Math.PI / 180;
  function val(x) { return x !== null && typeof x === 'object' && 'valeur' in x ? x.valeur : x; }
  function mulberry(seed) {
    var a = (seed >>> 0) || 1;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function hashStr(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rngOf(seed, tag) { return mulberry(((+seed || 0) * 2654435761 + hashStr(tag)) >>> 0); }
  function uni(r, ab) { return ab[0] + (ab[1] - ab[0]) * r(); }
  function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  function round(x, n) { var k = Math.pow(10, n == null ? 3 : n); return Math.round(x * k) / k; }
  function bareme() {
    var B = root.BAREME; if (B) return B;
    var S = RG.bareme;
    return { pierre: S.pierre, mur: S.mur, tour: S.tour, porte: S.porte, graalPresent: S.graal_present, graalNiveau: S.graal_par_niveau, retourPartiel: S.trone_partiel, retourComplet: S.trone_complet, boulet1: S.boulet_au_moins_1, boulet3: S.boulets_au_moins_3_supplement };
  }

  /* ================================================================== 1. caractéristiques physiques de notre robot */
  var ENT = RB.entrainement, NAC = RB.mecanismes.pince_A_et_B, CAN = RB.mecanismes.canon_C, ASC = RB.mecanismes.ascenseur_graal;
  var DECL = ((RB._declarations_equipe || {})['2026-10-28_durees'] || {}).valeurs || {};
  /* statut dans la spec : celui du champ s'il en porte un, « déclaré » s'il figure dans les déclarations de l'équipe du 2026-10-28,
     sinon « hérité » (valeur par défaut de l'ancien simulateur, à mesurer par l'équipe) */
  function statutOf(o, decl) { if (o && typeof o === 'object' && o.statut) return o.statut; if (decl && DECL[decl] != null) return 'declare'; return 'herite'; }
  var GRAAL_PLAGE = (ASC.duree_montee_s && ASC.duree_montee_s.plage) || null;
  /* id = clé du paramètre du moteur (ENGINE.DEF) ; facteur : unité affichée = valeur du moteur × facteur ; plage par défaut :
     ± pct % (hypothèse proposée à l'équipe : 15 %) ou [min, max] en unité affichée (montée du Graal : plage déclarée de la spec) */
  var PCT_DEFAUT = 15;
  var PHYSIQUE = [
    { id: 'v', nom: 'Vitesse de déplacement', unite: 'mm/s', facteur: 1000, source: 'entrainement.vitesse_lineaire_mm_s', statut: statutOf(ENT.vitesse_lineaire_mm_s) },
    { id: 'va', nom: 'Vitesse d\'approche', unite: 'mm/s', facteur: 1000, source: 'entrainement.vitesse_approche_mm_s', statut: statutOf(ENT.vitesse_approche_mm_s, 'vitesse_approche_mm_s') },
    { id: 'w', nom: 'Rotation de la base', unite: '°/s', facteur: 1, source: 'entrainement.vitesse_rotation_deg_s', statut: statutOf(ENT.vitesse_rotation_deg_s) },
    { id: 'vz', nom: 'Vitesse des vérins Z', unite: 'mm/s', facteur: 1, source: 'mecanismes.pince_A_et_B.vitesse_chariot_mm_s', statut: statutOf(NAC.vitesse_chariot_note) },
    { id: 'trot', nom: 'Rotation 90° des nacelles', unite: 's', facteur: 1, source: 'mecanismes.pince_A_et_B.rotation_duree_s_pour_90deg', statut: statutOf(null, 'rotation_90deg_nacelle_s') },
    { id: 'tvac', nom: 'Prise par le vide', unite: 's', facteur: 1, source: 'mecanismes.pince_A_et_B.prise_vide_s', statut: statutOf(null, 'prise_vide_s') },
    { id: 'trel', nom: 'Lâcher', unite: 's', facteur: 1, source: 'mecanismes.pince_A_et_B.relache_s', statut: statutOf(null, 'relache_s') },
    { id: 'tMonteeGraal', nom: 'Montée du Graal', unite: 's', facteur: 1, source: 'mecanismes.ascenseur_graal.duree_montee_s', statut: statutOf(ASC.duree_montee_s), plage: GRAAL_PLAGE },
    { id: 'bdep', nom: 'Sortie du canon', unite: 's', facteur: 1, source: 'mecanismes.canon_C.deploiement_s', statut: statutOf(null, 'sortie_canon_s') },
    { id: 'bspin', nom: 'Mise en route du canon', unite: 's', facteur: 1, source: 'mecanismes.canon_C.mise_en_route_s', statut: statutOf(null, 'mise_en_route_canon_s') },
    { id: 'brate', nom: 'Cadence du canon', unite: 'boulets/s', facteur: 1, source: 'mecanismes.canon_C.cadence_boulets_s (lue en boulets/s)', statut: statutOf(null, 'cadence_tir') }
  ];
  PHYSIQUE.forEach(function (d) { d.nominal = round(E.DEF[d.id] * d.facteur, 4); d.plageDefaut = d.plage ? d.plage.slice() : PCT_DEFAUT; });
  /* paramètres du moteur liés (hypothèse du moteur : la descente de la fourche dure autant que la montée du Graal) */
  var LIES = { tMonteeGraal: ['tDescenteFourche'] };
  function physDesc(id) { for (var i = 0; i < PHYSIQUE.length; i++) if (PHYSIQUE[i].id === id) return PHYSIQUE[i]; return null; }
  /* plage d'une caractéristique : nombre = ± % autour de la valeur nominale ; [min, max] (unité affichée) ; 0 ou null = fixe */
  function bornes(d, nominal, plage) {
    if (Array.isArray(plage)) return [+plage[0], +plage[1]];
    var p = plage == null ? 0 : +plage;
    return [nominal * (1 - p / 100), nominal * (1 + p / 100)];
  }
  /* Réglages : { actif, valeurs: { id: nominale (unité affichée) }, plages: { id: % | [min, max] | 0 } }.
     actif faux : valeurs nominales (réglées ou spec), sans tirage. Renvoie { params (clés du moteur), valeurs, nominales, plages }. */
  function tirerPhysique(seed, reglages, tag) {
    reglages = reglages || {};
    var r = rngOf(seed, tag || 'physique-notre'), vals = reglages.valeurs || {}, plages = reglages.plages || {};
    var out = { params: {}, valeurs: {}, nominales: {}, plages: {}, actif: !!reglages.actif };
    PHYSIQUE.forEach(function (d) {
      var nom = vals[d.id] != null ? +vals[d.id] : d.nominal;
      var pl = plages[d.id] !== undefined ? plages[d.id] : d.plageDefaut;
      var b = bornes(d, nom, pl), u = r();   /* un tirage par caractéristique, toujours consommé : reproductible */
      var x = reglages.actif ? b[0] + (b[1] - b[0]) * u : nom;
      if (d.id !== 'bspin' && !(x > 0)) x = nom;
      out.valeurs[d.id] = round(x, 4); out.nominales[d.id] = nom; out.plages[d.id] = pl;
      out.params[d.id] = x / d.facteur;
      (LIES[d.id] || []).forEach(function (k) { out.params[k] = x / d.facteur; });
    });
    return out;
  }
  /* observation « physique » : pour chaque caractéristique, valeur effective / nominale de la spec - 1 (bornée à ±1) ;
     nominale nulle (mise en route du canon) : écart en secondes, borné à ±1 */
  function observerPhysique(params) {
    params = params || {};
    return PHYSIQUE.map(function (d) {
      var nom = E.DEF[d.id], x = params[d.id] != null ? +params[d.id] : nom, v = nom ? x / nom - 1 : x - nom;
      return Math.max(-1, Math.min(1, v));
    });
  }
  function clesPhysiques() { var k = []; PHYSIQUE.forEach(function (d) { k.push(d.id); (LIES[d.id] || []).forEach(function (x) { k.push(x); }); }); return k; }

  /* ================================================================== 2. profils des adversaires */
  var HYPOTHESES = {
    cellule: 50,              /* grille de planification (mm) */
    marge: 15,                /* marge aux obstacles (mm) au-delà du rayon d'enveloppe */
    jeu: 25,                  /* écart entre l'enveloppe et l'objet visé à la pose d'approche (mm) */
    margeRobot: 120,          /* marge autour de notre robot pour planifier (mm), en plus des deux rayons */
    acceleration: 1500,       /* mm/s² : temps ajouté par trajet = v / acceleration */
    pas: 0.1,                 /* pas d'exécution (s) : évitement, contact */
    attenteMax: 3,            /* attente maximale derrière notre robot avant d'abandonner l'action (s) */
    facteurPorte: 1.5,        /* durée de pose d'une porte = facteurPorte × tPose */
    tCanon: 1,                /* sortie du canon adverse (s) */
    cadence: 1.5,             /* boulets/s */
    boulets: RG.assaut.boulets_par_equipe,
    hauteur: 340,             /* hauteur déclarée des robots abstraits (mm), <= 350 */
    margeFin: 1.5             /* marge de temps gardée pour finir au trône (s) */
  };
  /* Plages par profil (hypothèses proposées à l'équipe, dans les bornes validées : vitesse 300–800 mm/s, rotation 90–360 °/s,
     prise/pose 1–4 s, montée du Graal 2–6 s, périmètre 900–1200 mm, distance d'arrêt 250–450 mm). */
  var PROFILS = {
    batisseur: {
      id: 'batisseur', nom: 'Bâtisseur', type: 'regles', esquisse: 64,
      description: 'Rond, rapide ; construction pure (portes, murs, tours), Graal sur une construction, retour au trône ; pas de tir.',
      forme: 'rond', perimetre: [1050, 1150], v: [550, 750], w: [180, 360], tPrise: [2, 3.5], tPose: [1.5, 2.5], tGraal: [3, 5], dArret: [250, 450],
      capacite: 3, tir: false, precision: [0, 0],
      poids: { prendre: 1, construire: 1, porte: 1.3, graal: 1.2 }, valeurPierre: 2.6, carrieres: null, bruit: 0.25, enfermementApres: 80
    },
    razzia: {
      id: 'razzia', nom: 'Razzia', type: 'regles', esquisse: 54,
      description: 'Rond, très rapide ; vide d\'abord les carrières proches de notre château, puis construit chez lui ; tir sur notre cour à 85 s ; trône.',
      forme: 'rond', perimetre: [950, 1100], v: [700, 800], w: [240, 360], tPrise: [2, 3.5], tPose: [2, 3], tGraal: [3, 6], dArret: [250, 450],
      capacite: 6, tir: true, precision: [0.7, 0.9],
      poids: { prendre: 1, construire: 1, porte: 1.1, graal: 1.1 }, valeurPierre: 2.6, bruit: 0.2, enfermementApres: 70,
      /* carrières visées d'abord (repère de NOTRE équipe, jaune) : les plus proches de notre château, puis le centre */
      carrieres: ['P1', 'P5', 'P2', 'P6'], razziaJusqua: 45, bonusRazzia: 5
    },
    champion: {
      id: 'champion', nom: 'Champion', type: 'reseau', modele: 'champion', esquisse: 116,
      description: 'Mêmes mécanismes que notre robot, rapide ; réseau récurrent figé (entraînement complet) : porte, murs, tours, Graal haut, tir dès 85 s, trône.',
      /* plages des paramètres du moteur (unité affichée, comme PHYSIQUE) ; mécanismes : facteur multiplicatif sur les durées */
      phys: { v: [600, 800], va: [200, 260], w: [150, 300], tMonteeGraal: [2, 3.5] }, meca: [0.85, 1.15]
    },
    intermediaire: {
      id: 'intermediaire', nom: 'Intermédiaire', type: 'reseau', modele: 'intermediaire', esquisse: 41,
      description: 'Mêmes mécanismes que notre robot, lent mais fiable ; réseau récurrent figé (imitation + PPO bref) : 2–3 murs, Graal, quelques boulets, trône.',
      phys: { v: [300, 400], va: [150, 200], w: [90, 120], tMonteeGraal: [4, 6] }, meca: [1.1, 1.4]
    }
  };
  var IDS = ['batisseur', 'champion', 'intermediaire', 'razzia'];

  /* empreinte : polygone convexe (repère robot) de périmètre per ; rond = 24 côtés (périmètre du polygone), rectangle 15:14, triangle équilatéral */
  function empreinte(forme, per) {
    var P = [], i;
    if (forme === 'rectangle') { var a = per / 2 * 15 / 29, b = per / 2 * 14 / 29; P = [[a / 2, -b / 2], [a / 2, b / 2], [-a / 2, b / 2], [-a / 2, -b / 2]]; }
    else if (forme === 'triangle') { var s = per / 3, rr = s / Math.sqrt(3); for (i = 0; i < 3; i++) P.push([rr * Math.cos(i * 120 * D2R), rr * Math.sin(i * 120 * D2R)]); }
    else { var N = 24, r0 = per / (2 * N * Math.sin(Math.PI / N)); for (i = 0; i < N; i++) P.push([r0 * Math.cos(2 * Math.PI * i / N), r0 * Math.sin(2 * Math.PI * i / N)]); }
    return P;
  }
  function perimetreOf(P) { var s = 0; for (var i = 0; i < P.length; i++) s += dist(P[i], P[(i + 1) % P.length]); return s; }
  function rayonOf(P) { var r = 0; P.forEach(function (q) { r = Math.max(r, Math.hypot(q[0], q[1])); }); return r; }

  /* tirage des caractéristiques d'un adversaire (graine du scénario) ; fixe : valeurs imposées à la main (plateau) */
  function tirerAdversaire(id, seed, fixe) {
    var pr = PROFILS[id]; if (!pr) throw new Error('Adversaire inconnu : ' + id);
    var r = rngOf(seed, 'adversaire-' + id), f = fixe || {}, o = { profil: id };
    function pick(k, ab) { var u = r(); return f[k] != null ? +f[k] : ab[0] + (ab[1] - ab[0]) * u; }
    if (pr.type === 'regles') {
      o.forme = f.forme || pr.forme;
      ['perimetre', 'v', 'w', 'tPrise', 'tPose', 'tGraal', 'dArret', 'precision'].forEach(function (k) { o[k] = round(pick(k, pr[k]), 3); });
      o.capacite = f.capacite != null ? +f.capacite : pr.capacite;
      o.hauteur = HYPOTHESES.hauteur;
    } else {
      /* même tirage que pendant son entraînement (reglagesPhysiques) ; une valeur fixée à la main remplace sa plage */
      var reg = reglagesPhysiques(id);
      Object.keys(f).forEach(function (k) { if (physDesc(k)) { reg.valeurs[k] = +f[k]; reg.plages[k] = 0; } });
      o.phys = tirerPhysique(seed, reg, 'adversaire-' + id).valeurs;
      o.perimetre = round(G.hullPer(G.GEO.hull), 1);
      o.forme = 'robot ICAM LOT (mêmes mécanismes)';
    }
    return o;
  }
  /* plages des caractéristiques d'un adversaire « réseau » (unité affichée) : celles du profil, sinon facteur « meca » sur les
     durées des mécanismes (vitesses des vérins et cadence divisées par ce facteur), vitesses de base nominales */
  function plagesReseau(id) {
    var pr = PROFILS[id], m = pr.meca, pl = {};
    PHYSIQUE.forEach(function (d) {
      var nom = d.nominal;
      if (pr.phys[d.id]) pl[d.id] = pr.phys[d.id].slice();
      else if (d.id === 'vz' || d.id === 'brate') pl[d.id] = [round(nom / m[1], 4), round(nom / m[0], 4)];
      else if (d.id === 'v' || d.id === 'va' || d.id === 'w') pl[d.id] = [nom, nom];
      else pl[d.id] = [round(nom * m[0], 4), round(nom * m[1], 4)];
    });
    return pl;
  }
  /* réglages du tirage physique pour entraîner un adversaire « réseau » (comme notre robot : ENV.create({ physique })) */
  function reglagesPhysiques(id) { return { actif: true, valeurs: {}, plages: plagesReseau(id) }; }
  /* programmes de démonstration (imitation) des adversaires « réseau » ; « attendreTir » = attentes courtes jusqu'au tir valide */
  function programmeDemo(id) {
    var ref = E.PROGRAMME_REFERENCE.filter(function (x) { return x.a !== 'attendre'; }), iT = ref.map(function (x) { return x.a; }).indexOf('tir');
    if (id === 'champion') return ref.slice(0, iT).concat([{ a: 'attendreTir' }]).concat(ref.slice(iT));
    /* intermédiaire : 3 murs, Graal, tir, trône */
    return [
      { a: 'prendre', f: 'A', p: 'P1', tm: true }, { a: 'prendre', f: 'B', p: 'P9', tm: true },
      { a: 'mur', f: 'B', z: 'M2', side: 'ext' }, { a: 'mur', f: 'A', z: 'M1', side: 'int' },
      { a: 'prendre', f: 'A', p: 'P5', tm: true }, { a: 'mur', f: 'A', z: 'M5', side: 'int' },
      { a: 'monterGraal' }, { a: 'trone' }, { a: 'attendreTir' }, { a: 'tir' }, { a: 'trone' }
    ];
  }
  /* paramètres du moteur (makeSim) d'un adversaire « réseau » : nominales + caractéristiques tirées */
  function paramsReseau(tirage) {
    var P = {};
    PHYSIQUE.forEach(function (d) { var x = tirage.phys[d.id]; if (x == null) return; P[d.id] = x / d.facteur; (LIES[d.id] || []).forEach(function (k) { P[k] = x / d.facteur; }); });
    return P;
  }

  /* message affiché partout (API, interfaces, entraîneur) quand un robot « réseau » n'a pas de modèle figé */
  var NON_ENTRAINE = 'modèle non entraîné : lancer l\'entraînement';
  function commandeEntrainement(id) { return 'python -m trainer.adversaires --robot ' + id; }
  /* modèles figés des adversaires « réseau » : enregistrés par le chargeur (worker Node, plateau) */
  var MODELES = {};
  function enregistrerModele(id, brain) { MODELES[id] = brain; }
  function modele(id) { return MODELES[id] || null; }

  /* ================================================================== 3. robot abstrait */
  var GE = G.GEO, ZMW = RG.remparts_jaune.mur_dimensions, ZTR = RG.remparts_jaune.tour_diametre / 2, PL = RG.pierres.dimensions;
  function ownZones(team) {
    var b = team === 'blue';
    return {
      murs: E.ZM.filter(function (z) { var n = +z.id.slice(1); return b ? n >= 6 : n <= 5; }),
      tours: E.ZT.filter(function (z) { var n = +z.id.slice(1); return b ? n >= 5 : n <= 4; })
    };
  }
  function centreChateau(team) { return team === 'blue' ? [2620, 1000] : [380, 1000]; }
  function pkStones(i) { var pk = E.PK[i]; return [1, 2, 3].map(function (l) { return pk.id + '.' + l; }); }
  function pkIndex(id) { for (var i = 0; i < E.PK.length; i++) if (E.PK[i].id === id) return i; return -1; }
  function rect(cx, cy, hl, hn, ang) { return G.rectPoly({ cx: cx, cy: cy, hl: hl, hn: hn, ang: ang }); }
  function ptSegD(p, a, b) { var dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
  function ptPolyD(p, P) { if (E.inPoly(p[0], p[1], P)) return 0; var d = 1e9; for (var i = 0; i < P.length; i++) d = Math.min(d, ptSegD(p, P[i], P[(i + 1) % P.length])); return d; }
  function polyBox(P) { var b = [1e9, -1e9, 1e9, -1e9]; P.forEach(function (v) { b[0] = Math.min(b[0], v[0]); b[1] = Math.max(b[1], v[0]); b[2] = Math.min(b[2], v[1]); b[3] = Math.max(b[3], v[1]); }); return b; }
  function boxD(p, b) { var dx = Math.max(b[0] - p[0], 0, p[0] - b[1]), dy = Math.max(b[2] - p[1], 0, p[1] - b[3]); return Math.hypot(dx, dy); }

  /* tirage : { forme, perimetre, v, w, tPrise, tPose, tGraal, dArret, precision, capacite, hauteur } ;
     opts : { team, oppPoseAt(t), oppRadius(), foreignFeet(), oppTaken: { id: t }, seed } */
  function makeRobot(tirage, opts) {
    opts = opts || {};
    var H = HYPOTHESES, team = opts.team || 'blue', B = team === 'blue';
    var fp = empreinte(tirage.forme, tirage.perimetre), R = rayonOf(fp);
    var P = Object.assign({ team: team, profil: tirage.profil, abstrait: true }, tirage, { fp: fp, R: R });
    var throne = E.throneOf(team), castle = E.castleOf(team);
    var tc = [(throne[0][0] + throne[2][0]) / 2, (throne[0][1] + throne[2][1]) / 2];
    var gx = B ? 3000 - E.DEF.gx : E.DEF.gx, gy = E.DEF.gy, ga = B ? 180 - E.DEF.ga : E.DEF.ga;
    var s = { t: 0, x: tc[0], y: tc[1], h: B ? 180 : 0 };
    var K = [], segs = [], errors = [], program = [], stepInfo = [];
    var charge = [], taken = {}, built = [], graal = { k: 'home', t: 0, tl: [{ t: 0, k: 'home' }] }, tir = null;
    var rng = rngOf(opts.seed, 'tir-' + (tirage.profil || ''));
    function pushK(lbl) { K.push({ t: s.t, x: s.x, y: s.y, h: s.h, lbl: lbl || null }); }
    pushK('départ');
    function oppAt(t) { return opts.oppPoseAt ? opts.oppPoseAt(t) : null; }
    function oppR() { return opts.oppRadius ? opts.oppRadius() : GE.R; }
    function claimedByOther(id) { var tk = opts.oppTaken || {}; return tk[id] != null || tk[id.split('.')[0]] != null; }
    function otherTakeTime(id) { var tk = opts.oppTaken || {}; var a = tk[id], b = tk[id.split('.')[0]]; return a != null ? a : b != null ? b : null; }
    /* pierres disponibles d'une carrière (de haut en bas) : ni prises par nous (ce robot), ni réservées par l'autre */
    function dispo(i) { return pkStones(i).filter(function (id) { return taken[id] == null && !claimedByOther(id); }).reverse(); }
    /* pierres physiquement encore à la carrière à l'instant t (obstacle) */
    function presentes(i, t) { return pkStones(i).filter(function (id) { var o = otherTakeTime(id); return taken[id] == null && (o == null || o > t); }); }

    /* ---------- obstacles et planification ---------- */
    function obstacles(t, sansGraal) {
      var L = [];
      E.PK.forEach(function (pk, i) { var n = presentes(i, t).length; if (n) L.push(rect(pk.x, pk.y, PL[0] / 2, PL[1] / 2, pk.tan + 90)); });
      built.forEach(function (c) { c.feet.forEach(function (f) { L.push(f.foot); }); });
      (opts.foreignFeet ? opts.foreignFeet() : []).forEach(function (o) { L.push(o.foot); });
      if (graal.k === 'home' && !sansGraal) L.push(E.graalPoly([gx, gy], ga));
      return L.map(function (Pp) { return { P: Pp, b: polyBox(Pp) }; });
    }
    function clearance(p, OB) {
      var d = Math.min(p[0], 3000 - p[0], p[1], 2000 - p[1]);
      for (var i = 0; i < OB.length && d > 0; i++) { if (boxD(p, OB[i].b) >= d) continue; d = Math.min(d, ptPolyD(p, OB[i].P)); }
      return d;
    }
    var C = H.cellule, GW = Math.ceil(3000 / C), GH = Math.ceil(2000 / C);
    var cacheClr = {}, cacheIn = null;
    function cleMonde(t, sg) {
      var k = sg ? 'g' : 'G'; k += graal.k + built.length;
      E.PK.forEach(function (pk, i) { k += ',' + presentes(i, t).length; });
      (opts.foreignFeet ? opts.foreignFeet() : []).forEach(function (f) { k += ';' + f.id + Math.round(f.foot[0][0]) + Math.round(f.foot[0][1]); });
      return k;
    }
    function baseClr(t, sg) {
      var key = cleMonde(t, sg); if (cacheClr.key === key) return cacheClr.v;
      var OB = obstacles(t, sg), clr = new Float32Array(GW * GH);
      for (var k = 0; k < GW * GH; k++) clr[k] = clearance(ctr(k), OB);
      cacheClr = { key: key, v: { OB: OB, clr: clr } };
      return cacheClr.v;
    }
    function dedansGrid() {
      if (cacheIn) return cacheIn;
      cacheIn = new Uint8Array(GW * GH);
      for (var k = 0; k < GW * GH; k++) { var c = ctr(k), m = 1e9; for (var i = 0; i < castle.length; i++) m = Math.min(m, ptSegD(c, castle[i], castle[(i + 1) % castle.length])); cacheIn[k] = E.inPoly(c[0], c[1], castle) && m >= R ? 1 : 0; }
      return cacheIn;
    }
    function cellOf(p) { return [Math.max(0, Math.min(GW - 1, Math.floor(p[0] / C))), Math.max(0, Math.min(GH - 1, Math.floor(p[1] / C)))]; }
    function ctr(k) { var i = k % GW; return [(i + 0.5) * C, ((k - i) / GW + 0.5) * C]; }
    /* champ de coût (Dijkstra) depuis la pose courante ; dedans : contrainte « centre dans le château, à R du bord » (Graal tenu) */
    function champ(t, o) {
      o = o || {};
      /* champ de dégagement des obstacles fixes : mis en cache tant que le monde ne change pas */
      var base = baseClr(t, !!o.sansGraal), OB = base.OB.slice(), clr = new Float32Array(base.clr), us = oppAt(t), dUs = us && us.x != null ? R + oppR() + H.margeRobot : 0;
      var IN = o.dedans ? dedansGrid() : null;
      for (var k = 0; k < GW * GH; k++) {
        if (IN && !IN[k]) { clr[k] = -1; continue; }
        if (us && us.x != null) { var c = ctr(k); if (Math.hypot(c[0] - us.x, c[1] - us.y) < dUs) clr[k] = -1; }
      }
      (o.extra || []).forEach(function (Pp) { OB.push({ P: Pp, b: polyBox(Pp) }); for (var k = 0; k < GW * GH; k++) { if (clr[k] < 0) continue; var c = ctr(k); if (boxD(c, OB[OB.length - 1].b) < clr[k]) clr[k] = Math.min(clr[k], ptPolyD(c, Pp)); } });
      var lim = R + H.marge, s0 = o.depuis || [s.x, s.y], sc = cellOf(s0), si = sc[1] * GW + sc[0];
      var D = new Float64Array(GW * GH).fill(Infinity), par = new Int32Array(GW * GH).fill(-1), heap = [];
      function push(d, i) { heap.push([d, i]); var c = heap.length - 1; while (c > 0) { var p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; var tmp = heap[p]; heap[p] = heap[c]; heap[c] = tmp; c = p; } }
      function pop() { var top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; var c = 0; for (;;) { var l = 2 * c + 1, r = l + 1, m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; var tmp = heap[m]; heap[m] = heap[c]; heap[c] = tmp; c = m; } } return top; }
      /* cases de départ : celles autour du robot qu'il atteint en ligne droite sans contact */
      for (var dj = -2; dj <= 2; dj++) for (var di = -2; di <= 2; di++) {
        var ii = sc[0] + di, jj = sc[1] + dj; if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue;
        var kk = jj * GW + ii, cc = ctr(kk);
        if ((clr[kk] >= R + 2 || (clr[kk] < 0 && base.clr[kk] >= R + 2 && !(IN && !IN[kk]))) && segOk(s0, cc, OB, R + 1, o)) { D[kk] = dist(s0, cc); push(D[kk], kk); par[kk] = -2; }
      }
      while (heap.length) {
        var top = pop(), d0 = top[0], k0 = top[1]; if (d0 > D[k0]) continue;
        var ci = k0 % GW, cj = (k0 - ci) / GW;
        for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var ni = ci + dx, nj = cj + dy; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
          var nk = nj * GW + ni; if (clr[nk] < lim) continue;
          if (dx && dy && (clr[cj * GW + ni] < lim || clr[nj * GW + ci] < lim)) continue;
          var nd = d0 + (dx && dy ? C * Math.SQRT2 : C);
          if (nd < D[nk]) { D[nk] = nd; par[nk] = k0; push(nd, nk); }
        }
      }
      return { D: D, par: par, clr: clr, OB: OB, o: o, us: us, dUs: dUs, depuis: o.depuis || null };
    }
    function segOk(a, b, OB, rmin, o) {
      var n = Math.max(1, Math.ceil(dist(a, b) / 15));
      for (var q = 0; q <= n; q++) {
        var p = [a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n];
        if (clearance(p, OB) < rmin) return false;
        if (o && o.dedans && !E.inPoly(p[0], p[1], castle)) return false;
      }
      return true;
    }
    /* chemin vers le but O (pose d'approche exacte) : case du champ la plus proche reliée au but en ligne droite */
    function chemin(F, O, rapide) {
      var S0 = F.depuis || [s.x, s.y];
      if (dist(S0, O) < 5) return { pts: [S0, O], L: dist(S0, O) };
      if (clearance(O, F.OB) < R + 1) return null;
      if (F.us && F.us.x != null && Math.hypot(O[0] - F.us.x, O[1] - F.us.y) < F.dUs) return null;
      if (F.o.dedans && !E.inPoly(O[0], O[1], castle)) return null;
      if (!rapide && segOk(S0, O, F.OB, R + 1, F.o) && (!F.us || F.us.x == null || segDisc(S0, O, F.us, F.dUs))) return { pts: [S0, O], L: dist(S0, O) };
      var gc = cellOf(O), best = -1, bd = Infinity;
      for (var dj = -3; dj <= 3; dj++) for (var di = -3; di <= 3; di++) {
        var ii = gc[0] + di, jj = gc[1] + dj; if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue;
        var k = jj * GW + ii; if (F.D[k] === Infinity) continue;
        var tot = F.D[k] + dist(ctr(k), O); if (tot < bd && segOk(ctr(k), O, F.OB, R + 1, F.o)) { bd = tot; best = k; }
      }
      if (best < 0) return null;
      /* estimation : longueur sur la grille (majorant du chemin lissé) */
      if (rapide) return { pts: null, L: bd };
      var cells = [], k2 = best; while (k2 >= 0) { cells.push(k2); k2 = F.par[k2]; }
      cells.reverse();
      var pts = [S0].concat(cells.map(ctr)).concat([O]);
      /* raccourcis : ligne droite sans contact (marge), en avançant tant que la vue est dégagée */
      function vue(a, b) { return segOk(pts[a], pts[b], F.OB, b === pts.length - 1 || a === 0 ? R + 1 : R + H.marge, F.o) && (!F.us || F.us.x == null || segDisc(pts[a], pts[b], F.us, F.dUs)); }
      var out = [pts[0]], ia = 0;
      while (ia < pts.length - 1) { var jb = ia + 1; while (jb + 1 < pts.length && vue(ia, jb + 1)) jb++; out.push(pts[jb]); ia = jb; }
      var L = 0; for (var q = 1; q < out.length; q++) L += dist(out[q - 1], out[q]);
      return { pts: out, L: L };
    }
    function segDisc(a, b, c, r) { return ptSegD([c.x, c.y], a, b) >= r; }
    function dureeTrajet(L, dh) { return L < 1 && Math.abs(dh) < 1 ? 0 : Math.max(L / P.v + (L > 1 ? P.v / H.acceleration : 0), Math.abs(dh) / P.w); }
    function angd(a, b) { return ((b - a) % 360 + 540) % 360 - 180; }

    /* ---------- poses d'approche ---------- */
    function approcheCarriere(i) {
      var pk = E.PK[i], out = [];
      var nrm = pk.tan === 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
      nrm.forEach(function (n) { var d = PL[1] / 2 + R + H.jeu; var O = [pk.x + n[0] * d, pk.y + n[1] * d]; if (O[0] > R && O[0] < 3000 - R && O[1] > R && O[1] < 2000 - R) out.push({ O: O, h: Math.atan2(-n[1], -n[0]) / D2R }); });
      return out;
    }
    function approcheZone(z) {
      var c = z.c, ctrC = centreChateau(team), d, n;
      if (z.nin != null) { n = [Math.cos(z.nin * D2R), Math.sin(z.nin * D2R)]; d = ZMW[1] / 2 + R + H.jeu; }
      else { var v = [ctrC[0] - c[0], ctrC[1] - c[1]], L = Math.hypot(v[0], v[1]); n = [v[0] / L, v[1] / L]; d = ZTR + R + H.jeu; }
      return [{ O: [c[0] + n[0] * d, c[1] + n[1] * d], h: Math.atan2(-n[1], -n[0]) / D2R }];
    }
    function approcheGraal() {
      var gp = E.graalPoly([gx, gy], ga), gr = 0; gp.forEach(function (v) { gr = Math.max(gr, Math.hypot(v[0] - gx, v[1] - gy)); });
      var ctrC = centreChateau(team), out = [];
      [0, 30, -30, 60, -60].forEach(function (da) {
        var a = Math.atan2(ctrC[1] - gy, ctrC[0] - gx) + da * D2R, d = gr + R + H.jeu, O = [gx + Math.cos(a) * d, gy + Math.sin(a) * d];
        out.push({ O: O, h: a / D2R + 180 });
      });
      return out;
    }
    /* pieds d'une construction posée (zone z) */
    function piedsConstruction(kind, z, ids) {
      var c = z.c, tan = z.tan != null ? z.tan : 0, t = [Math.cos(tan * D2R), Math.sin(tan * D2R)], f = [];
      if (kind === 'mur') ids.forEach(function (id, l) { f.push({ id: id, foot: rect(c[0], c[1], PL[0] / 2, PL[1] / 2, tan + 90), bottom: PL[1] * l, top: PL[1] * (l + 1), vertical: false }); });
      else if (kind === 'tour') f.push({ id: ids[0], foot: rect(c[0], c[1], PL[1] / 2, PL[2] / 2, 0), bottom: 0, top: PL[0], vertical: true });
      else {
        var e = 105;
        [-1, 1].forEach(function (sg, q) { f.push({ id: ids[q], foot: rect(c[0] + sg * e * t[0], c[1] + sg * e * t[1], PL[1] / 2, PL[2] / 2, tan), bottom: 0, top: PL[0], vertical: true }); });
        f.push({ id: ids[2], foot: rect(c[0], c[1], PL[0] / 2, PL[1] / 2, tan + 90), bottom: PL[0] + 5, top: PL[0] + 5 + PL[1], vertical: false, linteau: true });
      }
      return f;
    }
    function zoneLibre(z) {
      if (built.some(function (c) { return c.z === z.id; })) return false;
      /* zone occupée par des pierres de l'autre robot */
      var Z = z.nin != null ? E.zoneRect(z) : null;
      return !(opts.foreignFeet ? opts.foreignFeet() : []).some(function (o) { var cc = [0, 0]; o.foot.forEach(function (v) { cc[0] += v[0] / o.foot.length; cc[1] += v[1] / o.foot.length; }); return Z ? E.inPoly(cc[0], cc[1], Z) : dist(cc, z.c) < ZTR; });
    }
    function besoin(kind) { return kind === 'tour' ? 1 : 3; }
    /* durée de pose d'une construction : tPose par pierre (porte : × facteurPorte) */
    function dureePose(kind) { return P.tPose * besoin(kind) * (kind === 'porte' ? H.facteurPorte : 1); }
    /* après avoir posé kind en z depuis sa pose d'approche, le robot peut-il encore sortir de son château ? */
    function sortiePossible(kind, z) {
      var a = approcheZone(z)[0], feet = piedsConstruction(kind, z, ['x', 'y', 'z']).map(function (f) { return f.foot; });
      var F = champ(s.t, { depuis: a.O, extra: feet });
      for (var k = 0; k < GW * GH; k++) if (F.D[k] < Infinity) { var c = ctr(k); if (!E.inPoly(c[0], c[1], castle) && ptPolyD(c, castle) > R + 50) return true; }
      return false;
    }

    /* ---------- exécution ---------- */
    function seg(d, label) { if (d > 0) segs.push({ t0: s.t, t1: s.t + d, label: label }); }
    function attendre(d, label) { if (!(d > 0)) return; seg(d, label); s.t += d; pushK(label); }
    function contact(t) {
      var o = oppAt(t); if (!o || o.x == null) return false;
      return G.hullHit(o, G.toTable(fp, { x: s.x, y: s.y, h: s.h }), 1);
    }
    /* parcours d'un chemin avec évitement : arrêt si notre robot est devant à moins de dArret (bords des enveloppes) ;
       abandon après attenteMax s d'arrêt cumulé. Renvoie false si le trajet est abandonné. */
    function parcourir(pts, hEnd, label) {
      var h0 = s.h, dh = angd(h0, hEnd), L = 0, q;
      for (q = 1; q < pts.length; q++) L += dist(pts[q - 1], pts[q]);
      var T = dureeTrajet(L, dh); if (T <= 0) return true;
      var t0 = s.t, u = 0, waited = 0, dt = H.pas, seg0 = s.t;
      function at(uu) {
        var d = uu * L, acc = 0;
        for (var k = 1; k < pts.length; k++) { var l = dist(pts[k - 1], pts[k]); if (acc + l >= d - 1e-9) { var w = l > 0 ? (d - acc) / l : 0; return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * w, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * w]; } acc += l; }
        return pts[pts.length - 1];
      }
      while (u < 1 - 1e-9) {
        var du = Math.min(1 - u, dt / T), nxt = at(u + du), cur = [s.x, s.y], dir = [nxt[0] - cur[0], nxt[1] - cur[1]];
        var o = oppAt(s.t + dt), bloque = false;
        if (o && o.x != null) {
          var gap = Math.hypot(o.x - nxt[0], o.y - nxt[1]) - R - GE.R, m = Math.hypot(dir[0], dir[1]);
          if (gap < P.dArret && (m < 1e-6 || (o.x - cur[0]) * dir[0] + (o.y - cur[1]) * dir[1] > 0)) bloque = true;
        }
        if (bloque) {
          if (waited >= H.attenteMax) { seg(s.t - seg0, label + ' (interrompu : robot adverse devant)'); pushK('arrêt'); return false; }
          s.t += dt; waited += dt; pushK('attente : robot adverse devant'); continue;
        }
        u += du; s.x = nxt[0]; s.y = nxt[1]; s.h = h0 + dh * u; s.t += dt * Math.min(1, du * T / dt);
        pushK(null);
        if (contact(s.t)) { errors.push({ step: program.length, msg: 'Contact avec le robot adverse (à ' + s.t.toFixed(1).replace('.', ',') + ' s).' }); }
      }
      s.x = pts[pts.length - 1][0]; s.y = pts[pts.length - 1][1]; s.h = h0 + dh;
      seg(s.t - seg0, label + (waited > 0 ? ' (attente ' + waited.toFixed(1).replace('.', ',') + ' s : robot adverse)' : ''));
      return true;
    }
    function aller(cands, label, o) {
      var F = champ(s.t, o), best = null;
      cands.forEach(function (c) { var ch = chemin(F, c.O); if (ch && (!best || ch.L < best.ch.L)) best = { c: c, ch: ch }; });
      if (!best) return { ok: false, raison: 'aucun passage (' + label + ')' };
      return { ok: parcourir(best.ch.pts, best.c.h, label), c: best.c };
    }
    /* estimation pure (sans effet) : durée du trajet vers la meilleure pose d'approche, ou null */
    function estimer(cands, F) {
      var best = null; cands.forEach(function (c) { var ch = chemin(F, c.O, true); if (ch) { var d = dureeTrajet(ch.L, angd(s.h, c.h)); if (!best || d < best.d) best = { d: d, c: c, ch: ch }; } });
      return best;
    }
    var steps = {
      prendre: function (st) {
        var i = pkIndex(st.p); if (i < 0) return 'Carrière inconnue.';
        if (charge.length >= P.capacite) return 'Capacité de transport atteinte.';
        if (!dispo(i).length) return 'Carrière vide.';
        var r = aller(approcheCarriere(i), 'Vers la carrière ' + st.p); if (!r.ok) return r.raison || null;
        var ids = dispo(i).slice(0, Math.min(st.n || 3, P.capacite - charge.length));
        if (!ids.length) { attendre(0.2, 'Carrière ' + st.p + ' vide à l\'arrivée'); return null; }
        ids.forEach(function (id) { taken[id] = s.t; charge.push(id); });
        attendre(P.tPrise, 'Prise de ' + ids.length + ' pierre(s) à ' + st.p);
        return null;
      },
      construire: function (st) {
        var z = E.zoneById(st.z), kind = st.type; if (!z) return 'Zone inconnue.';
        var zs = ownZones(team), mine = (kind === 'tour' ? zs.tours : zs.murs).some(function (q) { return q.id === z.id; });
        if (!mine) return 'Zone hors de notre château.';
        if (kind === 'porte' && built.some(function (c) { return c.kind === 'porte'; })) return 'Une seule porte par château.';
        if (!zoneLibre(z)) return 'Zone déjà construite.';
        if (charge.length < besoin(kind)) return 'Pas assez de pierres.';
        var r = aller(approcheZone(z), 'Vers ' + z.id); if (!r.ok) return r.raison || null;
        var ids = charge.splice(0, besoin(kind));
        attendre(dureePose(kind), (kind === 'mur' ? 'Mur ' : kind === 'tour' ? 'Tour ' : 'Porte ') + z.id);
        built.push({ kind: kind, z: z.id, ids: ids, t: s.t, feet: piedsConstruction(kind, z, ids) });
        return null;
      },
      graal: function (st) {
        if (graal.k !== 'home') return 'Graal déjà déplacé.';
        var c = built.filter(function (q) { return q.z === st.z; })[0]; if (!c) return 'Pas de construction en ' + st.z + '.';
        var r = aller(approcheGraal(), 'Vers le Graal', { dedans: true }); if (!r.ok) return r.raison || null;
        attendre(P.tPrise, 'Prise du Graal');
        graal = { k: 'robot', t: s.t, tl: graal.tl.concat([{ t: s.t, k: 'robot' }]) };
        attendre(P.tGraal, 'Montée du Graal');
        var z = E.zoneById(st.z), r2 = aller(approcheZone(z), 'Graal vers ' + st.z, { dedans: true, sansGraal: true });
        if (!r2.ok) { attendre(P.tPose, 'Graal reposé'); graal = { k: 'sol', t: s.t, c: [s.x, s.y], tl: graal.tl.concat([{ t: s.t, k: 'sol' }]) }; return r2.raison || 'Graal : trajet interrompu.'; }
        attendre(P.tPose, 'Graal posé sur ' + st.z);
        graal = { k: 'construction', z: st.z, kind: c.kind, t: s.t, tl: graal.tl.concat([{ t: s.t, k: 'construction', z: st.z }]) };
        return null;
      },
      trone: function () {
        var r = aller([{ O: tc, h: s.h }], 'Retour dans la salle du trône');
        return r.ok ? null : r.raison || null;
      },
      tir: function () {
        if (tir) return 'Tir déjà fait.';
        if (!E.inPoly(s.x, s.y, castle)) return 'Tir : hors du château.';
        var t0 = Math.max(s.t, T_ATT - H.tCanon);
        attendre(t0 - s.t, 'Attente du début de l\'assaut');
        attendre(H.tCanon, 'Sortie du canon');
        var shots = [], tt = Math.max(s.t, T_ATT);
        for (var b = 0; b < H.boulets; b++) { var tb = tt + b / H.cadence; shots.push({ t: tb, cour: rng() < P.precision }); }
        var tEnd = Math.min(MATCH, shots[shots.length - 1].t);
        tir = { t0: tt, shots: shots };
        attendre(tEnd - s.t, 'Tir de ' + H.boulets + ' boulets');
        return null;
      },
      attendre: function (st) { attendre(Math.min(+st.sec || 0, Math.max(0, MATCH - s.t)), 'Attente'); return null; },
      attendreJusqua: function (st) { attendre(Math.max(0, Math.min(+st.sec, MATCH) - s.t), 'Attente'); return null; }
    };
    function exec(st) {
      var t0 = s.t; program.push(st);
      var e = null;
      try { e = (steps[st.a] || function () { return 'Action inconnue.'; })(st); } catch (x) { e = 'Erreur interne : ' + x.message; }
      /* confinement du Graal (E.2.b) : contrôle de la pose quand il est tenu */
      if (graal.k === 'robot' && !E.inPoly(s.x, s.y, castle)) { errors.push({ step: program.length, msg: 'Graal sorti du château (E.2.b).' }); }
      stepInfo.push({ t0: t0, t1: s.t, err: e });
      return { t0: t0, t1: s.t, dt: s.t - t0, err: e };
    }
    function poseAtT(t) {
      if (t <= K[0].t) return withFp(K[0]);
      var lo = 0, hi = K.length - 1; if (t >= K[hi].t) return withFp(K[hi]);
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (K[mid].t < t) lo = mid; else hi = mid; }
      var a = K[hi - 1], b = K[hi], d = b.t - a.t, k = d > 0 ? (t - a.t) / d : 1;
      return withFp({ t: t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, h: a.h + (b.h - a.h) * k });
    }
    function withFp(k) { return { t: k.t, x: k.x, y: k.y, h: k.h, fp: fp, R: R }; }
    /* pierres posées (obstacles pour l'autre robot) */
    function freeFeet() {
      var out = [];
      built.forEach(function (c) { c.feet.forEach(function (f) { out.push({ id: f.id, foot: f.foot, top: f.top, bottom: f.bottom }); }); });
      if (graal.k === 'home') out.push({ id: 'Graal adverse', foot: E.graalPoly([gx, gy], ga), bottom: 0, top: GE.graal.h });
      return out;
    }
    function leftHome(into) { Object.keys(taken).forEach(function (id) { if (into[id] == null) into[id] = taken[id]; }); return into; }

    /* ---------- score (barème de la spec, évalué à T) ---------- */
    function scoreAt(T) {
      var Bm = bareme(), M = Math.min(T == null ? MATCH : T, MATCH), fin = M >= MATCH - 1e-9;
      var ok = built.filter(function (c) { return c.t <= M + 1e-9; });
      var nP = 0, murs = [], tours = [], portes = [];
      ok.forEach(function (c) { nP += c.ids.length; if (c.kind === 'mur') murs.push(c.z); else if (c.kind === 'tour') tours.push(c.z); else portes.push(c.z); });
      var gOk = fin && graal.k === 'construction' && graal.t <= M + 1e-9, lvl = gOk ? 3 : 0;
      var p = poseAtT(M), foot = G.toTable(fp, p);
      var full = foot.every(function (v) { return E.inPoly(v[0], v[1], throne) || ptPolyD(v, throne) <= 0.5; }), part = foot.some(function (v) { return E.inPoly(v[0], v[1], throne); }) || E.inPoly(p.x, p.y, throne);
      var roi = !fin ? 0 : full ? Bm.retourComplet : part ? Bm.retourPartiel : 0;
      var nB = !fin || !tir ? 0 : tir.shots.filter(function (b) { return b.cour && b.t <= MATCH + 1e-9; }).length;
      var bl = (nB >= 1 ? Bm.boulet1 : 0) + (nB >= 3 ? Bm.boulet3 : 0);
      var rows = [
        ['Construction', [['Pierres dans nos zones', nP + ' × ' + Bm.pierre + ' pt', nP * Bm.pierre], ['Murs', murs.join(', ') || 'aucun', murs.length * Bm.mur], ['Tours', tours.join(', ') || 'aucune', tours.length * Bm.tour], ['Porte', portes[0] || 'aucune', portes.length ? Bm.porte : 0]]],
        ['Graal', [['Dans le château', gOk ? 'posé sur ' + graal.z : !fin ? 'évalué à la fin du match' : graal.k === 'home' ? 'jamais déplacé : non compté' : 'non posé', gOk ? Bm.graalPresent : 0], ['Niveau d\'élévation', gOk ? 'niveau 3 (' + graal.kind + ')' : '-', lvl * Bm.graalNiveau]]],
        ['Retour du roi', [['Salle du trône', !fin ? 'évalué à la fin du match' : full ? 'complètement' : part ? 'en partie' : 'dehors', roi]]],
        ['Assaut', [['Boulets dans la cour adverse', !fin ? 'évalués à la fin du match' : nB + ' boulet(s)', bl], ['Douves et attaque de PAMI', 'non simulées', 0]]]
      ];
      var total = 0; rows.forEach(function (r) { r[1].forEach(function (x) { total += x[2]; }); });
      return { total: total, rows: rows, niveauGraal: lvl, detail: { pierres: nP * Bm.pierre, murs: murs.length * Bm.mur, tours: tours.length * Bm.tour, porte: portes.length ? Bm.porte : 0, graal: gOk ? Bm.graalPresent + lvl * Bm.graalNiveau : 0, roi: roi, boulets: bl } };
    }
    /* conformité au règlement (périmètre au départ et déployé, hauteur) */
    function conformite() {
      var per = perimetreOf(fp);
      return { perimetreDepart: per, perimetreDeploye: per, hauteur: P.hauteur, ok: per <= LIM.perimetre_depart_max + 1e-6 && per <= LIM.perimetre_deploye_max + 1e-6 && P.hauteur <= LIM.hauteur_max_robot_et_objets_manipules };
    }
    function result() {
      return {
        abstrait: true, team: team, profil: P.profil, physique: tirage, params: P, forme: fp, R: R, conformite: conformite(),
        K: K.slice(), segs: segs.slice(), errors: errors.slice(), stepInfo: stepInfo.slice(), T: s.t, program: program.slice(),
        built: JSON.parse(JSON.stringify(built)), graal: JSON.parse(JSON.stringify(graal)), tir: tir ? JSON.parse(JSON.stringify(tir)) : null, taken: Object.assign({}, taken),
        collisions: [], poseAt: poseAtT, scoreAt: scoreAt, graalHome: { c: [gx, gy], ang: ga }
      };
    }
    function snapshot() { return JSON.parse(JSON.stringify({ s: s, K: K, segs: segs, errors: errors, program: program, stepInfo: stepInfo, charge: charge, taken: taken, built: built, graal: graal, tir: tir })); }
    function restore(sn) { sn = JSON.parse(JSON.stringify(sn)); s = sn.s; K = sn.K; segs = sn.segs; errors = sn.errors; program = sn.program; stepInfo = sn.stepInfo; charge = sn.charge; taken = sn.taken; built = sn.built; graal = sn.graal; tir = sn.tir; }
    /* vue de l'état réel pour la stratégie (pas de copie profonde) */
    function etat() { return { t: s.t, x: s.x, y: s.y, h: s.h, charge: charge.length, built: built, graal: graal.k, tir: !!tir, R: R }; }
    return {
      abstrait: true, P: P, exec: exec, finish: function () { return result(); }, result: result, time: function () { return s.t; }, params: function () { return P; },
      poseAtT: poseAtT, pose: function () { return withFp(s); }, freeFeet: freeFeet, leftHome: leftHome, errors: function () { return errors; },
      program: function () { return program.slice(); }, snapshot: snapshot, restore: restore, scoreAt: scoreAt, conformite: conformite,
      /* pour les stratégies */
      etat: etat, dernier: function () { return stepInfo.length ? stepInfo[stepInfo.length - 1] : null; }, champ: champ, estimer: estimer, approcheCarriere: approcheCarriere, approcheZone: approcheZone, approcheGraal: approcheGraal,
      dispo: dispo, zoneLibre: zoneLibre, sortiePossible: sortiePossible, dureePose: dureePose, zones: function () { return ownZones(team); }, throneCentre: tc, dureeTrajet: dureeTrajet,
      claimed: function (id) { return claimedByOther(id); }, hullRadius: function () { return R; }
    };
  }

  /* ================================================================== 4. stratégies réactives */
  /* Agent à règles : à chaque décision, il estime (sans agir) les actions possibles d'après l'état réel (carrières restantes,
     constructions faites, position de notre robot), leur gain (points du barème) et leur durée, et choisit le meilleur rapport
     gain / durée pondéré par les priorités du profil, avec un aléa de ± bruit / 2 tiré de la graine. Il garde le temps de finir :
     Graal (si une construction le permet), tir à 85 s (s'il tire) et retour au trône avant 100 s. */
  function agentRegles(id, seed) {
    var pr = PROFILS[id], r = rngOf(seed, 'strategie-' + id), n = 0, H = HYPOTHESES;
    function bar() { return bareme(); }
    return {
      kind: 'regles', profil: id,
      next: function (sim) {
        if (n++ > 200) return null;
        var e = sim.etat(), t = e.t, Bm = bar(), P = sim.P, team = P.team;
        /* la dernière action a échoué sans faire avancer le temps (passage bloqué, souvent par notre robot) : attendre un peu */
        var der = sim.dernier(); if (der && der.err && der.t1 - der.t0 < 1e-6 && t < MATCH - 0.6) return { a: 'attendre', sec: 0.5 };
        if (t >= MATCH - 0.05) return null;
        var F = sim.champ(t), Fd = null;
        function dansChateau() { return Fd || (Fd = sim.champ(t, { dedans: true })); }
        var thr = sim.estimer([{ O: sim.throneCentre, h: e.h }], F);
        var dThr = thr ? thr.d : Math.hypot(e.x - sim.throneCentre[0], e.y - sim.throneCentre[1]) / P.v * 1.5;
        /* temps à garder après une action finissant en O : retour au trône (approché), Graal à faire, tir */
        function reserve(O, graalFait) {
          var back = Math.hypot(O[0] - sim.throneCentre[0], O[1] - sim.throneCentre[1]) * 1.3 / P.v + 1;
          var g = 0;
          if (!graalFait && e.graal === 'home' && (e.built.length || graalFait === false)) g = 2 * P.tPrise + P.tGraal + P.tPose + 4;
          return back + g + H.margeFin;
        }
        var tirFin = pr.tir && !e.tir;
        /* limite de temps pour l'action : 100 s, ou l'heure de partir au tir (tir depuis le trône) */
        var limite = tirFin ? T_ATT - H.tCanon : MATCH;
        var cands = [];
        function add(brick, gain, d, O, w, graalFait) {
          if (!(gain > 0) || d == null) return;
          if (t + d + reserve(O, graalFait) > limite) return;
          cands.push({ brick: brick, v: gain * w * (1 + pr.bruit * (r() - 0.5)) / (d + 1) });
        }
        var zs = sim.zones();
        /* 1) prendre */
        if (e.charge < P.capacite) E.PK.forEach(function (pk, i) {
          var nd = sim.dispo(i).length; if (!nd) return;
          var es = sim.estimer(sim.approcheCarriere(i), F); if (!es) return;
          var k = Math.min(nd, P.capacite - e.charge), w = pr.poids.prendre;
          /* razzia : carrières proches du château de l'autre équipe (liste en repère jaune, valable pour un adversaire bleu) */
          if (pr.carrieres && t < pr.razziaJusqua && pr.carrieres.indexOf(team === 'blue' ? pk.id : E.mirrorId(pk.id)) >= 0) w *= pr.bonusRazzia;
          /* n'aller chercher des pierres que si on peut encore les poser */
          var ttt = es.d + P.tPrise + 6;
          add({ a: 'prendre', p: pk.id }, k * pr.valeurPierre, ttt, es.c.O, w);
        });
        /* 2) construire */
        var porteFaite = e.built.some(function (c) { return c.kind === 'porte'; });
        [['tour', zs.tours], ['mur', zs.murs], ['porte', porteFaite ? [] : zs.murs]].forEach(function (q) {
          var kind = q[0], need = kind === 'tour' ? 1 : 3; if (e.charge < need) return;
          q[1].forEach(function (z) {
            if (!sim.zoneLibre(z)) return;
            /* ne pas s'enfermer dans son château tant qu'il reste du temps pour d'autres prises (choisie seulement faute de mieux) */
            var enferme = t < pr.enfermementApres && !sim.sortiePossible(kind, z);
            var es = sim.estimer(sim.approcheZone(z), F); if (!es) return;
            var pts = need * Bm.pierre + (kind === 'mur' ? Bm.mur : kind === 'tour' ? Bm.tour : Bm.porte);
            var w = kind === 'porte' ? pr.poids.porte : pr.poids.construire;
            add({ a: 'construire', type: kind, z: z.id }, pts, es.d + sim.dureePose(kind), es.c.O, enferme ? w * 1e-3 : w, e.graal !== 'home' ? true : undefined);
          });
        });
        /* 3) Graal sur une construction (niveau 3), sans quitter le château */
        if (e.graal === 'home' && e.built.length) {
          var Fi = dansChateau(), eg = sim.estimer(sim.approcheGraal(), Fi);
          if (eg) e.built.forEach(function (c) {
            var z = E.zoneById(c.z), O = sim.approcheZone(z)[0].O, dz = Math.hypot(O[0] - eg.c.O[0], O[1] - eg.c.O[1]) * 1.3 / P.v + 1;
            var d = eg.d + P.tPrise + P.tGraal + dz + P.tPose;
            add({ a: 'graal', z: c.z }, Bm.graalPresent + 3 * Bm.graalNiveau, d, O, pr.poids.graal * (1 + (c.kind === 'mur' ? 0.05 : 0)), true);
          });
        }
        if (cands.length) { cands.sort(function (a, b) { return b.v - a.v; }); return cands[0].brick; }
        /* plus rien d'utile à faire avant l'échéance : tir (depuis le trône), sinon retour au trône et attente */
        var auTrone = Math.hypot(e.x - sim.throneCentre[0], e.y - sim.throneCentre[1]) < 5;
        if (!auTrone && t + dThr < MATCH - 0.5) return { a: 'trone' };
        if (tirFin && t < MATCH - 1) return { a: 'tir' };
        return t < MATCH - 0.5 ? { a: 'attendreJusqua', sec: MATCH } : null;
      }
    };
  }

  /* ================================================================== 5. mise en place dans un duel (engine/env.js) */
  /* spec d'adversaire { robot: id, fixe?: { ... } } -> { tirage, make(opts) -> sim abstrait, agent } pour un robot à règles */
  function preparerRegles(id, seed, fixe) {
    var tirage = tirerAdversaire(id, seed, fixe), ag = agentRegles(id, seed);
    return { tirage: tirage, agent: ag, make: function (o) { return makeRobot(tirage, Object.assign({ seed: seed }, o)); } };
  }

  var api = {
    HYPOTHESES: HYPOTHESES, PHYSIQUE: PHYSIQUE, PROFILS: PROFILS, IDS: IDS, PCT_DEFAUT: PCT_DEFAUT,
    tirerPhysique: tirerPhysique, observerPhysique: observerPhysique, clesPhysiques: clesPhysiques, physDesc: physDesc, bornes: bornes,
    tirerAdversaire: tirerAdversaire, paramsReseau: paramsReseau, plagesReseau: plagesReseau, reglagesPhysiques: reglagesPhysiques, programmeDemo: programmeDemo, empreinte: empreinte, perimetreOf: perimetreOf,
    makeRobot: makeRobot, agentRegles: agentRegles, preparerRegles: preparerRegles,
    enregistrerModele: enregistrerModele, modele: modele, modeles: function () { return Object.keys(MODELES); },
    NON_ENTRAINE: NON_ENTRAINE, commandeEntrainement: commandeEntrainement
  };
  root.ADVERSAIRES = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
