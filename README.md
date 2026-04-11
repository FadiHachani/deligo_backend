# Déligo Backend API

A REST + WebSocket backend for **Déligo** — a bulky-item transport platform built for Tunisia.
Drivers bid on client transport requests, deliveries are tracked in real-time using Uber's H3 hexagonal grid.

Built with **NestJS · TypeScript · PostgreSQL · Redis · Socket.IO · h3-js**.

---

## What it does

| Feature | Description |
|---|---|
| OTP Auth | Phone-based login with profile completion (full name, email) |
| JWT RS256 | Short-lived access tokens + long-lived refresh tokens |
| Driver applications | Clients apply to become drivers; admins approve/reject |
| Transport requests | Clients post pickup/dropoff jobs with item details |
| Bidding | Approved drivers bid on open requests (price + ETA) |
| Bookings | Client accepts a bid → booking created transactionally |
| Real-time tracking | Driver streams GPS over WebSocket; client sees live location |
| H3 zones | Spatial queries using hexagonal grid (no PostGIS needed) |
| Ratings | Both parties rate after delivery; driver avg updated live |
| Notifications | In-app notifications for every key event |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS (TypeScript strict mode) |
| Database | PostgreSQL 16 via TypeORM |
| Cache / Presence | Redis 7 via ioredis |
| Real-time | Socket.IO (namespace `/tracking`) |
| Spatial | h3-js (Uber H3 hexagonal grid, res 9 & 7) |
| Auth | JWT RS256 — OTP phone verification |
| Image processing | sharp (resize + WebP compression for avatars) |
| Validation | class-validator + class-transformer |

---

## Project Structure

```
src/
├── common/
│   ├── enums.ts              # All shared enums (UserRole, RequestStatus, etc.)
│   ├── state-machine.ts      # assertTransition() — enforces status flow rules
│   ├── decorators/           # @Roles()
│   ├── filters/              # Global HTTP exception → error envelope
│   ├── guards/               # RolesGuard, ApprovedDriverGuard
│   ├── h3/                   # H3Service — zone queries, k-ring, heatmap
│   ├── interceptors/         # ResponseEnvelopeInterceptor
│   ├── types/                # JwtUser class
│   └── upload/               # UploadService — avatar compression (sharp → WebP)
├── config/
│   └── env.validation.ts     # Validates all required env vars on startup
├── entities/                 # TypeORM entities (one file per table)
├── modules/
│   ├── auth/                 # OTP request/verify, refresh, logout
│   ├── users/                # GET/PATCH /me, apply-as-driver
│   ├── admin/                # List/approve/reject driver applications
│   ├── drivers/              # PATCH /me/status (go online/offline)
│   ├── zones/                # Nearby drivers, heatmap, coverage
│   ├── requests/             # Transport request CRUD
│   ├── bids/                 # Bid lifecycle (create, accept, withdraw)
│   ├── bookings/             # Booking lifecycle (start, deliver, fail)
│   ├── tracking/             # WebSocket gateway (TrackingGateway)
│   ├── ratings/              # Rate after delivery
│   └── notifications/        # In-app notifications
└── redis/                    # Global Redis provider
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- PostgreSQL 16
- Redis 7

### 1. Install dependencies

```bash
npm install
```

### 2. Generate RS256 keypair (one-time)

```bash
mkdir -p keys
openssl genpkey -algorithm RSA -out keys/private.pem -pkeyopt rsa_keygen_bits:2048
openssl rsa -pubout -in keys/private.pem -out keys/public.pem
```

### 3. Configure environment

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=deligo
DATABASE_PASSWORD=your_password
DATABASE_NAME=deligo

REDIS_HOST=localhost
REDIS_PORT=6379

JWT_PRIVATE_KEY_PATH=keys/private.pem
JWT_PUBLIC_KEY_PATH=keys/public.pem
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL_DAYS=30

OTP_TTL_SECONDS=300
OTP_COOLDOWN_SECONDS=60
OTP_MAX_ATTEMPTS=3
```

### 4. Create the database

