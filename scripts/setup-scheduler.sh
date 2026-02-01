#!/bin/bash

# Research Agents - Scheduler Setup Script
# Run this script to enable daily automated research scans

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PLIST_NAME="com.research-agents.daily"
PLIST_SRC="$PROJECT_DIR/config/$PLIST_NAME.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo "🔬 Research Agents Scheduler Setup"
echo "==================================="

# Check if plist source exists
if [ ! -f "$PLIST_SRC" ]; then
    echo "❌ Error: plist file not found at $PLIST_SRC"
    exit 1
fi

# Create LaunchAgents directory if it doesn't exist
mkdir -p "$HOME/Library/LaunchAgents"

# Create logs directory
mkdir -p "$PROJECT_DIR/logs"

# Unload existing job if present
if launchctl list | grep -q "$PLIST_NAME"; then
    echo "📤 Unloading existing job..."
    launchctl unload "$PLIST_DEST" 2>/dev/null || true
fi

# Copy plist to LaunchAgents
echo "📋 Installing launch agent..."
cp "$PLIST_SRC" "$PLIST_DEST"

# Load the job
echo "🚀 Loading launch agent..."
launchctl load "$PLIST_DEST"

# Verify
if launchctl list | grep -q "$PLIST_NAME"; then
    echo "✅ Scheduler installed successfully!"
    echo ""
    echo "The research pipeline will run daily at 6:00 AM."
    echo ""
    echo "Commands:"
    echo "  View status:   launchctl list | grep research-agents"
    echo "  Run now:       launchctl start $PLIST_NAME"
    echo "  View logs:     tail -f $PROJECT_DIR/logs/daily.log"
    echo "  Disable:       launchctl unload $PLIST_DEST"
else
    echo "❌ Failed to load scheduler"
    exit 1
fi
