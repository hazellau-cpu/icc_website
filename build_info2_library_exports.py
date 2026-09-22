import csv
import re
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

SOURCE = Path('/Users/hazellau/Downloads/Info-2.xlsx')
OUTPUT = Path('exports/info2-library')
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

PROGRAMMES = [
    ('AIK-L1-O', 'AIKIRO Lv1 original', 'AIKIRO', 1, 'original', 'Robot'),
    ('AIK-L2-O', 'AIKIRO Lv2 original', 'AIKIRO', 2, 'original', 'Robot'),
    ('AIK-L3-O', 'AIKIRO Lv3 original', 'AIKIRO', 3, 'original', 'Robot'),
    ('AIK-L4-O', 'AIKIRO Lv4 original', 'AIKIRO', 4, 'original', 'Robot'),
    ('AIK-L1-A', 'AIKIRO Lv1 additional', 'AIKIRO', 1, 'additional', 'Robot'),
    ('AIK-L2-A', 'AIKIRO Lv2 additional', 'AIKIRO', 2, 'additional', 'Robot'),
    ('AIK-L3-A', 'AIKIRO Lv3 additional', 'AIKIRO', 3, 'additional', 'Robot'),
    ('AIK-L4-A', 'AIKIRO Lv4 additional', 'AIKIRO', 4, 'additional', 'Robot'),
    ('ROB-L1', 'ROBOKIT Lv1', 'ROBOKIT', 1, '', 'Robot'),
    ('ROB-L2', 'ROBOKIT Lv2', 'ROBOKIT', 2, '', 'Robot'),
    ('ROB-L3', 'ROBOKIT Lv3', 'ROBOKIT', 3, '', 'Robot'),
    ('ROB-L4', 'ROBOKIT Lv4', 'ROBOKIT', 4, '', 'Robot'),
    ('ROB-L5', 'ROBOKIT Lv5', 'ROBOKIT', 5, '', 'Robot'),
    ('ROB-L6', 'ROBOKIT Lv6', 'ROBOKIT', 6, '', 'Robot'),
    ('UAR-L1', 'UARO Lv1', 'UARO', 1, '', 'Robot'),
    ('UAR-L2', 'UARO Lv2', 'UARO', 2, '', 'Robot'),
    ('UAR-L3', 'UARO Lv3', 'UARO', 3, '', 'Robot'),
    ('UAR-L4', 'UARO Lv4', 'UARO', 4, '', 'Robot'),
    ('CS1', 'CS1', 'CodeCombat', 1, '', 'Coding'),
    ('CS2', 'CS2', 'CodeCombat', 2, '', 'Coding'),
    ('CS3', 'CS3', 'CodeCombat', 3, '', 'Coding'),
    ('CS4', 'CS4', 'CodeCombat', 4, '', 'Coding'),
    ('CS5', 'CS5', 'CodeCombat', 5, '', 'Coding'),
    ('CM-P1', 'CodeMonkey P1', 'CodeMonkey', 1, '', 'Coding'),
    ('CM-P2', 'CodeMonkey P2', 'CodeMonkey', 2, '', 'Coding'),
]
PROGRAMME_BY_NAME = {name.lower(): row for row in PROGRAMMES for name in (row[1], row[1].replace(' original', '_original').replace(' additional', '_additional'))}


