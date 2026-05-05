from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from pysnmp.hlapi import *
from flask_bcrypt import Bcrypt
from flask import session


app = Flask(__name__)
app.config['SECRET_KEY'] = 'supersecretkey'
app.config['SESSION_COOKIE_SAMESITE'] = 'None'
app.config['SESSION_COOKIE_SECURE'] = False   # For local dev

CORS(
    app,
    supports_credentials=True,
    origins=["http://localhost:5173"]
)
bcrypt = Bcrypt(app)

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///topology.db'
db = SQLAlchemy(app)

#Database model
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


previous_topology = {
    "nodes": [],
    "edges": []
}

def same_subnet(ip1, ip2):
    return ip1.split('.')[:3] == ip2.split('.')[:3]


#SNMP Helper
def snmp_get_sysdescr(ip):
    try:
        iterator = getCmd(
            SnmpEngine(),
            CommunityData('public', mpModel=1),  # SNMPv2c for now
            UdpTransportTarget((ip, 161), timeout=1, retries=0),
            ContextData(),
            ObjectType(ObjectIdentity('1.3.6.1.2.1.1.1.0'))  # sysDescr
        )

        errorIndication, errorStatus, errorIndex, varBinds = next(iterator)

        if errorIndication or errorStatus:
            return None

        for varBind in varBinds:
            return str(varBind[1])

    except:
        return None


def generate_arp_data(nodes):
    arp_map = {}

    # Group devices by subnet
    subnets = {}
    for ip in nodes:
        subnet = ".".join(ip.split(".")[:3])
        subnets.setdefault(subnet, []).append(ip)

    # Within each subnet, create neighbor relationships
    for subnet_nodes in subnets.values():
        for i, node in enumerate(subnet_nodes):
            neighbors = []

            if i > 0:
                neighbors.append(subnet_nodes[i - 1])
            if i < len(subnet_nodes) - 1:
                neighbors.append(subnet_nodes[i + 1])

            arp_map[node] = neighbors

    return arp_map

#ARP logic for edges
def build_topology(nodes):
    edges = []

    routers = [n for n in nodes if n["type"] == "router"]
    switches = [n for n in nodes if n["type"] == "switch"]
    hosts = [n for n in nodes if n["type"] == "host"]

    # Routers connect to routers (backbone)
    for i in range(len(routers) - 1):
        edges.append([routers[i]["ip"], routers[i+1]["ip"]])

    # Switches connect to nearest router
    for i, sw in enumerate(switches):
        if routers:
            edges.append([sw["ip"], routers[i % len(routers)]["ip"]])

    # Hosts connect to switches
    for i, host in enumerate(hosts):
        if switches:
            edges.append([host["ip"], switches[i % len(switches)]["ip"]])

    return edges

@app.route('/register', methods=['POST'])
def register():
    try:
        data = request.get_json(force=True)

        username = data.get('username')
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
        print("REGISTER ERROR:", e)
        return jsonify({"error": "Server error"}), 500

@app.route('/me')
def get_user():
    if 'user' not in session:
        return jsonify({"error": "Unauthorized"}), 401

    return jsonify({
        "username": session['user']
    })

@app.route('/login', methods=['POST'])
def login():
    try:
        data = request.get_json(force=True)

        username = data.get('username')
        password = data.get('password')

        user = User.query.filter_by(username=username).first()

        if not user:
            return jsonify({"error": "User not found"}), 401

        if not bcrypt.check_password_hash(user.password, password):
            return jsonify({"error": "Wrong password"}), 401

        session['user'] = user.username

        return jsonify({"status": "logged_in"})

    except Exception as e:
        print("LOGIN ERROR:", e)
        return jsonify({"error": "Server error"}), 500

@app.route('/logout', methods=['POST'])
def logout():
    session.clear()

    response = jsonify({"status": "logged_out"})
    response.set_cookie('session', '', expires=0)

    return response

@app.route('/', methods=['GET'])
def get_topology():
    if 'user' not in session:
        return jsonify({"error": "Unauthorized"}), 401
    
    global previous_topology

    user = User.query.filter_by(username=session['user']).first()
    devices = Device.query.filter_by(user_id=user.id).all()

    nodes = []
    for d in devices:
        nodes.append({
            "id": d.ip,
            "ip": d.ip,
            "type": d.device_type,
            "status": "active"
        })

    edges = build_topology(nodes)

    # --- CHANGE DETECTION ---
    new_edges = set(tuple(e) for e in edges)
    old_edges = set(tuple(e) for e in previous_topology["edges"])

    added = new_edges - old_edges
    removed = old_edges - new_edges

    alerts = []

    for e in added:
        alerts.append(f"New connection: {e[0]} → {e[1]}")

    for e in removed:
        alerts.append(f"Connection removed: {e[0]} → {e[1]}")

    # Save current state
    previous_topology = {
        "nodes": nodes,
        "edges": edges
    }

    return jsonify({
        "nodes": nodes,
        "edges": edges,
        "alerts": alerts
    })



def classify_device(ip):
    last = int(ip.split('.')[-1])
    if last == 1:
        return "router"
    elif last <= 5:
        return "switch"
    else:
        return "host"


@app.route('/add', methods=['POST'])
def add_device():
    if 'user' not in session:
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(force=True)
    ip = data.get('ip')

    user = User.query.filter_by(username=session['user']).first()

    if not user:
        return jsonify({"error": "User not found"}), 400

    device = Device(
        ip=ip,
        device_type=classify_device(ip),
        user_id=user.id
    )

    db.session.add(device)
    db.session.commit()

    return jsonify({"status": "added"})


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(debug=True)
