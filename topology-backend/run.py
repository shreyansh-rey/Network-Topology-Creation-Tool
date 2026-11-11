import os
import hmac
import math
import secrets
import time
import ipaddress
import platform
import subprocess
import threading
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, jsonify, request, session
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_bcrypt import Bcrypt
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import inspect, text, or_

import snmp_discovery
from flask_socketio import SocketIO, join_room

POLL_INTERVAL = 30  # seconds between status polls

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', os.urandom(24).hex())
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = os.environ.get('COOKIE_SECURE') == '1'  # set 1 behind HTTPS
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=8)

ALLOWED_ORIGINS = set(
    o.strip()
    for o in os.environ.get(
        'FRONTEND_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173'
    ).split(',')
    if o.strip()
)

CORS(
    app,
    supports_credentials=True,
    origins=list(ALLOWED_ORIGINS),
    allow_headers=['Content-Type', 'X-CSRF-Token'],
)
bcrypt = Bcrypt(app)

# in-memory storage: resets on restart, not shared across workers. Use redis in prod.
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["300 per minute"],
    default_limits_exempt_when=lambda: request.method == 'OPTIONS',
    storage_uri="memory://",
)

# push channel. threading mode: works with dev server and gunicorn --threads.
socketio = SocketIO(
    app,
    cors_allowed_origins=list(ALLOWED_ORIGINS),
    async_mode='threading',
)
socket_sessions = {}  # sid -> csrf token of the login session that opened it

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///topology.db'
db = SQLAlchemy(app)


class Device(db.Model):
    __tablename__ = 'device'

    id = db.Column(db.Integer, primary_key=True)
    ip = db.Column(db.String(50))
    device_type = db.Column(db.String(20))
    status = db.Column(db.String(20), default='unknown')
    last_seen = db.Column(db.DateTime)
    pos_x = db.Column(db.Float)
    pos_y = db.Column(db.Float)
    sys_name = db.Column(db.String(100))
    sys_descr = db.Column(db.String(255))
    snmp = db.Column(db.Boolean, default=False)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))


class User(db.Model):
    __tablename__ = 'user'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True)
    password = db.Column(db.String(200))

    devices = db.relationship('Device', backref='owner', lazy=True)


class Alert(db.Model):
    __tablename__ = 'alert'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), index=True)
    message = db.Column(db.String(300))
    type = db.Column(db.String(10), default='info')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Link(db.Model):
    __tablename__ = 'link'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), index=True)
    a_ip = db.Column(db.String(50))
    b_ip = db.Column(db.String(50))
    source = db.Column(db.String(10))   # lldp, cdp, fdb, arp, manual
    label = db.Column(db.String(100))


class ScanSchedule(db.Model):
    __tablename__ = 'scan_schedule'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), index=True)
    cidr = db.Column(db.String(50))
    interval_minutes = db.Column(db.Integer)
    enabled = db.Column(db.Boolean, default=True)
    last_run = db.Column(db.DateTime)
    last_found = db.Column(db.Integer)
    last_added = db.Column(db.Integer)


MAX_ALERTS_PER_USER = 500
MAX_SCHEDULES_PER_USER = 5
RETURN_ALERTS = 100

# previous edge set, keyed by user id
previous_topology = {}


def add_alert(user_id, message, alert_type):
    """Stage alert in session. Caller commits. Returns the Alert."""
    a = Alert(user_id=user_id, message=message[:300], type=alert_type)
    db.session.add(a)
    return a


def alert_dict(a):
    return {
        "id": a.id,
        "message": a.message,
        "type": a.type,
        "timestamp": a.created_at.isoformat() + "Z",
    }


def notify(user_id, event, payload=None):
    """Push event to all open sockets of this user. Never raises."""
    try:
        socketio.emit(event, payload or {}, to=f"user:{user_id}")
    except Exception as e:
        print("NOTIFY ERROR:", e)


def drop_sockets(token):
    """Disconnect sockets opened by the login session that just logged out."""
    if not token:
        return
    for sid, tok in list(socket_sessions.items()):
        if tok == token:
            try:
                socketio.server.disconnect(sid, namespace='/')
            except Exception:
                pass
            socket_sessions.pop(sid, None)


