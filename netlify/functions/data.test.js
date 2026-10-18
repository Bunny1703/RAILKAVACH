const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  handleMlDiagnostic,
  handler,
  parseMlDiagnosticEvents,
  predictWithMl,
  ruleEngineRisk,
  runMlDiagnostics,
  runMlSubprocess
} = require('./data');

function fakeSpawn({ stdout = '', exitCode = 0, signal = null, delayMs = 0 } = {}) {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    let closed = false;
    const finish = (code, closeSignal) => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      child.emit('exit', code, closeSignal);
      child.emit('close', code, closeSignal);
    };
    const timer = setTimeout(() => finish(exitCode, signal), delayMs);
    child.kill = closeSignal => {
      finish(null, closeSignal);
      return true;
    };
    return child;
  };
}

test('reports a normal Python subprocess exit', async () => {
  const result = await runMlSubprocess('python', [], '/api/risk', {
    spawnProcess: fakeSpawn({ stdout: '{"risk_level":"LOW"}' })
  });

  assert.equal(result.outcome, 'normal');
  assert.equal(result.exit_code, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '{"risk_level":"LOW"}');
  assert.equal(typeof result.elapsed_ms, 'number');
});

test('reports a non-zero Python subprocess exit as failed', async () => {
  const result = await runMlSubprocess('python', [], '/api/risk', {
    spawnProcess: fakeSpawn({ exitCode: 3 })
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.exit_code, 3);
  assert.equal(result.signal, null);
});

test('reports timeout separately from a process termination signal', async () => {
  const result = await runMlSubprocess('python', [], '/api/analytics', {
    spawnProcess: fakeSpawn({ delayMs: 100 }),
    timeoutMs: 5,
    terminationGraceMs: 5
  });

  assert.equal(result.outcome, 'timed_out');
  assert.equal(result.exit_code, null);
  assert.equal(result.signal, 'SIGTERM');
});

test('force-kills a child that ignores SIGTERM after timeout', async () => {
  const signals = [];
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = signal => {
      signals.push(signal);
      if (signal === 'SIGKILL') {
        child.emit('exit', null, signal);
        child.emit('close', null, signal);
      }
      return true;
    };
    return child;
  };

  const result = await runMlSubprocess('python', [], '/api/risk', {
    spawnProcess,
    timeoutMs: 5,
    terminationGraceMs: 5
  });

  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.outcome, 'timed_out');
  assert.equal(result.exit_code, null);
  assert.equal(result.signal, 'SIGKILL');
});

test('releases the slot if the child does not report exit after SIGKILL', async () => {
  let active = 0;
  let maximumActive = 0;
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    const index = active++;
    maximumActive = Math.max(maximumActive, active);
    child.kill = signal => {
      if (signal === 'SIGKILL') active -= 1;
      return true;
    };
    if (index > 0) {
      setTimeout(() => {
        active -= 1;
        child.emit('exit', 0, null);
        child.emit('close', 0, null);
      }, 1);
    }
    return child;
  };

  const results = await Promise.all([
    runMlSubprocess('python', [], '/api/risk', {
      spawnProcess,
      timeoutMs: 5,
      terminationGraceMs: 5,
      killGraceMs: 5
    }),
    runMlSubprocess('python', [], '/api/analytics', {
      spawnProcess,
      timeoutMs: 100,
      killGraceMs: 5
    }),
    runMlSubprocess('python', [], '/api/risk', {
      spawnProcess,
      timeoutMs: 100,
      killGraceMs: 5
    })
  ]);

  assert.equal(maximumActive, 2);
  assert.equal(results[0].outcome, 'timed_out');
  assert.equal(results[0].signal, null);
  assert.deepEqual(results.slice(1).map(result => result.outcome), ['normal', 'normal']);
});

test('clears the force-kill timer when timeout termination succeeds', async () => {
  const signals = [];
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = signal => {
      signals.push(signal);
      if (signal === 'SIGTERM') {
        child.emit('exit', null, signal);
        child.emit('close', null, signal);
      }
      return true;
    };
    return child;
  };

  const result = await runMlSubprocess('python', [], '/api/risk', {
    spawnProcess,
    timeoutMs: 5,
    terminationGraceMs: 20
  });
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.deepEqual(signals, ['SIGTERM']);
  assert.equal(result.outcome, 'timed_out');
  assert.equal(result.signal, 'SIGTERM');
});

