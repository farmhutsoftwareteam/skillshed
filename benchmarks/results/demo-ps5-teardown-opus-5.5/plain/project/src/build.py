#!/usr/bin/env python3
"""Generate dist/index.html: an exploded / assembled technical illustration of the
PlayStation 5 disc edition (CFI-1000 series).

Model space (millimetres), console lying horizontally on its side:
  x: 0..390  long axis (the console's height when stood upright; x=390 is the top end)
  y: 0..260  depth (y=260 is the front face: disc slot, front USB, intake vents)
  z: 0..104  thickness (the stack axis; parts explode upward along +z)

Facts and their sources are recorded with each label. Anything not confirmed by
a cited public teardown or spec gets an "illustrative" flag in the drawing.
"""
import math
import html
import os

# --------------------------------------------------------------------------- projection
S = 0.92                      # px per mm
KUX, KUY = 0.92, -0.62        # screen u = KUX*x + KUY*y
KVX, KVY = 0.26, 0.36         # screen v = KVX*x + KVY*y - z
VIEW = (0.62, 0.92)           # xy part of the direction toward the viewer

W, H = 1920, 1500
INK = "#1c1d21"
AMBER = "#b4570f"
PAPER = "#f5f3ee"


class Layer:
    def __init__(self, lid, off):
        self.id, self.off, self.out = lid, off, []
        self.umin = self.vmin = 1e9
        self.umax = self.vmax = -1e9


CUR = None


def P(x, y, z):
    u = S * (KUX * x + KUY * y)
    v = S * (KVX * x + KVY * y - z)
    if CUR is not None:
        CUR.umin, CUR.umax = min(CUR.umin, u), max(CUR.umax, u)
        CUR.vmin, CUR.vmax = min(CUR.vmin, v), max(CUR.vmax, v)
    return u, v


def f(n):
    s = f"{n:.1f}"
    return s[:-2] if s.endswith(".0") else s


def d_of(pts):
    return "M" + "L".join(f"{f(u)},{f(v)}" for u, v in pts) + "Z"


def emit(s):
    CUR.out.append(s)


def hexrgb(c):
    c = c.lstrip("#")
    return [int(c[i:i + 2], 16) for i in (0, 2, 4)]


def mix(a, b, t):
    A, B = hexrgb(a), hexrgb(b)
    return "#" + "".join(f"{round(A[i] + (B[i] - A[i]) * t):02x}" for i in range(3))


# ------------------------------------------------------------------------ 2-D outlines
def rect(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def rrect(x0, y0, x1, y1, r, n=5):
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -90), (x1 - r, y1 - r, 0), (x0 + r, y1 - r, 90), (x0 + r, y0 + r, 180)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def ellipse(cx, cy, rx, ry=None, n=40, a0=0.0):
    ry = rx if ry is None else ry
    return [(cx + rx * math.cos(a0 + 2 * math.pi * i / n), cy + ry * math.sin(a0 + 2 * math.pi * i / n)) for i in range(n)]


def area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2


def ccw(pts):
    return pts if area(pts) > 0 else pts[::-1]


# ---------------------------------------------------------------------------- primitives
def flat(pts, z, fill, stroke=INK, sw=0.7, extra=""):
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ' stroke="none"'
    emit(f'<path d="{d_of([P(x, y, z) for x, y in pts])}" fill="{fill}"{st}{extra}/>')


def ring(outer, inner, z, fill, stroke=INK, sw=0.7):
    d = d_of([P(x, y, z) for x, y in outer]) + d_of([P(x, y, z) for x, y in inner[::-1]])
    emit(f'<path d="{d}" fill="{fill}" fill-rule="evenodd" stroke="{stroke}" stroke-width="{sw}"/>')


def line(pts3, stroke=INK, sw=0.7, dash=None, extra=""):
    da = f' stroke-dasharray="{dash}"' if dash else ""
    pts = [P(*p) for p in pts3]
    emit(f'<path d="M{"L".join(f"{f(u)},{f(v)}" for u, v in pts)}" fill="none" stroke="{stroke}" '
         f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round"{da}{extra}/>')


def side_quads(pts, z0, z1):
    """Visible vertical faces of an extruded outline, far-to-near."""
    pts = ccw(pts)
    faces = []
    for i in range(len(pts)):
        (ax, ay), (bx, by) = pts[i], pts[(i + 1) % len(pts)]
        nx, ny = by - ay, -(bx - ax)
        ln = math.hypot(nx, ny) or 1
        nx, ny = nx / ln, ny / ln
        if nx * VIEW[0] + ny * VIEW[1] <= 1e-6:
            continue
        depth = ((ax + bx) / 2) * VIEW[0] + ((ay + by) / 2) * VIEW[1]
        faces.append((depth, (ax, ay), (bx, by), nx, ny))
    faces.sort(key=lambda t: t[0])
    return faces


def prism(pts, z0, z1, top, sy, sx, stroke=INK, sw=0.8, smooth=False, top_extra=""):
    """Extrude a 2-D outline from z0 to z1. sy/sx shade faces facing +y / +x."""
    faces = side_quads(pts, z0, z1)
    for _, a, b, nx, ny in faces:
        wy, wx = max(0, ny), max(0, nx)
        col = mix(sx, sy, wy / (wx + wy + 1e-9))
        quad = [P(a[0], a[1], z0), P(b[0], b[1], z0), P(b[0], b[1], z1), P(a[0], a[1], z1)]
        if smooth:
            emit(f'<path d="{d_of(quad)}" fill="{col}" stroke="{col}" stroke-width="0.6"/>')
        else:
            emit(f'<path d="{d_of(quad)}" fill="{col}" stroke="{stroke}" stroke-width="{sw}" stroke-linejoin="round"/>')
    if smooth and faces:
        for _, a, b, *_ in faces:
            line([(a[0], a[1], z0), (b[0], b[1], z0)], stroke, sw)
        ends = sorted([p for _, a, b, *_ in faces for p in (a, b)], key=lambda p: KUX * p[0] + KUY * p[1])
        for p in (ends[0], ends[-1]):
            line([(p[0], p[1], z0), (p[0], p[1], z1)], stroke, sw)
    if top:
        flat(pts, z1, top, stroke, sw, top_extra)


def box(x0, y0, x1, y1, z0, z1, top, sy, sx, **kw):
    prism(rect(x0, y0, x1, y1), z0, z1, top, sy, sx, **kw)


def front_quad(x0, x1, z0, z1, y, fill, stroke=None, sw=0.5):
    flat_pts = [P(x0, y, z0), P(x1, y, z0), P(x1, y, z1), P(x0, y, z1)]
    st = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ' stroke="none"'
    emit(f'<path d="{d_of(flat_pts)}" fill="{fill}"{st}/>')


def screw(x, y, z, r=2.4, torx=False):
    flat(ellipse(x, y, r, n=16), z, "#d4d7db", INK, 0.5)
    if torx:
        star = []
        for i in range(12):
            rr = r * (0.75 if i % 2 == 0 else 0.4)
            a = math.pi * i / 6
            star.append((x + rr * math.cos(a), y + rr * math.sin(a)))
        flat(star, z, "#55595f", None)
    else:
        line([(x - r * .6, y, z), (x + r * .6, y, z)], "#55595f", 0.7)
        line([(x, y - r * .6, z), (x, y + r * .6, z)], "#55595f", 0.7)


def pipe(pts2, z, sw=5.2):
    pts3 = [(x, y, z) for x, y in pts2]
    line(pts3, "#6e3d1d", sw + 1.6)
    line(pts3, "#c47a45", sw)
    line(pts3, "#e9b58b", sw * 0.28, extra=' opacity="0.9"')


# ------------------------------------------------------------------------- label store
LABELS = []
SRC = {"S": "Sony", "iF": "iFixit", "PC": "PCPer"}


def label(layer, p, title, sub="", src=(), ill=None, mode="exp", side=None):
    LABELS.append(dict(layer=layer, p=p, title=title, sub=sub, src=src, ill=ill, mode=mode, side=side))


# ------------------------------------------------------------------------- geometry
def panel_outline():
    pts = [(8, 0), (384, 0), (390, 8), (390, 254)]
    # concave front edge (stylised Bezier) from (390,262) back to (0,252)
    p0, c, p1 = (390, 262), (205, 214), (0, 252)
    for i in range(0, 25):
        t = i / 24
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]
        pts.append((x, y))
    pts += [(0, 8)]
    return pts


