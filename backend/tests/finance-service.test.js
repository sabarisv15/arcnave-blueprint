'use strict';

// Unit tests for FinanceService's pure business-logic paths — no live
// Postgres needed: financeRepository, feePaymentRepository, and
// auditLogRepository are stubbed via node:test's built-in mock, same
// technique as academic-service.test.js/attendance-service.test.js
// (works because financeService always calls e.g.
// `financeRepository.create(...)` as a fresh property lookup, never a
// destructured local).
//
// What's deliberately NOT here: an actual
// fee_structures_college_year_class_category_key /
// fee_structures_class_id_fkey / fee_payments_student_fee_structure_key /
// fee_payments_student_id_fkey / fee_payments_fee_structure_id_fkey
// violation reaching its domain error end-to-end through a real
// Postgres constraint. Both fee_structures (326e8b5) and fee_payments
// (c1b7aac) already live-verified those exact constraint names against
// a real database — this file trusts that grounding rather than
// re-running a live database for a service layer that adds no new SQL
// of its own.
//
// Also deliberately NOT here: any test asserting a real WorkflowService
// gate on fee_structures' status transitions. There is no such gate —
// see financeService.js's own file-level comment for why (WorkflowService,
// Module 8, doesn't exist yet). What IS tested is the one thing this
// slice actually enforces: status must be one of the known literals,
// same shape as academic-service.test.js's own timetableStatus coverage.

const test = require('node:test');
const assert = require('node:assert/strict');
const financeRepository = require('../src/repositories/financeRepository');
const feePaymentRepository = require('../src/repositories/feePaymentRepository');
const auditLogRepository = require('../src/repositories/auditLogRepository');
const financeService = require('../src/services/financeService');