test('force-kills and cleans up a child that exceeds the output limit', async () => {
  const signals = [];
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = signal => {
      signals.push(signal);
      if (signal === 'SIGKILL') {
        child.emit('exit', null, signal);
        child.emit('close', null, signal);
      }
      return true;
    };
    process.nextTick(() => child.stdout.emit('data', Buffer.alloc(1024 * 1024 + 1)));
    return child;
  };

  const result = await runMlSubprocess('python', [], '/api/analytics', {
    spawnProcess,
    timeoutMs: 1000,
    terminationGraceMs: 5
  });

  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.exit_code, null);
  assert.equal(result.signal, 'SIGKILL');
  assert.equal(result.stdout, '');
});

test('reports an external termination signal', async () => {
  const result = await runMlSubprocess('python', [], '/api/risk', {
    spawnProcess: fakeSpawn({ exitCode: null, signal: 'SIGTERM', delayMs: 1 })
  });

  assert.equal(result.outcome, 'terminated');
  assert.equal(result.exit_code, null);
  assert.equal(result.signal, 'SIGTERM');
});

test('limits concurrent Python subprocesses to two', async () => {
  let active = 0;
  let maximumActive = 0;
  const spawnProcess = () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => true;
    setTimeout(() => {
      active -= 1;
      child.emit('close', 0, null);
    }, 15);
    return child;
  };

  const results = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    runMlSubprocess('python', [], index % 2 ? '/api/analytics' : '/api/risk', { spawnProcess })
  ));

  assert.equal(results.length, 6);
  assert.equal(maximumActive, 2);
  assert.ok(results.every(result => result.outcome === 'normal'));
});

test('starts queued predictions after failed and terminated children release their slots', async () => {
  let spawned = 0;
  let active = 0;
  let maximumActive = 0;
  const spawnProcess = () => {
    const index = spawned++;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => true;
    if (index === 0) {
      setTimeout(() => {
        active -= 1;
        child.emit('exit', 1, null);
        child.emit('close', 1, null);
      }, 1);
    } else if (index === 1) {
      setTimeout(() => {
        active -= 1;
        child.emit('exit', null, 'SIGTERM');
        child.emit('close', null, 'SIGTERM');
      }, 2);
    } else if (index >= 2) {
      setTimeout(() => {
        active -= 1;
        child.emit('exit', 0, null);
        child.emit('close', 0, null);
      }, 1);
    }
    return child;
  };

  const results = await Promise.all(Array.from({ length: 4 }, (_, index) =>
    runMlSubprocess('python', [], index % 2 ? '/api/analytics' : '/api/risk', {
      spawnProcess,
      timeoutMs: 50,
      terminationGraceMs: 5
    })
  ));

  assert.equal(spawned, 4);
  assert.equal(maximumActive, 2);
  assert.deepEqual(results.map(result => result.outcome), ['failed', 'terminated', 'normal', 'normal']);
});

test('rule-based fallback provides no unsupported confidence or probabilities', () => {
  const result = ruleEngineRisk({
    asset_age_years: 0,
    days_since_last_inspection: 0,
    wear_level: 4,
    temperature_c: 25
  });

  assert.equal(result.risk_score, 16);
  assert.equal(result.confidence, null);
  assert.equal(Object.hasOwn(result, 'probabilities'), false);
  assert.equal(result.ml_available, false);
  assert.equal(result.fallback_used, true);
});

test('requires authentication before serving ML diagnostic results', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await handler({
      httpMethod: 'GET',
      path: '/api/ml-status',
      queryStringParameters: { diagnostic: '1' },
      headers: {}
    });

    assert.equal(result.statusCode, 401);
    assert.deepEqual(JSON.parse(result.body), { message: 'Not authenticated' });
  } finally {
    console.error = originalError;
  }
});