PANEL = panel_outline()
CORE = rrect(10, 18, 380, 242, 10)
CORE_IN = rrect(14, 22, 376, 238, 7)
BOARD = [(126, 20), (376, 20), (376, 112), (250, 112), (250, 236), (126, 236)]
PLATE = [(126, 40), (376, 40), (376, 112), (250, 112), (250, 236), (126, 236)]
FAN_C, FAN_R = (314, 176), 60
DRIVE = (22, 92, 196, 234)
SOC = (196, 70)
M2X = (214, 238)

WHITE_T, WHITE_Y, WHITE_X = "#fbfbfc", "#e3e6ea", "#c9cdd3"
BLK_T, BLK_Y, BLK_X = "#26282d", "#34373d", "#1b1d21"
STEEL_T, STEEL_Y, STEEL_X = "#c3c7cd", "#a9aeb5", "#8d939b"
PCB_T, PCB_Y, PCB_X = "#2d5e50", "#24493e", "#1b3a31"
CHIP = "#16171a"

layers = []


def new_layer(lid, off):
    global CUR
    CUR = Layer(lid, off)
    layers.append(CUR)
    return CUR


# ---- stand -----------------------------------------------------------------------------
L = new_layer("stand", -150)
prism(ellipse(200, 92, 56, 50, n=48), -14, 0, "#2b2d32", "#3a3d43", "#1d1f23", smooth=True)
flat(ellipse(200, 92, 44, 39, n=48), 0, "#323439", "#45484e", 0.6)
prism(ellipse(200, 92, 7, n=6), 0, 3, "#b9bdc3", "#9ea3aa", "#80868e")
flat(ellipse(228, 112, 9, 7, n=24), 0, "#1b1c20", "#45484e", 0.6)
label(L, (178, 128, -7), "Base stand",
      "Fits vertical or horizontal use; the stand screw stows in a cubby in the base", ("iF",),
      "shape & mounting point drawn schematically")
label(L, (228, 112, 0), "Screw-storage cubby", "Holds the stand screw in horizontal mode", ("iF",),
      "position illustrative")

# ---- side cover, non-drive side ---------------------------------------------------------
L = new_layer("panel_b", 0)
prism(PANEL, 0, 8, "#eef0f3", WHITE_Y, WHITE_X)
flat(rrect(18, 26, 372, 236, 12), 8, "#e6e9ed", "#c9cdd3", 0.5)
for (x, y) in ((40, 14), (350, 14), (40, 240), (180, 240), (350, 228)):
    box(x - 7, y - 3, x + 7, y + 3, 8, 13, "#dfe2e6", "#cfd3d8", "#b8bdc4", sw=0.5)
label(L, (60, 250, 4), "Side cover — non-drive side",
      "White tool-less cover; both covers pop off by hand", ("iF", "S"), "silhouette simplified")
label(L, (180, 240, 13), "Cover clip hooks", "Snap the cover onto the black core", (),
      "count & positions illustrative")

# ---- lower core shell: floor + far inner walls (drawn behind the internals) -------------
L = new_layer("shell_l_a", 120)
flat(CORE_IN, 10, "#1a1c20", INK, 0.6)
emit(f'<path d="{d_of([P(14, 22, 10), P(376, 22, 10), P(376, 22, 56), P(14, 22, 56)])}" fill="#2e3137" stroke="{INK}" stroke-width="0.5"/>')
emit(f'<path d="{d_of([P(14, 22, 10), P(14, 238, 10), P(14, 238, 56), P(14, 22, 56)])}" fill="#25282d" stroke="{INK}" stroke-width="0.5"/>')
for x in range(150, 371, 12):          # rear exhaust slots seen from inside
    line([(x, 22, 18), (x, 22, 48)], "#111214", 2.2)

# ---- heat sink + PSU --------------------------------------------------------------------
L = new_layer("heat", 290)
PSU = [(18, 22), (124, 22), (124, 150), (100, 150), (100, 234), (18, 234)]
prism(PSU, 24, 62, "#3d4147", "#30333a", "#24272c")
for i in range(9):
    for j in range(10):
        flat(ellipse(32 + i * 9.6, 34 + j * 10.5, 1.8, n=10), 62, "#17181b", None)
flat(rect(30, 162, 88, 222), 62, "#e9e6dc", "#9b978c", 0.5)
for k in range(5):
    line([(36, 170 + k * 10, 62), (82 - (k % 2) * 16, 170 + k * 10, 62)], "#9b978c", 1.1)

# heat sink: base, rear fin stack, front fin stack, contact plate, pipes
prism(rect(140, 28, 262, 150), 32, 50, "#cdd0d5", "#b5b9bf", "#9ca1a8")
prism(rect(262, 24, 376, 114), 24, 58, "#e1e4e8", "#c3c7cd", "#a5abb2")
for k in range(39):
    x = 264.5 + k * 2.9
    line([(x, 24, 58), (x, 114, 58)], "#9aa0a8", 0.45)
for k in range(13):
    x = 264.5 + k * 8.7
    line([(x, 114, 24), (x, 114, 58)], "#9aa0a8", 0.45)
prism(rect(140, 160, 250, 236), 24, 50, "#e1e4e8", "#c3c7cd", "#a5abb2")
for k in range(37):
    x = 142.5 + k * 2.95
    line([(x, 160, 50), (x, 236, 50)], "#9aa0a8", 0.45)
for k in range(12):
    x = 142.5 + k * 9.0
    line([(x, 236, 24), (x, 236, 50)], "#9aa0a8", 0.45)
prism(rect(170, 44, 222, 96), 50, 56.5, "#c47a45", "#a9653a", "#8c522e")
for y in (52, 62, 78, 88):
    pipe([(176, y), (372, y)], 58.6)
for x in (184, 206):
    pipe([(x, 96), (x, 120), (x, 160), (x, 232)], 50.8)
label(L, (60, 200, 62), "Power supply unit",
      "Delta-made, 350 W rated, enclosed; last part out. Measured ≈200 W at full load",
      ("iF", "S"), "‘boot-shaped’ outline approximated")
label(L, (300, 100, 58), "Heat sink — main fin stack",
      "Very large heat sink; Sony: cooling equal to a vapour chamber", ("S", "iF"),
      "fin-stack split & placement illustrative")
label(L, (245, 236, 37), "Heat sink — secondary fin stack", "Aluminium fins in the fan airflow", (),
      "existence & placement illustrative")
label(L, (330, 78, 58.6), "Copper heat pipes", "Copper heat pipes, no vapour chamber", ("iF",),
      "pipe count & routing illustrative")
label(L, (220, 96, 53), "SoC contact plate", "Heat-sink base that meets the SoC", (),
      "size & finish illustrative")

# ---- liquid metal TIM -------------------------------------------------------------------
L = new_layer("tim", 360)
prism(rrect(168, 42, 224, 98, 5), 56.5, 58, "#4a4d52", "#3c3f44", "#2f3236")
flat(rrect(178, 51, 214, 89, 3), 58, "url(#lm)", "#7d838b", 0.6)
label(L, (214, 72, 58), "Liquid-metal TIM",
      "Liquid-metal thermal interface between the SoC and the heat sink", ("S", "iF"))
label(L, (168, 90, 57), "Liquid-metal seal / barrier",
      "iFixit cites a Sony patent describing an insulated, foam-cushioned pouch", ("iF",),
      "seal shape & material drawn from patent description")

