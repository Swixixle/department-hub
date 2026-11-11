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

def calendar_pages():
    """A printed month calendar like a paper schedule: weekday header, short dates, names in capitals,
    highlighter for roles, one partial shift, and names struck out with a handwritten replacement."""
    start = date(2026, 11, 29)
    pink, green, blue = "#f6b6c9", "#bfe3b4", "#4f97c9"
    truth, struck = [], []
    for shift, people, per_cell, file in (("D", DAY, 4, "calendar-day.png"), ("N", NIGHT, 3, "calendar-night.png")):
        image = Image.new("RGB", (1900, 1300), "#fbfaf7")
        draw = ImageDraw.Draw(image)
        left, top, width, height = 60, 110, 254, 285
        if shift == "N":
            draw.text((250, 40), "Night", fill="#333333", font=font(40))
        for column, name in enumerate(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]):
            draw.rectangle((left + column * width, top - 50, left + (column + 1) * width, top), outline="#555555", width=2)
            draw.text((left + column * width + 90, top - 42), name, fill="#333333", font=font(26))
        for week in range(4):
            for column in range(7):
                offset = week * 7 + column
                day = start + timedelta(days=offset)
                x, y = left + column * width, top + week * height
                draw.rectangle((x, y, x + width, y + height), outline="#555555", width=2)
                draw.text((x + 12, y + 8), f"{day.month}/{day.day}", fill="#111111", font=font(27, True))
                names = [people[(offset * per_cell + index) % len(people)] for index in range(per_cell)]
                for index, name in enumerate(names):
                    text, ty = name.upper(), y + 48 + index * 46
                    hours = "7-3" if offset % 9 == 4 and index == per_cell - 1 else None
                    label = text + (" " + hours if hours else "")
                    span = draw.textlength(label, font=font(27))
                    tint = blue if hours else pink if index == 0 else green if index == 1 else None
                    if tint:
                        draw.rectangle((x + 8, ty - 2, x + 20 + span, ty + 34), fill=tint)
                    draw.text((x + 12, ty), label, fill="#141414", font=font(27))
                    if offset % 11 == 6 and index == 2:
                        draw.line((x + 8, ty + 19, x + 18 + span, ty + 15), fill="#141414", width=3)
                        draw.text((x + 26 + span, ty + 2), "Lee Jn", fill="#30303a", font=font(24))
                        struck.append(day.isoformat() + "|" + shift)
                        continue
                    entry = {"date": day.isoformat(), "shift": shift, "person": name}
                    if index < 2 and not hours:
                        entry["role"] = "charge" if index == 0 else "icu"
                    if hours:
                        entry["hours"] = hours
                    truth.append(entry)
        image.save(OUT / file, optimize=True)
    (OUT / "calendar.json").write_text(json.dumps({"files": ["calendar-day.png", "calendar-night.png"], "truth": truth, "struck": struck}, indent=2) + "\n")

if __name__ == "__main__":
    main()
    calendar_pages()
