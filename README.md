# 🔬 Research Agents

AI-powered research discovery and hypothesis generation system for physician-scientists and researchers.

## Features

- **Multi-Source Paper Discovery**: Search PubMed, Semantic Scholar, and ClinicalTrials.gov
- **Domain-Based Organization**: 5 configurable research domains
- **AI Pipeline**: Automatically generate and validate research hypotheses
- **Web Dashboard**: Beautiful, mobile-friendly interface
- **Custom Keywords**: Add your own research domains and keywords
- **Feedback System**: Rate discoveries and hypotheses to improve relevance

## Research Domains

| Day | Domain | Focus |
|-----|--------|-------|
| Monday | 💪 Myostatin | GLP-1, muscle preservation, sarcopenia |
| Tuesday | 🤖 Surgical AI | Computer vision, endoscopy AI |
| Wednesday | 🏥 Bariatric & MASH | Metabolic surgery, MASLD |
| Thursday | 🔮 Digital Twins | Computational models, personalized medicine |
| Friday | 🧠 AI in Medicine | Clinical AI, deep learning diagnosis |

## Quick Start

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/research-agents.git
cd research-agents
npm install

# Add your API key to .env
echo "ANTHROPIC_API_KEY=your-key-here" >> .env

# Start the dashboard
npm run web
```

Open http://localhost:3000 (password: `research2024`)

## Dashboard Features

- **▶ Run**: Search papers from selected domains
- **Discoveries**: View and select papers for analysis
- **Hypotheses**: AI-generated research hypotheses
- **Projects**: Designed research projects
- **Memory**: Save insights and notes
- **Settings**: Add custom domains and keywords

## Deploy

See [DEPLOY.md](DEPLOY.md) for deployment instructions.

### Quick Deploy to Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app)

## Tech Stack

- Node.js + Express
- sql.js (in-browser SQLite)
- Anthropic Claude API
- PubMed E-utilities API

## License

MIT
