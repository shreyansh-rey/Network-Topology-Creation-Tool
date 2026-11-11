import ipaddress
from collections import deque

try:
    from pysnmp import hlapi as h
    if not (hasattr(h, 'getCmd') and hasattr(h, 'nextCmd')):
        raise ImportError('installed pysnmp has no sync getCmd/nextCmd')
    SNMP_AVAILABLE = True
    SNMP_ERROR = None
except Exception as _exc:
    h = None
    SNMP_AVAILABLE = False
    SNMP_ERROR = f"{type(_exc).__name__}: {_exc}"

OID_SYS_DESCR = '1.3.6.1.2.1.1.1.0'
OID_SYS_NAME = '1.3.6.1.2.1.1.5.0'
OID_SYS_SERVICES = '1.3.6.1.2.1.1.7.0'

OID_LLDP_MAN_ADDR = '1.0.8802.1.1.2.1.4.2.1.3'      # lldpRemManAddrIfSubtype
OID_CDP_ADDR = '1.3.6.1.4.1.9.9.23.1.2.1.1.4'       # cdpCacheAddress
OID_ARP_MAC = '1.3.6.1.2.1.4.22.1.2'                # ipNetToMediaPhysAddress
OID_FDB_PORT = '1.3.6.1.2.1.17.4.3.1.2'             # dot1dTpFdbPort

AUTH_PROTOCOLS = {
    'SHA': 'usmHMACSHAAuthProtocol',
    'SHA256': 'usmHMAC192SHA256AuthProtocol',
    'MD5': 'usmHMACMD5AuthProtocol',
}
PRIV_PROTOCOLS = {
    'AES': 'usmAesCfb128Protocol',
    'AES256': 'usmAesCfb256Protocol',
    'DES': 'usmDESPrivProtocol',
}


class DiscoveryError(Exception):
    pass


# ---------- helpers ----------

def ok_target(ip):
    """Only private, unicast, non-link-local IPv4 hosts may be queried."""
    if not isinstance(ip, str):
        return False
    try:
        a = ipaddress.IPv4Address(ip)
    except ValueError:
        return False
    if not a.is_private or a.is_loopback or a.is_link_local or a.is_multicast or a.is_unspecified:
        return False
    return int(ip.split('.')[-1]) not in (0, 255)


def parse_config(data):
    """Validate SNMP credentials from request. Raises ValueError with user-safe message."""
    version = str(data.get('version') or '').strip()

    if version == '2c':
        community = data.get('community')
        if not isinstance(community, str) or not community or len(community) > 64:
            raise ValueError('Community string required (max 64 chars)')
        return {'version': '2c', 'community': community}

    if version == '3':
        username = data.get('username')
        if not isinstance(username, str) or not username or len(username) > 64:
            raise ValueError('SNMPv3 username required')
        auth_key = data.get('auth_key') or ''
        priv_key = data.get('priv_key') or ''
        auth_protocol = data.get('auth_protocol') or 'SHA'
        priv_protocol = data.get('priv_protocol') or 'AES'
        if auth_protocol not in AUTH_PROTOCOLS:
            raise ValueError('Unsupported auth protocol')
        if priv_protocol not in PRIV_PROTOCOLS:
            raise ValueError('Unsupported privacy protocol')
        for key in (auth_key, priv_key):
            if not isinstance(key, str) or (key and not 8 <= len(key) <= 128):
                raise ValueError('SNMPv3 keys must be 8-128 characters')
        if priv_key and not auth_key:
            raise ValueError('Privacy key requires an auth key')
        return {
            'version': '3',
            'username': username,
            'auth_key': auth_key,
            'auth_protocol': auth_protocol,
            'priv_key': priv_key,
            'priv_protocol': priv_protocol,
        }

    raise ValueError('SNMP version must be 2c or 3')


def _proto(name):
    p = getattr(h, name, None)
    if p is None:
        raise DiscoveryError(f'Protocol {name} not supported by installed pysnmp')
    return p


