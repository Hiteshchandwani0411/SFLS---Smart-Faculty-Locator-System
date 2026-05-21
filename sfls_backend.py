"""
Smart Faculty Locator System (SFLS) - Flask Backend
====================================================
Run:  flask run --debug
Env:  copy .env.example → .env  and fill in values
"""

from dotenv import load_dotenv
load_dotenv()

# from flask_bcrypt import Bcrypt
# bcrypt = Bcrypt()
# print(bcrypt.generate_password_hash('faculty@123').decode('utf-8'))

import os, json, math, hashlib, secrets
from datetime import datetime, timedelta
from functools import wraps

from flask import (Flask, request, jsonify, g)
from flask_sqlalchemy import SQLAlchemy
from flask_bcrypt import Bcrypt
from flask_jwt_extended import (
    JWTManager, create_access_token, jwt_required,
    get_jwt_identity, get_jwt
)
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import or_, func


# ─────────────────────────────────────────────
#  APP BOOTSTRAP
# ─────────────────────────────────────────────
app = Flask(__name__, static_folder='.', static_url_path='')

app.config.update(
    SECRET_KEY                      = os.getenv("SECRET_KEY", secrets.token_hex(32)),
    JWT_SECRET_KEY                  = os.getenv("JWT_SECRET_KEY", secrets.token_hex(32)),
    JWT_ACCESS_TOKEN_EXPIRES        = timedelta(hours=8),
    SQLALCHEMY_DATABASE_URI         = os.getenv(
        "DATABASE_URL",
        "mysql+pymysql://root:password@localhost/sfls_db"
    ),
    SQLALCHEMY_TRACK_MODIFICATIONS  = False,
    SQLALCHEMY_POOL_RECYCLE         = 280,
)

