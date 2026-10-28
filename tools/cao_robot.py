#!/usr/bin/env python3
"""Robot complet (concept) : châssis réel + 2 nacelles de préhension + canon + ascenseur à Graal + Graal.

Lit l'export STEP de la base roulante, raccourcit les 6 tubes (320 -> 290 mm, toit à 311,2 mm), ajoute les
actionneurs dessinés ici (volumes de principe, pas de visserie), vérifie le règlement sur la géométrie
assemblée (hauteur, périmètre au départ, collisions entre pièces) puis écrit :
- conception/robot_depart.step     : configuration de départ (Graal au sol, devant la face C)
- conception/robot_fin.step        : fin de match (Graal monté sur le toit)
- conception/<module>.step         : chaque module seul (même repère que la CAO de l'équipe)
- conception/rendu_*.png           : vues

Usage : python tools/cao_robot.py Structure_robot_p.STEP
Dépendances : pip install cadquery-ocp matplotlib
Repère des modules : x = normale sortante de la face, y = droite vue de face, z = hauteur depuis le sol (mm).
"""
from __future__ import annotations

import argparse
import math
from pathlib import Path

from OCP.BRep import BRep_Builder, BRep_Tool
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Fuse
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_GTransform, BRepBuilderAPI_Transform
from OCP.BRepGProp import BRepGProp
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCone, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.Interface import Interface_Static
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Reader, STEPControl_Writer
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS, TopoDS_Compound
from OCP.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_GTrsf, gp_Mat, gp_Pnt, gp_Trsf, gp_Vec, gp_XYZ

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "conception"

FACES = {"A": -72.1, "B": 47.9, "C": 167.9}   # normales dans la CAO (affectation provisoire, spec/robot.json)
FACE = 110.3                                   # distance face / centre
TUBE_ORIGINE, TUBE_NOUVEAU = 320.0, 290.0
TOIT = 341.2 - (TUBE_ORIGINE - TUBE_NOUVEAU)  # 311,2 mm
H_MAX = 350.0

# --- nacelle (faces A et B), voir conception/pince.md ---
SAILLIE = 35.0          # avant des ventouses, depuis la face
H_PRISE = 165.0         # axe de rotation (rangée 2) pour prendre une pile au sol
RANGEES = {1: (-110.0, 100.0, 20.0), 2: (0.0, 100.0, 20.0)}   # (z / axe, demi-écartement, rayon)
R3_Z, R3_X, R3_L, R3_H = 67.0, 66.0, 40.0, 20.0                  # ovales 40 x 20 à ±66 mm

# --- Graal et ascenseur (face C, bord droit vu de face), voir conception/ascenseur_graal.md ---
G = {"base": 62.0, "haut": 100.0, "anse_dessous": 22.0, "anse_ep": 6.0, "anse_saillie": 20.0, "anse_long": 50.0,
     "levre_ep": 4.0, "levre_h": 14.0, "pied_d": 30.0, "coupe_d": 62.0}
F = {"dent_l": 8.0, "dent_ep": 5.0, "dent_long": 72.0, "dent_bas": 9.0, "trav_ep": 8.0, "jeu_face": 4.0, "jeu_graal": 2.0,
     "rail_y": (113.0, 128.0), "bras_y": (113.0, 123.0), "bras_long": 110.0}
MARGE_TOIT, MAT_R = 4.0, 35.0

# --- canon (face C, partie gauche), canon entièrement rentré au départ ---
CANON = {"y": -50.0, "elev": 35.0, "d": 50.0, "long": 65.0, "pied": (40.0, 100.0), "course": 90.0}


# ----------------------------------------------------------------------------------------------- primitives
def box(x0, x1, y0, y1, z0, z1):
    return BRepPrimAPI_MakeBox(gp_Pnt(x0, y0, z0), x1 - x0, y1 - y0, z1 - z0).Shape()


def cyl(p, d, r, h):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*p), gp_Dir(*d)), r, h).Shape()


def fuse(shapes):
    s = shapes[0]
    for o in shapes[1:]:
        s = BRepAlgoAPI_Fuse(s, o).Shape()
    return s


