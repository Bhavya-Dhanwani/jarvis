import { playDoctorSequence } from './ascii.js';
import { createModelConfig } from '../services/modelConfigService.js';
import { loading, withSpinner } from './spinner.js';
import { card, section, statusLine, successBox, warningBox } from './theme.js';

export async function renderDoctorReport({ getReport, output = process.stdout } = {}) {
  await playDoctorSequence({ output });
  output.write(section('SYSTEM SCAN'));
  const report = await withSpinner('Collecting host diagnostics', getReport, { output });
  const modelConfig = createModelConfig({ totalMemoryGb: report.memory.totalGb });

  await loading('Analyzing local AI readiness', { output, durationMs: 650 });
  output.write(statusLine('success', 'OS detected', `${report.os.platform} ${report.os.release}`));
  output.write(statusLine('success', 'Node runtime', report.node.version));
  output.write(statusLine('success', 'CPU profile', `${report.cpu.model} (${report.cpu.cores} cores)`));
  output.write(statusLine('success', 'Memory', `${report.memory.freeGb} GB free / ${report.memory.totalGb} GB total`));

  output.write(section('OLLAMA RUNTIME'));
  output.write(report.ollama.available
    ? statusLine('success', 'Ollama CLI', formatOllamaStatus(report.ollama))
    : statusLine('warning', 'Ollama CLI', 'not found'));

  output.write(section('MODEL CORE'));
  output.write(card('LOCAL CORE PROFILE', [
    ['Profile', report.recommendation.size],
    ['Selected model', modelConfig.model],
    ['Config source', formatConfigSource(modelConfig.source)],
    ['Recommended model', report.recommendation.model],
    ['Context', modelConfig.options.num_ctx],
    ['Temperature', modelConfig.options.temperature],
  ], { borderColor: report.ollama.available ? 'green' : 'yellow' }));
  output.write('\n');

  output.write(report.ollama.available
    ? successBox('Diagnostics complete. Ollama runtime detected.')
    : warningBox('Diagnostics complete. Run "jarvis setup" to install and configure Ollama.'));

  return report;
}

function formatConfigSource(source) {
  if (source === 'saved-config') {
    return 'setup selection';
  }

  if (source === 'env') {
    return 'environment';
  }

  return 'hardware recommendation';
}

function formatOllamaStatus(ollama) {
  if (ollama.pathUpdated) {
    return `${ollama.version} (PATH repaired)`;
  }

  return ollama.version;
}
