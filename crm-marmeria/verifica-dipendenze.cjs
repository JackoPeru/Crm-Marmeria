'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = __dirname;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const nodeCommand = process.execPath;
const forceRepair = process.argv.includes('--force');
const updateMarker = path.join(root, '.crm-update-pending');
const { writeUpdateProgress } = require('./server/update-progress');
const updateInProgress = fs.existsSync(updateMarker);
const progress = (stage, percent, message, error = false) => {
  if (updateInProgress) writeUpdateProgress(path.join(root, 'server', 'data'), { stage, percent, message, error });
};

const npmCliPath = () => {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(nodeCommand), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
};

const dependencySets = [
  {
    label: 'frontend web (build)',
    directory: root,
    ignoreScripts: true,
    runtimeModules: [],
  },
  {
    label: 'server LAN',
    directory: path.join(root, 'server'),
    ignoreScripts: true,
    runtimeModules: [
      'bcrypt',
      'better-sqlite3',
      'cors',
      'express',
      'jsonwebtoken',
      'multer',
      'selfsigned',
      'ws',
    ],
  },
];

function fail(message) {
  console.error(`\n[ERRORE] ${message}`);
  process.exitCode = 1;
}

function run(command, args, directory, options = {}) {
  const npmCli = command === npmCommand && process.platform === 'win32' ? npmCliPath() : null;
  const result = spawnSync(npmCli ? nodeCommand : command, npmCli ? [npmCli, ...args] : args, {
    cwd: directory,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    windowsHide: true,
  });

  if (result.error) {
    return { ok: false, error: result.error.message };
  }

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function dependencyFingerprint(directory) {
  const manifestPaths = ['package.json', 'package-lock.json']
    .map((name) => path.join(directory, name))
    .filter((filePath) => fs.existsSync(filePath));

  if (!manifestPaths.length) {
    throw new Error(`Nessun package.json trovato in ${directory}`);
  }

  const hash = crypto.createHash('sha256');
  for (const filePath of manifestPaths) {
    hash.update(path.basename(filePath));
    hash.update('\0');
    hash.update(fs.readFileSync(filePath));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function stampPath(directory) {
  return path.join(directory, 'node_modules', '.crm-dependencies.sha256');
}

function readStamp(directory) {
  try {
    return fs.readFileSync(stampPath(directory), 'utf8').trim();
  } catch {
    return '';
  }
}

function verifyRuntimeModules(directory, modules) {
  if (!modules.length) return { ok: true };

  const script = [
    "const modules = JSON.parse(process.argv[1]);",
    "for (const name of modules) {",
    "  const resolved = require.resolve(name, { paths: [process.cwd()] });",
    "  require(resolved);",
    "}",
  ].join('\n');

  return run(nodeCommand, ['-e', script, JSON.stringify(modules)], directory);
}

function verifyInstalledTree(config) {
  const nodeModules = path.join(config.directory, 'node_modules');
  if (!fs.existsSync(nodeModules)) {
    return { ok: false, reason: 'cartella node_modules assente' };
  }

  const npmTree = run(npmCommand, ['ls', '--depth=0', '--silent'], config.directory);
  if (!npmTree.ok) {
    const details = (npmTree.stderr || npmTree.stdout).trim();
    return {
      ok: false,
      reason: details ? `albero npm non valido: ${details.split(/\r?\n/)[0]}` : 'albero npm non valido',
    };
  }

  const runtimeCheck = verifyRuntimeModules(config.directory, config.runtimeModules);
  if (!runtimeCheck.ok) {
    const details = (runtimeCheck.stderr || runtimeCheck.stdout || runtimeCheck.error || '').trim();
    return {
      ok: false,
      reason: details ? `modulo runtime non caricabile: ${details.split(/\r?\n/)[0]}` : 'modulo runtime non caricabile',
    };
  }

  return { ok: true };
}

function installDependencySet(config, fingerprint) {
  const hasLockfile = fs.existsSync(path.join(config.directory, 'package-lock.json'));
  const args = [hasLockfile ? 'ci' : 'install'];
  if (config.ignoreScripts) args.push('--ignore-scripts');

  console.log(`[DIPENDENZE] Installazione ${config.label}...`);
  const installation = run(npmCommand, args, config.directory, { inherit: true });
  if (!installation.ok) {
    throw new Error(`Installazione npm non riuscita per ${config.label}.`);
  }

  fs.mkdirSync(path.join(config.directory, 'node_modules'), { recursive: true });
  fs.writeFileSync(stampPath(config.directory), `${fingerprint}\n`, 'utf8');
}

function ensureDependencySet(config) {
  if (!fs.existsSync(path.join(config.directory, 'package.json'))) {
    throw new Error(`package.json mancante per ${config.label}: ${config.directory}`);
  }

  const fingerprint = dependencyFingerprint(config.directory);
  const currentStamp = readStamp(config.directory);
  let verification;

  if (forceRepair) {
    verification = { ok: false, reason: 'riparazione forzata' };
  } else if (currentStamp && currentStamp !== fingerprint) {
    verification = { ok: false, reason: 'package.json o package-lock.json modificato' };
  } else {
    verification = verifyInstalledTree(config);
  }

  if (verification.ok) {
    if (!currentStamp) {
      fs.writeFileSync(stampPath(config.directory), `${fingerprint}\n`, 'utf8');
      console.log(`[OK] Dipendenze ${config.label} valide; stato iniziale registrato.`);
    } else {
      console.log(`[OK] Dipendenze ${config.label} valide.`);
    }
    return;
  }

  console.log(`[DIPENDENZE] ${config.label}: ${verification.reason}.`);
  installDependencySet(config, fingerprint);

  const finalVerification = verifyInstalledTree(config);
  if (!finalVerification.ok) {
    throw new Error(`Verifica finale fallita per ${config.label}: ${finalVerification.reason}`);
  }

  console.log(`[OK] Dipendenze ${config.label} ripristinate e verificate.`);
}

function rebuildWebAfterUpdate() {
  if (!fs.existsSync(updateMarker)) return;

  progress('build', 75, 'Compilo interfaccia web aggiornata...');
  console.log('[AGGIORNAMENTO] Compilo interfaccia web aggiornata...');
  const build = run(npmCommand, ['run', 'build'], root, { inherit: true });
  if (!build.ok) {
    throw new Error('Build dell\'interfaccia web non riuscita dopo aggiornamento.');
  }
  progress('restarting', 95, 'Build completata. Avvio CRM aggiornato...');
}

try {
  progress('dependencies', 45, 'Verifico dipendenze applicazione...');
  const npmVersion = run(npmCommand, ['--version'], root);
  if (!npmVersion.ok) {
    throw new Error('npm non disponibile. Installa o ripara Node.js LTS.');
  }

  for (const [index, config] of dependencySets.entries()) {
    progress('dependencies', 50 + index * 12, `Verifico dipendenze ${config.label}...`);
    ensureDependencySet(config);
  }

  rebuildWebAfterUpdate();

  console.log('\n[OK] Tutte le dipendenze richieste sono pronte.');
} catch (error) {
  progress('error', 0, error && error.message ? error.message : String(error), true);
  fail(error && error.message ? error.message : String(error));
}
