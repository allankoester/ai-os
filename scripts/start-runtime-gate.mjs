export const REQUIRED_NODE_MAJOR = 22;

function parseNodeMajor(version) {
  const major = Number(String(version || '').trim().replace(/^v/i, '').split('.')[0]);
  return Number.isFinite(major) ? major : 0;
}

export function inspectRuntimeGate({ versions = {}, release = {}, execPath = '', env = {} } = {}) {
  const nodeVersion = String(versions?.node || '').trim();
  const nodeMajor = parseNodeMajor(nodeVersion);
  const releaseName = String(release?.name || '').trim().toLowerCase();
  const hasBunVersion = typeof versions?.bun === 'string' && versions.bun.trim().length > 0;
  const bunFromExec = /(?:^|\/)bun(?:\.exe)?$/i.test(String(execPath || '').trim());
  const isBun = releaseName === 'bun' || hasBunVersion || bunFromExec;

  if (isBun) {
    return {
      ok: false,
      code: 'runtime-bun-unsupported',
      message: `Unsupported runtime detected (Bun). Start this project with Node ${REQUIRED_NODE_MAJOR}+ (for example: npm run preflight or node scripts/start.mjs).`,
      nodeVersion,
      nodeMajor,
      isBun,
    };
  }

  if (nodeMajor < REQUIRED_NODE_MAJOR) {
    return {
      ok: false,
      code: 'runtime-node-too-old',
      message: `Node ${nodeVersion || 'unknown'} is not supported. Required: Node ${REQUIRED_NODE_MAJOR}+.`,
      nodeVersion,
      nodeMajor,
      isBun,
    };
  }

  return {
    ok: true,
    code: 'runtime-ok',
    message: `Runtime check passed: Node ${nodeVersion}`,
    nodeVersion,
    nodeMajor,
    isBun,
  };
}
