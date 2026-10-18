# Lengible

A personal study app for medical school, starting with Pathology and Pharmacology. It runs on your phone, tablet and PC, can be installed as an app (PWA), and syncs through Supabase.

**Stack:** Next.js 16 (App Router) + TypeScript + Tailwind, Supabase (login, Postgres, file storage), Google Gemini (free tier) behind `src/lib/ai.ts`, hosted on Vercel. All of it runs on free tiers.

## Setup (one time)

### 1. Supabase: database and login
1. Sign up at [supabase.com](https://supabase.com), click **New project**, name it `lengible`, set a database password (save it) and pick the nearest region. Stay on the Free plan.
2. When the project is ready, open **SQL Editor → New query**, paste everything from `supabase/migrations/0001_foundation.sql` and click **Run**. You should see "Success. No rows returned".
3. Create your account: **Authentication → Users → Add user → Create new user**. Enter your email and a password, and tick **Auto Confirm User**.
4. Lock it down so nobody else can sign up: **Authentication → Sign In / Providers**, turn off **Allow new users to sign up**, and save.
5. Copy your keys from **Project Settings → API** (the page may be called "API Keys"). You need the **Project URL** and the **anon / public** key. Never use the `service_role` / secret key in this app.

### 2. Gemini key (AI)
Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey), sign in with Google and click **Create API key**. The AI features from Phase 2 onward use it. The app works without it until then.

### 3. Vercel: put it online
1. Sign up at [vercel.com](https://vercel.com) with your GitHub account.
2. Click **Add New → Project**, import the `Lengible-` repo, and before deploying open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | your Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your Supabase anon / public key |
   | `GEMINI_API_KEY` | your Gemini key |

3. Click **Deploy**. When it finishes you get a link like `lengible-xxxx.vercel.app`.

### 4. Install on your devices
- **Android (Chrome):** open the link, then menu ⋮ → **Install app** (or **Add to Home screen**).
- **iPhone/iPad (Safari):** Share button → **Add to Home Screen**.
- **PC (Chrome/Edge):** click the install icon at the right end of the address bar.

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
src/lib/supabase/     Supabase clients for the browser, server and proxy, plus the database types
src/modules/registry.ts  course kinds (pathology, pharmacology, general) and what each one adds
supabase/migrations/  database schema; run new files in order in the SQL Editor
public/sw.js          service worker (install + offline)
```

**Adding a course** such as Medicine or Surgery: use **Courses → New** in the app and choose type "General". A course with its own special tools gets a new kind in `src/modules/registry.ts`.

## Build phases
1. ✅ Foundation: setup, login, database, courses, responsive layout, PWA
2. Library: uploads, text extraction, viewer, "Open in external app", search
3. Drug database and drug views
4. Flashcards with spaced repetition
5. Quiz engine
6. Course intelligence
7. Pathology picture tests and on-request diagrams
