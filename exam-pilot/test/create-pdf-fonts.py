"""Regenerate the static PDF instances from the existing licensed brand fonts.

One-time maintainer tool: pip install fonttools brotli. Deployment and browser
export need neither Python nor a font download.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1] / "public" / "fonts"
for family, weight in [("inter", 400), ("fraunces", 500)]:
    font = TTFont(root / f"{family}.woff2")
    axes = {axis.axisTag: axis.defaultValue for axis in font["fvar"].axes}
    axes["wght"] = weight
    font = instantiateVariableFont(font, axes, inplace=True)
    font.flavor = None
    font.save(root / f"{family}-pdf.ttf")
