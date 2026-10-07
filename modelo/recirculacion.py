"""
Modelo de estado estacionario de un sistema BES (bombeo electrosumergible)
con recirculación de fluido para enfriamiento del motor.

Es la versión de referencia en Python del modelo de simulador/modelo.js.
Ambos implementan exactamente las mismas ecuaciones; la herramienta
herramientas/verificar_js_py.py comprueba que den los mismos resultados.

Unidades de entrada/salida: campo (bpd, ft, in, psi, °F, hp).
Unidades internas: SI.

Uso:
    from recirculacion import simular
    r = simular(config="sumidero", recirc="orificio", J=0.45)
    print(r["qp_bpd"], r["T_wind_F"])
"""
from __future__ import annotations

import math

# ---------- Constantes y conversiones ----------
G = 9.80665
BPD = 1.840130728e-6  # 1 bpd en m3/s
FT = 0.3048
IN = 0.0254
PSI = 6894.757
HP = 745.7
RUG = 4.6e-5          # rugosidad absoluta tubería de acero comercial [m]
Q_EPS = 0.5 * BPD     # caudal mínimo numérico


def f2c(t):
    return (t - 32) / 1.8


def c2f(t):
    return t * 1.8 + 32


DEFAULTS = dict(
    config="sumidero",      # 'sobre' | 'sumidero' | 'camisa'
    recirc="orificio",      # 'ninguna' | 'orificio' | 'dedicada'
    # Pozo
    D_perf=6000, D_bomba=6200, casing_id=6.276, tubing_id=2.992,
    motor_od=5.62, motor_len=20, shroud_id=6.0, P_wh=150,
    # Yacimiento
    Pr=2200, J=0.45, T_res=200, GOR=250, gamma_g=0.75,
    # Fluido
    API=22, WC=0.7, SG_w=1.05, WC_inv=0.5,
    # Bomba principal (curva por etapa a 60 Hz)
    N_etapas=180, Q_bep=1000, H0=40, eta_bep=0.65, freq=55,
    ROR_min=0.65, ROR_max=1.25, x_onset=0.6,
    # Motor
    HP_nom=90, eta_motor=0.86, k0=0.3, dT_int=40, T_lim=400, kg_por_hp=15,
    # Recirculación
    rec_id=1.0, rec_len=80, orif_d=0.18, Cd=0.61, K_menores=1.5,
    Nr_etapas=3, Qr_bep=700, H0r=40, eta_r=0.55,
    # Térmico / gas
    UA=100, v_nat=0.015, phi=0.3, v_b=0.5, GVF_lim=0.15, P_in_min=50, z=0.9,
)


# ---------- Propiedades de fluido ----------
def props(p, T_F):
    T = max(T_F, 60)
    SGo = 141.5 / (131.5 + p["API"])
    rho_o, rho_w = 999 * SGo, 999 * p["SG_w"]
    WC = p["WC"]
    rho = WC * rho_w + (1 - WC) * rho_o
    # Viscosidad de crudo muerto, Beggs & Robinson (1975) [cP]
    zz = 3.0324 - 0.02023 * p["API"]
    xx = 10 ** zz * T ** -1.163
    mu_o = 10 ** xx - 1
    # Viscosidad del agua, Brill & Beggs [cP]
    mu_w = math.exp(1.003 - 1.479e-2 * T + 1.982e-5 * T * T)
    # Emulsión (Brinkman): fase continua según punto de inversión
    if WC >= p["WC_inv"]:
        mu = mu_w * (1 - (1 - WC)) ** -2.5
    else:
        mu = mu_o * (1 - WC) ** -2.5
    xw = WC * rho_w / rho
    cp = xw * 4180 + (1 - xw) * 2000
    k = WC * 0.66 + (1 - WC) * 0.13
    beta = WC * 5.5e-4 + (1 - WC) * 7.0e-4
    return dict(rho=rho, mu=mu * 1e-3, mu_cP=mu, mu_o=mu_o, mu_w=mu_w,
                k=k, cp=cp, beta=beta, C=rho * cp)


# ---------- PVT de gas (Standing) ----------
def rs_standing(p, P_psia, T_F):
    P = max(P_psia, 14.7)
    rs = p["gamma_g"] * ((P / 18.2 + 1.4) * 10 ** (0.0125 * p["API"] - 0.00091 * T_F)) ** 1.2048
    return min(rs, p["GOR"])


