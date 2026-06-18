import boxen from 'boxen';
import chalk from 'chalk';
import gradient from 'gradient-string';
import logSymbols from 'log-symbols';

export const cyberGradient = gradient(['#00E5FF', '#7C3AED', '#38BDF8']);

export const theme = {
  accent: chalk.hex('#8B5CF6'),
  cyan: chalk.hex('#22D3EE'),
  dim: chalk.dim,
  error: chalk.hex('#FF4D6D'),
  info: chalk.hex('#60A5FA'),
  muted: chalk.hex('#94A3B8'),
  primary: chalk.hex('#38BDF8'),
  success: chalk.hex('#22C55E'),
  title: chalk.bold.hex('#E0F2FE'),
  warning: chalk.hex('#FACC15'),
};

export const symbols = {
  error: logSymbols.error,
  info: logSymbols.info,
  pointer: theme.accent('❯'),
  success: logSymbols.success,
  warning: logSymbols.warning,
};

export function section(title) {
  return `\n${theme.cyan('◇')} ${theme.title(title)}\n${theme.dim('─'.repeat(54))}\n`;
}

export function divider() {
  return `${theme.dim('─'.repeat(54))}\n`;
}

export function muted(value) {
  return theme.muted(value);
}

export function statusLine(kind, label, value = '') {
  const icon = symbols[kind] ?? symbols.info;
  const suffix = value ? ` ${theme.dim('→')} ${value}` : '';
  return `${icon} ${theme.title(label)}${suffix}\n`;
}

export function panel(message, {
  borderColor = 'cyan',
  padding = 1,
  title,
} = {}) {
  return boxen(message, {
    borderColor,
    borderStyle: 'round',
    padding,
    title,
    titleAlignment: 'center',
  });
}

export function card(title, rows, { borderColor = 'cyan' } = {}) {
  const body = rows
    .map(([label, value]) => `${theme.muted(label.padEnd(16))} ${theme.title(String(value ?? ''))}`)
    .join('\n');

  return panel(body, {
    borderColor,
    padding: 1,
    title: theme.cyan(title),
  });
}

export function warningBox(message) {
  return `${panel(`${symbols.warning} ${theme.warning(message)}`, { borderColor: 'yellow' })}\n`;
}

export function errorBox(message) {
  return `${panel(`${symbols.error} ${theme.error(message)}`, { borderColor: 'red' })}\n`;
}

export function successBox(message) {
  return `${panel(`${symbols.success} ${theme.success(message)}`, { borderColor: 'green' })}\n`;
}
