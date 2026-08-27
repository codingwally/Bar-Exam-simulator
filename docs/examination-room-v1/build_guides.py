from __future__ import annotations

import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Paragraph


ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / "docs" / "examination-room-v1"
LEGACY_SCREENSHOTS = DOCS / "screenshots"
CURRENT = LEGACY_SCREENSHOTS
OUTPUT = ROOT / "output" / "pdf"
RENDERS = OUTPUT / "renders"

PAGE_W, PAGE_H = A4
MARGIN = 40
NAVY = HexColor("#07192B")
NAVY_2 = HexColor("#10283A")
GOLD = HexColor("#CDAA5C")
CREAM = HexColor("#F7F2E8")
PAPER = HexColor("#FFFDF8")
INK = HexColor("#102033")
MUTED = HexColor("#596879")
LINE = HexColor("#D8D0C0")
GREEN = HexColor("#2F7D5B")
RED = HexColor("#A64949")


def register_fonts() -> None:
    candidates = {
        "Body": Path(r"C:\Windows\Fonts\segoeui.ttf"),
        "Body-Bold": Path(r"C:\Windows\Fonts\segoeuib.ttf"),
        "Display": Path(r"C:\Windows\Fonts\georgia.ttf"),
        "Display-Bold": Path(r"C:\Windows\Fonts\georgiab.ttf"),
    }
    for name, path in candidates.items():
        if path.exists():
            pdfmetrics.registerFont(TTFont(name, str(path)))


register_fonts()


@dataclass(frozen=True)
class Screenshot:
    path: Path
    caption: str
    crop: tuple[int, int, int, int] | None = None


@dataclass(frozen=True)
class Guide:
    slug: str
    audience: str
    title: str
    subtitle: str
    steps: tuple[tuple[str, str], ...]
    activation_note: str
    flow: tuple[tuple[str, str], ...]
    help_items: tuple[tuple[str, str], ...]
    first_shot: Screenshot
    second_shot: Screenshot


