# James Workbook Template

The original Excel workbook contains five sheets. CSV files cannot contain multiple sheets, so each sheet is exported as a separate CSV. These files are populated from the current workspace data, not generic sample students.

Files:

- `Students.csv`: student master table, including programme, tutor, attendance, and robot fields.
- `Student_View.csv`: student progress view/report shape.
- `Daily_Summary.csv`: daily lesson records used by Today's Students.
- `Progress_Log.csv`: lesson progress records.
- `Deduction_Log.csv`: lesson-hour deduction records.

Required added fields:

- `Programme ID`
- `Programme Name`
- `Tutor ID`
- `Tutor Name`
- `Attendance Status`: `absent`, `present`, or `planned`
- `Current Robot`
- `Robot Status`: `finished` or `in progress`
- `Today's Starting Level`
- `Today's Finished Level`

Use `Student ID` as the relationship key across all sheets. Do not join sheets by student name. Current robot examples include Adrian Chiu, Kingsley Lo, Amelia Wong, and the other 24 robot students in the workspace. Current coding examples include the three coding student records.

For robot rows, fill the robot fields. For coding rows, leave robot-specific fields blank. `Daily_Summary`, `Progress_Log`, and `Deduction_Log` should include the `Student ID` for every lesson record.
