"""Generate fictional roster screenshots with a known truth set."""
from datetime import date, timedelta
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT = Path("public/fixtures")
OUT.mkdir(parents=True, exist_ok=True)
FONT_ROOT = Path("/usr/share/fonts/truetype/dejavu")
DAY = ["Avery", "Blair", "Casey", "Drew", "Emery", "Frankie", "Gray", "Harper", "Indigo", "Jamie"]
NIGHT = ["Jordan", "Morgan", "Parker", "Quinn", "Riley", "Sam", "Taylor"]

def font(size, bold=False):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    try:
        return ImageFont.truetype(str(FONT_ROOT / name), size)
    except OSError:
        return ImageFont.truetype(name, size)

def assignments(day_number):
    return {
        "D": [DAY[(day_number * 4 + index) % len(DAY)] for index in range(4)],
        "N": [NIGHT[(day_number * 3 + index) % len(NIGHT)] for index in range(3)],
    }

def main():
    start = date(2026, 11, 8)
    truth = []
    files = []
    for page in range(10):
        offsets = range(page * 3, page * 3 + 4)
        rows = [(start + timedelta(days=i), assignments(i)) for i in offsets]
        image = Image.new("RGB", (1340, 550), "#ffffff")
        draw = ImageDraw.Draw(image)
        draw.text((48, 27), "RESPIRATORY CARE   /   FICTIONAL TRAINING ROSTER", fill="#17372f", font=font(27, True))
        draw.text((48, 72), f"Source page {page + 1:02d} / 10", fill="#364b43", font=font(22))
        columns = [48, 270, 800]
        draw.rectangle((35, 125, 1304, 177), fill="#edf3ef")
        for x, label in zip(columns, ["DATE", "DAY SHIFT", "NIGHT SHIFT"]):
            draw.text((x, 137), label, fill="#152d24", font=font(26, True))
        for row_index, (day, cells) in enumerate(rows):
            y = 194 + row_index * 78
            draw.line((35, y + 58, 1304, y + 58), fill="#d7e2d9", width=2)
            values = [day.isoformat(), " / ".join(cells["D"]), " / ".join(cells["N"])]
            for x, value in zip(columns, values):
                draw.text((x, y), value, fill="#172b26", font=font(28))
            if row_index < 3 or page == 9:
                for shift, names in cells.items():
                    truth.extend({"date": day.isoformat(), "shift": shift, "person": name} for name in names)
        file = f"schedule-{page + 1:02d}.png"
        image.save(OUT / file, optimize=True)
        files.append(file)
    (OUT / "manifest.json").write_text(json.dumps({"files": files, "truth": truth}, indent=2) + "\n")

if __name__ == "__main__":
    main()