# ---- main board (back side up) -----------------------------------------------------------
L = new_layer("board", 430)
prism(BOARD, 58, 60, PCB_T, PCB_Y, PCB_X)
for (x, y) in ((132, 26), (370, 26), (370, 106), (244, 230), (132, 230), (244, 116)):
    flat(ellipse(x, y, 3, n=14), 60, "#d8c27a", "#8a7a40", 0.4)
    flat(ellipse(x, y, 1.4, n=10), 60, "#111", None)
# rear I/O connectors along the back edge
box(266, 20, 286, 32, 60, 67, "#b3b8bf", "#9aa0a8", "#80868e", sw=0.5)
box(292, 20, 310, 37, 60, 73, "#b3b8bf", "#9aa0a8", "#80868e", sw=0.5)
box(316, 20, 330, 35, 60, 66, "#b3b8bf", "#9aa0a8", "#80868e", sw=0.5)
box(336, 20, 350, 35, 60, 66, "#b3b8bf", "#9aa0a8", "#80868e", sw=0.5)
box(292, 42, 310, 53, 60, 64, CHIP, "#2a2c30", "#0e0f11", sw=0.5)          # LAN magnetics
box(318, 48, 350, 80, 60, 62.6, "#bfc4ca", "#a3a9b0", "#8a9098", sw=0.5)  # Wi-Fi can
flat(rect(322, 52, 340, 64), 62.6, "#e9e6dc", None)
flat(ellipse(344, 74, 2.4, n=12), 62.6, "#d8c27a", INK, 0.4)
line([(344, 74, 63), (356, 92, 63), (372, 100, 63), (384, 104, 66)], "#111214", 1.3)
box(128, 60, 140, 96, 60, 70, "#ebe8e0", "#d7d3c8", "#bdb8ab", sw=0.5)       # power prong
for i, x in enumerate((141, 161, 181)):                                     # NAND ×3
    box(x, 118, x + 16, 138, 60, 61.4, CHIP, "#2a2c30", "#0e0f11", sw=0.5)
    flat(ellipse(x + 3, 121, 1, n=8), 61.4, "#55595f", None)
flat(ellipse(160, 170, 9, n=30), 60, "#d3d6da", INK, 0.5)                  # backup battery
flat(ellipse(160, 170, 6.5, n=30), 60, "#c4c7cc", "#9aa0a8", 0.4)
prism(ellipse(190, 172, 6, n=24), 60, 63, "#2a2c30", "#3a3d43", "#1b1d21", smooth=True)  # buzzer
flat(ellipse(190, 172, 1.4, n=10), 63, "#000", None)
for i in range(6):                                                          # VRM row
    x = 137 + i * 11
    box(x, 190, x + 8, 198, 60, 62.5, "#3a3d43", "#4a4e55", "#26292d", sw=0.4)
box(160, 212, 206, 234, 60, 70, "#e1e4e8", "#c3c7cd", "#a5abb2", sw=0.5)    # VRM fin stack
for k in range(15):
    line([(161.5 + k * 3, 212, 70), (161.5 + k * 3, 234, 70)], "#9aa0a8", 0.4)
pipe([(134, 204), (200, 204), (200, 222)], 63.5, sw=4)
# M.2 slot: connector + standoff positions for 2230/2242/2260/2280/22110
box(M2X[0] - 2, 218, M2X[1] + 2, 226, 60, 64, CHIP, "#2a2c30", "#0e0f11", sw=0.5)
for L_ in (30, 42, 60, 80, 110):
    flat(ellipse(226, 222 - L_, 2.6, n=14), 60, "#d8c27a", "#8a7a40", 0.4)
flat(rect(M2X[0], 112, M2X[1], 218), 60, "none", "#9fc7b9", 0.6, ' stroke-dasharray="3 2"')
label(L, (130, 230, 59), "Main board — back side shown",
      "SoC side faces down onto the heat sink (see inset)", ("iF",))
label(L, (226, 150, 60), "M.2 expansion slot",
      "PCIe Gen 4 NVMe; 2230 / 2242 / 2260 / 2280 / 22110 lengths", ("S", "iF"), "slot position illustrative")
label(L, (161, 128, 61.4), "NAND flash ×3 (of 6)",
      "Kioxia TH58LJT0T24BA4M, ‘likely’; three per board side → 825 GB SSD", ("iF", "PC"),
      "positions illustrative")
label(L, (183, 223, 70), "VRM heat pipe + small fin stack",
      "Cools a row of VRMs on the board back", ("iF",), "geometry illustrative")
label(L, (334, 64, 62.6), "Wi-Fi module — Sony J20H100", "Wi-Fi 6, with antenna connector", ("iF", "PC"),
      "position illustrative")
label(L, (372, 100, 63), "Wi-Fi antenna lead", "", (), "routing & antenna location illustrative")
label(L, (301, 48, 64), "Ethernet magnetics — Bothhand GST5009", "1000BASE-T", ("iF",), "position illustrative")
label(L, (160, 170, 60), "3 V backup battery", "", ("iF",), "position illustrative")
label(L, (190, 172, 63), "Piezo buzzer — Murata", "", ("iF",), "position illustrative")
label(L, (134, 78, 70), "Power input prong", "Takes power from the PSU", ("iF",), "position illustrative")
label(L, (318, 28, 67), "Rear I/O connectors",
      "HDMI 2.1 · LAN · 2× USB-A 10 Gbps", ("iF", "PC"), "connector order illustrative")

# ---- steel shield plate ------------------------------------------------------------------
L = new_layer("plate", 550)
prism(PLATE, 62, 63.5, STEEL_T, STEEL_Y, STEEL_X)
flat(rrect(210, 106, 242, 230, 3), 63.5, "#2b2d31", INK, 0.5)     # M.2 window
flat(rrect(156, 208, 208, 236, 2), 63.5, "#2b2d31", INK, 0.5)     # VRM fin-stack window
flat(rrect(126, 56, 142, 100, 2), 63.5, "#2b2d31", INK, 0.5)      # power prong window
for r_ in (rrect(150, 50, 200, 104, 6), rrect(260, 56, 366, 104, 6), rrect(150, 130, 200, 196, 6)):
    flat(r_, 63.5, "none", "#e7eaee", 1.0)
    flat([(x + 1.2, y + 1.2) for x, y in r_], 63.5, "none", "#8d939b", 0.6)
for (x, y) in ((132, 46), (204, 46), (282, 46), (370, 46), (370, 106), (254, 106), (246, 150),
               (246, 200), (246, 232), (132, 232), (132, 150), (215, 120), (130, 108), (310, 108)):
    screw(x, y, 63.5, 2.2)
label(L, (320, 80, 63.5), "Steel shield plate",
      "Held by many screws; covers the back of the main board", ("iF",), "screw count & cut-outs illustrative")

# ---- fan + optical drive -----------------------------------------------------------------
L = new_layer("fandrive", 670)
x0, y0, x1, y1 = DRIVE
box(x0, y0, x1, y1, 64, 88, "#b7bcc3", "#a1a7ae", "#868c94")
flat(rrect(x0 + 8, y0 + 8, x1 - 8, y1 - 8, 6), 88, "#bfc4ca", "#8d939b", 0.6)
flat(ellipse(109, 163, 60, n=64), 88, "none", "#7f858d", 0.7, ' stroke-dasharray="4 3"')
flat(ellipse(109, 163, 9, n=24), 88, "#a3a9b0", "#6d737b", 0.6)
for (x, y) in ((x0 + 5, y0 + 5), (x1 - 5, y0 + 5), (x0 + 5, y1 - 5), (x1 - 5, y1 - 5)):
    screw(x, y, 88, 2.0)
