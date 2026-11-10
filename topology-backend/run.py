import os
import ipaddress

from flask import Flask, jsonify, request, session
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_bcrypt import Bcrypt

import platform
import subprocess
from concurrent.futures import ThreadPoolExecutor

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', os.urandom(24).hex())
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = False  # set True behind HTTPS

CORS(
    app,
    supports_credentials=True,
    origins=["http://localhost:5173", "http://127.0.0.1:5173"],
)
bcrypt = Bcrypt(app)

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///topology.db'
db = SQLAlchemy(app)


class Device(db.Model):
    __tablename__ = 'device'

    id = db.Column(db.Integer, primary_key=True)
    ip = db.Column(db.String(50))
    device_type = db.Column(db.String(20))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))


class User(db.Model):
    __tablename__ = 'user'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True)
    password = db.Column(db.String(200))

    devices = db.relationship('Device', backref='owner', lazy=True)


# previous edge set, keyed by user id
previous_topology = {}


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


@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(force=True)
        username = (data.get('username') or '').strip()
        password = data.get('password')

        if not username or not password:
            return jsonify({"error": "Missing fields"}), 400

        if User.query.filter_by(username=username).first():
            return jsonify({"error": "User exists"}), 400

        hashed = bcrypt.generate_password_hash(password).decode('utf-8')
        user = User(username=username, password=hashed)
        db.session.add(user)
        db.session.commit()

        session['user'] = user.username
        return jsonify({"status": "registered"})

    except Exception as e:
        db.session.rollback()
        print("REGISTER ERROR:", e)
        return jsonify({"error": "Server error"}), 500


@app.route('/me')
def get_user():
    if 'user' not in session:
        return jsonify({"error": "Unauthorized"}), 401
    return jsonify({"username": session['user']})


@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json(force=True)
        username = data.get('username')
        password = data.get('password') or ''

        user = User.query.filter_by(username=username).first()
        if not user or not bcrypt.check_password_hash(user.password, password):
            return jsonify({"error": "Invalid credentials"}), 401

        session['user'] = user.username
        return jsonify({"status": "logged_in"})

    except Exception as e:
        print("LOGIN ERROR:", e)
        return jsonify({"error": "Server error"}), 500


@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return jsonify({"status": "logged_out"})


@app.route('/', methods=['GET'])
def get_topology():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    devices = Device.query.filter_by(user_id=user.id).all()
    nodes = [
        {"id": d.ip, "ip": d.ip, "type": d.device_type, "status": "active"}
        for d in devices
    ]
    edges = build_topology(nodes)

    alerts = []
    new_edges = set(tuple(e) for e in edges)
    if user.id in previous_topology:
        old_edges = previous_topology[user.id]
        alerts += [f"New connection: {a} → {b}" for a, b in new_edges - old_edges]
        alerts += [f"Connection removed: {a} → {b}" for a, b in old_edges - new_edges]
    previous_topology[user.id] = new_edges

    return jsonify({"nodes": nodes, "edges": edges, "alerts": alerts})


@app.route('/add', methods=['POST'])
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

    db.session.add(Device(ip=ip, device_type=classify_device(ip), user_id=user.id))
    db.session.commit()
    return jsonify({"status": "added"})


@app.route('/delete', methods=['POST'])
def delete_device():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    ip = (request.get_json(force=True).get('ip') or '').strip()
    device = Device.query.filter_by(ip=ip, user_id=user.id).first()
    if not device:
        return jsonify({"error": "Not found"}), 404

    db.session.delete(device)
    db.session.commit()
    return jsonify({"status": "deleted"})

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


@app.route('/scan', methods=['POST'])
def scan_network():
    user = current_user()
    if not user:
        return jsonify({"error": "Unauthorized"}), 401

    cidr = (request.get_json(force=True).get('cidr') or '').strip()
    try:
        net = ipaddress.ip_network(cidr, strict=False)
    except Exception:
        return jsonify({"error": "Invalid CIDR"}), 400

    if net.version != 4 or net.prefixlen < 24:
        return jsonify({"error": "Use IPv4 /24 or smaller"}), 400

    hosts = [str(h) for h in net.hosts()]
    with ThreadPoolExecutor(max_workers=64) as pool:
        alive = [ip for ip, ok in zip(hosts, pool.map(ping, hosts)) if ok]

    existing = {d.ip for d in Device.query.filter_by(user_id=user.id).all()}
    new_ips = [ip for ip in alive if ip not in existing]
    for ip in new_ips:
        db.session.add(Device(ip=ip, device_type=classify_device(ip), user_id=user.id))
    db.session.commit()

    return jsonify({"found": len(alive), "added": len(new_ips)})

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(debug=os.environ.get('FLASK_DEBUG') == '1')