def pb_standing(p, T_F):
    if p["GOR"] <= 0:
        return 14.7
    return 18.2 * ((p["GOR"] / p["gamma_g"]) ** 0.83 * 10 ** (0.00091 * T_F - 0.0125 * p["API"]) - 1.4)


# ---------- IPR: PI lineal sobre Pb, Vogel por debajo ----------
class IPR:
    def __init__(self, p):
        self.p = p
        self.Pb = min(p["Pr"], max(pb_standing(p, p["T_res"]), 14.7))
        self.qb = p["J"] * (p["Pr"] - self.Pb)
        self.qmax = self.qb + p["J"] * self.Pb / 1.8

    def q(self, Pwf):
        p = self.p
        if Pwf >= self.Pb:
            return p["J"] * (p["Pr"] - Pwf)
        r = Pwf / self.Pb
        return self.qb + p["J"] * self.Pb / 1.8 * (1 - 0.2 * r - 0.8 * r * r)

    def pwf(self, qq):
        if qq <= 0:
            return self.p["Pr"]
        if qq >= self.qmax:
            return 0.0
        lo, hi = 0.0, self.p["Pr"]
        for _ in range(60):
            m = 0.5 * (lo + hi)
            if self.q(m) > qq:
                lo = m
            else:
                hi = m
        return 0.5 * (lo + hi)


# ---------- Curva de bomba centrífuga (etapa normalizada) ----------
def hfun(x):
    """H/H0 en función de x = Q/Q_BEP. h(1)=0.70, h=0 en x≈1.90."""
    return 1 - 0.05 * x - 0.25 * x * x


class Bomba:
    def __init__(self, N, Qbep_bpd, H0_ft, eta_bep, f):
        s = f / 60
        self.Qb = Qbep_bpd * BPD * s
        self.H0 = N * H0_ft * FT * s * s
        self.eta_bep = eta_bep

    def x(self, Q):
        return Q / self.Qb

    def head(self, Q):
        return self.H0 * hfun(Q / self.Qb)

    def eta(self, Q):
        x = min(Q / self.Qb, 1.9)
        return self.eta_bep * max(x * (2 - x), 0)

    def power(self, Q, rho):
        x = min(max(Q / self.Qb, 0), 1.9)
        return max(rho * G * self.H0 * hfun(x) * self.Qb / (self.eta_bep * (2 - x)), 0)


# ---------- Fricción ----------
def darcy(Re, D):
    if Re < 1e-9:
        return 0.0
    if Re < 2300:
        return 64 / Re
    a = math.log10(RUG / (3.7 * D) + 5.74 / Re ** 0.9)
    return 0.25 / (a * a)


def dp_pipe(q, D, L, fl, Kmin=0.0):
    if q <= 0:
        return 0.0
    A = math.pi / 4 * D * D
    v = q / A
    Re = fl["rho"] * v * D / fl["mu"]
    return (darcy(Re, D) * L / D + Kmin) * 0.5 * fl["rho"] * v * v


def bisect(fn, lo, hi, it=60):
    flo = fn(lo)
    for _ in range(it):
        m = 0.5 * (lo + hi)
        fm = fn(m)
        if (fm > 0) == (flo > 0):
            lo, flo = m, fm
        else:
            hi = m
    return 0.5 * (lo + hi)


# ---------- Transferencia de calor en el anular del motor ----------
def coef_pelicula(fl, v, Dh, L, qflux):
    Re = fl["rho"] * abs(v) * Dh / fl["mu"]
    Pr = fl["mu"] * fl["cp"] / fl["k"]

    def gnielinski(re):
        f = (0.79 * math.log(re) - 1.64) ** -2
        return (f / 8) * (re - 1000) * Pr / (1 + 12.7 * math.sqrt(f / 8) * (Pr ** (2 / 3) - 1))

    def hausen(re):
        Gz = Dh * re * Pr / L
        return 3.66 + 0.0668 * Gz / (1 + 0.04 * Gz ** (2 / 3))

    if Re < 2300:
        Nu = hausen(Re)
    elif Re < 4000:
        w = (Re - 2300) / 1700
        Nu = (1 - w) * hausen(2300) + w * gnielinski(4000)
    else:
        Nu = gnielinski(Re)
    hf = Nu * fl["k"] / Dh
    # Convección natural turbulenta: Nu = 0.15 Ra^(1/3)
    nu = fl["mu"] / fl["rho"]
    alpha = fl["k"] / (fl["rho"] * fl["cp"])
    dT, h = 10.0, hf
    hn = 0.0
    for _ in range(40):
        hn = 0.15 * fl["k"] * ((G * fl["beta"] * max(dT, 1e-3)) / (nu * alpha)) ** (1 / 3)
        h = (hf ** 3 + hn ** 3) ** (1 / 3)
        dT = 0.5 * (dT + qflux / h)
    regimen = "laminar" if Re < 2300 else ("transición" if Re < 4000 else "turbulento")
    return dict(Re=Re, Pr=Pr, Nu=Nu, hf=hf, hn=hn, h=h, dT=qflux / h, regimen=regimen)


