
// ------------------------------------------------------------------ notre robot : volume extérieur net, sans aucun mécanisme
// Enveloppe = plaque haute mesurée (spec/robot.json, polygone_repere_robot) extrudée du sol au toit ; roues omni aux coins ; mât de balise.
function makeHull() {
  const R = new THREE.Group();
  const shape = new THREE.Shape(SPEC.top.map(([x, y]) => new THREE.Vector2(x, y)));
  const H0 = 18, H1 = TOIT + 5;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: H1 - H0, bevelEnabled: true, bevelThickness: 4, bevelSize: 4, bevelSegments: 2 });
  geo.rotateX(Math.PI / 2); geo.translate(0, H1, 0);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x9fc6e2, roughness: 0.28, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.2, transparent: true, opacity: 0.96, emissive: 0x0a2a44, emissiveIntensity: 0.45 });
  const body = new THREE.Mesh(geo, glass); body.castShadow = body.receiveShadow = true; R.add(body);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), new THREE.LineBasicMaterial({ color: 0x38e1ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }));
  R.add(edges);
  // bandeau lumineux à mi-hauteur (signature visuelle, pas un composant)
  const ring = new THREE.Shape(SPEC.top.map(([x, y]) => new THREE.Vector2(x * 1.08, y * 1.08)));
  ring.holes.push(new THREE.Path(SPEC.top.slice().reverse().map(([x, y]) => new THREE.Vector2(x * 1.0, y * 1.0))));
  const band = new THREE.Mesh(new THREE.ExtrudeGeometry(ring, { depth: 10, bevelEnabled: false }),
    new THREE.MeshBasicMaterial({ color: 0xf2b705, side: THREE.DoubleSide }));
  band.geometry.rotateX(Math.PI / 2); band.position.y = 120; R.add(band);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.7, roughness: 0.3 }), rollMat = new THREE.MeshStandardMaterial({ color: 0x1c2026, roughness: 0.8 });
  const wheels = [];
  for (const ad of SPEC.wheels.angles_deg_repere_robot) {
    const a = ad * Math.PI / 180, wg = new THREE.Group(), spin = new THREE.Group(); wg.add(spin);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(22, 22, 26, 24), wheelMat); hub.rotation.z = Math.PI / 2; spin.add(hub);
    for (let i = 0; i < 12; i++) { const b = i / 12 * Math.PI * 2, r = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 5.5, 13, 10), rollMat); r.position.set((i % 2 ? 6 : -6), 26 * Math.sin(b), 26 * Math.cos(b)); r.rotation.x = b; spin.add(r); }
    wg.position.set(192 * Math.cos(a), 30, 192 * Math.sin(a)); wg.rotation.y = -a; wg.traverse(o => { if (o.isMesh) o.castShadow = true; });
    R.add(wg); wheels.push(spin);
  }
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(35, 35, 430 - H1, 24), new THREE.MeshStandardMaterial({ color: 0x8a96a3, metalness: 0.3, roughness: 0.35 }));
  mast.position.y = H1 + (430 - H1) / 2; mast.castShadow = true; R.add(mast);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 8, 24), new THREE.MeshBasicMaterial({ color: 0x38e1ff })); cap.position.y = 432; R.add(cap);
  // tampon « confidentiel » sur le toit
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const c = cv.getContext('2d');
  c.strokeStyle = '#ff4d5e'; c.lineWidth = 10; c.strokeRect(8, 8, 496, 112); c.fillStyle = '#ff4d5e'; c.font = '800 54px Inter, sans-serif'; c.textAlign = 'center'; c.fillText('CONFIDENTIEL', 256, 84);
  const tx = new THREE.CanvasTexture(cv); tx.colorSpace = THREE.SRGBColorSpace;
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(200, 50), new THREE.MeshBasicMaterial({ map: tx, transparent: true }));
  lab.rotation.x = -Math.PI / 2; lab.rotation.z = Math.PI / 2; lab.position.set(75, H1 + 6, 0); R.add(lab);
  R.userData = { glass, edges, band, wheels, label: lab };
  return R;
}