def read_workbook():
    with ZipFile(SOURCE) as archive:
        strings_root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
        strings = [''.join(t.text or '' for t in item.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')) for item in strings_root.findall('m:si', NS)]
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        targets = {item.attrib['Id']: item.attrib['Target'] for item in relationships}
        sheets = {}
        for sheet in workbook.find('m:sheets', NS):
            target = 'xl/' + targets[sheet.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
            document = ET.fromstring(archive.read(target))
            rows = []
            for row in document.findall('.//m:sheetData/m:row', NS):
                values = []
                for cell in row.findall('m:c', NS):
                    node = cell.find('m:v', NS)
                    value = '' if node is None else node.text or ''
                    if cell.attrib.get('t') == 's' and value:
                        value = strings[int(value)]
                    values.append(value.strip())
                rows.append(values)
            sheets[sheet.attrib['name']] = rows
        return sheets


def write_csv(filename, headers, rows):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with (OUTPUT / filename).open('w', newline='', encoding='utf-8') as handle:
        csv.writer(handle, lineterminator='\n').writerows([headers, *rows])


def level_number(value):
    match = re.search(r'\d+', str(value or ''))
    return int(match.group()) if match else None


def programme_for(kit, level, variant=''):
    prefix = {'AIKIRO': 'AIK', 'ROBOKIT': 'ROB', 'UARO': 'UAR'}[kit]
    if kit == 'AIKIRO':
        return f'{prefix}-L{level}-{"A" if variant == "additional" else "O"}'
    return f'{prefix}-L{level}'


def main():
    sheets = read_workbook()
    key_rows = [[pid, name, ptype, kit, level, variant, 'true'] for pid, name, kit, level, variant, ptype in PROGRAMMES]
    write_csv('programme-keys.csv', ['programme_id', 'programme_name', 'programme_type', 'kit_id', 'level', 'variant', 'active'], key_rows)

    robot_rows = []
    for sheet_name, kit in [('AIKIRO robot list', 'AIKIRO'), ('Robokit robot list', 'ROBOKIT'), ('UARO robot list', 'UARO')]:
        for row in sheets.get(sheet_name, []):
            values = row + [''] * 5
            if not any(values):
                continue
            if sheet_name == 'AIKIRO robot list':
                variant = 'additional' if 'additional' in values[1].lower() else 'original'
                level, sequence, name = level_number(values[1]), level_number(values[2]), values[3]
                if not level or level > 4:
                    continue
                programme_id = programme_for(kit, level, variant)
            elif sheet_name == 'Robokit robot list':
                kit_name, level, sequence, name = values[1], level_number(values[2]), level_number(values[3]), values[0]
                if not level or level > 6:
                    continue
                programme_id = programme_for(kit, level)
            else:
                level, sequence, name = level_number(values[0]), level_number(values[1]), values[2]
                if not level or level > 4:
                    continue
                programme_id = programme_for(kit, level)
            robot_rows.append([f'{programme_id}-R{sequence}', programme_id, kit, level, sequence, name])
    write_csv('robot-library.csv', ['item_id', 'programme_id', 'kit_id', 'level', 'sequence', 'item_name'], robot_rows)

    coding_rows = []
    for sheet_name, programme_id in [('Codemonkey', 'CM-P1')] + [(f'CS{i}', f'CS{i}') for i in range(1, 6)]:
        for row in sheets.get(sheet_name, [])[1:]:
            values = row + [''] * 3
            if not any(values):
                continue
            if sheet_name == 'Codemonkey':
                level, topic, part = level_number(values[0]), values[1], level_number(values[2])
            else:
                level, topic, part = level_number(values[0]), values[1], None
            if level is None:
                continue
            coding_rows.append([f'{programme_id}-L{level}' + (f'-P{part}' if part is not None else ''), programme_id, level, topic, part or ''])
    write_csv('coding-curriculum.csv', ['item_id', 'programme_id', 'level', 'item_name', 'part'], coding_rows)
    (OUTPUT / 'README.md').write_text('''# Info-2 Library Exports

The library is normalized into two files:

- `robot-library.csv`: AIKIRO, ROBOKIT, and UARO share the same columns.
- `coding-curriculum.csv`: CodeMonkey and CS1-CS5 share the same columns.
- `programme-keys.csv`: exactly the canonical programme catalogue.

Key rules:

- `programme_id` is the relationship key to a programme.
- `item_id` is the relationship key to a robot or curriculum item.
- Robot `level` and `sequence` are integers.
- Coding has no `sequence` column because its level is the sequence.
- AIKIRO original and additional programmes always have different IDs: `AIK-L2-O` and `AIK-L2-A`.
- `kit_id` connects robot programmes to the kit entity in the ER diagram.
''', encoding='utf-8')

if __name__ == '__main__':
    main()