# ---------- Hidráulica ----------
def hidraulica(p, fl, ipr):
    f = p["freq"]
    main = Bomba(p["N_etapas"], p["Q_bep"], p["H0"], p["eta_bep"], f)
    recP = Bomba(p["Nr_etapas"], p["Qr_bep"], p["H0r"], p["eta_r"], f)
    D_tbg, L_tbg = p["tubing_id"] * IN, p["D_bomba"] * FT
    D_rec, L_rec = p["rec_id"] * IN, p["rec_len"] * FT
    A_or = math.pi / 4 * (p["orif_d"] * IN) ** 2
    rec_on = p["recirc"] != "ninguna"
    dz = (p["D_bomba"] - p["D_perf"]) * FT

    def dp_rec(qr):
        if qr <= 0:
            return 0.0
        return dp_pipe(qr, D_rec, L_rec, fl, p["K_menores"]) + 0.5 * fl["rho"] * (qr / (p["Cd"] * A_or)) ** 2

    def Pin(qp):
        return ipr.pwf(qp / BPD) * PSI + fl["rho"] * G * dz

    def Pdis(qp):
        return p["P_wh"] * PSI + fl["rho"] * G * L_tbg + dp_pipe(qp, D_tbg, L_tbg, fl)

    def qr_orificio(qp):
        if not rec_on:
            return 0.0
        hi = 1.9 * main.Qb - qp
        if hi <= 0:
            return 0.0
        g = lambda qr: fl["rho"] * G * main.head(qp + qr) - dp_rec(qr)
        if g(0) <= 0:
            return 0.0
        return bisect(g, 0, hi)

    qr_ded = 0.0
    if p["recirc"] == "dedicada":
        g = lambda qr: fl["rho"] * G * recP.head(qr) - dp_rec(qr)
        qr_ded = bisect(g, 0, 1.9 * recP.Qb) if g(0) > 0 else 0.0

    def qr_of(qp):
        if p["recirc"] == "orificio":
            return qr_orificio(qp)
        if p["recirc"] == "dedicada":
            return qr_ded
        return 0.0

    def Qmain(qp):
        return qp + qr_of(qp) if p["recirc"] == "orificio" else qp

    def F(qp):
        return fl["rho"] * G * main.head(Qmain(qp)) - (Pdis(qp) - Pin(qp))

    qmax = ipr.qmax * BPD
    PinMin = p["P_in_min"] * PSI
    if Pin(0) <= PinMin:
        qcap = 0.0
    elif Pin(qmax * 0.9999) >= PinMin:
        qcap = qmax * 0.9999
    else:
        qcap = bisect(lambda q: Pin(q) - PinMin, 0, qmax * 0.9999)

    if qcap <= 0 or F(0) <= 0:
        qp, estado = 0.0, "sin_produccion"
    elif F(qcap) >= 0:
        qp, estado = qcap, "pump_off"
    else:
        qp, estado = bisect(F, 0, qcap), "normal"

    qr = qr_of(qp)
    Qm = Qmain(qp)
    return dict(main=main, recP=recP, qp=qp, qr=qr, Qm=Qm, estado=estado,
                Pin=Pin(qp), Pdis=Pdis(qp), Pwf=ipr.pwf(qp / BPD),
                Hm=main.head(Qm), dpRec=dp_rec(qr), dpTbg=dp_pipe(qp, D_tbg, L_tbg, fl),
                A_or=A_or)


