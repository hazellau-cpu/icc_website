from __future__ import annotations

import json
import csv
import io
import re
from urllib.parse import unquote
from pathlib import Path

OUTPUT_PATH = Path('/Users/hazellau/ICC website/workspace-db.json')
CSV_EXPORT_DIR = Path('/Users/hazellau/ICC website/exports/data')
CSV_EXPORT_NAMES = {
    'Icc(cwb)_database - Borrowing_log.csv': 'borrowing_log',
    'Icc(cwb)_database - Daily_summary.csv': 'daily_summary',
    'Icc(cwb)_database - Deduction_log.csv': 'deduction_log',
    'Icc(cwb)_database - Progress_log.csv': 'progress_log',
    'Icc(cwb)_database - Student_view.csv': 'student_view',
    'Icc(cwb)_database - Students.csv': 'students',
    'Icc(cwb)_database - coding_curriculum.csv': 'coding_curriculum',
    'Icc(cwb)_database - programme_keys.csv': 'programme_keys',
    'Icc(cwb)_database - robot_library.csv': 'robot_library',
    'Icc(cwb)_database - component_inventory.csv': 'component_inventory',
}
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


def read_csv_exports() -> list[dict]:
    sources = []
    for filename, canonical_name in CSV_EXPORT_NAMES.items():
        path = CSV_EXPORT_DIR / filename
        if not path.exists():
            continue
        source = read_source_file(path, Path(f'CSV export/{canonical_name}.csv'))
        source['name'] = path.name
        sources.append(source)
    return sources


def normalize_robot_library_csv() -> None:
    path = CSV_EXPORT_DIR / 'Icc(cwb)_database - robot_library.csv'
    programme_path = CSV_EXPORT_DIR / 'Icc(cwb)_database - programme_keys.csv'
    if not path.exists() or not programme_path.exists():
        return
    with programme_path.open(newline='', encoding='utf-8-sig') as handle:
        programme_names = {row['programme_id']: row['programme_name'] for row in csv.DictReader(handle)}
    with path.open(newline='', encoding='utf-8-sig') as handle:
        rows = list(csv.DictReader(handle))
    headers = ['item_id', 'programme_id', 'programme_name', 'variant', 'kit_id', 'level', 'sequence', 'item_name']
    normalized_rows = []
    for row in rows:
        programme_id = row.get('programme_id', '').strip()
        programme_name = programme_names.get(programme_id, programme_id)
        variant = 'original' if programme_id.endswith('-O') else 'additional' if programme_id.endswith('-A') else ''
        normalized_rows.append([
            row.get('item_id', ''), programme_id, programme_name, variant,
            row.get('kit_id', ''), row.get('level', ''), row.get('sequence', ''), row.get('item_name', ''),
        ])
    with path.open('w', newline='', encoding='utf-8') as handle:
        csv.writer(handle, lineterminator='\n').writerows([headers, *normalized_rows])