front_quad(x0 + 6, x1 - 6, 70, 82, y1, "#2a2c30", INK, 0.5)
front_quad(x0 + 14, x1 - 14, 75, 77, y1, "#0b0c0e")
emit(f'<path d="{d_of([P(146, 92, 88), P(166, 92, 88), P(166, 76, 64), P(146, 76, 64)])}" fill="#c98a3a" stroke="#7a4f1c" stroke-width="0.5"/>')
# fan
fx, fy = FAN_C
for a in (135, 315):
    ax, ay = fx + 66 * math.cos(math.radians(a)), fy + 66 * math.sin(math.radians(a))
    prism(ellipse(ax, ay, 7, n=16), 90, 94, "#2b2e33", "#3a3d43", "#1b1d21", smooth=True)
prism(ellipse(fx, fy, FAN_R, n=72), 50, 94, None, "#3d4046", "#25282d", smooth=True)
for k in range(72):
    a = 2 * math.pi * k / 72
    cx_, cy_ = fx + FAN_R * math.cos(a), fy + FAN_R * math.sin(a)
    if math.cos(a) * VIEW[0] + math.sin(a) * VIEW[1] > 0.05:
        line([(cx_, cy_, 51), (cx_, cy_, 93)], "#1a1c20", 0.5)
flat(ellipse(fx, fy, FAN_R, n=72), 94, "#111214", INK, 0.8)
for k in range(44):
    a = 2 * math.pi * k / 44
    blade = [(fx + 31 * math.cos(a), fy + 31 * math.sin(a)),
             (fx + 57 * math.cos(a + 0.28), fy + 57 * math.sin(a + 0.28)),
             (fx + 57 * math.cos(a + 0.33), fy + 57 * math.sin(a + 0.33)),
             (fx + 31 * math.cos(a + 0.07), fy + 31 * math.sin(a + 0.07))]
    flat(blade, 94, "#4b4f56", None)
flat(ellipse(fx, fy, 29, n=48), 94, "#2d3036", INK, 0.6)
flat(ellipse(fx, fy, 13, n=36), 94, "#5a5e65", INK, 0.5)
for a in (135, 315):
    ax, ay = fx + 66 * math.cos(math.radians(a)), fy + 66 * math.sin(math.radians(a))
    screw(ax, ay, 94, 2.8, torx=True)
label(L, (60, 234, 80), "Ultra HD Blu-ray drive",
      "Slides out after cover removal; paired to the main board, so a swapped drive won’t read discs",
      ("iF", "S"))
label(L, (156, 84, 76), "Drive cable to main board", "", (), "routing illustrative")
label(L, (fx + 40, fy + 40, 72), "Cooling fan",
      "120 mm dia. × 45 mm thick centrifugal fan, draws air in from both sides", ("S", "iF"))
label(L, (fx + 47, fy - 47, 94), "Fan screws — T8 Torx security", "", ("iF",), "count & positions illustrative")

# ---- lower core shell: outer faces + rim + front details (drawn in front of internals) --
L = new_layer("shell_l_b", 120)
prism(CORE, 8, 56, None, BLK_Y, BLK_X)
ring(CORE, CORE_IN, 56, BLK_T, INK, 0.7)
front_quad(36, 45, 29.5, 34, 242, "#0a0b0c", "#55595f", 0.4)        # USB-C
front_quad(54, 68, 28.5, 35, 242, "#0a0b0c", "#55595f", 0.4)        # USB-A
front_quad(57, 65, 31.6, 33, 242, "#3d6fb5")
front_quad(88, 116, 44, 46.5, 242, "#4a4e55", "#0a0b0c", 0.4)       # power button
front_quad(88, 116, 17, 19.5, 242, "#4a4e55", "#0a0b0c", 0.4)       # eject button
for k in range(10):
    x = 262 + k * 11
    front_quad(x, x + 4, 14, 52, 242, "#0c0d0f")
label(L, (40, 242, 31.7), "Front USB Type-C", "SuperSpeed 10 Gbps", ("PC", "S"), "position on front illustrative")
label(L, (61, 242, 31.5), "Front USB Type-A", "Hi-Speed (not 10 Gbps)", ("PC", "S"), "position on front illustrative")
label(L, (102, 242, 45), "Power & eject buttons", "", ("S",), "positions illustrative")
label(L, (330, 242, 30), "Front intake vents (lower)", "", ("S",), "slit pattern illustrative")
label(L, (24, 230, 56), "Black core shell — lower section",
      "Structural black shell between the two white covers", (), "two-piece split is a simplification")

# ---- upper core shell ---------------------------------------------------------------------
L = new_layer("shell_u", 815)
prism(CORE, 56, 96, BLK_T, BLK_Y, BLK_X)
flat(ellipse(fx, fy, 58, n=72), 96, "#0b0c0e", INK, 0.7)
for r_ in (20, 31, 42, 53):
    flat(ellipse(fx, fy, r_, n=72), 96, "none", "#4a4d53", 1.1)
for k in range(8):
    a = math.pi * k / 4 + 0.2
    line([(fx + 13 * math.cos(a), fy + 13 * math.sin(a), 96), (fx + 58 * math.cos(a), fy + 58 * math.sin(a), 96)], "#4a4d53", 1.1)
flat(ellipse(fx, fy, 13, n=36), 96, "#2c2e33", "#4a4d53", 0.8)
for (x, y) in ((244, 228), (244, 206)):
    flat(ellipse(x, y, 7, n=24), 96, "#3a3d43", INK, 0.6)
    flat(ellipse(x, y, 4.6, n=24), 96, "#050506", None)
flat(rrect(DRIVE[0], DRIVE[1], DRIVE[2], DRIVE[3], 6), 96, "#141518", INK, 0.6)
flat(rrect(DRIVE[0] + 3, DRIVE[1] + 3, DRIVE[2] - 3, DRIVE[3] - 3, 5), 96, "none", "#3a3d43", 0.6)
prism(rrect(206, 102, 236, 232, 4), 96, 97.6, "#a3a9b0", "#8d939b", "#757b83")
screw(221, 110, 97.6, 2.6)
for k in range(10):
    x = 262 + k * 11
    front_quad(x, x + 4, 60, 92, 242, "#0c0d0f")
front_quad(34, 184, 74, 77.5, 242, "#060607", "#55595f", 0.4)        # disc slot
label(L, (40, 230, 96), "Black core shell — upper section", "", (), "two-piece split is a simplification")
label(L, (fx - 30, fy + 40, 96), "Fan intake opening", "Fan pulls air from both faces of the console", ("S", "iF"))
label(L, (244, 217, 96), "Dust catchers ×2", "Holes for vacuuming out collected dust", ("S", "iF"),
      "positions illustrative")
label(L, (221, 180, 97.6), "M.2 bay cover", "Metal shield held by one Phillips screw", ("iF",), "position illustrative")
label(L, (90, 120, 96), "Drive bay opening", "Drive comes out once the cover is off", ("iF",), "opening outline illustrative")
label(L, (110, 242, 75.5), "Disc slot", "", ("S",), "position illustrative")
label(L, (330, 242, 76), "Front intake vents (upper)", "", ("S",), "slit pattern illustrative")

# ---- side cover, drive side --------------------------------------------------------------
L = new_layer("panel_t", 930)
prism(PANEL, 96, 104, "url(#panel)", WHITE_Y, WHITE_X)
prism(ellipse(109, 163, 82, 66, n=72), 104, 108, "url(#bulge)", "#eceef1", "#d3d7dc", smooth=True, sw=0.6, stroke="#aab0b8")
label(L, (300, 30, 104), "Side cover — drive side",
      "Tool-less white cover; lifts off to reach the fan intake, M.2 bay and dust catchers", ("iF", "S"),
      "silhouette simplified")
label(L, (109, 200, 108), "Disc-drive bulge", "Clearance for the optical drive", (), "shape approximate")

# ------------------------------------------------------------------------ assembled labels
ASM = []


def alabel(p, title, sub="", src=(), ill=None, side=None):
    ASM.append(dict(layer=None, p=p, title=title, sub=sub, src=src, ill=ill, mode="asm", side=side))


