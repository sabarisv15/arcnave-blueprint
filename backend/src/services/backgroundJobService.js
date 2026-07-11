'use strict';

const { appPool } = require('../db/pool');
const backgroundJobRepository = require('../repositories/backgroundJobRepository');

function publicJob(job) {
  return {
    id: job.id,
    college_id: job.college_id,
    name: job.name,
    status: job.status,
    error: job.error,
    created_by_user_id: job.created_by_user_id,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
  };
}

async function runTenantJob(collegeId, jobId, handler) {
  // Raw .query() calls below (BEGIN/COMMIT/ROLLBACK, set_config) are
  // transaction/tenant-context bootstrap plumbing, exempt from
  // CLAUDE.md rule 1 -- they establish the transaction and RLS context
  // that backgroundJobRepository's calls then run inside, not a
  // business-data bypass.
  const client = await appPool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    await backgroundJobRepository.markRunning(client, jobId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const finishClient = await appPool.connect();
  try {
    await handler();
    await finishClient.query('BEGIN');
    await finishClient.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    await backgroundJobRepository.markCompleted(finishClient, jobId);
    await finishClient.query('COMMIT');
  } catch (err) {
    await finishClient.query('ROLLBACK').catch(() => {});
    await finishClient.query('BEGIN');
    await finishClient.query("SELECT set_config('app.current_tenant', $1, true)", [collegeId]);
    await backgroundJobRepository.markFailed(
      finishClient,
      jobId,
      err && err.message ? err.message : 'Background job failed',
    );
    await finishClient.query('COMMIT');
  } finally {
    finishClient.release();
  }
}

async function enqueue(client, { collegeId, name, createdByUserId }, handler = async () => {}) {
  const job = await backgroundJobRepository.create(client, {
    collegeId,
    name: name || 'background_job',
    createdByUserId,
  });

  setImmediate(async () => {
    try {
      await runTenantJob(collegeId, job.id, handler);
    } catch {
      // Status updates are best-effort; callers can still see the queued row.
    }
  });

  return publicJob(job);
}

async function list(client, options) {
  const rows = await backgroundJobRepository.list(client, options);
  return rows.map(publicJob);
}

async function find(client, id) {
  const job = await backgroundJobRepository.findById(client, id);
  return job ? publicJob(job) : null;
}

module.exports = { enqueue, list, find };