test('FinanceService fee_structures validation and audit logging (no DB)', async (t) => {
  await t.test('createFeeStructure rejects missing academicYear/classId/feeCategory/amount without touching the DB', async () => {
    const createMock = t.mock.method(financeRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => financeService.createFeeStructure({}, { collegeId: 'c1' }),
      financeService.FeeStructureValidationError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createFeeStructure rejects an unknown status without touching the DB', async () => {
    const createMock = t.mock.method(financeRepository, 'create');
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => financeService.createFeeStructure({}, {
        collegeId: 'c1', academicYear: '2025-2026', classId: 'class-1', feeCategory: 'Tuition', amount: '45000.00', status: 'On Hold',
      }),
      financeService.FeeStructureStatusError,
    );
    assert.equal(createMock.mock.callCount(), 0);
  });

  await t.test('createFeeStructure accepts each known status literal', async () => {
    const createMock = t.mock.method(financeRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    const knownStatuses = ['Pending Approval', 'Approved', 'Rejected'];
    for (const status of knownStatuses) {
      await assert.doesNotReject(() => financeService.createFeeStructure({}, {
        collegeId: 'c1', academicYear: '2025-2026', classId: 'class-1', feeCategory: 'Tuition', amount: '45000.00', status,
      }));
    }
  });

  await t.test('createFeeStructure does not require status', async () => {
    const createMock = t.mock.method(financeRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await assert.doesNotReject(() => financeService.createFeeStructure({}, {
      collegeId: 'c1', academicYear: '2025-2026', classId: 'class-1', feeCategory: 'Tuition', amount: '45000.00',
    }));
  });

  await t.test('createFeeStructure drops an unrecognized field instead of passing it through', async () => {
    const createMock = t.mock.method(financeRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await financeService.createFeeStructure({}, {
      collegeId: 'c1', academicYear: '2025-2026', classId: 'class-1', feeCategory: 'Tuition', amount: '45000.00',
      aadhaarNumber: '1234-5678-9012',
    });

    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal('aadhaarNumber' in passedFields, false);
  });

  await t.test('createFeeStructure attributes the audit entry to actorUserId', async () => {
    const createMock = t.mock.method(financeRepository, 'create', async (client, fields) => ({
      id: 'new-id',
      college_id: fields.collegeId,
    }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      createMock.mock.restore();
      auditMock.mock.restore();
    });

    await financeService.createFeeStructure(
      {},
      { collegeId: 'c1', academicYear: '2025-2026', classId: 'class-1', feeCategory: 'Tuition', amount: '45000.00' },
      { actorUserId: 'actor-user' },
    );

    assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'actor-user');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'fee_structure_created');
    assert.equal(auditMock.mock.calls[0].arguments[1].entity, 'fee_structures');
  });

  await t.test('createFeeStructure maps a fee_structures_college_year_class_category_key violation to FeeStructureConflictError', async () => {
    const createMock = t.mock.method(financeRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "fee_structures_college_year_class_category_key"');
      err.code = '23505';
      err.constraint = 'fee_structures_college_year_class_category_key';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => financeService.createFeeStructure({}, {
        collegeId: 'c1', academicYear: '2025-2026', classId: 'class-1', feeCategory: 'Tuition', amount: '45000.00',
      }),
      financeService.FeeStructureConflictError,
    );
  });

  await t.test('createFeeStructure maps a fee_structures_class_id_fkey violation to FeeStructureClassNotFoundError', async () => {
    const createMock = t.mock.method(financeRepository, 'create', async () => {
      const err = new Error('insert or update on table "fee_structures" violates foreign key constraint "fee_structures_class_id_fkey"');
      err.code = '23503';
      err.constraint = 'fee_structures_class_id_fkey';
      throw err;
    });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => financeService.createFeeStructure({}, {
        collegeId: 'c1', academicYear: '2025-2026', classId: 'missing-class', feeCategory: 'Tuition', amount: '45000.00',
      }),
      financeService.FeeStructureClassNotFoundError,
    );
  });

  await t.test('createFeeStructure lets a non-conflict repository error pass through unchanged', async () => {
    const boom = new Error('connection lost');
    const createMock = t.mock.method(financeRepository, 'create', async () => { throw boom; });
    t.after(() => createMock.mock.restore());

    await assert.rejects(
      () => financeService.createFeeStructure({}, {
        collegeId: 'c1', academicYear: '2025-2026', classId: 'class-1', feeCategory: 'Tuition', amount: '45000.00',
      }),
      (err) => err === boom,
    );
  });

  await t.test('getFeeStructure is a thin passthrough to findById', async () => {
    const findMock = t.mock.method(financeRepository, 'findById', async (client, id) => ({ id }));
    t.after(() => findMock.mock.restore());

    const result = await financeService.getFeeStructure({}, 'fee-structure-9');
    assert.equal(result.id, 'fee-structure-9');
  });

  await t.test('updateFeeStructure rejects an unknown status without touching the DB', async () => {
    const updateMock = t.mock.method(financeRepository, 'update');
    t.after(() => updateMock.mock.restore());

    await assert.rejects(
      () => financeService.updateFeeStructure({}, 'fee-structure-1', { status: 'On Hold' }, { userId: 'u1' }),
      financeService.FeeStructureStatusError,
    );
    assert.equal(updateMock.mock.callCount(), 0);
  });

  await t.test('updateFeeStructure with no recognized fields does not write an audit entry', async () => {
    const updateMock = t.mock.method(financeRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await financeService.updateFeeStructure({}, 'fee-structure-1', { aadhaarNumber: 'x' }, { userId: 'u1' });

    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('updateFeeStructure with a recognized field writes an audit entry', async () => {
    const updateMock = t.mock.method(financeRepository, 'update', async (client, id) => ({ id, college_id: 'c1' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    await financeService.updateFeeStructure({}, 'fee-structure-1', { amount: '47000.00' }, { userId: 'u1' });

    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'fee_structure_updated');
  });

  await t.test('updateFeeStructure against a nonexistent id does not write an audit entry', async () => {
    const updateMock = t.mock.method(financeRepository, 'update', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await financeService.updateFeeStructure({}, 'missing-id', { amount: '47000.00' }, { userId: 'u1' });

    assert.equal(result, null);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('updateFeeStructure maps a category conflict on update to FeeStructureConflictError', async () => {
    const updateMock = t.mock.method(financeRepository, 'update', async () => {
      const err = new Error('duplicate key value violates unique constraint "fee_structures_college_year_class_category_key"');
      err.code = '23505';
      err.constraint = 'fee_structures_college_year_class_category_key';
      throw err;
    });
    t.after(() => updateMock.mock.restore());

    await assert.rejects(
      () => financeService.updateFeeStructure({}, 'fee-structure-1', { feeCategory: 'Hostel' }, { userId: 'u1' }),
      financeService.FeeStructureConflictError,
    );
  });

  await t.test('updateFeeStructure maps a class_id_fkey violation on update to FeeStructureClassNotFoundError', async () => {
    const updateMock = t.mock.method(financeRepository, 'update', async () => {
      const err = new Error('insert or update on table "fee_structures" violates foreign key constraint "fee_structures_class_id_fkey"');
      err.code = '23503';
      err.constraint = 'fee_structures_class_id_fkey';
      throw err;
    });
    t.after(() => updateMock.mock.restore());

    await assert.rejects(
      () => financeService.updateFeeStructure({}, 'fee-structure-1', { classId: 'missing-class' }, { userId: 'u1' }),
      financeService.FeeStructureClassNotFoundError,
    );
  });

  await t.test('removeFeeStructure on a nonexistent (or already soft-deleted) id is a no-op, no audit entry', async () => {
    const softDeleteMock = t.mock.method(financeRepository, 'softDelete', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      softDeleteMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await financeService.removeFeeStructure({}, 'missing-id', { userId: 'u1' });

    assert.equal(result, null);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('removeFeeStructure on an existing id soft-deletes (never a hard DELETE) and writes an audit entry', async () => {
    const softDeleteMock = t.mock.method(financeRepository, 'softDelete', async (client, id) => ({ id, college_id: 'c1', deleted_at: '2026-07-04T00:00:00Z' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      softDeleteMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await financeService.removeFeeStructure({}, 'fee-structure-1', { userId: 'u1' });

    assert.equal(result.deleted_at, '2026-07-04T00:00:00Z');
    assert.equal(softDeleteMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'fee_structure_removed');
    // financeRepository never exposes a hard-delete function at all —
    // there's nothing named `remove` to assert was *not* called, same
    // structural guarantee attendanceRepository.js already established.
    assert.equal('remove' in financeRepository, false);
  });

  await t.test('listFeeStructuresForClassAndYear is a thin passthrough to findByClassAndYear', async () => {
    const findMock = t.mock.method(financeRepository, 'findByClassAndYear', async (client, classId, year) => ([{ classId, year }]));
    t.after(() => findMock.mock.restore());

    const result = await financeService.listFeeStructuresForClassAndYear({}, 'class-1', '2025-2026');
    assert.deepEqual(result, [{ classId: 'class-1', year: '2025-2026' }]);
  });

  await t.test('listFeeStructures is a thin passthrough to list', async () => {
    const listMock = t.mock.method(financeRepository, 'list', async (client, opts) => ([{ opts }]));
    t.after(() => listMock.mock.restore());

    const result = await financeService.listFeeStructures({}, { limit: 10, offset: 0 });
    assert.deepEqual(result, [{ opts: { limit: 10, offset: 0 } }]);
  });
});

test('FinanceService fee_payments validation and audit logging (no DB)', async (t) => {
  await t.test('markFeePayment rejects missing collegeId/studentId/feeStructureId/actorUserId/status without touching the DB', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentAndFeeStructure');
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => financeService.markFeePayment({}, { studentId: 'student-1' }, {}),
      financeService.FeePaymentValidationError,
    );
    assert.equal(findMock.mock.callCount(), 0);
  });

  await t.test('markFeePayment rejects an unknown status without touching the DB', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentAndFeeStructure');
    t.after(() => findMock.mock.restore());

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        { collegeId: 'c1', studentId: 'student-1', feeStructureId: 'fee-structure-1', status: 'partially_paid' },
        { actorUserId: 'staff-1' },
      ),
      financeService.FeePaymentStatusError,
    );
    assert.equal(findMock.mock.callCount(), 0);
  });

  await t.test('markFeePayment creates a new payment when none exists yet', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentAndFeeStructure', async () => null);
    const createMock = t.mock.method(feePaymentRepository, 'create', async (client, fields) => ({ id: 'payment-1', ...fields }));
    const updateMock = t.mock.method(feePaymentRepository, 'update');
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const payment = await financeService.markFeePayment(
      {},
      { collegeId: 'c1', studentId: 'student-1', feeStructureId: 'fee-structure-1', status: 'paid' },
      { actorUserId: 'staff-1' },
    );

    assert.equal(payment.id, 'payment-1');
    assert.equal(createMock.mock.callCount(), 1);
    assert.equal(updateMock.mock.callCount(), 0);
    const passedFields = createMock.mock.calls[0].arguments[1];
    assert.equal(passedFields.markedByUserId, 'staff-1');
    assert.equal(passedFields.status, 'paid');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'fee_payment_marked');
    assert.equal(auditMock.mock.calls[0].arguments[1].entity, 'fee_payments');
    assert.equal(auditMock.mock.calls[0].arguments[1].userId, 'staff-1');
  });

  await t.test('markFeePayment re-marks an existing payment instead of creating a new one', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentAndFeeStructure', async () => ({ id: 'payment-2', status: 'not_paid' }));
    const createMock = t.mock.method(feePaymentRepository, 'create');
    const updateMock = t.mock.method(feePaymentRepository, 'update', async (client, id, fields) => ({ id, ...fields }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
      updateMock.mock.restore();
      auditMock.mock.restore();
    });

    const payment = await financeService.markFeePayment(
      {},
      { collegeId: 'c1', studentId: 'student-1', feeStructureId: 'fee-structure-1', status: 'paid', receiptDocumentId: 'doc-1' },
      { actorUserId: 'staff-2' },
    );

    assert.equal(payment.id, 'payment-2');
    assert.equal(createMock.mock.callCount(), 0);
    assert.equal(updateMock.mock.callCount(), 1);
    const passedFields = updateMock.mock.calls[0].arguments[2];
    assert.equal(passedFields.status, 'paid');
    assert.equal(passedFields.markedByUserId, 'staff-2');
    assert.equal(passedFields.receiptDocumentId, 'doc-1');
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'fee_payment_remarked');
  });

  await t.test('markFeePayment maps a fee_payments_student_id_fkey violation to FeePaymentStudentNotFoundError', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentAndFeeStructure', async () => null);
    const createMock = t.mock.method(feePaymentRepository, 'create', async () => {
      const err = new Error('insert or update on table "fee_payments" violates foreign key constraint "fee_payments_student_id_fkey"');
      err.code = '23503';
      err.constraint = 'fee_payments_student_id_fkey';
      throw err;
    });
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        { collegeId: 'c1', studentId: 'missing-student', feeStructureId: 'fee-structure-1', status: 'paid' },
        { actorUserId: 'staff-1' },
      ),
      financeService.FeePaymentStudentNotFoundError,
    );
  });

  await t.test('markFeePayment maps a fee_payments_fee_structure_id_fkey violation to FeePaymentFeeStructureNotFoundError', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentAndFeeStructure', async () => null);
    const createMock = t.mock.method(feePaymentRepository, 'create', async () => {
      const err = new Error('insert or update on table "fee_payments" violates foreign key constraint "fee_payments_fee_structure_id_fkey"');
      err.code = '23503';
      err.constraint = 'fee_payments_fee_structure_id_fkey';
      throw err;
    });
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        { collegeId: 'c1', studentId: 'student-1', feeStructureId: 'missing-fee-structure', status: 'paid' },
        { actorUserId: 'staff-1' },
      ),
      financeService.FeePaymentFeeStructureNotFoundError,
    );
  });

  await t.test('markFeePayment maps a student_fee_structure race to FeePaymentConflictError', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentAndFeeStructure', async () => null);
    const createMock = t.mock.method(feePaymentRepository, 'create', async () => {
      const err = new Error('duplicate key value violates unique constraint "fee_payments_student_fee_structure_key"');
      err.code = '23505';
      err.constraint = 'fee_payments_student_fee_structure_key';
      throw err;
    });
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        { collegeId: 'c1', studentId: 'student-1', feeStructureId: 'fee-structure-1', status: 'paid' },
        { actorUserId: 'staff-1' },
      ),
      financeService.FeePaymentConflictError,
    );
  });

  await t.test('markFeePayment lets a non-conflict repository error pass through unchanged', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentAndFeeStructure', async () => null);
    const boom = new Error('connection lost');
    const createMock = t.mock.method(feePaymentRepository, 'create', async () => { throw boom; });
    t.after(() => {
      findMock.mock.restore();
      createMock.mock.restore();
    });

    await assert.rejects(
      () => financeService.markFeePayment(
        {},
        { collegeId: 'c1', studentId: 'student-1', feeStructureId: 'fee-structure-1', status: 'paid' },
        { actorUserId: 'staff-1' },
      ),
      (err) => err === boom,
    );
  });

  await t.test('getFeePayment is a thin passthrough to findById', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findById', async (client, id) => ({ id }));
    t.after(() => findMock.mock.restore());

    const result = await financeService.getFeePayment({}, 'payment-9');
    assert.equal(result.id, 'payment-9');
  });

  await t.test('listFeePaymentsForStudent is a thin passthrough to findByStudentId', async () => {
    const findMock = t.mock.method(feePaymentRepository, 'findByStudentId', async (client, studentId) => ([{ studentId }]));
    t.after(() => findMock.mock.restore());

    const result = await financeService.listFeePaymentsForStudent({}, 'student-1');
    assert.deepEqual(result, [{ studentId: 'student-1' }]);
  });

  await t.test('listFeePayments is a thin passthrough to list', async () => {
    const listMock = t.mock.method(feePaymentRepository, 'list', async (client, opts) => ([{ opts }]));
    t.after(() => listMock.mock.restore());

    const result = await financeService.listFeePayments({}, { limit: 10, offset: 0 });
    assert.deepEqual(result, [{ opts: { limit: 10, offset: 0 } }]);
  });

  await t.test('removeFeePayment on a nonexistent (or already soft-deleted) id is a no-op, no audit entry', async () => {
    const softDeleteMock = t.mock.method(feePaymentRepository, 'softDelete', async () => null);
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      softDeleteMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await financeService.removeFeePayment({}, 'missing-id', { userId: 'u1' });

    assert.equal(result, null);
    assert.equal(auditMock.mock.callCount(), 0);
  });

  await t.test('removeFeePayment on an existing id soft-deletes (never a hard DELETE) and writes an audit entry', async () => {
    const softDeleteMock = t.mock.method(feePaymentRepository, 'softDelete', async (client, id) => ({ id, college_id: 'c1', deleted_at: '2026-07-04T00:00:00Z' }));
    const auditMock = t.mock.method(auditLogRepository, 'createAuditLogEntry', async () => {});
    t.after(() => {
      softDeleteMock.mock.restore();
      auditMock.mock.restore();
    });

    const result = await financeService.removeFeePayment({}, 'payment-1', { userId: 'u1' });

    assert.equal(result.deleted_at, '2026-07-04T00:00:00Z');
    assert.equal(softDeleteMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.callCount(), 1);
    assert.equal(auditMock.mock.calls[0].arguments[1].action, 'fee_payment_removed');
    assert.equal('remove' in feePaymentRepository, false);
  });
});
