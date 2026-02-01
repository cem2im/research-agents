#!/bin/bash

# Research Agents - Install Shell Aliases

SHELL_RC=""
if [ -f "$HOME/.zshrc" ]; then
    SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
    SHELL_RC="$HOME/.bashrc"
fi

if [ -z "$SHELL_RC" ]; then
    echo "Could not find .zshrc or .bashrc"
    exit 1
fi

# Check if aliases already exist
if grep -q "# Research Agents aliases" "$SHELL_RC"; then
    echo "Aliases already installed in $SHELL_RC"
    exit 0
fi

cat >> "$SHELL_RC" << 'EOF'

# Research Agents aliases
alias research="cd ~/research-agents && node src/cli.js"
alias rs="cd ~/research-agents && node src/cli.js scout"
alias rp="cd ~/research-agents && node src/cli.js pipeline"
alias rr="cd ~/research-agents && node src/cli.js report"
alias rc="cd ~/research-agents && node src/cli.js chat"
alias rm-memory="cd ~/research-agents && node src/cli.js memory"
alias rm-feedback="cd ~/research-agents && node src/cli.js feedback"
alias rm-schedule="cd ~/research-agents && node src/cli.js schedule"

# Quick functions
rsearch() { cd ~/research-agents && node src/cli.js scout -q "$*"; }
rmemo() { cd ~/research-agents && node src/cli.js memory -a -t "$1" -m "$2" -c "${3:-insight}" -i "${4:-normal}"; }
EOF

echo "✅ Aliases installed in $SHELL_RC"
echo ""
echo "Run 'source $SHELL_RC' or open a new terminal to use them."
echo ""
echo "Available aliases:"
echo "  research    - Main CLI"
echo "  rs          - Scout (search)"
echo "  rp          - Pipeline"
echo "  rr          - Report"
echo "  rc          - Chat"
echo "  rm-memory   - Memory management"
echo "  rm-feedback - Feedback"
echo "  rm-schedule - View schedule"
echo ""
echo "Quick functions:"
echo "  rsearch <query>           - Quick search"
echo "  rmemo \"title\" \"content\"   - Quick add memory"
