"""
Estudios de sensibilidad del modelo de recirculación.
Genera las figuras de docs/img/ que usa docs/investigacion_recirculaciones.md.

    python3 modelo/estudio_sensibilidad.py
"""
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from recirculacion import BPD, DEFAULTS, FT, IN, Bomba, coef_pelicula, props, simular  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(RAIZ, "docs", "img")
os.makedirs(IMG, exist_ok=True)

S1, S2, S3, S4 = "#2a78d6", "#eb6834", "#1baf7a", "#eda100"
CRIT, GOOD = "#d03b3b", "#0ca30c"
INK, INK2, MUTED, GRID = "#0b0b0b", "#52514e", "#898781", "#e1e0d9"

plt.rcParams.update({
    "figure.facecolor": "#fcfcfb", "axes.facecolor": "#fcfcfb",
    "axes.edgecolor": "#c3c2b7", "axes.labelcolor": INK2, "xtick.color": MUTED,
    "ytick.color": MUTED, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.spines.top": False, "axes.spines.right": False, "font.size": 9.5,
    "axes.titlesize": 10.5, "axes.titleweight": "bold", "lines.linewidth": 2,
    "legend.frameon": False,
})


def guardar(fig, nombre):
    fig.tight_layout()
    ruta = os.path.join(IMG, nombre)
    fig.savefig(ruta, dpi=150)
    plt.close(fig)
    print("  ", os.path.relpath(ruta, RAIZ))


# 1. Amplificación térmica: T_adm - T_res frente al índice de aporte -------------
def fig_aporte():
    J = np.linspace(0.04, 1.0, 50)
    casos = [("Sumidero + orificio", dict(), S1),
             ("Sumidero + bomba dedicada", dict(recirc="dedicada"), S2),
             ("Sobre perforados, sin recirculación", dict(config="sobre", D_bomba=6850, recirc="ninguna"), S3)]
    fig, ax = plt.subplots(1, 3, figsize=(12, 3.6))
    for nombre, kw, c in casos:
        r = [simular(J=j, **kw) for j in J]
        ax[0].plot(J, [x["qp_bpd"] for x in r], color=c, label=nombre)
        ax[1].plot(J, [x["T_in_F"] - x["T_res_F"] for x in r], color=c)
        ax[2].plot(J, [x["T_wind_F"] for x in r], color=c)
    ax[0].set(title="Producción a superficie", xlabel="Índice de productividad J [bpd/psi]", ylabel="q_p [bpd]")
    ax[1].set(title="Calentamiento en la admisión", xlabel="J [bpd/psi]", ylabel="T_adm − T_yac [°F]")
    ax[2].set(title="Temperatura de devanado", xlabel="J [bpd/psi]", ylabel="T_devanado [°F]")
    ax[2].axhline(400, color=CRIT, lw=1, ls="--")
    ax[2].text(0.98, 400, "límite aislamiento", color=CRIT, ha="right", va="bottom", fontsize=8)
    ax[0].legend(loc="upper left", fontsize=8)
    guardar(fig, "01_aporte_vs_temperatura.png")


# 2. Diámetro de orificio: el compromiso enfriamiento / producción -----------------
def fig_orificio():
    d = np.linspace(0.06, 0.30, 49)
    r = [simular(orif_d=x) for x in d]
    fig, ax = plt.subplots(1, 3, figsize=(12, 3.6))
    ax[0].plot(d, [x["qp_bpd"] for x in r], color=S1, label="q_p producción")
    ax[0].plot(d, [x["qr_bpd"] for x in r], color=S2, label="q_r recirculación")
    ax[0].set(title="Caudales", xlabel="Diámetro de orificio [in]", ylabel="bpd")
    ax[0].legend(fontsize=8)
    ax[1].plot(d, [x["v_motor_fts"] for x in r], color=S1)
    ax[1].axhline(1.0, color=CRIT, lw=1, ls="--")
    ax[1].text(0.06, 1.02, "1 ft/s mínimo", color=CRIT, fontsize=8, va="bottom")
    ax[1].set(title="Velocidad en el anular del motor", xlabel="Diámetro de orificio [in]", ylabel="ft/s")
    ax[2].plot(d, [x["x"] for x in r], color=S1)
    ax[2].axhspan(0.65, 1.25, color=GOOD, alpha=0.10)
    ax[2].text(0.07, 1.22, "rango recomendado", color="#006300", fontsize=8, va="top")
    ax[2].set(title="Punto de operación de la bomba", xlabel="Diámetro de orificio [in]", ylabel="Q/Q_BEP")
    guardar(fig, "02_orificio.png")


