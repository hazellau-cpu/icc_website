function assertRobotLibraryCompatible(existing, incoming) {
  const expected = new Map(incoming.map((row) => [row.robotId, row]));
  const positions = new Set(incoming.map((row) => `${row.programmeId}:${row.sequence}`));
  const programmes = new Set(incoming.map((row) => row.programmeId));
  if (expected.size !== incoming.length || positions.size !== incoming.length) {
    throw new Error('Robot library contains duplicate IDs or programme sequence positions.');
  }
  for (const row of existing) {
    if (!programmes.has(row.programme_id) && !expected.has(row.robot_id)) continue;
    const match = expected.get(row.robot_id);
    if (!match || match.programmeId !== row.programme_id
      || match.sequence !== Number(row.sequence_number) || match.name !== row.robot_name) {
      throw new Error('Robot library differs from the database. A history-preserving migration is required before importing.');
    }
  }
}

module.exports = { assertRobotLibraryCompatible };
