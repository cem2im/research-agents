#!/bin/bash

# Research Agents - Scheduler Uninstall Script

PLIST_NAME="com.research-agents.daily"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo "🔬 Research Agents Scheduler Uninstall"
echo "======================================="

if [ -f "$PLIST_DEST" ]; then
    echo "📤 Unloading launch agent..."
    launchctl unload "$PLIST_DEST" 2>/dev/null || true

    echo "🗑️  Removing plist file..."
    rm "$PLIST_DEST"

    echo "✅ Scheduler removed successfully!"
else
    echo "ℹ️  Scheduler not installed"
fi
