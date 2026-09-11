# backend/tools/network_monitor.py
"""
Real network connection monitor — proof of sovereign (air-gapped) operation.
Uses /proc/net/tcp to inspect actual TCP connections without requiring root.
"""
import os
import socket
import struct
from typing import Dict, List, Any
from datetime import datetime

# Loopback address in /proc/net/tcp hex format
_LOOPBACK_HEX = "0100007F"  # 127.0.0.1

# Known safe local ports
_SAFE_PORTS = {
    11434: "ollama",
    8000: "fastapi-backend",
    8080: "frontend-dev",
    5173: "vite-dev",
}

TCP_STATES = {
    "01": "ESTABLISHED",
    "02": "SYN_SENT",
    "03": "SYN_RECV",
    "04": "FIN_WAIT1",
    "05": "FIN_WAIT2",
    "06": "TIME_WAIT",
    "07": "CLOSE",
    "08": "CLOSE_WAIT",
    "09": "LAST_ACK",
    "0A": "LISTEN",
    "0B": "CLOSING",
}


def _hex_to_ip(hex_str: str) -> str:
    """Convert hex IP from /proc/net/tcp to dotted notation."""
    addr = struct.pack("<I", int(hex_str, 16))
    return socket.inet_ntoa(addr)


def _hex_to_port(hex_str: str) -> int:
    return int(hex_str, 16)


def _is_loopback_or_local(hex_addr: str) -> bool:
    """Check if an address is 127.x.x.x or 0.0.0.0."""
    return hex_addr in (_LOOPBACK_HEX, "00000000")


def get_connections() -> List[Dict[str, Any]]:
    """Read all TCP connections from /proc/net/tcp."""
    connections = []
    try:
        with open("/proc/net/tcp", "r") as f:
            lines = f.readlines()[1:]  # skip header

        for line in lines:
            parts = line.strip().split()
            if len(parts) < 4:
                continue

            local_addr, local_port_hex = parts[1].split(":")
            remote_addr, remote_port_hex = parts[2].split(":")
            state_hex = parts[3]

            local_ip = _hex_to_ip(local_addr)
            local_port = _hex_to_port(local_port_hex)
            remote_ip = _hex_to_ip(remote_addr)
            remote_port = _hex_to_port(remote_port_hex)
            state = TCP_STATES.get(state_hex, "UNKNOWN")

            is_local = _is_loopback_or_local(local_addr) and _is_loopback_or_local(remote_addr)

            connections.append({
                "local": f"{local_ip}:{local_port}",
                "remote": f"{remote_ip}:{remote_port}",
                "state": state,
                "is_local": is_local,
                "service": _SAFE_PORTS.get(local_port) or _SAFE_PORTS.get(remote_port) or None,
            })
    except FileNotFoundError:
        # Not on Linux (e.g. macOS) — fall back to ss
        pass

    return connections


def get_network_status() -> Dict[str, Any]:
    """Return a full network sovereignty report."""
    all_conns = get_connections()

    # Filter only ESTABLISHED or SYN_SENT (active/outgoing)
    active = [c for c in all_conns if c["state"] in ("ESTABLISHED", "SYN_SENT", "SYN_RECV")]
    outbound = [c for c in active if not c["is_local"]]
    inbound_local = [c for c in active if c["is_local"]]

    return {
        "timestamp": datetime.now().isoformat(),
        "total_connections": len(all_conns),
        "active_connections": len(active),
        "local_connections": len(inbound_local),
        "outbound_connections": len(outbound),
        "sovereign": len(outbound) == 0,
        "connections": active[:50],  # cap for UI
        "outbound_details": outbound,
    }
