from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
VIDEO_DIR = ROOT / "docs" / "examination-room-v1" / "videos"
SCREENSHOT_DIR = ROOT / "docs" / "examination-room-v1" / "screenshots"
CURRENT_DIR = SCREENSHOT_DIR
WIDTH = 1488
HEIGHT = 1060
FPS = 12
HOLD_SECONDS = 1.85
FADE_SECONDS = 0.0
NAVY = (5, 20, 39, 235)
GOLD = (203, 164, 84, 255)
CREAM = (255, 252, 244, 255)
MUTED = (213, 220, 229, 255)


PROFESSOR_STEPS = [
    (CURRENT_DIR / "current-creator-create-full.jpg", "Prepare the examination on one familiar scrolling page", (0, 0, 1264, 760)),
    (CURRENT_DIR / "current-creator-create-full.jpg", "Review questions and instructions before publication", (0, 1800, 1264, 3100)),
    (CURRENT_DIR / "current-creator-create-full.jpg", "Publish and request the student key when ready", (0, 0, 1264, 760)),
    (CURRENT_DIR / "current-admin-key-issued.jpg", "Admin approval issues and activates the exact student key", None),
    (CURRENT_DIR / "current-creator-monitor.jpg", "Monitor and Grade unlock automatically - no creator key entry", None),
    (VIDEO_DIR / "professor-frames" / "010-student-submitted.png", "See real names, submissions, and recovery events as they arrive", None),
    (CURRENT_DIR / "current-creator-grade.jpg", "Grade every response and save durable revisions", (0, 0, 319, 1450)),
    (VIDEO_DIR / "professor-frames" / "012-offline-grading.png", "Create a passphrase-protected offline grading copy", None),
    (CURRENT_DIR / "current-student-result.jpg", "Release selected, fully graded results", (160, 560, 1040, 1120)),
]


STUDENT_STEPS = [
    (CURRENT_DIR / "current-student-preview.jpg", "Enter the active student key and real school-record identity", (0, 0, 804, 760)),
    (CURRENT_DIR / "current-student-preview.jpg", "Preview exam metadata, then begin - no extra agreement step", (0, 1280, 804, 2220)),
    (CURRENT_DIR / "current-student-exam.jpg", "Begin in a calm examination workspace", (0, 0, 804, 1150)),
    (VIDEO_DIR / "student-frames" / "006-answer-1.png", "Write and save the first answer", None),
    (VIDEO_DIR / "student-frames" / "007-answer-2.png", "Continue while every change is saved", None),
    (VIDEO_DIR / "student-frames" / "008-answer-3-flagged.png", "Flag an answer for review without losing work", None),
    (VIDEO_DIR / "student-frames" / "009-answer-4.png", "Finish all questions and review completion", None),
    (CURRENT_DIR / "current-student-result.jpg", "Submit once and keep the signed receipt", (160, 100, 1040, 650)),
    (CURRENT_DIR / "current-student-result.jpg", "Return to see the creator-released score and feedback", (160, 560, 1040, 1120)),
]


def load_font(path: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(path, size=size)
    except OSError:
        return ImageFont.load_default()


LABEL_FONT = load_font(r"C:\Windows\Fonts\segoeuib.ttf", 17)
CAPTION_FONT = load_font(r"C:\Windows\Fonts\segoeui.ttf", 25)
STEP_FONT = load_font(r"C:\Windows\Fonts\segoeuib.ttf", 20)


def prepare_frame(
    source: Path,
    caption: str,
    step: int,
    total: int,
    crop: tuple[int, int, int, int] | None = None,
) -> Image.Image:
    if not source.exists():
        raise FileNotFoundError(f"Missing walkthrough frame: {source}")

    with Image.open(source) as opened:
        image = opened.convert("RGB")
        if crop:
            image = image.crop(crop)
        scale = min(WIDTH / image.width, HEIGHT / image.height)
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.Resampling.LANCZOS,
        )
        canvas = Image.new("RGB", (WIDTH, HEIGHT), (249, 247, 242))
        x = (WIDTH - image.width) // 2
        y = (HEIGHT - image.height) // 2
        canvas.paste(image, (x, y))

    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    top = HEIGHT - 112
    draw.rounded_rectangle((24, top, WIDTH - 24, HEIGHT - 24), radius=14, fill=NAVY, outline=GOLD, width=2)
    draw.rectangle((47, top + 20, 51, HEIGHT - 44), fill=GOLD)
    draw.text((70, top + 17), "LIVE PRODUCT WALKTHROUGH", font=LABEL_FONT, fill=GOLD)
    draw.text((70, top + 45), caption, font=CAPTION_FONT, fill=CREAM)
    step_text = f"{step:02d} / {total:02d}"
    step_width = draw.textbbox((0, 0), step_text, font=STEP_FONT)[2]
    draw.text((WIDTH - 55 - step_width, top + 37), step_text, font=STEP_FONT, fill=MUTED)
    return Image.alpha_composite(canvas.convert("RGBA"), overlay).convert("RGB")


def encode_video(name: str, steps: list[tuple[Path, str, tuple[int, int, int, int] | None]], ffmpeg_exe: str) -> Path:
    output = VIDEO_DIR / f"{name}-walkthrough.mp4"
    hold_frames = round(HOLD_SECONDS * FPS)
    fade_frames = round(FADE_SECONDS * FPS)

    prepared = [
        prepare_frame(path, caption, index, len(steps), crop)
        for index, (path, caption, crop) in enumerate(steps, 1)
    ]
    command = [
        ffmpeg_exe,
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s:v",
        f"{WIDTH}x{HEIGHT}",
        "-r",
        str(FPS),
        "-i",
        "-",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(output),
    ]

    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert process.stdin is not None
    try:
        for index, current in enumerate(prepared):
            for _ in range(hold_frames):
                process.stdin.write(current.tobytes())
            if index < len(prepared) - 1:
                upcoming = prepared[index + 1]
                for transition_index in range(1, fade_frames + 1):
                    mixed = Image.blend(current, upcoming, transition_index / (fade_frames + 1))
                    process.stdin.write(mixed.tobytes())
        process.stdin.close()
        return_code = process.wait()
    except Exception:
        process.kill()
        raise

    if return_code != 0:
        raise RuntimeError(f"ffmpeg failed for {name} with exit code {return_code}")
    return output


def main() -> int:
    dependency_dir = Path(r"C:\Users\wally\AppData\Local\Temp\duediligence-video-deps-20260826")
    sys.path.insert(0, str(dependency_dir))
    import imageio_ffmpeg

    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    outputs = [
        encode_video("professor", PROFESSOR_STEPS, ffmpeg_exe),
        encode_video("student", STUDENT_STEPS, ffmpeg_exe),
    ]
    for output in outputs:
        print(f"created {output} ({output.stat().st_size} bytes)")
    print(f"ffmpeg {ffmpeg_exe}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
