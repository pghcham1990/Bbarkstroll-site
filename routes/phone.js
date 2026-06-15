const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const api = require('/opt/twilio-voice/lib/phone-api');

router.get('/phone/calls',     (req, res) => res.json(api.recentCalls(db, { limit: req.query.limit, before: req.query.before })));
router.get('/phone/needs-you', (req, res) => res.json(api.callsNeedingYou(db, {})));
router.post('/phone/calls/:id/outcome', (req, res) => res.json({ ok: api.setOutcome(db, req.params.id, { outcome: req.body.outcome, note: req.body.note }) }));
router.post('/phone/dial', async (req, res) => res.json(await api.startDial({ business: 'barkstroll', to: req.body.to, name: req.body.name })));

module.exports = router;