# ---------- Balance térmico ----------
def termico(p, fl, hy):
    C = fl["C"]
    s = p["freq"] / 60
    qp, qr, Qm = hy["qp"], hy["qr"], hy["Qm"]
    rec_on = p["recirc"] != "ninguna" and qr > Q_EPS

    Psh_main = hy["main"].power(Qm, fl["rho"])
    Phyd_main = fl["rho"] * G * hy["Hm"] * Qm
    P_p = max(Psh_main - Phyd_main, 0)
    P_v = hy["dpRec"] * qr if p["recirc"] == "orificio" else 0.0
    P_rs = hy["recP"].power(qr, fl["rho"]) if p["recirc"] == "dedicada" else 0.0
    P_shaft = Psh_main + P_rs
    HP_av = p["HP_nom"] * s * HP
    L = P_shaft / HP_av
    Pm_rated = p["HP_nom"] * s * HP * (1 / p["eta_motor"] - 1)
    P_m = Pm_rated * (p["k0"] + (1 - p["k0"]) * L * L)

    r_m = qr / Qm if (p["recirc"] == "orificio" and Qm > Q_EPS) else 0.0
    Q_calor = r_m * P_p + P_v + P_m + P_rs
    dT_in = Q_calor / (C * qp + p["UA"])
    T_res = f2c(p["T_res"])
    T_in = T_res + dT_in
    T_dis = T_in + P_p / (C * max(Qm, Q_EPS))
    T_r = T_in
    if rec_on:
        T_r = T_dis + P_v / (C * qr) if p["recirc"] == "orificio" else T_in + P_rs / (C * qr)

    Dout = (p["shroud_id"] if p["config"] == "camisa" else p["casing_id"]) * IN
    Dm = p["motor_od"] * IN
    A_ann = math.pi / 4 * (Dout * Dout - Dm * Dm)
    Dh = Dout - Dm
    Lm = p["motor_len"] * FT
    A_mot = math.pi * Dm * Lm
    q_nat = p["v_nat"] * FT * A_ann

    if p["config"] == "sumidero":
        Q_mot = qr if rec_on else 0.0
        if rec_on:
            T_mi = T_r
            T_mo = T_r + P_m / (C * (qr + q_nat))
        else:
            T_mi = T_in
            T_mo = T_in + P_m / (C * q_nat)
    else:
        Q_mot = qp + (qr if rec_on else 0.0)
        T_mo = T_in
        T_mi = T_in - P_m / (C * (Q_mot + q_nat))

    v_mot = Q_mot / A_ann
    flm = props(p, c2f(T_mo))
    qflux = P_m / A_mot
    film = coef_pelicula(flm, v_mot, Dh, Lm, qflux)
    T_skin = T_mo + film["dT"]
    T_wind = T_skin + p["dT_int"] / 1.8 * (P_m / Pm_rated)
    vida_rel = 2 ** ((f2c(p["T_lim"]) - T_wind) / 10)

    return dict(
        P_p_kW=P_p / 1e3, P_v_kW=P_v / 1e3, P_rs_kW=P_rs / 1e3, P_m_kW=P_m / 1e3,
        Psh_main_kW=Psh_main / 1e3, Phyd_main_kW=Phyd_main / 1e3, P_shaft_hp=P_shaft / HP,
        L=L, eta_pump=hy["main"].eta(Qm), Q_calor_kW=Q_calor / 1e3,
        T_res_F=p["T_res"], T_in_F=c2f(T_in), T_dis_F=c2f(T_dis), T_r_F=c2f(T_r),
        T_mi_F=c2f(T_mi), T_mo_F=c2f(T_mo), T_skin_F=c2f(T_skin), T_wind_F=c2f(T_wind),
        dT_in_F=dT_in * 1.8, v_motor_fts=v_mot / FT, v_motor_ms=v_mot,
        Q_mot_bpd=Q_mot / BPD, Re=film["Re"], Nu=film["Nu"], h=film["h"],
        hf=film["hf"], hn=film["hn"], regimen=film["regimen"], dT_film_F=film["dT"] * 1.8,
        vida_rel=vida_rel,
    )


