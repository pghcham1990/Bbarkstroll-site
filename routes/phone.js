const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const api = require('/opt/twilio-voice/lib/phone-api');
const sugg = require('/opt/twilio-voice/lib/crm-suggestions');
try { sugg.ensureSchema(db); } catch (_) {}

router.get('/phone/calls',     (req, res) => res.json(api.recentCalls(db, { limit: req.query.limit, before: req.query.before })));
router.get('/phone/needs-you', (req, res) => res.json(api.callsNeedingYou(db, {})));
router.post('/phone/calls/:id/outcome', (req, res) => res.json({ ok: api.setOutcome(db, req.params.id, { outcome: req.body.outcome, note: req.body.note }) }));
router.post('/phone/dial', async (req, res) => res.json(await api.startDial({ business: 'barkstroll', to: req.body.to, name: req.body.name, coach: req.body.coach })));
router.get('/phone/calls/:id/coaching', (req, res) => res.json(api.callCoaching(db, req.params.id)));

router.get('/phone/calls/:sid/suggestions', (req, res) => res.json(sugg.listForCall(db, req.params.sid)));
router.post('/phone/suggestions/:id/decide', (req, res) =>
  res.json(req.body.decision === 'accept' ? sugg.accept(db, req.params.id, 'barkstroll') : sugg.reject(db, req.params.id)));

module.exports = router;