def moved(shape, rot_axis=None, deg=0.0, vec=(0, 0, 0)):
    t = gp_Trsf()
    if rot_axis is not None and deg:
        t.SetRotation(rot_axis, math.radians(deg))
    s = BRepBuilderAPI_Transform(shape, t, True).Shape() if rot_axis is not None and deg else shape
    t2 = gp_Trsf()
    t2.SetTranslation(gp_Vec(*vec))
    return BRepBuilderAPI_Transform(s, t2, True).Shape()


def compound(shapes):
    c = TopoDS_Compound()
    b = BRep_Builder()
    b.MakeCompound(c)
    for s in shapes:
        b.Add(c, s)
    return c


def bbox(shape):
    b = Bnd_Box()
    BRepBndLib.Add_s(shape, b, False)
    m, M = b.CornerMin(), b.CornerMax()
    return (m.X(), m.Y(), m.Z(), M.X(), M.Y(), M.Z())


def volume(shape):
    g = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, g)
    return g.Mass()


def write_step(shape, path):
    Interface_Static.SetCVal_s("write.step.unit", "MM")
    w = STEPControl_Writer()
    w.Transfer(shape, STEPControl_AsIs)
    assert w.Write(str(path)) == IFSelect_RetDone


# ----------------------------------------------------------------------------------------------- châssis
def chassis(step_path):
    r = STEPControl_Reader()
    r.ReadFile(step_path)
    r.TransferRoots()
    shape = r.OneShape()
    solids = []
    ex = TopExp_Explorer(shape, TopAbs_SOLID)
    while ex.More():
        solids.append(ex.Current())
        ex.Next()
    z0 = min(bbox(s)[2] for s in solids)
    dz = TUBE_ORIGINE - TUBE_NOUVEAU
    out = []
    for s in solids:
        x0, y0, zb, x1, y1, zt = bbox(s)
        if zt - zb > 300:                                  # tube vertical : raccourci
            k = TUBE_NOUVEAU / TUBE_ORIGINE
            gt = gp_GTrsf()
            gt.SetVectorialPart(gp_Mat(1, 0, 0, 0, 1, 0, 0, 0, k))
            gt.SetTranslationPart(gp_XYZ(0, 0, zb * (1 - k)))
            s = BRepBuilderAPI_GTransform(s, gt, True).Shape()
        elif zb > z0 + 250:                                # plaque haute et ses équerres : descendues
            s = moved(s, vec=(0, 0, -dz))
        out.append(s)
    top = [s for s in out if bbox(s)[5] > z0 + TOIT - 6 and volume(s) > 100000]
    tb = bbox(top[0])
    cx, cy = (tb[0] + tb[3]) / 2, (tb[1] + tb[4]) / 2
    return out, z0


def centre_toit(step_path):
    import sys
    sys.path.insert(0, str(ROOT / "tools"))
    from mesure_step import hull, mesh_points
    pts = mesh_points(step_path)
    z1 = max(p[2] for p in pts)
    h = hull([(x, y) for x, y, z in pts if z > z1 - 5])
    return sum(p[0] for p in h) / len(h), sum(p[1] for p in h) / len(h), min(p[2] for p in pts)


def to_cad(shape, face, frame):
    cx, cy, z0 = frame
    return moved(shape, gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 0, 1)), FACES[face], (cx, cy, z0))


# ----------------------------------------------------------------------------------------------- nacelle
def capsule_x(x0, x1, yc, zc, hl, r):
    """Barre arrondie dans le plan de la face (épaisseur selon x)."""
    return fuse([box(x0, x1, yc - hl, yc + hl, zc - r, zc + r),
                 cyl((x0, yc - hl, zc), (1, 0, 0), r, x1 - x0), cyl((x0, yc + hl, zc), (1, 0, 0), r, x1 - x0)])