db       = SQLAlchemy(app)
bcrypt   = Bcrypt(app)
jwt      = JWTManager(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")
CORS(app, resources={r"/api/*": {"origins": "*"}})
limiter  = Limiter(get_remote_address, app=app, default_limits=["200/hour"])


# ─────────────────────────────────────────────
#  MODELS  (mirrors schema.sql)
# ─────────────────────────────────────────────
class User(db.Model):
    __tablename__ = "users"
    id            = db.Column(db.Integer, primary_key=True)
    email         = db.Column(db.String(180), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role          = db.Column(db.Enum("admin","faculty","student"), default="student")
    full_name     = db.Column(db.String(120), nullable=False)
    avatar_url    = db.Column(db.String(512))
    is_active     = db.Column(db.Boolean, default=True)
    last_login    = db.Column(db.DateTime)
    created_at    = db.Column(db.DateTime, default=datetime.utcnow)


class Department(db.Model):
    __tablename__ = "departments"
    id         = db.Column(db.Integer, primary_key=True)
    name       = db.Column(db.String(100), unique=True)
    short_code = db.Column(db.String(10),  unique=True)


class Building(db.Model):
    __tablename__ = "buildings"
    id           = db.Column(db.Integer, primary_key=True)
    name         = db.Column(db.String(100))
    short_code   = db.Column(db.String(10), unique=True)
    lat          = db.Column(db.Numeric(10,7))
    lng          = db.Column(db.Numeric(10,7))
    entrance_lat = db.Column(db.Numeric(10,7))
    entrance_lng = db.Column(db.Numeric(10,7))
    floors       = db.relationship("Floor", backref="building", cascade="all,delete")


class Floor(db.Model):
    __tablename__ = "floors"
    id           = db.Column(db.Integer, primary_key=True)
    building_id  = db.Column(db.Integer, db.ForeignKey("buildings.id"), nullable=False)
    floor_number = db.Column(db.SmallInteger, nullable=False)
    floor_name   = db.Column(db.String(60))
    svg_map_data = db.Column(db.Text)
    rooms        = db.relationship("Room", backref="floor", cascade="all,delete")


class Room(db.Model):
    __tablename__ = "rooms"
    id          = db.Column(db.Integer, primary_key=True)
    floor_id    = db.Column(db.Integer, db.ForeignKey("floors.id"), nullable=False)
    room_number = db.Column(db.String(20))
    room_name   = db.Column(db.String(80))
    room_type   = db.Column(db.String(20), default="office")
    x_position  = db.Column(db.SmallInteger, default=0)
    y_position  = db.Column(db.SmallInteger, default=0)
    width       = db.Column(db.SmallInteger, default=60)
    height      = db.Column(db.SmallInteger, default=40)
    seats       = db.relationship("Seat", backref="room", cascade="all,delete")


class Seat(db.Model):
    __tablename__ = "seats"
    id         = db.Column(db.Integer, primary_key=True)
    room_id    = db.Column(db.Integer, db.ForeignKey("rooms.id"), nullable=False)
    seat_label = db.Column(db.String(10))
    row_num    = db.Column(db.SmallInteger)
    col_num    = db.Column(db.SmallInteger)
    seat_type  = db.Column(db.String(20), default="desk")
    is_active  = db.Column(db.Boolean, default=True)


class Faculty(db.Model):
    __tablename__ = "faculty"
    id                = db.Column(db.Integer, primary_key=True)
    user_id           = db.Column(db.Integer, db.ForeignKey("users.id"), unique=True)
    department_id     = db.Column(db.Integer, db.ForeignKey("departments.id"))
    employee_id       = db.Column(db.String(30), unique=True)
    designation       = db.Column(db.String(80))
    specialization    = db.Column(db.String(120))
    cabin_room_id     = db.Column(db.Integer, db.ForeignKey("rooms.id"), nullable=True)
    primary_seat_id   = db.Column(db.Integer, db.ForeignKey("seats.id"), nullable=True)
    office_hours      = db.Column(db.String(255))
    status            = db.Column(db.String(20), default="not_available")
    status_message    = db.Column(db.String(255))
    status_updated_at = db.Column(db.DateTime)
    is_on_campus      = db.Column(db.Boolean, default=False)
    fcm_token         = db.Column(db.String(512))
    updated_at        = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    # relationships
    user       = db.relationship("User",       foreign_keys=[user_id])
    department = db.relationship("Department", foreign_keys=[department_id])
    cabin_room = db.relationship("Room",       foreign_keys=[cabin_room_id])
    primary_seat = db.relationship("Seat",     foreign_keys=[primary_seat_id])


class SeatAllocation(db.Model):
    __tablename__ = "seat_allocations"
    id           = db.Column(db.Integer, primary_key=True)
    seat_id      = db.Column(db.Integer, db.ForeignKey("seats.id"),    unique=True)
    faculty_id   = db.Column(db.Integer, db.ForeignKey("faculty.id"),  nullable=False)
    allocated_by = db.Column(db.Integer, db.ForeignKey("users.id"),    nullable=False)
    allocated_at = db.Column(db.DateTime, default=datetime.utcnow)
    notes        = db.Column(db.String(255))
    seat    = db.relationship("Seat",    foreign_keys=[seat_id])
    faculty = db.relationship("Faculty", foreign_keys=[faculty_id])


class NotificationSubscription(db.Model):
    __tablename__ = "notification_subscriptions"
    id              = db.Column(db.Integer, primary_key=True)
    student_user_id = db.Column(db.Integer, db.ForeignKey("users.id"))
    faculty_id      = db.Column(db.Integer, db.ForeignKey("faculty.id"))


class Notification(db.Model):
    __tablename__ = "notifications"
    id             = db.Column(db.Integer, primary_key=True)
    user_id        = db.Column(db.Integer, db.ForeignKey("users.id"))
    title          = db.Column(db.String(120))
    body           = db.Column(db.Text)
    is_read        = db.Column(db.Boolean, default=False)
    notif_type     = db.Column(db.String(20), default="status_change")
    ref_faculty_id = db.Column(db.Integer, db.ForeignKey("faculty.id"), nullable=True)
    created_at     = db.Column(db.DateTime, default=datetime.utcnow)


class ActivityLog(db.Model):
    __tablename__ = "activity_logs"
    id          = db.Column(db.BigInteger, primary_key=True)
    user_id     = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=True)
    action      = db.Column(db.String(80))
    target_type = db.Column(db.String(40))
    target_id   = db.Column(db.Integer)
    old_value   = db.Column(db.String(255))
    new_value   = db.Column(db.String(255))
    ip_address  = db.Column(db.String(45))
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)


