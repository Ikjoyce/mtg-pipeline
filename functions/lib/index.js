"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setPipelineReaderClaim = exports.curatedInteractions = exports.collectRedditMTGData = void 0;
// Entry point for Firebase Cloud Functions - export only production functions
var redditMtgCollector_1 = require("./redditMtgCollector");
Object.defineProperty(exports, "collectRedditMTGData", { enumerable: true, get: function () { return redditMtgCollector_1.collectRedditMTGData; } });
var curatedInteractions_1 = require("./curatedInteractions");
Object.defineProperty(exports, "curatedInteractions", { enumerable: true, get: function () { return curatedInteractions_1.curatedInteractions; } });
var adminClaims_1 = require("./adminClaims");
Object.defineProperty(exports, "setPipelineReaderClaim", { enumerable: true, get: function () { return adminClaims_1.setPipelineReaderClaim; } });
