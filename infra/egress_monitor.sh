#!/usr/bin/env bash
# infra/egress_monitor.sh
set -eo pipefail

# Ensure script is run as root
if [ "$EUID" -ne 0 ]; then
    echo "[-] Error: Please run as root: sudo ./infra/egress_monitor.sh"
    exit 1
fi

INTERFACE=$(ip route | grep default | awk '{print $5}' | head -n1)
if [ -z "$INTERFACE" ]; then
    INTERFACE="any"
fi

echo "[+] Starting Sovereign Egress Monitor on interface: $INTERFACE"
echo "[+] Whitelisted local ranges: 127.0.0.1, 192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12"
echo ""

VIOLATIONS_LOG="/tmp/egress_violations.log"
LATEST_JSON="/tmp/latest_egress.json"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Egress monitor started on $INTERFACE" >> "$VIOLATIONS_LOG"
echo "{\"timestamp\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\", \"event\": \"monitor_started\", \"interface\": \"$INTERFACE\"}" > "$LATEST_JSON"

# Filter: capture outbound traffic that is NOT to loopback or RFC1918 private subnets
FILTER="ip and not dst 127.0.0.1 and not dst net 192.168.0.0/16 and not dst net 10.0.0.0/8 and not dst net 172.16.0.0/12"

tcpdump -i "$INTERFACE" -nn -l $FILTER | while IFS= read -r line; do
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "[$TIMESTAMP] EGRESS DETECTED: $line" >> "$VIOLATIONS_LOG"
    escaped_line=$(echo "$line" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')
    echo "{\"timestamp\": \"$TIMESTAMP\", \"violation\": \"$escaped_line\"}" > "$LATEST_JSON"
    echo "[$TIMESTAMP] \u26a0 EGRESS VIOLATION: $line"
done