#!/usr/bin/env python3
"""Regenerate the invented protocol PDFs used by the protocol tests and the "Add the synthetic
training protocol" action.

Optional tool. The PDFs it writes are committed, so no normal build, test or CI step runs this.
It needs Python 3 and reportlab. Output is byte-for-byte reproducible (invariant mode), so a
regeneration that changes nothing leaves the committed digests alone.

Everything here is made up: the device, the unit ("marks per minute"), the roles and every
number. It is test material for software and must never be read as clinical guidance.
"""
import sys
from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas

LABEL = 'Synthetic test material — NOT FOR CLINICAL USE'
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'public' / 'fixtures' / 'protocols'          # shipped: the app can add these two as a worked example
TEST_ONLY = ROOT / 'tests' / 'fixtures' / 'protocols'     # used by the tests only
W, H = letter
LEFT, RIGHT = 72, W - 72


class Page:
    """A page with a running label at the top and bottom and a cursor that moves down."""

    def __init__(self, pdf, number, total, identifier, revision):
        self.pdf, self.y = pdf, H - 96
        pdf.setFont('Helvetica-Bold', 9)
        pdf.drawString(LEFT, H - 44, LABEL)
        pdf.setFont('Helvetica', 8)
        pdf.drawString(LEFT, 40, LABEL)
        pdf.drawRightString(RIGHT, 40, f'{identifier} · Revision {revision} · Page {number} of {total}')

    def heading(self, text, size=13):
        self.y -= 8
        self.pdf.setFont('Helvetica-Bold', size)
        self.pdf.drawString(LEFT, self.y, text)
        self.y -= size + 9

    def para(self, text, size=10.5):
        self.pdf.setFont('Helvetica', size)
        for line in simpleSplit(text, 'Helvetica', size, RIGHT - LEFT):
            self.pdf.drawString(LEFT, self.y, line)
            self.y -= size + 3.5
        self.y -= 9

    def table(self, columns, rows, size=10):
        """A ruled table. Every cell is one line, drawn at a fixed column start."""
        top, step = self.y + 13, 19
        self.pdf.setLineWidth(0.6)
        for index, row in enumerate([[name for name, _ in columns]] + rows):
            self.pdf.setFont('Helvetica-Bold' if index == 0 else 'Helvetica', size)
            for (_, x), cell in zip(columns, row):
                self.pdf.drawString(x + 5, self.y, cell)
            self.pdf.line(LEFT, self.y - 6, RIGHT, self.y - 6)
            self.y -= step
        bottom = self.y + step - 6
        self.pdf.line(LEFT, top, RIGHT, top)
        for x in [x for _, x in columns] + [RIGHT]:
            self.pdf.line(x, top, x, bottom)
        self.y -= 12

    def box(self, x, y, w, text, size=9.5):
        self.pdf.setLineWidth(0.8)
        self.pdf.rect(x, y - 9, w, 26)
        self.pdf.setFont('Helvetica', size)
        self.pdf.drawString(x + 7, y, text)

    def arrow(self, x1, y1, x2, y2, label=None):
        self.pdf.setLineWidth(0.8)
        self.pdf.line(x1, y1, x2, y2)
        if x1 == x2:
            self.pdf.line(x2, y2, x2 - 3, y2 + 5)
            self.pdf.line(x2, y2, x2 + 3, y2 + 5)
        else:
            self.pdf.line(x2, y2, x2 - 5, y2 + 3)
            self.pdf.line(x2, y2, x2 - 5, y2 - 3)
        if label:
            self.pdf.setFont('Helvetica-Oblique', 8.5)
            self.pdf.drawString((x1 + x2) / 2 + (6 if x1 == x2 else -8), (y1 + y2) / 2 + (0 if x1 == x2 else 5), label)


def diagram(page, adult, pediatric, lead):
    """Three questions down the left, each with an outcome to its right. The arrows carry the logic,
    which a text reader cannot see: that is the point of including it."""
    y, left, right = page.y - 8, LEFT + 6, LEFT + 250
    steps = [('Is a drill order on file?', f'No order: do not start. Ask the {lead}.'),
             ('Is the amber seal lamp lit?', 'Lamp lit: do not start.'),
             ('Which age band is the manikin?', None)]
    for index, (question, stop) in enumerate(steps):
        page.box(left, y, 178, question)
        if stop:
            page.box(right, y, 208, stop)
            page.arrow(left + 178, y + 4, right, y + 4, 'No' if index == 0 else 'Yes')
            page.arrow(left + 89, y - 9, left + 89, y - 40, 'Yes' if index == 0 else 'No')
        y -= 66
    y += 66
    page.box(right, y + 14, 208, f'Adult: start at {adult} mk/min.')
    page.box(right, y - 22, 208, f'Pediatric: start at {pediatric} mk/min.')
    page.arrow(left + 178, y + 4, right, y + 18)
    page.arrow(left + 178, y + 4, right, y - 18)
    page.y = y - 50