# ─────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────
def role_required(*roles):
    """Decorator: restrict endpoint to given roles."""
    def decorator(fn):
        @wraps(fn)
        @jwt_required()
        def wrapper(*args, **kwargs):
            claims = get_jwt()
            if claims.get("role") not in roles:
                return jsonify(error="Forbidden"), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def log_action(action, target_type=None, target_id=None, old=None, new=None):
    try:
        uid = get_jwt_identity()
    except Exception:
        uid = None
    entry = ActivityLog(
        user_id=uid, action=action, target_type=target_type,
        target_id=target_id, old_value=str(old) if old else None,
        new_value=str(new) if new else None,
        ip_address=request.remote_addr
    )
    db.session.add(entry)


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi       = math.radians(lat2 - lat1)
    dlambda    = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def faculty_profile_for_user(user_id):
    """Return whether the user has a faculty row and the record if present."""
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return False, None
    f = Faculty.query.filter_by(user_id=uid).first()
    return (f is not None, f)


def faculty_to_dict(f: Faculty) -> dict:
    return {
        "id":            f.id,
        "name":          f.user.full_name,
        "avatar":        f.user.avatar_url,
        "employee_id":   f.employee_id,
        "designation":   f.designation,
        "specialization":f.specialization,
        "office_hours":  f.office_hours,
        "department":    f.department.name if f.department else None,
        "dept_code":     f.department.short_code if f.department else None,
        "status":        f.status,
        "status_message":f.status_message,
        "status_updated_at": f.status_updated_at.isoformat() if f.status_updated_at else None,
        "is_on_campus":  f.is_on_campus,
        "room": {
            "id":     f.cabin_room.id if f.cabin_room else None,
            "number": f.cabin_room.room_number if f.cabin_room else None,
            "name":   f.cabin_room.room_name   if f.cabin_room else None,
        } if f.cabin_room_id else None,
    }


# ─────────────────────────────────────────────
#  AUTH ROUTES  /api/auth/*
# ─────────────────────────────────────────────
@app.route("/api/auth/login", methods=["POST"])
@limiter.limit("10/minute")
def login():
    data     = request.get_json()
    email    = data.get("email","").lower().strip()
    password = data.get("password","")

    user = User.query.filter_by(email=email, is_active=True).first()
    if not user or not bcrypt.check_password_hash(user.password_hash, password):
        return jsonify(error="Invalid credentials"), 401

    user.last_login = datetime.utcnow()
    db.session.commit()

    extra_claims = {"role": user.role, "name": user.full_name}
    token = create_access_token(identity=str(user.id), additional_claims=extra_claims)
    payload = {
        "token": token,
        "role": user.role,
        "name": user.full_name,
        "id": user.id,
    }
    if user.role == "faculty":
        complete, faculty = faculty_profile_for_user(user.id)
        payload["faculty_profile_complete"] = complete
        if faculty:
            payload["faculty_id"] = faculty.id
    return jsonify(**payload)


@app.route("/api/auth/register", methods=["POST"])
def register():
    data = request.get_json()
    if User.query.filter_by(email=data["email"].lower()).first():
        return jsonify(error="Email already registered"), 409
    pw_hash = bcrypt.generate_password_hash(data["password"]).decode()
    user    = User(
        email=data["email"].lower(), password_hash=pw_hash,
        role=data.get("role","student"), full_name=data["full_name"]
    )
    db.session.add(user)
    db.session.commit()
    return jsonify(message="Registered successfully", id=user.id), 201


@app.route("/api/auth/me")
@jwt_required()
def me():
    uid  = get_jwt_identity()
    user = User.query.get_or_404(uid)
    payload = {
        "id": user.id,
        "email": user.email,
        "name": user.full_name,
        "role": user.role,
        "avatar": user.avatar_url,
    }
    if user.role == "faculty":
        complete, faculty = faculty_profile_for_user(user.id)
        payload["faculty_profile_complete"] = complete
        if faculty:
            payload["faculty_id"] = faculty.id
    return jsonify(**payload)


