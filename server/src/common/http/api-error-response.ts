export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string | string[];
    details?: unknown;
  };
  timestamp: string;
}

export interface sendSocketError {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export function apiErrorEnvelope(input: {
  code: string;
  message: string | string[];
  details?: unknown;
}): ApiErrorEnvelope {
  return {
    success: false,
    error: {
      code: input.code,
      message: input.message,
      ...(input.details === undefined ? {} : { details: input.details }),
    },
    timestamp: new Date().toISOString(),
  };
}

export function sendSocketError(
  code: string,
  message: string,
): sendSocketError {
  return { success: false, error: { code, message } };
}
