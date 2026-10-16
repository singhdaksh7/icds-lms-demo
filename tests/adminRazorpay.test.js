process.env.DATABASE_URL = process.env.DATABASE_URL || 'mysql://test:test@127.0.0.1:3306/test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'x'.repeat(64);
process.env.RAZORPAY_ENABLED = 'true';
process.env.RAZORPAY_KEY_ID = 'rzp_test_ENVKEY123456';
process.env.RAZORPAY_KEY_SECRET = 'env_secret_value_abc';
process.env.RAZORPAY_WEBHOOK_SECRET = 'env_webhook_secret_xyz';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { prisma } = require('../src/config/db');
const razorpayService = require('../src/services/razorpay.service');
const rs = require('../src/services/razorpaySettings.service');
const { validateRazorpaySettings } = require('../src/validators/razorpay.validator');

const sign = (secret, body) => crypto.createHmac('sha256', secret).update(body).digest('hex');

test('Razorpay validator: key format, required secrets, live-mode confirmation', () => {
  const ok = validateRazorpaySettings({ keyId: 'rzp_test_AbCdEf123456', keySecret: 'secret123', webhookSecret: 'whsec123', enabled: '1' });
  assert.deepEqual(ok.errors, []);
  assert.ok(validateRazorpaySettings({ keyId: 'nope', keySecret: 'secret123' }).errors.length);
  assert.ok(validateRazorpaySettings({ keyId: 'rzp_test_AbCdEf123456' }).errors.length, 'secret required on first save');
  assert.deepEqual(validateRazorpaySettings({ keyId: 'rzp_test_AbCdEf123456' }, { hasKeySecret: true }).errors, []);
  assert.ok(validateRazorpaySettings({ keyId: 'rzp_test_AbCdEf123456', keySecret: 'secret123', enabled: '1' }).errors.length, 'enabling needs a webhook secret');
  const live = { keyId: 'rzp_live_AbCdEf123456', keySecret: 'secret123', webhookSecret: 'whsec123', enabled: '1' };
  assert.ok(validateRazorpaySettings(live).errors.some((e) => /LIVE/.test(e)), 'live needs explicit confirmation');
  assert.deepEqual(validateRazorpaySettings({ ...live, confirmLive: '1' }).errors, []);
});

test('admin Razorpay settings: DB row wins over env, secrets encrypted and never in the admin view', async () => {
  let row = null;
  prisma.razorpaySetting = {
    findUnique: async () => row,
    upsert: async ({ create, update }) => {
      row = row ? { ...row, ...update } : { ...create };
    },
    deleteMany: async () => {
      row = null;
    },
  };
  rs.invalidate();
  assert.equal((await rs.getEffectiveConfig()).source, 'env');
  assert.equal(await razorpayService.isConfigured(), true);

  await rs.save({ enabled: true, keyId: 'rzp_test_ADMINKEY1234', keySecret: 'AdminSecretValue', webhookSecret: 'AdminWebhookValue' });
  assert.ok(!row.keySecretEnc.includes('AdminSecretValue'));
  assert.ok(!row.webhookSecretEnc.includes('AdminWebhookValue'));

  const view = await rs.getAdminView();
  assert.equal(view.hasKeySecret, true);
  assert.equal(view.activeMode, 'test');
  const dump = JSON.stringify(view);
  assert.ok(!dump.includes('AdminSecretValue') && !dump.includes('AdminWebhookValue') && !dump.includes(row.keySecretEnc));

  const cfg = await rs.getEffectiveConfig();
  assert.equal(cfg.source, 'admin');
  assert.equal(cfg.keySecret, 'AdminSecretValue');
  assert.equal(await razorpayService.getPublicKeyId(), 'rzp_test_ADMINKEY1234');
  const sig = sign('AdminSecretValue', 'order_Z|pay_Z');
  assert.equal(await razorpayService.verifyCheckoutSignature({ orderId: 'order_Z', paymentId: 'pay_Z', signature: sig }), true);
  const wh = Buffer.from('{"event":"x"}');
  assert.equal(await razorpayService.verifyWebhookSignature(wh, sign('AdminWebhookValue', wh)), true);
  assert.equal(await razorpayService.verifyWebhookSignature(wh, sign('env_webhook_secret_xyz', wh)), false);

  // blank secrets keep the stored ones; disabling turns checkout off
  await rs.save({ enabled: false, keyId: 'rzp_test_ADMINKEY1234', keySecret: '', webhookSecret: '' });
  assert.equal((await rs.getEffectiveConfig()).keySecret, 'AdminSecretValue');
  assert.equal(await razorpayService.isConfigured(), false);

  await rs.clear();
  assert.equal((await rs.getEffectiveConfig()).source, 'env');
  assert.equal(await razorpayService.isConfigured(), true);
});