def prune_alerts(user_id):
    old = (
        Alert.query.filter_by(user_id=user_id)
        .order_by(Alert.id.desc())
        .offset(MAX_ALERTS_PER_USER)
        .all()
    )
    for a in old:
        db.session.delete(a)


def migrate():
    """Add new columns to existing sqlite db (create_all does not alter tables)."""
    cols = {c['name'] for c in inspect(db.engine).get_columns('device')}
    with db.engine.begin() as conn:
        if 'status' not in cols:
            conn.execute(text("ALTER TABLE device ADD COLUMN status VARCHAR(20) DEFAULT 'unknown'"))
        if 'last_seen' not in cols:
            conn.execute(text("ALTER TABLE device ADD COLUMN last_seen DATETIME"))
        if 'pos_x' not in cols:
            conn.execute(text("ALTER TABLE device ADD COLUMN pos_x FLOAT"))
        if 'pos_y' not in cols:
            conn.execute(text("ALTER TABLE device ADD COLUMN pos_y FLOAT"))
        if 'sys_name' not in cols:
            conn.execute(text("ALTER TABLE device ADD COLUMN sys_name VARCHAR(100)"))
        if 'sys_descr' not in cols:
            conn.execute(text("ALTER TABLE device ADD COLUMN sys_descr VARCHAR(255)"))
        if 'snmp' not in cols:
            conn.execute(text("ALTER TABLE device ADD COLUMN snmp BOOLEAN DEFAULT 0"))


def valid_ip(ip):
    try:
        ipaddress.IPv4Address(ip)
    except Exception:
        return False
    last = int(ip.split('.')[-1])
    return last not in (0, 255)


def classify_device(ip):
    last = int(ip.split('.')[-1])
    if last == 1:
        return "router"
    if 2 <= last <= 5:
        return "switch"
    return "host"


def current_user():
    if 'user' not in session:
        return None
    return User.query.filter_by(username=session['user']).first()


def ping(ip):
    system = platform.system()
    if system == 'Windows':
        cmd = ['ping', '-n', '1', '-w', '1000', ip]
    elif system == 'Darwin':
        cmd = ['ping', '-c', '1', '-W', '1000', ip]
    else:
        cmd = ['ping', '-c', '1', '-W', '1', ip]
    try:
        r = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=3)
        return r.returncode == 0
    except Exception:
        return False


def poll_devices():
    """Ping every device, update status, queue alert on change."""
    with app.app_context():
        try:
            devices = Device.query.all()
            ips = list({d.ip for d in devices})
            if not ips:
                return
            with ThreadPoolExecutor(max_workers=64) as pool:
                results = dict(zip(ips, pool.map(ping, ips)))

            now = datetime.utcnow()
            new_alerts = []
            changed_users = set()
            for d in devices:
                alive = results.get(d.ip, False)
                new_status = 'active' if alive else 'down'
                old_status = d.status or 'unknown'
                if old_status != new_status:
                    changed_users.add(d.user_id)
                    if old_status in ('active', 'down'):
                        if new_status == 'down':
                            a = add_alert(d.user_id, f"Device {d.ip} is DOWN", 'error')
                        else:
                            a = add_alert(d.user_id, f"Device {d.ip} is back UP", 'info')
                        new_alerts.append((d.user_id, a))
                d.status = new_status
                if alive:
                    d.last_seen = now
            db.session.commit()

            for uid, a in new_alerts:
                notify(uid, 'alert', alert_dict(a))
            for uid in changed_users:
                notify(uid, 'topology', {'reason': 'status'})
        except Exception as e:
            db.session.rollback()
            print("POLL ERROR:", e)


def poll_loop():
    while True:
        poll_devices()
        time.sleep(POLL_INTERVAL)


def build_topology(nodes):
    edges = []

    routers = [n for n in nodes if n["type"] == "router"]
    switches = [n for n in nodes if n["type"] == "switch"]
    hosts = [n for n in nodes if n["type"] == "host"]

    for i in range(len(routers) - 1):
        edges.append([routers[i]["ip"], routers[i + 1]["ip"]])

    for i, sw in enumerate(switches):
        if routers:
            edges.append([sw["ip"], routers[i % len(routers)]["ip"]])

    for i, host in enumerate(hosts):
        if switches:
            edges.append([host["ip"], switches[i % len(switches)]["ip"]])

    return edges


