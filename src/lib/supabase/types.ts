// Database types, kept in step with supabase/migrations by hand.
// (You can regenerate them later with `npx supabase gen types typescript`.)

type Row<T> = T;
type Insert<T, Optional extends keyof T> = Omit<T, Optional> & Partial<Pick<T, Optional>>;
type Table<R, O extends keyof R> = {
  Row: Row<R>;
  Insert: Insert<R, O>;
  Update: Partial<R>;
  Relationships: [];
};

export type CourseKind = "general" | "pathology" | "pharmacology";

export type Profile = { id: string; display_name: string | null; structure_version: number; created_at: string };

export type Course = {
  id: string;
  user_id: string;
  name: string;
  code: string | null;
  kind: CourseKind;
  notes: string | null;
  color: string;
  sort_order: number;
  archived: boolean;
  parent_id: string | null;
  is_group: boolean;
  short_name: string | null;
  created_at: string;
};

export type ExamKind = "exam" | "eopt" | "test" | "mb" | "other";

export type CourseExam = {
  id: string;
  user_id: string;
  course_id: string;
  label: string;
  exam_date: string;
  kind: ExamKind;
  block_id: string | null;
  start_time: string | null;
  venue: string | null;
  confirmed: boolean;
  source_file_id: string | null;
  created_at: string;
};

export type Lecturer = {
  id: string;
  user_id: string;
  course_id: string;
  name: string;
  notes: string | null;
  created_at: string;
};

export type SessionType = "section" | "lecture" | "tutorial" | "practical" | "other";

export type Topic = {
  id: string;
  user_id: string;
  course_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  block_id: string | null;
  session_type: SessionType;
  lecturer_id: string | null;
  created_at: string;
};

export type Block = { id: string; user_id: string; name: string; start_date: string | null; end_date: string | null; created_at: string };

export type DocType =
  | "slides" | "timetable" | "topic_list" | "textbook" | "past_questions" | "picture_test"
  | "practical" | "manual" | "essay" | "mb_questions" | "notes" | "other";
export type FileStatus = "uploaded" | "extracted" | "no_text" | "analysed" | "failed";

export type Folder = { id: string; user_id: string; course_id: string | null; parent_id: string | null; name: string; created_at: string };

export type LibraryFile = {
  id: string;
  user_id: string;
  course_id: string | null;
  folder_id: string | null;
  topic_id: string | null;
  name: string;
  doc_type: DocType;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  status: FileStatus;
  error: string | null;
  page_count: number | null;
  analysis: unknown;
  version: number;
  created_at: string;
  updated_at: string;
};

export type Chunk = { id: string; user_id: string; file_id: string; course_id: string | null; page: number; content: string };

export type ScheduleSession = {
  id: string;
  user_id: string;
  course_id: string;
  block_id: string | null;
  topic_id: string | null;
  source_file_id: string | null;
  session_date: string;
  start_time: string | null;
  end_time: string | null;
  session_type: string;
  title: string;
  lecturer: string | null;
  venue: string | null;
  groups: string | null;
  created_at: string;
};

export type ConceptKind = "drug" | "disease" | "organism" | "investigation" | "other";
export type Concept = { id: string; user_id: string; name: string; kind: ConceptKind; aliases: string[]; notes: string | null; created_at: string };
export type FileConcept = { user_id: string; file_id: string; concept_id: string; pages: number[] };

export type Question = {
  id: string;
  user_id: string;
  course_id: string | null;
  topic_id: string | null;
  format: string;
  difficulty: string;
  stem: string;
  options: string[];
  answer: number;
  explanation: string | null;
  why_wrong: Record<string, string> | null;
  source_label: string | null;
  source_file_id: string | null;
  source_page: number | null;
  topic_name: string | null;
  flagged: boolean;
  flag_note: string | null;
  created_at: string;
};

export type DailyQuiz = {
  id: string;
  user_id: string;
  quiz_date: string;
  question_ids: string[];
  score: number | null;
  completed_at: string | null;
  created_at: string;
};

export type Attempt = {
  id: string;
  user_id: string;
  question_id: string;
  course_id: string | null;
  daily_quiz_id: string | null;
  chosen: unknown;
  correct: boolean;
  created_at: string;
};

export type SearchHit = { chunk_id: string; file_id: string; file_name: string; course_id: string | null; page: number; snippet: string; rank: number };

export type LecturerTopic = { user_id: string; lecturer_id: string; topic_id: string };

export type AICacheRow = { key: string; user_id: string; model: string; output: string; created_at: string };

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, "display_name" | "structure_version" | "created_at">;
      courses: Table<Course, "id" | "user_id" | "code" | "kind" | "notes" | "color" | "sort_order" | "archived" | "parent_id" | "is_group" | "short_name" | "created_at">;
      course_exams: Table<CourseExam, "id" | "user_id" | "label" | "kind" | "block_id" | "start_time" | "venue" | "confirmed" | "source_file_id" | "created_at">;
      lecturers: Table<Lecturer, "id" | "user_id" | "notes" | "created_at">;
      topics: Table<Topic, "id" | "user_id" | "parent_id" | "sort_order" | "block_id" | "session_type" | "lecturer_id" | "created_at">;
      blocks: Table<Block, "id" | "user_id" | "start_date" | "end_date" | "created_at">;
      folders: Table<Folder, "id" | "user_id" | "course_id" | "parent_id" | "created_at">;
      files: Table<LibraryFile, "id" | "user_id" | "course_id" | "folder_id" | "topic_id" | "doc_type" | "mime_type" | "size_bytes" | "status" | "error" | "page_count" | "analysis" | "version" | "created_at" | "updated_at">;
      chunks: Table<Chunk, "id" | "user_id" | "course_id">;
      schedule_sessions: Table<ScheduleSession, "id" | "user_id" | "block_id" | "topic_id" | "source_file_id" | "start_time" | "end_time" | "session_type" | "lecturer" | "venue" | "groups" | "created_at">;
      concepts: Table<Concept, "id" | "user_id" | "kind" | "aliases" | "notes" | "created_at">;
      file_concepts: Table<FileConcept, "user_id" | "pages">;
      questions: Table<Question, "id" | "user_id" | "course_id" | "topic_id" | "format" | "difficulty" | "options" | "explanation" | "why_wrong" | "source_label" | "source_file_id" | "source_page" | "topic_name" | "flagged" | "flag_note" | "created_at">;
      daily_quizzes: Table<DailyQuiz, "id" | "user_id" | "score" | "completed_at" | "created_at">;
      attempts: Table<Attempt, "id" | "user_id" | "course_id" | "daily_quiz_id" | "chosen" | "created_at">;
      lecturer_topics: Table<LecturerTopic, "user_id">;
      ai_cache: Table<AICacheRow, "user_id" | "created_at">;
    };
    Views: Record<string, never>;
    Functions: {
      search_chunks: { Args: { q: string; course?: string | null; lim?: number }; Returns: SearchHit[] };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
