#!/usr/bin/env python3
"""Nacelle de préhension (faces A et B) : faisabilité des rotations 0 / 90 / 180° sous 350 mm.

Modèle plan, dans le plan de la face : u = horizontale le long de la face, z = hauteur.
L'axe de rotation est au niveau de la rangée de ventouses 2 (comme dans engine/engine.js : hc).
Chaque rangée de ventouses est une capsule (demi-longueur, rayon). La pierre tenue est un rectangle.

Règles appliquées (règlement général F.3, jeu E.1.b) :
- actionneurs (ventouses, nacelle) : 350 mm au plus à tout instant ;
- pierres : 350 mm au plus, sauf dans les zones de construction et le château (pas de limite chiffrée) ;
- rien sous le sol : garde de GARDE_SOL mm.

Pendant une rotation, le chariot monte ou descend en même temps (mouvement coordonné) :
une rotation est faisable si, à chaque angle, il existe une hauteur d'axe qui respecte tout.

Usage : python tools/conception_pince.py   (écrit conception/pince_rotation.png)
"""
from __future__ import annotations

import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

PIERRE_L, PIERRE_E = 320.0, 110.0
H_MAX, GARDE_SOL = 350.0, 5.0
BORD_V3 = 12.0  # centre de la ventouse Ø20 de la pierre 3 au-dessus du bord bas de la pierre
# rangées de ventouses : (z relatif à l'axe, demi-écartement des 2 ventouses, rayon)
# rangées 1 et 2 : Ø40 à ±100 mm (hors du tag ArUco central, à 40 mm des bouts de la pierre)
# rangée 3 : 2 ventouses ovales 40 x 20 mm (grand axe horizontal) centrées à ±66 mm :
#   20 mm de haut pour poser le linteau sous 350 mm, hors du tag, enveloppe ±86 mm compatible avec la rotation de la pile
V3_CENTRE, V3_LONG, V3_HAUT = 66.0, 40.0, 20.0
RANGEES = {
    1: (-110.0, 100.0, 20.0),
    2: (0.0, 100.0, 20.0),
    3: (PIERRE_E / 2 + BORD_V3, V3_CENTRE + (V3_LONG - V3_HAUT) / 2, V3_HAUT / 2),  # +67 au-dessus de l'axe
}
TAG_DEMI = 45.0  # tag ArUco ~90 mm (estimé sur les photos du règlement, taille non cotée) centré sur la face

# --- tenue des ventouses (hypothèses explicites, à confirmer par essai) ---
MU = 0.5        # frottement ventouse / carton
ACC = 2.0       # m/s², accélération du robot (0,5 m/s atteints en 0,25 s)
PORTE_A_FAUX = 0.055  # m, centre de gravité de la pierre devant la face de contact (demi-épaisseur)


def tenue(masse, dp_kpa):
    """Coefficients de sécurité (pelage, glissement) pour les 3 cas de prise ; dp = dépression sous la ventouse."""
    g, dp = 9.81, dp_kpa * 1000
    out = {}
    # rangée 3 : 2 ventouses Ø20 près du bord bas, pierre à plat (linteau)
    r3 = V3_HAUT / 2000; A3 = ((V3_LONG - V3_HAUT) * V3_HAUT + math.pi * (V3_HAUT / 2) ** 2) / 1e6; h_cg = (PIERRE_E / 2 - BORD_V3) / 1000 + r3
    m_charge = masse * (g * PORTE_A_FAUX + ACC * h_cg)
    out["rangée 3 (2 ovales), linteau à plat"] = min(2 * dp * A3 * r3 / m_charge, MU * 2 * dp * A3 / (masse * math.hypot(g, ACC)))
    # rangée 1 : 2 ventouses Ø40 au centre de la pierre 1, qui porte au pire les 3 pierres de la pile en glissement
    _, x1, r1 = RANGEES[1]; r1 /= 1000; A1 = math.pi * r1 ** 2
    m_charge = masse * (g * PORTE_A_FAUX + ACC * r1)
    out["rangée 1, pile de 3 (pire cas)"] = min(2 * dp * A1 * r1 / m_charge, MU * 2 * dp * A1 / (3 * masse * math.hypot(g, ACC)))
    # rangée 1, pierre debout (nacelle à 90°) : 2 ventouses l'une au-dessus de l'autre, à 2*x1 d'écart
    x1m = x1 / 1000
    m_charge = masse * (g * PORTE_A_FAUX + ACC * (x1m + r1))
    out["rangée 1, pierre debout (90°)"] = min(dp * A1 * (r1 + 2 * x1m + r1) / m_charge, MU * 2 * dp * A1 / (masse * math.hypot(g, ACC)))
    return out


