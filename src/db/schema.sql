-- Discoveries from Scout
CREATE TABLE IF NOT EXISTS discoveries (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,  -- 'pubmed', 'semantic_scholar', 'clinical_trials'
    external_id TEXT,      -- PMID, DOI, NCT number
    title TEXT NOT NULL,
    abstract TEXT,
    authors TEXT,          -- JSON array
    publication_date TEXT,
    journal TEXT,
    url TEXT,
    citation_count INTEGER DEFAULT 0,
    influence_score REAL,
    mesh_terms TEXT,       -- JSON array
    keywords TEXT,         -- JSON array
    relevance_score REAL,  -- Triage score 0-100
    priority TEXT,         -- 'high', 'medium', 'low'
    processed BOOLEAN DEFAULT FALSE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    metadata TEXT          -- JSON for extra fields
);

-- Hypotheses from Oracle
CREATE TABLE IF NOT EXISTS hypotheses (
    id TEXT PRIMARY KEY,
    discovery_id TEXT REFERENCES discoveries(id),
    title TEXT NOT NULL,
    statement TEXT NOT NULL,
    rationale TEXT,
    assumptions TEXT,      -- JSON array
    testable_predictions TEXT,  -- JSON array
    required_evidence TEXT,     -- JSON array
    potential_impact TEXT,
    confidence_score REAL,
    status TEXT DEFAULT 'generated',  -- 'generated', 'validating', 'validated', 'rejected', 'project'
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Validations from Sage
CREATE TABLE IF NOT EXISTS validations (
    id TEXT PRIMARY KEY,
    hypothesis_id TEXT REFERENCES hypotheses(id),
    supporting_evidence TEXT,   -- JSON array of {source, summary, strength}
    contradicting_evidence TEXT, -- JSON array
    gaps_identified TEXT,       -- JSON array
    key_papers TEXT,            -- JSON array of PMIDs/DOIs
    confidence_level TEXT,      -- 'high', 'medium', 'low', 'insufficient'
    recommendation TEXT,        -- 'pursue', 'modify', 'reject', 'needs_more_research'
    summary TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Projects from Architect
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    hypothesis_id TEXT REFERENCES hypotheses(id),
    title TEXT NOT NULL,
    objective TEXT,
    methodology TEXT,
    milestones TEXT,           -- JSON array
    resources_required TEXT,   -- JSON array
    timeline_weeks INTEGER,
    estimated_cost_usd INTEGER,
    output_type TEXT,          -- 'grant', 'trial', 'product', 'publication'
    status TEXT DEFAULT 'drafted',
    feasibility_score REAL,
    risk_assessment TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Red team reviews from Adversary
CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    critical_questions TEXT,   -- JSON array
    weaknesses TEXT,           -- JSON array
    risks TEXT,                -- JSON array
    competitor_threats TEXT,
    regulatory_concerns TEXT,
    recommended_mitigations TEXT,  -- JSON array
    overall_assessment TEXT,   -- 'proceed', 'revise', 'pause', 'abandon'
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Activity log
CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    summary TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Research domains for filtering
CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    keywords TEXT,             -- JSON array
    mesh_terms TEXT,           -- JSON array
    emoji TEXT DEFAULT '🔬',
    active BOOLEAN DEFAULT TRUE
);

-- Insert default domains
INSERT OR IGNORE INTO domains (id, name, keywords, mesh_terms, emoji) VALUES
('myostatin', 'Myostatin & Muscle Preservation',
 '["myostatin", "GDF-8", "muscle wasting", "sarcopenia", "GLP-1", "muscle preservation", "follistatin", "activin", "cachexia"]',
 '["Myostatin", "Muscular Atrophy", "GLP-1 Receptor Agonists", "Sarcopenia"]',
 '💪'),

('surgical_ai', 'Surgical AI & Computer Vision',
 '["surgical AI", "computer vision surgery", "phase detection", "surgical coaching", "endoscopy AI", "intraoperative", "laparoscopic AI", "robotic surgery AI"]',
 '["Surgery, Computer-Assisted", "Artificial Intelligence", "Endoscopy"]',
 '🤖'),

('bariatric', 'Bariatric, Metabolic & MASH',
 '["bariatric", "ESG", "endoscopic sleeve", "obesity endoscopy", "intragastric balloon", "metabolic surgery", "MASH", "MASLD", "metabolic associated steatotic liver disease", "NAFLD"]',
 '["Bariatric Surgery", "Obesity", "Gastroplasty", "Fatty Liver"]',
 '🏥'),

('digital_twin', 'Digital Twins & Cardiometabolic',
 '["digital twin", "computational model", "patient simulation", "cardiometabolic", "personalized medicine", "in silico model"]',
 '["Computer Simulation", "Precision Medicine", "Cardiovascular Diseases"]',
 '🔮'),

('ai_medicine', 'AI in Medicine',
 '["artificial intelligence medicine", "machine learning healthcare", "deep learning diagnosis", "clinical AI", "medical AI", "healthcare AI"]',
 '["Artificial Intelligence", "Machine Learning", "Deep Learning", "Diagnosis, Computer-Assisted"]',
 '🧠');

-- User feedback on hypotheses, projects, discoveries
CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,  -- 'discovery', 'hypothesis', 'project', 'validation'
    entity_id TEXT NOT NULL,
    rating INTEGER,             -- 1-5 stars, or -1 (thumbs down), 1 (thumbs up)
    useful BOOLEAN,             -- Quick thumbs up/down
    notes TEXT,                 -- User's notes/comments
    tags TEXT,                  -- JSON array of user tags
    action_taken TEXT,          -- What the user did with this: 'pursued', 'ignored', 'modified', 'shared'
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Manual memory entries - user's own insights
CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,     -- 'insight', 'preference', 'context', 'correction', 'competitor', 'strategy'
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    keywords TEXT,              -- JSON array for searchability
    related_entities TEXT,      -- JSON array of {type, id} for linked items
    importance TEXT DEFAULT 'normal',  -- 'critical', 'high', 'normal', 'low'
    active BOOLEAN DEFAULT TRUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Learning preferences derived from feedback
CREATE TABLE IF NOT EXISTS preferences (
    id TEXT PRIMARY KEY,
    preference_type TEXT NOT NULL,  -- 'topic_interest', 'methodology', 'journal_trust', 'author_follow'
    value TEXT NOT NULL,
    weight REAL DEFAULT 1.0,        -- How strongly to weight this preference
    learned_from TEXT,              -- JSON array of feedback IDs that informed this
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Full text cache for articles
CREATE TABLE IF NOT EXISTS full_texts (
    id TEXT PRIMARY KEY,
    discovery_id TEXT REFERENCES discoveries(id),
    pmcid TEXT,
    full_text TEXT,
    sections TEXT,              -- JSON array of {title, text}
    fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discoveries_source ON discoveries(source);
CREATE INDEX IF NOT EXISTS idx_discoveries_priority ON discoveries(priority);
CREATE INDEX IF NOT EXISTS idx_discoveries_processed ON discoveries(processed);
CREATE INDEX IF NOT EXISTS idx_hypotheses_status ON hypotheses(status);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_feedback_entity ON feedback(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_memory_category ON memory(category);
CREATE INDEX IF NOT EXISTS idx_memory_active ON memory(active);
CREATE INDEX IF NOT EXISTS idx_preferences_type ON preferences(preference_type);

-- ============================================
-- RESEARCH PROJECT TRACKER MODULE
-- ============================================

-- Project Groups (Categories)
CREATE TABLE IF NOT EXISTS project_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3b82f6',
    icon TEXT DEFAULT '📁',
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Tracked Research Projects
CREATE TABLE IF NOT EXISTS tracked_projects (
    id TEXT PRIMARY KEY,
    group_id TEXT REFERENCES project_groups(id),
    title TEXT NOT NULL,
    description TEXT,
    project_type TEXT,          -- 'clinical_trial', 'grant', 'case_report', 'systematic_review', 'device', 'publication', 'other'
    status TEXT DEFAULT 'active',  -- 'draft', 'active', 'paused', 'completed', 'archived'
    priority TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
    current_milestone_id TEXT,
    start_date TEXT,
    target_date TEXT,
    completed_date TEXT,
    tags TEXT,                  -- JSON array
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Project Milestones
CREATE TABLE IF NOT EXISTS tracked_milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES tracked_projects(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'pending',  -- 'pending', 'in_progress', 'completed', 'blocked', 'skipped'
    start_date TEXT,
    due_date TEXT,
    completed_date TEXT,
    estimated_days INTEGER,
    actual_days INTEGER,
    dependencies TEXT,          -- JSON array of milestone IDs
    blockers TEXT,              -- JSON array of blocker descriptions
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Milestone Assignees (multiple people per milestone)
CREATE TABLE IF NOT EXISTS milestone_assignees (
    id TEXT PRIMARY KEY,
    milestone_id TEXT NOT NULL REFERENCES tracked_milestones(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,                     -- WhatsApp phone number (with country code, e.g., +905551234567)
    role TEXT DEFAULT 'assignee',  -- 'owner', 'assignee', 'reviewer', 'approver'
    notified_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Email Reminders
CREATE TABLE IF NOT EXISTS project_reminders (
    id TEXT PRIMARY KEY,
    milestone_id TEXT NOT NULL REFERENCES tracked_milestones(id) ON DELETE CASCADE,
    recipient_emails TEXT NOT NULL,  -- JSON array
    subject TEXT,
    message TEXT,
    scheduled_at TEXT,
    sent_at TEXT,
    status TEXT DEFAULT 'pending',  -- 'pending', 'sent', 'failed'
    error TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Scheduled Reminders (for automatic weekly/daily reminders)
CREATE TABLE IF NOT EXISTS scheduled_reminders (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES tracked_projects(id) ON DELETE CASCADE,
    milestone_id TEXT REFERENCES tracked_milestones(id) ON DELETE CASCADE,
    schedule_type TEXT NOT NULL,  -- 'weekly', 'daily', 'before_due'
    schedule_day INTEGER,         -- 0=Sunday, 1=Monday, etc. (for weekly)
    schedule_time TEXT DEFAULT '09:00',  -- HH:MM
    days_before_due INTEGER,      -- For 'before_due' type
    last_sent_at TEXT,
    active BOOLEAN DEFAULT TRUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Incoming WhatsApp Messages
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id TEXT PRIMARY KEY,
    from_phone TEXT NOT NULL,
    from_name TEXT,
    message TEXT NOT NULL,
    project_id TEXT REFERENCES tracked_projects(id),
    milestone_id TEXT REFERENCES tracked_milestones(id),
    wa_message_id TEXT,           -- WhatsApp message ID
    status TEXT DEFAULT 'received',  -- 'received', 'processed', 'replied'
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_phone ON whatsapp_messages(from_phone);
CREATE INDEX IF NOT EXISTS idx_scheduled_reminders_active ON scheduled_reminders(active);

-- Project Activity Log
CREATE TABLE IF NOT EXISTS project_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES tracked_projects(id) ON DELETE CASCADE,
    milestone_id TEXT REFERENCES tracked_milestones(id) ON DELETE SET NULL,
    action TEXT NOT NULL,       -- 'created', 'updated', 'milestone_completed', 'reminder_sent', 'status_changed'
    details TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for project tracker
CREATE INDEX IF NOT EXISTS idx_tracked_projects_group ON tracked_projects(group_id);
CREATE INDEX IF NOT EXISTS idx_tracked_projects_status ON tracked_projects(status);
CREATE INDEX IF NOT EXISTS idx_tracked_milestones_project ON tracked_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_tracked_milestones_status ON tracked_milestones(status);
CREATE INDEX IF NOT EXISTS idx_milestone_assignees_milestone ON milestone_assignees(milestone_id);
CREATE INDEX IF NOT EXISTS idx_project_reminders_milestone ON project_reminders(milestone_id);
CREATE INDEX IF NOT EXISTS idx_project_activity_project ON project_activity(project_id);
