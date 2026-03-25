# Allez Fencing Hub — Complete Deployment Guide
# dashboard.allezfencing.com

## Overview
This guide takes you from zero to a live dashboard in approximately 90 minutes.
No prior technical experience required — follow each step in order.

---

## PART 1 — ACCOUNTS TO CREATE (15 minutes)
Create accounts on these four free services. Keep all the credentials safe.

### 1.1 GitHub
- Go to github.com → Sign up (free)
- This is where the code lives

### 1.2 Supabase (database)
- Go to supabase.com → Start your project (free)
- Create a new project called "allez-hub"
- Region: Europe (West) — closest to Brentwood
- Note down your project URL and anon/service keys

### 1.3 Vercel (frontend hosting)
- Go to vercel.com → Sign up with your GitHub account
- Free tier is sufficient for club use

### 1.4 Railway (backend hosting)
- Go to railway.app → Login with GitHub
- Free tier: $5/month free credit — more than enough

### 1.5 Resend (email)
- Go to resend.com → Sign up (free, 3,000 emails/month)
- Verify your domain: allezfencing.com
- Add the DNS TXT record they provide (takes 10 minutes)
- Create an API key — save it

---

## PART 2 — DATABASE SETUP (10 minutes)

### 2.1 Open Supabase SQL Editor
1. Go to app.supabase.com → select your project
2. Click "SQL Editor" in the left sidebar
3. Click "New query"

### 2.2 Run the schema
1. Open the file `docs/schema.sql` from this project
2. Copy ALL the contents
3. Paste into Supabase SQL Editor
4. Click "Run" (the green button)
5. You should see "Success. No rows returned"

### 2.3 Verify tables were created
1. Click "Table Editor" in left sidebar
2. You should see these tables:
   - users
   - otp_codes
   - fencers
   - competitions
   - bouts
   - scrape_log
   - coach_notes
   - checklist_state

### 2.4 Add Chris's coach account
In SQL Editor, run:
```sql
-- Update with Chris's actual email
UPDATE users SET email = 'christian@allezfencing.com' WHERE role = 'coach';
```

### 2.5 Add each fencer
For each Allez fencer, run (update with real values):
```sql
-- First create the user account
INSERT INTO users (email, role, name) VALUES
  ('parent@email.com', 'fencer', 'Ajith Badhrinath');

-- Then create the fencer record, linking to that user
INSERT INTO fencers (
  user_id, name, first_name, bf_licence, ukr_id,
  category, dob_year, school, colour
) VALUES (
  (SELECT id FROM users WHERE email = 'parent@email.com'),
  'Ajith Badhrinath', 'Ajith', '157149', '65339',
  'U13', 2013, 'Brentwood School', '#F97316'
);
```

Repeat for each fencer. Use different colours from this list:
  #F97316 (orange — Ajith)
  #34d399 (green)
  #60a5fa (blue)
  #a78bfa (purple)
  #f472b6 (pink)
  #fb923c (light orange)

