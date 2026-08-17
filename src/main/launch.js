const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { currentOs, arch } = require('./versions');
const { isNativeLibrary, nativesTargetDir, libArtifact } = require('./versions');
const { tl } = require('./ti18n');

const running = new Map();

function rulesAllow(rules) {
  if (!rules || !rules.length) return true;
  let allow = false;
  for (const r of rules) {
    let ok = true;
    if (r.os) {
      ok = ok && (r.os.name ? r.os.name === currentOs() : true);
      if (r.os.arch) ok = ok && r.os.arch === arch();
    }
    if (r.features) {
      for (const [, v] of Object.entries(r.features)) ok = ok && !v;
    }
    if (!ok) continue;
    if (r.action === 'disallow') allow = false;
    else allow = true;
  }
  return allow;
}

function substitute(arg, tokens) {
  return String(arg).replace(/\$\{([^}]+)\}/g, (m, key) => (key in tokens ? String(tokens[key]) : m));
}

function splitArgs(str) {
  const out = [];
  const re = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;
  let m;
  while ((m = re.exec(str))) out.push(m[0].replace(/^"|"$/g, '').replace(/^'|'$/g, ''));
  return out;
}

function buildArgs({ versionJson, versionId, account, java, settings, gameDir: gd }) {
  const gameDir = gd || paths.gameDir();
  const libDir = paths.libDir();
  const assetsRoot = paths.assetsDir();
  const nativesDir = nativesTargetDir(versionJson);
  const nativesRoot = path.join(paths.versionDir(versionId), 'natives');
  const clientJar = path.join(paths.versionDir(versionId), `${versionId}.jar`);

  const cp = [];
  for (const lib of versionJson.libraries || []) {
    if (!rulesAllow(lib.rules)) continue;
    if (isNativeLibrary(lib)) continue;
    const art = libArtifact(lib);
    if (!art) continue;
    cp.push(path.join(libDir, ...art.pathParts));
  }
  cp.push(clientJar);
  const classpath = cp.join(path.delimiter);

  const mem = Math.max(512, Math.min(16384, parseInt(settings.memory || 2048, 10) || 2048));
  const tokens = {
    auth_player_name: account.name,
    version_name: versionId,
    game_directory: gameDir,
    assets_root: assetsRoot,
    game_assets: assetsRoot,
    assets_index_name: versionJson.assetIndex ? versionJson.assetIndex.id : 'legacy',
    auth_uuid: String(account.uuid).replace(/-/g, ''),
    auth_access_token: account.accessToken || '0',
    clientid: account.clientId || '',
    auth_xuid: account.xuid || '',
    user_type: account.userType || 'legacy',
    version_type: versionJson.type || 'release',
    user_properties: '{}',
    profile_name: account.name,
    natives_directory: nativesRoot,
    launcher_name: 'iDK Launcher',
    launcher_version: '1.0.0',
    classpath,
    library_directory: libDir,
    classpath_separator: path.delimiter,
    resolution_width: '854',
    resolution_height: '480',
  };

  const jvmBase = [
    `-Xmx${mem}M`,
    `-Xms${Math.min(512, mem)}M`,
    '-XX:+UseG1GC',
    '-XX:-OmitStackTraceInFastThrow',
  ];

  const flatten = (arg) => {
    const values = typeof arg === 'string' ? [arg] : Array.isArray(arg.value) ? arg.value : [arg.value];
    return values.map((v) => substitute(v, tokens));
  };

  let jvmArgs = [];
  let gameArgs = [];

  if (versionJson.arguments && versionJson.arguments.jvm) {
    jvmArgs = versionJson.arguments.jvm
      .filter((a) => typeof a === 'string' || (a && a.value))
      .filter((a) => rulesAllow(a.rules))
      .flatMap(flatten);
    gameArgs = versionJson.arguments.game
      .filter((a) => typeof a === 'string' || (a && a.value))
      .filter((a) => rulesAllow(a.rules))
      .flatMap(flatten);
  } else if (versionJson.minecraftArguments) {
    gameArgs = versionJson.minecraftArguments.split(' ').map((a) => substitute(a, tokens));
  }

  const jvmHasLibPath = jvmArgs.some((a) => a.startsWith('-Djava.library.path'));
  const jvmHasCp = jvmArgs.includes('-cp');
  if (!jvmHasLibPath) jvmBase.push('-Djava.library.path=' + nativesDir);

  if (settings.jvmArgs) jvmArgs = [...jvmArgs, ...splitArgs(String(settings.jvmArgs))];

  if (account.type === 'elyby' && settings.authlibInjector) {
    jvmArgs = [...jvmArgs, `-javaagent:${settings.authlibInjector}=https://account.ely.by/api/authlib-injector`];
  }

  const mainClass = versionJson.mainClass || 'net.minecraft.client.main.Main';
  if (mainClass === 'net.minecraft.launchwrapper.Launch') {
    gameArgs = ['--tweakClass', 'net.minecraft.launchwrapper.VanillaTweaker', ...gameArgs];
  }

  const args = [...jvmBase, ...jvmArgs];
  if (!jvmHasCp) args.push('-cp', classpath);
  args.push(mainClass, ...gameArgs);
  return { args, gameDir, nativesDir };
}

