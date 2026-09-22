# Info-2 Library Exports

The library is normalized into two files:

- `robot-library.csv`: AIKIRO, ROBOKIT, and UARO share the same columns.
- `coding-curriculum.csv`: CodeMonkey and CS1-CS5 share the same columns.
- `programme-keys.csv`: exactly the canonical programme catalogue.

Key rules:

- `programme_id` is the relationship key to a programme.
- `item_id` is the relationship key to a robot or curriculum item.
- Robot `level` and `sequence` are integers.
- Coding has no `sequence` column because its level is the sequence.
- AIKIRO original and additional programmes always have different IDs: `AIK-L2-O` and `AIK-L2-A`.
- `kit_id` connects robot programmes to the kit entity in the ER diagram.