def build_workspace_files() -> list[dict]:
    normalize_robot_library_csv()
    csv_exports = read_csv_exports()
    if csv_exports:
        print(f'Using CSV export source: {CSV_EXPORT_DIR}')
        return csv_exports
    raise RuntimeError(f'No CSV exports found in {CSV_EXPORT_DIR}. Restore the canonical data files before rebuilding.')


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
    workbook_sources = {
        source['path'].split('/')[-1].replace('.csv', '').lower(): source.get('rows', [])
        for source in files
        if source['path'].startswith('CSV export/')
    }

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

    if not student_rows and workbook_sources.get('students'):
        student_rows = workbook_sources['students']

    borrowing_rows = rows_matching(files, ('student borrowing log',), ('_all.csv',))
    if not borrowing_rows and workbook_sources.get('borrowing_log'):
        borrowing_rows = workbook_sources['borrowing_log']

    price_rows = rows_matching(files, ('component prices',), ('_all.csv',))
    canonical_data = {
        'robotProgress': exact_rows('ICC (CWB)/Student Tracker (ICC CWB) 03841f8415434bfeb7535b84400b5494_Robot Progress', False),
        'codingLessons': [],
        'robotLessons': [],
        'curriculum': exact_rows('ICC (CWB)/Coding Curriculum ', False),
        'componentLibrary': exact_rows('ICC (CWB)/Component Library/Component list ', False),
        'inventory': exact_rows('ICC (CWB)/Center Component Inventory ', False),
        'robotPrograms': exact_rows('ICC (CWB)/Robot Programs '),
        'robots': exact_rows('ICC (CWB)/Robots '),
    }

    if not canonical_data['curriculum'] and workbook_sources.get('coding_curriculum'):
        canonical_data['curriculum'] = workbook_sources['coding_curriculum']
    if not canonical_data['componentLibrary'] and workbook_sources.get('robot_library'):
        canonical_data['componentLibrary'] = workbook_sources['robot_library']
    if not canonical_data['inventory'] and workbook_sources.get('component_inventory'):
        canonical_data['inventory'] = workbook_sources['component_inventory']
    if not canonical_data['robotPrograms'] and workbook_sources.get('programme_keys'):
        canonical_data['robotPrograms'] = workbook_sources['programme_keys']
    if not canonical_data['robots'] and workbook_sources.get('robot_library'):
        canonical_data['robots'] = [
            {
                'Robot name': row.get('item_name') or row.get('Item name') or '',
                'Kit name': row.get('kit_id') or row.get('Kit') or '',
                'Level': str(row.get('level', '')) or '',
                'Sequence': row.get('sequence') or row.get('Sequence') or '',
                'Programme ID': row.get('programme_id') or '',
                'Programme Name': row.get('programme_name') or row.get('programme_id') or '',
                'Variant': row.get('variant') or '',
            }
            for row in workbook_sources['robot_library'] if row.get('item_name')
        ]
    if workbook_sources.get('daily_summary'):
        daily_summary_rows = workbook_sources['daily_summary']
        for row in daily_summary_rows:
            course_type = str(row.get('Course Type') or row.get('Course type') or '').strip().lower()
            programme_id = str(row.get('Programme ID') or row.get('Programme id') or '').strip()
            student_name = str(row.get('Student') or row.get('Student Name') or row.get('Name') or '').strip()
            if not student_name:
                continue
            lesson_time = row.get('Lesson Time') or row.get('Lesson time') or row.get('Lesson Date') or row.get('Date') or ''
            tutor = row.get('Tutor Name') or row.get('Tutor') or row.get('Tutor ID') or ''
            remarks = row.get('Remarks') or row.get('Comment') or row.get('Progress') or ''
            if course_type == 'robot' or programme_id.startswith(('AIK', 'UAR', 'ROB')):
                canonical_data['robotLessons'].append({
                    'Lesson time': lesson_time,
                    'Student name': student_name,
                    'Tutor': tutor,
                    'Remarks': remarks,
                    'Course type': 'Robot',
                    'sourceRow': row,
                })
            if course_type == 'coding' or programme_id.startswith('CS'):
                canonical_data['codingLessons'].append({
                    'Lesson time': lesson_time,
                    'Student (Coding)': student_name,
                    'Tutor': tutor,
                    'Remarks': remarks,
                    'Course type': 'Coding',
                    'sourceRow': row,
                })
    if not canonical_data['codingLessons'] and workbook_sources.get('daily_summary'):
        canonical_data['codingLessons'] = workbook_sources['daily_summary']

    def normalize_curriculum_row(row: dict) -> dict:
        programme_id = row.get('programme_id') or row.get('Program name') or row.get('programme_name') or ''
        level_value = row.get('level') or row.get('Level') or ''
        item_value = row.get('item_name') or row.get('Item') or row.get('Topic') or row.get('item') or ''
        program_name = row.get('programme_name') or row.get('Program name') or programme_id
        if re.fullmatch(r'CS[1-5]', str(programme_id).strip(), re.IGNORECASE):
            program_name = str(programme_id).strip().upper()
        elif re.fullmatch(r'CM-P\d+', str(programme_id).strip(), re.IGNORECASE):
            program_name = 'CodeMonkey'
        normalized = dict(row)
        normalized.setdefault('programme_id', programme_id)
        normalized['Program name'] = program_name
        normalized['Program'] = program_name
        normalized['Item'] = item_value
        normalized['item'] = item_value
        normalized['Level'] = level_value
        normalized['level'] = level_value
        normalized['Topic'] = row.get('Topic') or item_value
        normalized['topic'] = normalized['Topic']
        return normalized

    def normalize_component_row(row: dict) -> dict:
        normalized = dict(row)
        programme_id = row.get('programme_id') or row.get('Programme ID') or ''
        kit_name = row.get('kit_id') or row.get('Kit') or row.get('Kit name') or ''
        component_name = row.get('item_name') or row.get('Component') or row.get('Component Name') or row.get('Item') or ''
        level_value = row.get('level') or row.get('Level') or ''
        normalized['programme_id'] = programme_id
        normalized['Kit'] = kit_name
        normalized['kit_id'] = kit_name
        normalized['Component'] = component_name
        normalized['Item'] = component_name
        normalized['Tier'] = row.get('Tier') or row.get('tier') or ''
        normalized['Unit Price'] = row.get('Unit Price') or row.get('unit_price') or ''
        normalized['Level'] = level_value
        if level_value not in ('', None):
            try:
                numeric_level = int(float(level_value))
                normalized[f'Lv{numeric_level}'] = row.get(f'Lv{numeric_level}', 1)
            except (TypeError, ValueError):
                pass
        if kit_name:
            normalized['kit_name'] = kit_name
        return normalized

    canonical_data['curriculum'] = [normalize_curriculum_row(row) for row in canonical_data.get('curriculum', [])]
    canonical_data['componentLibrary'] = [normalize_component_row(row) for row in canonical_data.get('componentLibrary', [])]
    canonical_data['robotPrograms'] = [
        {**row,
         'programme_name': row.get('programme_name') or row.get('Programme Name') or row.get('Program name') or row.get('programme_id'),
         'Program name': row.get('programme_name') or row.get('Programme Name') or row.get('Program name') or row.get('programme_id')
         }
        for row in canonical_data.get('robotPrograms', [])
    ]

    inventory_rows = canonical_data['inventory']
    for row in inventory_rows:
        level_values = [int(row.get(f'Lv{level}', 0) or 0) for level in range(1, 9)]
        row['Required Qty'] = max(level_values + [int(row.get('Demo qty', 0) or 0)])
        row['Total center qty'] = int(row.get('Total center qty', 0) or 0)
        row['Result'] = 'Enough' if row['Total center qty'] >= row['Required Qty'] else 'Missing'

    def normalise(value: str) -> str:
        return ''.join(character.lower() for character in value if character.isalnum())

    price_options: dict[str, list[str]] = {}
    for row in price_rows:
        component = row.get('Component', '').strip()
        price = row.get('Unit Price', '').strip()
        if component and price:
            price_options.setdefault(normalise(component), []).append(price)

    component_items = []
    workbook_component_rows = workbook_sources.get('borrowing_log', [])
    if workbook_component_rows:
        for row in workbook_component_rows:
            component = (row.get('Component') or row.get('Component Name') or '').strip()
            student = (row.get('Student') or '').strip()
            if not component or not student:
                continue
            component_items.append({
                'item': component,
                'tier': '',
                'requiredQty': row.get('Quantity') or '1',
                'studentQty': row.get('Quantity') or '1',
                'quantityStatus': 'Enough',
                'student': student,
                'kit': row.get('Kit') or '',
                'level': row.get('Programme Name') or '',
                'unitPrice': '',
                'priceOptions': [],
                'sourcePath': 'CSV export/borrowing_log.csv',
                'sourceRow': row,
            })

    robot_students = []
    for row in student_rows:
        name = row.get('Name', '').strip() or row.get('Student', '').strip()
        if not name:
            continue
        course_type = str(row.get('Course type') or row.get('Course Type') or '').strip().lower()
        program = row.get('Programme Name') or row.get('Programme ID') or row.get('Program') or row.get('Program (text)') or ''
        attendance = row.get('Attendance Status') or row.get('Monthly attendance') or row.get('Check') or ''
        next_robot = row.get('Current Robot') or row.get('Next robot (auto)') or ''
        if course_type == 'robot':
            robot_students.append({
                'name': name,
                'level': row.get('Programme Name') or row.get('Programme ID') or program,
                'attendance': attendance,
                'program': program,
                'nextRobot': next_robot,
                'completion': row.get('Robot Status') == 'Finished' and '100%' or '0%',
                'sourceRow': row,
            })

    coding_students = []
    for row in student_rows:
        name = row.get('Name', '').strip() or row.get('Student', '').strip()
        if not name:
            continue
        course_type = str(row.get('Course type') or row.get('Course Type') or '').strip().lower()
        if course_type == 'coding':
            coding_students.append({
                'name': name,
                'sourceId': f"CSV export/students.csv:{name}",
                'completion': row.get('Robot Status') or '0%',
                'course': row.get('Programme Name') or row.get('Programme ID') or '',
                'lastUpdated': '',
                'attendance': row.get('Attendance Status') or '',
                'nextLevel': row.get("Today's Starting Level") or '',
                'topics': '',
                'sourcePath': 'CSV export/students.csv',
            })

    coding_progress = []
    for row in workbook_sources.get('daily_summary', []) + workbook_sources.get('progress_log', []):
        student_name = row.get('Student', '').strip()
        if not student_name:
            continue
        course_type = str(row.get('Course Type') or row.get('Course type') or '').strip().lower()
        if course_type == 'coding' or row.get('Programme ID', '').startswith('CS'):
            coding_progress.append({
                'name': student_name,
                'sourceId': f"CSV export/students.csv:{student_name}",
                'project': row.get('Comment') or row.get('Progress') or 'Coding progress',
                'progress': row.get('Progress') or row.get("Today's Finished Level") or '',
                'next': row.get("Today's Starting Level") or '',
                'status': row.get('Attendance Status') or '',
                'topics': row.get('Progress') or '',
                'sourceRow': row,
            })

    robot_progress = []
    for row in workbook_sources.get('progress_log', []):
        student_name = row.get('Student', '').strip()
        if not student_name:
            continue
        course_type = str(row.get('Course Type') or row.get('Course type') or '').strip().lower()
        if course_type == 'robot' or row.get('Programme ID', '').startswith(('AIK', 'UAR', 'ROB')):
            robot_progress.append({
                'Robot': row.get('Current Robot') or '',
                'Sequence': 1,
                'Status': 'Done' if str(row.get('Robot Status') or '').lower() == 'finished' else 'In progress',
                'Notes': row.get('Remarks') or row.get('Comment') or '',
                'Level': row.get('Programme Name') or row.get('Programme ID', ''),
                'Student': student_name,
                'Student (linked)': student_name,
                'sourceRow': row,
            })

    borrowings = []
    for row in borrowing_rows:
        borrowings.append({
            'item': row.get('Component') or row.get('Component Name') or row.get('Item') or '',
            'borrower': row.get('Student') or row.get('Borrower') or '',
            'due': row.get('Borrowed On') or row.get('Borrowed on') or row.get('Returned On') or '',
            'status': row.get('Status') or row.get('Outstanding item') or '',
            'sourceRow': row,
        })

    return {
        'robotStudents': robot_students,
        'codingStudents': coding_students,
        'codingProgress': coding_progress,
        'borrowings': borrowings,
        'robotProgress': robot_progress,
        'componentItems': component_items,
        'curriculum': canonical_data.get('curriculum', []),
        'componentLibrary': canonical_data.get('componentLibrary', []),
        'inventory': canonical_data.get('inventory', []),
        'robotPrograms': canonical_data.get('robotPrograms', []),
        'robots': canonical_data.get('robots', []),
        'codingLessons': canonical_data.get('codingLessons', []),
        'robotLessons': canonical_data.get('robotLessons', []),
        'reminders': [],
    }


def main() -> None:
    files = build_workspace_files()
    if not files:
        raise RuntimeError(
            'No CSV exports found. Restore the canonical exports/data files before rebuilding workspace-db.json.'
        )
    tools = build_tool_databases(files)
    database = {
        'workspaceFolders': ['CSV export'],
        'files': files,
        'records': build_records(files),
        **tools,
    }

    OUTPUT_PATH.write_text(json.dumps(database, indent=2), encoding='utf-8')
    print(f'Wrote {OUTPUT_PATH}')


if __name__ == '__main__':
    main()
