# Comment for Student Table Builder

Please build the `students` table with a stable `student_id` as the primary key. The frontend must never connect records by student name because names can change or duplicate.

## Required Student Fields

| Column | Type | Required | Example | Purpose |
|---|---|---:|---|---|
| `student_id` | VARCHAR | Yes, unique | `ST002` | Primary key used by every related table |
| `name` | VARCHAR | Yes | `Jason` | Display name |
| `course_type` | VARCHAR | Yes | `Coding` | `Robot` or `Coding` |
| `programme_id` | VARCHAR | Yes | `CODEMONKEY_P1` | Stable programme reference |
| `active_status` | VARCHAR | Yes | `Active` | `Active`, `Paused`, `Completed`, or `Withdrawn` |
| `paid_status` | VARCHAR | Yes | `Paid` | Billing/payment status only |
| `total_hours` | DECIMAL | No | `8.0` | Purchased or assigned hours |
| `remaining_hours` | DECIMAL | No | `5.5` | Remaining lesson hours |
| `hours_completed` | DECIMAL | No | `2.5` | Completed lesson hours |
| `new_bill_start` | DATE | No | `2026-09-01` | Billing period start |
| `remarks` | TEXT | No | `Continue loop practice.` | General student remarks |

## Robot Student Fields

These may be kept in the student table or a separate `robot_student_profiles` table, but the API should return them for robot students:

| Column | Type | Example |
|---|---|---|
| `current_robot_id` | VARCHAR | `ROBOT_DELIVERY` |
| `robot_carry_status` | VARCHAR | `Take Robot Home` |
| `progress_percent` | INTEGER | `60` |
| `checklist_status` | VARCHAR | `Pending` |
|
Allowed `robot_carry_status` values:

- `Take Robot Home`
- `Take Whole Kit Home`
- `Leave Kit At Centre`

## Coding Student Fields

These may be kept in the student table or a separate `coding_student_profiles` table:

| Column | Type | Example |
|---|---|---|
| `current_level` | INTEGER | `28` |
| `current_topic` | VARCHAR | `For Loops` |
| `progress_percent` | INTEGER | `70` |

## Related Tables Must Use student_id

Every related table must contain `student_id` as a foreign key:

- `lessons.student_id`
- `payments.student_id`
- `robot_progress.student_id`
- `student_components.student_id`
- `borrowings.student_id`
- `attendance.student_id`, if attendance is stored separately

Do not use `name` as a foreign key.

## API Response Expected by Frontend

`GET /students` should return a stable JSON shape similar to:

```json
[
  {
    "student_id": "ST002",
    "name": "Jason",
    "course_type": "Coding",
    "programme_id": "CODEMONKEY_P1",
    "active_status": "Active",
    "paid_status": "Paid",
    "total_hours": 8.0,
    "remaining_hours": 5.5,
    "hours_completed": 2.5,
    "new_bill_start": "2026-09-01",
    "remarks": "Continue loop practice.",
    "current_level": 28,
    "current_topic": "For Loops",
    "progress_percent": 70
  }
]
```

`GET /students` should return all active and historical students unless the API supports a filter. The frontend can then filter by `active_status` and `course_type`.

## Today's Students Requirement

Today's Students must come from a separate lessons query, not from all student rows:

```text
GET /lessons?lesson_date=2026-09-21
```

Each lesson record must include:

```json
{
  "lesson_id": "LS001",
  "student_id": "ST002",
  "lesson_date": "2026-09-21",
  "start_time": "16:00",
  "end_time": "17:00",
  "tutor_id": "TU001",
  "tutor_name": "Hazel",
  "lesson_status": "Scheduled",
  "attendance_status": "Upcoming",
  "notes": ""
}
```

The frontend joins `lessons.student_id` to `students.student_id`.

## Authentication Boundary

All protected endpoints must validate the JWT before database logic runs. The frontend sends:

```http
Authorization: Bearer <access_token>
```

Minimum protected endpoints:

- `GET /students`
- `GET /lessons`
- `GET /robot-progress`
- `GET /student-components`
- `GET /centre-inventory`
- `GET /borrowings`

The backend may choose the internal SQL schema, but the response fields above should remain stable for frontend integration.
