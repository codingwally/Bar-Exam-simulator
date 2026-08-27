from __future__ import annotations

from math import ceil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
SCREENSHOTS = ROOT / "docs" / "examination-room-v1" / "screenshots"
VIDEOS = ROOT / "docs" / "examination-room-v1" / "videos"
CURRENT = SCREENSHOTS
OUTPUT = SCREENSHOTS / "all-pages-contact-sheet.png"

PAGES = [
    (CURRENT / "current-creator-create-full.jpg", "Creator - One-page exam builder", (0, 0, 1264, 760)),
    (
        CURRENT / "current-creator-create-full.jpg",
        "Creator - Admission and optional safeguards",
        (0, 3800, 1264, 4750),
    ),
    (CURRENT / "current-creator-create-full.jpg", "Creator - Publish and request key", (0, 0, 1264, 760)),
    (VIDEOS / "professor-frames" / "006-waiting-key.png", "Creator - Waiting for Admin approval", None),
    (CURRENT / "current-creator-monitor.jpg", "Creator - Monitor auto-unlocked", None),
    (VIDEOS / "professor-frames" / "010-student-submitted.png", "Creator - Real-name submission", None),
    (CURRENT / "current-creator-grade.jpg", "Creator - Grading", (0, 0, 319, 1450)),
    (VIDEOS / "professor-frames" / "012-offline-grading.png", "Creator - Encrypted offline copy", None),
    (CURRENT / "current-admin-key-issued.jpg", "Admin - Active exact student key", None),
    (CURRENT / "current-student-preview.jpg", "Student - Key and identity", (0, 0, 804, 760)),
    (CURRENT / "current-student-preview.jpg", "Student - Preview, then begin", (0, 1280, 804, 2220)),
    (CURRENT / "current-student-exam.jpg", "Student - Examination workspace", (0, 0, 804, 1150)),
    (SCREENSHOTS / "student-offline-refresh-recovered.png", "Student - Disconnected refresh recovered", None),
    (CURRENT / "current-student-result.jpg", "Student - Signed receipt", (160, 100, 1040, 810)),
    (CURRENT / "current-student-result.jpg", "Student - Released result", (160, 570, 1040, 1450)),
]

COLS = 3
CELL_W = 760
CELL_H = 560
GAP = 24
MARGIN = 34
HEADER_H = 116
ROWS = ceil(len(PAGES) / COLS)
WIDTH = MARGIN * 2 + COLS * CELL_W + (COLS - 1) * GAP
HEIGHT = HEADER_H + MARGIN + ROWS * CELL_H + (ROWS - 1) * GAP + MARGIN


def font(path: str, size: int):
    try:
        return ImageFont.truetype(path, size=size)
    except OSError:
        return ImageFont.load_default()


TITLE = font(r"C:\Windows\Fonts\georgiab.ttf", 34)
SUBTITLE = font(r"C:\Windows\Fonts\segoeui.ttf", 17)
LABEL = font(r"C:\Windows\Fonts\segoeuib.ttf", 19)


def main() -> None:
    missing = [str(path) for path, _, _ in PAGES if not path.exists()]
    if missing:
        raise FileNotFoundError("Missing page atlas images:\n" + "\n".join(missing))

    atlas = Image.new("RGB", (WIDTH, HEIGHT), (246, 243, 236))
    draw = ImageDraw.Draw(atlas)
    draw.rectangle((0, 0, WIDTH, HEADER_H), fill=(5, 20, 39))
    draw.rectangle((0, HEADER_H - 4, WIDTH, HEADER_H), fill=(201, 163, 83))
    draw.text((MARGIN, 24), "DueDiligence.ph Examination Room", font=TITLE, fill=(255, 252, 244))
    draw.text((MARGIN, 73), "Verified page atlas · professor, administrator, and student journeys", font=SUBTITLE, fill=(211, 220, 230))

    image_box_h = CELL_H - 56
    for index, (path, label, crop) in enumerate(PAGES):
        row, col = divmod(index, COLS)
        left = MARGIN + col * (CELL_W + GAP)
        top = HEADER_H + MARGIN + row * (CELL_H + GAP)
        draw.rounded_rectangle((left, top, left + CELL_W, top + CELL_H), radius=14, fill=(255, 253, 248), outline=(203, 193, 174), width=2)
        with Image.open(path) as opened:
            image = opened.convert("RGB")
            if crop:
                image = image.crop(crop)
            image.thumbnail((CELL_W - 20, image_box_h - 18), Image.Resampling.LANCZOS)
            x = left + (CELL_W - image.width) // 2
            y = top + 10 + (image_box_h - 18 - image.height) // 2
            atlas.paste(image, (x, y))
        draw.line((left + 1, top + image_box_h, left + CELL_W - 1, top + image_box_h), fill=(220, 213, 201), width=2)
        draw.text((left + 18, top + image_box_h + 15), label, font=LABEL, fill=(5, 20, 39))

    atlas.save(OUTPUT, "PNG", optimize=True)
    print(f"created {OUTPUT} ({WIDTH}x{HEIGHT})")


if __name__ == "__main__":
    main()
