import csv
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

SOURCE = Path('/Users/hazellau/Downloads/Info-2.xlsx')
OUTPUT = Path('exports/info2-library')
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

def read_workbook():
    with ZipFile(SOURCE) as archive:
        strings_root = ET.fromstring(archive.read('xl/sharedStrings.xml'))
        strings = [''.join(t.text or '' for t in item.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t')) for item in strings_root.findall('m:si', NS)]
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
                    value_node = cell.find('m:v', NS)
                    value = '' if value_node is None else value_node.text or ''
                    if cell.attrib.get('t') == 's' and value:
                        value = strings[int(value)]
                    values.append(value)
                rows.append(values)
            sheets[name] = rows
        return sheets

def clean_rows(rows):
    rows = [[str(value).strip() for value in row] for row in rows]
    rows = [row for row in rows if any(row)]
    if not rows:
        return [], []
    width = max(len(row) for row in rows)
    headers = rows[0] + [''] * (width - len(rows[0]))
    headers = [header or f'field_{index + 1}' for index, header in enumerate(headers)]
    headers = [header.strip() for header in headers]
    body = []
    for row in rows[1:]:
        padded = row + [''] * (width - len(row))
        if any(padded):
            body.append(padded)
    used = [index for index in range(width) if headers[index] and any(row[index] for row in body)]
    return [headers[index] for index in used], [[row[index] for index in used] for row in body]

def write_csv(filename, headers, rows):
    path = OUTPUT / filename
    with path.open('w', newline='', encoding='utf-8') as handle:
        writer = csv.writer(handle)
        writer.writerow(headers)
        writer.writerows(rows)

def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    sheets = read_workbook()
    programme_keys = [
        ('AIK-L1', 'AIKIRO Lv1_original', 'AIKIRO', 'Robot'),
        ('AIK-L2', 'AIKIRO Lv2_original', 'AIKIRO', 'Robot'),
        ('AIK-L4', 'AIKIRO Lv4_original', 'AIKIRO', 'Robot'),
        ('ROB-L1', 'ROBOKIT Lv1', 'ROBOKIT', 'Robot'),
        ('ROB-L3', 'ROBOKIT Lv3', 'ROBOKIT', 'Robot'),
        ('ROB-L4', 'ROBOKIT Lv4', 'ROBOKIT', 'Robot'),
        ('ROB-L5', 'ROBOKIT Lv5', 'ROBOKIT', 'Robot'),
        ('UAR-L2', 'UARO Lv2', 'UARO', 'Robot'),
        ('CM-P1', 'CodeMonkey P1', 'CodeMonkey', 'Coding'),
        ('CS1', 'CS1', 'CodeCombat', 'Coding'),
        ('CS2', 'CS2', 'CodeCombat', 'Coding'),
        ('CS3', 'CS3', 'CodeCombat', 'Coding'),
        ('CS4', 'CS4', 'CodeCombat', 'Coding'),
        ('CS5', 'CS5', 'CodeCombat', 'Coding'),
    ]
    write_csv('programme-keys.csv', ['programme_id', 'programme_name', 'kit_or_platform', 'programme_type'], programme_keys)

    mappings = {
        'UARO robot list': ('uaro-robots.csv', ['level', 'sequence', 'robot_name']),
        'AIKIRO robot list': ('aikiro-robots.csv', ['kit', 'level', 'sequence', 'robot_name', 'robot_id']),
        'Robokit robot list': ('robokit-robots.csv', ['robot_name', 'kit', 'level', 'sequence']),
        'Codemonkey': ('codemonkey-curriculum.csv', ['challenge_no', 'topic', 'part']),
        'CS1': ('cs1-curriculum.csv', ['level', 'topic']),
        'CS2': ('cs2-curriculum.csv', ['level', 'topic']),
        'CS3': ('cs3-curriculum.csv', ['level', 'topic']),
        'CS4': ('cs4-curriculum.csv', ['level', 'topic']),
        'CS5': ('cs5-curriculum.csv', ['level', 'topic']),
    }
    for sheet_name, (filename, headers) in mappings.items():
        if sheet_name not in sheets:
            continue
        if sheet_name == 'AIKIRO robot list':
            normalized = []
            for row in sheets[sheet_name]:
                values = row + [''] * (5 - len(row))
                if any(values[:5]):
                    normalized.append([values[0] or 'AIKIRO', values[1], values[2], values[3], values[4]])
            write_csv(filename, headers, normalized)
            continue
        source_headers, body = clean_rows(sheets[sheet_name])
        normalized = []
        for row in body:
            values = dict(zip(source_headers, row))
            if sheet_name == 'UARO robot list':
                normalized.append([values.get('Level', ''), values.get('Sequence', ''), values.get('Robot Name', '')])
            else:
                normalized.append([values.get(source_headers[index], '') for index in range(min(len(headers), len(source_headers)))])
        write_csv(filename, headers, normalized)

    (OUTPUT / 'README.md').write_text('''# Info-2 Library Exports\n\nThese files are cleaned exports of the library sheets in `Info-2.xlsx`. The five James student/lesson sheets are kept separately in `exports/james-workbook-template/`.\n\n## Short programme IDs\n\nUse `programme_id` from `programme-keys.csv` as the stable key:\n\n- `AIK-L1`, `AIK-L2`, `AIK-L4` for AIKIRO\n- `ROB-L1`, `ROB-L3`, `ROB-L4`, `ROB-L5` for ROBOKIT\n- `UAR-L2` for UARO\n- `CM-P1` for CodeMonkey\n- `CS1` to `CS5` for CodeCombat\n\nUse `programme_name` when displaying the full programme label. Do not join records by the long programme text.\n''', encoding='utf-8')

if __name__ == '__main__':
    main()