def build_auth(cfg):
    if not SNMP_AVAILABLE:
        raise DiscoveryError(f'pysnmp unavailable: {SNMP_ERROR}')
    if cfg['version'] == '2c':
        return h.CommunityData(cfg['community'], mpModel=1)
    kwargs = {}
    if cfg['auth_key']:
        kwargs['authKey'] = cfg['auth_key']
        kwargs['authProtocol'] = _proto(AUTH_PROTOCOLS[cfg['auth_protocol']])
        if cfg['priv_key']:
            kwargs['privKey'] = cfg['priv_key']
            kwargs['privProtocol'] = _proto(PRIV_PROTOCOLS[cfg['priv_protocol']])
    return h.UsmUserData(cfg['username'], **kwargs)


def _missing(v):
    return v.__class__.__name__ in ('NoSuchObject', 'NoSuchInstance', 'EndOfMibView')


def _text(v):
    if v is None or _missing(v):
        return None
    try:
        return str(v.prettyPrint()).strip() or None
    except Exception:
        return None


def _int(v):
    if v is None or _missing(v):
        return None
    try:
        return int(v)
    except Exception:
        return None


def _octets(v):
    if v is None or _missing(v):
        return None
    try:
        return bytes(v.asOctets())
    except Exception:
        return None


def _suffix(oid, base):
    return oid[len(base) + 1:].split('.') if oid.startswith(base + '.') else None


def classify(descr, services):
    """switch/router/host from sysDescr keywords, then sysServices layer bits."""
    d = (descr or '').lower()
    if 'switch' in d:
        return 'switch'
    if 'router' in d:
        return 'router'
    if services is not None:
        if services & 4:      # layer 3 forwarding
            return 'router'
        if services & 2:      # layer 2 bridging
            return 'switch'
    return 'host'


# ---------- SNMP session ----------

class Session:
    def __init__(self, ip, auth, timeout=2, retries=1):
        self.engine = h.SnmpEngine()
        self.auth = auth
        self.target = h.UdpTransportTarget((ip, 161), timeout=timeout, retries=retries)
        self.ctx = h.ContextData()

    def close(self):
        try:
            self.engine.transportDispatcher.closeDispatcher()
        except Exception:
            pass

    def get(self, *oids):
        it = h.getCmd(
            self.engine, self.auth, self.target, self.ctx,
            *[h.ObjectType(h.ObjectIdentity(o)) for o in oids],
            lookupMib=False,
        )
        err_ind, err_stat, _, binds = next(it)
        if err_ind or err_stat:
            return None
        return {str(b[0]): b[1] for b in binds}

    def walk(self, base, limit=4000):
        out = []
        it = h.nextCmd(
            self.engine, self.auth, self.target, self.ctx,
            h.ObjectType(h.ObjectIdentity(base)),
            lexicographicMode=False,
            lookupMib=False,
        )
        for err_ind, err_stat, _, binds in it:
            if err_ind or err_stat:
                break
            for b in binds:
                out.append((str(b[0]), b[1]))
            if len(out) >= limit:
                break
        return out


def poll_device(ip, auth):
    """Query one device. Returns dict or None if it does not answer SNMP."""
    s = Session(ip, auth)
    try:
        base = s.get(OID_SYS_DESCR, OID_SYS_NAME, OID_SYS_SERVICES)
        if not base:
            return None
        descr = _text(base.get(OID_SYS_DESCR))
        name = _text(base.get(OID_SYS_NAME))
        services = _int(base.get(OID_SYS_SERVICES))
        if descr is None and name is None:
            return None

        neighbors = []   # (ip, source, label)
        arp = []         # (host_ip, mac)
        fdb = {}         # port -> set(mac)

        # LLDP: index = timeMark.localPort.remIndex.addrSubtype.addrLen.addr...
        for oid, _ in s.walk(OID_LLDP_MAN_ADDR):
            p = _suffix(oid, OID_LLDP_MAN_ADDR)
            if p and len(p) >= 9 and p[3] == '1' and p[4] == '4':
                neighbors.append(('.'.join(p[5:9]), 'lldp', f'port {p[1]}'))

        # CDP: index = ifIndex.deviceIndex, value = 4 byte IP
        for oid, val in s.walk(OID_CDP_ADDR):
            p = _suffix(oid, OID_CDP_ADDR)
            raw = _octets(val)
            if p and raw and len(raw) == 4:
                neighbors.append(('.'.join(str(b) for b in raw), 'cdp', f'ifIndex {p[0]}'))

        # ARP: index = ifIndex.a.b.c.d, value = MAC
        for oid, val in s.walk(OID_ARP_MAC):
            p = _suffix(oid, OID_ARP_MAC)
            raw = _octets(val)
            if p and len(p) >= 5 and raw and len(raw) == 6:
                arp.append(('.'.join(p[-4:]), raw.hex()))

        # Bridge FDB: index = MAC (6 numbers), value = bridge port
        for oid, val in s.walk(OID_FDB_PORT):
            p = _suffix(oid, OID_FDB_PORT)
            port = _int(val)
            if p and len(p) == 6 and port:
                try:
                    mac = bytes(int(x) for x in p).hex()
                except ValueError:
                    continue
                fdb.setdefault(port, set()).add(mac)

        return {
            'sys_name': name,
            'sys_descr': descr,
            'type': classify(descr, services),
            'neighbors': neighbors,
            'arp': arp,
            'fdb': fdb,
        }
    finally:
        s.close()


