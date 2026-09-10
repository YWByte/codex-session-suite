#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { startupMessage, startApplication } from '../src/app.js';
import { normalizeLocale, resolveLocale, translator } from '../src/i18n.js';

function localizedError(error, locale) {
  const key = `error.${error.code}`;
  const selected = normalizeLocale(locale);
  const translate = translator(selected);
  return error.code === 'INVALID_PORT' || error.code === 'ONLY_ONE_REPOSITORY_PATH' || error.code === 'INVALID_HOST' || error.code === 'PORT_IN_USE'
    ? translate(key, error.values ?? {})
    : translate('cli.error', { message: error.message });
}

try {
  const { values, positionals } = parseArgs({
    options: {
      port: { type: 'string', short: 'p', default: '4173' },
      host: { type: 'string', default: '127.0.0.1' },
      locale: { type: 'string', default: 'auto' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });
  const locale = resolveLocale(values.locale);
  if (values.help) {
    console.log(translator(locale)('cli.usage'));
    process.exit(0);
  }
  if (positionals.length > 1) {
    const error = new Error('Only one repository path may be provided');
    error.code = 'ONLY_ONE_REPOSITORY_PATH';
    throw error;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    const error = new Error('--port must be an integer from 0 to 65535');
    error.code = 'INVALID_PORT';
    throw error;
  }
  const app = await startApplication({
    repositoryPath: positionals[0] ?? process.cwd(),
    host: values.host,
    port,
    locale: values.locale,
  });
  console.log(startupMessage(app.url, app.locale));
} catch (error) {
  const locale = resolveLocale(parseArgs({ options: { locale: { type: 'string', default: 'auto' } }, allowPositionals: true }).values.locale);
  console.error(localizedError(error, locale));
  process.exitCode = 1;
}
