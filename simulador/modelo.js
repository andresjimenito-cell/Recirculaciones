/*
 * Modelo de estado estacionario (con dinámica térmica de primer orden) de un
 * sistema BES (bombeo electrosumergible) con recirculación de fluido.
 *
 * Unidades de entrada/salida: campo (bpd, ft, in, psi, °F, hp).
 * Unidades internas: SI.
 *
 * El mismo modelo está implementado en Python en modelo/recirculacion.py;
 * herramientas/verificar_js_py.py comprueba que ambos coinciden.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RecircModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- Constantes y conversiones ----------
  const G = 9.80665;
  const BPD = 1.840130728e-6;   // 1 bpd en m3/s
  const FT = 0.3048;
  const IN = 0.0254;
  const PSI = 6894.757;
  const HP = 745.7;
  const RUG = 4.6e-5;           // rugosidad absoluta tubería de acero comercial [m]
  const Q_EPS = 0.5 * BPD;      // caudal mínimo numérico
  const F2C = (t) => (t - 32) / 1.8;
  const C2F = (t) => t * 1.8 + 32;

  // Caso base: pozo de baja tasa y alta RGA en revestimiento de 5-1/2 in, 17 lb/ft,
  // con el equipo en el sumidero para separar gas (ver docs, sección 10).
  const DEFAULTS = {
    config: 'sumidero',      // 'sobre' | 'sumidero' | 'camisa'
    recirc: 'orificio',      // 'ninguna' | 'orificio' | 'dedicada'
    // Pozo
    D_perf: 7000, D_bomba: 7150, casing_id: 4.892, tubing_id: 2.441,
    motor_od: 4.50, pump_od: 4.00, motor_len: 25, shroud_id: 4.142, P_wh: 150,
    // Yacimiento
    Pr: 2400, J: 0.35, T_res: 210, GOR: 500, gamma_g: 0.75,
    // Fluido
    API: 40, WC: 0.5, SG_w: 1.05, WC_inv: 0.5,
    // Bomba principal (curva por etapa a 60 Hz)
    N_etapas: 280, Q_bep: 700, H0: 24, eta_bep: 0.65, freq: 55,
    ROR_min: 0.65, ROR_max: 1.25, x_onset: 0.6,
    // Motor
    HP_nom: 60, eta_motor: 0.86, k0: 0.3, dT_int: 40, T_lim: 400, kg_por_hp: 15,
    V_nom: 1100, FP: 0.82,
    // Recirculación (tubo aplanado: rec_id es el diámetro equivalente de flujo)
    rec_id: 0.30, rec_len: 70, orif_d: 0.30, Cd: 0.61, K_menores: 1.5,
    Nr_etapas: 40, Qr_bep: 500, H0r: 24, eta_r: 0.55,
    // Térmico / gas
    UA: 100, v_nat: 0.015, phi: 0.3, v_b: 0.5, GVF_lim: 0.15, P_in_min: 50, z: 0.9,
  };

  // ---------- Propiedades de fluido ----------
  function props(p, T_F) {
    const T = Math.max(T_F, 60);
    const SGo = 141.5 / (131.5 + p.API);
    const rho_o = 999 * SGo, rho_w = 999 * p.SG_w;
    const WC = p.WC;
    const rho = WC * rho_w + (1 - WC) * rho_o;
    // Viscosidad de crudo muerto, Beggs & Robinson (1975) [cP]
    const zz = 3.0324 - 0.02023 * p.API;
    const xx = Math.pow(10, zz) * Math.pow(T, -1.163);
    const mu_o = Math.pow(10, xx) - 1;
    // Viscosidad del agua, Brill & Beggs [cP]
    const mu_w = Math.exp(1.003 - 1.479e-2 * T + 1.982e-5 * T * T);
    // Emulsión (Brinkman): fase continua según punto de inversión
    let mu;
    if (WC >= p.WC_inv) mu = mu_w * Math.pow(1 - (1 - WC), -2.5);
    else mu = mu_o * Math.pow(1 - WC, -2.5);
    const xw = (WC * rho_w) / rho;                 // fracción másica de agua
    const cp = xw * 4180 + (1 - xw) * 2000;        // J/kg K
    const k = WC * 0.66 + (1 - WC) * 0.13;         // W/m K
    const beta = WC * 5.5e-4 + (1 - WC) * 7.0e-4;  // 1/K
    return { rho, mu: mu * 1e-3, mu_cP: mu, mu_o, mu_w, k, cp, beta, C: rho * cp };
  }

  // ---------- PVT de gas (Standing) ----------
  function rsStanding(p, P_psia, T_F) {
    const P = Math.max(P_psia, 14.7);
    const rs = p.gamma_g * Math.pow((P / 18.2 + 1.4) * Math.pow(10, 0.0125 * p.API - 0.00091 * T_F), 1.2048);
    return Math.min(rs, p.GOR);
  }
  function pbStanding(p, T_F) {
    if (p.GOR <= 0) return 14.7;
    return 18.2 * (Math.pow(p.GOR / p.gamma_g, 0.83) * Math.pow(10, 0.00091 * T_F - 0.0125 * p.API) - 1.4);
  }

  // ---------- IPR: PI lineal sobre Pb, Vogel por debajo ----------
  function makeIPR(p) {
    const Pb = Math.min(p.Pr, Math.max(pbStanding(p, p.T_res), 14.7));
    const qb = p.J * (p.Pr - Pb);
    const qmax = qb + (p.J * Pb) / 1.8;
    const q = (Pwf) => {
      if (Pwf >= Pb) return p.J * (p.Pr - Pwf);
      const r = Pwf / Pb;
      return qb + ((p.J * Pb) / 1.8) * (1 - 0.2 * r - 0.8 * r * r);
    };
    const pwf = (qq) => {
      if (qq <= 0) return p.Pr;
      if (qq >= qmax) return 0;
      let lo = 0, hi = p.Pr;
      for (let i = 0; i < 60; i++) {
        const m = 0.5 * (lo + hi);
        if (q(m) > qq) lo = m; else hi = m;
      }
      return 0.5 * (lo + hi);
    };
    return { Pb, qmax, q, pwf };
  }

  // ---------- Curva de bomba centrífuga (etapa normalizada) ----------
  // h(x) = H/H0 con x = Q/Q_BEP;  h(1)=0.70,  h=0 en x≈1.90
  const hfun = (x) => 1 - 0.05 * x - 0.25 * x * x;
  // eficiencia η = η_bep·x(2-x)  ⇒  potencia al eje finita en caudal cero
  function pump(N, Qbep_bpd, H0_ft, eta_bep, f) {
    const s = f / 60;
    const Qb = Qbep_bpd * BPD * s;            // m3/s, BEP a la frecuencia actual
    const H0 = N * H0_ft * FT * s * s;        // m, cierre de la sarta
    return {
      Qb, H0,
      x: (Q) => Q / Qb,
      head: (Q) => H0 * hfun(Q / Qb),
      eta: (Q) => { const x = Math.min(Q / Qb, 1.9); return eta_bep * Math.max(x * (2 - x), 0); },
      power: (Q, rho) => {
        const x = Math.min(Math.max(Q / Qb, 0), 1.9);
        return Math.max((rho * G * H0 * hfun(x) * Qb) / (eta_bep * (2 - x)), 0);
      },
    };
  }

  // ---------- Fricción ----------
  function darcy(Re, D) {
    if (Re < 1e-9) return 0;
    if (Re < 2300) return 64 / Re;
    const a = Math.log10(RUG / (3.7 * D) + 5.74 / Math.pow(Re, 0.9));
    return 0.25 / (a * a);
  }
  function dpPipe(q, D, L, fl, Kmin) {
    if (q <= 0) return 0;
    const A = (Math.PI / 4) * D * D;
    const v = q / A;
    const Re = (fl.rho * v * D) / fl.mu;
    return (darcy(Re, D) * (L / D) + (Kmin || 0)) * 0.5 * fl.rho * v * v;
  }

  function bisect(fn, lo, hi, it) {
    let flo = fn(lo);
    for (let i = 0; i < (it || 60); i++) {
      const m = 0.5 * (lo + hi);
      const fm = fn(m);
      if ((fm > 0) === (flo > 0)) { lo = m; flo = fm; } else hi = m;
    }
    return 0.5 * (lo + hi);
  }

  // ---------- Transferencia de calor en el anular del motor ----------
  function filmCoefficient(fl, v, Dh, L, qflux) {
    const Re = (fl.rho * Math.abs(v) * Dh) / fl.mu;
    const Pr = (fl.mu * fl.cp) / fl.k;
    const gnielinski = (re) => {
      const f = Math.pow(0.79 * Math.log(re) - 1.64, -2);
      return ((f / 8) * (re - 1000) * Pr) / (1 + 12.7 * Math.sqrt(f / 8) * (Math.pow(Pr, 2 / 3) - 1));
    };
    const hausen = (re) => {
      const Gz = (Dh * re * Pr) / L;
      return 3.66 + (0.0668 * Gz) / (1 + 0.04 * Math.pow(Gz, 2 / 3));
    };
    let Nu;
    if (Re < 2300) Nu = hausen(Re);
    else if (Re < 4000) { const w = (Re - 2300) / 1700; Nu = (1 - w) * hausen(2300) + w * gnielinski(4000); }
    else Nu = gnielinski(Re);
    const hf = (Nu * fl.k) / Dh;
    // Convección natural turbulenta: Nu = 0.15 Ra^(1/3) ⇒ h independiente de L
    const nu = fl.mu / fl.rho, alpha = fl.k / (fl.rho * fl.cp);
    let dT = 10, hn = 0, h = hf;
    for (let i = 0; i < 40; i++) {
      hn = 0.15 * fl.k * Math.cbrt((G * fl.beta * Math.max(dT, 1e-3)) / (nu * alpha));
      h = Math.cbrt(hf * hf * hf + hn * hn * hn);
      dT = 0.5 * (dT + qflux / h);
    }
    return { Re, Pr, Nu, hf, hn, h, dT: qflux / h, regimen: Re < 2300 ? 'laminar' : Re < 4000 ? 'transición' : 'turbulento' };
  }

  // ---------- Solución hidráulica a una temperatura de propiedades dada ----------
  function hydraulics(p, fl, ipr) {
    const f = p.freq;
    const main = pump(p.N_etapas, p.Q_bep, p.H0, p.eta_bep, f);
    const recP = pump(p.Nr_etapas, p.Qr_bep, p.H0r, p.eta_r, f);
    const D_tbg = p.tubing_id * IN, L_tbg = p.D_bomba * FT;
    const D_rec = p.rec_id * IN, L_rec = p.rec_len * FT;
    const A_or = (Math.PI / 4) * Math.pow(p.orif_d * IN, 2);
    const recOn = p.recirc !== 'ninguna';
    const dz = (p.D_bomba - p.D_perf) * FT;  // >0 si la admisión está bajo los perforados

    const dpRec = (qr) => (qr <= 0 ? 0 : dpPipe(qr, D_rec, L_rec, fl, p.K_menores) + 0.5 * fl.rho * Math.pow(qr / (p.Cd * A_or), 2));
    const Pin = (qp) => ipr.pwf(qp / BPD) * PSI + fl.rho * G * dz;      // Pa
    const Pdis = (qp) => p.P_wh * PSI + fl.rho * G * L_tbg + dpPipe(qp, D_tbg, L_tbg, fl, 0);

    // Caudal de recirculación
    const qrOrifice = (qp) => {
      if (!recOn) return 0;
      const hi = 1.9 * main.Qb - qp;
      if (hi <= 0) return 0;
      const g = (qr) => fl.rho * G * main.head(qp + qr) - dpRec(qr);
      if (g(0) <= 0) return 0;
      return bisect(g, 0, hi);
    };
    let qrDed = 0;
    if (p.recirc === 'dedicada') {
      const g = (qr) => fl.rho * G * recP.head(qr) - dpRec(qr);
      qrDed = g(0) > 0 ? bisect(g, 0, 1.9 * recP.Qb) : 0;
    }
    const qrOf = (qp) => (p.recirc === 'orificio' ? qrOrifice(qp) : p.recirc === 'dedicada' ? qrDed : 0);
    const Qmain = (qp) => (p.recirc === 'orificio' ? qp + qrOf(qp) : qp);

    const F = (qp) => fl.rho * G * main.head(Qmain(qp)) - (Pdis(qp) - Pin(qp));

    // Caudal máximo antes de que la presión de admisión caiga al mínimo (pump-off)
    const qmax = ipr.qmax * BPD;
    const PinMin = p.P_in_min * PSI;
    let qcap;
    if (Pin(0) <= PinMin) qcap = 0;
    else if (Pin(qmax * 0.9999) >= PinMin) qcap = qmax * 0.9999;
    else qcap = bisect((q) => Pin(q) - PinMin, 0, qmax * 0.9999);

    let qp, estado;
    if (qcap <= 0 || F(0) <= 0) { qp = 0; estado = 'sin_produccion'; }
    else if (F(qcap) >= 0) { qp = qcap; estado = 'pump_off'; }
    else { qp = bisect(F, 0, qcap); estado = 'normal'; }

    const qr = qrOf(qp);
    const Qm = Qmain(qp);
    return {
      main, recP, qp, qr, Qm, estado,
      Pin: Pin(qp), Pdis: Pdis(qp), Pwf: ipr.pwf(qp / BPD),
      Hm: main.head(Qm), dpRec: dpRec(qr), dpTbg: dpPipe(qp, D_tbg, L_tbg, fl, 0),
      A_or, curves: { Pin, Pdis, Qmain, qrOf },
    };
  }

  // ---------- Modelo completo ----------
  function simulate(input) {
    const p = Object.assign({}, DEFAULTS, input || {});
    const ipr = makeIPR(p);
    const recOn = p.recirc !== 'ninguna';

    let T_props = p.T_res, hy, fl, th;
    for (let it = 0; it < 8; it++) {
      fl = props(p, T_props);
      hy = hydraulics(p, fl, ipr);
      th = thermal(p, fl, hy);
      const Tn = th.T_in_F;
      if (Math.abs(Tn - T_props) < 0.05) { T_props = Tn; break; }
      T_props = 0.5 * (T_props + Math.min(Tn, 700));
    }

    // Gas libre en la admisión
    const Pin_psia = hy.Pin / PSI;
    const qp_bpd = hy.qp / BPD, qr_bpd = hy.qr / BPD;
    const qo = qp_bpd * (1 - p.WC);
    const Rs = rsStanding(p, Pin_psia, th.T_in_F);
    const libre_scf = Math.max(p.GOR - Rs, 0) * qo;
    const Bg = (0.00504 * p.z * (th.T_in_F + 460)) / Math.max(Pin_psia, 14.7); // bbl/scf
    const qg_libre = libre_scf * Bg;                                           // bbl/d
    // separación natural: E = v_b / (v_b + v_l)
    // área anular alrededor de la bomba/admisión, por donde pasa el líquido que la burbuja debe vencer
    const casA = (Math.PI / 4) * (p.casing_id * p.casing_id - p.pump_od * p.pump_od) * IN * IN;
    let v_l;
    if (p.config === 'sobre') v_l = (hy.qp + hy.qr) / casA;
    else if (p.config === 'sumidero') v_l = hy.qp / casA;
    else {
      const sOD = p.shroud_id + 0.5;
      const A = (Math.PI / 4) * Math.max(p.casing_id * p.casing_id - sOD * sOD, 0.5) * IN * IN;
      v_l = hy.qp / A;
    }
    const vb = p.v_b * FT;
    const E_sep = vb / (vb + v_l);
    const qg_in = qg_libre * (1 - E_sep);
    const R = hy.qp > Q_EPS ? hy.qr / hy.qp : 0;
    const qg_tot = qg_in * (1 + p.phi * R);
    const GVF = qp_bpd > 0.5 ? qg_tot / (qg_tot + qp_bpd + qr_bpd) : 0;
    const GVF_sin_rec = qp_bpd > 0.5 ? qg_in / (qg_in + qp_bpd) : 0;

    // Estado de la bomba
    const x = hy.main.x(hy.Qm);
    let zona;
    if (hy.Qm < Q_EPS) zona = 'cerrada';
    else if (x < p.ROR_min) zona = 'empuje_descendente';
    else if (x > p.ROR_max) zona = 'empuje_ascendente';
    else zona = 'rango';
    const recInterna = Math.max(0, (p.x_onset - x) / p.x_onset);

    // Erosión en el orificio (API RP 14E, C = 100)
    const rho_lb = fl.rho * 0.062428;
    const v_or = recOn && hy.A_or > 0 ? hy.qr / (p.Cd * hy.A_or) / FT : 0;
    const v_eros = 100 / Math.sqrt(rho_lb);

    const alertas = [];
    if (hy.estado === 'sin_produccion') alertas.push({ n: 'critico', t: 'La bomba no levanta la columna: no hay producción a superficie.' });
    if (hy.estado === 'pump_off') alertas.push({ n: 'critico', t: 'Pump-off: el pozo no aporta lo que la bomba puede manejar; la presión de admisión cae al mínimo.' });
    if (th.v_motor_fts < 1) alertas.push({ n: 'critico', t: `Velocidad en el motor ${th.v_motor_fts.toFixed(2)} ft/s, por debajo de 1 ft/s.` });
    if (th.T_wind_F > p.T_lim) alertas.push({ n: 'critico', t: 'El devanado supera el límite del aislamiento.' });
    else if (th.T_wind_F > p.T_lim - 30) alertas.push({ n: 'aviso', t: 'Devanado a menos de 30 °F del límite.' });
    if (zona === 'empuje_descendente') alertas.push({ n: 'aviso', t: 'Bomba por debajo del rango recomendado (empuje descendente).' });
    if (zona === 'empuje_ascendente') alertas.push({ n: 'aviso', t: 'Bomba por encima del rango recomendado (empuje ascendente).' });
    if (recInterna > 0) alertas.push({ n: 'aviso', t: 'Caudal bajo el umbral de recirculación interna en el impulsor.' });
    if (GVF > p.GVF_lim) alertas.push({ n: 'critico', t: `GVF en admisión ${(GVF * 100).toFixed(0)} % sobre el límite del equipo.` });
    if (th.L > 1.0) alertas.push({ n: 'critico', t: 'Motor sobrecargado.' });
    if (v_or > v_eros && recOn) alertas.push({ n: 'aviso', t: 'Velocidad en el orificio sobre la velocidad erosional (API RP 14E).' });

    return {
      p, fl, ipr, hy,
      Pb: ipr.Pb, qmax_bpd: ipr.qmax,
      qp_bpd, qr_bpd, Qm_bpd: hy.Qm / BPD, R,
      Pwf_psi: hy.Pwf, Pin_psi: Pin_psia, Pdis_psi: hy.Pdis / PSI,
      TDH_ft: hy.Hm / FT, dpRec_psi: hy.dpRec / PSI, dpTbg_psi: hy.dpTbg / PSI,
      x, zona, recInterna, estado: hy.estado,
      GVF, GVF_sin_rec, E_sep, qg_libre_bpd: qg_libre, Rs,
      v_or_fts: v_or, v_eros_fts: v_eros, mu_cP: fl.mu_cP, rho: fl.rho,
      desgaste_rel: hy.qp > Q_EPS ? hy.Qm / hy.qp : Infinity,
      ...th,
      alertas,
    };
  }

  function thermal(p, fl, hy) {
    const C = fl.C;
    const s = p.freq / 60;
    const qp = hy.qp, qr = hy.qr, Qm = hy.Qm;
    const recOn = p.recirc !== 'ninguna' && qr > Q_EPS;

    // Potencias [W]
    const Psh_main = hy.main.power(Qm, fl.rho);
    const Phyd_main = fl.rho * G * hy.Hm * Qm;
    const P_p = Math.max(Psh_main - Phyd_main, 0);                     // pérdidas bomba principal
    const P_v = p.recirc === 'orificio' ? hy.dpRec * qr : 0;            // estrangulamiento en la línea
    const P_rs = p.recirc === 'dedicada' ? hy.recP.power(qr, fl.rho) : 0; // bomba de recirculación (todo a calor)
    const P_shaft = Psh_main + P_rs;
    const HP_av = p.HP_nom * s * HP;
    const L = P_shaft / HP_av;
    const Pm_rated = p.HP_nom * s * HP * (1 / p.eta_motor - 1);
    const P_m = Pm_rated * (p.k0 + (1 - p.k0) * L * L);
    // Corriente de línea con V/Hz constante
    const V_mot = p.V_nom * s;
    const I_mot = (P_shaft + P_m) / (Math.sqrt(3) * V_mot * p.FP);
    const I_nom = (p.HP_nom * HP / p.eta_motor) / (Math.sqrt(3) * p.V_nom * p.FP);

    // Balance de energía en el lazo (ver docs, sección 5)
    const r_m = p.recirc === 'orificio' && Qm > Q_EPS ? qr / Qm : 0;
    const Q_calor = r_m * P_p + P_v + P_m + P_rs;
    const dT_in = Q_calor / (C * qp + p.UA);                            // K
    const T_res = F2C(p.T_res);
    const T_in = T_res + dT_in;
    const T_dis = T_in + P_p / (C * Math.max(Qm, Q_EPS));
    let T_r = T_in;
    if (recOn) T_r = p.recirc === 'orificio' ? T_dis + P_v / (C * qr) : T_in + P_rs / (C * qr);

    // Geometría del anular del motor
    const Dout = (p.config === 'camisa' ? p.shroud_id : p.casing_id) * IN;
    const Dm = p.motor_od * IN;
    const A_ann = (Math.PI / 4) * (Dout * Dout - Dm * Dm);
    const Dh = Dout - Dm;
    const Lm = p.motor_len * FT;
    const A_mot = Math.PI * Dm * Lm;
    const q_nat = p.v_nat * FT * A_ann;  // intercambio equivalente por convección natural

    let Q_mot, T_mi, T_mo;
    if (p.config === 'sumidero') {
      Q_mot = recOn ? qr : 0;
      if (recOn) { T_mi = T_r; T_mo = T_r + P_m / (C * (qr + q_nat)); }
      else { T_mi = T_in; T_mo = T_in + P_m / (C * q_nat); }
    } else {
      Q_mot = qp + (recOn ? qr : 0);
      T_mo = T_in;
      T_mi = T_in - P_m / (C * (Q_mot + q_nat));
    }
    const v_mot = Q_mot / A_ann;
    const flm = props(p, C2F(T_mo));
    const qflux = P_m / A_mot;
    const film = filmCoefficient(flm, v_mot, Dh, Lm, qflux);
    const T_skin = T_mo + film.dT;
    const T_wind = T_skin + (p.dT_int / 1.8) * (P_m / Pm_rated);
    const vida_rel = Math.pow(2, (F2C(p.T_lim) - T_wind) / 10);

    // Constantes de tiempo para la dinámica visual
    const M_mot = p.kg_por_hp * p.HP_nom;
    const tau_mot = Math.min(Math.max((M_mot * 460) / (film.h * A_mot), 60), 6 * 3600);
    const V_pozo = (Math.PI / 4) * Math.pow(p.casing_id * IN, 2) * 100; // 100 m de pozo alrededor del equipo
    const tau_pozo = Math.min(Math.max((V_pozo * C + 2.0e6) / (C * qp + p.UA), 60), 24 * 3600);

    return {
      P_p_kW: P_p / 1e3, P_v_kW: P_v / 1e3, P_rs_kW: P_rs / 1e3, P_m_kW: P_m / 1e3,
      Psh_main_kW: Psh_main / 1e3, Phyd_main_kW: Phyd_main / 1e3, P_shaft_hp: P_shaft / HP,
      L, eta_pump: hy.main.eta(Qm), Q_calor_kW: Q_calor / 1e3,
      V_mot, I_mot, I_nom, P_elec_kW: (P_shaft + P_m) / 1e3,
      T_res_F: p.T_res, T_in_F: C2F(T_in), T_dis_F: C2F(T_dis), T_r_F: C2F(T_r),
      T_mi_F: C2F(T_mi), T_mo_F: C2F(T_mo), T_skin_F: C2F(T_skin), T_wind_F: C2F(T_wind),
      dT_in_F: dT_in * 1.8, v_motor_fts: v_mot / FT, v_motor_ms: v_mot,
      Q_mot_bpd: Q_mot / BPD, A_ann_in2: A_ann / (IN * IN), Dh_in: Dh / IN,
      h: film.h, hf: film.hf, hn: film.hn, Re: film.Re, Prandtl: film.Pr, Nu: film.Nu,
      regimen: film.regimen, qflux, dT_film_F: film.dT * 1.8,
      vida_rel, tau_mot, tau_pozo,
    };
  }

  // Barrido de un parámetro
  function sweep(base, key, values) {
    return values.map((v) => {
      const o = simulate(Object.assign({}, base, { [key]: v }));
      return { v, o };
    });
  }

  return { DEFAULTS, simulate, sweep, props, pump, hfun, makeIPR, rsStanding, pbStanding, units: { G, BPD, FT, IN, PSI, HP, F2C, C2F } };
});
