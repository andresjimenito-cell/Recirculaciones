# Recirculaciones en pozos con BES

Investigación y simulación de los sistemas de recirculación usados en pozos con bombeo electrosumergible (BES/ESP): por qué se usan, qué fenómenos físicos intervienen (hidráulica acoplada, balance térmico del lazo, transferencia de calor en el motor, gas libre, recirculación interna de las etapas) y cómo afectan la producción, la temperatura del motor y la vida del equipo.

## Contenido

| Ruta | Qué es |
|---|---|
| `docs/investigacion_recirculaciones.md` | Documento técnico completo: ecuaciones, derivaciones, fenómenos, resultados y procedimiento de diseño |
| `simulador/index.html` | Simulador interactivo: pozo 3D en corte, recorrido guiado de 9 pasos, diagnóstico con recomendaciones, curva de la bomba, perfil térmico, tendencias y sensibilidad |
| `simulador/escena3d.js` | Escena 3D (Three.js r128): formación, cemento, revestimiento, cañoneo, bomba con etapas, sello, motor con estator y rotor, cable, línea de recirculación y flujo de partículas y gas |
| `simulador/modelo.js` | Modelo físico en JavaScript (lo usa el simulador; también corre en Node) |
| `simulador/vendor/` | Copia local de Three.js (licencia MIT) para usar el simulador sin internet |
| `modelo/recirculacion.py` | El mismo modelo en Python para cálculos de ingeniería |
| `modelo/estudio_sensibilidad.py` | Genera las figuras de `docs/img/` |
| `herramientas/verificar_js_py.py` | Verifica que el modelo JS y el de Python den resultados idénticos |

## Uso rápido

Simulador: abrir `simulador/index.html` en el navegador (no requiere servidor ni instalación; necesita WebGL). Arrastra para girar el pozo, rueda para acercar, clic en un componente para ver su explicación.

Modelo en Python (solo biblioteca estándar):

```bash
python3 modelo/recirculacion.py                 # comparación de configuraciones
python3 -c "import sys; sys.path.insert(0,'modelo'); from recirculacion import simular; \
r = simular(config='sumidero', recirc='dedicada', J=0.3); \
print(r['qp_bpd'], r['qr_bpd'], r['v_motor_fts'], r['T_wind_F'])"
```

Figuras (requiere `numpy` y `matplotlib`) y verificación cruzada (requiere `node`):

```bash
python3 modelo/estudio_sensibilidad.py
python3 herramientas/verificar_js_py.py
```

## Caso base

Pozo de baja tasa y alta RGA en revestimiento de 5-1/2 in, 17 lb/ft, con el equipo 150 ft bajo los perforados para separar gas. La holgura motor–revestimiento es de 0.196 in: no cabe una camisa y la línea de recirculación es un tubo aplanado. Es el tipo de pozo en que la industria usa recirculación (ver docs, secciones 3 y 10).

## Configuraciones que modela

- Posición del equipo: sobre los perforados (convencional), bajo los perforados (sumidero) o bajo los perforados con camisa.
- Recirculación: ninguna, derivación desde la descarga con orificio, o bomba de recirculación dedicada.

## Resultado principal

El balance de energía del lazo da, para todas las configuraciones:

```
T_admisión − T_yacimiento = (r·P_bomba + P_estrangulamiento + P_motor + P_bomba_recirc) / (ρ·cp·q_producido + UA)
```

La recirculación no evacua calor: lo redistribuye. Todo el calor sale con la producción o hacia la formación. La recirculación por orificio además consume capacidad de la bomba y convierte en calor toda la altura que le entrega al fluido recirculado; una bomba de recirculación dedicada refrigera el motor con una fracción mínima de esa potencia.

Modelo educativo y de pre-diseño: calibrar con datos de campo y curvas del fabricante antes de usarlo para decisiones.
