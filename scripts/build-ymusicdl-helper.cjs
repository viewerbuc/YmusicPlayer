const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const helperPath = path.join(root, 'python', 'ymusicdl_helper.py');
const distPath = path.join(root, 'resources', 'ymusicdl');
const buildPath = path.join(root, '.helper-build');
const exeName = process.platform === 'win32' ? 'ymusicdl-helper.exe' : 'ymusicdl-helper';

function candidatePythonCommands() {
  if (process.env.PYTHON) return [process.env.PYTHON];
  return process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python'];
}

function resolveMusicdlPath() {
  const candidates = [
    process.env.MUSICDL_REPO,
    path.join(root, 'python', 'vendor'),
    path.resolve(root, '..', '..', 'python', 'musicdl'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'musicdl')));
}

const musicdlPath = resolveMusicdlPath();
if (!musicdlPath) {
  console.error('Cannot find musicdl package. Set MUSICDL_REPO=/path/to/musicdl before running this script.');
  process.exit(1);
}

fs.mkdirSync(distPath, { recursive: true });
fs.mkdirSync(buildPath, { recursive: true });

let lastResult = null;
for (const python of candidatePythonCommands()) {
  const env = {
    ...process.env,
    PYTHONPATH: [musicdlPath, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
  };
  const result = spawnSync(python, [
    '-m', 'PyInstaller',
    '--clean',
    '--onefile',
    '--name', exeName.replace(/\.exe$/i, ''),
    '--distpath', distPath,
    '--workpath', buildPath,
    '--specpath', buildPath,
    helperPath,
  ], { cwd: root, env, stdio: 'inherit' });
  lastResult = result;
  if (!result.error && result.status === 0) process.exit(0);
  if (result.error && result.error.code === 'ENOENT') continue;
}

if (lastResult?.error) console.error(lastResult.error.message);
process.exit(lastResult?.status || 1);
