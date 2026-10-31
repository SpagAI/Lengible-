# Lengible

A personal study app for medical school, starting with Pathology and Pharmacology. It runs on your phone, tablet and PC, can be installed as an app (PWA), and syncs through Supabase.

**Stack:** Next.js 16 (App Router) + TypeScript + Tailwind, Supabase (login, Postgres, file storage), Google Gemini (free tier) behind `src/lib/ai.ts`, hosted on Vercel. All of it runs on free tiers.

## Setup (one time)

### 1. Supabase: database and login
1. Sign up at [supabase.com](https://supabase.com), click **New project**, name it `lengible`, set a database password (save it) and pick the nearest region. Stay on the Free plan.
2. When the project is ready, open **SQL Editor → New query**, paste everything from `supabase/migrations/0001_foundation.sql` and click **Run**. You should see "Success. No rows returned". Then do the same with `0002_library.sql`, `0003_drugs.sql`, `0004_flashcards.sql`, `0005_quiz_engine.sql`, `0006_material_topics.sql`, `0007_drive_links.sql`, `0008_ally_and_history.sql`, `0009_server_processing.sql` (and any later numbered files, in order). Every file is safe to run again.
3. Create your account: **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick **Auto Confirm User**.
4. Lock it down so nobody else can sign up: **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**, and save.
5. Copy your keys from **Project Settings → API** (the page may be called "API Keys"). You need the **Project URL** and the **anon / public** key. Never use the `service_role` / secret key in this app.

### 2. Gemini key (AI)
Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in with Google and click **Create API key**. The AI features from Phase 2 onward use it. The app works without it until then.

### 3. Vercel: put it online
1. Sign up at [vercel.com](https://vercel.com) with your GitHub account.
2. Click **Add New → Project**, import the `Lengible-` repo, and before deploying open **Environment Variables** and add:

   | Name | Value | Type |
   |---|---|---|
   | `SUPABASE_URL` | your Supabase Project URL | any |
   | `SUPABASE_ANON_KEY` | your Supabase publishable key (`sb_publishable_…`) | any |
   | `GEMINI_API_KEY` | your Gemini key | Secret |

   For processing on the server (keeps going with Lengible closed), also add:

   | Name | Value | Type |
   |---|---|---|
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API keys → **secret** key (`sb_secret_…`) | Secret |
   | `CRON_SECRET` | any long random password you make up | Secret |

   Then open `supabase/setup_worker.sql`, put in your site address and that `CRON_SECRET`, and run it once in the SQL Editor:
   Supabase then asks Lengible to carry on processing every minute.

   Optional, to use Claude or ChatGPT instead of Gemini (for everything, or only for Ally):

   | Name | Value |
   |---|---|
   | `AI_PROVIDER` | `gemini` (default), `anthropic` (Claude) or `openai` (ChatGPT) — reading files, quizzes, flashcards |
   | `ALLY_PROVIDER` | the same choices, for the Ally chat only (default: same as `AI_PROVIDER`) |
   | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | the key for the provider you chose (Secret) |
   | `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL`, `ALLY_MODEL` | optional: pin a model (defaults: `claude-opus-5-5`, `gpt-5`, `gemini-flash-latest`) |

   The app also accepts `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`, but Vercel stores *Secret* variables with a `NEXT_PUBLIC_` name as empty, so the plain names are simpler.

3. Click **Deploy**. When it finishes you get a link like `lengible-xxxx.vercel.app`.

### 4. Install on your devices
- **Android (Chrome):** open the link, then menu ⋮ → **Install app** (or **Add to Home screen**).
- **iPhone/iPad (Safari):** Share button → **Add to Home Screen**.
- **PC (Chrome/Edge):** click the install icon at the right end of the address bar.

### How uploads work
Files go straight from your device to Supabase Storage (private to you). Lengible reads the text in your browser, saves it page by page
so it can be searched, then asks the AI to pick out drugs, diseases and organisms (for links between courses). Timetables and topic
lists are read into sessions, topics, lecturers and EOPT dates, which you review before they're added. Photos and scanned PDFs have no
text layer; open them and tap **Read with AI**. Free storage is 1 GB in total, up to 50 MB per file.

### Running on your own computer (optional)
```bash
cp .env.example .env.local   # then fill in the three values
npm install
npm run dev                  # open http://localhost:3000
```

## Project layout
```
src/app/(app)/        signed-in pages: home, courses, library, quiz, flashcards, drugs, progress, more
src/app/login/        sign-in page and actions
src/config/ai.ts      AI model name (switch models here or with GEMINI_MODEL)
src/config/nav.ts     navigation tabs (Emiloju (Clinic) is a disabled placeholder)
src/lib/ai.ts         the only file that talks to the AI provider; caches every answer in ai_cache
src/lib/extract/      reads text from PDF, PowerPoint, Word and text files in the browser
src/lib/analysis/     AI pass over uploads: timetables, topic lists, drugs/diseases found in each file
src/lib/quiz.ts       makes the daily quiz from your materials
src/data/drugs/       Lengible's starting drug list, one file per system (copied into your account, then yours to edit)
src/lib/dailymed.ts   official label images from NIH DailyMed
src/lib/supabase/     Supabase clients for the browser, server and proxy, plus the database types
src/modules/registry.ts  course kinds (pathology, pharmacology, general) and what each one adds
supabase/migrations/  database schema; run new files in order in the SQL Editor
public/sw.js          service worker (install + offline)
```

**Adding a course** such as Medicine or Surgery: use **Courses → New** in the app and choose type "General". A course with its own special tools gets a new kind in `src/modules/registry.ts`.

## Build phases
1. ✅ Foundation: setup, login, database, courses, responsive layout, PWA
2. ✅ Library: folders, uploads, text extraction, viewer, "Open in another app", search; timetable and topic-list import (sessions, lecturers, EOPT dates);
   links between courses (drugs, diseases, organisms); daily 10-question quiz with streak; progress dashboard; blue theme, light/dark, collapsible sidebar
3. ✅ Drug database: 510 drugs in 127 classes/subclasses across the syllabus (marked "needs verification" until you check them), drug tree with search
   (including suffixes like -olol and brand names), drug pages, group pages with mnemonics, compare drugs or groups, edit/add/verify, official
   DailyMed images and your own photos, links from your materials; "By my syllabus" view, "On your syllabus" badges and a "Syllabus only" filter, with every other group marked as an extra beyond your syllabus
4. ✅ Flashcards with spaced repetition (FSRS): decks made from your drug database (one per syllabus group, syllabus cards first) or by
   AI from any uploaded file, plus your own question/answer, fill-in-the-blank and picture cards; Again/Hard/Good/Easy with the next interval
   shown, keyboard keys, a daily new-card limit, a flashcard streak (20 answers or nothing left due), stats on Home and Progress
5. ✅ Quiz engine: build a quiz (MCQ, multiple true/false with optional negative marking, quick-fire, short and long essays marked by AI,
   picture tests from your picture cards), Easy/Medium/Hard, courses and topics, slides only or slides + standard references, 5–30
   questions, timed or untimed; past-question mode weighted toward the topics in your past/MB questions; reuses unanswered questions from
   your bank before asking the AI; sources on every question; flag, edit or delete questions; redo the ones you missed; weak topics with
   what to revise. Drug quizzes from your drug database (name the class, drug ↔ mechanism, odd one out, side-effect profile,
   suffix → class) and "Learn a group" (overview → subgroups → prototype → others → memory aids → mini-quiz)
6. Course intelligence
7. Pathology picture tests and on-request diagrams

## Processing on the server

Every file you upload or bring in from Drive goes into a queue that is worked on the server (every minute by Supabase's
scheduler, and straight away while Lengible is open), so it keeps going with Lengible closed. Each file goes through: copy from
Drive → read the text (PDF, PowerPoint, Word, text) → AI reads picture-only pages → topics, drugs and diseases → what the file is
(course, set like 2K23, lecture/practical/past questions, exam, year, lecturer, topics) → its past questions → search indexing.
Every step saves its place: **Pause**, **Stop**, **Resume** and **Retry** (in the corner panel, per file or for everything) and
network problems carry on from the step where it stopped, and a file that's already processed is never processed again unless it
changes. With a paid Gemini key, several files are processed at once.

**Past questions** (sidebar): every question from MB, EOPT, resit and test papers, with how often each one came back (in any
wording) and in which exams and sets, plus which topics come up every set.

**Reading view**: tap **Read** on a file, or **Select** files in a folder and tap **Read selected**: the slides (or Google's viewer
for linked PowerPoints) or a clean text view page by page, with text size, and it remembers where you stopped.

## Ask Ally and quizzes from your slides

**Ally** is Lengible's study assistant (sidebar → Ask Ally, and a small Ask Ally box on every course, Library folder and file page).
It works like a chat app: your conversations are saved in the list on the left (needs `0008_ally_and_history.sql`), suggestions
fill the message box without sending, and you choose where Ally searches (everything, a course, or Pathology as a whole). Ally first
plans the search from your question and how your files are grouped (course / folder / file names): search words with synonyms and
drug or disease names, the files that fit, and any slides you name ("slides 10–20 of the anaemia lecture"). Lengible then searches
the text and ranks the pages, and Ally answers from the best ones with numbered sources that open the exact slide. "Which slides
cover…" lists where something is; "quiz me on…" builds a quiz written only from those slides. Files not processed yet aren't
searched. Ally also finds pages by meaning (not only matching words), reasons through **clinical cases** across all your courses
(diagnosis, investigations, management, and how the courses link), and answers questions about **past papers** from the question
bank ("how many times has sickle cell come up in MB essays?"). Each question uses two AI calls (provider: `ALLY_PROVIDER`).

**Quiz me on this file / folder**: on a file page (optionally slides from–to) or a Library folder; questions come only from that material.

## Google Drive links (optional)

Library → Google Drive links lists everything in a folder shared "Anyone with the link" (e.g. your class folder). Nothing is taken until
you tick folders or files and tap **Bring in & process**, which saves them in Lengible and reads them. Each file and folder shows a
progress bar (green 100% = processed, red 0% = not processed), and each folder shows exactly how many subfolders and files it holds.
Folders are mirrored and matched to courses. The link is checked when Lengible opens and every hour while it's open (and when you open
the link's page): newer versions of what you brought in replace the old ones and are processed again, new files in folders you brought
in come in and are processed by themselves (ticking alone never starts anything), and changed timetables and topic lists show exactly
what changed before you apply them. **Disconnect** keeps everything you brought in working; **Reconnect** (Drive links page, or paste
the same link again) picks up where it left off without downloading or processing anything twice. PowerPoint and Word files (and anything over 50 MB) aren't copied into Supabase storage: Lengible keeps a link, reads their text on
the server, and shows them with Google's viewer, so there's no size limit and they don't use your 1 GB of free storage. It needs a free Google API key:
console.cloud.google.com → enable **Google Drive API** → Credentials → Create API key (restrict it to Google Drive API) → add
`GOOGLE_DRIVE_API_KEY` in Vercel and redeploy.
