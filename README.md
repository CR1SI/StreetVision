# StreetVision: The Gridlock Solution

**Sperry Tech — Shell Hacks 2026 Challenge**

StreetVision is an automated intelligence dashboard and infrastructure coordination tool for electric utilities. Built to solve the **Gridlock Challenge**, this platform ingests public future-construction data from multiple utilities, maps it, and mathematically identifies where planned transmission projects overlap.

### The Ideology & The "Why"
Historically, power grid companies have operated in silos. If two utilities need to build high-voltage power lines to the same region, they usually buy separate land, hire separate crews, and build separate infrastructure. This is expensive and inefficient.

In 2024, the federal government issued **FERC Order No. 1920**, mandating long-term regional coordination. StreetVision is the technological bridge that makes this forced coordination a reality. By identifying **Geographic** and **Timeline Overlaps**, utilities can share **Right-of-Ways** (the strip of land bought for a power line)—saving millions of dollars and accelerating infrastructure deployment.

---

## The Visual Language
When exploring the StreetVision dashboard, you'll encounter the following elements:
* **The Utilities:** Different companies are color-coded (e.g., Purple for Dominion Energy SC, Teal for Georgia Power).
* **The Lines:** Transmission Lines—the massive, high-voltage highways moving power across states.
* **The Icons (Points):** Substations—the "interchanges" where electricity is stepped up/down in voltage.
* **The Overlaps:** Glowing zones and a ranked leaderboard highlight the "lowest-hanging fruit" for coordination, scored by geographic proximity (<25 miles) and timeline alignment.

---

## Quick Start (Demo Mode)

StreetVision includes a zero-dependency mock API server and a React frontend. You do **not** need Docker or PostgreSQL to run the demo.

### On Windows
You can start both servers with a single click or command:

1. **Option A (Double Click):** Double-click `run-demo.bat` in the root folder.
2. **Option B (Terminal / PowerShell):**
   ```powershell
   # If PowerShell blocks script execution, first run:
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

   # Start the backend (in one terminal)
   python backend\api_server.py

   # Start the frontend (in another terminal, from the root folder)
   npm install
   npm run dev
   ```

### On macOS / Linux
Open two terminals in the repository root:

```bash
# Terminal 1: Start mock API (port 8001)
python3 backend/api_server.py

# Terminal 2: Start frontend dev server
npm install
npm run dev
```

Open your browser to the local URL displayed by Vite (typically `http://localhost:5173/` or `http://localhost:5175/`).

---

## Troubleshooting Windows Setup

### 1. `vite.ps1 cannot be loaded because running scripts is disabled`
This is Windows PowerShell's default security policy.
* **Fix**: Run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` or use **Command Prompt (`cmd.exe`)** / **Git Bash**.

### 2. `'npm' or 'python' is not recognized`
* Ensure [Node.js (LTS)](https://nodejs.org/) and [Python 3.10+](https://www.python.org/) are installed.
* Check **"Add Python to PATH"** during installation.

### 3. Running commands from subfolders
You can run `npm install` and `npm run dev` directly from the repository root, or navigate directly to `frontend/front`.

---

## Architecture Overview

* **Frontend**: React 18, Vite, Tailwind CSS, MapLibre GL (`frontend/front/`)
* **Dev/Mock Backend**: Zero-dependency Python HTTP server (`backend/api_server.py`)
* **Production Backend**: FastAPI with PostGIS (`backend/api/main.py`)
* **Precomputed Datasets**: Cleaned GeoJSON and CSV coordination pairs (`backend/data/processed/`)
