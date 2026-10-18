# InstaClone 📸

An Instagram-style social network with real accounts, a real database and photo uploads.

**Features:** sign up / log in (bcrypt-hashed passwords), feed, stories, photo upload, likes (double-tap ❤️),
comments, saves, follow / unfollow, profiles, edit profile, explore, search, notifications, direct messages,
and a mobile layout.

## Tech
| Part | What it uses |
|------|-------------|
| Website hosting | Render (free web service) |
| Database | Supabase PostgreSQL (free) |
| Photo storage | Supabase Storage (free, a public bucket is created automatically) |
| Server | Node.js + Express (`server.js`) |
| Frontend | Plain HTML / CSS / JavaScript (`public/`) |

## Environment variables
| Name | Where to find it |
|------|------------------|
| `DATABASE_URL` | Supabase → **Connect** → **Session pooler** connection string, with your password filled in |
| `SUPABASE_URL` | Supabase → Project Settings → Data API → Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API Keys → **Secret key** (`sb_secret_…`) or the legacy `service_role` key |

On first start the server creates all the tables and the storage bucket, then adds demo accounts
(password `password123`, e.g. `zanzibar_vibes`).

## Run on your own computer
```bash
npm install
cp .env.example .env   # then fill in your values
npm start              # http://localhost:3000
```
If you leave out the `SUPABASE_*` variables, photos are saved to a local `uploads/` folder instead.

## Keep the free server awake
Render's free servers go to sleep after 15 minutes without visitors. Supabase pauses free projects after 7 quiet days.
A GitHub Action that visits `/api/health` every 10 minutes prevents both. See **DEPLOY-GUIDE.html**, step 4.