```bash
psql -U postgres -c "CREATE USER deligo WITH PASSWORD 'your_password';"
psql -U postgres -c "CREATE DATABASE deligo OWNER deligo;"
```

### 5. Run the app

```bash
# Development (hot reload)
npm run start:dev

# Production build
npm run build
npm run start:prod
```

The app starts on **http://localhost:3000**.
TypeORM will auto-create all tables on first run (`synchronize: true` — disable in production).

---

## API Overview

All responses follow this envelope:

```json
{ "success": true, "data": { ... }, "meta": { ... } }
{ "success": false, "error": { "code": "...", "message": "..." } }
```

### Auth — `/api/auth`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/otp/request` | Public | Request OTP for a phone number |
| POST | `/otp/verify` | Public | Verify OTP → returns tokens. Accepts optional `full_name` and `email` for profile completion |
| POST | `/refresh` | Public | Exchange refresh token for new access token |
| POST | `/logout` | Public | Revoke refresh token |

### Users — `/api/users`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/me` | Any | Get own profile (+ driver info if applicable) |
| PATCH | `/me` | Any | Update `full_name` / `email` / `avatar_url` |
| POST | `/me/avatar` | Any | Upload profile picture (multipart, max 5MB, JPEG/PNG/WebP → compressed to 300x300 WebP) |
| POST | `/me/apply-as-driver` | CLIENT | Submit driver application |
| GET | `/me/application-status` | DRIVER | Check application status |

### Admin — `/api/admin`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/driver-applications` | ADMIN | List applications (`?status=PENDING&page=1&limit=20`) |
| PATCH | `/driver-applications/:id/approve` | ADMIN | Approve a driver |
| PATCH | `/driver-applications/:id/reject` | ADMIN | Reject with reason |

### Drivers — `/api/drivers`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| PATCH | `/me/status` | DRIVER (approved) | Go online/offline with GPS coordinates |

### Zones — `/api/zones`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/drivers` | Any | Nearby online drivers (`?lat=&lng=&radius=2`) |
| GET | `/heatmap` | Any | Driver density heatmap (`?lat=&lng=&radius=3`) |
| GET | `/coverage` | Any | All active coverage cells |

### Requests — `/api/requests`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/` | CLIENT | Create transport request |
| GET | `/` | Any | List requests (filtered by role + `?status=&page=&limit=`) |
| GET | `/:id` | Owner/driver/admin | Get request details with bids |
| PATCH | `/:id/cancel` | CLIENT | Cancel open/bidding request |

### Bids — `/api/bids`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/` | DRIVER (approved) | Place a bid |
| GET | `/` | Any | List bids (`?request_id=`) |
| POST | `/:id/accept` | CLIENT | Accept bid → creates booking atomically |
| POST | `/:id/withdraw` | DRIVER | Withdraw pending bid |

### Bookings — `/api/bookings`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/` | Any | List own bookings (`?status=&page=&limit=`) |
| GET | `/:id` | Owner/driver/admin | Full booking details |
| PATCH | `/:id/start` | DRIVER (approved) | Mark delivery started |
| PATCH | `/:id/deliver` | DRIVER (approved) | Mark delivered |
| PATCH | `/:id/fail` | DRIVER (approved) | Mark failed |

### Ratings — `/api/ratings`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/` | Any | Rate the other party after delivery (score 1–5) |
| GET | `/` | Any | Get ratings for a booking (`?booking_id=`) |

### Notifications — `/api/notifications`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/` | Any | Own notifications (`?page=&limit=`) |
| PATCH | `/:id/read` | Any | Mark notification as read |

---

## WebSocket — Real-time Tracking

Connect to `ws://localhost:3000/tracking` with your JWT:

```js
const socket = io('http://localhost:3000/tracking', {
  auth: { token: '<accessToken>' }
});
```

### Events (client → server)

| Event | Payload | Description |
|---|---|---|
| `join_booking` | `{ bookingId }` | Join the booking room to receive updates |
| `leave_booking` | `{ bookingId }` | Leave the room |
| `location_update` | `{ bookingId, lat, lng, heading? }` | Driver streams GPS (only during IN_TRANSIT) |

### Events (server → client)

