#!/usr/bin/env bash
# Quickstart script for Meta Project Aria Streaming Bridge (Hotspot / Knight Hacks)
DEVICE_IP="${1:-10.149.207.241}"

echo "=========================================================="
echo "  Starting Meta Project Aria Bridge (Ultra-Smooth Hotspot)"
echo "  Target Aria Glasses IP: $DEVICE_IP"
echo "=========================================================="

# Activate virtualenv if available
if [ -f "/home/kapar/aria-venv/bin/activate" ]; then
    source /home/kapar/aria-venv/bin/activate
elif [ -f ".venv/bin/activate" ]; then
    source .venv/bin/activate
fi

python aria_bridge.py --mode aria --interface wifi --device-ip "$DEVICE_IP" --hotspot
