"""
Verifica que el modelo JavaScript (simulador/modelo.js) y el de Python
(modelo/recirculacion.py) den los mismos resultados en un conjunto de casos.

    python3 herramientas/verificar_js_py.py
"""
import json
import os
import subprocess
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(RAIZ, "modelo"))
from recirculacion import simular  # noqa: E402

CASOS = [
    {},
    {"recirc": "ninguna"},
    {"recirc": "dedicada", "orif_d": 0.75},
    {"config": "sobre", "D_bomba": 5800, "recirc": "ninguna"},
    {"config": "sobre", "D_bomba": 5800},
    {"config": "camisa", "recirc": "ninguna"},
    {"API": 12, "WC": 0.2, "recirc": "dedicada", "orif_d": 0.75},
    {"J": 0.05},
    {"J": 0.15, "freq": 60},
    {"GOR": 600, "Pr": 1800},
    {"N_etapas": 60},
]
CLAVES = ["qp_bpd", "qr_bpd", "Pin_psi", "Pwf_psi", "x", "T_in_F", "T_dis_F", "T_r_F",
          "T_mo_F", "T_skin_F", "T_wind_F", "v_motor_fts", "GVF", "L", "P_m_kW", "P_p_kW", "P_v_kW"]

js = r"""
const M = require(process.argv[1]);
const casos = JSON.parse(process.argv[2]);
console.log(JSON.stringify(casos.map(c => { const o = M.simulate(c); const r = {};
  for (const k of %s) r[k] = o[k]; r.estado = o.estado; r.zona = o.zona; return r; })));
""" % json.dumps(CLAVES)

salida = subprocess.run(
    ["node", "-e", js, os.path.join(RAIZ, "simulador", "modelo.js"), json.dumps(CASOS)],
    capture_output=True, text=True, check=True,
).stdout
res_js = json.loads(salida)

fallos = 0
for caso, rj in zip(CASOS, res_js):
    rp = simular(**caso)
    for k in CLAVES:
        a, b = rp[k], rj[k]
        if abs(a - b) > 1e-6 * max(1.0, abs(a)):
            fallos += 1
            print(f"DIFERENCIA {caso} {k}: py={a} js={b}")
    for k in ("estado", "zona"):
        if rp[k] != rj[k]:
            fallos += 1
            print(f"DIFERENCIA {caso} {k}: py={rp[k]} js={rj[k]}")

print(f"{len(CASOS)} casos, {len(CLAVES) + 2} variables por caso, {fallos} diferencias")
sys.exit(1 if fallos else 0)
