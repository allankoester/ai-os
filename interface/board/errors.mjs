export class BoardError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'BoardError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function boardError(status, code, message, details = null) {
  return new BoardError(status, code, message, details);
}

export function asBoardEnvelopeError(err) {
  if (err instanceof BoardError) {
    return {
      status: err.status,
      body: {
        ok: false,
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      },
    };
  }
  if (Number(err?.status) === 413 || err?.code === 'payload_too_large') {
    return {
      status: 413,
      body: {
        ok: false,
        error: {
          code: 'payload_too_large',
          message: 'Request body exceeds 256KB limit for board endpoints',
        },
      },
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      error: {
        code: 'internal_error',
        message: String(err?.message || err || 'internal error'),
      },
    },
  };
}