MIN_PASSWORD_LEN = 8
MAX_FAILS = 5
LOCK_SECONDS = 300
failed_logins = {}  # username -> {"count": int, "until": float}

SAFE_METHODS = ('GET', 'HEAD', 'OPTIONS')
CSRF_EXEMPT = {'login', 'register'}


def is_locked(username):
    rec = failed_logins.get(username)
    return bool(rec and rec['until'] > time.time())


def record_fail(username):
    if len(failed_logins) > 10000:
        failed_logins.clear()
    rec = failed_logins.setdefault(username, {"count": 0, "until": 0})
    rec["count"] += 1
    if rec["count"] >= MAX_FAILS:
        rec["until"] = time.time() + LOCK_SECONDS
        rec["count"] = 0


def clear_fails(username):
    failed_logins.pop(username, None)


def issue_session(username):
    """Fresh session (prevents fixation) with new CSRF token."""
    session.clear()
    session.permanent = True
    session['user'] = username
    session['csrf'] = secrets.token_urlsafe(32)
    return session['csrf']


@app.before_request
def csrf_protect():
    if request.method in SAFE_METHODS:
        return None

    origin = request.headers.get('Origin')
    if origin and origin not in ALLOWED_ORIGINS:
        return jsonify({"error": "Forbidden origin"}), 403

    if request.endpoint in CSRF_EXEMPT:
        return None

    if 'user' not in session:
        return jsonify({"error": "Unauthorized"}), 401

    token = session.get('csrf') or ''
    sent = request.headers.get('X-CSRF-Token') or ''
    if not token or not hmac.compare_digest(token.encode(), sent.encode()):
        return jsonify({"error": "CSRF token missing or invalid"}), 403
    return None


@app.after_request
def security_headers(resp):
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['X-Frame-Options'] = 'DENY'
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.errorhandler(429)
def too_many_requests(e):
    return jsonify({"error": "Too many requests. Slow down and try again later."}), 429


@app.route('/register', methods=['POST'])
@limiter.limit("10 per hour")
def register():
    try:
        data = request.get_json(force=True, silent=True) or {}
        username = data.get('username')
        password = data.get('password')

        if not isinstance(username, str) or not isinstance(password, str):
            return jsonify({"error": "Missing fields"}), 400

        username = username.strip()
        if not username or not password:
            return jsonify({"error": "Missing fields"}), 400
        if len(username) > 50:
            return jsonify({"error": "Username too long"}), 400
        if len(password) < MIN_PASSWORD_LEN:
            return jsonify({"error": f"Password must be at least {MIN_PASSWORD_LEN} characters"}), 400
        if len(password.encode('utf-8')) > 72:
            return jsonify({"error": "Password too long (max 72 bytes)"}), 400

        if User.query.filter_by(username=username).first():
            return jsonify({"error": "User exists"}), 400

        hashed = bcrypt.generate_password_hash(password).decode('utf-8')
        user = User(username=username, password=hashed)
        db.session.add(user)
        db.session.commit()

        csrf = issue_session(user.username)
        return jsonify({"status": "registered", "csrf": csrf})

    except Exception as e:
        db.session.rollback()
        print("REGISTER ERROR:", e)
        return jsonify({"error": "Server error"}), 500


@app.route('/me')
def get_user():
    if 'user' not in session:
        return jsonify({"error": "Unauthorized"}), 401
    if 'csrf' not in session:
        session['csrf'] = secrets.token_urlsafe(32)
    return jsonify({"username": session['user'], "csrf": session['csrf']})


