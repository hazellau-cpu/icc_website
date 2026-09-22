export interface Programme {
  programme_id: string;
  programme_name: string;
  course_type: 'Robot' | 'Coding';
  kit_id?: string;
  level?: string;
  active?: boolean;
}

export interface Curriculum {
  curriculum_id: string;
  programme_id: string;
  level: number | string;
  topic: string;
  item?: string;
}

export interface InventoryItem {
  inventory_id?: string;
  kit_id?: string;
  component_id?: string;
  Component: string;
  Kit: string;
  Category?: string;
  Colour?: string;
  Tier?: string;
  'Unit Price'?: string | number;
  'Total center qty'?: string | number;
  'Last counted'?: string;
  Notes?: string;
}

export interface BorrowingLog {
  borrowing_id?: string;
  student_id?: string;
  borrower?: string;
  item: string;
  quantity?: string | number;
  status: 'Still borrowing' | 'Returned';
  borrowed_on?: string;
  returned_on?: string;
  sourceRow?: Record<string, string>;
}

export interface LibraryService {
  load(): Promise<void>;
  getProgrammes(): Programme[];
  getCurriculumByProgramme(programmeId: string): Curriculum[];
  getTopicByLevel(programmeId: string, level: string | number): Curriculum[];
}

export interface InventoryService {
  load(): Promise<void>;
  getItems(): InventoryItem[];
  getItemById(id: string): InventoryItem | undefined;
  createItem(item: InventoryItem): InventoryItem;
  updateItem(id: string, changes: Partial<InventoryItem>): InventoryItem | null;
  deleteItem(id: string): boolean;
}

export interface BorrowingService {
  load(): Promise<void>;
  getBorrowingLogs(): BorrowingLog[];
  createBorrowingLog(log: BorrowingLog): BorrowingLog;
  returnBorrowedItem(id: string | number): BorrowingLog | null;
  getBorrowingHistory(studentId: string): BorrowingLog[];
}