test('denies ML diagnostics to authenticated non-admin users', async () => {
  let diagnosticCalled = false;
  const result = await handleMlDiagnostic(
    { id: 'operator-user', role: 'operator' },
    async () => { diagnosticCalled = true; return {}; }
  );

  assert.equal(result.statusCode, 403);
  assert.deepEqual(JSON.parse(result.body), { message: 'Admin access required.' });
  assert.equal(diagnosticCalled, false);
});

test('allows administrators to request bounded ML diagnostics', async () => {
  const result = await handleMlDiagnostic(
    { id: 'admin-user', role: 'admin' },
    async () => ({
      outcome: 'normal',
      elapsed_ms: 10,
      stages: [{ stage: 'inference', status: 'completed', elapsed_ms: 2 }]
    })
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), {
    diagnostic: {
      outcome: 'normal',
      elapsed_ms: 10,
      stages: [{ stage: 'inference', status: 'completed', elapsed_ms: 2 }]
    }
  });
});

test('filters diagnostic events to allowlisted fields and values', () => {
  const output = [
    JSON.stringify({
      type: 'stage',
      stage: 'dependency_import',
      status: 'completed',
      elapsed_ms: 123.4,
      environment: 'must-not-appear',
      feature_values: { wear_level: 5 }
    }),
    JSON.stringify({
      type: 'stage',
      stage: 'model_loading',
      status: 'failed',
      elapsed_ms: 4,
      error_category: 'model_loading_failed',
      error: 'secret token'
    }),
    JSON.stringify({
      type: 'stage',
      stage: 'unknown_stage',
      status: 'completed',
      elapsed_ms: 5
    }),
    'raw token output'
  ].join('\n');
  const stages = parseMlDiagnosticEvents(output);

  assert.deepEqual(stages, [
    {
      stage: 'dependency_import',
      status: 'completed',
      elapsed_ms: 123,
    },
    {
      stage: 'model_loading',
      status: 'failed',
      elapsed_ms: 4,
      error_category: 'model_loading_failed',
    }
  ]);
  assert.doesNotMatch(JSON.stringify(stages), /environment|wear_level|secret token|raw token/);
});

test('runs bounded local diagnostic and returns only safe stage measurements', async () => {
  const result = await runMlDiagnostics();

  assert.equal(result.outcome, 'normal');
  assert.equal(typeof result.elapsed_ms, 'number');
  assert.deepEqual(result.stages.map(stage => [stage.stage, stage.status]), [
    ['dependency_import', 'started'],
    ['dependency_import', 'completed'],
    ['model_loading', 'started'],
    ['model_loading', 'completed'],
    ['inference', 'started'],
    ['inference', 'completed']
  ]);
  for (const stage of result.stages) {
    assert.ok(Number.isFinite(stage.elapsed_ms));
    assert.ok(['dependency_import', 'model_loading', 'inference'].includes(stage.stage));
    assert.ok(['started', 'completed', 'failed'].includes(stage.status));
    assert.ok(Object.keys(stage).every(key =>
      ['stage', 'status', 'elapsed_ms', 'error_category'].includes(key)
    ));
  }
  assert.doesNotMatch(JSON.stringify(result), /\/opt\/|\/Users\/|wear_level|asset_id|token|SUPABASE/);
});