def nacelle(h=H_PRISE, theta=0.0):
    """Guidage fixe + chariot + moteur de rotation + nacelle tournante (6 ventouses). Retourne (fixe, mobile, tournant)."""
    fixe = [box(90, 100, 50, 60, 20, 305), box(90, 100, -60, -50, 20, 305)]
    mobile = [box(100, 106, -60, 60, h - 30, h + 30), cyl((75, 0, h), (1, 0, 0), 21, 25),
              cyl((106, 0, h), (1, 0, 0), 15, 6)]
    xa, xb, xc = FACE + 2, FACE + 9.7, FACE + SAILLIE   # dos de la nacelle, avant des barres, avant des ventouses
    tour = [box(xa, xb, -15, 15, h - 135, h + R3_Z + 10)]
    for zc, x, r in RANGEES.values():
        tour.append(capsule_x(xa, xb, 0, h + zc, x, r))
        for s in (-1, 1):
            tour.append(cyl((xb, s * x, h + zc), (1, 0, 0), r, xc - xb))
    tour.append(capsule_x(xa, xb, 0, h + R3_Z, R3_X + (R3_L - R3_H) / 2, R3_H / 2))
    for s in (-1, 1):
        tour.append(capsule_x(xb, xc, s * R3_X, h + R3_Z, (R3_L - R3_H) / 2, R3_H / 2))
    t = fuse(tour)
    if theta:
        t = moved(t, gp_Ax1(gp_Pnt(0, 0, h), gp_Dir(1, 0, 0)), theta)
    return fuse(fixe), fuse(mobile), t


def pile(h=H_PRISE, n=3):
    x0 = FACE + SAILLIE
    return [box(x0, x0 + 110, -160, 160, h - 165 + 110 * k, h - 165 + 110 * (k + 1)) for k in range(n)]


# ----------------------------------------------------------------------------------------------- Graal
def graal_geometrie():
    b = G["base"] / 2
    y0 = F["rail_y"][0] - 5 - b - G["anse_saillie"]
    x_prise = FACE + F["jeu_face"] + F["trav_ep"] + F["jeu_graal"] + b
    y_gauche = y0 - b - (G["anse_saillie"] - G["levre_ep"]) / 2 - F["dent_l"] / 2
    xc_min = math.sqrt(max((MAT_R + 3) ** 2 - y_gauche ** 2, 0))   # traverse hors du mât en position rentrée
    course = FACE + F["jeu_face"] - xc_min
    x_depose = x_prise - course
    return {"y0": y0, "x_prise": x_prise, "x_depose": x_depose, "course": course, "y_gauche": y_gauche}


def graal(x, y0, zf):
    b, hb = G["base"] / 2, G["anse_dessous"] + G["anse_ep"]
    parts = [box(x - b, x + b, y0 - b, y0 + b, zf, zf + hb)]
    for s in (-1, 1):
        y_in = y0 + s * b
        y_out = y0 + s * (b + G["anse_saillie"])
        parts.append(box(x - G["anse_long"] / 2, x + G["anse_long"] / 2, min(y_in, y_out), max(y_in, y_out), zf + G["anse_dessous"], zf + hb))
        yl = y_out - s * G["levre_ep"]
        parts.append(box(x - G["anse_long"] / 2, x + G["anse_long"] / 2, min(yl, y_out), max(yl, y_out), zf + hb - G["levre_h"], zf + hb))
    h_pied = 27.0
    parts.append(cyl((x, y0, zf + hb), (0, 0, 1), G["pied_d"] / 2, h_pied))
    parts.append(BRepPrimAPI_MakeCone(gp_Ax2(gp_Pnt(x, y0, zf + hb + h_pied), gp_Dir(0, 0, 1)), G["pied_d"] / 2 + 4, G["coupe_d"] / 2, G["haut"] - hb - h_pied).Shape())
    return fuse(parts)


