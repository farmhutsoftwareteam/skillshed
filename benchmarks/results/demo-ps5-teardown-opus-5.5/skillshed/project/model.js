// PlayStation 5 disc edition (CFI-1000) exploded assembly.
// Standing pose: x = thickness (+x is the heatsink / M.2 side, -x the disc drive side),
// y = depth (front at -y), z = height (stand end at 0). Units are millimetres.
// Sources and confidence for each feature group are recorded in evidence.md.
self.DrawingModels ??= {};
self.DrawingModels.ps5 = (parameters, options) => {
  const G = TechnicalGeometry;
  const camera = {azimuth: -58, elevation: 16, roll: 0};

  // Overall envelope from Sony's published size, 390 × 104 × 260 mm (H × W × D).
  const H = 390, D = 260, W = 104;
  const coreY = [-120, 120], coreZ = [10, 380];

  // Lays an outline drawn in (y, z) into world space and gives it depth along +x from x0.
  const YZ = {xAxis: [0, 1, 0], yAxis: [0, 0, 1], zAxis: [1, 0, 0]};
  const plate = (p, outline, x0, depth, holes = [], role = 'edge') => {
    const piece = G.extrude(G.piece(), outline, {depth, holes, role});
    G.merge(p, G.transform(piece, {origin: [x0, 0, 0], ...YZ}));
    return p;
  };
  const rect = (y0, z0, y1, z1) => [[y0, z0], [y1, z0], [y1, z1], [y0, z1]];
  const disc = (cy, cz, r, n = 48) => Array.from({length: n}, (_, i) => [cy + r * Math.cos(i * 2 * Math.PI / n), cz + r * Math.sin(i * 2 * Math.PI / n)]);
  const rounded = (y0, z0, y1, z1, r) => G.roundedRectangle(y1 - y0, z1 - z0, r, {center: [(y0 + y1) / 2, (z0 + z1) / 2]});
  const xLine = (p, x, pts, role = 'detail', closed = true) => G.polyline(p, pts.map(([y, z]) => [x, y, z]), {closed, role});

  const fanCenter = [-45, 305], fanR = 60, fanT = 45;
  const dustPorts = [[62, 352], [62, 292]];
  const m2Window = [-88, 192, 10, 234];

  // White side cover: a fin outline whose front edge curves inward at mid-height.
  const coverOutline = () => {
    const pts = [];
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const z = 6 + (H - 12) * i / n;
      pts.push([-D / 2 + 26 * Math.sin(Math.PI * (z / H)) ** 1.4, z]);
    }
    for (const [y, z] of G.roundedRectangle(D - 12, H - 12, 6, {center: [6, H / 2]})) {
      if (y > -D / 2 + 30) pts.push([y, z]);
    }
    return orderAround(pts);
  };
  // Sorts outline points by angle around their centroid so the polygon stays simple.
  const orderAround = pts => {
    const c = pts.reduce((s, q) => [s[0] + q[0] / pts.length, s[1] + q[1] / pts.length], [0, 0]);
    return pts.sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
  };

  const parts = [];
  const add = (id, name, explosion, build) => {
    const p = G.part(id, name);
    build(p);
    p.explosion = explosion;
    parts.push(p);
    return p;
  };

  // ── Drive side (-x) ──────────────────────────────────────────────────────
  add('cover-drive', 'Side cover, disc drive side', [-310, 0, 0], p => {
    plate(p, coverOutline(), -W / 2, 8);
  });

  add('chassis-drive', 'Chassis half, disc drive side', [-225, 0, 0], p => {
    const outer = rounded(coreY[0], coreZ[0], coreY[1], coreZ[1], 10);
    plate(p, outer, -44, 3, [disc(...fanCenter, fanR + 2, 72)]);
    plate(p, outer, -41.2, 41.2, [rounded(coreY[0] + 3, coreZ[0] + 3, coreY[1] - 3, coreZ[1] - 3, 7)]);
    // Front face: disc slot and intake vents.
    const fy = coreY[0] - .05;
    G.polyline(p, [[-30, fy, 40], [-6, fy, 40], [-6, fy, 160], [-30, fy, 160]], {closed: true, role: 'detail'});
    for (let z = 190; z <= 370; z += 6) G.line(p, [-36, fy, z], [-6, fy, z], 'texture');
  });

  add('drive', 'Ultra HD Blu-ray drive', [-145, 0, 0], p => {
    G.box(p, [-38, -118, 18], [-12, 30, 172], {radius: 3});
    const fx = -11.95;
    G.circle(p, [fx, -44, 95], 60, [1, 0, 0], {role: 'detail'});
    G.circle(p, [fx, -44, 95], 13, [1, 0, 0], {role: 'detail'});
    xLine(p, fx, rect(-108, 26, -60, 44));
    for (const [y, z] of [[-110, 24], [22, 24], [-110, 166], [22, 166]]) G.circle(p, [fx, y, z], 2.5, [1, 0, 0], {role: 'detail', segments: 24});
  });

  add('psu', 'Power supply unit, 350 W', [-145, 0, 0], p => {
    G.box(p, [-38, 34, 186], [-12, 116, 374], {radius: 3});
    const fx = -11.95;
    for (let row = 0; row < 7; row++) for (let col = 0; col < 4; col++) {
      G.circle(p, [fx, 50 + col * 16, 300 + row * 9], 2.6, [1, 0, 0], {role: 'texture', segments: 24});
    }
    xLine(p, fx, rect(46, 200, 104, 280));
  });

  add('shield-drive', 'Steel shield, disc drive side', [-70, 0, 0], p => {
    const holes = [rect(-60, 60, 10, 120), rect(30, 130, 90, 180)];
    plate(p, rounded(-112, 14, 112, 236, 4), -8, 1.2, holes);
    for (const [y, z] of [[-104, 22], [104, 22], [-104, 228], [104, 228], [0, 22], [0, 228]]) G.circle(p, [-6.75, y, z], 2.5, [1, 0, 0], {role: 'detail', segments: 24});
  });

  // ── Main board (centre) ──────────────────────────────────────────────────
  const boardX = 0, top = boardX + .05;
  add('board', 'Main board', [0, 0, 0], p => {
    plate(p, rounded(-115, 15, 112, 238, 3), -1.6, 1.6);
    for (const [y, z] of [[-107, 23], [104, 23], [-107, 230], [104, 230]]) G.circle(p, [top, y, z], 2.5, [1, 0, 0], {role: 'detail', segments: 24});
  });

  const soc = [20, 140];
  add('soc', 'AMD SoC, CXD90060GG', [0, 0, 0], p => {
    G.box(p, [0, soc[0] - 22, soc[1] - 22], [1.5, soc[0] + 22, soc[1] + 22]);
    G.box(p, [1.5, soc[0] - 11, soc[1] - 13], [2.4, soc[0] + 11, soc[1] + 13]);
  });

  add('gddr6', 'GDDR6 memory, 8 × 2 GB', [0, 0, 0], p => {
    const spots = [[-14, 52], [14, 52], [-14, -52], [14, -52], [-52, -14], [-52, 14], [52, -14], [52, 14]];
    spots.forEach(([dy, dz]) => {
      const vertical = Math.abs(dy) > Math.abs(dz);
      const [hy, hz] = vertical ? [6.5, 7] : [7, 6.5];
      G.box(p, [0, soc[0] + dy - hy, soc[1] + dz - hz], [1.2, soc[0] + dy + hy, soc[1] + dz + hz]);
    });
  });

  add('ssd-controller', 'SSD controller, CXD90062GG', [0, 0, 0], p => {
    G.box(p, [0, -80, 92], [1.3, -62, 110]);
  });

  add('nand', 'NAND flash, 3 of 6 shown', [0, 0, 0], p => {
    for (const z of [40, 64, 88]) G.box(p, [0, -100, z - 8], [1.3, -86, z + 8]);
  });

  add('m2-slot', 'M.2 expansion slot', [0, 0, 0], p => {
    G.box(p, [0, -86, 200], [5, -78, 226]);
    G.box(p, [0, -4, 211], [3, 2, 215]);
    G.polyline(p, [[top, -78, 200], [top, 4, 200], [top, 4, 226], [top, -78, 226]], {role: 'texture'});
  });

  add('wifi', 'Wi-Fi module, J20H100', [0, 0, 0], p => {
    G.box(p, [0, 64, 200], [1.8, 98, 226]);
  });

  // ── Heatsink side (+x) ───────────────────────────────────────────────────
  add('heatsink', 'Heatsink with copper heat pipes', [75, 0, 0], p => {
    // Contact block over the SoC, heat pipes, and a fin stack below it.
    G.box(p, [2.6, soc[0] - 24, soc[1] - 24], [18, soc[0] + 24, soc[1] + 24], {radius: 2});
    G.box(p, [4, -108, 18], [36, 108, 104], {radius: 2});
    const fx = 36.05;
    for (let z = 22; z <= 100; z += 3) G.line(p, [fx, -105, z], [fx, 105, z], 'texture');
    for (let z = 22; z <= 100; z += 3) G.line(p, [4, -108.05, z], [36, -108.05, z], 'texture');
    const ring = Array.from({length: 16}, (_, i) => [3.5 * Math.cos(i * Math.PI / 8), 3.5 * Math.sin(i * Math.PI / 8)]);
    [4, 12, 20, 28, 36].forEach(y => {
      G.sweep(p, [[12.5, y, soc[1]], [12.5, y, 98]], ring);
    });
  });

  add('shield-heatsink', 'Steel shield, heatsink side', [150, 0, 0], p => {
    plate(p, rounded(-112, 14, 112, 188, 4), 38, 1.2, [rect(-70, 30, 70, 92)]);
    for (const [y, z] of [[-104, 22], [104, 22], [-104, 180], [104, 180], [0, 180]]) G.circle(p, [39.25, y, z], 2.5, [1, 0, 0], {role: 'detail', segments: 24});
  });

  add('chassis-heatsink', 'Chassis half, heatsink side', [265, 0, 0], p => {
    const outer = rounded(coreY[0], coreZ[0], coreY[1], coreZ[1], 10);
    const window = rect(...m2Window);
    plate(p, outer, 41, 3, [disc(...fanCenter, fanR + 2, 72), window, ...dustPorts.map(([y, z]) => disc(y, z, 7, 32))]);
    plate(p, outer, 0, 41.2, [rounded(coreY[0] + 3, coreZ[0] + 3, coreY[1] - 3, coreZ[1] - 3, 7)]);
    const fy = coreY[0] - .05;
    // Front face: USB-A and USB-C ports, power and eject buttons, vents.
    G.polyline(p, [[10, fy, 60], [30, fy, 60], [30, fy, 74], [10, fy, 74]], {closed: true, role: 'detail'});
    G.polyline(p, [[16, fy, 88], [24, fy, 88], [24, fy, 97], [16, fy, 97]], {closed: true, role: 'detail'});
    G.line(p, [8, fy, 120], [32, fy, 120], 'detail');
    G.line(p, [8, fy, 150], [32, fy, 150], 'detail');
    for (let z = 190; z <= 370; z += 6) G.line(p, [6, fy, z], [36, fy, z], 'texture');
  });

  add('m2-cover', 'M.2 bay cover', [320, 0, 0], p => {
    plate(p, rect(m2Window[0] - 4, m2Window[1] - 4, m2Window[2] + 4, m2Window[3] + 4), 44, 1);
    G.circle(p, [45.05, m2Window[2] - 6, (m2Window[1] + m2Window[3]) / 2], 2.5, [1, 0, 0], {role: 'detail', segments: 24});
  });

  add('cover-heatsink', 'Side cover, heatsink side', [385, 0, 0], p => {
    plate(p, coverOutline(), 45.2, W / 2 - 45.2);
  });

  // ── Fan and stand ────────────────────────────────────────────────────────
  add('fan', 'Cooling fan, 120 mm × 45 mm', [0, 0, 110], p => {
    const [cy, cz] = fanCenter;
    G.lathe(p, [[-fanT / 2, fanR], [fanT / 2, fanR], [fanT / 2, fanR - 9], [-fanT / 2, fanR - 9]], {at: [0, cy, cz]});
    G.lathe(p, [[-4, 26], [4, 26], [4, 0], [-4, 0]], {at: [0, cy, cz]});
    for (let i = 0; i < 60; i++) {
      const a = i * 2 * Math.PI / 60;
      G.line(p, [-fanT / 2, cy + (fanR + .05) * Math.cos(a), cz + (fanR + .05) * Math.sin(a)], [fanT / 2, cy + (fanR + .05) * Math.cos(a), cz + (fanR + .05) * Math.sin(a)], 'texture');
    }
  });

  add('stand', 'Base stand', [0, 0, -90], p => {
    G.lathe(p, [[0, 0], [0, 70], [8, 66], [12, 30], [12, 0]], {axis: 'z', at: [0, 40, -12], creaseAngle: 20});
  });

  add('stand-screw', 'Stand screw', [0, 0, -45], p => {
    const s = G.screw(G.piece(), {length: 14, radius: 3, headRadius: 8, headHeight: 4, pitch: 1});
    G.merge(p, G.transform(s, {origin: [0, 40, -16], ...G.along('z')}));
  });

  const trails = [
    {a: [0, fanCenter[0], fanCenter[1]], b: [0, fanCenter[0], fanCenter[1]], from: 'fan', to: 'board'},
    {a: [0, 40, -4], b: [0, 40, -4], from: 'stand-screw', to: 'stand'},
    {a: [-W / 2, -44, 95], b: [-12, -44, 95], from: 'cover-drive', to: 'drive'},
    {a: [18, soc[0], soc[1]], b: [2.4, soc[0], soc[1]], from: 'heatsink', to: 'soc'},
  ];

  return TechnicalProjection.render(parts, {...options, camera, trails});
};
