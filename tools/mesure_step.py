#!/usr/bin/env python3
"""Mesure la base roulante depuis l'export STEP de la CAO (alimente spec/robot.json).

Usage : python tools/mesure_step.py Structure_robot_p.STEP [--saillies]
Dépendance : pip install cadquery-ocp
"""
from __future__ import annotations

import argparse
import math

from OCP.BRep import BRep_Tool
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_FACE
from OCP.TopExp import TopExp_Explorer
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS


def mesh_points(path: str):
    reader = STEPControl_Reader()
    reader.ReadFile(path)
    reader.TransferRoots()
    shape = reader.OneShape()
    BRepMesh_IncrementalMesh(shape, 0.3, False, 0.2)
    pts = []
    ex = TopExp_Explorer(shape, TopAbs_FACE)
    while ex.More():
        loc = TopLoc_Location()
        tri = BRep_Tool.Triangulation_s(TopoDS.Face(ex.Current()), loc)
        if tri is not None:
            T = loc.Transformation()
            for i in range(1, tri.NbNodes() + 1):
                p = tri.Node(i).Transformed(T)
                pts.append((p.X(), p.Y(), p.Z()))
        ex.Next()
    return pts


def hull(points):
    pts = sorted(set((round(x, 1), round(y, 1)) for x, y in points))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def perimeter(poly):
    return sum(math.dist(poly[i], poly[(i + 1) % len(poly)]) for i in range(len(poly)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("step")
    ap.add_argument("--saillies", action="store_true", help="budget de périmètre pour des mécanismes posés sur les faces")
    args = ap.parse_args()

    pts = mesh_points(args.step)
    z0 = min(p[2] for p in pts)
    z1 = max(p[2] for p in pts)
    # le centre du robot est pris au centre de la plaque haute (plan supérieur)
    top = [(x, y) for x, y, z in pts if z > z1 - 5]
    ht = hull(top)
    cx = sum(p[0] for p in ht) / len(ht)
    cy = sum(p[1] for p in ht) / len(ht)
    base = hull([(x - cx, y - cy) for x, y, _ in pts])
    print(f"hauteur de la structure : {z1 - z0:.1f} mm")
    print(f"périmètre de l'enveloppe convexe au sol : {perimeter(base):.1f} mm (limite au départ : 1200)")
    print(f"rayon maximal au sol : {max(math.hypot(*p) for p in base):.1f} mm")

    faces = []
    tp = hull([(x - cx, y - cy) for x, y in top])
    for i in range(len(tp)):
        a, b = tp[i], tp[(i + 1) % len(tp)]
        L = math.dist(a, b)
        if L < 150:
            continue
        mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        nx, ny = (b[1] - a[1]) / L, -(b[0] - a[0]) / L
        if nx * mx + ny * my < 0:
            nx, ny = -nx, -ny
        faces.append((math.degrees(math.atan2(ny, nx)), nx * mx + ny * my, L))
    for ang, d, L in faces:
        print(f"face : normale {ang:6.1f}°, à {d:.1f} mm du centre, longueur {L:.1f} mm")

    if args.saillies:
        for depth in (0, 20, 30, 40, 50, 80):
            q = list(base)
            for ang, d, L in faces:
                n = (math.cos(math.radians(ang)), math.sin(math.radians(ang)))
                t = (-n[1], n[0])
                for s in (-1, 1):
                    for dd in (d, d + depth):
                        q.append((n[0] * dd + s * t[0] * L / 2, n[1] * dd + s * t[1] * L / 2))
            print(f"mécanisme pleine largeur sur les 3 faces, saillie {depth:2d} mm -> périmètre {perimeter(hull(q)):.1f} mm")


if __name__ == "__main__":
    main()