def protocol(revision):
    """The two revisions differ on purpose: the adult rate, the pediatric recheck, the servicing
    interval and the person to call all change, and an added summary shifts later passages."""
    second = revision == 2
    values = dict(adult='14' if second else '12', adult_top='22' if second else '20', pediatric='6', pediatric_top='10',
                  adult_recheck='10', pediatric_recheck='4' if second else '5', serviced='48' if second else '24',
                  lead='Charge Educator' if second else 'Simulation Lead', effective='1 November 2026' if second else '1 June 2026')
    identifier, total = 'RT-TRAIN-014', 3
    name = f'rt-train-014-rev{revision}.pdf'
    pdf = canvas.Canvas(str(OUT / name), pagesize=letter, invariant=1, pageCompression=1)
    pdf.setTitle(f'Blue Trainer Bellows Drill (invented) — Revision {revision}')
    pdf.setAuthor('Department Hub test fixture')
    pdf.setSubject(LABEL)

    page = Page(pdf, 1, total, identifier, revision)
    page.heading('Blue Trainer Bellows Drill', 17)
    page.para(f'Protocol {identifier} · Revision {revision} · Effective {values["effective"]} · '
              'Issued by the Lakeside Training Hospital Respiratory Education Committee (a fictional body).')
    if second:
        page.heading('Summary of changes in Revision 2')
        page.para('The adult starting rate and highest rate are raised. The pediatric recheck is shortened. The servicing '
                  'interval is lengthened. The Charge Educator replaces the Simulation Lead as the person who issues the '
                  'drill order and the first person to call.')
    page.heading('1. Purpose')
    page.para('This invented protocol exists only to test Department Hub. It describes a classroom drill on the Blue '
              'Trainer bellows, a device that does not exist. Rates are counted in marks per minute (mk/min), a unit '
              'made up for this document.')
    page.heading('2. Who may run the drill')
    page.para('Only a therapist who holds a current Blue Trainer card may run the drill. A student may run the drill '
              'only while a card holder is present in the room.')
    page.heading('3. Drill order')
    page.para(f'A written drill order from the {values["lead"]} is required before the drill is started. A verbal '
              'request is not a drill order.')
    pdf.showPage()

    page = Page(pdf, 2, total, identifier, revision)
    page.heading('4. Rates by age band')
    page.table([('Age band', LEFT), ('Starting rate', LEFT + 168), ('Highest rate', LEFT + 268), ('Recheck after', LEFT + 364)], [
        ['Adult (18 years and over)', f'{values["adult"]} mk/min', f'{values["adult_top"]} mk/min', f'{values["adult_recheck"]} minutes'],
        ['Pediatric (under 18 years)', f'{values["pediatric"]} mk/min', f'{values["pediatric_top"]} mk/min', f'{values["pediatric_recheck"]} minutes']])
    page.heading('5. Adult drill')
    page.para(f'For an adult manikin, start the bellows at {values["adult"]} mk/min. At each recheck, raise the rate by '
              f'2 mk/min while the green lamp stays lit. Never set an adult rate above {values["adult_top"]} mk/min.')
    page.heading('6. Pediatric drill')
    page.para(f'For a pediatric manikin, fit the small cuff and start the bellows at {values["pediatric"]} mk/min. At '
              f'each recheck, raise the rate by 1 mk/min while the green lamp stays lit. Never set a pediatric rate '
              f'above {values["pediatric_top"]} mk/min.')
    if second:
        page.para('Do not run a pediatric drill with the large cuff fitted.')
    pdf.showPage()

    page = Page(pdf, 3, total, identifier, revision)
    page.heading('7. When the drill must not be started')
    page.para('Do not start the drill if the amber seal lamp on the manikin is lit, or if the bellows was serviced '
              f'within the last {values["serviced"]} hours. This applies to adult and pediatric drills.')
    page.heading('8. When to stop')
    page.para('Stop the drill at once if the red lamp lights or the gauge reads above 30 marks.')
    page.heading('9. Who to call')
    page.para(f'After stopping, call the {values["lead"]}. If the {values["lead"]} does not answer within 5 minutes, '
              'call the Education Supervisor.')
    page.heading('Figure 1. Start decision')
    diagram(page, values['adult'], values['pediatric'], values['lead'])
    pdf.showPage()
    pdf.save()
    return name


def scan_like():
    """One page with a drawing and no text at all, standing in for a scanned page. Reading it must
    come back empty and must not be treated as a successful import."""
    pdf = canvas.Canvas(str(TEST_ONLY / 'no-text-page.pdf'), pagesize=letter, invariant=1, pageCompression=1)
    pdf.setTitle('Page with no readable text (invented)')
    pdf.setSubject(LABEL)
    pdf.setLineWidth(1)
    pdf.rect(LEFT, 300, RIGHT - LEFT, 380)
    for y in range(340, 660, 22):
        pdf.line(LEFT + 24, y, RIGHT - 24 - (y % 3) * 40, y)
    pdf.showPage()
    pdf.save()
    return 'no-text-page.pdf'


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    TEST_ONLY.mkdir(parents=True, exist_ok=True)
    for folder, written in [(OUT, protocol(1)), (OUT, protocol(2)), (TEST_ONLY, scan_like())]:
        print('wrote', (folder / written).relative_to(ROOT), (folder / written).stat().st_size, 'bytes')
    sys.exit(0)