@app.route("/api/departments")
def list_departments():
    depts = Department.query.order_by(Department.name).all()
    return jsonify(results=[
        {"id": d.id, "name": d.name, "short_code": d.short_code}
        for d in depts
    ])


@app.route("/api/auth/faculty-profile", methods=["GET", "POST"])
@jwt_required()
def faculty_profile():
    uid  = int(get_jwt_identity())
    user = User.query.get_or_404(uid)
    if user.role != "faculty":
        return jsonify(error="Only faculty accounts have a faculty profile"), 403

    if request.method == "GET":
        faculty = Faculty.query.filter_by(user_id=uid).first()
        if not faculty:
            return jsonify(complete=False)
        return jsonify(complete=True, profile=faculty_to_dict(faculty))

    # POST — create faculty profile
    if Faculty.query.filter_by(user_id=uid).first():
        return jsonify(error="Faculty profile already exists"), 409

    data = request.get_json() or {}
    department_id = data.get("department_id")
    employee_id   = (data.get("employee_id") or "").strip()
    designation   = (data.get("designation") or "").strip()
    specialization = (data.get("specialization") or "").strip() or None
    office_hours  = (data.get("office_hours") or "").strip() or None

    if not department_id:
        return jsonify(error="department_id is required"), 400
    if not employee_id:
        return jsonify(error="employee_id is required"), 400
    if not designation:
        return jsonify(error="designation is required"), 400

    dept = Department.query.get(department_id)
    if not dept:
        return jsonify(error="Invalid department"), 400
    if Faculty.query.filter_by(employee_id=employee_id).first():
        return jsonify(error="Employee ID already in use"), 409

    faculty = Faculty(
        user_id=uid,
        department_id=dept.id,
        employee_id=employee_id,
        designation=designation,
        specialization=specialization,
        office_hours=office_hours,
        status="not_available",
    )
    db.session.add(faculty)
    db.session.commit()
    log_action("FACULTY_PROFILE_CREATED", "faculty", faculty.id)

    return jsonify(
        message="Faculty profile created",
        complete=True,
        faculty_id=faculty.id,
        profile=faculty_to_dict(faculty),
    ), 201


# ─────────────────────────────────────────────
#  FACULTY SEARCH  /api/faculty/*
# ─────────────────────────────────────────────
@app.route("/api/faculty")
def list_faculty():
    q    = request.args.get("q","").strip()
    dept = request.args.get("dept","").strip()
    status = request.args.get("status","").strip()
    page   = int(request.args.get("page",1))
    per    = min(int(request.args.get("per",20)), 50)

    query = Faculty.query.join(User).join(Department)

    if q:
        query = query.filter(
            or_(User.full_name.ilike(f"%{q}%"),
                Faculty.designation.ilike(f"%{q}%"),
                Faculty.employee_id.ilike(f"%{q}%"))
        )
    if dept:
        query = query.filter(Department.short_code == dept.upper())
    if status:
        query = query.filter(Faculty.status == status)

    total      = query.count()
    results    = query.offset((page-1)*per).limit(per).all()
    return jsonify(total=total, page=page, results=[faculty_to_dict(f) for f in results])


@app.route("/api/faculty/<int:fid>")
def get_faculty(fid):
    f = Faculty.query.get_or_404(fid)
    return jsonify(faculty_to_dict(f))


# ─────────────────────────────────────────────
#  FACULTY STATUS  /api/faculty/<id>/status
# ─────────────────────────────────────────────
VALID_STATUSES = {"available","busy","not_available","in_class"}

