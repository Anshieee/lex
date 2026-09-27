#!/usr/bin/env bash
# infra/egress_monitor.sh
# Sovereign Egress Monitor — Live audit of zero external network calls
# Requires root privileges to bind tcpdump to network interfaces.
# Run with: sudo ./infra/egress_monitor.sh

set -euo pipefail

# Detect primary external interface
INTERFACE=$(ip route | grep default | awk '{print $5}')
if [ -z "$INTERFACE" ]; then
    INTERFACE="any"
fi

echo "Starting Sovereign Egress Monitor on interface: $INTERFACE"
echo "Monitoring for outbound connections to non-local networks..."
echo "Whitelisted local ranges: 127.0.0.1, 192.168.0.0/16, 10.0.0.0/8"
echo ""

# Log file for violations
VIOLATIONS_LOG="/tmp/egress_violations.log"
LATEST_JSON="/tmp/latest_egress.json"

# Initialize log files
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Egress monitor started on $INTERFACE" >> "$VIOLATIONS_LOG"
echo "{\"timestamp\": \"$(date -u +"%Y-%m-%dT%H:%M:%SZ")\", \"event\": \"monitor_started\", \"interface\": \"$INTERFACE\"}" > "$LATEST_JSON"

# tcpdump filter: capture outbound packets NOT destined for local ranges
# -i: interface
# -nn: no DNS/port resolution
# -l: line-buffered output
# dst not (local ranges): filter out whitelisted destinations
sudo tcpdump -i "$INTERFACE" -nn -l "dst not (127.0.0.1 or 192.168.0.0/16 or 10.0.0.0/8)" 2>/dev/null |
while IFS= read -r line; do
    TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    # Log to structured file
    echo "[$TIMESTAMP] EGRESS DETECTED: $line" >> "$VIOLATIONS_LOG"

    # Write latest violation as JSON for frontend polling
    # Escape JSON special chars in the line
    escaped_line=$(echo "$line" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')
    echo "{\"timestamp\": \"$TIMESTAMP\", \"violation\": \"$escaped_line\"}" > "$LATEST_JSON"

    # Also print to stdout for visibility
    echo "[$TIMESTAMP] ⚠ EGRESS VIOLATION: $line"
done