def ascenseur(xc, zp, gg):
    """Rail (fixe) + chariot, coulisse, traverse et dents (mobiles). xc : face intérieure de la traverse, zp : dessous des dents."""
    b = G["base"] / 2
    fixe = box(FACE, FACE + 10, *F["rail_y"], 15, 335)
    yl = gg["y0"] - b - (G["anse_saillie"] - G["levre_ep"]) / 2
    yr = gg["y0"] + b + (G["anse_saillie"] - G["levre_ep"]) / 2
    mob = [box(FACE + 10, FACE + 22, F["rail_y"][0] - 3, F["rail_y"][1] + 3, zp - 40, zp + 15),           # chariot
           box(FACE + 22, FACE + 40, F["bras_y"][0] - 2, F["bras_y"][1] + 2, zp - 5, zp + 15),             # palier de coulisse
           box(xc, xc + F["bras_long"], *F["bras_y"], zp + 5, zp + 15),                                       # bras coulissant
           box(xc, xc + F["trav_ep"], yl - F["dent_l"] / 2, F["bras_y"][1], zp, zp + 15)]                     # traverse
    for yd in (yl, yr):
        mob.append(box(xc + F["trav_ep"], xc + F["trav_ep"] + F["dent_long"], yd - F["dent_l"] / 2, yd + F["dent_l"] / 2, zp, zp + F["dent_ep"]))
    return fixe, fuse(mob)


