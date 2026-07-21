'use strict';

// Unit tests (no DB) for positionAccountInvitationService's recursive
// invite-guard (Phase 2 step 6, Group (a) scope — Level 1/2/3 only;
// Class Tutor's 'ownDepartmentOnly' rule lands in step 10).

const test = require('node:test');
const assert = require('node:assert/strict');
const positionAccountInvitationService = require('../src/services/positionAccountInvitationService');

const { assertCanInvite } = positionAccountInvitationService;

test('assertCanInvite: Level 1/2 requires a Platform Admin actor', async (t) => {
  await t.test('a Platform Admin may invite Level 1', () => {
    assert.doesNotThrow(() => assertCanInvite({
      actorIsPlatformAdmin: true, actorCapabilities: null, targetLevel: 1, targetCollegeId: 'c1',
    }));
  });

  await t.test('a Platform Admin may invite Level 2', () => {
    assert.doesNotThrow(() => assertCanInvite({
      actorIsPlatformAdmin: true, actorCapabilities: null, targetLevel: 2, targetCollegeId: 'c1',
    }));
  });

  await t.test('a tenant actor (even a Principal) cannot invite Level 1', () => {
    assert.throws(
      () => assertCanInvite({
        actorIsPlatformAdmin: false,
        actorCapabilities: { collegeId: 'c1', positions: [{ level: 1 }] },
        targetLevel: 1,
        targetCollegeId: 'c1',
      }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });
});

test('assertCanInvite: Level 3 (HOD) requires a Level 2 tenant actor in the same college', async (t) => {
  await t.test('a Level 2 actor in the same college may invite Level 3', () => {
    assert.doesNotThrow(() => assertCanInvite({
      actorIsPlatformAdmin: false,
      actorCapabilities: { collegeId: 'c1', positions: [{ level: 2 }] },
      targetLevel: 3,
      targetCollegeId: 'c1',
    }));
  });

  await t.test('a Level 2 actor in a DIFFERENT college is forbidden', () => {
    assert.throws(
      () => assertCanInvite({
        actorIsPlatformAdmin: false,
        actorCapabilities: { collegeId: 'c1', positions: [{ level: 2 }] },
        targetLevel: 3,
        targetCollegeId: 'c2',
      }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });

  await t.test('an actor with no Level 2 position is forbidden, even if they hold other positions', () => {
    assert.throws(
      () => assertCanInvite({
        actorIsPlatformAdmin: false,
        actorCapabilities: { collegeId: 'c1', positions: [{ level: 3 }] },
        targetLevel: 3,
        targetCollegeId: 'c1',
      }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });

  await t.test('a Platform Admin cannot invite Level 3 — that is a tenant-actor-only rule', () => {
    assert.throws(
      () => assertCanInvite({
        actorIsPlatformAdmin: true, actorCapabilities: null, targetLevel: 3, targetCollegeId: 'c1',
      }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });

  await t.test('an actor with no resolved capabilities at all is forbidden, not a crash', () => {
    assert.throws(
      () => assertCanInvite({
        actorIsPlatformAdmin: false, actorCapabilities: null, targetLevel: 3, targetCollegeId: 'c1',
      }),
      positionAccountInvitationService.PositionInvitationForbiddenError,
    );
  });
});

test('assertCanInvite: Class Tutor (Level 4 + class_tutor) is not supported yet — step 10', async (t) => {
  await t.test('throws PositionInvitationLevelNotSupportedError, not a generic forbidden error', () => {
    assert.throws(
      () => assertCanInvite({
        actorIsPlatformAdmin: false,
        actorCapabilities: { collegeId: 'c1', positions: [{ level: 3 }] },
        targetLevel: 4,
        targetPositionType: 'class_tutor',
        targetCollegeId: 'c1',
      }),
      positionAccountInvitationService.PositionInvitationLevelNotSupportedError,
    );
  });

  await t.test('plain Level 4 (no position_type) is also not supported — no invite flow exists for plain staff', () => {
    assert.throws(
      () => assertCanInvite({
        actorIsPlatformAdmin: true, actorCapabilities: null, targetLevel: 4, targetCollegeId: 'c1',
      }),
      positionAccountInvitationService.PositionInvitationLevelNotSupportedError,
    );
  });
});