alabel((300, 40, 104), "Side cover (white, ×2)", "Tool-less; outer covers lift off by hand", ("iF",), "silhouette simplified", "right")
alabel((109, 175, 108), "Disc-drive bulge", "", (), "shape approximate", "left")
alabel((20, 242, 60), "Black core", "", (), None, "left")
alabel((110, 242, 75.5), "Disc slot", "", ("S",), "position illustrative", "left")
alabel((40, 242, 31.7), "USB Type-C (front)", "SuperSpeed 10 Gbps", ("PC", "S"), "position illustrative", "left")
alabel((61, 242, 31.5), "USB Type-A (front)", "Hi-Speed", ("PC", "S"), "position illustrative", "left")
alabel((102, 242, 45), "Power & eject buttons", "", ("S",), "positions illustrative", "left")
alabel((330, 242, 60), "Front intake vents", "", ("S",), "slit pattern illustrative", "right")
alabel((380, 130, 60), "Rear exhaust + rear I/O", "On the hidden back face; see the rear I/O inset", ("iF",), None, "right")

# ----------------------------------------------------------------------- layout & output
DRAW_X0, DRAW_X1, DRAW_Y0, DRAW_Y1 = 40, 1340, 112, 1398
EXP_CX = 690


def bounds(asm):
    us, vs = [], []
    for l in layers:
        dv = 0 if asm else -S * l.off
        us += [l.umin, l.umax]
        vs += [l.vmin + dv, l.vmax + dv]
    return min(us), max(us), min(vs), max(vs)


eu0, eu1, ev0, ev1 = bounds(False)
OX = EXP_CX - (eu0 + eu1) / 2
OY = (DRAW_Y0 + 8 + DRAW_Y1 - 6) / 2 - (ev0 + ev1) / 2

au0, au1, av0, av1 = bounds(True)
ZOOM = 1.72
ACX, ACY = 690, 720
TX = ACX - ZOOM * (OX + (au0 + au1) / 2)
TY = ACY - ZOOM * (OY + (av0 + av1) / 2)


def screen(p, off, asm):
    global CUR
    saved, CUR = CUR, None
    u, v = P(*p)
    CUR = saved
    if asm:
        return TX + ZOOM * (OX + u), TY + ZOOM * (OY + v)
    return OX + u, OY + v - S * off


def wrap(text, n):
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        if len(cur) + len(w_) + 1 > n and cur:
            lines.append(cur)
            cur = w_
        else:
            cur = (cur + " " + w_).strip()
    if cur:
        lines.append(cur)
    return lines


def place(items, asm, lx, rx, chars):
    for it in items:
        off = it["layer"].off if it["layer"] else 0
        it["a"] = screen(it["p"], off, asm)
        it["lines"] = wrap(it["sub"], chars) if it["sub"] else []
        it["ill_lines"] = wrap("◇ ILLUSTRATIVE — " + it["ill"], chars) if it["ill"] else []
        it["h"] = 15 + 13 * len(it["lines"]) + 12.5 * len(it["ill_lines"])
    cx = (DRAW_X0 + DRAW_X1) / 2 if asm else EXP_CX
    for it in items:
        if not it["side"]:
            it["side"] = "left" if it["a"][0] < cx else "right"
    # balance the two columns by total height
    def tot(s): return sum(i["h"] for i in items if i["side"] == s)
    for _ in range(40):
        lft, rgt = tot("left"), tot("right")
        if abs(lft - rgt) < 80:
            break
        src, dst = ("left", "right") if lft > rgt else ("right", "left")
        cand = [i for i in items if i["side"] == src and not i.get("fixed")]
        if not cand:
            break
        mv = min(cand, key=lambda i: abs(i["a"][0] - cx))
        mv["side"] = dst
        mv["fixed"] = True
    for side in ("left", "right"):
        col = sorted([i for i in items if i["side"] == side], key=lambda i: i["a"][1])
        if not col:
            continue
        tx = lx if side == "left" else rx
        elbow = tx + 22 if side == "left" else tx - 22
        for i in col:
            i["tx"] = tx
        stack(col)
        # swap neighbours whose leaders cross until the column is untangled
        for _ in range(200):
            changed = False
            for k in range(len(col) - 1):
                a, b = col[k], col[k + 1]
                if crosses(a, b, elbow):
                    col[k], col[k + 1] = b, a
                    stack(col)
                    if crosses(col[k], col[k + 1], elbow):
                        col[k], col[k + 1] = a, b
                        stack(col)
                    else:
                        changed = True
            if not changed:
                break


def stack(col, gap=7):
    top, bot = DRAW_Y0 + 10, DRAW_Y1
    y = top
    for i in col:
        i["ty"] = max(i["a"][1] - 4, y)
        y = i["ty"] + i["h"] + gap
    y = bot
    for i in reversed(col):
        i["ty"] = min(i["ty"], y - i["h"])
        y = i["ty"] - gap


def crosses(a, b, ex):
    """True if the anchor→elbow segments of two labels intersect."""
    def seg(i): return (i["a"][0], i["a"][1]), (ex, i["ty"])
    (p1, p2), (p3, p4) = seg(a), seg(b)
    def orient(p, q, r): return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    d1, d2 = orient(p3, p4, p1), orient(p3, p4, p2)
    d3, d4 = orient(p1, p2, p3), orient(p1, p2, p4)
    return d1 * d2 < 0 and d3 * d4 < 0


def render_labels(items, cls):
    out = [f'<g class="{cls}">']
    for it in items:
        ax, ay = it["a"]
        ill = bool(it["ill"])
        left = it["side"] == "left"
        tx, ty = it["tx"], it["ty"] + 4
        elbow = tx + 22 if left else tx - 22
        end = tx + 5 if left else tx - 5
        anchor = "end" if left else "start"
        dash = ' stroke-dasharray="4 3"' if ill else ""
        lc = AMBER if ill else INK
        out.append(f'<g class="lbl{" ill" if ill else ""}">')
        out.append(f'<path d="M{f(ax)},{f(ay)}L{f(elbow)},{f(ty - 4)}L{f(end)},{f(ty - 4)}" fill="none" stroke="{lc}" stroke-width="0.8"{dash}/>')
        if ill:
            out.append(f'<circle cx="{f(ax)}" cy="{f(ay)}" r="2.8" fill="#fff" stroke="{AMBER}" stroke-width="1.2"/>')
        else:
            out.append(f'<circle cx="{f(ax)}" cy="{f(ay)}" r="2.6" fill="{INK}" stroke="#fff" stroke-width="0.8"/>')
        srcs = " ".join(f"[{s}]" for s in it["src"])
        st = f'<tspan class="src"> {srcs}</tspan>' if srcs else ""
        out.append(f'<text x="{f(tx)}" y="{f(ty)}" text-anchor="{anchor}" class="lt">{html.escape(it["title"])}{st}</text>')
        yy = ty
        for ln in it["lines"]:
            yy += 13
            out.append(f'<text x="{f(tx)}" y="{f(yy)}" text-anchor="{anchor}" class="ls">{html.escape(ln)}</text>')
        for ln in it["ill_lines"]:
            yy += 12.5
            out.append(f'<text x="{f(tx)}" y="{f(yy)}" text-anchor="{anchor}" class="li">{html.escape(ln)}</text>')
        out.append("</g>")
    out.append("</g>")
    return "\n".join(out)


place(LABELS, False, 412, 968, 64)
place(ASM, True, 214, 1146, 32)