@app.route('/login', methods=['POST'])
@limiter.limit("10 per minute; 50 per hour")
def login():
    try:
        data = request.get_json(force=True, silent=True) or {}
        username = data.get('username')
        password = data.get('password')

        if not isinstance(username, str) or not isinstance(password, str):
            return jsonify({"error": "Invalid credentials"}), 401

        if is_locked(username):
            return jsonify({"error": "Too many failed attempts. Try again in a few minutes."}), 429

        user = User.query.filter_by(username=username).first()
        if not user or not bcrypt.check_password_hash(user.password, password):
            record_fail(username)
            return jsonify({"error": "Invalid credentials"}), 401

        clear_fails(username)
        csrf = issue_session(user.username)
        return jsonify({"status": "logged_in", "csrf": csrf})

    except Exception as e:
        print("LOGIN ERROR:", e)
        return jsonify({"error": "Server error"}), 500


@app.route('/logout', methods=['POST'])
def logout():
    token = session.get('csrf')
    session.clear()
    drop_sockets(token)
    return jsonify({"status": "logged_out"})


@app.route('/', methods=['GET'])
def get_topology():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    devices = Device.query.filter_by(user_id=user.id).all()
    nodes = [
        {
            "id": d.ip,
            "ip": d.ip,
            "type": d.device_type,
            "status": d.status or "unknown",
            "last_seen": d.last_seen.isoformat() + "Z" if d.last_seen else None,
            "x": d.pos_x,
            "y": d.pos_y,
            "name": d.sys_name,
            "descr": d.sys_descr,
            "snmp": bool(d.snmp),
        }
        for d in devices
    ]
    edges = build_edges(user.id, nodes)

    new_edges = set((e[0], e[1]) for e in edges)
    if user.id in previous_topology:
        old_edges = previous_topology[user.id]
        for a, b in sorted(new_edges - old_edges):
            add_alert(user.id, f"New connection: {a} → {b}", 'warning')
        for a, b in sorted(old_edges - new_edges):
            add_alert(user.id, f"Connection removed: {a} → {b}", 'warning')
    previous_topology[user.id] = new_edges

    prune_alerts(user.id)
    db.session.commit()

    recent = (
        Alert.query.filter_by(user_id=user.id)
        .order_by(Alert.id.desc())
        .limit(RETURN_ALERTS)
        .all()
    )
    alerts = [
        {
            "id": a.id,
            "message": a.message,
            "type": a.type,
            "timestamp": a.created_at.isoformat() + "Z",
        }
        for a in recent
    ]

    return jsonify({"nodes": nodes, "edges": edges, "alerts": alerts})


@app.route('/add', methods=['POST'])
@limiter.limit("60 per minute")
def add_device():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(force=True)
    ip = (data.get('ip') or '').strip()

    if not valid_ip(ip):
        return jsonify({"error": "Invalid IP address"}), 400

    if Device.query.filter_by(ip=ip, user_id=user.id).first():
        return jsonify({"error": "Device already exists"}), 409

    db.session.add(Device(ip=ip, device_type=classify_device(ip), status='unknown', user_id=user.id))
    db.session.commit()
    notify(user.id, 'topology', {'reason': 'add'})
    return jsonify({"status": "added"})


@app.route('/delete', methods=['POST'])
@limiter.limit("60 per minute")
def delete_device():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    ip = (request.get_json(force=True).get('ip') or '').strip()
    device = Device.query.filter_by(ip=ip, user_id=user.id).first()
    if not device:
        return jsonify({"error": "Not found"}), 404

    db.session.delete(device)
    Link.query.filter(
        Link.user_id == user.id, or_(Link.a_ip == ip, Link.b_ip == ip)
    ).delete(synchronize_session=False)
    db.session.commit()
    notify(user.id, 'topology', {'reason': 'delete'})
    return jsonify({"status": "deleted"})


# ---------- socket channel ----------

@socketio.on('connect')
def on_connect():
    user = current_user()
    if not user:
        return False  # reject unauthenticated socket
    socket_sessions[request.sid] = session.get('csrf')
    join_room(f"user:{user.id}")


@socketio.on('disconnect')
def on_disconnect(*args):
    socket_sessions.pop(request.sid, None)


# ---------- ping scan: background job + scheduler ----------

def parse_cidr(cidr):
    try:
        net = ipaddress.ip_network(cidr, strict=False)
    except Exception:
        raise ValueError("Invalid CIDR")
    if net.version != 4 or net.prefixlen < 24:
        raise ValueError("Use IPv4 /24 or smaller")
    if not net.is_private:
        raise ValueError("Only private ranges allowed")
    return net


