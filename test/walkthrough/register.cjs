"use strict";

// Resolve `vscode` to the fake module for code loaded under node:test.
const Module = require("module");
const path = require("path");

const fakePath = path.join(__dirname, "fake-vscode.cjs");
const original = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "vscode") {
    return fakePath;
  }
  return original.call(this, request, ...rest);
};
