'use strict';
/**
 * Vercel Serverless Function Catch-All for /api/*
 * Catches all nested API endpoints automatically on Vercel
 */

const requestHandler = require('../server.js');

module.exports = async (req, res) => {
  return requestHandler(req, res);
};