def do_scan(user_id, net, progress=None, alert_new=False):
    """Ping sweep, add new live hosts. Needs app context. Returns (found, new_ips)."""
    hosts = [str(h) for h in net.hosts()]
    alive = []
    with ThreadPoolExecutor(max_workers=64) as pool:
        for i, (ip, ok) in enumerate(zip(hosts, pool.map(ping, hosts)), 1):
            if ok:
                alive.append(ip)
            if progress and (i % 16 == 0 or i == len(hosts)):
                progress(f"Pinged {i}/{len(hosts)}")

    existing = {d.ip for d in Device.query.filter_by(user_id=user_id).all()}
    new_ips = [ip for ip in alive if ip not in existing]
    now = datetime.utcnow()
    for ip in new_ips:
        db.session.add(Device(
            ip=ip,
            device_type=classify_device(ip),
            status='active',
            last_seen=now,
            user_id=user_id,
        ))

    new_alert = None
    if alert_new and new_ips:
        shown = ", ".join(new_ips[:5]) + (" ..." if len(new_ips) > 5 else "")
        new_alert = add_alert(user_id, f"Scheduled scan {net}: {len(new_ips)} new device(s): {shown}", 'info')
    db.session.commit()

    if new_ips:
        if new_alert is not None:
            notify(user_id, 'alert', alert_dict(new_alert))
        notify(user_id, 'topology', {'reason': 'scan'})
    return len(alive), new_ips


scan_jobs = {}  # user_id -> {status, message, found, added, error}
scan_lock = threading.Lock()


def run_scan_job(user_id, net):
    job = scan_jobs[user_id]

    def progress(msg):
        job['message'] = msg

    try:
        with app.app_context():
            found, new_ips = do_scan(user_id, net, progress=progress)
        job.update(
            status='done',
            message=f"Found {found} live, added {len(new_ips)} new",
            found=found,
            added=len(new_ips),
        )
    except Exception as e:
        with app.app_context():
            db.session.rollback()
        print("SCAN ERROR:", e)
        job.update(status='error', error='Scan failed')


@app.route('/scan', methods=['POST'])
@limiter.limit("5 per minute; 30 per hour")
def scan_network():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(force=True, silent=True) or {}
    cidr = data.get('cidr')
    cidr = cidr.strip() if isinstance(cidr, str) else ''
    try:
        net = parse_cidr(cidr)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    with scan_lock:
        job = scan_jobs.get(user.id)
        if job and job['status'] == 'running':
            return jsonify({"error": "Scan already running"}), 409
        scan_jobs[user.id] = {
            "status": "running",
            "message": "Starting",
            "found": 0,
            "added": 0,
            "error": None,
        }

    threading.Thread(target=run_scan_job, args=(user.id, net), daemon=True).start()
    return jsonify({"status": "running"}), 202


@app.route('/scan/status')
def scan_status():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify(scan_jobs.get(user.id, {"status": "idle"}))


def schedule_dict(sc):
    return {
        "id": sc.id,
        "cidr": sc.cidr,
        "interval_minutes": sc.interval_minutes,
        "enabled": bool(sc.enabled),
        "last_run": sc.last_run.isoformat() + "Z" if sc.last_run else None,
        "last_found": sc.last_found,
        "last_added": sc.last_added,
    }


@app.route('/schedules', methods=['GET'])
def list_schedules():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    rows = ScanSchedule.query.filter_by(user_id=user.id).order_by(ScanSchedule.id).all()
    return jsonify([schedule_dict(r) for r in rows])