def rect(u0, z0, u1, z1, n=24):
    pts = []
    for k in range(n + 1):
        f = k / n
        pts += [(u0 + (u1 - u0) * f, z0), (u0 + (u1 - u0) * f, z1), (u0, z0 + (z1 - z0) * f), (u1, z0 + (z1 - z0) * f)]
    return pts


def capsule(zc, hl, r, n=24):
    pts = []
    for s in (-1, 1):
        for k in range(n + 1):
            a = math.pi * k / n
            pts.append((s * hl + s * r * math.sin(a), zc + r * math.cos(a)))
    return pts


def capsule_contour(zc, hl, r, n=16):
    """Contour ordonné d'une capsule (pour le dessin)."""
    pts = [(hl + r * math.cos(a), zc + r * math.sin(a)) for a in [-math.pi / 2 + math.pi * k / n for k in range(n + 1)]]
    pts += [(-hl + r * math.cos(a), zc + r * math.sin(a)) for a in [math.pi / 2 + math.pi * k / n for k in range(n + 1)]]
    return pts


def actionneur():
    pts = []
    for zc, hl, r in RANGEES.values():
        pts += capsule(zc, hl, r)
    return pts


def pierre_tenue(rangee):
    """Pierre tenue par la rangée donnée, nacelle à 0° (pierre à plat)."""
    zc = RANGEES[rangee][0]
    if rangee == 3:
        bas = zc - BORD_V3
    else:
        bas = zc - PIERRE_E / 2
    return rect(-PIERRE_L / 2, bas, PIERRE_L / 2, bas + PIERRE_E)


