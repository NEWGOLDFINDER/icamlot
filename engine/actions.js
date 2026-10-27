/* Catalogue des actions du réseau (106 actions de base + extensions tactiques V2) et masque de validité. */
(function (root) {
  var FACES = ['A', 'B'];
  var PACKS = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10'];
  var MURS = ['M1', 'M2', 'M3', 'M4', 'M5'];
  var TOURS = ['T1', 'T2', 'T3', 'T4'];
  var COTES = ['ext', 'int'];
  var GRAAL_ZONES = MURS.concat(TOURS);
  var STAGING_ZONES = ['SN', 'SS', 'SC'];

  var WAYPOINTS_INFO = [
    { id: 'W1', x: 1050, y: 450, label: 'Sortie Nord Château (1050, 450)' },
    { id: 'W2', x: 1050, y: 1550, label: 'Sortie Sud Château (1050, 1550)' },
    { id: 'W3', x: 1050, y: 1000, label: 'Carrefour Ouest Centre (1050, 1000)' },
    { id: 'W4', x: 1500, y: 280, label: 'Couloir Nord (1500, 280)' },
    { id: 'W5', x: 1500, y: 1720, label: 'Couloir Sud (1500, 1720)' },
    { id: 'W6', x: 1500, y: 1000, label: 'Point Central (1500, 1000)' },
    { id: 'W7', x: 500, y: 220, label: 'Flanc Nord (500, 220)' },
    { id: 'W8', x: 500, y: 1780, label: 'Flanc Sud (500, 1780)' }
  ];
  var WAYPOINTS = WAYPOINTS_INFO.map(function (w) { return [w.x, w.y]; });

  var FAMILLES = [
    { id: 'prendre', label: 'Prendre un paquet', n: 20 },
    { id: 'mur', label: 'Poser un mur', n: 20 },
    { id: 'tour', label: 'Faire une tour', n: 24 },
    { id: 'porte', label: 'Faire une porte', n: 20 },
    { id: 'boulets', label: 'Lâcher les boulets', n: 1 },
    { id: 'prendreGraal', label: 'Prendre le Graal', n: 2 },
    { id: 'poserGraal', label: 'Poser le Graal', n: 18 },
    { id: 'trone', label: 'Retour au trône', n: 1 },
    { id: 'staging', label: 'Déposer relais', n: 6 },
    { id: 'repickup', label: 'Reprendre relais', n: 6 },
    { id: 'traj', label: 'Naviguer carrefour', n: 8 },
    { id: 'tournerPince', label: 'Tourner pince', n: 2 },
    { id: 'deposerZone', label: 'Déposer zone', n: 2 }
  ];

  function buildAll() {
    var out = [];
    // 0..19 : Prendre paquet P1..P10
    FACES.forEach(function (f) {
      PACKS.forEach(function (p) { out.push({ i: out.length, famille: 'prendre', a: 'prendre', f: f, p: p, label: 'Prendre ' + p + ' · face ' + f }); });
    });
    // 20..39 : Murs M1..M5
    FACES.forEach(function (f) {
      MURS.forEach(function (z) {
        COTES.forEach(function (side) { out.push({ i: out.length, famille: 'mur', a: 'mur', f: f, z: z, side: side, label: 'Mur ' + z + ' · ' + side + ' · face ' + f }); });
      });
    });
    // 40..63 : Tours T1..T4
    FACES.forEach(function (f) {
      TOURS.forEach(function (z) {
        [0, 1, 2].forEach(function (rank) { out.push({ i: out.length, famille: 'tour', a: 'tour', f: f, z: z, rank: rank, label: 'Tour ' + z + ' · pierre ' + (rank + 1) + ' · face ' + f }); });
      });
    });
    // 64..83 : Portes M1..M5
    FACES.forEach(function (f) {
      MURS.forEach(function (z) {
        COTES.forEach(function (side) { out.push({ i: out.length, famille: 'porte', a: 'porte', f: f, z: z, side: side, label: 'Porte ' + z + ' · ' + side + ' · face ' + f }); });
      });
    });
    // 84 : Boulets
    out.push({ i: out.length, famille: 'boulets', a: 'boulets', label: 'Lâcher les boulets' });
    // 85..86 : Prendre Graal
    FACES.forEach(function (f) { out.push({ i: out.length, famille: 'prendreGraal', a: 'prendreGraal', f: f, label: 'Prendre le Graal · face ' + f }); });
    // 87..104 : Poser Graal
    FACES.forEach(function (f) {
      GRAAL_ZONES.forEach(function (z) { out.push({ i: out.length, famille: 'poserGraal', a: 'poserGraal', f: f, z: z, label: 'Poser le Graal sur ' + z + ' · face ' + f }); });
    });
    // 105 : Trône
    out.push({ i: out.length, famille: 'trone', a: 'trone', label: 'Aller dans la salle du trône' });

    // 106..111 : Staging / Relais sur SN, SS, SC (Face A et B)
    FACES.forEach(function (f) {
      STAGING_ZONES.forEach(function (z) {
        out.push({ i: out.length, famille: 'staging', a: 'staging', f: f, z: z, label: 'Déposer relais ' + z + ' · face ' + f });
      });
    });

    // 112..117 : Reprise relais depuis SN, SS, SC (Face A et B)
    FACES.forEach(function (f) {
      STAGING_ZONES.forEach(function (z) {
        out.push({ i: out.length, famille: 'repickup', a: 'reprendre', f: f, z: z, label: 'Reprendre relais ' + z + ' · face ' + f });
      });
    });

    // 118..125 : 8 Actions de repositionnement / navigation waypoints
    WAYPOINTS_INFO.forEach(function (w) {
      out.push({ i: out.length, famille: 'traj', a: 'traj', w: w.id, tx: w.x, ty: w.y, th: 0, label: 'Trajet ' + w.label });
    });

    // 126..127 : Rotation pince Face A / Face B (0° <-> 90°)
    FACES.forEach(function (f) {
      out.push({ i: out.length, famille: 'tournerPince', a: 'tournerPince', f: f, r: 0, label: 'Tourner pince face ' + f });
    });

    // 128..129 : Déposer zone / lacher Face A / Face B (purger / débloquer pince)
    FACES.forEach(function (f) {
      out.push({ i: out.length, famille: 'deposerZone', a: 'deposerZone', f: f, label: 'Déposer zone face ' + f });
    });

    return out;
  }
  var ALL = buildAll();
  var ALL_BASE = ALL.slice(0, 106);
  if (ALL.length !== 130) throw new Error('Le catalogue étendu doit compter 130 actions, pas ' + ALL.length + '.');
  if (ALL_BASE.length !== 106) throw new Error('Le catalogue de base doit compter 106 actions, pas ' + ALL_BASE.length + '.');

  function filterByFamilles(familles) {
    var set = {};
    (familles || FAMILLES.map(function (f) { return f.id; })).forEach(function (id) { set[id] = true; });
    return ALL.filter(function (a) { return set[a.famille]; });
  }

  function indexOfStep(st, sim, catalogue) {
    catalogue = catalogue || ALL;
    for (var i = 0; i < catalogue.length; i++) {
      var a = catalogue[i];
      if (st.a === 'tourner' && a.famille === 'tournerPince' && a.f === st.f) return i;
      if (st.a === 'lacher' && a.famille === 'deposerZone' && a.f === st.f) return i;
      if (st.a === 'seDeplacer' && a.famille === 'traj' && Math.hypot((a.tx || 0) - (st.x || 0), (a.ty || 0) - (st.y || 0)) < 10) return i;
      if (st.a === 'traj' && a.famille === 'traj' && st.pts && st.pts[0] && Math.hypot((a.tx || 0) - (st.pts[0].x || 0), (a.ty || 0) - (st.pts[0].y || 0)) < 10) return i;
      if (a.a !== (st.a === 'tir' ? 'boulets' : st.a)) continue;
      if (a.f && a.f !== st.f) continue;
      if (a.p && a.p !== st.p) continue;
      if (a.z && a.z !== st.z) continue;
      if (a.side && a.side !== st.side) continue;
      if (a.a === 'tour') {
        var held = sim.held()[st.f];
        var stack = held && held.stack ? held.stack.filter(function (x) { return x; }) : [];
        var rank = -1;
        stack.forEach(function (x, k) { if (x.id === st.s) rank = k; });
        if (rank !== a.rank) continue;
      }
      return i;
    }
    return -1;
  }

  function toProgramStep(act, sim) {
    var st = { a: act.a === 'boulets' ? 'tir' : (act.a === 'reprendre' ? 'prendre' : act.a) };
    var blue = teamOf(sim) === 'blue';
    if (act.f) st.f = act.f;
    if (act.p) st.p = act.p;
    if (act.z) st.z = act.z;
    if (act.side) st.side = act.side;
    // R4 : Mode de placement adaptatif proche par défaut pour constructions
    if (act.a === 'mur' || act.a === 'tour' || act.a === 'porte') {
      st.pm = act.pm || 'proche';
    } else if (act.pm) {
      st.pm = act.pm;
    }
    if (act.a === 'tour') {
      var held = sim.held()[act.f];
      var stack = held && held.stack ? held.stack : [];
      var target = stack.filter(function (x) { return x; })[act.rank];
      st.s = target ? (blue ? ENGINE.mirrorId(target.id.split('.')[0]) + '.' + target.id.split('.')[1] : target.id) : 'P1.1';
    }
    if (act.a === 'traj') {
      st.pts = [{ x: blue ? 3000 - act.tx : act.tx, y: act.ty }];
    }
    if (act.a === 'tournerPince' || act.famille === 'tournerPince') {
      var curRot = (sim.pose()[act.f] && sim.pose()[act.f].rot) || 0;
      st.a = 'tourner';
      st.r = (curRot === 90) ? 0 : 90;
    }
    if (act.a === 'deposerZone' || act.famille === 'deposerZone') {
      st.a = 'lacher';
    }
    return st;
  }

  function faceEmpty(sim, f) { return !sim.held()[f]; }
  function faceStackFlat(sim, f) {
    var h = sim.held()[f];
    if (!h || !h.stack) return false;
    var n = h.stack.filter(function (x) { return x; }).length;
    return n === 3 && sim.pose()[f].rot === 0;
  }
  function faceHoldsGraal(sim, f) { var h = sim.held()[f]; return !!(h && h.graal); }

  // R1 : Support de la reprise de paquets déposés (cur.k === 'free') et de la prise partielle
  function packetStacked(sim, p, f) {
    var idx = -1;
    if (typeof ENGINE !== 'undefined' && ENGINE.PK) {
      ENGINE.PK.forEach(function (pk, i) { if (pk.id === p) idx = i; });
    } else {
      idx = parseInt(p.replace(/\D/g, ''), 10) - 1;
    }
    if (idx < 0) return false;
    var stones = typeof sim.stones === 'function' ? sim.stones() : (sim.stones || []);
    var sts = stones.filter(function (st) { return st.pk === idx; });

    // Pierres disponibles sur la table (home ou free)
    var avail = sts.filter(function (x) {
      return x.cur && (x.cur.k === 'home' || x.cur.k === 'free') && !(sim.claimed && sim.claimed(x.id));
    });
    if (avail.length === 0) return false;

    // Prise partielle : vérifier la capacité disponible sur la face
    if (f && sim.held && sim.held()[f]) {
      var h = sim.held()[f];
      var heldN = h.stack ? h.stack.filter(function (x) { return x; }).length : 0;
      if (heldN >= 3) return false;
    }

    // 1. Paquet intact au point de départ (home)
    var allHome = avail.every(function (x) { return x.cur && x.cur.k === 'home'; });
    if (allHome) return true;

    // 2. Paquet déposé / relayé sur la table (cur.k === 'free')
    var allFree = avail.every(function (x) { return x.cur && x.cur.k === 'free'; });
    if (!allFree) return false;

    // Vérifier qu'aucune pierre n'est debout (doit être empilée à plat)
    if (avail.some(function (x) { return x.cur.geo && x.cur.geo.vertical; })) return false;

    // Vérifier la co-localisation horizontale des pierres (tolérance 25 mm)
    if (avail.length > 1) {
      var p0 = avail[0].cur.geo && avail[0].cur.geo.fo;
      if (!p0) return false;
      for (var i = 1; i < avail.length; i++) {
        var pi = avail[i].cur.geo && avail[i].cur.geo.fo;
        if (!pi) return false;
        if (Math.hypot(pi.cx - p0.cx, pi.cy - p0.cy) > 25.0) return false;
      }
    }

    // Vérifier qu'aucun objet n'est posé par-dessus la pierre supérieure
    var sorted = avail.slice().sort(function (a, b) {
      var za = (a.cur.geo && a.cur.geo.zc) || 0;
      var zb = (b.cur.geo && b.cur.geo.zc) || 0;
      return za - zb;
    });
    var topStone = sorted[sorted.length - 1];
    if (sim.covered && sim.covered(topStone, avail)) return false;

    return true;
  }

  function stoneHeldRank(sim, f, rank) {
    var h = sim.held()[f];
    if (!h || !h.stack) return false;
    return !!h.stack.filter(function (x) { return x; })[rank];
  }
  function zoneStoneCount(sim, z) {
    var zone = ENGINE.zoneById(z); if (!zone) return 0;
    var isWall = z && z[0] === 'M';
    var zr = zone.tan !== undefined ? rectPoly({ cx: zone.c[0], cy: zone.c[1], hl: 200, hn: 100, ang: zone.tan + 90 }) : null;
    var n = 0;
    var all = [];
    sim.stones().forEach(function (st) { if (st.cur.k === 'free' && st.cur.geo) all.push(st.cur.geo); });
    (sim.foreign ? sim.foreign() : []).forEach(function (g) { all.push(g); });
    all.forEach(function (g) {
      if (!isWall && !g.vertical) return;
      if (zr) { if (overlap(g.foot, zr, 0)) n++; return; }
      var d = 1e9, P = g.foot;
      if (ENGINE.inPoly(zone.c[0], zone.c[1], P)) { n++; return; }
      for (var i = 0; i < P.length; i++) {
        var a = P[i], b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
        var u = L ? Math.max(0, Math.min(1, ((zone.c[0] - a[0]) * dx + (zone.c[1] - a[1]) * dy) / L)) : 0;
        d = Math.min(d, Math.hypot(zone.c[0] - a[0] - u * dx, zone.c[1] - a[1] - u * dy));
      }
      if (d < 100) n++;
    });
    return n;
  }
  function zoneHasBuild(sim, z) {
    var isWall = z && z[0] === 'M';
    return isWall ? zoneStoneCount(sim, z) >= 3 : zoneStoneCount(sim, z) >= 1;
  }
  function towerComplete(sim, z) { return zoneStoneCount(sim, z) >= 1; }

  function validDoorTarget(act) {
    if (act.z === 'M5') return false;
    if (act.z === 'M1' && act.side === 'ext') return false;
    return true;
  }
  function castleHasDoor(sim) {
    if (typeof SCORE === 'undefined' || !SCORE.outcome) return false;
    var r = sim.result(false);
    var o = SCORE.outcome(r, sim.params(), sim.time());
    var team = teamOf(sim);
    return o.doors.some(function (id) { return SCORE.own(id, team); });
  }

  function teamOf(sim) { if (!sim) return 'yellow'; var P = sim.params && sim.params(); return (P && P.team) || 'yellow'; }
  function real(act, sim) {
    if (teamOf(sim) !== 'blue') return act;
    var o = {}; Object.keys(act).forEach(function (k) { o[k] = act[k]; });
    if (o.p) o.p = ENGINE.mirrorId(o.p);
    if (o.z) o.z = ENGINE.mirrorId(o.z);
    return o;
  }

  var PACK_CENTERS = [
    [750, 55], [1250, 55], [1750, 55], [2250, 55],
    [750, 1945], [1250, 1945], [1750, 1945], [2250, 1945],
    [1500, 500], [1500, 1500]
  ];

  var ACTION_TARGETS = {
    'P1': [750, 305.5], 'P2': [1250, 305.5], 'P3': [1750, 305.5], 'P4': [2250, 305.5],
    'P5': [750, 1694.5], 'P6': [1250, 1694.5], 'P7': [1750, 1694.5], 'P8': [2250, 1694.5],
    'P9': [1249.5, 500], 'P10': [1249.5, 1500],
    'M1_ext': [250, 229.5], 'M1_int': [250, 570.5],
    'M2_ext': [799.8, 450.3], 'M2_int': [558.8, 691.3],
    'M3_ext': [1020.5, 1000], 'M3_int': [679.5, 1000],
    'M4_ext': [799.8, 1550.0], 'M4_int': [558.8, 1309.0],
    'M5_ext': [250, 1770.5], 'M5_int': [250, 1429.5],
    'T1': [329.5, 400], 'T2': [679.5, 750], 'T3': [679.5, 1250], 'T4': [329.5, 1600],
    'PG_M1': [150, 320], 'PG_M2': [579.3, 490.8], 'PG_M3': [750, 920], 'PG_M4': [579.3, 1349.5], 'PG_M5': [150, 1520],
    'PG_T1': [400, 320], 'PG_T2': [750, 670], 'PG_T3': [750, 1170], 'PG_T4': [400, 1520],
    'SN': [1120.5, 450.0], 'SS': [1120.5, 1550.0], 'SC': [1279.5, 800.0]
  };

  var STAGING_TARGETS = {
    'SN': [1120.5, 450.0],
    'SS': [1120.5, 1550.0],
    'SC': [1279.5, 800.0]
  };

  function getActionTarget(act, sim) {
    if (!act) return null;
    if (act.tx != null && act.ty != null) return [act.tx, act.ty];
    if (act.p) {
      if (sim && typeof sim.stones === 'function') {
        var pkIdx = parseInt(act.p.replace(/\D/g, ''), 10) - 1;
        var sts = sim.stones().filter(function (st) { return st.pk === pkIdx; });
        if (sts.length === 3 && sts.every(function (x) { return x.cur && x.cur.k === 'free'; })) {
          var fo = sts[0].cur.geo && sts[0].cur.geo.fo;
          if (fo) {
            var rin = 400.0 / (2.0 * Math.sqrt(3.0));
            var phi = (fo.ang != null ? fo.ang - 90 : 0);
            var rad = phi * Math.PI / 180.0;
            return [fo.cx - (rin + 55.0) * Math.cos(rad), fo.cy - (rin + 55.0) * Math.sin(rad)];
          }
        }
      }
      if (ACTION_TARGETS[act.p]) return ACTION_TARGETS[act.p];
    }
    if (act.z) {
      if (act.famille === 'mur' || act.famille === 'porte') {
        var key = act.z + '_' + (act.side || 'ext');
        if (ACTION_TARGETS[key]) return ACTION_TARGETS[key];
      }
      if (act.famille === 'tour' && ACTION_TARGETS[act.z]) return ACTION_TARGETS[act.z];
      if (act.famille === 'poserGraal') {
        var pgKey = 'PG_' + act.z;
        if (ACTION_TARGETS[pgKey]) return ACTION_TARGETS[pgKey];
      }
      if ((act.famille === 'staging' || act.famille === 'repickup') && ACTION_TARGETS[act.z]) {
        return ACTION_TARGETS[act.z];
      }
    }
    if (act.famille === 'boulets' || act.famille === 'trone') return [250, 1000];
    if (act.famille === 'prendreGraal') return [295.3, 1067.3];
    return null;
  }

  // R2 : Approches multi-angles dynamiques (dual opposé pour paquets, 4 cardinaux pour tours)
  function getActionTargets(act, sim) {
    if (!act) return [];
    if (act.w) {
      for (var wi = 0; wi < WAYPOINTS_INFO.length; wi++) {
        if (WAYPOINTS_INFO[wi].id === act.w) return [[WAYPOINTS_INFO[wi].x, WAYPOINTS_INFO[wi].y]];
      }
    }
    if (act.famille === 'traj' && act.tx != null) {
      return [[act.tx, act.ty]];
    }
    if (act.famille === 'tournerPince' || act.famille === 'deposerZone') {
      if (sim && typeof sim.pose === 'function') {
        var sp = sim.pose();
        return [[sp.x, sp.y]];
      }
      return [[250, 1000]];
    }
    if (act.p) {
      var pId = act.p;
      if (pId === 'P9') return [[1249.5, 500], [1750.5, 500]];
      if (pId === 'P10') return [[1249.5, 1500], [1750.5, 1500]];
      if (ACTION_TARGETS[pId]) {
        var base = ACTION_TARGETS[pId];
        if (pId === 'P1' || pId === 'P2' || pId === 'P3' || pId === 'P4') {
          return [[base[0], 305.5], [base[0], -195.5]];
        }
        if (pId === 'P5' || pId === 'P6' || pId === 'P7' || pId === 'P8') {
          return [[base[0], 1694.5], [base[0], 2195.5]];
        }
        return [base];
      }
    }
    if (act.z) {
      if (act.famille === 'tour' || (act.famille === 'poserGraal' && act.z && act.z.charAt(0) === 'T')) {
        var twCenters = {
          'T1': [500, 400], 'T2': [850, 750], 'T3': [850, 1250], 'T4': [500, 1600]
        };
        var c = twCenters[act.z];
        if (c) {
          return [
            [c[0] - 170.5, c[1]], // Ouest / Extérieur
            [c[0] + 170.5, c[1]], // Est / Intérieur
            [c[0], c[1] - 170.5], // Nord / Haut
            [c[0], c[1] + 170.5]  // Sud / Bas
          ];
        }
      }
      if (act.famille === 'mur' || act.famille === 'porte') {
        var key = act.z + '_' + (act.side || 'ext');
        if (ACTION_TARGETS[key]) return [ACTION_TARGETS[key]];
      }
      if (act.famille === 'poserGraal') {
        var pgKey = 'PG_' + act.z;
        if (ACTION_TARGETS[pgKey]) return [ACTION_TARGETS[pgKey]];
      }
      if ((act.famille === 'staging' || act.famille === 'repickup') && ACTION_TARGETS[act.z]) {
        return [ACTION_TARGETS[act.z]];
      }
    }
    if (act.famille === 'boulets' || act.famille === 'trone') return [[250, 1000]];
    if (act.famille === 'prendreGraal') return [[295.3, 1067.3]];
    var single = getActionTarget(act, sim);
    return single ? [single] : [];
  }

  var BUILD_OBSTACLES = [
    { id: 'M1', x: 250, y: 400, r: 210 },
    { id: 'M2', x: 679.3, y: 570.8, r: 210 },
    { id: 'M3', x: 850, y: 1000, r: 210 },
    { id: 'M4', x: 679.3, y: 1429.5, r: 210 },
    { id: 'M5', x: 250, y: 1600, r: 210 },
    { id: 'M6', x: 2750, y: 400, r: 210 },
    { id: 'M7', x: 2320.7, y: 570.8, r: 210 },
    { id: 'M8', x: 2150, y: 1000, r: 210 },
    { id: 'M9', x: 2320.7, y: 1429.5, r: 210 },
    { id: 'M10', x: 2750, y: 1600, r: 210 },
    { id: 'T1', x: 500, y: 400, r: 180 },
    { id: 'T2', x: 850, y: 750, r: 180 },
    { id: 'T3', x: 850, y: 1250, r: 180 },
    { id: 'T4', x: 500, y: 1600, r: 180 },
    { id: 'T5', x: 2500, y: 400, r: 180 },
    { id: 'T6', x: 2150, y: 750, r: 180 },
    { id: 'T7', x: 2150, y: 1250, r: 180 },
    { id: 'T8', x: 2500, y: 1600, r: 180 }
  ];

  function segmentHitsCircle(ax, ay, bx, by, cx, cy, r) {
    var abx = bx - ax, aby = by - ay;
    var l2 = abx * abx + aby * aby;
    if (l2 < 1e-4) return false;
    var u = Math.max(0, Math.min(1, ((cx - ax) * abx + (cy - ay) * aby) / l2));
    var isDepartingFromThis = Math.hypot(ax - cx, ay - cy) < (r + 80);
    var isArrivingAtThis = Math.hypot(bx - cx, by - cy) < (r + 80);
    var uMin = isDepartingFromThis ? 0.13 : 0.02;
    var uMax = isArrivingAtThis ? 0.87 : 0.98;
    if (u <= uMin || u >= uMax) return false;
    var px = ax + u * abx, py = ay + u * aby;
    return Math.hypot(cx - px, cy - py) < r;
  }

  function isSegmentBlocked(ax, ay, bx, by, act, sim) {
    var abx = bx - ax, aby = by - ay;
    var l2 = abx * abx + aby * aby;
    if (l2 < 1e-4) return false;

    var isBlue = (sim.params && sim.params().team === 'blue');
    var targetPk = act && act.famille === 'prendre' ? (isBlue && typeof ENGINE !== 'undefined' ? ENGINE.mirrorId(act.p) : act.p) : null;
    var stones = typeof sim.stones === 'function' ? sim.stones() : [];
    var held = typeof sim.held === 'function' ? sim.held() : (sim.held || {});
    var nA = (held.A && held.A.stack) ? held.A.stack.filter(function (x) { return x; }).length : 0;
    var nB = (held.B && held.B.stack) ? held.B.stack.filter(function (x) { return x; }).length : 0;
    var rRob = 235;
    if (nA > 0 && nB > 0) rRob = 350;
    else if (nA > 0 || nB > 0) rRob = 310;

    // 1. Collision avec les paquets P1..P10 encore au sol
    for (var k = 0; k < 10; k++) {
      var pkId = 'P' + (k + 1);
      if (pkId === targetPk) continue;

      var hasStones = stones.some(function (st) {
        return st.pk === k && st.cur && st.cur.k === 'home';
      });
      if (!hasStones) continue;

      var cx = PACK_CENTERS[k][0], cy = PACK_CENTERS[k][1];
      var acx = cx - ax, acy = cy - ay;
      var u = Math.max(0, Math.min(1, (acx * abx + acy * aby) / l2));
      var px = ax + u * abx, py = ay + u * aby;
      var hx = (k === 8 || k === 9) ? 55 : 160;
      var hy = (k === 8 || k === 9) ? 160 : 55;
      var dx = Math.max(0, Math.abs(px - cx) - hx);
      var dy = Math.max(0, Math.abs(py - cy) - hy);
      var distToBox = Math.hypot(dx, dy);
      if (distToBox < rRob && u > 0.05 && u < 0.95) return true;
    }

    // 2. Collision avec les constructions (M1..M10, T1..T8) déjà posées
    var targetZone = act && act.z ? (isBlue && typeof ENGINE !== 'undefined' ? ENGINE.mirrorId(act.z) : act.z) : null;
    for (var b = 0; b < BUILD_OBSTACLES.length; b++) {
      var obs = BUILD_OBSTACLES[b];
      var zId = isBlue && typeof ENGINE !== 'undefined' ? ENGINE.mirrorId(obs.id) : obs.id;
      if (zId === targetZone) continue;
      if (!zoneHasBuild(sim, zId)) continue;
      var ox = isBlue ? 3000 - obs.x : obs.x, oy = obs.y;
      if (segmentHitsCircle(ax, ay, bx, by, ox, oy, obs.r)) return true;
    }

    // 2b. Collision avec toute pierre libre sur la table (déposée)
    for (var sIdx = 0; sIdx < stones.length; sIdx++) {
      var stItem = stones[sIdx];
      if (stItem.cur && stItem.cur.k === 'free' && stItem.cur.geo && stItem.cur.geo.fo) {
        var fo = stItem.cur.geo.fo;
        if (targetPk && stItem.pk === parseInt(targetPk.slice(1), 10) - 1) continue;
        if (segmentHitsCircle(ax, ay, bx, by, fo.cx, fo.cy, rRob + 55)) return true;
      }
    }

    // 3. Empêcher de traverser l'enceinte du château si elle est fermée
    var inCastleNow = (isBlue ? (3000 - ax) : ax) < 760 && ay > 300 && ay < 1700;
    var inCastleAfter = (isBlue ? (3000 - bx) : bx) < 760 && by > 300 && by < 1700;
    var exitsOpen = ['M2', 'M3', 'M4'].filter(function (z) {
      var zid = isBlue && typeof ENGINE !== 'undefined' ? ENGINE.mirrorId(z) : z;
      if (zid === targetZone && act && (act.famille === 'mur' || act.famille === 'porte')) {
        if (inCastleAfter) return true;
        return false;
      }
      return !zoneHasBuild(sim, zid);
    }).length;

    if (exitsOpen === 0 && (inCastleNow !== inCastleAfter)) {
      return true;
    }

    // 4. Ne pas fermer la DERNIÈRE porte de façade depuis l'EXTÉRIEUR
    if (act) {
      var isFrontWall = (act.famille === 'mur' || act.famille === 'porte') && (act.z === 'M2' || act.z === 'M3' || act.z === 'M4');
      if (isFrontWall && !inCastleAfter && exitsOpen === 0 && !zoneHasBuild(sim, targetZone)) {
        return true;
      }
    }

    // 5. Collision avec le robot adverse si détecté
    var opp = (typeof sim.oppPose === 'function' ? sim.oppPose() : (sim.opp ? sim.opp : null));
    if (opp && opp.x > 0 && opp.y > 0) {
      if (segmentHitsCircle(ax, ay, bx, by, opp.x, opp.y, 350)) return true;
    }

    return false;
  }

  function getEffectiveActionDistance(ax, ay, tx, ty, act, sim) {
    if (!isSegmentBlocked(ax, ay, tx, ty, act, sim)) {
      return Math.hypot(tx - ax, ty - ay);
    }
    var isBlue = (sim.params && sim.params().team === 'blue');
    var bestDist = Infinity;
    for (var w = 0; w < WAYPOINTS.length; w++) {
      var wx = isBlue ? 3000 - WAYPOINTS[w][0] : WAYPOINTS[w][0];
      var wy = WAYPOINTS[w][1];
      if (!isSegmentBlocked(ax, ay, wx, wy, null, sim) && !isSegmentBlocked(wx, wy, tx, ty, act, sim)) {
        var d = Math.hypot(wx - ax, wy - ay) + Math.hypot(tx - wx, ty - wy);
        if (d < bestDist) bestDist = d;
      }
    }
    return bestDist < Infinity ? bestDist : null;
  }

  // R2 : Validation multi-angle : valide si AU MOINS UN angle est libre
  function hitsCrates(act, sim) {
    if (!act) return false;
    if (act.famille === 'boulets' || act.famille === 'trone' || act.famille === 'tournerPince' || act.famille === 'deposerZone') return false;
    if (!sim || typeof sim.pose !== 'function') return false;
    var s = sim.pose();
    if (!s || s.x == null) return false;
    var tgts = getActionTargets(act, sim);
    if (!tgts || !tgts.length) return false;

    var isBlue = (sim.params && sim.params().team === 'blue');
    var bestDist = Infinity;
    for (var i = 0; i < tgts.length; i++) {
      var raw = tgts[i];
      var tx = isBlue ? 3000 - raw[0] : raw[0];
      var ty = raw[1];
      if (tx < 70 || tx > 2930 || ty < 70 || ty > 1930) continue;
      var effDist = getEffectiveActionDistance(s.x, s.y, tx, ty, act, sim);
      if (effDist != null && effDist < bestDist) {
        bestDist = effDist;
      }
    }
    return bestDist === Infinity;
  }

  function valid(act, sim) {
    if (hitsCrates(act, sim)) return false;

    // Anticipation temporelle : budget temps pour rentrer au trône et tirer les boulets (<= 100s)
    if (act.famille !== 'boulets' && act.famille !== 'trone' && typeof sim.pose === 'function' && typeof sim.time === 'function') {
      var tgts = getActionTargets(act, sim);
      if (tgts && tgts.length) {
        var s = sim.pose();
        var isBlue = (sim.params && sim.params().team === 'blue');
        var thX = isBlue ? 2750 : 250, thY = 1000;
        var MECH_DURATIONS = {
          'prendre': 1.8, 'mur': 1.6, 'tour': 2.2, 'porte': 4.8, 'boulets': 5.0,
          'prendreGraal': 2.5, 'poserGraal': 2.9, 'trone': 2.0,
          'staging': 1.6, 'repickup': 1.6, 'traj': 0.2, 'tournerPince': 0.75, 'deposerZone': 1.0
        };
        var mech = act.mech || MECH_DURATIONS[act.famille] || 1.0;
        var minTime = Infinity;
        for (var ti = 0; ti < tgts.length; ti++) {
          var rawTgt = tgts[ti];
          var tx = isBlue ? 3000 - rawTgt[0] : rawTgt[0], ty = rawTgt[1];
          if (tx < 70 || tx > 2930 || ty < 70 || ty > 1930) continue;
          var effDist = getEffectiveActionDistance(s.x, s.y, tx, ty, act, sim) || Math.hypot(tx - s.x, ty - s.y);
          var dt_act = effDist / 500.0 + mech;
          var dt_throne = Math.hypot(thX - tx, thY - ty) / 500.0 + 0.5;
          var tTotal = dt_act + dt_throne;
          if (tTotal < minTime) minTime = tTotal;
        }
        var ballsFired = sim.balls && sim.balls().shots;
        var dt_tir = ballsFired ? 0.0 : 6.1;
        if (minTime < Infinity && sim.time() + minTime + dt_tir > 100.0) return false;
      }
    }

    act = real(act, sim);
    switch (act.famille) {
      case 'prendre':
        var h = sim.held()[act.f];
        var heldCount = (h && h.stack) ? h.stack.filter(function (x) { return x; }).length : 0;
        var faceCanTake = (heldCount === 0) || (heldCount < 3 && ((sim.pose()[act.f] && sim.pose()[act.f].rot) || 0) === 0);
        return faceCanTake && !faceHoldsGraal(sim, act.f) && packetStacked(sim, act.p, act.f);
      case 'mur': return faceStackFlat(sim, act.f) && !zoneHasBuild(sim, act.z);
      case 'tour': return stoneHeldRank(sim, act.f, act.rank) && !towerComplete(sim, act.z);
      case 'porte': return faceStackFlat(sim, act.f) && !zoneHasBuild(sim, act.z) && !castleHasDoor(sim) && validDoorTarget(act);
      case 'boulets': return !sim.balls().shots && sim.time() >= 80;
      case 'prendreGraal': return faceEmpty(sim, act.f) && sim.graal().cur.k === 'home';
      case 'poserGraal': return faceHoldsGraal(sim, act.f) && zoneHasBuild(sim, act.z);
      case 'trone': return true;
      case 'staging':
        var hS = sim.held()[act.f];
        var nS = (hS && hS.stack) ? hS.stack.filter(function (x) { return x; }).length : 0;
        return nS === 3 && ((sim.pose()[act.f] && sim.pose()[act.f].rot) || 0) === 0;
      case 'repickup':
        return faceEmpty(sim, act.f) && !faceHoldsGraal(sim, act.f);
      case 'traj':
        return true;
      case 'tournerPince':
        return true;
      case 'deposerZone':
        var hD = sim.held()[act.f];
        return !!(hD && hD.stack && hD.stack.some(function (x) { return x; }));
      default: return false;
    }
  }

  function mask(sim, catalogue) {
    return (catalogue || ALL).map(function (act) { return valid(act, sim) ? 1 : 0; });
  }

  var api = {
    FACES: FACES, PACKS: PACKS, MURS: MURS, TOURS: TOURS, COTES: COTES, FAMILLES: FAMILLES, ALL: ALL,
    ALL_BASE: ALL_BASE,
    filterByFamilles: filterByFamilles, toProgramStep: toProgramStep, indexOfStep: indexOfStep,
    valid: valid, mask: mask, hitsCrates: hitsCrates, isSegmentBlocked: isSegmentBlocked,
    getEffectiveActionDistance: getEffectiveActionDistance, packetStacked: packetStacked,
    getActionTarget: getActionTarget, getActionTargets: getActionTargets,
    STAGING_ZONES: STAGING_ZONES, STAGING_TARGETS: STAGING_TARGETS,
    WAYPOINTS: WAYPOINTS, WAYPOINTS_INFO: WAYPOINTS_INFO
  };
  root.ACTIONS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