| Event | Payload | Description |
|---|---|---|
| `location_broadcast` | `{ lat, lng, heading, h3_index, timestamp }` | Live driver position |
| `booking_status_changed` | `{ bookingId, status, timestamp }` | Booking state transitions |

---

## Profile Picture Upload

Avatars are uploaded via `POST /api/users/me/avatar` as `multipart/form-data` (field name: `avatar`).

- **Max size**: 5MB input
- **Accepted formats**: JPEG, PNG, WebP
- **Processing**: resized to 300x300 (cover crop) and converted to WebP at 80% quality via sharp
- **Storage**: saved to `uploads/avatars/` (served statically at `/uploads/avatars/<uuid>.webp`)
- **Space savings**: a typical 3MB phone photo compresses to ~15-30KB as 300x300 WebP
- **Cleanup**: uploading a new avatar automatically deletes the previous one

```bash
# Example upload with curl
curl -X POST http://localhost:3000/api/users/me/avatar \
  -H "Authorization: Bearer <token>" \
  -F "avatar=@photo.jpg"
# → { "avatar_url": "/uploads/avatars/uuid.webp" }
```

---

## Request & Booking State Machines

```
Request:  OPEN → BIDDING → BOOKED → IN_TRANSIT → DELIVERED
                                  ↘              ↘ FAILED
          OPEN / BIDDING / BOOKED → CANCELLED

Booking:  CONFIRMED → IN_TRANSIT → DELIVERED
                                 ↘ FAILED
```

---

## H3 Spatial Logic

- **Resolution 9** (~174m cells) — driver tracking, request pickup/dropoff indexing
- **Resolution 7** (~5km cells) — heatmap and coverage zones
- No PostGIS — all spatial queries use `h3_index` B-tree indexes on plain varchar columns

---

## Security Notes

- `synchronize: true` is enabled for development — **must be disabled in production**
- JWT private key (`keys/private.pem`) must never be committed — it's in `.gitignore`
- OTP codes are logged to console only — wire a real SMS provider for production
- Refresh tokens are SHA-256 hashed before storage
- Uploaded files (`uploads/`) are gitignored — back them up separately in production

---

## Production Server (OVH via Tailscale)

### Server Details

| | |
|---|---|
| Tailscale IP | `100.93.224.81` |
| Public IP | `51.77.18.159` |
| Tailscale hostname | `deligobackend.taild2bb8.ts.net` |
| SSH user | `ubuntu` |
| Server user | `aymen.frikha88@` (Aymen Frikha) |
| App location | `~/deligo_backend` |

### SSH Access

```bash
ssh ubuntu@100.93.224.81
```

Your public key (`~/.ssh/id_ed25519.pub`) must be in `/home/ubuntu/.ssh/authorized_keys` on the server.

### Server Setup (already done)

- Node.js 20, PostgreSQL 16, Redis 7, nginx, pm2 installed
- PostgreSQL user: `deligo` / password: `deligo123` / db: `deligo`
- nginx proxies port 80 → localhost:3000
- pm2 manages the Node process (survives disconnects)

### Deploying Updates

```bash
ssh ubuntu@100.93.224.81
cd ~/deligo_backend
git pull
npm install        # pick up new dependencies
npm run build
pm2 restart deligo-api
```

TypeORM `synchronize: true` automatically applies schema changes (new columns, tables) on restart — no manual migration needed.

> **Production warning:** `synchronize` can silently drop data when columns are renamed or removed. Before going live, switch to TypeORM migrations:
> 1. Set `synchronize: false` in `app.module.ts`
> 2. Generate migrations: `npx typeorm migration:generate -d src/data-source.ts`
> 3. Run migrations: `npx typeorm migration:run -d src/data-source.ts`

### Start / Stop the server

```bash
# SSH in first
ssh ubuntu@100.93.224.81

# Start
pm2 start npm --name deligo-api -- run start:prod

# Stop
pm2 stop deligo-api

# Check status
pm2 status

# View logs
pm2 logs deligo-api
```

### Frontend API Base URL

```
http://51.77.18.159
```

Example:
```
http://51.77.18.159/api/auth/otp/request
```
