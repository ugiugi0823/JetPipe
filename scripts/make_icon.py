"""Generate JetPipe icon — gradient 'J' on rounded-square dark tile."""
from PIL import Image, ImageDraw, ImageFont
import sys
from pathlib import Path

SIZE = 1024
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("jetpipe-icon.png")


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def main():
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    # Background: rounded-square dark gradient tile
    tile = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    tdraw = ImageDraw.Draw(tile)
    radius = int(SIZE * 0.22)
    # Solid dark base
    tdraw.rounded_rectangle((0, 0, SIZE, SIZE), radius=radius, fill=(15, 15, 18, 255))

    # Diagonal cyan→violet gradient overlay inside the rounded tile
    grad = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(grad)
    cyan = (34, 211, 238)
    violet = (168, 85, 247)
    for y in range(SIZE):
        for x in range(0, SIZE, 8):
            t = (x + y) / (SIZE * 2)
            color = lerp(cyan, violet, t)
            gdraw.rectangle((x, y, x + 8, y + 1), fill=color + (255,))
    # Mask to rounded square
    mask = Image.new("L", (SIZE, SIZE), 0)
    mdraw = ImageDraw.Draw(mask)
    mdraw.rounded_rectangle((0, 0, SIZE, SIZE), radius=radius, fill=255)
    tile.paste(grad, (0, 0), mask)

    img = Image.alpha_composite(img, tile)

    # Draw a stylized 'J' (we use a heavy sans font; fall back gracefully)
    draw = ImageDraw.Draw(img)
    font_paths = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/SFNS.ttf",
        "/Library/Fonts/Arial Bold.ttf",
    ]
    font = None
    for fp in font_paths:
        try:
            font = ImageFont.truetype(fp, int(SIZE * 0.72))
            break
        except Exception:
            continue
    if font is None:
        font = ImageFont.load_default()

    text = "J"
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (SIZE - tw) // 2 - bbox[0]
    y = (SIZE - th) // 2 - bbox[2] // 16 - bbox[1]
    # Subtle drop shadow
    draw.text((x + 6, y + 8), text, fill=(0, 0, 0, 80), font=font)
    draw.text((x, y), text, fill=(10, 10, 12, 255), font=font)

    img.save(OUT, "PNG")
    print(f"wrote {OUT} ({SIZE}x{SIZE})")


if __name__ == "__main__":
    main()
