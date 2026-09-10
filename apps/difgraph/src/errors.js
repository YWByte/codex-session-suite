import { hasMessage, translator } from './i18n.js';

export class AppError extends Error {
  constructor(code, message, status = 400, values = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.values = values;
  }
}

export function localizedErrorMessage(error, locale = 'en') {
  const translate = translator(locale);
  if (error instanceof AppError) {
    const key = `error.${error.code}`;
    if (hasMessage(locale, key)) return translate(key, error.values);
    return error.message;
  }
  return translate('error.INTERNAL_ERROR');
}

export function errorPayload(error, locale = 'en') {
  return {
    error: {
      code: error.code ?? 'INTERNAL_ERROR',
      message: localizedErrorMessage(error, locale),
    },
  };
}
