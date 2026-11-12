# CA ControlRoom: putting it online (free)

You need about 15 minutes, once. Nothing here costs money.

## Try it first (no setup)

Open `index.html` from this folder in Chrome or Edge, or use the online link once it is set up.
Without the steps below it runs in **"This device only"** mode: every tool works, but data stays in that one browser and there are no logins.

## Step 1: Create the free database (Supabase)

1. Go to **supabase.com** and click **Start your project**. Sign up with Google or your email.
2. Click **New project**.
   - Name: `ca-controlroom`
   - Database password: click **Generate a password** and save it somewhere safe. You will not need it day to day.
   - Region: **South Asia (Mumbai)**
   - Click **Create new project** and wait about 2 minutes.
3. In the left menu, open **SQL Editor**, click **New query**, paste the whole contents of `supabase/schema.sql`, and click **Run**. It should say "Success".
4. In the left menu, open **Authentication**, then **Sign In / Providers** (or **Providers**), open **Email**, and switch **off** "Confirm email". Click **Save**.
   This lets your staff log in straight away. The free plan can only send a few emails per hour, so confirmation emails would get stuck.
5. Open **Project Settings** (gear icon), then **API** (or **Data API** and **API Keys**). Copy two things:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - **anon public** key (a long text starting with `eyJ` or `sb_publishable_`)

   Send these two to Claude, or paste them into `config.js` yourself.
   **Never share the database password or the `service_role` / secret key.**

## Step 2: Put the app online

The app is a plain website, so free hosting works:

- **GitHub Pages:** the code lives in your GitHub repository `ca-controlroom`. In the repository, open **Settings**, then **Pages**, set **Source** to "Deploy from a branch", choose `main` and `/ (root)`, and save. After a minute your link is `https://<your-github-name>.github.io/ca-controlroom/`.
- **Vercel (if you prefer, and for a private repository):** sign in at vercel.com with GitHub, click **Add New Project**, pick `ca-controlroom`, and click **Deploy**.

Then in Supabase, **Authentication**, **URL Configuration**, set **Site URL** to your new link. This makes "Forgot password" emails point to the right place.

## Step 3: First login

1. Open your link and click **Create a login**. Use your own email.
2. As the first person, you set up the firm and become **partner**.
3. To bring your old data over: in the old single-file tool, open **Backup** and click **Save backup**. In the new app, open **Backup** and choose that file under **Restore from backup**.
4. Open the **Team** tab and add each staff member (name, email, mobile, role). Send them the link. They click **Create a login** with the same email.

## Roles

| Role | Can do |
|---|---|
| Partner | Everything, manages the team, can undo mistakes from the 90-day history |
| Staff | Every tool, sees fees |
| Article | Every tool except fees and billing, rates and settings, and backup |

## What each tab adds

- **Due-date calendar:** every client's filings by date, assign to staff, one-click WhatsApp or email reminders, add to Google Calendar.
- **GST:** probable matches, 2A and IMS, remembered matches, supplier follow-up messages.
- **Bank to Tally:** PDF statements, learned ledgers, Tally ledger check, Contra entries, .xml file.
- **Billing:** GST fee invoices with your own number series, payments with TDS, outstanding by age, payment reminders, client statements. Fill in **Firm details** (GSTIN, bank, UPI ID) once at the bottom of the Billing tab.
- **Time and work:** timer or manual time per client; partners see workload, overdue work and time against fees.
- **Document inbox:** create an upload link per client and send it on WhatsApp. Clients upload without a login; files land here. Uses the free 1 GB Supabase storage that `schema.sql` sets up.

## Good to know

- **Supabase pauses a free project after 7 days with nobody using it.** Daily office use keeps it awake. If it ever pauses, log in at supabase.com and click **Restore project**.
- **Install it like an app:** in Chrome on a phone, open the link, tap the menu, then **Add to Home screen**.
- **Offline:** if the internet drops, saves wait on that device and go online by themselves when it is back. The top bar shows "Offline, N changes waiting" until then.
- **Invoices, payments and time entries** are saved one by one, so any number of people can add them at the same moment.
- **Two people editing the same list (for example the Client master) at the same moment:** the later save wins. Others get a "Refresh to see it" message when a colleague saves. Every save is kept for 90 days, and a partner can bring back any earlier version from the Team tab.
- **Spreadsheets and statements you open in the tools are read in the browser and are never uploaded.** Only what you save (clients, tracker, assignments, invoices, time, rates, rules) and files clients send through the upload link go online.
