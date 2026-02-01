#!/bin/bash
# Start the Research Agents Dashboard

cd "$(dirname "$0")"

# Kill any existing server on port 3000
lsof -ti :3000 | xargs kill 2>/dev/null

# Start the server with environment variables
echo "🔬 Starting Research Agents Dashboard..."
node src/web/server.js
