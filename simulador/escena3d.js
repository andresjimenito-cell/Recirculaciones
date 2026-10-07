/*
 * Escena 3D del pozo en corte con el equipo BES y el sistema de recirculación.
 * Requiere THREE (r128), THREE.OrbitControls, THREE.CSS2DRenderer y THREE.RoomEnvironment.
 *
 * Escala: radial 1 in = RS unidades; vertical comprimida (las longitudes del equipo
 * son esquemáticas, las profundidades reales se rotulan).
 */
(function (root) {
  'use strict';
  const T = root.THREE;
  const RS = 5.5;                 // unidades por pulgada en dirección radial
  const WEDGE = Math.PI;          // se retira la mitad delantera: corte longitudinal
  const TH0 = WEDGE / 2, THL = 2 * Math.PI - WEDGE;
  const P = (r, th, y) => new T.Vector3(r * Math.sin(th), y, r * Math.cos(th));

  // ---------------- Texturas procedurales ----------------
  function canvasTex(w, h, draw, rx, ry) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); draw(g, w, h);
    const t = new T.CanvasTexture(c);
    t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(rx || 1, ry || 1);
    t.encoding = T.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  function rnd(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }
  function grains(g, w, h, base, cols, n, rmax, seed) {
    const r = rnd(seed);
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < n; i++) {
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.globalAlpha = 0.35 + r() * 0.5;
      g.beginPath(); g.arc(r() * w, r() * h, 0.6 + r() * rmax, 0, 7); g.fill();
    }
    g.globalAlpha = 1;
  }
  const TEX = {};
  function buildTextures() {
    if (TEX.ok) return;
    TEX.sand = canvasTex(512, 512, (g, w, h) => {
      grains(g, w, h, '#b59c72', ['#94794f', '#cdb98f', '#7d6643', '#c2ab83'], 9000, 1.8, 7);
      const r = rnd(3); g.strokeStyle = 'rgba(120,95,60,0.25)';
      for (let y = 0; y < h; y += 18 + r() * 30) { g.lineWidth = 1 + r() * 2; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x / 50 + y) * 3); g.stroke(); }
    }, 5, 2);
    TEX.pay = canvasTex(512, 512, (g, w, h) => {
      grains(g, w, h, '#6d5638', ['#4d3b25', '#8a6e48', '#3a2c1b', '#7a6142'], 10000, 1.8, 11);
      const r = rnd(5); g.strokeStyle = 'rgba(30,20,10,0.35)';
      for (let y = 0; y < h; y += 14 + r() * 26) { g.lineWidth = 1 + r() * 2; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x / 60 + y) * 2); g.stroke(); }
    }, 5, 2);
    TEX.shale = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#545a60'; g.fillRect(0, 0, w, h);
      const r = rnd(13);
      for (let y = 0; y < h; y += 2 + r() * 5) {
        const l = 70 + Math.floor(r() * 40); g.fillStyle = `rgb(${l},${l + 4},${l + 9})`;
        g.fillRect(0, y, w, 1 + r() * 2.5);
      }
      grains(g, w, h, 'rgba(0,0,0,0)', ['#3c4146', '#6c737a'], 2500, 0.9, 17);
    }, 5, 3);
    TEX.cement = canvasTex(256, 256, (g, w, h) => grains(g, w, h, '#8e8a82', ['#77736c', '#a6a29a', '#6a665f'], 4000, 1.2, 23), 6, 6);
    TEX.lam = canvasTex(64, 512, (g, w, h) => {
      for (let y = 0; y < h; y += 4) { g.fillStyle = (y / 4) % 2 ? '#8d979e' : '#5d666d'; g.fillRect(0, y, w, 4); }
    }, 1, 12);
    TEX.rotor = canvasTex(512, 64, (g, w, h) => {
      g.fillStyle = '#6f777d'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 16) { g.fillStyle = '#b07a43'; g.fillRect(x, 0, 6, h); }
    }, 1, 1);
    TEX.ok = true;
  }

  // ---------------- Materiales ----------------
  let MAT = null;
  function buildMaterials() {
    if (MAT) return MAT;
    buildTextures();
    const S = (o) => new T.MeshStandardMaterial(Object.assign({ side: T.DoubleSide }, o));
    MAT = {
      casing: S({ color: 0xa8b0b7, metalness: 0.85, roughness: 0.33 }),
      cutSteel: S({ color: 0x9ea9b2, metalness: 0.6, roughness: 0.4 }),
      tubing: S({ color: 0x9aa3ab, metalness: 0.85, roughness: 0.3 }),
      paint: S({ color: 0x2f4558, metalness: 0.45, roughness: 0.42 }),
      paintRec: S({ color: 0x1f6a6a, metalness: 0.45, roughness: 0.42 }),
      seal: S({ color: 0x3a4d5f, metalness: 0.45, roughness: 0.45 }),
      motor: S({ color: 0x2f4558, metalness: 0.45, roughness: 0.42, emissive: 0x000000 }),
      shaft: S({ color: 0xcfd5da, metalness: 0.95, roughness: 0.18 }),
      impeller: S({ color: 0xb08d57, metalness: 0.8, roughness: 0.3 }),
      diffuser: S({ color: 0x66717a, metalness: 0.75, roughness: 0.38 }),
      copper: S({ color: 0xc27a3e, metalness: 0.9, roughness: 0.28 }),
      brass: S({ color: 0xd0aa48, metalness: 0.9, roughness: 0.3 }),
      rubber: S({ color: 0x24282c, metalness: 0.0, roughness: 0.85 }),
      lam: S({ map: TEX.lam, metalness: 0.7, roughness: 0.4 }),
      rotor: S({ map: TEX.rotor, metalness: 0.7, roughness: 0.35 }),
      cable: S({ color: 0x8e969c, metalness: 0.8, roughness: 0.45 }),
      cableJacket: S({ color: 0x1b1e21, metalness: 0.1, roughness: 0.7 }),
      line: S({ color: 0xdfe5ea, metalness: 0.9, roughness: 0.18, transparent: true, opacity: 0.45, depthWrite: false }),
      lineCut: S({ color: 0xdfe5ea, metalness: 0.9, roughness: 0.2 }),
      sensor: S({ color: 0x8d6e3f, metalness: 0.8, roughness: 0.35 }),
      cement: S({ map: TEX.cement, metalness: 0, roughness: 0.95 }),
      sand: S({ map: TEX.sand, metalness: 0, roughness: 0.95 }),
      pay: S({ map: TEX.pay, metalness: 0, roughness: 0.9 }),
      shale: S({ map: TEX.shale, metalness: 0, roughness: 0.92 }),
      tunnel: S({ color: 0x0b0806, metalness: 0, roughness: 1 }),
      crushed: S({ color: 0x4a2c18, metalness: 0, roughness: 1 }),
      shroud: S({ color: 0xb9c3cc, metalness: 0.8, roughness: 0.25, transparent: true, opacity: 0.38, depthWrite: false }),
      dark: S({ color: 0x14181c, metalness: 0.3, roughness: 0.8 }),
      glow: new T.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0.25, side: T.BackSide, depthWrite: false, blending: T.AdditiveBlending }),
    };
    return MAT;
  }

  // Tubo anular con corte en cuña, caras de corte y tapas
  function anillo(rIn, rOut, y0, y1, mat, capMat, opt) {
    opt = opt || {};
    const g = new T.Group();
    const h = y1 - y0, ym = (y0 + y1) / 2, seg = opt.seg || 72;
    const full = !!opt.full;
    const th0 = full ? 0 : TH0, thl = full ? Math.PI * 2 : THL;
    const o = new T.Mesh(new T.CylinderGeometry(rOut, rOut, h, seg, 1, true, th0, thl), mat);
    o.position.y = ym; g.add(o);
    if (rIn > 0.01) { const i = new T.Mesh(new T.CylinderGeometry(rIn, rIn, h, seg, 1, true, th0, thl), opt.inMat || mat); i.position.y = ym; g.add(i); }
    capMat = capMat || mat;
    if (!full) {
      [th0, th0 + thl].forEach((th) => {
        const pl = new T.Mesh(new T.PlaneGeometry(rOut - rIn, h), capMat);
        pl.rotation.y = th - Math.PI / 2;
        pl.position.set(Math.sin(th) * (rIn + rOut) / 2, ym, Math.cos(th) * (rIn + rOut) / 2);
        if (capMat.map) { pl.geometry.attributes.uv.array.forEach((v, k, a) => { a[k] = k % 2 ? v * (h / 40) : v * ((rOut - rIn) / 40); }); }
        g.add(pl);
      });
    }
    if (opt.caps !== false) {
      [y0, y1].forEach((y, k) => {
        if (opt.caps === 'top' && k === 0) return;
        if (opt.caps === 'bottom' && k === 1) return;
        const ring = new T.Mesh(new T.RingGeometry(Math.max(rIn, 0.001), rOut, seg, 1, th0 - Math.PI / 2, thl), capMat);
        ring.rotation.x = -Math.PI / 2; ring.position.y = y; g.add(ring);
      });
    }
    return g;
  }
  function disco(r, y0, y1, mat, seg) {
    const m = new T.Mesh(new T.CylinderGeometry(r, r, y1 - y0, seg || 40), mat);
    m.position.y = (y0 + y1) / 2; return m;
  }
  function boxBetween(a, b, w, t, mat, thetaHint) {
    const d = new T.Vector3().subVectors(b, a); const len = d.length();
    const m = new T.Mesh(new T.BoxGeometry(w, len, t), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.clone().normalize());
    if (thetaHint !== undefined && Math.abs(d.y) > Math.abs(d.x) + Math.abs(d.z)) m.rotateY(thetaHint);
    return m;
  }

  // Rampa de color por temperatura (frío → caliente)
  const C0 = new T.Color(0x6fa3d0), C1 = new T.Color(0xf2a03d), C2 = new T.Color(0xff3a2e);
  function tCol(T_, lo, hi, out) {
    let u = (T_ - lo) / Math.max(hi - lo, 1); u = Math.min(Math.max(u, 0), 1);
    out = out || new T.Color();
    if (u < 0.5) out.copy(C0).lerp(C1, u / 0.5); else out.copy(C1).lerp(C2, (u - 0.5) / 0.5);
    return out;
  }

  // ================= Escena =================
  function crear(container, opts) {
    opts = opts || {};
    buildMaterials();
    const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    container.appendChild(renderer.domElement);
    const labels = new T.CSS2DRenderer();
    labels.domElement.className = 'etq-capa';
    container.appendChild(labels.domElement);

    const scene = new T.Scene();
    const pm = new T.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new T.RoomEnvironment(), 0.04).texture;
    scene.add(new T.HemisphereLight(0xdfe9f3, 0x2a2118, 0.45));
    const key = new T.DirectionalLight(0xffffff, 1.1); key.position.set(120, 260, 220); scene.add(key);
    const rim = new T.DirectionalLight(0x9cc8ff, 0.5); rim.position.set(-200, 80, -120); scene.add(rim);

    const camera = new T.PerspectiveCamera(32, 1, 1, 6000);
    const controls = new T.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    controls.minDistance = 25; controls.maxDistance = 1400;
    controls.maxPolarAngle = Math.PI * 0.92;

    let world = new T.Group(); scene.add(world);
    let L = null, R = null, lastKey = '';
    const comps = {};          // nombre → { group, y0, y1, r }
    const labelObjs = [];
    const rotors = [];         // grupos que giran con el eje
    let glow = null, glowComp = null;
    let aura = null;
    let state = { etiquetas: true, particulas: true, corriendo: true };

    // ---------- Partículas ----------
    const MAXP = 1800, MAXB = 420;
    const pGeo = new T.SphereGeometry(1, 10, 8);
    const pMat = new T.MeshBasicMaterial({ color: 0xffffff });
    const pMesh = new T.InstancedMesh(pGeo, pMat, MAXP);
    pMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    pMesh.instanceColor = new T.InstancedBufferAttribute(new Float32Array(MAXP * 3), 3);
    pMesh.instanceColor.setUsage(T.DynamicDrawUsage);
    pMesh.count = 0;
    scene.add(pMesh);
    const bMat = new T.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1 });
    const bMesh = new T.InstancedMesh(pGeo, bMat, MAXB); bMesh.count = 0;
    bMesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
    scene.add(bMesh);
    const parts = [], bubbles = [];
    const acc = { p: 0, r: 0, g: 0 };
    const M4 = new T.Matrix4(), V3 = new T.Vector3(), COL = new T.Color(), Q0 = new T.Quaternion(), SC = new T.Vector3();

    // ---------- Construcción ----------
    function disposeGroup(g) {
      g.traverse((o) => { if (o.geometry && o.geometry !== pGeo) o.geometry.dispose(); });
    }
    function addLabel(name, pos, side, cls) {
      const outer = document.createElement('div'); outer.className = 'etq-ancla';
      const inner = document.createElement('div'); inner.className = 'etq ' + (side === 'r' ? 'der' : 'izq') + (cls ? ' ' + cls : '');
      outer.appendChild(inner);
      const o = new T.CSS2DObject(outer); o.position.copy(pos); world.add(o);
      labelObjs.push({ name, o, el: inner });
      return inner;
    }

    function construir(r) {
      R = r;
      const p = r.p;
      // limpiar
      labelObjs.forEach((l) => l.o.parent && l.o.parent.remove(l.o)); labelObjs.length = 0;
      Object.keys(comps).forEach((k) => delete comps[k]);
      rotors.length = 0;
      scene.remove(world); disposeGroup(world);
      world = new T.Group(); scene.add(world);
      parts.length = 0; bubbles.length = 0; glow = null; aura = null;

      // ----- Geometría radial (pulgadas → unidades) -----
      const ci = (p.casing_id / 2) * RS;
      const odMap = { '4.892': 5.5, '6.276': 7.0, '6.366': 7.0, '8.681': 9.625 };
      const casOD = odMap[String(p.casing_id)] || p.casing_id + 0.6;
      const co = (casOD / 2) * RS;
      const bit = { 5.5: 7.875, 7: 8.75, 9.625: 12.25 }[casOD] || casOD * 1.4;
      const rh = (bit / 2) * RS;
      const rf = rh + 7 * RS;
      const tubOD = p.tubing_id + 0.43;
      const rtO = (tubOD / 2) * RS, rtI = (p.tubing_id / 2) * RS;
      const rm = (p.motor_od / 2) * RS;
      const rp = (p.pump_od / 2) * RS;
      const rs = rm * 0.93;
      const rShaft = 0.42 * RS;
      const camisa = p.config === 'camisa';
      const shI = ((p.casing_id - 0.75) / 2) * RS, shO = shI + 0.25 * RS;

      // ----- Distribución vertical (unidades esquemáticas) -----
      const lens = { dh: 9, pump: 96, intake: 12, recp: p.recirc === 'dedicada' ? 18 : 0, seal: 30, motor: 44 + p.motor_len * 1.5, sensor: 11 };
      const y = {}; let cur = 160;
      y.dh = [cur - lens.dh, cur]; cur -= lens.dh;
      y.pump = [cur - lens.pump, cur]; cur -= lens.pump;
      y.intake = [cur - lens.intake, cur]; cur -= lens.intake;
      if (lens.recp) { y.recp = [cur - lens.recp, cur]; cur -= lens.recp; }
      y.seal = [cur - lens.seal, cur]; cur -= lens.seal;
      y.motor = [cur - lens.motor, cur]; cur -= lens.motor;
      y.sensor = [cur - lens.sensor, cur]; cur -= lens.sensor;
      const yOut = cur - 9;
      let perf, sand;
      if (p.config === 'sobre') { perf = [yOut - 62, yOut - 18]; sand = [yOut - 82, yOut - 6]; }
      else { perf = [y.dh[1] + 34, y.dh[1] + 82]; sand = [y.dh[1] + 18, y.dh[1] + 100]; }
      const yTop = Math.max(sand[1], y.dh[1]) + 40;
      const yBot = Math.min(yOut, perf[0]) - 28;
      L = { ci, co, rh, rf, rtO, rtI, rm, rp, rs, rShaft, shI, shO, camisa, y, yTop, yOut, yBot, perf, sand };
      // tamaño de partícula: visible pero menor que la holgura más estrecha que recorre (anular del motor)
      L.pSize = Math.max(Math.min(0.17 * RS, 0.42 * ((camisa ? shI : ci) - rm)), 0.08 * RS);

      // ----- Formación, cemento, revestimiento -----
      const capas = [
        [yBot - 14, sand[0], MAT.shale], [sand[0], perf[0], MAT.sand], [perf[0], perf[1], MAT.pay], [perf[1], sand[1], MAT.sand], [sand[1], yTop, MAT.shale],
      ];
      capas.forEach(([a, b, m], k) => { if (b - a > 0.5) world.add(anillo(rh, rf, a, b, m, m, { caps: k === 0 ? 'bottom' : k === capas.length - 1 ? 'top' : false })); });
      world.add(anillo(co, rh, yBot - 14, yTop, MAT.cement, MAT.cement));
      const cas = anillo(ci, co, yBot, yTop, MAT.casing, MAT.cutSteel); world.add(cas);
      // fondo del pozo (tapón)
      world.add(anillo(0, ci, yBot - 4, yBot, MAT.dark, MAT.dark));
      comps.revestimiento = { group: cas, y0: yBot, y1: yTop, r: co };

      // ----- Cañoneo (túneles en espiral, fase 60°) -----
      const perfG = new T.Group();
      const tunGeo = new T.CylinderGeometry(0.22 * RS, 0.12 * RS, 1, 10);
      L.tunnels = [];
      let k = 0;
      const tunLen = 5.5 * RS;
      for (let yy = perf[0] + 2.5; yy < perf[1] - 1.5; yy += 3.4, k++) {
        const th = (k * Math.PI) / 3 + Math.PI / 2;
        const thn = ((th % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const enCorte = Math.abs(Math.cos(thn)) < 1e-6;
        const inCut = !enCorte && (thn < TH0 || thn > 2 * Math.PI - TH0);
        if (inCut) continue;
        if (enCorte) {
          // túnel visto en sección sobre la cara del corte
          const sx = Math.sin(thn);
          const zona = new T.Mesh(new T.BoxGeometry(tunLen * 0.95, 0.9 * RS, 0.06), MAT.crushed);
          zona.position.set(sx * (rh + tunLen * 0.45), yy, 0.05); perfG.add(zona);
          const tun = new T.Mesh(new T.BoxGeometry(tunLen + (rh - ci), 0.42 * RS, 0.06), MAT.tunnel);
          tun.position.set(sx * (ci + (tunLen + rh - ci) / 2), yy, 0.09); perfG.add(tun);
        } else {
          const a = P(ci, th, yy), b = P(rh + tunLen, th, yy);
          const m = new T.Mesh(tunGeo, MAT.tunnel);
          m.position.copy(a).add(b).multiplyScalar(0.5); m.scale.set(1, a.distanceTo(b), 1);
          m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize());
          perfG.add(m);
        }
        L.tunnels.push({ th: thn, y: yy, enCorte });
      }
      world.add(perfG);
      comps.perforados = { group: perfG, y0: perf[0], y1: perf[1], r: rh };

      // ----- Tubería de producción -----
      const tub = anillo(rtI, rtO, y.dh[1], yTop, MAT.tubing, MAT.cutSteel); world.add(tub);
      comps.tuberia = { group: tub, y0: y.dh[1], y1: yTop, r: rtO };
      // cople
      world.add(anillo(rtO, rtO * 1.18, y.dh[1] + 24, y.dh[1] + 29, MAT.tubing, MAT.cutSteel));

      // ----- Cabeza de descarga -----
      const dh = new T.Group();
      dh.add(anillo(rtI, rp * 1.02, y.dh[0], y.dh[1], MAT.paint, MAT.cutSteel));
      world.add(dh); comps.descarga = { group: dh, y0: y.dh[0], y1: y.dh[1], r: rp };

      // ----- Bomba principal: carcasa en corte + etapas -----
      const pumpG = new T.Group();
      pumpG.add(anillo(rp - 0.22 * RS, rp, y.pump[0], y.pump[1], MAT.paint, MAT.cutSteel));
      const nS = 15, pitch = (y.pump[1] - y.pump[0]) / nS;
      const rIn = rp - 0.24 * RS;
      const rot = new T.Group();
      const vaneGeo = new T.BoxGeometry(rIn * 0.5, pitch * 0.36, 0.12 * RS);
      for (let i = 0; i < nS; i++) {
        const yb = y.pump[0] + i * pitch;
        // difusor (estático): cono con pared
        const dif = new T.Mesh(new T.CylinderGeometry(rIn * 0.98, rIn * 0.55, pitch * 0.42, 40, 1, true, TH0, THL), MAT.diffuser);
        dif.position.y = yb + pitch * 0.79; pumpG.add(dif);
        const difPlate = new T.Mesh(new T.RingGeometry(rIn * 0.35, rIn * 0.98, 40, 1, TH0 - Math.PI / 2, THL), MAT.diffuser);
        difPlate.rotation.x = -Math.PI / 2; difPlate.position.y = yb + pitch * 0.995; pumpG.add(difPlate);
        // impulsor (gira): disco base + álabes + anillo superior
        const imp = new T.Group();
        const hub = new T.Mesh(new T.CylinderGeometry(rIn * 0.86, rIn * 0.86, 0.22 * RS, 40), MAT.impeller);
        hub.position.y = yb + pitch * 0.08; imp.add(hub);
        for (let v = 0; v < 7; v++) {
          const a = (v / 7) * Math.PI * 2;
          const m = new T.Mesh(vaneGeo, MAT.impeller);
          const rr = rIn * 0.56;
          m.position.set(rr * Math.sin(a), yb + pitch * 0.27, rr * Math.cos(a));
          m.rotation.y = a - Math.PI / 2 + 0.55;
          imp.add(m);
        }
        const eye = new T.Mesh(new T.CylinderGeometry(rIn * 0.42, rIn * 0.84, pitch * 0.12, 40, 1, true), MAT.impeller);
        eye.position.y = yb + pitch * 0.47; imp.add(eye);
        rot.add(imp);
      }
      rot.add(disco(rShaft, y.pump[0], y.dh[1], MAT.shaft, 16));
      pumpG.add(rot); rotors.push(rot);
      world.add(pumpG); comps.bomba = { group: pumpG, y0: y.pump[0], y1: y.pump[1], r: rp };

      // ----- Admisión: costillas con puertos -----
      const inG = new T.Group();
      const yi0 = y.intake[0], yi1 = y.intake[1];
      inG.add(anillo(rIn * 0.6, rp, yi1 - 2.2, yi1, MAT.paint, MAT.cutSteel));
      inG.add(anillo(rIn * 0.6, rp, yi0, yi0 + 2.2, MAT.paint, MAT.cutSteel));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const an = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        if (an < TH0 || an > 2 * Math.PI - TH0) continue;
        const rib = new T.Mesh(new T.BoxGeometry(0.42 * RS, yi1 - yi0 - 4.4, 0.3 * RS), MAT.paint);
        rib.position.set((rp - 0.15 * RS) * Math.sin(a), (yi0 + yi1) / 2, (rp - 0.15 * RS) * Math.cos(a));
        rib.rotation.y = a; inG.add(rib);
      }
      inG.add(disco(rShaft, yi0, yi1, MAT.shaft, 16));
      world.add(inG); comps.admision = { group: inG, y0: yi0, y1: yi1, r: rp };

      // ----- Bomba de recirculación dedicada -----
      if (y.recp) {
        const rg = new T.Group();
        rg.add(anillo(rp * 0.9 - 0.2 * RS, rp * 0.9, y.recp[0] + 3, y.recp[1], MAT.paintRec, MAT.cutSteel));
        const rr = new T.Group();
        for (let i = 0; i < 4; i++) {
          const yb = y.recp[0] + 4 + i * ((y.recp[1] - y.recp[0] - 4) / 4);
          const hub = new T.Mesh(new T.CylinderGeometry(rp * 0.66, rp * 0.66, 0.2 * RS, 32), MAT.impeller); hub.position.y = yb + 0.6; rr.add(hub);
          for (let v = 0; v < 6; v++) { const a = (v / 6) * Math.PI * 2; const m = new T.Mesh(new T.BoxGeometry(rp * 0.32, 1.3, 0.1 * RS), MAT.impeller); m.position.set(rp * 0.4 * Math.sin(a), yb + 1.4, rp * 0.4 * Math.cos(a)); m.rotation.y = a - Math.PI / 2 + 0.5; rr.add(m); }
        }
        rr.add(disco(rShaft, y.recp[0], y.recp[1], MAT.shaft, 16));
        rg.add(rr); rotors.push(rr);
        // puertos de entrada de la bomba de recirculación
        rg.add(anillo(rShaft * 1.5, rp * 0.9, y.recp[0], y.recp[0] + 1.2, MAT.paintRec, MAT.cutSteel));
        world.add(rg); comps.bomba_rec = { group: rg, y0: y.recp[0], y1: y.recp[1], r: rp * 0.9 };
      }

      // ----- Sello / protector -----
      const sg = new T.Group();
      sg.add(anillo(rs - 0.2 * RS, rs, y.seal[0], y.seal[1], MAT.seal, MAT.cutSteel));
      const sh = (y.seal[1] - y.seal[0]);
      sg.add(anillo(rShaft * 1.6, rs * 0.62, y.seal[0] + sh * 0.55, y.seal[0] + sh * 0.92, MAT.rubber, MAT.rubber));
      sg.add(anillo(rShaft * 1.6, rs * 0.62, y.seal[0] + sh * 0.16, y.seal[0] + sh * 0.5, MAT.rubber, MAT.rubber));
      sg.add(disco(rs * 0.8, y.seal[0] + 1, y.seal[0] + 2.4, MAT.brass, 32));
      sg.add(disco(rShaft, y.seal[0], y.seal[1], MAT.shaft, 16));
      world.add(sg); comps.sello = { group: sg, y0: y.seal[0], y1: y.seal[1], r: rs };

      // ----- Motor: carcasa, estator laminado, devanados, rotor -----
      const mg = new T.Group();
      const motorHousing = anillo(rm - 0.24 * RS, rm, y.motor[0], y.motor[1], MAT.motor, MAT.cutSteel);
      mg.add(motorHousing);
      const ym0 = y.motor[0] + 4, ym1 = y.motor[1] - 4;
      const rStatO = rm - 0.25 * RS, rStatI = rm * 0.5;
      mg.add(anillo(rStatI, rStatO, ym0, ym1, MAT.lam, MAT.lam));
      [ym0 - 1.6, ym1 + 1.6].forEach((yy) => {
        const tor = new T.Mesh(new T.TorusGeometry((rStatI + rStatO) / 2, (rStatO - rStatI) * 0.42, 12, 48, THL), MAT.copper);
        // el toro queda en el plano XZ; su arco cubre la misma porción que la carcasa cortada
        tor.rotation.set(Math.PI / 2, 0, Math.PI / 2 - TH0 - THL); tor.position.y = yy;
        mg.add(tor);
      });
      const rr = new T.Group();
      const nR = 4, segL = (ym1 - ym0) / nR;
      for (let i = 0; i < nR; i++) {
        rr.add(disco(rStatI - 0.12 * RS, ym0 + i * segL + 0.8, ym0 + (i + 1) * segL - 0.8, MAT.rotor, 36));
        if (i) rr.add(disco(rStatI - 0.05 * RS, ym0 + i * segL - 0.8, ym0 + i * segL + 0.8, MAT.brass, 36));
      }
      rr.add(disco(rShaft, y.motor[0], y.motor[1], MAT.shaft, 16));
      mg.add(rr); rotors.push(rr);
      world.add(mg); comps.motor = { group: mg, y0: y.motor[0], y1: y.motor[1], r: rm };
      L.motorMat = MAT.motor;

      // ----- Sensor de fondo -----
      const sn = new T.Group();
      sn.add(anillo(0, rm * 0.86, y.sensor[0], y.sensor[1], MAT.sensor, MAT.sensor, { full: true }));
      for (let i = 1; i < 4; i++) sn.add(anillo(rm * 0.86, rm * 0.9, y.sensor[0] + i * 2.6, y.sensor[0] + i * 2.6 + 0.6, MAT.dark, MAT.dark, { full: true }));
      world.add(sn); comps.sensor = { group: sn, y0: y.sensor[0], y1: y.sensor[1], r: rm * 0.86 };

      // ----- Camisa -----
      if (camisa) {
        const shG = new T.Group();
        const top = y.intake[1] + 6, bot = yOut - 6;
        shG.add(anillo(shI, shO, bot, top, MAT.shroud, MAT.shroud, { caps: false }));
        shG.add(anillo(rp, shO, top, top + 2, MAT.paint, MAT.cutSteel));
        world.add(shG); comps.camisa = { group: shG, y0: bot, y1: top, r: shO };
        L.shroudTop = top; L.shroudBot = bot;
      }

      // ----- Cable de potencia -----
      const thC = -2.05;
      const cg = new T.Group();
      const rcRound = Math.min((rtO + ci) / 2, ci - 0.6 * RS);
      cg.add(boxBetween(P(rcRound, thC, yTop), P(rcRound, thC, y.dh[1] + 4), 0.9 * RS, 0.9 * RS, MAT.cableJacket));
      const rFlat = rp + Math.min(0.2 * RS, (ci - rp) * 0.45);
      cg.add(boxBetween(P(rcRound, thC, y.dh[1] + 4), P(rFlat, thC, y.dh[1] - 4), 0.9 * RS, 0.3 * RS, MAT.cable));
      const flatEnd = y.motor[1] + 2;
      const mle = boxBetween(P(rFlat, thC, y.dh[1] - 4), P(rFlat, thC, flatEnd), 0.95 * RS, 0.3 * RS, MAT.cable, thC);
      cg.add(mle);
      const pot = new T.Mesh(new T.BoxGeometry(1.3 * RS, 4, 0.55 * RS), MAT.brass);
      pot.position.copy(P(rm + 0.05 * RS, thC, y.motor[1] - 2)); pot.rotation.y = thC; cg.add(pot);
      world.add(cg); comps.cable = { group: cg, y0: y.motor[1], y1: yTop, r: rFlat };

      // ----- Línea de recirculación (tubo aplanado) -----
      L.line = null;
      if (p.recirc !== 'ninguna') {
        const thR = 1.85;
        const gapM = Math.max(ci - rm, 0.05 * RS);
        const A = Math.PI / 4 * p.rec_id * p.rec_id;               // in²
        const tRad = Math.min((p.rec_id + 0.1) * RS, gapM * 0.86);  // espesor radial
        const wTan = Math.min(Math.max((1.35 * A / (tRad / RS) + 0.12) * RS, tRad), 1.4 * RS);
        const rL1 = Math.min(rp + (ci - rp) / 2, ci - tRad / 2 - 0.02 * RS);
        const rL2 = rm + gapM / 2;
        const yStart = p.recirc === 'orificio' ? (y.dh[0] + y.dh[1]) / 2 : y.recp[1] - 2;
        const rStart = p.recirc === 'orificio' ? rp : rp * 0.9;
        const pts = [
          P(rStart, thR, yStart), P(rL1, thR, yStart), P(rL1, thR, y.seal[1] - 2), P(rL2, thR, y.seal[1] - 8),
          P(rL2, thR, yOut), P(rm * 0.35, thR, yOut - 3),
        ];
        const lg = new T.Group();
        for (let i = 1; i < pts.length; i++) lg.add(boxBetween(pts[i - 1], pts[i], wTan, tRad, MAT.line, thR));
        // abrazaderas
        for (let yy = yStart - 14; yy > yOut + 6; yy -= 22) {
          const rr2 = yy > y.seal[1] - 4 ? rL1 : rL2;
          const cl = new T.Mesh(new T.BoxGeometry(wTan * 1.5, 1.6, tRad * 1.35), MAT.lineCut);
          cl.position.copy(P(rr2, thR, yy)); cl.rotation.y = thR; lg.add(cl);
        }
        // boquilla de salida
        const nz = new T.Mesh(new T.CylinderGeometry(0.25 * RS, 0.4 * RS, 3, 16), MAT.lineCut);
        nz.position.copy(P(rm * 0.35, thR, yOut - 1.5)); lg.add(nz);
        // orificio
        let yOr = yStart - 9;
        if (p.recirc === 'orificio') {
          const ob = new T.Mesh(new T.BoxGeometry(wTan * 1.6, 4.5, tRad * 1.3), MAT.brass);
          ob.position.copy(P(rL1, thR, yOr)); ob.rotation.y = thR; lg.add(ob);
        }
        world.add(lg);
        comps.linea = { group: lg, y0: yOut, y1: yStart, r: rL1 };
        L.line = { pts, thR, rL1, rL2, yStart, yOr, wTan, tRad };
      }

      // ----- Aura térmica alrededor del motor -----
      const rA0 = rm + 0.03 * RS, rA1 = (camisa ? shI : ci) - 0.03 * RS;
      const ag = new T.CylinderGeometry(rA1, rA1, y.motor[1] - y.motor[0], 48, 12, true, TH0, THL);
      const cols = new Float32Array(ag.attributes.position.count * 3);
      ag.setAttribute('color', new T.BufferAttribute(cols, 3));
      aura = new T.Mesh(ag, new T.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.2, side: T.DoubleSide, depthWrite: false }));
      aura.position.y = (y.motor[0] + y.motor[1]) / 2; world.add(aura);
      L.auraR = [rA0, rA1];

      // ----- Etiquetas -----
      const thL = -Math.PI / 2;
      addLabel('tuberia', P(rtO, thL, Math.min(y.dh[1] + 40, yTop - 12)), 'l');
      addLabel('bomba', P(rp, thL, (y.pump[0] + y.pump[1]) / 2), 'l');
      addLabel('admision', P(rp, thL, (y.intake[0] + y.intake[1]) / 2), 'l');
      if (y.recp) addLabel('bomba_rec', P(rp, Math.PI / 2, (y.recp[0] + y.recp[1]) / 2), 'r');
      addLabel('sello', P(rs, thL, (y.seal[0] + y.seal[1]) / 2), 'l');
      addLabel('motor', P(rm, thL, (y.motor[0] + y.motor[1]) / 2), 'l');
      addLabel('sensor', P(rm, thL, (y.sensor[0] + y.sensor[1]) / 2), 'l');
      addLabel('perforados', P(rh + 3 * RS, Math.PI / 2, (perf[0] + perf[1]) / 2), 'r');
      addLabel('formacion', P(rf - 1 * RS, Math.PI / 2, (sand[0] + perf[0]) / 2), 'r', 'tenue');
      if (L.line) { addLabel('linea', P(L.line.rL2, L.line.thR, (y.motor[0] + y.motor[1]) / 2 - 8), 'r'); }
      if (p.recirc === 'orificio') addLabel('orificio', P(L.line.rL1, L.line.thR, L.line.yOr), 'r');
      addLabel('salida', P(rm * 0.6, Math.PI / 2, yOut - 3), 'r', 'tenue');
      if (camisa) addLabel('camisa', P(shO, Math.PI / 2, (L.shroudTop + L.shroudBot) / 2 + 10), 'r');

      buildPaths();
      actualizar(r);
      fitCamera();
      // el flujo arranca ya establecido: se simulan unos segundos antes de mostrar
      for (let i = 0; i < 300; i++) { spawn(1 / 30); step(1 / 30); }
    }

    // ---------- Trayectorias de flujo ----------
    function buildPaths() {
      const { ci, rp, rm, rShaft, y, yOut, perf, rh, rtI, camisa, shI, shO } = L;
      const rnd2 = Math.random;
      // ángulo dentro de la mitad conservada, concentrado cerca de los bordes del corte (lo que se ve)
      const thVis = () => { const sd = rnd2() < 0.5 ? 1 : -1; return sd * (Math.PI / 2 + Math.min(Math.abs((rnd2() + rnd2() + rnd2() - 1.5) * 0.9), Math.PI / 2)); };
      const annR = (rIn, rOut) => rIn + (0.2 + 0.6 * rnd2()) * (rOut - rIn);
      const pumpSpiral = (pts, th, y0, y1, Tin, Tout, sp, rr) => {
        const n = 10;
        for (let i = 1; i <= n; i++) { const u = i / n; pts.push([P(rr, th + u * 5.5, y0 + (y1 - y0) * u), Tin + (Tout - Tin) * u, sp]); }
        return th + 5.5;
      };
      L.makeProd = () => {
        const r = R; const sec = L.tunnels.filter((t) => t.enCorte); const pool = sec.length && rnd2() < 0.7 ? sec : L.tunnels;
        const tun = pool[Math.floor(rnd2() * pool.length)];
        // en los túneles del corte, la partícula viaja justo delante de la cara cortada para que se vea
        const th = tun.th - (tun.enCorte ? Math.sign(Math.sin(tun.th)) * 0.06 : 0);
        const sp = L.speeds;
        const Tres = r.T_res_F, Tin = r.T_in_F, Td = r.T_dis_F;
        const pts = [[P(rh + 5 * RS, th, tun.y), Tres, sp.form], [P(ci - 0.05 * RS, th, tun.y), Tres, sp.form]];
        const thA = tun.enCorte ? th + Math.sign(Math.sin(tun.th)) * rnd2() * 0.5 : thVis();
        const yI = (y.intake[0] + y.intake[1]) / 2;
        if (R.p.config === 'sobre') {
          const ra = annR(rm, ci);
          pts.push([P(ra, thA, tun.y), Tres, sp.ann], [P(ra, thA, y.motor[0]), r.T_mi_F, sp.mot], [P(ra, thA, y.motor[1]), r.T_mo_F, sp.mot], [P(annR(rp, ci), thA, yI), Tin, sp.mot]);
        } else if (R.p.config === 'sumidero') {
          const ra = annR(rp, ci);
          pts.push([P(ra, thA, tun.y), Tres, sp.ann], [P(ra, thA, yI + 2), Tres, sp.ann]);
        } else {
          const ro = annR(shO, ci), ri = annR(rm, shI);
          pts.push([P(ro, thA, tun.y), Tres, sp.ann], [P(ro, thA, L.shroudBot - 3), Tres, sp.ann], [P(ri, thA, L.shroudBot - 3), Tres, sp.mot],
            [P(ri, thA, y.motor[0]), r.T_mi_F, sp.mot], [P(ri, thA, y.motor[1]), r.T_mo_F, sp.mot], [P(annR(rp * 0.9, shI), thA, yI), Tin, sp.mot]);
        }
        const rr = rShaft + (rp - rShaft) * (0.35 + 0.4 * rnd2());
        pts.push([P(rr, thA, y.intake[1]), Tin, sp.pump]);
        const thE = pumpSpiral(pts, thA, y.pump[0], y.pump[1], Tin, Td, sp.pump, rr);
        const rt = rtI * (0.2 + 0.6 * rnd2());
        pts.push([P(rt, thE, y.dh[1] + 2), Td, sp.tub], [P(rt, thE, L.yTop + 2), Td, sp.tub]);
        return { pts, kind: 'p' };
      };
      L.makeRec = () => {
        const r = R; const ln = L.line; if (!ln) return null;
        const sp = L.speeds;
        const pts = [];
        const Tin = r.T_in_F, Td = r.T_dis_F, Tr = r.T_r_F;
        const off = (rnd2() - 0.5) * 0.04;
        const lp = ln.pts.map((v) => { const th = Math.atan2(v.x, v.z) + off; const rr = Math.hypot(v.x, v.z); return P(rr, th, v.y); });
        const Tstart = R.p.recirc === 'orificio' ? Td : Tin;
        pts.push([lp[0], Tstart, sp.line], [lp[1], Tstart, sp.line]);
        for (let i = 2; i < lp.length; i++) pts.push([lp[i], i === 2 ? (Tstart + Tr) / 2 : Tr, sp.line]);
        const thA = thVis();
        const ra = camisa ? annR(rm, shI) : annR(rm, ci);
        pts.push([P(ra, thA, yOut + 1), Tr, sp.mot], [P(ra, thA, y.motor[0]), r.T_mi_F, sp.mot], [P(ra, thA, y.motor[1]), r.T_mo_F, sp.mot]);
        if (R.p.recirc === 'orificio') {
          const yI = (y.intake[0] + y.intake[1]) / 2;
          pts.push([P(annR(rp, ci), thA, yI), Tin, sp.mot]);
          const rr = rShaft + (rp - rShaft) * (0.35 + 0.4 * rnd2());
          pts.push([P(rr, thA, y.intake[1]), Tin, sp.pump]);
          pumpSpiral(pts, thA, y.pump[0], y.pump[1], Tin, Td, sp.pump, rr);
          pts.push([P(rp * 0.6, thA + 5.5, (y.dh[0] + y.dh[1]) / 2), Td, sp.pump]);
        } else {
          pts.push([P(annR(rp * 0.9, ci), thA, y.recp[0] + 0.5), Tin, sp.mot], [P(rp * 0.4, thA, y.recp[0] + 1), Tin, sp.pump]);
          pumpSpiral(pts, thA, y.recp[0] + 1, y.recp[1] - 2, Tin, Tin, sp.pump, rp * 0.45);
        }
        return { pts, kind: 'r' };
      };
    }

    function addParticle(path) {
      if (!path || parts.length >= MAXP) return;
      const segs = [];
      for (let i = 1; i < path.pts.length; i++) {
        const a = path.pts[i - 1], b = path.pts[i];
        segs.push({ a: a[0], b: b[0], Ta: a[1], Tb: b[1], v: b[2], len: a[0].distanceTo(b[0]) });
      }
      parts.push({ segs, i: 0, s: 0, kind: path.kind, size: L.pSize * (path.kind === 'r' ? 0.92 : 1) });
    }
    function addBubble() {
      if (bubbles.length >= MAXB) return;
      const tun = L.tunnels[Math.floor(Math.random() * L.tunnels.length)];
      const ra = (R.p.config === 'sobre' ? L.rm : L.rp) + (0.25 + 0.5 * Math.random()) * (L.ci - (R.p.config === 'sobre' ? L.rm : L.rp));
      const ro = R.p.config === 'camisa' ? L.shO + 0.5 * (L.ci - L.shO) : ra;
      const thb = Math.sign(Math.sin(tun.th) || 1) * (Math.PI / 2 + Math.random() * 0.7);
      bubbles.push({ th: thb, r: ro, y: tun.y, size: (0.12 + Math.random() * 0.2) * RS, cap: Math.random() > R.E_sep, ph: Math.random() * 6, st: 0 });
    }

    // ---------- Actualización con un nuevo resultado ----------
    function actualizar(r, dyn) {
      R = r; if (!L) return;
      const p = r.p;
      const ftps = (bpd, in2) => (bpd * 5.615 / 86400) / (in2 / 144);
      const vis = (v) => 7 + 20 * Math.sqrt(Math.max(v, 0));
      const A_cas = Math.PI / 4 * (p.casing_id ** 2 - p.pump_od ** 2);
      L.speeds = {
        form: vis(ftps(r.qp_bpd, 6)) * 0.6,
        ann: vis(ftps(r.qp_bpd, A_cas)),
        mot: vis(r.v_motor_fts),
        pump: vis(ftps(r.Qm_bpd, Math.PI / 4 * (p.pump_od * 0.55) ** 2)) * 1.6,
        tub: vis(ftps(r.qp_bpd, Math.PI / 4 * p.tubing_id ** 2)),
        line: vis(ftps(r.qr_bpd, Math.PI / 4 * p.rec_id ** 2)) * 0.8,
      };
      const lo = p.T_res, hi = p.T_lim;
      const Tw = dyn && dyn.Tw != null ? dyn.Tw : r.T_wind_F;
      // motor: brillo según temperatura de devanado
      const u = Math.min(Math.max((Tw - lo) / Math.max(hi - lo, 1), 0), 1.2);
      tCol(Tw, lo, hi, COL);
      L.motorMat.emissive.copy(COL).multiplyScalar(0.08 + 0.55 * u * u);
      // aura: gradiente de temperatura del fluido a lo largo del motor
      if (aura) {
        const pos = aura.geometry.attributes.position, col = aura.geometry.attributes.color;
        const h = L.y.motor[1] - L.y.motor[0];
        for (let i = 0; i < pos.count; i++) {
          const yy = pos.getY(i) / h + 0.5;
          const Tf = r.T_mi_F + (r.T_mo_F - r.T_mi_F) * yy;
          tCol(Tf, lo, hi, COL); col.setXYZ(i, COL.r, COL.g, COL.b);
        }
        col.needsUpdate = true;
        aura.material.opacity = 0.1 + 0.25 * Math.min((r.T_mo_F - lo) / Math.max(hi - lo, 1), 1);
      }
      // etiquetas
      const f0 = (v, d) => (Number.isFinite(v) ? v.toLocaleString('es-CO', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) : '—');
      const txt = {
        tuberia: `<b>Tubería de producción</b> ${f0(p.tubing_id, 3)} in ID<br>${f0(r.qp_bpd)} bpd a superficie · ${f0(r.T_dis_F)} °F`,
        bomba: `<b>Bomba</b> ${f0(p.N_etapas)} etapas · ${f0(p.freq, 1)} Hz<br>${f0(r.Qm_bpd)} bpd · ${f0(r.TDH_ft)} ft · ${f0(r.x, 2)}×BEP`,
        admision: `<b>Admisión</b> ${f0(r.Pin_psi)} psi · ${f0(Math.round(dyn && dyn.Tin != null ? dyn.Tin : r.T_in_F))} °F<br>gas libre ${f0(r.GVF * 100, 1)} % · ${f0(p.D_bomba)} ft`,
        bomba_rec: `<b>Bomba de recirculación</b> ${f0(p.Nr_etapas)} etapas<br>${f0(r.qr_bpd)} bpd · ${f0(r.P_rs_kW, 1)} kW`,
        sello: `<b>Sello / protector</b><br>iguala presión, aísla el aceite del motor`,
        motor: `<b>Motor</b> ${f0(p.HP_nom)} hp · ${f0(p.motor_od, 2)} in · ${f0(r.I_mot)} A<br>devanado <span class="t">${f0(Tw)} °F</span> · v ${f0(r.v_motor_fts, 2)} ft/s`,
        sensor: `<b>Sensor de fondo</b> ${f0(p.D_bomba + p.motor_len + 30)} ft`,
        perforados: `<b>Perforados</b> ${f0(p.D_perf)} ft<br>Pwf ${f0(r.Pwf_psi)} psi · ${f0(r.qp_bpd)} bpd`,
        formacion: `Arenisca productora entre lutitas`,
        revestimiento: `Revestimiento ${f0(p.casing_id, 3)} in ID · cemento`,
        linea: `<b>Línea de recirculación</b><br>${f0(r.qr_bpd)} bpd · ${f0(r.T_r_F)} °F`,
        orificio: `<b>Orificio</b> Ø ${f0(p.orif_d, 2)} in<br>ΔP ${f0(r.dpRec_psi)} psi · ${f0(r.P_v_kW, 1)} kW a calor`,
        salida: `Salida bajo el motor`,
        camisa: `<b>Camisa</b> ${f0(p.casing_id - 0.75, 2)} in ID<br>obliga al fluido a pasar por el motor`,
      };
      labelObjs.forEach((l) => { if (txt[l.name] != null) l.el.innerHTML = txt[l.name]; l.el.classList.toggle('alerta', l.name === 'motor' && Tw > p.T_lim - 30); });
    }

    // ---------- Cámara ----------
    let tween = null;
    function presets() {
      const { y, perf, yTop, yBot, rf, ci } = L;
      const tanH = Math.tan((camera.fov * Math.PI) / 360);
      // distancia para encuadrar una altura h y un ancho w
      const fit = (h, w) => Math.max(h / (2 * tanH), w / (2 * tanH * Math.max(camera.aspect, 0.3))) * 1.08;
      const at = (yy, h, w, elev, az) => { const d = fit(h, w); return { t: new T.Vector3(0, yy, 0), p: new T.Vector3(Math.sin(az) * d, yy + elev * d, Math.cos(az) * d) }; };
      const lineY = L.line ? (L.line.yStart + y.motor[0]) / 2 : (y.seal[0] + y.seal[1]) / 2;
      const W = 2 * rf;
      return {
        general: at((yTop + yBot) / 2, yTop - yBot, W * 1.25, 0.12, 0.42),
        perforados: at((perf[0] + perf[1]) / 2, perf[1] - perf[0] + 40, W * 1.1, 0.12, 0.3),
        bomba: at((y.pump[0] + y.pump[1]) / 2, y.pump[1] - y.pump[0] + 16, ci * 5, 0.08, 0.32),
        admision: at((y.intake[0] + y.seal[1]) / 2, 46, ci * 4, 0.12, 0.35),
        motor: at((y.motor[0] + y.motor[1]) / 2, y.motor[1] - y.motor[0] + 18, ci * 5, 0.08, 0.3),
        linea: at(lineY, (L.line ? L.line.yStart : y.seal[1]) - L.yOut + 20, ci * 5, 0.06, 0.75),
        fondo: at(L.yOut + 10, 60, ci * 4.5, 0.2, 0.3),
      };
    }
    function vista(nombre, inmediato) {
      if (!L) return;
      if (presets()[nombre]) vistaActual = nombre;
      const pr = presets()[nombre] || presets().general;
      if (inmediato) { camera.position.copy(pr.p); controls.target.copy(pr.t); controls.update(); return; }
      tween = { t0: performance.now(), d: 1100, p0: camera.position.clone(), t0v: controls.target.clone(), p1: pr.p, t1: pr.t };
    }
    // al reconstruir, se re-encuadra la vista activa (la geometría cambia de altura)
    function fitCamera() { vista(vistaActual, true); }
    let vistaActual = 'general';

    function resaltar(nombre) {
      if (glow) { world.remove(glow); glow.geometry.dispose(); glow = null; }
      glowComp = nombre;
      const c = comps[nombre]; if (!c) return;
      const h = c.y1 - c.y0;
      glow = new T.Mesh(new T.CylinderGeometry(c.r * 1.18 + 1.5, c.r * 1.18 + 1.5, h + 4, 48, 1, true), MAT.glow);
      glow.position.y = (c.y0 + c.y1) / 2; world.add(glow);
    }

    // ---------- Selección con clic ----------
    const ray = new T.Raycaster(), mouse = new T.Vector2();
    let downAt = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
      const hit = pick(e); if (hit && opts.onSelect) opts.onSelect(hit);
    });
    renderer.domElement.addEventListener('pointermove', (e) => {
      if (e.buttons) return;
      const hit = pick(e);
      renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
      if (opts.onHover) opts.onHover(hit, e);
    });
    function pick(e) {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
      ray.setFromCamera(mouse, camera);
      const order = ['motor', 'sello', 'admision', 'bomba_rec', 'bomba', 'descarga', 'linea', 'cable', 'sensor', 'camisa', 'perforados', 'tuberia'];
      const objs = []; order.forEach((k) => comps[k] && objs.push(comps[k].group));
      const hits = ray.intersectObjects(objs, true);
      if (!hits.length) return null;
      let o = hits[0].object;
      while (o) { const k = order.find((n) => comps[n] && comps[n].group === o); if (k) return k; o = o.parent; }
      return null;
    }

    // ---------- Bucle ----------
    function resize() {
      const w = container.clientWidth, h = container.clientHeight;
      renderer.setSize(w, h); labels.setSize(w, h);
      camera.aspect = w / Math.max(h, 1); camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize); resize();

    let last = performance.now();
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.08); last = now;
      if (tween) {
        const u = Math.min((now - tween.t0) / tween.d, 1); const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0v, tween.t1, e);
        if (u >= 1) tween = null;
      }
      controls.update();
      if (L && R && state.corriendo) {
        const w = 2 * Math.PI * (R.p.freq / 60) * 0.9;
        rotors.forEach((g) => { g.rotation.y += w * dt; });
        if (state.particulas) { spawn(dt); step(dt); }
      }
      if (glow) glow.material.opacity = 0.16 + 0.12 * Math.sin(now / 260);
      drawInstances();
      renderer.render(scene, camera);
      labels.render(scene, camera);
      requestAnimationFrame(frame);
    }
    function spawn(dt) {
      const rate = (q) => Math.min(q / 7, 110);
      acc.p += rate(R.qp_bpd) * dt; acc.r += rate(R.qr_bpd) * dt;
      acc.g += Math.min(R.qg_libre_bpd / 2.5, 60) * dt;
      while (acc.p >= 1) { acc.p -= 1; addParticle(L.makeProd()); }
      while (acc.r >= 1) { acc.r -= 1; addParticle(L.makeRec()); }
      while (acc.g >= 1) { acc.g -= 1; addBubble(); }
    }
    function step(dt) {
      for (let k = parts.length - 1; k >= 0; k--) {
        const q = parts[k]; let seg = q.segs[q.i]; let adv = seg.v * dt;
        while (adv > 0 && seg) { const rem = seg.len - q.s; if (adv < rem) { q.s += adv; adv = 0; } else { adv -= rem; q.i++; q.s = 0; seg = q.segs[q.i]; } }
        if (!seg) parts.splice(k, 1);
      }
      const yI = (L.y.intake[0] + L.y.intake[1]) / 2;
      const vb = 9 * (R.p.v_b / 0.5);
      for (let k = bubbles.length - 1; k >= 0; k--) {
        const b = bubbles[k]; b.ph += dt * 5;
        if (b.st === 1) { // entrando a la admisión
          b.r += ((L.rp * 0.5) - b.r) * Math.min(dt * 3, 1); b.y += (L.y.intake[1] + 6 - b.y) * Math.min(dt * 1.5, 1);
          b.size *= 1 - dt * 1.8; if (b.size < 0.03 * RS) bubbles.splice(k, 1);
          continue;
        }
        if (R.p.config === 'sobre') { b.y += vb * dt; if (b.cap && b.y > yI - 4) b.st = 1; }
        else if (b.cap) { b.y -= 6 * dt; if (R.p.config === 'camisa' ? b.y < L.shroudBot : b.y < yI + 2) b.st = 1; }
        else b.y += vb * dt;
        if (b.y > L.yTop) bubbles.splice(k, 1);
      }
    }
    function drawInstances() {
      if (!L || !R) { pMesh.count = 0; bMesh.count = 0; return; }
      const lo = R.p.T_res, hi = R.p.T_lim;
      let n = 0;
      if (state.particulas) for (const q of parts) {
        const seg = q.segs[q.i]; const u = seg.len > 0 ? q.s / seg.len : 0;
        V3.copy(seg.a).lerp(seg.b, u);
        SC.set(q.size, q.size, q.size);
        M4.compose(V3, Q0, SC); pMesh.setMatrixAt(n, M4);
        tCol(seg.Ta + (seg.Tb - seg.Ta) * u, lo, hi, COL); pMesh.setColorAt(n, COL);
        n++;
      }
      pMesh.count = n; pMesh.instanceMatrix.needsUpdate = true; if (pMesh.instanceColor) pMesh.instanceColor.needsUpdate = true;
      let m = 0;
      if (state.particulas) for (const b of bubbles) {
        V3.copy(P(b.r + Math.sin(b.ph) * 0.08 * RS, b.th + Math.cos(b.ph) * 0.02, b.y));
        SC.set(b.size, b.size, b.size); M4.compose(V3, Q0, SC); bMesh.setMatrixAt(m, M4); m++;
      }
      bMesh.count = m; bMesh.instanceMatrix.needsUpdate = true;
    }
    requestAnimationFrame(frame);

    return {
      construir, actualizar, vista, resaltar,
      opciones(o) {
        Object.assign(state, o);
        labels.domElement.style.display = state.etiquetas ? '' : 'none';
      },
      limpiarFlujo() { parts.length = 0; bubbles.length = 0; },
      stats: () => ({ parts: parts.length, bubbles: bubbles.length, drawn: pMesh.count, col: pMesh.instanceColor ? Array.from(pMesh.instanceColor.array.slice(0, 6)) : null }),
      componentes: () => Object.keys(comps),
      resize,
    };
  }

  root.Escena3D = { crear, disponible: () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { return false; } } };
})(typeof self !== 'undefined' ? self : this);
