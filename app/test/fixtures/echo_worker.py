# Stand-in Python helper for pyworker tests: answers like the real ones, touches no hardware.
import sys, json, time
print(json.dumps({'event': 'ready'}), flush=True)
for line in sys.stdin:
    msg = json.loads(line)
    if msg['cmd'] == 'echo':
        print(json.dumps({'id': msg['id'], 'ok': True, 'value': msg.get('value')}), flush=True)
    elif msg['cmd'] == 'fail':
        print(json.dumps({'id': msg['id'], 'ok': False, 'error': 'boom'}), flush=True)
    elif msg['cmd'] == 'slow':
        time.sleep(0.3)
        print(json.dumps({'id': msg['id'], 'ok': True}), flush=True)
    elif msg['cmd'] == 'die':
        sys.exit(3)
