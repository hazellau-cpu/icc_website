from __future__ import annotations

import json
import csv
import io
import re
import tempfile
from urllib.request import urlopen
from urllib.parse import unquote
from pathlib import Path

SOURCE_ROOT = Path('/Users/hazellau/Downloads/Private & Shared')
EXTERNAL_UARO_ROBOTS = Path('/Users/hazellau/Downloads/Info.xlsx - UARO robot list.csv')
EXTERNAL_ROBOKIT_ROBOTS = Path('/Users/hazellau/ICC website/robokit-robot-list.csv')
GOOGLE_SHEET_XLSX_URL = 'https://docs.google.com/spreadsheets/d/1gZcLy4G3FO136lYNr3qrYYdrMgOu7WVG/export?format=xlsx'
FOLDERS = ['Coding Students', 'ICC (CWB)']
OUTPUT_PATH = Path('/Users/hazellau/ICC website/workspace-db.json')


def collection_for(folder_name: str, relative_path: Path) -> str:
    if folder_name == 'Coding Students':
        return 'Students'

    path_text = str(relative_path).lower()
    if 'borrowing' in path_text or path_text.startswith('robots/'):
        return 'Operations'
    if 'student tracker' in path_text or 'student' in path_text:
        return 'Students'
    return 'Libraries & curriculum'


def make_record(name: str, collection: str, status: str, notes: str, source_path: str) -> dict:
    return {
        'name': name,
        'collection': collection,
        'status': status,
        'notes': notes,
        'sourcePath': source_path,
    }


def is_resource(name: str) -> bool:
    return name.lower().endswith(('.csv', '.md', '.json'))


def read_source_file(path: Path, relative_path: Path) -> dict:
    content = path.read_text(encoding='utf-8-sig', errors='replace')
    source = {
        'path': str(relative_path),
        'name': path.name,
        'type': path.suffix.lower().lstrip('.') or 'text',
        'size': path.stat().st_size,
        'content': content,
    }

    if path.suffix.lower() == '.csv':
        source['rows'] = list(csv.DictReader(io.StringIO(content)))

    return source


def read_external_uaro_robots() -> list[dict]:
    if not EXTERNAL_UARO_ROBOTS.exists():
        return []
    with EXTERNAL_UARO_ROBOTS.open(newline='', encoding='utf-8-sig') as handle:
        return [
            {'Robot name': row['Robot Name'], 'Kit name': 'UARO', 'Level': row['Level'], 'Sequence': row['Sequence']}
            for row in csv.DictReader(handle)
        ]

def read_external_robokit_robots() -> list[dict]:
    if not EXTERNAL_ROBOKIT_ROBOTS.exists():
        return []
    with EXTERNAL_ROBOKIT_ROBOTS.open(newline='', encoding='utf-8-sig') as handle:
        return [
            {'Robot name': row['Robot Name'], 'Kit name': row['Kit'], 'Level': row['Level'], 'Sequence': row['Sequence']}
            for row in csv.DictReader(handle)
        ]


def read_google_sheet_files() -> list[dict]:
    try:
        from openpyxl import load_workbook
    except ImportError as error:
        raise RuntimeError('Install openpyxl to import the Google Sheet workbook.') from error

    with urlopen(GOOGLE_SHEET_XLSX_URL, timeout=30) as response:
        workbook_bytes = response.read()
    with tempfile.NamedTemporaryFile(suffix='.xlsx') as temporary_file:
        temporary_file.write(workbook_bytes)
        temporary_file.flush()
        workbook = load_workbook(temporary_file.name, read_only=True, data_only=True)
        sources = []
        for worksheet in workbook.worksheets:
            values = list(worksheet.values)
            if not values:
                continue
            headers = [str(value or '').strip() for value in values[0]]
            rows = [dict(zip(headers, row)) for row in values[1:] if any(value not in (None, '') for value in row)]
            sources.append({
                'path': f'Google Sheet/{worksheet.title}.csv',
                'name': worksheet.title,
                'type': 'csv',
                'size': len(rows),
                'content': '',
                'rows': rows,
            })
        return sources


