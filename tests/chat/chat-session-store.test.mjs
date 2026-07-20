import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { createChatSessionStore } from '../../chat/storage/chat-session-store.mjs';

async function mk(prefix) {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

async function setupRoots(name) {
  const root = await mk(`chat-store-${name}-`);
  const workspaceRoot = path.join(root, 'workspace');
  const chatDir = path.join(workspaceRoot, 'chat');
  const historyDir = path.join(chatDir, 'history');
  const runtimeRoot = path.join(root, 'runtime');
  await fs.mkdir(historyDir, { recursive: true });
  await fs.mkdir(runtimeRoot, { recursive: true });
  return { root, workspaceRoot, chatDir, historyDir, runtimeRoot };
}

test('migrates/imports legacy sessions.json and activates SQLite authority marker', async () => {
  const env = await setupRoots('migrate');
  const sessionsCompatPath = path.join(env.chatDir, 'sessions.json');
  const legacy = {
    conv_legacy: {
      id: 'conv_legacy',
      title: 'Legacy Session',
      agent: 'danny',
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z',
      turns: 3,
      currentSessionId: 'conv_legacy_resume',
      archived: false,
    },
  };
  await fs.writeFile(sessionsCompatPath, JSON.stringify(legacy, null, 2), 'utf8');

  const store = createChatSessionStore({
    workspaceRoot: env.workspaceRoot,
    chatDir: env.chatDir,
    historyDir: env.historyDir,
    testRuntimeRoot: env.runtimeRoot,
  });
  try {
    const authority = store.getAuthority();
    assert.equal(authority?.value, 'chat_sqlite_v1');

    const imported = store.getSession('conv_legacy');
    assert.ok(imported);
    assert.equal(imported.title, 'Legacy Session');
    assert.equal(imported.currentSessionId, 'conv_legacy_resume');

    const migrations = store.getMigrationLedger();
    assert.equal(migrations.length >= 1, true);
  } finally {
    store.close();
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test('create/resume/rename/archive/search + compatibility payload parity', async () => {
  const env = await setupRoots('crud');
  const store = createChatSessionStore({
    workspaceRoot: env.workspaceRoot,
    chatDir: env.chatDir,
    historyDir: env.historyDir,
    testRuntimeRoot: env.runtimeRoot,
  });

  try {
    const userEntry = {
      t: 'user',
      ts: '2026-07-20T08:00:00.000Z',
      text: 'Please prepare launch checklist',
      agent: 'danny',
    };
    store.createSessionFromFirstTurn({
      conversationId: 'conv_1',
      message: userEntry.text,
      selectedAgent: 'danny',
      sessionId: 'ses_initial',
      userEntry,
    });
    store.persistRunCompletion({
      conversationId: 'conv_1',
      selectedAgent: 'danny',
      sessionId: 'ses_next',
      toolEntries: [{ t: 'tool', ts: '2026-07-20T08:00:01.000Z', name: 'Task', detail: 'planner' }],
      assistantEntry: {
        t: 'assistant',
        ts: '2026-07-20T08:00:02.000Z',
        text: 'Here is the launch checklist and timeline.',
        meta: { session_id: 'ses_next' },
      },
    });

    const listed = store.listSessions();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, 'conv_1');
    assert.equal(listed[0].turns, 1);
    assert.equal(listed[0].currentSessionId, 'ses_next');

    const renamed = store.renameSession('conv_1', 'Launch QA Session');
    assert.equal(renamed.title, 'Launch QA Session');
    const archived = store.archiveSession('conv_1', true);
    assert.equal(archived.archived, true);

    const archivedVisibleByDefault = store.listSessions();
    assert.equal(archivedVisibleByDefault.length, 0);
    const archivedIncluded = store.listSessions({ includeArchived: true });
    assert.equal(archivedIncluded.length, 1);

    const searchResults = store.searchSessions('checklist');
    assert.equal(searchResults.length, 1);
    assert.equal(searchResults[0].id, 'conv_1');
    assert.match(searchResults[0].snippet.toLowerCase(), /checklist/);

    const compatObject = store.getLegacySessionsObject();
    assert.ok(compatObject.conv_1);
    assert.equal(compatObject.conv_1.title, 'Launch QA Session');
    assert.equal(typeof compatObject.conv_1.createdAt, 'string');
    assert.equal(typeof compatObject.conv_1.updatedAt, 'string');
  } finally {
    store.close();
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test('rebuilds FTS/search metadata from JSONL transcript files', async () => {
  const env = await setupRoots('fts');
  const transcriptPath = path.join(env.historyDir, 'conv_fts.jsonl');
  const raw = [
    JSON.stringify({ t: 'user', ts: '2026-07-20T09:00:00.000Z', text: 'Need CRM workflow cleanup', agent: 'danny' }),
    JSON.stringify({ t: 'assistant', ts: '2026-07-20T09:00:01.000Z', text: 'CRM workflow cleanup steps.' }),
  ].join('\n') + '\n';
  await fs.writeFile(transcriptPath, raw, 'utf8');

  const store = createChatSessionStore({
    workspaceRoot: env.workspaceRoot,
    chatDir: env.chatDir,
    historyDir: env.historyDir,
    testRuntimeRoot: env.runtimeRoot,
  });
  try {
    const migratedCanonicalPath = path.join(store.canonicalHistoryDir, 'conv_fts.jsonl');
    const migratedCanonicalRaw = await fs.readFile(migratedCanonicalPath, 'utf8');
    assert.match(migratedCanonicalRaw, /CRM workflow cleanup/);

    let found = store.searchSessions('workflow cleanup');
    assert.equal(found.length, 1);
    assert.equal(found[0].id, 'conv_fts');

    await fs.appendFile(migratedCanonicalPath, `${JSON.stringify({ t: 'assistant', ts: '2026-07-20T09:00:02.000Z', text: 'Also include backlog triage.' })}\n`, 'utf8');
    store.reconcileFromTranscripts();
    found = store.searchSessions('backlog triage');
    assert.equal(found.length, 1);
  } finally {
    store.close();
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test('rejects symlinked legacy history root and does not import transcript content', async () => {
  const env = await setupRoots('legacy-symlink-root');
  const realLegacyRoot = path.join(env.root, 'real-legacy-history');
  await fs.mkdir(realLegacyRoot, { recursive: true });
  await fs.writeFile(
    path.join(realLegacyRoot, 'conv_symlink_root.jsonl'),
    `${JSON.stringify({ t: 'user', ts: '2026-07-20T12:00:00.000Z', text: 'from symlinked legacy root', agent: 'danny' })}\n`,
    'utf8',
  );
  await fs.rm(env.historyDir, { recursive: true, force: true });
  await fs.symlink(realLegacyRoot, env.historyDir, 'dir');

  const store = createChatSessionStore({
    workspaceRoot: env.workspaceRoot,
    chatDir: env.chatDir,
    historyDir: env.historyDir,
    testRuntimeRoot: env.runtimeRoot,
  });
  try {
    assert.equal(store.readHistory('conv_symlink_root').length, 0);
    const diag = store.getDiagnostics();
    assert.equal(diag.unsafePathRejectCount >= 1, true);
    assert.equal(diag.lastFailureCode, 'unsafe_legacy_chat_history_path');
  } finally {
    store.close();
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test('rejects unsafe canonical transcript path without falling back to workspace legacy history', async () => {
  const env = await setupRoots('canonical-reject-no-fallback');
  const store = createChatSessionStore({
    workspaceRoot: env.workspaceRoot,
    chatDir: env.chatDir,
    historyDir: env.historyDir,
    testRuntimeRoot: env.runtimeRoot,
  });

  try {
    const legacyTranscriptPath = path.join(env.historyDir, 'conv_nofallback.jsonl');
    await fs.writeFile(
      legacyTranscriptPath,
      `${JSON.stringify({ t: 'user', ts: '2026-07-20T13:00:00.000Z', text: 'legacy fallback candidate', agent: 'danny' })}\n`,
      'utf8',
    );

    const externalFile = path.join(env.root, 'external-transcript.jsonl');
    await fs.writeFile(externalFile, `${JSON.stringify({ t: 'assistant', text: 'outside runtime' })}\n`, 'utf8');
    await fs.symlink(externalFile, path.join(store.canonicalHistoryDir, 'conv_nofallback.jsonl'));

    const history = store.readHistory('conv_nofallback');
    assert.equal(history.length, 0);

    const diag = store.getDiagnostics();
    assert.equal(diag.unsafePathRejectCount >= 1, true);
    assert.equal(diag.lastFailureCode, 'unsafe_chat_transcript_path');
  } finally {
    store.close();
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test('rejects symlinked legacy transcript file during migration', async () => {
  const env = await setupRoots('legacy-symlink-file');
  const externalFile = path.join(env.root, 'external-transcript.jsonl');
  await fs.writeFile(
    externalFile,
    `${JSON.stringify({ t: 'user', ts: '2026-07-20T14:00:00.000Z', text: 'symlinked legacy file', agent: 'danny' })}\n`,
    'utf8',
  );
  await fs.symlink(externalFile, path.join(env.historyDir, 'conv_symlink_file.jsonl'));

  const store = createChatSessionStore({
    workspaceRoot: env.workspaceRoot,
    chatDir: env.chatDir,
    historyDir: env.historyDir,
    testRuntimeRoot: env.runtimeRoot,
  });
  try {
    assert.equal(store.readHistory('conv_symlink_file').length, 0);
    const diag = store.getDiagnostics();
    assert.equal(diag.unsafePathRejectCount >= 1, true);
    assert.equal(diag.lastFailureCode, 'unsafe_legacy_chat_history_path');
  } finally {
    store.close();
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test('throws explicit error on transcript append failure', async () => {
  const env = await setupRoots('append-fail');
  const store = createChatSessionStore({
    workspaceRoot: env.workspaceRoot,
    chatDir: env.chatDir,
    historyDir: env.historyDir,
    testRuntimeRoot: env.runtimeRoot,
  });

  try {
    await fs.rm(store.canonicalHistoryDir, { recursive: true, force: true });
    await fs.writeFile(store.canonicalHistoryDir, 'not-a-directory', 'utf8');

    assert.throws(
      () => store.appendUserTurn({
        conversationId: 'conv_fail',
        userEntry: { t: 'user', ts: nowIsoForTest(), text: 'hello', agent: 'danny' },
      }),
      (err) => err?.code === 'chat_history_append_failed',
    );

    const diag = store.getDiagnostics();
    assert.equal(diag.transcriptAppendFailures >= 1, true);
  } finally {
    store.close();
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test('readHistory keeps compatible payload while surfacing malformed transcript diagnostics', async () => {
  const env = await setupRoots('malformed-diag');
  const store = createChatSessionStore({
    workspaceRoot: env.workspaceRoot,
    chatDir: env.chatDir,
    historyDir: env.historyDir,
    testRuntimeRoot: env.runtimeRoot,
  });
  try {
    const transcriptPath = path.join(store.canonicalHistoryDir, 'conv_diag.jsonl');
    await fs.writeFile(
      transcriptPath,
      `${JSON.stringify({ t: 'user', ts: '2026-07-20T11:00:00.000Z', text: 'hello', agent: 'danny' })}\nnot-json\n`,
      'utf8',
    );

    const events = store.readHistory('conv_diag');
    assert.equal(events.length, 1);
    assert.equal(events[0].t, 'user');

    const diag = store.getDiagnostics();
    assert.equal(diag.transcripts.malformedLineCount >= 1, true);
    assert.equal(diag.transcripts.quarantinedLineCount >= 1, true);
  } finally {
    store.close();
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

test('reconciles append/index gap after interrupted metadata transaction', async () => {
  const env = await setupRoots('reconcile-gap');
  let failOnce = true;
  const store = createChatSessionStore({
    workspaceRoot: env.workspaceRoot,
    chatDir: env.chatDir,
    historyDir: env.historyDir,
    testRuntimeRoot: env.runtimeRoot,
    hooks: {
      beforeMetadataCommit(phase) {
        if (phase === 'persist_run_completion' && failOnce) {
          failOnce = false;
          throw new Error('simulated crash before metadata commit');
        }
      },
    },
  });

  try {
    store.createSessionFromFirstTurn({
      conversationId: 'conv_gap',
      message: 'Gap test',
      selectedAgent: 'danny',
      sessionId: 'ses_gap_1',
      userEntry: { t: 'user', ts: '2026-07-20T10:00:00.000Z', text: 'Gap test', agent: 'danny' },
    });

    assert.throws(() => {
      store.persistRunCompletion({
        conversationId: 'conv_gap',
        selectedAgent: 'danny',
        sessionId: 'ses_gap_2',
        assistantEntry: {
          t: 'assistant',
          ts: '2026-07-20T10:00:01.000Z',
          text: 'Assistant persisted to transcript first.',
          meta: { session_id: 'ses_gap_2' },
        },
      });
    });

    const stale = store.getSession('conv_gap');
    assert.equal(stale.turns, 0);
    assert.equal(store.readHistory('conv_gap').length, 2);
  } finally {
    store.close();
  }

  const reopened = createChatSessionStore({
    workspaceRoot: env.workspaceRoot,
    chatDir: env.chatDir,
    historyDir: env.historyDir,
    testRuntimeRoot: env.runtimeRoot,
  });

  try {
    const healed = reopened.getSession('conv_gap');
    assert.equal(healed.turns, 1);
    assert.equal(healed.currentSessionId, 'ses_gap_2');
    const search = reopened.searchSessions('transcript first');
    assert.equal(search.length, 1);
    assert.equal(search[0].id, 'conv_gap');
  } finally {
    reopened.close();
    await fs.rm(env.root, { recursive: true, force: true });
  }
});

function nowIsoForTest() {
  return new Date().toISOString();
}