# ---------- Modelo completo ----------
def simular(**kw):
    p = dict(DEFAULTS)
    p.update(kw)
    ipr = IPR(p)
    rec_on = p["recirc"] != "ninguna"

    T_props = p["T_res"]
    for _ in range(8):
        fl = props(p, T_props)
        hy = hidraulica(p, fl, ipr)
        th = termico(p, fl, hy)
        Tn = th["T_in_F"]
        if abs(Tn - T_props) < 0.05:
            T_props = Tn
            break
        T_props = 0.5 * (T_props + min(Tn, 700))

    Pin_psia = hy["Pin"] / PSI
    qp_bpd, qr_bpd = hy["qp"] / BPD, hy["qr"] / BPD
    qo = qp_bpd * (1 - p["WC"])
    Rs = rs_standing(p, Pin_psia, th["T_in_F"])
    libre_scf = max(p["GOR"] - Rs, 0) * qo
    Bg = 0.00504 * p["z"] * (th["T_in_F"] + 460) / max(Pin_psia, 14.7)
    qg_libre = libre_scf * Bg
    casA = math.pi / 4 * (p["casing_id"] ** 2 - p["motor_od"] ** 2) * IN * IN
    if p["config"] == "sobre":
        v_l = (hy["qp"] + hy["qr"]) / casA
    elif p["config"] == "sumidero":
        v_l = hy["qp"] / casA
    else:
        sOD = p["shroud_id"] + 0.5
        A = math.pi / 4 * max(p["casing_id"] ** 2 - sOD ** 2, 0.5) * IN * IN
        v_l = hy["qp"] / A
    vb = p["v_b"] * FT
    E_sep = vb / (vb + v_l)
    qg_in = qg_libre * (1 - E_sep)
    R = hy["qr"] / hy["qp"] if hy["qp"] > Q_EPS else 0.0
    qg_tot = qg_in * (1 + p["phi"] * R)
    GVF = qg_tot / (qg_tot + qp_bpd + qr_bpd) if qp_bpd > 0.5 else 0.0

    x = hy["main"].x(hy["Qm"])
    if hy["Qm"] < Q_EPS:
        zona = "cerrada"
    elif x < p["ROR_min"]:
        zona = "empuje_descendente"
    elif x > p["ROR_max"]:
        zona = "empuje_ascendente"
    else:
        zona = "rango"

    rho_lb = fl["rho"] * 0.062428
    v_or = hy["qr"] / (p["Cd"] * hy["A_or"]) / FT if (rec_on and hy["A_or"] > 0) else 0.0

    out = dict(
        Pb=ipr.Pb, qmax_bpd=ipr.qmax, qp_bpd=qp_bpd, qr_bpd=qr_bpd, Qm_bpd=hy["Qm"] / BPD, R=R,
        Pwf_psi=hy["Pwf"], Pin_psi=Pin_psia, Pdis_psi=hy["Pdis"] / PSI,
        TDH_ft=hy["Hm"] / FT, dpRec_psi=hy["dpRec"] / PSI, dpTbg_psi=hy["dpTbg"] / PSI,
        x=x, zona=zona, recInterna=max(0.0, (p["x_onset"] - x) / p["x_onset"]), estado=hy["estado"],
        GVF=GVF, E_sep=E_sep, qg_libre_bpd=qg_libre, Rs=Rs,
        v_or_fts=v_or, v_eros_fts=100 / math.sqrt(rho_lb),
        mu_cP=fl["mu_cP"], rho=fl["rho"],
    )
    out.update(th)
    return out


def barrido(clave, valores, **base):
    """Barre un parámetro y devuelve la lista de resultados."""
    return [simular(**{**base, clave: v}) for v in valores]


if __name__ == "__main__":
    for nombre, kw in [
        ("Sumidero sin recirculación", dict(recirc="ninguna")),
        ("Sumidero + orificio", dict()),
        ("Sumidero + bomba dedicada", dict(recirc="dedicada", orif_d=0.75)),
        ("Sobre perforados (convencional)", dict(config="sobre", D_bomba=5800, recirc="ninguna")),
    ]:
        r = simular(**kw)
        print(f"{nombre:34s} qp={r['qp_bpd']:6.0f} bpd  qr={r['qr_bpd']:5.0f} bpd  "
              f"v_motor={r['v_motor_fts']:4.2f} ft/s  T_adm={r['T_in_F']:5.1f} °F  "
              f"T_dev={r['T_wind_F']:5.1f} °F  GVF={r['GVF']*100:4.1f} %  zona={r['zona']}")
