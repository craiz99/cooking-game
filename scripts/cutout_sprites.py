#!/usr/bin/env python3
"""
Asset processing & transparent cutout pipeline for Purple Van Road Trip.
Uses border-seeded BFS floodfill so pure-white interior details (chef hats,
panda fur, skunk stripes, rice, fish eyes) stay 100% opaque while exterior
flat white backgrounds become cleanly transparent with smooth anti-aliased edges.
"""

from collections import deque
import os
from pathlib import Path
from PIL import Image

ARTIFACT_DIR = Path(os.environ.get("RAW_ART_DIR", "./raw_art"))
ASSETS_DIR = Path(__file__).resolve().parent.parent / "client" / "public" / "assets"


def find_latest(prefix: str) -> Path:
    matches = sorted(ARTIFACT_DIR.glob(f"{prefix}_*.jpg"))
    if not matches:
        raise FileNotFoundError(f"Missing generated asset with prefix: {prefix}")
    return matches[-1]


def floodfill_white_bg(img: Image.Image, threshold: int = 236, soft_band: int = 22) -> Image.Image:
    """Removes exterior near-white background via 4-connected BFS from edges."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()

    def is_bg(r: int, g: int, b: int) -> bool:
        return r >= threshold and g >= threshold and b >= threshold and (max(r, g, b) - min(r, g, b) < 26)

    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()

    # Seed from all 4 border edges
    for x in range(w):
        for y in (0, h - 1):
            r, g, b, _ = px[x, y]
            if is_bg(r, g, b) and not visited[y][x]:
                visited[y][x] = True
                q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            r, g, b, _ = px[x, y]
            if is_bg(r, g, b) and not visited[y][x]:
                visited[y][x] = True
                q.append((x, y))

    while q:
        cx, cy = q.popleft()
        px[cx, cy] = (0, 0, 0, 0)
        for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx]:
                r, g, b, _ = px[nx, ny]
                if is_bg(r, g, b):
                    visited[ny][nx] = True
                    q.append((nx, ny))

    # Gentle 1-pixel edge defringing for pixels adjacent to transparent exterior
    edge_updates: list[tuple[int, int, tuple[int, int, int, int]]] = []
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            touches_bg = (
                px[x - 1, y][3] == 0
                or px[x + 1, y][3] == 0
                or px[x, y - 1][3] == 0
                or px[x, y + 1][3] == 0
            )
            if touches_bg:
                lum = (r + g + b) / 3.0
                if lum > threshold - soft_band and (max(r, g, b) - min(r, g, b) < 35):
                    ratio = max(0.0, min(1.0, (threshold - lum) / float(soft_band)))
                    new_a = int(a * ratio)
                    # Darken residual white fringe slightly toward warm storybook ink
                    edge_updates.append((x, y, (int(r * 0.72), int(g * 0.68), int(b * 0.65), new_a)))

    for x, y, val in edge_updates:
        px[x, y] = val

    # Tight crop with small padding
    bbox = rgba.getbbox()
    if bbox:
        pad = 6
        x0 = max(0, bbox[0] - pad)
        y0 = max(0, bbox[1] - pad)
        x1 = min(w, bbox[2] + pad)
        y1 = min(h, bbox[3] + pad)
        rgba = rgba.crop((x0, y0, x1, y1))
    return rgba


def save_cutout(img: Image.Image, dest: Path, max_dim: int = 384) -> None:
    cut = floodfill_white_bg(img)
    cut.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
    dest.parent.mkdir(parents=True, exist_ok=True)
    cut.save(dest, "PNG", optimize=True)


def slice_grid(
    src_path: Path, cols: int, rows: int, outputs: list[Path], max_dim: int = 256
) -> None:
    sheet = Image.open(src_path).convert("RGBA")
    w, h = sheet.size
    cw = w / cols
    ch = h / rows
    idx = 0
    for r in range(rows):
        for c in range(cols):
            if idx >= len(outputs):
                return
            box = (int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch))
            cell = sheet.crop(box)
            save_cutout(cell, outputs[idx], max_dim=max_dim)
            idx += 1


def process_all() -> None:
    # 1. Painted scenes -> optimized 1440x810 WebP
    scenes = [
        ("art_sharon_lobby_bg", "sharon_lobby_bg.webp"),
        ("art_us_map_bg", "us_map_bg.webp"),
        ("art_kitchen_sharon", "kitchen_sharon.webp"),
        ("art_kitchen_nyc", "kitchen_nyc.webp"),
        ("art_kitchen_chicago", "kitchen_chicago.webp"),
        ("art_kitchen_austin", "kitchen_austin.webp"),
        ("art_kitchen_denver", "kitchen_denver.webp"),
        ("art_kitchen_yosemite", "kitchen_yosemite.webp"),
        ("art_kitchen_tahoe", "kitchen_tahoe.webp"),
        ("art_kitchen_sanjose", "kitchen_sanjose.webp"),
    ]
    for prefix, out_name in scenes:
        img = Image.open(find_latest(prefix)).convert("RGB")
        img.thumbnail((1440, 810), Image.Resampling.LANCZOS)
        dest = ASSETS_DIR / "scenes" / out_name
        dest.parent.mkdir(parents=True, exist_ok=True)
        img.save(dest, "WEBP", quality=86, method=4)
        print(f"Scene OK: {dest.name} ({img.size[0]}x{img.size[1]})")

    # 2. PWA App Icons (crop slightly to fill icon square cleanly)
    icon_src = Image.open(find_latest("art_pwa_icon")).convert("RGB")
    iw, ih = icon_src.size
    crop_margin = int(iw * 0.11)
    icon_clean = icon_src.crop((crop_margin, crop_margin, iw - crop_margin, ih - crop_margin))
    for size, fname in [(512, "icon-512.png"), (192, "icon-192.png"), (180, "apple-touch-icon.png")]:
        resized = icon_clean.resize((size, size), Image.Resampling.LANCZOS)
        dest = ASSETS_DIR / "icons" / fname
        dest.parent.mkdir(parents=True, exist_ok=True)
        resized.save(dest, "PNG", optimize=True)
        print(f"Icon OK: {fname}")

    # 3. 6 Individual Hero Animal Chefs + Purple Van sprite
    hero_sprites = [
        ("art_chef_purple_cat", ASSETS_DIR / "chefs" / "purple_cat.png", 384),
        ("art_chef_orange_dog", ASSETS_DIR / "chefs" / "orange_dog.png", 384),
        ("art_chef_panda", ASSETS_DIR / "chefs" / "panda.png", 384),
        ("art_chef_fox", ASSETS_DIR / "chefs" / "fox.png", 384),
        ("art_chef_skunk", ASSETS_DIR / "chefs" / "skunk.png", 384),
        ("art_chef_purple_bat", ASSETS_DIR / "chefs" / "purple_bat.png", 340),
        ("art_purple_van_sprite", ASSETS_DIR / "chefs" / "purple_van.png", 360),
    ]
    for prefix, dest, max_dim in hero_sprites:
        save_cutout(Image.open(find_latest(prefix)), dest, max_dim=max_dim)
        print(f"Hero OK: {dest.name}")

    # 4. 6 Emote effect cutouts
    slice_grid(
        find_latest("art_emotes_sheet"),
        cols=3,
        rows=2,
        outputs=[
            ASSETS_DIR / "chefs" / "emote_moonbeams.png",
            ASSETS_DIR / "chefs" / "emote_star_treat.png",
            ASSETS_DIR / "chefs" / "emote_bamboo.png",
            ASSETS_DIR / "chefs" / "emote_leaves.png",
            ASSETS_DIR / "chefs" / "emote_fart_cloud.png",
            ASSETS_DIR / "chefs" / "emote_twinkle.png",
        ],
        max_dim=240,
    )
    print("Emotes OK (6)")

    # 5. 6 Kitchen station furniture cutouts
    slice_grid(
        find_latest("art_stations_sheet"),
        cols=3,
        rows=2,
        outputs=[
            ASSETS_DIR / "stations" / "station_prep_board.png",
            ASSETS_DIR / "stations" / "station_stove_pot.png",
            ASSETS_DIR / "stations" / "station_grill_fryer.png",
            ASSETS_DIR / "stations" / "station_counter.png",
            ASSETS_DIR / "stations" / "station_crate.png",
            ASSETS_DIR / "stations" / "station_trash.png",
        ],
        max_dim=280,
    )
    print("Stations OK (6)")

    # 6. 14 Ingredients
    slice_grid(
        find_latest("art_ingredients_a"),
        cols=4,
        rows=2,
        outputs=[
            ASSETS_DIR / "food" / "ing_seaweed.png",
            ASSETS_DIR / "food" / "ing_pasta.png",
            ASSETS_DIR / "food" / "ing_cheetos.png",
            ASSETS_DIR / "food" / "ing_gummy_bears.png",
            ASSETS_DIR / "food" / "ing_french_fries.png",
            ASSETS_DIR / "food" / "ing_fish_eyes.png",
            ASSETS_DIR / "food" / "ing_cheese.png",
            ASSETS_DIR / "food" / "ing_bread.png",
        ],
        max_dim=220,
    )
    slice_grid(
        find_latest("art_ingredients_b"),
        cols=3,
        rows=2,
        outputs=[
            ASSETS_DIR / "food" / "ing_rice.png",
            ASSETS_DIR / "food" / "ing_fish.png",
            ASSETS_DIR / "food" / "ing_sweet_corn.png",
            ASSETS_DIR / "food" / "ing_soup.png",
            ASSETS_DIR / "food" / "ing_ice_cream.png",
            ASSETS_DIR / "food" / "ing_chocolate.png",
        ],
        max_dim=220,
    )
    print("Ingredients OK (14)")

    # 7. 19 Plated Regional Dishes
    slice_grid(
        find_latest("art_dishes_a"),
        cols=4,
        rows=2,
        outputs=[
            ASSETS_DIR / "food" / "dish_seaweed_pack.png",
            ASSETS_DIR / "food" / "dish_fisheye_chowder.png",
            ASSETS_DIR / "food" / "dish_butter_pasta.png",
            ASSETS_DIR / "food" / "dish_cheetos_fries.png",
            ASSETS_DIR / "food" / "dish_cheetos_melt.png",
            ASSETS_DIR / "food" / "dish_gummy_pretzel.png",
            ASSETS_DIR / "food" / "dish_pasta_pie.png",
            ASSETS_DIR / "food" / "dish_seaweed_fries.png",
        ],
        max_dim=240,
    )
    slice_grid(
        find_latest("art_dishes_b"),
        cols=4,
        rows=2,
        outputs=[
            ASSETS_DIR / "food" / "dish_gummy_mix.png",
            ASSETS_DIR / "food" / "dish_fisheye_taco.png",
            ASSETS_DIR / "food" / "dish_cheetos_corn.png",
            ASSETS_DIR / "food" / "dish_gummy_smores.png",
            ASSETS_DIR / "food" / "dish_campfire_nachos.png",
            ASSETS_DIR / "food" / "dish_gummy_parfait.png",
            ASSETS_DIR / "food" / "dish_sequoia_soup.png",
            ASSETS_DIR / "food" / "dish_trout_bowl.png",
        ],
        max_dim=240,
    )
    slice_grid(
        find_latest("art_dishes_c"),
        cols=3,
        rows=1,
        outputs=[
            ASSETS_DIR / "food" / "dish_tahoe_pasta.png",
            ASSETS_DIR / "food" / "dish_onigiri.png",
            ASSETS_DIR / "food" / "dish_cheetos_burrito.png",
        ],
        max_dim=240,
    )
    print("Dishes OK (19)")


if __name__ == "__main__":
    process_all()
