# Hosting BESH. J IMS online (free)

The whole system runs at one web address:

- **Neon** hosts the PostgreSQL database (free tier, no expiry).
- **Render** runs the NestJS API, which also serves the React screens (free tier).

On first start the API sees an empty database and builds it automatically: schema, sample data and all the numbered scripts in `database/`. It never touches a database that already has data.

Time needed: about 15 minutes. Do it from a laptop browser.

---

## Before you start

The hosted site is built from the **`main`** branch. Merge the open pull requests first, in order (Phase 1, Phase 2, hosting), so `main` has everything.

## Step 1: create the database on Neon

1. Go to **https://neon.tech** and sign up. "Continue with GitHub" is easiest.
2. Create a project:
   - **Project name:** `besh-ims`
   - **Postgres version:** 16
   - **Region:** pick the one closest to Ghana, e.g. **AWS Europe (Frankfurt)**.
3. On the project dashboard, click **Connect**.
4. Turn **Connection pooling OFF**, so you get the direct connection string.
5. Copy the connection string. It looks like:
   `postgresql://neondb_owner:xxxxxxxx@ep-something-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require`

Keep it private: it's the database password.

## Step 2: create the web service on Render

1. Go to **https://render.com** and sign up with **GitHub**.
2. Click **New → Blueprint**.
3. Connect GitHub when asked, and give Render access to **BeshJ-IMS**.
4. Choose the **BeshJ-IMS** repository. Render reads `render.yaml` and shows one service, **besh-ims**.
5. It asks for **DATABASE_URL**: paste the Neon connection string from Step 1.
6. Click **Apply**.

The first build takes about 5 minutes. When the log shows `Database ready` and `BESH IMS API running`, open the address Render gives you, e.g. **https://besh-ims.onrender.com**.

Log in as `kmensah`, password `Password123!`.

## Step 3: check it

- **https://besh-ims.onrender.com/api/health** should show `"database":"connected"` and `"tables":20`.
- Every push to `main` redeploys automatically.

---

## Things to know

**The free service sleeps.** After 15 minutes with no visitors, Render pauses it. The next visit takes about a minute to wake it up. **Before a presentation, open the site 2–3 minutes early.**

**Change the demo passwords** if you share the link widely. Every demo user has `Password123!`. The Admin (`kappiah`) can reset passwords on the Users screen.

**Reset the demo data** (e.g. before the presentation). From your laptop, in the `backend` folder:

```bash
npm install
npm run build
DATABASE_URL="<your Neon connection string>" npm run db:reset
```

On Windows PowerShell:

```powershell
$env:DATABASE_URL="<your Neon connection string>"; npm run db:reset
```

This drops everything and reloads the sample data. Anything typed into the hosted site is lost.

**Adding a new database script** (e.g. `05_phase3_sales.sql`). The hosted database won't run it on its own, because it already has data. After deploying, run `db:reset` as above. That rebuilds everything, including the new script, so it also wipes any data entered so far.

## If something goes wrong

| Symptom | Fix |
|---|---|
| Render build fails | Open the build log in Render and send the last 30 lines to the team chat |
| `/api/health` shows an error mentioning SSL or connection | Check `DATABASE_URL` in Render → besh-ims → Environment: it must end in `?sslmode=require` and be the **direct** (not pooled) string |
| Login page loads but login says "Something went wrong" | The database may be empty or half-built: run `npm run db:reset` as above |
| Site takes a minute to load | It was asleep (free tier); this is normal |