GUIDES = (
    Guide(
        slug="professor",
        audience="PROFESSOR / CREATOR",
        title="Create, monitor, and grade",
        subtitle="A familiar one-page workflow for every signed-in creator.",
        steps=(
            ("Open", "Sign in, choose Examination Room, then enter the Creator door. No professor-role approval is required."),
            ("Build", "Add questions directly or upload a source. Set duration, navigation, identity, admission, and optional safeguards."),
            ("Publish", "Save as often as needed. Preview, publish, and request the student key when the examination is ready."),
            ("Run", "After Admin approval, Monitor and Grade unlock automatically. Share the student key, monitor, grade, and release."),
        ),
        activation_note="Admin approval and key issuance are the final activation step. The creator never enters the key or opens the room separately.",
        flow=(
            ("1. Publish", "Preview and request a key"),
            ("2. Admin approves", "Student key becomes active"),
            ("3. Monitor", "Real names and saves appear"),
            ("4. Grade", "Save feedback and release"),
        ),
        help_items=(
            ("No dates required", "The active student key controls entry; there is no creator date or start-time field."),
            ("Default admission", "Anyone with the student key may enter. Use the optional email list only when you need it."),
            ("Connection loss", "Student answers continue saving locally and synchronize when service returns."),
        ),
        first_shot=Screenshot(
            CURRENT / "current-creator-create-full.jpg",
            "Current creator page: questions, controls, and the contextual Examination Assistant stay together.",
            (0, 0, 1264, 760),
        ),
        second_shot=Screenshot(
            CURRENT / "current-creator-monitor.jpg",
            "Current Monitor view immediately after Admin key issuance: Student key active - monitoring ready.",
        ),
    ),
    Guide(
        slug="student",
        audience="STUDENT",
        title="Enter, answer, and submit",
        subtitle="Use the student key, confirm your identity, and begin.",
        steps=(
            ("Enter", "Open the Student door. Enter the student key, real name, student number, subject, and year level."),
            ("Preview", "Check the examination title, duration, questions, and safeguards. Questions remain sealed until you begin."),
            ("Answer", "Write, navigate when allowed, and flag items for review. Your work saves locally first and then synchronizes."),
            ("Submit", "Review completion, submit once, keep the signed receipt, and return when the creator releases the result."),
        ),
        activation_note="Only the signed-in session and active student key are needed. An email is entered only for a creator's optional email-limited room.",
        flow=(
            ("1. Key + identity", "Use your school-record details"),
            ("2. Preview", "Confirm exam information"),
            ("3. Answer", "Autosave, navigate, and review"),
            ("4. Submit", "Receipt now, result later"),
        ),
        help_items=(
            ("Disconnected", "Keep the page open. Saved answers remain recoverable and synchronize after reconnection."),
            ("Not admitted", "Recheck the key and identity. Add email only if the creator limited admission to listed emails."),
            ("After submission", "Keep the receipt reference. Use Check for result after the creator releases grades."),
        ),
        first_shot=Screenshot(
            CURRENT / "current-student-preview.jpg",
            "Current preview leads directly to Begin examination - no additional agreement screen.",
            (0, 1280, 804, 2220),
        ),
        second_shot=Screenshot(
            CURRENT / "current-student-exam.jpg",
            "Current examination workspace immediately after Begin examination.",
            (0, 0, 804, 1150),
        ),
    ),
    Guide(
        slug="admin",
        audience="OWNER ADMIN",
        title="Approve and operate every room",
        subtitle="One command center for keys, lifecycle, recovery, questions, answers, and grades.",
        steps=(
            ("Review", "Open Admin > Examination Room. Select a creator's published examination and review its stored version."),
            ("Approve", "Approve and generate the student key. This is the final activation step and immediately unlocks Creator Monitor and Grade."),
            ("Deliver", "Copy or email the visible key to the creator. Keep the Admin copy available for support and recovery."),
            ("Operate", "Inspect the room, questions, students, answers, grades, delivery, and recovery; rotate, revoke, close, or delete when needed."),
        ),
        activation_note="Key issuance is immediate activation. Do not ask the creator to enter a key or perform a separate Open room step.",
        flow=(
            ("1. Select request", "Open the published version"),
            ("2. Approve + key", "Activate in one action"),
            ("3. Deliver", "Copy or email the exact key"),
            ("4. Control", "Inspect, recover, close, or delete"),
        ),
        help_items=(
            ("Email unavailable", "Copy the visible key and send it through the school's approved channel; the room remains active."),
            ("Key problem", "Refresh status, then rotate or revoke the key. Never edit the examination version to repair a key."),
            ("Delete safely", "Delete removes the room from active workspaces while its recoverable record remains preserved."),
        ),
        first_shot=Screenshot(
            CURRENT / "current-admin-key-issued.jpg",
            "Current owner command center: exact active key, Close room, and Delete examination are visible.",
        ),
        second_shot=Screenshot(
            CURRENT / "current-admin-key-issued.jpg",
            "Current exact-key and lifecycle controls remain visible inside the selected examination.",
            (260, 100, 1425, 802),
        ),
    ),
)


def paragraph(canvas: Canvas, text: str, x: float, top: float, width: float, style: ParagraphStyle) -> float:
    item = Paragraph(text, style)
    _, height = item.wrap(width, PAGE_H)
    item.drawOn(canvas, x, top - height)
    return height


def footer(canvas: Canvas, guide: Guide, page_number: int) -> None:
    canvas.setStrokeColor(LINE)
    canvas.line(MARGIN, 34, PAGE_W - MARGIN, 34)
    canvas.setFont("Body", 8.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, 20, "DueDiligence.ph | Examination Room")
    canvas.drawRightString(PAGE_W - MARGIN, 20, f"{guide.audience.title()} | Page {page_number} of 2")


