'use strict';

// Thin wrapper over the twilio SDK's client construction + send call —
// pulled into its own module (not inlined in notificationService.js)
// so it's mockable the same way this codebase already mocks
// nodemailer.createTransport/documentRepository.create/etc: a plain
// property on a required module, called as a live lookup
// (twilioClient.sendMessage(...)), not a fresh SDK client instance
// notificationService.js would otherwise have to construct inline
// (whose own .messages.create is a per-instance own-property, not a
// shared prototype method — not mockable that way at all).

const twilio = require('twilio');

async function sendMessage({
  accountSid, authToken, to, from, body,
}) {
  const client = twilio(accountSid, authToken);
  return client.messages.create({ to, from, body });
}

module.exports = { sendMessage };