function launchGame({ versionId, versionJson, account, java, settings, gameDir, runId, onOutput, onExit }) {
  const gd = gameDir || paths.gameDir();
  const key = runId || versionId;
  const { args, gameDir: builtGameDir } = buildArgs({ versionJson, versionId, account, java, settings, gameDir: gd });
  const dir = builtGameDir || gd;
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });

  const logStream = fs.createWriteStream(path.join(dir, 'logs', 'idk-launcher-latest.log'), { flags: 'a' });

  const proc = spawn(java.bin, args, {
    cwd: dir,
    env: { ...process.env },
    windowsHide: false,
  });
  running.set(key, proc);

  const forward = (line) => {
    logStream.write(line + '\n');
    if (onOutput) onOutput(line);
  };

  proc.stdout && proc.stdout.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(forward));
  proc.stderr && proc.stderr.on('data', (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(forward));
  proc.on('error', (e) => {
    forward(tl('launch.error', { msg: e.message }));    if (onExit) onExit(e.code || 1);
  });
  proc.on('exit', (code) => {
    logStream.end();
    running.delete(key);
    if (onExit) onExit(code);
  });
  return true;
}

function stopGame(key) {
  const proc = running.get(key);
  if (!proc) return false;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    } else {
      proc.kill('SIGKILL');
    }
  } catch {}
  return true;
}

function isRunning(key) {
  return running.has(key);
}

function lastLogs(gameDir) {
  const gd = gameDir || paths.gameDir();
  const res = { log: '', crash: null };
  const readTail = (file) => {
    try {
      if (!fs.existsSync(file)) return '';
      const data = fs.readFileSync(file, 'utf8');
      return data.split(/\r?\n/).filter(Boolean).slice(-400).join('\n');
    } catch {
      return '';
    }
  };
  res.log = readTail(path.join(gd, 'logs', 'latest.log')) || readTail(path.join(gd, 'logs', 'idk-launcher-latest.log'));
  try {
    const crashDir = path.join(gd, 'crash-reports');
    if (fs.existsSync(crashDir)) {
      const files = fs
        .readdirSync(crashDir)
        .filter((f) => f.endsWith('.txt'))
        .map((f) => path.join(crashDir, f))
        .filter((f) => {
          try {
            return fs.statSync(f).isFile();
          } catch {
            return false;
          }
        })
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (files.length) {
        const latest = files[0];
        try {
          res.crash = { file: path.basename(latest), content: fs.readFileSync(latest, 'utf8').slice(0, 12000) };
        } catch {}
      }
    }
  } catch {}
  return res;
}

module.exports = { launchGame, stopGame, isRunning, buildArgs, lastLogs };
