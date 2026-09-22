import csv
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

SOURCE = Path('/Users/hazellau/Downloads/Info-2.xlsx')
OUTPUT = Path('exports/info2-library')
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

def read_workbook():
    with ZipFile(SOURCE) as archive:
        root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
        strings = [''.join(t.text or '' for t in item.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')) for item in root.findall('m:si', NS)]
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        targets = {item.attrib['Id']: item.attrib['Target'] for item in relationships}
        sheets = {}
        for sheet in workbook.find('m:sheets', NS):
            name = sheet.attrib['name']
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
            sheets[name] = rows
        return sheets

def clean_rows(rows):
    rows = [row for row in rows if any(row)]
    if not rows:
        return [], []
    width = max(len(row) for row in rows)
    headers = (rows[0] + [''] * width)[:width]
    headers = [header or f'field_{index + 1}' for index, header in enumerate(headers)]
    body = [(row + [''] * width)[:width] for row in rows[1:] if any(row)]
    return headers, body

def write_csv(filename, headers, rows):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with (OUTPUT / filename).open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle, lineterminator='\n')
        writer.writerow(headers)
        writer.writerows(rows)

def main():
    sheets = read_workbook()
    programme_keys = [
        ('AIK-L1-O', 'AIKIRO Lv1_original', 'AIKIRO', 'Robot'), ('AIK-L1-A', 'AIKIRO Lv1_additional', 'AIKIRO', 'Robot'),
        ('AIK-L2-O', 'AIKIRO Lv2_original', 'AIKIRO', 'Robot'), ('AIK-L2-A', 'AIKIRO Lv2_additional', 'AIKIRO', 'Robot'),
        ('AIK-L3-O', 'AIKIRO Lv3_original', 'AIKIRO', 'Robot'), ('AIK-L3-A', 'AIKIRO Lv3_additional', 'AIKIRO', 'Robot'),
        ('AIK-L4-O', 'AIKIRO Lv4_original', 'AIKIRO', 'Robot'), ('ROB-L1', 'ROBOKIT Lv1', 'ROBOKIT', 'Robot'),
        ('ROB-L3', 'ROBOKIT Lv3', 'ROBOKIT', 'Robot'), ('ROB-L4', 'ROBOKIT Lv4', 'ROBOKIT', 'Robot'),
        ('ROB-L5', 'ROBOKIT Lv5', 'ROBOKIT', 'Robot'), ('UAR-L2', 'UARO Lv2', 'UARO', 'Robot'),
        ('CM-P1', 'CodeMonkey P1', 'CodeMonkey', 'Coding'), ('CS1', 'CS1', 'CodeCombat', 'Coding'),
        ('CS2', 'CS2', 'CodeCombat', 'Coding'), ('CS3', 'CS3', 'CodeCombat', 'Coding'), ('CS4', 'CS4', 'CodeCombat', 'Coding'), ('CS5', 'CS5', 'CodeCombat', 'Coding'),
    ]
    robot_rows = []
    robot_headers = ['item_id', 'programme_id', 'programme_name', 'kit', 'level', 'sequence', 'item_name']
    for sheet_name, prefix, kit in [('AIKIRO robot list', 'AIK', 'AIKIRO'), ('Robokit robot list', 'ROB', 'ROBOKIT'), ('UARO robot list', 'UAR', 'UARO')]:
        if sheet_name not in sheets:
            continue
        headers, body = clean_rows(sheets[sheet_name])
        if sheet_name == 'AIKIRO robot list':
            body = sheets[sheet_name]
            for row in body:
                values = (row + [''] * 5)[:5]
                if any(values):
                    level, sequence, name = values[1], values[2], values[3]
                    robot_rows.append([f'{prefix}-{level}-{sequence}', f'{prefix}-{level}', f'{kit} {level}', kit, level, sequence, name])
        else:
            for row in body:
                data = dict(zip(headers, row))
                level = data.get('Level', '')
                sequence = data.get('Sequence', '') or data.get('sequence', '')
                name = data.get('Robot Name', '') or data.get('robot_name', '')
                robot_rows.append([f'{prefix}-{level}-{sequence}', f'{prefix}-{level}', f'{kit} {level}', kit, level, sequence, name])
    write_csv('robot-library.csv', robot_headers, robot_rows)

    coding_rows = []
    coding_headers = ['item_id', 'programme_id', 'programme_name', 'level', 'sequence', 'item_name', 'part']
    for sheet_name, programme_id, programme_name in [('Codemonkey', 'CM-P1', 'CodeMonkey P1')] + [(f'CS{i}', f'CS{i}', f'CS{i}') for i in range(1, 6)]:
        if sheet_name not in sheets:
            continue
        headers, body = clean_rows(sheets[sheet_name])
        for row in body:
            data = dict(zip(headers, row))
            level = data.get('Challenge No.', '') or data.get('Level', '')
            part = data.get('Part', '')
            topic = data.get('Topic', '')
            coding_rows.append([f'{programme_id}-{level}-{part or level}', programme_id, programme_name, level, level, topic, part])
    known = {row[0] for row in programme_keys}
    for row in robot_rows:
        if row[1] not in known:
            programme_keys.append((row[1], row[2], row[3], 'Robot'))
            known.add(row[1])
    for row in coding_rows:
        if row[1] not in known:
            programme_keys.append((row[1], row[2], 'CodeMonkey' if row[1] == 'CM-P1' else 'CodeCombat', 'Coding'))
            known.add(row[1])
    write_csv('programme-keys.csv', ['programme_id', 'programme_name', 'kit_or_platform', 'programme_type'], programme_keys)
    write_csv('coding-curriculum.csv', coding_headers, coding_rows)
    (OUTPUT / 'README.md').write_text('''# Info-2 Library Exports

The related library sheets are consolidated into two normalized files:

- `robot-library.csv`: AIKIRO, ROBOKIT, and UARO share one format.
- `coding-curriculum.csv`: CodeMonkey and CS1-CS5 share one format.
- `programme-keys.csv`: canonical short programme IDs and display names.

Every library item has an `item_id` and `programme_id`. Use those keys for joins; use `programme_name` and `item_name` for display. AIKIRO original and additional levels have separate IDs such as `AIK-L2-O` and `AIK-L2-A`.
''', encoding='utf-8')

if __name__ == '__main__':
    main()
