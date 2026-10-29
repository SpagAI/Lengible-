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

export type Profile = { id: string; display_name: string | null; structure_version: number; new_cards_per_day: number; created_at: string };

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

export type QuestionFormat = "quickfire" | "mcq" | "tf" | "short_essay" | "long_essay" | "picture";
export type Difficulty = "easy" | "medium" | "hard";
export type MarkingPoint = { point: string; marks: number };

export type Question = {
  id: string;
  user_id: string;
  course_id: string | null;
  topic_id: string | null;
  format: QuestionFormat;
  difficulty: Difficulty;
  stem: string;
  options: string[];
  // mcq: option index · tf: true/false per statement · quickfire/picture: answer text · essays: ""
  answer: number | boolean[] | string;
  model_answer: string | null;
  marking_points: MarkingPoint[] | null;
  source_kind: "material" | "past" | "mb" | "standard" | "drugs" | "picture" | null;
  image_path: string | null;
  card_id: string | null;
  drug_class_id: string | null;
  edited: boolean;
  updated_at: string | null;
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
  quiz_session_id: string | null;
  chosen: unknown;
  correct: boolean;
  score: number | null;
  answer_text: string | null;
  feedback: EssayFeedback | null;
  topic_name: string | null;
  created_at: string;
};

export type EssayFeedback = {
  points: { point: string; marks: number; awarded: number; comment: string }[];
  feedback: string;
  missed: string[];
};

export type QuizSettings = {
  formats: QuestionFormat[];
  difficulty: Difficulty;
  course_ids: string[];
  topics: string[];
  source: "slides" | "mixed" | "past";
  count: number;
  timed: boolean;
  negative_marking: boolean;
  // Drug quizzes
  drug_types?: string[];
  scope?: string;
  // Notes shown on the quiz (e.g. "No picture cards yet").
  notes?: string[];
};

export type QuizSession = {
  id: string;
  user_id: string;
  mode: "custom" | "past" | "drugs" | "group";
  title: string;
  settings: QuizSettings;
  question_ids: string[];
  time_limit: number | null;
  started_at: string | null;
  finished_at: string | null;
  score: number | null;
  created_at: string;
};

export type SearchHit = { chunk_id: string; file_id: string; file_name: string; course_id: string | null; page: number; snippet: string; rank: number };

export type LecturerTopic = { user_id: string; lecturer_id: string; topic_id: string };

export type AICacheRow = { key: string; user_id: string; model: string; output: string; created_at: string };

export type DrugClass = {
  id: string;
  user_id: string;
  seed_key: string | null;
  parent_id: string | null;
  name: string;
  system: string;
  description: string | null;
  mnemonic: string | null;
  recognition_tip: string | null;
  sort_order: number;
  verified: boolean;
  edited: boolean;
  created_at: string;
  updated_at: string;
};

export type Drug = {
  id: string;
  user_id: string;
  seed_key: string | null;
  class_id: string;
  name: string;
  is_prototype: boolean;
  mechanism: string | null;
  indications: string[];
  side_effects: string[];
  contraindications: string[];
  interactions: string[];
  pharmacokinetics: string | null;
  brands: string[];
  nigerian_context: string | null;
  notes: string | null;
  verified: boolean;
  edited: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type DrugImage = {
  id: string;
  user_id: string;
  drug_id: string;
  url: string | null;
  storage_path: string | null;
  source: string;
  source_url: string | null;
  caption: string | null;
  created_at: string;
};

export type Deck = {
  id: string;
  user_id: string;
  name: string;
  course_id: string | null;
  kind: "drugs" | "material" | "custom";
  drug_class_id: string | null;
  file_id: string | null;
  next_offset: number;
  created_at: string;
};

export type CardKind = "basic" | "cloze" | "image";

export type FlashCard = {
  id: string;
  user_id: string;
  deck_id: string;
  course_id: string | null;
  kind: CardKind;
  front: string;
  back: string;
  extra: string | null;
  image_path: string | null;
  source: "drug" | "material" | "manual";
  source_ref: string | null;
  drug_id: string | null;
  file_id: string | null;
  page: number | null;
  priority: number;
  suspended: boolean;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
  created_at: string;
  updated_at: string;
};

export type CardReview = {
  id: string;
  user_id: string;
  card_id: string;
  rating: number;
  state: number;
  scheduled_days: number;
  review_date: string;
  duration_ms: number | null;
  created_at: string;
};

export type FlashcardDay = { user_id: string; day: string; reviews: number; done: boolean };

export type DeckCount = { deck_id: string; total: number; due_now: number; new_count: number; suspended: number };

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, "display_name" | "structure_version" | "new_cards_per_day" | "created_at">;
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
      questions: Table<
        Question,
        | "id" | "user_id" | "course_id" | "topic_id" | "format" | "difficulty" | "options" | "explanation" | "why_wrong" | "source_label" | "source_file_id"
        | "source_page" | "topic_name" | "flagged" | "flag_note" | "created_at" | "model_answer" | "marking_points" | "source_kind" | "image_path" | "card_id"
        | "drug_class_id" | "edited" | "updated_at"
      >;
      quiz_sessions: Table<QuizSession, "id" | "user_id" | "mode" | "settings" | "question_ids" | "time_limit" | "started_at" | "finished_at" | "score" | "created_at">;
      daily_quizzes: Table<DailyQuiz, "id" | "user_id" | "score" | "completed_at" | "created_at">;
      drug_classes: Table<DrugClass, "id" | "user_id" | "seed_key" | "parent_id" | "description" | "mnemonic" | "recognition_tip" | "sort_order" | "verified" | "edited" | "created_at" | "updated_at">;
      drugs: Table<Drug, "id" | "user_id" | "seed_key" | "is_prototype" | "mechanism" | "indications" | "side_effects" | "contraindications" | "interactions" | "pharmacokinetics" | "brands" | "nigerian_context" | "notes" | "verified" | "edited" | "sort_order" | "created_at" | "updated_at">;
      drug_images: Table<DrugImage, "id" | "user_id" | "url" | "storage_path" | "source_url" | "caption" | "created_at">;
      attempts: Table<Attempt, "id" | "user_id" | "course_id" | "daily_quiz_id" | "quiz_session_id" | "chosen" | "score" | "answer_text" | "feedback" | "topic_name" | "created_at">;
      lecturer_topics: Table<LecturerTopic, "user_id">;
      ai_cache: Table<AICacheRow, "user_id" | "created_at">;
      decks: Table<Deck, "id" | "user_id" | "course_id" | "kind" | "drug_class_id" | "file_id" | "next_offset" | "created_at">;
      cards: Table<
        FlashCard,
        | "id" | "user_id" | "course_id" | "kind" | "extra" | "image_path" | "source" | "source_ref" | "drug_id" | "file_id" | "page" | "priority"
        | "suspended" | "due" | "stability" | "difficulty" | "elapsed_days" | "scheduled_days" | "learning_steps" | "reps" | "lapses" | "state"
        | "last_review" | "created_at" | "updated_at"
      >;
      card_reviews: Table<CardReview, "id" | "user_id" | "scheduled_days" | "duration_ms" | "created_at">;
      flashcard_days: Table<FlashcardDay, "user_id" | "reviews" | "done">;
    };
    Views: Record<string, never>;
    Functions: {
      search_chunks: { Args: { q: string; course?: string | null; lim?: number }; Returns: SearchHit[] };
      deck_counts: { Args: Record<string, never>; Returns: DeckCount[] };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
