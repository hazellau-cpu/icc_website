# James data handoff

The Cloud SQL import accepts these lesson fields.

## Robot students

Required columns:

`Student Name`, `Tutor Name`, `Programme`, `Robot Name`, `Current Level`, `Lesson Date`, `Robot Status`, `Attendance`, `Comment`, `Remarks`

They are stored in `robot_lessons` and linked by `student_id` and `programme_id`.

## Coding students

Required columns:

`Student Name`, `Tutor Name`, `Programme`, `Lesson Date`, `Attendance`, `Starting Level`, `Ending Level`, `Topic`, `Comment`, `Remarks`

They are stored in `coding_lessons` and linked by `student_id` and `programme_id`.

The importer also accepts the current workspace aliases:

- `Attendance Status` -> `Attendance`
- `Today's Starting Level` -> `Starting Level`
- `Today's Finished Level` -> `Ending Level`
- `Current Robot` -> `Robot Name`
- `Progress` -> `Topic` when `Topic` is empty

Protected API reads:

- `GET /robot-lessons`
- `GET /coding-lessons`

The live Google Sheets partner integration can instead read the `Students`, `Robot Progress Log`, `Coding Progress Log`, and `Math Progress Log` tabs directly. The workbook log tabs use their own headers and are normalized to the partner `Progress_Log` response by the Sheets read router; see the live-source setup in [README.md](README.md).