@app.route('/schedules', methods=['POST'])
@limiter.limit("20 per minute")
def create_schedule():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(force=True, silent=True) or {}
    cidr = data.get('cidr')
    cidr = cidr.strip() if isinstance(cidr, str) else ''
    try:
        net = parse_cidr(cidr)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        interval = int(data.get('interval_minutes'))
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid interval"}), 400
    if not 5 <= interval <= 1440:
        return jsonify({"error": "Interval must be 5 to 1440 minutes"}), 400

    mine = ScanSchedule.query.filter_by(user_id=user.id).all()
    if len(mine) >= MAX_SCHEDULES_PER_USER:
        return jsonify({"error": f"Max {MAX_SCHEDULES_PER_USER} schedules"}), 400
    if any(r.cidr == str(net) for r in mine):
        return jsonify({"error": "Schedule for this range already exists"}), 409

    sc = ScanSchedule(user_id=user.id, cidr=str(net), interval_minutes=interval, enabled=True)
    db.session.add(sc)
    db.session.commit()
    return jsonify(schedule_dict(sc)), 201


@app.route('/schedules/delete', methods=['POST'])
@limiter.limit("20 per minute")
def delete_schedule():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    sid = (request.get_json(force=True, silent=True) or {}).get('id')
    sc = ScanSchedule.query.filter_by(id=sid, user_id=user.id).first() if isinstance(sid, int) else None
    if not sc:
        return jsonify({"error": "Not found"}), 404
    db.session.delete(sc)
    db.session.commit()
    return jsonify({"status": "deleted"})


@app.route('/schedules/toggle', methods=['POST'])
@limiter.limit("20 per minute")
def toggle_schedule():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    data = request.get_json(force=True, silent=True) or {}
    sid, enabled = data.get('id'), data.get('enabled')
    sc = ScanSchedule.query.filter_by(id=sid, user_id=user.id).first() if isinstance(sid, int) else None
    if not sc or not isinstance(enabled, bool):
        return jsonify({"error": "Not found"}), 404
    sc.enabled = enabled
    db.session.commit()
    return jsonify(schedule_dict(sc))


def run_due_schedules():
    # claim due schedules first so a slow scan never runs twice
    with app.app_context():
        now = datetime.utcnow()
        due = [
            sc for sc in ScanSchedule.query.filter_by(enabled=True).all()
            if not sc.last_run or sc.last_run + timedelta(minutes=sc.interval_minutes) <= now
        ]
        for sc in due:
            sc.last_run = now
        db.session.commit()
        jobs = [(sc.id, sc.user_id, sc.cidr) for sc in due]

    for sid, uid, cidr in jobs:
        try:
            with app.app_context():
                found, new_ips = do_scan(uid, ipaddress.ip_network(cidr), alert_new=True)
                sc = db.session.get(ScanSchedule, sid)
                if sc:
                    sc.last_found = found
                    sc.last_added = len(new_ips)
                    db.session.commit()
        except Exception as e:
            with app.app_context():
                db.session.rollback()
            print("SCHEDULED SCAN ERROR:", e)


def scheduler_loop():
    while True:
        try:
            run_due_schedules()
        except Exception as e:
            print("SCHEDULER ERROR:", e)
        time.sleep(30)


@app.route('/positions', methods=['POST'])
@limiter.limit("60 per minute")
def save_positions():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    positions = request.get_json(force=True).get('positions')
    if not isinstance(positions, dict) or len(positions) > 1000:
        return jsonify({"error": "Invalid positions"}), 400

    devices = {d.ip: d for d in Device.query.filter_by(user_id=user.id).all()}
    for ip, pos in positions.items():
        d = devices.get(ip)
        if not d or not isinstance(pos, dict):
            continue
        try:
            x = float(pos['x'])
            y = float(pos['y'])
        except (KeyError, TypeError, ValueError):
            continue
        if not (math.isfinite(x) and math.isfinite(y)):
            continue
        d.pos_x, d.pos_y = x, y

    db.session.commit()
    return jsonify({"status": "saved"})


@app.route('/alerts/clear', methods=['POST'])
@limiter.limit("10 per minute")
def clear_alerts():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    Alert.query.filter_by(user_id=user.id).delete()
    db.session.commit()
    notify(user.id, 'topology', {'reason': 'alerts'})
    return jsonify({"status": "cleared"})


def build_edges(user_id, nodes):
    """Real stored links if any exist, else role-based guess. Edge = [a, b, kind]."""
    ips = {n["ip"] for n in nodes}
    links = Link.query.filter_by(user_id=user_id).all()
    if links:
        return [[l.a_ip, l.b_ip, l.source] for l in links if l.a_ip in ips and l.b_ip in ips]
    return [[a, b, "inferred"] for a, b in build_topology(nodes)]