# 3. Curva de bomba con y sin recirculación -----------------------------------------
def fig_curva():
    base = simular(recirc="ninguna")
    rec = simular()
    b = Bomba(280, 700, 24, 0.65, 55)
    Q = np.linspace(0, 1.9 * b.Qb, 200)
    fig, ax = plt.subplots(1, 2, figsize=(10, 3.8))
    ax[0].plot(Q / BPD, [b.head(q) / FT for q in Q], color=S1, label="Curva H–Q de la sarta (55 Hz)")
    lo, hi = 0.65 * b.Qb / BPD, 1.25 * b.Qb / BPD
    ax[0].axvspan(lo, hi, color=GOOD, alpha=0.08)
    for r, c, et in [(base, S3, "Sin recirculación"), (rec, S2, "Con recirculación por orificio")]:
        ax[0].plot(r["Qm_bpd"], r["TDH_ft"], "o", ms=9, color=c, mec="#fcfcfb", mew=2, label=et)
    ax[0].set(title="Punto de operación", xlabel="Caudal por la bomba [bpd]", ylabel="Altura [ft]")
    ax[0].legend(fontsize=8, loc="lower left")
    eta = [b.eta(q) * 100 for q in Q]
    ax[1].plot(Q / BPD, eta, color=S1)
    ax[1].axvspan(lo, hi, color=GOOD, alpha=0.08)
    for r, c in [(base, S3), (rec, S2)]:
        ax[1].plot(r["Qm_bpd"], r["eta_pump"] * 100, "o", ms=9, color=c, mec="#fcfcfb", mew=2)
    ax[1].set(title="Eficiencia de la bomba", xlabel="Caudal por la bomba [bpd]", ylabel="η [%]")
    guardar(fig, "03_curva_bomba.png")


# 4. Coeficiente de película y calentamiento del motor vs velocidad ------------------
def fig_pelicula():
    v = np.linspace(0.05, 4, 120) * FT
    Dh = (4.892 - 4.50) * IN
    A_ann = np.pi / 4 * (4.892 ** 2 - 4.50 ** 2) * IN * IN
    A = np.pi * 4.50 * IN * 25 * FT
    P_m = 3000.0
    fig, ax = plt.subplots(1, 3, figsize=(13, 3.7))
    for (nombre, kw, T), c in zip([("Agua 90 %, 220 °F", dict(API=22, WC=0.9), 220),
                                   ("22 °API, 30 % agua, 220 °F", dict(API=22, WC=0.3), 220),
                                   ("14 °API, 10 % agua, 160 °F", dict(API=14, WC=0.1), 160),
                                   ("10 °API, 10 % agua, 140 °F", dict(API=10, WC=0.1), 140)], [S1, S2, S3, S4]):
        p = dict(DEFAULTS, **kw)
        fl = props(p, T)
        res = [coef_pelicula(fl, vv, Dh, 25 * FT, P_m / A) for vv in v]
        film = np.array([x["dT"] * 1.8 for x in res])
        bulk = P_m / (fl["C"] * v * A_ann) * 1.8
        ax[0].plot(v / FT, [x["h"] for x in res], color=c, label=f"{nombre} (μ={fl['mu_cP']:.1f} cP)")
        ax[1].plot(v / FT, film, color=c)
        ax[2].plot(v / FT, film + bulk, color=c)
    ax[0].set(title="Coeficiente de película h", xlabel="Velocidad en el anular [ft/s]", ylabel="h [W/m²K]")
    ax[0].set_yscale("log")
    ax[0].legend(fontsize=7.5)
    ax[1].set(title="Salto en la película", xlabel="Velocidad en el anular [ft/s]",
              ylabel="T_piel − T_fluido [°F]")
    ax[2].set(title="Piel del motor sobre fluido de entrada", xlabel="Velocidad en el anular [ft/s]",
              ylabel="ΔT película + ΔT de mezcla [°F]")
    ax[1].set_ylim(0, 120)
    ax[2].set_ylim(0, 200)
    for a in ax:
        a.axvline(1.0, color=CRIT, lw=1, ls="--")
    guardar(fig, "04_pelicula.png")


# 5. Comparación de configuraciones --------------------------------------------------
def fig_config():
    casos = [("Sobre\nperforados", dict(config="sobre", D_bomba=6850, recirc="ninguna")),
             ("Sumidero\nsin recirc.", dict(recirc="ninguna")),
             ("Camisa\n(motor 3.75)", dict(config="camisa", recirc="ninguna", motor_od=3.75, pump_od=3.38, motor_len=35)),
             ("Sumidero\n+ orificio", dict()),
             ("Sumidero\n+ dedicada", dict(recirc="dedicada"))]
    r = [simular(**kw) for _, kw in casos]
    et = [n for n, _ in casos]
    fig, ax = plt.subplots(1, 3, figsize=(13.5, 3.9))
    for a, k, t, u in [(ax[0], "qp_bpd", "Producción", "bpd"),
                       (ax[1], "T_wind_F", "Temperatura de devanado", "°F"),
                       (ax[2], "GVF", "Fracción de gas en la admisión", "%")]:
        vals = [x[k] * (100 if k == "GVF" else 1) for x in r]
        bars = a.bar(et, vals, color=S1, width=0.6)
        for b_, v in zip(bars, vals):
            a.text(b_.get_x() + b_.get_width() / 2, v, f"{v:.0f}", ha="center", va="bottom", fontsize=8, color=INK2)
        a.set(title=t, ylabel=u)
        a.tick_params(axis="x", labelsize=7.5)
        a.grid(axis="x", visible=False)
    ax[1].axhline(400, color=CRIT, lw=1, ls="--")
    ax[1].text(4.4, 400, "límite", color=CRIT, ha="right", va="bottom", fontsize=8)
    guardar(fig, "05_configuraciones.png")


if __name__ == "__main__":
    print("Generando figuras:")
    fig_aporte()
    fig_orificio()
    fig_curva()
    fig_pelicula()
    fig_config()
