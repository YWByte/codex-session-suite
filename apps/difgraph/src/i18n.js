const messages = Object.freeze({
  en: Object.freeze({
    'cli.usage': 'Usage: difgraph [path] [--host <host>] [--port <port>] [--locale <locale>]',
    'cli.started': 'difgraph is available at {url}',
    'cli.error': 'difgraph: {message}',
    'folderPicker.prompt': 'Choose a Git directory to open in difgraph',
    'error.ONLY_ONE_REPOSITORY_PATH': 'Only one repository path may be provided',
    'error.INVALID_PORT': '--port must be an integer from 0 to 65535',
    'error.INVALID_HOST': '--host must be a loopback address (127.0.0.1, localhost, or ::1)',
    'error.PORT_IN_USE': 'Port {port} is already in use on {host}',
    'error.PATH_NOT_FOUND': 'The selected path does not exist',
    'error.NOT_A_REPOSITORY': 'The selected path is not a Git repository',
    'error.EMPTY_REPOSITORY': 'The repository has no commits',
    'error.BRANCH_NOT_FOUND': 'The selected local branch does not exist',
    'error.GIT_READ_FAILED': 'Unable to read Git history',
    'error.COMMIT_NOT_LOADED': 'The commit is not in the currently loaded history',
    'error.FOLDER_PICKER_UNAVAILABLE': 'The folder picker is unavailable',
    'error.FOLDER_PICKER_UNSUPPORTED': 'The folder picker is only supported on macOS',
    'error.FOLDER_PICKER_BUSY': 'The folder picker is already open',
    'error.FOLDER_PICKER_TIMEOUT': 'The folder picker timed out. Please try again.',
    'error.FOLDER_PICKER_FAILED': 'Unable to open the macOS folder picker',
    'error.FOLDER_PICKER_INVALID_RESULT': 'The folder picker did not return a valid directory',
    'error.INVALID_DIRECTORY': 'The selected path is not an accessible directory',
    'error.DIFIT_NOT_FOUND': 'difit was not found in PATH or the suite dependency',
    'error.DIFIT_START_TIMEOUT': 'Timed out while starting difit',
    'error.DIFIT_START_FAILED': 'Unable to start difit',
    'error.INTERNAL_ERROR': 'Unexpected server error',
  }),
  'zh-CN': Object.freeze({
    'cli.usage': '用法：difgraph [路径] [--host <主机>] [--port <端口>] [--locale <语言>]',
    'cli.started': 'difgraph 已在 {url} 启动',
    'cli.error': 'difgraph：{message}',
    'folderPicker.prompt': '选择要在 difgraph 中打开的 Git 目录',
    'error.ONLY_ONE_REPOSITORY_PATH': '只能提供一个仓库路径',
    'error.INVALID_PORT': '--port 必须是 0 到 65535 之间的整数',
    'error.INVALID_HOST': '--host 必须是 loopback 地址（127.0.0.1、localhost 或 ::1）',
    'error.PORT_IN_USE': '{host} 上的端口 {port} 已被占用',
    'error.PATH_NOT_FOUND': '所选路径不存在',
    'error.NOT_A_REPOSITORY': '所选路径不是 Git 仓库',
    'error.EMPTY_REPOSITORY': '仓库没有提交',
    'error.BRANCH_NOT_FOUND': '所选本地分支不存在',
    'error.GIT_READ_FAILED': '无法读取 Git 历史',
    'error.COMMIT_NOT_LOADED': '提交不在当前加载的历史中',
    'error.FOLDER_PICKER_UNAVAILABLE': '文件夹选择器不可用',
    'error.FOLDER_PICKER_UNSUPPORTED': '文件夹选择器仅支持 macOS',
    'error.FOLDER_PICKER_BUSY': '文件夹选择器已打开',
    'error.FOLDER_PICKER_TIMEOUT': '文件夹选择超时，请重试。',
    'error.FOLDER_PICKER_FAILED': '无法打开 macOS 文件夹选择器',
    'error.FOLDER_PICKER_INVALID_RESULT': '文件夹选择器未返回有效目录',
    'error.INVALID_DIRECTORY': '所选路径不是可访问的文件夹',
    'error.DIFIT_NOT_FOUND': 'PATH 和套件依赖中都没有找到 difit',
    'error.DIFIT_START_TIMEOUT': '启动 difit 超时',
    'error.DIFIT_START_FAILED': '无法启动 difit',
    'error.INTERNAL_ERROR': '服务器发生意外错误',
  }),
});

export function normalizeLocale(value, fallback = 'en') {
  if (!value || value === 'auto') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (/^zh(?:$|(?:[-_](?:hans|cn))(?:[._-]|$))/.test(normalized)) return 'zh-CN';
  return /^(en([-_].*)?)$/.test(normalized) ? 'en' : fallback;
}

export function systemLocale(env = process.env) {
  const configured = env.CODEX_SUITE_LOCALE;
  if (configured && configured !== 'auto') return normalizeLocale(configured);
  return normalizeLocale(env.LC_ALL || env.LC_MESSAGES || env.LANG || 'en');
}

export function resolveLocale(value, env = process.env) {
  return value && value !== 'auto' ? normalizeLocale(value) : systemLocale(env);
}

export function hasMessage(locale, key) {
  return Boolean(messages[normalizeLocale(locale)]?.[key] ?? messages.en[key]);
}

export function translator(locale) {
  const selected = messages[normalizeLocale(locale)] || messages.en;
  return (key, values = {}) => {
    const template = selected[key] ?? messages.en[key] ?? key;
    return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? `{${name}}`));
  };
}
