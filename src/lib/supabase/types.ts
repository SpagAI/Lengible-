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

export type Profile = { id: string; display_name: string | null; created_at: string };

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
  created_at: string;
};

export type CourseExam = {
  id: string;
  user_id: string;
  course_id: string;
  label: string;
  exam_date: string;
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

export type Topic = {
  id: string;
  user_id: string;
  course_id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
};

export type LecturerTopic = { user_id: string; lecturer_id: string; topic_id: string };

export type AICacheRow = { key: string; user_id: string; model: string; output: string; created_at: string };

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, "display_name" | "created_at">;
      courses: Table<Course, "id" | "user_id" | "code" | "kind" | "notes" | "color" | "sort_order" | "archived" | "created_at">;
      course_exams: Table<CourseExam, "id" | "user_id" | "label" | "created_at">;
      lecturers: Table<Lecturer, "id" | "user_id" | "notes" | "created_at">;
      topics: Table<Topic, "id" | "user_id" | "parent_id" | "sort_order" | "created_at">;
      lecturer_topics: Table<LecturerTopic, "user_id">;
      ai_cache: Table<AICacheRow, "user_id" | "created_at">;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
