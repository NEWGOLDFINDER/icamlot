#!/usr/bin/env python3
"""Conception du Graal à anses et de son ascenseur (face C, bord droit vu de face).

Calcule la faisabilité réglementaire, la position de dépose sur le toit, puis écrit :
- conception/graal.step               : le Graal (repère de la CAO de l'équipe, posé au sol devant la face C)
- conception/ascenseur_graal.step     : rail vertical, chariot, coulisse horizontale et fourche (position basse)
- conception/vues_graal.png           : vue de dessus et vue de profil

Usage : python tools/conception_graal.py Structure_robot_p.STEP [--toit 311.2]
Dépendances : pip install cadquery-ocp matplotlib
Toutes les cotes en mm ; les cotes de conception sont regroupées dans DESIGN.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# --- cotes de conception (propositions, voir conception/ascenseur_graal.md) ---
DESIGN = {
    "graal_base": 70.0,          # base carrée (> cube de 60 mm exigé)
    "graal_hauteur": 100.0,      # sommet <= 425 mm une fois sur le toit (balise adverse à 430 mm)
    "anse_dessous": 22.0,        # hauteur du dessous des anses au-dessus du fond du Graal
    "anse_epaisseur": 6.0,
    "anse_saillie": 22.0,        # débord latéral de chaque anse
    "anse_longueur": 50.0,       # longueur dans le sens d'engagement de la fourche
    "levre_epaisseur": 4.0,      # lèvre de retenue, côté extérieur
    "levre_hauteur": 14.0,
    "pied_diametre": 30.0,
    "coupe_diametre": 70.0,
    "dent_largeur": 8.0,         # dents de la fourche
    "dent_epaisseur": 5.0,
    "dent_longueur": 72.0,
    "dent_hauteur_basse": 9.0,   # dessous des dents en position basse (au-dessus de la table)
    "traverse_epaisseur": 8.0,
    "jeu_face": 4.0,             # entre la face C et la traverse de la fourche
    "rail_largeur": 15.0,
    "rail_epaisseur": 10.0,
    "marge_toit": 4.0,           # garde entre le fond du Graal et le toit pendant le transfert
    "mat_balise_diametre": 70.0, # section minimale autorisée (général F.6)
    "hauteur_max": 350.0,
}

FACE_C_DEG = 167.9   # normale de la face C dans la CAO (affectation provisoire, spec/robot.json)
FACE_DIST = 110.3
FACE_LONG = 262.0


def roof_polygon_local(step_path: str):
    """Contour de la plaque haute dans le repère de la face C : x = normale sortante, y = droite vue de face."""
    import sys
    sys.path.insert(0, str(ROOT / "tools"))
    from mesure_step import hull, mesh_points
    pts = mesh_points(step_path)
    z0, z1 = min(p[2] for p in pts), max(p[2] for p in pts)
    top = [(x, y) for x, y, z in pts if z > z1 - 5]
    h = hull(top)
    cx, cy = sum(p[0] for p in h) / len(h), sum(p[1] for p in h) / len(h)
    a = math.radians(FACE_C_DEG)
    n, t = (math.cos(a), math.sin(a)), (-math.sin(a), math.cos(a))
    loc = [((x - cx) * n[0] + (y - cy) * n[1], (x - cx) * t[0] + (y - cy) * t[1]) for x, y in h]
    return loc, (cx, cy, z0), n, t


def inside(poly, p, margin):
    for i in range(len(poly)):
        a, b = poly[i], poly[(i + 1) % len(poly)]
        ex, ey = b[0] - a[0], b[1] - a[1]
        L = math.hypot(ex, ey)
        # polygone dans le sens trigonométrique : l'intérieur est à gauche
        if (ex * (p[1] - a[1]) - ey * (p[0] - a[0])) / L < margin:
            return False
    return True


def ccw(poly):
    s = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    return poly if s > 0 else poly[::-1]


def faisabilite(D, toit):
    """Hauteur maximale du dessus des dents pendant le transfert, comparée à 350 mm."""
    dents_sous_anse_au_sol = D["dent_hauteur_basse"] + D["dent_epaisseur"]
    fond_transfert = toit + D["marge_toit"]
    dessus_dents_haut = fond_transfert + D["anse_dessous"]
    return {
        "toit": toit,
        "jeu_dents_anses_au_sol": round(D["anse_dessous"] - dents_sous_anse_au_sol, 1),
        "fond_graal_pendant_transfert": round(fond_transfert, 1),
        "dessus_dents_position_haute": round(dessus_dents_haut, 1),
        "marge_sous_350": round(D["hauteur_max"] - dessus_dents_haut, 1),
        "sommet_graal_sur_toit": round(toit + D["graal_hauteur"], 1),
        "toit_max_pour_ces_anses": round(D["hauteur_max"] - D["anse_dessous"] - D["marge_toit"], 1),
    }


def landing(D, roof, y0, mast_center=(0.0, 0.0)):
    """Plus grande avancée vers le centre (x minimal) qui garde la base sur le toit et hors du mât."""
    b = D["graal_base"] / 2
    r_mast = D["mat_balise_diametre"] / 2 + 3
    best = None
    x = FACE_DIST + D["jeu_face"] + D["traverse_epaisseur"] + b
    while x > -50:
        corners = [(x + sx * b, y0 + sy * b) for sx in (-1, 1) for sy in (-1, 1)]
        on_roof = all(inside(roof, c, 3.0) for c in corners)
        # distance du centre du mât au carré de la base
        dx = max(abs(mast_center[0] - x) - b, 0)
        dy = max(abs(mast_center[1] - y0) - b, 0)
        clear = math.hypot(dx, dy) >= r_mast
        if on_roof and clear:
            best = x
        if not clear:
            break
        x -= 1.0
    return best


def build_step(D, toit, frame, y0, x_pick, out_dir: Path):
    from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder
    from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec, gp_Ax1
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.Interface import Interface_Static
    from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer

    def box(x0, y0_, z0, dx, dy, dz):
        return BRepPrimAPI_MakeBox(gp_Pnt(x0, y0_, z0), dx, dy, dz).Shape()

    def fuse(shapes):
        s = shapes[0]
        for o in shapes[1:]:
            s = BRepAlgoAPI_Fuse(s, o).Shape()
        return s

    def to_cad(shape):
        cx, cy, z0 = frame
        tr = gp_Trsf()
        tr.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), math.radians(FACE_C_DEG))
        t2 = gp_Trsf()
        t2.SetTranslation(gp_Vec(cx, cy, z0))
        return BRepBuilderAPI_Transform(BRepBuilderAPI_Transform(shape, tr).Shape(), t2).Shape()

    def write(shape, path):
        Interface_Static.SetCVal_s("write.step.unit", "MM")
        w = STEPControl_Writer()
        w.Transfer(shape, STEPControl_AsIs)
        assert w.Write(str(path)) == IFSelect_RetDone

    b = D["graal_base"] / 2
    hb = D["anse_dessous"] + D["anse_epaisseur"]
    # --- Graal posé au sol, devant la face C (position de prise) ---
    g = [box(x_pick - b, y0 - b, 0, 2 * b, 2 * b, hb)]
    for s in (-1, 1):
        ya = y0 + s * b if s > 0 else y0 - b - D["anse_saillie"]
        g.append(box(x_pick - D["anse_longueur"] / 2, ya, D["anse_dessous"], D["anse_longueur"], D["anse_saillie"], D["anse_epaisseur"]))
        yl = y0 + s * (b + D["anse_saillie"]) - (D["levre_epaisseur"] if s > 0 else 0)
        g.append(box(x_pick - D["anse_longueur"] / 2, yl, hb - D["levre_hauteur"], D["anse_longueur"], D["levre_epaisseur"], D["levre_hauteur"]))
    h_pied = 27.0
    g.append(BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x_pick, y0, hb), gp_Dir(0, 0, 1)), D["pied_diametre"] / 2, h_pied).Shape())
    h_coupe = D["graal_hauteur"] - hb - h_pied
    g.append(BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(x_pick, y0, hb + h_pied), gp_Dir(0, 0, 1)), D["pied_diametre"] / 2 + 5, D["coupe_diametre"] / 2, h_coupe).Shape())
    write(to_cad(fuse(g)), out_dir / "graal.step")

    # --- ascenseur en position basse, fourche sortie (dents sous les anses) ---
    xf = FACE_DIST + D["jeu_face"]
    zt = D["dent_hauteur_basse"]
    yr = FACE_LONG / 2 - D["rail_largeur"] / 2 - 3
    parts = [box(FACE_DIST, yr - D["rail_largeur"] / 2, 15, D["rail_epaisseur"], D["rail_largeur"], 320)]
    y_lo = y0 - b - (D["anse_saillie"] - D["levre_epaisseur"]) / 2 - D["dent_largeur"] / 2
    y_hi = y0 + b + (D["anse_saillie"] - D["levre_epaisseur"]) / 2 - D["dent_largeur"] / 2
    for yd in (y_lo, y_hi):
        parts.append(box(xf + D["traverse_epaisseur"], yd, zt, D["dent_longueur"], D["dent_largeur"], D["dent_epaisseur"]))
    parts.append(box(xf, y_lo, zt, D["traverse_epaisseur"], yr + D["rail_largeur"] / 2 - y_lo, D["dent_epaisseur"] + 10))
    write(to_cad(fuse(parts)), out_dir / "ascenseur_graal.step")
    return {"rail_y": round(yr, 1), "dents_y": [round(y_lo + D["dent_largeur"] / 2, 1), round(y_hi + D["dent_largeur"] / 2, 1)]}


def draw(D, roof, toit, y0, x_pick, x_land, out_png: Path):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Circle, Polygon, Rectangle

    b = D["graal_base"] / 2
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 6))
    a1.add_patch(Polygon(roof, closed=True, fill=False, lw=1.5, label="toit (plaque haute)"))
    a1.add_patch(Circle((0, 0), D["mat_balise_diametre"] / 2, fill=False, ls="--", label="mât de balise Ø70 (au centre)"))
    a1.add_patch(Rectangle((x_pick - b, y0 - b), 2 * b, 2 * b, fill=False, ec="tab:orange", label="Graal au sol (prise)"))
    a1.add_patch(Rectangle((x_land - b, y0 - b), 2 * b, 2 * b, fill=False, ec="tab:green", lw=2, label="Graal déposé (niveau 4)"))
    yr = FACE_LONG / 2 - D["rail_largeur"] / 2 - 3
    a1.add_patch(Rectangle((FACE_DIST, yr - D["rail_largeur"] / 2), D["rail_epaisseur"], D["rail_largeur"], color="tab:red", label="rail vertical"))
    a1.plot([FACE_DIST, FACE_DIST], [-FACE_LONG / 2, FACE_LONG / 2], "k-", lw=3)
    a1.annotate("face C", (FACE_DIST + 4, -FACE_LONG / 2 + 5))
    a1.set_aspect("equal"); a1.set_xlim(-200, 260); a1.set_ylim(-200, 200)
    a1.set_xlabel("x : normale de la face C (mm)"); a1.set_ylabel("y : droite vue de face (mm)")
    a1.set_title("Vue de dessus (repère de la face C)")
    a1.legend(loc="lower left", fontsize=8); a1.grid(alpha=.3)

    hb = D["anse_dessous"]
    a2.plot([-180, FACE_DIST], [toit, toit], "k-", lw=2, label=f"toit à {toit:.1f} mm")
    a2.plot([-250, 300], [350, 350], "r--", label="limite actionneurs 350 mm")
    a2.plot([-250, 300], [430, 430], "b:", label="balise adverse 430 mm")
    a2.add_patch(Rectangle((x_pick - b, 0), 2 * b, D["graal_hauteur"], fill=False, ec="tab:orange"))
    zf = toit + D["marge_toit"]
    a2.add_patch(Rectangle((x_land - b, toit), 2 * b, D["graal_hauteur"], fill=False, ec="tab:green", lw=2))
    a2.add_patch(Rectangle((FACE_DIST, 15), D["rail_epaisseur"], 320, color="tab:red", alpha=.6))
    a2.add_patch(Rectangle((x_pick - b, D["dent_hauteur_basse"]), D["dent_longueur"], D["dent_epaisseur"], color="gray"))
    a2.add_patch(Rectangle((x_land - b, zf + hb - D["dent_epaisseur"]), D["dent_longueur"], D["dent_epaisseur"], color="gray"))
    a2.annotate("dents en haut : %.1f mm" % (zf + hb), (x_land - b, zf + hb + 6), fontsize=8)
    a2.set_xlim(-250, 300); a2.set_ylim(0, 460); a2.set_xlabel("x (mm)"); a2.set_ylabel("z (mm)")
    a2.set_title("Profil : prise au sol puis dépose sur le toit"); a2.legend(fontsize=8, loc="center left"); a2.grid(alpha=.3)
    fig.tight_layout(); fig.savefig(out_png, dpi=110)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("step")
    ap.add_argument("--toit", type=float, default=311.2, help="hauteur du toit (341.2 aujourd'hui ; 311.2 avec des tubes de 290 mm)")
    args = ap.parse_args()
    D = DESIGN
    out_dir = ROOT / "conception"
    out_dir.mkdir(exist_ok=True)

    for toit in (341.2, 321.2, 311.2):
        print(json.dumps(faisabilite(D, toit), ensure_ascii=False))

    roof, frame, n, t = roof_polygon_local(args.step)
    roof = ccw(roof)
    b = D["graal_base"] / 2
    yr = FACE_LONG / 2 - D["rail_largeur"] / 2 - 3
    # Graal (anses comprises) entièrement à gauche du rail, avec 5 mm de jeu
    y0 = yr - D["rail_largeur"] / 2 - 5 - b - D["anse_saillie"]
    x_pick = FACE_DIST + D["jeu_face"] + D["traverse_epaisseur"] + b
    res = {}
    for mast in ((0.0, 0.0), (-40.0, -40.0)):
        res[str(mast)] = landing(D, roof, y0, mast)
    x_land = res[str((0.0, 0.0))]
    print(json.dumps({"y_graal": round(y0, 1), "x_prise": round(x_pick, 1), "x_depose_mat_centre": x_land,
                      "x_depose_mat_decale(-40,-40)": res[str((-40.0, -40.0))],
                      "course_coulisse": None if x_land is None else round(x_pick - x_land, 1)}, ensure_ascii=False))
    if x_land is None:
        raise SystemExit("aucune position de dépose sur le toit : revoir les cotes")
    info = build_step(D, args.toit, frame, y0, x_pick, out_dir)
    print(json.dumps(info, ensure_ascii=False))
    draw(D, roof, args.toit, y0, x_pick, x_land, out_dir / "vues_graal.png")


if __name__ == "__main__":
    main()