def hero(canvas: Canvas, guide: Guide, compact: bool = False) -> None:
    height = 104 if compact else 146
    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_H - height, PAGE_W, height, stroke=0, fill=1)
    canvas.setFillColor(GOLD)
    canvas.rect(0, PAGE_H - height, 7, height, stroke=0, fill=1)
    canvas.setFont("Body-Bold", 9.5)
    canvas.drawString(MARGIN, PAGE_H - 34, guide.audience)
    canvas.setFont("Display-Bold", 25 if compact else 31)
    canvas.setFillColor(PAPER)
    canvas.drawString(MARGIN, PAGE_H - (68 if compact else 76), guide.title)
    if not compact:
        canvas.setFont("Body", 12.5)
        canvas.setFillColor(HexColor("#DCE5EC"))
        canvas.drawString(MARGIN, PAGE_H - 108, guide.subtitle)
        canvas.setFont("Body-Bold", 9)
        canvas.setFillColor(GOLD)
        canvas.drawRightString(PAGE_W - MARGIN, PAGE_H - 34, "QUICK START | 2 PAGES")


def prepare_image(source: Screenshot, temp_dir: Path) -> Path:
    if not source.path.exists():
        raise FileNotFoundError(f"Missing guide screenshot: {source.path}")
    with Image.open(source.path) as opened:
        image = opened.convert("RGB")
        if source.crop:
            left, top, right, bottom = source.crop
            left = max(0, min(left, image.width - 1))
            top = max(0, min(top, image.height - 1))
            right = max(left + 1, min(right, image.width))
            bottom = max(top + 1, min(bottom, image.height))
            image = image.crop((left, top, right, bottom))
        output = temp_dir / f"{source.path.stem}-{abs(hash(source.crop))}.jpg"
        image.save(output, "JPEG", quality=92, optimize=True)
        return output


def draw_screenshot(canvas: Canvas, source: Screenshot, temp_dir: Path, x: float, y: float, width: float, height: float) -> None:
    prepared = prepare_image(source, temp_dir)
    with Image.open(prepared) as opened:
        image_w, image_h = opened.size
    scale = min(width / image_w, height / image_h)
    draw_w, draw_h = image_w * scale, image_h * scale
    draw_x = x + (width - draw_w) / 2
    draw_y = y + (height - draw_h) / 2
    canvas.setFillColor(PAPER)
    canvas.roundRect(x - 7, y - 7, width + 14, height + 14, 8, stroke=0, fill=1)
    canvas.setStrokeColor(LINE)
    canvas.roundRect(x - 7, y - 7, width + 14, height + 14, 8, stroke=1, fill=0)
    canvas.drawImage(ImageReader(str(prepared)), draw_x, draw_y, draw_w, draw_h, preserveAspectRatio=True, mask="auto")


BODY = ParagraphStyle("body", fontName="Body", fontSize=10.5, leading=14, textColor=INK, alignment=TA_LEFT)
BODY_SMALL = ParagraphStyle("body-small", fontName="Body", fontSize=9.3, leading=12, textColor=MUTED)
STEP_TITLE = ParagraphStyle("step-title", fontName="Body-Bold", fontSize=13.2, leading=15, textColor=INK)
STEP_BODY = ParagraphStyle("step-body", fontName="Body", fontSize=9.4, leading=12.2, textColor=MUTED)
NOTE = ParagraphStyle("note", fontName="Body-Bold", fontSize=10.3, leading=13.5, textColor=NAVY)


def draw_step_card(canvas: Canvas, number: int, title: str, body: str, x: float, y: float, width: float, height: float) -> None:
    canvas.setFillColor(PAPER)
    canvas.setStrokeColor(LINE)
    canvas.roundRect(x, y, width, height, 9, stroke=1, fill=1)
    canvas.setFillColor(GOLD)
    canvas.circle(x + 24, y + height - 24, 14, stroke=0, fill=1)
    canvas.setFillColor(NAVY)
    canvas.setFont("Body-Bold", 11)
    canvas.drawCentredString(x + 24, y + height - 28, str(number))
    paragraph(canvas, title, x + 46, y + height - 13, width - 56, STEP_TITLE)
    paragraph(canvas, body, x + 16, y + height - 48, width - 32, STEP_BODY)