def tourne(pts, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return [(u * c - z * s, u * s + z * c) for u, z in pts]


def plage_axe(act, pierres, chateau):
    """Hauteurs d'axe admissibles [hmin, hmax] pour une configuration donnée, ou None."""
    bas = min(z for _, z in act + pierres)
    haut_act = max(z for _, z in act)
    hmin = GARDE_SOL - bas
    hmax = H_MAX - haut_act
    if pierres and not chateau:
        hmax = min(hmax, H_MAX - max(z for _, z in pierres))
    return (hmin, hmax) if hmin <= hmax else None


def balayage(pierres0, deb, fin, chateau, pas=1.0):
    """Rotation de deb à fin degrés : renvoie (faisable, pire marge, [(angle, hmin, hmax)])."""
    act0 = actionneur()
    out, pire = [], 1e9
    n = int(abs(fin - deb) / pas)
    for k in range(n + 1):
        a = deb + (fin - deb) * k / n
        r = plage_axe(tourne(act0, a), tourne(pierres0, a), chateau)
        if r is None:
            lo = GARDE_SOL - min(z for _, z in tourne(act0 + pierres0, a))
            hi = H_MAX - max(z for _, z in tourne(act0, a))
            if pierres0 and not chateau:
                hi = min(hi, H_MAX - max(z for _, z in tourne(pierres0, a)))
            out.append((a, lo, hi))
            pire = min(pire, hi - lo)
        else:
            out.append((a, r[0], r[1]))
            pire = min(pire, r[1] - r[0])
    return pire >= 0, pire, out


def resume(nom, pierres, deb, fin, chateau):
    ok, marge, prof = balayage(pierres, deb, fin, chateau)
    print(f"{nom:66s} {'FAISABLE' if ok else 'IMPOSSIBLE':10s} marge mini {marge:7.1f} mm")
    return ok, prof


def main():
    p3 = pierre_tenue(3)
    p1 = pierre_tenue(1)
    pile = pierre_tenue(1) + pierre_tenue(2) + rect(-PIERRE_L / 2, 55, PIERRE_L / 2, 165)
    print("Rangée 3 à +%.0f mm de l'axe (ventouses de 20 mm de haut, centrées à %.0f mm du bord bas de la pierre 3)\n" % (RANGEES[3][0], BORD_V3))

    print("— Hauteurs à 0° —")
    act_top = max(z for _, z in actionneur())
    print(f"prise d'une pile au sol : axe à 165 mm -> ventouses de 30 à {165 + act_top:.0f} mm")
    print(f"linteau (porte) : bas de la pierre 3 à 325 mm -> axe à {325 - (RANGEES[3][0] - BORD_V3):.0f} mm -> haut des ventouses à {325 - (RANGEES[3][0] - BORD_V3) + act_top:.0f} mm (limite 350)")
    axe_bas3 = 325 - (RANGEES[3][0] - BORD_V3)
    print(f"  -> la nacelle ne doit pas dépasser {H_MAX - axe_bas3 - RANGEES[3][0]:.0f} mm au-dessus du centre de la ventouse 3")
    print(f"linteau tenu par la ventouse 1 (pierre prise en bas, sans retournement) : axe à {325 + 55 + 110:.0f} mm -> ventouses à {325 + 55 + 110 + act_top:.0f} mm : IMPOSSIBLE\n")

    print("— Rotations (mouvement coordonné du chariot) —")
    resume("nacelle vide 0 -> 180°", [], 0, 180, False)
    resume("retournement 180 -> 0° avec 1 pierre (ventouse 3), hors château", p3, 180, 0, False)
    ok_c, prof_c = resume("retournement 180 -> 0° avec 1 pierre (ventouse 3), dans le château", p3, 180, 0, True)
    resume("retournement 180 -> 360° (autre sens), dans le château", p3, 180, 360, True)
    resume("1 pierre (ventouse 1) 0 -> 90° (tour), hors château", p1, 0, 90, False)
    resume("1 pierre (ventouse 3) 0 -> 90° (tour), hors château", p3, 0, 90, False)
    resume("pile de 3 pierres 0 -> 90° (piliers de porte), hors château", pile, 0, 90, False)
    resume("pile de 3 pierres 0 -> 90° (piliers de porte), dans le château", pile, 0, 90, True)
    resume("1 pierre (ventouse 1) 0 -> 90° (tour), dans le château", p1, 0, 90, True)
    resume("1 pierre (ventouse 2) 0 -> 180°, dans le château", pierre_tenue(2), 0, 180, True)

    print("\n— Sensibilité : demi-largeur des rangées 1 et 2 (axe des ventouses extrêmes + rayon) —")
    z1, hl1, r1 = RANGEES[1]; z2, hl2, r2 = RANGEES[2]
    for hl in (105, 90, 80, 70, 60):
        RANGEES[1] = (z1, hl, r1); RANGEES[2] = (z2, hl, r2)
        m_pile = balayage(pile, 0, 90, True)[1]
        m_flip = balayage(p3, 180, 0, True)[1]
        print(f"  demi-longueur {hl:3d} + rayon {r1:.0f} : pile 0->90° (château) marge {m_pile:6.1f} | retournement avec pierre marge {m_flip:6.1f}")
    RANGEES[1] = (z1, hl1, r1); RANGEES[2] = (z2, hl2, r2)
    print("\n— Sensibilité : demi-écartement des 2 ventouses Ø20 de la rangée 3 —")
    z3, hl3, r3 = RANGEES[3]
    for hl in (90, 80, 70, 60, 50):
        RANGEES[3] = (z3, hl, r3)
        print(f"  ventouses 3 à ±{hl:3d} mm : pile 0->90° (château) marge {balayage(pile, 0, 90, True)[1]:6.1f} | 1 pierre ventouse 1 0->90° (château) {balayage(p1, 0, 90, True)[1]:6.1f} | retournement avec pierre {balayage(p3, 180, 0, True)[1]:6.1f}")
    RANGEES[3] = (z3, hl3, r3)

    print("\n— Tenue des ventouses : coefficient de sécurité (>= 3 visé) —")
    print(f"hypothèses : frottement {MU}, accélération {ACC} m/s², centre de gravité à {PORTE_A_FAUX*1000:.0f} mm devant la face")
    for masse in (0.090, 0.180):
        for dp in (10, 20, 30, 40):
            t = tenue(masse, dp)
            print(f"  pierre {masse*1000:3.0f} g, dépression {dp:2d} kPa : " + " | ".join(f"{k} {v:4.1f}" for k, v in t.items()))
    print(f"\nencombrement : rangées 1-2 de ±{RANGEES[1][1] + RANGEES[1][2]:.0f} mm, rangée 3 de ±{RANGEES[3][1] + RANGEES[3][2]:.0f} mm ; "
          f"tag supposé de ±{TAG_DEMI:.0f} mm : jeu {V3_CENTRE - V3_LONG / 2 - TAG_DEMI:.0f} mm (rangée 3), {RANGEES[1][1] - RANGEES[1][2] - TAG_DEMI:.0f} mm (rangées 1-2) ; "
          f"bout de pierre à {PIERRE_L/2 - RANGEES[1][1] - RANGEES[1][2]:.0f} mm des ventouses Ø40")

    dessin(p3, prof_c)


def dessin(p3, prof):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon

    etapes = [180, 135, 90, 45, 0]
    fig, axes = plt.subplots(1, len(etapes) + 1, figsize=(19, 5.2), gridspec_kw={"width_ratios": [1] * len(etapes) + [1.4]})
    act0 = actionneur()
    for ax, a in zip(axes, etapes):
        h = next(((lo + hi) / 2 for (aa, lo, hi) in prof if abs(aa - a) < 0.6), None)
        b = RANGEES[3][0] - BORD_V3
        coins = [(-PIERRE_L / 2, b), (PIERRE_L / 2, b), (PIERRE_L / 2, b + PIERRE_E), (-PIERRE_L / 2, b + PIERRE_E)]
        quad = [(u, z + h) for u, z in tourne(coins, a)]
        ax.add_patch(Polygon(quad, closed=True, fc="#d2b48c", ec="saddlebrown", label="pierre"))
        for i, (zc, hl, r) in RANGEES.items():
            C = [(u, z + h) for u, z in tourne(capsule_contour(zc, hl, r), a)]
            ax.add_patch(Polygon(C, closed=True, fc="tab:blue" if i < 3 else "tab:red", alpha=.6))
        ax.plot([0], [h], "k+", ms=12)
        ax.axhline(0, color="k"); ax.axhline(H_MAX, color="r", ls="--")
        ax.set_xlim(-260, 260); ax.set_ylim(-20, 480); ax.set_aspect("equal")
        ok = next((lo <= hi for (aa, lo, hi) in prof if abs(aa - a) < 0.6), True)
        ax.set_title(f"{a}°  (axe à {h:.0f} mm)" + ("" if ok else " : IMPOSSIBLE"), fontsize=10, color="k" if ok else "r")
        ax.set_xticks([]);
    axes[0].set_ylabel("z (mm)")
    axes[0].text(-250, 355, "350 mm", color="r", fontsize=8)
    axL = axes[-1]
    A = [p[0] for p in prof]
    lo = [p[1] for p in prof]; hi = [p[2] for p in prof]
    axL.plot(A, lo, "k-", lw=1.5, label="axe minimal (rien sous le sol)")
    axL.plot(A, hi, "r-", lw=1.5, label="axe maximal (actionneurs <= 350 mm)")
    axL.fill_between(A, lo, hi, where=[l <= h for l, h in zip(lo, hi)], color="tab:green", alpha=.3, label="faisable")
    axL.fill_between(A, lo, hi, where=[l > h for l, h in zip(lo, hi)], color="tab:red", alpha=.3, label="impossible")
    axL.invert_xaxis(); axL.set_xlabel("angle de la nacelle (°)"); axL.set_ylabel("hauteur de l'axe (mm)")
    axL.set_title("Retournement avec pierre (château) :\nhauteur d'axe nécessaire", fontsize=10); axL.grid(alpha=.3); axL.legend(fontsize=8)
    fig.suptitle("Pierre prise en bas avec la ventouse 3 (nacelle à 180°), puis retournée à 0° pour servir de linteau", fontsize=11)
    fig.tight_layout()
    fig.savefig(ROOT / "conception" / "pince_rotation.png", dpi=100)


def perimetre(step_path):
    """Saillie admissible des nacelles A et B (canon rentré, fourche du Graal rangée au-dessus du toit)."""
    import sys
    sys.path.insert(0, str(ROOT / "tools"))
    from mesure_step import hull, mesh_points, perimeter
    pts = mesh_points(step_path)
    z1 = max(p[2] for p in pts)
    top = hull([(x, y) for x, y, z in pts if z > z1 - 5])
    cx, cy = sum(p[0] for p in top) / len(top), sum(p[1] for p in top) / len(top)
    base = hull([(x - cx, y - cy) for x, y, _ in pts])
    faces = {"A": -72.1, "B": 47.9}   # affectation provisoire (spec/robot.json)

    def avec(saillie, demi_u):
        q = list(base)
        for ang in faces.values():
            n = (math.cos(math.radians(ang)), math.sin(math.radians(ang)))
            t = (-n[1], n[0])
            for sgn in (-1, 1):
                for d in (110.3, 110.3 + saillie):
                    q.append((n[0] * d + sgn * t[0] * demi_u, n[1] * d + sgn * t[1] * demi_u))
        return perimeter(hull(q))

    act = actionneur()
    demi0 = max(abs(u) for u, _ in act)
    demi_max = max(max(abs(u) for u, _ in tourne(act, a)) for a in range(0, 181))
    print(f"\n— Périmètre (châssis seul : {perimeter(base):.1f} mm) —")
    print(f"largeur de la nacelle à 0° : ±{demi0:.0f} mm ; au pire pendant une rotation : ±{demi_max:.0f} mm")
    for s_ in (10, 20, 25, 30, 35, 40):
        print(f"  saillie {s_:2d} mm : départ (nacelles à 0°) {avec(s_, demi0):7.1f} mm | match, 2 nacelles au pire angle {avec(s_, demi_max):7.1f} mm")


if __name__ == "__main__":
    import sys as _s
    main()
    if len(_s.argv) > 1:
        perimetre(_s.argv[1])
