# Finds the IP Webcam phone on the Pi's current network, so a changed camera address
# doesn't need editing by hand. Checks every address on the Pi's Wi-Fi subnet for an
# IP Webcam answer on port 8080 (/shot.jpg returning a JPEG). Takes a few seconds.
import json, socket, subprocess, ipaddress, urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

CONFIG = Path(__file__).resolve().parent.parent / 'config.json'
PORT = 8080


def is_camera(addr, timeout=0.8):
    try:
        with urllib.request.urlopen(f'http://{addr}/shot.jpg', timeout=timeout) as r:
            return r.headers.get_content_type() == 'image/jpeg' and r.read(3)[:2] == b'\xff\xd8'
    except Exception:
        return False


def my_networks():
    """IPv4 networks the Pi is on right now (Wi-Fi first)."""
    out = subprocess.run(['ip', '-4', '-o', 'addr', 'show'], capture_output=True, text=True).stdout
    nets = []
    for line in out.splitlines():
        parts = line.split()
        dev, cidr = parts[1], parts[3]
        if dev == 'lo':
            continue
        iface = ipaddress.ip_interface(cidr)
        net = iface.network
        if net.prefixlen < 22:                 # very big network (e.g. school Wi-Fi): only scan nearby
            net = ipaddress.ip_network(f'{iface.ip}/24', strict=False)
        nets.append((0 if dev.startswith('wl') else 1, net, iface.ip))
    return [(n, ip) for _, n, ip in sorted(nets)]


def find_camera(exclude=()):
    """Returns 'ip:8080' of the first IP Webcam found, or None."""
    for net, mine in my_networks():
        hosts = [str(h) for h in net.hosts() if h != mine and str(h) not in exclude]
        with ThreadPoolExecutor(max_workers=64) as pool:
            for host, ok in zip(hosts, pool.map(lambda h: is_camera(f'{h}:{PORT}'), hosts)):
                if ok:
                    return f'{host}:{PORT}'
    return None


def save_camera(addr):
    try:
        cfg = json.load(open(CONFIG))
    except FileNotFoundError:
        cfg = {}
    if cfg.get('camera') != addr:
        cfg['camera'] = addr
        json.dump(cfg, open(CONFIG, 'w'), indent=2)
        return True
    return False


if __name__ == '__main__':
    import sys
    addr = find_camera()
    if not addr:
        sys.exit('No IP Webcam found. Is the phone on the same Wi-Fi as the Pi, with "Start server" on?')
    changed = save_camera(addr)
    print(f'Camera found at {addr}' + (' (saved to config.json)' if changed else ' (already in config.json)'))
