# SFLS — Smart Faculty Locator System

A campus web application that helps students find faculty members, check real-time availability, get turn-by-turn navigation to offices, and receive notifications when subscribed faculty become available. Faculty can update their status and check in via GPS/Wi‑Fi geofencing; administrators manage buildings, floors, rooms, and seat assignments.

## Features

| Role | Capabilities |
|------|----------------|
| **Student** | Search and filter faculty by name, department, and status; view profiles; subscribe to availability alerts; outdoor map routing (Leaflet) and indoor step-by-step directions |
| **Faculty** | Set status (`available`, `busy`, `not_available`, `in_class`); optional status message; campus check-in via GPS/Wi‑Fi |
| **Admin** | CRUD for buildings, floors, rooms; allocate seats to faculty; manage campus infrastructure |

**Platform capabilities**

- JWT authentication with role-based access control
- REST API with rate limiting (Flask-Limiter)
- Real-time status updates via Socket.IO
- MySQL persistence (SQLAlchemy ORM)
- Optional push notification hooks (FCM placeholder in backend)

## Tech Stack

| Layer | Technologies |
|-------|----------------|
| **Frontend** | HTML, CSS, vanilla JavaScript, [Leaflet](https://leafletjs.com/), Leaflet Routing Machine |
| **Backend** | Python 3, [Flask](https://flask.palletsprojects.com/), Flask-SQLAlchemy, Flask-JWT-Extended, Flask-SocketIO, Flask-Bcrypt, Flask-CORS, Flask-Limiter |
| **Database** | MySQL (via PyMySQL) |

## Project Structure

```
SFLS - Smart Faculty Locator System/
├── sfls_backend.py      # Flask API, WebSocket, and static file server
├── sfls_app.html        # Main UI (student, faculty, admin views)
├── script.js            # Frontend logic and API client
├── style.css            # Application styles
├── requirements.txt     # Python dependencies
├── database/
│   └── sfls_schema.sql  # MySQL schema and seed data
├── .env                 # Local environment variables (not committed)
└── README.md
```

## Prerequisites

- **Python 3.10+**
- **MySQL 8.x** (or MariaDB with compatible syntax)
- A modern web browser

## Installation

### 1. Clone and enter the project

```bash
cd "SFLS - Smart Faculty Locator System"
```

### 2. Create a virtual environment

**Windows (PowerShell)**

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

**macOS / Linux**

```bash
python3 -m venv venv
source venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure the database

Create the database and tables using the provided schema:

```bash
mysql -u root -p < database/sfls_schema.sql
```

Alternatively, the backend can create tables automatically on first run via SQLAlchemy (`db.create_all()`), but using `sfls_schema.sql` is recommended for seed data and full schema fidelity.

### 5. Environment variables

Create a `.env` file in the project root (see `.gitIgnore` — this file should stay local):

```env
# Required for production-like setups
SECRET_KEY=your-flask-secret-key
JWT_SECRET_KEY=your-jwt-secret-key
DATABASE_URL=mysql+pymysql://USER:PASSWORD@localhost/sfls_db

# Campus geofence (optional — defaults shown)
CAMPUS_LAT=28.6139
CAMPUS_LNG=77.2090
CAMPUS_RADIUS_KM=0.5
CAMPUS_WIFI_SSID=CampusNet
```

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | Flask session secret | Random hex if unset |
| `JWT_SECRET_KEY` | JWT signing key | Random hex if unset |
| `DATABASE_URL` | SQLAlchemy connection URI | `mysql+pymysql://root:password@localhost/sfls_db` |
| `CAMPUS_LAT` / `CAMPUS_LNG` | Campus center for geofencing | `28.6139`, `77.2090` |
| `CAMPUS_RADIUS_KM` | On-campus radius (km) | `0.5` |
| `CAMPUS_WIFI_SSID` | Wi‑Fi SSID treated as on-campus | `CampusNet` |

To generate a bcrypt password hash for seed users, uncomment and run the helper at the top of `sfls_backend.py`, then update `password_hash` values in `database/sfls_schema.sql`.

## Running the Application

Start the backend (serves the API and frontend on port 5000):

```bash
python sfls_backend.py
```

Or with the Flask CLI:

```bash
set FLASK_APP=sfls_backend.py
flask run --debug
```

Open in your browser:

**http://localhost:5000**

The frontend API base URL is configured in `script.js` as `http://localhost:5000/api`. Change it if you deploy to another host or port.

## User Roles & Views

After sign-in, the app routes users by role:

- **Student** — search, faculty cards, navigation, subscriptions
- **Faculty** — status panel and campus check-in
- **Admin** — tabs for buildings, floors, rooms, seats, and faculty management

Register new accounts via the sign-up flow (`POST /api/auth/register`) or insert users directly in MySQL with bcrypt-hashed passwords.

## API Overview

Base URL: `http://localhost:5000/api`

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/login` | — | Login; returns JWT |
| `POST` | `/auth/register` | — | Register user |
| `GET` | `/auth/me` | JWT | Current user profile |
| `GET` | `/faculty` | — | List/search faculty (`q`, `dept`, `status`, `page`, `per`) |
| `GET` | `/faculty/:id` | — | Faculty detail |
| `PATCH` | `/faculty/:id/status` | JWT | Update faculty status |
| `POST` | `/checkin` | JWT (faculty) | GPS/Wi‑Fi campus check-in |
| `GET` | `/navigate` | — | Outdoor + indoor directions (`faculty_id`, `lat`, `lng`) |
| `GET` / `POST` | `/admin/buildings` | JWT (admin) | List or create buildings |
| `POST` | `/admin/floors` | JWT (admin) | Add floor |
| `POST` | `/admin/rooms` | JWT (admin) | Add room |
| `POST` | `/admin/seats/allocate` | JWT (admin) | Assign seat to faculty |
| `GET` | `/admin/rooms/:id/seats` | JWT (admin) | Seats in a room |
| `GET` | `/notifications` | JWT | User notifications |
| `PATCH` | `/notifications/read` | JWT | Mark notifications read |
| `POST` / `DELETE` | `/subscribe/:faculty_id` | JWT | Subscribe/unsubscribe to faculty alerts |

**WebSocket (Socket.IO)**

- Event `join` with `{ "room": "global_feed" }` or `faculty_<id>`
- Server emits `status_update` when faculty status changes

## Demo / Offline Behavior

`script.js` includes mock faculty data and fallback handlers when the API is unreachable, so parts of the UI can be explored without a running backend. For full functionality (auth, navigation, admin CRUD, live updates), run `sfls_backend.py` with MySQL configured.

## Development Notes

- Static assets are served from the project root (`static_folder='.'`).
- CORS is enabled for `/api/*`.
- Default API rate limit: 200 requests/hour; login is limited to 10/minute.
- FCM push in `_send_fcm_push` is a stub — integrate Firebase Admin SDK for production mobile apps.
- Ensure Socket.IO client CDN in `sfls_app.html` matches your server version for reliable WebSocket connections.

## Security

- Never commit `.env` or real credentials to version control.
- Use strong `SECRET_KEY` and `JWT_SECRET_KEY` in production.
- Restrict CORS origins and Socket.IO `cors_allowed_origins` when deploying publicly.
- Replace placeholder password hashes in seed data before going live.

## License

No license file is included in this repository. Add one if you plan to distribute or open-source the project.