@app.route("/api/faculty/<int:fid>/status", methods=["PATCH"])
@jwt_required()
def update_status(fid):
    claims  = get_jwt()
    uid     = get_jwt_identity()
    faculty = Faculty.query.get_or_404(fid)

    print(f"CHECK: faculty.user_id ({type(faculty.user_id)}) vs uid ({type(uid)})")
    print(f"VALUES: {faculty.user_id} vs {uid}")

    # Only own faculty or admin
    if claims["role"] == "faculty" and str(faculty.user_id) != str(uid):
        print("RESULT: Access Denied (Not Owner)")
        return jsonify(error="Forbidden"), 403

    data       = request.get_json()
    new_status = data.get("status")
    message    = data.get("message","")

    if new_status not in VALID_STATUSES:
        return jsonify(error=f"status must be one of {VALID_STATUSES}"), 400

    old_status = faculty.status
    faculty.status            = new_status
    faculty.status_message    = message[:255] if message else None
    faculty.status_updated_at = datetime.utcnow()

    log_action("STATUS_CHANGE","faculty", fid, old=old_status, new=new_status)
    db.session.commit()

    # Real-time push via WebSocket
    payload = {
        "faculty_id": fid,
        "name":       faculty.user.full_name,
        "old_status": old_status,
        "new_status": new_status,
        "message":    message,
    }
    socketio.emit("status_update", payload, room=f"faculty_{fid}")
    socketio.emit("status_update", payload, room="global_feed")

    # DB notifications for subscribed students
    if new_status == "available":
        _notify_subscribers(faculty)

    return jsonify(success=True, **payload)


def _notify_subscribers(faculty: Faculty):
    subs = NotificationSubscription.query.filter_by(faculty_id=faculty.id).all()
    for sub in subs:
        notif = Notification(
            user_id=sub.student_user_id,
            title=f"{faculty.user.full_name} is now Available",
            body=faculty.status_message or "The faculty is now available.",
            notif_type="status_change",
            ref_faculty_id=faculty.id
        )
        db.session.add(notif)
    db.session.commit()

    # FCM push (conceptual – replace with real firebase-admin call)
    if faculty.fcm_token:
        _send_fcm_push(
            faculty.fcm_token,
            f"Faculty Available: {faculty.user.full_name}",
            faculty.status_message or ""
        )


def _send_fcm_push(token: str, title: str, body: str):
    """
    Conceptual FCM Push – replace with:
        import firebase_admin
        from firebase_admin import messaging
        msg = messaging.Message(
            notification=messaging.Notification(title=title, body=body),
            token=token
        )
        messaging.send(msg)
    """
    print(f"[FCM] → {token[:20]}...  title={title}")


# ─────────────────────────────────────────────
#  GEOFENCE / WIFI CHECK-IN  /api/checkin
# ─────────────────────────────────────────────
CAMPUS_CENTER_LAT = float(os.getenv("CAMPUS_LAT", "28.6139"))
CAMPUS_CENTER_LNG = float(os.getenv("CAMPUS_LNG", "77.2090"))
CAMPUS_RADIUS_KM  = float(os.getenv("CAMPUS_RADIUS_KM", "0.5"))

@app.route("/api/checkin", methods=["POST"])
@jwt_required()
def wifi_checkin():
    """
    Mobile wrapper sends GPS coords periodically.
    If outside campus radius → mark not_available & off-campus.
    """
    uid     = get_jwt_identity()
    faculty = Faculty.query.filter_by(user_id=uid).first()
    if not faculty:
        return jsonify(error="Not a faculty account"), 403

    data = request.get_json()
    lat  = float(data.get("lat", 0))
    lng  = float(data.get("lng", 0))
    ssid = data.get("ssid","")  # WiFi SSID from native app

    dist_km = haversine_km(lat, lng, CAMPUS_CENTER_LAT, CAMPUS_CENTER_LNG)
    on_campus = dist_km <= CAMPUS_RADIUS_KM or ssid == os.getenv("CAMPUS_WIFI_SSID","CampusNet")

    faculty.is_on_campus   = on_campus
    faculty.last_checkin_at = datetime.utcnow()

    if not on_campus and faculty.status != "not_available":
        old = faculty.status
        faculty.status            = "not_available"
        faculty.status_updated_at = datetime.utcnow()
        log_action("AUTO_STATUS","faculty",faculty.id, old=old, new="not_available")
        socketio.emit("status_update", {
            "faculty_id": faculty.id, "new_status": "not_available",
            "reason": "left_campus"
        }, room="global_feed")

    db.session.commit()
    return jsonify(on_campus=on_campus, dist_km=round(dist_km,3))


