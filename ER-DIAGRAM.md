# ICC Operations Database ER Diagram

```mermaid
erDiagram
    STUDENTS ||--o{ LESSONS : attends
    STUDENTS ||--o{ PAYMENTS : has
    STUDENTS ||--o{ STUDENT_COMPONENTS : owns
    STUDENTS ||--o{ ROBOT_PROGRESS : follows
    STUDENTS ||--o{ BORROWINGS : borrows
    STUDENTS }o--|| PROGRAMMES : enrolled_in
    TUTORS ||--o{ LESSONS : teaches
    KITS ||--o{ PROGRAMMES : contains
    KITS ||--o{ COMPONENTS : defines
    KITS ||--o{ CENTRE_INVENTORY : stocks
    COMPONENTS ||--o{ CENTRE_INVENTORY : identifies
    COMPONENTS ||--o{ STUDENT_COMPONENTS : required_for
    COMPONENTS ||--o{ BORROWINGS : borrowed_item
    ROBOTS ||--o{ ROBOT_PROGRESS : tracked_in

    STUDENTS {
        string student_id PK
        string name
        string course_type
        string programme_id FK
        string paid_status
        decimal total_hours
        decimal remaining_hours
        decimal hours_completed
        date new_bill_start
        string active_status
        string current_robot
        string robot_carry_status
        int current_level
        string current_topic
        int progress_percent
        string attendance_summary
        string checklist_status
        string quick_notes
    }

    PROGRAMMES {
        string programme_id PK
        string programme_name
        string course_type
        string kit_id FK
        string level
        boolean active
    }

    KITS {
        string kit_id PK
        string kit_name
    }

    TUTORS {
        string tutor_id PK
        string tutor_name
        boolean active
    }

    LESSONS {
        string lesson_id PK
        string student_id FK
        string tutor_id FK
        date lesson_date
        time start_time
        time end_time
        string lesson_status
        string attendance_status
        string notes
    }

    PAYMENTS {
        string payment_id PK
        string student_id FK
        decimal amount
        string payment_status
        date paid_date
        date billing_period_start
        string notes
    }

    ROBOTS {
        string robot_id PK
        string kit_id FK
        string robot_name
        string level
        int sequence
    }

    ROBOT_PROGRESS {
        string progress_id PK
        string student_id FK
        string robot_id FK
        string status
        date completed_date
        string notes
    }

    COMPONENTS {
        string component_id PK
        string component_name
        string category
        string colour
        string tier
    }

    CENTRE_INVENTORY {
        string inventory_id PK
        string kit_id FK
        string component_id FK
        decimal unit_price
        int centre_quantity
        date last_counted
        string notes
    }

    STUDENT_COMPONENTS {
        string student_component_id PK
        string student_id FK
        string kit_id FK
        string component_id FK
        int required_quantity
        int student_quantity
        string checklist_status
        string notes
    }

    BORROWINGS {
        string borrowing_id PK
        string student_id FK
        string component_id FK
        string kit_id FK
        int quantity
        date borrowed_on
        date returned_on
        string borrowing_status
        string notes
    }
```

## Important Keys

- Use `student_id` in every student-related table. Do not join records by student name.
- Use `kit_id + component_id` for centre inventory because the same component name can mean different items in different kits.
- Use `lesson_date` to build the Today's Students page.
- Keep centre inventory separate from student checklist quantities.
- Keep JWT authentication outside this database relationship layer; protected API routes should validate the Bearer token before querying these tables.
