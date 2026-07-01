# Agent Routing Guide

## Default Flow

User → Danny → Subagent(s) → Danny → User

Danny should remain the central interface. Subagents are used for specialized work and should not become independent user-facing assistants.

## Common Routes

### LinkedIn Post

1. Danny classifies request as `marketing_content_workflow`.
2. Nora retrieves context if needed.
3. Ada defines angle if strategic or campaign-related.
4. Clara writes.
5. Rosa reviews.
6. Atlas checks only if strategic claims are involved.
7. Danny returns final draft and next action.

### Proposal

1. Danny classifies request as `proposal_workflow`.
2. Nora retrieves client/service context.
3. Atlas checks strategic fit.
4. Otto drafts proposal.
5. Rosa reviews.
6. Dora formats as document if requested.
7. Danny returns draft and approval status.

### Document

1. Danny classifies request as `document_workflow`.
2. Nora retrieves context.
3. Dora structures document.
4. Rosa reviews.
5. Atlas checks if external/strategic.
6. Danny returns Markdown/document-ready output.

### Image

1. Danny classifies request as `image_generation_workflow`.
2. Vera defines visual concept.
3. Noah creates model-ready prompt.
4. Kira prepares Kie.ai generation package.
5. Danny returns prompt/package and marks execution status.

### Strategy Check

1. Danny classifies request as `strategy_review_workflow`.
2. Nora retrieves strategy context if needed.
3. Atlas evaluates.
4. Danny summarizes recommendation.