def draw_first_page(canvas: Canvas, guide: Guide, temp_dir: Path) -> None:
    canvas.setFillColor(CREAM)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    hero(canvas, guide)
    canvas.setFont("Display-Bold", 18)
    canvas.setFillColor(NAVY)
    canvas.drawString(MARGIN, 672, "Start here")
    card_w = (PAGE_W - 2 * MARGIN - 14) / 2
    for index, (title, body) in enumerate(guide.steps):
        row, col = divmod(index, 2)
        draw_step_card(canvas, index + 1, title, body, MARGIN + col * (card_w + 14), 544 - row * 122, card_w, 108)
    canvas.setFillColor(HexColor("#F2E5BE"))
    canvas.roundRect(MARGIN, 394, PAGE_W - 2 * MARGIN, 42, 8, stroke=0, fill=1)
    paragraph(canvas, guide.activation_note, MARGIN + 14, 424, PAGE_W - 2 * MARGIN - 28, NOTE)
    draw_screenshot(canvas, guide.first_shot, temp_dir, MARGIN + 7, 94, PAGE_W - 2 * MARGIN - 14, 270)
    canvas.setFont("Body", 9)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, 66, guide.first_shot.caption)
    footer(canvas, guide, 1)
    canvas.showPage()


def draw_flow(canvas: Canvas, guide: Guide, y: float) -> None:
    gap = 12
    box_w = (PAGE_W - 2 * MARGIN - gap * 3) / 4
    for index, (title, body) in enumerate(guide.flow):
        x = MARGIN + index * (box_w + gap)
        canvas.setFillColor(PAPER)
        canvas.setStrokeColor(GOLD if index == 1 else LINE)
        canvas.roundRect(x, y, box_w, 91, 8, stroke=1, fill=1)
        paragraph(canvas, title, x + 10, y + 77, box_w - 20, ParagraphStyle(
            f"flow-title-{index}", fontName="Body-Bold", fontSize=10.4, leading=12.5, textColor=NAVY
        ))
        paragraph(canvas, body, x + 10, y + 51, box_w - 20, ParagraphStyle(
            f"flow-body-{index}", fontName="Body", fontSize=8.7, leading=11, textColor=MUTED
        ))
        if index < 3:
            canvas.setStrokeColor(GOLD)
            canvas.setLineWidth(1.5)
            arrow_x = x + box_w + 2
            canvas.line(arrow_x, y + 46, arrow_x + gap - 4, y + 46)
            canvas.line(arrow_x + gap - 7, y + 49, arrow_x + gap - 4, y + 46)
            canvas.line(arrow_x + gap - 7, y + 43, arrow_x + gap - 4, y + 46)


def draw_help_item(canvas: Canvas, title: str, body: str, x: float, y: float, width: float) -> None:
    canvas.setFillColor(NAVY_2)
    canvas.roundRect(x, y, width, 53, 7, stroke=0, fill=1)
    canvas.setFillColor(GOLD)
    canvas.rect(x, y, 4, 53, stroke=0, fill=1)
    paragraph(canvas, title, x + 14, y + 43, width - 28, ParagraphStyle(
        f"help-title-{title}", fontName="Body-Bold", fontSize=10.2, leading=12, textColor=PAPER
    ))
    paragraph(canvas, body, x + 14, y + 25, width - 28, ParagraphStyle(
        f"help-body-{title}", fontName="Body", fontSize=8.7, leading=10.5, textColor=HexColor("#DCE5EC")
    ))