def build_workspace_files() -> list[dict]:
    files: list[dict] = []

    for folder_name in FOLDERS:
        folder = SOURCE_ROOT / folder_name
        if not folder.exists():
            continue

        for item in sorted(folder.rglob('*'), key=lambda p: str(p).lower()):
            if item.is_file() and not item.name.startswith('.') and is_resource(item.name):
                files.append(read_source_file(item, item.relative_to(SOURCE_ROOT)))

    files.extend(read_google_sheet_files())

    return files


def build_records(files: list[dict]) -> list[dict]:
    records: list[dict] = []

    for source in files:
        source_path = Path(source['path'])
        folder_name = source_path.parts[0]
        collection = collection_for(folder_name, source_path)
        records.append(
            make_record(
                source_path.stem,
                collection,
                'Active',
                f'{source_path.parent} • {source_path.name} • {source["size"]} bytes',
                source['path'],
            )
        )

    return records


def rows_matching(files: list[dict], include: tuple[str, ...], exclude: tuple[str, ...] = ()) -> list[dict]:
    matches: list[dict] = []
    for source in files:
        path_text = source['path'].lower()
        if source['type'] == 'csv' and all(part in path_text for part in include) and not any(part in path_text for part in exclude):
            matches.extend(source.get('rows', []))
    return matches


