# Lengible

A personal study app for medical school, starting with Pathology and Pharmacology. It runs on your phone, tablet and PC, can be installed as an app (PWA), and syncs through Supabase.

**Stack:** Next.js 16 (App Router) + TypeScript + Tailwind, Supabase (login, Postgres, file storage), Google Gemini (free tier) behind `src/lib/ai.ts`, hosted on Vercel. All of it runs on free tiers.

## Setup (one time)

### 1. Supabase: database and login
1. Sign up at [supabase.com](https://supabase.com), click **New project**, name it `lengible`, set a database password (save it) and pick the nearest region. Stay on the Free plan.
2. When the project is ready, open **SQL Editor → New query**, paste everything from `supabase/migrations/0001_foundation.sql` and click **Run**. You should see "Success. No rows returned". Then do the same with `0002_library.sql`, `0003_drugs.sql`, `0004_flashcards.sql`, `0005_quiz_engine.sql` (and any later numbered files, in order).
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
