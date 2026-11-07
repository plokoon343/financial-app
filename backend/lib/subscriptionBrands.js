// Subscription brands as banks actually print them. Card statements and alerts
// truncate and mangle merchant names ("N FLX", "NFLX.COM", "SPOTIFY AB",
// "GOOGLE *YouTube", "GOOGLEClaudebyAnth"), so one service shows up under several
// descriptions. Resolving each charge to its brand lets every source land on one
// subscription.
//
// round 6, Block 3 (section 5.2): the 28-brand table that used to live in this file
// as a hardcoded array is now backend/data/merchantCatalogue.json, the one config
// table section 5.2 asks for (editable without an app release), widened there with
// non-subscription merchants too. This file is unchanged on the outside - same
// `brandFor`, same `{name, slug}` shape, same matching behaviour (subscriptionBrands
// .test.js's 28 cases still pass unmodified) - and now just a thin pointer to
// lib/merchantCatalogue.js so the two existing call sites (lib/merchantKey.js,
// server.js) never had to change.
'use strict';

const { brandFor } = require('./merchantCatalogue');

module.exports = { brandFor };