def dims():
    """Overall dimension lines for the assembled view."""
    def A(x, y, z):
        return screen((x, y, z), 0, True)
    out = ['<g class="dims">']

    def dim(p0, p1, e, txt, toff, rot=False):
        a, b = A(*p0), A(*p1)
        ea, eb = A(*[p0[i] + e[i] for i in range(3)]), A(*[p1[i] + e[i] for i in range(3)])
        out.append(f'<path d="M{f(a[0])},{f(a[1])}L{f(ea[0])},{f(ea[1])}M{f(b[0])},{f(b[1])}L{f(eb[0])},{f(eb[1])}" stroke="#6b6f76" stroke-width="0.7" fill="none"/>')
        k = 0.82
        ma = (a[0] + (ea[0] - a[0]) * k, a[1] + (ea[1] - a[1]) * k)
        mb = (b[0] + (eb[0] - b[0]) * k, b[1] + (eb[1] - b[1]) * k)
        out.append(f'<path d="M{f(ma[0])},{f(ma[1])}L{f(mb[0])},{f(mb[1])}" stroke="{INK}" stroke-width="0.9" marker-start="url(#arr)" marker-end="url(#arr)" fill="none"/>')
        mx, my = (ma[0] + mb[0]) / 2 + toff[0], (ma[1] + mb[1]) / 2 + toff[1]
        tr = f' transform="rotate(-90 {f(mx)} {f(my)})"' if rot else ""
        out.append(f'<text x="{f(mx)}" y="{f(my)}" class="dim" text-anchor="middle"{tr}>{txt}</text>')
    dim((0, 262, 0), (390, 262, 0), (0, 40, 0), "390 mm", (-14, 22))
    dim((390, 0, 0), (390, 260, 0), (42, 0, 0), "260 mm", (36, -6))
    dim((0, 252, 0), (0, 252, 104), (-34, 0, 0), "104 mm", (-12, 0), rot=True)
    out.append(f'<text x="{ACX}" y="{DRAW_Y1 - 230}" text-anchor="middle" class="ls">W × H × D (upright) 390 × 104 × 260 mm, excluding largest projection and base · approx. 4.5 kg [S]</text>')
    out.append("</g>")
    return "\n".join(out)


# ---------------------------------------------------------------------------- insets
def soc_inset(x0, y0):
    k = 1.62
    def T(x, y): return x0 + 14 + k * (376 - x), y0 + 40 + k * (y - 20)
    def poly(pts, fill, stroke=INK, sw=0.7, extra=""):
        return f'<path d="{d_of([T(*p) for p in pts])}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"{extra}/>'
    o = [f'<g class="inset">',
         f'<rect x="{x0}" y="{y0}" width="520" height="560" fill="#fff" stroke="{INK}" stroke-width="1"/>',
         f'<text x="{x0 + 14}" y="{y0 + 24}" class="ih">A · MAIN BOARD, SoC SIDE (board flipped)</text>',
         poly(BOARD, PCB_T, INK, 1)]
    chips = []
    def chip(n, x, y, w, h, fill=CHIP, note=None):
        o.append(poly(rect(x - w / 2, y - h / 2, x + w / 2, y + h / 2), fill, INK, 0.6))
        chips.append((n, x, y))
    # SoC package + die
    o.append(poly(rect(SOC[0] - 23, SOC[1] - 23, SOC[0] + 23, SOC[1] + 23), "#3f5a3a", INK, 0.7))
    o.append(poly(rect(SOC[0] - 11, SOC[1] - 14, SOC[0] + 11, SOC[1] + 14), "#9aa3ad", INK, 0.6))
    o.append(poly(rrect(SOC[0] - 27, SOC[1] - 27, SOC[0] + 27, SOC[1] + 27, 4), "none", "#c9cdd3", 0.8, ' stroke-dasharray="3 2"'))
    chips.append((1, SOC[0], SOC[1]))
    gd = [(158, 52), (158, 88), (234, 52), (234, 88), (180, 33), (212, 33), (180, 107), (212, 107)]
    for i, (x, y) in enumerate(gd):
        o.append(poly(rect(x - 7, y - 6, x + 7, y + 6), CHIP, INK, 0.6))
    chips.append((2, 234, 88))
    chip(3, 152, 152, 17, 17)
    chip(4, 175, 152, 10, 12)
    for x in (146, 166, 186):
        o.append(poly(rect(x - 8, 180, x + 8, 198), CHIP, INK, 0.6))
    chips.append((5, 166, 189))
    chip(6, 222, 150, 14, 14)
    chip(7, 278, 46, 8, 8)
    chip(8, 226, 192, 6, 6)
    chip(9, 140, 222, 6, 6)
    chip(10, 236, 124, 7, 7)
    for (x, y) in ((266, 20), (292, 20), (316, 20), (336, 20)):
        o.append(poly(rect(x, 20, x + (20 if x == 266 else 18 if x == 292 else 14), 26), "#b3b8bf", INK, 0.5))
    tx_, ty_ = T(300, 180)
    o.append(f'<text x="{f(tx_)}" y="{f(ty_)}" class="ls" text-anchor="middle" fill="#7b8088">fan cut-out</text>')
    for n, x, y in chips:
        cx_, cy_ = T(x, y)
        o.append(f'<circle cx="{f(cx_)}" cy="{f(cy_)}" r="7.5" fill="#fff" stroke="{AMBER}" stroke-width="1"/>')
        o.append(f'<text x="{f(cx_)}" y="{f(cy_ + 3.4)}" text-anchor="middle" class="num">{n}</text>')
    key = [
        ("1", "SoC — SIE/AMD CXD90060GG: 8-core Zen 2 ≤3.5 GHz, RDNA 2 36 CU ≤2.23 GHz [iF]"),
        ("2", "GDDR6 ×8 — Micron MT61K512M32KPA-14:B, 2 GB each = 16 GB, 448 GB/s [iF]"),
        ("3", "SSD controller — Sony CXD90062GG (custom) [iF]"),
        ("4", "DDR4 512 MB — SK Hynix H5AN4G8NBJR-UHC [iF]"),
        ("5", "NAND ×3 of 6 — Kioxia TH58LJT0T24BA4M, ‘likely’ [iF]"),
        ("6", "I/O controller — Sony CXD90061GG, ‘likely’ [iF]"),
        ("7", "HDMI redriver — Panasonic MN864739, ‘likely’ [iF]"),
        ("8", "Serial flash — Winbond W25Q16JV, 16 Mb [iF]"),
        ("9", "USB-C redriver — TI TUSB1044 [iF]"),
        ("10", "16-phase PWM controller — Infineon XDPE14286A, ‘likely’ [iF]"),
    ]
    yy = y0 + 404
    for n, t in key:
        o.append(f'<text x="{x0 + 16}" y="{yy}" class="ks"><tspan class="kn">{n}</tspan>  {html.escape(t)}</text>')
        yy += 12.6
    o.append(f'<text x="{x0 + 16}" y="{yy + 4}" class="li">◇ ILLUSTRATIVE — chip identities are from iFixit; placement on the board is schematic.</text>')
    o.append(f'<text x="{x0 + 16}" y="{yy + 17}" class="li">Dashed square = liquid-metal seal footprint.</text>')
    o.append("</g>")
    return "\n".join(o)


def rear_inset(x0, y0):
    o = [f'<g class="inset">',
         f'<rect x="{x0}" y="{y0}" width="520" height="150" fill="#fff" stroke="{INK}" stroke-width="1"/>',
         f'<text x="{x0 + 14}" y="{y0 + 24}" class="ih">B · REAR PANEL (console lying flat)</text>',
         f'<rect x="{x0 + 16}" y="{y0 + 40}" width="488" height="58" rx="6" fill="{BLK_T}"/>',
         f'<rect x="{x0 + 16}" y="{y0 + 36}" width="488" height="6" rx="3" fill="#e3e6ea" stroke="#9aa0a8" stroke-width="0.5"/>',
         f'<rect x="{x0 + 16}" y="{y0 + 96}" width="488" height="6" rx="3" fill="#e3e6ea" stroke="#9aa0a8" stroke-width="0.5"/>']
    for k in range(22):
        o.append(f'<rect x="{x0 + 236 + k * 12}" y="{y0 + 48}" width="5" height="42" rx="2" fill="#0b0c0e"/>')
    px = x0 + 30
    ports = [("AC IN", 26, 18, 9), ("HDMI 2.1", 30, 11, 0), ("LAN", 22, 20, 0), ("USB-A", 20, 10, 0), ("USB-A", 20, 10, 0)]
    for name, w_, h_, r_ in ports:
        o.append(f'<rect x="{px}" y="{y0 + 69 - h_ / 2}" width="{w_}" height="{h_}" rx="{r_ or 1.5}" fill="#0b0c0e" stroke="#7b8088" stroke-width="0.8"/>')
        o.append(f'<text x="{px + w_ / 2}" y="{y0 + 122}" text-anchor="middle" class="ks">{name}</text>')
        px += w_ + 26
    o.append(f'<text x="{x0 + 370}" y="{y0 + 122}" text-anchor="middle" class="ks">exhaust vents</text>')
    o.append(f'<text x="{x0 + 16}" y="{y0 + 140}" class="li">◇ ILLUSTRATIVE — port order &amp; vent pattern. Port set per iFixit; rear USB-A 10 Gbps per PCPer.</text>')
    o.append("</g>")
    return "\n".join(o)