# ---------- SNMP discovery (background job per user) ----------

discovery_jobs = {}  # user_id -> {status, message, devices, links, error}
discovery_lock = threading.Lock()


def persist_discovery(user_id, result):
    existing = {d.ip: d for d in Device.query.filter_by(user_id=user_id).all()}

    for ip, info in result['devices'].items():
        d = existing.get(ip)
        if not d:
            d = Device(
                ip=ip,
                device_type=info.get('type') or classify_device(ip),
                status='unknown',
                user_id=user_id,
            )
            db.session.add(d)
            existing[ip] = d
        if info.get('snmp'):
            d.device_type = info['type']
            d.sys_name = (info.get('sys_name') or '')[:100] or None
            d.sys_descr = (info.get('sys_descr') or '')[:255] or None
            d.snmp = True

    # rediscovery replaces learned links, keeps manual ones
    Link.query.filter(Link.user_id == user_id, Link.source != 'manual').delete(
        synchronize_session=False
    )
    for a, b, source, label in result['links']:
        db.session.add(Link(user_id=user_id, a_ip=a, b_ip=b, source=source, label=label or None))

    add_alert(
        user_id,
        f"SNMP discovery: {len(result['devices'])} devices, {len(result['links'])} links",
        'info',
    )
    db.session.commit()
    return len(result['devices']), len(result['links'])


def run_discovery(user_id, seed, cfg):
    job = discovery_jobs[user_id]

    def progress(msg):
        job['message'] = msg

    try:
        auth = snmp_discovery.build_auth(cfg)
        result = snmp_discovery.crawl(seed, auth, progress=progress)
        with app.app_context():
            n_dev, n_links = persist_discovery(user_id, result)
        job.update(
            status='done',
            message=f"Found {n_dev} devices ({result['snmp_count']} via SNMP), {n_links} links",
            devices=n_dev,
            links=n_links,
        )
        notify(user_id, 'topology', {'reason': 'discovery'})
    except snmp_discovery.DiscoveryError as e:
        job.update(status='error', error=str(e))
    except Exception as e:
        with app.app_context():
            db.session.rollback()
        print("DISCOVERY ERROR:", type(e).__name__, e)
        job.update(status='error', error='Discovery failed. Check SNMP settings and server log.')


@app.route('/discover', methods=['POST'])
@limiter.limit("3 per minute; 20 per hour")
def discover():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    if not snmp_discovery.SNMP_AVAILABLE:
        return jsonify({"error": f"SNMP library unavailable: {snmp_discovery.SNMP_ERROR}"}), 503

    data = request.get_json(force=True, silent=True) or {}
    seed = (data.get('seed') or '').strip() if isinstance(data.get('seed'), str) else ''
    if not snmp_discovery.ok_target(seed):
        return jsonify({"error": "Seed must be a private IPv4 device address"}), 400

    try:
        cfg = snmp_discovery.parse_config(data)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    with discovery_lock:
        job = discovery_jobs.get(user.id)
        if job and job['status'] == 'running':
            return jsonify({"error": "Discovery already running"}), 409
        discovery_jobs[user.id] = {
            "status": "running",
            "message": "Starting",
            "devices": 0,
            "links": 0,
            "error": None,
        }

    threading.Thread(target=run_discovery, args=(user.id, seed, cfg), daemon=True).start()
    return jsonify({"status": "running"}), 202


@app.route('/discover/status')
def discover_status():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify(discovery_jobs.get(user.id, {"status": "idle"}))


def start_poller():
    threading.Thread(target=poll_loop, daemon=True).start()
    threading.Thread(target=scheduler_loop, daemon=True).start()


if __name__ == "__main__":
    debug = os.environ.get('FLASK_DEBUG') == '1'
    with app.app_context():
        db.create_all()
        migrate()
    # debug reloader spawns 2 processes: start poller only in worker
    if not debug or os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        start_poller()
    socketio.run(app, debug=debug, allow_unsafe_werkzeug=True)