test('keeps safe stage progress when the diagnostic subprocess times out', async () => {
  const result = await runMlDiagnostics(async () => ({
    outcome: 'timed_out',
    elapsed_ms: 60000,
    stdout: [
      JSON.stringify({ type: 'stage', stage: 'dependency_import', status: 'completed', elapsed_ms: 1200 }),
      JSON.stringify({ type: 'stage', stage: 'model_loading', status: 'started', elapsed_ms: 0 }),
      JSON.stringify({ type: 'stage', stage: 'model_loading', status: 'completed', elapsed_ms: 2200, path: '/private/model.pkl' }),
      'secret token output'
    ].join('\n')
  }));

  assert.equal(result.outcome, 'timed_out');
  assert.deepEqual(result.stages, [
    { stage: 'dependency_import', status: 'completed', elapsed_ms: 1200 },
    { stage: 'model_loading', status: 'started', elapsed_ms: 0 },
    { stage: 'model_loading', status: 'completed', elapsed_ms: 2200 }
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private|token|path/);
});

test('logs safe diagnostics and keeps the baseline fallback on subprocess failure', async () => {
  const events = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.info = (message, serializedEvent) => {
    if (message === 'ML prediction subprocess:') events.push(JSON.parse(serializedEvent));
  };
  console.warn = () => {};

  let result;
  try {
    result = await predictWithMl(
      { wear_level: 4, access_token: 'must-not-be-logged' },
      '/api/analytics',
      async () => ({
        stdout: '',
        elapsed_ms: 27,
        outcome: 'terminated',
        exit_code: null,
        signal: 'SIGTERM'
      })
    );
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }

  assert.equal(result.__mlUnavailable, true);
  assert.equal(result.reason, 'ML prediction process was terminated; baseline rule engine used.');
  assert.equal(result.exit_code, null);
  assert.deepEqual(events, [{
    endpoint: '/api/analytics',
    elapsed_ms: 27,
    outcome: 'terminated',
    exit_code: null,
    signal: 'SIGTERM'
  }]);
  assert.doesNotMatch(JSON.stringify(events), /must-not-be-logged|access_token|wear_level/);
});

test('marks invalid predictor output as failed and keeps the baseline fallback', async () => {
  const events = [];
  const originalInfo = console.info;
  const originalWarn = console.warn;
  console.info = (message, serializedEvent) => {
    if (message === 'ML prediction subprocess:') events.push(JSON.parse(serializedEvent));
  };
  console.warn = () => {};

  let result;
  try {
    result = await predictWithMl(
      { wear_level: 1 },
      '/api/risk',
      async () => ({
        stdout: 'not-json',
        elapsed_ms: 12,
        outcome: 'normal',
        exit_code: 0,
        signal: null
      })
    );
  } finally {
    console.info = originalInfo;
    console.warn = originalWarn;
  }

  assert.equal(result.__mlUnavailable, true);
  assert.equal(result.exit_code, 0);
  assert.equal(events[0].outcome, 'failed');
  assert.equal(events[0].exit_code, 0);
});

test('runs the bundled Python predictor successfully when RENDER is set locally', async () => {
  const previousRender = process.env.RENDER;
  process.env.RENDER = 'true';
  try {
    const result = await predictWithMl({
      asset_age_years: 2,
      wear_level: 1,
      corrosion_level: 0,
      crack_level: 0,
      deformation_level: 0,
      vibration_level: 1,
      temperature_c: 30,
      maintenance_count: 0,
      previous_failures: 0,
      days_since_last_inspection: 5
    });

    assert.equal(result.ml_available, true);
    assert.equal(result.method, 'tree-ensemble-ml-with-safety-guardrail');
    assert.match(result.risk_level, /LOW|MEDIUM|HIGH|CRITICAL/);
    assert.equal(typeof result.score, 'number');
  } finally {
    if (previousRender === undefined) delete process.env.RENDER;
    else process.env.RENDER = previousRender;
  }
});

test('runs the bundled Python predictor successfully in the local environment', async () => {
  const result = await predictWithMl({
    asset_age_years: 2,
    wear_level: 1,
    corrosion_level: 0,
    crack_level: 0,
    deformation_level: 0,
    vibration_level: 1,
    temperature_c: 30,
    maintenance_count: 0,
    previous_failures: 0,
    days_since_last_inspection: 5
  });

  assert.equal(result.ml_available, true);
  assert.equal(result.method, 'tree-ensemble-ml-with-safety-guardrail');
  assert.match(result.risk_level, /LOW|MEDIUM|HIGH|CRITICAL/);
  assert.equal(typeof result.score, 'number');
  assert.ok(result.python_bin);
});

test('reports a missing model file with a non-zero exit and stderr details', () => {
  const { getPythonBin } = require('./_python');
  const python = getPythonBin();
  const result = spawnSync(python, [
    path.join(__dirname, '..', '..', 'ml', 'predict.py'),
    '--model', path.join(__dirname, '..', '..', 'ml', 'model', 'missing-risk-model.pkl'),
    '--json', JSON.stringify({ asset_age_years: 1, wear_level: 1 })
  ], { encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  assert.match(String(result.stderr || ''), /Model file does not exist/);
  assert.match(String(result.stderr || ''), /resolved:/i);
});
