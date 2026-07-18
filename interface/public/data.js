// Steadymade AI OS — system model
// Static operating knowledge (departments, roles, access rules, workflows).
// File-level data (docs, mtimes, descriptions) is loaded live from /api/system
// and merged with this model in app.js.

const DEPARTMENTS = [
  { id: 'core',      name: 'Core',                 note: 'Central orchestration' },
  { id: 'strategy',  name: 'Strategy',             note: 'Positioning, market fit, commercial discipline' },
  { id: 'knowledge', name: 'Knowledge',            note: 'Retrieval, governance, operating profile' },
  { id: 'marketing', name: 'Marketing',            note: 'Campaigns, content, review, cadence' },
  { id: 'sales',     name: 'Sales / Offers',       note: 'Proposals, scopes, service modules' },
  { id: 'delivery',  name: 'Delivery',             note: 'Pilot plans, rollout, status, handover' },
  { id: 'creative',  name: 'Creative Production',  note: 'Visual concepts, prompts, generation' },
  { id: 'it',        name: 'IT',                   note: 'Security audits, specifications, architecture' },
];

// Folder keys map to real directories under knowledge/ (Stage 1 contract:
// company/<domain>, personal, inbox). "company/company_handbook_SSOT" is the SSOT area of this project. "personal" is private per-user knowledge and is
// intentionally not listed in any agent access set.
const AGENTS = [
  {
    id: 'danny', name: 'Danny', title: 'Orchestrator', dept: 'core',
    role: 'Central interface. Routes requests, coordinates agents, retrieves context, manages review and approval.',
    promptPath: 'CLAUDE.md',
    status: 'active',
    access: ['inbox', 'company/strategy', 'company/company_handbook_SSOT', 'company/commercial', 'company/marketing'],
    workflows: ['strategy_review', 'knowledge_retrieval', 'knowledge_intake', 'setup_profile', 'marketing_content', 'proposal', 'delivery', 'document', 'creative_image', 'calendar_planning', 'security_audit', 'dev_spec', 'multi_department'],
    responsibilities: ['Understand user intent', 'Classify the workflow', 'Route to specialist agents', 'Create concise task briefs', 'Apply strategy gates', 'Synthesize final results'],
    inputs: ['User requests', 'Agent outputs', 'Operating profile'],
    outputs: ['Task briefs', 'Synthesized answers', 'Approval requests'],
    noGo: ['Doing all specialist work alone', 'Claiming tool execution that did not happen', 'Marking artifacts approved without explicit user approval'],
  },
  {
    id: 'atlas', name: 'Atlas', title: 'Strategic Advisor', dept: 'strategy',
    role: 'Strategy gate, positioning, market fit, commercial discipline.',
    promptPath: '.claude/agents/atlas-strategic-advisor.md',
    status: 'active',
    access: ['company/strategy', 'company/company_handbook_SSOT', 'company/commercial', 'company/marketing'],
    workflows: ['strategy_review', 'proposal', 'knowledge_retrieval', 'knowledge_intake', 'multi_department'],
    responsibilities: ['Strategy gate decisions', 'Positioning and target customers', 'Offer architecture', 'Market fit DACH + Australia', 'Major claims review'],
    inputs: ['Ideas, offers, claims', 'Drafts with strategic weight'],
    outputs: ['Strategic Fit rating', 'Risk rating', 'Go / Revise / Stop'],
    noGo: ['Generic business coaching', 'Motivational advice', 'Approving inflated ROI promises'],
  },
  {
    id: 'nora', name: 'Nora', title: 'Knowledge Agent', dept: 'knowledge',
    role: 'Retrieves relevant context from Markdown knowledge.',
    promptPath: '.claude/agents/nora-knowledge-agent.md',
    status: 'active',
    access: ['inbox', 'company/strategy', 'company/company_handbook_SSOT', 'company/commercial', 'company/marketing'],
    workflows: ['strategy_review', 'knowledge_retrieval', 'marketing_content', 'proposal', 'delivery', 'document', 'creative_image', 'security_audit', 'dev_spec', 'multi_department'],
    responsibilities: ['Source-grounded retrieval', 'Context packaging for other agents', 'Brand rules and service descriptions', 'Prompt library access'],
    inputs: ['Retrieval briefs from Danny'],
    outputs: ['Context packages', 'Source references'],
    noGo: ['Inventing sources', 'Dumping the full knowledge base into briefs'],
  },
  {
    id: 'mara', name: 'Mara', title: 'Knowledge Governance', dept: 'knowledge',
    role: 'Classifies, curates and updates operating knowledge.',
    promptPath: '.claude/agents/mara-setup-agent.md',
    status: 'active',
    access: ['inbox', 'company/strategy', 'company/company_handbook_SSOT', 'company/commercial', 'company/marketing'],
    workflows: ['knowledge_intake'],
    responsibilities: ['Knowledge intake and classification', 'Duplicate and contradiction detection', 'Operating profile updates', 'Canonical source logic'],
    inputs: ['New material, messy notes'],
    outputs: ['Classified knowledge', 'Update proposals'],
    noGo: ['Silently overwriting canonical sources'],
  },
  {
    id: 'ada', name: 'Ada', title: 'Marketing & Communications', dept: 'marketing',
    role: 'Campaign logic, content pillars, writing and publication planning.',
    promptPath: '.claude/agents/ada-marketing-strategy.md',
    status: 'active',
    access: ['company/strategy', 'company/company_handbook_SSOT', 'company/marketing', 'company/commercial'],
    workflows: ['marketing_content', 'calendar_planning'],
    responsibilities: ['Campaign architecture', 'Content pillars and messaging frameworks', 'Copywriting (content-writing skill)', 'Publication planning (publication-calendar skill)'],
    inputs: ['Campaign goals', 'Strategy context', 'Context from Nora'],
    outputs: ['Campaign concepts', 'Content plans', 'Draft copy', 'Editorial calendars'],
    noGo: ['AI hype', 'Fake urgency', 'Generic transformation language', 'Scheduling unapproved artifacts as published'],
  },
  {
    id: 'rosa', name: 'Rosa', title: 'Review', dept: 'marketing',
    role: 'Editorial review, AI-slop removal, claim checks.',
    promptPath: '.claude/agents/rosa-review.md',
    status: 'active',
    access: ['company/company_handbook_SSOT', 'company/marketing', 'company/commercial'],
    workflows: ['marketing_content', 'proposal', 'delivery', 'document', 'creative_image'],
    responsibilities: ['Quality review of drafts', 'AI-slop removal', 'Tone and clarity', 'Claim checking at editorial level'],
    inputs: ['Drafts from any agent'],
    outputs: ['Reviewed, sharpened texts', 'Change notes'],
    noGo: ['Rewriting strategy', 'Approving on behalf of the user'],
  },
  {
    id: 'otto', name: 'Otto', title: 'Proposal Agent', dept: 'sales',
    role: 'Offers, scopes, service modules, proposal drafts.',
    promptPath: '.claude/agents/otto-proposal-agent.md',
    status: 'active',
    access: ['company/commercial', 'company/strategy'],
    workflows: ['proposal'],
    responsibilities: ['Client offers and scopes', 'Service modules and pricing structures', 'Pilot offers', 'Proposal variants'],
    inputs: ['Client context', 'Strategy gate results'],
    outputs: ['Proposal drafts', 'Scope documents'],
    noGo: ['Pricing without strategy gate', 'Inflated ROI promises'],
  },
  {
    id: 'paula', name: 'Paula', title: 'Delivery Agent', dept: 'delivery',
    role: 'Pilot plans, roadmaps, milestones, status reports, rollout and handover.',
    promptPath: '.claude/agents/paula-delivery-agent.md',
    status: 'active',
    access: ['company/projects', 'company/commercial', 'company/company_handbook_SSOT'],
    workflows: ['delivery'],
    responsibilities: ['Pilot plans and implementation roadmaps', 'Milestones and dependencies', 'Status reports against plan', 'Handover checklists and rollout readiness'],
    inputs: ['Signed offers from Otto', 'Specifications from Iris', 'Client context'],
    outputs: ['Delivery plans', 'Status reports', 'Handover checklists'],
    noGo: ['Changing scope, pricing or architecture', 'Reporting milestones as done without verification'],
  },
  {
    id: 'vera', name: 'Vera', title: 'Creative Production', dept: 'creative',
    role: 'Visual concepts, image prompts and Kie.ai generation packages in one lane.',
    promptPath: '.claude/agents/vera-visual-concept.md',
    status: 'active',
    access: ['company/marketing', 'company/company_handbook_SSOT'],
    workflows: ['creative_image'],
    responsibilities: ['Visual intent documents', 'Model-ready image prompts (image-prompting skill)', 'Kie.ai generation packages (generation-package skill)', 'Asset documentation'],
    inputs: ['Creative briefs', 'Prompt library patterns (reference only)'],
    outputs: ['Visual Intent Documents', 'Image Prompt Packages', 'Generation packages'],
    noGo: ['Copy-pasting library prompts mechanically', 'Claiming generation ran without a completed Kie.ai job'],
  },
  {
    id: 'simon', name: 'Simon', title: 'Security Audit', dept: 'it',
    role: 'Security audits, risk assessment, permission and guardrail reviews, compliance checks.',
    promptPath: '.claude/agents/simon-security-audit.md',
    status: 'active',
    access: ['company/company_handbook_SSOT', 'company/commercial'],
    workflows: ['security_audit', 'dev_spec'],
    responsibilities: ['Security audits of setups and workflows', 'Risk assessment with severity ratings', 'Permission, guardrail and data-flow review', 'Compliance and governance checks'],
    inputs: ['System descriptions, configs, architecture docs'],
    outputs: ['Audit reports with findings and severities', 'Remediation recommendations'],
    noGo: ['Fear-mongering without evidence', 'Approving a setup as "secure" without listing residual risks'],
  },
  {
    id: 'iris', name: 'Iris', title: 'Spec & Architecture', dept: 'it',
    role: 'Development specifications, architecture design, technical concepts and system diagrams.',
    promptPath: '.claude/agents/iris-spec-architect.md',
    status: 'active',
    access: ['company/strategy', 'company/company_handbook_SSOT'],
    workflows: ['dev_spec'],
    responsibilities: ['Development specifications', 'Architecture design and trade-off analysis', 'Component and data-flow diagrams', 'Acceptance criteria and phased delivery plans'],
    inputs: ['Requirements, use cases, constraints'],
    outputs: ['Specification documents', 'Architecture designs with diagrams'],
    noGo: ['Vendor lock-in by default', 'Over-engineering beyond the stated requirements', 'Specs without acceptance criteria'],
  },
];

