# ⚡ Koda Free — Unified Multi-Model AI Workspace

> **Query, compare, and synthesize responses across leading AI engines side by side.**

Koda is a high-performance, multi-model AI operating interface and workspace. Run queries across Koda, ChatGPT, Claude, Gemini, Perplexity, and DeepSeek simultaneously with instant synthesis, secure account profiles, and an ultra-minimal Pure AMOLED design.

---

## 🌟 Highlights

- **Parallel Engine Architecture**: Stream and evaluate responses from 6 major models concurrently in 2-column, 3-column, 6-column, or consensus grid layouts.
- **Strict Theme Engine**: 
  - **Pure AMOLED**: 100% pitch-black (`#000000`) surfaces for OLED battery efficiency and maximum contrast.
  - **Light Mode**: High-clarity off-white surfaces with crisp typography.
- **Non-Scrollable Viewport Workspace**: Fixed 100vh full-screen grid with docked bottom composer and quick-prompt chips.
- **Account & Profiles Hub**: Dedicated `/profile` page for managing identities, switching accounts with 1 click, and updating passwords.
- **Vercel Cloud Ready**: Built-in Vercel configuration (`vercel.json`) and Serverless Functions (`/api/*`) for instant zero-config worldwide web hosting.
- **Cross-Platform PWA & Android**: Includes Capacitor configuration for native Android APK generation and 1-click PWA browser installation.

---

## 🚀 Quick Start (Local)

1. **Clone the repository**:
   ```bash
   git clone https://github.com/gitofr8-source/Koda-Free.git
   cd Koda-Free
   ```

2. **Start the server**:
   ```bash
   npm start
   ```
   *(Or double-click `start-server.bat` on Windows)*.

3. Open **`http://localhost:3000`** in your browser.

---

## ☁️ Deploy to Vercel (Free Web Hosting)

### Method 1: 1-Click Script (Windows)
Double-click **`deploy-vercel.bat`** and choose `1` (Deploy to Production).

### Method 2: Vercel CLI
```bash
npx vercel --prod
```

### Method 3: GitHub Integration
1. Go to [vercel.com/new](https://vercel.com/new).
2. Import this `Koda-Free` repository.
3. Click **Deploy**. Vercel will build and host your website and workspace with global SSL automatically.

---

## 📁 Repository Structure

```
├── index.html           # Public landing website with hero showcase and 1-click app install
├── chat.html            # Full-viewport multi-model AI workspace
├── login.html           # Authentication, guest access, and multi-account sign-in
├── profile.html         # Profile management and account switcher
├── server.js            # Node.js local server and backend API engine
├── api/
│   ├── index.js         # Vercel Serverless Function entry point
│   └── [...path].js     # Catch-all serverless API handler
├── theme-styles.css     # Pure AMOLED and Light Mode variables & styling
├── theme-manager.js     # Client-side theme engine with cross-tab persistence
├── vercel.json          # Vercel Edge routing, clean URLs & security headers
├── deploy-vercel.bat    # 1-click Vercel production deployment script
├── capacitor.config.json# Capacitor native app configuration
└── android/             # Android native wrapper project
```

---

## 📄 License

MIT License. Designed and built with Koda AI.
