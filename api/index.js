'use strict';
/**
 * Vercel Serverless Function entrypoint for Koda AI
 * Handles all incoming API endpoints (/api/auth/*, /api/proxy/*, /api/version, etc.)
 */

const requestHandler = require('../server.js');

module.exports = async (req, res) => {
  return requestHandler(req, res);
};