# ─────────────────────────────────────────────
#  NAVIGATION  /api/navigate
# ─────────────────────────────────────────────
@app.route("/api/navigate")
def navigate():
    """
    Returns:
      - Outdoor: building entrance GPS coords (for Google Maps)
      - Indoor:  step-by-step text instructions + waypoints list
      - Distance & ETA
    """
    faculty_id  = request.args.get("faculty_id", type=int)
    user_lat    = request.args.get("lat",  type=float)
    user_lng    = request.args.get("lng",  type=float)

    faculty = Faculty.query.get_or_404(faculty_id)

    if not faculty.cabin_room_id:
        return jsonify(error="Faculty has no assigned room"), 404

    room  = faculty.cabin_room
    floor = room.floor
    bldg  = floor.building

    # ── Outdoor leg ──────────────────────────────
    outdoor = None
    if user_lat and user_lng and bldg.entrance_lat:
        dist_km = haversine_km(user_lat, user_lng,
                               float(bldg.entrance_lat), float(bldg.entrance_lng))
        walk_min = round(dist_km / 0.083, 1)   # avg 5 km/h walking
        outdoor = {
            "destination_lat":  float(bldg.entrance_lat),
            "destination_lng":  float(bldg.entrance_lng),
            "building_name":    bldg.name,
            "distance_km":      round(dist_km, 3),
            "eta_walk_min":     walk_min,
        }

    # ── Indoor leg ───────────────────────────────
    steps   = _build_indoor_steps(bldg, floor, room)
    indoor  = {
        "building":      bldg.name,
        "floor_number":  floor.floor_number,
        "floor_name":    floor.floor_name or f"Floor {floor.floor_number}",
        "room_number":   room.room_number,
        "room_name":     room.room_name,
        "steps":         steps,
        "svg_map":       floor.svg_map_data,   # raw SVG for rendering
        "room_coords":   {"x": room.x_position, "y": room.y_position,
                          "w": room.width, "h": room.height},
    }

    return jsonify(outdoor=outdoor, indoor=indoor,
                   faculty={"name": faculty.user.full_name, "status": faculty.status})


def _build_indoor_steps(bldg, floor, room) -> list[dict]:
    """Generate human-readable indoor navigation steps."""
    steps = []
    steps.append({"step": 1, "icon": "door",
                  "text": f"Enter {bldg.name} through the main entrance."})

    if floor.floor_number == 0:
        steps.append({"step": 2, "icon": "arrow_right",
                      "text": "Proceed straight along the ground floor corridor."})
    elif floor.floor_number > 0:
        steps.append({"step": 2, "icon": "stairs",
                      "text": f"Take the staircase or lift to Floor {floor.floor_number}."})
        steps.append({"step": 3, "icon": "arrow",
                      "text": f"Exit on Floor {floor.floor_number} and follow directional signs."})

    steps.append({"step": len(steps)+1, "icon": "room",
                  "text": f"Locate Room {room.room_number}"
                          + (f" ({room.room_name})" if room.room_name else "")
                          + "."})
    steps.append({"step": len(steps)+1, "icon": "pin",
                  "text": f"You have arrived. Knock and check for {faculty_to_dict.__name__} availability."})
    return steps


# ─────────────────────────────────────────────
#  ADMIN – BUILDINGS / FLOORS / ROOMS
# ─────────────────────────────────────────────
@app.route("/api/admin/buildings", methods=["GET","POST"])
@role_required("admin")
def admin_buildings():
    if request.method == "GET":
        return jsonify([{
            "id": b.id, "name": b.name, "short_code": b.short_code,
            "lat": float(b.lat or 0), "lng": float(b.lng or 0)
        } for b in Building.query.all()])

    d   = request.get_json()
    bld = Building(**{k: d[k] for k in ("name","short_code","lat","lng",
                                         "entrance_lat","entrance_lng") if k in d})
    db.session.add(bld); db.session.commit()
    return jsonify(id=bld.id, message="Building created"), 201


@app.route("/api/admin/floors", methods=["POST"])
@role_required("admin")
def admin_add_floor():
    d = request.get_json()
    fl = Floor(building_id=d["building_id"], floor_number=d["floor_number"],
               floor_name=d.get("floor_name"), svg_map_data=d.get("svg_map_data"))
    db.session.add(fl); db.session.commit()
    return jsonify(id=fl.id, message="Floor created"), 201


