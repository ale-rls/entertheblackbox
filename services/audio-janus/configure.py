"""Render only the required Janus plugin/transport config, then replace this process."""
import ipaddress
import os
from pathlib import Path
import re
import secrets


def render(address, pin, admin_key=None):
    address = str(ipaddress.IPv4Address(address))
    if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", pin):
        raise ValueError("JANUS_LISTENER_PIN must contain 8–64 letters, digits or hyphens")
    admin_key = admin_key or secrets.token_hex(32)
    if not re.fullmatch(r"[A-Za-z0-9-]{32,128}", admin_key):
        raise ValueError("JANUS_ADMIN_KEY must contain 32–128 letters, digits or hyphens")
    return {
        "janus.jcfg": f'''general: {{
 configs_folder = "/run/janus"
 plugins_folder = "/opt/janus/lib/janus/plugins"
 transports_folder = "/opt/janus/lib/janus/transports"
 debug_level = 4
 session_timeout = 120
}}
media: {{ rtp_port_range = "20000-20200" }}
nat: {{ nat_1_1_mapping = "{address}" }}
''',
        "janus.transport.http.jcfg": '''general: {
 json = "compact"
 base_path = "/janus"
 http = true
 port = 8088
 https = false
}
admin: { admin_http = false admin_https = false }
''',
        "janus.plugin.streaming.jcfg": f'''general: {{ admin_key = "{admin_key}" }}
blackbox: {{
 type = "rtp"
 id = 1
 description = "Blackbox Janus trial"
 is_private = true
 secret = "{admin_key}"
 pin = "{pin}"
 audio = true
 video = false
 audioport = 5002
 audiopt = 111
 audiocodec = "opus"
 audiofmtp = "stereo=1;sprop-stereo=1"
}}
''',
    }


if __name__ == "__main__":
    configs = render(os.environ["JANUS_PUBLIC_IP"], os.environ["JANUS_LISTENER_PIN"], os.environ.get("JANUS_ADMIN_KEY"))
    for name, content in configs.items():
        path = Path("/run/janus") / name
        path.write_text(content)
        path.chmod(0o600)
    os.execv("/opt/janus/bin/janus", ["janus", "-F", "/run/janus"])
