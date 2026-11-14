const fs = require('node:fs');
const path = require('node:path');
const { transaction } = require('./db');
const { assertRobotLibraryCompatible } = require('./robot-library-import-check');

const databasePath = path.resolve(__dirname, '..', 'workspace-db.json');
const workspace = JSON.parse(fs.readFileSync(databasePath, 'utf8'));

const text = (value) => String(value ?? '').trim();
const number = (value) => Number(value) || 0;
const optionalNumber = (value) => {
  const raw = text(value);
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};
const date = (value) => text(value) || null;

async function importData() {
  await transaction(async (connection) => {
    for (const row of workspace.robotPrograms || []) {
      await connection.execute(
        `INSERT INTO programmes (programme_id, programme_name, programme_type, kit_id, level_number, variant)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE programme_name = VALUES(programme_name), programme_type = VALUES(programme_type), kit_id = VALUES(kit_id), level_number = VALUES(level_number), variant = VALUES(variant)`,
        [text(row.programme_id), text(row.programme_name), text(row.programme_type), text(row.kit_id) || null, Number(row.level) || null, /additional/i.test(text(row.programme_name)) ? 'additional' : /original/i.test(text(row.programme_name)) ? 'original' : null],
      );
    }

    for (const row of workspace.curriculum || []) {
      const programmeId = text(row.programme_id);
      const itemId = text(row.item_id) || `${programmeId}-L${number(row.Level ?? row.level)}`;
      if (!programmeId || !itemId) continue;
      await connection.execute(
        `INSERT INTO curriculum_items (curriculum_id, programme_id, level_number, item_name)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE level_number = VALUES(level_number), item_name = VALUES(item_name)`,
        [itemId, programmeId, number(row.Level ?? row.level), text(row.Item ?? row.item_name)],
      );
    }

    const robotRows = (workspace.robots || []).map((row) => ({
      robotId: text(row.item_id) || `${text(row['Programme ID'])}-R${number(row.Sequence)}`,
      programmeId: text(row['Programme ID'] ?? row.programme_id),
      sequence: number(row.Sequence ?? row.sequence),
      name: text(row['Robot name'] ?? row.item_name),
    })).filter((row) => row.robotId && row.programmeId);
    const [existingRobots] = await connection.execute(
      'SELECT robot_id, programme_id, sequence_number, robot_name FROM robot_library_items',
    );
    assertRobotLibraryCompatible(existingRobots, robotRows);

    for (const row of robotRows) {
      await connection.execute(
        `INSERT INTO robot_library_items (robot_id, programme_id, sequence_number, robot_name)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE sequence_number = VALUES(sequence_number), robot_name = VALUES(robot_name)`,
        [row.robotId, row.programmeId, row.sequence, row.name],
      );
    }

    for (const row of workspace.inventory || []) {
      const componentId = text(row['Component ID']);
      if (!componentId) continue;
      await connection.execute(
        `INSERT INTO components (component_id, kit_id, component_name, unit_price, tier)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE kit_id = VALUES(kit_id), component_name = VALUES(component_name), unit_price = VALUES(unit_price), tier = VALUES(tier)`,
        [componentId, text(row.Kit), text(row.Component), number(row['Unit Price']), text(row.Tier) || null],
      );
      await connection.execute(
        `INSERT INTO inventory_items (inventory_id, component_id, centre_quantity, last_counted, notes)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE centre_quantity = VALUES(centre_quantity), last_counted = VALUES(last_counted), notes = VALUES(notes)`,
        [`INV-${componentId}`, componentId, number(row['Total center qty']), date(row['Last counted']), text(row.Notes) || null],
      );
      for (let level = 1; level <= 8; level += 1) {
        await connection.execute(
          `INSERT INTO component_level_requirements (component_id, level_number, level_quantity, cumulative_quantity)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE level_quantity = VALUES(level_quantity), cumulative_quantity = VALUES(cumulative_quantity)`,
          [componentId, level, number(row[`Lv${level}`]), number(row[`Lv${level} total`])],
        );
      }
    }

    const studentsSource = (workspace.files || []).find((file) => file.path === 'CSV export/students.csv');
    const studentSourceByName = new Map((studentsSource?.rows || []).map((row) => [text(row.Name), row]));
    const studentSourceById = new Map((studentsSource?.rows || []).map((row, index) => [text(row['Student ID']), { ...row, source_row_number: index + 2 }]));
    const studentIdsByName = new Map();
    if ((workspace.mathStudents || []).length) {
      await connection.execute(
        `INSERT INTO programmes (programme_id, programme_name, programme_type) VALUES ('MATH', 'Math', 'Math')
         ON DUPLICATE KEY UPDATE programme_name = VALUES(programme_name), programme_type = VALUES(programme_type)`,
      );
    }
    for (const row of [...(workspace.robotStudents || []), ...(workspace.codingStudents || []), ...(workspace.mathStudents || [])]) {
      const studentId = text(row.sourceRow?.['Student ID'] || studentSourceByName.get(text(row.name))?.['Student ID']);
      const source = { ...(studentSourceById.get(studentId) || studentSourceByName.get(text(row.name)) || {}), ...(row.sourceRow || {}) };
      const programmeId = text(source['Programme ID']) || (row.studentType === 'Math' ? 'MATH' : (workspace.robotPrograms || []).find((programme) => text(programme.programme_name) === text(row.program ?? row.course))?.programme_id);
      if (!studentId || !programmeId) continue;
      const courseType = row.studentType === 'Math' || text(row.course) === 'Math'
        ? 'Math'
        : row.studentType === 'Coding' || Boolean(text(row.course))
          ? 'Coding'
          : 'Robot';
      studentIdsByName.set(text(row.name), studentId);
      await connection.execute(
        `INSERT INTO students (student_id, student_name, course_type, programme_id, tutor_name, attendance_status, paid_status, current_robot, robot_status, progress, comment, total_hours, remaining_hours, hours_completed, new_bill_start, remarks, source_row_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE student_name = VALUES(student_name), course_type = VALUES(course_type), programme_id = VALUES(programme_id), tutor_name = VALUES(tutor_name), attendance_status = VALUES(attendance_status), paid_status = VALUES(paid_status), current_robot = VALUES(current_robot), robot_status = VALUES(robot_status), progress = VALUES(progress), comment = VALUES(comment), total_hours = VALUES(total_hours), remaining_hours = VALUES(remaining_hours), hours_completed = VALUES(hours_completed), new_bill_start = VALUES(new_bill_start), remarks = VALUES(remarks), source_row_number = VALUES(source_row_number)`,
        [studentId, text(row.name), courseType, programmeId, text(source['Tutor Name']) || text(row.tutor) || null, text(row.attendance) || null, text(source['Paid Status']) || null, text(row.nextRobot ?? source['Current Robot']) || null, text(source['Robot Status']) || null, text(row.progress || row.topics || source.Progress) || null, text(row.comment || source.Comment) || null, optionalNumber(source['Total Hours']), optionalNumber(source['Remaining Hours']), optionalNumber(source['Hours Completed']), date(source['New Bill Start']), text(source.Remarks || row.remarks) || null, Number(source.source_row_number) || null],
      );
    }

    const programmeForStudent = (studentId) => {
      const row = [...(workspace.robotStudents || []), ...(workspace.codingStudents || []), ...(workspace.mathStudents || [])].find((student) => studentIdsByName.get(text(student.name)) === studentId);
      const source = row?.sourceRow || studentSourceByName.get(text(row?.name)) || {};
      return text(source['Programme ID']) || (row?.studentType === 'Math' ? 'MATH' : text(row?.course) === 'Math' ? 'MATH' : '');
    };
    for (const row of workspace.robotProgress || []) {
      const studentId = text(row.studentId) || studentIdsByName.get(text(row.Student || row['Student (linked)']));
      const programmeId = text(row.sourceRow?.['Programme ID']) || programmeForStudent(studentId);
      if (!studentId || !programmeId || !text(row.Robot)) continue;
      await connection.execute(
        `INSERT INTO student_robot_progress (student_id, programme_id, robot_name, sequence_number, status, notes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE sequence_number = VALUES(sequence_number), status = VALUES(status), notes = VALUES(notes)`,
        [studentId, programmeId, text(row.Robot), number(row.Sequence) || null, text(row.Status) || null, text(row.Notes) || null],
      );
    }
    for (const row of workspace.codingProgress || []) {
      const studentId = text(row.studentId) || studentIdsByName.get(text(row.name));
      const programmeId = text(row.sourceRow?.['Programme ID']) || programmeForStudent(studentId);
      const topic = text(row.topics || row.project || row.progress);
      if (!studentId || !programmeId || !topic) continue;
      await connection.execute(
        `INSERT INTO student_topic_progress (student_id, programme_id, level_number, topic, status, notes)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE status = VALUES(status), notes = VALUES(notes)`,
        [studentId, programmeId, text(row.next) || null, topic, text(row.status) || null, text(row.project) || null],
      );
    }
    for (const row of workspace.componentItems || []) {
      const studentId = text(row.studentId) || studentIdsByName.get(text(row.student));
      const componentId = text(row.componentId);
      const programmeId = text(row.sourceRow?.['Programme ID']) || programmeForStudent(studentId);
      if (!studentId || !componentId || !programmeId) continue;
      await connection.execute(
        `INSERT INTO student_checklist_items (student_id, component_id, required_quantity, student_quantity, status, notes, generated_for_programme_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE required_quantity = VALUES(required_quantity), student_quantity = VALUES(student_quantity), status = VALUES(status), notes = VALUES(notes), generated_for_programme_id = VALUES(generated_for_programme_id)`,
        [studentId, componentId, number(row.requiredQty), row.studentQty === '' ? null : number(row.studentQty), text(row.quantityStatus) || 'Missing', text(row.sourceRow?.Notes) || null, programmeId],
      );
    }

    const componentsByName = new Map((workspace.inventory || []).map((row) => [`${text(row.Kit)}:${text(row.Component)}`, text(row['Component ID'])]));
    for (const row of workspace.borrowings || []) {
      const source = row.sourceRow || {};
      const studentId = studentIdsByName.get(text(row.borrower));
      const componentId = componentsByName.get(`${text(source.Kit)}:${text(row.item)}`);
      if (!studentId || !componentId) continue;
      const borrowingId = text(source['Borrowing ID']) || `BOR-${studentId}-${componentId}`;
      await connection.execute(
        `INSERT INTO borrowing_logs (borrowing_id, student_id, component_id, quantity, status, borrowed_on, returned_on, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), status = VALUES(status), borrowed_on = VALUES(borrowed_on), returned_on = VALUES(returned_on), notes = VALUES(notes)`,
        [borrowingId, studentId, componentId, number(source.Quantity) || 1, text(row.status) || 'Still borrowing', date(source['Borrowed On'] ?? source['Borrowed on']) || new Date().toISOString().slice(0, 10), date(source['Returned On'] ?? source['Returned on']), text(source.Notes) || null],
      );
    }

    const sourceRows = (filename) => (workspace.files || []).find((file) => file.path === `CSV export/${filename}`)?.rows || [];
    const studentIdByName = new Map(studentIdsByName);
    const programmeIdByName = new Map((workspace.robotPrograms || []).map((row) => [text(row.programme_name), text(row.programme_id)]));
    const programmeIdFor = (row, student) => text(row['Programme ID']) || programmeIdByName.get(text(row['Programme Name'])) || text(student?.sourceRow?.['Programme ID']);
    const studentByName = new Map([...(workspace.robotStudents || []), ...(workspace.codingStudents || []), ...(workspace.mathStudents || [])].map((row) => [text(row.name), row]));
    const lessonDateFor = (row) => date(row['Lesson Date'] || row.Date || row['Lesson time']?.split(' ')[0]);

    for (const row of sourceRows('daily_summary.csv').concat(sourceRows('progress_log.csv'))) {
      const studentName = text(row.Student || row['Student Name']);
      const studentId = studentIdByName.get(studentName);
      const student = studentByName.get(studentName);
      const programmeId = programmeIdFor(row, student);
      const lessonDate = lessonDateFor(row);
      if (!studentId || !programmeId || !lessonDate) continue;
      const courseType = text(row['Course Type'] || row['Course type']).toLowerCase();
      if (courseType === 'robot' || /^AIK|^UAR|^ROB/i.test(programmeId)) {
        await connection.execute(
          `INSERT INTO robot_lessons (student_id, tutor_name, programme_id, robot_name, current_level, lesson_date, robot_status, attendance, comment, remarks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE tutor_name = VALUES(tutor_name), current_level = VALUES(current_level), robot_status = VALUES(robot_status), attendance = VALUES(attendance), comment = VALUES(comment), remarks = VALUES(remarks)`,
          [studentId, text(row['Tutor Name'] || row.Tutor), programmeId, text(row['Robot Name'] || row['Current Robot']), text(row['Current Level'] || row["Today's Starting Level"]), lessonDate, text(row['Robot Status']), text(row.Attendance || row['Attendance Status']), text(row.Comment), text(row.Remarks)],
        );
      } else if (courseType === 'coding' || /^CS|^CM-/i.test(programmeId)) {
        await connection.execute(
          `INSERT INTO coding_lessons (student_id, tutor_name, programme_id, lesson_date, attendance, starting_level, ending_level, topic, comment, remarks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE tutor_name = VALUES(tutor_name), attendance = VALUES(attendance), starting_level = VALUES(starting_level), ending_level = VALUES(ending_level), topic = VALUES(topic), comment = VALUES(comment), remarks = VALUES(remarks)`,
          [studentId, text(row['Tutor Name'] || row.Tutor), programmeId, lessonDate, text(row.Attendance || row['Attendance Status']), text(row['Starting Level'] || row["Today's Starting Level"]), text(row['Ending Level'] || row["Today's Finished Level"]), text(row.Topic || row.Progress), text(row.Comment), text(row.Remarks)],
        );
      }
    }

    for (const [index, row] of sourceRows('progress_log.csv').entries()) {
      const studentId = text(row['Student ID']) || studentIdByName.get(text(row.Student || row['Student Name']));
      const recordDate = lessonDateFor(row);
      const courseType = text(row['Course Type'] || row['Course type']);
      if (!studentId || !recordDate || !courseType) continue;
      const lessonTime = text(row['Lesson Time']);
      const startMatch = (text(row['Start Time']) || lessonTime).match(/(?:^|\s)(\d{1,2}:\d{2})/);
      const startTime = startMatch ? `${startMatch[1].padStart(5, '0')}:00` : null;
      await connection.execute(
        `INSERT INTO progress_log_entries (student_id, row_number, record_date, start_time, programme_id, programme_name, tutor_id, tutor_name, course_type, attendance_status, comment, progress, remarks, lesson_time, current_robot, robot_status, starting_level, finished_level, progress_percent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE start_time = VALUES(start_time), programme_id = VALUES(programme_id), programme_name = VALUES(programme_name), tutor_id = VALUES(tutor_id), tutor_name = VALUES(tutor_name), attendance_status = VALUES(attendance_status), comment = VALUES(comment), progress = VALUES(progress), remarks = VALUES(remarks), lesson_time = VALUES(lesson_time), current_robot = VALUES(current_robot), robot_status = VALUES(robot_status), starting_level = VALUES(starting_level), finished_level = VALUES(finished_level), progress_percent = VALUES(progress_percent)`,
        [studentId, index + 2, recordDate, startTime, text(row['Programme ID']) || null, text(row['Programme Name']) || null, text(row['Tutor ID']) || null, text(row.Tutor) || null, courseType, text(row['Attendance Status']) || null, text(row.Comment) || null, text(row.Progress) || null, text(row.Remarks) || null, lessonTime || null, text(row['Current Robot']) || null, text(row['Robot Status']) || null, text(row["Today's Starting Level"]) || null, text(row["Today's Finished Level"]) || null, text(row['Progress Percent']) || null],
      );
    }
  });
}

importData().then(() => console.log('Imported workspace-db.json into Cloud SQL.')).catch((error) => { console.error(error); process.exitCode = 1; });
