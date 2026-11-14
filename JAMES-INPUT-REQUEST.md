# James Integration Input Request

Hi James,

I reviewed the embedded exports in `workspace-db.json` and need your confirmation and corrected source data before we treat the Sheets integration as reliable. Please answer the questions below and, where noted, send a corrected CSV/export sample. Please do not send any passwords, API keys, JWTs, or signing secrets.

## 1. Confirm the source of truth

The workspace currently contains these embedded exports:

- `students.csv`: 31 student rows.
- `student_view.csv`: 4 student rows.
- `daily_summary.csv`: 2 lesson rows.
- `progress_log.csv`: 2 progress rows.

Please confirm which sheet/export is authoritative for each endpoint. In particular, is `student_view.csv` intentionally a four-row sample, or should it contain every student? The student API must identify records by the stable `Student ID`; names should only be used as a matching check/display value, never as the record key.

## 2. Students fields and billing data

The `students.csv` header currently includes:

`Student ID`, `Name`, `Course type`, `Paid Status`, `Total Hours`, `Remaining Hours`, `Hours Completed`, `New Bill Start`, and `Remarks`.

In the 31 embedded student rows, `Paid Status`, `Total Hours`, `Remaining Hours`, `Hours Completed`, and `New Bill Start` are blank. Please confirm whether these blanks are correct or whether the export is missing billing data. If those values should be available, please provide an updated export with the real values and confirm:

- Whether hours are decimal hours and what precision to retain.
- The allowed values/meaning of `Paid Status`.
- The date format and meaning of `New Bill Start`.
- Whether blank means unknown/not supplied, rather than zero or unpaid.

Please do not fill these fields with calculated or assumed values.

## 3. Correct the Progress_Log column alignment

The embedded `progress_log.csv` rows do not appear to line up with their own headers. For `ST-R-003` on `2026-09-19`, `daily_summary.csv` says:

| Field | `daily_summary.csv` value |
| --- | --- |
| Tutor Name | Hazel |
| Progress | Shooter |
| Remarks | Still borrowed: 11×15 Frame ×1 |
| Lesson Time | 14:00-16:00 |
| Current Robot | Caterpillar |
| Robot Status | Finished |

The corresponding `progress_log.csv` row puts `Shooter` in `Comment`, the borrowing note in `Progress`, `14:00-16:00` in `Remarks`, `Caterpillar` in `Lesson Time`, and `Finished` in `Current Robot`; `Robot Status` is blank. This strongly suggests a shifted column mapping.

The `ST-C-001` row dated `2026-09-30` also differs: `daily_summary.csv` has `Attendance Status=Planned`, `Today's Starting Level=1`, and `Today's Finished Level=10`; `progress_log.csv` has `Attendance Status=Present`, `Current Robot=In progress`, `Robot Status=1`, `Today's Starting Level=10`, and no finished level.

Please confirm the intended mapping and send a corrected `progress_log.csv` with values aligned to its header. If the embedded daily summary is also wrong, please identify the correct source instead of using either row as assumed truth. Please also confirm whether entries such as `Coding Student Profile — Progress` are test/placeholder records, and whether demo/test students should be excluded from production responses.

## 4. Define the progress fields and latest-row rule

The current `progress_log.csv` header has no `Progress Percent` column, although the integration needs to return the source value without calculating it. Please confirm whether this field exists in the live sheet. If it does, provide its exact header and an example value/format (for example, `60%` or `0.6`). If it does not exist, please confirm that it should be blank.

Please confirm the exact source headers for these fields, including whether `Tutor` means `Tutor Name` and `Date` means the lesson date:

`Date`, `Student ID`, `Student`, `Programme ID`, `Programme Name`, `Tutor ID`, `Tutor Name`, `Course Type`, `Attendance Status`, `Comment`, `Progress`, `Remarks`, `Lesson Time`, `Current Robot`, `Robot Status`, `Today's Starting Level`, `Today's Finished Level`, `Progress Percent`.

The requested progress behavior is one latest row per `Course Type` for the matched student, ordered by date, then lesson start time, then source row number. Please confirm:

- Whether “latest” should use the sheet's `Date` or another timestamp.
- The exact start-time column and format. The current export has `Lesson Time` (examples look like `14:00-16:00`) but no separate `Start Time` column.
- What to do when two rows have the same date and start time; source row number is proposed as the final tie-breaker.
- Whether “per Course Type” means one result for every course type the student has history in, or only the student's current course type.
- Whether a student with no progress rows should return a successful response with an empty `rows` array.

## 5. Confirm the API contract

Please confirm that the partner will call these HTTPS endpoints on the existing ICC service:

```text
GET /api/sheets/students?student_id=<ID>&student_name=<URL-encoded name>
GET /api/sheets/progress/latest?student_id=<ID>&student_name=<URL-encoded name>
```

Both requests use `Authorization: Bearer <JWT>` and no request body. The ID and name must match the same student. Responses use `sheet_name`, `columns`, `rows` (each with `row_number` and string `values`), and `pagination`; values are mapped by `columns` order and blanks are `""`. Please confirm this is the format your integration expects, including the optional `limit` (default 100, max 500) and `offset` (default 0) parameters.

The partner token is issued by ICC and is separate from a student's identity. Please confirm which trusted server-side client will request/hold the token, and provide the exact production browser origin only if a browser will call the API directly. Do not put the token in a URL or public frontend code.

## Reply format

Please reply with:

1. The authoritative source/sheet for each endpoint, and whether `student_view.csv` is a sample or complete export.
2. Whether the blank billing values are expected; if not, the corrected source and field definitions.
3. A corrected `progress_log.csv` (or confirmation of the correct alternative source) and the exact column mapping.
4. The `Progress Percent` header/format, latest-row rules, and treatment of demo/test rows.
5. Confirmation or corrections to the API contract and which trusted client will obtain and use the JWT.

Thanks.