def draw_second_page(canvas: Canvas, guide: Guide, temp_dir: Path) -> None:
    canvas.setFillColor(CREAM)
    canvas.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    hero(canvas, guide, compact=True)
    canvas.setFont("Display-Bold", 17)
    canvas.setFillColor(NAVY)
    canvas.drawString(MARGIN, 710, "The complete flow")
    draw_flow(canvas, guide, 600)
    draw_screenshot(canvas, guide.second_shot, temp_dir, MARGIN + 7, 302, PAGE_W - 2 * MARGIN - 14, 246)
    canvas.setFont("Body", 9)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, 278, guide.second_shot.caption)
    canvas.setFont("Display-Bold", 16)
    canvas.setFillColor(NAVY)
    canvas.drawString(MARGIN, 246, "If something interrupts the flow")
    for index, (title, body) in enumerate(guide.help_items):
        draw_help_item(canvas, title, body, MARGIN, 177 - index * 61, PAGE_W - 2 * MARGIN)
    footer(canvas, guide, 2)
    canvas.showPage()


def build_pdf(guide: Guide, temp_dir: Path) -> Path:
    output = OUTPUT / f"examination-room-{guide.slug}-guide.pdf"
    canvas = Canvas(str(output), pagesize=A4, pageCompression=1)
    canvas.setTitle(f"DueDiligence.ph Examination Room - {guide.audience.title()} Guide")
    canvas.setAuthor("DueDiligence.ph")
    canvas.setSubject("Two-page Examination Room quick-start guide")
    draw_first_page(canvas, guide, temp_dir)
    draw_second_page(canvas, guide, temp_dir)
    canvas.save()
    return output


def render_pdfs(outputs: Iterable[Path]) -> list[Path]:
    RENDERS.mkdir(parents=True, exist_ok=True)
    for path in RENDERS.glob("*.png"):
        path.unlink()
    executable = shutil.which("pdftoppm")
    if not executable:
        raise RuntimeError("pdftoppm is required to render and verify the guides")
    rendered: list[Path] = []
    for output in outputs:
        prefix = RENDERS / output.stem.replace("examination-room-", "").replace("-guide", "")
        subprocess.run([executable, "-png", "-r", "144", str(output), str(prefix)], check=True)
        rendered.extend(sorted(RENDERS.glob(f"{prefix.name}-*.png")))
    return rendered


def build_contact_sheet(rendered: list[Path]) -> Path:
    if len(rendered) != 6:
        raise RuntimeError(f"Expected six rendered guide pages, found {len(rendered)}")
    thumb_w, thumb_h = 595, 842
    gap, margin, header = 24, 32, 92
    width = margin * 2 + thumb_w * 3 + gap * 2
    height = header + margin + thumb_h * 2 + gap + margin
    sheet = Image.new("RGB", (width, height), (244, 240, 232))
    draw = ImageDraw.Draw(sheet)
    draw.rectangle((0, 0, width, header), fill=(7, 25, 43))
    title_font = ImageFont.truetype(r"C:\Windows\Fonts\georgiab.ttf", 30)
    body_font = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 16)
    draw.text((margin, 19), "DueDiligence.ph Examination Room - quick-start guides", font=title_font, fill=(255, 253, 248))
    draw.text((margin, 58), "Three audiences | two large-font pages each | current activation flow", font=body_font, fill=(205, 170, 92))
    for index, path in enumerate(rendered):
        row, col = divmod(index, 3)
        x = margin + col * (thumb_w + gap)
        y = header + margin + row * (thumb_h + gap)
        with Image.open(path) as opened:
            image = opened.convert("RGB")
            image.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            sheet.paste(image, (x, y))
    output = RENDERS / "all-guides-contact-sheet.png"
    sheet.save(output, "PNG", optimize=True)
    return output


def main() -> int:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    scratch_root = ROOT / "tmp" / "pdfs"
    scratch_root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="examination-room-guides-", dir=scratch_root) as temp:
        temp_dir = Path(temp)
        outputs = [build_pdf(guide, temp_dir) for guide in GUIDES]
    rendered = render_pdfs(outputs)
    contact_sheet = build_contact_sheet(rendered)
    for output in outputs:
        print(f"created {output} ({output.stat().st_size} bytes)")
    for image in rendered:
        with Image.open(image) as opened:
            print(f"rendered {image} ({opened.width}x{opened.height})")
    with Image.open(contact_sheet) as opened:
        print(f"contact sheet {contact_sheet} ({opened.width}x{opened.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