def legend(x0, y0):
    o = [f'<g class="inset">',
         f'<rect x="{x0}" y="{y0}" width="520" height="200" fill="#fff" stroke="{INK}" stroke-width="1"/>',
         f'<text x="{x0 + 14}" y="{y0 + 24}" class="ih">C · KEY &amp; SOURCES</text>',
         f'<circle cx="{x0 + 22}" cy="{y0 + 45}" r="2.6" fill="{INK}"/>',
         f'<path d="M{x0 + 22},{y0 + 45}H{x0 + 56}" stroke="{INK}" stroke-width="0.8"/>',
         f'<text x="{x0 + 64}" y="{y0 + 49}" class="ks">Confirmed: identified in a cited public teardown or Sony spec</text>',
         f'<circle cx="{x0 + 22}" cy="{y0 + 65}" r="2.8" fill="#fff" stroke="{AMBER}" stroke-width="1.2"/>',
         f'<path d="M{x0 + 22},{y0 + 65}H{x0 + 56}" stroke="{AMBER}" stroke-width="0.8" stroke-dasharray="4 3"/>',
         f'<text x="{x0 + 64}" y="{y0 + 69}" class="ks">◇ Illustrative: the named detail is not confirmed; drawn for clarity</text>']
    rows = [
        "[S]   Sony Interactive Entertainment, official PS5 teardown video (Y. Ootori, 7 Oct 2020) & PS5 spec",
        "[iF]  iFixit, “PlayStation 5 Teardown” (guide 138280), launch disc model",
        "[PC]  PC Perspective, “The PlayStation 5 Gets Strip Searched” (Oct 2020)",
        "All geometry is schematic and not to scale; the overall envelope follows Sony’s",
        "390 × 104 × 260 mm. Colours are chosen for legibility. Parts explode along the",
        "thickness axis in teardown order: the top layer comes out first, the PSU last [iF].",
    ]
    yy = y0 + 94
    for r in rows:
        o.append(f'<text x="{x0 + 16}" y="{yy}" class="ks">{html.escape(r)}</text>')
        yy += 15
    o.append("</g>")
    return "\n".join(o)


STYLE = f"""
.drawing text{{font-family:"Helvetica Neue",Helvetica,Arial,sans-serif;fill:{INK}}}
.drawing path,.drawing circle,.drawing rect{{vector-effect:non-scaling-stroke}}
.lt{{font-size:12.2px;font-weight:700;letter-spacing:.1px}}
.ls{{font-size:10.6px;fill:#3d4047}}
.li{{font-size:10px;fill:{AMBER} !important;font-weight:600}}
.src{{font-size:9.5px;font-weight:500;fill:#6b6f76}}
.ih{{font-size:13px;font-weight:800;letter-spacing:1.2px}}
.ks{{font-size:10.6px;fill:#2b2d33}}
.kn{{font-weight:800;fill:{AMBER}}}
.num{{font-size:9px;font-weight:800;fill:{AMBER}}}
.dim{{font-size:12px;font-weight:700}}
.title{{font-size:26px;font-weight:800;letter-spacing:.4px}}
.subtitle{{font-size:12.5px;fill:#4a4d53;letter-spacing:.6px}}
.tb{{font-size:10.5px;fill:#3d4047;letter-spacing:.5px}}
.tbv{{font-size:13px;font-weight:800;letter-spacing:1.5px}}
.layer,.stage{{transition:transform 1.1s cubic-bezier(.65,0,.35,1)}}
.lbl-exp,.lbl-asm,.dims,.mode-exp,.mode-asm{{transition:opacity .45s ease}}
.drawing.assembled .lbl-exp,.drawing.assembled .mode-exp{{opacity:0;visibility:hidden}}
.drawing.exploded .lbl-asm,.drawing.exploded .dims,.drawing.exploded .mode-asm{{opacity:0;visibility:hidden}}
.drawing.assembled .stage{{transform:translate({f(TX)}px,{f(TY)}px) scale({ZOOM})}}
.drawing.no-anim .layer,.drawing.no-anim .stage{{transition:none}}
.drawing.no-anim .lbl-exp,.drawing.no-anim .lbl-asm,.drawing.no-anim .dims{{transition:none}}
""" + "\n".join(
    f".drawing.exploded #L-{l.id}{{transform:translate(0px,{f(-S * l.off)}px)}}" for l in layers)

DEFS = f"""<defs>
<linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">
 <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f4f5f7"/><stop offset="1" stop-color="#dfe2e6"/>
</linearGradient>
<radialGradient id="bulge" cx=".4" cy=".35" r=".75">
 <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e8eaee"/>
</radialGradient>
<linearGradient id="lm" x1="0" y1="0" x2="1" y2="1">
 <stop offset="0" stop-color="#f4f6f8"/><stop offset=".45" stop-color="#aab1ba"/><stop offset=".6" stop-color="#e6e9ec"/><stop offset="1" stop-color="#8a929c"/>
</linearGradient>
<marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
 <path d="M0,1.5L9,5L0,8.5Z" fill="{INK}"/>
</marker>
<pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
 <path d="M24,0H0V24" fill="none" stroke="#e7e3da" stroke-width="0.6"/>
</pattern>
</defs>"""