const WORKFLOWS = [
  {
    id: 'strategy_review', name: 'Strategy Review',
    desc: 'Strategic fit check for ideas, claims and decisions.',
    chain: ['danny', 'nora', 'atlas', 'danny', 'user'],
  },
  {
    id: 'marketing_content', name: 'Marketing Content',
    desc: 'From campaign logic to written, reviewed content (Ada writes via content-writing skill).',
    chain: ['danny', 'nora', 'ada', 'rosa', 'approval'],
  },
  {
    id: 'proposal', name: 'Proposal Workflow',
    desc: 'Strategy-gated offers with clean scopes and documents (steadymade-docs skill).',
    chain: ['danny', 'nora', 'atlas', 'otto', 'rosa', 'approval'],
  },
  {
    id: 'delivery', name: 'Delivery Workflow',
    desc: 'From signed offer or approved spec to pilot, rollout and handover.',
    chain: ['danny', 'nora', 'paula', 'rosa', 'approval'],
  },
  {
    id: 'document', name: 'Document Workflow',
    desc: 'Structured, client-ready documents with review (domain agent + steadymade-docs skill).',
    chain: ['danny', 'nora', 'danny', 'rosa', 'approval'],
  },
  {
    id: 'creative_image', name: 'Creative Image Workflow',
    desc: 'Vera: visual intent → prompts → Kie.ai-ready package, then review.',
    chain: ['danny', 'nora', 'vera', 'rosa', 'approval'],
  },
  {
    id: 'knowledge_retrieval', name: 'Knowledge Retrieval',
    desc: 'Source-grounded retrieval and context packaging for downstream tasks.',
    chain: ['danny', 'nora', 'danny', 'user'],
  },
  {
    id: 'knowledge_intake', name: 'Knowledge Intake',
    desc: 'New material classified, curated and routed into docs.',
    chain: ['danny', 'mara', 'nora', 'atlas', 'docs'],
  },
  {
    id: 'setup_profile', name: 'Setup Profile',
    desc: 'Company or personal onboarding and profile updates.',
    chain: ['danny', 'mara', 'nora', 'danny', 'user'],
  },
  {
    id: 'calendar_planning', name: 'Calendar Planning',
    desc: 'Editorial planning and publication cadence (Ada + publication-calendar skill).',
    chain: ['danny', 'nora', 'ada', 'user'],
  },
  {
    id: 'security_audit', name: 'Security Audit',
    desc: 'Security and risk audit of systems, setups and workflows.',
    chain: ['danny', 'nora', 'simon', 'atlas', 'user'],
  },
  {
    id: 'dev_spec', name: 'Development Spec',
    desc: 'Development specification incl. architecture design and security review.',
    chain: ['danny', 'nora', 'iris', 'simon', 'rosa', 'approval'],
  },
  {
    id: 'multi_department', name: 'Multi-Department',
    desc: 'Cross-department orchestration across strategy, knowledge, and delivery.',
    chain: ['danny', 'nora', 'atlas', 'rosa', 'user'],
  },
];

// terminal pseudo-steps used in workflow chains
const TERMINALS = {
  user: { name: 'User', role: 'Final answer' },
  approval: { name: 'User Approval', role: 'Required gate' },
  docs: { name: 'Update Docs', role: 'Knowledge write' },
};

const DOC_STATUSES = ['approved', 'draft', 'candidate', 'needs_review', 'approved_candidate', 'conflict', 'deprecated'];
const MARKET_SCOPES = ['DACH', 'Australia', 'Both', 'Unknown'];
