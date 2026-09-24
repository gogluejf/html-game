#!/usr/bin/env python3
"""Render a level overview PNG from a petal-panic trace dump.

Layout: 3 horizontal areas stacked on the LEFT. One vertical climb on the RIGHT.
All dimensions read from the dump — no hardcoded game constants.
"""

import json
import sys
from PIL import Image, ImageDraw, ImageFont


def render(trace_path: str, out_path: str):
    with open(trace_path) as f:
        data = json.load(f)

    area_map = data.get("areaMap", {})
    horiz_areas = sorted(a for a in area_map if area_map[a].get("orientation") != "vertical")
    vert_areas = sorted(a for a in area_map if area_map[a].get("orientation") == "vertical")

    # Read dimensions from the first horizontal and vertical area
    h_ref = area_map[horiz_areas[0]] if horiz_areas else {}
    v_ref = area_map[vert_areas[0]] if vert_areas else {}

    H_GAME_W = h_ref["zoneWidthPx"]
    H_GAME_H = h_ref["zoneHeightPx"]
    V_GAME_W = v_ref["zoneWidthPx"]
    V_GAME_H = v_ref["zoneHeightPx"]
    UNIT_PX_X = h_ref["unitPxX"]
    UNIT_PX_Y = h_ref["unitPxY"]

    # Pick a single scale so both sides use the same px-per-game-px ratio
    target_v_h = 1000
    scale = target_v_h / V_GAME_H

    H_RENDER_W = int(H_GAME_W * scale)
    H_RENDER_H = int(H_GAME_H * scale)
    V_RENDER_W = int(V_GAME_W * scale)
    V_RENDER_H = int(V_GAME_H * scale)

    MARGIN = 50
    GAP = 10

    CANVAS_W = MARGIN + H_RENDER_W + GAP + V_RENDER_W + 10
    CANVAS_H = max(MARGIN * 2 + V_RENDER_H, MARGIN + H_RENDER_H * 3 + GAP * 2 + 10)

    img = Image.new("RGB", (CANVAS_W, CANVAS_H), (0, 0, 0))
    draw = ImageDraw.Draw(img)

    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 14)
    except OSError:
        font = ImageFont.load_default()

    plat_thick = max(2, int((UNIT_PX_Y / 8) * scale))

    # --- Horizontal rows (left side) ---
    for row_idx, area_id in enumerate(horiz_areas[:3]):
        info = area_map[area_id]
        units = info.get("placedUnits", [])
        h_w = info["zoneWidthPx"]
        h_h = info["zoneHeightPx"]

        y_top = MARGIN + row_idx * (H_RENDER_H + GAP)
        y_bot = y_top + H_RENDER_H
        x_left = MARGIN
        x_right = MARGIN + H_RENDER_W

        draw.rectangle([x_left, y_top, x_right - 1, y_bot - 1], outline=(255, 255, 255), width=1)
        draw.text((x_left + 4, y_top + 3), area_id, fill=(255, 255, 255), font=font)

        floor_h = int(UNIT_PX_Y * scale)
        floor_y = y_bot - floor_h
        draw.rectangle([x_left, floor_y, x_right - 1, y_bot - 1], fill=(30, 30, 30))
        draw.line([x_left, floor_y, x_right - 1, floor_y], fill=(80, 80, 80), width=1)

        if not units:
            continue

        sx = lambda gx: x_left + int((gx / h_w) * H_RENDER_W)
        sy = lambda tier: floor_y - int(tier * UNIT_PX_Y * scale)

        for u in units:
            kind = u.get("kind")
            ux = u.get("x", 0)
            uw = u.get("w", 1)
            uh = u.get("h", 1)

            if kind == "platform":
                tier = u.get("tier")
                if tier is None:
                    uy = u.get("y", 0)
                    tier = max(1, round(uy / 85)) if uy > 5 else 1
                px = sx(ux * UNIT_PX_X)
                pw = max(3, int(uw * UNIT_PX_X * scale))
                py = sy(tier)
                draw.rectangle([px, py - plat_thick, px + pw - 1, py - 1], fill=(255, 165, 0))
            elif kind == "block":
                px = sx(ux * UNIT_PX_X)
                pw = max(3, int(uw * UNIT_PX_X * scale))
                ph = max(3, int(uh * UNIT_PX_Y * scale))
                py = floor_y - ph
                draw.rectangle([px, py, px + pw - 1, py + ph - 1], fill=(255, 165, 0))

        # Slots (potential spawn points)
        slot_colors = {"enemy": (255, 50, 50), "barrel": (255, 140, 0), "powerup": (50, 100, 255)}
        dot_r = max(2, int(UNIT_PX_X * scale * 0.15))
        for s in info.get("slots", []):
            stype = s.get("type", "")
            color = slot_colors.get(stype, (128, 128, 128))
            sxp = sx(s["x"] * UNIT_PX_X + UNIT_PX_X * 0.5)
            syp = sy(s.get("y", 0)) - dot_r
            draw.ellipse([sxp - dot_r, syp - dot_r, sxp + dot_r, syp + dot_r], fill=color)

    # --- Vertical column (right side) ---
    if vert_areas:
        area_id = vert_areas[0]
        info = area_map[area_id]
        units = info.get("placedUnits", [])
        v_w = info["zoneWidthPx"]
        v_h = info["zoneHeightPx"]

        v_x_left = MARGIN + H_RENDER_W + GAP
        v_x_right = v_x_left + V_RENDER_W
        v_y_top = MARGIN
        v_y_bot = MARGIN + V_RENDER_H

        draw.rectangle([v_x_left, v_y_top, v_x_right - 1, v_y_bot - 1], outline=(255, 255, 255), width=1)
        draw.text((v_x_left + 4, v_y_top + 3), f"{area_id} (V)", fill=(255, 255, 255), font=font)

        v_floor_h = int(UNIT_PX_Y * scale)
        v_floor_y = v_y_bot - v_floor_h
        draw.rectangle([v_x_left, v_floor_y, v_x_right - 1, v_y_bot - 1], fill=(30, 30, 30))
        draw.line([v_x_left, v_floor_y, v_x_right - 1, v_floor_y], fill=(80, 80, 80), width=1)

        if units:
            min_x = min(u["x"] for u in units) * UNIT_PX_X
            max_x = max(u["x"] + u["w"] for u in units) * UNIT_PX_X
            x_span = max_x - min_x
            x_offset = (V_RENDER_W - int(x_span * scale)) // 2

            sx = lambda gx: v_x_left + x_offset + int(((gx - min_x) / v_w) * V_RENDER_W)
            sy = lambda gy: v_floor_y - int((gy / v_h) * V_RENDER_H)

            for u in units:
                kind = u.get("kind")
                ux = u.get("x", 0)
                uy = u.get("y", 0)
                uw = u.get("w", 1)
                uh = u.get("h", 1)

                if kind == "platform":
                    px = sx(ux * UNIT_PX_X)
                    pw = max(3, int(uw * UNIT_PX_X * scale))
                    py = sy(uy * UNIT_PX_Y)
                    draw.rectangle([px, py - plat_thick, px + pw - 1, py - 1], fill=(255, 165, 0))
                elif kind == "block":
                    px = sx(ux * UNIT_PX_X)
                    pw = max(3, int(uw * UNIT_PX_X * scale))
                    ph = max(3, int(uh * UNIT_PX_Y * scale))
                    py = sy((uy + uh) * UNIT_PX_Y)
                    draw.rectangle([px, py, px + pw - 1, py + ph - 1], fill=(255, 165, 0))

            # Slots (potential spawn points)
            slot_colors = {"enemy": (255, 50, 50), "barrel": (255, 140, 0), "powerup": (50, 100, 255)}
            dot_r = max(2, int(UNIT_PX_X * scale * 0.15))
            for s in info.get("slots", []):
                stype = s.get("type", "")
                color = slot_colors.get(stype, (128, 128, 128))
                sxp = sx(s["x"] * UNIT_PX_X + UNIT_PX_X * 0.5)
                syp = sy(s.get("y", 0) * UNIT_PX_Y) - dot_r
                draw.ellipse([sxp - dot_r, syp - dot_r, sxp + dot_r, syp + dot_r], fill=color)

    img.save(out_path)
    print(f"Saved: {out_path} ({CANVAS_W}x{CANVAS_H})")


if __name__ == "__main__":
    trace = sys.argv[1] if len(sys.argv) > 1 else None
    if trace is None:
        import glob, os
        dumps = sorted(glob.glob(os.path.expanduser("~/Downloads/petal-panic-trace-*.json")), key=os.path.getmtime)
        if not dumps:
            print("No trace dumps found in ~/Downloads/")
            sys.exit(1)
        trace = dumps[-1]
        print(f"Using latest: {trace}")
    out = sys.argv[2] if len(sys.argv) > 2 else "/home/goglue/tmp/level-overview.png"
    render(trace, out)