def build_tool_databases(files: list[dict]) -> dict:
    def exact_rows(prefix: str, exclude_all: bool = True) -> list[dict]:
        matches = [source for source in files if source['path'].startswith(prefix) and (not exclude_all or not source['path'].endswith('_all.csv'))]
        if not exclude_all:
            matches.sort(key=lambda source: not source['path'].endswith('_all.csv'))
        if matches:
            return matches[0].get('rows', [])
        return []

    student_rows = []
    for source in files:
        path_text = source['path'].lower()
        if (source['type'] == 'csv'
                and path_text.startswith('icc (cwb)/student tracker (icc cwb) ')
                and 'robot students info' in path_text
                and not path_text.endswith('_all.csv')):
            student_rows.extend(source.get('rows', []))

    google_sources = [source for source in files if source['path'].startswith('Google Sheet/')]

    def google_rows(required_headers: set[str]) -> list[dict]:
        rows: list[dict] = []
        for source in google_sources:
            source_rows = source.get('rows', [])
            if source_rows and required_headers.issubset(source_rows[0].keys()):
                rows.extend(source_rows)
        return rows

    if not student_rows:
        student_rows = google_rows({'Student', 'Robot completion %'})

    borrowing_rows = rows_matching(files, ('student borrowing log',), ('_all.csv',))
    price_rows = rows_matching(files, ('component prices',), ('_all.csv',))
    canonical_data = {
        'robotProgress': exact_rows('ICC (CWB)/Student Tracker (ICC CWB) 03841f8415434bfeb7535b84400b5494_Robot Progress', False),
        'codingLessons': exact_rows('ICC (CWB)/Coding Lessons '),
        'robotLessons': exact_rows('ICC (CWB)/Robot Lessons '),
        'curriculum': exact_rows('ICC (CWB)/Coding Curriculum ', False),
        'componentLibrary': exact_rows('ICC (CWB)/Component Library/Component list ', False),
        'inventory': exact_rows('ICC (CWB)/Center Component Inventory ', False),
        'robotPrograms': exact_rows('ICC (CWB)/Robot Programs '),
        'robots': exact_rows('ICC (CWB)/Robots '),
    }

    if not canonical_data['curriculum']:
        canonical_data['curriculum'] = google_rows({'Item', 'Level', 'Program name', 'Topic'})
    if not canonical_data['componentLibrary']:
        canonical_data['componentLibrary'] = google_rows({'Component', 'Tier'})
    if not canonical_data['robots']:
        canonical_data['robots'] = [
            {'Robot name': row.get('Robot Name', row.get('Robot name', '')), 'Kit name': row.get('Kit', row.get('Kit name', '')), 'Level': row.get('Level', ''), 'Sequence': row.get('sequence', row.get('Sequence', ''))}
            for row in google_rows({'Robot Name', 'Kit', 'Level', 'sequence'})
        ]
    if not canonical_data['codingLessons']:
        canonical_data['codingLessons'] = google_rows({'Student (Coding)', 'Lesson time', 'Status'})

    inventory_rows = canonical_data['inventory']
    canonical_data['robots'] = [row for row in canonical_data['robots'] if str(row.get('Kit name', '')).upper() not in {'UARO', 'ROBOKIT'}] + read_external_uaro_robots() + read_external_robokit_robots()
    for row in inventory_rows:
        level_values = [int(row.get(f'Lv{level}', 0) or 0) for level in range(1, 9)]
        row['Required Qty'] = max(level_values + [int(row.get('Demo qty', 0) or 0)])
        row['Result'] = 'Enough' if int(row.get('Total center qty', 0) or 0) >= row['Required Qty'] else 'Missing'

    def normalise(value: str) -> str:
        return ''.join(character.lower() for character in value if character.isalnum())

    price_options: dict[str, list[str]] = {}
    for row in price_rows:
        component = row.get('Component', '').strip()
        price = row.get('Unit Price', '').strip()
        if component and price:
            price_options.setdefault(normalise(component), []).append(price)

    component_items = []
    for source in files:
        path_text = source['path'].lower()
        if source['type'] != 'csv' or 'robot students info/' not in path_text or 'component checklist' not in path_text:
            continue
        source_parts = Path(source['path']).parts
        folder_student = source_parts[source_parts.index('Robot students info') + 1] if 'Robot students info' in source_parts and len(source_parts) > source_parts.index('Robot students info') + 1 else ''
        for row in source.get('rows', []):
            item = row.get('Item', '').strip()
            if not item:
                continue
            options = price_options.get(normalise(item), [])
            component_items.append({
                'item': item,
                'tier': row.get('Tier', ''),
                'requiredQty': row.get('Required Qty', ''),
                'studentQty': row.get('Student Qty', ''),
                'quantityStatus': row.get('Qty status', ''),
                'student': row.get('Student', '').split(' (', 1)[0].strip() or unquote(folder_student),
                'kit': row.get('Student Kit', ''),
                'level': row.get('Student Level', ''),
                'unitPrice': options[0] if options else '',
                'priceOptions': options,
                'sourcePath': source['path'],
                'sourceRow': row,
            })

    # Complete each student's checklist from the all-level component catalogue,
    # including Tier C items omitted by some exported personal checklists.
    existing_keys = {(row['student'], normalise(row['item'])) for row in component_items}
    for student_row in student_rows:
        student = {'name': student_row.get('Student', '').strip(), 'program': student_row.get('Program (text)') or student_row.get('Program') or ''}
        program = student.get('program', '')
        kit_match = re.match(r'(AIKIRO|ROBOKIT|UARO)', program, re.IGNORECASE)
        level_match = re.search(r'Lv(\d+)', program, re.IGNORECASE)
        if not kit_match or not level_match:
            continue
        kit = kit_match.group(1).upper()
        level = level_match.group(1)
        for library_row in canonical_data['componentLibrary']:
            library_kit = str(library_row.get('Kit', '')).upper().replace('URAO', 'UARO')
            if library_kit != kit:
                continue
            required = library_row.get(f'Lv{level} total') or library_row.get(f'Lv{level}') or '0'
            if int(required or 0) <= 0:
                continue
            item = library_row.get('Component', '').strip()
            key = (student['name'], normalise(item))
            if not item or key in existing_keys:
                continue
            options = price_options.get(normalise(item), [])
            component_items.append({
                'item': item,
                'tier': library_row.get('Tier', ''),
                'requiredQty': str(required),
                'studentQty': '',
                'quantityStatus': 'Missing',
                'student': student['name'],
                'kit': kit,
                'level': f'Lv{level}',
                'unitPrice': options[0] if options else str(library_row.get('Unit Price', '')),
                'priceOptions': options,
                'sourcePath': 'ICC (CWB)/Component Library/Component list all export',
                'sourceRow': {'Item': item, 'Tier': library_row.get('Tier', ''), 'Required Qty': str(required), 'Student Qty': '', 'Qty status': 'Missing', 'Notes': ''},
            })
            existing_keys.add(key)

    coding_students = []
    for source in files:
        path_text = source['path']
        if not (path_text.startswith('Coding Students/') and source['type'] == 'md' and '/' not in path_text[len('Coding Students/'):]):
            continue
        fields = dict(re.findall(r'^([^:\n]+):\s*(.+)$', source['content'], re.MULTILINE))
        title = source['content'].splitlines()[0].removeprefix('# ').strip()
        coding_students.append({
            'name': title,
            'sourceId': source['path'],
            'completion': fields.get('Coding completion %', ''),
            'course': fields.get('Course', ''),
            'lastUpdated': fields.get('Last updated', ''),
            'attendance': fields.get('Monthly attendance', ''),
            'nextLevel': fields.get('Next starting level', ''),
            'topics': fields.get('Topics learnt', ''),
            'sourcePath': source['path'],
        })

    robot_students = []
    for row in student_rows:
        name = row.get('Student', '').strip()
        if not name:
            continue
        completion = row.get('Robot completion %', '').strip()
        robot_students.append({
            'name': name,
            'level': row.get('Level (text)') or row.get('Level') or row.get('Program (text)') or '',
            'attendance': row.get('Monthly attendance') or row.get('Check') or '',
            'program': row.get('Program (text)') or row.get('Program') or '',
            'nextRobot': row.get('Next robot (auto)', ''),
            'completion': completion,
            'sourceRow': row,
        })

    coding_progress = []
    for source in files:
        if source['type'] != 'csv' or not source['path'].startswith('Coding Students/'):
            continue
        source_parts = Path(source['path']).parts
        profile_folder = source_parts[1] if len(source_parts) > 1 else ''
        for row in source.get('rows', []):
            student_name = row.get('Student (Coding)', '').split(' (', 1)[0].strip() or profile_folder
            if not student_name:
                continue
            coding_progress.append({
                'name': student_name,
                'sourceId': row.get('Student (Coding)', '') or source['path'],
                'project': row.get('Lesson', ''),
                'progress': row.get('Ending level', ''),
                'next': row.get('Starting level', ''),
                'status': row.get('Status', ''),
                'topics': row.get('Topics covered', ''),
                'sourceRow': row,
            })

    known_coding_sources = {str(row.get('sourceRow', {}).get('Student (Coding)', '')) for row in coding_progress}
    for student in coding_students:
        profile_id = Path(student['sourcePath']).stem.rsplit(' ', 1)[-1]
        if any(profile_id in source for source in known_coding_sources):
            continue
        coding_progress.append({
            'name': student['name'],
            'sourceId': student['sourcePath'],
            'project': student.get('course', 'Coding progress'),
            'progress': student.get('completion', ''),
            'next': student.get('nextLevel', ''),
            'status': student.get('attendance', ''),
            'topics': student.get('topics', ''),
            'sourceRow': {},
        })

    borrowings = []
    for row in borrowing_rows:
        borrowings.append({
            'item': row.get('Item') or row.get('Component') or row.get('Component name') or row.get('Equipment') or row.get('Name') or '',
            'borrower': row.get('Student') or row.get('Borrower') or '',
            'due': row.get('Due date') or row.get('Due') or row.get('Returned on') or '',
            'status': row.get('Status') or row.get('Returned') or row.get('Outstanding item') or '',
            'sourceRow': row,
        })

    return {
        'robotStudents': robot_students,
        'codingStudents': coding_students,
        'codingProgress': coding_progress,
        'borrowings': borrowings,
        'componentPrices': price_rows,
        'componentItems': component_items,
        **canonical_data,
        'reminders': [],
    }


def main() -> None:
    files = build_workspace_files()
    if not files:
        raise RuntimeError(
            'No source files found. Restore Coding Students and ICC (CWB) before rebuilding workspace-db.json.'
        )
    tools = build_tool_databases(files)
    database = {
        'workspaceFolders': FOLDERS,
        'files': files,
        'records': build_records(files),
        **tools,
    }

    OUTPUT_PATH.write_text(json.dumps(database, indent=2), encoding='utf-8')
    print(f'Wrote {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
