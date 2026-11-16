# The Wolf Protocol

A fitness tracking web app featuring **Daily Quest** workouts, a **Schedule** roadmap with past-day editing, an interactive anatomical **Stats** measurement & growth tracker, and a searchable exercise **Video Library**, backed by local storage and Firebase Cloud Sync.

---

## Local Development

```bash
npm install
npm run dev
```

To create a production build locally (output to `./dist`):

```bash
npm run build
```

---

## Deploying Live on GitHub Pages (Recommended: Automatic)

This repository already includes a pre-configured GitHub Actions workflow at `.github/workflows/deploy.yml` and relative asset paths (`base: './'` in `vite.config.ts`), so GitHub Pages works automatically on every push to `main`.

### Step 1: Push the Code to GitHub
Push your project files to a GitHub repository on the `main` branch (either a new repository or an existing one—see the section below if syncing to an existing repo).

### Step 2: Enable GitHub Pages
1. Open your repository on **GitHub.com**.
2. Go to **Settings** → **Pages** (in the left sidebar under *Code and automation*).
3. Under **Build and deployment → Source**, select **GitHub Actions**.

### Step 3: Trigger & View Your Live Site
1. Any push to `main` automatically runs **Deploy to GitHub Pages**.
   - You can also trigger it manually under the **Actions** tab → **Deploy to GitHub Pages** → **Run workflow**.
2. Wait ~1–2 minutes for the workflow checkmark to turn green.
3. Your live URL will appear at:
   `https://<your-github-username>.github.io/<your-repo-name>/`
   *(and is also shown directly in **Settings → Pages** and inside the Actions job summary).*

---

## Pushing Updates to an Existing GitHub Repository

If you downloaded an updated ZIP of this project and want to push it to an **existing** repository:

### Option A: Using GitHub Desktop (No Terminal Required)
1. Extract the downloaded ZIP.
2. Open **GitHub Desktop** and clone your existing repository (or open its folder if already cloned).
3. Copy the extracted project files into your local repository folder, replacing the existing files (**keep the hidden `.git` folder intact**).
4. In GitHub Desktop, write a commit message (e.g. `Update app`), click **Commit to main**, then click **Push origin**.

### Option B: Using Git in Terminal
If your existing repo is already cloned locally:
```bash
# Copy/replace the extracted files into your repo folder (keeping .git), then:
git add .
git commit -m "Update app"
git push origin main
```

If you extracted the ZIP into a brand-new folder and want to connect it to your existing repo:
```bash
cd path/to/extracted-folder
git init
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git fetch origin
git reset --soft origin/main
git add .
git commit -m "Sync latest updates"
git push origin main
```

*(If your repository's default branch is `master` instead of `main`, update `branches: [main]` in `.github/workflows/deploy.yml` to `master` and push to `master`.)*

---

## Alternative: Manual Deploy via `gh-pages`

If you prefer deploying the built `./dist` folder directly from your computer instead of GitHub Actions:

```bash
npm install
npm run deploy
```

Then in **Settings → Pages**, set **Source** to **Deploy from a branch** and select the **`gh-pages`** branch (`/(root)`).

---

## Enable Firebase Google Sign-In on Your Live URL

If you use Google Sign-In & cloud sync on your live GitHub Pages site:
1. Open the [Firebase Console](https://console.firebase.google.com/) and select your project.
2. Go to **Authentication** → **Settings** → **Authorized domains**.
3. Click **Add domain** and add:
   `<your-github-username>.github.io`
   *(without `https://` or the repo path).*
