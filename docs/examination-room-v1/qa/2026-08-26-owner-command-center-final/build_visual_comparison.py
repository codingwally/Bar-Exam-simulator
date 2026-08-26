from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[4]
REFERENCE = ROOT / "docs" / "visual-references" / "examination-room-v1" / "counsels-canvas-selected.png"
CURRENT = Path(__file__).with_name("23-professor-create-post-continuity.png")
OUTPUT = Path(__file__).with_name("24-reference-vs-post-continuity.png")


def font(size: int):
    candidates = [
        Path("C:/Windows/Fonts/seguisb.ttf"),
        Path("C:/Windows/Fonts/arialbd.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    return ImageFont.load_default()


reference = Image.open(REFERENCE).convert("RGB")
current = Image.open(CURRENT).convert("RGB")
if current.size != reference.size:
    # The in-app browser capture omits its 15 px vertical and 10 px horizontal
    # scrollbar chrome. Crop the approved reference to the identical rendered
    # content area; never stretch either product image during visual QA.
    reference = reference.crop((0, 0, current.width, current.height))

header_height = 64
gutter = 8
canvas = Image.new(
    "RGB",
    (reference.width * 2 + gutter, reference.height + header_height),
    "#f4f0e8",
)
canvas.paste(reference, (0, header_height))
canvas.paste(current, (reference.width + gutter, header_height))
draw = ImageDraw.Draw(canvas)
label_font = font(25)
draw.rectangle((0, 0, canvas.width, header_height), fill="#061d33")
draw.text((24, 16), "APPROVED REFERENCE", fill="#f2d27a", font=label_font)
draw.text((reference.width + gutter + 24, 16), "CURRENT VERIFIED BUILD", fill="#f2d27a", font=label_font)
canvas.save(OUTPUT, quality=95)
print(OUTPUT)