def svg():
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" id="drawing" class="drawing exploded" viewBox="0 0 {W} {H}" '
             f'width="{W}" height="{H}" role="img" aria-labelledby="dt dd">',
             '<title id="dt">PlayStation 5 CFI-1000 disc edition: exploded teardown illustration</title>',
             '<desc id="dd">Exploded and assembled axonometric illustration of the original PS5 disc edition, '
             'with labelled components and source notes.</desc>',
             f"<style>{STYLE}</style>", DEFS,
             f'<rect width="{W}" height="{H}" fill="{PAPER}"/>',
             f'<rect x="20" y="96" width="1330" height="1310" fill="url(#grid)"/>',
             f'<rect x="20" y="96" width="1330" height="1310" fill="none" stroke="#cfcac0" stroke-width="1"/>',
             f'<text x="28" y="48" class="title">SONY PLAYSTATION 5 — ORIGINAL DISC EDITION (CFI-1000 SERIES)</text>',
             f'<text x="28" y="74" class="subtitle">TECHNICAL TEARDOWN ILLUSTRATION · AXONOMETRIC · NOT TO SCALE · '
             f'BASED ON PUBLIC TEARDOWNS BY SONY, iFIXIT AND PCPER</text>',
             f'<text x="1340" y="80" text-anchor="end" class="tbv mode-exp">EXPLODED VIEW</text>',
             f'<text x="1340" y="80" text-anchor="end" class="tbv mode-asm">ASSEMBLED VIEW</text>',
             f'<g class="stage"><g transform="translate({f(OX)},{f(OY)})">']
    for l in layers:
        parts.append(f'<g class="layer" id="L-{l.id}">')
        parts += l.out
        parts.append("</g>")
    parts.append("</g></g>")
    parts.append(render_labels(LABELS, "lbl-exp"))
    parts.append(render_labels(ASM, "lbl-asm"))
    parts.append(dims())
    parts.append(soc_inset(1380, 96))
    parts.append(rear_inset(1380, 672))
    parts.append(legend(1380, 838))
    parts.append(f'<g class="inset"><rect x="1380" y="1054" width="520" height="352" fill="#fff" stroke="{INK}"/>'
                 f'<text x="1394" y="1078" class="ih">D · TEARDOWN ORDER (top layer first)</text>')
    order = ["Side cover, drive side — tool-less [iF]",
             "Upper core shell: fan intake, M.2 bay cover, dust catchers, drive bay",
             "Fan (T8 Torx) and Ultra HD Blu-ray drive [iF]",
             "Steel shield plate, many screws [iF]",
             "Main board: back side with M.2 slot and VRM heat pipe [iF]",
             "Liquid-metal TIM on the SoC [S][iF]",
             "Heat sink with copper heat pipes; 350 W PSU removed last [iF]",
             "Lower core shell → side cover, non-drive side → stand"]
    yy = 1102
    for i, t in enumerate(order):
        parts.append(f'<text x="1396" y="{yy}" class="ks"><tspan class="kn">{i + 1:>2}</tspan>   {html.escape(t)}</text>')
        yy += 17
    parts.append(f'<text x="1396" y="{yy + 8}" class="ks">Key specs [S]: 825 GB SSD · 16 GB GDDR6 · Ultra HD Blu-ray ·</text>')
    parts.append(f'<text x="1396" y="{yy + 23}" class="ks">HDMI 2.1 out · Wi-Fi 6 · Bluetooth 5.1 · AC 100–240 V, 350 W rated.</text>')
    parts.append(f'<text x="1396" y="{yy + 50}" class="tb">DRAWING PS5-CFI1000-XPL · SHEET 1/1 · REV A · 2026-10-27</text>')
    parts.append(f'<text x="1396" y="{yy + 66}" class="tb">Two-piece core split, chip placement and routing are illustrative.</text>')
    parts.append("</g>")
    parts.append(f'<text x="28" y="1440" class="tb">Labels: bold = component · grey = detail · [S]/[iF]/[PC] = source · '
                 f'amber dashed leader + ◇ = illustrative, not confirmed by a public teardown.</text>')
    parts.append(f'<text x="28" y="1458" class="tb">“PlayStation” and “PS5” are trademarks of Sony Interactive Entertainment. '
                 f'Independent illustration; not affiliated with or endorsed by Sony.</text>')
    parts.append("</svg>")
    return "\n".join(parts)


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PS5 CFI-1000 — Exploded Teardown Illustration</title>
<style>
:root{--ink:#1c1d21;--paper:#f5f3ee;--line:#d6d1c6;--amber:#b4570f}
*{box-sizing:border-box}
html,body{margin:0;background:#e9e6df;color:var(--ink);font:14px/1.4 "Helvetica Neue",Helvetica,Arial,sans-serif}
header{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;
  padding:12px 20px;background:rgba(245,243,238,.94);backdrop-filter:blur(6px);border-bottom:1px solid var(--line)}
header h1{font-size:15px;margin:0;font-weight:800;letter-spacing:.3px;margin-right:auto}
header h1 span{font-weight:500;color:#5b5f66}
.switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer;user-select:none;border:0;background:none;
  font:inherit;color:inherit;padding:4px 2px}
.switch .opt{font-weight:600;color:#7b7f86;transition:color .2s}
.switch .track{position:relative;width:46px;height:24px;border-radius:12px;background:var(--ink);transition:background .2s}
.switch .knob{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .25s}
.switch[aria-checked="true"] .knob{transform:translateX(22px)}
.switch[aria-checked="false"] .opt.exp,.switch[aria-checked="true"] .opt.asm{color:var(--ink)}
.switch:focus-visible{outline:2px solid var(--amber);outline-offset:3px;border-radius:6px}
.btn{font:inherit;font-weight:600;padding:7px 14px;border-radius:7px;border:1px solid var(--ink);background:#fff;color:var(--ink);cursor:pointer}
.btn:hover{background:var(--ink);color:#fff}
.btn:focus-visible{outline:2px solid var(--amber);outline-offset:2px}
.btn[disabled]{opacity:.5;cursor:progress}
main{padding:18px}
.sheet{max-width:1920px;margin:0 auto;box-shadow:0 2px 18px rgba(0,0,0,.12);background:var(--paper)}
.sheet svg{display:block;width:100%;height:auto}
.hint{max-width:1920px;margin:10px auto 0;color:#5b5f66;font-size:12.5px}
#status{min-width:9ch;color:#5b5f66;font-size:12.5px}
</style>
</head>
<body>
<header>
  <h1>PlayStation 5 · CFI-1000 disc edition <span>— exploded teardown</span></h1>
  <button class="switch" id="toggle" role="switch" aria-checked="false" aria-label="Show assembled console">
    <span class="opt exp">Exploded</span><span class="track"><span class="knob"></span></span><span class="opt asm">Assembled</span>
  </button>
  <button class="btn" id="dl-svg">Download SVG</button>
  <button class="btn" id="dl-png">Download PNG</button>
  <span id="status" aria-live="polite"></span>
</header>
<main>
  <div class="sheet">__SVG__</div>
  <p class="hint">The switch (or the <kbd>A</kbd> key) moves between the exploded and assembled views. Downloads save the view on screen: SVG keeps it as vectors; PNG is rendered at 2× (3840 × 3000 px).</p>
</main>
<script>
(function(){
  var svg=document.getElementById('drawing'), tg=document.getElementById('toggle'), st=document.getElementById('status');
  function set(asm){
    svg.classList.toggle('assembled',asm); svg.classList.toggle('exploded',!asm);
    tg.setAttribute('aria-checked',asm?'true':'false');
    tg.setAttribute('aria-label',asm?'Show exploded view':'Show assembled console');
  }
  tg.addEventListener('click',function(){set(tg.getAttribute('aria-checked')!=='true')});
  document.addEventListener('keydown',function(e){
    if((e.key==='a'||e.key==='A')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&!/INPUT|TEXTAREA/.test(e.target.tagName)) tg.click();
  });
  function mode(){return svg.classList.contains('assembled')?'assembled':'exploded'}
  function source(){
    var c=svg.cloneNode(true); c.classList.add('no-anim'); c.removeAttribute('style');
    return '<?xml version="1.0" encoding="UTF-8"?>\\n'+new XMLSerializer().serializeToString(c);
  }
  function save(blob,name){
    var a=document.createElement('a'), u=URL.createObjectURL(blob);
    a.href=u; a.download=name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){URL.revokeObjectURL(u)},4000);
  }
  document.getElementById('dl-svg').addEventListener('click',function(){
    save(new Blob([source()],{type:'image/svg+xml'}),'ps5-cfi1000-'+mode()+'.svg');
  });
  document.getElementById('dl-png').addEventListener('click',function(){
    var b=this; b.disabled=true; st.textContent='Rendering…';
    var vb=svg.viewBox.baseVal, scale=2, img=new Image();
    img.onload=function(){
      var cv=document.createElement('canvas'); cv.width=vb.width*scale; cv.height=vb.height*scale;
      var cx=cv.getContext('2d'); cx.drawImage(img,0,0,cv.width,cv.height);
      try{
        cv.toBlob(function(blob){
          b.disabled=false;
          if(!blob){st.textContent='PNG export failed';return}
          save(blob,'ps5-cfi1000-'+mode()+'.png'); st.textContent='';
        },'image/png');
      }catch(err){b.disabled=false; st.textContent='PNG export blocked by browser';}
    };
    img.onerror=function(){b.disabled=false; st.textContent='PNG export failed';};
    img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(source());
  });
})();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "dist", "index.html")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(PAGE.replace("__SVG__", svg()))
    print("wrote", out, os.path.getsize(out), "bytes;", len(LABELS), "exploded labels,", len(ASM), "assembled labels")