@app.route("/api/admin/rooms", methods=["POST"])
@role_required("admin")
def admin_add_room():
    d    = request.get_json()
    room = Room(floor_id=d["floor_id"], room_number=d["room_number"],
                room_name=d.get("room_name"), room_type=d.get("room_type","office"),
                x_position=d.get("x",0), y_position=d.get("y",0),
                width=d.get("w",60), height=d.get("h",40))
    db.session.add(room); db.session.commit()
    return jsonify(id=room.id, message="Room created"), 201


# ─────────────────────────────────────────────
#  ADMIN – SEATING GRID
# ─────────────────────────────────────────────
@app.route("/api/admin/seats/allocate", methods=["POST"])
@role_required("admin")
def allocate_seat():
    uid  = get_jwt_identity()
    d    = request.get_json()

    seat    = Seat.query.get_or_404(d["seat_id"])
    faculty = Faculty.query.get_or_404(d["faculty_id"])

    # Remove any existing allocation for this seat
    SeatAllocation.query.filter_by(seat_id=seat.id).delete()

    alloc = SeatAllocation(seat_id=seat.id, faculty_id=faculty.id,
                           allocated_by=uid, notes=d.get("notes"))
    faculty.primary_seat_id = seat.id
    db.session.add(alloc)
    log_action("SEAT_ALLOC","seat", seat.id, new=f"faculty:{faculty.id}")
    db.session.commit()
    return jsonify(message=f"Seat {seat.seat_label} allocated to {faculty.user.full_name}")


@app.route("/api/admin/rooms/<int:rid>/seats")
@role_required("admin")
def room_seats(rid):
    seats = Seat.query.filter_by(room_id=rid).all()
    allocs = {a.seat_id: a for a in
              SeatAllocation.query.filter(
                  SeatAllocation.seat_id.in_([s.id for s in seats])).all()}
    result = []
    for s in seats:
        a = allocs.get(s.id)
        result.append({
            "id": s.id, "label": s.seat_label,
            "row": s.row_num, "col": s.col_num,
            "allocated": bool(a),
            "faculty": faculty_to_dict(a.faculty) if a else None
        })
    return jsonify(result)


# ─────────────────────────────────────────────
#  NOTIFICATIONS
# ─────────────────────────────────────────────
@app.route("/api/notifications")
@jwt_required()
def get_notifications():
    uid   = get_jwt_identity()
    notifs = (Notification.query
              .filter_by(user_id=uid)
              .order_by(Notification.created_at.desc())
              .limit(50).all())
    return jsonify([{
        "id": n.id, "title": n.title, "body": n.body,
        "is_read": n.is_read, "type": n.notif_type,
        "faculty_id": n.ref_faculty_id,
        "created_at": n.created_at.isoformat()
    } for n in notifs])


@app.route("/api/notifications/read", methods=["PATCH"])
@jwt_required()
def mark_read():
    uid  = get_jwt_identity()
    nids = request.get_json().get("ids",[])
    Notification.query.filter(
        Notification.user_id == uid,
        Notification.id.in_(nids)
    ).update({"is_read": True}, synchronize_session=False)
    db.session.commit()
    return jsonify(success=True)


@app.route("/api/subscribe/<int:fid>", methods=["POST","DELETE"])
@jwt_required()
def subscribe(fid):
    uid = get_jwt_identity()
    sub = NotificationSubscription.query.filter_by(
        student_user_id=uid, faculty_id=fid).first()
    if request.method == "POST":
        if not sub:
            db.session.add(NotificationSubscription(student_user_id=uid, faculty_id=fid))
            db.session.commit()
        return jsonify(subscribed=True)
    else:
        if sub:
            db.session.delete(sub); db.session.commit()
        return jsonify(subscribed=False)


# ─────────────────────────────────────────────
#  WEBSOCKET ROOMS
# ─────────────────────────────────────────────
@socketio.on("join")
def on_join(data):
    room = data.get("room","global_feed")
    join_room(room)
    emit("joined", {"room": room})


# ─────────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────────
@app.route('/')
def serve_frontend():
    return open('sfls_app.html', encoding='utf-8').read()

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    socketio.run(app, debug=True, host="0.0.0.0", port=5000)
