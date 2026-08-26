from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[3]
VIDEO_DIR = ROOT / "docs" / "examination-room-v1" / "videos"
SCREENSHOT_DIR = ROOT / "docs" / "examination-room-v1" / "screenshots"
WIDTH = 1488
HEIGHT = 1060
FPS = 12
HOLD_SECONDS = 1.85
FADE_SECONDS = 0.40
NAVY = (5, 20, 39, 235)
GOLD = (203, 164, 84, 255)
CREAM = (255, 252, 244, 255)
MUTED = (213, 220, 229, 255)


PROFESSOR_STEPS = [
    (VIDEO_DIR / "professor-frames" / "001-create.png", "Prepare the examination on one familiar scrolling page"),
    (VIDEO_DIR / "professor-frames" / "002-roster.png", "Confirm the real-name student roster"),
    (VIDEO_DIR / "professor-frames" / "003-safety.png", "Choose only the safeguards the professor wants"),
    (VIDEO_DIR / "professor-frames" / "004-preview.png", "Preview exactly what students will receive"),
    (VIDEO_DIR / "professor-frames" / "005-publish-review.png", "Run the final control check and publish"),
    (VIDEO_DIR / "professor-frames" / "006-waiting-key.png", "Wait for the administrator's room key"),
    (VIDEO_DIR / "professor-frames" / "007-key-issued.png", "Receive the administrator-issued key"),
    (VIDEO_DIR / "professor-frames" / "008-room-open.png", "Enter the key and open the room"),
    (VIDEO_DIR / "professor-frames" / "009-room-open.png", "Monitor real names and integrity signals"),
    (VIDEO_DIR / "professor-frames" / "010-student-submitted.png", "See submissions and recovery events as they arrive"),
    (VIDEO_DIR / "professor-frames" / "011-grading-complete.png", "Grade every response and save durable revisions"),
    (VIDEO_DIR / "professor-frames" / "012-offline-grading.png", "Create a passphrase-protected offline grading copy"),
    (VIDEO_DIR / "professor-frames" / "012-results-released.png", "Release only the selected, fully graded results"),
]


STUDENT_STEPS = [
    (VIDEO_DIR / "student-frames" / "001-entry.png", "Enter the administrator-issued room key"),
    (VIDEO_DIR / "student-frames" / "002-identity.png", "Confirm real name, student number, year, and subject"),
    (VIDEO_DIR / "student-frames" / "003-preview.png", "Preview exam metadata while questions stay sealed"),
    (VIDEO_DIR / "student-frames" / "004-privacy.png", "Agree to the required versioned privacy notice"),
    (VIDEO_DIR / "student-frames" / "005-question-1.png", "Begin in a calm, protected examination workspace"),
    (VIDEO_DIR / "student-frames" / "006-answer-1.png", "Write and save the first answer"),
    (VIDEO_DIR / "student-frames" / "007-answer-2.png", "Continue while every change is saved"),
    (VIDEO_DIR / "student-frames" / "008-answer-3-flagged.png", "Flag an answer for review without losing work"),
    (VIDEO_DIR / "student-frames" / "009-answer-4.png", "Finish all questions and review completion"),
    (SCREENSHOT_DIR / "student-submission-receipt.png", "Submit and receive a signed receipt"),
    (SCREENSHOT_DIR / "student-result-released-final.png", "Return to see the professor-released score and feedback"),
]


def load_font(path: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    try:
        return ImageFont.truetype(path, size=size)
    except OSError:
        return ImageFont.load_default()


LABEL_FONT = load_font(r"C:\Windows\Fonts\segoeuib.ttf", 17)
CAPTION_FONT = load_font(r"C:\Windows\Fonts\segoeui.ttf", 25)
STEP_FONT = load_font(r"C:\Windows\Fonts\segoeuib.ttf", 20)


def prepare_frame(source: Path, caption: str, step: int, total: int) -> Image.Image:
    if not source.exists():
        raise FileNotFoundError(f"Missing walkthrough frame: {source}")

    with Image.open(source) as opened:
        image = opened.convert("RGB")
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


def encode_video(name: str, steps: list[tuple[Path, str]], ffmpeg_exe: str) -> Path:
    output = VIDEO_DIR / f"{name}-walkthrough.mp4"
    hold_frames = round(HOLD_SECONDS * FPS)
    fade_frames = round(FADE_SECONDS * FPS)

    prepared = [prepare_frame(path, caption, index, len(steps)) for index, (path, caption) in enumerate(steps, 1)]
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