# ---------- crawl ----------

def crawl(seed, auth, progress=None, max_devices=64, max_hosts=500):
    """
    BFS over LLDP/CDP neighbors starting at seed.
    Returns {'devices': {ip: info}, 'links': [(a, b, source, label)], 'snmp_count': n}
    """
    say = progress or (lambda msg: None)

    devices = {}
    links = {}            # (a, b) sorted -> (source, label)
    mac_to_ip = {}
    arp_entries = []      # (source device ip, host ip)
    fdb_tables = {}       # switch ip -> {port: set(mac)}
    visited = set()
    queue = deque([seed])

    def add_link(a, b, source, label=''):
        if a == b:
            return
        key = tuple(sorted((a, b)))
        if key not in links:          # first (highest confidence) source wins
            links[key] = (source, label)

    while queue and len(visited) < max_devices:
        ip = queue.popleft()
        if ip in visited:
            continue
        visited.add(ip)
        say(f'Querying {ip} ({len(visited)} devices)')

        info = poll_device(ip, auth)
        if info is None:
            if ip == seed:
                raise DiscoveryError(
                    f'No SNMP response from {ip}. Check SNMP is enabled, credentials, and that '
                    'this machine can reach UDP 161.'
                )
            devices.setdefault(ip, {'snmp': False})
            continue

        devices[ip] = {
            'snmp': True,
            'type': info['type'],
            'sys_name': info['sys_name'],
            'sys_descr': info['sys_descr'],
        }

        for nip, source, label in info['neighbors']:
            if nip == ip or not ok_target(nip):
                continue
            devices.setdefault(nip, {'snmp': False})
            add_link(ip, nip, source, label)
            if nip not in visited:
                queue.append(nip)

        for hip, mac in info['arp']:
            if hip != ip and ok_target(hip):
                mac_to_ip.setdefault(mac, hip)
                arp_entries.append((ip, hip))

        if info['fdb']:
            fdb_tables[ip] = info['fdb']

    host_budget = max_hosts

    # bridge table: port with exactly one learned MAC = directly attached device
    for sw, ports in fdb_tables.items():
        for port, macs in ports.items():
            if len(macs) != 1:
                continue
            hip = mac_to_ip.get(next(iter(macs)))
            if not hip or hip == sw or not ok_target(hip):
                continue
            if hip not in devices:
                if host_budget <= 0:
                    continue
                host_budget -= 1
                devices[hip] = {'snmp': False}
            add_link(sw, hip, 'fdb', f'port {port}')

    # ARP from routers: only for hosts that have no link yet
    linked = {x for pair in links for x in pair}
    for src, hip in arp_entries:
        if hip not in devices:
            if host_budget <= 0:
                continue
            host_budget -= 1
            devices[hip] = {'snmp': False}
        if hip not in linked and devices.get(src, {}).get('type') == 'router':
            add_link(src, hip, 'arp')
            linked.add(hip)

    return {
        'devices': devices,
        'links': [(a, b, src, label) for (a, b), (src, label) in links.items()],
        'snmp_count': sum(1 for d in devices.values() if d.get('snmp')),
    }