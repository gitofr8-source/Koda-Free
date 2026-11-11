# 🚀 Deploying Koda AI to Vercel

You can now host Koda on **Vercel** with full backend and frontend capabilities. Once deployed, Koda is accessible from **any web browser, phone, tablet, or desktop** anywhere in the world!

---

## ⚡ Method 1: 1-Click Deployment (Recommended)

1. Open the folder `D:\KODA files`.
2. Double-click **`deploy-vercel.bat`**.
3. Choose **`1`** (Deploy to Production).
4. If it's your first time, Vercel will open a browser window to log in (free GitHub/Google/Email login).
5. Follow the prompts (press `Enter` to accept defaults for project name and directory).
6. In about **30 seconds**, Vercel will output your live URL:
   ```
   https://koda-yourname.vercel.app
   ```

---

## 🌐 Method 2: Command Line (PowerShell or Terminal)

From `D:\KODA files`, run:

```bash
# 1. Login to Vercel (free account)
npx vercel login

# 2. Deploy directly to production
npx vercel --prod
```

When prompted:
- **Set up and deploy?** `Y`
- **Which scope?** (Select your personal account)
- **Link to existing project?** `N`
- **Project name?** `koda` (or any name you like)
- **Directory located?** `./` (Press Enter)
- **Want to modify settings?** `N` (Press Enter)

---

## 🐙 Method 3: Via GitHub (Continuous Deployment)

1. Push your `D:\KODA files` to a GitHub repository:
   ```bash
   git init
   git add .
   git commit -m "Koda Vercel deployment"
   git remote add origin https://github.com/your-username/koda.git
   git push -u origin main
   ```
   *(Note: Huge files like video and installer archives are automatically excluded by `.gitignore` and `.vercelignore`)*.

2. Go to [https://vercel.com/new](https://vercel.com/new).
3. Click **Import** next to your `koda` repository.
4. Leave all build settings as default (Framework Preset: **Other**).
5. Click **Deploy**.
6. Every time you push changes to GitHub, Vercel will automatically redeploy!

---

## 🛠️ Architecture Details for Vercel

- **Edge CDN Frontend**: `index.html`, `chat.html`, `login.html`, `profile.html`, and CSS/JS are served directly from Vercel's global Edge CDN with sub-50ms latency worldwide.
- **Serverless API Engine**: All `/api/*` endpoints (Authentication, Accounts, Profiles, AI proxy, telemetry) run automatically via `api/index.js` and `api/[...path].js`.
- **Pre-configured Routes in `vercel.json`**:
  - `/` → Home Page
  - `/chat` or `/workspace` → 6-Model AI Workspace
  - `/login` → Authentication & Sign-in
  - `/profile` or `/accounts` → Profiles & Multi-Account Switcher
  - `/api/*` → Serverless Function backend
- **Multi-Theme Support**: Pure AMOLED and Light Mode work seamlessly across all pages without layout shift.