### 2.6 Get your Supabase credentials
1. Go to Settings → API in Supabase
2. Note down:
   - Project URL (looks like: https://xxxx.supabase.co)
   - Service role key (long string starting with "eyJ")

---

## PART 3 — UPLOAD CODE TO GITHUB (10 minutes)

### 3.1 Install GitHub Desktop
- Download from desktop.github.com (easier than command line)

### 3.2 Create a new repository
1. Open GitHub Desktop → File → New Repository
2. Name: allez-hub
3. Local path: choose where to save it
4. Click "Create Repository"

### 3.3 Copy the project files
1. Copy all files from this project folder into the repository folder
2. You should have:
   ```
   allez-hub/
   ├── frontend/
   ├── backend/
   └── docs/
   ```

### 3.4 Push to GitHub
1. In GitHub Desktop, you'll see all files listed
2. Add a commit message: "Initial commit"
3. Click "Commit to main"
4. Click "Publish repository" → make it Private
5. Click "Push origin"

---

## PART 4 — DEPLOY BACKEND TO RAILWAY (20 minutes)

### 4.1 Create Railway project
1. Go to railway.app → New Project
2. Click "Deploy from GitHub repo"
3. Select "allez-hub"
4. Railway will detect it's a Node.js project

### 4.2 Set root directory
1. Click on your service in Railway
2. Settings → Source → Root Directory: `backend`
3. Click "Deploy"

### 4.3 Add environment variables
1. Click "Variables" tab
2. Add each of these (click "New Variable" for each):

```
SUPABASE_URL           = https://xxxx.supabase.co     (from Supabase)
SUPABASE_SERVICE_KEY   = eyJ...                        (service role key)
JWT_SECRET             = (generate: open terminal, type: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
JWT_EXPIRES_IN         = 7d
RESEND_API_KEY         = re_xxxx                       (from Resend)
FROM_EMAIL             = noreply@allezfencing.com
NODE_ENV               = production
FRONTEND_URL           = https://dashboard.allezfencing.com
```

### 4.4 Get your backend URL
1. Click "Settings" → "Networking" → "Generate Domain"
2. Note this URL — it will be like: https://allez-hub-production.up.railway.app

### 4.5 Verify it's working
Visit: https://your-railway-url/health
You should see: {"status":"ok","timestamp":"..."}

---

## PART 5 — DEPLOY FRONTEND TO VERCEL (15 minutes)

### 5.1 Create Vercel project
1. Go to vercel.com → New Project
2. Import from GitHub → select "allez-hub"
3. Root directory: `frontend`
4. Framework: Vite

### 5.2 Add environment variables in Vercel
Before deploying, click "Environment Variables":
```
VITE_API_URL = https://your-railway-url/api
```
(replace with your actual Railway URL from step 4.4)

### 5.3 Deploy
1. Click "Deploy"
2. Wait 2-3 minutes
3. Vercel gives you a URL like: https://allez-hub.vercel.app

### 5.4 Test the login
1. Visit your Vercel URL
2. Enter Chris's email: christian@allezfencing.com
3. Check email for OTP code
4. Enter code → should see the coach dashboard

---

## PART 6 — CONNECT TO dashboard.allezfencing.com (10 minutes)

### 6.1 Find where allezfencing.com DNS is managed
The domain is hosted somewhere (likely the same place as the WordPress site).
Common options: GoDaddy, Namecheap, 123-reg, or the WordPress host itself.

Ask whoever manages the website, or check your email for the domain registration.

### 6.2 Add a CNAME record
In your DNS settings, add:

| Type  | Name      | Value                          | TTL  |
|-------|-----------|--------------------------------|------|
| CNAME | dashboard | cname.vercel-dns.com           | 3600 |

### 6.3 Add domain in Vercel
1. Go to Vercel → your project → Settings → Domains
2. Add: dashboard.allezfencing.com
3. Vercel will show you a verification TXT record — add that to DNS too

### 6.4 Wait for DNS to propagate
Usually 5-30 minutes. Test by visiting: https://dashboard.allezfencing.com

---

## PART 7 — SYNC FENCER DATA (5 minutes)

### 7.1 Trigger initial data sync for Ajith
Once logged in as coach:
1. Go to Squad overview
2. Click on Ajith
3. Click "Sync UKRatings data"
4. Wait 1-2 minutes
5. Refresh — bouts and competitions should populate

### 7.2 Add other fencers' UKRatings IDs
For each fencer, find their UKRatings ID:
1. Go to ukratings.co.uk → Search for the fencer
2. The URL will contain their ID: /tourneys/athleteex/34/{ID}/None
3. Update in Supabase:
```sql
UPDATE fencers SET ukr_id = '12345' WHERE bf_licence = '157149';
```

---

## PART 8 — ADDING NEW FENCERS (ongoing)

When a new fencer joins the club:

1. **Add to Supabase** (SQL Editor):
```sql
-- Create login account
INSERT INTO users (email, role, name)
VALUES ('parent@email.com', 'fencer', 'First Last');

-- Create fencer record
INSERT INTO fencers (user_id, name, first_name, bf_licence, ukr_id, category, dob_year, school, colour)
VALUES (
  (SELECT id FROM users WHERE email = 'parent@email.com'),
  'First Last', 'First', 'BF_NUMBER', 'UKR_ID',
  'U13', 2013, 'School Name', '#60a5fa'
);
```

2. **Email the parent** their login email — they just enter it on the login page to receive a code.

3. **Sync their data** — log in as coach, find the fencer, click "Sync UKRatings data".

---

## MAINTENANCE

### Keeping data up to date
UKRatings is updated after each FTL event (usually within 24 hours).
Trigger a sync for any fencer by:
- Logging in as coach → Squad → [Fencer name] → Sync UKRatings data

### Adding a cue phrase for a fencer
```sql
UPDATE fencers SET cue_phrase = 'My footwork' WHERE name = 'Ajith Badhrinath';
```

### Resetting an OTP (if someone is locked out)
```sql
DELETE FROM otp_codes WHERE email = 'parent@email.com';
```

### Costs
All services are on free tiers. Estimated costs at club scale (20-30 fencers):
- Vercel: Free
- Railway: ~£0-2/month (within free credit)
- Supabase: Free (up to 500MB, 50,000 rows — won't be reached)
- Resend: Free (up to 3,000 emails/month)
**Total: £0-2/month**

---

## TROUBLESHOOTING

### Login code not arriving
1. Check spam/junk folder
2. Verify Resend DNS records are correct
3. Check Railway logs: railway.app → your project → Deployments → Logs

### Data not syncing
1. Check fencer has a ukr_id set in the database
2. Check UKRatings is accessible: ukratings.co.uk
3. Check Railway logs for scrape errors

### White screen / app not loading
1. Open browser DevTools (F12) → Console tab
2. Look for red error messages
3. Check VITE_API_URL is set correctly in Vercel

### Need help?
The entire codebase is straightforward React + Node.js.
Any developer familiar with JavaScript can maintain and extend it.
For changes, describe what you want to a new Claude conversation —
it can edit specific component files without touching the rest.

---
Generated for Allez Fencing Club, Brentwood School
Contact: christian@allezfencing.com
