# StreetVision

Transmission infrastructure coordination and overlap finder for electric utilities.

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

### 1. `vite.ps1 cannot be loaded because running scripts is disabled on this system`
This is Windows PowerShell's default security policy blocking local scripts.
* **Fix**: In your PowerShell window, run:
  ```powershell
  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
  ```
  Or run your commands using **Command Prompt (`cmd.exe`)** or **Git Bash** instead of PowerShell.

### 2. `'npm' or 'python' is not recognized as an internal or external command`
* Ensure [Node.js (LTS)](https://nodejs.org/) and [Python 3.10+](https://www.python.org/) are installed.
* During Python installation, make sure to check the box: **"Add Python to PATH"**.

### 3. Running commands from subfolders
You can run `npm install` and `npm run dev` directly from the repository root, or navigate directly to `frontend/front`:
```bash
cd frontend/front
npm install
npm run dev
```

---

## Architecture Overview

* **Frontend**: React 18, Vite, Tailwind CSS, MapLibre GL (`frontend/front/`)
* **Dev/Mock Backend**: Zero-dependency Python HTTP server (`backend/api_server.py`)
* **Production Backend**: FastAPI with PostGIS (`backend/api/main.py`)
* **Precomputed Datasets**: Cleaned GeoJSON and CSV coordination pairs (`backend/data/processed/`)