# ----------------------------------------------------------------------------------------------- canon
def canon(deploye=False):
    a = math.radians(CANON["elev"])
    d = (math.cos(a), 0, math.sin(a))
    y, r = CANON["y"], CANON["d"] / 2
    x0, z0 = CANON["pied"]
    if deploye:
        x0 += CANON["course"] * d[0]
        z0 += CANON["course"] * d[2]
    tube = cyl((x0, y, z0), d, r, CANON["long"])
    lanceur = box(12, 55, y - 25, y + 25, 70, 150)          # bloc de lancement à 2 volants (principe)
    roues = [cyl((30, y + s * 22, 76), (0, 0, 1), 18, 62) for s in (-1, 1)]
    chargeur = box(-12, 81, -46, 46, 158, 302)             # magasin : 4 colonnes de 3 boulets Ø45 (10 chargés)
    boulets = []
    pos = [(12, -23), (57, -23), (12, 23), (57, 23)]
    for k in range(10):
        px, py = pos[k % 4]
        boulets.append(BRepPrimAPI_MakeSphere(gp_Pnt(px, py, 182 + 46 * (k // 4)), 22.5).Shape())
    return fuse([lanceur] + roues), tube, chargeur, compound(boulets)


# ----------------------------------------------------------------------------------------------- contrôles
def mesh(shape, defl=1.0):
    BRepMesh_IncrementalMesh(shape, defl, False, 0.5)
    tris = []
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        f = TopoDS.Face(ex.Current())
        loc = TopLoc_Location()
        t = BRep_Tool.Triangulation_s(f, loc)
        if t is not None:
            T = loc.Transformation()
            nodes = [t.Node(i).Transformed(T) for i in range(1, t.NbNodes() + 1)]
            for i in range(1, t.NbTriangles() + 1):
                a, b_, c = t.Triangle(i).Get()
                tris.append([(nodes[k - 1].X(), nodes[k - 1].Y(), nodes[k - 1].Z()) for k in (a, b_, c)])
        ex.Next()
    return tris


def perimetre(points):
    import sys
    sys.path.insert(0, str(ROOT / "tools"))
    from mesure_step import hull, perimeter
    return perimeter(hull(points))


def collisions(named):
    """Volumes communs entre modules (> 1 mm3)."""
    res = []
    names = list(named)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a, b = named[names[i]], named[names[j]]
            ba, bb = bbox(a), bbox(b)
            if any(ba[k] > bb[k + 3] or bb[k] > ba[k + 3] for k in range(3)):
                continue
            v = volume(BRepAlgoAPI_Common(a, b).Shape())
            if v > 1.0:
                res.append((names[i], names[j], round(v)))
    return res


# ----------------------------------------------------------------------------------------------- rendu
COULEURS = {"châssis": "#9a9a9a", "nacelle": "#1f77b4", "ventouses": "#1f77b4", "guidage": "#5a5a5a", "canon": "#d62728",
            "chargeur": "#f2c14e", "boulets": "#f7d000", "ascenseur": "#2ca02c", "graal": "#e6a817", "pierres": "#d2b48c"}


def rendu(scenes, frame, path, titre):
    """scenes : liste de (titre de vue, élévation, azimut, [(groupe, forme, finesse, opacité)]). Une scène = un tri en profondeur."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import to_rgb
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection
    import numpy as np

    cx, cy, z0 = frame
    cache = {}
    fig = plt.figure(figsize=(8 * len(scenes), 8.5))
    light = np.array([0.3, -0.4, 0.85]) / np.linalg.norm([0.3, -0.4, 0.85])
    for k, (nom_vue, elev, azim, groupes) in enumerate(scenes):
        ax = fig.add_subplot(1, len(scenes), k + 1, projection="3d")
        all_t, all_c = [], []
        for nom, shape, defl, alpha in groupes:
            key = (id(shape), defl)
            if key not in cache:
                t = np.array(mesh(shape, defl))
                t[:, :, 0] -= cx; t[:, :, 1] -= cy; t[:, :, 2] -= z0
                cache[key] = t
            tris = cache[key]
            n = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
            n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
            sh = 0.4 + 0.6 * np.abs(n @ light)
            base = np.array(to_rgb(COULEURS.get(nom.split(" ")[0], "#888888")))
            cols = np.clip(base[None, :] * sh[:, None], 0, 1)
            all_t.append(tris)
            all_c.append(np.c_[cols, np.full(len(cols), alpha)])
        pc = Poly3DCollection(np.concatenate(all_t), facecolors=np.concatenate(all_c), edgecolors="none")
        ax.add_collection3d(pc)
        ax.set_xlim(-230, 230); ax.set_ylim(-230, 230); ax.set_zlim(0, 460)
        ax.set_box_aspect((1, 1, 1))
        ax.view_init(elev=elev, azim=azim)
        ax.set_axis_off()
        ax.set_title(nom_vue, fontsize=13)
    fig.suptitle(titre, fontsize=15)
    fig.subplots_adjust(left=0, right=1, bottom=0, top=0.92, wspace=0)
    fig.savefig(path, dpi=90)
    plt.close(fig)


# ----------------------------------------------------------------------------------------------- assemblage
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("step")
    ap.add_argument("--sans-rendu", action="store_true")
    args = ap.parse_args()
    OUT.mkdir(exist_ok=True)

    frame = centre_toit(args.step)
    ch_solids, _ = chassis(args.step)
    ch = compound(ch_solids)
    gg = graal_geometrie()
    print(f"toit à {TOIT:.1f} mm ; Graal y = {gg['y0']:.1f}, prise x = {gg['x_prise']:.1f}, dépose x = {gg['x_depose']:.1f}, course de la coulisse {gg['course']:.1f} mm")

    # --- configuration de départ : nacelles à 0°, canon rentré, fourche rangée au-dessus du toit, Graal au sol devant C ---
    zp_haut = TOIT + MARGE_TOIT + G["anse_dessous"] - F["dent_ep"] + 0.0
    xc_in = FACE + F["jeu_face"] - gg["course"]
    mods = {}
    for f in ("A", "B"):
        fx, mob, tour = nacelle()
        mods[f"guidage {f}"] = to_cad(fx, f, frame)
        mods[f"nacelle {f} (chariot)"] = to_cad(mob, f, frame)
        mods[f"ventouses {f}"] = to_cad(tour, f, frame)
    lanceur, tube, chargeur, boulets = canon(False)
    mods["canon"] = to_cad(fuse([lanceur, tube]), "C", frame)
    mods["chargeur"] = to_cad(chargeur, "C", frame)
    rail, fourche_haut = ascenseur(xc_in, zp_haut, gg)
    mods["ascenseur (rail)"] = to_cad(rail, "C", frame)
    mods["ascenseur (fourche)"] = to_cad(fourche_haut, "C", frame)
    fourche_haut_cad = mods["ascenseur (fourche)"]

    # mât de balise centré, Ø70, du toit à 430 mm (pour les contrôles)
    mat = cyl((frame[0], frame[1], frame[2] + TOIT), (0, 0, 1), MAT_R, 430 - TOIT)

    # contrôles réglementaires sur la configuration de départ
    pts = []
    for s in list(mods.values()) + [ch]:
        for t in mesh(s, 2.0):
            pts += [(p[0] - frame[0], p[1] - frame[1]) for p in t]
    print(f"périmètre au départ : {perimetre(pts):.1f} mm (limite 1200)")
    zmax = max(bbox(s)[5] for s in list(mods.values()) + [ch]) - frame[2]
    print(f"hauteur maximale au départ (hors mât de balise) : {zmax:.1f} mm (limite 350)")
    cols = collisions({**dict(mods), "mât": mat})
    cols_ch = []
    for k, v in mods.items():
        for i, s in enumerate(ch_solids):
            bs, bv = bbox(s), bbox(v)
            if any(bs[q] > bv[q + 3] or bv[q] > bs[q + 3] for q in range(3)):
                continue
            vol = volume(BRepAlgoAPI_Common(s, v).Shape())
            if vol > 1.0:
                cols_ch.append((k, f"pièce châssis {i}", round(vol)))
    print("collisions entre modules :", cols or "aucune")
    # nacelles aux extrémités de course et en rotation
    fixes = {k: v for k, v in mods.items() if not k.startswith(("nacelle", "ventouses"))}
    cols_course = []
    for f in ("A", "B"):
        for h in (140.0, 205.0, 270.0):
            for th in (0.0, 90.0, 180.0):
                _, mob, tour = nacelle(h, th)
                test = {f"{f} chariot h={h:.0f}": to_cad(mob, f, frame), f"{f} nacelle h={h:.0f} θ={th:.0f}": to_cad(tour, f, frame)}
                for nom, sh in test.items():
                    for k, v in fixes.items():
                        if k.endswith(f) or k == f"guidage {f}":
                            continue
                        r = collisions({nom: sh, k: v})
                        cols_course += r
                    for i, so in enumerate(ch_solids):
                        bs, bv = bbox(so), bbox(sh)
                        if any(bs[q] > bv[q + 3] or bv[q] > bs[q + 3] for q in range(3)):
                            continue
                        vol = volume(BRepAlgoAPI_Common(so, sh).Shape())
                        if vol > 1.0:
                            cols_course.append((nom, f"pièce châssis {i}", round(vol)))
    print("collisions des nacelles sur leur course (h 140 / 205 / 270, rotation 0 / 90 / 180°) :", cols_course or "aucune")
    print("collisions avec le châssis :", cols_ch or "aucune")

    # --- séquence Graal : prise au sol puis dépose sur le toit ---
    g_sol = to_cad(graal(gg["x_prise"], gg["y0"], 0.0), "C", frame)
    _, fourche_bas = ascenseur(FACE + F["jeu_face"], F["dent_bas"], gg)
    fourche_bas = to_cad(fourche_bas, "C", frame)
    g_toit = to_cad(graal(gg["x_depose"], gg["y0"], TOIT), "C", frame)
    _, fourche_pose = ascenseur(xc_in, zp_haut - MARGE_TOIT, gg)
    fourche_pose = to_cad(fourche_pose, "C", frame)
    print("Graal au sol / fourche basse :", collisions({"graal": g_sol, "fourche": fourche_bas}) or "dents dans les anses sans interférence")
    print("Graal sur le toit / mât / fourche :", collisions({"graal": g_toit, "mât": mat, "fourche": fourche_pose}) or "aucune interférence")
    top_fourche = bbox(fourche_pose)[5] - frame[2]
    print(f"haut de la fourche Graal posé : {top_fourche:.1f} mm ; sommet du Graal sur le toit : {bbox(g_toit)[5] - frame[2]:.1f} mm")

    # pile tenue par la nacelle A (exemple), nacelle B tournée à 90° (pile en piliers)
    pile_a = to_cad(compound(pile()), "A", frame)
    print("pile tenue face A / nacelle A :", collisions({"pile": pile_a, "ventouses": mods["ventouses A"]}) or "contact sans interférence")

    # --- écritures ---
    write_step(ch, OUT / "chassis_tubes_290.step")
    write_step(compound([mods["guidage A"], mods["nacelle A (chariot)"], mods["ventouses A"]]), OUT / "nacelle_A.step")
    write_step(compound([mods["guidage B"], mods["nacelle B (chariot)"], mods["ventouses B"]]), OUT / "nacelle_B.step")
    write_step(compound([mods["canon"], mods["chargeur"], to_cad(boulets, "C", frame)]), OUT / "canon.step")
    write_step(compound([mods["ascenseur (rail)"], fourche_bas]), OUT / "ascenseur_graal.step")
    write_step(g_sol, OUT / "graal.step")
    depart = compound([ch] + list(mods.values()) + [to_cad(boulets, "C", frame), g_sol])
    write_step(depart, OUT / "robot_depart.step")
    fin = compound([ch] + [v for k, v in mods.items() if "fourche" not in k] + [fourche_pose, g_toit])
    write_step(fin, OUT / "robot_fin.step")
    print("STEP écrits dans", OUT)

    if args.sans_rendu:
        return
    base_ch = [("châssis", ch, 1.5, 1.0)]
    canon_r = [("canon", mods["canon"], 0.8, 1.0), ("chargeur", mods["chargeur"], 1.0, 0.25), ("boulets", to_cad(boulets, "C", frame), 1.5, 1.0)]
    nac = lambda f: [(f"guidage {f}", mods[f"guidage {f}"], 0.8, 1.0), (f"nacelle {f}", mods[f"nacelle {f} (chariot)"], 0.8, 1.0), (f"ventouses {f}", mods[f"ventouses {f}"], 0.6, 1.0)]
    rail = [("ascenseur", mods["ascenseur (rail)"], 0.8, 1.0)]
    # nacelle B tournée à 90° avec les 3 pierres debout (piliers), axe à 200 mm, dans le château
    fxB, mobB, tourB = nacelle(200.0, 90.0)
    pileB = moved(compound(pile(200.0)), gp_Ax1(gp_Pnt(0, 0, 200.0), gp_Dir(1, 0, 0)), 90.0)
    nacB90 = [("guidage B", to_cad(fxB, "B", frame), 0.8, 1.0), ("nacelle B", to_cad(mobB, "B", frame), 0.8, 1.0),
              ("ventouses B", to_cad(tourB, "B", frame), 0.6, 1.0), ("pierres", to_cad(pileB, "B", frame), 1.0, 0.85)]
    a = FACES
    rendu([("Face C : canon (rentré) et ascenseur, Graal saisi au sol", 18, a["C"] + 30,
            base_ch + canon_r + rail + nac("A") + nac("B") + [("ascenseur", fourche_bas, 0.8, 1.0), ("graal", g_sol, 0.5, 1.0)]),
           ("Face A : pile de 3 pierres tenue à plat", 18, a["A"] - 25,
            base_ch + canon_r + rail + nac("A") + nac("B") + [("ascenseur", fourche_haut_cad, 0.8, 1.0), ("pierres", pile_a, 1.0, 0.85)]),
           ("Face B : nacelle tournée à 90° (piliers de porte)", 18, a["B"] + 25,
            base_ch + canon_r + rail + nac("A") + nacB90 + [("ascenseur", fourche_haut_cad, 0.8, 1.0)])],
          frame, OUT / "rendu_prise.png", "ICAM LOT — robot complet (concept) : préhension et ascenseur")
    _, tube_dep, _, _ = canon(True)
    canon_dep = [("canon", to_cad(fuse([lanceur, tube_dep]), "C", frame), 0.8, 1.0), ("chargeur", mods["chargeur"], 1.0, 0.25), ("boulets", to_cad(boulets, "C", frame), 1.5, 1.0)]
    fin = base_ch + canon_dep + rail + nac("A") + nac("B") + [("ascenseur", fourche_pose, 0.8, 1.0), ("graal", g_toit, 0.5, 1.0)]
    rendu([("Fin de match : canon sorti, Graal sur le toit (niveau 4)", 22, a["C"] + 35, fin),
           ("Vue de dessus", 89, -90, fin)],
          frame, OUT / "rendu_fin.png", "ICAM LOT — robot complet (concept) : fin de match")
    print("rendus écrits")


if __name__ == "__main__":
    main()
