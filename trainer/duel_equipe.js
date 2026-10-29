/* Pont d'équipe de l'environnement d'apprentissage (chantier deux-côtés, docs/CONTRATS.md §17).

   Constat : ENV.create (engine/env.js) ne fait jouer que le jaune. ENGINE.makeDuel force `team: 'yellow'` pour le robot du
   joueur (clé « yellow » du duel), l'adversaire est toujours bleu (clé « blue », `oBlue.team = 'blue'`, params passés par
   `blueParams`, programmes passés par `mirrorStep`), et `exec` du joueur n'applique jamais `ACTIONS.realStep(., 'blue')`.

   Ce module n'ajoute RIEN au moteur : il remplace ENGINE.makeDuel, dans le processus du worker seulement, par un duel dont les rôles
   sont inchangés (clé « yellow » = NOTRE robot, clé « blue » = l'adversaire, comme le lit engine/env.js) mais dont les équipes
   sont échangées quand le scénario demande l'équipe bleue :
   - notre robot : makeSim(ENGINE.blueParams(params)), briques de l'équipe converties en briques réelles (ACTIONS.realStep) ;
   - l'adversaire : équipe jaune. Ses params (déjà passés par blueParams par env.js) sont ramenés au jaune (inverse de blueParams) ;
     un robot à règles est construit avec `team: 'yellow'` ; un programme enregistré (écrit en repère jaune, déjà mis en miroir par
     env.js) est remis en repère jaune brique par brique ; un cerveau lit son équipe dans sa croyance (rien à faire).
   Quand le moteur saura jouer le bleu (ENV.create / makeDuel avec une équipe), ce fichier et son appel dans engine/env_worker.js
   se suppriment sans autre changement (le champ de scénario `equipe` est déjà celui du contrat).

   Utilisation : const pont = require('../trainer/duel_equipe.js')(ctx);  pont.avecEquipe('blue', function () { env.reset(sc); });
*/
'use strict';

module.exports = function (ctx) {
  var ENGINE = ctx.ENGINE, ACTIONS = ctx.ACTIONS;
  var origMakeDuel = ENGINE.makeDuel;
  var courante = 'yellow';

  function equipeValide(e) {
    if (e == null) return 'yellow';
    if (e === 'yellow' || e === 'blue') return e;
    throw new Error('Équipe inconnue : ' + e + ' (attendu : yellow, blue).');
  }

  /* inverse de ENGINE.blueParams (involutif sur les champs qu'elle transforme) */
  function jaunePourBleu(P) {
    var Q = Object.assign({}, P, { team: 'yellow' });
    Q.x0 = 3000 - P.x0; Q.h0 = ENGINE.mirrorCap(P.h0); Q.gx = 3000 - P.gx; Q.ga = 180 - P.ga;
    return Q;
  }

  function makeDuelBleu(cfg) {
    cfg = cfg || {};
    var DEF = ENGINE.DEF;
    var Pnous = ENGINE.blueParams(Object.assign({}, DEF, cfg.params || {}));
    var hasOpp = !!cfg.blue;
    var tk = { yellow: {}, blue: {} }, sims = {}, programs = { yellow: [], blue: [] };
    sims.yellow = ENGINE.makeSim(Object.assign({}, Pnous, { oppTaken: tk.blue }), {
      skipContacts: !!cfg.skipContacts,
      oppPoseAt: hasOpp ? function (tt) { return sims.blue.poseAtT(tt); } : null,
      foreignFeet: hasOpp ? function () { return sims.blue.freeFeet(); } : null
    });
    if (hasOpp) {
      var oOpp = {
        skipContacts: !cfg.blue.contacts, team: 'yellow', oppTaken: tk.yellow,
        oppPoseAt: function (tt) { return sims.yellow.poseAtT(tt); },
        oppRadius: function () { return sims.yellow.hullRadius(); },
        foreignFeet: function () { return sims.yellow.freeFeet(); }
      };
      sims.blue = cfg.blue.make ? cfg.blue.make(oOpp)
        : ENGINE.makeSim(Object.assign({}, DEF, jaunePourBleu(cfg.blue.params || ENGINE.blueParams(Object.assign({}, DEF, cfg.params || {}))), { oppTaken: tk.yellow }), oOpp);
    }
    /* brique de l'agent -> brique réelle : notre robot (clé « yellow ») reçoit une brique de l'équipe bleue ; un programme enregistré
       adverse a été mis en miroir par env.js pour un adversaire bleu : on le remet en repère jaune */
    function reelle(team, brick, agent) {
      if (team === 'yellow') return ACTIONS.realStep(brick, 'blue');
      if (agent && agent.kind === 'strategie') return ACTIONS.realStep(brick, 'blue');
      return brick;
    }
    function exec(team, brick, agent) {
      var b = reelle(team, brick, agent);
      var info = sims[team].exec(b);
      sims[team].leftHome(tk[team]);
      programs[team].push(b);
      return info;
    }
    function advanceBlue(agent, upTo) {
      if (!hasOpp || !agent) return;
      for (var n = 0; n < 500 && sims.blue.time() < upTo; n++) {
        var b = agent.next(sims.blue, sims.yellow);
        if (b == null) { agent.done = true; return; }
        exec('blue', b, agent);
      }
    }
    function run(agents) {
      var done = { yellow: false, blue: !hasOpp }, guard = 0;
      while ((!done.yellow || !done.blue) && guard++ < 5000) {
        var team = done.yellow ? 'blue' : done.blue ? 'yellow' : (sims.blue.time() < sims.yellow.time() ? 'blue' : 'yellow');
        var b = agents[team].next(sims[team], sims[team === 'yellow' ? 'blue' : 'yellow']);
        if (b == null) { done[team] = true; continue; }
        exec(team, b, agents[team]);
      }
    }
    function finish() {
      var Ry = sims.yellow.finish(), Rb = hasOpp ? sims.blue.finish() : null;
      if (hasOpp && !cfg.skipContacts) Ry = sims.yellow.result(true);
      Ry.opponent = Rb;
      Ry.oppEvents = { taken: Object.assign({}, tk.blue), none: !hasOpp };
      Ry.programs = { yellow: programs.yellow.slice(), blue: programs.blue.slice() };
      return Ry;
    }
    return { sims: sims, exec: function (team, brick) { return exec(team, brick, null); }, run: run, advanceBlue: advanceBlue, finish: finish,
             claims: tk, programs: programs, hasBlue: hasOpp, equipe: 'blue' };
  }

  ENGINE.makeDuel = function (cfg) {
    return courante === 'blue' ? makeDuelBleu(cfg) : origMakeDuel.apply(this, arguments);
  };

  return {
    equipeValide: equipeValide,
    /* exécute fn() avec l'équipe du joueur demandée (les makeDuel faits pendant l'appel jouent ce côté) */
    avecEquipe: function (equipe, fn) {
      var avant = courante;
      courante = equipeValide(equipe);
      try { return fn(); } finally { courante = avant; }
    }
  };
};
